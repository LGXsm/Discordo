const { app, autoUpdater, BrowserWindow, Menu, dialog, net, session, shell } = require('electron');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { installScreenPicker } = require('./screen-picker.cjs');
const { installVoiceShortcuts } = require('./shortcuts.cjs');
const { startUpdates } = require('./updates.cjs');
const { showUpdateNotice } = require('./update-notice.cjs');
const { refreshShortcutIcons } = require('./shortcut-icon.cjs');
const windowFrame = require('./window-frame.cjs');

const home = new URL('https://discordo.lgmartinez.com/');
const titleBarCss = readFileSync(path.join(__dirname, 'titlebar.css'), 'utf8');
let window;

function isDiscordo(address) {
  if (!URL.canParse(address)) return false;
  const url = new URL(address);
  return url.protocol === 'https:' && url.origin === home.origin;
}

function openExternal(address) {
  if (!URL.canParse(address)) return;
  const url = new URL(address);
  if (url.protocol === 'https:' || url.protocol === 'http:') {
    void shell.openExternal(url.href).catch(console.error);
  }
}

async function loadHome(browserWindow) {
  try {
    await browserWindow.loadURL(home.href, { extraHeaders: 'Cache-Control: no-cache\r\n' });
  } catch (error) {
    if (browserWindow.isDestroyed() || error.code === 'ERR_ABORTED') return;
    browserWindow.show();
    const { response } = await dialog.showMessageBox(browserWindow, {
      type: 'error',
      title: 'Discordo',
      message: 'Não foi possível conectar ao Discordo.',
      detail: 'Confira a conexão com a internet e tente novamente.',
      buttons: ['Tentar novamente', 'Fechar'],
      defaultId: 0,
      cancelId: 1,
    });
    if (browserWindow.isDestroyed()) return;
    if (response === 0) await loadHome(browserWindow);
    else browserWindow.close();
  }
}

function createWindow() {
  const desktopSession = session.fromPartition('persist:discordo');
  const browserWindow = new BrowserWindow({
    title: 'Discordo',
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#190f23',
    ...windowFrame,
    icon: path.join(__dirname, 'discordo.ico'),
    show: false,
    webPreferences: {
      session: desktopSession,
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
    },
  });
  window = browserWindow;
  browserWindow.once('ready-to-show', () => browserWindow.show());
  browserWindow.on('closed', () => { window = undefined; });

  const contents = browserWindow.webContents;
  contents.on('dom-ready', () => {
    if (isDiscordo(contents.getURL())) void contents.insertCSS(titleBarCss, { cssOrigin: 'user' }).catch(console.error);
  });
  const permissions = new Set(['clipboard-sanitized-write', 'media', 'speaker-selection', 'display-capture', 'fullscreen']);
  function allows(sender, permission, origin, details) {
    return sender === contents && details.isMainFrame && isDiscordo(origin) && permissions.has(permission);
  }
  desktopSession.setPermissionCheckHandler(allows);
  desktopSession.setPermissionRequestHandler((sender, permission, callback, details) =>
    callback(allows(sender, permission, details.requestingUrl, details)));
  installScreenPicker(browserWindow, desktopSession, isDiscordo);
  installVoiceShortcuts(browserWindow, isDiscordo);

  contents.on('will-navigate', event => {
    if (isDiscordo(event.url)) return;
    event.preventDefault();
    if (event.initiator === contents.mainFrame) openExternal(event.url);
  });
  contents.on('will-redirect', event => {
    if (event.isMainFrame && !isDiscordo(event.url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isDiscordo(url)) void contents.loadURL(url).catch(console.error);
    else openExternal(url);
    return { action: 'deny' };
  });

  void loadHome(browserWindow).catch(console.error);
}

if (require('electron-squirrel-startup') || !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId('com.squirrel.Discordo.Discordo');
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    if (process.platform === 'win32' && app.isPackaged) {
      refreshShortcutIcons(shell, process.execPath, app.getPath('desktop'), app.getPath('appData'));
    }
    createWindow();
    const contents = window.webContents;
    const updater = existsSync(path.join(path.dirname(process.execPath), '..', 'Update.exe'))
      ? startUpdates({
        app, autoUpdater, showUpdateNotice, net, window,
        onFirstRun: process.argv.includes('--squirrel-firstrun'),
        onStatus: state => {
          if (isDiscordo(contents.getURL())) contents.send('discordo:update-status', state);
        },
      }) : undefined;
    const trusted = event => event.senderFrame === contents.mainFrame && isDiscordo(event.senderFrame?.url);
    const updateState = () => updater?.getState() ?? { version: app.getVersion(), status: 'unavailable' };
    contents.ipc.handle('discordo:updates:get', event => trusted(event) ? updateState() : undefined);
    contents.ipc.handle('discordo:updates:check', event => {
      if (!trusted(event)) return;
      void updater?.check();
      return updateState();
    });
    contents.ipc.handle('discordo:updates:restart', event => {
      if (trusted(event)) updater?.restart();
    });
  }).catch(console.error);
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
}
