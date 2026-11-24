const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const version = new URLSearchParams(location.search).get('version');
  if (version) document.querySelector('h1').textContent = `A versão ${version} está pronta.`;
  const choose = restart => ipcRenderer.send('discordo:update-choice', restart);
  document.querySelector('#restart').addEventListener('click', () => choose(true));
  document.querySelector('#later').addEventListener('click', () => choose(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') choose(false);
  });
}, { once: true });
