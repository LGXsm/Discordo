import { updateProfileSound, type Account, type ProfileSounds } from './accounts';
import { playRoomSound, prepareRoomSounds } from './sounds';
import { openMicrophone, readVoicePreferences } from './voice-preferences';

const soundTypes = [
  { kind: 'entrySound', label: 'Meu som de entrada', preview: 'entrou' },
  { kind: 'exitSound', label: 'Meu som de saída', preview: 'saiu' },
  { kind: 'moveExitSound', label: 'Som de saída ao ser movido', preview: 'saiu-movido' },
  { kind: 'moveEntrySound', label: 'Som de entrada ao ser movido', preview: 'chegou-movido' },
  { kind: 'disconnectSound', label: 'Meu aviso ao ser desconectado', preview: 'moderacao' },
  { kind: 'punishedSound', label: 'Meu aviso ao ser castigado', preview: 'moderacao' },
  { kind: 'absenceSound', label: 'Som que os outros ouvem quando verifico a ausência', preview: 'verificar-ausencia' },
] as const;

const soundMarkup = ({ kind, label }: typeof soundTypes[number]) => `
  <fieldset class="profile-sound" data-profile-sound="${kind}">
    <legend>${label}</legend>
    <div class="profile-photo-actions">
      <input type="file" accept="audio/*,.mp3,.wav,.ogg,.webm,.m4a" hidden>
      <button type="button" class="settings-button" data-sound-action="record">Gravar</button>
      <button type="button" class="settings-button" data-sound-action="upload">Enviar arquivo</button>
      <button type="button" class="settings-button" data-sound-action="preview">Ouvir</button>
      <button type="button" class="settings-button" data-sound-action="remove">Remover</button>
    </div>
    <p class="settings-status" role="status"></p>
  </fieldset>`;

export const profileSoundsMarkup = soundTypes.map(soundMarkup).join('');
export const tutorialSoundsMarkup = soundTypes.slice(0, 2).map(soundMarkup).join('');

async function prepareSound(file: Blob, recording: boolean) {
  if (file.size > 200 * 1024) throw new Error('O arquivo deve ter até 200 KB.');
  const rate = 24000;
  const decoder = new OfflineAudioContext(1, 1, rate);
  let decoded: AudioBuffer;
  try { decoded = await decoder.decodeAudioData(await file.arrayBuffer()); }
  catch { throw new Error('O navegador não conseguiu abrir este áudio.'); }
  if (!recording && decoded.length > rate * 2) throw new Error('O áudio deve ter até 2 segundos.');
  if (decoded.length < rate * .05) throw new Error('O áudio está curto demais.');
  // Leave space for the encoder's leading and trailing samples inside the two-second limit.
  const length = Math.min(decoded.length, 46656);
  const mono = new Float32Array(length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const samples = decoded.getChannelData(channel);
    for (let i = 0; i < length; i++) mono[i] += samples[i] / decoded.numberOfChannels;
  }
  let peak = 0;
  for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
  if (peak < .001) throw new Error('O áudio está muito baixo. Grave ou escolha outro som.');
  const gain = Math.min(.65 / peak, 4);
  const samples = Int16Array.from(mono, (sample, index) =>
    Math.round(sample * gain * 32767 * Math.min(1, index / 120, (length - 1 - index) / 120)));
  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(1, rate, 64);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < samples.length; offset += 1152) {
    chunks.push(new Uint8Array(encoder.encodeBuffer(samples.subarray(offset, offset + 1152))));
  }
  chunks.push(new Uint8Array(encoder.flush()));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

function soundDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível preparar o envio do som.'));
    reader.readAsDataURL(blob);
  });
}

