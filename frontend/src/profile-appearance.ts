import { updateProfileAppearance } from './accounts';
import { mountThemeColors, paintThemeColors, themeColorsMarkup, type ThemeColors } from './profile-theme-colors';
import alienThumbnail from './profile-effects/alien-thumb.webp?inline';
import smokeThumbnail from './profile-effects/smoke-thumb.webp?inline';

const themes = {
  discordo: 'Discordo', noite: 'Noite violeta', ciano: 'Azul oceano', brasa: 'Brasa', mata: 'Verde mata',
} as const;
const frames = { none: 'Sem moldura', neon: 'Neon', grafite: 'Grafite', gelo: 'Gelo', metal: 'Metal' } as const;
const effects = {
  none: 'Sem animação', neon: 'Neon', grafite: 'Grafite', gelo: 'Gelo',
  'brasa-fumaca': 'Fumaça contínua', 'visitante-vidro': 'Visitante no vidro',
} as const;
type ProfileEffect = keyof typeof effects;
const effectThumbnails: Partial<Record<ProfileEffect, string>> = {
  'brasa-fumaca': smokeThumbnail,
  'visitante-vidro': alienThumbnail,
};
const frameDefaults = { neon: '#D2ADFF', grafite: '#FFCB87' } as const;

function supportsFrameColor(frame: string): frame is keyof typeof frameDefaults {
  return frame === 'neon' || frame === 'grafite';
}

export type ProfileAppearance = {
  bio: string;
  theme: keyof typeof themes | 'personalizado';
  frame: keyof typeof frames;
  effect: ProfileEffect;
  colors?: ThemeColors;
  frameColor?: string;
};

const defaults: ProfileAppearance = { bio: '', theme: 'discordo', frame: 'none', effect: 'none' };
const options = (items: Record<string, string>) =>
  Object.entries(items).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');

function effectSample(effect: ProfileEffect) {
  const image = effectThumbnails[effect];
  if (image) return `<img src="${image}" alt="" decoding="async">`;
  return `<i></i>${effect === 'none' ? '' : `<span class="profile-effect"><span data-effect="${effect}"></span></span>`}`;
}

export const profileDecorationsMarkup = '<div class="profile-frame" aria-hidden="true"></div><div class="profile-effect" aria-hidden="true"></div>';
export const profileAppearanceMarkup = `
  <form class="profile-appearance-form" aria-labelledby="profile-appearance-title">
    <h4 id="profile-appearance-title">Aparência do cartão</h4>
    <label for="profile-bio">Bio</label>
    <textarea id="profile-bio" name="bio" rows="2" maxlength="180" placeholder="Conte um pouco sobre você"></textarea>
    <nav class="profile-appearance-tabs" aria-label="Opções de aparência">
      <button type="button" aria-pressed="true" aria-controls="profile-theme-panel">Tema</button>
      <button type="button" aria-pressed="false" aria-controls="profile-frame-panel">Moldura</button>
      <button type="button" aria-pressed="false" aria-controls="profile-effect-panel">Animação de abertura</button>
    </nav>
    <div id="profile-theme-panel" data-appearance-panel>
      <select id="profile-theme" name="theme" hidden>${options({ ...themes, personalizado: 'Personalizado' })}</select>
      <div class="profile-theme-grid" role="group" aria-label="Paletas do cartão">
        ${Object.entries(themes).map(([value, label]) => `
          <button class="profile-theme-option" type="button" data-theme-choice="${value}" aria-pressed="false">
            <span class="profile-theme-sample" data-profile-theme="${value}" aria-hidden="true"><i></i></span>
            <span>${label}</span>
          </button>`).join('')}
        <button class="profile-theme-option" type="button" data-theme-choice="personalizado" aria-pressed="false">
          <span class="profile-theme-sample custom-theme-sample" aria-hidden="true"><i></i></span>
          <span>Personalizado</span>
        </button>
      </div>
      ${themeColorsMarkup}
    </div>
    <div id="profile-frame-panel" data-appearance-panel hidden>
      <select id="profile-frame" name="frame" hidden>${options(frames)}</select>
      <div class="profile-theme-grid" role="group" aria-label="Molduras do cartão">
        ${Object.entries(frames).map(([value, label]) => `
          <button class="profile-theme-option" type="button" data-frame-choice="${value}" aria-pressed="false">
            <span class="profile-theme-sample profile-frame-sample" data-profile-frame="${value}" aria-hidden="true">
              <i></i><span class="profile-frame"></span>
            </span>
            <span>${label}</span>
          </button>`).join('')}
      </div>
      <div class="profile-frame-color" data-frame-color-controls hidden>
        <label class="profile-frame-color-toggle"><input type="checkbox" data-custom-frame-color> Personalizar cor</label>
        <label class="profile-frame-color-swatch" data-frame-swatch hidden>Cor da moldura
          <input type="color" data-frame-color><output data-frame-color-code></output>
        </label>
      </div>
    </div>
    <div id="profile-effect-panel" data-appearance-panel hidden>
      <div class="profile-theme-grid" role="group" aria-label="Animações de abertura">
        ${(Object.keys(effects) as ProfileEffect[]).map(value => `
          <button class="profile-theme-option" type="button" data-effect-choice="${value}" aria-pressed="false">
            <span class="profile-theme-sample profile-effect-sample" aria-hidden="true">${effectSample(value)}</span>
            <span>${effects[value]}</span>
          </button>`).join('')}
      </div>
    </div>
  </form>`;

