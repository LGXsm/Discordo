import { icon } from './icons';
import { changeServer, MANAGE_CHANNELS, safeText, type ServerDetail, type ServerChannel, type ChannelCategory } from './servers';
import { dismissOnBackdrop } from './dialog-dismiss';

type Group = { category: ChannelCategory | null; channels: ServerChannel[] };
export function channelGroups(server: ServerDetail): Group[] {
  const categories = server.categories ?? [{ id: 'default-text', name: 'Canais de texto' }, { id: 'default-voice', name: 'Canais de voz' }];
  const channels = server.channels.map(channel => ({ ...channel, categoryId: server.categories ? channel.categoryId ?? null
    : channel.type === 'TEXTO' ? 'default-text' : 'default-voice' }));
  const order = (items: ServerChannel[]) => items.sort((a, b) => (a.position ?? a.id) - (b.position ?? b.id));
  return [{ category: null, channels: order(channels.filter(c => !c.categoryId || !categories.some(category => category.id === c.categoryId))) },
    ...categories.map(category => ({ category, channels: order(channels.filter(c => c.categoryId === category.id)) }))];
}

export function channelCategoriesMarkup(server: ServerDetail | undefined, render: (channel: ServerChannel) => string, demo: string) {
  if (!server) return '<p class="channel-empty">Entre em um servidor para ver os canais.</p>';
  const manage = Boolean(server.permissions & MANAGE_CHANNELS);
  const groups = channelGroups(server);
  const sections = groups.filter(group => (group.category || group.channels.length) && (manage || group.channels.length)).map(({ category, channels }) => {
    const id = category?.id ?? '';
    const index = groups.findIndex(group => group.category?.id === id);
    return `<section class="channel-category" data-channel-category="${safeText(id)}">
      ${category ? `<div class="channel-category-heading"${manage ? ` draggable="true" data-category-drag="${safeText(id)}"` : ''}>
        <h2><button type="button" data-collapse-category="${safeText(id)}" aria-expanded="true">${icon('chevron')}<span>${safeText(category.name)}</span></button></h2>
        ${manage ? `<div class="channel-category-tools">
          <button type="button" class="icon-button" data-category-direction="-1" aria-label="Mover categoria ${safeText(category.name)} para cima"${index <= 1 ? ' disabled' : ''}>↑</button>
          <button type="button" class="icon-button" data-category-direction="1" aria-label="Mover categoria ${safeText(category.name)} para baixo"${index === groups.length - 1 ? ' disabled' : ''}>↓</button>
        </div>` : ''}
      </div>` : manage || channels.length ? '<h2 class="uncategorized-title">Sem categoria</h2>' : ''}
      <div class="channel-category-items" data-category-items="${safeText(id)}">
        ${channels.map(channel => `<div data-channel-item="${channel.id}"${manage ? ' draggable="true"' : ''}>${render(channel)}</div>`).join('')}
        ${manage && !channels.length ? '<p class="channel-category-empty">Arraste um canal para cá</p>' : ''}
      </div>
    </section>`;
  }).join('');
  return sections + demo + '<p class="channel-layout-status" role="status"></p>';
}

