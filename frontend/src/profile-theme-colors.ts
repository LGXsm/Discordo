export type ThemeColors =
  | { mode: 'solid'; primary: string }
  | { mode: 'gradient'; primary: string; secondary: string; direction: 'vertical' | 'horizontal' | 'diagonal' };

const hexPattern = /^#[0-9a-f]{6}$/i;
export function isThemeHex(value: unknown): value is string {
  return typeof value === 'string' && hexPattern.test(value);
}
const directions = { vertical: '180deg', horizontal: '90deg', diagonal: '135deg' } as const;
const defaultPrimary = '#51387B';
const defaultSecondary = '#24577B';

const gradientMarkup = `
    <div class="theme-color-modes" role="group" aria-label="Tipo de cor">
      <button type="button" data-color-mode="solid" aria-pressed="true">Cor sólida</button>
      <button type="button" data-color-mode="gradient" aria-pressed="false">Gradiente</button>
    </div>
    <div class="theme-gradient-options" data-gradient-options hidden>
      <div class="theme-gradient-stops" role="group" aria-label="Cor do gradiente a editar">
        <button type="button" data-color-stop="primary" aria-pressed="true"><i aria-hidden="true"></i> Cor 1</button>
        <button type="button" data-color-stop="secondary" aria-pressed="false"><i aria-hidden="true"></i> Cor 2</button>
      </div>
      <label>Direção
        <select data-color-direction><option value="vertical">Vertical</option><option value="horizontal">Horizontal</option><option value="diagonal">Diagonal</option></select>
      </label>
    </div>`;

export const solidColorControls = `
    <button type="button" class="theme-color-plane" data-color-plane aria-label="Saturação e brilho. Ajuste com as setas.">
      <span aria-hidden="true"></span>
    </button>
    <input class="theme-color-hue" data-color-hue type="range" min="0" max="359" step="1" aria-label="Matiz">
    <label class="theme-hex-label">HEX
      <span class="theme-hex-input"><i aria-hidden="true" data-color-swatch></i><input type="text" data-color-hex maxlength="7" spellcheck="false" autocomplete="off"></span>
    </label>`;

export const themeColorsMarkup = `<div class="theme-color-picker" data-theme-colors hidden>
    ${gradientMarkup}
    ${solidColorControls}
  </div>`;

function rgb(hex: string) {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function toHsv(hex: string) {
  const [r, g, b] = rgb(hex);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta) {
    if (max === r) hue = (g - b) / delta;
    else if (max === g) hue = 2 + (b - r) / delta;
    else hue = 4 + (r - g) / delta;
  }
  return { h: Math.min(359, Math.round((hue * 60 + 360) % 360)), s: max ? delta / max : 0, v: max };
}

function toHex(h: number, s: number, v: number) {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16).padStart(2, '0');
  };
  return ('#' + channel(5) + channel(3) + channel(1)).toUpperCase();
}

