type Action = 'microphone' | 'audio';
type Bindings = Partial<Record<Action, string>>;
const actions = { microphone: 'Silenciar ou reativar microfone', audio: 'Silenciar ou reativar áudio' } as const;
const storageKey = (email: string) => `discordo:shortcuts:${email}`;

function readBindings(email: string): Bindings {
  try { return JSON.parse(localStorage.getItem(storageKey(email)) ?? 'null') ?? {}; }
  catch { return {}; }
}

const modifiers = new Map([['Control', 'Ctrl'], ['Alt', 'Alt'], ['Shift', 'Shift'], ['Meta', 'Cmd'], ['AltGraph', 'AltGr']]);
const keyLabels = new Map([
  ['Space', 'Espaço'], ['Plus', '+'], ['Escape', 'Esc'], ['ArrowUp', '↑'],
  ['ArrowDown', '↓'], ['ArrowLeft', '←'], ['ArrowRight', '→'],
]);

function combination(event: KeyboardEvent) {
  if (event.isComposing || !event.key || event.key === 'Process') return;
  const modifier = modifiers.get(event.key);
  const altGraph = event.getModifierState('AltGraph');
  const active = [
    ['Ctrl', !altGraph && event.ctrlKey],
    ['Alt', !altGraph && event.altKey],
    ['Shift', event.shiftKey],
    ['Cmd', event.metaKey],
    ['AltGr', altGraph],
  ] as const;
  const keys: string[] = active.filter(([name, down]) => down || modifier === name).map(([name]) => name);
  if (!modifier) {
    const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
    let key = event.key;
    if (key === 'Unidentified' || key === 'Dead') key = event.code;
    else if ((event.ctrlKey || event.altKey || event.metaKey) && !altGraph && physical && !/^[a-z0-9]$/i.test(key)) {
      key = physical[1] || physical[2];
    }
    if (!key) return;
    keys.push(key === ' ' ? 'Space' : key === '+' ? 'Plus' : [...key].length === 1 ? key.toUpperCase() : key);
  }
  return keys.join('+');
}

function shortcutLabel(binding: string) {
  return binding.split('+').map(key => keyLabels.get(key) ?? key).join(' + ');
}

export const shortcutSettingsMarkup = `
  <section class="settings-section" id="settings-shortcuts" aria-labelledby="settings-shortcuts-title" hidden>
    <h3 id="settings-shortcuts-title">Atalhos</h3>
    <p class="settings-description">Use o teclado para controlar a chamada enquanto a aba do Discordo estiver em foco.</p>
    <h4 class="settings-group-title" id="shortcut-bindings">Teclas de atalho</h4>
    ${(Object.keys(actions) as Action[]).map(action => `
      <div class="shortcut-row">
        <strong id="shortcut-${action}">${actions[action]}</strong>
        <button type="button" class="settings-button" data-bind="${action}" aria-describedby="shortcut-${action}"></button>
        <button type="button" class="settings-button" data-clear="${action}" aria-describedby="shortcut-${action}">Limpar</button>
      </div>`).join('')}
    <p class="settings-hint">Escolha uma tecla ou combinação. Alguns atalhos do navegador e do sistema são reservados.</p>
    <h4 class="settings-group-title" id="shortcut-extension">Extensão do Chrome</h4>
    <p class="settings-hint">Para usar atalhos com outro aplicativo em foco, <a href="${import.meta.env.BASE_URL}discordo-atalhos.zip" download>baixe a extensão do Chrome</a>.</p>
    <p class="settings-status" role="status" data-shortcut-status></p>
  </section>`;

