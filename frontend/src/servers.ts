import { icon } from './icons';
import { isThemeHex, mountThemeColors, solidColorControls } from './profile-theme-colors';
import { profileImageAccept, profileImageType } from './avatar';
import { dismissOnBackdrop } from './dialog-dismiss';
import type { ProfileAppearance } from './profile-appearance';
import { confirmSettingsExit } from './settings-confirm';
import type { AvatarCrop } from './avatar';

export const MANAGE_CHANNELS = 1;
export const MANAGE_ROLES = 2;
export const MOVE_VOICE = 4;
export const CREATE_ROLES = 8;
export const MUTE_VOICE = 16;
export const DEAFEN_VOICE = 32;
export const DISCONNECT_VOICE = 64;
export const PUNISH_VOICE = 128;
export const DELETE_MESSAGES = 256;
const permissionOptions = [
  [CREATE_ROLES, 'Criar cargos comuns'],
  [MANAGE_ROLES, 'Gerenciar cargos comuns e atribuí-los'],

  [MANAGE_CHANNELS, 'Gerenciar canais e categorias'],
  [DELETE_MESSAGES, 'Excluir mensagens de outras pessoas'],
  [MOVE_VOICE, 'Mover participantes entre canais de voz'],
  [DISCONNECT_VOICE, 'Desconectar participantes da chamada'],
  [PUNISH_VOICE, 'Castigar participantes da chamada'],

  [MUTE_VOICE, 'Silenciar voz no servidor'],
  [DEAFEN_VOICE, 'Desativar áudio no servidor'],
] as const;

export type ServerRole = { id: number; name: string; permissions: number; position?: number; color?: string | null };
type ReservedRoleTitle = 'Criador' | 'ADM';
type ReservedRole = { title: ReservedRoleTitle; color: string | null };
export type ServerMember = { id: number; userId?: number; name: string; self: boolean; title: string | null; titleColor?: string | null; roles: ServerRole[];
  avatarUrl?: string; avatarStillUrl?: string; avatarCrop?: AvatarCrop; bannerUrl?: string; appearance?: ProfileAppearance | null };
export type ServerChannel = { id: number; name: string; type: 'TEXTO' | 'VOZ'; private: boolean; topic?: string; roles?: number[];
  userLimit?: number | null; categoryId?: string | null; position?: number };
export type ChannelCategory = { id: string; name: string };
export type ServerSummary = { id: number; name: string; hasIcon: boolean; owner: boolean; lobby: boolean };
export type ServerDetail = Omit<ServerSummary, 'owner'> & {
  admin: boolean; permissions: number; categories?: ChannelCategory[]; reservedRoles?: ReservedRole[]; members: ServerMember[]; channels: ServerChannel[]; roles: ServerRole[];
};

const endpoint = new URL(`${import.meta.env.BASE_URL}servers.php`, document.baseURI);
export const serverIcon = (id: number) => `${endpoint}?icon=${id}`;
const escaped: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const safeText = (value: string) => value.replace(/[&<>"']/g, character => escaped[character]);

async function request<T>(url: URL, data?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, data ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Discordo-Request': 'servers' },
    body: JSON.stringify(data),
  } : { signal, cache: 'no-store' });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('O serviço de servidores está indisponível.');
  }
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error ?? 'Não foi possível acessar o servidor.'), { status: response.status });
  return result as T;
}

export async function listServers() {
  return (await request<{ servers: ServerSummary[] }>(endpoint)).servers;
}

export async function loadServer(id: number) {
  const url = new URL(endpoint);
  if (id) url.searchParams.set('server', String(id));
  else url.searchParams.set('entrance', '1');
  const server = await request<ServerDetail>(url);
  if ((id ? server.id !== id : !server.lobby) || !Array.isArray(server.channels) || !Array.isArray(server.members)) {
    throw new Error('O serviço retornou dados de outro servidor. Tente novamente.');
  }
  return server;
}

