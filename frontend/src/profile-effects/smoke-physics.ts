export const DURATION = 5;
export const FPS = 60;
const STEP = 1 / FPS;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const random = (i: number) => Math.abs((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1);

export type SmokeLayout = { width: number; height: number; x: number; y: number };
type SmokeParticle = {
  id: number; x: number; y: number; vx: number; vy: number; born: number;
  r: number; hit: boolean; spreadAge: number; squeeze: number; spin: number;
  phase: number; branch: number; size: number;
};

// Fixed steps make replay and scrubbing reproduce the same collisions.
export function simulateSmoke({ width, height, x, y }: SmokeLayout) {
  const particles: SmokeParticle[] = [];
  const frames: SmokeParticle[][] = [];
  let collisions = 0;
  const aimX = width - 12 - x;
  const aimY = height - 16 - y;
  const length = Math.hypot(aimX, aimY);
  for (let frame = 0; frame <= DURATION * FPS; frame++) {
    const time = frame * STEP;
    const count = Math.min(140, Math.max(0, Math.floor((time - .08) * 46)));
    while (particles.length < count) {
      const id = particles.length;
      const speed = length / 1.4 * (.88 + random(id + 2) * .22);
      particles.push({ id, x, y, vx: aimX / length * speed, vy: aimY / length * speed,
        born: time, r: 2, hit: false, spreadAge: 0, squeeze: 0, spin: random(id + 80) * 6.28,
        phase: random(id + 50) * 6.28, branch: id % 2, size: .8 + random(id + 100) * .4 });
    }
    // Expanding puffs exert pressure on neighbours and push into open space.
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        if (!a.hit || !b.hit) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy);
        const separation = (a.r + b.r) * .74;
        if (distance >= separation || distance < .01) continue;
        const impulse = (separation - distance) * 8 * STEP;
        a.vx -= dx / distance * impulse;
        a.vy -= dy / distance * impulse;
        b.vx += dx / distance * impulse;
        b.vy += dy / distance * impulse;
      }
    }
    for (const p of particles) {
      const age = time - p.born;
      p.r = p.size * (4.2 + 21 * (1 - Math.exp(-age * 3.2)) + (p.hit ? 26 * (1 - Math.exp(-p.spreadAge * 1.8)) : 0));
      p.squeeze *= .9;
      if (p.hit) {
        p.spreadAge += STEP;
        const across = p.branch === 0;
        const turn = across ? clamp((width * .78 - p.x) / (width * .58), 0, 1) : clamp((height * .72 - p.y) / (height * .5), 0, 1);
        const targetX = across ? -135 * (1 - .65 * turn) : -95 * turn;
        const targetY = across ? -16 - height * .43 * turn : -height * .63;
        p.vx += (targetX - p.vx) * STEP * 2.4;
        p.vy += (targetY - p.vy) * STEP * 2.4;
        p.vx += Math.sin(time * 3.3 + p.phase) * 35 * STEP;
        p.vy += Math.cos(time * 2.8 + p.phase) * 28 * STEP;
      } else {
        p.vx += Math.sin(time * 11 + p.phase) * 20 * STEP;
        p.vy += Math.cos(time * 9 + p.phase) * 35 * STEP;
      }
      p.x += p.vx * STEP;
      p.y += p.vy * STEP;
      const margin = p.r * .62;
      if ((p.x > width - margin || p.y > height - margin) && !p.hit) {
        p.hit = true;
        p.squeeze = 1;
        collisions++;
        // Normal momentum is lost on impact and redirected along wall tangents.
        p.vx = p.branch === 0 ? -165 : -15;
        p.vy = p.branch === 0 ? -12 : -height * .65;
      }
      if (p.hit) {
        if (p.x < margin || p.x > width - margin) {
          p.x = clamp(p.x, margin, width - margin);
          p.vx *= -.12;
          p.squeeze = Math.max(p.squeeze, .35);
        }
        if (p.y < margin || p.y > height - margin) {
          p.y = clamp(p.y, margin, height - margin);
          p.vy *= -.12;
          p.squeeze = Math.max(p.squeeze, .35);
        }
      }
    }
    frames.push(particles.map(p => ({ ...p })));
  }
  return { frames, collisions };
}

export function smokeContour(p: SmokeParticle, time: number) {
  const points: [number, number][] = [];
  const lobes = 5 + p.id % 3;
  const rotation = p.spin + time * (.23 + .09 * Math.sin(p.phase));
  for (let i = 0; i < 64; i++) {
    const angle = i / 64 * Math.PI * 2;
    let radius = p.r * .75;
    for (let lobe = 0; lobe < lobes; lobe++) {
      const direction = lobe / lobes * Math.PI * 2 + .1 * Math.sin(time * 2.4 + lobe);
      const center = p.r * (.52 + .055 * Math.sin(time * 3 + lobe + p.phase));
      const size = p.r * (.49 + .05 * Math.sin(time * 2.1 - lobe + p.phase));
      const cross = center * Math.sin(angle - direction);
      if (Math.abs(cross) < size) radius = Math.max(radius,
        center * Math.cos(angle - direction) + Math.sqrt(size * size - cross * cross));
    }
    const xx = Math.cos(angle) * radius * (1 - p.squeeze * .22);
    const yy = Math.sin(angle) * radius * (1 + p.squeeze * .2);
    points.push([p.x + xx * Math.cos(rotation) - yy * Math.sin(rotation),
      p.y + xx * Math.sin(rotation) + yy * Math.cos(rotation)]);
  }
  return points;
}
