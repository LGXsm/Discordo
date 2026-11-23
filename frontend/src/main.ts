import './style.css';
import { mountServerContextMenu } from './server-context-menu';
import { mountServerTooltips } from './server-tooltips';
import { mountButtonTooltips } from './button-tooltips';
import { openFriends } from './friends';
import { mountProfileFriend } from './profile-friend';
import { mountProfileContextMenu } from './profile-context-menu';
import { channelCategoriesMarkup, mountChannelCategories } from './channel-categories';
import { mountChannelResize } from './channel-resize';
import { accountStorageKey, currentAccount, resendAccountCode, signIn, signOut, signUp, verifyAccountCode, type Account } from './accounts';
import { renderAvatar, renderImage } from './avatar';
import { isThemeHex } from './profile-theme-colors';
import { icon } from './icons';
import { openSettings } from './settings';
import { acceptInvite, CREATE_ROLES, DELETE_MESSAGES, inviteIcon, listServers, previewInvite, loadMembers, loadServer, MANAGE_CHANNELS, MANAGE_ROLES, MOVE_VOICE, openServerDialog, safeText, serverIcon, type ServerDetail, type ServerMember, type ServerSummary } from './servers';
import { createVoiceCall, mountVoice, voiceAccountControlsMarkup, voiceDockMarkup, voiceStageMarkup } from './voice-ui';
import { readVoicePreferences } from './voice-preferences';
import { mountTextChat, textComposerMarkup } from './text-chat';
import { demoRoomForServer } from './voice-demo';
import { openGameplay, tutorialGameplayMarkup } from './gameplay';
import { tutorialSoundsMarkup } from './profile-sounds';
import { mountTutorial, startNewAccountTutorial } from './tutorial';
import { playProfileEffect, profileDecorationsMarkup, renderProfileAppearance, stopProfileEffect } from './profile-appearance';
import { profileCardDetailsMarkup, renderProfileCardDetails, type ProfileCardDetails } from './profile-card-details';

type Channel = { id?: number; name: string; topic: string; greeting: string; private?: boolean };

const channels: Channel[] = [
  { name: 'geral', topic: 'O ponto de encontro da galera', greeting: 'Chega mais! Esse é o canto pra trocar ideia com a galera.' },
  { name: 'jogos', topic: 'Combine partidas e compartilhe suas jogadas', greeting: 'Vai jogar o quê hoje? Deixe aqui o convite pra próxima partida.' },
  { name: 'memes', topic: 'O melhor do grupo vai parar aqui', greeting: 'Tem um meme bom? Esse é o lugar.' },
];

const app = document.querySelector<HTMLDivElement>('#app')!;
const voiceCall = createVoiceCall();
let disposeWorkspace: (keepCall?: boolean) => void = () => {};
let workspaceEmail: string | undefined;

function showAuth(mode: 'login' | 'register' = 'login', email = '', notice = '') {
  disposeWorkspace();
  disposeWorkspace = () => {};
  workspaceEmail = undefined;
  const register = mode === 'register';
  app.innerHTML = `
    <main class="entry">
      <div class="entry-frame${register ? ' entry-frame-register' : ''}">
        <img class="entry-logo" src="${import.meta.env.BASE_URL}art/logo-principal.webp" alt="Discordo" width="2172" height="724">
        <section class="auth-box" aria-labelledby="entry-title">
          <div class="auth-switch" role="group" aria-label="Acesso à conta">
            <button type="button" data-mode="login" aria-pressed="${!register}">${icon('login')} Entrar</button>
            <button type="button" data-mode="register" aria-pressed="${register}">${icon('userPlus')} Criar conta</button>
          </div>
          <h1 id="entry-title">${register ? 'Enrola não' : 'Entra logo meu fi'}</h1>
          <p class="auth-description">${register ? 'Cria a conta logo ai.' : 'O povo ta te esperando, bora.'}</p>
          <form class="auth-form">
            <div class="auth-fields">
              <div class="auth-field">
                <label for="email">E-mail</label>
                <input id="email" name="email" type="email" autocomplete="username" placeholder="voce@exemplo.com" maxlength="254" required>
              </div>
              ${register ? `<div class="auth-field">
                <label for="name">Nome de exibição</label>
                <input id="name" name="name" autocomplete="nickname" placeholder="Como a galera te chama?" maxlength="40" required>
              </div>` : ''}
              <div class="auth-field">
                <label for="password">Senha</label>
                <div class="password-field">
                  <input id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="${register ? 'Pelo menos 8 caracteres' : 'Digite sua senha'}" ${register ? 'minlength="8"' : ''} maxlength="128" required>
                  <button class="icon-button password-toggle" type="button" aria-label="Mostrar senha">${icon('eye')}</button>
                </div>
              </div>
              ${register ? `<div class="auth-field">
                <label for="birth-date">Data de nascimento</label>
                <input id="birth-date" name="birthDate" type="date" autocomplete="bday" required>
              </div>` : ''}
            </div>
            <p class="form-message" role="status" hidden></p>
            <button class="primary-button" type="submit">${register ? 'Criar minha conta' : 'Entrar no Discordo'}${icon('arrow')}</button>
          </form>
          <p class="local-note">${icon('lock')} Use sua conta do Discordo para entrar.</p>
        </section>
      </div>
    </main>`;

  const form = app.querySelector<HTMLFormElement>('.auth-form')!;
  const emailInput = form.querySelector<HTMLInputElement>('#email')!;
  const birthDate = form.querySelector<HTMLInputElement>('#birth-date');
  const password = form.querySelector<HTMLInputElement>('#password')!;
  const toggle = form.querySelector<HTMLButtonElement>('.password-toggle')!;
  const feedback = form.querySelector<HTMLParagraphElement>('.form-message')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  emailInput.value = email;
  if (birthDate) {
    const today = new Date();
    birthDate.max = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
  }
  if (notice) {
    feedback.hidden = false;
    feedback.textContent = notice;
  }

  toggle.addEventListener('click', () => {
    const show = password.type === 'password';
    password.type = show ? 'text' : 'password';
    toggle.innerHTML = icon(show ? 'eyeOff' : 'eye');
    toggle.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });

  const modes = app.querySelectorAll<HTMLButtonElement>('[data-mode]');
  for (const button of modes) {
    button.addEventListener('click', () => {
      if (button.dataset.mode === mode) return;
      showAuth(mode === 'login' ? 'register' : 'login', emailInput.value);
      app.querySelector<HTMLButtonElement>('[data-mode][aria-pressed="true"]')?.focus({ preventScroll: true });
    });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get('email')).trim().toLowerCase();
    const name = String(data.get('name') ?? '').trim();
    const password = String(data.get('password'));
    submit.disabled = true;
    for (const button of modes) button.disabled = true;
    form.setAttribute('aria-busy', 'true');
    feedback.hidden = true;
    try {
      if (register && !name) throw new Error('Digite um nome de exibição.');
      const result = register
        ? { verification: await signUp(name, email, password, String(data.get('birthDate'))) }
        : await signIn(email, password);
      if (!form.isConnected) return;
      if ('account' in result) await openEntrance(result.account, true);
      else showVerification(mode, email, result.verification);
    } catch (error) {
      feedback.textContent = error instanceof Error && error.constructor === Error
        ? error.message : 'Não foi possível acessar a conta. Confira sua conexão.';
      feedback.hidden = false;
    } finally {
      submit.disabled = false;
      for (const button of modes) button.disabled = false;
      form.removeAttribute('aria-busy');
    }
  });
}

