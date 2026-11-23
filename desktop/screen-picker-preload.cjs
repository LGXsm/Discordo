const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', async () => {
  const list = document.querySelector('#sources');
  const status = document.querySelector('#status');
  const share = document.querySelector('#share');
  const sound = document.querySelector('#sound');
  let selected;
  const cancel = () => void ipcRenderer.invoke('discordo:screen-select', null);
  document.querySelector('#cancel').addEventListener('click', cancel);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancel();
  });
  try {
    const { choices, audioAvailable } = await ipcRenderer.invoke('discordo:screen-choices');
    choices.forEach((choice, index) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      const image = document.createElement('img');
      const name = document.createElement('span');
      input.type = 'radio';
      input.name = 'source';
      image.src = choice.thumbnail;
      image.alt = '';
      name.textContent = choice.name;
      label.append(input, image, name);
      list.append(label);
      input.addEventListener('change', () => {
        selected = index;
        sound.closest('label').hidden = !audioAvailable || !choice.screen;
        sound.checked = false;
        share.disabled = false;
      });
    });
  } catch {
    status.textContent = 'Não foi possível carregar as fontes.';
  }

  share.addEventListener('click', () => {
    share.disabled = true;
    void ipcRenderer.invoke('discordo:screen-select', selected, sound.checked).catch(() => {
      status.textContent = 'Não foi possível compartilhar a fonte selecionada.';
      share.disabled = false;
    });
  });
});
