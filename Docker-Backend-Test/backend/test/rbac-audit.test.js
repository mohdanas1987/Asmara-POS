'use strict';
/**
 * Full RBAC enforcement audit (CTO forensic audit 2026-09-21, P0 "Full RBAC enforcement
 * audit -- every mutating route needs a real automated test proving it's gated by the
 * correct permission, not spot checks").
 *
 * This is deliberately NOT another set of hand-picked "does role X get 403 on route Y"
 * checks (test/rbac.test.js and test/role-permissions.test.js already do that, well, for a
 * handful of routes). Spot checks can't catch the next route someone adds without thinking
 * about permissions -- which is exactly how /orders/cancel shipped unprotected in the first
 * place. Instead, this test walks the REAL Express router stack for every routes/*.js file
 * at runtime (the actual registered middleware chain, not source-code guessing) and asserts
 * that every mutating route (POST/PUT/PATCH/DELETE) is one of:
 *
 *   1. Gated by requirePermission(...) (middlewares/requirePermission.js tags its returned
 *      middleware with `__requiresPermission` specifically so this test can find it without
 *      parsing source text or guessing from function names).
 *   2. Gated by a different, equally-real auth layer: requirePlatformAdmin (superadmin.js,
 *      billing-admin.js) or websiteApiKey (the public website webhook).
 *   3. Explicitly allowlisted below, with a one-line reason -- these are routes a human
 *      reviewed and decided, on purpose, need no permission beyond "is a logged-in staff
 *      member of this tenant" (fetchuser). Anything not on this list and not otherwise
 *      gated fails the test.
 *
 * A future PR that adds a new mutating route and forgets to gate (or allowlist) it fails
 * this test immediately, on CI, before it ever reaches production -- that's the actual
 * "full audit" the verdict asked for, not a one-time manual pass that goes stale.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// bcrypt/sharp are native modules some routes require at module-load time purely for
// handlers this test never calls -- stub them so requiring the router doesn't need a real
// native binding to exist for THIS process's platform/arch.
const origLoad = Module._load;
function withNativeStubs(fn) {
    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === 'bcrypt') {
            return { hash: async () => 'stub', compare: async () => true, genSalt: async () => 'stub', hashSync: () => 'stub', compareSync: () => true };
        }
        if (request === 'sharp') {
            return () => ({ resize: () => ({ toBuffer: async () => Buffer.from(''), toFile: async () => {} }) });
        }
        return origLoad.apply(this, arguments);
    };
    try {
        return fn();
    } finally {
        Module._load = origLoad;
    }
}

const MUTATING = ['post', 'put', 'patch', 'delete'];

// Every entry here was read and judged by hand (see the comment on each) -- this is not a
// blanket escape hatch, it's the explicit record of "we looked at this one."
const ALLOWLIST = {
    'auth.js': {
        'POST /signup': 'pre-auth by design: creates the very first account for a new tenant.',
        'POST /signup-tenant': 'pre-auth by design: tenant onboarding, no session exists yet.',
        'POST /login': 'pre-auth by design: this IS the login endpoint.',
        'POST /pin-login': "staff quick-switch (CTO audit 2026-09-20): requires an already-unlocked terminal session (fetchuser); switching WHO is active is deliberately not further permission-gated, same as physically handing a badge to a coworker.",
        'POST /qr-login': 'same staff quick-switch mechanism as /pin-login, same reasoning.',
    },
    'config.js': {
        'POST /update-stock-alert': "self-scoped: writes a Setting row keyed to the caller's OWN user_id -- a personal notification preference, not tenant config.",
        'DELETE /notification/delete/:id': 'dismissing a notification from the shared feed is a benign, non-destructive-to-business-data UI action available to any staff member.',
    },
    'kitchen.js': {
        'POST /tickets/:id/print-result': 'an automated print-result callback fired by the printing subsystem right after a ticket prints, not a user-initiated privileged action.',
    },
    'orders.js': {
        'POST /x-report': 'core cashier/waiter end-of-shift duty (mid-shift register check); no register-report permission exists in the model and gating this behind REPORTS_VIEW would lock cashiers out of checking their own till.',
        'POST /z-report': 'same reasoning as /x-report -- closing out the register at end of shift is a normal cashier/waiter duty, not a management-only "view reports" action.',
    },
    'pos.js': {
        'POST /session': 'opening a POS session on the till one is already logged into is a normal operational action for any staff role working the register.',
        'POST /opening-day-cash-amount': 'entering the starting cash float for a session one is already opening; same tier as /session.',
        'POST /create-customer': 'creating a walk-in/loyalty customer record is a routine front-of-house task for any staff role, not a management action.',
    },
    'sync.js': {
        'POST /terminals/register': "an automated terminal heartbeat/self-registration fired on boot by the terminal app itself, not a user-initiated action.",
        'POST /push': "handles its own finer-grained check in-handler: a single push batch can carry mutations for different entity types (table_layout vs. menu_item) that require DIFFERENT permissions (SETTINGS_MANAGE vs. MENU_MANAGE respectively) -- a static per-route middleware tag can't express a per-mutation-in-a-batch distinction, so this route is intentionally exempted from the blanket check and instead covered by its own behavioral tests in test/sync-mutations.test.js (see ENTITY_PERMISSION in routes/sync.js).",
    },
    'users.js': {
        'POST /:id/pin': "handles its own finer-grained check in-handler: setting one's OWN pin needs no extra permission, setting someone ELSE's pin requires STAFF_MANAGE (see the comment above this route) -- a static middleware tag can't express that self-vs-other distinction, so this route is intentionally exempted from the blanket check and instead covered by its own behavioral test.",
    },
};

function auditRouterFile(file) {
    const r = require(path.join('..', 'routes', file));
    if (!r || !r.stack) return { file, error: 'not an Express router' };

    const globalMiddlewareNames = [];
    const findings = [];
    for (const layer of r.stack) {
        if (!layer.route) {
            globalMiddlewareNames.push(layer.name);
            continue;
        }
        const methods = Object.keys(layer.route.methods).filter((m) => MUTATING.includes(m));
        if (methods.length === 0) continue;

        const handleNames = layer.route.stack.map((s) =>
            s.handle.__requiresPermission ? `PERM:${s.handle.__requiresPermission}` : s.handle.name || 'anonymous'
        );
        const isPermissionGated = handleNames.some((n) => n.startsWith('PERM:'));
        const isPlatformAdminGated = globalMiddlewareNames.includes('requirePlatformAdmin');
        const isWebsiteKeyGated = handleNames.includes('websiteApiKey');

        for (const method of methods) {
            const key = `${method.toUpperCase()} ${layer.route.path}`;
            const gated = isPermissionGated || isPlatformAdminGated || isWebsiteKeyGated;
            const allowlistReason = ALLOWLIST[file] && ALLOWLIST[file][key];
            findings.push({ key, gated, allowlisted: Boolean(allowlistReason), handleNames });
        }
    }
    return { file, findings };
}

test('RBAC audit: every mutating route in every routes/*.js file is permission-gated or explicitly, reviewably allowlisted', () => {
    const savedJwtSecret = process.env.JWT_SECRET;
    if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'rbac-audit-test-secret';

    const routesDir = path.join(__dirname, '..', 'routes');
    const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js'));
    const unprotected = [];
    const stillOk = [];

    withNativeStubs(() => {
        for (const file of files) {
            let result;
            try {
                result = auditRouterFile(file);
            } catch (e) {
                // A route file that can't even be required in a test process (missing an
                // unrelated env var, etc.) is a gap in this audit's own coverage, not a pass --
                // fail loudly rather than silently skipping a whole file.
                unprotected.push(`${file}: COULD NOT AUDIT (require failed: ${e.message})`);
                continue;
            }
            if (result.error) {
                unprotected.push(`${file}: ${result.error}`);
                continue;
            }
            for (const f of result.findings) {
                if (f.gated || f.allowlisted) {
                    stillOk.push(`${file} ${f.key}`);
                } else {
                    unprotected.push(`${file} ${f.key} -- middleware chain: [${f.handleNames.join(', ')}]`);
                }
            }
        }
    });

    if (savedJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedJwtSecret;

    assert.equal(
        unprotected.length,
        0,
        `Found ${unprotected.length} mutating route(s) with no permission gate and no allowlist entry ` +
            `(add requirePermission(...) to the route, or a reviewed, justified entry to ALLOWLIST above ` +
            `if it genuinely needs none):\n  - ${unprotected.join('\n  - ')}`
    );
    // Sanity check on the audit itself: if this drops to zero, the audit silently stopped
    // finding any mutating routes at all (e.g. a refactor changed how routers are built) and
    // the "0 unprotected" result above would be meaningless.
    assert.ok(stillOk.length > 30, `Expected to find and account for a substantial number of mutating routes, only found ${stillOk.length} -- the audit may not be walking the router stacks correctly any more.`);
});