export async function loadMembers(server: number, signal: AbortSignal) {
  const url = new URL(endpoint);
  url.searchParams.set('members', String(server));
  return (await request<{ members: ServerMember[] }>(url, undefined, signal)).members;
}

type ServerChange = ({ action: 'create' | 'join'; server?: never }
  | { action: 'server' | 'deleteServer' | 'channel' | 'deleteChannel' | 'role' | 'deleteRole' | 'roleOrder' | 'memberRoles' | 'shareInvite' | 'reservedRoleColor' | 'category' | 'deleteCategory' | 'moveCategory' | 'moveChannel'; server: number })
  & Record<string, unknown>;

export async function changeServer(data: ServerChange) {
  const result = await request<{ id: number; token?: string }>(endpoint, data);
  if (!Number.isSafeInteger(result.id) || result.id < 1 || (data.server !== undefined && result.id !== data.server)) {
    throw new Error('O serviço não confirmou a alteração neste servidor. Reabra as configurações.');
  }
  return result;
}


export type InvitePreview = { id: number; name: string; hasIcon: boolean; member: boolean };

export function previewInvite(token: string) {
  const url = new URL(endpoint);
  url.searchParams.set('invite', token);
  return request<InvitePreview>(url);
}

export function inviteIcon(token: string) {
  const url = new URL(endpoint);
  url.searchParams.set('inviteIcon', token);
  return url.href;
}

export function acceptInvite(token: string) {
  return changeServer({ action: 'join', code: token });
}

export function inviteLink(token: string) {
  const url = new URL(import.meta.env.BASE_URL, document.baseURI);
  url.searchParams.set('convite', token);
  return url.href;
}

function mountServerInvites(panel: HTMLElement, server: number) {
  panel.innerHTML = `
    <div class="server-invite">
      <input aria-label="Link do convite" readonly placeholder="Preparando link…">
      <button type="button" class="primary-button" disabled>Copiar link</button>
    </div>
    <p class="settings-status server-invite-status" role="status"></p>`;
  const input = panel.querySelector('input')!;
  const copy = panel.querySelector('button')!;
  const status = panel.querySelector('[role=status]')!;
  async function prepare() {
    copy.disabled = true;
    status.textContent = '';
    try {
      const { token } = await changeServer({ action: 'shareInvite', server });
      if (!token || !/^[a-f0-9]{48}$/.test(token)) throw new Error('Não foi possível preparar o link.');
      input.value = inviteLink(token);
      copy.textContent = 'Copiar link';
    } catch (error) {
      input.placeholder = '';
      status.textContent = (error as Error).message;
      copy.textContent = 'Tentar novamente';
    } finally {
      copy.disabled = false;
    }
  }
  copy.addEventListener('click', async () => {
    if (!input.value) {
      await prepare();
      return;
    }
    try {
      await navigator.clipboard.writeText(input.value);
      status.textContent = 'Link copiado.';
    } catch {
      input.focus();
      input.select();
      status.textContent = 'Copie o link selecionado.';
    }
  });
  void prepare();
}

async function resizeIcon(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024 || !await profileImageType(file)) {
    throw new Error('Escolha uma imagem JPG, PNG, WebP ou GIF de até 8 MB.');
  }
  const image = await createImageBitmap(file).catch(() => { throw new Error('Não foi possível abrir essa imagem.'); });
  try {
    const size = Math.min(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    canvas.getContext('2d')!.drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 128, 128);
    return canvas.toDataURL('image/png');
  } finally {
    image.close();
  }
}