export function renderProfileAppearance(card: HTMLElement, appearance?: ProfileAppearance | null) {
  const { bio, theme, frame } = appearance ?? defaults;
  card.dataset.profileTheme = theme;
  card.dataset.profileFrame = frame;
  applyFrameColor(card, frame, appearance?.frameColor);
  paintThemeColors(card, theme === 'personalizado' ? appearance?.colors : undefined);
  const text = card.querySelector<HTMLElement>('[data-profile-bio]')!;
  text.textContent = bio;
  text.hidden = !bio;
}

function applyFrameColor(element: HTMLElement, frame: string, color?: string) {
  if (supportsFrameColor(frame) && color && /^#[0-9a-f]{6}$/i.test(color)) {
    element.style.setProperty('--profile-frame-color', color);
  } else {
    element.style.removeProperty('--profile-frame-color');
  }
}

const illustratedPlayback = new WeakMap<HTMLElement, AbortController>();

export function stopProfileEffect(card: HTMLElement) {
  illustratedPlayback.get(card)?.abort();
  illustratedPlayback.delete(card);
  card.querySelector('.profile-effect')?.replaceChildren();
}

export function playProfileEffect(card: HTMLElement, appearance?: ProfileAppearance | null) {
  stopProfileEffect(card);
  const effect = appearance?.effect;
  if (!effect || effect === 'none') return;
  const overlay = card.querySelector<HTMLElement>('.profile-effect')!;
  if (effect === 'brasa-fumaca' || effect === 'visitante-vidro') {
    const playback = new AbortController();
    illustratedPlayback.set(card, playback);
    void import('./profile-opening').then(({ playIllustratedEffect }) => {
      if (!playback.signal.aborted && card.isConnected && overlay.clientWidth && overlay.clientHeight) {
        playIllustratedEffect(card, overlay, effect, playback.signal);
      }
    }).catch(error => {
      if (!playback.signal.aborted) console.error('Falha ao carregar a animação do perfil.', error);
    });
    return;
  }
  const animation = document.createElement('span');
  animation.dataset.effect = effect;
  animation.addEventListener('animationend', () => animation.remove(), { once: true });
  animation.addEventListener('animationcancel', () => animation.remove(), { once: true });
  overlay.append(animation);
}

