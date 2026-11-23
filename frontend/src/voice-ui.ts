import { createVoiceActivityMeter } from './voice-activity';
import channels from '../../shared/voice-channels.json';
import { icon } from './icons';
import { VoiceSession, type VoiceMember, type VoiceActivity } from './voice-session';
import { playRoomSound, prepareRoomSounds, stopRoomSound, type RoomSound } from './sounds';
import { mountQuickVoiceSettings } from './voice-quick-settings';
import { saveVoicePreferences, type VoicePreferences } from './voice-preferences';
import { renderAvatar } from './avatar';
import { checkVoiceAbsence, moderateVoiceMember, moveVoiceMember, punishVoiceMember, readVoicePresence } from './voice-transport';
import { mountScreenPlayback } from './screen-playback';
import { openVoiceMemberMenu, type ListenerVolume } from './voice-member-menu';
import type { Profile } from './accounts';
import { listenForVoiceShortcuts } from './shortcuts';
import { createVoiceModerationAlert, remainingPunishmentSeconds } from './voice-moderation-alert';
import { isDemoRoom, type DemoBot } from './voice-demo';

export const voiceChannels = channels;
type Channel = (typeof channels)[number];

const cameraIcon = icon('camera');
const screenIcon = icon('screen');

const screenTile = `
  <article class="voice-screen-tile" data-screen-tile>
    <div class="voice-screen-controls">
      <strong data-feed-name></strong>
      <span data-feed-kind></span>
    </div>
    <div class="voice-feed-actions">
    <div class="voice-screen-volume-menu" data-screen-volume-controls hidden>
      <button type="button" class="icon-button" data-screen-sound aria-label="Silenciar áudio da transmissão">${icon('voice')}</button>
      <div class="voice-screen-volume">
        <input class="volume-slider" type="range" min="0" max="100" value="100" data-screen-volume aria-label="Volume da transmissão">
      </div>
    </div>
    <button class="icon-button" type="button" data-feed-fullscreen aria-label="Tela cheia" title="Tela cheia" hidden>${icon('expand')}</button>
    </div>
    <video muted playsinline hidden></video>
    <button class="voice-feed-select" type="button" data-feed-select hidden><span hidden>Assistir</span></button>
    <button class="icon-button voice-panel-handle voice-feed-close" type="button" data-feed-close hidden>${icon('close')}</button>
    <audio hidden></audio>
    <div class="voice-screen-status" data-screen-status hidden>
      <p role="status"></p>
      <button class="settings-button" type="button" hidden>${icon('screen')} Reproduzir transmissão</button>
    </div>
  </article>`;

export const voiceStageMarkup = `
  <section class="voice-stage" id="voice-stage" aria-label="Câmeras e telas" hidden>
    <div class="voice-stage-header">
      <button class="icon-button mobile-menu" type="button" data-stage-menu aria-label="Canais e conta" aria-controls="channel-panel" aria-expanded="false">${icon('menu')}</button>
      <strong>Transmissões</strong>
      <button class="settings-button" type="button" data-edit-demo aria-expanded="false" aria-controls="voice-demo-editor" hidden>Editar bots</button>
      <button class="icon-button" type="button" data-stream-close aria-label="Fechar visualização da transmissão">${icon('close')}</button>
    </div>
    <div class="voice-stage-content">
      <div class="voice-main-feed" aria-label="Transmissão em destaque" tabindex="-1">
        <div class="voice-panel-controls voice-camera-controls">
          <button class="icon-button voice-panel-handle" type="button" data-toggle-cameras aria-controls="voice-camera-previews" aria-expanded="true" hidden>${icon('chevron')}</button>
          <button class="icon-button voice-panel-handle" type="button" data-maximize-cameras aria-label="Maximizar câmeras" aria-pressed="false" hidden>${icon('chevron')}</button>
        </div>
        <div class="voice-panel-controls voice-preview-controls">
          <button class="icon-button voice-panel-handle" type="button" data-toggle-previews aria-controls="voice-video-previews" aria-expanded="true" hidden>${icon('chevron')}</button>
          <button class="icon-button voice-panel-handle" type="button" data-maximize-screens aria-label="Maximizar telas" aria-pressed="false" hidden>${icon('chevron')}</button>
        </div>
        <div class="voice-feed-gallery" hidden></div>
      </div>
      <div class="voice-camera-panel" hidden>
        <div class="voice-camera-previews" id="voice-camera-previews" aria-label="Câmeras" hidden></div>
      </div>
      <div class="voice-video-previews" id="voice-video-previews" aria-label="Outras transmissões" hidden></div>
    </div>
    <section class="voice-demo-editor" id="voice-demo-editor" aria-label="Editar bots de teste" hidden>
      <div data-demo-bots></div>
      <button class="settings-button" type="button" data-add-demo>Adicionar bot</button>
    </section>
  </section>`;

export const voiceDockMarkup = `
  <div class="voice-dock" hidden>
    <div class="voice-dock-top">
      <div class="voice-current" role="status">
        <span class="voice-current-icon">${icon('signal')}</span>
        <div><strong data-voice-state></strong><small data-voice-room-name></small></div>
      </div>
      <button class="icon-button" type="button" data-dock-noise>${icon('noise')}</button>
      <button class="icon-button voice-leave" type="button" data-dock-leave aria-label="Sair do canal">${icon('phoneOff')}</button>
    </div>
    <div class="voice-dock-actions" hidden>
      <button class="settings-button" type="button" data-dock-camera>${icon('camera')}</button>
      <button class="settings-button" type="button" data-dock-screen></button>
      <button class="settings-button" type="button" data-voice-watch aria-controls="voice-stage" aria-expanded="false" hidden>${icon('screen')} Ver câmeras e telas</button>
    </div>
    <button class="settings-button" type="button" data-voice-play hidden>${icon('voice')} Ativar áudio</button>
    <button class="settings-button" type="button" data-voice-retry hidden>Entrar de novo</button>
    <p class="voice-notice" role="status"></p>
    <p class="voice-notice voice-punishment" hidden><span data-punishment-status role="status"></span> <span data-punishment-time role="timer"></span></p>
  </div>`;

export const voiceAccountControlsMarkup = `
  <div class="voice-account-controls">
    <div class="voice-control-group">
      <button class="icon-button" type="button" data-dock-mic></button>
      <button class="icon-button voice-control-arrow" type="button" data-quick-voice="input" aria-label="Opções de microfone" aria-haspopup="true" aria-expanded="false">${icon('chevron')}</button>
    </div>
    <div class="voice-control-group">
      <button class="icon-button" type="button" data-dock-headphones></button>
      <button class="icon-button voice-control-arrow" type="button" data-quick-voice="output" aria-label="Opções de fone" aria-haspopup="true" aria-expanded="false">${icon('chevron')}</button>
    </div>
    <button class="icon-button" type="button" data-voice-settings aria-label="Configurações de usuário">${icon('settings')}</button>
  </div>`;

type VoiceOrigin = { id?: number; name: string };

export function createVoiceCall() {
  const audioHost = document.createElement('div');
  audioHost.className = 'voice-audio';
  audioHost.setAttribute('aria-hidden', 'true');
  document.body.append(audioHost);
  return {
    session: undefined as VoiceSession | undefined,
    muted: false,
    deafened: false,
    origin: undefined as VoiceOrigin | undefined,
    roomName: '',
    audioHost,
    moderationAlert: createVoiceModerationAlert(),
    punishments: new Map<number | undefined, number>(),
    audio: new Map<string, HTMLAudioElement>(),
    blockedAudio: new Set<string>(),
    outputIssues: new Set<string>(),
    routing: new WeakMap<HTMLAudioElement, Promise<void>>(),
    ownIds: new Map<string, string>(),
    watching: false,
    mainFeed: '',
    gallery: null as 'screens' | 'cameras' | null,
    previewsHidden: false,
    camerasHidden: false,
    demos: new Map<string, { bots: DemoBot[]; nextBot: number }>(),
    screenLevels: new Map<string, ListenerVolume>(),
    closedScreens: new Set<string>(),
    changed: undefined as (() => void) | undefined,
    moved: undefined as ((id: string, name: string) => void) | undefined,
    playbackChanged: undefined as (() => void) | undefined,
    activity: undefined as ((event: VoiceActivity) => void) | undefined,
    lastRoomSound: -Infinity,
  };
}

