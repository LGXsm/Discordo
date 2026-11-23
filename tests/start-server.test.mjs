import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir } from 'node:fs/promises';
import test from 'node:test';

test('The built Node server serves the shortcuts zip and RNNoise module', { timeout: 10000 }, async () => {
  const dist = new URL('../dist/assets/', import.meta.url);
  const wasm = (await readdir(dist)).find(name => /^rnnoise-.*\.wasm$/.test(name));
  assert.ok(wasm, 'Run npm run build before testing the production server');
  const child = spawn(process.execPath, ['backend/src/start.mjs'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0' },
  });
  const closed = once(child, 'close');
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) resolve(match[1]);
      });
      child.once('error', reject);
      child.once('exit', code => reject(new Error(`Server exited with ${code}`)));
    });
    const base = `http://127.0.0.1:${port}`;
    const zip = await fetch(`${base}/discordo-atalhos.zip`);
    assert.equal(zip.status, 200);
    assert.equal(zip.headers.get('content-type'), 'application/zip');
    assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(), 0x04034b50);
    const module = await fetch(`${base}/assets/${wasm}`);
    assert.equal(module.status, 200);
    assert.equal(module.headers.get('content-type'), 'application/wasm');
    await WebAssembly.compileStreaming(Promise.resolve(module));
  } finally {
    child.kill();
    await closed;
  }
});
