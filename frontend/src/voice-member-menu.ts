import type { VoiceMember } from './voice-session';
import { voicePunishmentDurations, type VoiceModeration, type VoicePunishmentDuration } from './voice-transport';
import { DEAFEN_VOICE, DISCONNECT_VOICE, MUTE_VOICE, PUNISH_VOICE } from './servers';

export type ListenerVolume = { volume: number; muted: boolean };

type MenuOptions = {
  member: VoiceMember;
  x: number;
  y: number;
  profile: () => void;
  editRoles?: () => void;
  audio?: ListenerVolume;
  selfAudio?: {
    muted: boolean; deafened: boolean; microphoneLocked: boolean; headphonesLocked: boolean;
    toggleMicrophone: () => void; toggleHeadphones: () => void;
  };
  checkAbsence?: () => Promise<void>;
  canCheckAbsence?: () => boolean;
  setAudio: (value: ListenerVolume) => void;
  destinations: { id: string; name: string }[];
  move: (id: string) => Promise<void>;
  permissions: number;
  moderate?: (action: VoiceModeration, enabled: boolean) => Promise<void>;
  punish?: (duration: VoicePunishmentDuration) => Promise<void>;
};

export function voiceMemberMenuActions(editRoles: boolean, absence?: boolean) {
  return `
    <button type="button" data-profile>Perfil</button>
    ${editRoles ? '<button type="button" data-voice-edit-roles>Editar cargos</button>' : ''}
    ${absence === undefined ? '' : `<button type="button" data-check-absence${absence ? '' : ' disabled'}>Verificar ausência</button>`}`;
}

