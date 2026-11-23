import { VoiceMicrophone } from './voice-microphone';
import type { VoicePreferences } from './voice-preferences';
import { createVoiceTransport } from './voice-transport';
import { HttpVoiceTransport } from './voice-http';
import type { ProfileSounds } from './accounts';
import { createDemoMedia, isDemoRoom, type DemoBot, type DemoPeer } from './voice-demo';

const screenWithoutAudioNotice = 'A fonte selecionada está sendo compartilhada sem áudio.';

export type VoiceMember = ProfileSounds & { id: string; userId?: number; name: string; muted: boolean; sharing: boolean; deafened?: boolean;
  serverMuted?: boolean; serverDeafened?: boolean; screenAudioCapable?: boolean; sharingAudio?: boolean;
  cameraCapable?: boolean; cameraOn?: boolean };

type ModerationReason = 'punished' | 'disconnect';
export type VoiceActivity = { type: 'entrou' | 'saiu' | 'voce-entrou' | 'voce-saiu' | 'transmitiu';
  member: VoiceMember; transferred?: boolean }
  | { type: 'peer-moderated'; member: VoiceMember; reason: ModerationReason; sound?: string | null }
  | { type: 'check-absence'; senderName: string; sound: string | null }
  | { type: 'disconnect' } | { type: 'punished'; seconds: number; showAlert: boolean };

type Signal = { description: RTCSessionDescriptionInit } | { candidate: RTCIceCandidateInit };
type ServerMessage =
  | { type: 'welcome'; self: VoiceMember; members: VoiceMember[]; iceServers: RTCIceServer[]; demoHost?: boolean; demoBots?: DemoBot[] }
  | { type: 'demo'; bots: DemoBot[] }
  | { type: 'screen-subscription'; from: string; watching: boolean }
  | { type: 'check-absence'; senderName: string; sound: string | null }
  | { type: 'joined'; member: VoiceMember; transferred?: boolean }
  | { type: 'state'; member: VoiceMember }
  | { type: 'left'; id: string; transferred?: boolean; moderation?: ModerationReason; sound?: string | null }
  | { type: 'move'; room: string; name: string }
  | { type: 'disconnect' }
  | { type: 'punished'; seconds: number }
  | ({ type: 'signal'; from: string } & Signal)
  | { type: 'rejected'; reason: 'full' | 'invalid' };

export type VoicePeer = {
  member: VoiceMember;
  connection: RTCPeerConnection;
  audio?: MediaStream;
  video?: MediaStream;
  camera?: MediaStream;
  screenAudio?: MediaStream;
  microphoneSender?: RTCRtpSender;
  screenSender?: RTCRtpSender;
  screenPaused?: boolean;
  cameraSender?: RTCRtpSender;
  screenAudioSender?: RTCRtpSender;
  candidates: RTCIceCandidateInit[];
  queue: Promise<void>;
  failed: boolean;
  slow: boolean;
  iceRestarted?: boolean;
  restartPending?: boolean;
  ignoreOffer?: boolean;
  timer?: ReturnType<typeof setTimeout>;
};

export class VoiceSession {
  state: 'connecting' | 'connected' | 'ended' = 'connecting';
  readonly peers = new Map<string, VoicePeer>();
  self?: VoiceMember;
  screen?: MediaStream;
  pickingScreen = false;
  camera?: MediaStream;
  pickingCamera = false;
  notice = '';
  connectionNotice = '';
  canRetry = false;
  demoPeers?: DemoPeer[];
  demoHost = false;
  private demoMedia?: ReturnType<typeof createDemoMedia>;
  private demoBots: readonly DemoBot[] = [];
  private readonly pausedScreens = new Set<string>();

