const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.origin === 'https://discordo.lgmartinez.com') {
  contextBridge.exposeInMainWorld('discordoDesktop', {
    setVoiceShortcuts: bindings => ipcRenderer.invoke('discordo:voice-shortcuts', bindings),
    onVoiceShortcut(listener) {
      const handler = (_event, action) => listener(action);
      ipcRenderer.on('discordo:voice-shortcut', handler);
      return () => ipcRenderer.removeListener('discordo:voice-shortcut', handler);
    },
  });
}
