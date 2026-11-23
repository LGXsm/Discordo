import assert from 'node:assert/strict';
import { launchTestChrome } from './browser-chrome.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';

test('The gallery shows simultaneous screens and cameras with independent screen audio', { timeout: 40000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'discordo-screen-test-'));
  const server = await createServer({ server: { port: 0 }, logLevel: 'silent' });
  server.middlewares.use('/rnnoise-test', (_request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Screen audio regression</title>');
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
    await command('Runtime.enable');
    await command('Runtime.addBinding', { name: 'moveTestMouse' });
    socket.addEventListener('message', async event => {
      const { method, params } = JSON.parse(event.data);
      if (method !== 'Runtime.bindingCalled' || params.name !== 'moveTestMouse') return;
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...JSON.parse(params.payload) });
      await command('Runtime.evaluate', { expression: 'window.testMouseMoved()' });
    });
    await command('Page.navigate', { url: `${origin}rnnoise-test` });
    await command('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 500));
    const evaluation = await command('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        await import('/src/style.css');
        const ui = await import('/src/voice-ui.ts');
        const workspace = document.createElement('main');
        workspace.innerHTML = ui.voiceStageMarkup + ui.voiceDockMarkup + ui.voiceAccountControlsMarkup + '<span data-account-voice-status></span>';
        document.body.append(workspace);
        const context = new AudioContext();
        const first = context.createMediaStreamDestination().stream;
        const second = context.createMediaStreamDestination().stream;
        const thumbnailCanvas = document.createElement('canvas');
        const thumbnailStream = thumbnailCanvas.captureStream(1);
        const call = ui.createVoiceCall();
        call.watching = true;
        const subscriptions = [];
        call.session = {
          state: 'connected', room: 'voice', self: { id: 'self', name: 'Você' },
          microphone: { available: true, configure() {} }, deafened: false,
          peers: new Map([
            ['a', { member: { id: 'a', userId: 1, name: 'Ana', sharing: true, sharingAudio: true, cameraOn: true }, screenAudio: first, video: thumbnailStream, camera: thumbnailStream, connection: {} }],
            ['b', { member: { id: 'b', name: 'Bia', sharing: true, sharingAudio: true }, screenAudio: second, video: thumbnailStream, connection: {} }],
            ['c', { member: { id: 'c', name: 'Caio', cameraOn: true }, camera: thumbnailStream, connection: {} }],
            ['d', { member: { id: 'd', name: 'Duda', sharing: true }, video: thumbnailStream, connection: {} }],
            ['e', { member: { id: 'e', name: 'Eli', sharing: true }, video: thumbnailStream, connection: {} }],
            ['f', { member: { id: 'f', name: 'Fábio', sharing: true }, video: thumbnailStream, connection: {} }],
          ]), leave() {}, setWatchingScreen(id, watching) { subscriptions.push([id, watching]); },
        };
        const preferences = { input: '', output: '', inputVolume: 100, outputVolume: 100, noiseSuppression: true };
        const mounted = ui.mountVoice(call, workspace, () => 'Você', preferences, () => {}, () => {}, []);
        const allTiles = [...workspace.querySelectorAll('[data-screen-tile]')];
        const tiles = allTiles.filter(tile => tile.querySelector('[data-screen-volume-controls]:not([hidden], [data-audio-unavailable])'));
        const ranges = tiles.map(tile => tile.querySelector('[data-screen-volume]'));
        const sounds = tiles.map(tile => tile.querySelector('[data-screen-sound]'));
        const audio = tiles.map(tile => tile.querySelector('audio'));
        const setVolume = (index, value) => {
          ranges[index].value = value;
          ranges[index].dispatchEvent(new Event('input'));
        };
        const check = (condition, message) => { if (!condition) throw new Error(message); };
        const moveMouse = (x, y) => new Promise(resolve => {
          window.testMouseMoved = resolve;
          window.moveTestMouse(JSON.stringify({ x, y }));
        });
        workspace.querySelector('.voice-dock').style.width = '232px';
        const cameraButton = workspace.querySelector('[data-dock-camera]');
        const screenButton = workspace.querySelector('[data-dock-screen]');
        const watchButton = workspace.querySelector('[data-voice-watch]');
        check(cameraButton.querySelector('svg') && !cameraButton.textContent.trim()
          && cameraButton.getAttribute('aria-label') === 'Ligar câmera', 'The camera should be icon-only and accessible');
        check(cameraButton.offsetLeft < screenButton.offsetLeft && screenButton.offsetWidth > cameraButton.offsetWidth
          && watchButton.offsetWidth > cameraButton.offsetWidth, 'The camera took space from the video controls');
        const stage = workspace.querySelector('.voice-stage');
        const main = stage.querySelector('.voice-main-feed');
        const previews = stage.querySelector('.voice-video-previews');
        const cameras = stage.querySelector('.voice-camera-previews');
        const toggle = stage.querySelector('[data-toggle-previews]');
        const toggleCameras = stage.querySelector('[data-toggle-cameras]');
        const closeScreen = main.querySelector('[data-feed-close]');
        const handles = [toggle, toggleCameras, closeScreen, main.querySelector('.voice-feed-actions')];
        const panelHandlesVisible = () => handles.every(button => getComputedStyle(button).opacity === '1');
        const finishHandleTransitions = () => {
          for (const button of handles) {
            getComputedStyle(button).opacity;
            for (const transition of button.getAnimations()) transition.finish();
          }
        };
        check(!panelHandlesVisible(), 'Panel handles were visible before moving the mouse');
        main.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }));
        finishHandleTransitions();
        check(panelHandlesVisible(), 'Moving the mouse did not reveal the panel handles');
        for (let i = 0; i < 60 && stage.hasAttribute('data-show-panel-handles'); i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        getComputedStyle(toggle).opacity;
        const [fade] = toggle.getAnimations();
        check(fade, 'Panel handles did not fade after mouse inactivity');
        fade.currentTime = 200;
        const fading = Number(getComputedStyle(toggle).opacity);
        check(fading > 0 && fading < 1, 'Panel handles disappeared without a fade');
        finishHandleTransitions();
        check(handles.every(button => getComputedStyle(button).opacity === '0'), 'A control stayed visible after mouse inactivity');
        main.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }));
        finishHandleTransitions();
        check(panelHandlesVisible(), 'The panel handles did not reappear after inactivity');
        stage.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
        check(!stage.hasAttribute('data-show-panel-handles'), 'Leaving the viewer kept the panel handles visible');
        const title = () => main.querySelector('[data-feed-name]').textContent;
        const findPreview = label => [...previews.children, ...cameras.children].find(tile => tile.querySelector('[data-feed-name]').textContent === label);
        const playing = () => [...stage.querySelectorAll('video')].filter(video => video.srcObject).length;
        check(title() === 'Tela de Ana' && previews.children.length === 4 && cameras.children.length === 2 && playing() === 6
          && findPreview('Tela de Fábio').hasAttribute('data-feed-placeholder'), 'The chosen feed or four-video cap was lost');
        Object.assign(stage.style, { width: '340px', maxWidth: '100%', height: '490px' });
        check(previews.scrollWidth > previews.clientWidth && stage.scrollWidth === stage.clientWidth,
          'Only the thumbnail strip should scroll horizontally');
        const wheel = (deltaY, options = {}) => previews.dispatchEvent(new WheelEvent('wheel',
          { deltaY, cancelable: true, ...options }));
        check(getComputedStyle(previews).scrollbarWidth === 'none', 'The thumbnail strip showed a scrollbar');
        check(!wheel(100) && previews.scrollLeft > 0, 'Scrolling down should move to the right');
        check(!wheel(-100) && previews.scrollLeft === 0, 'Scrolling up should move back to the left');
        check(wheel(100, { ctrlKey: true }) && wheel(100, { deltaX: 10 }) && previews.scrollLeft === 0,
          'Zoom or native horizontal scrolling should not be intercepted');
        const stripBounds = previews.getBoundingClientRect();
        const columnBounds = cameras.getBoundingClientRect();
        check(columnBounds.left >= stripBounds.right && Math.abs(columnBounds.bottom - stripBounds.bottom) < 1,
          'The camera column must fill the space beside the scrolling screen strip');
        check(previews.firstElementChild.getBoundingClientRect().left >= previews.getBoundingClientRect().left,
          'The first screen thumbnail must be reachable when the strip overflows');
        const primary = main.firstElementChild.getBoundingClientRect();
        const thumb = previews.firstElementChild.getBoundingClientRect();
        check(primary.width > thumb.width && primary.bottom <= thumb.top && cameras.getBoundingClientRect().left >= primary.right,
          'Screen thumbnails must sit below and cameras to the right of the main feed');
        stage.style.width = '1000px';
        const centered = () => {
          const left = previews.firstElementChild.getBoundingClientRect().left;
          const right = previews.lastElementChild.getBoundingClientRect().right;
          const featured = main.getBoundingClientRect();
          return Math.abs((left + right) / 2 - (featured.left + featured.right) / 2) < 1;
        };
        check(centered(), 'The thumbnail group should align with the main video when cameras are open');
        toggleCameras.click();
        check(centered(), 'The thumbnail group did not follow the main video when cameras were closed');
        toggleCameras.click();
        check(centered(), 'The thumbnail group did not follow the main video when cameras reopened');
        call.session.peers.delete('f');
        call.changed();
        check(centered(), 'The strip did not recenter when a screen left');
        call.session.peers.set('f', { member: { id: 'f', name: 'Fábio', sharing: true }, video: thumbnailStream, connection: {} });
        call.changed();
        check(centered(), 'The strip did not recenter when a screen joined');
        for (const width of ['340px', '820px']) {
          stage.style.width = width;
          const video = main.getBoundingClientRect();
          const cameraHandle = toggleCameras.parentElement.getBoundingClientRect();
          const screenHandle = toggle.parentElement.getBoundingClientRect();
          check(cameraHandle.left < video.right && cameraHandle.right > video.right
            && Math.abs((cameraHandle.top + cameraHandle.bottom - video.top - video.bottom) / 2) < 1
            && cameras.firstElementChild.getBoundingClientRect().left - cameraHandle.right >= 4,
            'The camera handle must overlap the main border with clear space before the cameras');
          check(screenHandle.top < video.bottom && screenHandle.bottom > video.bottom
            && Math.abs((screenHandle.left + screenHandle.right - video.left - video.right) / 2) < 1,
            'The bottom handle must overlap the center of the main border');
          check(previews.firstElementChild.getBoundingClientRect().top - video.bottom <= 10
            && getComputedStyle(cameras).borderLeftWidth === '0px', 'The old divider or large lower gap remained');
        }
        stage.style.height = '380px';
        const feedHeight = main.getBoundingClientRect().height;
        const stripHeight = previews.getBoundingClientRect().height;
        for (let index = 0; index < 8; index++) {
          const id = 'extra-camera-' + index;
          call.session.peers.set(id, { member: { id, name: id, cameraOn: true, sharing: true },
            camera: thumbnailStream, video: thumbnailStream, connection: {} });
        }
        call.changed();
        const lastPreview = previews.lastElementChild;
        previews.scrollLeft = previews.scrollWidth;
        const strip = previews.getBoundingClientRect();
        check(Math.abs(main.getBoundingClientRect().height - feedHeight) <= 2 && strip.height + 1 >= stripHeight
          && strip.bottom <= stage.getBoundingClientRect().bottom && lastPreview.getBoundingClientRect().bottom <= strip.bottom,
          'Adding many live cameras and screen shares must not grow the main feed or clip the thumbnail strip');
        previews.scrollLeft = 0;
        const cameraBounds = [...cameras.children].map(tile => tile.getBoundingClientRect());
        check(cameraBounds.length === 10 && cameras.scrollHeight > cameras.clientHeight
          && cameraBounds.every((bounds, index) => index === 0 || bounds.top >= cameraBounds[index - 1].bottom + 7),
          'Many camera tiles must stack without overlapping in a scrollable column');
        check(getComputedStyle(cameras).scrollbarWidth === 'none' && getComputedStyle(cameras).overflowY === 'auto',
          'Camera previews must scroll without showing a scrollbar');
        cameras.scrollTop = cameras.scrollHeight;
        check(cameras.scrollTop > 0
          && cameras.lastElementChild.getBoundingClientRect().bottom <= cameras.getBoundingClientRect().bottom + 1,
          'The last camera must remain reachable with the scrollbar hidden');
        cameras.scrollTop = 0;
        const shell = document.body.appendChild(document.createElement('div'));
        shell.className = 'workspace';
        shell.style.height = '380px';
        shell.innerHTML = '<nav class="server-rail"></nav><aside class="channel-panel"><header></header><div class="channel-list"><ul class="voice-channel-members"></ul></div><footer>Conta</footer></aside><section class="chat"></section>';
        const channelList = shell.querySelector('.channel-list');
        channelList.querySelector('ul').innerHTML = '<li>Bot</li>'.repeat(16);
        shell.querySelector('.chat').append(stage);
        stage.style.width = stage.style.height = '';
        check(previews.getBoundingClientRect().bottom <= shell.getBoundingClientRect().bottom
          && channelList.scrollHeight > channelList.clientHeight, 'A long participant list must scroll without pushing the screen previews outside the app');
        check(getComputedStyle(channelList).scrollbarWidth === 'thin'
          && getComputedStyle(shell.querySelector('.server-rail')).scrollbarWidth === 'thin'
          && getComputedStyle(channelList).transitionProperty.includes('--scrollbar-thumb'),
          'Sidebars should use the thin scrollbar with a smooth reveal');
        channelList.scrollTop = channelList.scrollHeight;
        check(channelList.scrollTop > 0
          && channelList.querySelector('li:last-child').getBoundingClientRect().bottom <= channelList.getBoundingClientRect().bottom + 1,
          'Hiding the channel list scrollbar kept the last participant out of reach');
        workspace.prepend(stage);
        shell.remove();
        for (let index = 0; index < 8; index++) call.session.peers.delete('extra-camera-' + index);
        call.changed();
        stage.style.height = '490px';
        stage.style.width = '340px';
        const fullscreen = main.querySelector('[data-feed-fullscreen]');
        main.firstElementChild.requestFullscreen = async () => { throw Error('Native fullscreen unavailable'); };
        fullscreen.click();
        await new Promise(resolve => setTimeout(resolve, 0));
        check(main.firstElementChild.hasAttribute('data-video-expanded') && fullscreen.getAttribute('aria-label') === 'Sair da tela cheia',
          'Fullscreen had no fallback');
        fullscreen.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        check(!main.firstElementChild.hasAttribute('data-video-expanded'), 'Escape did not close fullscreen');
        const silent = allTiles.find(tile => tile.querySelector('[data-feed-name]').textContent === 'Tela de Duda');
        const silentControls = silent.querySelector('[data-screen-volume-controls]');
        check(!silentControls.hidden && silentControls.hasAttribute('data-audio-unavailable')
          && silentControls.querySelector('[data-screen-sound]:disabled').getAttribute('aria-label') === 'Transmissão sem áudio',
          'A live screen without audio lost its audio control');
        check(audio.length === 2 && audio.every(item => !item.muted)
          && sounds.every(button => button.getAttribute('aria-label') === 'Silenciar áudio da transmissão'),
          'Every new screen that carries audio should start unmuted');
        const sliderPanel = ranges[0].closest('.voice-screen-volume');
        document.activeElement?.blur();
        sounds[0].scrollIntoView({ block: 'center' });
        check(getComputedStyle(sliderPanel).visibility === 'hidden', 'The volume slider opened before interaction');
        const collapsedSound = sounds[0].getBoundingClientRect();
        const collapsedMenu = sliderPanel.parentElement.getBoundingClientRect();
        await moveMouse(collapsedSound.left - 8, collapsedSound.top + collapsedSound.height / 2);
        await moveMouse(collapsedSound.left + collapsedSound.width / 2, collapsedSound.top + collapsedSound.height / 2);
        check(getComputedStyle(sliderPanel).visibility === 'visible' && !audio[0].muted,
          'Opening the volume slider changed mute state or did not expose the slider');
        await Promise.all(sliderPanel.parentElement.getAnimations().map(animation => animation.finished));
        const expandedSound = sounds[0].getBoundingClientRect();
        const expandedMenu = sliderPanel.parentElement.getBoundingClientRect();
        check(expandedSound.left < collapsedSound.left && expandedMenu.right === collapsedMenu.right
          && Math.abs(expandedSound.top - ranges[0].getBoundingClientRect().top) < expandedSound.height / 2,
          'The volume control did not expand leftward into an inline slider');
        await moveMouse(0, 0);
        await Promise.all(sliderPanel.getAnimations().map(animation => animation.finished));
        check(getComputedStyle(sliderPanel).visibility === 'hidden', 'The slider stayed open after the mouse left');
        setVolume(0, '35');
        setVolume(1, '70');
        check(audio[0].volume === .35 && audio[1].volume === .7, 'Volumes are not independent');
        sounds[0].click();
        check(audio[0].muted && !audio[1].muted, 'Muting the first stream affected the second');
        setVolume(0, '45');
        check(audio[0].muted && audio[0].volume === .45, 'Changing volume cleared an explicit mute');
        setVolume(0, '35');
        sounds[0].click();
        check(!audio[0].muted && audio[0].volume === .35, 'Unmuting lost the selected volume');
        setVolume(1, '0');
        check(audio[1].muted && !audio[0].muted, 'Zero volume did not mute only the selected stream');
        sounds[1].click();
        check(!audio[1].muted && audio[1].volume === 1, 'Muted stream could not be restored');
        mounted.configure({ ...preferences, outputVolume: 50 });
        check(audio[0].volume === .175 && audio[1].volume === .5, 'Master volume was not respected');
        call.session.deafened = true;
        call.changed();
        check(audio.every(item => item.muted), 'Deafen did not silence the streams');
        call.session.deafened = false;
        call.changed();
        const thirdCamera = call.session.peers.get('b');
        thirdCamera.member.cameraOn = true;
        thirdCamera.camera = thumbnailStream;
        call.changed();
        const cameraVideos = [...cameras.querySelectorAll('video')];
        check(cameraVideos.length === 3 && cameraVideos.every(video => video.srcObject === thumbnailStream),
          'Three cameras should play alongside four screens');
        const fabio = findPreview('Tela de Fábio');
        fabio.querySelector('[data-feed-select]').click();
        check(main.firstElementChild === fabio && title() === 'Tela de Fábio'
          && fabio.querySelector('video').srcObject === thumbnailStream && playing() === 7, 'Clicking a placeholder did not play that transmission');
        check(cameraVideos.every(video => cameras.contains(video) && video.srcObject === thumbnailStream),
          'Switching the screen share blanked a camera');
        findPreview('Câmera de Ana').querySelector('[data-feed-select]').click();
        check(title() === 'Câmera de Ana' && main.querySelector('[data-screen-volume-controls]').hidden
          && cameras.querySelectorAll('[data-screen-volume-controls]:not([hidden])').length === 0,
          'A camera exposed the screen-audio controls');
        toggle.click();
        check(previews.hidden && previews.children.length === 0 && title() === 'Câmera de Ana' && playing() === 3,
          'Hiding screens affected the cameras');
        toggleCameras.click();
        check(cameras.hidden && cameras.children.length === 0 && playing() === 1, 'Hiding cameras affected the main feed');
        toggleCameras.click();
        toggle.click();
        check(!previews.hidden && previews.children.length === 5 && cameras.children.length === 2, 'The preview panels did not reopen');
        findPreview('Tela de Ana').querySelector('[data-feed-select]').click();
        check(main.querySelector('[data-screen-volume]').value === '35', 'Switching lost the screen volume');
        stage.style.width = '1000px';
        findPreview('Tela de Fábio').querySelector('[data-feed-select]').click();
        const maximizeScreens = stage.querySelector('[data-maximize-screens]');
        const maximizeCameras = stage.querySelector('[data-maximize-cameras]');
        const gallery = main.querySelector('.voice-feed-gallery');
        const galleryVideosLive = () => [...gallery.querySelectorAll('video')].every(video => video.srcObject === thumbnailStream);
        const equalTiles = () => {
          const [first, ...rest] = [...gallery.children].map(tile => tile.getBoundingClientRect());
          return rest.every(tile => Math.abs(tile.width - first.width) < 1 && Math.abs(tile.height - first.height) < 1);
        };
        const galleryRows = () => {
          const rows = [];
          for (const tile of gallery.children) {
            const bounds = tile.getBoundingClientRect();
            if (!rows.length || Math.abs(rows.at(-1)[0].top - bounds.top) > 1) rows.push([]);
            rows.at(-1).push(bounds);
          }
          return rows;
        };
        const centeredRows = rows => {
          const center = gallery.getBoundingClientRect().left + gallery.clientWidth / 2;
          return rows.every(row => Math.abs((row[0].left + row.at(-1).right) / 2 - center) < 1);
        };
        const arrow = button => button.querySelector('svg path').getAttribute('d');
        check(arrow(maximizeScreens) === arrow(toggle) && arrow(maximizeCameras) === arrow(toggleCameras)
          && getComputedStyle(maximizeScreens.querySelector('svg')).transform !== getComputedStyle(toggle.querySelector('svg')).transform
          && getComputedStyle(maximizeCameras.querySelector('svg')).transform !== getComputedStyle(toggleCameras.querySelector('svg')).transform,
          'Maximize buttons should use chevrons facing away from their collapse controls');
        maximizeScreens.click();
        check(stage.dataset.gallery === 'screens' && gallery.children.length === 5 && galleryVideosLive() && equalTiles()
          && maximizeScreens.getAttribute('aria-pressed') === 'true', 'Maximizing screens should play all screen shares at the same size');
        const originalScreens = [...call.session.peers.values()].filter(peer => peer.member.sharing);
        const templates = [[1], [2], [2, 1], [2, 2], [3, 2], [3, 3], [3, 3, 1], [3, 3, 2]];
        for (const [index, expected] of templates.entries()) {
          const count = index + 1;
          originalScreens.forEach((peer, position) => { peer.member.sharing = position < count; });
          for (let extra = 0; extra < 3; extra++) {
            const id = 'layout-screen-' + extra;
            if (extra < count - originalScreens.length) {
              call.session.peers.set(id, { member: { id, name: id, sharing: true }, video: thumbnailStream, connection: {} });
            } else call.session.peers.delete(id);
          }
          call.changed();
          const rows = galleryRows();
          check(rows.map(row => row.length).join() === expected.join() && centeredRows(rows) && equalTiles(),
            'Unexpected maximized layout for ' + count + ' screens');
        }
        stage.style.height = '650px';
        for (let extra = 3; extra < 6; extra++) {
          const id = 'layout-screen-' + extra;
          call.session.peers.set(id, { member: { id, name: id, sharing: true }, video: thumbnailStream, connection: {} });
        }
        call.changed();
        const viewport = gallery.getBoundingClientRect();
        check(gallery.children.length === 11 && gallery.scrollHeight > gallery.clientHeight
          && viewport.bottom <= main.getBoundingClientRect().bottom + 1,
          'The maximized grid must stay inside the viewer and scroll past nine streams');
        check(getComputedStyle(gallery).overflowY === 'auto' && getComputedStyle(gallery).scrollbarWidth === 'none',
          'The grid must allow scrolling without a visible scrollbar');
        gallery.scrollTop = gallery.scrollHeight;
        const lastTile = gallery.lastElementChild.getBoundingClientRect();
        check(gallery.scrollTop > 0 && lastTile.bottom <= viewport.bottom + 1 && lastTile.top >= viewport.top - 1,
          'Scrolling must make the last stream fully visible');
        gallery.scrollTop = 0;
        stage.style.height = '490px';
        originalScreens.forEach(peer => { peer.member.sharing = true; });
        for (let extra = 0; extra < 6; extra++) call.session.peers.delete('layout-screen-' + extra);
        call.changed();
        maximizeScreens.click();
        findPreview('Tela de Fábio').querySelector('[data-feed-select]').click();
        maximizeScreens.click();
        maximizeCameras.click();
        check(stage.dataset.gallery === 'cameras' && gallery.children.length === 3 && galleryVideosLive() && equalTiles()
          && galleryRows().map(row => row.length).join() === '2,1' && centeredRows(galleryRows())
          && maximizeScreens.getAttribute('aria-pressed') === 'false' && maximizeCameras.getAttribute('aria-pressed') === 'true',
          'Maximizing cameras should replace the screen grid');
        check(previews.children.length === 5 && previews.firstElementChild.querySelector('[data-feed-name]').textContent === 'Tela de Fábio'
          && previews.firstElementChild.querySelector('video').srcObject === thumbnailStream,
          'The previous featured screen must join the strip while cameras are maximized');
        maximizeCameras.click();
        check(gallery.hidden && stage.dataset.gallery === '' && title() === 'Tela de Fábio', 'Returning should restore the selected screen');
        findPreview('Tela de Ana').querySelector('[data-feed-select]').click();
        main.querySelector('[data-feed-close]').click();
        const closed = findPreview('Tela de Ana');
        check(title() === 'Tela de Bia' && closed && closed.querySelector('[data-feed-select]').textContent.trim() === 'Assistir'
          && !closed.querySelector('video').srcObject && !closed.querySelector('audio').srcObject
          && closed.querySelector('[data-feed-close]').hidden, 'Closing the main screen did not leave a stopped placeholder');
        check(cameras.querySelector('video').srcObject === thumbnailStream, 'Closing a screen stopped a camera');
        maximizeScreens.click();
        check(![...gallery.querySelectorAll('[data-feed-name]')].some(name => name.textContent === 'Tela de Ana'),
          'The gallery resumed a closed screen');
        closed.querySelector('[data-feed-select]').click();
        check(title() === 'Tela de Ana' && main.querySelector('video').srcObject === thumbnailStream
          && JSON.stringify(subscriptions) === JSON.stringify([['a', false], ['a', true]]),
          'Watch did not resume only the selected screen');
        call.session.peers.delete('a');
        call.changed();
        check(title() === 'Tela de Bia', 'The main feed did not recover when the presenter left');
        const { demoRoom } = await import('/src/voice-demo.ts');
        call.session.room = demoRoom;
        call.session.peers.clear();
        call.session.demoPeers = [{
          member: { id: 'bot', name: 'Bot 1', sharing: true, cameraOn: true, muted: true },
          video: thumbnailStream, camera: thumbnailStream,
        }];
        call.changed();
        const demoSound = main.querySelector('[data-screen-sound]');
        const demoVolume = main.querySelector('[data-screen-volume]');
        const demoPlayer = main.querySelector('audio');
        check(title() === 'Tela de Bot 1' && !demoSound.disabled
          && demoSound.getAttribute('aria-pressed') === 'true' && demoPlayer.srcObject === null,
          'The simulated screen did not start with an enabled, unmuted control and no audio stream');
        demoSound.scrollIntoView({ block: 'center' });
        const demoButton = demoSound.getBoundingClientRect();
        await moveMouse(demoButton.left - 8, demoButton.top + demoButton.height / 2);
        await moveMouse(demoButton.left + demoButton.width / 2, demoButton.top + demoButton.height / 2);
        check(getComputedStyle(demoVolume.closest('.voice-screen-volume')).visibility === 'visible',
          'The simulated volume slider did not open');
        demoVolume.value = '45';
        demoVolume.dispatchEvent(new Event('input'));
        demoSound.click();
        check(demoSound.getAttribute('aria-pressed') === 'false', 'The simulated screen could not be muted');
        demoSound.click();
        check(demoSound.getAttribute('aria-pressed') === 'true' && demoVolume.value === '45'
          && demoPlayer.srcObject === null, 'The simulated screen did not restore its volume while remaining silent');
        check(cameras.querySelector('[data-screen-volume-controls]').hidden, 'The simulated camera exposed audio controls');
        mounted.dispose();
        first.getTracks().forEach(track => track.stop());
        second.getTracks().forEach(track => track.stop());
        thumbnailStream.getTracks().forEach(track => track.stop());
        await context.close();
        const { VoiceSession } = await import('/src/voice-session.ts');
        const warningCall = ui.createVoiceCall();
        const warningSession = new VoiceSession('warning-test', 'Ana', preferences,
          { muted: false, deafened: false }, () => warningCall.changed?.(), () => {});
        warningSession.state = 'connected';
        warningSession.self = { id: 'warning-self', name: 'Ana', muted: false, sharing: false };
        warningCall.session = warningSession;
        const speakingSidebar = workspace.appendChild(document.createElement('ul'));
        speakingSidebar.className = 'voice-channel-members';
        speakingSidebar.dataset.voiceMembers = warningSession.room;
        const warningUI = ui.mountVoice(warningCall, workspace, () => 'Ana', preferences, () => {}, () => {}, []);
        const displayBeforeWarning = navigator.mediaDevices.getDisplayMedia;
        navigator.mediaDevices.getDisplayMedia = async () => document.createElement('canvas').captureStream(1);
        const warningText = () => workspace.querySelector('.voice-notice').textContent;
        try {
          await warningSession.toggleScreen();
          check(warningText().includes('sem áudio'), 'A silent share did not show its audio warning');
          await warningSession.toggleScreen();
          check(!warningSession.screen && !warningSession.self.sharing && !warningSession.notice
            && !warningText().includes('sem áudio'), 'Stopping via the screen button left the audio warning visible');
          await warningSession.toggleScreen();
          const endedVideo = warningSession.screen.getVideoTracks()[0];
          endedVideo.stop();
          endedVideo.dispatchEvent(new Event('ended'));
          check(!warningSession.screen && !warningSession.notice && !warningText().includes('sem áudio'),
            'Stopping via the browser left the audio warning visible');
          await warningSession.toggleScreen();
          warningSession.notice = 'A câmera não está disponível neste navegador.';
          await warningSession.toggleScreen();
          check(warningSession.notice.includes('câmera'), 'Stopping a screen cleared an unrelated notice');
          navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('Canceled', 'NotAllowedError'); };
          await warningSession.toggleScreen();
          check(warningText().includes('Compartilhamento cancelado'), 'Share cleanup hid the capture permission error');
          const input = new AudioContext();
          const tone = input.createOscillator();
          const level = input.createGain();
          level.gain.value = 0;
          const microphone = input.createMediaStreamDestination();
          tone.connect(level).connect(microphone);
          tone.start();
          await input.resume();
          const speaking = () => Boolean(speakingSidebar.querySelector('.voice-avatar-speaking'));
          async function expectSpeaking(expected) {
            for (let attempt = 0; attempt < 30 && speaking() !== expected; attempt++) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
            check(speaking() === expected, 'Microphone activity ring has the wrong state');
          }
          try {
            navigator.mediaDevices.getDisplayMedia = async () => {
              const stream = document.createElement('canvas').captureStream(1);
              stream.addTrack(microphone.stream.getAudioTracks()[0].clone());
              return stream;
            };
            level.gain.value = 0.25;
            await warningSession.toggleScreen();
            await new Promise(resolve => setTimeout(resolve, 300));
            check(!speaking(), 'Screen audio was treated as microphone activity');
            await warningSession.toggleScreen();
            warningSession.microphone.stream = microphone.stream;
            warningCall.changed();
            await expectSpeaking(true);
            level.gain.value = 0;
            await expectSpeaking(false);
            level.gain.value = 0.25;
            await expectSpeaking(true);
            warningSession.toggleMicrophone();
            check(!speaking(), 'Muting did not clear the activity ring immediately');
          } finally {
            tone.stop();
            await input.close();
          }

        } finally {
          navigator.mediaDevices.getDisplayMedia = displayBeforeWarning;
          warningUI.dispose();
        }
        const flags = { muted: false, deafened: false };
        const sender = new VoiceSession('test', 'Ana', preferences, flags, () => {}, () => {});
        const receiver = new VoiceSession('test', 'Bia', preferences, flags, () => {}, () => {});
        const ana = { id: 'sender', name: 'Ana', muted: true, sharing: false, screenAudioCapable: true, cameraCapable: true };
        const bia = { ...ana, id: 'receiver', name: 'Bia' };
        const swapMessages = (from, to, member) => {
          from.send = message => queueMicrotask(() => {
            if (['signal', 'screen-subscription'].includes(message.type)) to.receive({ ...message, from: member.id });
            if (message.type === 'state') to.receive({ type: 'state', member: { ...member, ...message } });
          });
        };
        swapMessages(sender, receiver, ana);
        swapMessages(receiver, sender, bia);
        receiver.receive({ type: 'welcome', self: bia, members: [], iceServers: [] });
        receiver.receive({ type: 'joined', member: ana });
        sender.receive({ type: 'welcome', self: ana, members: [bia], iceServers: [] });
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 48;
        const paint = canvas.getContext('2d');
        const screen = canvas.captureStream(15);
        const sharingAudio = new AudioContext();
        await sharingAudio.resume();
        const screenTone = sharingAudio.createOscillator();
        const sharedAudio = sharingAudio.createMediaStreamDestination();
        screenTone.connect(sharedAudio);
        screenTone.start();
        screen.addTrack(sharedAudio.stream.getAudioTracks()[0]);
        let frame = 0;
        const frames = setInterval(() => {
          paint.fillStyle = frame++ % 2 ? 'blue' : 'yellow';
          paint.fillRect(0, 0, canvas.width, canvas.height);
        }, 66);
        const getDisplayMedia = navigator.mediaDevices.getDisplayMedia;
        navigator.mediaDevices.getDisplayMedia = async () => screen;
        const brokenPeer = new RTCPeerConnection();
        sender.peers.set('broken', {
          member: { id: 'broken', name: 'Broken' }, connection: brokenPeer, queue: Promise.resolve(),
          screenSender: { replaceTrack: async () => { throw Error('Simulated recipient failure'); } },
        });
        try {
          await sender.toggleCamera();
          await sender.toggleScreen();
          const captured = sender.camera.getVideoTracks()[0];
          const peer = receiver.peers.get(ana.id);
          for (let i = 0; i < 160 && (peer.camera?.getVideoTracks()[0]?.muted !== false || peer.video?.getVideoTracks()[0]?.muted !== false); i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          check(sender.screen === screen, 'A single failing recipient cut off the screen for everyone');
          check(peer.member.cameraOn && peer.member.sharing && peer.camera.getVideoTracks()[0].muted === false
            && peer.video.getVideoTracks()[0].muted === false && peer.camera !== peer.video, 'Camera and screen did not arrive as two live tracks');
          const outbound = sender.peers.get(bia.id);
          const videoTrack = screen.getVideoTracks()[0];
          const soundTrack = screen.getAudioTracks()[0];
          check(outbound.screenSender.track === videoTrack && outbound.screenAudioSender.track === soundTrack, 'The share was not transmitting video and audio');
          receiver.setWatchingScreen(ana.id, false);
          await Promise.resolve();
          await outbound.queue;
          check(outbound.screenSender.track === null && outbound.screenAudioSender.track === null
            && outbound.cameraSender.track === captured && videoTrack.readyState === 'live',
            'Closing one subscription did not stop both outbound tracks for only that viewer');
          receiver.setWatchingScreen(ana.id, true);
          await Promise.resolve();
          await outbound.queue;
          check(outbound.screenSender.track === videoTrack && outbound.screenAudioSender.track === soundTrack,
            'Watching again did not restore both outbound tracks');
          await sender.toggleCamera();
          await new Promise(resolve => setTimeout(resolve, 0));
          check(captured.readyState === 'ended' && !peer.member.cameraOn && peer.member.sharing
            && peer.video.getVideoTracks()[0].muted === false, 'Stopping the camera disrupted the live screen');
        } finally {
          navigator.mediaDevices.getDisplayMedia = getDisplayMedia;
          clearInterval(frames);
          sender.leave();
          receiver.leave();
          screen.getTracks().forEach(track => track.stop());
          screenTone.stop();
          await sharingAudio.close();
        }
        const creator = new VoiceSession(demoRoom, 'Ana', preferences, flags, () => {}, () => {});
        const guest = new VoiceSession(demoRoom, 'Bia', preferences, flags, () => {}, () => {});
        const demoAudio = new AudioContext();
        await demoAudio.resume();
        const tone = demoAudio.createOscillator();
        const creatorSource = demoAudio.createMediaStreamDestination();
        const guestSource = demoAudio.createMediaStreamDestination();
        tone.connect(creatorSource);
        tone.connect(guestSource);
        tone.start();
        creator.microphone.stream = creatorSource.stream;
        guest.microphone.stream = guestSource.stream;
        swapMessages(creator, guest, ana);
        swapMessages(guest, creator, bia);
        try {
          creator.receive({ type: 'welcome', self: ana, members: [], iceServers: [], demoHost: true });
          creator.receive({ type: 'joined', member: bia });
          guest.receive({ type: 'welcome', self: bia, members: [ana], iceServers: [], demoHost: false });
          const hostToGuest = guest.peers.get(ana.id);
          const guestToHost = creator.peers.get(bia.id);
          for (let i = 0; i < 160 && [hostToGuest, guestToHost].some(peer => peer.audio?.getAudioTracks()[0]?.muted !== false); i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          for (const peer of [hostToGuest, guestToHost]) {
            check(peer.audio?.getAudioTracks()[0]?.muted === false && peer.connection.getTransceivers().length === 1,
              'The demo did not negotiate a live microphone-only connection in each direction: '
              + JSON.stringify({ state: peer.connection.connectionState, signaling: peer.connection.signalingState,
                failed: peer.failed, transceivers: peer.connection.getTransceivers().length, muted: peer.audio?.getAudioTracks()[0]?.muted }));
          }
          await guest.toggleCamera();
          await guest.toggleScreen();
          check(!guest.camera && !guest.screen, 'The demo guest enabled real video');
        } finally {
          creator.leave();
          guest.leave();
          tone.stop();
          await demoAudio.close();
        }
        return { independent: true, mute: true, masterVolume: true, camera: true, demoAudio: true };
      })()`,
    });
    assert.equal(evaluation.exceptionDetails, undefined, JSON.stringify(evaluation.exceptionDetails));
    assert.deepEqual(evaluation.result.value, { independent: true, mute: true, masterVolume: true, camera: true, demoAudio: true });
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