export function openVoiceMemberMenu(host: HTMLElement, options: MenuOptions) {
  host.querySelector<HTMLElement>('.voice-member-menu:popover-open')?.hidePopover();
  const menu = document.createElement('div');
  menu.className = 'voice-member-menu';
  menu.popover = 'auto';
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', `Opções de ${options.member.name}`);
  const moderation = options.moderate ? [
    (options.permissions & MUTE_VOICE) && '<label>Silenciar voz no servidor <input type="checkbox" data-moderate="serverMuted"></label>',
    (options.permissions & DEAFEN_VOICE) && '<label>Desativar áudio no servidor <input type="checkbox" data-moderate="serverDeafened"></label>',
    (options.permissions & DISCONNECT_VOICE) && '<button type="button" data-disconnect>Desconectar</button>',
  ].filter(Boolean).join('') : '';
  const punish = options.punish;
  const punishment = punish && (options.permissions & PUNISH_VOICE) ? `
    <button type="button" data-punish aria-expanded="false" aria-controls="voice-punishment-durations">Castigar</button>
    <div id="voice-punishment-durations" hidden>
      ${voicePunishmentDurations.map(seconds => `<button type="button" data-duration="${seconds}">${seconds === 60 ? '1 minuto' : `${seconds} segundos`}</button>`).join('')}
    </div>` : '';
  menu.innerHTML = `
    ${voiceMemberMenuActions(Boolean(options.editRoles), options.checkAbsence ? options.canCheckAbsence?.() ?? true : undefined)}
    ${options.audio ? `<div class="voice-menu-section">
      <label class="voice-menu-volume">Volume do usuário <output></output><input class="volume-slider" type="range" min="0" max="100"></label>
      <label>Silenciar para mim <input type="checkbox" data-local-mute></label>
    </div>` : ''}
    ${options.selfAudio ? `<div class="voice-menu-section">
      <label>Silenciar microfone <input type="checkbox" data-self-mute></label>
      <label>Desativar meu áudio <input type="checkbox" data-self-deafen></label>
    </div>` : ''}
    ${options.destinations.length ? `<form class="voice-menu-section">
      <label for="voice-move-destination">Mover para</label>
      <div class="voice-menu-move"><select id="voice-move-destination" required><option value="">Escolha o canal</option></select>
      <button type="submit">Mover</button></div>
    </form>` : ''}
    ${moderation || punishment ? `<div class="voice-menu-section voice-menu-moderation">${moderation}${punishment}</div>` : ''}
    <p role="status"></p>`;

  const status = menu.querySelector('[role=status]')!;
  const margin = 8;
  function positionMenu() {
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(margin, Math.min(options.x, innerWidth - width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(options.y, innerHeight - height - margin))}px`;
  }
  let busy = false;
  async function perform(action: () => Promise<void>, onError?: () => void) {
    if (busy) return;
    busy = true;
    const controls = menu.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(':is(input, button, select):enabled');
    controls.forEach(control => { control.disabled = true; });
    try {
      await action();
      menu.hidePopover();
    } catch (error) {
      status.textContent = (error as Error).message;
      onError?.();
      if (menu.matches(':popover-open')) {
        positionMenu();
        menu.scrollTop = menu.scrollHeight;
      }
    } finally {
      busy = false;
      controls.forEach(control => { control.disabled = false; });
      refreshAbsence();
    }
  }

  menu.querySelector('[data-profile]')!.addEventListener('click', () => {
    menu.hidePopover();
    options.profile();
  });

  menu.querySelector('[data-voice-edit-roles]')?.addEventListener('click', () => {
    menu.hidePopover();
    options.editRoles?.();
  });

  const checkAbsence = options.checkAbsence;
  const absence = menu.querySelector<HTMLButtonElement>('[data-check-absence]');
  function refreshAbsence() {
    if (!absence || !menu.matches(':popover-open')) return;
    const available = options.canCheckAbsence?.() ?? true;
    absence.disabled = busy || !available;
    absence.title = available ? '' : 'Disponível para quem está na sua call com o microfone ou o áudio desativado.';
  }
  absence?.addEventListener('click', () => {
    refreshAbsence();
    if (checkAbsence && !absence.disabled) void perform(checkAbsence);
  });

  if (options.audio) {
    const range = menu.querySelector<HTMLInputElement>('[type=range]')!;
    const mute = menu.querySelector<HTMLInputElement>('[data-local-mute]')!;
    const value = menu.querySelector('output')!;
    range.value = String(options.audio.volume);
    mute.checked = options.audio.muted;
    const paint = () => {
      value.textContent = `${range.value}%`;
      range.style.setProperty('--volume-fraction', String(range.valueAsNumber / 100));
    };
    paint();
    const update = () => {
      paint();
      options.setAudio({ volume: Number(range.value), muted: mute.checked });
    };
    range.addEventListener('input', update);
    mute.addEventListener('change', update);
  }

  if (options.selfAudio) {
    const selfAudio = options.selfAudio;
    const mute = menu.querySelector<HTMLInputElement>('[data-self-mute]')!;
    const deafen = menu.querySelector<HTMLInputElement>('[data-self-deafen]')!;
    mute.checked = selfAudio.muted;
    mute.disabled = selfAudio.microphoneLocked;
    deafen.checked = selfAudio.deafened;
    deafen.disabled = selfAudio.headphonesLocked;
    mute.addEventListener('change', () => {
      selfAudio.toggleMicrophone();
      menu.hidePopover();
    });
    deafen.addEventListener('change', () => {
      selfAudio.toggleHeadphones();
      menu.hidePopover();
    });
  }

  const move = menu.querySelector('form');
  if (move) {
    const select = move.querySelector('select')!;
    select.append(...options.destinations.map(room => new Option(room.name, room.id)));
    move.addEventListener('submit', event => {
      event.preventDefault();
      if (select.value) void perform(() => options.move(select.value));
    });
  }

  const moderate = options.moderate;
  if (moderate) {
    for (const checkbox of menu.querySelectorAll<HTMLInputElement>('[data-moderate]')) {
      const action = checkbox.dataset.moderate as 'serverMuted' | 'serverDeafened';
      checkbox.checked = Boolean(options.member[action]);
      checkbox.addEventListener('change', () => void perform(
        () => moderate(action, checkbox.checked), () => { checkbox.checked = !checkbox.checked; },
      ));
    }
    menu.querySelector('[data-disconnect]')?.addEventListener('click', () => {
      void perform(() => moderate('disconnect', true));
    });
  }
  const punishmentButton = menu.querySelector<HTMLButtonElement>('[data-punish]');
  if (punishmentButton && punish) {
    const durations = menu.querySelector<HTMLElement>('#voice-punishment-durations')!;
    punishmentButton.addEventListener('click', () => {
      durations.hidden = !durations.hidden;
      punishmentButton.setAttribute('aria-expanded', String(!durations.hidden));
      positionMenu();
      if (!durations.hidden) durations.querySelector('button')?.focus();
    });
    for (const duration of voicePunishmentDurations) {
      durations.querySelector(`[data-duration="${duration}"]`)!.addEventListener('click', () => void perform(() => punish(duration)));
    }
  }

  menu.addEventListener('toggle', () => {
    if (!menu.matches(':popover-open')) menu.remove();
  });
  host.append(menu);
  menu.showPopover();
  positionMenu();
  menu.querySelector('button')!.focus({ preventScroll: true });
  refreshAbsence();
  return refreshAbsence;
}