function showVerification(mode: 'login' | 'register', email: string, verification: { token: string; resendAfter: number }) {
  const box = app.querySelector<HTMLElement>('.auth-box')!;
  box.innerHTML = `
    <h1 id="entry-title">Confirme seu e-mail</h1>
    <p class="auth-description">Digite o código de seis números enviado para <strong>${safeText(email)}</strong>.</p>
    <form class="auth-form">
      <label for="verification-code">Código de verificação</label>
      <input id="verification-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
      <p class="form-message" role="status" hidden></p>
      <button class="primary-button" type="submit">Confirmar código${icon('arrow')}</button>
      <div class="profile-photo-actions">
        <button type="button" class="settings-button" data-resend-code>Reenviar código</button>
        <button type="button" class="settings-button" data-back-auth>Voltar</button>
      </div>
    </form>`;
  const form = box.querySelector<HTMLFormElement>('form')!;
  const input = form.querySelector<HTMLInputElement>('input')!;
  const feedback = form.querySelector<HTMLElement>('[role="status"]')!;
  const confirm = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const resend = form.querySelector<HTMLButtonElement>('[data-resend-code]')!;
  const back = form.querySelector<HTMLButtonElement>('[data-back-auth]')!;
  let busy = false;
  let resendAt = Date.now() + verification.resendAfter * 1000;
  const renderButtons = () => {
    const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    confirm.disabled = back.disabled = busy;
    resend.disabled = busy || seconds > 0;
    resend.textContent = seconds ? `Reenviar em ${seconds} s` : 'Reenviar código';
  };
  const clock = window.setInterval(() => {
    if (!form.isConnected) window.clearInterval(clock);
    else renderButtons();
  }, 1000);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    busy = true;
    renderButtons();
    feedback.hidden = true;
    try {
      await work();
    } catch (error) {
      feedback.textContent = error instanceof Error ? error.message : 'Não foi possível verificar o código.';
      feedback.hidden = false;
    } finally {
      busy = false;
      renderButtons();
    }
  };
  form.addEventListener('submit', event => {
    event.preventDefault();
    void run(async () => {
      const account = await verifyAccountCode(verification.token, input.value);
      if (form.isConnected) {
        if (mode === 'register') startNewAccountTutorial(account.email);
        await openEntrance(account, true);
      }
    });
  });
  resend.addEventListener('click', () => void run(async () => {
    verification = await resendAccountCode(verification.token);
    resendAt = Date.now() + verification.resendAfter * 1000;
    input.value = '';
    feedback.textContent = 'Enviamos um novo código.';
    feedback.hidden = false;
    input.focus();
  }));
  back.addEventListener('click', () => {
    window.clearInterval(clock);
    showAuth(mode, email);
    app.querySelector<HTMLInputElement>('#email')?.focus();
  });
  renderButtons();
  input.focus();
}


function clearInviteFromAddress() {
  const url = new URL(location.href);
  url.searchParams.delete('convite');
  history.replaceState(history.state, '', url);
}

async function openInvitation(token: string, account?: Account, current = () => true) {
  let preview: Awaited<ReturnType<typeof previewInvite>> | undefined;
  let message = '';
  try {
    preview = await previewInvite(token);
    if (!current()) return;
    if (account && preview.member) {
      const server = await loadServer(preview.id);
      if (!current()) return;
      clearInviteFromAddress();
      showWorkspace(account, true, server);
      return;
    }
  } catch (error) {
    message = (error as Error).message;
  }
  if (!current()) return;
  disposeWorkspace(workspaceEmail === account?.email && account !== undefined);
  disposeWorkspace = () => {};
  app.innerHTML = `<main class="entry">
    <section class="auth-box invite-landing" aria-labelledby="invite-title">
      ${preview?.hasIcon ? `<img src="${safeText(inviteIcon(token))}" width="64" height="64" alt="">` : ''}
      <h1 id="invite-title">${preview ? safeText(preview.name) : 'Convite indisponível'}</h1>
      <p class="auth-description">${preview ? 'Você recebeu um convite para entrar neste servidor.' : safeText(message)}</p>
      <div class="invite-landing-actions">
        ${preview ? '<button class="primary-button" type="button" data-invite-continue>' + (account ? 'Aceitar convite' : 'Entrar ou criar conta') + '</button>' : ''}
        <button class="settings-button" type="button" data-invite-back>Voltar</button>
      </div>
      <p class="settings-status" role="status"></p>
    </section>
  </main>`;
  const landing = app.querySelector<HTMLElement>('.invite-landing')!;
  const back = landing.querySelector<HTMLButtonElement>('[data-invite-back]')!;
  back.addEventListener('click', () => {
    clearInviteFromAddress();
    if (account) void openEntrance(account, true, () => landing.isConnected);
    else showAuth();
  });
  const submit = landing.querySelector<HTMLButtonElement>('[data-invite-continue]');
  submit?.addEventListener('click', async () => {
    if (!account) {
      showAuth('login', '', 'Entre ou crie uma conta para aceitar o convite de ' + preview!.name + '.');
      return;
    }
    submit.disabled = back.disabled = true;
    const status = landing.querySelector('[role=status]')!;
    try {
      const result = await acceptInvite(token);
      if (result.id !== preview?.id) throw new Error('O convite retornou outro servidor.');
      const server = await loadServer(result.id);
      if (!landing.isConnected) return;
      clearInviteFromAddress();
      showWorkspace(account, true, server);
    } catch (error) {
      status.textContent = (error as Error).message;
      submit.disabled = back.disabled = false;
    }
  });
  (submit ?? back).focus();
}

