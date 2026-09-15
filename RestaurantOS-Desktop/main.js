/**
 * RestaurantOS Desktop shell — local-first architecture.
 *
 * On launch this spawns the local backend (Express, same one already built and tested in
 * Phase 1 / Docker-Backend-Test) and the frontend (Next.js production server) as child
 * processes ON THIS MACHINE, then opens a window pointed at the local frontend. No network
 * is required for either process to talk to the other -- they're both on localhost. This is
 * what makes offline mode the default behavior rather than a special mode: there is no
 * remote server in the loop for taking an order, printing a ticket, or opening the cash
 * drawer.
 *
 * A second, optional window (customer-facing display) follows the same pattern the CURRENT
 * live app already uses in its own main.js -- a second BrowserWindow, not a second app.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Store = require('electron-store');

const store = new Store({ name: 'restaurantos-config' });
const hardware = require('./hardware');
const scale = require('./scale');

const BACKEND_PORT = 5102;
const FRONTEND_PORT = 3000;

let backendProcess = null;
let frontendProcess = null;
let mainWindow = null;
let customerWindow = null;

// Spawns a plain Node script using Electron's OWN embedded Node runtime, via the documented
// ELECTRON_RUN_AS_NODE trick -- this is what makes the packaged app fully self-contained: a
// restaurant's Windows/Mac machine does NOT need Node.js installed separately, because
// Electron already bundles it. Without ELECTRON_RUN_AS_NODE set, `process.execPath` re-runs
// the Electron BINARY itself (i.e. tries to launch a second full GUI app instance) instead of
// executing the given script as plain JS -- this was a real bug caught by actually launching
// the app under Xvfb: the backend process crashed immediately every single time
// ("Running as root without --no-sandbox is not supported"), so no order, table, or menu
// data was ever reachable. See VERIFICATION.md for the full story.
function spawnNodeScript(scriptPath, args, cwd, label, extraEnv = {}) {
    const child = spawn(process.execPath, [scriptPath, ...args], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...extraEnv },
    });
    child.stdout.on('data', (d) => console.log(`[${label}] ${d}`.trim()));
    child.stderr.on('data', (d) => console.error(`[${label}] ${d}`.trim()));
    child.on('exit', (code) => console.log(`[${label}] exited with code ${code}`));
    return child;
}

// Resolves the backend/frontend project directories for both dev (sibling folders in this
// repo, as today) and a packaged build (bundled as extraResources -- see electron-builder
// config -- copied next to the app under process.resourcesPath).
function resolveProjectDirs() {
    if (app.isPackaged) {
        return {
            backendDir: path.join(process.resourcesPath, 'backend'),
            frontendDir: path.join(process.resourcesPath, 'frontend'),
        };
    }
    return {
        backendDir: path.join(__dirname, '..', 'Docker-Backend-Test', 'backend'),
        frontendDir: path.join(__dirname, '..', 'RestaurantOS-Frontend'),
    };
}

// A restaurant owner installing this app has no terminal to run `openssl rand` or hand-write
// a .env file in -- and the app must never ship with a hardcoded JWT secret baked into every
// install (see backend/config/auth.js's own comment on exactly that vulnerability in the
// OLD app). So the desktop shell generates a random per-install secret itself, once, and
// persists it via electron-store (already a dependency) in this machine's userData
// directory -- never inside the app's own installation folder, which can be read-only and
// gets replaced on every update.
function getOrCreateJwtSecret() {
    let secret = store.get('jwtSecret');
    if (!secret) {
        secret = crypto.randomBytes(48).toString('hex');
        store.set('jwtSecret', secret);
    }
    return secret;
}

// Real restaurant data (orders, tables, menu) must live in a persistent, writable, per-
// install location -- NOT next to the app binary (a standard Windows install lives under
// Program Files, normally not writable by a regular user, and any install folder gets wiped
// on update/reinstall regardless of OS). Electron's userData directory is the standard place
// for exactly this. See knexfile.local.js's RESTAURANTOS_SQLITE_PATH override.
function getSqliteDbPath() {
    return path.join(app.getPath('userData'), 'restaurantos.sqlite');
}

function startLocalServices() {
    const { backendDir, frontendDir } = resolveProjectDirs();

    const backendEnv = {
        JWT_SECRET: getOrCreateJwtSecret(),
        RESTAURANTOS_SQLITE_PATH: getSqliteDbPath(),
    };
    backendProcess = spawnNodeScript(path.join(backendDir, 'server.local.js'), [], backendDir, 'backend', backendEnv);

    // Run Next.js's own compiled CLI entry directly out of the frontend's node_modules --
    // NOT `npx next start`. `npx` needs either a global `next` install or a network fetch to
    // resolve the package, neither of which a restaurant's offline POS machine can rely on.
    // Resolving the CLI script path from frontendDir's own node_modules guarantees the exact
    // Next.js build that was actually tested is what runs in production.
    const nextCli = require.resolve('next/dist/bin/next', { paths: [frontendDir] });
    frontendProcess = spawnNodeScript(nextCli, ['start', '-p', String(FRONTEND_PORT)], frontendDir, 'frontend');
}

function stopLocalServices() {
    if (backendProcess) backendProcess.kill();
    if (frontendProcess) frontendProcess.kill();
}

function isSetupComplete() {
    return !!store.get('setupComplete');
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false, // matches the Stage 2b fix already applied to the current app
        },
    });

    const target = isSetupComplete() ? `http://localhost:${FRONTEND_PORT}/pos` : `http://localhost:${FRONTEND_PORT}/setup`;
    mainWindow.loadURL(target);
}

function openCustomerDisplay() {
    const displays = require('electron').screen.getAllDisplays();
    const secondary = displays.find((d) => d.id !== require('electron').screen.getPrimaryDisplay().id);
    if (!secondary) return; // no second monitor connected -- not an error, just nothing to open

    customerWindow = new BrowserWindow({
        x: secondary.bounds.x,
        y: secondary.bounds.y,
        width: secondary.bounds.width,
        height: secondary.bounds.height,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
    });
    customerWindow.loadURL(`http://localhost:${FRONTEND_PORT}/customer-display`);
}

// Polls a local HTTP URL until it answers (any response at all -- even a 4xx means the
// server is up and listening) or the timeout elapses. Replaces an earlier fixed 3-second
// `setTimeout` guess, which was never reliable: a slower machine (or the first cold start,
// when Next.js compiles routes on demand) could easily take longer than 3 seconds, silently
// pointing the window at a server that isn't listening yet.
function waitForHttp(url, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        function attempt() {
            const req = http.get(url, (res) => {
                res.resume();
                resolve();
            });
            req.on('error', () => {
                if (Date.now() > deadline) return reject(new Error(`Timed out waiting for ${url}`));
                setTimeout(attempt, 300);
            });
        }
        attempt();
    });
}

app.whenReady().then(async () => {
    startLocalServices();
    try {
        await waitForHttp(`http://localhost:${BACKEND_PORT}/check-connection`, 20000);
        await waitForHttp(`http://localhost:${FRONTEND_PORT}/`, 20000);
    } catch (err) {
        console.error('[startup] local services did not come up in time:', err.message);
        // Still try to open the window -- loadURL will show its own error page rather than
        // leaving the user staring at nothing, and the console error above is there for
        // support/diagnostics.
    }
    createMainWindow();
    openCustomerDisplay();
});

app.on('window-all-closed', () => {
    stopLocalServices();
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopLocalServices);

// --- Hardware IPC bridge (see hardware.js + preload.js) ---
ipcMain.handle('hardware:listPrinters', () => hardware.listPrinters());
ipcMain.handle('hardware:print', (event, payload) => hardware.print(payload));
ipcMain.handle('hardware:openCashDrawer', (event, printerId) => hardware.openCashDrawer(printerId));
ipcMain.handle('hardware:listPaymentTerminals', () => hardware.listPaymentTerminals());
ipcMain.handle('config:get', (event, key) => store.get(key));
ipcMain.handle('config:set', (event, key, value) => store.set(key, value));

// --- Weighing scale IPC bridge (see scale.js + preload.js) ---
// Scale connection covers USB / RS232 / RJ11-RJ12 "telephone port" scales uniformly under
// 'serial' transport (they all present as a virtual COM port once wired into this machine),
// and Ethernet-connected scale indicators under 'network' transport (plain TCP socket).
ipcMain.handle('hardware:listScales', () => scale.listSerialPorts());
ipcMain.handle('hardware:autoDetectScale', (event, options) => scale.autoDetectSerialScale(options));
ipcMain.handle('hardware:discoverNetworkScales', (event, subnetBase, options) => scale.discoverNetworkScales(subnetBase, options));
ipcMain.handle('hardware:connectScale', (event, config) => scale.connectScale(config));
ipcMain.handle('hardware:disconnectScale', () => scale.disconnectScale());
ipcMain.handle('hardware:getScaleReading', () => scale.getLastReading());
ipcMain.handle('hardware:isScaleConnected', () => scale.isConnected());

// Live weight readings are pushed to whichever window is focused (normally the POS screen)
// as they arrive, rather than making the renderer poll for every reading -- polling would
// miss the brief "stable" moment on a fast-settling scale.
scale.bus.on('weight', (reading) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hardware:scale-weight', reading);
    }
});
scale.bus.on('error', (err) => {
    console.error('[scale] error:', err.message);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hardware:scale-error', { message: err.message });
    }
});
