import { icon } from './icons';
import { readVoicePreferences, saveVoicePreferences, type VoicePreferences } from './voice-preferences';

export function mountQuickVoiceSettings(host: HTMLElement, email: string, apply: (next: VoicePreferences) => void,
  openVoiceSettings: () => void, signal: AbortSignal) {
  let menu: HTMLDivElement | undefined;
  let revision = 0;

  function close() {
    revision++;
    menu?.remove();
    menu = undefined;
    host.querySelectorAll('[data-quick-voice]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }

  signal.addEventListener('abort', close, { once: true });
  for (const trigger of host.querySelectorAll<HTMLButtonElement>('[data-quick-voice]')) {
    trigger.addEventListener('click', () => {
      const same = menu && trigger.getAttribute('aria-expanded') === 'true';
      close();
      if (same) return;
      const input = trigger.dataset.quickVoice === 'input';
      const current = readVoicePreferences(email);
      const popup = document.createElement('div');
      menu = popup;
      popup.className = 'quick-voice-menu';
      popup.popover = 'auto';
      popup.setAttribute('role', 'group');
      popup.setAttribute('aria-label', input ? 'Configurações rápidas do microfone' : 'Configurações rápidas do fone');
      popup.innerHTML = `
        <label>${input ? 'Dispositivo de entrada' : 'Dispositivo de saída'}
          <select data-quick-device></select>
        </label>
        ${input ? '<label><input type="checkbox" data-quick-noise> Supressão de ruído</label>' : ''}
        <label>${input ? 'Volume de entrada' : 'Volume de saída'}
          <div class="quick-voice-volume"><input class="volume-slider" type="range" min="0" max="${input ? 200 : 100}" aria-label="${input ? 'Volume de entrada' : 'Volume de saída'}"><output></output></div>
        </label>
        <p role="status"></p>
        <button class="settings-button" type="button" data-open-voice-settings>${icon('settings')} Configurações de voz</button>`;
      const select = popup.querySelector('select')!;
      const slider = popup.querySelector<HTMLInputElement>('[type=range]')!;
      const noise = popup.querySelector<HTMLInputElement>('[data-quick-noise]');
      const output = popup.querySelector('output')!;
      const status = popup.querySelector('[role=status]')!;
      const selected = input ? current.input : current.output;
      const devices = navigator.mediaDevices;
      const supportsOutput = typeof HTMLMediaElement.prototype.setSinkId === 'function';
      function fill(list: MediaDeviceInfo[]) {
        select.replaceChildren(new Option(input ? 'Microfone padrão' : 'Saída padrão do sistema', ''));
        const options = list.filter(device => device.kind === (input ? 'audioinput' : 'audiooutput') && device.deviceId && device.deviceId !== 'default');
        options.forEach((device, index) => select.add(new Option(device.label || `Dispositivo ${index + 1}`, device.deviceId)));
        if (selected && !options.some(device => device.deviceId === selected)) select.add(new Option('Dispositivo salvo · não listado', selected));
        select.value = selected;
      }
      fill([]);
      select.disabled = !devices?.enumerateDevices || (!input && !supportsOutput);
      if (!input && !supportsOutput) status.textContent = 'Este navegador usa a saída de áudio do sistema.';
      slider.value = String(input ? current.inputVolume : current.outputVolume);
      if (noise) noise.checked = current.noiseSuppression;
      function paint() {
        output.value = `${slider.value}%`;
        slider.style.setProperty('--volume-fraction', String(slider.valueAsNumber / Number(slider.max)));
        slider.setAttribute('aria-valuetext', output.value);
      }
      function save(change: Partial<VoicePreferences>) {
        const next = { ...readVoicePreferences(email), ...change };
        try {
          saveVoicePreferences(email, next);
          apply(next);
          status.textContent = '';
        } catch {
          status.textContent = 'Não foi possível salvar o ajuste. Confira as configurações do navegador.';
        }
      }
      slider.addEventListener('input', () => {
        paint();
        save(input ? { inputVolume: slider.valueAsNumber } : { outputVolume: slider.valueAsNumber });
      });
      select.addEventListener('change', () => save(input ? { input: select.value } : { output: select.value }));
      noise?.addEventListener('change', () => save({ noiseSuppression: noise.checked }));
      popup.querySelector('[data-open-voice-settings]')!.addEventListener('click', () => { close(); openVoiceSettings(); });
      function position() {
        if (!popup.isConnected) return;
        const rect = trigger.getBoundingClientRect();
        popup.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - popup.offsetWidth - 8))}px`;
        popup.style.top = `${Math.max(8, rect.top - popup.offsetHeight - 8)}px`;
      }
      popup.addEventListener('toggle', () => {
        if (!popup.matches(':popover-open') && menu === popup) close();
      });
      host.append(popup);
      popup.showPopover();
      trigger.setAttribute('aria-expanded', 'true');
      paint();
      position();
      const ticket = revision;
      void devices?.enumerateDevices().then(list => {
        if (ticket !== revision || menu !== popup) return;
        fill(list);
        position();
      }).catch(() => {
        if (menu === popup) status.textContent = 'Permita o microfone em Configurações de voz para listar os dispositivos.';
      });
      select.focus({ preventScroll: true });
    }, { signal });
  }
  window.addEventListener('resize', close, { signal });
}
