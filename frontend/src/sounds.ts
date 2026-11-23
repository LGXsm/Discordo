export type RoomSound = 'entrou' | 'saiu' | 'voce-entrou' | 'voce-saiu' | 'transmitiu' | 'moderacao'
  | 'chegou-movido' | 'saiu-movido' | 'verificar-ausencia'
  | 'microfone-silenciado' | 'microfone-ativado' | 'audio-desativado' | 'audio-ativado';

const notes: Record<Exclude<RoomSound, 'moderacao'>, number[]> = {
  entrou: [523, 784], saiu: [659, 440],
  'voce-entrou': [440, 587, 784], 'voce-saiu': [784, 587, 392],
  'chegou-movido': [370, 740], 'saiu-movido': [740, 370],
  transmitiu: [392, 523, 659],
  'microfone-silenciado': [740, 554],
  'microfone-ativado': [554, 740],
  'audio-desativado': [494, 370],
  'audio-ativado': [370, 494],
  'verificar-ausencia': [660, 880, 660, 990],
};
const files = import.meta.glob<string>('./sounds/*.{ogg,mp3}', { eager: true, query: '?url', import: 'default' });
const cache = new Map<string, Promise<AudioBuffer>>();
const generated = new Map<RoomSound, AudioBuffer>();
let context: AudioContext | undefined;
let source: AudioBufferSourceNode | undefined;
let player: HTMLAudioElement | undefined;
let request = 0;

export function prepareRoomSounds() {
  if (!window.AudioContext) return;
  try {
    if (!context || context.state === 'closed') context = new AudioContext();
    if (context.state !== 'running') void context.resume().catch(() => {});
  } catch { /* A call can start even if notification playback is unavailable. */ }
}

export function stopRoomSound() {
  request++;
  source?.stop();
  source = undefined;
  if (player) {
    player.pause();
    player.srcObject = null;
    player = undefined;
  }
}

export function limitSoundPeak(buffer: AudioBuffer, target: number) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    for (const value of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(value));
  }
  const scale = peak > target ? target / peak : 1;
  if (scale === 1) return;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  }
}

function generatedSound(audio: AudioContext, name: RoomSound) {
  const existing = generated.get(name);
  if (existing) return existing;
  if (name === 'moderacao') {
    const duration = .46;
    const buffer = audio.createBuffer(1, Math.ceil(duration * audio.sampleRate), audio.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      const t = i / audio.sampleRate;
      const phase = 2 * Math.PI * (145 * t - 75 * t * t);
      const envelope = Math.min(1, t / .015) * (1 - t / duration) ** 1.6;
      samples[i] = .17 * envelope * (Math.sin(phase) + .35 * Math.sin(2 * phase) + .15 * Math.sin(3 * phase));
    }
    generated.set(name, buffer);
    return buffer;
  }
  const melody = notes[name];
  const duration = .12;
  const buffer = audio.createBuffer(1, Math.ceil((.09 * (melody.length - 1) + duration) * audio.sampleRate), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (const [index, frequency] of melody.entries()) {
    const offset = Math.floor(index * .09 * audio.sampleRate);
    for (let i = 0; i < duration * audio.sampleRate && offset + i < samples.length; i++) {
      const time = i / audio.sampleRate;
      const envelope = Math.min(time / .008, 1) * (1 - time / duration) ** 2;
      samples[offset + i] += .24 * envelope * Math.sin(2 * Math.PI * frequency * time);
    }
  }
  generated.set(name, buffer);
  return buffer;
}

function loadSound(audio: AudioContext, url: string) {
  const existing = cache.get(url);
  if (existing) return existing;
  if (cache.size >= 40) cache.delete(cache.keys().next().value!);
  const pending = (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(4500) });
    if (!response.ok) throw new Error('Áudio indisponível.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 200 * 1024) throw new Error('Áudio muito grande.');
    const buffer = await audio.decodeAudioData(bytes);
    if (buffer.duration > 2.01) throw new Error('Áudio muito longo.');
    limitSoundPeak(buffer, .45);
    return buffer;
  })().catch(error => { cache.delete(url); throw error; });
  cache.set(url, pending);
  return pending;
}

async function resumeForPlayback(audio: AudioContext, timeoutMs: number) {
  if (audio.state === 'running') return;
  await new Promise<void>(resolve => {
    const timeout = setTimeout(finish, timeoutMs);
    function finish() {
      clearTimeout(timeout);
      audio.removeEventListener('statechange', onStateChange);
      resolve();
    }
    function onStateChange() {
      if (audio.state === 'running' || audio.state === 'closed') finish();
    }
    audio.addEventListener('statechange', onStateChange);
    void audio.resume().then(onStateChange, onStateChange);
  });
}

async function standardSound(audio: AudioContext, name: RoomSound) {
  for (const extension of ['ogg', 'mp3']) {
    const url = files[`./sounds/${name}.${extension}`];
    if (url) {
      try {
        const buffer = await loadSound(audio, url);
        if (buffer.duration <= 1.5) return buffer;
      } catch { /* Try the next format. */ }
    }
  }
  return generatedSound(audio, name);
}

export async function playRoomSound(name: RoomSound, options: {
  volume: number; output: string; url?: string; allowed?: () => boolean; fallback?: boolean;
}) {
  if (!options.volume || options.allowed?.() === false) return false;
  try {
    prepareRoomSounds();
    const audio = context;
    if (!audio) return false;
    stopRoomSound();
    const attempt = request;
    let buffer: AudioBuffer | undefined;
    if (options.url) {
      const url = new URL(options.url, document.baseURI);
      if (url.origin === location.origin) buffer = await loadSound(audio, url.href).catch(() => undefined);
      if (!buffer && options.fallback === false) return false;
    }
    buffer ??= await standardSound(audio, name);
    await resumeForPlayback(audio, name === 'moderacao' || name === 'verificar-ausencia' ? 1500 : 500);
    if (attempt !== request || options.allowed?.() === false || audio.state !== 'running') return false;
    let destination: AudioNode = audio.destination;
    const routed = audio as AudioContext & { setSinkId?: (id: string) => Promise<void>; sinkId?: string };
    if (routed.setSinkId) {
      if (routed.sinkId !== options.output) await routed.setSinkId(options.output).catch(() => routed.setSinkId!('').catch(() => {}));
    } else if (options.output && typeof HTMLMediaElement.prototype.setSinkId === 'function') {
      const stream = audio.createMediaStreamDestination();
      const element = new Audio();
      element.srcObject = stream.stream;
      await element.setSinkId(options.output).catch(() => {});
      if (attempt !== request) return false;
      player = element;
      await element.play();
      destination = stream;
    }
    if (attempt !== request || options.allowed?.() === false) return false;
    const gain = audio.createGain();
    gain.gain.value = Math.min(1, Math.max(0, options.volume));
    const playing = audio.createBufferSource();
    source = playing;
    playing.buffer = buffer;
    playing.connect(gain).connect(destination);
    playing.onended = () => {
      playing.disconnect();
      gain.disconnect();
      if (source === playing) {
        source = undefined;
        stopRoomSound();
      }
    };
    playing.start();
    return true;
  } catch {
    return false;
  }
}
