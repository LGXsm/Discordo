import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const requireDesktop = createRequire(new URL('../desktop/screen-picker.cjs', import.meta.url));
const frameOptions = requireDesktop('./window-frame.cjs');

test('Capture picker opens as a modal with the Discordo window frame', async () => {
  const contents = new EventEmitter();
  const origin = 'https://discordo.lgmartinez.com';
  contents.mainFrame = { url: origin };
  contents.isDestroyed = () => false;
  const parent = { webContents: contents };
  let onRequest;
  const session = { setDisplayMediaRequestHandler: callback => { onRequest = callback; } };
  let pickerOptions;
  const handlers = new Map();

  class Picker extends EventEmitter {
    constructor(options) {
      super();
      pickerOptions = options;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = () => {};
    }

    async loadFile() {
      handlers.get('discordo:screen-select')({
        sender: this.webContents,
        senderFrame: this.webContents.mainFrame,
      }, null);
    }

    close() { this.emit('closed'); }
  }

  const electron = {
    BrowserWindow: Picker,
    desktopCapturer: { getSources: async () => [{ id: 'screen:0:0', thumbnail: { isEmpty: () => true } }] },
    ipcMain: {
      handle: (name, handler) => handlers.set(name, handler),
      removeHandler: name => handlers.delete(name),
    },
  };
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../desktop/screen-picker.cjs', import.meta.url), 'utf8'), {
    module, require: name => name === 'electron' ? electron : requireDesktop(name), __dirname: 'desktop',
  });
  module.exports.installScreenPicker(parent, session, url => url === origin);
  const selection = await new Promise(resolve => onRequest({
    frame: contents.mainFrame, securityOrigin: origin, videoRequested: true, userGesture: true,
  }, resolve));

  assert.equal(pickerOptions.parent, parent);
  assert.equal(pickerOptions.modal, true);
  for (const [property, value] of Object.entries(frameOptions)) assert.equal(pickerOptions[property], value);
  assert.equal(selection, null);
  assert.equal(handlers.size, 0);
});
