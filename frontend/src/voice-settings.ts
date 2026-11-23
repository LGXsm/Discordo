import { saveVoicePreferences, type VoicePreferences } from './voice-preferences';
import { playRoomSound } from './sounds';
import { microphoneError, microphonePermission, microphoneRestriction, pendingMicrophone } from './audio-permissions';

export const voiceSettingsMarkup = `
  <section class="settings-section" id="settings-voice" aria-labelledby="settings-voice-title" hidden>
    <h3 id="settings-voice-title">Voz</h3>
    <p class="settings-description">Escolha os dispositivos e ajuste o que você fala e ouve.</p>
    <form class="voice-settings-form">
      <div class="voice-setting" id="voice-input-section">
        <h4 class="settings-group-title">Microfone</h4>
        <label for="voice-input">Microfone</label>
        <select id="voice-input" aria-describedby="voice-input-hint"></select>
        <p class="settings-hint" id="voice-input-hint"></p>
        <div class="volume-heading"><label for="voice-input-volume">Volume de entrada</label><output for="voice-input-volume"></output></div>
        <input id="voice-input-volume" class="volume-slider" type="range" min="0" max="200">
      </div>
      <div class="voice-setting" id="voice-output-section">
        <h4 class="settings-group-title">Saída de áudio</h4>
        <label for="voice-output">Fone ou alto-falante</label>
        <select id="voice-output" aria-describedby="voice-output-hint"></select>
        <div class="volume-heading"><label for="voice-output-volume">Volume de saída</label><output for="voice-output-volume"></output></div>
        <input id="voice-output-volume" class="volume-slider" type="range" min="0" max="100">
      </div>
      <p class="settings-hint" id="voice-output-hint"></p>
      <div class="profile-photo-actions">
        <button class="settings-button" type="button" data-permit-mic>Permitir microfone</button>
        <button class="settings-button" type="button" data-list-devices>Atualizar dispositivos</button>
        <button class="settings-button" type="button" data-pick-output hidden>Selecionar fone</button>
      </div>
      <div class="voice-setting" id="voice-sounds-section">
        <h4 class="settings-group-title">Sons da sala</h4>
        <label><input type="checkbox" id="room-sounds"> Sons da sala</label>
        <div class="volume-heading"><label for="room-sound-volume">Volume dos sons da sala</label><output for="room-sound-volume"></output></div>
        <input id="room-sound-volume" class="volume-slider" type="range" min="0" max="100">
        <label><input type="checkbox" id="room-custom-sounds"> Tocar sons personalizados dos outros</label>
        <label><input type="checkbox" id="room-lobby-sounds"> Avisar quando alguém entrar numa sala do servidor</label>
        <div><button class="settings-button" type="button" data-test-room-sound>Testar</button></div>
      </div>
      <div class="settings-footer">
        <p class="settings-status" role="status"></p>
      </div>
    </form>
  </section>`;

