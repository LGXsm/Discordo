import { DURATION, FPS, simulateSmoke, smokeContour, type SmokeLayout } from './smoke-physics';

type Point = [number, number];
type SmokeParticle = ReturnType<typeof simulateSmoke>['frames'][number][number];

function ramp(time: number, start: number, end: number) {
  const progress = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}

function cloudPath(points: Point[]) {
  const path = new Path2D();
  const last = points[points.length-1];
  path.moveTo((last[0]+points[0][0])/2, (last[1]+points[0][1])/2);
  for (let i=0; i<points.length; i++) {
    const a=points[i], b=points[(i+1)%points.length];
    path.quadraticCurveTo(a[0], a[1], (a[0]+b[0])/2, (a[1]+b[1])/2);
  }
  path.closePath();
  return path;
}
function drawPuff(ctx: CanvasRenderingContext2D, p: SmokeParticle, t: number) {
  const alpha = ramp(t-p.born,0,.09);
  if (alpha<.001) return;
  const path = cloudPath(smokeContour(p,t));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.id%3===0 ? '#e8eef3' : '#f5f8fa';
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  // Moving cel shadows reinforce rolling volume while retaining flat illustration.
  const shade = new Path2D();
  const shift = Math.sin(t*1.8+p.phase)*p.r*.12;
  shade.moveTo(p.x-p.r*1.4,p.y+p.r*.12);
  shade.bezierCurveTo(p.x-p.r*.3,p.y+p.r*.8,p.x+p.r*.48+shift,p.y+p.r*.3,p.x+p.r*1.3,p.y-p.r*.4);
  shade.lineTo(p.x+p.r*1.5,p.y+p.r*1.5);
  shade.lineTo(p.x-p.r*1.5,p.y+p.r*1.5);
  shade.closePath();
  ctx.fillStyle = p.id%3===0 ? '#8f9eae' : '#aab6c2';
  ctx.fill(shade);
  ctx.restore();
  ctx.strokeStyle='#29303a';
  ctx.lineWidth=1.55;
  ctx.stroke(path);
  if(p.r>17 && p.id%3===0) {
    ctx.beginPath();
    ctx.ellipse(p.x-p.r*.17,p.y-p.r*.19,p.r*.35,p.r*.27,Math.sin(t+p.phase)*.5,3.5,6.1);
    ctx.lineWidth=1.15;
    ctx.stroke();
  }
}

function drawContinuousPlume(ctx: CanvasRenderingContext2D, layout: SmokeLayout, particles: SmokeParticle[], time: number) {
  const incoming = particles.filter(p => !p.hit);
  if (!incoming.length) return;
  const angle = Math.atan2(layout.height - 16 - layout.y, layout.width - 12 - layout.x);
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const sections = incoming.map(p => ({
    along: (p.x - layout.x) * dx + (p.y - layout.y) * dy,
    across: -(p.x - layout.x) * dy + (p.y - layout.y) * dx,
    radius: p.r * (.96 + .04 * Math.sin(time * 2.1 + p.phase)),
  }));
  if (time < 3.16) sections.push({ along: 0, across: 0, radius: 1.6 });
  const start = Math.max(0, Math.min(...sections.map(p => p.along - p.radius)));
  const end = Math.max(...sections.map(p => p.along + p.radius));
  const top: Point[] = [];
  const bottom: Point[] = [];
  const inner: Point[] = [];
  const world = (along: number, across: number): Point => [layout.x + along * dx - across * dy, layout.y + along * dy + across * dx];
  // The envelope merges overlapping volumes into one closed, changing silhouette.
  for (let i = 0; i <= 120; i++) {
    const along = start + (end - start) * i / 120;
    let upper = Infinity;
    let lower = -Infinity;
    for (const p of sections) {
      const offset = along - p.along;
      if (Math.abs(offset) > p.radius) continue;
      const radius = Math.sqrt(Math.max(0, p.radius * p.radius - offset * offset));
      upper = Math.min(upper, p.across - radius);
      lower = Math.max(lower, p.across + radius);
    }
    if (!Number.isFinite(upper)) continue;
    const curl = Math.sin(along * .12 - time * 3) * Math.min(2.3, (lower - upper) * .055);
    top.push(world(along, upper + curl));
    bottom.push(world(along, lower + curl));
    inner.push(world(along, lower * .35 + upper * .12 + curl * 2));
  }
  if (top.length < 3) return;
  const silhouette = cloudPath([...top, ...bottom.slice().reverse()]);
  ctx.globalAlpha = ramp(time, .08, .22);
  ctx.fillStyle = '#f5f8fa';
  ctx.fill(silhouette);
  ctx.save();
  ctx.clip(silhouette);
  ctx.fillStyle = '#aab6c2';
  ctx.fill(cloudPath([...inner, ...bottom.slice().reverse()]));
  ctx.restore();
  ctx.lineWidth = 1.55;
  ctx.strokeStyle = '#29303a';
  ctx.stroke(silhouette);
  // Sparse, open curves describe folds without dividing the plume into balls.
  for (let i = 24; i < top.length - 10; i += 28) {
    const a = top[i];
    const b = inner[Math.min(i + 7, inner.length - 1)];
    const c = inner[Math.min(i + 14, inner.length - 1)];
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.quadraticCurveTo(b[0] - dx * 5, b[1] - dy * 5, c[0], c[1]);
    ctx.lineWidth = 1.1;
    ctx.stroke();
  }
}

export function createSmokeRenderer(canvas: HTMLCanvasElement, continuous = true) {
  const ctx = canvas.getContext('2d');
  let layout: SmokeLayout;
  let simulation: ReturnType<typeof simulateSmoke>;
  let pixelRatio = 1;

  return {
    resize(next: SmokeLayout) {
      layout = next;
      pixelRatio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(layout.width * pixelRatio);
      canvas.height = Math.round(layout.height * pixelRatio);
      simulation = simulateSmoke(layout);
    },
    render(time: number) {
      if (!ctx || !simulation) return;
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, layout.width + 1, layout.height + 1);
      canvas.style.opacity = String(1 - ramp(time, 4.2, DURATION));
      const position = Math.max(0, Math.min(time, DURATION)) * FPS;
      const frame = Math.floor(position);
      const fraction = position - frame;
      const next = simulation.frames[Math.min(frame + 1, simulation.frames.length - 1)];
      const particles = simulation.frames[frame].map((particle, index) => {
        const following = next[index] ?? particle;
        return {
          ...particle,
          x: particle.x + (following.x - particle.x) * fraction,
          y: particle.y + (following.y - particle.y) * fraction,
        };
      });
      particles.sort((a, b) => Number(b.hit) - Number(a.hit) || a.id - b.id);
      for (const particle of particles) {
        if (!continuous || particle.hit) drawPuff(ctx, particle, time);
      }
      if (continuous) drawContinuousPlume(ctx, layout, particles, time);
      ctx.globalAlpha = 1;
    },
  };
}