export function mountProfileSounds(dialog: HTMLDialogElement, account: Account,
  onSave: (sounds: ProfileSounds) => void, canHear: () => boolean, onChange: () => void) {
  let busy = false;
  let activeRecorder: MediaRecorder | undefined;
  const lifetime = new AbortController();
  let saved: ProfileSounds = account;
  let revision = 0;
  const controls = soundTypes.map(type => {
    const field = dialog.querySelector<HTMLFieldSetElement>(`[data-profile-sound="${type.kind}"]`)!;
    const button = (action: string) => field.querySelector<HTMLButtonElement>(`[data-sound-action="${action}"]`)!;
    return { ...type, field, file: field.querySelector('input')!, status: field.querySelector('p')!,
      record: button('record'), upload: button('upload'), hear: button('preview'),
      remove: button('remove'), draft: undefined as Blob | null | undefined };
  });
  let recording: typeof controls[number] | undefined;

  function refresh() {
    for (const item of controls) {
      const ready = Boolean(saved[`${item.kind}Url`]);
      item.record.textContent = item === recording ? 'Parar' : 'Gravar';
      item.record.disabled = !window.MediaRecorder || (busy && item !== recording);
      item.upload.disabled = busy;
      item.hear.disabled = busy || item.draft === null || (!ready && !item.draft);
      item.remove.disabled = busy || item.draft === null || (!ready && !item.draft);
    }
  }

  async function run(item: typeof controls[number], task: () => Promise<void>) {
    if (busy) return;
    busy = true;
    refresh();
    onChange();
    try {
      await task();
    } catch (error) {
      item.status.textContent = error instanceof Error ? error.message : 'Não foi possível preparar o som.';
      item.status.dataset.state = 'error';
    } finally {
      busy = false;
      refresh();
      onChange();
    }
  }

  async function stage(item: typeof controls[number], blob: Blob, recorded: boolean) {
    item.status.dataset.state = 'neutral';
    item.status.textContent = 'Preparando áudio…';
    const version = revision;
    const prepared = await prepareSound(blob, recorded);
    if (version !== revision || lifetime.signal.aborted) return;
    item.draft = prepared;
    item.status.textContent = 'Som pronto para salvar.';
  }

  function stopRecording() {
    if (activeRecorder?.state === 'recording') activeRecorder.stop();
  }

  dialog.addEventListener('close', () => { lifetime.abort(); stopRecording(); }, { once: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopRecording();
  }, { signal: lifetime.signal });

  for (const item of controls) {
    item.upload.addEventListener('click', () => item.file.click());
    item.file.addEventListener('change', () => {
      const file = item.file.files?.[0];
      item.file.value = '';
      if (file) void run(item, () => stage(item, file, false));
    });
    item.record.addEventListener('click', () => {
      if (recording === item) { stopRecording(); return; }
      void run(item, async () => {
        const version = revision;
        item.status.dataset.state = 'neutral';
        item.status.textContent = 'Aguardando o microfone…';
        const preferences = readVoicePreferences(account.email);
        const { stream } = await openMicrophone(preferences.input, preferences.noiseSuppression);
        let timer: ReturnType<typeof setTimeout> | undefined;
        let countdown: ReturnType<typeof setTimeout> | undefined;
        try {
          if (version !== revision || lifetime.signal.aborted || !dialog.isConnected || document.hidden) return;
          const recorder = new MediaRecorder(stream);
          activeRecorder = recorder;
          recording = item;
          refresh();
          const chunks: Blob[] = [];
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
          const result = new Promise<Blob>((resolve, reject) => {
            recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
            recorder.onerror = () => reject(new Error('Não foi possível gravar o áudio.'));
          });
          recorder.start();
          item.status.textContent = 'Gravando… 2 s';
          countdown = setTimeout(() => { item.status.textContent = 'Gravando… 1 s'; }, 1000);
          timer = setTimeout(stopRecording, 1950);
          const blob = await result;
          stream.getTracks().forEach(track => track.stop());
          recording = undefined;
          refresh();
          if (version === revision && !lifetime.signal.aborted) await stage(item, blob, true);
        } finally {
          clearTimeout(timer);
          clearTimeout(countdown);
          activeRecorder = undefined;
          recording = undefined;
          stream.getTracks().forEach(track => track.stop());
        }
      });
    });
    item.hear.addEventListener('click', () => {
      if (!canHear()) { item.status.textContent = 'Reative o fone para ouvir a prévia.'; return; }
      prepareRoomSounds();
      void run(item, async () => {
        const temporary = item.draft ? URL.createObjectURL(item.draft) : undefined;
        const preferences = readVoicePreferences(account.email);
        try {
          const played = await playRoomSound(item.preview, { url: temporary ?? saved[`${item.kind}Url`] ?? undefined,
            volume: preferences.outputVolume * (preferences.roomSoundVolume ?? 60) / 10000,
            output: preferences.output, fallback: false, allowed: () => canHear() && !lifetime.signal.aborted });
          if (!played) throw new Error('Não foi possível ouvir o som. Confira o volume de saída.');
        } finally {
          if (temporary) URL.revokeObjectURL(temporary);
        }
      });
    });
    item.remove.addEventListener('click', () => {
      item.draft = saved[`${item.kind}Url`] ? null : undefined;
      item.status.dataset.state = 'neutral';
      item.status.textContent = item.draft === null ? 'Remoção pendente.' : 'Prévia descartada.';
      refresh();
      onChange();
    });
  }
  refresh();
  return {
    dirty: () => controls.some(item => item.draft !== undefined),
    busy: () => busy,
    reset() {
      revision++;
      stopRecording();
      for (const item of controls) { item.draft = undefined; item.status.textContent = ''; }
      refresh();
    },
    async save() {
      for (const item of controls) {
        if (item.draft === undefined) continue;
        saved = await updateProfileSound(account.email, item.kind, item.draft === null ? null : await soundDataUrl(item.draft));
        item.status.textContent = item.draft === null ? 'Som removido.' : 'Som salvo.';
        item.status.dataset.state = 'success';
        item.draft = undefined;
        onSave(saved);
        refresh();
      }
    },
  };
}
