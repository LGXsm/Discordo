import { openMicrophone, type VoicePreferences } from './voice-preferences';
import { microphoneError, microphoneRestriction, pendingMicrophone } from './audio-permissions';
import { createNoiseSuppressor, rnnoiseSupported } from './rnnoise';

export class VoiceMicrophone {
  requesting = false;
  muted = false;
  deafened = false;
  notice = '';
  private revision = 0;
  private permissionTimer?: ReturnType<typeof setTimeout>;
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private gain?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private suppressor?: AudioWorkletNode;
  private loadingSuppressor?: Promise<void>;
  private nativeSuppression = !rnnoiseSupported();

  constructor(private preferences: VoicePreferences, private changed: () => void) {}

  get available() {
    return Boolean(this.stream?.getAudioTracks()[0]);
  }

  get silent() {
    return !this.available || this.muted || this.deafened || this.preferences.inputVolume === 0;
  }

  get gainUnavailable() {
    return this.available && ![0, 100].includes(this.preferences.inputVolume) && this.context?.state !== 'running';
  }

  get noiseEngine() { return this.suppressor ? 'RNNoise' : 'navegador'; }

  get track() {
    if (!this.stream) return null;
    return this.context?.state === 'running' && this.destination
      ? this.destination.stream.getAudioTracks()[0] : this.stream.getAudioTracks()[0];
  }

  async start() {
    const restricted = microphoneRestriction();
    if (restricted) {
      this.notice = restricted;
      this.changed();
      return;
    }
    const request = ++this.revision;
    this.requesting = true;
    this.notice = 'Aguardando autorização do microfone. Você pode ouvir enquanto isso.';
    clearTimeout(this.permissionTimer);
    this.permissionTimer = setTimeout(() => {
      this.notice = pendingMicrophone;
      this.changed();
    }, 5_000);
    this.changed();
    try {
      const capture = openMicrophone(this.preferences.input, this.nativeSuppression && this.preferences.noiseSuppression);
      this.prepareContext();
      const { stream, fallback } = await capture;
      if (request !== this.revision) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (!track) {
        stream.getTracks().forEach(item => item.stop());
        throw new Error('no audio track');
      }
      this.source?.disconnect();
      this.stream?.getTracks().forEach(item => item.stop());
      this.stream = stream;
      track.enabled = !this.silent;
      if (this.context && this.gain) {
        try {
          this.source = this.context.createMediaStreamSource(stream);
          this.source.connect(this.suppressor ?? this.gain);
        } catch {
          this.closeContext();
        }
      }
      this.notice = fallback ? 'O microfone escolhido está indisponível. Usando a entrada padrão.' : '';
      if (this.nativeSuppression && track.getSettings().noiseSuppression !== this.preferences.noiseSuppression) {
        this.notice = 'O navegador não confirmou a configuração de supressão de ruído.';
      } else if (this.nativeSuppression && rnnoiseSupported()) {
        this.notice = 'RNNoise indisponível. Usando a supressão de ruído do navegador.';
      }
      track.addEventListener('ended', () => {
        if (this.stream !== stream) return;
        this.releaseStream();
        this.notice = 'O microfone foi desconectado. Você pode continuar ouvindo ou ativar outra entrada.';
        this.changed();
      });
      void this.syncNoiseSuppression().catch(() => {
        if (this.stream !== stream) return;
        this.nativeSuppression = true;
        void this.applyNativeSuppression();
      });
    } catch (error) {
      if (request !== this.revision) return;
      if (!this.available) this.closeContext();
      this.notice = this.available ? 'Não foi possível mudar de microfone. A entrada anterior continua ativa.'
        : microphoneError(error);
    } finally {
      if (request === this.revision) {
        clearTimeout(this.permissionTimer);
        this.requesting = false;
        this.changed();
      }
    }
  }

  toggle() {
    if (this.deafened) return;
    const track = this.stream?.getAudioTracks()[0];
    if (!track) {
      if (this.requesting) {
        this.cancelRequest();
        this.notice = 'A tentativa foi cancelada. Clique em Permitir microfone para tentar novamente.';
        this.changed();
      } else {
        void this.start();
      }
      return;
    }
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
    this.muted = !this.muted;
    track.enabled = !this.silent;
    this.changed();
  }

  setDeafened(deafened: boolean) {
    this.deafened = deafened;
    const track = this.stream?.getAudioTracks()[0];
    if (track) track.enabled = !this.silent;
    this.changed();
  }

