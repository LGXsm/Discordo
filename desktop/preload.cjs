const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.origin === 'https://discordo.lgmartinez.com') {
  window.addEventListener('DOMContentLoaded', () => {
    const title = document.createElement('div');
    title.id = 'discordo-desktop-titlebar';
    const content = document.createElement('div');
    const image = document.createElement('img');
    const initials = document.createElement('span');
    const name = document.createElement('span');
    image.alt = '';
    image.className = initials.className = 'discordo-desktop-title-icon';
    name.className = 'discordo-desktop-title-name';
    image.addEventListener('error', () => {
      image.hidden = true;
      initials.hidden = !initials.textContent;
    });
    initials.setAttribute('aria-hidden', 'true');
    content.append(image, initials, name);
    title.append(content);
    document.body.prepend(title);

    const app = document.querySelector('#app');
    const observer = new MutationObserver(updateTitle);
    function updateTitle() {
      const workspace = app?.querySelector(':scope > [data-desktop-server-name]');
      const friends = workspace?.querySelector(':scope > .friends-page');
      const serverName = friends ? '' : workspace?.dataset.desktopServerName ?? '';
      const serverIcon = serverName ? workspace.dataset.desktopServerIcon : '';
      name.textContent = serverName || (friends ? 'Amigos' : 'Discordo');
      initials.textContent = serverName.slice(0, 2).toLocaleUpperCase('pt-BR');
      initials.hidden = !serverName || Boolean(serverIcon);
      image.hidden = !serverIcon;
      if (serverIcon) {
        if (image.getAttribute('src') !== serverIcon) image.src = serverIcon;
        else if (image.complete && !image.naturalWidth) {
          image.hidden = true;
          initials.hidden = false;
        }
      } else image.removeAttribute('src');
      observer.disconnect();
      if (app) observer.observe(app, { childList: true });
      if (workspace) observer.observe(workspace, { childList: true });
    }
    updateTitle();
  }, { once: true });

  contextBridge.exposeInMainWorld('discordoDesktop', {
    setVoiceShortcuts: bindings => ipcRenderer.invoke('discordo:voice-shortcuts', bindings),
    onVoiceShortcut(listener) {
      const handler = (_event, action) => listener(action);
      ipcRenderer.on('discordo:voice-shortcut', handler);
      return () => ipcRenderer.removeListener('discordo:voice-shortcut', handler);
    },
  });
}
