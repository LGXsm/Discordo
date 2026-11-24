import { icon } from './icons';

const emojis = [
  ['😀', 'Sorriso'], ['😂', 'Chorando de rir'], ['🤣', 'Rolando de rir'], ['😊', 'Sorriso tímido'],
  ['😍', 'Apaixonado'], ['😎', 'Óculos escuros'], ['🤔', 'Pensando'], ['😭', 'Chorando'],
  ['😮', 'Surpreso'], ['🙃', 'De cabeça para baixo'], ['😅', 'Rindo de nervoso'], ['😴', 'Dormindo'],
  ['❤️', 'Coração'], ['💜', 'Coração roxo'], ['👍', 'Joinha'], ['👎', 'Não gostei'],
  ['👏', 'Palmas'], ['🙌', 'Mãos para cima'], ['🙏', 'Agradecimento'], ['🤝', 'Aperto de mãos'],
  ['🔥', 'Fogo'], ['🎉', 'Festa'], ['✨', 'Brilho'], ['💯', 'Cem pontos'],
  ['🎮', 'Videogame'], ['🎧', 'Fones de ouvido'], ['🏆', 'Troféu'], ['⚡', 'Raio'],
  ['👀', 'Olhos'], ['💀', 'Caveira'], ['✅', 'Confirmado'], ['🚀', 'Foguete'],
] as const;

export const emojiButtonMarkup = `<button type="button" class="icon-button chat-emoji-button" data-emoji-button
  aria-label="Inserir emoji" title="Inserir emoji" aria-haspopup="dialog" aria-expanded="false">${icon('smile')}</button>`;

export function mountEmojiPicker(host: HTMLElement) {
  const panel = document.createElement('div');
  panel.className = 'chat-emoji-picker';
  panel.popover = 'auto';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Emojis');
  panel.innerHTML = '<input type="search" aria-label="Buscar emoji" placeholder="Buscar emoji"><div class="chat-emoji-grid"></div><p hidden>Nenhum emoji encontrado.</p>';
  const search = panel.querySelector('input')!;
  const grid = panel.querySelector('div')!;
  const empty = panel.querySelector('p')!;
  host.append(panel);
  let choose: ((emoji: string) => void) | undefined;

  const normalize = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '');
  for (const [emoji, name] of emojis) {
    const option = document.createElement('button');
    option.type = 'button';
    option.dataset.emoji = emoji;
    option.dataset.search = normalize(name);
    option.setAttribute('aria-label', name);
    option.title = name;
    option.textContent = emoji;
    grid.append(option);
  }
  function filter() {
    const term = normalize(search.value.trim());
    let found = false;
    for (const option of grid.querySelectorAll('button')) {
      option.hidden = !(option.dataset.search!.includes(term) || option.dataset.emoji === term);
      found ||= !option.hidden;
    }
    empty.hidden = found;
  }
  function close() {
    if (panel.matches(':popover-open')) panel.hidePopover();
  }
  function open(anchor: HTMLElement, onChoose: (emoji: string) => void) {
    if (panel.matches(':popover-open')) close();
    choose = onChoose;
    search.value = '';
    filter();
    panel.showPopover();
    const bounds = anchor.getBoundingClientRect();
    const above = bounds.top - panel.offsetHeight - 7;
    panel.style.left = `${Math.max(8, Math.min(bounds.right - panel.offsetWidth, innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${above >= 8 ? above : Math.max(8, Math.min(bounds.bottom + 7, innerHeight - panel.offsetHeight - 8))}px`;
    search.focus();
  }
  search.addEventListener('input', filter);
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      grid.querySelector<HTMLButtonElement>('button:not([hidden])')?.click();
    }
  });
  grid.addEventListener('click', event => {
    const option = (event.target as Element).closest<HTMLButtonElement>('[data-emoji]');
    if (option) {
      close();
      choose?.(option.dataset.emoji!);
    }
  });
  return { open, close, panel };
}

export function mountChatEmoji(form: HTMLFormElement, input: HTMLInputElement) {
  const button = form.querySelector<HTMLButtonElement>('[data-emoji-button]')!;
  const { open, close, panel } = mountEmojiPicker(form);
  panel.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(panel.matches(':popover-open'))));
  button.addEventListener('click', () => {
    if (panel.matches(':popover-open')) { close(); return; }
    open(form, emoji => {
      if (input.readOnly) return;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      if (input.value.length - (end - start) + emoji.length > input.maxLength) return;
      input.setRangeText(emoji, start, end, 'end');
      input.focus();
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  return { close, setBusy(busy: boolean) { button.disabled = busy; if (busy) close(); } };
}