type Tab = 'profile' | 'channels' | 'roles' | 'members';
const tabs: { id: Tab; label: string }[] = [
  { id: 'profile', label: 'Perfil do servidor' }, { id: 'channels', label: 'Canais' },
  { id: 'roles', label: 'Cargos' }, { id: 'members', label: 'Membros' },
];
const submitButton = (label: string) => `<button type="submit" class="primary-button">${label}</button>`;
const nameInput = (label: string, value = '') => `<label>${label}<input name="name" required maxlength="60" value="${safeText(value)}"></label>`;
const fileInput = `<label>Imagem do servidor <input name="icon" type="file" accept="${profileImageAccept}"></label>`;
const roleChecks = (roles: ServerRole[], selected: number[]) => roles.length ? roles.map(role =>
  `<label class="server-check"><input type="checkbox" name="roles" value="${role.id}"${selected.includes(role.id) ? ' checked' : ''}> ${safeText(role.name)}</label>`).join('')
  : '<p>Crie um cargo na seção Cargos para poder selecioná-lo aqui.</p>';

function confirmChannelDeletion(channel: ServerChannel): Promise<boolean> {
  const prompt = document.createElement('dialog');
  prompt.className = 'settings-dialog settings-confirm';
  prompt.setAttribute('aria-labelledby', 'delete-channel-title');
  prompt.innerHTML = `
    <form method="dialog">
      <h2 id="delete-channel-title">Excluir canal?</h2>
      <p>O canal <strong>${safeText(channel.name)}</strong> será excluído permanentemente.
        ${channel.type === 'TEXTO' ? 'As mensagens, os anexos e as enquetes desse canal também serão apagados.' : 'Quem estiver na chamada será desconectado.'}</p>
      <div class="settings-footer">
        <button type="submit" class="settings-button" value="cancel" autofocus>Cancelar</button>
        <button type="submit" class="settings-button danger-button" value="delete">Excluir canal</button>
      </div>
    </form>`;
  dismissOnBackdrop(prompt);
  document.body.append(prompt);
  prompt.showModal();
  return new Promise(resolve => prompt.addEventListener('close', () => {
    const confirmed = prompt.returnValue === 'delete';
    prompt.remove();
    resolve(confirmed);
  }, { once: true }));
}