  async setNoiseSuppression(enabled: boolean) {
    const previous = this.preferences.noiseSuppression;
    this.preferences = { ...this.preferences, noiseSuppression: enabled };
    try {
      if (this.nativeSuppression && this.available) {
        await this.applyNativeSuppression();
        return;
      }
      await this.syncNoiseSuppression();
      this.changed();
    } catch (error) {
      this.preferences = { ...this.preferences, noiseSuppression: previous };
      throw error;
    }
  }

  configure(preferences: VoicePreferences) {
    const switched = preferences.input !== this.preferences.input;
    const noiseChanged = preferences.noiseSuppression !== this.preferences.noiseSuppression;
    this.preferences = preferences;
    const track = this.stream?.getAudioTracks()[0];
    if (track) track.enabled = !this.silent;
    if (this.context && this.gain) {
      this.gain.gain.setTargetAtTime(preferences.inputVolume / 100, this.context.currentTime, .02);
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    }
    if (switched && (this.available || this.requesting)) void this.start();
    else {
      if (noiseChanged) void this.setNoiseSuppression(preferences.noiseSuppression).catch(() => {
        this.notice = 'Não foi possível alterar a supressão de ruído.';
        this.changed();
      });
      this.changed();
    }
  }

  dispose() {
    this.cancelRequest();
    this.releaseStream();
  }

  private cancelRequest() {
    this.revision++;
    clearTimeout(this.permissionTimer);
    this.requesting = false;
    if (!this.available) this.closeContext();
  }

  private prepareContext() {
    if (this.context || !window.AudioContext) return;
    try {
      const context = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      this.context = context;
      this.gain = context.createGain();
      this.gain.gain.value = this.preferences.inputVolume / 100;
      this.destination = context.createMediaStreamDestination();
      this.destination.channelCount = 1;
      this.gain.connect(this.destination);
      context.onstatechange = this.changed;
      void context.resume().catch(() => {});
    } catch {
      this.closeContext();
    }
  }

  private async applyNativeSuppression() {
    const track = this.stream?.getAudioTracks()[0];
    if (!track) return;
    const noiseSuppression = this.preferences.noiseSuppression;
    let applied = false;
    try {
      await track.applyConstraints({ ...track.getConstraints(), noiseSuppression });
      applied = track.getSettings().noiseSuppression === noiseSuppression;
    } catch { /* Some browsers only apply suppression when opening the device. */ }
    if (this.stream?.getAudioTracks()[0] !== track || noiseSuppression !== this.preferences.noiseSuppression) return;
    if (!applied) {
      await this.start();
    } else {
      if (rnnoiseSupported()) this.notice = 'RNNoise indisponível. Usando a supressão de ruído do navegador.';
      this.changed();
    }
  }

  private closeContext() {
    this.suppressor?.port.postMessage({ type: 'stop' });
    this.suppressor?.disconnect();
    this.suppressor?.port.close();
    this.suppressor = undefined;
    this.loadingSuppressor = undefined;
    this.destination?.stream.getTracks().forEach(track => track.stop());
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
    this.context = undefined;
    this.destination = undefined;
    this.gain = undefined;
  }

  private async syncNoiseSuppression() {
    const context = this.context;
    if (this.preferences.noiseSuppression && context && !this.nativeSuppression && !this.suppressor) {
      if (!this.loadingSuppressor) {
        const loading = createNoiseSuppressor(context, this.preferences.noiseSuppression).then(node => {
          if (this.context !== context) {
            node.port.postMessage({ type: 'stop' });
            node.port.close();
            return;
          }
          this.suppressor = node;
          node.connect(this.gain!);
          this.source?.disconnect();
          this.source?.connect(node);
          node.onprocessorerror = () => {
            if (this.suppressor !== node) return;
            this.source?.disconnect();
            this.source?.connect(this.gain!);
            node.disconnect();
            node.port.close();
            this.suppressor = undefined;
            this.nativeSuppression = true;
            void this.applyNativeSuppression();
          };
        }).finally(() => {
          if (this.loadingSuppressor === loading) this.loadingSuppressor = undefined;
        });
        this.loadingSuppressor = loading;
      }
      await this.loadingSuppressor;
    }
    if (this.context !== context) return;
    this.suppressor?.port.postMessage({ type: 'enabled', enabled: this.preferences.noiseSuppression });
    this.changed();
  }

  private releaseStream() {
    this.source?.disconnect();
    this.source = undefined;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = undefined;
    this.closeContext();
  }
}
