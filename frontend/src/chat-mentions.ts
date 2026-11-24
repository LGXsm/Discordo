import { renderAvatar } from './avatar';
import type { ServerMember } from './servers';

type MentionMember = ServerMember & { userId: number };
export const mentionToken = /@\{([1-9]\d*)\}/g;

export function mountChatMentions(form: HTMLFormElement, input: HTMLInputElement, members: () => readonly ServerMember[]) {
  const panel = document.createElement('div');
  panel.className = 'chat-mentions';
  panel.popover = 'manual';
  panel.id = 'chat-mention-options';
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'Mencionar membro');
  form.append(panel);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', panel.id);
  input.setAttribute('aria-expanded', 'false');
  let choices: HTMLDivElement[] = [];
  let selected = 0;

  const normalize = (value: string) => value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{M}/gu, '');
  const available = () => members().filter((member): member is MentionMember => Boolean(member.userId));
  const label = (member: MentionMember, roster: MentionMember[]) =>
    roster.some(other => other.userId !== member.userId && normalize(other.name) === normalize(member.name))
      ? `@${member.name}#${member.userId}` : `@${member.name}`;

  function close() {
    if (panel.matches(':popover-open')) panel.hidePopover();
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    choices = [];
  }

  function select(index: number) {
    selected = index;
    choices.forEach((option, position) => option.setAttribute('aria-selected', String(position === index)));
    input.setAttribute('aria-activedescendant', choices[index].id);
  }

  function update() {
    const end = input.selectionEnd ?? 0;
    const match = /(?:^|[\s(])(@([^@\r\n]*))$/.exec(input.value.slice(0, end));
    if (!match || input.readOnly || input.selectionStart !== end) { close(); return; }
    const start = end - match[1].length;
    const term = normalize(match[2]);
    const roster = available();
    choices = roster.filter(member => normalize(label(member, roster).slice(1)).includes(term)).slice(0, 6).map((member, index) => {
      const option = document.createElement('div');
      option.id = `chat-mention-${index}`;
      option.setAttribute('role', 'option');
      const avatar = document.createElement('span');
      avatar.className = 'avatar personal';
      renderAvatar(avatar, member);
      const text = document.createElement('span');
      const display = label(member, roster);
      text.textContent = display;
      option.append(avatar, text);
      option.addEventListener('pointerdown', event => event.preventDefault());
      option.addEventListener('click', () => {
        const insertion = display + ' ';
        if (input.value.length - (end - start) + insertion.length <= input.maxLength) {
          input.setRangeText(insertion, start, end, 'end');
        }
        close();
        input.focus();
      });
      return option;
    });
    if (!choices.length) { close(); return; }
    panel.replaceChildren(...choices);
    if (!panel.matches(':popover-open')) panel.showPopover();
    const anchor = form.getBoundingClientRect();
    panel.style.left = `${Math.min(anchor.left, innerWidth - panel.offsetWidth - 8)}px`;
    panel.style.top = `${Math.max(8, anchor.top - panel.offsetHeight - 7)}px`;
    input.setAttribute('aria-expanded', 'true');
    select(0);
  }

  input.addEventListener('input', update);
  input.addEventListener('click', update);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', event => {
    if (!choices.length || event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      select((selected + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      choices[selected].click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });

  function encode(text: string) {
    const roster = available();
    const ids = new Map(roster.map(member => [label(member, roster), member.userId]));
    if (!ids.size || !text.includes('@')) return text;
    const names = [...ids.keys()].sort((left, right) => right.length - left.length)
      .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const mentions = new RegExp(`(^|[\\s(])(${names})(?=$|[\\s.,!?;:)…])`, 'g');
    return text.replace(mentions, (_, boundary: string, name: string) => `${boundary}@{${ids.get(name)}}`);
  }
  return { close, encode };
}
