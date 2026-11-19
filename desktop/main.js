'use strict';
const { app, BrowserWindow, Menu, shell, dialog, safeStorage, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), net = require('net'), crypto = require('crypto');

const PREFERRED_PORT = +process.env.RR_PORT || 47821; // fixed so OAuth redirect URIs stay valid between launches
let win, server, base, serverMod, cfg = { mode: 'local' };
// Auto-update: only for a packaged app on this computer, with a release feed baked in at build time (see docs/GIT_AND_DEPLOY.md).
function setupUpdates(manual) {
  if (!app.isPackaged || cfg.mode === 'remote') { if (manual) dialog.showMessageBox(win, { message: 'Updates are only checked in the installed app.' }); return; }
  let au; try { au = require('electron-updater').autoUpdater; } catch (e) { return; }
  if (!setupUpdates.wired) {
    setupUpdates.wired = true; au.autoDownload = false; au.logger = null;
    au.on('update-available', async i => { const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['Download', 'Later'], defaultId: 0, message: `Version ${i.version} is available`, detail: 'Your data stays as it is.' }); if (r.response === 0) au.downloadUpdate().catch(() => {}); });
    au.on('update-downloaded', async () => { const r = await dialog.showMessageBox(win, { type: 'info', buttons: ['Restart now', 'Later'], defaultId: 0, message: 'Update ready' }); if (r.response === 0) au.quitAndInstall(); });
    au.on('update-not-available', () => { if (setupUpdates.manual) dialog.showMessageBox(win, { message: 'You are on the latest version.' }); });
    au.on('error', e => { if (setupUpdates.manual) dialog.showErrorBox('Could not check for updates', String(e && e.message || e).slice(0, 300)); });
  }
  setupUpdates.manual = !!manual; au.checkForUpdates().catch(() => {});
}
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const loadCfg = () => { try { const c = JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); if (c.mode === 'remote' && /^https:\/\//.test(c.url || '')) cfg = c; } catch (e) { /* defaults */ } };
ipcMain.handle('get-config', () => cfg);
ipcMain.handle('set-server', async (e, url) => {
  if (!String(e.senderFrame && e.senderFrame.url).startsWith('file://')) throw new Error('Not allowed'); // only the local settings window may change this
  if (!url) { fs.writeFileSync(cfgFile(), JSON.stringify({ mode: 'local' })); app.relaunch(); app.exit(0); return; }
  let u; try { u = new URL(url); } catch (x) { throw new Error('That is not a valid address'); } if (u.protocol !== 'https:') throw new Error('Use an https:// address so your data is encrypted in transit');
  try { const r = await fetch(u.origin + '/api/info', { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('bad status'); const j = await r.json(); if (typeof j.desktop !== 'boolean') throw new Error('unexpected reply'); } catch (x) { throw new Error('Could not reach a Revenue Rescue server at that address'); }
  fs.writeFileSync(cfgFile(), JSON.stringify({ mode: 'remote', url: u.origin })); app.relaunch(); app.exit(0);
});

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function portFree(port) { return new Promise(r => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(port, '127.0.0.1', () => s.close(() => r(true))); }); }
async function pickPort() { if (await portFree(PREFERRED_PORT)) return PREFERRED_PORT; return await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); }); }

// The credential-encryption key is wrapped by the operating system (Keychain, DPAPI, libsecret) when available.
function loadKey(dir) {
  const f = path.join(dir, 'key.bin');
  if (fs.existsSync(f)) { const raw = fs.readFileSync(f); if (raw[0] === 1) return safeStorage.decryptString(raw.subarray(1)); return raw.subarray(1).toString('utf8'); }
  const k = crypto.randomBytes(32).toString('hex'), wrap = safeStorage.isEncryptionAvailable();
  fs.writeFileSync(f, Buffer.concat([Buffer.from([wrap ? 1 : 0]), wrap ? safeStorage.encryptString(k) : Buffer.from(k)]), { mode: 0o600 });
  return k;
}

async function startServer() {
  const dir = path.join(app.getPath('userData'), 'data'); fs.mkdirSync(dir, { recursive: true });
  const port = await pickPort(); base = `http://127.0.0.1:${port}`;
  Object.assign(process.env, { DESKTOP: '1', PORT: String(port), BASE_URL: base, DATA_DIR: dir, ENCRYPTION_KEY: loadKey(dir) });
  serverMod = require('../server.js');
  await new Promise((res, rej) => { server = serverMod.app.listen(port, '127.0.0.1', res); server.once('error', rej); });
  serverMod.startWorkers();
}

function openExternalSafe(url) { try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(url); } catch (e) { /* ignore */ } }

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 600, backgroundColor: '#0d1117', title: 'Revenue Rescue', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true, preload: path.join(__dirname, 'preload.js') } });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(base)) { e.preventDefault(); openExternalSafe(url); } });
  win.loadURL(base + '/dashboard.html').catch(() => dialog.showErrorBox('Cannot reach the server', `Could not open ${base}. Check your connection, or use File → Server settings to switch back to this computer.`));
  win.on('closed', () => { win = null; });
}

function serverWindow() {
  const w = new BrowserWindow({ width: 520, height: 330, parent: win, modal: true, resizable: false, title: 'Server settings', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') } });
  w.setMenu(null); w.loadFile(path.join(__dirname, 'server.html'));
}

async function backup() {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder for the backup', properties: ['openDirectory', 'createDirectory'] }); if (r.canceled) return;
  const dir = path.join(app.getPath('userData'), 'data'), out = path.join(r.filePaths[0], 'revenue-rescue-backup-' + new Date().toISOString().slice(0, 10));
  try { serverMod.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); fs.mkdirSync(out, { recursive: true });
    for (const f of ['app.db', 'key.bin']) if (fs.existsSync(path.join(dir, f))) fs.copyFileSync(path.join(dir, f), path.join(out, f));
    dialog.showMessageBox(win, { type: 'info', message: 'Backup saved', detail: `${out}\n\nThe backup contains your data and the key that unlocks your saved connections. Keep it private.` });
  } catch (e) { dialog.showErrorBox('Backup failed', e.message); }
}

function menu() {
  const mac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [...(cfg.mode === 'remote' ? [] : [{ label: 'Back up data…', click: backup }, { label: 'Open data folder', click: () => shell.openPath(path.join(app.getPath('userData'), 'data')) }]), { label: 'Server settings…', click: serverWindow }, { label: 'Check for updates…', click: () => setupUpdates(true) }, { type: 'separator' }, mac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }])] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label: cfg.mode === 'remote' ? `Connected to ${cfg.url}` : `Redirect address for provider apps: ${base}/oauth/callback/<provider>`, enabled: false }] }
  ]));
}

app.whenReady().then(async () => {
  loadCfg();
  if (cfg.mode === 'remote') base = cfg.url; else try { await startServer(); } catch (e) { dialog.showErrorBox('Revenue Rescue could not start', e.message); app.quit(); return; }
  menu(); createWindow(); setTimeout(() => setupUpdates(false), 15000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { server && server.close(); } catch (e) { /* ignore */ } });
