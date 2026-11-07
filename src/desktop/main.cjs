'use strict';
/**
 * Windows desktop entry point (Electron).
 *
 * Runs the authoritative campaign host in-process and opens the GM window on it. Additional
 * windows (player windows for single-computer play, pop-outs) load the same host. The bundled
 * GURPS Character Sheet runs as its own native application, launched from here.
 *
 * appId / productName are unchanged from earlier builds so %APPDATA% data stays in place and the
 * previous build's save (character-data/profiles.json) can be migrated.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const path = require('node:path');
const { Host } = require('../server/host');

let host = null;
// Automatic updates (installed builds only). Releases are published by the GitHub Actions
// workflow to the repository named in package.json "build.publish".
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* development checkout without dependency */ }
let updateState = { status: 'idle', version: null };
let gmWindow = null;
const windows = new Set();

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => { if (gmWindow) { if (gmWindow.isMinimized()) gmWindow.restore(); gmWindow.focus(); } });

function allowedUrl(url) {
  try { const u = new URL(url); return u.hostname === '127.0.0.1' && Number(u.port) === host.port; } catch { return false; }
}

function makeWindow(url, { title = 'S.T.A.L.K.E.R. GURPS Companion', width = 1600, height = 980 } = {}) {
  const win = new BrowserWindow({
    width, height, minWidth: 1100, minHeight: 700, title, backgroundColor: '#0b1219', autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (allowedUrl(target)) { makeWindow(target, { title: 'Companion window', width: 1400, height: 900 }); return { action: 'deny' }; }
    if (/^https:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => { if (!allowedUrl(target)) e.preventDefault(); });
  win.loadURL(url);
  windows.add(win);
  win.on('closed', () => windows.delete(win));
  return win;
}

function menu() {
  const send = (fn) => () => fn();
  return Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Save campaign', accelerator: 'CmdOrCtrl+S', click: send(() => host.current.snapshot('manual')) },
      { label: 'Create named backup', click: send(() => { const f = host.current.backup('manual'); dialog.showMessageBox({ message: `Backup created: ${f}` }); }) },
      { label: 'Open campaign data folder', click: send(() => shell.openPath(host.dataDir)) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Windows', submenu: [
      { label: 'New window (main menu)', accelerator: 'CmdOrCtrl+Shift+N', click: send(() => makeWindow(host.menuUrl(), { title: 'S.T.A.L.K.E.R. GURPS Companion', width: 1400, height: 900 })) },
    ] },
    { label: 'GCS', submenu: [
      { label: 'Open GURPS Character Sheet', click: send(() => { try { host.gcs.launch(); } catch (e) { dialog.showErrorBox('GCS', e.message); } }) },
      { label: 'Locate gcs.exe…', click: async () => { const r = await dialog.showOpenDialog(gmWindow, { title: 'Locate GURPS Character Sheet', properties: ['openFile'], filters: [{ name: 'GCS', extensions: ['exe'] }] }); if (!r.canceled) try { host.gcs.setExecutable(r.filePaths[0]); } catch (e) { dialog.showErrorBox('GCS', e.message); } } },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'Check for updates…', enabled: !!autoUpdater && app.isPackaged, click: () => checkForUpdates(true) },
      { label: updateState.status === 'ready' ? `Restart to install ${updateState.version}` : 'Restart to install update', enabled: updateState.status === 'ready', click: () => installUpdate() },
      { type: 'separator' },
      { label: 'About', click: () => dialog.showMessageBox({ message: `S.T.A.L.K.E.R. GURPS Companion ${app.getVersion()}`, detail: 'GURPS is a trademark of Steve Jackson Games; this is an unofficial fan tool.\nBundles GURPS Character Sheet (GCS) by Richard A. Wilkes under the Mozilla Public License 2.0 — https://github.com/richardwilkes/gcs' }) },
    ] },
  ]);
}

function checkForUpdates(manual = false) {
  if (!autoUpdater || !app.isPackaged) return;
  updateState.manual = manual;
  autoUpdater.checkForUpdates().catch(e => { if (manual) dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates.', detail: e.message }); });
}

async function installUpdate() {
  if (updateState.status !== 'ready') return;
  stopping = true; // the campaign is saved by host.stop(); skip the normal quit handler
  try { await host.stop(); } catch { /* still install */ }
  autoUpdater.quitAndInstall(true, true); // silent install, then relaunch
}

function setupUpdates() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // if the GM chooses "Later", it installs on the next close
  autoUpdater.on('update-available', info => { updateState = { status: 'downloading', version: info.version }; host.notify('update', `Update ${info.version} found — downloading in the background. Play can continue.`, false); });
  autoUpdater.on('update-not-available', () => { if (updateState.manual) dialog.showMessageBox({ type: 'info', message: `You have the latest version (${app.getVersion()}).` }); updateState = { status: 'idle', version: null }; });
  autoUpdater.on('error', e => { host.notify('update', `Update check failed: ${String(e.message || e).split('\n')[0]}`); if (updateState.manual) dialog.showMessageBox({ type: 'warning', message: 'Update failed.', detail: String(e.message || e) }); });
  autoUpdater.on('update-downloaded', async info => {
    updateState = { status: 'ready', version: info.version };
    Menu.setApplicationMenu(menu());
    host.notify('update', `Version ${info.version} is ready. It installs when you close the app (or Help → Restart to install).`, false);
    const r = await dialog.showMessageBox(gmWindow, { type: 'info', buttons: ['Restart and update now', 'Later (install when I close the app)'], defaultId: 1, cancelId: 1, message: `Version ${info.version} has been downloaded.`, detail: 'Your campaign is saved first. Connected players reconnect automatically after the restart.' });
    if (r.response === 0) installUpdate();
  });
  setTimeout(() => checkForUpdates(false), 8000); // after start-up
  setInterval(() => checkForUpdates(false), 4 * 3600 * 1000).unref();
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const userData = app.getPath('userData');
  host = new Host({
    dataDir: path.join(userData, 'campaign-data'),
    port: 7788,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    legacyDataFile: path.join(userData, 'character-data', 'profiles.json'),
    portFallback: true,
  });
  try { await host.start(); }
  catch (e) { dialog.showErrorBox('Companion failed to start', e.stack || e.message); app.quit(); return; }
  ipcMain.handle('pick-gcs-file', async (ev) => { const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(ev.sender), { title: 'Link a GCS character', properties: ['openFile'], filters: [{ name: 'GCS character', extensions: ['gcs'] }] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('pick-gcs-exe', async (ev) => { const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(ev.sender), { title: 'Locate gcs.exe', properties: ['openFile'], filters: [{ name: 'Program', extensions: ['exe', ''] }] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('open-window', (_ev, url, title) => { if (allowedUrl(url)) makeWindow(url, { title: `Companion — ${String(title || '').slice(0, 60)}`, width: 1400, height: 900 }); return true; });
  Menu.setApplicationMenu(menu());
  // opens on the main menu: the GM signs in with the GM password, players pick a character
  gmWindow = makeWindow(host.menuUrl(), { title: 'S.T.A.L.K.E.R. GURPS Companion' });
  gmWindow.on('closed', () => { gmWindow = null; });
  setupUpdates();
});

app.on('window-all-closed', () => app.quit());
let stopping = false;
app.on('before-quit', async (e) => {
  if (stopping || !host) return;
  e.preventDefault(); stopping = true;
  try { await host.stop(); } finally { app.quit(); }
});