export function mountVoiceSettings(section: HTMLElement, email: string, preferences: VoicePreferences,
  onSave: (preferences: VoicePreferences) => void, onMicrophoneAllowed: () => void, canHear: () => boolean, onChange: () => void) {
  const form = section.querySelector('form')!;
  const input = form.querySelector<HTMLSelectElement>('#voice-input')!;
  const output = form.querySelector<HTMLSelectElement>('#voice-output')!;
  const inputVolume = form.querySelector<HTMLInputElement>('#voice-input-volume')!;
  const outputVolume = form.querySelector<HTMLInputElement>('#voice-output-volume')!;
  const roomSounds = form.querySelector<HTMLInputElement>('#room-sounds')!;
  const roomVolume = form.querySelector<HTMLInputElement>('#room-sound-volume')!;
  const customSounds = form.querySelector<HTMLInputElement>('#room-custom-sounds')!;
  const lobbySounds = form.querySelector<HTMLInputElement>('#room-lobby-sounds')!;
  const list = form.querySelector<HTMLButtonElement>('[data-list-devices]')!;
  const permit = form.querySelector<HTMLButtonElement>('[data-permit-mic]')!;
  const pick = form.querySelector<HTMLButtonElement>('[data-pick-output]')!;
  const status = form.querySelector<HTMLElement>('.settings-status')!;
  const hint = form.querySelector<HTMLElement>('#voice-output-hint')!;
  const micHint = form.querySelector<HTMLElement>('#voice-input-hint')!;
  const devices = navigator.mediaDevices as (MediaDevices & {
    selectAudioOutput?: () => Promise<MediaDeviceInfo>;
  }) | undefined;
  const supportsOutput = typeof HTMLMediaElement.prototype.setSinkId === 'function';
  let saved = preferences;
  let micAttempt = 0;
  let requestingMic = false;
  let permissionTimer: ReturnType<typeof setTimeout> | undefined;
  output.disabled = !supportsOutput;
  pick.hidden = !supportsOutput || !devices?.selectAudioOutput;
  list.disabled = !devices?.enumerateDevices;
  const restriction = microphoneRestriction();
  permit.disabled = Boolean(restriction);
  hint.textContent = !supportsOutput ? 'Este navegador usa a saída de áudio definida no sistema.'
    : pick.hidden ? 'Escolha um fone na lista. Se ele não aparecer, permita o microfone e atualize os dispositivos. A saída padrão usa o fone configurado no sistema.'
      : 'Use Selecionar fone para autorizar uma saída que ainda não aparece na lista.';
  micHint.textContent = restriction || 'Clique em Permitir microfone para solicitar acesso ao navegador.';

  function fillOptions(select: HTMLSelectElement, options: MediaDeviceInfo[], selected: string, fallback: string) {
    select.replaceChildren(new Option(fallback, ''));
    for (const [index, device] of options.entries()) {
      select.add(new Option(device.label || `Dispositivo ${index + 1}`, device.deviceId));
    }
    if (selected && !options.some(device => device.deviceId === selected)) {
      select.add(new Option('Dispositivo salvo · não listado', selected));
    }
    select.value = selected;
  }

  function fillDevices(options: MediaDeviceInfo[], selectedOutput = output.value) {
    const listed = options.filter(device => device.deviceId && device.deviceId !== 'default');
    fillOptions(input, listed.filter(device => device.kind === 'audioinput'), input.value, 'Microfone padrão');
    fillOptions(output, listed.filter(device => device.kind === 'audiooutput'), selectedOutput, 'Saída padrão do sistema');
  }

  fillOptions(input, [], saved.input, 'Microfone padrão');
  fillOptions(output, [], saved.output, 'Saída padrão do sistema');
  roomSounds.checked = saved.roomSounds !== false;
  customSounds.checked = saved.customRoomSounds !== false;
  lobbySounds.checked = saved.lobbySounds === true;
  for (const [slider, value] of [[inputVolume, saved.inputVolume], [outputVolume, saved.outputVolume],
    [roomVolume, saved.roomSoundVolume ?? 60]] as const) {
    slider.value = String(value);
    const readout = form.querySelector<HTMLOutputElement>(`output[for="${slider.id}"]`)!;
    const sync = () => {
      readout.value = `${slider.value}%`;
      slider.setAttribute('aria-valuetext', readout.value);
      slider.style.setProperty('--volume-fraction', String(slider.valueAsNumber / Number(slider.max)));
    };
    slider.addEventListener('input', sync);
    sync();
  }

  function feedback(message: string, state: 'error' | 'success' | 'neutral') {
    status.textContent = message;
    status.dataset.state = state;
  }

  form.querySelector('[data-test-room-sound]')!.addEventListener('click', async () => {
    if (!canHear()) { feedback('Reative o fone para testar o som.', 'neutral'); return; }
    const volume = roomVolume.valueAsNumber * outputVolume.valueAsNumber / 10000;
    if (!volume) { feedback('Aumente o volume para testar o som.', 'neutral'); return; }
    const played = await playRoomSound('entrou', { volume, output: output.value, allowed: canHear });
    feedback(played ? '' : 'Não foi possível tocar o som.', played ? 'neutral' : 'error');
  });

  async function refresh(showFeedback = false) {
    if (!devices?.enumerateDevices) return;
    try {
      fillDevices(await devices.enumerateDevices());
      const permission = await microphonePermission();
      if (restriction) {
        micHint.textContent = restriction;
      } else if (permission === 'denied') {
        micHint.textContent = microphoneError(new DOMException('', 'NotAllowedError'));
      } else if (permission === 'granted') {
        micHint.textContent = 'O navegador já permitiu o uso do microfone.';
      } else {
        micHint.textContent = 'Clique em Permitir microfone para solicitar acesso ao navegador.';
      }
      if (showFeedback) feedback('Lista de dispositivos atualizada.', 'success');
    } catch {
      if (showFeedback) feedback('Confira as permissões de áudio do navegador e tente novamente.', 'error');
    }
  }

  list.addEventListener('click', async () => {
    list.disabled = true;
    feedback('Carregando dispositivos…', 'neutral');
    await refresh(true);
    list.disabled = false;
  });
  permit.addEventListener('click', async () => {
    const attempt = ++micAttempt;
    if (requestingMic) {
      clearTimeout(permissionTimer);
      requestingMic = false;
      permit.textContent = 'Permitir microfone';
      feedback('Tentativa cancelada. Você pode solicitar o acesso novamente.', 'neutral');
      return;
    }
    if (!devices) return;
    requestingMic = true;
    permit.textContent = 'Cancelar pedido do microfone';
    feedback('Aguardando autorização do microfone…', 'neutral');
    permissionTimer = setTimeout(() => {
      if (section.isConnected) feedback(pendingMicrophone, 'neutral');
    }, 5_000);
    let stream: MediaStream | undefined;
    try {
      stream = await devices.getUserMedia({ audio: true });
      if (attempt !== micAttempt || !section.isConnected) return;
      try {
        const options = await devices.enumerateDevices();
        if (attempt === micAttempt) fillDevices(options);
      } catch {
        // Permission can succeed even if device enumeration is unavailable.
      }
      if (attempt !== micAttempt || !section.isConnected) return;
      micHint.textContent = 'O navegador permitiu o uso do microfone.';
      feedback('Microfone liberado.', 'success');
      onMicrophoneAllowed();
    } catch (error) {
      if (attempt !== micAttempt) return;
      micHint.textContent = microphoneError(error);
      feedback('O acesso ao microfone precisa ser liberado no navegador.', 'error');
    } finally {
      stream?.getTracks().forEach(track => track.stop());
      if (attempt === micAttempt) {
        clearTimeout(permissionTimer);
        requestingMic = false;
        permit.textContent = 'Permitir microfone';
      }
    }
  });
  pick.addEventListener('click', async () => {
    if (!devices?.selectAudioOutput) return;
    try {
      const chosen = await devices.selectAudioOutput();
      const available = [...await devices.enumerateDevices().catch(() => [])];
      if (!available.some(device => device.deviceId === chosen.deviceId)) available.push(chosen);
      fillDevices(available, chosen.deviceId);
      onChange();
      feedback('Saída selecionada. Salve para aplicar.', 'neutral');
    } catch {
      feedback('O navegador não autorizou outra saída. Você pode tentar novamente ou usar a saída padrão do sistema.', 'neutral');
    }
  });
  const draft = (): VoicePreferences => ({ ...saved, input: input.value, output: supportsOutput ? output.value : saved.output,
      inputVolume: inputVolume.valueAsNumber, outputVolume: outputVolume.valueAsNumber,
      roomSounds: roomSounds.checked, roomSoundVolume: roomVolume.valueAsNumber,
      customRoomSounds: customSounds.checked, lobbySounds: lobbySounds.checked });
  let baseline = JSON.stringify(draft());
  const dirty = () => JSON.stringify(draft()) !== baseline;
  form.addEventListener('input', onChange);
  form.addEventListener('change', onChange);
  return {
    dirty,
    refresh,
    reset() {
      if (!Array.from(input.options).some(option => option.value === saved.input)) input.add(new Option('Dispositivo salvo', saved.input));
      if (!Array.from(output.options).some(option => option.value === saved.output)) output.add(new Option('Dispositivo salvo', saved.output));
      input.value = saved.input;
      output.value = saved.output;
      roomSounds.checked = saved.roomSounds !== false;
      customSounds.checked = saved.customRoomSounds !== false;
      lobbySounds.checked = saved.lobbySounds === true;
      for (const [slider, value] of [[inputVolume, saved.inputVolume], [outputVolume, saved.outputVolume],
        [roomVolume, saved.roomSoundVolume ?? 60]] as const) {
        slider.value = String(value);
        slider.dispatchEvent(new Event('input'));
      }
      feedback('', 'neutral');
    },
    save() {
      if (!dirty()) return;
      const next = draft();
      saveVoicePreferences(email, next);
      saved = next;
      baseline = JSON.stringify(draft());
      onSave(next);
    },
  };
}
