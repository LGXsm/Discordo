import { renderAvatar } from './avatar';
import { icon } from './icons';
import { emojiButtonMarkup, mountChatEmoji } from './chat-emoji';
import { inviteLink, safeText } from './servers';

export type FriendshipStatus = 'friend' | 'received' | 'sent' | null;
type Person = { id: number; name: string; status: FriendshipStatus; avatarUrl?: string; bannerUrl?: string;
  room?: string; waiting?: boolean };
type PrivateVoice = {
  joinPrivate(room: string, friend: string): void;
  leavePrivate(): void;
  togglePrivateMic(): void;
  privateState(room?: string): { state: string; peers: number; muted: boolean; deafened: boolean; notice: string } | undefined;
  togglePrivateAudio(): void;
};
type Message = { id: number; text: string; own: boolean; time: string };
type Action = 'request' | 'accept' | 'decline' | 'cancel' | 'remove' | 'send';
type FriendRequestData = { action: Action; user: number; text?: string } | { action: 'invite'; user: number; server: number };
const endpoint = new URL(`${import.meta.env.BASE_URL}friends.php`, document.baseURI);
const time = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export async function friendsRequest<T>(signal: AbortSignal, params: Record<string, string> = {},
  data?: FriendRequestData): Promise<T> {
  const url = new URL(endpoint);
  url.search = new URLSearchParams(params).toString();
  const response = await fetch(url, {
    signal,
    ...(data && { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Discordo-Request': 'friends' }, body: JSON.stringify(data) }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Amizades indisponíveis.');
  return payload;
}

export function openFriends(workspace: HTMLElement, voice: PrivateVoice, close: () => void) {
  const dialog = document.createElement('section');
  dialog.className = 'friends-page';
  dialog.setAttribute('aria-labelledby', 'friends-title');
  dialog.innerHTML = `
    <div class="friends-wall-frame" aria-hidden="true">
      <div class="friends-mural chat-wall"></div>
    </div>
    <aside class="friends-sidebar" aria-label="Amizades">
      <img class="friends-brand" src="${import.meta.env.BASE_URL}art/logo-principal.webp" alt="Discordo">
      <h2>Amigos</h2>
      <nav aria-label="Navegação de amizades">
        <button class="settings-button" type="button" data-friends-tab="all" aria-current="page">${icon('users')} Todos</button>
        <button class="settings-button" type="button" data-friends-tab="requests">${icon('userPlus')} Pedidos</button>
        <button class="settings-button" type="button" data-friends-tab="conversations">${icon('chat')} Conversas</button>
      </nav>
      <div class="friends-sidebar-actions">
        <button class="icon-button friends-return" type="button" data-friends-return aria-label="Voltar aos servidores">${icon('menu')}</button>
        <button class="settings-button friends-add-trigger" type="button" data-add-friend aria-expanded="false"
          aria-controls="friends-add">${icon('userPlus')} Adicionar amigo</button>
      </div>
    </aside>
    <div class="friends-content">
      <header class="friends-page-heading">
        <h1 id="friends-title" tabindex="-1">Amigos</h1>
      </header>
      <div class="friends-add" id="friends-add" hidden>
        <form class="friends-search">
          <label for="friend-search">Encontrar pessoas</label>
          <div><input type="search" id="friend-search" name="search" placeholder="Digite um apelido" minlength="2" maxlength="40" required>
          <button class="settings-button">Buscar</button></div>
        </form>
        <section class="friends-results" aria-label="Resultados da busca" hidden></section>
      </div>
      <div class="friends-layout">
        <section class="friends-list" data-friend-list></section>
        <section class="friends-panel friends-requests" data-requests aria-labelledby="friend-requests-title" hidden></section>
      </div>
      <section class="friends-conversation" aria-label="Conversa privada" hidden></section>
      <p class="friends-status" role="status"></p>
    </div>`;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const results = dialog.querySelector<HTMLElement>('.friends-results')!;
  const search = dialog.querySelector<HTMLFormElement>('.friends-search')!;
  const conversation = dialog.querySelector<HTMLElement>('.friends-conversation')!;
  const status = dialog.querySelector<HTMLElement>('.friends-status')!;
  const roster = dialog.querySelector<HTMLElement>('[data-friend-list]')!;
  const requests = dialog.querySelector<HTMLElement>('[data-requests]')!;
  const title = dialog.querySelector<HTMLElement>('h1')!;
  const add = dialog.querySelector<HTMLButtonElement>('[data-add-friend]')!;
  const addPanel = dialog.querySelector<HTMLElement>('.friends-add')!;
  const tabs = dialog.querySelectorAll<HTMLButtonElement>('[data-friends-tab]');
  let tab = 'all';
  let people: Person[] = [];
  let selected: Person | undefined;
  let searchTerm = '';
  let listRevision = 0;
  let searchRevision = 0;
  let latest = 0;
  let earliest = 0;
  let loadingHistory = false;
  let pending = false;
  let opening = 0;

  function request<T>(params?: Record<string, string>, data?: FriendRequestData) {
    return friendsRequest<T>(signal, params, data);
  }

  function report(error: unknown) {
    if (!signal.aborted) status.textContent = error instanceof Error ? error.message : 'Não foi possível concluir a ação.';
  }

  function renderRows(group: HTMLElement, entries: Person[], inRequests = false) {
    for (const person of entries) {
      const row = document.createElement('div');
      row.className = inRequests ? 'friends-row friends-request-row' : 'friends-row';
      const avatar = document.createElement('span');
      avatar.className = 'avatar personal';
      avatar.setAttribute('aria-hidden', 'true');
      renderAvatar(avatar, person);
      const name = document.createElement('strong');
      name.textContent = person.name;
      if (person.status === 'friend') {
        const profile = document.createElement('button');
        profile.type = 'button';
        profile.className = 'friends-profile';
        profile.dataset.friendId = String(person.id);
        profile.setAttribute('aria-current', String(selected?.id === person.id));
        profile.setAttribute('aria-label', `Conversar · ${person.name}`);
        const state = document.createElement('span');
        state.className = 'friends-profile-state';
        state.textContent = person.waiting ? 'Chamando você' : '';
        const glyph = document.createElement('span');
        glyph.className = 'friends-chat-icon';
        glyph.innerHTML = icon('chat');
        profile.append(avatar, name, state, glyph);
        profile.addEventListener('click', () => openConversation(person));
        row.append(profile);
        group.append(row);
        continue;
      }
      const actions = document.createElement('div');
      actions.className = 'friends-actions';
      const button = (label: string, action: Action) => {
        const control = document.createElement('button');
        control.type = 'button';
        control.className = 'settings-button';
        control.textContent = label;
        control.setAttribute('aria-label', `${label} · ${person.name}`);
        if (action === 'accept') control.className = 'primary-button';
        if (inRequests) {
          control.classList.add('friends-request-action');
          control.innerHTML = icon(action === 'accept' ? 'check' : 'close');
          control.title = label;
        }
        control.addEventListener('click', () => void update(person, action));
        actions.append(control);
      };
      switch (person.status) {
        case 'received': button('Aceitar', 'accept'); button('Recusar', 'decline'); break;
        case 'sent': button('Cancelar pedido', 'cancel'); break;
        default: button('Adicionar', 'request');
      }
      if (inRequests) {
        const copy = document.createElement('div');
        copy.className = 'friends-request-copy';
        const description = document.createElement('small');
        description.textContent = person.status === 'received' ? 'Quer ser seu amigo' : 'Aguardando resposta';
        copy.append(name, description);
        row.append(avatar, copy, actions);
      } else row.append(avatar, name, actions);
      group.append(row);
    }
  }

  function selectTab(next: string) {
    tab = next;
    for (const button of tabs) {
      if (button.dataset.friendsTab === tab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    renderOverview();
  }

  function renderOverview() {
    const friends = people.filter(person => person.status === 'friend');
    dialog.dataset.friendsTab = tab;
    requests.hidden = tab !== 'requests';
    roster.hidden = tab === 'requests';
    roster.classList.toggle('friends-panel', tab === 'conversations');
    roster.innerHTML = `<h2>${icon('users')} ${tab === 'conversations' ? 'Conversas' : 'Todos os amigos'}</h2>`;
    if (tab === 'conversations') renderRows(roster, friends);
    else if (friends.length) renderCards(friends);
    if (!friends.length) roster.insertAdjacentHTML('beforeend', '<p>Sua lista de amigos está vazia.</p>');
    requests.innerHTML = `<h2 id="friend-requests-title" tabindex="-1">${icon('userPlus')} Pedidos</h2>`;
    for (const state of ['received', 'sent'] as const) {
      const entries = people.filter(person => person.status === state);
      if (!entries.length) continue;
      const group = document.createElement('section');
      group.className = 'friends-request-list';
      if (state === 'sent') group.innerHTML = '<h3>Enviados</h3>';
      renderRows(group, entries, true);
      requests.append(group);
    }
    if (requests.children.length === 1) requests.insertAdjacentHTML('beforeend', '<p>Nenhum pedido pendente.</p>');
  }

  function renderCards(friends: Person[]) {
    const cards = document.createElement('div');
    cards.className = 'friends-cards';
    for (const person of friends) {
      const card = document.createElement('article');
      card.className = 'friends-card';
      card.innerHTML = `<button class="friends-card-person" type="button" data-friend-id="${person.id}" aria-label="Conversar · ${safeText(person.name)}">
        <span class="friends-card-banner"></span><span class="avatar personal" aria-hidden="true"></span>
        <strong>${safeText(person.name)}</strong>${person.waiting ? '<small>Chamando você</small>' : ''}
      </button><div class="friends-card-actions"><button class="settings-button" type="button" aria-label="Conversar com ${safeText(person.name)}">${icon('chat')}</button>
        <button class="primary-button" type="button">${icon('gamepad')} Bora jogar?</button></div>`;
      if (person.bannerUrl) {
        const banner = document.createElement('img');
        banner.src = person.bannerUrl;
        banner.alt = '';
        card.querySelector('.friends-card-banner')!.append(banner);
      }
      renderAvatar(card.querySelector<HTMLElement>('.avatar')!, person);
      const [profile, chat, play] = card.querySelectorAll('button');
      for (const button of [profile, chat]) button.addEventListener('click', () => openConversation(person));
      play.addEventListener('click', () => {
        openConversation(person);
        const field = conversation.querySelector<HTMLInputElement>('[name=message]')!;
        if (!field.value.trim()) field.value = 'Bora jogar?';
        field.focus();
      });
      cards.append(card);
    }
    roster.append(cards);
  }

  async function refreshPeople() {
    const revision = ++listRevision;
    const result = await request<{ people: Person[] }>();
    if (revision !== listRevision || signal.aborted) return;
    if (selected && !result.people.some(person => person.id === selected?.id && person.status === 'friend')) closeConversation();
    if (roster.hasChildNodes() && JSON.stringify(result.people) === JSON.stringify(people)) return;
    people = result.people;
    renderOverview();
    renderCall();
  }

  async function findPeople() {
    const revision = ++searchRevision;
    const result = await request<{ people: Person[] }>({ search: searchTerm });
    if (revision !== searchRevision || signal.aborted) return;
    results.hidden = false;
    results.innerHTML = '<h3>Resultados da busca</h3>';
    renderRows(results, result.people);
    if (!result.people.length) results.insertAdjacentHTML('beforeend', '<p>Nenhuma pessoa encontrada.</p>');
  }

  function closeConversation() {
    opening++;
    voice.leavePrivate();
    selected = undefined;
    conversation.hidden = true;
    conversation.replaceChildren();
    dialog.removeAttribute('data-conversation');
    dialog.querySelectorAll('[data-friend-id]').forEach(button => button.setAttribute('aria-current', 'false'));
  }

  function openConversation(person: Person) {
    opening++;
    if (selected?.id === person.id) return;
    if (selected) voice.leavePrivate();
    selected = person;
    latest = earliest = 0;
    loadingHistory = false;
    dialog.setAttribute('data-conversation', '');
    conversation.hidden = false;
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-friend-id]')) {
      button.setAttribute('aria-current', String(button.dataset.friendId === String(person.id)));
    }
    conversation.innerHTML = `
      <header class="friends-chat-heading">
        <button class="settings-button friends-back" type="button">Voltar</button>
        <strong>${safeText(person.name)}</strong>
        <button class="settings-button" type="button" data-start-call>${icon('phone')} <span>Ligar</span></button>
        <button class="icon-button" type="button" data-call-mic aria-label="Silenciar microfone" hidden>${icon('mic')}</button>
        <button class="icon-button" type="button" data-call-audio aria-label="Desativar áudio" hidden>${icon('headphones')}</button>
        <button class="icon-button" data-remove type="button" aria-label="Remover amizade" title="Remover amizade">${icon('trash')}</button>
      </header>
      <p class="friends-call-status" role="status" hidden></p>
      <div class="friends-history" tabindex="0" aria-label="Histórico de mensagens">
        <button class="settings-button" type="button" data-older hidden>Ver mensagens anteriores</button>
        <p data-empty-message>Envie a primeira mensagem.</p>
        <div class="friends-messages" role="log" aria-label="Mensagens privadas"></div>
      </div>
      <form class="composer friends-composer">
        <input type="text" name="message" aria-label="Mensagem privada" placeholder="Escreva uma mensagem" maxlength="2000" required autocomplete="off">
        ${emojiButtonMarkup}
        <button class="icon-button" type="submit" aria-label="Enviar mensagem">${icon('send')}</button>
      </form>`;
    conversation.querySelector('.friends-back')!.addEventListener('click', () => {
      closeConversation();
      title.focus();
    });
    conversation.querySelector('[data-start-call]')!.addEventListener('click', () => {
      const room = people.find(friend => friend.id === person.id)?.room ?? person.room;
      if (!room) return;
      const call = voice.privateState(room);
      if (call && call.state !== 'ended') voice.leavePrivate();
      else startCall(person, room);
      renderCall();
    });
    conversation.querySelector('[data-call-mic]')!.addEventListener('click', () => voice.togglePrivateMic());
    conversation.querySelector('[data-call-audio]')!.addEventListener('click', () => voice.togglePrivateAudio());
    conversation.querySelector('[data-older]')!.addEventListener('click', () => void refreshMessages(person, true).catch(report));
    conversation.querySelector('[data-remove]')!.addEventListener('click', () => {
      if (window.confirm(`Remover a amizade com ${person.name} e apagar esta conversa?`)) void update(person, 'remove');
    });
    const form = conversation.querySelector<HTMLFormElement>('form')!;
    const field = form.elements.namedItem('message') as HTMLInputElement;
    mountChatEmoji(form, field);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const text = field.value.trim();
      if (text) void update(person, 'send', text).then(saved => {
        if (saved && form.isConnected && field.value.trim() === text) field.value = '';
      });
    });
    conversation.querySelector<HTMLElement>('.friends-chat-heading')!.setAttribute('tabindex', '-1');
    conversation.querySelector<HTMLElement>('.friends-chat-heading')!.focus();
    renderCall();
    void refreshMessages(person).catch(report);
  }

  function startCall(person: Person, room: string) {
    const call = voice.privateState(room);
    if (!call || call.state === 'ended') voice.joinPrivate(room, person.name);
    renderCall();
  }

  async function openDirect(userId: number, call: boolean) {
    const ticket = ++opening;
    const { people: current } = await request<{ people: Person[] }>();
    if (signal.aborted || ticket !== opening) return;
    const person = current.find(friend => friend.id === userId && friend.status === 'friend');
    if (!person) throw new Error('A conversa está disponível apenas entre amigos.');
    if (call && !person.room) throw new Error('A chamada privada está indisponível.');
    people = current;
    selectTab('conversations');
    openConversation(person);
    if (call && person.room) startCall(person, person.room);
    else conversation.querySelector<HTMLInputElement>('[name=message]')?.focus();
  }

  function renderCall() {
    if (!selected) return;
    const friend = people.find(person => person.id === selected?.id) ?? selected;
    const call = voice.privateState(friend.room);
    const active = call && call.state !== 'ended';
    const button = conversation.querySelector<HTMLButtonElement>('[data-start-call]')!;
    const label = active ? 'Desligar' : friend.waiting ? 'Entrar na chamada' : 'Ligar';
    if (button.textContent?.trim() !== label) button.innerHTML = `${icon(active ? 'phoneOff' : 'phone')} <span>${label}</span>`;
    button.disabled = !friend.room;
    button.toggleAttribute('data-hangup', Boolean(active));
    const mic = conversation.querySelector<HTMLButtonElement>('[data-call-mic]')!;
    mic.hidden = !active;
    mic.disabled = Boolean(call?.deafened);
    const muted = Boolean(call?.muted);
    if (mic.getAttribute('aria-pressed') !== String(muted)) {
      mic.setAttribute('aria-pressed', String(muted));
      mic.setAttribute('aria-label', muted ? 'Ativar microfone' : 'Silenciar microfone');
      mic.innerHTML = icon(muted ? 'micOff' : 'mic');
    }
    const audio = conversation.querySelector<HTMLButtonElement>('[data-call-audio]')!;
    audio.hidden = !active;
    const deafened = Boolean(call?.deafened);
    if (audio.getAttribute('aria-pressed') !== String(deafened)) {
      audio.setAttribute('aria-pressed', String(deafened));
      audio.setAttribute('aria-label', deafened ? 'Reativar áudio' : 'Desativar áudio');
      audio.innerHTML = icon(deafened ? 'headphonesOff' : 'headphones');
    }
    const notice = conversation.querySelector<HTMLElement>('.friends-call-status')!;
    const message = active
      ? call.state === 'connecting' ? 'Conectando à chamada…' : call.peers ? 'Em chamada privada' : 'Aguardando a outra pessoa…'
      : call?.notice || (friend.waiting ? `${friend.name} está aguardando na chamada.` : '');
    if (notice.textContent !== message) notice.textContent = message;
    notice.hidden = !message;
  }

  async function refreshMessages(person: Person, older = false) {
    if (older && (loadingHistory || !earliest)) return;
    if (older) loadingHistory = true;
    const cursor = older ? earliest : latest;
    try {
      const result = await request<{ messages: Message[]; more: boolean }>({ with: String(person.id), [older ? 'before' : 'after']: String(cursor) });
      if (selected !== person || signal.aborted) return;
      const history = conversation.querySelector<HTMLElement>('.friends-history')!;
      const messages = history.querySelector<HTMLElement>('.friends-messages')!;
      const stick = history.scrollHeight - history.scrollTop - history.clientHeight < 60;
      const height = history.scrollHeight;
      const rows = result.messages.filter(message => older ? message.id < earliest : message.id > latest).map(message => {
        const row = document.createElement('article');
        row.className = 'friends-message';
        row.toggleAttribute('data-own-message', message.own);
        row.innerHTML = `<header><strong>${safeText(message.own ? 'Você' : person.name)}</strong><time>${time.format(new Date(message.time))}</time></header><p></p>`;
        const body = row.querySelector('p')!;
        const invitation = /^\?convite=([a-f0-9]{48})$/.exec(message.text);
        if (invitation) {
          const link = document.createElement('a');
          link.href = inviteLink(invitation[1]);
          link.textContent = 'Abrir convite para o servidor';
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          body.append(link);
        } else body.textContent = message.text;
        latest = Math.max(latest, message.id);
        earliest = earliest ? Math.min(earliest, message.id) : message.id;
        return row;
      });
      if (older) messages.prepend(...rows);
      else messages.append(...rows);
      history.querySelector<HTMLElement>('[data-empty-message]')!.hidden = Boolean(earliest);
      if (older || !cursor) history.querySelector<HTMLButtonElement>('[data-older]')!.hidden = !result.more;
      if (older && rows.length) history.scrollTop += history.scrollHeight - height;
      else if (stick) history.scrollTop = history.scrollHeight;
    } finally {
      if (older && selected === person) loadingHistory = false;
    }
  }

  async function update(person: Person, action: Action, text?: string) {
    if (pending) return false;
    pending = true;
    status.textContent = '';
    try {
      await request({}, { action, user: person.id, text });
    } catch (error) {
      report(error);
      return false;
    } finally {
      pending = false;
    }
    if (action === 'send') void refreshMessages(person).catch(report);
    else {
      void refreshPeople().catch(report);
      if (searchTerm) void findPeople().catch(report);
    }
    return true;
  }

  search.addEventListener('submit', event => {
    event.preventDefault();
    searchTerm = String(new FormData(search).get('search')).trim();
    status.textContent = '';
    void findPeople().catch(report);
  });
  const query = search.querySelector('input')!;
  query.addEventListener('input', () => {
    if (!query.value.trim()) {
      searchTerm = '';
      searchRevision++;
      results.hidden = true;
    }
  });
  for (const button of tabs) {
    button.addEventListener('click', () => {
      closeConversation();
      selectTab(button.dataset.friendsTab!);
      if (tab === 'requests') requests.querySelector('h2')?.focus();
    });
  }
  add.addEventListener('click', () => {
    addPanel.hidden = !addPanel.hidden;
    add.setAttribute('aria-expanded', String(!addPanel.hidden));
    if (!addPanel.hidden) query.focus();
  });
  dialog.querySelector('[data-friends-return]')!.addEventListener('click', close);
  workspace.addEventListener('voice-state-change', renderCall, { signal });
  async function refresh() {
    await refreshPeople();
    if (selected) await refreshMessages(selected);
  }

  const timer = window.setInterval(() => {
    if (!document.hidden) void refresh().catch(report);
  }, 4000);
  workspace.append(dialog);
  title.focus();
  renderOverview();
  void refreshPeople().catch(report);
  return {
    openDirect,
    refresh,
    person: (id: number) => people.find(person => person.id === id),
    dispose() {
      lifetime.abort();
      window.clearInterval(timer);
      voice.leavePrivate();
      dialog.remove();
    },
  };
}
