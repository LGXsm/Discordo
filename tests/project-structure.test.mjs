import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import config from '../vite.config.mjs';

const project = new URL('../', import.meta.url);
const exists = relative => access(new URL(relative, project));

test('Frontend and backend resolve from their separate project folders', async () => {
  const settings = config({ mode: 'development' });
  assert.equal(settings.root, fileURLToPath(new URL('frontend/', project)));
  assert.equal(settings.build.outDir, fileURLToPath(new URL('dist/', project)));
  await Promise.all([
    'frontend/index.html', 'frontend/src/main.ts', 'frontend/public/art/logo.webp',
    'frontend/public/discordo-atalhos.zip', 'backend/src/account.php', 'backend/src/voice.mjs',
    'backend/src/start.mjs', 'shared/voice-channels.json', 'scripts/publish-hostgator.py',
    'extensions/discordo-atalhos/manifest.json', 'vendor/rnnoise/COPYING',
  ].map(exists));
  const pkg = JSON.parse(await readFile(new URL('package.json', project), 'utf8'));
  assert.equal(pkg.scripts.start, 'node backend/src/start.mjs');
  assert.equal(pkg.scripts.deploy, 'python scripts/publish-hostgator.py');
});

test('Database and original artwork stay outside the published frontend', async () => {
  const migrations = await readdir(new URL('database/migrations/', project));
  assert.equal(migrations.filter(name => name.endsWith('.sql')).length, 8);
  assert.ok(migrations.includes('friends.sql'));
  assert.ok(migrations.includes('message-permissions.sql'));
  await Promise.all(['database/discordo-esquema-atual.sql', 'database/modelos/discordoBrasil.mwb',
    'Imagens/background.jpg', 'Imagens/logo-pequena.png'].map(exists));
  const publicFiles = await readdir(new URL('frontend/public/', project));
  assert.ok(!publicFiles.some(name => /sql|referencias|imagens|vendor|backend/i.test(name)));
  assert.deepEqual((await readdir(new URL('frontend/public/art/', project))).sort(),
    ['chat-grafite.webp', 'chat-parede-ultrawide.webp', 'fundo-amizades.webp', 'logo-pequena.webp', 'logo-principal.webp', 'logo.webp', 'new-background.webp', 'tijolos-chat.webp', 'voice-recua-fascista.webp', 'voice-se-fudeu.webp', 'wall.webp']);
});
