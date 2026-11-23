const { globalShortcut, ipcMain } = require('electron');

const actions = ['microphone', 'audio'];

// Keep ordinary typing and common editing shortcuts available in other apps.
function accelerator(binding) {
  if (typeof binding !== 'string' || binding.length > 32) return;
  const [key, ...modifiers] = binding.split('+').reverse();
  if (new Set(modifiers).size !== modifiers.length ||
      modifiers.some(modifier => !['Ctrl', 'Alt', 'Shift'].includes(modifier))) return;
  if (modifiers.includes('Ctrl') && modifiers.includes('Alt') &&
      /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key)) {
    return [...modifiers.sort(), key].join('+');
  }
}

function installVoiceShortcuts(window, isDiscordo) {
  const contents = window.webContents;
  const registered = new Map();
  let bindings = {};
  let enabled = false;

  function clear() {
    for (const key of registered.values()) globalShortcut.unregister(key);
    registered.clear();
  }

  function refresh(focused = window.isFocused()) {
    clear();
    if (!enabled || focused || !isDiscordo(contents.getURL())) return;
    for (const action of actions) {
      const key = bindings[action];
      if (!key || [...registered.values()].includes(key)) continue;
      try {
        if (globalShortcut.register(key, () => {
          if (!contents.isDestroyed() && isDiscordo(contents.getURL())) {
            contents.send('discordo:voice-shortcut', action);
          }
        })) registered.set(action, key);
      } catch (error) {
        console.error('Não foi possível registrar o atalho.', error);
      }
    }
  }

  ipcMain.handle('discordo:voice-shortcuts', (event, request) => {
    if (event.sender !== contents || event.senderFrame !== contents.mainFrame ||
        !isDiscordo(event.senderFrame?.url) || typeof request?.active !== 'boolean') return;

    enabled = request.active;
    bindings = Object.fromEntries(actions.map(action => [action, accelerator(request[action])]));
    refresh();
  });

  window.on('focus', clear);
  window.on('blur', () => refresh(false));
  contents.on('did-start-navigation', event => {
    if (!event.isMainFrame || event.isSameDocument) return;
    enabled = false;
    clear();
  });
  contents.on('render-process-gone', () => {
    enabled = false;
    clear();
  });
  window.on('closed', () => {
    clear();
    ipcMain.removeHandler('discordo:voice-shortcuts');
  });
}

module.exports = { installVoiceShortcuts };
