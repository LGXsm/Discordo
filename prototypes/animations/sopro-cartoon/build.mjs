import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from '../../../node_modules/rolldown/dist/index.mjs';

const fromHere = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const cache = join(tmpdir(), 'discordo-sopro-gsap-3.13.0');
const gsap = join(cache, 'node_modules/gsap/gsap-core.js');
if (!existsSync(gsap)) {
  const env = { ...process.env, npm_config_prefix: cache };
  const args = ['install', '--no-audit', '--no-fund', 'gsap@3.13.0'];
  if (process.platform === 'win32') execSync('npm.cmd install --no-audit --no-fund gsap@3.13.0', { env, stdio: 'inherit' });
  else execFileSync('npm', args, { env, stdio: 'inherit' });
}

const bundle = await rolldown({
  input: fromHere('./motion-source.mjs'),
  resolve: { alias: { gsap, three: fromHere('../../../../../.agents/skills/transformar-3d/build/three.module.js') } },
});
try {
  await bundle.write({ file: fromHere('./motion.js'), format: 'iife', minify: true, comments: { legal: true } });
} finally {
  await bundle.close();
}
