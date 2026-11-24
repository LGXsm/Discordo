const { BrowserWindow } = require('electron');
const path = require('node:path');
const windowFrame = require('./window-frame.cjs');

function showUpdateNotice(parent, version) {
  const width = Math.min(460, parent.getBounds().width);
  const notice = new BrowserWindow({
    ...windowFrame,
    parent,
    modal: true,
    title: 'Atualização do Discordo',
    width,
    height: width < 420 ? 270 : 238,
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    backgroundColor: '#190f23',
    webPreferences: {
      preload: path.join(__dirname, 'update-notice-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const contents = notice.webContents;
  contents.on('will-navigate', event => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return new Promise((resolve, reject) => {
    let restart = false;
    contents.ipc.on('discordo:update-choice', (event, choice) => {
      if (event.senderFrame !== contents.mainFrame || typeof choice !== 'boolean') return;
      restart = choice;
      notice.close();
    });
    notice.once('closed', () => resolve(restart));
    notice.once('ready-to-show', () => notice.show());
    void notice.loadFile(path.join(__dirname, 'update-notice.html'), { query: { version: version ?? '' } }).catch(error => {
      reject(error);
      if (!notice.isDestroyed()) notice.close();
    });
  });
}

module.exports = { showUpdateNotice };
