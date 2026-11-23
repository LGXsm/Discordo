import { friendsRequest, type FriendshipStatus } from './friends';
import { icon } from './icons';
import { inviteLink, type ServerMember } from './servers';

type Actions = {
  resolve(anchor: HTMLElement): ServerMember | undefined;
  profile(person: ServerMember, anchor: HTMLElement): void;
  conversation(user: number, call: boolean): Promise<void>;
  roles?: (user: number) => Promise<void>;
  refreshFriends(): Promise<void> | undefined;
};

export function mountProfileContextMenu(workspace: HTMLElement, signal: AbortSignal, actions: Actions) {
  const menu = document.createElement('div');
  menu.className = 'profile-context-menu';
  menu.popover = 'auto';
  menu.setAttribute('role', 'group');
  menu.innerHTML = `
    <div class="server-actions profile-menu-actions">
      <button type="button" data-profile-action="profile">${icon('profile')} Perfil</button>
      <button type="button" data-profile-action="message" hidden>${icon('chat')} Mensagem</button>
      <button type="button" data-profile-action="call" hidden>${icon('phone')} Iniciar chamada</button>
      <button type="button" data-profile-action="add" hidden></button>
      <button type="button" data-profile-action="invite" aria-expanded="false" aria-controls="profile-invite-options">
        ${icon('userPlus')} Convidar para o servidor ${icon('chevron')}
      </button>
      <button type="button" class="server-delete-action" data-profile-action="remove" hidden>${icon('close')} Desfazer amizade</button>
      <button type="button" data-profile-action="roles" hidden>${icon('settings')} Editar cargos</button>
    </div>
    <div class="server-actions profile-invite-options" id="profile-invite-options" role="group" aria-label="Servidores para convidar" hidden></div>`;
  const feedback = document.createElement('p');
  feedback.className = 'voice-activity-toast profile-menu-status';
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  workspace.append(menu, feedback);

  const button = (action: string) => menu.querySelector<HTMLButtonElement>(`[data-profile-action="${action}"]`)!;
  const friendButton = button('add');
  const inviteButton = button('invite');
  const submenu = menu.querySelector<HTMLElement>('.profile-invite-options')!;
  let current: { person: ServerMember; anchor: HTMLElement; x: number; y: number; status?: FriendshipStatus } | undefined;
  let eligible: AbortController | undefined;
  let relationship: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;

  function announce(message: string) {
    if (signal.aborted) return;
    clearTimeout(timer);
    feedback.hidden = false;
    feedback.textContent = message;
    timer = setTimeout(() => { feedback.hidden = true; }, 5200);
  }

  function report(error: unknown) {
    announce(error instanceof Error ? error.message : 'Não foi possível concluir a ação.');
  }

  function position() {
    if (!current || !menu.matches(':popover-open')) return;
    const leftEdge = Math.max(8, Math.min(current.x, innerWidth - menu.offsetWidth - 8));
    const fitsLeft = leftEdge - submenu.offsetWidth >= 8;
    const fitsRight = leftEdge + menu.offsetWidth + submenu.offsetWidth <= innerWidth - 8;
    const inline = !submenu.hidden && !fitsLeft && !fitsRight;
    menu.classList.toggle('profile-menu-inline', inline);
    menu.style.left = `${leftEdge}px`;
    menu.style.top = `${Math.max(8, Math.min(current.y, innerHeight - menu.offsetHeight - 8))}px`;
    if (submenu.hidden || inline) return;
    const bounds = menu.getBoundingClientRect();
    const row = inviteButton.getBoundingClientRect();
    const side = bounds.right + submenu.offsetWidth <= innerWidth - 8 ? bounds.right : bounds.left - submenu.offsetWidth;
    const left = Math.max(8, side);
    const top = Math.max(8, Math.min(row.top, innerHeight - submenu.offsetHeight - 8));
    submenu.style.left = `${left - bounds.left}px`;
    submenu.style.top = `${top - bounds.top}px`;
  }

  function closeSubmenu() {
    eligible?.abort();
    submenu.hidden = true;
    inviteButton.setAttribute('aria-expanded', 'false');
    position();
  }

  function closeMenu() {
    relationship?.abort();
    closeSubmenu();
    current = undefined;
    if (menu.matches(':popover-open')) menu.hidePopover();
  }

  async function openSubmenu(focus: boolean) {
    const user = current?.person.userId;
    if (!user || busy) return;
    if (!submenu.hidden) {
      if (focus) submenu.querySelector('button')?.focus();
      return;
    }
    eligible = new AbortController();
    const { signal: requestSignal } = eligible;
    submenu.hidden = false;
    inviteButton.setAttribute('aria-expanded', 'true');
    submenu.innerHTML = '<p role="status">Carregando servidores…</p>';
    position();
    try {
      const { servers } = await friendsRequest<{ servers: { id: number; name: string }[] }>(requestSignal, { inviteServers: String(user) });
      if (requestSignal.aborted) return;
      submenu.replaceChildren();
      for (const server of servers) {
        const option = document.createElement('button');
        option.type = 'button';
        option.textContent = server.name;
        option.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          closeMenu();
          try {
            const result = await friendsRequest<{ sent: boolean; token: string }>(signal, {}, { action: 'invite', user, server: server.id });
            if (result.sent) {
              announce(`Convite para ${server.name} enviado na conversa privada.`);
              await actions.refreshFriends();
              return;
            }
            if (!/^[a-f0-9]{48}$/.test(result.token)) throw new Error('Não foi possível preparar o link.');
            const link = inviteLink(result.token);
            try {
              await navigator.clipboard.writeText(link);
              announce(`Link de convite para ${server.name} copiado.`);
            } catch {
              if (!signal.aborted) window.prompt('Copie o link do convite para compartilhar.', link);
            }
          } catch (error) { report(error); }
          finally { busy = false; }
        });
        submenu.append(option);
      }
      if (!servers.length) submenu.innerHTML = '<p role="status">Nenhum servidor disponível para convidar.</p>';
      position();
      if (focus || document.activeElement === inviteButton) submenu.querySelector('button')?.focus();
    } catch (error) {
      if (requestSignal.aborted) return;
      const message = submenu.querySelector('p')!;
      message.textContent = error instanceof Error ? error.message : 'Não foi possível listar os servidores.';
      position();
    }
  }

  workspace.addEventListener('contextmenu', event => {
    const anchor = (event.target as Element).closest<HTMLElement>(
      '[data-member], [data-author-avatar], [data-author-name-button], [data-friend-id], [data-voice-profile-user]',
    );
    const person = anchor && actions.resolve(anchor);
    if (!anchor || !person) return;
    event.preventDefault();
    closeMenu();
    const bounds = anchor.getBoundingClientRect();
    current = { person, anchor, x: event.clientX || bounds.left, y: event.clientY || bounds.bottom };
    menu.setAttribute('aria-label', `Opções de ${person.name}`);
    for (const action of ['message', 'call', 'remove']) button(action).hidden = true;
    friendButton.hidden = true;
    inviteButton.hidden = Boolean(person.self || !person.userId);
    button('roles').hidden = !(actions.roles && person.id > 0 && person.userId);
    menu.showPopover({ source: anchor });
    position();
    button('profile').focus({ preventScroll: true });
    if (person.self || !person.userId) return;
    relationship = new AbortController();
    const { signal: requestSignal } = relationship;
    void friendsRequest<{ status: FriendshipStatus }>(requestSignal, { relationship: String(person.userId) })
      .then(({ status }) => {
        if (requestSignal.aborted || !current || !menu.matches(':popover-open')) return;
        current.status = status;
        if (status === 'friend') {
          for (const action of ['message', 'call', 'remove']) button(action).hidden = false;
        } else {
          friendButton.innerHTML = status === 'sent' ? `${icon('clock')} Pedido enviado`
            : status === 'received' ? `${icon('check')} Aceitar pedido de amizade`
              : `${icon('userPlus')} Adicionar amigo`;
          friendButton.disabled = status === 'sent';
          friendButton.hidden = false;
        }
        position();
      }).catch(() => { /* O perfil e os convites continuam acessíveis. */ });
  }, { signal, capture: true });

  inviteButton.addEventListener('pointerenter', () => void openSubmenu(false), { signal });
  inviteButton.addEventListener('click', () => void openSubmenu(true), { signal });
  for (const option of menu.querySelectorAll('[data-profile-action]:not([data-profile-action="invite"])')) {
    option.addEventListener('pointerenter', closeSubmenu, { signal });
  }
  menu.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' && event.target === inviteButton) {
      event.preventDefault();
      void openSubmenu(true);
    } else if (event.key === 'ArrowLeft' && submenu.contains(event.target as Node)) {
      event.preventDefault();
      closeSubmenu();
      inviteButton.focus();
    }
  }, { signal });
  menu.addEventListener('click', async event => {
    const action = (event.target as Element).closest<HTMLButtonElement>('[data-profile-action]')?.dataset.profileAction;
    if (!action || action === 'invite' || !current) return;
    const { person, anchor, status } = current;
    if (action === 'add' && (busy || (status !== null && status !== 'received'))) return;
    closeMenu();
    if (action === 'profile') return actions.profile(person, anchor);
    const user = person.userId;
    if (!user) return;
    try {
      if (action === 'roles') await actions.roles?.(user);
      else if (action === 'add') {
        busy = true;
        try {
          const accepting = status === 'received';
          const result = await friendsRequest<{ status?: FriendshipStatus }>(signal, {}, { action: accepting ? 'accept' : 'request', user });
          const nextStatus = result.status ?? (accepting ? 'friend' : 'sent');
          announce(nextStatus === 'friend' ? `Você e ${person.name} são amigos.`
            : nextStatus === 'received' ? `${person.name} já enviou um pedido para você.`
              : `Pedido de amizade enviado para ${person.name}.`);
          await actions.refreshFriends();
        } finally { busy = false; }
      } else if (action === 'remove') {
        if (busy || !window.confirm(`Remover a amizade com ${person.name} e apagar esta conversa?`)) return;
        busy = true;
        try {
          await friendsRequest(signal, {}, { action: 'remove', user });
          announce(`Amizade com ${person.name} desfeita.`);
          await actions.refreshFriends();
        } finally { busy = false; }
      } else await actions.conversation(user, action === 'call');
    } catch (error) { report(error); }
  }, { signal });
  menu.addEventListener('beforetoggle', event => {
    if (event.newState === 'closed') {
      relationship?.abort();
      closeSubmenu();
      current = undefined;
    }
  }, { signal });
  window.addEventListener('resize', closeMenu, { signal });
  signal.addEventListener('abort', () => {
    closeMenu();
    clearTimeout(timer);
    menu.remove();
    feedback.remove();
  }, { once: true });
}