export function mountShortcutSettings(section: HTMLElement, email: string, onChange: () => void) {
  let saved = readBindings(email);
  let bindings = saved;
  let recording: Action | undefined;
  let pendingModifier: string | undefined;
  const status = section.querySelector('[data-shortcut-status]')!;
  const rows = (Object.keys(actions) as Action[]).map(action => ({
    action,
    bind: section.querySelector<HTMLButtonElement>(`[data-bind="${action}"]`)!,
    clear: section.querySelector<HTMLButtonElement>(`[data-clear="${action}"]`)!,
  }));
  const render = () => {
    for (const { action, bind, clear } of rows) {
      const binding = bindings[action];
      bind.textContent = recording === action ? 'Pressione uma tecla…' : binding ? shortcutLabel(binding) : 'Definir atalho';
      bind.setAttribute('aria-pressed', String(recording === action));
      clear.disabled = !bindings[action];
    }
  };
  function stage(next: Bindings, message: string) {
    bindings = next;
    status.textContent = message;
    recording = undefined;
    pendingModifier = undefined;
    render();
    onChange();
  }
  function record(action: Action, value: string) {
    const other = action === 'audio' ? 'microphone' : 'audio';
    if (bindings[other] === value) {
      status.textContent = 'Essa combinação já está em uso.';
      return;
    }
    stage({ ...bindings, [action]: value }, 'Atalho pronto para salvar.');
  }
  for (const { action, bind, clear } of rows) {
    bind.addEventListener('click', () => {
      recording = recording === action ? undefined : action;
      pendingModifier = undefined;
      status.textContent = recording ? 'Pressione uma tecla ou clique novamente para cancelar.' : '';
      render();
    });
    bind.addEventListener('blur', () => {
      if (recording !== action) return;
      recording = undefined;
      pendingModifier = undefined;
      status.textContent = '';
      render();
    });
    bind.addEventListener('keydown', event => {
      if (recording !== action) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const value = combination(event);
      pendingModifier = modifiers.has(event.key) ? value : undefined;
      if (!value) { status.textContent = 'O navegador não identificou essa tecla. Tente outra.'; return; }
      if (!pendingModifier) record(action, value);
    });
    bind.addEventListener('keyup', event => {
      const modifier = modifiers.get(event.key);
      if (recording !== action || !modifier || !pendingModifier?.split('+').includes(modifier)) return;
      event.preventDefault();
      const value = pendingModifier;
      pendingModifier = undefined;
      record(action, value);
    });
    clear.addEventListener('click', () => {
      const next = { ...bindings };
      delete next[action];
      bind.focus();
      stage(next, 'Remoção pendente.');
    });
  }
  render();
  const dirty = () => Object.keys(actions).some(action => bindings[action as Action] !== saved[action as Action]);
  return {
    dirty,
    reset() { bindings = saved; recording = undefined; pendingModifier = undefined; status.textContent = ''; render(); },
    save() {
      if (!dirty()) return;
      localStorage.setItem(storageKey(email), JSON.stringify(bindings));
      saved = bindings;
      status.textContent = '';
    },
  };
}

export function listenForVoiceShortcuts(email: string, controls: Record<Action, HTMLButtonElement>,
  inCall: () => boolean, signal: AbortSignal) {
  let pendingModifier: string | undefined;
  function available(event: KeyboardEvent) {
    return inCall() && !event.defaultPrevented && !document.querySelector('dialog[open], :popover-open') &&
      !event.composedPath().some(target => target instanceof HTMLElement &&
        (target.isContentEditable || target.matches('input, textarea, select')));
  }
  function activate(key: string, event: KeyboardEvent) {
    const bindings = readBindings(email);
    const button = key === bindings.microphone ? controls.microphone : key === bindings.audio ? controls.audio : undefined;
    if (!button || button.disabled) return;
    event.preventDefault();
    if (!event.repeat) button.click();
  }
  document.addEventListener('keydown', event => {
    if (!available(event)) { pendingModifier = undefined; return; }
    const key = combination(event);
    if (modifiers.has(event.key)) {
      if (!event.repeat) pendingModifier = key;
      return;
    }
    pendingModifier = undefined;
    if (key) activate(key, event);
  }, { signal });
  document.addEventListener('keyup', event => {
    const modifier = modifiers.get(event.key);
    if (!modifier || !pendingModifier?.split('+').includes(modifier)) return;
    const key = pendingModifier;
    pendingModifier = undefined;
    if (available(event)) activate(key, event);
  }, { signal });
  window.addEventListener('blur', () => { pendingModifier = undefined; }, { signal });
  for (const action of Object.keys(controls) as Action[]) {
    document.addEventListener(`discordo:global-shortcut:${action}`, event => {
      if (!inCall()) return;
      event.preventDefault();
      if (!controls[action].disabled) controls[action].click();
    }, { signal });
  }
}
