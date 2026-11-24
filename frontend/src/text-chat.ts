import { renderAvatar } from './avatar';
import { clipboardImage } from './clipboard-image';
import { emojiButtonMarkup, mountChatEmoji, mountEmojiPicker } from './chat-emoji';
import { mentionToken, mountChatMentions } from './chat-mentions';
import { icon } from './icons';
import { dismissOnBackdrop } from './dialog-dismiss';
import type { ServerMember } from './servers';
import { renderGameplay, sendGameplay, type GameplayPoll } from './gameplay';

const endpoint = new URL(`${import.meta.env.BASE_URL}chat.php`, document.baseURI);
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
type Message = { id: number; text: string; time: string; author: string; userId: number; own?: boolean; media?: 'image' | 'video' | null; video: boolean;
  forwarded?: boolean; reply?: { id: number; author: string | null; text: string | null } | null };
type TextDestination = { id?: number; name: string; private?: boolean };
type MessageEdit = { id: number; text: string; editedAt: string };
type Reaction = { emoji: string; count: number; own: boolean };

function renderMessageText(body: HTMLElement, text: string, mentionName: (id: number) => string | undefined,
  openMember: ((id: number, name: string, anchor: HTMLElement) => void) | undefined, selfId?: number) {
  let offset = 0;
  function appendText(part: string) {
    let position = 0;
    for (const match of part.matchAll(mentionToken)) {
      body.append(part.slice(position, match.index));
      const id = Number(match[1]);
      const name = mentionName(id);
      const mention = document.createElement(openMember && name ? 'button' : 'span');
      mention.className = 'chat-mention';
      mention.dataset.mentionUser = String(id);
      mention.toggleAttribute('data-self-mention', id === selfId);
      mention.textContent = `@${name ?? 'usuário'}`;
      if (mention instanceof HTMLButtonElement && name) {
        mention.type = 'button';
        mention.addEventListener('click', () => openMember?.(id, mentionName(id) ?? name, mention));
      }
      body.append(mention);
      position = match.index + match[0].length;
    }
    body.append(part.slice(position));
  }
  const links = /\[([^\]\r\n]+)\]\((https?:\/\/(?:[^\s<>"'()]|\([^\s<>"'()]*\))+)\)|(?<![\w@./:])(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  for (const match of text.matchAll(links)) {
    const [candidate, markdownLabel, destination] = match;
    let label = markdownLabel ?? candidate.replace(/[.,!?;:]+$/, '');
    if (markdownLabel === undefined) {
      while (label.endsWith(')') && label.split(')').length > label.split('(').length) label = label.slice(0, -1);
    }
    const address = destination ?? label;
    let url: URL;
    try {
      url = new URL(/^www\./i.test(address) ? `https://${address}` : address);
    } catch {
      continue;
    }
    appendText(text.slice(offset, match.index));
    const link = document.createElement('a');
    link.href = url.href;
    link.textContent = label;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    body.append(link);
    offset = match.index + (destination === undefined ? label.length : candidate.length);
  }
  appendText(text.slice(offset));
}

export const textComposerMarkup = `
  <form class="composer">
    <div class="chat-attachment chat-reply-draft" data-chat-reply hidden><span></span>
      <button class="icon-button" type="button" aria-label="Cancelar resposta">${icon('close')}</button>
    </div>
    <div class="chat-attachment" data-chat-attachment hidden>
      <div class="chat-attachment-card">
        <img class="chat-attachment-preview" alt="Prévia da imagem anexada" hidden>
        <span></span>
        <button class="icon-button" type="button" aria-label="Remover anexo">${icon('close')}</button>
      </div>
    </div>
    <input type="file" name="media" accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" hidden>
    <button type="button" class="icon-button" data-attach-media aria-label="Anexar imagem, GIF ou vídeo" title="Anexar imagem, GIF ou vídeo">${icon('clip')}</button>
    <input type="text" name="message" maxlength="1000" autocomplete="off">
    ${emojiButtonMarkup}
    <button type="submit" class="icon-button" aria-label="Enviar mensagem">${icon('send')}</button>
  </form>`;

async function chatRequest<T>(url: URL, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw Object.assign(new Error(result?.error ?? 'Não foi possível acessar as mensagens agora.'), { status: response.status });
  return result as T;
}

export function mountTextChat(workspace: HTMLElement, memberFor: (userId: number) => ServerMember | undefined,
  openAuthor?: (userId: number, name: string, anchor: HTMLElement) => void, canModerate = () => false,
  destinations: readonly TextDestination[] = [], members = () => [] as readonly ServerMember[]) {
  const lifetime = new AbortController();
  const scroll = workspace.querySelector<HTMLElement>('.chat-scroll')!;
  const messages = workspace.querySelector<HTMLElement>('.messages')!;
  const form = workspace.querySelector<HTMLFormElement>('.composer')!;
  const input = form.querySelector<HTMLInputElement>('[name=message]')!;
  const emoji = mountChatEmoji(form, input);
  const reactionPicker = mountEmojiPicker(workspace);
  reactionPicker.panel.setAttribute('aria-label', 'Reagir à mensagem');
  const mentions = mountChatMentions(form, input, members);
  const mentionName = (id: number) => memberFor(id)?.name;
  const readableText = (text: string) => text.replace(mentionToken, (_, id: string) => `@${mentionName(Number(id)) ?? 'usuário'}`);
  const file = form.querySelector<HTMLInputElement>('[name=media]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const pick = form.querySelector<HTMLButtonElement>('[data-attach-media]')!;
  const attachment = form.querySelector<HTMLElement>('[data-chat-attachment]')!;
  const preview = attachment.querySelector('img')!;
  const filename = attachment.querySelector('span')!;
  const remove = attachment.querySelector<HTMLButtonElement>('button')!;
  const status = workspace.querySelector<HTMLElement>('.chat-note')!;
  const replyDraft = form.querySelector<HTMLElement>('[data-chat-reply]')!;
  const replyCancel = replyDraft.querySelector('button')!;
  let replyTo: number | undefined;
  let mediaDraft: File | undefined;
  const menu = document.createElement('div');
  menu.className = 'server-actions message-context-menu';
  menu.popover = 'auto';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Opções da mensagem');
  workspace.append(menu);
  let menuRow: HTMLElement | undefined;
  let room: { id: number; cursor: number; lifetime: AbortController; loading: boolean; refreshQueued: boolean;
    messageActions?: boolean; changesEnabled?: boolean } | undefined;
  const reactionWrites = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sending = new Set<number>();
  const deleting = new Set<HTMLElement>();
  let closeViewer: (() => void) | undefined;
  let viewerRow: Element | null = null;

  function setReply(row?: HTMLElement) {
    replyTo = row ? Number(row.dataset.message) : undefined;
    replyDraft.hidden = !row;
    replyDraft.querySelector('span')!.textContent = row
      ? `Respondendo a ${row.dataset.authorName} · ${readableText(row.dataset.messageCopy || 'Mensagem')}` : '';
  }
  replyCancel.addEventListener('click', () => { setReply(); input.focus(); });

  function hideMessageMenu() {
    if (menu.matches(':popover-open')) menu.hidePopover();
    menuRow?.removeAttribute('data-message-menu-open');
    menuRow = undefined;
  }
  menu.addEventListener('toggle', () => {
    if (!menu.matches(':popover-open')) hideMessageMenu();
  });
  scroll.addEventListener('scroll', hideMessageMenu, { signal: lifetime.signal });
  window.addEventListener('resize', hideMessageMenu, { signal: lifetime.signal });

  function openViewer(original: HTMLImageElement | HTMLVideoElement) {
    closeViewer?.();
    viewerRow = original.closest('[data-message]');
    const dialog = document.createElement('dialog');
    dialog.className = 'chat-media-viewer';
    const video = original instanceof HTMLVideoElement ? original : undefined;
    dialog.setAttribute('aria-label', video ? 'Vídeo do chat' : 'Imagem do chat');
    const media = original.cloneNode() as HTMLImageElement | HTMLVideoElement;
    if (media instanceof HTMLImageElement) media.loading = 'eager';
    if (media instanceof HTMLVideoElement && video) {
      const position = video.currentTime;
      const wasPlaying = !video.paused && !video.ended;
      video.pause();
      media.preload = 'metadata';
      media.volume = video.volume;
      media.muted = video.muted;
      if (position > 0) media.addEventListener('loadedmetadata', () => { media.currentTime = position; }, { once: true });
      if (wasPlaying) void media.play().catch(() => {});
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'icon-button chat-media-close';
    close.autofocus = true;
    close.setAttribute('aria-label', 'Fechar visualizador');
    close.innerHTML = icon('close');
    dialog.append(media, close);
    const dismiss = () => {
      if (closeViewer !== dismiss) return;
      closeViewer = undefined;
      viewerRow = null;
      if (media instanceof HTMLVideoElement) {
        media.pause();
        if (video?.isConnected && media.readyState > 0 && video.readyState > 0) video.currentTime = media.currentTime;
        media.removeAttribute('src');
        media.load();
      }
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    closeViewer = dismiss;
    close.addEventListener('click', dismiss);
    dialog.addEventListener('close', dismiss);
    dismissOnBackdrop(dialog, undefined, dismiss);
    workspace.append(dialog);
    dialog.showModal();
  }

  function drawAuthor(row: HTMLElement) {
    const member = memberFor(Number(row.dataset.author));
    const author = member?.name ?? row.dataset.authorName ?? '';
    row.querySelector('strong')!.textContent = author;
    renderAvatar(row.querySelector('.avatar')!, member ?? { name: author });
    row.querySelector('[data-author-avatar]')?.setAttribute('aria-label', `Perfil de ${author}`);
  }

  function updateText(row: HTMLElement, text: string) {
    const body = row.querySelector<HTMLElement>('[data-message-text]')!;
    body.replaceChildren();
    row.dataset.messageCopy = text;
    renderMessageText(body, text, mentionName, openAuthor, members().find(member => member.self)?.userId);
  }

  function applyEdit(edit: MessageEdit) {
    const row = messages.querySelector<HTMLElement>(`[data-message="${Number(edit.id)}"]`);
    if (!row || (row.dataset.editedAt === edit.editedAt && row.dataset.messageCopy === edit.text)) return;
    updateText(row, edit.text);
    row.dataset.editedAt = edit.editedAt;
    const label = document.createElement('small');
    label.className = 'message-edited';
    label.textContent = '(editada)';
    row.querySelector('[data-message-text]')!.append(' ', label);
    for (const reference of messages.querySelectorAll<HTMLElement>(`[data-reply-message="${Number(edit.id)}"]`)) {
      reference.textContent = `${row.dataset.authorName} · ${readableText(edit.text)}`;
    }
    if (replyTo === Number(edit.id)) setReply(row);
  }

  function renderReactions(row: HTMLElement, reactions: Reaction[]) {
    const container = row.querySelector<HTMLElement>('.message-reactions')!;
    const key = JSON.stringify(reactions);
    if (container.dataset.state === key) return;
    const focused = container.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.reactionEmoji : undefined;
    container.dataset.state = key;
    container.replaceChildren(...reactions.map(reaction => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.reactionEmoji = reaction.emoji;
      chip.setAttribute('aria-pressed', String(reaction.own));
      chip.setAttribute('aria-label', `${reaction.own ? 'Remover' : 'Adicionar'} reação ${reaction.emoji} · ${reaction.count}`);
      chip.textContent = `${reaction.emoji} ${reaction.count}`;
      return chip;
    }));
    if (focused) {
      [...container.querySelectorAll('button')].find(chip => chip.dataset.reactionEmoji === focused)?.focus({ preventScroll: true });
    }
  }

  function append(message: Message, channel: number) {
    const row = document.createElement('article');
    row.className = 'message';
    row.dataset.message = String(message.id);
    row.dataset.author = String(message.userId);
    row.dataset.authorName = message.author;
    row.dataset.messageCopy = message.text;
    row.toggleAttribute('data-own-message', Boolean(message.own));
    const avatar = '<span class="avatar personal" aria-hidden="true"></span>';
    row.innerHTML = openAuthor
      ? `<button class="profile-trigger message-author-avatar" type="button" data-author-avatar aria-haspopup="dialog">${avatar}</button>
        <div><button class="profile-trigger profile-name-trigger" type="button" data-author-name-button aria-haspopup="dialog"><strong></strong></button> <time></time><p></p></div>`
      : `${avatar}<div><strong></strong> <time></time><p></p></div>`;
    drawAuthor(row);
    const time = row.querySelector('time')!;
    time.dateTime = message.time;
    time.textContent = timeFormat.format(new Date(message.time));
    const messageText = row.querySelector('p')!;
    messageText.dataset.messageText = '';
    updateText(row, message.text);
    if (message.reply) {
      const reference = document.createElement('button');
      reference.type = 'button';
      reference.className = 'message-reply-reference';
      reference.dataset.replyMessage = String(message.reply.id);
      reference.textContent = message.reply.author
        ? `${message.reply.author} · ${readableText(message.reply.text || 'Mensagem')}` : 'Mensagem original indisponível';
      reference.disabled = !message.reply.author;
      row.querySelector('div')!.prepend(reference);
    }
    if (message.forwarded) {
      const label = document.createElement('small');
      label.className = 'message-forwarded-label';
      label.textContent = 'Encaminhada';
      messageText.before(label);
    }
    const kind = message.media ?? (message.video ? 'video' : null);
    if (kind) {
      const url = new URL(endpoint);
      url.searchParams.set('channel', String(channel));
      url.searchParams.set(kind === 'video' ? 'video' : 'media', String(message.id));
      const body = row.querySelector('div')!;
      if (kind === 'image') {
        const image = document.createElement('img');
        image.className = 'chat-image';
        image.alt = `Imagem enviada por ${message.author}`;
        image.loading = 'lazy';
        image.decoding = 'async';
        image.src = url.href;
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'chat-image-open';
        open.setAttribute('aria-label', 'Ampliar imagem');
        open.setAttribute('aria-haspopup', 'dialog');
        open.append(image);
        open.addEventListener('click', () => openViewer(image));
        body.append(open);
      } else {
        const video = document.createElement('video');
        video.src = url.href;
        video.controls = true;
        video.playsInline = true;
        video.preload = 'none';
        video.setAttribute('aria-label', `Vídeo enviado por ${message.author}`);
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'settings-button chat-video-open';
        open.setAttribute('aria-haspopup', 'dialog');
        open.innerHTML = `${icon('expand')} Ampliar vídeo`;
        open.addEventListener('click', () => openViewer(video));
        body.append(video, open);
      }
    }
    const reactions = document.createElement('div');
    reactions.className = 'message-reactions';
    row.querySelector('div')!.append(reactions);
    const tools = document.createElement('div');
    tools.className = 'message-tools';
    tools.setAttribute('role', 'group');
    tools.setAttribute('aria-label', 'Ações da mensagem');
    tools.innerHTML = `
      <button type="button" class="icon-button" data-message-change="reaction" title="Reagir" aria-label="Reagir" aria-haspopup="dialog">${icon('smile')}</button>
      ${message.own ? `<button type="button" class="icon-button" data-message-change="edit" title="Editar mensagem" aria-label="Editar mensagem" aria-haspopup="dialog">${icon('pencil')}</button>` : ''}
      <button type="button" class="icon-button" data-message-shortcut="reply" title="Responder" aria-label="Responder">${icon('reply')}</button>
      <button type="button" class="icon-button" data-message-shortcut="forward" title="Encaminhar" aria-label="Encaminhar">${icon('arrow')}</button>
      <button type="button" class="icon-button message-more" data-message-options aria-label="Opções da mensagem" aria-haspopup="true">${icon('more')}</button>`;
    row.append(tools);
    messages.append(row);
  }

  function showMessageMenu(row: HTMLElement, x: number, y: number) {
    hideMessageMenu();
    menuRow = row;
    row.setAttribute('data-message-menu-open', '');
    const hasText = !!row.dataset.messageCopy?.trim();
    menu.innerHTML = `
      ${room?.changesEnabled ? `<button type="button" data-message-action="reaction">${icon('smile')} Reagir</button>
      ${canEditMessage(row) ? `<button type="button" data-message-action="edit">${icon('pencil')} Editar mensagem</button>` : ''}` : ''}
      ${room?.messageActions ? `<button type="button" data-message-action="reply">${icon('reply')} Responder</button>
      <button type="button" data-message-action="forward">${icon('arrow')} Encaminhar</button>` : ''}
      <button type="button" data-message-action="copy"${hasText ? '' : ' disabled'}>${icon('copy')} Copiar texto</button>
      ${canDeleteMessage(row) ? `<button type="button" class="server-delete-action" data-message-action="delete">${icon('trash')} Excluir mensagem</button>` : ''}`;
    menu.showPopover();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('button')?.focus({ preventScroll: true });
  }

  messages.addEventListener('contextmenu', event => {
    if (event.defaultPrevented) return;
    const row = (event.target as Element).closest<HTMLElement>('[data-message]');
    if (!row) return;
    event.preventDefault();
    showMessageMenu(row, event.clientX, event.clientY);
  }, { signal: lifetime.signal });
  messages.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const change = event.target.closest<HTMLButtonElement>('[data-message-change], [data-reaction-emoji]');
    const target = change?.closest<HTMLElement>('[data-message]');
    if (change && target && room?.changesEnabled) {
      if (change.dataset.reactionEmoji) {
        void writeReaction(target, room, change.dataset.reactionEmoji, change.getAttribute('aria-pressed') !== 'true');
      } else void runMessageAction(change.dataset.messageChange!, target, room, change);
      return;
    }
    const shortcut = event.target.closest<HTMLElement>('[data-message-shortcut]');
    const shortcutRow = shortcut?.closest<HTMLElement>('[data-message]');
    if (shortcut && shortcutRow && room?.messageActions) {
      void runMessageAction(shortcut.dataset.messageShortcut!, shortcutRow, room);
      return;
    }
    const more = event.target.closest<HTMLElement>('[data-message-options]');
    const row = more?.closest<HTMLElement>('[data-message]');
    if (more && row) {
      const bounds = more.getBoundingClientRect();
      showMessageMenu(row, bounds.right - 170, bounds.bottom);
    }
    const reference = event.target.closest<HTMLElement>('[data-reply-message]');
    if (!reference) return;
    const original = messages.querySelector<HTMLElement>(`[data-message="${Number(reference.dataset.replyMessage)}"]`);
    if (original) {
      original.tabIndex = -1;
      original.focus({ preventScroll: true });
      original.scrollIntoView({ block: 'center' });
    } else status.textContent = 'A mensagem original não está no trecho carregado.';
  }, { signal: lifetime.signal });

  function chooseForwardChannel(active: NonNullable<typeof room>) {
    const dialog = document.createElement('dialog');
    dialog.className = 'settings-dialog settings-confirm';
    dialog.setAttribute('aria-labelledby', 'message-forward-title');
    dialog.innerHTML = `<form method="dialog">
      <h2 id="message-forward-title">Encaminhar mensagem</h2>
      <label class="message-forward-channel">Canal de destino <select autofocus></select></label>
      <div class="settings-footer">
        <button type="submit" class="settings-button" value="cancel">Cancelar</button>
        <button type="submit" class="primary-button" value="forward">Encaminhar</button>
      </div>
    </form>`;
    const select = dialog.querySelector('select')!;
    const source = destinations.find(channel => channel.id === active.id);
    for (const channel of destinations) {
      if (channel.id && (!source?.private || channel.id === source.id)) {
        select.add(new Option(`# ${channel.name}`, String(channel.id)));
      }
    }
    if (!select.options.length) return Promise.resolve(undefined);
    select.value = String(active.id);
    workspace.append(dialog);
    dismissOnBackdrop(dialog);
    return new Promise<number | undefined>(resolve => {
      const cancel = () => dialog.close('cancel');
      active.lifetime.signal.addEventListener('abort', cancel, { once: true });
      dialog.addEventListener('close', () => {
        active.lifetime.signal.removeEventListener('abort', cancel);
        dialog.remove();
        resolve(dialog.returnValue === 'forward' ? Number(select.value) : undefined);
      }, { once: true });
      dialog.showModal();
    });
  }

  menu.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest<HTMLButtonElement>('[data-message-action]')?.dataset.messageAction;
    const row = menuRow;
    const active = room;
    if (!action || !row?.isConnected || !active) return;
    hideMessageMenu();
    void runMessageAction(action, row, active, row.querySelector<HTMLButtonElement>('[data-message-options]')!);
  }, { signal: lifetime.signal });

  async function runMessageAction(action: string, row: HTMLElement, active: NonNullable<typeof room>, anchor = row) {
    try {
      if (action === 'edit' && canEditMessage(row)) openEdit(row, active);
      if (action === 'reaction' && active.changesEnabled) {
        reactionPicker.open(anchor, emoji => {
          if (!row.isConnected || room !== active) return;
          const chips = [...row.querySelectorAll<HTMLButtonElement>('[data-reaction-emoji]')];
          const existing = chips.find(chip => chip.dataset.reactionEmoji === emoji);
          void writeReaction(row, active, emoji, existing?.getAttribute('aria-pressed') !== 'true');
        });
      }
      if (action === 'reply') { setReply(row); input.focus(); }
      if (action === 'delete') await deleteMessage(row, active);
      if (action === 'copy') {
        await navigator.clipboard.writeText(readableText(row.dataset.messageCopy ?? ''));
        if (room === active) status.textContent = 'Texto copiado.';
      }
      if (action === 'forward') {
        const channel = await chooseForwardChannel(active);
        if (!channel || room !== active) return;
        const url = new URL(endpoint);
        url.searchParams.set('channel', String(channel));
        await chatRequest(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Discordo-Request': 'chat' },
          body: JSON.stringify({ action: 'forwardMessage', sourceChannel: active.id, id: Number(row.dataset.message) }),
          signal: lifetime.signal,
        });
        if (room === active) {
          status.textContent = 'Mensagem encaminhada.';
          if (channel === active.id) refreshSoon();
        }
      }
    } catch (error) {
      if (room === active) status.textContent = action === 'copy' ? 'Não foi possível copiar o texto.' : (error as Error).message;
    }
  }

  function canEditMessage(row: HTMLElement) {
    return row.hasAttribute('data-own-message') && !row.querySelector('.gameplay-card');
  }

  async function writeMessageChange(active: NonNullable<typeof room>, payload: Record<string, unknown>) {
    const url = new URL(endpoint);
    url.searchParams.set('channel', String(active.id));
    await chatRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Discordo-Request': 'chat' },
      signal: active.lifetime.signal, body: JSON.stringify(payload) });
    if (room === active) refreshSoon();
  }

  async function writeReaction(row: HTMLElement, active: NonNullable<typeof room>, emoji: string, enabled: boolean) {
    const key = `${row.dataset.message}:${emoji}`;
    if (reactionWrites.has(key)) return;
    reactionWrites.add(key);
    try {
      await writeMessageChange(active, { action: 'setReaction', id: Number(row.dataset.message), active: enabled, emoji });
    } catch (error) {
      if (room === active) status.textContent = (error as Error).message;
    } finally {
      reactionWrites.delete(key);
    }
  }

  function openEdit(row: HTMLElement, active: NonNullable<typeof room>) {
    const dialog = document.createElement('dialog');
    dialog.className = 'settings-dialog settings-confirm message-edit-dialog';
    dialog.setAttribute('aria-labelledby', 'message-edit-title');
    dialog.innerHTML = `<form>
      <h2 id="message-edit-title">Editar mensagem</h2>
      <textarea aria-label="Texto da mensagem" maxlength="1000" required autofocus></textarea>
      <p role="status" hidden></p>
      <div class="settings-footer">
        <button type="button" class="settings-button">Cancelar</button>
        <button type="submit" class="primary-button">Salvar</button>
      </div>
    </form>`;
    const editor = dialog.querySelector('textarea')!;
    const feedback = dialog.querySelector('p')!;
    const save = dialog.querySelector<HTMLButtonElement>('[type=submit]')!;
    const original = row.dataset.messageCopy ?? '';
    const display = readableText(original);
    editor.value = display;
    const close = () => dialog.close();
    dialog.querySelector('[type=button]')!.addEventListener('click', close);
    active.lifetime.signal.addEventListener('abort', close, { once: true });
    dialog.addEventListener('close', () => {
      active.lifetime.signal.removeEventListener('abort', close);
      dialog.remove();
    }, { once: true });
    dismissOnBackdrop(dialog);
    dialog.querySelector('form')!.addEventListener('submit', async event => {
      event.preventDefault();
      if (save.disabled) return;
      const draft = editor.value.trim();
      if (draft === display) { close(); return; }
      save.disabled = editor.readOnly = true;
      try {
        await writeMessageChange(active, { action: 'editMessage', id: Number(row.dataset.message), text: mentions.encode(draft) });
        if (dialog.open) close();
      } catch (error) {
        if (!dialog.open) return;
        feedback.textContent = (error as Error).message;
        feedback.hidden = false;
      } finally {
        save.disabled = editor.readOnly = false;
      }
    });
    workspace.append(dialog);
    dialog.showModal();
  }

  function canDeleteMessage(row: HTMLElement) {
    return row.hasAttribute('data-own-message') || canModerate();
  }

  function removeMessage(row: Element) {
    if (viewerRow === row) closeViewer?.();
    if (menuRow === row) hideMessageMenu();
    const id = Number((row as HTMLElement).dataset.message);
    if (replyTo === id) setReply();
    for (const reference of messages.querySelectorAll<HTMLButtonElement>(`[data-reply-message="${id}"]`)) {
      reference.textContent = 'Mensagem original indisponível';
      reference.disabled = true;
    }
    row.remove();
  }

  function confirmDeletion(signal: AbortSignal) {
    const dialog = document.createElement('dialog');
    dialog.className = 'settings-dialog settings-confirm';
    dialog.setAttribute('aria-labelledby', 'message-delete-title');
    dialog.innerHTML = `<form method="dialog">
      <h2 id="message-delete-title">Excluir mensagem?</h2>
      <p>Esta mensagem será apagada para todos.</p>
      <div class="settings-footer">
        <button type="submit" class="settings-button" value="cancel" autofocus>Cancelar</button>
        <button type="submit" class="settings-button danger-button" value="delete">Excluir mensagem</button>
      </div>
    </form>`;
    workspace.append(dialog);
    dismissOnBackdrop(dialog);
    return new Promise<boolean>(resolve => {
      const cancel = () => dialog.close('cancel');
      signal.addEventListener('abort', cancel, { once: true });
      dialog.addEventListener('close', () => {
        signal.removeEventListener('abort', cancel);
        dialog.remove();
        resolve(dialog.returnValue === 'delete');
      }, { once: true });
      dialog.showModal();
    });
  }

  async function deleteMessage(row: HTMLElement, active: NonNullable<typeof room>) {
    if (!canDeleteMessage(row) || deleting.has(row)) return;
    deleting.add(row);
    try {
      if (!await confirmDeletion(active.lifetime.signal) || room !== active || !row.isConnected || !canDeleteMessage(row)) return;
      const url = new URL(endpoint);
      url.searchParams.set('channel', String(active.id));
      await chatRequest(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Discordo-Request': 'chat' },
        body: JSON.stringify({ action: 'deleteMessage', id: Number(row.dataset.message) }),
        signal: lifetime.signal,
      });
      if (room === active) {
        removeMessage(row);
        status.textContent = '';
        refreshSoon();
      }
    } finally {
      deleting.delete(row);
    }
  }

  messages.addEventListener('click', event => {
    if (!openAuthor || !(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLElement>('[data-author-avatar], [data-author-name-button]');
    const message = anchor?.closest<HTMLElement>('[data-author]');
    if (anchor && message) openAuthor(Number(message.dataset.author), message.dataset.authorName ?? '', anchor);
  }, { signal: lifetime.signal });

  function clearPreview() {
    const url = preview.getAttribute('src');
    preview.hidden = true;
    preview.removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
  }

  function resetFile() {
    mediaDraft = undefined;
    file.value = '';
    attachment.hidden = true;
    filename.textContent = '';
    clearPreview();
  }

  function updateComposer() {
    const busy = !!room && sending.has(room.id);
    input.readOnly = busy;
    submit.disabled = pick.disabled = remove.disabled = busy;
    emoji.setBusy(busy);
    if (busy) mentions.close();
  }

  function refreshSoon() {
    if (room?.loading) room.refreshQueued = true;
    else void refresh();
  }

  messages.addEventListener('click', async event => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-gameplay-action]');
    const card = button?.closest<HTMLElement>('[data-gameplay]');
    const active = room;
    if (!button || !card || !active || card.dataset.busy) return;
    card.dataset.busy = 'true';
    button.disabled = true;
    const choice = button.dataset.gameplayAction;
    try {
      await sendGameplay(active.id, { id: Number(card.dataset.gameplay), action: choice === 'approve' ? 'approveGameplay' : 'respondGameplay',
        choice, member: button.dataset.gameplayMember ? Number(button.dataset.gameplayMember) : undefined });
      if (room === active) {
        status.textContent = '';
        refreshSoon();
      }
    } catch (error) {
      if (room === active) status.textContent = error instanceof Error ? error.message : 'Não foi possível registrar a resposta.';
    } finally {
      delete card.dataset.busy;
      button.disabled = false;
    }
  }, { signal: lifetime.signal });

  async function refresh() {
    clearTimeout(timer);
    const active = room;
    if (!active || active.loading || document.hidden) return;
    active.loading = true;
    let delay = 600;
    try {
      const url = new URL(endpoint);
      url.searchParams.set('channel', String(active.id));
      url.searchParams.set('after', String(active.cursor));
      const first = (messages.firstElementChild as HTMLElement | null)?.dataset.message;
      if (first) url.searchParams.set('pollsFrom', first);
      const result = await chatRequest<{ messages: Message[]; polls?: GameplayPoll[]; existing?: number[] | null; messageActions?: boolean;
        changesEnabled?: boolean; edits?: MessageEdit[]; reactions?: Record<number, Reaction[]> }>(url, { signal: AbortSignal.any([
        active.lifetime.signal, AbortSignal.timeout(5000),
      ]) });
      if (active !== room) return;
      active.messageActions = result.messageActions === true;
      active.changesEnabled = result.changesEnabled === true;
      messages.toggleAttribute('data-message-actions', active.messageActions);
      messages.toggleAttribute('data-message-changes', active.changesEnabled);
      form.hidden = false;
      const atBottom = !active.cursor || scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 48;
      if (result.existing) {
        const existing = new Set(result.existing);
        for (const row of messages.querySelectorAll<HTMLElement>('[data-message]')) {
          if (!existing.has(Number(row.dataset.message))) removeMessage(row);
        }
      }
      for (const message of result.messages) {
        append(message, active.id);
        active.cursor = message.id;
      }
      while (messages.children.length > 150) messages.firstElementChild?.remove();
      for (const poll of result.polls ?? []) {
        const row = messages.querySelector<HTMLElement>(`[data-message="${poll.message}"]`);
        if (!row) continue;
        let card = row.querySelector<HTMLElement>('.gameplay-card');
        if (!card) {
          card = document.createElement('section');
          card.className = 'gameplay-card';
          const text = row.querySelector<HTMLElement>('[data-message-text]')!;
          text.hidden = true;
          text.after(card);
        }
        renderGameplay(card, poll);
      }
      for (const edit of result.edits ?? []) applyEdit(edit);
      if (active.changesEnabled) {
        for (const row of messages.querySelectorAll<HTMLElement>('[data-message]')) {
          renderReactions(row, result.reactions?.[Number(row.dataset.message)] ?? []);
        }
      }
      if (atBottom && result.messages.length) scroll.scrollTop = scroll.scrollHeight;
    } catch (error) {
      delay = 2500;
      if (active === room && !active.lifetime.signal.aborted) {
        if ((error as { status?: number }).status === 403) {
          hideMessageMenu();
          setReply();
          closeViewer?.();
          messages.replaceChildren();
          active.cursor = 0;
          form.hidden = true;
        }
        status.textContent = (error as Error).message;
      }
    } finally {
      active.loading = false;
      if (active === room && !document.hidden) {
        timer = setTimeout(refresh, active.refreshQueued ? 0 : delay);
        active.refreshQueued = false;
      }
    }
  }

  pick.addEventListener('click', () => file.click());
  remove.addEventListener('click', resetFile);
  preview.addEventListener('error', clearPreview, { signal: lifetime.signal });
  function attach(media: File) {
    if (media.size < 1 || media.size > 20 * 1024 * 1024) {
      status.textContent = 'Escolha uma imagem, GIF ou vídeo de até 20 MB.';
      return;
    }
    mediaDraft = media;
    status.textContent = '';
    attachment.hidden = false;
    filename.textContent = media.name;
    clearPreview();
    if (media.type.startsWith('image/') || (!media.type && /\.(?:jpe?g|png|webp|gif)$/i.test(media.name))) {
      preview.src = URL.createObjectURL(media);
      preview.hidden = false;
    }
  }
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    file.value = '';
    if (selected) attach(selected);
  });
  document.addEventListener('paste', event => {
    if (event.defaultPrevented || !room || input.readOnly || !form.getClientRects().length
        || document.querySelector('dialog[open]')) return;
    const target = event.target;
    if (!(target instanceof Element) || (target !== document.body && !target.closest('.chat'))) return;
    const image = clipboardImage(event);
    if (!image) return;
    event.preventDefault();
    attach(image);
    input.focus();
  }, { signal: lifetime.signal });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const active = room;
    const text = input.value.trim();
    const media = mediaDraft;
    if (!active || sending.has(active.id) || (!text && !media)) return;
    const reply = replyTo;
    const tagged = mentions.encode(text);
    if (Array.from(tagged).length > input.maxLength) {
      status.textContent = 'Digite uma mensagem de até 1000 caracteres, incluindo as menções.';
      return;
    }
    sending.add(active.id);
    updateComposer();
    status.textContent = media ? 'Enviando anexo…' : 'Enviando…';
    try {
      const url = new URL(endpoint);
      url.searchParams.set('channel', String(active.id));
      const headers: Record<string, string> = { 'X-Discordo-Request': 'chat' };
      let body: FormData | string;
      if (media) {
        body = new FormData();
        body.set('message', JSON.stringify({ text: tagged, replyTo: reply }));
        body.set('media', media);
      } else {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify({ action: 'sendMessage', text: tagged, replyTo: reply });
      }
      await chatRequest(url, { method: 'POST', headers, body, signal: lifetime.signal });
      if (active === room) {
        input.value = '';
        resetFile();
        if (replyTo === reply) setReply();
      }
      if (active.id === room?.id) {
        status.textContent = '';
        refreshSoon();
      }
    } catch (error) {
      if (active.id === room?.id) status.textContent = (error as Error).message;
    } finally {
      sending.delete(active.id);
      if (active.id === room?.id) updateComposer();
    }
  });

  document.addEventListener('visibilitychange', refresh, { signal: lifetime.signal });
  return {
    refresh: refreshSoon,
    select(id: number | undefined, name: string) {
      hideMessageMenu();
      emoji.close();
      reactionPicker.close();
      mentions.close();
      setReply();
      closeViewer?.();
      room?.lifetime.abort();
      clearTimeout(timer);
      room = id ? { id, cursor: 0, lifetime: new AbortController(), loading: false, refreshQueued: false } : undefined;
      input.placeholder = `Conversar em #${name}`;
      input.setAttribute('aria-label', input.placeholder);
      input.value = '';
      messages.replaceChildren();
      messages.removeAttribute('data-message-actions');
      messages.removeAttribute('data-message-changes');
      resetFile();
      updateComposer();
      status.textContent = room && sending.has(room.id) ? 'Enviando…' : '';
      form.hidden = !room;
      void refresh();
    },
    refreshAuthors() {
      for (const row of messages.querySelectorAll<HTMLElement>('[data-author]')) drawAuthor(row);
      for (const mention of messages.querySelectorAll<HTMLElement>('[data-mention-user]')) {
        mention.textContent = `@${mentionName(Number(mention.dataset.mentionUser)) ?? 'usuário'}`;
      }
    },
    dispose() {
      resetFile();
      hideMessageMenu();
      menu.remove();
      closeViewer?.();
      lifetime.abort();
      room?.lifetime.abort();
      room = undefined;
      clearTimeout(timer);
    },
  };
}
