import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

test('Desktop voice shortcuts only register for an active background call and release on focus', async () => {
  const handlers = new Map();
  const registered = new Map();
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL('../desktop/shortcuts.cjs', import.meta.url), 'utf8'), {
    module,
    require: () => ({
      globalShortcut: {
        register: (key, action) => { registered.set(key, action); return true; },
        unregister: key => registered.delete(key),
      },
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
        removeHandler: channel => handlers.delete(channel),
      },
    }),
  });

  const origin = 'https://discordo.lgmartinez.com/';
  const contents = new EventEmitter();
  const window = new EventEmitter();
  const events = [];
  contents.mainFrame = { url: origin };
  contents.getURL = () => origin;
  contents.isDestroyed = () => false;
  contents.send = (...args) => events.push(args);
  window.webContents = contents;
  window.isFocused = () => true;
  module.exports.installVoiceShortcuts(window, url => url === origin);
  const update = handlers.get('discordo:voice-shortcuts');
  const event = { sender: contents, senderFrame: contents.mainFrame };
  const config = { active: true, microphone: 'Ctrl+Alt+F8', audio: 'Alt+F4' };

  update({ ...event, senderFrame: { url: origin } }, config);
  window.emit('blur');
  assert.equal(registered.size, 0);
  update(event, config);
  assert.equal(registered.size, 0);
  window.emit('blur');
  assert.deepEqual([...registered.keys()], ['Alt+Ctrl+F8']);
  registered.get('Alt+Ctrl+F8')();
  assert.deepEqual(events, [['discordo:voice-shortcut', 'microphone']]);
  const staleCallback = registered.get('Alt+Ctrl+F8');
  window.emit('focus');
  assert.equal(registered.size, 0);
  staleCallback();
  assert.equal(events.length, 1);

  window.isFocused = () => false;
  update(event, { active: true, microphone: 'F8', audio: 'F24' });
  assert.deepEqual([...registered.keys()], ['F8', 'F24']);
  registered.get('F24')();
  assert.deepEqual(events.at(-1), ['discordo:voice-shortcut', 'audio']);
  update(event, { active: true, microphone: 'M', audio: 'Ctrl+C' });
  assert.equal(registered.size, 0);
  update(event, config);
  update(event, { active: false });
  assert.equal(registered.size, 0);
  update(event, config);
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  assert.equal(registered.size, 0);
  window.emit('closed');
  assert.equal(handlers.size, 0);
});
