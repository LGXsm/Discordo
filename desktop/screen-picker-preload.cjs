const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', async () => {
  const tabs = [...document.querySelectorAll('[role=tab]')];
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')));
  const share = document.querySelector('#share');
  const sound = document.querySelector('#sound');
  const audioOption = document.querySelector('#audio-option');
  let active = 0;
  let audioAvailable = false;
  let selected;
  let submitting = false;

  function activate(index) {
    if (index === active || submitting) return;
    const checked = panels[active].querySelector('input:checked');
    if (checked) checked.checked = false;
    active = index;
    tabs.forEach((tab, position) => {
      const current = position === active;
      tab.tabIndex = current ? 0 : -1;
      tab.setAttribute('aria-selected', String(current));
      panels[position].hidden = !current;
    });
    selected = undefined;
    share.disabled = true;
    sound.checked = false;
    audioOption.hidden = !audioAvailable || active !== 1;
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(index));
    tab.addEventListener('keydown', event => {
      const target = { ArrowLeft: 1 - index, ArrowRight: 1 - index, Home: 0, End: 1 }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      activate(target);
      tabs[active].focus();
    });
  });

  const cancel = () => void ipcRenderer.invoke('discordo:screen-select', null);
  document.querySelector('#cancel').addEventListener('click', cancel);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancel();
  });

  function makeSource(choice, index) {
    const label = document.createElement('label');
    label.className = 'source';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'source';
    input.value = String(index);
    const preview = document.createElement('span');
    preview.className = 'source-preview';
    if (choice.thumbnail) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = choice.thumbnail;
      preview.append(image);
    } else {
      preview.textContent = 'Prévia indisponível';
      preview.setAttribute('aria-hidden', 'true');
    }
    const caption = document.createElement('span');
    caption.className = 'source-caption';
    if (choice.appIcon) {
      const image = document.createElement('img');
      image.alt = '';
      image.src = choice.appIcon;
      caption.append(image);
    }
    const name = document.createElement('span');
    name.textContent = choice.name;
    caption.append(name);
    label.title = choice.name;
    label.append(input, preview, caption);
    input.addEventListener('change', () => {
      selected = index;
      share.disabled = submitting;
    });
    return label;
  }

  try {
    const result = await ipcRenderer.invoke('discordo:screen-choices');
    audioAvailable = result.audioAvailable;
    const counts = [0, 0];
    const lists = panels.map(panel => panel.querySelector('.source-grid'));
    result.choices.forEach((choice, index) => {
      const group = choice.screen ? 1 : 0;
      counts[group]++;
      lists[group].append(makeSource(choice, index));
    });
    panels.forEach((panel, index) => {
      const status = panel.querySelector('[role=status]');
      status.hidden = counts[index] > 0;
      status.textContent = index === 0 ? 'Nenhuma janela disponível.' : 'Nenhuma tela disponível.';
    });
    audioOption.hidden = !audioAvailable || active !== 1;
  } catch {
    for (const panel of panels) panel.querySelector('[role=status]').textContent = 'Não foi possível carregar as fontes.';
  }

  share.addEventListener('click', async () => {
    if (selected === undefined || submitting) return;
    submitting = true;
    share.disabled = true;
    try {
      await ipcRenderer.invoke('discordo:screen-select', selected, active === 1 && sound.checked);
    } catch {
      const status = panels[active].querySelector('[role=status]');
      status.textContent = 'Não foi possível compartilhar a fonte selecionada.';
      status.hidden = false;
    } finally {
      submitting = false;
      share.disabled = selected === undefined;
    }
  });
});