export function mountVoice(call: ReturnType<typeof createVoiceCall>, workspace: HTMLElement, name: () => string, preferences: VoicePreferences,
  closeSidebar: () => void, openSettings: (initial?: 'profile' | 'voice') => void, rooms: Channel[] = channels, server?: number,
  canMove = false, serverName = '', participant?: {
    email: string;
    permissions: number;
    appearance: (member: VoiceMember, self: boolean) => Profile | undefined;
    profile: (member: VoiceMember, anchor: HTMLButtonElement, self: boolean) => void;
    editRoles?: (userId: number) => Promise<void>;
  }) {
  const stage = workspace.querySelector<HTMLElement>('.voice-stage')!;
  const mainFeed = stage.querySelector<HTMLElement>('.voice-main-feed')!;
  const gallery = mainFeed.querySelector<HTMLElement>('.voice-feed-gallery')!;
  const previews = stage.querySelector<HTMLElement>('.voice-video-previews')!;
  const togglePreviews = stage.querySelector<HTMLButtonElement>('[data-toggle-previews]')!;
  const cameras = stage.querySelector<HTMLElement>('.voice-camera-previews')!;
  const toggleCameras = stage.querySelector<HTMLButtonElement>('[data-toggle-cameras]')!;
  const maximizeScreens = stage.querySelector<HTMLButtonElement>('[data-maximize-screens]')!;
  const maximizeCameras = stage.querySelector<HTMLButtonElement>('[data-maximize-cameras]')!;
  const cameraPanel = cameras.parentElement!;
  const editDemo = stage.querySelector<HTMLButtonElement>('[data-edit-demo]')!;
  const demoEditor = stage.querySelector<HTMLElement>('.voice-demo-editor')!;
  const demoBots = demoEditor.querySelector<HTMLElement>('[data-demo-bots]')!;
  const addDemo = demoEditor.querySelector<HTMLButtonElement>('[data-add-demo]')!;
  const closeStream = stage.querySelector<HTMLButtonElement>('[data-stream-close]')!;
  const dock = workspace.querySelector<HTMLElement>('.voice-dock')!;
  const dockCurrent = dock.querySelector('.voice-current')!;
  const dockState = dockCurrent.querySelector('[data-voice-state]')!;
  const dockRoom = dockCurrent.querySelector<HTMLElement>('[data-voice-room-name]')!;
  const notice = dock.querySelector('.voice-notice')!;
  const punishment = dock.querySelector<HTMLElement>('.voice-punishment')!;
  const punishmentStatus = punishment.querySelector('[data-punishment-status]')!;
  const punishmentTime = punishment.querySelector('[data-punishment-time]')!;
  let punishmentTimer: ReturnType<typeof setTimeout> | undefined;
  const play = dock.querySelector<HTMLButtonElement>('[data-voice-play]')!;
  const retryCall = dock.querySelector<HTMLButtonElement>('[data-voice-retry]')!;
  const watch = dock.querySelector<HTMLButtonElement>('[data-voice-watch]')!;
  const dockMic = workspace.querySelector<HTMLButtonElement>('[data-dock-mic]')!;
  const dockNoise = dock.querySelector<HTMLButtonElement>('[data-dock-noise]')!;
  const dockHeadphones = workspace.querySelector<HTMLButtonElement>('[data-dock-headphones]')!;
  const dockCamera = dock.querySelector<HTMLButtonElement>('[data-dock-camera]')!;
  const dockScreen = dock.querySelector<HTMLButtonElement>('[data-dock-screen]')!;
  const dockLeave = dock.querySelector<HTMLButtonElement>('[data-dock-leave]')!;
  const dockActions = dock.querySelector<HTMLElement>('.voice-dock-actions')!;
  const accountControls = workspace.querySelector<HTMLElement>('.voice-account-controls')!;
  const accountStatus = workspace.querySelector<HTMLElement>('[data-account-voice-status]')!;
  const roomButtons = workspace.querySelectorAll<HTMLButtonElement>('[data-voice-room]');
  const sidebarLists = workspace.querySelectorAll<HTMLUListElement>('[data-voice-members]');
  const lifetime = new AbortController();
  let wasConnected = false;
  previews.addEventListener('wheel', event => {
    if (event.ctrlKey || event.deltaX || !event.deltaY || previews.scrollWidth <= previews.clientWidth) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? previews.clientWidth : 1;
    event.preventDefault();
    previews.scrollLeft += event.deltaY * unit;
  }, { passive: false, signal: lifetime.signal });
  let panelHandleTimer: ReturnType<typeof setTimeout> | undefined;
  function hidePanelHandles() {
    clearTimeout(panelHandleTimer);
    stage.removeAttribute('data-show-panel-handles');
  }
  stage.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    stage.setAttribute('data-show-panel-handles', '');
    clearTimeout(panelHandleTimer);
    panelHandleTimer = setTimeout(hidePanelHandles, 2000);
  }, { passive: true, signal: lifetime.signal });
  stage.addEventListener('pointerleave', hidePanelHandles, { signal: lifetime.signal });
  lifetime.signal.addEventListener('abort', hidePanelHandles, { once: true });
  const template = document.createElement('template');
  template.innerHTML = screenTile;
  const tiles = new Map<string, ReturnType<typeof createTile>>();
  const compactSidebar = matchMedia('(max-width: 720px)');
  const { audioHost, ownIds, audio, blockedAudio, outputIssues, routing } = call;
  let presence: Record<string, VoiceMember[]> = {};
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  let fetchingPresence = false;
  let session = call.session;
  let speaking: ReadonlySet<string> = new Set();
  function paintSpeaking() {
    for (const sidebar of sidebarLists) {
      const currentRoom = session?.state === 'connected' && sidebar.dataset.voiceMembers === session.room;
      for (const avatar of sidebar.querySelectorAll<HTMLElement>('[data-voice-avatar]')) {
        avatar.classList.toggle('voice-avatar-speaking', currentRoom && speaking.has(avatar.dataset.voiceAvatar!));
      }
    }
  }
  const activityMeter = createVoiceActivityMeter(next => {
    speaking = next;
    paintSpeaking();
  });

  function syncSpeaking() {
    const tracks = new Map<string, MediaStreamTrack>();
    if (session?.state === 'connected' && session.self) {
      const local = session.microphone.track;
      if (local && !session.microphone.silent && !session.microphoneLocked) tracks.set(session.self.id, local);
      if (!session.deafened) for (const [id, peer] of session.peers) {
        const track = peer.audio?.getAudioTracks()[0];
        const member = peer.member;
        if (track && !member.muted && !member.serverMuted && !member.serverDeafened && !level(member).muted) tracks.set(id, track);
      }
    }
    activityMeter.sync(tracks);
    paintSpeaking();
  }

  let wasDeafened = false;
  const noiseSupported = Boolean(window.AudioWorkletNode && window.WebAssembly)
    || navigator.mediaDevices?.getSupportedConstraints().noiseSuppression === true;
  let changingNoise = false;
  let noiseError = '';
  let dragged: { room: string; member: VoiceMember } | undefined;
  const audioKey = `discordo:participant-audio:${participant?.email ?? ''}`;
  const levels = new Map<number, ListenerVolume>();
  try {
    const saved = JSON.parse(localStorage.getItem(audioKey) ?? '{}') as Record<string, ListenerVolume>;
    for (const [id, value] of Object.entries(saved)) {
      if (value && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 100) levels.set(Number(id), value);
    }
  } catch { /* The mixer can still be used for the current page. */ }

  function level(member: VoiceMember): ListenerVolume {
    return levels.get(member.userId ?? 0) ?? { volume: 100, muted: false };
  }

  function setLevel(member: VoiceMember, value: ListenerVolume) {
    if (!member.userId) return;
    levels.set(member.userId, value);
    updateAudio();
    syncSpeaking();
    showScreen();
    try { localStorage.setItem(audioKey, JSON.stringify(Object.fromEntries(levels))); } catch { /* Kept in memory. */ }
  }

  async function moveParticipant(source: string, member: VoiceMember, target: string) {
    await moveVoiceMember(source, member.id, target);
    void refreshPresence();
  }

  function reportMoveError(error: unknown) {
    const status = workspace.querySelector<HTMLElement>('.chat-note');
    if (status) status.textContent = (error as Error).message;
  }

  let refreshAbsenceAction: (() => void) | undefined;

  function renderSidebar() {
    refreshAbsenceAction?.();
    if (dragged) return;
    for (const sidebar of sidebarLists) {
      const id = sidebar.dataset.voiceMembers!;
      const self = session?.room === id ? session.self : undefined;
      if (self) ownIds.set(id, self.id);
      const remote = (presence[id] ?? []).filter(member => member.id !== ownIds.get(id));
      if (isDemoRoom(id) && session?.room === id) {
        for (const peer of session.peers.values()) {
          const index = remote.findIndex(member => member.id === peer.member.id);
          if (index === -1) remote.push(peer.member);
          else remote[index] = peer.member;
        }
        remote.push(...(session.demoPeers ?? []).map(peer => peer.member));
      }
      const members = (self ? [{ ...self, name: name() }, ...remote] : remote).map(member =>
        ({ ...member, ...participant?.appearance(member, member.id === self?.id) }));
      const signature = JSON.stringify(members);
      if (sidebar.dataset.rendered === signature) continue;
      sidebar.dataset.rendered = signature;
      sidebar.hidden = members.length === 0;
      sidebar.replaceChildren(...members.map(member => {
        const row = document.createElement('li');
        const avatar = document.createElement('span');
        avatar.className = 'avatar personal';
        avatar.dataset.voiceAvatar = member.id;
        if (session?.room === id && speaking.has(member.id)) avatar.classList.add('voice-avatar-speaking');
        avatar.setAttribute('aria-hidden', 'true');
        renderAvatar(avatar, member);
        const label = document.createElement('span');
        label.className = 'voice-member-name';
        label.textContent = member.name;
        const state = document.createElement('span');
        state.className = 'voice-member-state';
        if (member.muted || member.serverMuted || member.serverDeafened) state.innerHTML += icon('micOff');
        if (member.deafened || member.serverDeafened) state.innerHTML += icon('headphonesOff');
        if (member.sharing) state.innerHTML += icon('screen');
        if (member.cameraOn) state.innerHTML += icon('camera');
        const details = [member.serverMuted ? 'Voz silenciada no servidor' : member.muted && 'Microfone silenciado',
          member.serverDeafened ? 'Áudio desativado no servidor' : member.deafened && 'Fone silenciado',
          member.sharing && 'Compartilhando a tela', member.cameraOn && 'Câmera ligada'].filter(Boolean).join(', ');
        if (details) {
          state.title = details;
          state.setAttribute('role', 'img');
          state.setAttribute('aria-label', details);
        }
        const selfMember = self?.id === member.id;
        const profile = document.createElement('button');
        profile.type = 'button';
        profile.className = 'voice-member-profile';
        if (member.userId) {
          profile.dataset.voiceProfileUser = String(member.userId);
          profile.dataset.voiceProfileName = member.name;
          profile.toggleAttribute('data-voice-profile-self', selfMember);
        }
        profile.setAttribute('aria-label', `Perfil de ${member.name}`);
        profile.setAttribute('aria-haspopup', 'dialog');
        profile.append(avatar, label, state);
        if (isDemoRoom(id) && !member.userId) {
          profile.disabled = true;
          profile.removeAttribute('aria-haspopup');
          row.append(profile);
          return row;
        }
        const openProfile = () => participant?.profile(member, profile, selfMember);
        profile.addEventListener('click', openProfile);
        const options = document.createElement('button');
        options.type = 'button';
        options.className = 'icon-button voice-member-options';
        options.setAttribute('aria-label', `Opções de ${member.name}`);
        options.innerHTML = icon('more');
        const destinations = canMove ? rooms.filter(room => room.id !== id) : [];
        const openMenu = (x: number, y: number) => {
          const active = session;
          const userId = member.userId;
          const editRoles = participant?.editRoles;
          const showAbsence = id.startsWith('channel-') && userId !== undefined && !selfMember
            && active?.self?.userId !== userId;
          const canCheckAbsence = () => {
            if (session?.state !== 'connected' || session.room !== id || session.self?.userId === undefined) return false;
            const peer = session.peers.get(member.id)?.member ?? presence[id]?.find(candidate => candidate.id === member.id);
            return Boolean(peer && (peer.muted || peer.deafened || peer.serverMuted || peer.serverDeafened));
          };
          refreshAbsenceAction = openVoiceMemberMenu(workspace, {
            member, x, y, profile: openProfile,
            editRoles: userId !== undefined && editRoles ? () => void editRoles(userId) : undefined,
            canCheckAbsence,
            checkAbsence: showAbsence ? async () => {
              const sender = session?.self;
              if (!sender || !canCheckAbsence()) return;
              await checkVoiceAbsence(id, sender.id, member.id);
              showActivity('Aviso de ausência enviado.');
            } : undefined,
            audio: !selfMember && member.userId && session?.room === id ? level(member) : undefined,
            selfAudio: selfMember && session ? {
              muted: session.microphoneLocked || session.microphone.muted || session.deafened,
              deafened: session.deafened,
              microphoneLocked: session.microphoneLocked || session.deafened,
              headphonesLocked: Boolean(session.self?.serverDeafened),
              toggleMicrophone,
              toggleHeadphones,
            } : undefined,
            setAudio: value => setLevel(member, value),
            destinations,
            move: target => moveParticipant(id, member, target),
            permissions: participant?.permissions ?? 0,
            moderate: participant && member.userId ? async (action, enabled) => {
              if (action === 'disconnect' && session?.self?.id === member.id) {
                session.leave('', false, true);
                return;
              }
              await moderateVoiceMember(id, member.id, action, enabled);
            } : undefined,
            punish: participant && member.userId && !selfMember
              ? duration => punishVoiceMember(id, member.id, duration) : undefined,
          });
        };
        row.addEventListener('contextmenu', event => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          const rect = profile.getBoundingClientRect();
          openMenu(event.clientX || rect.right, event.clientY || rect.top);
        });
        options.addEventListener('click', () => {
          const rect = options.getBoundingClientRect();
          openMenu(rect.right, rect.top);
        });
        if (destinations.length) {
          profile.draggable = true;
          profile.addEventListener('dragstart', event => {
            if (!event.dataTransfer) return;
            dragged = { room: id, member };
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', member.name);
          });
          profile.addEventListener('dragend', clearDrag);
        }
        row.append(profile, options);
        return row;
      }));
    }
  }

  let lobbyBaseline = false;
  const lobbyEnabled = () => preferences.lobbySounds === true && (!session || session.state === 'ended');
  const canRefreshPresence = () => rooms.length > 0 && !lifetime.signal.aborted && !document.hidden
    && (lobbyEnabled() || !compactSidebar.matches || workspace.classList.contains('with-channels'));

  const toast = document.createElement('p');
  toast.className = 'voice-activity-toast';
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  workspace.append(toast);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function showActivity(message: string) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3300);
  }

  type VoiceAlertSound = 'moderacao' | 'verificar-ausencia';
  let voiceAlert: {
    sound: VoiceAlertSound;
    url?: string | null;
    session: VoiceSession;
    pending: boolean;
    playing: boolean;
  } | undefined;
  let voiceAlertTimer: ReturnType<typeof setTimeout> | undefined;

  // The absence alert can ring while the call audio is silenced.
  const canHearVoiceAlert = (active: VoiceSession, sound: VoiceAlertSound) => !lifetime.signal.aborted && session === active
    && active.state === 'connected' && (sound === 'verificar-ausencia' || !active.deafened) && preferences.roomSounds !== false
    && preferences.outputVolume > 0 && (preferences.roomSoundVolume ?? 60) > 0;

  function updatePlayButton() {
    if (voiceAlert && !canHearVoiceAlert(voiceAlert.session, voiceAlert.sound)) {
      clearTimeout(voiceAlertTimer);
      voiceAlert = undefined;
    }
    play.hidden = blockedAudio.size === 0 && !voiceAlert?.pending;
  }

  async function playVoiceAlert() {
    const alert = voiceAlert;
    if (!alert || alert.playing || !canHearVoiceAlert(alert.session, alert.sound)) return;
    alert.playing = true;
    const played = await playRoomSound(alert.sound, {
      volume: preferences.outputVolume * (preferences.roomSoundVolume ?? 60) / 10000,
      output: preferences.output,
      url: preferences.customRoomSounds === false ? undefined : alert.url ?? undefined,
      allowed: () => voiceAlert === alert && canHearVoiceAlert(alert.session, alert.sound),
    });
    if (voiceAlert !== alert) return;
    alert.playing = false;
    alert.pending = !played;
    if (played) {
      clearTimeout(voiceAlertTimer);
      voiceAlert = undefined;
    }
    updatePlayButton();
  }

  function notifyVoiceAlert(active: VoiceSession, sound: VoiceAlertSound, url?: string | null) {
    if (!canHearVoiceAlert(active, sound)) return;
    clearTimeout(voiceAlertTimer);
    voiceAlert = { session: active, sound, url, playing: false, pending: false };
    voiceAlertTimer = setTimeout(() => {
      voiceAlert = undefined;
      updatePlayButton();
    }, 30_000);
    void playVoiceAlert();
  }

  function unlockVoiceAudio() {
    if (session && session.state !== 'ended') activityMeter.unlock();
    if (preferences.roomSounds !== false && (lobbyEnabled() || (session && session.state !== 'ended'))) {
      prepareRoomSounds();
      if (voiceAlert?.pending) void playVoiceAlert();
    }
  }
  const unlockOptions = { capture: true, signal: lifetime.signal };
  workspace.addEventListener('click', unlockVoiceAudio, unlockOptions);
  workspace.addEventListener('keydown', unlockVoiceAudio, unlockOptions);
  document.addEventListener('touchend', unlockVoiceAudio, unlockOptions);
  window.addEventListener('pageshow', unlockVoiceAudio, { signal: lifetime.signal });

  async function refreshPresence() {
    clearTimeout(presenceTimer);
    if (fetchingPresence || !canRefreshPresence()) return;
    fetchingPresence = true;
    try {
      const next = await readVoicePresence(AbortSignal.any([lifetime.signal, AbortSignal.timeout(4500)]), server);
      if (lifetime.signal.aborted) return;
      if (lobbyEnabled() && lobbyBaseline) {
        for (const room of rooms) {
          const known = new Set((presence[room.id] ?? []).map(member => member.id));
          const joined = next[room.id]?.find(member => !known.has(member.id) && member.id !== ownIds.get(room.id));
          if (joined) {
            showActivity(`${joined.name} entrou na ${room.name}`);
            if (preferences.roomSounds !== false && performance.now() - call.lastRoomSound >= 400) {
              call.lastRoomSound = performance.now();
              void playRoomSound('entrou', {
                volume: preferences.outputVolume * (preferences.roomSoundVolume ?? 60) / 30000,
                output: preferences.output,
                allowed: () => lobbyEnabled() && preferences.roomSounds !== false && !lifetime.signal.aborted && !call.session?.deafened,
              });
            }
            break;
          }
        }
      }
      lobbyBaseline = lobbyEnabled();
      presence = next;
      renderSidebar();
    } catch {
      // Keep the latest roster while the network recovers.
    } finally {
      fetchingPresence = false;
      if (canRefreshPresence()) presenceTimer = setTimeout(refreshPresence, 750);
    }
  }
  document.addEventListener('visibilitychange', () => {
    lobbyBaseline = false;
    void refreshPresence();
    if (!document.hidden) {
      unlockVoiceAudio();
      updatePunishment();
    }
  }, { signal: lifetime.signal });
  compactSidebar.addEventListener('change', refreshPresence, { signal: lifetime.signal });
  void refreshPresence();

  function playAudio(id: string, element: HTMLAudioElement) {
    void element.play().then(() => blockedAudio.delete(id), error => {
      if (audio.get(id) === element && error.name !== 'AbortError') blockedAudio.add(id);
    }).then(() => call.playbackChanged?.());
  }

  function routeAudio(id: string, element: HTMLAudioElement) {
    if (typeof element.setSinkId !== 'function') return Promise.resolve();
    const task = (routing.get(element) ?? Promise.resolve()).then(async () => {
      if (audio.get(id) !== element) return;
      const destination = preferences.output;
      try {
        if (element.sinkId !== destination) await element.setSinkId(destination);
        outputIssues.delete(id);
      } catch {
        await element.setSinkId('').catch(() => {});
        if (audio.get(id) === element) outputIssues.add(id);
      }
      call.playbackChanged?.();
    });
    routing.set(element, task);
    return task;
  }

  function updateAudio() {
    for (const [id, element] of audio) {
      const peer = session?.peers.get(id);
      if (peer?.audio && element.srcObject === peer.audio) {
        adjustAudio(element, peer.member);
        continue;
      }
      element.srcObject = null;
      element.remove();
      audio.delete(id);
      blockedAudio.delete(id);
      outputIssues.delete(id);
    }
    for (const [id, peer] of session?.peers ?? []) {
      if (!peer.audio || audio.has(id)) continue;
      const element = document.createElement('audio');
      adjustAudio(element, peer.member);
      element.srcObject = peer.audio;
      audio.set(id, element);
      audioHost.append(element);
      void routeAudio(id, element).then(() => {
        if (audio.get(id) === element) playAudio(id, element);
      });
    }
    updatePlayButton();
  }

  function adjustAudio(element: HTMLAudioElement, member: VoiceMember) {
    const personal = level(member);
    element.volume = preferences.outputVolume * personal.volume / 10000;
    element.muted = Boolean(session?.deafened || personal.muted || member.serverMuted || member.serverDeafened);
  }

  function updateNotice() {
    if (!session) {
      notice.textContent = '';
      return;
    }
    const networkIssue = [...session.peers.values()].some(peer =>
      peer.slow || peer.failed || peer.connection.connectionState === 'failed');
    notice.textContent = [
      session.notice,
      session.connectionNotice,
      noiseError,
      session.state === 'connected' && session.microphone.notice,
      session.state === 'connected' && session.microphone.gainUnavailable &&
        'O navegador está usando o volume de entrada definido no sistema.',
      outputIssues.size > 0 && 'A saída escolhida não está disponível. O áudio voltou para a saída padrão.',
      networkIssue && 'A conexão com alguém na sala está demorando ou falhou. Em redes diferentes, pode ser necessário configurar um servidor TURN.',
    ].filter(Boolean).join(' ');
  }

  function updatePunishment() {
    clearTimeout(punishmentTimer);
    const until = call.punishments.get(server);
    punishment.hidden = until === undefined;
    dock.hidden = punishment.hidden && !(session?.state === 'connected' || session?.state === 'connecting' || session?.notice);
    if (until === undefined) return;
    const seconds = remainingPunishmentSeconds(until);
    const message = seconds ? 'Castigo na voz deste servidor. Você pode voltar em' : 'O castigo acabou. Você já pode entrar novamente.';
    if (punishmentStatus.textContent !== message) punishmentStatus.textContent = message;
    punishmentTime.textContent = seconds ? `${seconds} s.` : '';
    if (seconds) punishmentTimer = setTimeout(updatePunishment, Math.max(1, until - Date.now() - (seconds - 1) * 1000));
  }

  function createTile(id: string) {
    const tile = template.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const controller = new AbortController();
    const slot = {
      tile, controller,
      name: tile.querySelector<HTMLElement>('[data-feed-name]')!,
      kind: tile.querySelector<HTMLElement>('[data-feed-kind]')!,
      select: tile.querySelector<HTMLButtonElement>('[data-feed-select]')!,
      fullscreen: tile.querySelector<HTMLButtonElement>('[data-feed-fullscreen]')!,
      close: tile.querySelector<HTMLButtonElement>('[data-feed-close]')!,
      video: tile.querySelector('video')!,
      sound: tile.querySelector<HTMLButtonElement>('[data-screen-sound]')!,
      volumeControls: tile.querySelector<HTMLElement>('[data-screen-volume-controls]')!,
      volume: tile.querySelector<HTMLInputElement>('[data-screen-volume]')!,
      audio: tile.querySelector('audio')!,
      showVideo: mountScreenPlayback(tile, controller.signal),
      blocked: false,
      pending: false,
    };
    slot.close.addEventListener('click', () => {
      call.closedScreens.add(id);
      call.previewsHidden = false;
      session?.setWatchingScreen(id.slice('screen:'.length), false);
      if (document.fullscreenElement === tile) void document.exitFullscreen().catch(() => {});
      tile.removeAttribute('data-video-expanded');
      showScreen();
      slot.select.focus({ preventScroll: true });
    });
    slot.select.addEventListener('click', () => {
      if (call.closedScreens.delete(id)) session?.setWatchingScreen(id.slice('screen:'.length), true);
      call.mainFeed = id;
      call.gallery = null;
      showScreen();
      mainFeed.focus({ preventScroll: true });
    });
    slot.sound.addEventListener('click', () => {
      const value = call.screenLevels.get(id);
      if (!value) return;
      if (slot.blocked) slot.blocked = false;
      else value.muted = slot.audio.muted ? false : true;
      if (!value.muted && value.volume === 0) value.volume = 100;
      showScreen();
    });
    slot.volume.addEventListener('input', () => {
      const value = call.screenLevels.get(id);
      if (!value) return;
      value.volume = Number(slot.volume.value);
      showScreen();
    });
    slot.fullscreen.addEventListener('click', async () => {
      if (document.fullscreenElement === tile) {
        await document.exitFullscreen().catch(() => {});
      } else if (!tile.toggleAttribute('data-video-expanded', !tile.hasAttribute('data-video-expanded'))) {
        updateFullscreen();
        return;
      } else if (tile.requestFullscreen && document.fullscreenEnabled) {
        try {
          await tile.requestFullscreen();
          tile.removeAttribute('data-video-expanded');
        } catch { /* Keep the in-page full view if native fullscreen is unavailable. */ }
      }
      updateFullscreen();
    });
    function updateFullscreen() {
      const expanded = document.fullscreenElement === tile || tile.hasAttribute('data-video-expanded');
      slot.fullscreen.title = expanded ? 'Sair da tela cheia' : 'Tela cheia';
      slot.fullscreen.setAttribute('aria-label', slot.fullscreen.title);
    }
    document.addEventListener('fullscreenchange', updateFullscreen, { signal: controller.signal });
    tile.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !tile.hasAttribute('data-video-expanded')) return;
      tile.removeAttribute('data-video-expanded');
      updateFullscreen();
      event.stopPropagation();
    }, { signal: controller.signal });
    return slot;
  }

  function removeTile(id: string, slot: ReturnType<typeof createTile>) {
    slot.controller.abort();
    slot.audio.srcObject = null;
    slot.tile.remove();
    tiles.delete(id);
  }

  function showScreen() {
    const feeds = new Map<string, {
      label: string; stream?: MediaStream; audio?: MediaStream; member?: VoiceMember; camera?: boolean; simulatedAudio?: boolean;
    }>();
    if (session?.self) {
      if (session.screen) feeds.set(`screen:${session.self.id}`, { label: 'Sua tela', stream: session.screen });
      if (session.camera) feeds.set(`camera:${session.self.id}`, { label: 'Sua câmera', stream: session.camera, camera: true });
      const demoPeers = session.demoPeers ?? [];
      for (const peer of [...session.peers.values(), ...demoPeers]) {
        const id = peer.member.id;
        if (peer.member.sharing) feeds.set(`screen:${id}`, { label: `Tela de ${peer.member.name}`, stream: peer.video,
          audio: peer.member.sharingAudio ? peer.screenAudio : undefined, member: peer.member,
          simulatedAudio: demoPeers.includes(peer) });
        if (peer.member.cameraOn) feeds.set(`camera:${id}`, { label: `Câmera de ${peer.member.name}`, stream: peer.camera, member: peer.member, camera: true });
      }
    }
    const demo = session !== undefined && isDemoRoom(session.room) && session.state !== 'ended';
    const editing = demo && session?.state === 'connected' && session.demoHost;
    editDemo.hidden = !editing;
    if (!editing) {
      demoEditor.hidden = true;
      editDemo.setAttribute('aria-expanded', 'false');
    }
    watch.hidden = feeds.size === 0 && !demo;
    if (watch.hidden) call.watching = false;
    stage.hidden = !call.watching;
    if (stage.hidden) hidePanelHandles();
    watch.setAttribute('aria-expanded', String(call.watching));
    watch.innerHTML = icon('eye') + (call.watching ? ' Ocultar' : ' Ver vídeos');
    if (session?.state === 'connected') {
      for (const id of call.closedScreens) {
        if (feeds.has(id)) continue;
        call.closedScreens.delete(id);
        session.setWatchingScreen(id.slice('screen:'.length), true);
      }
    }
    const allScreens = [...feeds.keys()].filter(id => !feeds.get(id)?.camera);
    const openScreens = allScreens.filter(id => !call.closedScreens.has(id));
    const allCameras = [...feeds.keys()].filter(id => feeds.get(id)?.camera);
    if (!feeds.has(call.mainFeed) || call.closedScreens.has(call.mainFeed)) {
      call.mainFeed = openScreens[0] ?? allCameras[0] ?? '';
    }
    if ((call.gallery === 'screens' && !openScreens.length) || (call.gallery === 'cameras' && !allCameras.length)) {
      call.gallery = null;
    }
    const galleryIds = call.gallery === 'screens' ? openScreens : call.gallery === 'cameras' ? allCameras : [];
    const featured = call.gallery ? galleryIds : call.mainFeed ? [call.mainFeed] : [];
    const featuredIds = new Set(featured);
    const screenIds = allScreens.filter(id => !featuredIds.has(id));
    const formerMainScreen = call.gallery === 'cameras' ? screenIds.indexOf(call.mainFeed) : -1;
    if (formerMainScreen > 0) screenIds.unshift(...screenIds.splice(formerMainScreen, 1));
    const cameraIds = allCameras.filter(id => !featuredIds.has(id));
    const screensHidden = call.previewsHidden || !screenIds.length;
    const camerasHidden = call.camerasHidden || !cameraIds.length;
    const ordered = [...featured, ...(screensHidden ? [] : screenIds), ...(camerasHidden ? [] : cameraIds)];
    const visible = new Set(call.watching ? ordered : []);
    for (const [id, slot] of tiles) if (!visible.has(id)) removeTile(id, slot);
    for (const id of call.screenLevels.keys()) if (!feeds.has(id)) call.screenLevels.delete(id);
    if (!call.watching) return;
    let emptyNote = mainFeed.querySelector('[data-demo-empty]');
    if (call.mainFeed) emptyNote?.remove();
    else {
      if (!emptyNote) {
        const note = document.createElement('p');
        note.dataset.demoEmpty = '';
        mainFeed.append(note);
        emptyNote = note;
      }
      emptyNote.textContent = allScreens.length ? 'Escolha uma transmissão para assistir.'
        : session?.state === 'connecting' ? 'Conectando à sala de teste…'
        : session?.demoHost ? 'Ligue a tela ou a câmera de um bot para começar.'
        : 'Aguardando a simulação.';
    }

    stage.dataset.gallery = call.gallery ?? '';
    gallery.hidden = !call.gallery;
    if (galleryIds.length) {
      const columns = galleryIds.length > 4 ? 3 : Math.min(galleryIds.length, 2);
      gallery.style.setProperty('--gallery-columns', String(columns));
      gallery.style.setProperty('--gallery-rows', String(Math.min(3, Math.ceil(galleryIds.length / columns))));
    }
    mainFeed.setAttribute('aria-label', call.gallery === 'screens' ? 'Telas compartilhadas'
      : call.gallery === 'cameras' ? 'Câmeras maximizadas' : 'Transmissão em destaque');
    togglePreviews.hidden = !screenIds.length;
    previews.hidden = screensHidden;
    const previewLabel = screensHidden ? 'Mostrar telas' : 'Ocultar telas';
    togglePreviews.title = previewLabel;
    togglePreviews.setAttribute('aria-label', previewLabel);
    togglePreviews.setAttribute('aria-expanded', String(!previews.hidden));
    toggleCameras.hidden = !cameraIds.length;
    cameraPanel.hidden = camerasHidden;
    cameras.hidden = camerasHidden;
    const cameraLabel = call.camerasHidden ? 'Mostrar câmeras' : 'Ocultar câmeras';
    toggleCameras.title = cameraLabel;
    toggleCameras.setAttribute('aria-label', cameraLabel);
    toggleCameras.setAttribute('aria-expanded', String(!cameras.hidden));
    for (const [button, type, noun, ids] of [
      [maximizeScreens, 'screens', 'telas', openScreens], [maximizeCameras, 'cameras', 'câmeras', allCameras],
    ] as const) {
      const maximized = call.gallery === type;
      button.hidden = !ids.length;
      button.title = maximized ? 'Voltar ao destaque' : `Maximizar ${noun}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-pressed', String(maximized));
    }

    // Only screen shares count toward the four-screen limit.
    const screenSlots = feeds.get(call.mainFeed)?.camera ? 4 : 3;
    const liveScreens = new Set(screensHidden ? [] : screenIds.filter(id => !call.closedScreens.has(id)).slice(0, call.gallery === 'cameras' ? 4 : screenSlots));
    let featuredIndex = 0;
    let previewIndex = 0;
    let cameraIndex = 0;
    for (const id of ordered) {
      const feed = feeds.get(id)!;
      let slot = tiles.get(id);
      if (!slot) {
        slot = createTile(id);
        tiles.set(id, slot);
      }
      const primary = featuredIds.has(id);
      const closed = call.closedScreens.has(id);
      const live = !closed && (primary || !!feed.camera || liveScreens.has(id));
      const container = primary ? (call.gallery ? gallery : mainFeed) : (feed.camera ? cameras : previews);
      const next = container.children[primary ? featuredIndex++ : feed.camera ? cameraIndex++ : previewIndex++] ?? null;
      if (slot.tile !== next) container.insertBefore(slot.tile, next);
      slot.tile.toggleAttribute('data-camera', !!feed.camera);
      slot.tile.toggleAttribute('data-feed-placeholder', !live);
      if (slot.name.textContent !== feed.label) {
        slot.name.textContent = feed.label;
        slot.video.setAttribute('aria-label', feed.label);
        slot.select.setAttribute('aria-label', `Assistir: ${feed.label}`);
        slot.close.setAttribute('aria-label', `Fechar: ${feed.label}`);
        slot.close.title = 'Fechar transmissão';
      }
      slot.kind.innerHTML = feed.camera ? cameraIcon : screenIcon;
      slot.select.hidden = primary && !call.gallery;
      slot.select.querySelector('span')!.hidden = !closed;
      slot.close.hidden = !!feed.camera || closed;
      slot.fullscreen.hidden = !primary;
      slot.showVideo(live ? feed.stream ?? null : null, primary);
      setScreenAudio(slot, id, live && !feed.camera ? feed.audio : undefined, feed.member, live && !feed.camera, feed.simulatedAudio);
    }
  }

  function setScreenAudio(slot: ReturnType<typeof createTile>, id: string, stream: MediaStream | undefined,
    member: VoiceMember | undefined, showAudioControl: boolean, simulatedAudio?: boolean) {
    const { audio, sound } = slot;
    if (audio.srcObject !== (stream ?? null)) {
      audio.srcObject = stream ?? null;
      slot.blocked = slot.pending = false;
    }
    slot.volumeControls.hidden = !showAudioControl;
    if (!showAudioControl) return;
    const unavailable = !member || (!stream && !simulatedAudio);
    slot.volumeControls.toggleAttribute('data-audio-unavailable', unavailable);
    if (unavailable) {
      sound.disabled = true;
      sound.title = 'Transmissão sem áudio';
      sound.setAttribute('aria-label', sound.title);
      sound.removeAttribute('aria-pressed');
      sound.innerHTML = icon('headphonesOff');
      slot.volume.disabled = true;
      return;
    }
    const personal = level(member);
    if (!call.screenLevels.has(id)) call.screenLevels.set(id, { volume: 100, muted: false });
    const screenLevel = call.screenLevels.get(id)!;
    const disabled = Boolean(session?.deafened || personal.muted);
    audio.volume = preferences.outputVolume * personal.volume * screenLevel.volume / 1000000;
    audio.muted = disabled || screenLevel.muted || screenLevel.volume === 0;
    slot.volume.value = String(screenLevel.volume);
    slot.volume.style.setProperty('--volume-fraction', String(screenLevel.volume / 100));
    slot.volume.setAttribute('aria-label', `Volume da tela de ${member.name}`);
    slot.volume.setAttribute('aria-valuetext', `${screenLevel.volume}%`);
    slot.volume.disabled = disabled;
    sound.disabled = disabled;
    const label = audio.muted ? 'Ativar áudio da transmissão'
      : slot.blocked ? 'Reproduzir áudio da transmissão' : 'Silenciar áudio da transmissão';
    sound.setAttribute('aria-label', label);
    sound.title = label;
    sound.innerHTML = icon(audio.muted ? 'headphonesOff' : 'voice');
    sound.setAttribute('aria-pressed', String(!audio.muted && !slot.blocked));
    if (!stream) return;
    if (audio.muted) {
      audio.pause();
    } else if (audio.paused && !slot.pending && !slot.blocked) {
      slot.pending = true;
      if (typeof audio.setSinkId === 'function' && audio.sinkId !== preferences.output) {
        void audio.setSinkId(preferences.output).catch(() => {});
      }
      void audio.play().catch(error => {
        if (audio.srcObject === stream && error.name !== 'AbortError') slot.blocked = true;
      }).finally(() => {
        if (audio.srcObject !== stream) return;
        slot.pending = false;
        if (slot.blocked) showScreen();
      });
    }
  }

  function render() {
    const deafened = session && session.state !== 'ended' ? session.deafened : call.deafened;
    if (deafened && !wasDeafened) stopRoomSound();
    wasDeafened = deafened;
    updateAudio();
    renderSidebar();
    syncSpeaking();
    const active = session?.state === 'connected';
    if (active !== wasConnected) {
      wasConnected = active;
      document.dispatchEvent(new Event('discordo:voice-shortcuts-changed'));
    }
    const demo = active && isDemoRoom(session?.room);
    const connecting = session?.state === 'connecting';
    const muted = session && session.state !== 'ended' ? Boolean(session.microphoneLocked || session.self?.muted) : call.muted || call.deafened;
    const sharing = Boolean(session?.screen);
    const cameraOn = Boolean(session?.camera);
    const requestingMic = Boolean(session?.microphone.requesting && !session.microphone.available);
    const micOff = !session?.microphone.available || session.microphone.muted;
    const micLabel = session?.microphoneLocked ? 'Microfone silenciado no servidor'
      : deafened ? 'Microfone silenciado pelo fone'
      : requestingMic ? 'Cancelar pedido do microfone'
      : !session || session.state === 'ended' ? call.muted ? 'Ativar microfone' : 'Silenciar microfone'
      : !session.microphone.available ? 'Permitir microfone'
      : micOff ? 'Ativar microfone' : 'Silenciar microfone';
    const screenLabel = sharing ? 'Parar transmissão' : 'Compartilhar tela';
    const headphonesLabel = session?.self?.serverDeafened ? 'Áudio desativado no servidor' : deafened ? 'Reativar áudio' : 'Desativar áudio';
    call.roomName = rooms.find(room => room.id === session?.room)?.name ?? call.roomName;
    const origin = call.origin?.id !== server && call.origin?.name ? ` · ${call.origin.name}` : '';
    const roomName = call.roomName + origin;
    updatePunishment();
    retryCall.hidden = session?.state !== 'ended' || !session.canRetry;
    dockActions.hidden = !active;
    accountControls.hidden = false;
    dockNoise.hidden = !active;
    accountStatus.textContent = active ? 'Em voz' : 'Disponível';
    dockState.textContent = active ? 'Voz conectada' : connecting ? 'Conectando…' : 'Canal de voz';
    dockRoom.textContent = roomName;
    dockRoom.title = roomName;
    dockLeave.hidden = !(active || connecting);
    dockLeave.setAttribute('aria-label', connecting ? 'Cancelar entrada no canal' : 'Sair do canal');
    dockLeave.title = dockLeave.getAttribute('aria-label')!;
    dockMic.innerHTML = icon(muted ? 'micOff' : 'mic');
    dockMic.setAttribute('aria-label', micLabel);
    dockMic.disabled = deafened || Boolean(active && session?.microphoneLocked);
    dockMic.toggleAttribute('data-muted', muted);
    dockMic.setAttribute('aria-pressed', String(muted));
    const noiseLabel = noiseSupported ? `Supressão de ruído · ${session?.microphone.noiseEngine ?? 'RNNoise'}`
      : 'Supressão de ruído indisponível no navegador';
    dockNoise.setAttribute('aria-label', noiseLabel);
    dockNoise.title = noiseLabel;
    dockNoise.setAttribute('aria-pressed', String(noiseSupported && preferences.noiseSuppression));
    dockNoise.disabled = !noiseSupported || changingNoise || requestingMic;
    dockHeadphones.innerHTML = icon(deafened ? 'headphonesOff' : 'headphones');
    dockHeadphones.setAttribute('aria-label', headphonesLabel);
    dockHeadphones.disabled = Boolean(active && session?.self?.serverDeafened);
    dockHeadphones.toggleAttribute('data-muted', deafened);
    dockHeadphones.setAttribute('aria-pressed', String(deafened));
    const cameraLabel = cameraOn ? 'Desligar câmera' : 'Ligar câmera';
    dockCamera.setAttribute('aria-pressed', String(cameraOn));
    dockCamera.setAttribute('aria-label', cameraLabel);
    dockCamera.title = cameraLabel;
    dockCamera.disabled = Boolean(session?.pickingCamera);
    dockCamera.hidden = dockScreen.hidden = demo;
    dockScreen.innerHTML = `${icon('screen')} <span>Tela</span>`;
    dockScreen.setAttribute('aria-pressed', String(sharing));
    dockScreen.setAttribute('aria-label', screenLabel);
    dockScreen.title = screenLabel;
    dockScreen.disabled = Boolean(session?.pickingScreen);
    for (const button of roomButtons) {
      const joined = Boolean(active && button.dataset.voiceRoom === session?.room);
      button.classList.toggle('voice-joined', joined);
      button.setAttribute('aria-pressed', String(joined));
    }
    updateNotice();
    showScreen();
    workspace.dispatchEvent(new Event('voice-state-change'));
  }

  for (const button of roomButtons) {
    const target = button.dataset.voiceRoom!;
    const acceptDrag = (event: DragEvent) => {
      if (!dragged || dragged.room === target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      button.classList.add('voice-drop-target');
    };
    button.addEventListener('dragover', acceptDrag);
    button.addEventListener('dragleave', () => button.classList.remove('voice-drop-target'));
    button.addEventListener('drop', event => {
      if (!dragged || dragged.room === target) return;
      event.preventDefault();
      const { room, member } = dragged;
      clearDrag();
      void moveParticipant(room, member, target).catch(reportMoveError);
    });
    button.addEventListener('click', () => {
      const channel = rooms.find(item => item.id === button.dataset.voiceRoom);
      if (channel) connect(channel);
    });
  }
  function clearDrag() {
    dragged = undefined;
    for (const button of roomButtons) button.classList.remove('voice-drop-target');
    renderSidebar();
  }
  function connect(channel: Channel, origin: VoiceOrigin = { id: server, name: serverName }, transferred = session?.state === 'connected') {
    if (session?.room === channel.id && session.state !== 'ended') return;
    const until = channel.id.startsWith('friend-') ? undefined : call.punishments.get(origin.id);
    if (until !== undefined) {
      if (remainingPunishmentSeconds(until) > 0) {
        updatePunishment();
        return;
      }
      call.punishments.delete(origin.id);
    }
    const mute = { muted: session && session.state !== 'ended' ? session.microphone.muted : call.muted,
      deafened: session && session.state !== 'ended' ? session.microphone.deafened : call.deafened };
    activityMeter.unlock();
    if (preferences.roomSounds !== false) prepareRoomSounds();
    lobbyBaseline = false;
    session?.leave('', false, true, transferred);
    call.mainFeed = '';
    call.gallery = null;
    call.screenLevels.clear();
    call.closedScreens.clear();
    call.roomName = channel.name;
    call.origin = origin;
    const next = new VoiceSession(channel.id, name(), preferences, mute, () => {
      if (call.session === next) call.changed?.();
    }, (id, name) => {
      if (call.session === next) call.moved?.(id, name);
    }, event => call.activity?.(event), transferred);
    call.session = session = next;
    const demo = isDemoRoom(channel.id);
    if (demo) call.watching = true;
    render();
    if (demo) closeSidebar();
    next.join(demo && rooms.some(room => room.id === channel.id) ? demoSettings(channel.id).bots : undefined);
  }

  function demoSettings(roomId: string) {
    let settings = call.demos.get(roomId);
    if (!settings) {
      settings = { bots: [1, 2, 3].map(number => ({ id: `demo-bot-${number}`, name: `Bot ${number}`, screen: true, camera: true })), nextBot: 4 };
      call.demos.set(roomId, settings);
    }
    return settings;
  }

  function drawDemoBots() {
    const host = session;
    if (!host?.demoHost) return;
    const settings = demoSettings(host.room);
    demoBots.replaceChildren(...settings.bots.map(bot => {
      const row = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = bot.name;
      row.append(name);
      for (const [kind, text] of [['screen', 'Tela'], ['camera', 'Câmera']] as const) {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = bot[kind];
        checkbox.setAttribute('aria-label', `${text} de ${bot.name}`);
        checkbox.addEventListener('change', () => {
          if (session !== host) return;
          bot[kind] = checkbox.checked;
          host.updateDemo(settings.bots);
        });
        label.append(checkbox, text);
        row.append(label);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'icon-button';
      remove.innerHTML = icon('trash');
      remove.setAttribute('aria-label', `Remover ${bot.name}`);
      remove.addEventListener('click', () => {
        if (session !== host) return;
        settings.bots = settings.bots.filter(item => item !== bot);
        host.updateDemo(settings.bots);
        drawDemoBots();
        addDemo.focus();
      });
      row.append(remove);
      return row;
    }));
  }
  editDemo.addEventListener('click', () => {
    if (!session?.demoHost) return;
    demoEditor.hidden = !demoEditor.hidden;
    editDemo.setAttribute('aria-expanded', String(!demoEditor.hidden));
    if (!demoEditor.hidden) drawDemoBots();
  });
  addDemo.addEventListener('click', () => {
    if (!session?.demoHost) return;
    const settings = demoSettings(session.room);
    const number = settings.nextBot++;
    settings.bots.push({ id: `demo-bot-${number}`, name: `Bot ${number}`, screen: true, camera: true });
    session.updateDemo(settings.bots);
    drawDemoBots();
  });
  workspace.querySelector('[data-voice-settings]')!.addEventListener('click', () => openSettings());
  retryCall.addEventListener('click', () => {
    if (session?.state === 'ended' && session.canRetry) {
      connect({ id: session.room, name: call.roomName }, call.origin);
    }
  });
  function playMuteConfirmation(sound: RoomSound, current: VoiceSession, stillApplied: () => boolean) {
    const allowed = () => !lifetime.signal.aborted && session === current
      && current.state === 'connected' && preferences.roomSounds !== false
      && stillApplied();
    void playRoomSound(sound, {
      volume: preferences.outputVolume * (preferences.roomSoundVolume ?? 60) / 10000,
      output: preferences.output,
      allowed,
    });
  }
  function toggleMicrophone() {
    const current = session;
    if (!current || current.state === 'ended') {
      call.muted = !call.muted;
      render();
      return;
    }
    const before = current.microphone.muted;
    current.toggleMicrophone();
    const muted = current.microphone.muted;
    call.muted = muted;
    if (before !== muted) {
      playMuteConfirmation(muted ? 'microfone-silenciado' : 'microfone-ativado', current,
        () => current.microphone.muted === muted && !current.deafened);
    }
  }
  function toggleHeadphones() {
    const current = session;
    if (!current || current.state === 'ended') {
      call.deafened = !call.deafened;
      render();
      return;
    }
    const before = current.deafened;
    current.toggleHeadphones();
    const deafened = current.deafened;
    call.deafened = current.microphone.deafened;
    if (before !== deafened) {
      playMuteConfirmation(deafened ? 'audio-desativado' : 'audio-ativado', current, () => current.deafened === deafened);
    }
    if (!current.deafened) for (const [id, element] of audio) {
      if (blockedAudio.has(id)) playAudio(id, element);
    }
  }
  dockMic.addEventListener('click', toggleMicrophone);
  dockNoise.addEventListener('click', async () => {
    if (!session || changingNoise) return;
    changingNoise = true;
    noiseError = '';
    render();
    try {
      const enabled = !preferences.noiseSuppression;
      await session.microphone.setNoiseSuppression(enabled);
      preferences = { ...preferences, noiseSuppression: enabled };
      if (participant) {
        try { saveVoicePreferences(participant.email, preferences); } catch { /* Applied to the current call. */ }
      }
    } catch {
      noiseError = 'Não foi possível alterar a supressão de ruído neste microfone.';
    } finally {
      changingNoise = false;
      if (!lifetime.signal.aborted) render();
    }
  });
  dockHeadphones.addEventListener('click', toggleHeadphones);
  if (participant) listenForVoiceShortcuts(participant.email, { microphone: dockMic, audio: dockHeadphones },
    () => session?.state === 'connected', lifetime.signal);
  dockCamera.addEventListener('click', () => void session?.toggleCamera());
  dockScreen.addEventListener('click', () => void session?.toggleScreen());
  dockLeave.addEventListener('click', () => {
    const button = [...roomButtons].find(item => item.dataset.voiceRoom === session?.room);
    session?.leave('', false, true);
    button?.focus();
  });
  play.addEventListener('click', () => {
    unlockVoiceAudio();
    for (const [id, element] of audio) playAudio(id, element);
  });
  togglePreviews.addEventListener('click', () => {
    call.previewsHidden = !previews.hidden;
    showScreen();
  });
  toggleCameras.addEventListener('click', () => {
    call.camerasHidden = !call.camerasHidden;
    showScreen();
  });
  maximizeScreens.addEventListener('click', () => {
    call.gallery = call.gallery === 'screens' ? null : 'screens';
    showScreen();
  });
  maximizeCameras.addEventListener('click', () => {
    call.gallery = call.gallery === 'cameras' ? null : 'cameras';
    if (call.gallery === 'cameras') call.previewsHidden = false;
    showScreen();
  });
  watch.addEventListener('click', () => {
    call.watching = !call.watching;
    showScreen();
    if (call.watching) {
      closeSidebar();
      closeStream.focus();
    }
  });
  closeStream.addEventListener('click', () => {
    call.watching = false;
    showScreen();
    (watch.getClientRects().length ? watch : workspace.querySelector<HTMLButtonElement>('.mobile-menu'))?.focus();
  });

  call.changed = render;
  call.activity = event => {
    if (event.type === 'check-absence') {
      const active = call.session;
      if (active?.state !== 'connected') return;
      showActivity(event.senderName + ' está chamando você na call.');
      notifyVoiceAlert(active, 'verificar-ausencia', event.sound);
      return;
    }
    if (event.type === 'punished' || event.type === 'disconnect') {
      if (event.type === 'punished') {
        const until = Date.now() + event.seconds * 1000;
        call.punishments.set(call.origin ? call.origin.id : server, until);
        updatePunishment();
        if (event.showAlert) call.moderationAlert.show(event.type, until);
      } else {
        call.moderationAlert.show(event.type);
      }
      return;
    }
    if (event.type === 'peer-moderated') {
      const active = call.session;
      if (active?.state !== 'connected' || (event.member.userId !== undefined && event.member.userId === active.self?.userId)) return;
      showActivity(event.reason === 'punished'
        ? `${event.member.name} recebeu um castigo na ${call.roomName}`
        : `${event.member.name} foi desconectado da ${call.roomName}`);
      notifyVoiceAlert(active, 'moderacao', event.sound);
      return;
    }
    if (event.type === 'voce-entrou') call.moderationAlert.preload();
    if (event.type === 'entrou' || event.type === 'saiu') {
      showActivity(event.type === 'entrou'
        ? `${event.member.name} entrou na ${call.roomName}`
        : `${event.member.name} saiu da ${call.roomName}`);
    }
    const entering = event.type === 'voce-entrou';
    const leaving = event.type === 'voce-saiu';
    const active = call.session;
    const sameAccount = event.member.userId !== undefined && event.member.userId === active?.self?.userId;
    if (event.transferred && (entering || leaving || sameAccount)) return;
    const moveEntry = event.transferred && event.type === 'entrou';
    const moveExit = event.transferred && event.type === 'saiu';
    const allowed = () => !lifetime.signal.aborted && !call.session?.deafened && preferences.roomSounds !== false
      && (leaving || call.session === active)
      && (!entering || call.session?.self?.id === event.member.id);
    if (!allowed()) return;
    const play = (priority = false) => {
      if (!allowed() || (!priority && !event.transferred && performance.now() - call.lastRoomSound < 400)) return;
      call.lastRoomSound = performance.now();
      let url: string | null | undefined;
      if (preferences.customRoomSounds !== false) {
        if (moveEntry) url = event.member.moveEntrySoundUrl;
        else if (moveExit) url = event.member.moveExitSoundUrl;
        else if (event.type === 'entrou') url = event.member.entrySoundUrl;
        else if (event.type === 'saiu') url = event.member.exitSoundUrl;
      }
      return playRoomSound(moveEntry ? 'chegou-movido' : moveExit ? 'saiu-movido' : event.type, {
        volume: preferences.outputVolume * (preferences.roomSoundVolume ?? 60) / 10000,
        output: preferences.output, url: url ?? undefined, allowed,
      });
    };
    if (leaving) {
      void play(true);
      return;
    }
    const delay = 400 - (performance.now() - call.lastRoomSound);
    if (delay > 0 && entering) setTimeout(() => play(), Math.ceil(delay) + 1);
    else void play();
  };
  call.moved = (id, name) => connect(rooms.find(room => room.id === id) ?? { id, name }, call.origin, true);
  call.playbackChanged = () => {
    updatePlayButton();
    updateNotice();
  };
  function configureVoice(next: VoicePreferences) {
      if (next.lobbySounds !== preferences.lobbySounds) lobbyBaseline = false;
      preferences = next;
      if (next.roomSounds === false || next.roomSoundVolume === 0 || next.outputVolume === 0) stopRoomSound();
      if (session?.state !== 'ended') session?.microphone.configure(next);
      updateAudio();
      showScreen();
      for (const [id, element] of audio) routeAudio(id, element);
      if (lobbyEnabled()) void refreshPresence();
  }
  if (participant) mountQuickVoiceSettings(workspace, participant.email, configureVoice, () => openSettings('voice'), lifetime.signal);
  render();
  return {
    refreshPresence,
    refreshProfiles: renderSidebar,
    joinPrivate(room: string, friend: string) {
      connect({ id: room, name: friend }, { name: 'Chamada privada' }, false);
    },
    leavePrivate() {
      if (session?.room.startsWith('friend-') && session.state !== 'ended') session.leave();
    },
    privateState(room?: string) {
      if (!room || session?.room !== room) return undefined;
      return { state: session.state, peers: session.peers.size, muted: session.microphone.muted, deafened: session.deafened, notice: session.notice };
    },
    togglePrivateMic() {
      if (session?.room.startsWith('friend-')) toggleMicrophone();
    },
    togglePrivateAudio() {
      if (session?.room.startsWith('friend-')) toggleHeadphones();
    },
    enableMicrophone() {
      if (session?.state === 'connected' && !session.microphone.available) void session.microphone.start();
    },
    configure: configureVoice,
    dispose(keepCall = false) {
      lifetime.abort();
      clearTimeout(toastTimer);
      clearTimeout(voiceAlertTimer);
      toast.remove();
      for (const [id, slot] of tiles) removeTile(id, slot);
      clearTimeout(presenceTimer);
      clearTimeout(punishmentTimer);
      if (!keepCall || session?.state === 'ended') {
        session?.leave();
        call.session = undefined;
        call.origin = undefined;
        call.watching = false;
        call.mainFeed = '';
        call.gallery = null;
        call.screenLevels.clear();
        call.closedScreens.clear();
      }
      if (!keepCall) ownIds.clear();
      if (!keepCall) call.moderationAlert.clear();
      if (!keepCall) call.punishments.clear();
      if (!keepCall) stopRoomSound();
      call.changed = undefined;
      call.moved = undefined;
      call.playbackChanged = undefined;
      call.activity = undefined;
      session = undefined;
      activityMeter.dispose();
    },
  };
}
