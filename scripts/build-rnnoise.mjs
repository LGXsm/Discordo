import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const project = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.WASI_SDK_PATH) throw new Error('Defina WASI_SDK_PATH com a pasta do wasi-sdk.');
const compiler = path.join(process.env.WASI_SDK_PATH, 'bin', process.platform === 'win32' ? 'clang.exe' : 'clang');
const sources = ['denoise', 'rnn', 'pitch', 'kiss_fft', 'celt_lpc', 'nnet', 'nnet_default',
  'parse_lpcnet_weights', 'rnnoise_data_little', 'rnnoise_tables'];
const result = spawnSync(compiler, [
  '-O3', '-flto', '-msimd128', '-mexec-model=reactor',
  '-Ivendor/rnnoise/include', '-Ivendor/rnnoise/src',
  'vendor/rnnoise/browser.c', ...sources.map(name => `vendor/rnnoise/src/${name}.c`),
  '-Wl,--export=noise_create', '-Wl,--export=noise_frame',
  '-Wl,--export=noise_process', '-Wl,--export=noise_destroy',
  '-Wl,--initial-memory=16777216', '-Wl,--max-memory=16777216',
  '-Wl,-z,stack-size=262144', '-lm', '-o', 'frontend/src/rnnoise.wasm',
], { cwd: project, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
