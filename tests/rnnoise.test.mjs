import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const module = await WebAssembly.compile(await readFile(new URL('../frontend/src/rnnoise.wasm', import.meta.url)));
const source = await readFile(new URL('../frontend/src/rnnoise-worklet.js', import.meta.url), 'utf8');
let Processor;
vm.runInNewContext(source, {
  WebAssembly, Float32Array,
  AudioWorkletProcessor: class {
    port = { postMessage() {}, onmessage: null };
  },
  registerProcessor(name, implementation) {
    assert.equal(name, 'discordo-rnnoise');
    Processor = implementation;
  },
});

const create = (enabled = true) => new Processor({ processorOptions: { module, enabled } });
const configure = (processor, enabled) => processor.port.onmessage({ data: { type: 'enabled', enabled } });
const stop = processor => processor.port.onmessage({ data: { type: 'stop' } });

test('RNNoise reduces steady noise across 128-sample render blocks', () => {
  const processor = create();
  const input = new Float32Array(128);
  const output = new Float32Array(128);
  let seed = 42;
  let inputEnergy = 0;
  let outputEnergy = 0;
  for (let block = 0; block < 1125; block++) {
    for (let i = 0; i < 128; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      input[i] = (seed / 4294967296 - .5) * .1;
    }
    assert.equal(processor.process([[input]], [[output]]), true);
    for (let i = 0; i < 128; i++) {
      assert.ok(Number.isFinite(output[i]), 'Output must contain finite audio samples');
      if (block < 375) continue;
      inputEnergy += input[i] ** 2;
      outputEnergy += output[i] ** 2;
    }
  }
  const ratio = outputEnergy / inputEnergy;
  assert.ok(ratio < .2, `Expected noise reduction, energy ratio was ${ratio}`);
  stop(processor);
});

test('Disabling suppression passes audio unchanged and can be re-enabled', () => {
  const processor = create(false);
  const input = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 8) * .2);
  const output = new Float32Array(128);
  processor.process([[input]], [[output]]);
  assert.deepEqual(output, input);
  configure(processor, true);
  processor.process([[input]], [[output]]);
  assert.ok(output.every(value => value === 0), 'A new frame queue starts with silence');
  configure(processor, false);
  processor.process([[input]], [[output]]);
  assert.deepEqual(output, input);
  stop(processor);
  assert.equal(processor.process([[input]], [[output]]), false);
});

test('Independent calls have isolated model state and release their processors', () => {
  const first = create();
  const second = create();
  const output = new Float32Array(128);
  first.process([[new Float32Array(128).fill(.4)]], [[output]]);
  stop(first);
  for (let i = 0; i < 10; i++) second.process([[new Float32Array(128)]], [[output]]);
  assert.ok(output.every(value => value === 0));
  stop(second);
});
