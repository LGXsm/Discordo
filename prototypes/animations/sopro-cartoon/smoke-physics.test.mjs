import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateSmoke, smokeContour, FPS } from './smoke-physics.mjs';

for (const [width, height] of [[348, 310], [270, 328], [348, 385], [270, 423]]) {
  test(`Smoke hits the corner and fills ${width} × ${height}`, () => {
    const simulation = simulateSmoke({ width, height, x: 75.52, y: 125.6 });
    const early = simulation.frames[Math.round(.4 * FPS)];
    assert.ok(early.every(p => p.x > 75 && p.y > 125 && !p.hit));
    assert.ok(simulation.frames[Math.round(.9 * FPS)].every(p => !p.hit), 'The slower jet must not reach the wall early');
    const impact = simulation.frames[Math.round(2.3 * FPS)].filter(p => p.hit);
    assert.ok(impact.some(p => p.vx < -50));
    assert.ok(impact.some(p => p.vy < -50));
    assert.ok(simulation.collisions > 100);
    const full = simulation.frames[Math.round(4.15 * FPS)];
    let covered = 0;
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const x = (col + .5) * width / 10;
        const y = (row + .5) * height / 10;
        if (full.some(p => Math.hypot(p.x - x, p.y - y) < p.r)) covered++;
      }
    }
    assert.ok(covered >= 85, `Only ${covered}% covered`);
    assert.ok(full.every(p => Number.isFinite(p.x + p.y + p.r) && p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height));
  });
}

test('The drawing changes even with position and radius held constant', () => {
  const puff = { id: 3, x: 0, y: 0, r: 30, spin: 0, phase: 1, squeeze: 0 };
  const a = smokeContour(puff, 1);
  const b = smokeContour(puff, 1.5);
  const ratios = a.map((p, i) => Math.hypot(...p) / Math.hypot(...b[i]));
  assert.ok(Math.max(...ratios) - Math.min(...ratios) > .1);
});

test('Replay reproduces the same simulation', () => {
  const layout = { width: 348, height: 310, x: 75.52, y: 125.6 };
  assert.deepEqual(simulateSmoke(layout), simulateSmoke(layout));
});
