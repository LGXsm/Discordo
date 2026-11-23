import assert from 'node:assert/strict';
import { launchTestChrome } from './browser-chrome.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';

test('Voice worker recovers signaling, rebuilds playback, and respects an administrative disconnect', { timeout: 40000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'discordo-voice-test-'));
  const joins = [];
  let failOnce = true;
  let mode = 'normal';
  const server = await createServer({
    server: { port: 0 }, logLevel: 'silent',
    plugins: [{ name: 'voice-regression-endpoint', configureServer(vite) {
      vite.middlewares.use('/voice-test-control', async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        mode = Buffer.concat(chunks).toString();
        response.end('ok');
      });
      vite.middlewares.use('/voice.php', async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks).toString());
        const reply = (data, status = 200) => {
          response.writeHead(status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(data));
        };
        if (body.type === 'leave') return reply({ ok: true });
        if (body.type === 'join') {
          joins.push(body);
          return reply({ type: 'welcome', token: 'test-token',
            self: { id: 'local-' + joins.length, name: 'Player', muted: body.muted, deafened: body.deafened },
            members: [{ id: 'remote', name: 'Peer', muted: false, sharing: false }], iceServers: [] });
        }
        if (failOnce) { failOnce = false; return reply({ code: 'unavailable' }, 503); }
        if (mode === 'expire') { mode = 'normal'; return reply({ code: 'not_in_room' }, 403); }
        if (mode === 'kick') return reply({ events: [{ type: 'disconnect' }] });
        const events = body.messages.some(message => message.description?.type === 'offer')
          ? [{ type: 'signal', from: 'remote', description: { type: 'answer', sdp: 'test' } }] : [];
        reply({ events, pollId: body.pollId });
      });
    } }],
  });
  server.middlewares.use('/voice-test', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Voice recovery regression</title>');
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
        const ui = await import('/src/voice-ui.ts');
        const { VoiceSession } = await import('/src/voice-session.ts');
        let workers = 0;
        let forcedPolls = 0;
        window.Worker = class extends Worker {
          constructor(...args) { super(...args); workers++; }
          postMessage(message) { if (message.type === 'poll') forcedPolls++; super.postMessage(message); }
        };
        window.RTCPeerConnection = class {
          connectionState = 'new'; signalingState = 'stable'; restarts = 0; offers = []; transceivers = [];
          addTransceiver(kind) {
            const transceiver = { receiver: { track: { kind } }, sender: { track: null,
              async replaceTrack(track) { this.track = track; } } };
            this.transceivers.push(transceiver);
            return transceiver;
          }
          getTransceivers() { return this.transceivers; }
          restartIce() { this.restarts++; }
          async createOffer(options) { this.offers.push(options); return { type: 'offer', sdp: 'test' }; }
          async setLocalDescription(description) {
            this.localDescription = description;
            this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
          }
          async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = 'stable'; }
          close() { this.signalingState = this.connectionState = 'closed'; }
        };
        const wait = async (condition, message) => {
          const deadline = Date.now() + 8000;
          while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
          if (!condition()) throw Error(message);
        };
        const workspace = document.createElement('main');
        workspace.innerHTML = ui.voiceStageMarkup + ui.voiceDockMarkup + ui.voiceAccountControlsMarkup + '<span data-account-voice-status></span>';
        document.body.append(workspace);
        const preferences = { input: '', output: '', inputVolume: 100, outputVolume: 100, noiseSuppression: false };
        const call = ui.createVoiceCall();
        const session = new VoiceSession('channel-1', 'Player', preferences, { muted: true, deafened: true }, () => call.changed?.(), () => {});
        call.session = session;
        const mounted = ui.mountVoice(call, workspace, () => 'Player', preferences, () => {}, () => {}, []);
        const context = new AudioContext();
        const firstAudio = context.createMediaStreamDestination().stream.getAudioTracks()[0];
        const secondAudio = context.createMediaStreamDestination().stream.getAudioTracks()[0];
        const control = mode => fetch('/voice-test-control', { method: 'POST', body: mode });
        try {
          session.join();
          await wait(() => session.connectionNotice.includes('reconectando'), 'Temporary failure did not show recovery status');
          const before = session.peers.get('remote');
          await wait(() => !session.connectionNotice && before.connection.remoteDescription, 'Temporary failure did not recover');
          if (workers !== 1 || session.peers.get('remote') !== before) throw Error('Recovery replaced an active connection or skipped the worker');
          before.connection.ontrack({ track: firstAudio, transceiver: before.connection.getTransceivers()[0] });
          const oldAudio = call.audio.get('remote');
          await control('expire');
          document.dispatchEvent(new Event('visibilitychange'));
          await wait(() => session.self?.id === 'local-2', 'Expired room did not rejoin');
          const after = session.peers.get('remote');
          after.connection.ontrack({ track: secondAudio, transceiver: after.connection.getTransceivers()[0] });
          if (forcedPolls === 0 || before.connection.signalingState !== 'closed' || oldAudio.srcObject !== null
              || call.audio.get('remote').srcObject !== after.audio || !session.microphone.muted || !session.deafened) {
            throw Error('Rejoin did not preserve settings and replace the audio track');
          }
          await wait(() => after.connection.remoteDescription && after.connection.signalingState === 'stable', 'New peer did not negotiate');
          after.connection.connectionState = 'failed';
          after.connection.onconnectionstatechange();
          await wait(() => after.connection.offers.some(offer => offer?.iceRestart), 'ICE restart offer was not sent');
          if (after.connection.restarts !== 1) throw Error('ICE restart was repeated');
          await control('kick');
          window.dispatchEvent(new Event('online'));
          await wait(() => session.state === 'ended', 'Administrative disconnect did not end the session');
          if (session.canRetry || !workspace.querySelector('[data-voice-retry]').hidden) throw Error('Moderation exposed reconnect');
          return { recovered: true };
        } finally {
          mounted.dispose();
          firstAudio.stop(); secondAudio.stop();
          await context.close();
        }
      })()`,
    });
    assert.equal(evaluation.exceptionDetails, undefined, JSON.stringify(evaluation.exceptionDetails));
    assert.deepEqual(evaluation.result.value, { recovered: true });
    assert.equal(joins.length, 2);
    assert.equal(joins[1].muted, true);
    assert.equal(joins[1].deafened, true);
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