export function openServerDialog(
  host: HTMLElement,
  mode: 'create' | 'manage' | 'member' | 'edit-channel' | 'delete-server' | 'invite',
  onChange: (id: number, deletedChannel?: number) => Promise<void>,
  server?: ServerDetail,
  initial: Tab = 'profile',
  selectedId?: number,
  openProfile?: (member: ServerMember) => void,
  onRolesSaved?: (members: ServerMember[]) => void,
) {
  const editingChannel = mode === 'edit-channel' ? server?.channels.find(channel => channel.id === selectedId) : undefined;
  if (mode === 'edit-channel' && (!editingChannel || !((server?.permissions ?? 0) & MANAGE_CHANNELS))) return;
  if (mode === 'invite' && !server) return;
  if (mode === 'delete-server' && (!server?.admin || server.lobby)) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog server-dialog';
  if (mode === 'create') dialog.classList.add('server-create-dialog');
  if (mode === 'invite') dialog.classList.add('server-invite-dialog');
  if (editingChannel) dialog.classList.add('channel-editor-dialog');
  const heading = mode === 'create' ? 'Criar servidor'
    : mode === 'member' ? 'Editar cargos' : mode === 'edit-channel' ? 'Editar canal'
      : mode === 'delete-server' ? 'Excluir servidor' : mode === 'invite' ? 'Convidar pessoas' : 'Configurações do servidor';
  const availableTabs = tabs.filter(({ id }) => id === 'profile' ? server?.admin
    : id === 'channels' ? (server?.permissions ?? 0) & MANAGE_CHANNELS
      : (server?.permissions ?? 0) & (id === 'roles' ? MANAGE_ROLES | CREATE_ROLES : MANAGE_ROLES));
  dialog.setAttribute('aria-label', heading);
  dialog.innerHTML = `
    <header class="settings-header"><h2>${heading}</h2>
      <button class="icon-button" type="button" data-close aria-label="Fechar">${icon('close')}</button>
    </header>
    <div class="server-dialog-layout${mode === 'manage' ? ' with-navigation' : ''}">
      ${mode === 'manage' ? `<nav aria-label="Configurações do servidor">${availableTabs.map(({ id, label }) =>
        `<button type="button" data-tab="${id}">${label}</button>`).join('')}</nav>` : ''}
      <section class="server-form-panel"></section>
    </div>`;
  const panel = dialog.querySelector<HTMLElement>('.server-form-panel')!;
  let tab = mode === 'member' ? 'members' : mode === 'edit-channel' ? 'channels'
    : availableTabs.some(candidate => candidate.id === initial) ? initial : availableTabs[0]?.id ?? initial;
  let roleEditor: number | ReservedRoleTitle | 'new' | undefined;
  let busy = false;
  let leaving = false;
  let baseline = '';
  let updatedServer: number | undefined;
  let deletedChannel: number | undefined;

  const snapshot = (form: HTMLFormElement) => JSON.stringify([...new FormData(form)].map(([key, value]) =>
    [key, value instanceof File ? [value.name, value.size, value.name ? value.lastModified : 0] : value]));

  async function leaveSettings(proceed: () => void) {
    if (busy || leaving) return;
    leaving = true;
    try {
      const form = panel.querySelector('form');
      if (form && mode !== 'delete-server' && snapshot(form) !== baseline) {
        const choice = await confirmSettingsExit();
        if (choice === 'stay' || (choice === 'save' && (!form.reportValidity() || !await save(form)))) return;
      }
      if (dialog.open) proceed();
    } finally { leaving = false; }
  }

  function render(message = '') {
    for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
      button.setAttribute('aria-pressed', String(button.dataset.tab === tab));
    }
    if (mode === 'invite' && server) {
      mountServerInvites(panel, server.id);
      return;
    }
    let fields = '';
    if (mode === 'create') {
      fields = `<p>Seu espaço já começa com um canal de texto e um de voz.</p>
        ${nameInput('Nome do servidor')}${fileInput}${submitButton('Criar servidor')}`;
    } else if (mode === 'delete-server' && server) {
      fields = `<p>Excluir <strong>${safeText(server.name)}</strong> é permanente. Os canais, cargos e vínculos de membros serão excluídos.</p>
        <div class="server-form-actions">
          <button type="button" class="settings-button" data-cancel-delete autofocus>Cancelar</button>
          <button type="submit" class="settings-button server-delete-confirm">Excluir servidor</button>
        </div>`;
    } else if (server) {
      if (tab === 'profile') {
        fields = `${nameInput('Nome do servidor', server.name)}${fileInput}
          ${server.hasIcon ? '<label class="server-check"><input type="checkbox" name="removeIcon"> Remover imagem atual</label>' : ''}
          ${submitButton('Salvar servidor')}`;
      } else if (tab === 'channels') {
        const channel = editingChannel;
        const categoryOptions = `<label>Categoria<select name="category"><option value="">Sem categoria</option>${(server.categories ?? []).map(category =>
          `<option value="${safeText(category.id)}"${channel?.categoryId === category.id ? ' selected' : ''}>${safeText(category.name)}</option>`).join('')}</select></label>`;
        fields = `${nameInput('Nome do canal', channel?.name)}${server.categories ? categoryOptions : ''}
          ${channel ? `<p>Canal de ${channel.type === 'VOZ' ? 'voz' : 'texto'}</p>`
            : '<label>Tipo<select name="type"><option value="TEXTO">Texto</option><option value="VOZ">Voz</option></select></label>'}
          <div class="server-voice-limit" data-voice-limit${channel?.type === 'VOZ' ? '' : ' hidden'}>
            <label class="server-check"><input type="checkbox" name="limitEnabled"${channel?.userLimit ? ' checked' : ''}> Limitar participantes</label>
            <label data-limit-count${channel?.userLimit ? '' : ' hidden'}>Máximo de participantes
              <input type="number" name="userLimit" min="1" max="2147483647" step="1" value="${channel?.userLimit ?? ''}"
                ${channel?.userLimit ? 'required' : 'disabled'}>
            </label>
          </div>
          <label class="server-check"><input type="checkbox" name="private"${channel?.private ? ' checked' : ''}> Canal privado</label>
          <fieldset data-private${channel?.private ? '' : ' hidden'}><legend>Cargos com acesso</legend>
            <p>A administração também tem acesso.</p>${roleChecks(server.roles, channel?.roles ?? [])}</fieldset>
          ${channel ? `<div class="channel-editor-actions">
            ${submitButton('Salvar canal')}
            <button type="button" class="settings-button danger-button" data-delete-channel
              aria-label="Excluir canal" title="Excluir canal">${icon('trash')}</button>
          </div>` : submitButton('Criar canal')}`;
      } else if (tab === 'roles') {
        const canManage = Boolean(server.permissions & MANAGE_ROLES);
        const reservedRoles = server.reservedRoles ?? [];
        if (roleEditor === undefined) {
          const count = reservedRoles.length + server.roles.length;
          fields = `<div class="server-role-heading"><h3>Cargos <span>${count}</span></h3>
            <button type="button" class="primary-button" data-new-role>Criar cargo</button></div>
            ${server.admin && server.roles.length > 1 ? '<p>Os cargos mais altos na lista aparecem primeiro na aba de membros.</p>' : ''}
            ${count ? `<ul class="server-role-list">${reservedRoles.map(({ title }) => `
              <li><strong>${title}</strong><div class="server-role-actions">
                <button type="button" class="icon-button" data-edit-reserved-role="${title}"
                  aria-label="Configurar cor do cargo ${title}" title="Configurar cor do cargo ${title}">${icon('settings')}</button>
              </div></li>`).join('')}${server.roles.map((role, index, roles) => {
              const name = safeText(role.name);
              const orderControls = server!.admin && roles.length > 1 ? [-1, 1].map(direction => {
                const label = direction < 0 ? 'Subir' : 'Descer';
                return `<button type="button" class="icon-button" data-order-role="${role.id}" data-direction="${direction}"
                  aria-label="${label} cargo ${name}" title="${label} cargo ${name}"${roles[index + direction] ? '' : ' disabled'}>
                  <span aria-hidden="true">${direction < 0 ? '↑' : '↓'}</span></button>`;
              }).join('') : '';
              return `<li><strong>${name}</strong><div class="server-role-actions">${orderControls}
                ${canManage && (server!.admin || !role.permissions)
                  ? `<button type="button" class="icon-button" data-edit-role="${role.id}" aria-label="Configurar cargo ${name}" title="Configurar cargo ${name}">${icon('settings')}</button>`
                  : '<span class="server-role-lock" title="Sem permissão para editar" aria-label="Sem permissão para editar" role="img">' + icon('lock') + '</span>'}
              </div></li>`;
            }).join('')}</ul>` : '<p>O servidor ainda não tem cargos.</p>'}`;
        } else {
          const role = server.roles.find(candidate => candidate.id === roleEditor);
          const permissions = server.admin ? `<fieldset><legend>Permissões do cargo</legend>${permissionOptions.map(([bit, label]) =>
            `<label class="server-check"><input type="checkbox" name="permissions" value="${bit}"${(role?.permissions ?? 0) & bit ? ' checked' : ''}> ${label}</label>`).join('')}</fieldset>`
            : '<p>Os cargos que dão permissões são gerenciados pela administração.</p>';
          const reserved = reservedRoles.find(candidate => candidate.title === roleEditor);
          const initialColor = reserved?.color ?? role?.color;
          const color = isThemeHex(initialColor) ? initialColor.toUpperCase() : '';
          const palette = `<fieldset><legend>Cor do cargo</legend>
            <div class="role-color-modes">
              <label><input type="radio" name="colorMode" value="none"${color ? '' : ' checked'}> Sem cor</label>
              <label><input type="radio" name="colorMode" value="custom"${color ? ' checked' : ''}> Cor personalizada</label>
            </div>
            <input type="hidden" name="color" value="${color}">
            <div class="theme-color-picker" data-role-color-picker${color ? '' : ' hidden'}>${solidColorControls}</div>
          </fieldset>`;
          fields = `<div class="server-role-heading"><h3>${reserved?.title ?? (role ? 'Editar cargo' : 'Novo cargo')}</h3>
            <button type="button" class="settings-button" data-role-back>Voltar aos cargos</button></div>
            ${reserved ? '' : nameInput('Nome do cargo', role?.name)}${palette}${reserved ? '' : permissions}
            <div class="server-form-actions">${submitButton(reserved ? 'Salvar cor' : role ? 'Salvar cargo' : 'Criar cargo')}
            ${role ? '<button type="button" class="settings-button" data-delete-role>Excluir cargo</button>' : ''}</div>`;
        }
      } else {
        const eligible = server.members.filter(member => member.id > 0);
        const member = eligible.find(candidate => candidate.id === selectedId);
        const editable = server.roles.filter(role => server!.admin || !role.permissions);
        fields = mode === 'member' && member ? `<h3>${safeText(member.name)}</h3>
          <fieldset><legend>Cargos do membro</legend>${roleChecks(editable, member.roles.map(role => role.id))}</fieldset>
          <input type="hidden" name="member" value="${member.id}">${submitButton('Salvar cargos')}`
          : `<ul class="server-member-list">${eligible.map(person => `<li><div>${openProfile
            ? `<button class="profile-trigger profile-name-trigger" type="button" aria-haspopup="dialog" data-server-member-profile="${person.id}"><strong>${safeText(person.name)}</strong></button>`
            : `<strong>${safeText(person.name)}</strong>`}
            <small>${safeText([person.title, ...person.roles.map(role => role.name)].filter(Boolean).join(', ') || 'Sem cargos')}</small></div>
            <button class="settings-button" type="button" data-edit-member="${person.id}">Editar cargos</button></li>`).join('')}</ul>`;
      }
    }
    panel.innerHTML = `<form>${fields}<p class="settings-status" role="status"></p></form>`;
    const form = panel.querySelector('form')!;
    baseline = snapshot(form);
    const picker = form.querySelector<HTMLElement>('[data-role-color-picker]');
    if (picker) {
      const custom = form.querySelector<HTMLInputElement>('[name=colorMode][value=custom]')!;
      const color = form.querySelector<HTMLInputElement>('[name=color]')!;
      const updateColor = () => {
        picker.hidden = !custom.checked;
        color.value = custom.checked ? palette.value().primary : '';
      };
      const palette = mountThemeColors(picker, updateColor);
      palette.set(color.value ? { mode: 'solid', primary: color.value } : undefined);
      for (const mode of form.querySelectorAll('[name=colorMode]')) mode.addEventListener('change', updateColor);
    }
    const status = form.querySelector<HTMLElement>('[role=status]')!;
    status.textContent = message;
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-order-role]')) {
      button.addEventListener('click', () => void moveRole(button, status));
    }
    form.querySelector('[data-cancel-delete]')?.addEventListener('click', () => dialog.close());
    if (editingChannel) form.querySelector('[data-delete-channel]')?.addEventListener('click', async () => {
      if (busy || leaving) return;
      leaving = true;
      try {
        if (await confirmChannelDeletion(editingChannel)) await save(form, true);
      } finally {
        leaving = false;
      }
    });
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-server-member-profile]')) {
      button.addEventListener('click', () => {
        const member = server?.members.find(person => person.id === Number(button.dataset.serverMemberProfile));
        if (!member || !openProfile) return;
        void leaveSettings(() => {
          dialog.close();
          openProfile(member);
        });
      });
    }
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-edit-member]')) {
      button.addEventListener('click', () => {
        openServerDialog(host, 'member', async id => {
          updatedServer = id;
          try {
            server = await loadServer(id);
            render('Cargos atualizados.');
          } catch {
            status.textContent = 'Os cargos foram salvos. Reabra a janela para atualizar a lista.';
          }
        }, server, 'members', Number(button.dataset.editMember));
      });
    }
    for (const button of form.querySelectorAll<HTMLButtonElement>('[data-new-role], [data-edit-role], [data-edit-reserved-role]')) {
      button.addEventListener('click', () => {
        const reserved = server?.reservedRoles?.find(role => role.title === button.dataset.editReservedRole);
        roleEditor = reserved?.title ?? (button.dataset.editRole ? Number(button.dataset.editRole) : 'new');
        render();
        panel.querySelector<HTMLInputElement>('[name=name], [name=colorMode]:checked')?.focus();
      });
    }
    form.querySelector('[data-role-back]')?.addEventListener('click', () => void leaveSettings(() => showRoles()));
    form.querySelector<HTMLInputElement>('[name=private]')?.addEventListener('change', event => {
      form.querySelector<HTMLElement>('[data-private]')!.hidden = !(event.target as HTMLInputElement).checked;
    });
    const voiceLimit = form.querySelector<HTMLElement>('[data-voice-limit]');
    if (voiceLimit) {
      const type = form.querySelector<HTMLSelectElement>('[name=type]');
      const enabled = voiceLimit.querySelector<HTMLInputElement>('[name=limitEnabled]')!;
      const count = voiceLimit.querySelector<HTMLInputElement>('[name=userLimit]')!;
      const refreshLimit = () => {
        voiceLimit.hidden = (editingChannel?.type ?? type?.value) !== 'VOZ';
        enabled.disabled = voiceLimit.hidden;
        count.disabled = voiceLimit.hidden || !enabled.checked;
        count.required = !count.disabled;
        count.closest('label')!.hidden = count.disabled;
      };
      type?.addEventListener('change', refreshLimit);
      enabled.addEventListener('change', refreshLimit);
      refreshLimit();
      baseline = snapshot(form);
    }
    form.querySelector('[data-delete-role]')?.addEventListener('click', () => {
      if (confirm('Excluir este cargo e remover seus vínculos com membros e canais?')) {
        void save(form, true);
      }
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      void save(form);
    });
  }

  async function moveRole(button: HTMLButtonElement, status: HTMLElement) {
    if (busy || !server?.admin) return;
    const previous = server.roles.map(role => role.id);
    const role = Number(button.dataset.orderRole);
    const index = previous.indexOf(role);
    const next = index + Number(button.dataset.direction);
    if (index < 0 || !previous[next]) return;
    const order = [...previous];
    [order[index], order[next]] = [order[next], order[index]];
    busy = true;
    status.textContent = 'Salvando a ordem…';
    try {
      const result = await changeServer({ action: 'roleOrder', server: server.id, previous, order });
      updatedServer = result.id;
      const byId = new Map(server.roles.map(item => [item.id, item]));
      server.roles = order.map((id, position) => ({ ...byId.get(id)!, position }));
      render('Ordem dos cargos salva.');
      const selector = `[data-order-role="${role}"]`;
      (panel.querySelector<HTMLButtonElement>(`${selector}[data-direction="${button.dataset.direction}"]:enabled`)
        ?? panel.querySelector<HTMLButtonElement>(`${selector}:enabled`))?.focus();
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Não foi possível salvar a ordem.';
    } finally {
      busy = false;
    }
  }

  function showRoles(message = '') {
    const focus = typeof roleEditor === 'number' ? `[data-edit-role="${roleEditor}"]`
      : roleEditor === 'Criador' || roleEditor === 'ADM' ? `[data-edit-reserved-role="${roleEditor}"]` : '[data-new-role]';
    roleEditor = undefined;
    render(message);
    (panel.querySelector<HTMLButtonElement>(focus) ?? panel.querySelector<HTMLButtonElement>('[data-new-role]'))?.focus();
  }

  async function save(form: HTMLFormElement, deleting = false) {
    if (busy || (tab === 'roles' && roleEditor === undefined)) return false;
    const submitting = snapshot(form);
    const data = new FormData(form);
    const controls = [...dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')]
      .filter(control => !control.disabled);
    const status = form.querySelector<HTMLElement>('[role=status]')!;
    busy = true;
    for (const control of controls) control.disabled = true;
    status.textContent = mode === 'delete-server' ? 'Excluindo servidor…'
      : deleting && editingChannel ? 'Excluindo canal…' : 'Salvando…';
    try {
      const name = String(data.get('name') ?? '').trim();
      const roles = data.getAll('roles').map(Number);
      let payload: ServerChange;
      if (mode === 'create' || tab === 'profile' && mode === 'manage') {
        const file = data.get('icon');
        const image = file instanceof File && file.size ? await resizeIcon(file) : data.has('removeIcon') ? null : undefined;
        payload = mode === 'create' ? { action: 'create', name, image }
          : { action: 'server', server: server!.id, name, image };
      } else if (mode === 'delete-server') {
        payload = { action: 'deleteServer', server: server!.id, name: server!.name };
      } else if (deleting && editingChannel) {
        payload = { action: 'deleteChannel', server: server!.id, channel: editingChannel.id, name: editingChannel.name };
      } else if (tab === 'channels') {
        payload = { action: 'channel', server: server!.id, channel: editingChannel?.id,
          name, type: data.get('type'), private: data.has('private'), roles,
          ...(server!.categories ? { category: data.get('category') || null } : {}),
          userLimit: data.has('limitEnabled') ? Number(data.get('userLimit')) : null };
      } else if (tab === 'roles') {
        const color = data.get('color') || null;
        if (roleEditor === 'Criador' || roleEditor === 'ADM') {
          payload = { action: 'reservedRoleColor', server: server!.id, title: roleEditor, color };
        } else {
          payload = { action: deleting ? 'deleteRole' : 'role', server: server!.id,
            role: typeof roleEditor === 'number' ? roleEditor : undefined, name, color,
            permissions: data.getAll('permissions').reduce((bits, value) => bits | Number(value), 0) };
        }
      } else {
        payload = { action: 'memberRoles', server: server!.id, member: Number(data.get('member')), roles };
      }
      const result = await changeServer(payload);
      baseline = submitting;
      updatedServer = result.id;
      if (payload.action === 'deleteChannel') deletedChannel = editingChannel?.id;
      if (mode !== 'manage') {
        dialog.close();
      } else {
        try {
          server = await loadServer(result.id);
          if (tab === 'roles') {
            onRolesSaved?.(server.members);
            showRoles(deleting ? 'Cargo excluído.' : 'Cargo salvo.');
          } else {
            render('Alterações salvas.');
            panel.querySelector<HTMLInputElement>('[name=name]')?.focus();
          }
        } catch {
          status.textContent = 'As alterações foram salvas. Feche a janela para atualizar o servidor.';
        }
      }
      return true;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Não foi possível salvar.';
      return false;
    } finally {
      busy = false;
      for (const control of controls) control.disabled = false;
    }
  }

  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    button.addEventListener('click', () => {
      if (button.dataset.tab === tab) return;
      void leaveSettings(() => {
        tab = button.dataset.tab as Tab;
        roleEditor = undefined;
        render();
      });
    });
  }
  const close = () => void leaveSettings(() => dialog.close());
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dismissOnBackdrop(dialog, undefined, close);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (updatedServer !== undefined) void onChange(updatedServer, deletedChannel);
  });
  render();
  host.append(dialog);
  dialog.showModal();
}
