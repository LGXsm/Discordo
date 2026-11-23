const { BrowserWindow, desktopCapturer, ipcMain } = require('electron');
const path = require('node:path');

function installScreenPicker(browserWindow, desktopSession, isDiscordo) {
  const contents = browserWindow.webContents;
  let picker;
  let navigation = 0;
  contents.on('did-start-navigation', event => {
    if (!event.isMainFrame || event.isSameDocument) return;
    navigation++;
    picker?.close();
  });
  contents.on('render-process-gone', () => {
    navigation++;
    picker?.close();
  });

  function trusted(request) {
    return !contents.isDestroyed() && request.frame && request.frame === contents.mainFrame &&
      isDiscordo(request.securityOrigin) && isDiscordo(request.frame.url);
  }

  async function choose(request) {
    const requestedPage = navigation;
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 240, height: 135 },
    });
    if (!sources.length || requestedPage !== navigation || !trusted(request)) return null;
    const choices = sources.map(source => ({
      name: source.name,
      screen: source.id.startsWith('screen:'),
      thumbnail: source.thumbnail.toDataURL(),
    }));

    return new Promise(resolve => {
      picker = new BrowserWindow({
        parent: browserWindow,
        modal: true,
        title: 'Compartilhar tela · Discordo',
        width: 650,
        height: 590,
        minWidth: 380,
        minHeight: 320,
        show: false,
        backgroundColor: '#1b1325',
        webPreferences: {
          preload: path.join(__dirname, 'screen-picker-preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      const pickerContents = picker.webContents;
      const fromPicker = event => event.sender === pickerContents && event.senderFrame === pickerContents.mainFrame;
      let selection = null;
      ipcMain.handle('discordo:screen-choices', event => fromPicker(event)
        ? { choices, audioAvailable: process.platform === 'win32' && request.audioRequested }
        : undefined);
      ipcMain.handle('discordo:screen-select', (event, index, audio) => {
        if (!fromPicker(event)) return;
        if (index === null) {
          picker.close();
          return;
        }
        if (!Number.isInteger(index) || !sources[index]) return;
        const video = sources[index];
        selection = { video };
        if (audio === true && request.audioRequested && process.platform === 'win32' && choices[index].screen) {
          selection.audio = 'loopback';
        }
        picker.close();
      });
      pickerContents.on('will-navigate', event => event.preventDefault());
      pickerContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      picker.once('ready-to-show', () => picker.show());
      picker.once('closed', () => {
        ipcMain.removeHandler('discordo:screen-choices');
        ipcMain.removeHandler('discordo:screen-select');
        picker = undefined;
        resolve(requestedPage === navigation && trusted(request) ? selection : null);
      });
      void picker.loadFile(path.join(__dirname, 'screen-picker.html')).catch(error => {
        console.error(error);
        picker?.close();
      });
    });
  }

  let pending = false;
  desktopSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (pending || !request.userGesture || !request.videoRequested || !trusted(request)) {
      callback(null);
      return;
    }
    pending = true;
    let selection = null;
    try {
      selection = await choose(request);
    } catch (error) {
      console.error('Não foi possível listar as fontes de captura.', error);
    } finally {
      pending = false;
    }
    if (!contents.isDestroyed() && request.frame) callback(selection);
  });
}

module.exports = { installScreenPicker };
