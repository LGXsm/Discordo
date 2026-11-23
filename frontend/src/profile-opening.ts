import alienArt from './profile-effects/alien.svg?raw';
import smokeIntroArt from './profile-effects/smoke.svg?raw';
import { createSmokeRenderer } from './profile-effects/smoke-renderer';
import { DURATION as smokeDuration } from './profile-effects/smoke-physics';

export type IllustratedEffect = 'brasa-fumaca' | 'visitante-vidro';

const alienDuration = 5;
const exhaleStart = 1.48;
const introEnd = 1.78;
let nextId = 0;

const lerp = (a: number, b: number, amount: number) => a + (b - a) * amount;
const step = (time: number, start: number, end: number) => Math.max(0, Math.min(1, (time - start) / (end - start)));
const soft = (amount: number) => amount * amount * (3 - 2 * amount);
const out = (amount: number) => 1 - (1 - amount) ** 3;
const translate = (x: number, y: number) => `translate(${x} ${y})`;

function paint(node: SVGElement, opacity: number, transform?: string) {
  node.setAttribute('opacity', opacity.toFixed(3));
  if (transform) node.setAttribute('transform', transform);
}

type FindArt = (name: string) => SVGElement;

function mountSmoke(card: HTMLElement, overlay: HTMLElement) {
  const group = document.createElement('div');
  group.className = 'profile-smoke';
  const prefix = `profile-fx-${++nextId}-`;
  group.innerHTML = smokeIntroArt.replaceAll('FX-', prefix);
  const intro = group.querySelector('svg')!;
  const find: FindArt = name => intro.querySelector(`#${prefix}${name}`)!;
  const dragging = find('dragging');
  const ember = find('ember');
  const thread = find('smoke-thread');
  const sparksGroup = find('sparks');
  const sparks = Array.from({ length: 7 }, (_, index) => {
    const spark = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    spark.setAttribute('r', index % 3 === 0 ? '1.9' : '1.1');
    sparksGroup.append(spark);
    return spark;
  });
  const canvas = document.createElement('canvas');
  canvas.dataset.effect = 'brasa-fumaca';
  group.prepend(canvas);
  overlay.append(group);
  const smoke = createSmokeRenderer(canvas);
  const avatar = card.querySelector('.profile-identity .avatar');
  let previous: Parameters<typeof smoke.resize>[0] | undefined;

  return {
    node: group,
    duration: exhaleStart + smokeDuration,
    render(time: number) {
      const area = overlay.getBoundingClientRect();
      const source = avatar?.getBoundingClientRect();
      if (!source?.width || !area.width || !area.height) return;
      const layout = {
        width: area.width,
        height: area.height,
        x: source.left - area.left + source.width * .77,
        y: source.top - area.top + source.height * .60,
      };
      if (time < introEnd) {
        const origin = translate(layout.x / layout.width * 350 - 81, layout.y / layout.height * 310 - 119);
        const inhale = Math.sin(Math.PI * step(time, .42, 1.45)) ** 2;
        paint(dragging, out(step(time, .12, .43)) * (1 - soft(step(time, 1.46, introEnd))),
          origin + translate(-1.7 * inhale, 1.2 * inhale));
        paint(ember, .18 + .82 * inhale,
          `translate(112 123) scale(${.61 + .51 * inhale}) translate(-112 -123)`);
        paint(thread, (.17 + .25 * (1 - inhale)) * out(step(time, .33, .64)),
          translate(Math.sin(time * 4) * 2, -step(time, .38, 1.5) * 5));
        sparksGroup.setAttribute('transform', origin);
        sparks.forEach((spark, index) => {
          const progress = step(time, .62 + index * .071, 1.24 + index * .071);
          paint(spark, Math.sin(Math.PI * progress) * .85,
            translate(112 + progress * (8 + index * 3), 123 - out(progress) * (16 + (index % 4) * 5)));
        });
      } else if (intro.isConnected) {
        intro.remove();
      }
      if (time < exhaleStart) return;
      if (!previous || layout.width !== previous.width || layout.height !== previous.height
        || layout.x !== previous.x || layout.y !== previous.y) {
        smoke.resize(layout);
        previous = layout;
      }
      smoke.render(time - exhaleStart);
    },
  };
}