export function mountProfileAppearance(form: HTMLFormElement, preview: HTMLElement, replay: HTMLButtonElement,
  email: string, appearance: ProfileAppearance | null | undefined, onSave: (appearance: ProfileAppearance) => void,
  onChange: () => void) {
  let saved = appearance ?? defaults;
  const bio = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const theme = form.querySelector<HTMLSelectElement>('#profile-theme')!;
  const frame = form.querySelector<HTMLSelectElement>('#profile-frame')!;
  let effect = saved.effect;
  const colorsRoot = form.querySelector<HTMLElement>('[data-theme-colors]')!;
  const choices = [...form.querySelectorAll<HTMLButtonElement>('[data-theme-choice]')];
  const frameChoices = [...form.querySelectorAll<HTMLButtonElement>('[data-frame-choice]')];
  const effectChoices = [...form.querySelectorAll<HTMLButtonElement>('[data-effect-choice]')];
  const frameColorControls = form.querySelector<HTMLElement>('[data-frame-color-controls]')!;
  const customFrameColor = form.querySelector<HTMLInputElement>('[data-custom-frame-color]')!;
  const frameSwatch = form.querySelector<HTMLElement>('[data-frame-swatch]')!;
  const frameColor = form.querySelector<HTMLInputElement>('[data-frame-color]')!;
  const frameColorCode = form.querySelector<HTMLOutputElement>('[data-frame-color-code]')!;
  let frameColors: Partial<Record<keyof typeof frameDefaults, string>> = {};
  const tabs = [...form.querySelectorAll<HTMLButtonElement>('.profile-appearance-tabs button')];
  const panels = form.querySelectorAll<HTMLElement>('[data-appearance-panel]');
  const palette = mountThemeColors(colorsRoot, change);
  form.closest('dialog')?.addEventListener('close', () => stopProfileEffect(preview), { once: true });

  function populate(value: ProfileAppearance) {
    bio.value = value.bio;
    theme.value = value.theme;
    frame.value = value.frame;
    effect = value.effect;
    frameColors = supportsFrameColor(value.frame) && value.frameColor ? { [value.frame]: value.frameColor } : {};
    palette.set(value.colors);
  }

  const draft = (): ProfileAppearance => ({
    bio: bio.value.trim(), theme: theme.value as ProfileAppearance['theme'],
    frame: frame.value as ProfileAppearance['frame'], effect,
    ...(theme.value === 'personalizado' ? { colors: palette.value() } : {}),
    ...(supportsFrameColor(frame.value) && frameColors[frame.value] ? { frameColor: frameColors[frame.value] } : {}),
  });

  function dirty() {
    const value = draft();
    return value.bio !== saved.bio || value.theme !== saved.theme || value.frame !== saved.frame || value.effect !== saved.effect
      || value.frameColor !== saved.frameColor || JSON.stringify(value.colors) !== JSON.stringify(saved.colors);
  }

  function refresh() {
    const value = draft();
    colorsRoot.hidden = value.theme !== 'personalizado';
    for (const choice of choices) choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === value.theme));
    for (const choice of effectChoices) choice.setAttribute('aria-pressed', String(choice.dataset.effectChoice === value.effect));
    for (const choice of frameChoices) {
      const kind = choice.dataset.frameChoice!;
      choice.setAttribute('aria-pressed', String(kind === value.frame));
      applyFrameColor(choice.querySelector<HTMLElement>('.profile-frame-sample')!, kind,
        supportsFrameColor(kind) ? frameColors[kind] : undefined);
    }
    frameColorControls.hidden = !supportsFrameColor(value.frame);
    customFrameColor.checked = Boolean(value.frameColor);
    frameSwatch.hidden = !customFrameColor.checked;
    if (supportsFrameColor(value.frame)) {
      const color = value.frameColor ?? frameDefaults[value.frame];
      frameColor.value = color.toLowerCase();
      frameColorCode.value = color;
    }
    renderProfileAppearance(preview, value);
    replay.disabled = value.effect === 'none';
  }

  populate(saved);
  refresh();
  function change() {
    stopProfileEffect(preview);
    refresh();
    onChange();
  }
  form.addEventListener('input', event => {
    if (!(event.target instanceof Node && (colorsRoot.contains(event.target) || frameColorControls.contains(event.target)))) change();
  });
  for (const choice of choices) choice.addEventListener('click', () => {
    theme.value = choice.dataset.themeChoice!;
    change();
  });
  for (const choice of frameChoices) choice.addEventListener('click', () => {
    frame.value = choice.dataset.frameChoice!;
    change();
  });
  for (const choice of effectChoices) choice.addEventListener('click', () => {
    effect = choice.dataset.effectChoice as ProfileEffect;
    change();
  });
  customFrameColor.addEventListener('change', () => {
    const kind = frame.value;
    if (!supportsFrameColor(kind)) return;
    if (customFrameColor.checked) frameColors[kind] = frameDefaults[kind];
    else delete frameColors[kind];
    change();
  });
  frameColor.addEventListener('input', () => {
    if (!supportsFrameColor(frame.value) || !customFrameColor.checked) return;
    frameColors[frame.value] = frameColor.value.toUpperCase();
    change();
  });
  for (const tab of tabs) tab.addEventListener('click', () => {
    for (const button of tabs) button.setAttribute('aria-pressed', String(button === tab));
    for (const panel of panels) panel.hidden = panel.id !== tab.getAttribute('aria-controls');
  });
  replay.addEventListener('click', () => playProfileEffect(preview, draft()));
  return {
    dirty,
    reset() { populate(saved); stopProfileEffect(preview); refresh(); },
    async save() {
      if (!dirty()) return;
      saved = await updateProfileAppearance(email, draft());
      populate(saved);
      onSave(saved);
      refresh();
    },
  };
}
