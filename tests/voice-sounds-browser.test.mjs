import assert from 'node:assert/strict';
import { launchTestChrome } from './browser-chrome.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';

test('User settings, voice shortcuts, and room sounds work in Chrome', { timeout: 65000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'discordo-sounds-test-'));
  const server = await createServer({ server: { port: 0 }, logLevel: 'silent' });
  server.middlewares.use('/sounds-test', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Room sounds regression</title>');
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
    assert.ok(chrome.spawnargs.includes('--mute-audio'), 'Voice tests must mute the test browser output');
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
    await command('Page.navigate', { url: `${origin}sounds-test` });
    await new Promise(resolve => setTimeout(resolve, 500));
    const evaluation = await command('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
  const { openSettings } = await import('/src/settings.ts');
  const { readVoicePreferences } = await import('/src/voice-preferences.ts');
  const account = { name: 'Player', email: 'player@example.test', birthDate: '2000-01-01' };
  const requests = [];
  const originalFetch = window.fetch;
  window.fetch = async (url, options) => {
    if (String(url).endsWith('/account.php') && options?.method === 'POST') {
      const body = JSON.parse(options.body); requests.push(body);
      account[body.kind + 'Url'] = body.sound ? 'account.php?sound=fixture.mp3' : null;
      return Response.json({ account });
    }
    return originalFetch(url, options);
  };
  const gains = [];
  const started = [];
  let audioInterrupted = false;
  let audioNeedsGesture = false;
  document.addEventListener('touchend', () => { audioNeedsGesture = false; }, { capture: true });
  let blockedResumeAttempts = 0;
  window.AudioContext = class extends AudioContext {
    get state() { return audioInterrupted ? 'interrupted' : super.state; }
    async resume() {
      if (audioInterrupted) {
        blockedResumeAttempts++;
        if (audioNeedsGesture) throw new DOMException('Audio requires a gesture', 'NotAllowedError');
        await new Promise(resolve => setTimeout(resolve, 75));
        audioInterrupted = false;
      }
      return super.resume();
    }
    createGain() { const gain = super.createGain(); gains.push(gain); return gain; }
    createBufferSource() {
      const source = super.createBufferSource();
      const start = source.start.bind(source);
      source.start = () => { started.push(source); start(); };
      return source;
    }
  };
  let hear = true;
  openSettings(document.body, account, () => {}, async () => true, () => {}, () => {}, undefined, () => hear);
  const wait = async (condition, message) => {
    const deadline = Date.now() + 8000;
    while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (!condition()) throw Error(message);
  };
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const saveSettings = () => document.querySelector('.user-settings[open] [data-save-settings]');
  const chooseExit = choice => document.querySelector('.settings-confirm[open] [value="' + choice + '"]').click();
  const dialog = document.querySelector('dialog');
  check(!dialog.querySelector('#settings-profile').hidden, 'Settings did not open on My Profile');
  dialog.querySelector('[aria-controls="settings-shortcuts"]').click();
  const keyboard = (target, key, options = {}, type = 'keydown') => target.dispatchEvent(new KeyboardEvent(type, {
    key, bubbles: true, cancelable: true, ...options,
  }));
  for (const [action, key, label] of [['microphone', 'F8', 'F8'], ['audio', ' ', 'Espaço']]) {
    const button = dialog.querySelector('[data-bind="' + action + '"]');
    button.click();
    keyboard(button, key);
    check(button.textContent === label, 'Individual shortcut was not recorded');
  }
  const audioBinding = dialog.querySelector('[data-bind="audio"]');
  audioBinding.click();
  keyboard(audioBinding, 'F8');
  check(dialog.querySelector('[data-shortcut-status]').textContent.includes('em uso'), 'Duplicate shortcut was accepted');
  keyboard(audioBinding, 'Escape');
  check(audioBinding.textContent === 'Esc' && dialog.open, 'Escape could not be assigned as a shortcut');
  audioBinding.click();
  keyboard(audioBinding, 'Tab');
  check(audioBinding.textContent === 'Tab', 'Tab could not be assigned as a shortcut');
  audioBinding.click();
  keyboard(audioBinding, 'Shift', { shiftKey: true });
  keyboard(audioBinding, 'Shift', {}, 'keyup');
  check(audioBinding.textContent === 'Shift', 'A modifier key alone could not be assigned');
  audioBinding.click();
  keyboard(audioBinding, ' ');
  const { listenForVoiceShortcuts } = await import('/src/shortcuts.ts');
  const controls = { microphone: document.createElement('button'), audio: document.createElement('button') };
  const presses = [];
  for (const [action, button] of Object.entries(controls)) button.onclick = () => presses.push(action);
  const shortcutLifetime = new AbortController();
  let connected = true;
  listenForVoiceShortcuts(account.email, controls, () => connected, shortcutLifetime.signal);
  keyboard(dialog, 'F8');
  check(presses.length === 0, 'Shortcut fired in settings');
  check(!localStorage.getItem('discordo:shortcuts:' + account.email), 'Shortcut was persisted before saving');
  dialog.querySelector('[data-close]').click();
  chooseExit('save');
  await wait(() => !dialog.isConnected, 'Settings did not close');
  const editor = document.body.appendChild(document.createElement('textarea'));
  keyboard(editor, 'F8');
  editor.remove();
  connected = false;
  keyboard(document.body, 'F8');
  connected = true;
  keyboard(document.body, 'F8');
  keyboard(document.body, 'F8', { repeat: true });
  keyboard(document.body, ' ');
  controls.microphone.disabled = true;
  keyboard(document.body, 'F8');
  controls.microphone.disabled = false;
  localStorage.setItem('discordo:shortcuts:' + account.email, JSON.stringify({ microphone: 'Ctrl+Alt+M', audio: 'Shift' }));
  keyboard(document.body, 'm', { ctrlKey: true, altKey: true });
  keyboard(document.body, 'Shift', { shiftKey: true });
  keyboard(document.body, 'A', { shiftKey: true });
  keyboard(document.body, 'Shift', {}, 'keyup');
  check(presses.join(',') === 'microphone,audio,microphone', 'An existing combo failed or Shift triggered during a chord');
  keyboard(document.body, 'Shift', { shiftKey: true });
  keyboard(document.body, 'Shift', {}, 'keyup');
  shortcutLifetime.abort();
  keyboard(document.body, 'm', { ctrlKey: true, altKey: true });
  check(presses.join(',') === 'microphone,audio,microphone,audio', 'Shortcuts bypassed call, focus, repeat or disabled controls');
  openSettings(document.body, account, () => {}, async () => true, () => {}, () => {}, undefined, () => hear);
  const settings = document.querySelector('dialog');
  const backdrop = () => settings.dispatchEvent(new MouseEvent('click', { clientX: -1, clientY: -1 }));
  settings.dispatchEvent(new PointerEvent('pointerdown', { clientX: settings.offsetLeft + 2, clientY: settings.offsetTop + 2 }));
  backdrop();
  check(settings.open, 'Drag from inside closed settings');
  settings.dispatchEvent(new PointerEvent('pointerdown', { clientX: -1, clientY: -1 }));
  backdrop();
  check(!settings.open, 'Click on the backdrop did not close settings');
  await wait(() => !settings.isConnected, 'Dismissed settings were not removed');
  openSettings(document.body, account, () => {}, async () => true, () => {}, () => {}, 'voice', () => hear);
  check(document.querySelector('#room-sound-volume').value === '60', 'Wrong default volume');
  check(!document.querySelector('#room-lobby-sounds').checked, 'Lobby sounds must be opt-in');
  document.querySelector('#room-sound-volume').value = '35';
  document.querySelector('#voice-output-volume').value = '80';
  document.querySelector('[data-test-room-sound]').click();
  await wait(() => started.length === 1, 'Default sound did not play');
  check(Math.abs(gains.at(-1).gain.value - .28) < .001, 'Sound mixer ignored the room or output volume');
  hear = false;
  document.querySelector('[data-test-room-sound]').click();
  check(started.length === 1, 'Test sound played with headphones disabled');
  hear = true;
  document.querySelector('.voice-settings-form').requestSubmit();
  await wait(() => document.querySelector('[data-save-status]').textContent === 'Alterações salvas.', 'Voice settings did not finish saving');
  const preferences = readVoicePreferences(account.email);
  check(preferences.roomSoundVolume === 35 && preferences.outputVolume === 80, 'Sound settings were not saved');
  document.querySelector('[aria-controls="settings-profile"]').click();
  const entry = document.querySelector('[data-profile-sound="entrySound"]');
  const exit = document.querySelector('[data-profile-sound="exitSound"]');
  const wav = (seconds) => {
    const length = Math.round(24000 * seconds);
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);
    const tag = (offset, name) => Array.from(name).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
    tag(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true); view.setUint32(28, 48000, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    tag(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.round(31000 * Math.sin(i * .13)), true);
    return new File([buffer], 'tone.wav', { type: 'audio/wav' });
  };
  const upload = (seconds, section = entry) => {
    const input = section.querySelector('input');
    const transfer = new DataTransfer(); transfer.items.add(wav(seconds));
    input.files = transfer.files; input.dispatchEvent(new Event('change'));
  };
  const button = (section, action) => section.querySelector('[data-sound-action="' + action + '"]');
  upload(2.1);
  await wait(() => entry.querySelector('p').dataset.state === 'error', 'Long audio was accepted');
  upload(2);
  await wait(() => !saveSettings().disabled, 'Valid audio did not prepare');
  button(entry, 'preview').click();
  await wait(() => started.length === 2, 'Personal sound preview did not play');
  const decoded = started.at(-1).buffer;
  const peak = Math.max(...decoded.getChannelData(0).map(Math.abs));
  check(decoded.duration <= 2 && peak <= .451, 'Personal audio exceeded duration or peak');
  await wait(() => !saveSettings().disabled, 'Preview did not finish loading');
  saveSettings().click();
  await wait(() => entry.querySelector('p').textContent === 'Som salvo.', 'Entry sound was not saved');
  check(requests[0].kind === 'entrySound' && requests[0].sound.startsWith('data:audio/mpeg;base64,'), 'Wrong entry upload');
  const streams = [];
  const getMicrophone = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    const stream = await getMicrophone(constraints); streams.push(stream); return stream;
  };
  button(exit, 'record').click();
  await wait(() => exit.querySelector('p').textContent.startsWith('Gravando'), 'Recording did not start');
  await wait(() => !saveSettings().disabled, 'Recording did not finish');
  check(streams.length === 1 && streams[0].getTracks().every(track => track.readyState === 'ended'), 'Recording left the microphone open');
  saveSettings().click();
  await wait(() => exit.querySelector('p').textContent === 'Som salvo.', 'Exit sound was not saved');
  button(entry, 'remove').click();
  check(requests.length === 2, 'Sound was removed before saving');
  saveSettings().click();
  await wait(() => entry.querySelector('p').textContent === 'Som removido.', 'Entry sound was not removed');
  check(requests[1].kind === 'exitSound' && requests[2].sound === null, 'Wrong recording or removal request');
  for (const kind of ['moveExitSound', 'moveEntrySound', 'punishedSound', 'disconnectSound', 'absenceSound']) {
    const section = document.querySelector('[data-profile-sound="' + kind + '"]');
    upload(.1, section);
    await wait(() => !saveSettings().disabled, 'Transfer sound was not prepared');
    saveSettings().click();
    await wait(() => section.querySelector('p').textContent === 'Som salvo.', 'Transfer sound was not saved');
    check(requests.at(-1).kind === kind, 'Transfer sound overwrote another profile sound');
  }
  document.querySelector('dialog').close();
  const { VoiceSession } = await import('/src/voice-session.ts');
  const { createVoiceCall, mountVoice, voiceStageMarkup, voiceDockMarkup, voiceAccountControlsMarkup } = await import('/src/voice-ui.ts');
  const workspace = document.createElement('main');
  workspace.innerHTML = voiceStageMarkup + voiceDockMarkup + voiceAccountControlsMarkup + '<span data-account-voice-status></span>';
  document.body.append(workspace);
  const call = createVoiceCall();
  call.roomName = 'Lan house';
  const voice = mountVoice(call, workspace, () => 'Player', preferences, () => {}, () => {}, []);
  const member = { id: 'peer', name: 'Peer', muted: false, sharing: false, exitSoundUrl: 'account.php?sound=fixture.mp3' };
  call.activity({ type: 'entrou', member });
  call.activity({ type: 'entrou', member });
  await wait(() => started.length === 3, 'A room entry did not play');
  await new Promise(resolve => setTimeout(resolve, 100));
  check(started.length === 3, 'Concurrent entries played more than one sound');
  check(workspace.querySelector('.voice-activity-toast').textContent === 'Peer entrou na Lan house', 'Entry toast was missing');
  const events = [];
  const session = new VoiceSession('channel-1', 'Player', preferences, { muted: false, deafened: true }, () => {}, () => {}, event => events.push(event));
  const welcome = { type: 'welcome', self: { id: 'self', name: 'Player', muted: true, sharing: false }, members: [], iceServers: [] };
  session.receive(welcome);
  session.receive(welcome);
  session.receive({ type: 'joined', member });
  session.receive({ type: 'joined', member });
  session.receive({ type: 'state', member: { ...member, sharing: true } });
  session.receive({ type: 'state', member: { ...member, sharing: true } });
  session.receive({ type: 'left', id: member.id });
  check(events.map(event => event.type).join(',') === 'voce-entrou,entrou,transmitiu,saiu', 'Voice events played twice or were missed');
  check(events.at(-1).member.exitSoundUrl === member.exitSoundUrl, 'Exit sound URL was lost with the peer');
  call.session = session;
  await new Promise(resolve => setTimeout(resolve, 310));
  call.activity({ type: 'entrou', member });
  await new Promise(resolve => setTimeout(resolve, 50));
  check(started.length === 3, 'Room sound played while deafened');
  voice.dispose();
  const { DISCONNECT_VOICE, PUNISH_VOICE } = await import('/src/servers.ts');
  const ownWorkspace = document.body.appendChild(document.createElement('main'));
  ownWorkspace.innerHTML = workspace.innerHTML;
  ownWorkspace.querySelector('.voice-activity-toast')?.remove();
  ownWorkspace.insertAdjacentHTML('beforeend', '<ul data-voice-members="channel-1"></ul>');
  const ownCall = createVoiceCall();
  const sourceChannel = { id: 'channel-1', name: 'Origem' };
  const destinationChannel = { id: 'channel-2', name: 'Destino' };
  const currentMoveSounds = { moveExitSoundUrl: 'account.php?sound=move-exit', moveEntrySoundUrl: 'account.php?sound=move-entry',
    punishedSoundUrl: 'account.php?sound=punished', disconnectSoundUrl: 'account.php?sound=disconnected' };
  const ownSession = new VoiceSession('channel-1', 'Player', preferences, { muted: false, deafened: false },
    () => ownCall.changed?.(), () => {}, event => ownCall.activity?.(event));
  ownCall.session = ownSession;
  ownSession.receive({ ...welcome, self: { ...welcome.self, userId: 1 } });
  const ownVoice = mountVoice(ownCall, ownWorkspace, () => 'Player', preferences, () => {}, () => {},
    [sourceChannel, destinationChannel], 1, true, 'Servidor', { email: account.email, permissions: DISCONNECT_VOICE | PUNISH_VOICE,
      appearance() {}, profile() {} });
  ownWorkspace.querySelector('[data-voice-members] li').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  check(!ownWorkspace.querySelector('[data-punish]'), 'The self menu offered self-punishment');
  ownCall.lastRoomSound = performance.now();
  ownWorkspace.querySelector('[data-disconnect]').click();
  await wait(() => started.length === 4, 'Disconnecting through the self menu did not play the local exit sound');
  check(ownSession.state === 'ended', 'Disconnecting through the self menu did not end the call');
  check(!document.querySelector('.voice-moderation-alert'), 'Voluntary exit displayed a moderation sign');

  const previousFetch = window.fetch;
  let moveRequest;
  window.fetch = (url, options) => {
    const request = new URL(url, location.href);
    if (request.pathname.endsWith('/voice.php')) {
      if (options?.method === 'POST') {
        moveRequest = JSON.parse(options.body);
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.resolve(Response.json({ rooms: {} }));
    }
    const sound = request.searchParams.get('sound');
    if (sound === 'move-exit') return Promise.resolve(new Response(wav(.15)));
    if (sound === 'move-entry') return Promise.resolve(new Response(wav(.10)));
    if (sound === 'punished') return Promise.resolve(new Response(wav(.22)));
    if (sound === 'disconnected') return Promise.resolve(new Response(wav(.25)));
    return previousFetch(url, options);
  };
  const originSession = new VoiceSession(sourceChannel.id, 'Player', preferences, { muted: false, deafened: false },
    () => ownCall.changed?.(), (id, name) => ownCall.moved?.(id, name), event => ownCall.activity?.(event));
  const originalJoin = VoiceSession.prototype.join;
  VoiceSession.prototype.join = function () {
    this.receive({ ...welcome, self: { ...welcome.self, id: this.room + '-member', userId: 1 } });
  };
  ownCall.session = originSession;
  // Remount with the source session, as happens when a user navigates while connected.
  ownVoice.dispose(true);
  ownCall.session = originSession;
  originSession.receive({ ...welcome, self: { ...welcome.self, userId: 1 } });
  const transferVoice = mountVoice(ownCall, ownWorkspace, () => 'Player', preferences, () => {}, () => {},
    [sourceChannel, destinationChannel], 1, true, 'Servidor', { email: account.email,
      permissions: DISCONNECT_VOICE | PUNISH_VOICE, appearance() {}, profile() {} });
  try {
    ownWorkspace.querySelector('[data-voice-members] li').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const moveForm = ownWorkspace.querySelector('.voice-member-menu:popover-open form');
    moveForm.querySelector('select').value = destinationChannel.id;
    moveForm.requestSubmit();
    await wait(() => moveRequest?.type === 'move', 'Moving yourself skipped the server transfer');
    check(moveRequest.room === sourceChannel.id && moveRequest.destination === destinationChannel.id && moveRequest.id === 'self',
      'Self transfer sent the wrong room or participant');
    originSession.receive({ type: 'move', room: destinationChannel.id, name: destinationChannel.name });
  } finally {
    VoiceSession.prototype.join = originalJoin;
  }
  const arrival = ownCall.session;
  check(arrival.room === destinationChannel.id && originSession.state === 'ended', 'Transfer did not connect to the destination');
  ownCall.activity({ type: 'entrou', member: { ...member, ...currentMoveSounds, userId: 1 }, transferred: true });
  await new Promise(resolve => setTimeout(resolve, 250));
  check(started.length === 4, 'The moved user heard their own transfer sound');
  ownCall.activity({ type: 'saiu', member: { ...member, ...currentMoveSounds }, transferred: true });
  await wait(() => started.length === 5, 'Another user did not hear the transfer departure');
  check(Math.abs(started[4].buffer.duration - .15) < .01, 'The source room played the wrong sound');
  ownCall.activity({ type: 'entrou', member: { ...member, ...currentMoveSounds }, transferred: true });
  await wait(() => started.length === 6, 'Another user did not hear the transfer arrival');
  check(Math.abs(started[5].buffer.duration - .10) < .01, 'The destination room played the wrong sound');
  const moderatedPeer = { ...member, userId: 2 };
  arrival.receive({ type: 'welcome', self: arrival.self, members: [moderatedPeer, { ...moderatedPeer, id: 'other-peer' }], iceServers: [] });
  audioInterrupted = true;
  arrival.receive({ type: 'left', id: moderatedPeer.id, moderation: 'punished', sound: currentMoveSounds.punishedSoundUrl });
  await wait(() => started.length === 7, 'The observer did not hear the punishment');
  check(blockedResumeAttempts > 0 && Math.abs(started.at(-1).buffer.duration - .22) < .01, 'The punishment did not resume audio and use the peer clip');
  audioInterrupted = audioNeedsGesture = true;
  arrival.receive({ type: 'left', id: 'other-peer', moderation: 'disconnect', sound: currentMoveSounds.disconnectSoundUrl });
  const resumeVoice = ownWorkspace.querySelector('[data-voice-play]');
  await wait(() => !resumeVoice.hidden, 'The disconnected sound was dropped when mobile playback was blocked');
  check(started.length === 7, 'Sound played while browser playback was blocked');
  audioNeedsGesture = false;
  resumeVoice.click();
  await wait(() => started.length === 8 && resumeVoice.hidden, 'The observer did not hear the disconnect after enabling audio');
  check(Math.abs(started.at(-1).buffer.duration - .25) < .01, 'The disconnect did not use the peer clip');
  arrival.receive({ type: 'left', id: 'unknown-peer', moderation: 'disconnect', sound: currentMoveSounds.disconnectSoundUrl });
  arrival.receive({ type: 'punished', seconds: 4 });
  const alert = () => document.querySelector('.voice-moderation-alert:popover-open');
  const timeLeft = () => ownWorkspace.querySelector('[data-punishment-time]').textContent;
  const alertCountdown = () => alert()?.querySelector('.voice-moderation-countdown')?.textContent;
  check(arrival.state === 'ended' && timeLeft() === '4 s.' && alertCountdown()?.includes('4 s'),
    'The punishment did not start the same countdown on the sign and in the voice panel');
  check(alert()?.querySelector('img').alt === 'Recua Fascista' && alert().querySelector('img').src.endsWith('/art/voice-recua-fascista.webp'),
    'Punishment did not open the right sign');
  await wait(() => alert()?.querySelector('img').naturalWidth > 0 && !alert()?.querySelector('img').hidden, 'Punishment art did not load');
  await wait(() => timeLeft() === '3 s.' && alertCountdown()?.includes('3 s'), 'The sign and the voice countdown did not tick');
  await wait(() => !alert(), 'The punishment sign did not dismiss before the countdown finished');
  check(timeLeft() !== '', 'Dismissing the sign ended the punishment countdown');
  await wait(() => ownWorkspace.querySelector('[data-punishment-status]').textContent.includes('já pode entrar'),
    'The countdown did not tell the participant they could rejoin');
  check(timeLeft() === '', 'Expired punishment showed a time remaining');
  const blocked = new VoiceSession('channel-2', 'Player', preferences, { muted: false, deafened: false },
    () => {}, () => {}, event => ownCall.activity?.(event));
  blocked.receive({ type: 'punished', seconds: 8 });
  check(!alert() && timeLeft() === '8 s.', 'Attempting to rejoin did not update the countdown quietly');
  const quiet = new VoiceSession('channel-2', 'Player', preferences, { muted: false, deafened: true },
    () => {}, () => {}, event => ownCall.activity?.(event));
  quiet.receive(welcome);
  const disconnectedAt = performance.now();
  quiet.receive({ type: 'disconnect' });
  check(alert()?.querySelector('img').alt === 'Se Fudeu!' && alert().querySelector('img').src.endsWith('/art/voice-se-fudeu.webp'),
    'Administrative disconnect did not open the right sign');
  await wait(() => alert()?.querySelector('img').naturalWidth > 0 && !alert()?.querySelector('img').hidden, 'Disconnect art did not load');
  await wait(() => !alert(), 'The moderation sign did not dismiss');
  check(performance.now() - disconnectedAt >= 2900 && performance.now() - disconnectedAt < 3500, 'The moderation sign did not stay for three seconds');
  const selfDisconnect = new VoiceSession('channel-2', 'Player', preferences, { muted: false, deafened: false },
    () => {}, () => {}, event => { if (event.type === 'disconnect') ownCall.activity?.(event); });
  selfDisconnect.receive(welcome);
  selfDisconnect.receive({ type: 'disconnect' });
  await new Promise(resolve => setTimeout(resolve, 200));
  check(started.length === 8, 'Moderation audio played for the target or an unknown peer');
  transferVoice.dispose();

  const muteWorkspace = document.body.appendChild(document.createElement('main'));
  muteWorkspace.innerHTML = voiceStageMarkup + voiceDockMarkup + voiceAccountControlsMarkup
    + '<span data-account-voice-status></span><ul data-voice-members="channel-1"></ul>';
  const muteCall = createVoiceCall();
  const mutePreferences = { ...preferences, noiseSuppression: false };
  const muteSession = new VoiceSession('channel-1', 'Player', mutePreferences, { muted: false, deafened: false },
    () => muteCall.changed?.(), () => {}, event => muteCall.activity?.(event));
  muteCall.session = muteSession;
  muteSession.receive({ ...welcome, self: { ...welcome.self, userId: 1 } });
  await muteSession.microphone.start();
  check(muteSession.microphone.available, 'Test microphone did not start');
  const muteVoice = mountVoice(muteCall, muteWorkspace, () => 'Player', mutePreferences, () => {}, () => {},
    [], 1, false, 'Servidor', { email: account.email, permissions: 0, appearance() {}, profile() {} });
  keyboard(document.body, 'm', { ctrlKey: true, altKey: true });
  await wait(() => started.length === 9, 'Muting by shortcut did not play a confirmation');
  check(muteSession.microphone.muted, 'Shortcut did not mute the microphone');
  const micCue = started.at(-1).buffer;
  muteWorkspace.querySelector('[data-dock-mic]').click();
  check(!muteSession.microphone.muted, 'Microphone did not unmute');
  await wait(() => started.length === 10, 'Reactivating the microphone did not play a confirmation');
  check(started.at(-1).buffer.getChannelData(0)[200] !== micCue.getChannelData(0)[200], 'Microphone on and off used the same tone');
  muteWorkspace.querySelector('[data-voice-members] li').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  muteWorkspace.querySelector('[data-self-deafen]').click();
  muteCall.changed();
  await wait(() => started.length === 11, 'Disabling voice audio from the menu did not play a confirmation');
  check(muteSession.deafened && muteSession.microphone.silent, 'Disabling audio did not silence voice and microphone');
  const audioCue = started.at(-1).buffer;
  check(micCue.duration === audioCue.duration && micCue.getChannelData(0)[200] !== audioCue.getChannelData(0)[200],
    'The two mute cues were not similar but distinct');
  const globalAudio = () => document.dispatchEvent(new Event('discordo:global-shortcut:audio', { cancelable: true }));
  check(!globalAudio(), 'The active call did not handle the global shortcut');
  await wait(() => started.length === 12, 'Reactivating voice audio by global shortcut did not play a confirmation');
  check(!muteSession.deafened && started.at(-1).buffer.getChannelData(0)[200] !== audioCue.getChannelData(0)[200],
    'The global shortcut failed to restore voice audio or used the same tone as disabling it');
  muteVoice.configure({ ...mutePreferences, roomSounds: false });
  muteWorkspace.querySelector('[data-dock-mic]').click();
  await new Promise(resolve => setTimeout(resolve, 100));
  check(started.length === 12 && muteSession.microphone.muted, 'The confirmation ignored the room sounds setting');
  muteVoice.dispose();
  check(globalAudio(), 'An inactive call handled the global shortcut');
  const { mountTextChat, textComposerMarkup } = await import('/src/text-chat.ts');
  const history = [];
  const posted = [];
  window.fetch = async (url, options) => {
    const request = new URL(url, location.href);
    if (!request.pathname.endsWith('/chat.php')) return originalFetch(url, options);
    if (options?.method === 'POST') {
      const form = options.body instanceof FormData ? options.body : null;
      if (form?.get('text')?.startsWith('https://')) return new Response('Not Acceptable', { status: 406 });
      const file = form?.get('media');
      if (file) posted.push(file.name);
      const message = JSON.parse(form ? form.get('message') : options.body);
      if (!form) check(options.headers['Content-Type'] === 'application/json' && message.action === 'sendMessage',
        'Standalone messages must use the JSON API');
      history.push({ id: history.length + 1, media: file ? (file.type.startsWith('image/') ? 'image' : 'video') : null,
        text: message.text, time: new Date().toISOString(), author: 'Player', userId: 1 });
      return Response.json({ ok: true }, { status: 201 });
    }
    return Response.json({ messages: history.filter(item => item.id > Number(request.searchParams.get('after'))) });
  };
  const chat = () => {
    const element = document.body.appendChild(document.createElement('main'));
    element.innerHTML = '<div class="chat-scroll"><div class="messages"></div></div>' + textComposerMarkup + '<p class="chat-note"></p>';
    const mounted = mountTextChat(element, () => undefined);
    mounted.select(12, 'geral');
    return { element, mounted };
  };
  const sender = chat();
  const recipient = chat();
  const picker = sender.element.querySelector('input[type="file"]');
  check(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4'].every(extension => picker.accept.split(',').includes(extension)), 'Attachment picker hides supported formats');
  for (const [index, [filename, type]] of [['foto.png', 'image/png'], ['animado.gif', 'image/gif'], ['video.mp4', 'video/mp4']].entries()) {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['fixture'], filename, { type }));
    picker.files = transfer.files;
    picker.dispatchEvent(new Event('change'));
    sender.element.querySelector('form').requestSubmit();
    await wait(() => sender.element.querySelectorAll('.message').length === index + 1, 'Sender did not receive attachment');
  }
  await wait(() => recipient.element.querySelectorAll('.message').length === 3, 'Other member did not receive attachments');
  check(posted.join(',') === 'foto.png,animado.gif,video.mp4', 'Unexpected uploaded attachments');
  const mediaUrls = [...recipient.element.querySelectorAll('.message .chat-image')].map(img => new URL(img.src).searchParams.get('media'));
  check(mediaUrls.join(',') === '1,2', 'Photos and GIFs did not render as images');
  check(new URL(recipient.element.querySelector('.message video').src).searchParams.get('video') === '3', 'Video playback regressed');
  const viewer = () => recipient.element.querySelector('.chat-media-viewer[open]');
  await import('/src/style.css');
  {
    const photo = recipient.element.querySelector('.chat-image');
    const photoButton = photo.closest('button');
    const photoMessage = photo.closest('.message');
    photoMessage.querySelector('p').textContent = 'Uma mensagem que ocupa mais espaço na linha do que a miniatura da imagem.';
    photo.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48"><rect width="80" height="48" fill="purple"/></svg>');
    photo.loading = 'eager';
    await photo.decode();
    photo.scrollIntoView({ block: 'center' });
    const photoBounds = photo.getBoundingClientRect();
    const buttonBounds = photoButton.getBoundingClientRect();
    const rowBounds = photoMessage.getBoundingClientRect();
    const x = photoBounds.right + 20;
    const y = photoBounds.top + photoBounds.height / 2;
    const outside = document.elementFromPoint(x, y);
    check(x < rowBounds.right && outside && !photoButton.contains(outside),
      'The blank space beside an image still belongs to its zoom button');
    outside.click();
    check(!viewer(), 'Clicking the blank space opened the image viewer');
    check(Math.abs(buttonBounds.width - photoBounds.width) < 1 && Math.abs(buttonBounds.height - photoBounds.height) < 1
      && Math.abs(buttonBounds.top - photoBounds.top) < 1, 'The zoom button does not match the image bounds');
    document.elementFromPoint(photoBounds.left + photoBounds.width / 2, y).click();
    check(viewer()?.querySelector('img')?.src === photo.src, 'Clicking the photo did not open it');
    viewer().querySelector('.chat-media-close').click();
  }
  recipient.element.querySelectorAll('.chat-image-open')[1].click();
  check(new URL(viewer()?.querySelector('img').src).searchParams.get('media') === '2', 'Clicking the GIF did not open the right image');
  viewer().querySelector('.chat-media-close').click();
  check(!viewer(), 'The close button did not dismiss the image viewer');
  recipient.element.querySelector('.chat-video-open').click();
  const expandedVideo = viewer()?.querySelector('video');
  check(expandedVideo?.controls && new URL(expandedVideo.src).searchParams.get('video') === '3', 'The expanded video did not preserve playback controls');
  recipient.mounted.select(13, 'outro');
  check(!viewer() && !expandedVideo.hasAttribute('src'), 'Changing channels left expanded media playing');
  recipient.mounted.select(12, 'geral');
  const urlText = 'Olha (https://example.test/a_(b)?x=1&y=2), www.example.test. javascript:alert(1) <b>texto</b>';
  sender.element.querySelector('[name=message]').value = urlText;
  sender.element.querySelector('form').requestSubmit();
  await wait(() => recipient.element.querySelector('[data-message="4"] p'), 'The other member did not receive the link message');
  const linkMessage = recipient.element.querySelector('[data-message="4"] p');
  const links = [...linkMessage.querySelectorAll('a')];
  check(linkMessage.textContent === urlText && links.length === 2 && !linkMessage.querySelector('b')
    && links[0].href === 'https://example.test/a_(b)?x=1&y=2' && links[1].href === 'https://www.example.test/'
    && links.every(link => link.rel === 'noopener noreferrer' && link.target === '_blank'), 'Chat rendered links incorrectly');
  const youtube = 'https://www.youtube.com/watch?v=d6mELw0-LPE';
  const send = async (text, id) => {
    sender.element.querySelector('[name=message]').value = text;
    sender.element.querySelector('form').requestSubmit();
    await wait(() => recipient.element.querySelector('[data-message="' + id + '"] p a'), 'The YouTube link never reached the recipient');
    const message = recipient.element.querySelector('[data-message="' + id + '"]');
    check(message.querySelector('p').textContent === youtube && message.querySelector('a').href === youtube,
      'The YouTube URL was not preserved as a clickable link');
    return message;
  };
  await send(youtube, 5);
  await send('[' + youtube + '](' + youtube + ')', 6);
  const caption = new DataTransfer();
  caption.items.add(new File(['fixture'], 'legenda.gif', { type: 'image/gif' }));
  picker.files = caption.files;
  picker.dispatchEvent(new Event('change'));
  const captionMessage = await send(youtube, 7);
  check(captionMessage.querySelector('.chat-image') !== null, 'Sending the caption dropped the image');
  sender.mounted.dispose();
  recipient.mounted.dispose();
  {
    const pendingSends = new Map();
    window.fetch = async (url, options) => {
      const request = new URL(url, location.href);
      if (!request.pathname.endsWith('/chat.php')) return originalFetch(url, options);
      if (options?.method !== 'POST') return Response.json({ messages: [] });
      return new Promise(resolve => pendingSends.set(request.searchParams.get('channel'), resolve));
    };
    const { element, mounted } = chat();
    const composer = element.querySelector('form');
    const message = composer.elements.message;
    message.value = 'Primeiro canal';
    message.focus();
    composer.requestSubmit();
    check(message.readOnly && pendingSends.has('12') && document.activeElement === message, 'Sending stole focus from the composer');
    mounted.select(13, 'outro');
    check(!message.readOnly, 'A pending message blocked the new channel');
    message.value = 'Segundo canal';
    composer.requestSubmit();
    check(message.readOnly && pendingSends.has('13'), 'The new channel could not send independently');
    pendingSends.get('12')(Response.json({ ok: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
    check(message.readOnly && message.value === 'Segundo canal', 'The old send changed the new composer');
    pendingSends.get('13')(Response.json({ ok: true }));
    await wait(() => !message.readOnly && !message.value, 'The new composer did not finish');
    check(document.activeElement === message, 'The composer lost focus after sending');
    message.value = 'Terceira mensagem';
    composer.requestSubmit();
    const outside = element.appendChild(document.createElement('button'));
    outside.focus();
    pendingSends.get('13')(Response.json({ ok: true }));
    await wait(() => !message.readOnly && !message.value, 'The last send did not finish');
    check(document.activeElement === outside, 'The composer stole focus from a control selected while sending');
    mounted.dispose();
    element.remove();
  }
  const { openVoiceMemberMenu } = await import('/src/voice-member-menu.ts');
  const { MUTE_VOICE, DEAFEN_VOICE, openServerDialog } = await import('/src/servers.ts');
  const chosen = [];
  const memberOptions = {
    member, x: 8, y: 8, profile() {}, setAudio() {}, destinations: [], async move() {},
    permissions: MUTE_VOICE | DEAFEN_VOICE | DISCONNECT_VOICE, async moderate() {}, async punish(seconds) { chosen.push(seconds); },
  };
  openVoiceMemberMenu(document.body, memberOptions);
  check(!document.querySelector('.voice-member-menu:popover-open [data-punish]'), 'Punishment was shown without the permission');
  const moderation = document.querySelector('.voice-menu-moderation');
  const textLeft = item => {
    const range = document.createRange();
    range.selectNode(item.firstChild);
    return range.getBoundingClientRect().left;
  };
  const disconnectLeft = textLeft(moderation.querySelector('[data-disconnect]'));
  for (const label of moderation.querySelectorAll('label')) {
    check(Math.abs(textLeft(label) - disconnectLeft) < 1, 'Disconnect text is misaligned with the moderation toggles');
  }
  openVoiceMemberMenu(document.body, { ...memberOptions, permissions: PUNISH_VOICE });
  const punishmentMenu = document.querySelector('.voice-member-menu:popover-open');
  punishmentMenu.querySelector('[data-punish]').click();
  const choices = [...punishmentMenu.querySelectorAll('[data-duration]')];
  check(choices.map(choice => choice.textContent).join(',') === '10 segundos,30 segundos,1 minuto', 'Unexpected punishment choices');
  choices[1].click();
  await wait(() => !punishmentMenu.matches(':popover-open'), 'Punishment menu did not close after success');
  check(chosen.join(',') === '30', 'Selected punishment duration was lost');
  openServerDialog(document.body, 'settings', async () => {}, {
    id: 1, name: 'Servidor', admin: true, permissions: 255, members: [], channels: [], roles: [],
  }, 'roles');
  document.querySelector('[data-new-role]').click();
  check(document.querySelector('input[name=permissions][value="128"]').parentElement.textContent.includes('Castigar'),
    'Role creation did not offer the punishment permission');
  document.querySelector('.server-dialog [name=name]').value = 'Cargo não salvo';
  document.querySelector('.server-dialog [data-role-back]').click();
  check(document.querySelector('.settings-confirm[open]'), 'Server settings did not protect an edited role');
  chooseExit('discard');
  await wait(() => document.querySelector('.server-dialog [data-new-role]'), 'Discard did not return to role list');
  document.querySelector('.server-dialog [data-close]').click();
  const capacityServer = {
    id: 1, name: 'Servidor', admin: true, permissions: 255, members: [], roles: [],
    channels: [{ id: 5, name: 'Voz', type: 'VOZ', private: false, userLimit: 12 }],
  };
  const serverRequests = [];
  window.fetch = async (_url, options) => {
    if (options?.method === 'POST') {
      serverRequests.push(JSON.parse(options.body));
      return Response.json({ id: 1 });
    }
    return Response.json(capacityServer);
  };
  openServerDialog(document.body, 'edit-channel', async () => {}, capacityServer, 'channels', 5);
  const capForm = document.querySelector('.server-dialog[open] form');
  const capEnabled = capForm.elements.namedItem('limitEnabled');
  const capCount = capForm.elements.namedItem('userLimit');
  check(capEnabled.checked && !capCount.disabled && capCount.value === '12', 'Channel editing did not show the saved limit');
  capEnabled.click();
  check(capCount.disabled, 'Disabling the limit did not hide the number input');
  capForm.requestSubmit();
  await wait(() => !capForm.isConnected, 'Channel editor did not save the change');
  check(serverRequests[0].userLimit === null, 'Disabling the limit did not submit unlimited capacity');
  openServerDialog(document.body, 'manage', async () => {}, capacityServer, 'channels');
  const createChannel = document.querySelector('.server-dialog[open] form');
  const channelType = createChannel.elements.namedItem('type');
  check(createChannel.querySelector('[data-voice-limit]').hidden, 'Text channels showed a voice limit');
  channelType.value = 'VOZ';
  channelType.dispatchEvent(new Event('change'));
  check(!createChannel.querySelector('[data-voice-limit]').hidden, 'Voice channel creation did not offer a limit');
  createChannel.elements.namedItem('limitEnabled').click();
  createChannel.elements.namedItem('name').value = 'Sala nova';
  createChannel.elements.namedItem('userLimit').value = '9';
  createChannel.requestSubmit();
  await wait(() => serverRequests.length === 2 && !createChannel.isConnected, 'Voice channel limit was not saved');
  check(serverRequests[1].userLimit === 9, 'Voice channel creation did not submit the chosen capacity');
  document.querySelector('.server-dialog[open] [data-close]').click();
  document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }));
  const peerAppearance = { bio: 'Fã de jogos e grafite', theme: 'ciano', frame: 'gelo', effect: 'grafite' };
  let hierarchy = [{ id: 11, name: 'Veterano', permissions: 0, position: 0 },
    { id: 12, name: 'Organizador', permissions: 0, position: 1 }];
  const roster = [
    { id: 1, userId: 1, name: account.name, self: true, title: 'Criador', roles: [] },
    { id: 2, userId: 2, name: 'Outra pessoa', self: false, roles: hierarchy, appearance: peerAppearance },
    { id: 3, userId: 3, name: 'Pessoa sem cargo', self: false, title: null, roles: [] },
    { id: 4, userId: 4, name: 'Administrador', self: false, title: 'ADM', roles: [] },
    { id: 5, userId: 5, name: 'Pessoa veterana', self: false, title: null, roles: [hierarchy[0]] },
  ];
  let refreshCount = 0;
  let gameplayPoll;
  let gameplayChannel;
  window.fetch = async (url, options) => {
    const request = new URL(url, location.href);
    if (request.pathname.endsWith('/chat.php')) {
      const channel = Number(request.searchParams.get('channel'));
      if (options?.method === 'POST') {
        const data = JSON.parse(options.body);
        if (data.action === 'approveGameplay') {
          check(data.id === 10 && data.member === 5 && channel === gameplayChannel, 'The approval targeted the wrong participant');
          gameplayPoll.participants.find(person => person.member === data.member).status = 'CONFIRMADO';
          gameplayPoll.confirmed.push('Pessoa veterana');
          gameplayPoll.interested--;
          return Response.json({ id: 10 });
        }
        check(data.action === 'createGameplay' && data.game === 'VALORANT' && data.members.join(',') === '2' && channel === 13,
          'Gameplay did not submit the selected channel and guest');
        check(data.comment === '<duo> & ranked', 'Gameplay did not submit the comment');
        check(data.timezone === Intl.DateTimeFormat().resolvedOptions().timeZone, 'Gameplay did not send its local time zone');
        gameplayChannel = channel;
        gameplayPoll = { id: 10, message: 10, game: data.game, comment: data.comment, start: data.start, owner: true, status: null,
          confirmed: [], declined: 0, interested: 0, requests: [] };
        return Response.json({ id: 10, message: 10, emailFailures: 1 });
      }
      if (gameplayPoll && channel === gameplayChannel) return Response.json({
        messages: Number(request.searchParams.get('after')) >= 10 ? [] : [
          { id: 10, text: 'Gameplay: VALORANT', time: '2026-01-01T12:00:00Z', author: 'Player', userId: 1 },
        ], polls: [gameplayPoll],
      });
      return Response.json({ messages: Number(request.searchParams.get('after')) ? [] : [
        { id: 1, text: 'Uma mensagem', author: 'Nome antigo', userId: 2, time: '2026-01-01T12:00:00Z' },
        { id: 2, text: 'Outra mensagem', author: 'Ex-membro', userId: 99, time: '2026-01-01T12:01:00Z' },
      ] });
    }
    if (request.pathname.endsWith('/account.php')) {
      if (options?.method === 'POST') {
        const { action, name, bio, theme, frame, effect, colors, frameColor, avatar, avatarStill, avatarCrop } = JSON.parse(options.body);
        if (action === 'profile') {
          if (name !== undefined) account.name = roster[0].name = name;
          if (avatar !== undefined) account.avatarUrl = roster[0].avatarUrl = avatar;
          if (avatarStill !== undefined) account.avatarStillUrl = roster[0].avatarStillUrl = avatarStill;
          if (avatarCrop !== undefined) account.avatarCrop = roster[0].avatarCrop = avatarCrop;
        }
        else if (action === 'profileAppearance') account.appearance = roster[0].appearance = { bio, theme, frame, effect, colors, frameColor };
        else throw Error('Unexpected profile action');
      }
      return Response.json({ account });
    }
    if (request.pathname.endsWith('/servers.php')) {
      if (options?.method === 'POST') {
        const { action, server, previous, order } = JSON.parse(options.body);
        check(action === 'roleOrder' && server === 1 && previous.join(',') === '11,12' && order.join(',') === '12,11',
          'Reordering did not send the complete hierarchy');
        hierarchy = order.map((id, position) => ({ ...hierarchy.find(role => role.id === id), position }));
        roster[1].roles = hierarchy;
        roster[4].roles = [hierarchy[1]];
        return Response.json({ id: 1 });
      }
      if (request.searchParams.has('members')) {
        refreshCount++;
        return Response.json({ members: roster });
      }
      if (request.searchParams.has('entrance') || request.searchParams.has('server')) return Response.json({
        id: 1, name: 'Discordo Brasil', lobby: true, admin: true, permissions: 2, roles: hierarchy, members: roster,
        channels: [{ id: 12, name: 'geral', type: 'TEXTO' }, { id: 13, name: 'outro', type: 'TEXTO' },
          { id: 14, name: 'Resenha', type: 'VOZ' }],
      });
      return Response.json({ servers: [] });
    }
    return originalFetch(url, options);
  };
  await import('/src/main.ts?profile-test');
  await wait(() => document.querySelector('[data-member="2"]'), 'Member list did not load');
  const demo = document.querySelector('[data-voice-room="local-video-demo"]');
  check(demo, 'The creator did not see the private video test room');
  {
    const { VoiceSession } = await import('/src/voice-session.ts');
    const join = VoiceSession.prototype.join;
    VoiceSession.prototype.join = function (bots) {
      check(this.room === demo.dataset.voiceRoom, 'The test room did not use the voice join flow');
      check(Array.isArray(bots) && bots.length === 3, 'The creator did not provide their initial bots');
      // The simulated call flow below only tests permission and video layout.
      this.activity = undefined;
      this.receive({ type: 'welcome', self: { ...welcome.self, userId: 1 }, members: [], iceServers: [],
        demoHost: true, demoBots: bots });
    };
    try {
      demo.click();
      const stage = document.querySelector('#voice-stage');
      const chatBar = document.querySelector('.chat-bar');
      check(getComputedStyle(chatBar).display === 'none', 'The text-channel header was still visible above the viewer');
      stage.querySelector('[data-stage-menu]').click();
      check(document.querySelector('.workspace').classList.contains('with-channels'), 'The viewer lost access to the channel sidebar');
      stage.querySelector('[data-stage-menu]').click();
      check(!stage.hidden && stage.querySelectorAll('[data-screen-tile]').length === 6
        && document.querySelector('[data-voice-members="local-video-demo"]').children.length === 4,
        'The private room did not show three bots with screen and camera');
      const mainTrack = stage.querySelector('.voice-main-feed video').srcObject.getVideoTracks()[0];
      check(!document.querySelector('[data-dock-mic]').hidden && !document.querySelector('[data-dock-headphones]').hidden
        && document.querySelector('[data-dock-camera]').hidden && document.querySelector('[data-dock-screen]').hidden,
        'The test room did not expose voice without real video controls');
      stage.querySelector('[data-edit-demo]').click();
      const checkbox = stage.querySelector('input[aria-label="Tela de Bot 1"]');
      checkbox.click();
      check(mainTrack.readyState === 'ended' && stage.querySelectorAll('[data-screen-tile]').length === 5,
        'Turning off the first bot screen did not release its track: ' + mainTrack.readyState + ', ' + stage.querySelectorAll('[data-screen-tile]').length);
      stage.querySelector('[data-add-demo]').click();
      check(stage.querySelectorAll('[data-screen-tile]').length === 7 && stage.querySelector('input[aria-label="Câmera de Bot 4"]').checked,
        'The additional bot did not publish its two simulated feeds');
      stage.querySelector('[aria-label="Remover Bot 4"]').click();
      const activeTracks = [...stage.querySelectorAll('video')].flatMap(video => video.srcObject?.getTracks() ?? []);
      document.querySelector('[data-dock-leave]').click();
      check(activeTracks.length > 0 && activeTracks.every(track => track.readyState === 'ended') && stage.hidden,
        'Leaving the demo did not stop all simulated tracks');
      check(getComputedStyle(chatBar).display !== 'none', 'The channel header did not return after leaving the viewer');
    } finally {
      VoiceSession.prototype.join = join;
    }
  }
  {
    const { VoiceSession } = await import('/src/voice-session.ts');
    const { demoRoom } = await import('/src/voice-demo.ts');
    const workspace = document.createElement('div');
    workspace.innerHTML = voiceStageMarkup + voiceDockMarkup + voiceAccountControlsMarkup
      + '<button data-voice-settings></button><span data-account-voice-status></span><button data-voice-room="channel-1">Origem</button>';
    document.body.append(workspace);
    const call = createVoiceCall();
    const source = new VoiceSession('channel-1', 'Guest', preferences, { muted: true, deafened: false },
      () => call.changed?.(), (id, name) => call.moved?.(id, name));
    call.session = source;
    source.receive(welcome);
    const voice = mountVoice(call, workspace, () => 'Guest', preferences, () => {}, () => {},
      [{ id: 'channel-1', name: 'Origem' }], 1, true, 'Servidor');
    const join = VoiceSession.prototype.join;
    const bot = { id: 'demo-bot-1', name: 'Bot 1', screen: true, camera: true };
    VoiceSession.prototype.join = function (bots) {
      check(this.room === demoRoom && bots === undefined, 'Guest did not enter the demo as an observer');
      this.receive({ ...welcome, demoHost: false, demoBots: [bot] });
    };
    try {
      check(!workspace.querySelector('[data-voice-room="local-video-demo"]'), 'Guest could see a test room entry');
      source.receive({ type: 'move', room: demoRoom, name: 'Teste de vídeo' });
      check(call.session.room === demoRoom && source.state === 'ended', 'Guest was not transferred to the demo');
      const stage = workspace.querySelector('#voice-stage');
      check(!stage.hidden && stage.querySelectorAll('[data-screen-tile]').length === 2,
        'Guest did not see the shared simulation on arrival');
      check(stage.querySelector('[data-edit-demo]').hidden && stage.querySelector('.voice-demo-editor').hidden,
        'Guest had access to bot editing');
      check(!workspace.querySelector('[data-dock-mic]').hidden && !workspace.querySelector('[data-dock-headphones]').hidden,
        'Guest had no voice controls');
      call.session.updateDemo([]);
      check(stage.querySelectorAll('[data-screen-tile]').length === 2, 'Guest could edit bots');
      call.session.receive({ type: 'demo', bots: [{ ...bot, camera: false }] });
      check(stage.querySelectorAll('[data-screen-tile]').length === 1, 'Guest did not receive creator changes live');
    } finally {
      VoiceSession.prototype.join = join;
      voice.dispose();
      workspace.remove();
    }
  }
  const memberGroups = () => [...document.querySelectorAll('.member-group h3')].map(group => group.textContent.split(' ·')[0]).join(',');
  check(memberGroups() === 'Criador,ADM,Veterano,Sem cargo', 'The sidebar did not arrange the initial groups');
  const roleDialog = () => document.querySelector('.server-dialog[open]');
  document.querySelector('[data-server-settings]').click();
  roleDialog().querySelector('[data-tab="roles"]').click();
  roleDialog().querySelector('[data-order-role="12"][data-direction="-1"]').click();
  await wait(() => roleDialog().querySelector('.server-role-list strong').textContent === 'Organizador', 'The new order was not saved');
  roleDialog().querySelector('[data-close]').click();
  await wait(() => memberGroups() === 'Criador,ADM,Organizador,Veterano,Sem cargo', 'The sidebar did not follow the saved hierarchy');
  check(document.querySelectorAll('[data-member="2"]').length === 1
    && document.querySelector('[data-member="2"]').closest('.member-group').querySelector('h3').textContent.startsWith('Organizador'),
    'A member with multiple roles was not grouped by the highest role');
  const card = document.querySelector('#member-profile');
  document.querySelector('[data-member="2"]').click();
  const playedEffect = card.querySelector('.profile-effect [data-effect="grafite"]');
  check(playedEffect && card.dataset.profileFrame === 'gelo' && card.querySelector('[data-profile-bio]').textContent === peerAppearance.bio,
    'Opening another profile did not show its appearance and effect');
  roster[1].title = 'Moderador';
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(() => card.querySelector('[data-card-roles]').textContent.includes('Moderador'), 'Open profile did not update from the member list');
  check(refreshCount > 0 && card.querySelector('.profile-effect span') === playedEffect, 'Member refresh restarted the effect');
  await wait(() => !card.querySelector('.profile-effect span'), 'Profile effect did not finish');
  check(card.dataset.profileFrame === 'gelo', 'The frame disappeared with the effect');
  card.hidePopover();

  await wait(() => document.querySelector('.message[data-author="2"]'), 'The chat did not load the member message');
  const chatMessage = document.querySelector('.message[data-author="2"]');
  const authorName = chatMessage.querySelector('[data-author-name-button]');
  const authorAvatar = chatMessage.querySelector('[data-author-avatar] .avatar');
  const cardName = () => card.querySelector('[data-card-name]').textContent;
  chatMessage.querySelector('p').click();
  check(!card.matches(':popover-open'), 'Clicking the message text opened the profile');
  authorName.click();
  const chatEffect = card.querySelector('.profile-effect span');
  check(card.matches(':popover-open') && cardName() === roster[1].name && chatEffect,
    'Clicking a chat author did not open the current member profile');
  card.querySelector('[data-card-name]').click();
  card.querySelector('[data-card-avatar]').click();
  check(card.matches(':popover-open') && card.querySelector('.profile-effect span') === chatEffect,
    'Clicking inside the profile reopened it or replayed the effect');
  card.hidePopover();
  authorAvatar.click();
  check(card.matches(':popover-open') && cardName() === roster[1].name, 'Clicking the chat avatar did not open the profile');
  document.querySelector('.message[data-author="99"] [data-author-name-button]').click();
  check(card.matches(':popover-open') && cardName() === 'Ex-membro', 'A historical message did not open its author card');
  document.querySelector('[data-channel="13"]').click();
  check(!card.matches(':popover-open'), 'Changing channels left the old author profile open');
  const accountProfile = document.querySelector('[data-account-profile]');
  const accountOptions = document.querySelector('.account-menu');
  accountProfile.querySelector('[data-avatar]').click();
  check(card.matches(':popover-open') && cardName() === account.name && !accountOptions.open, 'The account avatar did not open the personal profile');
  const ownAnchor = accountProfile.getBoundingClientRect();
  const ownBounds = card.getBoundingClientRect();
  check(ownBounds.bottom <= ownAnchor.top - 9 && Math.abs(ownBounds.left - ownAnchor.left) < 2,
    'The personal profile should open above and aligned with the account bar');
  document.querySelector('[data-member="2"]').click();
  check(!card.style.getPropertyValue('--profile-max-height'), 'The account placement constrained another member’s profile');
  card.hidePopover();
  accountOptions.querySelector('summary').click();
  check(accountOptions.open, 'The account options arrow stopped opening the menu');
  accountOptions.open = false;

  document.querySelector('[data-server-settings]').click();
  const serverSettings = document.querySelector('.server-dialog[open]');
  serverSettings.querySelector('[data-tab="members"]').click();
  await wait(() => serverSettings.querySelector('[data-server-member-profile="2"]'), 'The server member list was unavailable');
  serverSettings.querySelector('[data-server-member-profile="2"]').click();
  check(!serverSettings.open && card.matches(':popover-open') && cardName() === roster[1].name,
    'The server member name did not open the same profile card');
  card.hidePopover();

  document.querySelector('.account-menu [data-settings]').click();
  const editorForm = document.querySelector('.profile-appearance-form');
  const appearancePreview = document.querySelector('.profile-preview');
  const update = (field, value) => {
    const control = editorForm.elements.namedItem(field);
    control.value = value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
  };
  update('bio', '<jogos> & café');
  update('theme', 'brasa');
  update('frame', 'grafite');
  editorForm.querySelector('[aria-controls="profile-effect-panel"]').click();
  editorForm.querySelector('[data-effect-choice="neon"]').click();
  check(appearancePreview.dataset.profileTheme === 'brasa' && !appearancePreview.querySelector('.profile-effect span'),
    'Editing options did not update the static preview');
  document.querySelector('[data-preview-effect]').click();
  check(appearancePreview.querySelector('[data-effect="neon"]'), 'The preview button did not replay the selected effect');
  const personal = editorForm.closest('dialog');
  const nameInput = personal.querySelector('#profile-name');
  nameInput.value = 'Novo nome';
  nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  check(personal.querySelectorAll('[data-save-settings], button[type=submit]').length === 1, 'Settings show duplicate save buttons');
  personal.dispatchEvent(new Event('cancel', { cancelable: true }));
  check(document.querySelector('.settings-confirm[open]'), 'Esc did not prompt for pending changes');
  chooseExit('stay');
  await wait(() => !document.querySelector('.settings-confirm'), 'Continue editing did not dismiss confirmation');
  check(personal.open && nameInput.value === 'Novo nome', 'Continue editing lost the draft');
  saveSettings().click();
  await wait(() => personal.querySelector('[data-save-status]').textContent === 'Alterações salvas.', 'Appearance and name were not saved together');
  check(account.name === 'Novo nome' && account.appearance.theme === 'brasa', 'Shared save did not persist both profile changes');
  update('theme', 'mata');
  personal.querySelector('[aria-controls="settings-voice"]').click();
  chooseExit('discard');
  await wait(() => !personal.querySelector('#settings-voice').hidden, 'Discard did not switch settings tab');
  personal.querySelector('[aria-controls="settings-profile"]').click();
  await wait(() => !personal.querySelector('#settings-profile').hidden, 'Profile tab did not reopen');
  check(personal.querySelector('#profile-theme').value === 'brasa', 'Discard overwrote saved appearance');
  personal.querySelector('[data-close]').click();
  document.querySelector('.account-menu [data-own-profile]').click();
  check(card.querySelector('[data-effect="neon"]') && card.dataset.profileFrame === 'grafite'
    && card.querySelector('[data-profile-bio]').textContent === '<jogos> & café', 'Opening the personal profile did not show the saved style');
  card.hidePopover();
  document.querySelector('.account-menu [data-settings]').click();
  check(document.querySelector('#profile-theme').value === 'brasa' && document.querySelector('#profile-bio').value === '<jogos> & café',
    'Reopening settings lost saved appearance');
  const photoSettings = document.querySelector('.user-settings[open]');
  const photoInput = photoSettings.querySelector('[data-media-file="avatar"]');
  const fixture = document.createElement('canvas');
  fixture.width = 240;
  fixture.height = 120;
  const paint = fixture.getContext('2d');
  paint.fillStyle = '#e02020'; paint.fillRect(0, 0, 120, 120);
  paint.fillStyle = '#2020e0'; paint.fillRect(120, 0, 120, 120);
  const photo = new File([await new Promise(resolve => fixture.toBlob(resolve))], 'foto.png', { type: 'image/png' });
  const cropDialog = () => document.querySelector('.avatar-editor[open]');
  const choosePhoto = file => {
    const selection = new DataTransfer();
    selection.items.add(file);
    photoInput.files = selection.files;
    photoInput.dispatchEvent(new Event('change'));
  };
  choosePhoto(photo);
  await wait(cropDialog, 'Picking a photo did not open the crop editor');
  cropDialog().querySelector('[data-cancel]').click();
  await wait(() => !photoSettings.querySelector('[data-photo=avatar]').disabled, 'Cancel left the photo editor busy');
  check(saveSettings().disabled && !photoSettings.querySelector('[data-preview-avatar] img'), 'Cancel applied the photo');
  choosePhoto(photo);
  await wait(cropDialog, 'Choosing a photo again did not reopen the editor');
  cropDialog().querySelector('[data-rotate]').click();
  cropDialog().querySelector('[data-reset]').click();
  const zoom = cropDialog().querySelector('input[type=range]');
  zoom.value = '2';
  zoom.dispatchEvent(new Event('input'));
  check(cropDialog().querySelector('output').value === '200%', 'Zoom did not update the crop');
  for (let i = 0; i < 15; i++) keyboard(cropDialog().querySelector('canvas'), 'ArrowLeft');
  cropDialog().querySelector('[data-apply]').click();
  await wait(() => photoSettings.querySelector('[data-preview-avatar] img'), 'Applying did not update the preview');
  const cropped = photoSettings.querySelector('[data-preview-avatar] img');
  await cropped.decode();
  fixture.width = fixture.height = 192;
  paint.drawImage(cropped, 0, 0);
  const [red, , blue] = paint.getImageData(96, 96, 1, 1).data;
  check(cropped.naturalWidth === 192 && blue > red && account.avatarUrl === undefined, 'Applying the crop did not stage the chosen image');
  const gif = new File([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), char => char.charCodeAt(0))],
    'avatar.gif', { type: 'image/gif' });
  choosePhoto(gif);
  await wait(cropDialog, 'GIFs did not open in the crop editor');
  cropDialog().querySelector('[data-rotate]').click();
  cropDialog().querySelector('[data-apply]').click();
  await wait(() => photoSettings.querySelector('[data-preview-avatar] img')?.src.startsWith('data:image/gif;'), 'GIF lost animation after cropping');
  saveSettings().click();
  await wait(() => photoSettings.querySelector('[data-save-status]').textContent === 'Alterações salvas.', 'The GIF crop did not save');
  check(account.avatarCrop.turns === 1 && account.avatarStillUrl.startsWith('data:image/png;'), 'The saved GIF lost its crop or thumbnail');
  const previewCard = photoSettings.querySelector('.profile-preview');
  photoSettings.querySelector('[data-theme-choice="personalizado"]').click();
  const colorPicker = photoSettings.querySelector('[data-theme-colors]');
  const hexInput = colorPicker.querySelector('[data-color-hex]');
  const editHex = value => {
    hexInput.value = value;
    hexInput.dispatchEvent(new Event('input', { bubbles: true }));
  };
  check(!colorPicker.hidden && photoSettings.querySelector('[data-theme-choice="personalizado"]').getAttribute('aria-pressed') === 'true',
    'Selecting the custom theme did not reveal the palette');
  editHex('#FFF1C9');
  check(getComputedStyle(previewCard).backgroundColor === 'rgb(255, 241, 201)'
    && getComputedStyle(previewCard.querySelector('h2')).color === 'rgb(0, 0, 0)', 'The solid palette did not preview a readable light theme');
  colorPicker.querySelector('[data-color-mode="gradient"]').click();
  colorPicker.querySelector('[data-color-stop="secondary"]').click();
  editHex('#15243F');
  const direction = colorPicker.querySelector('[data-color-direction]');
  direction.value = 'diagonal';
  direction.dispatchEvent(new Event('change', { bubbles: true }));
  check(getComputedStyle(previewCard).backgroundImage.includes('135deg')
    && getComputedStyle(previewCard.querySelector('h2')).color === 'rgb(255, 255, 255)', 'The mixed gradient did not use the selected direction and contrast');
  saveSettings().click();
  await wait(() => photoSettings.querySelector('[data-save-status]').textContent === 'Alterações salvas.', 'The custom theme did not save');
  check(account.appearance.colors.primary === '#FFF1C9' && account.appearance.colors.secondary === '#15243F'
    && account.appearance.colors.direction === 'diagonal', 'A gradient setting was lost on save');
  photoSettings.close();
  await wait(() => !photoSettings.isConnected, 'Profile settings did not close');
  document.querySelector('[data-member="1"]').click();
  check(card.dataset.profileTheme === 'personalizado' && getComputedStyle(card).backgroundImage.includes('135deg'),
    'The real profile card did not use the saved gradient');
  const actualSize = card.getBoundingClientRect();
  card.hidePopover();
  document.querySelector('.account-menu [data-settings]').click();
  const reopenedSettings = document.querySelector('.user-settings[open]');
  const reopenedPreview = reopenedSettings.querySelector('.profile-preview');
  const previewSize = reopenedPreview.getBoundingClientRect();
  check(Math.abs(previewSize.width - actualSize.width) < 1 && Math.abs(previewSize.height - actualSize.height) < 1,
    'The settings preview and the profile opened from members have different dimensions');
  for (const selector of ['[data-card-roles]', '[data-edit-profile]', '[data-edit-member-roles]']) {
    check(getComputedStyle(reopenedPreview.querySelector(selector)).visibility === 'hidden', 'The settings preview displayed member controls');
  }
  check(reopenedSettings.querySelector('[data-color-mode="gradient"]').getAttribute('aria-pressed') === 'true'
    && reopenedSettings.querySelector('[data-color-hex]').value === '#FFF1C9', 'Reopening the theme did not restore its colors');
  reopenedSettings.querySelector('[aria-controls="profile-frame-panel"]').click();
  const gallery = reopenedSettings.querySelector('#profile-frame-panel');
  const frameChoice = value => gallery.querySelector('[data-frame-choice="' + value + '"]');
  const colorControls = gallery.querySelector('[data-frame-color-controls]');
  check(!gallery.hidden && gallery.querySelectorAll('[data-frame-choice]').length === 5,
    'The frame gallery did not show all five options');
  frameChoice('metal').click();
  const previewFrame = getComputedStyle(reopenedPreview.querySelector('.profile-frame'));
  check(reopenedPreview.dataset.profileFrame === 'metal' && previewFrame.backgroundImage.includes('gradient')
    && previewFrame.animationName === 'none' && colorControls.hidden,
    'Metal did not render as a static frame or showed the color picker');
  check(!reopenedSettings.querySelector('[data-effect-choice="metal"]'), 'Metal appeared as an opening effect');
  frameChoice('neon').click();
  check(!colorControls.hidden, 'Neon did not offer a custom color');
  gallery.querySelector('[data-custom-frame-color]').click();
  const frameColorInput = gallery.querySelector('[data-frame-color]');
  frameColorInput.value = '#20acf0';
  frameColorInput.dispatchEvent(new Event('input', { bubbles: true }));
  check(reopenedPreview.style.getPropertyValue('--profile-frame-color') === '#20ACF0', 'The frame color did not preview');
  frameChoice('grafite').click();
  check(!colorControls.hidden && !reopenedPreview.style.getPropertyValue('--profile-frame-color'), 'The Neon color leaked to Grafite');
  frameChoice('neon').click();
  check(reopenedPreview.style.getPropertyValue('--profile-frame-color') === '#20ACF0', 'Switching frames discarded the unsaved color');
  saveSettings().click();
  await wait(() => reopenedSettings.querySelector('[data-save-status]').textContent === 'Alterações salvas.', 'The frame did not save');
  check(account.appearance.frame === 'neon' && account.appearance.frameColor === '#20ACF0', 'The custom frame color was lost on save');
  reopenedSettings.close();
  await wait(() => !reopenedSettings.isConnected, 'Frame settings did not close');
  document.querySelector('.account-menu [data-own-profile]').click();
  check(card.dataset.profileFrame === 'neon' && card.style.getPropertyValue('--profile-frame-color') === '#20ACF0',
    'The real profile card did not use the saved frame color');
  card.hidePopover();
  document.querySelector('.account-menu [data-settings]').click();
  const animationSettings = document.querySelector('.user-settings[open]');
  animationSettings.querySelector('[aria-controls="profile-effect-panel"]').click();
  const animationGallery = animationSettings.querySelector('#profile-effect-panel');
  const animationChoices = [...animationGallery.querySelectorAll('[data-effect-choice]')];
  check(!animationGallery.hidden && animationChoices.length === 6 && !animationGallery.querySelector('select'),
    'The animation gallery did not show all choices together');
  check(animationGallery.querySelector('[aria-pressed="true"]').dataset.effectChoice === 'neon',
    'The saved animation was not selected in the gallery');
  check(getComputedStyle(animationGallery.querySelector('[data-effect="neon"]')).animationName === 'none',
    'An animation thumbnail played on its own');
  const smokeChoice = animationGallery.querySelector('[data-effect-choice="brasa-fumaca"]');
  smokeChoice.click();
  check(smokeChoice.getAttribute('aria-pressed') === 'true'
    && animationChoices.filter(button => button.getAttribute('aria-pressed') === 'true').length === 1,
    'Selecting a new animation did not update the gallery highlight');
  const animationPreview = animationSettings.querySelector('.profile-preview');
  check(!animationPreview.querySelector('.profile-effect > *'), 'Selecting an effect started playback before replay');
  animationSettings.querySelector('[data-preview-effect]').click();
  await wait(() => animationPreview.querySelector('canvas[data-effect="brasa-fumaca"]'), 'Smoke did not start in the preview');
  saveSettings().click();
  await wait(() => animationSettings.querySelector('[data-save-status]').textContent === 'Alterações salvas.', 'The new effect did not save');
  check(account.appearance.effect === 'brasa-fumaca', 'The saved account lost its opening animation');
  animationSettings.close();
  await wait(() => !animationSettings.isConnected, 'Animation settings did not close');
  check(!animationPreview.querySelector('.profile-effect > *'), 'Closing settings left an animation active');
  document.querySelector('.account-menu [data-own-profile]').click();
  await wait(() => card.querySelector('canvas[data-effect="brasa-fumaca"]'), 'Smoke did not start on the real profile');
  const smoke = card.querySelector('canvas[data-effect="brasa-fumaca"]');
  const avatar = card.querySelector('[data-card-avatar]').getBoundingClientRect();
  const effectBounds = smoke.getBoundingClientRect();
  const originX = (avatar.left + avatar.width * .77 - effectBounds.left) / effectBounds.width * smoke.width;
  const originY = (avatar.top + avatar.height * .60 - effectBounds.top) / effectBounds.height * smoke.height;
  const context = smoke.getContext('2d');
  await wait(() => context.getImageData(Math.floor(originX), Math.floor(originY), 4, 4).data
    .some((value, i) => i % 4 === 3 && value > 80), 'The smoke did not draw at the actual avatar');
  card.hidePopover();
  await wait(() => !smoke.isConnected, 'Closing the card left the smoke running');
  peerAppearance.effect = 'visitante-vidro';
  roster[1].title = 'Visitante';
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(() => document.querySelector('[data-member="2"]')?.closest('.member-group')
    ?.querySelector('h3')?.textContent.includes('Visitante'), 'The new peer appearance was not fetched');
  document.querySelector('[data-member="2"]').click();
  await wait(() => card.querySelector('svg[data-effect="visitante-vidro"]'), 'The alien did not start on the other profile');
  const visitor = card.querySelector('svg[data-effect="visitante-vidro"]');
  const gesture = visitor.querySelector('[id$="-gesture"]');
  check(gesture.closest('[id$="-visitor-window"]'), 'The gesture is outside the wiped glass');
  await wait(() => Number(gesture.getAttribute('opacity')) === 1, 'The alien did not raise its hand');
  check(card.querySelector('svg[data-effect="visitante-vidro"]') === visitor, 'A profile refresh restarted the animation');
  await wait(() => !visitor.isConnected, 'The alien effect did not finish');
  check(card.matches(':popover-open') && card.dataset.profileFrame === 'gelo', 'The effect changed the open profile after finishing');
  card.hidePopover();
  const gameplayButton = document.querySelector('[data-open-gameplay]');
  check(gameplayButton.classList.contains('primary-button'), 'Gameplay did not use the yellow primary button');
  gameplayButton.click();
  const gameplayForm = document.querySelector('.gameplay-dialog form');
  const gameInput = gameplayForm.querySelector('[name=game]');
  const gameplayDay = gameplayForm.querySelector('[name=day]');
  const gameplayTime = gameplayForm.querySelector('[name=time]');
  const scheduleLabel = gameplayDay.closest('label');
  check(scheduleLabel.getBoundingClientRect().top - gameInput.getBoundingClientRect().bottom >= 8,
    'The game input focus outline overlaps the label below');
  gameInput.value = 'VALORANT';
  const localDay = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(value => String(value).padStart(2, '0')).join('-');
  const limitDay = new Date();
  limitDay.setDate(limitDay.getDate() + 3);
  check(gameplayDay.options.length === 4 && gameplayDay.value === localDay(new Date())
    && gameplayDay.options[3].value === localDay(limitDay), 'The picker did not offer today through the third calendar day');
  check(gameplayDay.options[3].textContent.includes(String(limitDay.getFullYear())) && gameplayTime.type === 'time',
    'The schedule did not prefill the date and offer a separate time field');
  const followingDay = new Date(limitDay);
  followingDay.setDate(followingDay.getDate() + 1);
  gameplayDay.value = localDay(followingDay);
  check(gameplayDay.validity.valueMissing, 'The picker offered the fourth calendar day');
  gameplayDay.value = localDay(limitDay);
  gameplayTime.value = '23:59';
  check(gameplayDay.validity.valid && gameplayTime.validity.valid, 'The last minute of the third day was rejected');
  gameplayForm.querySelector('[name=channel]').value = '13';
  const guestSearch = gameplayForm.querySelector('[data-guest-search]');
  const guest = gameplayForm.querySelector('[name=members][value="2"]');
  const searchGuests = value => {
    guestSearch.value = value;
    guestSearch.dispatchEvent(new Event('input', { bubbles: true }));
  };
  searchGuests('OUTRA PESSOA');
  check([...gameplayForm.querySelectorAll('[data-guest]:not([hidden])')].length === 1 && !guest.closest('label').hidden,
    'Guest search did not filter the list');
  guest.click();
  searchGuests('unmatched');
  check(guest.checked && guest.closest('label').hidden
    && gameplayForm.querySelector('[data-selected-guests] li')?.textContent === 'Outra pessoa'
    && gameplayForm.querySelector('[data-guest-count]').textContent === '1/20',
    'Filtering hid or cleared the selection summary');
  searchGuests('');
  guest.click();
  check(gameplayForm.querySelector('[data-guest-count]').textContent === '0/20', 'Unchecking a member did not update the summary');
  guest.click();
  gameplayForm.querySelector('[name=comment]').value = '<duo> & ranked';
  gameplayForm.requestSubmit();
  await wait(() => document.querySelector('.gameplay-card h3')?.textContent === 'VALORANT', 'The Gameplay poll did not appear in the selected channel');
  check(document.querySelector('.gameplay-comment')?.textContent === '<duo> & ranked', 'The poll did not display the comment as plain text');
  check(document.querySelector('#channel-title').textContent === 'outro' && document.querySelector('.chat-note').textContent.includes('1 convite'),
    'Publication did not open the chosen chat or show the email failure');
  gameplayPoll.owner = false;
  gameplayPoll.status = 'CONVIDADO';
  await wait(() => document.querySelector('[data-gameplay-action="CONFIRMADO"]'), 'The invited member did not receive a vote button');
  gameplayPoll.participants = [
    { member: 2, name: 'Outra pessoa', status: 'CONFIRMADO' },
    { member: 3, name: 'Pessoa sem cargo', status: 'RECUSADO' },
    { member: 5, name: 'Pessoa veterana', status: 'INTERESSADO' },
  ];
  gameplayPoll.confirmed = ['Outra pessoa'];
  gameplayPoll.declined = gameplayPoll.interested = 1;
  await wait(() => document.querySelectorAll('.gameplay-response').length === 3, 'The poll did not list all three answers');
  const response = (kind, label, name) => {
    const row = document.querySelector('[data-response="' + kind + '"]');
    check(row.textContent.includes(name) && row.querySelector('[role=img]').getAttribute('aria-label') === label,
      'The name and icon do not match the Gameplay response');
    return row;
  };
  response('CONFIRMADO', 'Confirmado', 'Outra pessoa');
  response('RECUSADO', 'Recusado', 'Pessoa sem cargo');
  check(!response('INTERESSADO', 'Aguardando aprovação', 'Pessoa veterana').querySelector('button'),
    'A regular member was shown the organizer action');
  gameplayPoll.owner = true;
  await wait(() => document.querySelector('[data-gameplay-action="approve"][data-gameplay-member="5"]'),
    'The organizer could not approve the interested member');
  document.querySelector('[data-gameplay-action="approve"][data-gameplay-member="5"]').click();
  await wait(() => [...document.querySelectorAll('[data-response="CONFIRMADO"]')].some(row => row.textContent.includes('Pessoa veterana'))
    && !document.querySelector('[data-response="INTERESSADO"]'), 'Approval did not confirm the interested member immediately');
  gameplayPoll.participants[0].status = 'RECUSADO';
  await wait(() => document.querySelectorAll('[data-response="RECUSADO"]').length === 2
    && ![...document.querySelectorAll('[data-response="CONFIRMADO"]')].some(row => row.textContent.includes('Outra pessoa')),
    'Changing a vote did not move the participant to the new status');
  gameplayPoll.owner = false;
  gameplayPoll.status = null;
  await wait(() => document.querySelector('[data-gameplay-action="INTERESSADO"]'), 'An uninvited member did not get the interest button');
  const absenceWorkspace = document.body.appendChild(document.createElement('main'));
  absenceWorkspace.innerHTML = voiceStageMarkup + voiceDockMarkup + voiceAccountControlsMarkup
    + '<span data-account-voice-status></span><ul data-voice-members="channel-1"></ul>';
  const absenceCall = createVoiceCall();
  const mutedPeer = { ...member, id: 'muted-peer', name: 'Muted', muted: false, serverMuted: true, userId: 2 };
  const activePeer = { ...member, id: 'active-peer', name: 'Active', muted: false, userId: 3 };
  const deafenedPeer = { ...member, id: 'deafened-peer', name: 'Deafened', muted: false, deafened: true, userId: 4 };
  const savedFetch = window.fetch;
  let absenceRequest;
  let rejectAbsence = true;
  window.fetch = (url, options) => {
    const request = new URL(url, location.href);
    if (request.searchParams.get('sound') === 'caller-absence') return Promise.resolve(new Response(wav(.32)));
    if (!request.pathname.endsWith('/voice.php')) return savedFetch(url, options);
    if (options?.method === 'POST') {
      absenceRequest = JSON.parse(options.body);
      return Promise.resolve(rejectAbsence ? Response.json({ error: 'absence_cooldown' }, { status: 429 })
        : Response.json({ ok: true }));
    }
    return Promise.resolve(Response.json({ rooms: { 'channel-1': [mutedPeer, activePeer, deafenedPeer] } }));
  };
  const absenceSession = new VoiceSession('channel-1', 'Player', preferences, { muted: false, deafened: false },
    () => absenceCall.changed?.(), () => {}, event => absenceCall.activity?.(event));
  absenceCall.session = absenceSession;
  absenceSession.receive({ ...welcome, self: { ...welcome.self, userId: 1 } });
  const absenceVoice = mountVoice(absenceCall, absenceWorkspace, () => 'Player', preferences, () => {}, () => {},
    [{ id: 'channel-1', name: 'Origem' }], 1, false, '', {
      email: account.email, permissions: 2, appearance() {}, profile() {}, async editRoles() {},
    });
  try {
    const row = name => [...absenceWorkspace.querySelectorAll('[data-voice-members] li')]
      .find(item => item.querySelector('.voice-member-name').textContent === name);
    await wait(() => row('Muted'), 'Muted peer not visible in the sidebar');
    const open = name => row(name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const findAction = () => absenceWorkspace.querySelector('.voice-member-menu:popover-open [data-check-absence]');
    open('Active');
    const activeAction = findAction();
    check(activeAction?.disabled, 'An active microphone should keep the alert visible and disabled');
    activeAction.click();
    check(!absenceRequest, 'A disabled alert sent an absence request');
    activePeer.muted = true;
    await wait(() => !activeAction.disabled, 'Muting did not enable the alert in the open menu');
    activePeer.muted = false;
    await wait(() => activeAction.disabled, 'Unmuting did not disable the alert in the open menu');
    open('Player');
    check(!findAction(), 'The alert action appeared for your own account');
    open('Deafened');
    check(findAction() && !findAction().disabled, 'The alert action was disabled for a member who silenced their headphones');
    row('Muted').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true,
      clientX: innerWidth - 1, clientY: innerHeight - 1 }));
    check(findAction() && !findAction().disabled && findAction().previousElementSibling.hasAttribute('data-voice-edit-roles')
      && getComputedStyle(findAction()).backgroundColor === getComputedStyle(document.querySelector('[data-open-gameplay]')).backgroundColor,
      'The muted peer alert was not enabled, yellow and directly below Editar cargos');
    const menu = findAction().closest('.voice-member-menu');
    const status = menu.querySelector('[role="status"]');
    const initialTop = menu.getBoundingClientRect().top;
    findAction().click();
    await wait(() => status.textContent.includes('recebeu um aviso'), 'The cooldown message did not appear');
    check(menu.getBoundingClientRect().top < initialTop && menu.getBoundingClientRect().bottom <= innerHeight - 7
      && status.getBoundingClientRect().bottom <= menu.getBoundingClientRect().bottom,
      'The cooldown message pushed the menu past the bottom edge');
    rejectAbsence = false;
    findAction().click();
    await wait(() => absenceWorkspace.querySelector('.voice-activity-toast').textContent === 'Aviso de ausência enviado.',
      'Sending the alert did not show confirmation');
    check(JSON.stringify(absenceRequest) === JSON.stringify({ type: 'check-absence', room: 'channel-1', sender: 'self', id: mutedPeer.id }),
      'The alert targeted the wrong participant');
    const before = started.length;
    const alert = { type: 'check-absence', senderName: 'Caller', sound: null };
    absenceSession.receive({ type: 'state', member: { ...absenceSession.self, serverMuted: true } });
    absenceSession.receive({ ...alert, sound: 'account.php?sound=caller-absence' });
    await wait(() => started.length === before + 1, 'Server microphone mute blocked the alert');
    check(Math.abs(started.at(-1).buffer.duration - .32) < .01, 'The recipient did not play the recording from the caller');
    absenceSession.receive({ type: 'state', member: { ...absenceSession.self, serverMuted: false, serverDeafened: true } });
    check(absenceSession.deafened && !absenceSession.microphone.deafened, 'The test did not activate server deafen');
    audioInterrupted = audioNeedsGesture = true;
    absenceSession.receive(alert);
    const resumeAlert = absenceWorkspace.querySelector('[data-voice-play]');
    await wait(() => !resumeAlert.hidden, 'The absence alert was dropped when mobile playback was blocked');
    document.body.dispatchEvent(new Event('touchend', { bubbles: true }));
    await wait(() => started.length === before + 2 && resumeAlert.hidden, 'The recipient did not replay the alert after a touch');
    check(absenceWorkspace.querySelector('.voice-activity-toast').textContent.startsWith('Caller'),
      'The recipient toast did not identify the caller');
    absenceSession.receive({ type: 'state', member: { ...absenceSession.self, serverDeafened: false } });
    absenceSession.toggleHeadphones();
    check(absenceSession.microphone.deafened && !absenceSession.self.serverDeafened, 'The test did not silence local headphones');
    absenceSession.receive(alert);
    await wait(() => started.length === before + 3, 'The absence alert did not play with local headphones silenced');
    check(absenceSession.deafened && resumeAlert.hidden, 'Playing the alert changed the recipient’s headphone state');
    absenceCall.activity({ type: 'peer-moderated', reason: 'disconnect', member: activePeer });
    await new Promise(resolve => setTimeout(resolve, 100));
    check(started.length === before + 3, 'A regular moderation sound played with local headphones silenced');
  } finally {
    absenceVoice.dispose();
    absenceWorkspace.remove();
    window.fetch = savedFetch;
  }
  const accountFetch = window.fetch;
  const deleteRequests = [];
  let deleted = false;
  const ownKey = 'discordo:voice:' + account.email;
  const otherKey = 'discordo:voice:someone-else@example.test';
  localStorage.setItem(ownKey, '{}');
  localStorage.setItem(otherKey, '{}');
  window.fetch = async (url, options) => {
    if (options?.method === 'POST' && new URL(url, location.href).pathname.endsWith('/account.php')) {
      const body = JSON.parse(options.body);
      if (body.action === 'deleteAccount') {
        deleteRequests.push(body);
        if (body.password !== 'senha-correta') return Response.json({ error: 'A senha não confere.' }, { status: 422 });
        return Response.json({ account: null, deleted: true });
      }
    }
    return accountFetch(url, options);
  };
  try {
    openSettings(document.body, account, () => {}, async () => true, () => {}, () => {}, undefined, undefined, undefined,
      () => { deleted = true; });
    const settings = document.querySelector('.user-settings[open]');
    settings.querySelector('[aria-controls="settings-account"]').click();
    await wait(() => !settings.querySelector('#settings-account').hidden, 'The account tab did not open');
    await Promise.resolve();
    const button = settings.querySelector('[data-delete-account]');
    button.click();
    await wait(() => document.querySelector('.account-delete-confirm[open]'), 'The deletion prompt did not open');
    let prompt = document.querySelector('.account-delete-confirm[open]');
    const field = prompt.querySelector('input[type=password]');
    const fieldStyle = getComputedStyle(field);
    const buttons = [...prompt.querySelectorAll('.account-delete-actions button')];
    const actions = buttons.map(button => button.getBoundingClientRect());
    check(buttons.every(button => getComputedStyle(button).justifyContent === 'center'), 'The action labels were not centered');
    check(fieldStyle.backgroundColor === getComputedStyle(settings.querySelector('.profile-name')).backgroundColor
      && parseFloat(fieldStyle.borderRadius) > 0 && field.getBoundingClientRect().height >= 44,
      'The password input did not use the theme field style');
    const fieldBounds = field.getBoundingClientRect();
    check(actions.length === 2 && actions.every(button => button.height >= 44)
      && Math.abs(actions[0].width - actions[1].width) <= 1 && actions[0].top === actions[1].top
      && Math.abs(actions[0].left - fieldBounds.left) <= 1 && Math.abs(actions[1].right - fieldBounds.right) <= 1,
      'The account confirmation actions did not fill the footer evenly');
    prompt.querySelector('[data-cancel]').click();
    check(!deleteRequests.length && !deleted, 'Cancel issued an account deletion request');
    button.click();
    await wait(() => document.querySelector('.account-delete-confirm[open]'), 'The deletion prompt did not reopen');
    prompt = document.querySelector('.account-delete-confirm[open]');
    const password = prompt.querySelector('input[type=password]');
    password.value = 'senha-errada';
    password.form.requestSubmit();
    await wait(() => prompt.querySelector('[role=status]').textContent === 'A senha não confere.', 'Wrong password was not shown in the confirmation');
    check(prompt.open && settings.open && !deleted, 'Wrong password terminated the current session');
    password.value = 'senha-correta';
    password.form.requestSubmit();
    await wait(() => deleted, 'The confirmed deletion did not leave account settings');
    check(deleteRequests.length === 2 && deleteRequests.every(body => body.email === account.email)
      && !settings.open && !prompt.open, 'The deletion did not target the current account or close the confirmation');
    check(!localStorage.getItem(ownKey) && localStorage.getItem(otherKey), 'The deletion cleared the wrong browser data');
  } finally {
    window.fetch = accountFetch;
    localStorage.removeItem(otherKey);
  }
  return { sounds: started.length, uploads: requests.length };
})()`,
    });
    assert.equal(evaluation.exceptionDetails, undefined, JSON.stringify(evaluation.exceptionDetails));
    assert.deepEqual(evaluation.result.value, { sounds: 15, uploads: 8 });
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 320, mobile: false, deviceScaleFactor: 1 });
    const smallMenu = await command('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const { openVoiceMemberMenu } = await import('/src/voice-member-menu.ts');
        const host = document.body.appendChild(document.createElement('div'));
        openVoiceMemberMenu(host, {
          member: { id: 'muted', name: 'Mutado', muted: true, sharing: false }, x: innerWidth - 1, y: innerHeight - 1,
          profile() {}, audio: { muted: false, volume: 100 }, setAudio() {},
          destinations: [{ id: 'test', name: 'Teste' }], async move() {}, permissions: 112, async moderate() {},
          async checkAbsence() { throw Error('Essa pessoa recebeu um aviso há pouco. Aguarde para enviar outro.'); },
        });
        const menu = host.querySelector('.voice-member-menu');
        const status = menu.querySelector('[role="status"]');
        menu.querySelector('[data-check-absence]').click();
        await Promise.resolve();
        const bounds = menu.getBoundingClientRect();
        const message = status.getBoundingClientRect();
        const result = status.textContent.includes('Aguarde') && menu.scrollTop > 0
          && bounds.top >= 8 && bounds.bottom <= innerHeight - 7 && message.top >= bounds.top && message.bottom <= bounds.bottom;
        menu.hidePopover();
        host.remove();
        return result;
      })()`,
    });
    assert.equal(smallMenu.exceptionDetails, undefined, JSON.stringify(smallMenu.exceptionDetails));
    assert.equal(smallMenu.result.value, true, 'A short viewport must scroll the alert message into view');
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, mobile: false, deviceScaleFactor: 1 });
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const mobile = await command('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        document.querySelector('.account-menu [data-settings]').click();
        const settings = document.querySelector('.user-settings[open]');
        settings.querySelector('[aria-controls="profile-frame-panel"]').click();
        settings.querySelector('[data-frame-choice="metal"]').click();
        const frame = settings.querySelector('.profile-preview').dataset.profileFrame;
        settings.querySelector('[aria-controls="profile-effect-panel"]').click();
        const panel = settings.querySelector('#profile-effect-panel');
        const restored = panel.querySelector('[aria-pressed="true"]').dataset.effectChoice;
        const replay = settings.querySelector('[data-preview-effect]');
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches || replay.disabled) {
          throw Error('Reduced motion disabled the requested preview');
        }
        if (getComputedStyle(panel.querySelector('[data-effect="neon"]').parentElement).display === 'none') {
          throw Error('Reduced motion hid static thumbnails');
        }
        const preview = settings.querySelector('.profile-preview');
        panel.querySelector('[data-effect-choice="neon"]').click();
        if (preview.querySelector('.profile-effect > *')) throw Error('Selection started playing by itself');
        replay.click();
        const neon = preview.querySelector('[data-effect="neon"]');
        if (!neon?.getAnimations().length) throw Error('A CSS effect could not be previewed with reduced motion');
        panel.querySelector('[data-effect-choice="visitante-vidro"]').click();
        replay.click();
        for (let i = 0; i < 120 && !preview.querySelector('svg[data-effect="visitante-vidro"]'); i++) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (!preview.querySelector('svg[data-effect="visitante-vidro"]')?.getBoundingClientRect().width) {
          throw Error('An illustrated effect could not be previewed with reduced motion');
        }
        panel.querySelector('[data-effect-choice="none"]').click();
        if (preview.querySelector('.profile-effect > *')) throw Error('Changing selection did not stop the manually played animation');
        return {
          viewport: innerWidth,
          width: settings.getBoundingClientRect().width,
          panelWidth: panel.clientWidth,
          contentWidth: panel.scrollWidth,
          frame,
          restored,
          replayDisabled: settings.querySelector('[data-preview-effect]').disabled,
        };
      })()`,
    });
    assert.equal(mobile.exceptionDetails, undefined, JSON.stringify(mobile.exceptionDetails));
    const { viewport, width, panelWidth, contentWidth, frame, restored, replayDisabled } = mobile.result.value;
    assert.equal(viewport, 390);
    assert.ok(width <= viewport && panelWidth > 0 && contentWidth <= panelWidth + 1, JSON.stringify(mobile.result.value));
    assert.equal(frame, 'metal');
    assert.equal(restored, 'brasa-fumaca');
    assert.equal(replayDisabled, true);
    await command('Emulation.setEmulatedMedia', { features: [] });
    await command('Runtime.evaluate', { expression: `document.querySelector('.user-settings[open]').close();
      document.querySelector('.mobile-menu').setAttribute('aria-expanded', 'false');
      document.querySelector('.workspace').classList.remove('with-channels', 'with-members');` });
    await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    async function swipe(x, y, dx, dy) {
      await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (const progress of [0.25, 0.5, 0.75, 1]) {
        await command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * progress, y: y + dy * progress }] });
      }
      await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    async function expanded() {
      const { result } = await command('Runtime.evaluate', {
        returnByValue: true,
        expression: `['.mobile-menu', '.members-toggle'].map(selector =>
          document.querySelector(selector).getAttribute('aria-expanded') === 'true')`,
      });
      return result.value;
    }
    await swipe(115, 280, 135, 8);
    assert.deepEqual(await expanded(), [true, false], 'Swiping right should open the channels');
    const joined = await command('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        const { VoiceSession } = await import('/src/voice-session.ts');
        const join = VoiceSession.prototype.join;
        VoiceSession.prototype.join = function () {
          VoiceSession.prototype.join = join;
          setTimeout(() => this.receive({
            type: 'welcome', self: { id: 'mobile-join', name: 'Player', muted: true, sharing: false },
            members: [], iceServers: [],
          }), 40);
        };
        document.querySelector('.workspace [data-voice-room="channel-14"]').click();
        const participant = '.workspace [data-voice-members="channel-14"] li';
        for (let i = 0; i < 50 && !document.querySelector(participant); i++) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        return {
          participant: Boolean(document.querySelector(participant)),
          channelsOpen: document.querySelector('.workspace').classList.contains('with-channels'),
        };
      })()`,
    });
    assert.equal(joined.exceptionDetails, undefined, JSON.stringify(joined.exceptionDetails));
    assert.deepEqual(joined.result.value, { participant: true, channelsOpen: true });
    assert.deepEqual(await expanded(), [true, false], 'Joining voice should keep the channels expanded');
    await swipe(222, 306, -120, 0);
    assert.deepEqual(await expanded(), [false, false], 'Swiping left should close the channels');
    await swipe(270, 270, -130, 4);
    assert.deepEqual(await expanded(), [false, true], 'Swiping left should open the members');
    await swipe(200, 320, 125, 0);
    assert.deepEqual(await expanded(), [false, false], 'Swiping right should close the members');
    await swipe(150, 230, 32, 155);
    assert.deepEqual(await expanded(), [false, false], 'A vertical scroll should leave both panels closed');
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reducedMotionProfile = await command('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const toggle = document.querySelector('.members-toggle');
        const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
        if (!wasOpen) toggle.click();
        const card = document.querySelector('#member-profile');
        if (card.querySelector('.profile-effect > *')) throw Error('A profile effect played before opening a profile');
        document.querySelector('[data-member="2"]').click();
        let visitor;
        for (let i = 0; i < 120 && !visitor; i++) {
          visitor = card.querySelector('svg[data-effect="visitante-vidro"]');
          if (!visitor) await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (!visitor?.getBoundingClientRect().width || !card.matches(':popover-open')) {
          throw Error('Reduced motion hid the opening animation on another member’s profile');
        }
        card.hidePopover();
        for (let i = 0; i < 120 && visitor.isConnected; i++) await new Promise(resolve => setTimeout(resolve, 25));
        if (!wasOpen) toggle.click();
        return !visitor.isConnected;
      })()`,
    });
    assert.equal(reducedMotionProfile.exceptionDetails, undefined, JSON.stringify(reducedMotionProfile.exceptionDetails));
    assert.equal(reducedMotionProfile.result.value, true, 'Closing the profile left its animation playing');
    await command('Emulation.setEmulatedMedia', { features: [] });
    const verification = await command('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        document.body.replaceChildren(Object.assign(document.createElement('div'), { id: 'app' }));
        let account = null;
        let sessionRevoked = false;
        const attempts = [];
        const token = 'a'.repeat(64);
        window.fetch = async (url, options) => {
          if (new URL(url, location.href).pathname.endsWith('/account.php')) {
            const request = options?.body ? JSON.parse(options.body) : {};
            if (['login', 'register', 'resendCode'].includes(request.action)) {
              attempts.push(request.action);
              return Response.json({ verification: { token, resendAfter: 0 } });
            }
            if (request.action === 'verifyCode') {
              if (request.code !== '012345' || request.token !== token) return Response.json({ error: 'Código incorreto' }, { status: 422 });
              account = { name: 'Teste', email: 'person@example.test', birthDate: '2000-01-01' };
            }
            if (request.action === 'logout') account = null;
            return Response.json({ account });
          }
          if (sessionRevoked && new URL(url, location.href).searchParams.has('members')) {
            return Response.json({ error: 'Sessão antiga' }, { status: 401 });
          }
          const params = new URL(url, location.href).searchParams;
          if (params.has('entrance') || params.get('server') === '1') {
            return Response.json({ id: 1, name: 'Discordo Brasil', lobby: true, permissions: 0, roles: [],
              members: [{ id: 1, userId: 1, name: 'Teste', self: true, roles: [] }],
              channels: [{ id: 14, name: 'Resenha', type: 'VOZ' }] });
          }
          return Response.json({ members: [], channels: [], servers: [] });
        };
        const wait = async selector => {
          for (let i = 0; i < 120; i++) {
            const element = document.querySelector(selector);
            if (element) return element;
            await new Promise(resolve => setTimeout(resolve, 25));
          }
          throw new Error('Missing ' + selector);
        };
        await import('/src/main.ts?verification-test');
        await wait('#email');
        document.querySelector('[data-mode=register]').click();
        document.querySelector('#email').value = 'person@example.test';
        document.querySelector('#name').value = 'Teste';
        document.querySelector('#password').value = 'test-password';
        document.querySelector('#birth-date').value = '2000-01-01';
        document.querySelector('.auth-form').requestSubmit();
        const input = await wait('#verification-code');
        if (document.querySelector('.workspace')) throw Error('Registration opened before verification');
        document.querySelector('[data-resend-code]').click();
        await wait('[role=status]:not([hidden])');
        input.value = '000000';
        input.form.requestSubmit();
        for (let i = 0; i < 120 && document.querySelector('.form-message')?.textContent !== 'Código incorreto'; i++) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (document.querySelector('.form-message').textContent !== 'Código incorreto') throw Error('The verification error was not displayed');
        input.value = '012345';
        input.form.requestSubmit();
        await wait('[data-voice-room="channel-14"]');
        if (document.querySelector('[data-voice-room="local-video-demo"]')) throw Error('The simulated room appeared for a non-creator');
        window.dispatchEvent(new StorageEvent('storage', { key: 'discordo:session-changed' }));
        await new Promise(resolve => setTimeout(resolve, 100));
        if (document.querySelector('#verification-code')) throw Error('An active session required another code');
        (await wait('[data-action=switch]')).click();
        (await wait('#email')).value = 'person@example.test';
        document.querySelector('#password').value = 'test-password';
        document.querySelector('.auth-form').requestSubmit();
        const loginCode = await wait('#verification-code');
        if (document.querySelector('.workspace')) throw Error('Login opened before verification');
        loginCode.value = '012345';
        loginCode.form.requestSubmit();
        await wait('.workspace');
        sessionRevoked = true;
        window.dispatchEvent(new Event('focus'));
        const email = await wait('#email');
        if (email.value !== 'person@example.test' || document.querySelector('.workspace')) {
          throw Error('The old session did not return to login');
        }
        return attempts;
      })()`,
    });
    assert.equal(verification.exceptionDetails, undefined, JSON.stringify(verification.exceptionDetails));
    assert.deepEqual(verification.result.value, ['register', 'resendCode', 'login']);
  } finally {
    socket?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const exited = new Promise(resolve => chrome.once('exit', resolve));
      chrome.kill();
      await exited;
    }
    await server.close();
    assert.ok(path.resolve(profile).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