function mountAlien(overlay: HTMLElement) {
  const prefix = `profile-fx-${++nextId}-`;
  overlay.innerHTML = alienArt.replaceAll('FX-', prefix);
  const svg = overlay.querySelector<SVGSVGElement>('svg')!;
  svg.dataset.effect = 'visitante-vidro';
  const find: FindArt = name => svg.querySelector(`#${prefix}${name}`)!;
  return { node: svg, duration: alienDuration, render: createAlien(find) };
}

function createAlien(find: FindArt) {
  const alien = find('alien');
  const eyes = find('eyes');
  const fog = find('condensation');
  const reflection = find('condensation-light');
  const visitor = find('visitor');
  const hand = find('hand');
  const gesture = find('gesture');
  const rim = find('wipe-rim');
  const wipe = ['wipe-window', 'wipe-hole', 'wipe-stroke'].map(name => find(name));

  return (time: number) => {
    const pass = soft(step(time, .77, 2.39));
    const leading = lerp(-55, 382, pass);
    const handY = 224 - .30 * leading + 6 * Math.sin(pass * Math.PI);
    const path = `M-56 169 Q ${leading * .47} ${164 - leading * .19} ${leading} ${handY - 52}
      q24 9 10 39 t-9 38 Q ${leading * .47} ${259 - leading * .125} -56 270 Z`;
    for (const node of wipe) node.setAttribute('d', path);
    paint(hand, out(step(time, .58, .91)) * (1 - soft(step(time, 2.28, 2.55))),
      translate(leading - 5, handY + 5) + ` rotate(${lerp(-30, 15, pass)}) scale(.83)`);

    const lift = out(step(time, 2.45, 3.06));
    const lower = soft(step(time, 3.77, 4.43));
    paint(gesture, soft(step(time, 2.48, 2.83)) * (1 - soft(step(time, 3.88, 4.41))),
      translate(lerp(65, 82, lift), lerp(306, 206, lift) + 4 * Math.sin(lift * Math.PI * 2) + lower * 74)
      + ` rotate(${lerp(-21, -7, lift)}) scale(.87)`);
    paint(visitor, out(step(time, .77, 1.03)) * (1 - soft(step(time, 3.79, 4.91))));
    paint(alien, 1, translate(lerp(13, -8, soft(step(time, .65, 2.52))), lerp(13, -4, soft(step(time, .74, 2.55))))
      + ` rotate(${lerp(-7, 3, soft(step(time, 1.12, 2.8)))} 205 160)`);
    const blink = Math.max(0, 1 - Math.abs(time - 3.09) / .12);
    paint(eyes, 1, `translate(0 150) scale(1 ${1 - .92 * blink}) translate(0 -150)`);
    paint(fog, .94 * out(step(time, .06, .53)) * (1 - soft(step(time, 3.67, 4.87))));
    paint(reflection, 1, translate(16 * Math.sin(time * .95), 5 * Math.sin(time * 1.1)));
    paint(rim, .76 * out(step(time, .82, 1.30)) * (1 - soft(step(time, 3.54, 4.80))));
  };
}

export function playIllustratedEffect(card: HTMLElement, overlay: HTMLElement, effect: IllustratedEffect, signal: AbortSignal) {
  if (signal.aborted) return;
  const { node, duration, render } = effect === 'brasa-fumaca' ? mountSmoke(card, overlay) : mountAlien(overlay);
  let frame = 0;
  const start = performance.now();

  function stop() {
    cancelAnimationFrame(frame);
    signal.removeEventListener('abort', stop);
    node.remove();
  }

  function tick(now: number) {
    const elapsed = (now - start) / 1000;
    if (!node.isConnected || elapsed >= duration) return stop();
    render(Math.max(0, elapsed));
    frame = requestAnimationFrame(tick);
  }

  render(0);
  signal.addEventListener('abort', stop, { once: true });
  frame = requestAnimationFrame(tick);
}
