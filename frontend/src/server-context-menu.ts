import { icon } from './icons';
import { CREATE_ROLES, loadServer, MANAGE_CHANNELS, MANAGE_ROLES, type ServerDetail } from './servers';

export function mountServerContextMenu(workspace: HTMLElement, current: ServerDetail | undefined,
  openAction: (id: number, action: string) => void) {
  const rail = workspace.querySelector('.server-rail')!;
  const lifetime = new AbortController();
  const menu = document.createElement('div');
  menu.className = 'server-actions server-context-menu';
  menu.popover = 'auto';
  menu.setAttribute('role', 'group');
  const signal = lifetime.signal;
  workspace.append(menu);
  let revision = 0;

  async function show(button: HTMLElement) {
    const ticket = ++revision;
    const id = Number(button.dataset.server ?? 0);
    const bounds = button.getBoundingClientRect();
    menu.setAttribute('aria-label', button.getAttribute('aria-label') ?? 'Opções do servidor');
    menu.innerHTML = '<p role="status">Carregando opções…</p>';
    workspace.querySelector<HTMLElement>('.server-name-tooltip:popover-open')?.hidePopover();
    if (!menu.matches(':popover-open')) menu.showPopover({ source: button });
    function position() {
      menu.style.left = `${Math.max(8, Math.min(bounds.right + 8, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(bounds.top, innerHeight - menu.offsetHeight - 8))}px`;
    }
    position();
    try {
      const server = current && (id === current.id || (id === 0 && current.lobby)) ? current : await loadServer(id);
      if (ticket !== revision || signal.aborted || !menu.matches(':popover-open')) return;
      const permissions = server.permissions;
      menu.innerHTML = `
        ${permissions & (MANAGE_CHANNELS | MANAGE_ROLES | CREATE_ROLES) ? `<button type="button" data-action="server-settings">${icon('settings')} Configurações do servidor</button>` : ''}
        ${permissions & MANAGE_CHANNELS ? `<button type="button" data-action="create-channel">${icon('plus')} Criar canal</button>
          <button type="button" data-action="create-category">${icon('plus')} Criar categoria</button>` : ''}
        <button type="button" data-action="open-invites">${icon('userPlus')} Convites</button>
        ${server.admin && !server.lobby ? `<button type="button" class="server-delete-action" data-action="delete-server">${icon('trash')} Excluir servidor</button>` : ''}`;
      position();
      for (const item of menu.querySelectorAll<HTMLButtonElement>('[data-action]')) {
        item.addEventListener('click', () => {
          menu.hidePopover();
          openAction(id, item.dataset.action!);
        });
      }
      menu.querySelector('button')?.focus({ preventScroll: true });
    } catch {
      if (ticket !== revision || signal.aborted || !menu.matches(':popover-open')) return;
      menu.innerHTML = '<p role="status">Não foi possível carregar as opções.</p>';
      position();
    }
  }

  rail.addEventListener('contextmenu', event => {
    const button = (event.target as Element).closest<HTMLElement>('[data-server], [data-lobby]');
    if (!button) return;
    event.preventDefault();
    void show(button);
  }, { signal });
  window.addEventListener('resize', () => { if (menu.matches(':popover-open')) menu.hidePopover(); }, { signal });
  rail.addEventListener('scroll', () => { if (menu.matches(':popover-open')) menu.hidePopover(); }, { signal });
  return () => { lifetime.abort(); menu.remove(); };
}