export function mountChannelCategories(workspace: HTMLElement, server: ServerDetail | undefined, email: string, refresh: (id: number) => Promise<unknown>) {
  if (!server) return;
  const list = workspace.querySelector<HTMLElement>('.channel-list')!;
  const manage = Boolean(server.permissions & MANAGE_CHANNELS);
  const groups = channelGroups(server);
  const lifetime = new AbortController();
  let busy = false;
  const status = list.querySelector<HTMLElement>('.channel-layout-status')!;
  const collapseKey = `discordo:categories:${email}:${server.id}`;
  let collapsed = new Set<string>();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(collapseKey) ?? '[]');
    if (Array.isArray(saved)) collapsed = new Set(saved.filter((id): id is string => typeof id === 'string'));
  } catch { /* Collapse is optional. */ }
  function paintCollapsed() {
    for (const button of list.querySelectorAll<HTMLButtonElement>('[data-collapse-category]')) {
      const closed = collapsed.has(button.dataset.collapseCategory!);
      button.setAttribute('aria-expanded', String(!closed));
      const items = button.closest('.channel-category')!.querySelector<HTMLElement>('[data-category-items]')!;
      items.hidden = closed;
    }
  }
  paintCollapsed();
  async function change(action: 'moveChannel' | 'moveCategory', data: Record<string, unknown>) {
    if (!manage || busy) return;
    busy = true;
    status.textContent = 'Salvando organização…';
    list.setAttribute('aria-busy', 'true');
    try {
      await changeServer({ action, server: server!.id, ...data });
      await refresh(server!.id);
    } catch (error) {
      if (!lifetime.signal.aborted) status.textContent = error instanceof Error ? error.message : 'Não foi possível organizar os canais.';
    } finally { busy = false; list.removeAttribute('aria-busy'); }
  }
  function editCategory(category?: ChannelCategory) {
    if (!manage || busy) return;
    const dialog = document.createElement('dialog');
    dialog.className = 'settings-dialog category-editor-dialog';
    dialog.setAttribute('aria-labelledby', 'category-editor-title');
    dialog.innerHTML = `<header class="settings-header"><h2 id="category-editor-title">${category ? 'Editar' : 'Criar'} categoria</h2><button type="button" class="icon-button" data-close aria-label="Fechar">${icon('close')}</button></header>
      <form class="server-form-panel"><label>Nome da categoria<input name="name" maxlength="60" required autocomplete="off" value="${safeText(category?.name ?? '')}" autofocus></label>
      <p class="settings-hint">Reúna canais de texto e voz como preferir. As permissões de cada canal continuam valendo.</p>
      <div class="server-form-actions"><button class="primary-button" type="submit">${category ? 'Salvar' : 'Criar'} categoria</button>
      ${category ? `<button type="button" class="settings-button danger-button" data-delete-category>${icon('trash')} Excluir categoria</button>` : ''}</div>
      <p role="status"></p></form>`;
    let saving = false;
    let deleting = false;
    function close() { if (!saving) dialog.close(); }
    dialog.querySelector('[data-close]')!.addEventListener('click', close);
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dismissOnBackdrop(dialog, () => !saving);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    const form = dialog.querySelector('form')!;
    const notice = form.querySelector('[role=status]')!;
    dialog.querySelector('[data-delete-category]')?.addEventListener('click', () => {
      deleting = true;
      notice.textContent = 'Os canais serão mantidos em Sem categoria. Confirme para excluir somente a categoria.';
      form.querySelector('input')!.required = false;
      form.querySelector('[type=submit]')!.textContent = 'Confirmar exclusão da categoria';
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      for (const button of dialog.querySelectorAll<HTMLButtonElement>('button')) button.disabled = true;
      try {
        await changeServer({ action: deleting ? 'deleteCategory' : 'category', server: server!.id,
          ...(category ? { category: category.id } : {}), name: new FormData(form).get('name') });
        dialog.close();
        await refresh(server!.id);
      } catch (error) {
        notice.textContent = error instanceof Error ? error.message : 'Não foi possível salvar a categoria.';
      } finally { saving = false; for (const button of dialog.querySelectorAll<HTMLButtonElement>('button')) button.disabled = false; }
    });
    workspace.append(dialog);
    dialog.showModal();
  }
  const menu = manage ? document.createElement('div') : undefined;
  if (menu) {
    const signal = lifetime.signal;
    menu.className = 'server-actions server-context-menu category-context-menu';
    menu.popover = 'auto';
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', 'Opções da categoria');
    menu.innerHTML = `<button type="button" data-edit-category>${icon('settings')} Editar categoria</button>`;
    const edit = menu.querySelector('button')!;
    let selected: ChannelCategory | undefined;
    const dismiss = () => { if (menu.matches(':popover-open')) menu.hidePopover(); };
    workspace.append(menu);
    list.addEventListener('contextmenu', event => {
      const anchor = (event.target as Element).closest<HTMLButtonElement>('[data-collapse-category]');
      if (!anchor) return;
      selected = groups.find(group => group.category?.id === anchor.dataset.collapseCategory)?.category ?? undefined;
      if (!selected) return;
      event.preventDefault();
      if (busy) return;
      dismiss();
      menu.showPopover({ source: anchor });
      const bounds = anchor.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(bounds.right + 8, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(bounds.top, innerHeight - menu.offsetHeight - 8))}px`;
      edit.focus({ preventScroll: true });
    }, { signal });
    edit.addEventListener('click', () => {
      const category = selected;
      dismiss();
      if (category) editCategory(category);
    }, { signal });
    menu.addEventListener('toggle', () => {
      if (!menu.matches(':popover-open')) selected = undefined;
    }, { signal });
    list.addEventListener('scroll', dismiss, { signal });
    window.addEventListener('resize', dismiss, { signal });
    signal.addEventListener('abort', () => menu.remove(), { once: true });
  }
  workspace.querySelector('[data-create-category]')?.addEventListener('click', () => editCategory(), { signal: lifetime.signal });
  list.addEventListener('click', event => {
    const target = event.target as Element;
    const toggle = target.closest<HTMLButtonElement>('[data-collapse-category]');
    if (toggle) {
      const id = toggle.dataset.collapseCategory!;
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      paintCollapsed();
      try { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); } catch { /* Keep the state in this view. */ }
    }
    if (!manage) return;
    const categoryMove = target.closest<HTMLElement>('[data-category-direction]');
    if (categoryMove) {
      const id = categoryMove.closest<HTMLElement>('[data-channel-category]')!.dataset.channelCategory!;
      const categories = groups.flatMap(group => group.category ? [group.category] : []);
      const index = categories.findIndex(category => category.id === id);
      const direction = Number(categoryMove.dataset.categoryDirection);
      void change('moveCategory', { category: id, before: direction < 0 ? categories[index - 1]?.id : categories[index + 2]?.id ?? null });
    }
  }, { signal: lifetime.signal });
  let dragged: { kind: 'channel' | 'category'; id: string } | undefined;
  function clearDrop() {
    list.querySelectorAll('[data-channel-insertion]').forEach(node => node.removeAttribute('data-channel-insertion'));
  }
  function dropDestination(event: DragEvent, moving: { kind: 'channel' | 'category'; id: string }) {
    const section = (event.target as Element).closest<HTMLElement>('[data-channel-category]');
    if (!section) return;
    const category = section.dataset.channelCategory || null;
    if (moving.kind === 'category') {
      if (!category) return;
      const heading = section.querySelector('.channel-category-heading')!.getBoundingClientRect();
      const below = event.clientY > heading.top + heading.height / 2;
      const next = section.nextElementSibling as HTMLElement | null;
      return { anchor: section, edge: below ? 'after' : 'before', action: 'moveCategory' as const,
        data: { category: moving.id, before: below ? next?.dataset.channelCategory || null : category } };
    }
    const item = (event.target as Element).closest<HTMLElement>('[data-channel-item]');
    const below = item && event.clientY > item.getBoundingClientRect().top + item.getBoundingClientRect().height / 2;
    const next = below ? item.nextElementSibling as HTMLElement | null : item;
    const items = section.querySelector<HTMLElement>('[data-category-items]')!;
    const anchor = item ?? (items.hidden ? section.querySelector<HTMLElement>('.channel-category-heading')! : items);
    return { anchor, edge: item && !below ? 'before' : 'after', action: 'moveChannel' as const,
      data: { channel: Number(moving.id), category, before: next?.dataset.channelItem ? Number(next.dataset.channelItem) : null } };
  }
  list.addEventListener('dragstart', event => {
    if (!manage || busy || (event.target as Element).closest('.voice-channel-members')) return;
    const category = (event.target as Element).closest<HTMLElement>('[data-category-drag]');
    const channel = (event.target as Element).closest<HTMLElement>('[data-channel-item]');
    if (!category && !channel) return;
    dragged = category ? { kind: 'category', id: category.dataset.categoryDrag! } : { kind: 'channel', id: channel!.dataset.channelItem! };
    event.dataTransfer?.setData('application/x-discordo-channel', dragged.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
  }, { signal: lifetime.signal });
  list.addEventListener('dragover', event => {
    if (!dragged) return;
    clearDrop();
    const destination = dropDestination(event, dragged);
    if (!destination) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    destination.anchor.setAttribute('data-channel-insertion', destination.edge);
  }, { signal: lifetime.signal });
  list.addEventListener('dragleave', event => {
    if (!(event.relatedTarget instanceof Node) || !list.contains(event.relatedTarget)) clearDrop();
  }, { signal: lifetime.signal });
  list.addEventListener('drop', event => {
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    const destination = dropDestination(event, dragged);
    dragged = undefined;
    clearDrop();
    if (destination) void change(destination.action, destination.data);
  }, { signal: lifetime.signal });
  list.addEventListener('dragend', () => { dragged = undefined; clearDrop(); }, { signal: lifetime.signal });
  return () => lifetime.abort();
}