  setWatchingScreen(peerId: string, watching: boolean) {
    if (watching === !this.pausedScreens.has(peerId)) return;
    if (watching) this.pausedScreens.delete(peerId);
    else this.pausedScreens.add(peerId);
    if (this.peers.has(peerId)) this.send({ type: 'screen-subscription', to: peerId, watching });
    else if (this.demoMedia) this.renderDemo(this.demoBots);
  }
  readonly microphone: VoiceMicrophone;
  private socket?: ReturnType<typeof createVoiceTransport>;
  private timer?: ReturnType<typeof setTimeout>;
  private iceServers: RTCIceServer[] = [];

  constructor(readonly room: string, private name: string, preferences: VoicePreferences,
    mute: { muted: boolean; deafened: boolean }, private changed: () => void,
    private moved: (room: string, name: string) => void, private activity?: (event: VoiceActivity) => void,
    private transferred = false) {
    this.microphone = new VoiceMicrophone(preferences, () => this.microphoneChanged());
    this.microphone.muted = mute.muted;
    this.microphone.deafened = mute.deafened;
  }

  get deafened() { return this.microphone.deafened || Boolean(this.self?.serverDeafened); }
  get microphoneLocked() { return Boolean(this.self?.serverMuted || this.self?.serverDeafened); }
  private get outgoingMicrophone() { return this.microphoneLocked ? null : this.microphone.track; }

  join(demoBots?: readonly DemoBot[]) {
    if (!window.RTCPeerConnection) {
      this.leave('Este navegador não oferece suporte a chamadas de voz.');
      return;
    }

    try {
      this.socket = createVoiceTransport(this.room);
      this.socket.addEventListener('open', () => this.send({ type: 'join', room: this.room, name: this.name,
        muted: this.microphone.silent, deafened: this.microphone.deafened, screenAudioCapable: true, cameraCapable: true,
        transferred: this.transferred, demoBots }));
      this.socket.addEventListener('message', event => this.receive(JSON.parse((event as MessageEvent<string>).data) as ServerMessage));
      this.socket.addEventListener('status', event => {
        this.connectionNotice = (event as MessageEvent).data.reconnecting ? 'Conexão instável, reconectando…' : '';
        this.changed();
      });
      this.socket.addEventListener('close', () => {
        if (this.state !== 'ended') this.leave('A conexão com o canal caiu. Entre novamente para continuar.', true);
      });
      this.timer = setTimeout(() => this.leave('O servidor de voz não respondeu. Tente entrar novamente.', true), 30_000);
      void this.microphone.start();
    } catch {
      this.leave('Não foi possível abrir uma conexão com o servidor de voz.');
    }
  }

  updateDemo(bots: readonly DemoBot[]) {
    if (!this.demoHost || this.state !== 'connected') return;
    this.renderDemo(bots);
    this.send({ type: 'demo', bots });
    this.changed();
  }

  private renderDemo(bots: readonly DemoBot[]) {
    if (!HTMLCanvasElement.prototype.captureStream) return;
    this.demoMedia ??= createDemoMedia();
    this.demoBots = bots;
    this.demoPeers = this.demoMedia.update(bots, this.pausedScreens);
  }

  leave(notice = '', canRetry = false, voluntary = false, transferred = false) {
    if (this.state === 'ended') return;
    if (voluntary && this.self) this.activity?.({ type: 'voce-saiu', member: this.self, transferred });
    this.state = 'ended';
    this.notice = notice;
    this.connectionNotice = '';
    this.canRetry = canRetry;
    clearTimeout(this.timer);
    if (this.socket instanceof HttpVoiceTransport) this.socket.close(transferred);
    else this.socket?.close();
    this.microphone.dispose();
    this.screen?.getTracks().forEach(track => track.stop());
    this.screen = undefined;
    this.camera?.getTracks().forEach(track => track.stop());
    this.camera = undefined;
    this.demoMedia?.stop();
    this.demoMedia = undefined;
    this.demoPeers = undefined;
    this.self = undefined;
    for (const peer of this.peers.values()) this.closePeer(peer);
    this.peers.clear();
    this.changed();
  }

