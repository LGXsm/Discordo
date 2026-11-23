import workletUrl from './rnnoise-worklet.js?url&no-inline';
import wasmUrl from './rnnoise.wasm?url';

let compiled: Promise<WebAssembly.Module> | undefined;

export const rnnoiseSupported = () => Boolean(window.AudioWorkletNode && window.AudioContext && window.WebAssembly);

function loadModule() {
  compiled ??= fetch(wasmUrl).then(async response => {
    if (!response.ok) throw new Error('Não foi possível carregar o RNNoise.');
    return WebAssembly.compile(await response.arrayBuffer());
  }).catch(error => {
    compiled = undefined;
    throw error;
  });
  return compiled;
}

export async function createNoiseSuppressor(context: AudioContext, enabled: boolean) {
  if (context.sampleRate !== 48000) throw new Error('RNNoise precisa de áudio a 48 kHz.');
  const [module] = await Promise.all([loadModule(), context.audioWorklet.addModule(workletUrl)]);
  const node = new AudioWorkletNode(context, 'discordo-rnnoise', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { module, enabled },
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => fail(), 5000);
    const fail = () => {
      clearTimeout(timeout);
      node.port.postMessage({ type: 'stop' });
      node.port.close();
      reject(new Error('Não foi possível iniciar o RNNoise.'));
    };
    node.onprocessorerror = fail;
    node.port.onmessage = ({ data }) => {
      if (data.type !== 'ready') return;
      clearTimeout(timeout);
      node.onprocessorerror = null;
      node.port.onmessage = null;
      resolve();
    };
  });
  return node;
}
