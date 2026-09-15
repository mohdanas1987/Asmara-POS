'use strict';
/**
 * backend/config/auth.js
 *
 * STAGE 2 / phase 15 (JWT secret fix).
 *
 * Before this change, `routes/auth.js` and `middlewares/loggedIn.js` each independently
 * declared `const JWT_SECRET = 'whateverItWas';` — a hardcoded literal, identical in both
 * files, shipped inside every copy of the packaged application. Anyone who extracted the
 * app.asar could read this constant directly and forge a valid JWT for any user id,
 * completely bypassing authentication for every `fetchuser`-protected route.
 *
 * JWT_SECRET must now be a real, per-install secret provided via the environment. The
 * server intentionally refuses to start without one — there is no fallback literal here,
 * because a fallback would just recreate the original vulnerability under a different name.
 *
 * See ../../SETUP-INSTRUCTIONS.md for how to generate one.
 */

require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error(
    'Missing required environment variable: JWT_SECRET.\n' +
    'Generate one with:\n' +
    '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n' +
    'and set it in your .env file. See SETUP-INSTRUCTIONS.md.'
  );
}

if (JWT_SECRET === 'whateverItWas') {
  throw new Error(
    'JWT_SECRET is still set to the old hardcoded literal value. This is exactly the ' +
    'vulnerability this fix exists to close — generate a new random secret instead.'
  );
}

module.exports = { JWT_SECRET };