async function openEntrance(account: Account, focus = false, current = () => true) {
  const params = new URL(location.href).searchParams;
  const invite = params.get('convite');
  if (invite !== null) {
    await openInvitation(invite, account, current);
    return;
  }
  const requested = Number(params.get('servidor'));
  const serverId = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  const channel = Number(params.get('canal'));
  let server: ServerDetail | undefined;
  let notice = '';
  try {
    server = await loadServer(serverId);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (serverId && (status === 403 || status === 404)) {
      server = await loadServer(0).catch(() => undefined);
      notice = 'Este servidor está indisponível para sua conta.';
    } else {
      notice = 'Não foi possível carregar o servidor. Tente novamente pelo menu de servidores.';
    }
  }
  if (!current()) return;
  showWorkspace(account, focus, server, undefined, server?.id === serverId ? channel : undefined);
  if (notice) app.querySelector('.chat-note')!.textContent = notice;
}

function rememberWorkspace(server: ServerDetail, channel?: number) {
  const url = new URL(location.href);
  url.searchParams.set('servidor', String(server.id));
  if (channel === undefined) url.searchParams.delete('canal');
  else url.searchParams.set('canal', String(channel));
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

function showWorkspace(account: Account, focus = false, server?: ServerDetail, knownServers?: ServerSummary[], previousChannel?: number) {
  disposeWorkspace(workspaceEmail === account.email);
  workspaceEmail = account.email;
  const serverName = server?.name ?? 'Discordo';
  const textRooms: Channel[] = server ? server.channels.filter(channel => channel.type === 'TEXTO').map(channel => ({
    ...channel, topic: channel.private ? 'Canal privado' : channel.topic ?? '',
    greeting: (server.lobby && channels.find(previous => previous.name === channel.name)?.greeting)
      || 'Envie uma mensagem para começar.',
  })) : [];
  const voiceRooms: { id: string; name: string; private: boolean; channelId?: number }[] = server ? server.channels.filter(channel => channel.type === 'VOZ').map(channel => ({
    id: `channel-${channel.id}`, name: channel.name, private: channel.private, channelId: channel.id,
  })) : [];
  if (server?.members.some(member => member.self && member.title === 'Criador')) {
    voiceRooms.push({ id: demoRoomForServer(server.id, server.lobby), name: 'Teste de vídeo', private: true });
  }
  let members: ServerMember[] = server?.members ?? [];
  const canOpenServerSettings = Boolean((server?.permissions ?? 0) & (MANAGE_CHANNELS | MANAGE_ROLES | CREATE_ROLES));
  const channelKey = (channel: Channel) => channel.id === undefined ? channel.name : String(channel.id);
  const channelSettings = (id: number | undefined, name: string) =>
    id && (server!.permissions & MANAGE_CHANNELS)
      ? `<button type="button" class="icon-button channel-settings" data-edit-channel="${id}"
          aria-label="Editar canal ${safeText(name)}" title="Editar canal ${safeText(name)}">${icon('settings')}</button>`
      : '';
  const renderVoiceRoom = ({ id, name, private: privateRoom, channelId }: typeof voiceRooms[number]) => `
    <div class="voice-channel"><div class="channel-row">
      <button class="channel" type="button" data-voice-room="${id}">${icon('voice')} <span class="channel-name">${safeText(name)}</span> ${privateRoom ? icon('lock') : ''}</button>
      ${channelSettings(channelId, name)}</div>
      <ul class="voice-channel-members" aria-label="Participantes em ${safeText(name)}" data-voice-members="${id}" hidden></ul>
    </div>`;
  const channelSidebar = channelCategoriesMarkup(server, channel => channel.type === 'TEXTO'
    ? `<div class="channel-row"><button class="channel" type="button" data-channel="${channel.id}">${icon(channel.private ? 'lock' : 'hash')} <span class="channel-name">${safeText(channel.name)}</span></button>${channelSettings(channel.id, channel.name)}</div>`
    : renderVoiceRoom(voiceRooms.find(room => room.channelId === channel.id)!),
    voiceRooms.filter(room => room.channelId === undefined).map(room => `<section class="demo-channel-section"><h2>Teste de vídeo</h2>${renderVoiceRoom(room)}</section>`).join(''));
  app.innerHTML = `
    <main class="workspace" aria-label="Discordo">
      <nav class="server-rail" aria-label="Amizades e servidores">
        <button class="server-icon friends-trigger" type="button" data-open-friends aria-label="Amizades" aria-pressed="false">${icon('users')}</button>
        <hr class="server-rail-divider">
        <button type="button" class="server-icon" data-lobby aria-label="Discordo Brasil"${server?.lobby ? ' aria-current="true"' : ''}>
          <img src="${import.meta.env.BASE_URL}art/logo-pequena.webp" alt="Discordo Brasil" width="46" height="46">
        </button>
        <div class="server-rail-list" data-server-icons></div>
        <button class="server-icon server-add" type="button" data-create-server aria-label="Criar servidor" title="Criar servidor">${icon('plus')}</button>
      </nav>
      <aside class="channel-panel" id="channel-panel" aria-label="Canais do servidor">
        <header class="server-heading">
          <details class="server-menu">
            <summary>${server?.lobby ? '<span class="brazil-flag" aria-hidden="true"></span>' : ''}<span>${safeText(serverName)}</span>${icon('chevron')}</summary>
            <div class="server-actions">
              ${canOpenServerSettings ? `<button type="button" data-server-settings>${icon('settings')} Configurações do servidor</button>` : ''}
              ${(server?.permissions ?? 0) & MANAGE_CHANNELS ? `<button type="button" data-create-channel>${icon('plus')} Criar canal</button><button type="button" data-create-category>${icon('plus')} Criar categoria</button>` : ''}
              ${server ? `<button type="button" data-open-invites>${icon('userPlus')} Convites</button>` : ''}
              ${server?.admin && !server.lobby ? `<button class="server-delete-action" type="button" data-delete-server>${icon('trash')} Excluir servidor</button>` : ''}
              ${!canOpenServerSettings ? '<p class="channel-empty">Você está neste servidor.</p>' : ''}
            </div>
          </details>
          ${server ? `<button type="button" class="icon-button server-invite-trigger" data-open-invites
            aria-label="Convidar para o servidor">${icon('userPlus')}</button>` : ''}
        </header>
        <div class="channel-list">
          ${channelSidebar}
        </div>
        ${voiceDockMarkup}
      </aside>
      <div class="voice-account-bar">
        <button class="profile-trigger account-profile" type="button" data-account-profile aria-haspopup="dialog">
          <span class="avatar personal" data-avatar aria-hidden="true"></span>
          <span class="account-label"><strong data-account-name></strong><small data-account-voice-status>Conta Discordo</small></span>
        </button>
        <details class="account-menu">
          <summary class="account-summary" aria-label="Opções da conta" hidden>${icon('chevron')}</summary>
          <div class="account-actions">
            <span class="account-email"></span>
            <button type="button" data-own-profile aria-haspopup="dialog">${icon('profile')} Meu perfil</button>
            <button type="button" data-settings>${icon('settings')} Configurações</button>
            <button type="button" data-action="switch">${icon('swap')} Trocar de conta</button>
            <button type="button" data-action="logout">${icon('logout')} Sair</button>
          </div>
        </details>
        ${voiceAccountControlsMarkup}
      </div>
      <section class="chat chat-wall" aria-labelledby="channel-title">
        <header class="chat-bar">
          <button class="icon-button mobile-menu" type="button" aria-label="Canais e conta" aria-controls="channel-panel" aria-expanded="false">${icon('menu')}</button>
          <span class="chat-hash">${icon('hash')}</span>
          <h1 id="channel-title" tabindex="-1"></h1>
          <p id="channel-topic"></p>
          <button class="primary-button gameplay-open" type="button" data-open-gameplay${textRooms.some(room => room.id) ? '' : ' hidden'}>Gameplay</button>
          <button class="icon-button members-toggle" type="button" aria-label="Mostrar membros" aria-controls="member-panel" aria-expanded="true">${icon('users')}</button>
        </header>
        ${voiceStageMarkup}
        <div class="chat-scroll">
          <div class="chat-start">
            <span class="chat-mark">${icon('hash')}</span>
            <h2></h2>
            <p></p>
          </div>
          <div class="messages" role="log" aria-label="Mensagens do canal"></div>
        </div>
        ${textComposerMarkup}
        <p class="chat-note" role="status"></p>
      </section>
      <aside class="members-panel" id="member-panel" aria-label="Membros">
        <h2>Membros <span data-member-count>${server ? members.length : ''}</span></h2>
        <div data-member-list>${server ? '' : '<p class="channel-empty" role="status">Abra um servidor para ver os membros.</p>'}</div>
      </aside>
      <section id="member-profile" class="member-profile" popover role="dialog" aria-label="Perfil do usuário">
        <div class="profile-banner" data-card-banner aria-hidden="true"></div>
        <button class="icon-button profile-friend-action" type="button" data-profile-friend aria-label="Adicionar amigo" hidden>${icon('userPlus')}</button>
        <button class="icon-button profile-card-close" type="button" popovertarget="member-profile" popovertargetaction="hide" aria-label="Fechar perfil">${icon('close')}</button>
        <div class="profile-identity">
          <span class="avatar personal" data-card-avatar aria-hidden="true"></span>
          <h2 data-card-name></h2>
          <p class="profile-bio" data-profile-bio hidden></p>
          <p class="profile-friend-feedback" data-profile-friend-feedback role="status" hidden></p>
          ${profileCardDetailsMarkup}
        </div>
        ${profileDecorationsMarkup}
      </section>
    </main>`;

  app.querySelector('.account-email')!.textContent = account.email;

  const workspace = app.querySelector<HTMLElement>('.workspace')!;
  const disposeServerTooltips = mountServerTooltips(workspace);
  function runServerAction(scope: HTMLElement, action: string) {
    const button = scope.querySelector<HTMLButtonElement>(`.server-actions > [data-${action}]`);
    if (!button) return;
    button.closest('details')!.open = false;
    button.click();
  }
  const disposeServerContextMenu = mountServerContextMenu(workspace, server, (id, action) => {
    if (server && (id === server.id || (id === 0 && server.lobby))) runServerAction(workspace, action);
    else void navigate(id, false, next => runServerAction(next, action));
  });
  const disposeChannelResize = mountChannelResize(workspace);
  const disposeChannelCategories = mountChannelCategories(workspace, server, account.email, id => navigate(id, true));
  const title = app.querySelector<HTMLElement>('#channel-title')!;
  const topic = app.querySelector<HTMLElement>('#channel-topic')!;
  const textChat = mountTextChat(workspace, userId => members.find(member => member.userId === userId), openUserProfile, () => {
    const self = members.find(member => member.self);
    return Boolean(server?.admin || self?.roles.some(role => role.permissions & DELETE_MESSAGES));
  }, textRooms);
  const note = app.querySelector<HTMLElement>('.chat-note')!;
  const menu = workspace.querySelector<HTMLButtonElement>('.chat-bar .mobile-menu')!;
  const stageMenu = workspace.querySelector<HTMLButtonElement>('[data-stage-menu]')!;
  const visibleMenu = () => stageMenu.closest('[hidden]') ? menu : stageMenu;
  const memberToggle = app.querySelector<HTMLButtonElement>('.members-toggle')!;
  const narrow = matchMedia('(max-width: 1050px)');
  const serverMenu = workspace.querySelector<HTMLDetailsElement>('.server-menu')!;
  let selected = textRooms.find(channel => previousChannel && channel.id === previousChannel) ?? textRooms[0];
  workspace.querySelector('[data-open-gameplay]')!.addEventListener('click', () => {
    openGameplay(workspace, textRooms, members, selected?.id, (id, failures) => {
      const channel = textRooms.find(room => room.id === id);
      if (channel && selected?.id !== id) selectChannel(channel);
      else textChat.refresh();
      note.textContent = failures ? `Enquete publicada. Falha ao enviar ${failures} convite(s) por e-mail.` : 'Gameplay publicado.';
    });
  });
  let serverChoices = knownServers ?? [];
  let navigation = 0;
  const voice = mountVoice(voiceCall, workspace, () => account.name, readVoicePreferences(account.email), () => {
    if (workspace.classList.contains('with-channels')) {
      setChannels(false);
      visibleMenu().focus({ preventScroll: true });
    }
  }, showSettings, voiceRooms, server?.id, Boolean((server?.permissions ?? 0) & MOVE_VOICE), serverName, {
    email: account.email,
    permissions: server?.permissions ?? 0,
    appearance(member, self) {
      const profile = self ? account : members.find(candidate => member.userId !== undefined && candidate.userId === member.userId);
      if (profile) return { name: profile.name, avatarUrl: profile.avatarUrl, avatarStillUrl: profile.avatarStillUrl };
    },
    profile(member, anchor, self) {
      openUserProfile(member.userId, member.name, anchor, self);
    },
    editRoles: (server?.permissions ?? 0) & MANAGE_ROLES ? editMemberRoles : undefined,
  });
  const memberLifetime = new AbortController();
  let friends: ReturnType<typeof openFriends> | undefined;
  const friendsButton = workspace.querySelector<HTMLButtonElement>('[data-open-friends]')!;
  function exitFriends() {
    friends?.dispose();
    friends = undefined;
    friendsButton.setAttribute('aria-pressed', 'false');
  }
  function showFriends() {
    if (friends) return friends;
    setChannels(false);
    friends = openFriends(workspace, voice, () => {
      exitFriends();
      visibleMenu().focus({ preventScroll: true });
    });
    friendsButton.setAttribute('aria-pressed', 'true');
    return friends;
  }
  friendsButton.addEventListener('click', () => { if (friends) exitFriends(); else showFriends(); });
  mountButtonTooltips(workspace, memberLifetime.signal);
  let memberTimer: ReturnType<typeof setTimeout> | undefined;
  let memberRequest: AbortController | undefined;
  let tutorialSidebar: { channels: boolean; menu: boolean; scrollTop: number } | undefined;
  const tutorialChannelList = workspace.querySelector<HTMLElement>('.channel-list')!;
  const tutorial = mountTutorial(workspace, account.email, { sounds: tutorialSoundsMarkup, gameplay: tutorialGameplayMarkup }, feature => {
    if (feature === 'sounds' || feature === 'absence') {
      tutorialSidebar ??= {
        channels: workspace.classList.contains('with-channels'), menu: accountMenu.open, scrollTop: tutorialChannelList.scrollTop,
      };
      if (matchMedia('(max-width: 720px)').matches && !workspace.classList.contains('with-channels')) setChannels(true);
      accountMenu.open = feature === 'sounds';
      if (feature === 'sounds') return accountMenu.querySelector('[data-settings]');
      const room = workspace.querySelector<HTMLElement>('[data-voice-room^="channel-"]');
      room?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return room;
    }
    if (tutorialSidebar) {
      accountMenu.open = tutorialSidebar.menu;
      tutorialChannelList.scrollTop = tutorialSidebar.scrollTop;
      if (workspace.classList.contains('with-channels') !== tutorialSidebar.channels) setChannels(tutorialSidebar.channels);
      tutorialSidebar = undefined;
    }
    return feature === 'gameplay' ? workspace.querySelector('[data-open-gameplay]:not([hidden])') : null;
  });
  disposeWorkspace = (keepCall = false) => {
    exitFriends();
    disposeServerContextMenu();
    disposeServerTooltips();
    disposeChannelResize();
    disposeChannelCategories?.();
    tutorial.dispose();
    voice.dispose(keepCall);
    textChat.dispose();
    memberLifetime.abort();
    memberRequest?.abort();
    clearTimeout(memberTimer);
  };

  function drawServers() {
    const rail = workspace.querySelector('[data-server-icons]')!;
    const entrance = serverChoices.find(choice => choice.lobby);
    const entranceButton = workspace.querySelector<HTMLButtonElement>('[data-lobby]')!;
    if (entrance) {
      entranceButton.setAttribute('aria-label', entrance.name);
      entranceButton.removeAttribute('title');
      if (entrance.hasIcon) entranceButton.querySelector('img')!.src = serverIcon(entrance.id);
    }
    rail.innerHTML = serverChoices.filter(choice => !choice.lobby).map(choice => `<button type="button" class="server-icon" data-server="${choice.id}"
      aria-label="${safeText(choice.name)}"${choice.id === server?.id ? ' aria-current="true"' : ''}>
      ${choice.hasIcon ? `<img src="${serverIcon(choice.id)}" alt="" width="46" height="46">` : safeText(choice.name.slice(0, 2).toUpperCase())}
    </button>`).join('');
    for (const button of rail.querySelectorAll<HTMLButtonElement>('[data-server]')) {
      button.addEventListener('click', () => void navigate(Number(button.dataset.server)));
    }
    for (const button of workspace.querySelectorAll<HTMLButtonElement>('[data-create-server]')) {
      const owns = serverChoices.some(choice => choice.owner);
      button.disabled = owns;
      if (owns) button.title = 'Você já tem um servidor próprio';
    }
  }

  async function navigate(id: number, refresh = false, afterOpen?: (next: HTMLElement) => void) {
    exitFriends();
    if (server && (id === server.id || id === 0 && server.lobby) && !refresh) return;
    const ticket = ++navigation;
    try {
      const [next, choices] = await Promise.all([loadServer(id), refresh ? listServers().catch(() => serverChoices) : serverChoices]);
      if (ticket === navigation && workspace.isConnected) {
        showWorkspace(account, false, next, choices, refresh ? selected?.id : undefined);
        const nextWorkspace = app.querySelector<HTMLElement>('.workspace');
        if (nextWorkspace) afterOpen?.(nextWorkspace);
      }
    } catch (error) {
      if (ticket !== navigation || !workspace.isConnected) return;
      note.textContent = error instanceof Error ? error.message : 'Não foi possível abrir o servidor.';
    }
  }
  drawServers();
  if (!knownServers) void listServers().then(choices => {
    if (!workspace.isConnected) return;
    serverChoices = choices;
    drawServers();
  }).catch(() => { if (workspace.isConnected) note.textContent = 'Não foi possível carregar seus servidores.'; });
  workspace.querySelector('[data-lobby]')!.addEventListener('click', () => void navigate(0));
  for (const button of workspace.querySelectorAll<HTMLButtonElement>('[data-create-server], [data-server-settings], [data-create-channel]')) {
    button.addEventListener('click', () => {
      serverMenu.open = false;
      const mode = button.hasAttribute('data-create-server') ? 'create' : 'manage';
      openServerDialog(workspace, mode, id => navigate(id, true), server,
        button.hasAttribute('data-create-channel') ? 'channels' : 'profile', undefined, member => {
          const row = memberList.querySelector<HTMLElement>(`[data-member="${member.id}"]`);
          openMember(member, row?.getClientRects().length ? row : serverMenu.querySelector('summary')!);
        }, next => {
          if (memberLifetime.signal.aborted) return;
          memberRequest?.abort();
          applyMembers(next);
        });
    });
  }
  for (const button of workspace.querySelectorAll('[data-open-invites]')) {
    button.addEventListener('click', () => {
      serverMenu.open = false;
      openServerDialog(workspace, 'invite', id => navigate(id, true), server);
    });
  }
  for (const button of workspace.querySelectorAll<HTMLButtonElement>('[data-edit-channel]')) {
    button.addEventListener('click', () => {
      openServerDialog(workspace, 'edit-channel', async (id, deletedChannel) => {
        if (deletedChannel !== undefined && voiceCall.session?.room === `channel-${deletedChannel}`) voiceCall.session.leave();
        await navigate(id, true);
      }, server, 'channels', Number(button.dataset.editChannel));
    });
  }
  workspace.querySelector('[data-delete-server]')?.addEventListener('click', () => {
    serverMenu.open = false;
    openServerDialog(workspace, 'delete-server', async id => {
      if (voiceCall.origin?.id === id) voiceCall.session?.leave();
      await navigate(0, true);
    }, server);
  });

  function refreshProfile() {
    for (const element of workspace.querySelectorAll('[data-account-name]')) element.textContent = account.name;
    for (const element of workspace.querySelectorAll('[data-avatar]')) renderAvatar(element, account);
    voice.refreshProfiles();
    textChat.refreshAuthors();
  }

  function selectChannel(channel: Channel) {
    selected = channel;
    if (server) rememberWorkspace(server, channel.id);
    title.textContent = channel.name;
    topic.textContent = channel.topic;
    app.querySelector('.chat-start h2')!.textContent = `Início de #${channel.name}`;
    app.querySelector('.chat-start p')!.textContent = channel.greeting;
    if (memberRow?.closest('.messages') && profileCard.matches(':popover-open')) profileCard.hidePopover();
    textChat.select(channel.id, channel.name);
    for (const button of app.querySelectorAll<HTMLButtonElement>('[data-channel]')) {
      if (button.dataset.channel === channelKey(channel)) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }

  function setMembers(open: boolean) {
    workspace.classList.toggle('with-members', open);
    memberToggle.setAttribute('aria-expanded', String(open));
    memberToggle.setAttribute('aria-label', open ? 'Ocultar membros' : 'Mostrar membros');
    void refreshMembers();
  }

  function setChannels(open: boolean) {
    workspace.classList.toggle('with-channels', open);
    menu.setAttribute('aria-expanded', String(open));
    stageMenu.setAttribute('aria-expanded', String(open));
    if (open) void voice.refreshPresence();
    void refreshMembers();
  }

  function toggleChannels() {
    const open = !workspace.classList.contains('with-channels');
    setMembers(false);
    setChannels(open);
    if (open) workspace.querySelector<HTMLButtonElement>('.channel[aria-current]')?.focus();
  }
  menu.addEventListener('click', toggleChannels);
  stageMenu.addEventListener('click', toggleChannels);
  memberToggle.addEventListener('click', () => {
    setChannels(false);
    setMembers(!workspace.classList.contains('with-members'));
  });
  let swipe: { id: number; x: number; y: number } | undefined;
  workspace.addEventListener('touchstart', event => {
    swipe = undefined;
    if (!matchMedia('(max-width: 720px)').matches || event.touches.length !== 1
      || !(event.target instanceof Element) || !event.target.closest('.chat-scroll, .channel-list, .members-panel, .server-rail')
      || event.target.closest('dialog, [popover], input, textarea, select, video, [contenteditable]')
      || window.getSelection()?.type === 'Range') return;
    const { identifier, clientX, clientY } = event.touches[0];
    swipe = { id: identifier, x: clientX, y: clientY };
  }, { passive: true });
  workspace.addEventListener('touchcancel', () => { swipe = undefined; }, { passive: true });
  workspace.addEventListener('touchend', event => {
    const start = swipe;
    swipe = undefined;
    if (!start || event.touches.length || window.getSelection()?.type === 'Range') return;
    const end = Array.from(event.changedTouches).find(touch => touch.identifier === start.id);
    if (!end) return;
    const x = end.clientX - start.x;
    const y = end.clientY - start.y;
    if (Math.abs(x) < 56 || Math.abs(x) < Math.abs(y) * 1.6) return;
    const channelsOpen = workspace.classList.contains('with-channels');
    const membersOpen = workspace.classList.contains('with-members');
    if (channelsOpen && x < 0) setChannels(false);
    else if (membersOpen && x > 0) setMembers(false);
    else if (!channelsOpen && !membersOpen) {
      if (x > 0) setChannels(true);
      else setMembers(true);
    }
  }, { passive: true });
  for (const button of app.querySelectorAll<HTMLButtonElement>('[data-channel]')) {
    button.addEventListener('click', () => {
      const channel = textRooms.find(channel => channelKey(channel) === button.dataset.channel);
      if (!channel) return;
      selectChannel(channel);
      setChannels(false);
      title.focus();
    });
  }
  workspace.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (workspace.classList.contains('with-channels')) {
      setChannels(false);
      visibleMenu().focus();
    } else if (narrow.matches && workspace.classList.contains('with-members')) {
      setMembers(false);
      memberToggle.focus();
    }
  });
  async function exitAccount(action: 'switch' | 'logout') {
    try {
      await signOut();
    } catch {
      return false;
    }
    showAuth('login', '', action === 'switch' ? 'Entre com outra conta do Discordo.' : '');
    app.querySelector<HTMLInputElement>('#email')?.focus();
    return true;
  }

  const accountMenu = workspace.querySelector<HTMLDetailsElement>('.account-menu')!;
  document.addEventListener('click', event => {
    const path = event.composedPath();
    for (const menu of [serverMenu, accountMenu]) {
      if (menu === accountMenu && workspace.querySelector('.tutorial-card[open][data-step="1"]')) continue;
      if (menu.open && !path.includes(menu)) menu.open = false;
    }
  }, { capture: true, signal: memberLifetime.signal });
  const profileCard = workspace.querySelector<HTMLElement>('#member-profile')!;
  const selectProfileFriend = mountProfileFriend(profileCard, memberLifetime.signal, renderCard);
  const cardBanner = profileCard.querySelector('[data-card-banner]')!;
  const cardAvatar = profileCard.querySelector('[data-card-avatar]')!;
  const memberList = workspace.querySelector<HTMLElement>('[data-member-list]')!;
  let memberRow: HTMLElement | undefined;
  let activeMember: ServerMember | undefined;

  function drawMembers() {
    workspace.querySelector('[data-member-count]')!.textContent = String(members.length);
    const focused = memberList.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.member : undefined;
    const groups = new Map<string, { name: string; position: number; color?: string; members: ServerMember[] }>();
    for (const member of members) {
      const role = member.roles[0];
      const key = member.title ?? (role ? `role-${role.id}` : 'members');
      const color = member.title ? member.titleColor : role?.color;
      const group = groups.get(key) ?? {
        name: member.title ?? role?.name ?? 'Sem cargo',
        color: isThemeHex(color) ? color : undefined,
        position: member.title === 'Criador' ? -2 : member.title === 'ADM' ? -1 : role ? role.position ?? 0 : Infinity,
        members: [],
      };
      group.members.push(member);
      groups.set(key, group);
    }
    const orderedGroups = [...groups.values()].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
    const orderedMembers = orderedGroups.flatMap(group => group.members);
    memberList.innerHTML = orderedGroups.map(group => `<section class="member-group">
      <h3${group.color ? ` style="--role-text:${group.color}"` : ''}>${safeText(group.name)} <span>· ${group.members.length}</span></h3>
      ${group.members.map(member => `<button type="button" class="member-row" data-member="${member.id}" aria-haspopup="dialog">
      <span class="avatar personal"${member.self ? ' data-avatar' : ''} aria-hidden="true"></span>
      <strong${member.self ? ' data-account-name' : ''}>${safeText(member.self ? account.name : member.name)}</strong>
    </button>`).join('')}</section>`).join('');
    for (const [index, row] of [...memberList.querySelectorAll<HTMLButtonElement>('[data-member]')].entries()) {
      const member = orderedMembers[index];
      const profile = member.self ? account : member;
      renderAvatar(row.querySelector('.avatar')!, profile);
      if (profile.bannerUrl) {
        const banner = document.createElement('img');
        banner.className = 'member-row-banner';
        banner.alt = '';
        banner.loading = 'lazy';
        banner.addEventListener('error', () => banner.remove(), { once: true });
        banner.src = profile.bannerUrl;
        row.prepend(banner);
      }
      const color = isThemeHex(member.titleColor) ? member.titleColor : member.roles.find(role => isThemeHex(role.color))?.color;
      if (isThemeHex(color)) row.style.setProperty('--role-text', color);
      if (row.dataset.member === focused) row.focus({ preventScroll: true });
    }
    if (activeMember && profileCard.matches(':popover-open')) {
      const updated = members.find(candidate => activeMember?.userId !== undefined
        ? candidate.userId === activeMember.userId : candidate.id === activeMember?.id);
      activeMember = updated ?? (activeMember.self || !activeMember.id ? activeMember : undefined);
      if (memberRow?.classList.contains('member-row')) {
        memberRow = activeMember && memberList.querySelector<HTMLButtonElement>(`[data-member="${activeMember.id}"]`) || undefined;
      }
      if (activeMember && memberRow) renderCard();
      else profileCard.hidePopover();
    }
  }

  let memberPointerToggle: number | undefined;
  memberList.addEventListener('pointerdown', event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-member]');
    const id = row && Number(row.dataset.member);
    // Native popover dismissal can run before click, so remember the open card here.
    memberPointerToggle = profileCard.matches(':popover-open') && activeMember?.id === id ? id : undefined;
  });
  memberList.addEventListener('pointercancel', () => { memberPointerToggle = undefined; });
  memberList.addEventListener('click', event => {
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-member]');
    const repeated = memberPointerToggle;
    memberPointerToggle = undefined;
    if (!row) return;
    const member = members.find(candidate => candidate.id === Number(row.dataset.member));
    if (!member) return;
    if (repeated === member.id || (profileCard.matches(':popover-open') && activeMember?.id === member.id)) {
      profileCard.hidePopover();
      memberRow?.removeAttribute('aria-expanded');
      stopProfileEffect(profileCard);
      return;
    }
    openMember(member, row);
  });

  mountProfileContextMenu(workspace, memberLifetime.signal, {
    resolve(anchor) {
      if (anchor.dataset.member) return members.find(member => member.id === Number(anchor.dataset.member));
      const message = anchor.closest<HTMLElement>('[data-author]');
      const id = Number(anchor.dataset.friendId ?? anchor.dataset.voiceProfileUser ?? message?.dataset.author);
      const userId = Number.isSafeInteger(id) && id > 0 ? id : undefined;
      const self = anchor.hasAttribute('data-voice-profile-self') || Boolean(message?.hasAttribute('data-own-message'));
      const member = members.find(person => self ? person.self : userId !== undefined && person.userId === userId);
      if (member) return member;
      const friend = userId ? friends?.person(userId) : undefined;
      const name = friend?.name ?? anchor.dataset.voiceProfileName ?? message?.dataset.authorName;
      if (!name) return;
      return { id: 0, userId, name, self, title: null, roles: [], avatarUrl: friend?.avatarUrl, bannerUrl: friend?.bannerUrl };
    },
    profile: openMember,
    conversation: (user, call) => showFriends().openDirect(user, call),
    roles: (server?.permissions ?? 0) & MANAGE_ROLES ? editMemberRoles : undefined,
    refreshFriends: () => friends?.refresh(),
  });

  function openUserProfile(userId: number | undefined, name: string, anchor: HTMLElement, self = false) {
    const member = members.find(candidate => self ? candidate.self : userId !== undefined && candidate.userId === userId);
    openMember(member ?? { id: 0, userId, name, self, title: null, roles: [] }, anchor);
  }

  function openMember(member: ServerMember, row: HTMLElement) {
    const alreadyOpen = profileCard.matches(':popover-open');
    const sameMember = (activeMember?.self && member.self) ||
      (member.userId !== undefined && activeMember?.userId === member.userId) ||
      (memberRow === row && activeMember?.id === member.id);
    memberRow?.removeAttribute('aria-expanded');
    memberRow = row;
    activeMember = member;
    if (!alreadyOpen) profileCard.showPopover(row.isConnected ? { source: row } : undefined);
    renderCard();
    if (!alreadyOpen || !sameMember) playProfileEffect(profileCard, (member.self ? account : member).appearance);
  }

  function applyMembers(next: ServerMember[]) {
    if (JSON.stringify(next) === JSON.stringify(members)) return;
    members = next;
    const self = next.find(member => member.self);
    if (self) {
      account.name = self.name;
      if (self.avatarUrl !== undefined) {
        account.avatarUrl = self.avatarUrl ?? undefined;
        account.avatarStillUrl = self.avatarStillUrl ?? undefined;
        account.avatarCrop = self.avatarCrop;
      }
      if (self.bannerUrl !== undefined) account.bannerUrl = self.bannerUrl ?? undefined;
      if (self.appearance !== undefined) account.appearance = self.appearance;
      refreshProfile();
    } else textChat.refreshAuthors();
    drawMembers();
  }

  const canRefreshMembers = () => !memberLifetime.signal.aborted && !document.hidden;
  async function refreshMembers() {
    clearTimeout(memberTimer);
    if (!server || memberRequest || !canRefreshMembers()) return;
    const request = new AbortController();
    memberRequest = request;
    const timeout = setTimeout(() => request.abort(), 5000);
    let delay = 2000;
    try {
      const next = await loadMembers(server.id, request.signal);
      if (!memberLifetime.signal.aborted && !request.signal.aborted) applyMembers(next);
    } catch (error) {
      if (!memberLifetime.signal.aborted && (error as { status?: number }).status === 401) {
        showAuth('login', account.email, 'Entre novamente para confirmar seu e-mail.');
        return;
      }
      delay = 4000;
      if (!memberLifetime.signal.aborted && !members.length) {
        memberList.textContent = 'Não foi possível carregar os membros. Tentando novamente…';
      }
    } finally {
      clearTimeout(timeout);
      memberRequest = undefined;
      if (canRefreshMembers()) memberTimer = setTimeout(refreshMembers, delay);
    }
  }
  document.addEventListener('visibilitychange', refreshMembers, { signal: memberLifetime.signal });
  window.addEventListener('focus', refreshMembers, { signal: memberLifetime.signal });
  if (server) drawMembers();

  function profileDetails(member?: ServerMember): ProfileCardDetails {
    return {
      roles: [...(member?.title ? [member.title] : []), ...(member?.roles.map(role => role.name) ?? [])],
      editProfile: member?.self ?? true,
      editRoles: Boolean(member?.id && ((server?.permissions ?? 0) & MANAGE_ROLES)),
    };
  }

  function renderCard() {
    if (!activeMember || !memberRow) return;
    const profile = activeMember.self ? account : activeMember;
    memberRow.setAttribute('aria-expanded', 'true');
    renderImage(cardBanner, profile.bannerUrl);
    renderAvatar(cardAvatar, profile, true);
    profileCard.querySelector('[data-card-name]')!.textContent = profile.name;
    renderProfileAppearance(profileCard, profile.appearance);
    const aboveAccount = memberRow.hasAttribute('data-account-profile');
    const details = profileDetails(activeMember);
    selectProfileFriend(!activeMember.self && activeMember.userId ? activeMember.userId : undefined);
    renderProfileCardDetails(profileCard, { ...details, editRoles: details.editRoles && !aboveAccount,
      switchAccount: aboveAccount && activeMember.self });
    if (!memberRow.isConnected) return;
    const anchor = memberRow.getBoundingClientRect();
    if (aboveAccount) profileCard.style.setProperty('--profile-max-height', `${Math.max(100, anchor.top - 22)}px`);
    else profileCard.style.removeProperty('--profile-max-height');
    const card = profileCard.getBoundingClientRect();
    const left = anchor.left - card.width - 10;
    const right = anchor.right + 10;
    const position = aboveAccount ? anchor.left
      : left >= 12 ? left : right + card.width <= window.innerWidth - 12 ? right : (window.innerWidth - card.width) / 2;
    profileCard.style.setProperty('--profile-left', `${position}px`);
    profileCard.style.setProperty('--profile-top', `${aboveAccount ? anchor.top - card.height - 10 : anchor.top}px`);
    profileCard.style.setProperty('--profile-height', `${card.height}px`);
  }

  window.addEventListener('resize', () => {
    if (profileCard.matches(':popover-open')) renderCard();
  }, { signal: memberLifetime.signal });

  profileCard.addEventListener('toggle', () => {
    if (profileCard.matches(':popover-open')) {
      renderCard();
      void refreshMembers();
    }
    else {
      selectProfileFriend();
      memberRow?.removeAttribute('aria-expanded');
      stopProfileEffect(profileCard);
      renderImage(cardBanner);
      cardAvatar.replaceChildren();
    }
  });

  function showSettings(initial: 'profile' | 'voice' = 'profile') {
    openSettings(app, account, saved => {
      Object.assign(account, saved);
      refreshProfile();
      if (server) drawMembers();
      if (activeMember?.self && profileCard.matches(':popover-open')) renderCard();
    }, exitAccount, voice.configure, voice.enableMicrophone, initial, () => !voiceCall.session?.deafened,
    profileDetails(members.find(member => member.self)), () => {
      const url = new URL(location.href);
      url.searchParams.delete('servidor');
      url.searchParams.delete('canal');
      history.replaceState(history.state, '', url);
      showAuth('login', '', 'Sua conta foi excluída.');
      app.querySelector<HTMLInputElement>('#email')?.focus();
    }, () => tutorial.open(true));
  }

  profileCard.querySelector('[data-edit-profile]')!.addEventListener('click', () => {
    profileCard.hidePopover();
    memberRow?.focus();
    showSettings();
  });
  profileCard.querySelector<HTMLButtonElement>('[data-card-switch-account]')!.addEventListener('click', async event => {
    const button = event.currentTarget as HTMLButtonElement;
    if (!activeMember?.self) return;
    button.disabled = true;
    if (!await exitAccount('switch')) {
      button.disabled = false;
      profileCard.hidePopover();
      note.textContent = 'Não foi possível encerrar a sessão. Confira sua conexão.';
    }
  });
  async function editMemberRoles(userId: number) {
    if (!server || !(server.permissions & MANAGE_ROLES)) return;
    try {
      const latest = await loadServer(server.id);
      if (!workspace.isConnected) return;
      const member = latest.members.find(candidate => candidate.userId === userId && candidate.id > 0);
      if (!(latest.permissions & MANAGE_ROLES) || !member) throw new Error();
      openServerDialog(workspace, 'member', async () => refreshMembers(), latest, 'members', member.id);
    } catch {
      if (workspace.isConnected) note.textContent = 'Não foi possível abrir os cargos desse membro.';
    }
  }

  profileCard.querySelector('[data-edit-member-roles]')!.addEventListener('click', () => {
    if (activeMember?.userId === undefined) return;
    profileCard.hidePopover();
    void editMemberRoles(activeMember.userId);
  });
  const accountProfile = workspace.querySelector<HTMLButtonElement>('[data-account-profile]')!;
  const openOwnProfile = () => {
    accountMenu.open = false;
    openUserProfile(undefined, account.name, accountProfile, true);
  };
  accountProfile.addEventListener('click', openOwnProfile);
  accountMenu.querySelector('[data-own-profile]')!.addEventListener('click', openOwnProfile);
  accountMenu.querySelector('[data-settings]')!.addEventListener('click', () => {
    accountMenu.open = false;
    accountMenu.querySelector<HTMLElement>('summary')!.focus();
    showSettings();
  });
  for (const button of accountMenu.querySelectorAll<HTMLButtonElement>('[data-action]')) {
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (!await exitAccount(button.dataset.action === 'switch' ? 'switch' : 'logout')) {
        button.disabled = false;
        note.textContent = 'Não foi possível encerrar a sessão. Confira sua conexão.';
      }
    });
  }

  refreshProfile();
  setMembers(!narrow.matches);
  if (selected) selectChannel(selected);
  else {
    title.textContent = serverName;
    workspace.querySelector('.chat-start h2')!.textContent = 'Nenhum canal de texto disponível';
    textChat.select(undefined, '');
    if (server) rememberWorkspace(server);
    note.textContent = '';
  }
  if (focus) title.focus();
  if (server) tutorial.open();
}

async function restoreSession() {
  const previous = app.firstElementChild;
  try {
    const account = await currentAccount();
    if (app.firstElementChild !== previous) return;
    if (account) {
      await openEntrance(account, false, () => app.firstElementChild === previous);
    }
    else {
      const invite = new URL(location.href).searchParams.get('convite');
      if (invite !== null) await openInvitation(invite, undefined, () => app.firstElementChild === previous);
      else showAuth();
    }
  } catch {
    if (app.firstElementChild === previous) {
      showAuth('login', '', 'Não foi possível consultar a sessão. Confira sua conexão.');
    }
  }
}

restoreSession();
window.addEventListener('storage', event => {
  if (!event.key || event.key === accountStorageKey) restoreSession();
});
window.addEventListener('pagehide', () => disposeWorkspace());
window.addEventListener('pageshow', event => {
  if (event.persisted) restoreSession();
});