  toggleMicrophone() {
    if (this.self && !this.microphoneLocked) this.microphone.toggle();
  }

  toggleHeadphones() {
    if (this.self && !this.self.serverDeafened) this.microphone.setDeafened(!this.microphone.deafened);
  }

  private microphoneChanged() {
    if (this.state === 'ended') return;
    for (const peer of this.peers.values()) {
      if (peer.microphoneSender?.track !== this.outgoingMicrophone) this.run(peer, () => this.syncMicrophone(peer));
    }
    const muted = this.microphone.silent;
    if (this.self && (this.self.muted !== muted || Boolean(this.self.deafened) !== this.microphone.deafened)) {
      this.self.muted = muted;
      this.self.deafened = this.microphone.deafened;
      this.publish();
    } else {
      this.changed();
    }
  }

  async toggleCamera() {
    if (isDemoRoom(this.room)) return;
    if (!this.self || this.pickingCamera) return;
    if (this.camera) {
      this.stopCamera();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.notice = 'A câmera não está disponível neste navegador.';
      this.changed();
      return;
    }
    this.pickingCamera = true;
    this.notice = '';
    this.changed();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 20 } },
      });
      const track = stream.getVideoTracks()[0];
      if (!this.self || !track || track.readyState !== 'live') {
        stream.getTracks().forEach(item => item.stop());
        return;
      }
      this.camera = stream;
      this.self.cameraOn = true;
      track.addEventListener('ended', () => {
        if (this.camera === stream) this.stopCamera();
      }, { once: true });
      for (const peer of this.peers.values()) this.run(peer, () => this.syncCamera(peer));
      this.publish();
    } catch (error) {
      if (this.state !== 'ended') this.notice = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Permita o uso da câmera no navegador para ligar o vídeo.'
        : 'Não foi possível ligar a câmera. Confira se ela está disponível.';
    } finally {
      this.pickingCamera = false;
      this.changed();
    }
  }

  private stopCamera() {
    this.camera?.getTracks().forEach(track => track.stop());
    this.camera = undefined;
    if (!this.self) return;
    this.self.cameraOn = false;
    for (const peer of this.peers.values()) this.run(peer, () => this.syncCamera(peer));
    this.publish();
  }

  async toggleScreen() {
    if (isDemoRoom(this.room)) return;
    if (!this.self || this.pickingScreen) return;
    if (this.screen) {
      this.stopScreen();
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.notice = 'Este navegador não oferece compartilhamento de tela. Abra o Discordo em um navegador de computador compatível.';
      this.changed();
      return;
    }
    this.pickingScreen = true;
    this.notice = '';
    this.changed();
    try {
      const options: DisplayMediaStreamOptions & { systemAudio: 'include'; selfBrowserSurface: 'exclude' } = {
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 15, max: 15 } },
        audio: true,
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(options);
      const track = stream.getVideoTracks()[0];
      if (!this.self || !track || track.readyState === 'ended') {
        stream.getTracks().forEach(item => item.stop());
        return;
      }
      this.screen = stream;
      const audioTrack = stream.getAudioTracks()[0];
      this.self.sharingAudio = Boolean(audioTrack);
      if (!audioTrack) this.notice = screenWithoutAudioNotice;
      audioTrack?.addEventListener('ended', () => {
        if (this.screen !== stream || !this.self) return;
        this.self.sharingAudio = false;
        this.publish();
      });
      track.addEventListener('ended', () => {
        if (this.screen === stream) this.stopScreen();
      });
      for (const peer of this.peers.values()) this.run(peer, () => this.syncScreen(peer));
      this.self.sharing = true;
      this.publish();
    } catch (error) {
      if (this.state !== 'ended') {
        this.notice = error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name)
          ? 'Compartilhamento cancelado ou não autorizado.'
          : 'Não foi possível compartilhar a tela. Tente selecionar outra janela ou aba.';
        this.stopScreen();
      }
    } finally {
      this.pickingScreen = false;
      this.changed();
    }
  }

  private stopScreen() {
    if (this.notice === screenWithoutAudioNotice) this.notice = '';
    this.screen?.getTracks().forEach(track => track.stop());
    this.screen = undefined;
    if (!this.self) return;
    this.self.sharing = false;
    this.self.sharingAudio = false;
    for (const peer of this.peers.values()) this.run(peer, () => this.syncScreen(peer));
    this.publish();
  }

  private send(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private publish() {
    if (this.self) this.send({ type: 'state', muted: this.self.muted, sharing: this.self.sharing,
      sharingAudio: this.self.sharingAudio, cameraOn: this.self.cameraOn, deafened: this.microphone.deafened });
    this.changed();
  }

  private receive(message: ServerMessage) {
    if (this.state === 'ended') return;
    if (message.type === 'check-absence') {
      if (this.state === 'connected') this.activity?.(message);
      return;
    }
    if (message.type === 'move') {
      this.moved(message.room, message.name);
      return;
    }
    if (message.type === 'disconnect') {
      if (this.state === 'connected') this.activity?.({ type: message.type });
      this.leave('Você foi desconectado da chamada pela administração.');
      return;
    }
    if (message.type === 'punished') {
      const showAlert = this.state === 'connected';
      this.activity?.({ type: 'punished', seconds: message.seconds, showAlert });
      this.leave();
      return;
    }
    if (message.type === 'rejected') {
      this.leave(message.reason === 'full' ? 'O canal de voz atingiu o limite de participantes.' : 'Não foi possível entrar neste canal.');
      return;
    }
    if (message.type === 'welcome') {
      const initial = this.state === 'connecting';
      clearTimeout(this.timer);
      for (const peer of this.peers.values()) this.closePeer(peer);
      this.peers.clear();
      const sharing = Boolean(this.screen?.getVideoTracks().some(track => track.readyState === 'live'));
      const localState = {
        muted: this.microphone.silent,
        deafened: this.microphone.deafened,
        sharing,
        sharingAudio: sharing && Boolean(this.screen?.getAudioTracks().some(track => track.readyState === 'live')),
        cameraOn: Boolean(this.camera?.getVideoTracks().some(track => track.readyState === 'live')),
      };
      this.self = { ...message.self, ...localState };
      this.iceServers = message.iceServers;
      this.state = 'connected';
      if (isDemoRoom(this.room)) {
        this.demoHost = message.demoHost === true;
        this.renderDemo(message.demoBots ?? []);
      }
      for (const member of message.members) this.addPeer(member, true);
      if (localState.muted !== message.self.muted || localState.deafened !== Boolean(message.self.deafened)
        || localState.sharing !== message.self.sharing || localState.sharingAudio !== Boolean(message.self.sharingAudio)
        || localState.cameraOn !== Boolean(message.self.cameraOn)) {
        this.publish();
      } else this.changed();
      if (initial) this.activity?.({ type: 'voce-entrou', member: this.self, transferred: this.transferred });
      return;
    }
    if (message.type === 'demo' && isDemoRoom(this.room)) this.renderDemo(message.bots);
    if (message.type === 'joined' && !this.peers.has(message.member.id)) {
      this.addPeer(message.member, false);
      this.activity?.({ type: 'entrou', member: message.member, transferred: message.transferred });
    }
    if (message.type === 'left') {
      const peer = this.peers.get(message.id);
      if (peer) {
        this.closePeer(peer);
        this.activity?.(message.moderation
          ? { type: 'peer-moderated', member: peer.member, reason: message.moderation, sound: message.sound }
          : { type: 'saiu', member: peer.member, transferred: message.transferred });
      }
      this.peers.delete(message.id);
    }
    if (message.type === 'state') {
      if (this.self && message.member.id === this.self.id) {
        this.self.serverMuted = message.member.serverMuted;
        this.self.serverDeafened = message.member.serverDeafened;
        this.microphoneChanged();
        return;
      }
      const peer = this.peers.get(message.member.id);
      if (peer) {
        if (!peer.member.sharing && message.member.sharing) this.activity?.({ type: 'transmitiu', member: message.member });
        peer.member = message.member;
      }
    }
    if (message.type === 'screen-subscription') {
      const peer = this.peers.get(message.from);
      if (peer && !isDemoRoom(this.room)) {
        peer.screenPaused = !message.watching;
        this.run(peer, () => this.syncScreen(peer));
      }
      return;
    }
    if (message.type === 'signal') {
      const peer = this.peers.get(message.from);
      if (peer) this.run(peer, () => this.applySignal(peer, message));
      return;
    }
    this.changed();
  }

  private addPeer(member: VoiceMember, offerer: boolean) {
    if (this.peers.has(member.id)) return;
    const connection = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: VoicePeer = { member, connection, candidates: [], queue: Promise.resolve(), failed: false, slow: false };
    this.peers.set(member.id, peer);
    if (this.pausedScreens.has(member.id)) {
      this.send({ type: 'screen-subscription', to: member.id, watching: false });
    }
    connection.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ type: 'signal', to: member.id, candidate: candidate.toJSON() });
    };
    const waitForPeer = () => {
      peer.timer = setTimeout(() => {
        peer.timer = undefined;
        peer.slow = true;
        this.changed();
      }, 10_000);
    };
    waitForPeer();
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'failed') {
        this.restartPeer(peer);
        return;
      }
      if (['connected', 'closed'].includes(connection.connectionState)) {
        clearTimeout(peer.timer);
        peer.timer = undefined;
        peer.slow = false;
      } else if (connection.connectionState === 'disconnected' && !peer.timer && !peer.slow) {
        waitForPeer();
      }
      this.changed();
    };
    connection.onnegotiationneeded = () => this.offerRestart(peer);
    connection.ontrack = ({ track, transceiver }) => {
      if (track.kind === 'audio' && connection.getTransceivers().filter(item => item.receiver.track.kind === 'audio')[1] === transceiver) {
        peer.screenAudio = new MediaStream([track]);
      } else if (track.kind === 'audio') peer.audio = new MediaStream([track]);
      else if (track.kind === 'video') {
        const stream = new MediaStream([track]);
        if (connection.getTransceivers().filter(item => item.receiver.track.kind === 'video')[1] === transceiver) peer.camera = stream;
        else peer.video = stream;
      }
      this.changed();
    };
    if (!offerer) return;
    peer.microphoneSender = connection.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    if (!isDemoRoom(this.room)) {
      peer.screenSender = connection.addTransceiver('video', { direction: 'sendrecv' }).sender;
      if (member.screenAudioCapable) peer.screenAudioSender = connection.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      if (member.cameraCapable) peer.cameraSender = connection.addTransceiver('video', { direction: 'sendrecv' }).sender;
    }
    this.run(peer, async () => {
      await this.syncMicrophone(peer);
      await this.syncScreen(peer);
      await this.syncCamera(peer);
      await connection.setLocalDescription(await connection.createOffer());
      this.send({ type: 'signal', to: member.id, description: connection.localDescription });
    });
  }

  private closePeer(peer: VoicePeer) {
    clearTimeout(peer.timer);
    peer.connection.onconnectionstatechange = null;
    peer.connection.onnegotiationneeded = null;
    peer.connection.onicecandidate = null;
    peer.connection.ontrack = null;
    peer.connection.close();
  }

  private restartPeer(peer: VoicePeer) {
    if (peer.iceRestarted) {
      this.failPeer(peer);
      return;
    }
    peer.iceRestarted = peer.restartPending = true;
    peer.slow = true;
    clearTimeout(peer.timer);
    peer.timer = setTimeout(() => this.failPeer(peer), 15000);
    peer.connection.restartIce();
    this.offerRestart(peer);
    this.changed();
  }

  private offerRestart(peer: VoicePeer) {
    if (!peer.restartPending) return;
    this.run(peer, async () => {
      const { connection } = peer;
      if (!peer.restartPending || connection.signalingState !== 'stable') return;
      peer.restartPending = false;
      await connection.setLocalDescription(await connection.createOffer({ iceRestart: true }));
      this.send({ type: 'signal', to: peer.member.id, description: connection.localDescription });
    });
  }

  private failPeer(peer: VoicePeer) {
    if (peer.connection.signalingState === 'closed') return;
    peer.failed = true;
    this.closePeer(peer);
    this.changed();
  }

  private async syncMicrophone(peer: VoicePeer) {
    await peer.microphoneSender?.replaceTrack(this.outgoingMicrophone);
  }

  private async syncScreen(peer: VoicePeer) {
    const screen = peer.screenPaused ? undefined : this.screen;
    await peer.screenSender?.replaceTrack(screen?.getVideoTracks()[0] ?? null);
    const audio = screen?.getAudioTracks()[0];
    await peer.screenAudioSender?.replaceTrack(audio?.readyState === 'live' ? audio : null);
  }

  private async syncCamera(peer: VoicePeer) {
    await peer.cameraSender?.replaceTrack(this.camera?.getVideoTracks()[0] ?? null);
  }

  private async applySignal(peer: VoicePeer, signal: Signal) {
    const { connection, member } = peer;
    const matches = (candidate: RTCIceCandidateInit) => connection.remoteDescription &&
      (!candidate.usernameFragment || connection.remoteDescription.sdp.split(/\r?\n/).includes(`a=ice-ufrag:${candidate.usernameFragment}`));
    if ('candidate' in signal) {
      if (peer.ignoreOffer) return;
      if (matches(signal.candidate)) await connection.addIceCandidate(signal.candidate);
      else if (peer.candidates.length < 96) peer.candidates.push(signal.candidate);
      return;
    }
    const collision = signal.description.type === 'offer' && connection.signalingState !== 'stable';
    peer.ignoreOffer = collision && (this.self?.id ?? '') < member.id;
    if (peer.ignoreOffer) return;
    if (signal.description.type === 'answer' && connection.signalingState !== 'have-local-offer') return;
    if (collision && connection.signalingState === 'have-local-offer') {
      await connection.setLocalDescription({ type: 'rollback' });
    }
    await connection.setRemoteDescription(signal.description);
    for (const candidate of peer.candidates.splice(0)) {
      if (matches(candidate)) await connection.addIceCandidate(candidate);
    }
    if (signal.description.type !== 'offer') return;
    const videos = connection.getTransceivers().filter(item => item.receiver.track.kind === 'video');
    for (const transceiver of connection.getTransceivers()) {
      transceiver.direction = 'sendrecv';
      if (transceiver.receiver.track.kind === 'audio') {
        if (!peer.microphoneSender || peer.microphoneSender === transceiver.sender) {
          peer.microphoneSender = transceiver.sender;
          await this.syncMicrophone(peer);
        } else peer.screenAudioSender = transceiver.sender;
      } else if (transceiver === videos[0]) {
        peer.screenSender = transceiver.sender;
      } else if (transceiver === videos[1]) {
        peer.cameraSender = transceiver.sender;
      }
    }
    await this.syncScreen(peer);
    await this.syncCamera(peer);
    await connection.setLocalDescription(await connection.createAnswer());
    this.send({ type: 'signal', to: member.id, description: connection.localDescription });
  }

  private enqueue(peer: VoicePeer, work: () => Promise<void>) {
    const next = peer.queue.then(() => {
      if (!peer.failed && peer.connection.signalingState !== 'closed') return work();
    });
    peer.queue = next.catch(() => {});
    return next;
  }

  private run(peer: VoicePeer, work: () => Promise<void>) {
    void this.enqueue(peer, work).catch(() => this.failPeer(peer));
  }
}

