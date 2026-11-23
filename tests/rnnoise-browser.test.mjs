import assert from 'node:assert/strict';
import { launchTestChrome } from './browser-chrome.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';

test('Browser microphone uses RNNoise and releases it on leaving a call', { timeout: 40000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'discordo-rnnoise-test-'));
  const server = await createServer({ server: { port: 0 }, logLevel: 'silent' });
  server.middlewares.use('/rnnoise-test', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>RNNoise regression</title>');
  });
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const chrome = launchTestChrome(profile);
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome did not start')), 10000);
      chrome.once('error', error => { clearTimeout(timer); reject(error); });
      let output = '';
      chrome.stderr.on('data', data => {
        output += data;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const url = new URL(endpoint);
    const pages = await fetch(`http://${url.host}/json/list`).then(response => response.json());
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    await command('Page.navigate', { url: `${origin}rnnoise-test` });
    await new Promise(resolve => setTimeout(resolve, 500));
    const evaluation = await command('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        const { VoiceMicrophone } = await import('/src/voice-microphone.ts');
        const preferences = { input: '', output: '', inputVolume: 100, outputVolume: 100, noiseSuppression: true };
        const mic = new VoiceMicrophone(preferences, () => {});
        await mic.start();
        const deadline = Date.now() + 10000;
        while (!mic.suppressor && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (!mic.suppressor) throw new Error('RNNoise did not start: ' + mic.notice);
        await mic.setNoiseSuppression(true);
        const context = mic.context;
        const processed = mic.track;
        if (processed === mic.stream.getAudioTracks()[0]) throw new Error('Raw microphone was sent');
        if (context.sampleRate !== 48000) throw new Error('Wrong sample rate');
        if (mic.stream.getAudioTracks()[0].getSettings().noiseSuppression) throw new Error('Double suppression');
        await mic.setNoiseSuppression(false);
        if (mic.track !== processed) throw new Error('Disabling RNNoise changed the outgoing track');
        await mic.setNoiseSuppression(true);
        mic.toggle();
        if (!mic.silent || mic.stream.getAudioTracks()[0].enabled) throw new Error('Mute was lost');
        mic.toggle();
        mic.setDeafened(true);
        if (!mic.silent || mic.stream.getAudioTracks()[0].enabled) throw new Error('Deafen was lost');
        mic.setDeafened(false);
        mic.configure({ ...preferences, inputVolume: 50 });
        if (mic.preferences.inputVolume !== 50) throw new Error('Volume preference was lost');
        mic.dispose();
        await new Promise(resolve => setTimeout(resolve, 100));
        if (context.state !== 'closed' || mic.suppressor || mic.available) throw new Error('Audio resources leaked');
        const probe = new AudioContext();
        const prototype = Object.getPrototypeOf(probe.audioWorklet);
        const original = prototype.addModule;
        prototype.addModule = async () => { throw new Error('Simulated module failure'); };
        const fallback = new VoiceMicrophone(preferences, () => {});
        const devices = navigator.mediaDevices;
        const capture = devices.getUserMedia;
        const nativeRequests = [];
        devices.getUserMedia = function (constraints) {
          nativeRequests.push(constraints.audio.noiseSuppression);
          return capture.call(this, constraints);
        };
        try {
          await fallback.start();
          const fallbackDeadline = Date.now() + 5000;
          while ((!fallback.nativeSuppression || fallback.requesting) && Date.now() < fallbackDeadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          if (!fallback.available || fallback.suppressor || !fallback.nativeSuppression) throw new Error('Fallback failed');
          if (!fallback.stream.getAudioTracks()[0].getSettings().noiseSuppression && !nativeRequests.includes(true)) {
            throw new Error('Native suppression was not requested');
          }
          await fallback.setNoiseSuppression(false);
          if (fallback.stream.getAudioTracks()[0].getSettings().noiseSuppression && nativeRequests.at(-1) !== false) {
            throw new Error('Native suppression was not turned off');
          }
          const activeTrack = fallback.track;
          const activeCapture = fallback.stream.getAudioTracks()[0];
          devices.getUserMedia = async () => { throw new DOMException('Simulated device failure', 'NotReadableError'); };
          activeCapture.applyConstraints = async () => { throw new DOMException('Simulated constraint failure', 'OverconstrainedError'); };
          await fallback.setNoiseSuppression(true);
          if (!fallback.available || fallback.track !== activeTrack || activeCapture.readyState !== 'live') {
            throw new Error('A failed suppression change interrupted a working microphone');
          }
        } finally {
          devices.getUserMedia = capture;
          prototype.addModule = original;
          fallback.dispose();
          await probe.close();
        }
        return { sampleRate: context.sampleRate, outgoingTrackEnded: processed.readyState === 'ended' };
      })()`,
    });
    assert.equal(evaluation.exceptionDetails, undefined, JSON.stringify(evaluation.exceptionDetails));
    assert.deepEqual(evaluation.result.value, { sampleRate: 48000, outgoingTrackEnded: true });
  } finally {
    socket?.close();
    const exited = new Promise(resolve => chrome.once('exit', resolve));
    chrome.kill();
    await exited;
    await server.close();
    assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