function luminance(channels: number[]) {
  const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

export function paintThemeColors(card: HTMLElement, colors?: ThemeColors) {
  const properties = [
    '--card-surface', '--card-banner', '--card-accent', '--card-text',
    '--card-control-surface', '--card-control-border', '--card-role-color',
  ];
  if (!colors || !hexPattern.test(colors.primary) ||
      (colors.mode === 'gradient' && (!hexPattern.test(colors.secondary) || !Object.hasOwn(directions, colors.direction)))) {
    for (const property of properties) card.style.removeProperty(property);
    return;
  }
  const primary = colors.primary;
  const secondary = colors.mode === 'gradient' ? colors.secondary : primary;
  const background = colors.mode === 'gradient'
    ? `linear-gradient(${directions[colors.direction]} in srgb, ${primary}, ${secondary})`
    : primary;
  const first = rgb(primary);
  const last = rgb(secondary);
  // Relative luminance is convex along an sRGB gradient. The maximum is at one of the stops.
  const max = Math.max(luminance(first), luminance(last));
  // Each interpolated channel stays above its lower endpoint.
  const min = luminance(first.map((channel, index) => Math.min(channel, last[index])));
  const useLightText = 1.05 / (max + .05) >= 4.5;
  const useDarkText = (min + .05) / .05 >= 4.5;
  const dark = !useLightText && useDarkText;
  const text = dark ? '#000000' : '#FFFFFF';
  const needsOverlay = !useLightText && !useDarkText;
  const overlay = '#100B18';
  const surface = needsOverlay ? `linear-gradient(${overlay}AA, ${overlay}AA), ${background}` : background;
  const chroma = (channels: number[]) => Math.max(...channels) - Math.min(...channels);
  const tint = chroma(last) > chroma(first) ? last : first;
  const shade = rgb(dark ? '#000000' : '#F4F2F6');
  const tinted = tint.map((channel, index) => Math.round(255 * (.24 * channel + .76 * shade[index])));
  const tintedLight = luminance(tinted.map(channel => channel / 255));
  const overlayChannels = rgb(overlay);
  const lightest = needsOverlay
    ? Math.max(...[first, last].map(stop => luminance(stop.map((channel, index) => (channel + 2 * overlayChannels[index]) / 3))))
    : max;
  const contrast = dark ? (min + .05) / (tintedLight + .05) : (tintedLight + .05) / (lightest + .05);
  card.style.setProperty('--card-surface', surface);
  card.style.setProperty('--card-banner', background);
  card.style.setProperty('--card-accent', text);
  card.style.setProperty('--card-text', text);
  card.style.setProperty('--card-control-surface', dark ? '#FFFFFF8C' : '#00000046');
  card.style.setProperty('--card-control-border', dark ? '#00000073' : '#FFFFFF90');
  card.style.setProperty('--card-role-color', contrast >= 4.5 ? `rgb(${tinted.join(' ')})` : text);
}

export function mountThemeColors(root: HTMLElement, onChange: () => void) {
  const plane = root.querySelector<HTMLButtonElement>('[data-color-plane]')!;
  const marker = plane.querySelector('span')!;
  const hue = root.querySelector<HTMLInputElement>('[data-color-hue]')!;
  const hex = root.querySelector<HTMLInputElement>('[data-color-hex]')!;
  const swatch = root.querySelector<HTMLElement>('[data-color-swatch]')!;
  const direction = root.querySelector<HTMLSelectElement>('[data-color-direction]');
  const gradient = root.querySelector<HTMLElement>('[data-gradient-options]');
  const modes = [...root.querySelectorAll<HTMLButtonElement>('[data-color-mode]')];
  const stops = [...root.querySelectorAll<HTMLButtonElement>('[data-color-stop]')];
  let mode: ThemeColors['mode'] = 'solid';
  let colors = { primary: defaultPrimary, secondary: defaultSecondary };
  let active: keyof typeof colors = 'primary';
  let hsv = toHsv(colors.primary);
  let pointer: number | undefined;

  function render(updateHex = true) {
    if (gradient) gradient.hidden = mode !== 'gradient';
    for (const button of modes) button.setAttribute('aria-pressed', String(button.dataset.colorMode === mode));
    for (const [index, button] of stops.entries()) {
      const stop = index === 0 ? 'primary' : 'secondary';
      button.setAttribute('aria-pressed', String(stop === active));
      button.querySelector('i')!.style.background = colors[stop];
    }
    hue.value = String(hsv.h);
    plane.style.setProperty('--picker-hue', String(hsv.h));
    marker.style.left = `${hsv.s * 100}%`;
    marker.style.top = `${(1 - hsv.v) * 100}%`;
    plane.setAttribute('aria-label', `Saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%. Ajuste com as setas.`);
    swatch.style.background = colors[active];
    if (updateHex) {
      hex.value = colors[active];
      hex.removeAttribute('aria-invalid');
    }
  }

  function changeFromPicker() {
    colors[active] = toHex(hsv.h, hsv.s, hsv.v);
    render();
    onChange();
  }

  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  function selectPoint(event: PointerEvent) {
    const rect = plane.getBoundingClientRect();
    hsv.s = clamp((event.clientX - rect.left) / rect.width);
    hsv.v = 1 - clamp((event.clientY - rect.top) / rect.height);
    changeFromPicker();
  }
  plane.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointer !== undefined) return;
    pointer = event.pointerId;
    plane.setPointerCapture(pointer);
    selectPoint(event);
  });
  plane.addEventListener('pointermove', event => { if (event.pointerId === pointer) selectPoint(event); });
  plane.addEventListener('lostpointercapture', () => { pointer = undefined; });
  plane.addEventListener('keydown', event => {
    const step = event.shiftKey ? .1 : .02;
    if (event.key === 'ArrowLeft') hsv.s = clamp(hsv.s - step);
    else if (event.key === 'ArrowRight') hsv.s = clamp(hsv.s + step);
    else if (event.key === 'ArrowDown') hsv.v = clamp(hsv.v - step);
    else if (event.key === 'ArrowUp') hsv.v = clamp(hsv.v + step);
    else return;
    event.preventDefault();
    changeFromPicker();
  });
  hue.addEventListener('input', () => {
    hsv.h = hue.valueAsNumber;
    changeFromPicker();
  });
  hex.addEventListener('input', () => {
    const value = '#' + hex.value.trim().replace(/^#/, '').toUpperCase();
    if (!hexPattern.test(value)) { hex.setAttribute('aria-invalid', 'true'); return; }
    colors[active] = value;
    hsv = toHsv(value);
    hex.removeAttribute('aria-invalid');
    render(false);
    onChange();
  });
  hex.addEventListener('blur', () => render());
  direction?.addEventListener('change', onChange);
  for (const button of modes) button.addEventListener('click', () => {
    mode = button.dataset.colorMode === 'gradient' ? 'gradient' : 'solid';
    if (mode === 'solid') active = 'primary';
    hsv = toHsv(colors[active]);
    render();
    onChange();
  });
  for (const button of stops) button.addEventListener('click', () => {
    active = button.dataset.colorStop === 'secondary' ? 'secondary' : 'primary';
    hsv = toHsv(colors[active]);
    render();
  });
  return {
    value(): ThemeColors {
      return mode === 'solid' || !direction ? { mode: 'solid', primary: colors.primary }
        : { mode, ...colors, direction: direction.value as keyof typeof directions };
    },
    set(value?: ThemeColors) {
      mode = direction ? value?.mode ?? 'solid' : 'solid';
      colors = { primary: value?.primary ?? defaultPrimary, secondary: value?.mode === 'gradient' ? value.secondary : defaultSecondary };
      if (direction) direction.value = value?.mode === 'gradient' ? value.direction : 'vertical';
      active = 'primary';
      hsv = toHsv(colors.primary);
      render();
    },
  };
}
