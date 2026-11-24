import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { launchTestChrome } from './browser-chrome.mjs';

test('Settings and channel features stay in the selected server across reloads', { timeout: 45000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'discordo-servers-test-'));
  const account = { name: 'Player', email: 'player@example.test', birthDate: '2000-01-01' };
  const fixture = (id, name, lobby) => ({
    id, name, lobby, admin: true, hasIcon: false, permissions: 255, invite: 'test',
    roles: [{ id: id * 10 + 1, name: 'Jogador', permissions: 0, position: 0 },
      { id: id * 10 + 2, name: 'Capitão', permissions: 4, position: 1 }],
    members: [{ id: id * 100 + 1, userId: 1, name: 'Player', self: true, title: lobby ? 'Criador' : 'ADM', roles: [] },
      { id: id * 100 + 2, userId: id + 1, name: lobby ? 'Membro do Brasil' : 'Membro da guilda', self: false, title: null, roles: [] }],
    channels: [{ id: id * 10 + 1, name: 'geral', type: 'TEXTO' }, { id: id * 10 + 2, name: 'partidas', type: 'TEXTO' },
      { id: id * 10 + 3, name: 'Resenha', type: 'VOZ', userLimit: null }],
  });
  const entrance = fixture(1, 'Discordo Brasil', true);
  const guild = fixture(29, 'Guilda', false);
  guild.members[1].bannerUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  guild.members[1].roles = [guild.roles[0]];
  guild.members[1].appearance = {
    theme: 'personalizado',
    colors: { mode: 'gradient', primary: '#000000', secondary: '#420000', direction: 'vertical' },
  };
  guild.roles[1].color = '#0020BC';
  guild.reservedRoles = [{ title: 'ADM', color: null }];
  const servers = new Map([[entrance.id, entrance], [guild.id, guild]]);
  const writes = [];
  const chatMessages = new Map();
  const chatDeletes = [];
  const chatUploads = [];
  const visits = [];
  const invitation = 'a'.repeat(48);
  const expired = 'b'.repeat(48);
  const guestInvitation = 'd'.repeat(48);
  let signedIn = true;
  const friendsFixture = [
    { id: 2, name: 'Ana', status: 'received', room: 'friend-12',
      bannerUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
    { id: 3, name: 'Bruno', status: null },
    { id: 30, name: 'Membro da guilda', status: null },
    { id: 35, name: 'Carla', status: 'friend' },
    { id: 36, name: 'Davi', status: 'received' },
  ];
  const directMessages = [];
  const profileInvites = [];
  const privateVoiceRequests = [];
  let returningToVerifiedAccount = false;
  let accountSessions = [{ id: 1, current: true }, { id: 2, current: false }];
  let joinedInvite = false;
  let acceptCount = 0;
  let wrongResponse = true;
  let guildUnavailable = false;
  const vite = await createServer({ server: { port: 0 }, logLevel: 'silent', plugins: [{
    name: 'multi-server-fixture',
    configureServer(server) {
      const reply = (response, value, status = 200) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      server.middlewares.use('/account.php', async (request, response) => {
        if (request.method !== 'POST') return reply(response, { account: signedIn ? account : null });
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { action, sessionId, email, password, acceptTrustedDevice } = JSON.parse(Buffer.concat(chunks));
        if (action === 'accountDetails') return reply(response, { phone: '+5511987654321', sessions: accountSessions });
        if (action === 'revokeAccountSession' && sessionId === 2) {
          accountSessions = accountSessions.filter(session => session.id !== sessionId);
          return reply(response, { saved: true });
        }
        if (action === 'logout') {
          signedIn = false;
          return reply(response, { account: null });
        }
        if (action === 'login' && returningToVerifiedAccount && email === account.email && acceptTrustedDevice) {
          if (password !== 'senha-valida') return reply(response, { error: 'O e-mail ou a senha não confere.' }, 401);
          signedIn = true;
          return reply(response, { account });
        }
        if (action === 'login' || action === 'register') return reply(response, { verification: { token: 'c'.repeat(64), resendAfter: 60 } });
        if (action === 'verifyCode') {
          signedIn = true;
          return reply(response, { account });
        }
        return reply(response, { error: 'Unexpected account action' }, 422);
      });
      server.middlewares.use('/friends.php', async (request, response) => {
        const params = new URL(request.url, 'http://localhost').searchParams;
        if (request.method === 'GET') {
          if (params.has('inviteServers')) {
            const eligible = [...servers.values()].filter(server => server.members.some(member => member.self)
              && !server.members.some(member => member.userId === Number(params.get('inviteServers'))));
            return reply(response, { servers: eligible.map(({ id, name }) => ({ id, name })) });
          }
          if (params.has('relationship')) {
            return reply(response, { status: friendsFixture.find(person => person.id === Number(params.get('relationship')))?.status ?? null });
          }
          if (params.has('with')) {
            if (params.get('with') !== '2' || friendsFixture[0].status !== 'friend') return reply(response, { error: 'Sem acesso' }, 403);
            return reply(response, { more: false, messages: directMessages.filter(message => message.id > Number(params.get('after'))) });
          }
          const search = params.get('search')?.toLowerCase();
          return reply(response, { people: friendsFixture.filter(person => search ? person.name.toLowerCase().startsWith(search) : person.status) });
        }
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const { action, user, text, server } = JSON.parse(Buffer.concat(chunks));
        if (action === 'request' && user === 3) friendsFixture[1].status = 'sent';
        else if (action === 'request' && user === 30) friendsFixture[2].status = 'sent';
        else if (action === 'accept' && user === 2) friendsFixture[0].status = 'friend';
        else if (action === 'send' && user === 2) directMessages.push({ id: directMessages.length + 1, text, own: true, time: '2026-11-22T14:00:00Z' });
        else if (action === 'invite' && user === 2 && server === 29) {
          profileInvites.push({ user, server });
          directMessages.push({ id: directMessages.length + 1, text: '?convite=' + invitation, own: true, time: '2026-11-22T14:00:00Z' });
          return reply(response, { sent: true, token: invitation });
        } else if (action === 'remove' && user === 35) friendsFixture[3].status = null;
        else return reply(response, { error: 'Ação inesperada' }, 422);
        return reply(response, { saved: true, status: friendsFixture.find(person => person.id === user)?.status });
      });
      server.middlewares.use('/voice.php', async (request, response) => {
        if (request.method === 'POST') {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks));
          if (body.room === 'friend-12') {
            privateVoiceRequests.push(body.type);
            if (body.type === 'join') return reply(response, { type: 'welcome', token: 't'.repeat(48),
              self: { id: 'self', userId: 1, name: 'Player', muted: false, sharing: false }, members: [], iceServers: [] });
            return reply(response, body.type === 'leave' ? { ok: true } : { events: [] });
          }
        }
        const params = new URL(request.url, 'http://localhost').searchParams;
        const voice = guild.channels.find(channel => channel.type === 'VOZ');
        const rooms = voice && Number(params.get('server')) === guild.id
          ? { ['channel-' + voice.id]: [{ id: 'peer', userId: guild.members[1].userId,
              name: guild.members[1].name, muted: false, sharing: false }] }
          : {};
        return reply(response, { rooms });
      });
      server.middlewares.use('/chat.php', async (request, response) => {
        const params = new URL(request.url, 'http://localhost').searchParams;
        const channel = Number(params.get('channel'));
        const messages = chatMessages.get(channel) ?? [];
        if (request.method === 'POST') {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          if (request.headers['content-type']?.startsWith('multipart/form-data;')) {
            const body = await new Response(Buffer.concat(chunks), {
              headers: { 'Content-Type': request.headers['content-type'] },
            }).formData();
            const media = body.get('media');
            const { text } = JSON.parse(body.get('message'));
            chatUploads.push({ channel, text, name: media.name, type: media.type, bytes: [...new Uint8Array(await media.arrayBuffer())] });
            return reply(response, { ok: true });
          }
          const { action, id } = JSON.parse(Buffer.concat(chunks));
          if (action !== 'deleteMessage' || !messages.some(message => message.id === id)) {
            return reply(response, { error: 'Unexpected delete' }, 404);
          }
          chatDeletes.push({ channel, id });
          chatMessages.set(channel, messages.filter(message => message.id !== id));
          return reply(response, { ok: true });
        }
        const after = Number(params.get('after'));
        const first = Number(params.get('pollsFrom'));
        return reply(response, {
          messageActions: true,
          messages: messages.filter(message => message.id > after),
          existing: first ? messages.filter(message => message.id >= first && message.id <= after).map(message => message.id) : null,
        });
      });
      server.middlewares.use('/servers.php', async (request, response) => {
        const params = new URL(request.url, 'http://localhost').searchParams;
        if (request.method === 'POST') {
          const chunks = [];
          for await (const chunk of request) chunks.push(chunk);
          const body = JSON.parse(Buffer.concat(chunks));
          writes.push(body);
          if (body.action === 'join') {
            if (!signedIn || body.code !== guestInvitation) return reply(response, { error: 'Wrong invitation' }, 403);
            acceptCount++;
            joinedInvite = true;
            return reply(response, { id: guild.id });
          }
          const server = servers.get(body.server);
          if (server !== guild) return reply(response, { error: 'Wrong server' }, 422);
          if (wrongResponse) {
            wrongResponse = false;
            return reply(response, { id: entrance.id });
          }
          if (body.action === 'server') server.name = body.name;
          else if (body.action === 'channel') {
            const channel = server.channels.find(channel => channel.id === body.channel);
            if (!channel) return reply(response, { error: 'Wrong channel' }, 404);
            Object.assign(channel, { name: body.name, userLimit: body.userLimit });
          } else if (body.action === 'deleteChannel') {
            const channel = server.channels.find(channel => channel.id === body.channel && channel.name === body.name);
            if (!channel) return reply(response, { error: 'Wrong channel' }, 404);
            server.channels = server.channels.filter(item => item !== channel);
          } else if (body.action === 'memberRoles') {
            if (!(server.permissions & 2) || body.member !== server.members[1].id) {
              return reply(response, { error: 'Wrong member or permission' }, 403);
            }
            server.members[1].roles = body.roles.map(id => server.roles.find(role => role.id === id));
          } else if (body.action === 'roleOrder') {
            server.roles = body.order.map((id, position) => ({ ...server.roles.find(role => role.id === id), position }));
          } else if (body.action === 'role') {
            const role = server.roles.find(role => role.id === body.role);
            if (body.role === undefined) {
              server.roles.push({ id: 295, name: body.name, permissions: body.permissions, position: server.roles.length, color: body.color });
            } else {
              if (!role) return reply(response, { error: 'Wrong role' }, 404);
              role.color = body.color;
              for (const member of server.members) {
                member.roles = member.roles.map(assigned => server.roles.find(role => role.id === assigned.id));
              }
            }
          } else if (body.action === 'reservedRoleColor') {
            const role = server.reservedRoles.find(role => role.title === body.title);
            if (!role) return reply(response, { error: 'Wrong reserved role' }, 403);
            role.color = body.color;
            for (const member of server.members.filter(member => member.title === role.title)) {
              member.titleColor = role.color;
            }
          } else if (body.action === 'shareInvite') {
            return reply(response, { id: server.id, token: invitation });
          } else return reply(response, { error: 'Unexpected action' }, 422);
          return reply(response, { id: server.id });
        }
        if (params.has('invite')) {
          if (params.get('invite') === expired) return reply(response, { error: 'Este convite expirou.' }, 410);
          return reply(response, { name: guild.name, id: guild.id, hasIcon: false, member: joinedInvite });
        }
        if (params.has('members')) {
          const server = servers.get(Number(params.get('members')));
          return server ? reply(response, { members: server.members }) : reply(response, { error: 'Wrong roster' }, 404);
        }
        if (params.has('entrance') || params.has('server')) {
          const id = params.has('entrance') ? entrance.id : Number(params.get('server'));
          visits.push(id);
          if (id === guild.id && guildUnavailable) return reply(response, { error: 'Unavailable' }, 503);
          return reply(response, servers.get(id));
        }
        return reply(response, { servers: [...servers.values()].map(({ id, name, lobby, hasIcon }) =>
          ({ id, name, lobby, hasIcon, owner: !lobby })) });
      });
    },
  }] });
  await vite.listen();
  const chrome = launchTestChrome(profile);
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Chrome did not start')), 10000);
      chrome.once('error', error => { clearTimeout(timeout); reject(error); });
      let output = '';
      chrome.stderr.on('data', chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
    });
    const pages = await fetch(`http://${new URL(endpoint).host}/json/list`).then(response => response.json());
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    let loaded;
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Page.loadEventFired') loaded?.();
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
    await command('Page.enable');
    async function navigatePage(url) {
      const wait = new Promise(resolve => { loaded = resolve; });
      try {
        if (url) await command('Page.navigate', { url });
        else await command('Page.reload');
        await wait;
      } finally { loaded = undefined; }
    }
    async function evaluate(expression) {
      const evaluation = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(evaluation.exceptionDetails, undefined, evaluation.exceptionDetails?.exception?.description);
      return evaluation.result.value;
    }

    await command('Emulation.setDeviceMetricsOverride', { width: 2515, height: 956, deviceScaleFactor: 1, mobile: false });
    await navigatePage(vite.resolvedUrls.local[0]);
    const chatLayout = await evaluate(`(async () => {
      for (let attempt = 0; attempt < 180 && !document.querySelector('.chat-scroll'); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const chat = document.querySelector('.chat');
      if (!document.querySelector('.server-rail > .friends-trigger:first-child + hr + [data-lobby]')) {
        throw Error('Friends should have a separate shortcut before the server list');
      }
      const row = document.createElement('article');
      row.className = 'message';
      row.innerHTML = '<button class="profile-trigger message-author-avatar"><span class="avatar"></span></button><div><strong>Jogador</strong> <time>18:00</time><p>Mensagem</p></div>';
      chat.querySelector('.chat-scroll').append(row);
      try {
        return {
          rail: document.querySelector('.server-rail').getBoundingClientRect().width,
          header: chat.querySelector('.chat-bar').getBoundingClientRect().height,
          avatar: row.querySelector('.avatar').getBoundingClientRect().width,
          messageFont: getComputedStyle(row.querySelector('p')).fontSize,
          wallpaperSize: getComputedStyle(chat).backgroundSize.split(', ').at(-1),
        };
      } finally { row.remove(); }
    })()`);
    assert.deepEqual(chatLayout, { rail: 68, header: 57, avatar: 34, messageFont: '15.04px', wallpaperSize: '7680px auto' });
    const wallMetrics = () => evaluate(`(async () => {
      const chat = document.querySelector('.chat');
      const style = getComputedStyle(chat);
      const image = new Image();
      image.src = '/art/chat-parede-ultrawide.webp?v=2';
      await image.decode();
      return {
        width: chat.clientWidth,
        height: chat.clientHeight,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        size: parseFloat(style.backgroundSize.split(', ').at(-1)),
        positionX: style.backgroundPositionX.split(', ').at(-1),
        positionY: parseFloat(style.backgroundPositionY.split(', ').at(-1)),
        repeat: style.backgroundRepeat.split(', ').at(-1),
        hasSingleImage: style.backgroundImage.match(/url[(]/g)?.length === 1 &&
          style.backgroundImage.endsWith('url("' + image.src + '")') &&
          style.backgroundImage.startsWith('linear-gradient(rgba(33, 18, 40, 0.46), rgba(33, 18, 40, 0.46)), ') &&
          ['::before', '::after'].every(layer => getComputedStyle(chat, layer).content === 'none'),
      };
    })()`);
    for (const width of [1960, 3440, 5120, 7680]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height: 1080, deviceScaleFactor: 1, mobile: false });
      const wall = await wallMetrics();
      assert.ok(wall.width > 0 && wall.width <= wall.size, 'The mural needs to cover the full chat width');
      assert.equal(wall.imageWidth, 8192);
      assert.equal(wall.imageHeight, 2304);
      assert.equal(wall.size, 7680, 'The bricks and graffiti must keep the same scale on desktop');
      assert.equal(wall.positionX, '100%');
      assert.equal(wall.positionY, 57);
      assert.equal(wall.repeat, 'no-repeat');
      assert.ok(wall.hasSingleImage, 'The chat should paint one uniformly shaded wallpaper');
    }
    const wallToneSpread = await evaluate(`(async () => {
      const image = new Image();
      image.src = '/art/chat-parede-ultrawide.webp?v=2';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 925;
      canvas.height = 288;
      const context = canvas.getContext('2d');
      // Exclude gold on the right and average over two courses to isolate lighting from mortar.
      context.drawImage(image, 0, 0, 7400, 2304, 0, 0, canvas.width, canvas.height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      const regions = [];
      for (let y = 3; y + 18 < canvas.height; y += 11) {
        for (let x = 0; x + 10 < canvas.width; x += 8) {
          let sum = 0;
          for (let row = y; row < y + 18; row++) {
            for (let col = x; col < x + 10; col++) {
              const i = 4 * (row * canvas.width + col);
              sum += .35 * data[i] + .55 * data[i + 1] + .1 * data[i + 2];
            }
          }
          regions.push(sum / 180);
        }
      }
      regions.sort((a, b) => a - b);
      return regions[Math.floor(regions.length * .95)] - regions[Math.floor(regions.length * .05)];
    })()`);
    assert.ok(wallToneSpread < 2, `Uneven lighting returned to the brick wall (${wallToneSpread})`);
    for (const [width, height] of [[320, 640], [390, 740], [700, 360]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const wall = await wallMetrics();
      const artWidth = wall.size * 1536 / wall.imageWidth;
      const fits = wall.width >= artWidth * .46 && wall.positionY + artWidth * .38 <= wall.height &&
        wall.positionY + wall.size * wall.imageHeight / wall.imageWidth >= wall.height;
      assert.ok(fits && wall.hasSingleImage, `The graffiti or wall did not fit at ${width} × ${height}`);
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 920, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 180; i++) {
          const value = document.querySelector(selector);
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing element: ' + selector);
      };
      const check = (condition, message) => { if (!condition) throw Error(message); };
      (await wait('[data-server="29"]')).click();
      await wait('[data-server="29"][aria-current="true"]');
      check(!document.querySelector('[data-voice-room^="video-demo-"]'), 'An ordinary server owner gained access to the test room');
      const bar = document.querySelector('.voice-account-bar');
      const accountBounds = bar.getBoundingClientRect();
      const railBounds = document.querySelector('.server-rail').getBoundingClientRect();
      const channelBounds = document.querySelector('.channel-panel').getBoundingClientRect();
      check(accountBounds.left === railBounds.left && accountBounds.right === channelBounds.right &&
        railBounds.bottom === accountBounds.top && channelBounds.bottom === accountBounds.top, 'The account bar should span both sidebars below their artwork');
      check(bar.querySelector('.avatar').offsetWidth >= 40 && bar.querySelector('[data-voice-settings]').offsetWidth >= 36,
        'The account bar needs a larger avatar and settings control');
      check(!bar.querySelector('.account-summary').getClientRects().length, 'The removed account arrow is still visible');
      const mic = bar.querySelector('[data-dock-mic]');
      const fone = bar.querySelector('[data-dock-headphones]');
      const panelColor = getComputedStyle(document.querySelector('.server-add')).backgroundColor;
      const selectedColor = getComputedStyle(document.querySelector('.channel[aria-current=true]')).backgroundColor;
      for (const selector of ['[data-dock-camera]', '[data-dock-screen]', '[data-voice-watch]']) {
        const button = document.querySelector(selector);
        const pressed = button.getAttribute('aria-pressed');
        button.setAttribute('aria-pressed', 'false');
        check(getComputedStyle(button).backgroundColor === panelColor, 'Wrong idle color for ' + selector);
        button.setAttribute('aria-pressed', 'true');
        check(getComputedStyle(button).backgroundColor === selectedColor, 'Wrong active color for ' + selector);
        if (pressed === null) button.removeAttribute('aria-pressed');
        else button.setAttribute('aria-pressed', pressed);
      }
      const hover = (button, label, below = false) => {
        button.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        const tooltip = document.querySelector('.button-tooltip:popover-open');
        check(tooltip?.textContent === label, 'Missing tooltip for ' + label);
        const trigger = button.getBoundingClientRect();
        const bubble = tooltip.getBoundingClientRect();
        check(below ? bubble.top > trigger.bottom : bubble.bottom < trigger.top, 'Tooltip is on the wrong side of ' + label);
        button.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
        check(!tooltip.matches(':popover-open'), 'Tooltip did not dismiss for ' + label);
      };
      hover(bar.querySelector('[data-voice-settings]'), 'Configurações de usuário');
      hover(document.querySelector('.server-invite-trigger'), 'Convidar para o servidor', true);
      hover(mic, 'Silenciar microfone');
      hover(fone, 'Desativar áudio');
      check(!bar.querySelector('.voice-account-controls').hidden, 'Audio controls are hidden outside a call');
      mic.click();
      check(mic.getAttribute('aria-pressed') === 'true', 'Cannot mute before joining a call');
      hover(mic, 'Ativar microfone');
      mic.click();
      fone.click();
      check(fone.getAttribute('aria-pressed') === 'true', 'Cannot deafen before joining a call');
      hover(fone, 'Reativar áudio');
      fone.click();
      const inputMenu = bar.querySelector('[data-quick-voice=input]');
      inputMenu.click();
      let quick = await wait('.quick-voice-menu:popover-open');
      const volume = quick.querySelector('[type=range]');
      volume.value = '73';
      volume.dispatchEvent(new Event('input', { bubbles: true }));
      check(JSON.parse(localStorage.getItem('discordo:voice:player@example.test')).inputVolume === 73, 'Input volume was not saved');
      check(quick.querySelector('output').value === '73%', 'Input volume label is stale');
      inputMenu.click();
      check(!document.querySelector('.quick-voice-menu'), 'Clicking the input arrow should close its menu');
      inputMenu.click();
      quick = await wait('.quick-voice-menu:popover-open');
      check(quick.querySelector('[type=range]').value === '73', 'Reopening lost the input volume');
      bar.querySelector('[data-quick-voice=output]').click();
      quick = await wait('.quick-voice-menu:popover-open');
      check(quick.getAttribute('aria-label').includes('fone') && !quick.querySelector('[data-quick-noise]'), 'Output menu mixed input options');
      const footer = quick.querySelector('[data-open-voice-settings]');
      const footerRect = footer.getBoundingClientRect();
      const popupRect = quick.getBoundingClientRect();
      const glyph = footer.querySelector('svg').getBoundingClientRect();
      check(footerRect.height >= 42 && popupRect.bottom - footerRect.bottom >= 15,
        'Voice settings footer is clipped against the menu edge');
      check(Math.abs((glyph.top + glyph.bottom - footerRect.top - footerRect.bottom) / 2) <= 1,
        'Voice settings icon is not centered vertically');
      quick.querySelector('[data-open-voice-settings]').click();
      check(!document.querySelector('#settings-voice').hidden, 'Quick menu did not open voice settings');
      document.querySelector('.user-settings [data-close]').click();
      await new Promise(resolve => setTimeout(resolve, 40));
      bar.querySelector('[data-voice-settings]').click();
      check(!document.querySelector('#settings-profile').hidden, 'Gear did not open personal settings');
      const settingsPane = document.querySelector('.user-settings');
      const content = settingsPane.querySelector('.settings-content');
      const navPane = settingsPane.querySelector('.settings-nav');
      const navBounds = navPane.getBoundingClientRect();
      const contentBounds = content.getBoundingClientRect();
      check(Math.abs(navBounds.height - contentBounds.height) <= 1, 'The sidebar ends before the content area');
      settingsPane.querySelector('[data-settings-jump=profile-audio]').click();
      check(content.scrollTop > 0 && navPane.getBoundingClientRect().top === navBounds.top,
        'Section navigation moved the sidebar with the content');
      check(navPane.querySelector('[data-settings-jump=profile-audio]').getAttribute('aria-current') === 'location',
        'Jumping to a subsection did not update the marker');
      content.scrollTop = 0;
      content.dispatchEvent(new Event('scroll'));
      check(navPane.querySelector('[aria-current=location]').dataset.settingsJump === 'profile-basic',
        'The section marker did not follow manual scrolling');
      settingsPane.querySelector('[aria-controls=settings-voice]').click();
      const voiceSubmenu = settingsPane.querySelector('[data-parent-tab=settings-voice]');
      const profileSubmenu = settingsPane.querySelector('[data-parent-tab=settings-profile]');
      check(voiceSubmenu.hasAttribute('data-expanded') && !voiceSubmenu.inert && profileSubmenu.inert
        && getComputedStyle(voiceSubmenu).transitionProperty.includes('grid-template-rows'), 'Submenu does not expand with a transition');
      check(!settingsPane.querySelector('[data-test-microphone], [name=voiceInputProfile]'), 'Voice settings were not restored');
      check(voiceSubmenu.querySelector('[aria-current=location]').dataset.settingsJump === 'voice-input-section',
        'The initial voice section does not have an active marker');
      const markers = new Set();
      for (const tab of ['voice', 'shortcuts', 'account', 'profile']) {
        await Promise.resolve();
        settingsPane.querySelector('[aria-controls=settings-' + tab + ']').click();
        for (const link of navPane.querySelectorAll('[data-expanded] [data-settings-jump]')) {
          markers.add(getComputedStyle(link, '::before').height);
        }
      }
      check(markers.size === 1 && markers.has('20px'), 'Settings sidebar indicators change height with the label');
      await Promise.resolve();
      settingsPane.querySelector('[aria-controls=settings-voice]').click();

      await Promise.resolve();
      const frame = settingsPane.getBoundingClientRect();
      for (const tab of ['shortcuts', 'account', 'profile']) {
        settingsPane.querySelector('[aria-controls=settings-' + tab + ']').click();
        await Promise.resolve();
        const currentFrame = settingsPane.getBoundingClientRect();
        check(!settingsPane.querySelector('#settings-' + tab).hidden
          && ['x', 'y', 'width', 'height'].every(key => Math.abs(currentFrame[key] - frame[key]) <= 1),
          'Changing tabs resized or moved the settings dialog: ' + tab + ' ' + JSON.stringify([frame,currentFrame,settingsPane.querySelector('#settings-' + tab).hidden]));
      }

      document.querySelector('.user-settings [data-close]').click();
      await new Promise(resolve => setTimeout(resolve, 40));
      const controls = bar.querySelector('.voice-account-controls').getBoundingClientRect();
      const bounds = bar.getBoundingClientRect();
      check(controls.right <= bounds.right + 1 && controls.left >= bounds.left, 'Audio controls overflow the account bar');

      check((await wait('[data-member="2902"]')).textContent.includes('Membro da guilda'), 'The member list is not scoped to the guild');
      check(!document.querySelector('[data-member="102"]'), 'A lobby member leaked into the guild');
      check((await wait('[data-member="2902"] .member-row-banner')).getAttribute('src').startsWith('data:image/'),
        'A member banner was not rendered');
      check(!document.querySelector('[data-member="2901"] .member-row-banner'), 'A member without a banner gained a background');
      check(document.querySelector('[data-member="2902"] > strong').textContent === 'Membro da guilda'
        && document.querySelector('[data-member="2901"] > strong').textContent === 'Player'
        && !document.querySelector('.member-row small'), 'Member rows should show only the display name');
      check(document.querySelector('[data-member="2902"]').closest('.member-group').querySelector('h3').textContent.includes('Jogador'),
        'The role should still appear as the member group heading');
      (await wait('[data-channel="292"]')).click();
      const route = new URL(location.href);
      check(route.searchParams.get('servidor') === '29' && route.searchParams.get('canal') === '292', 'The guild selection was not saved in the URL');
      (await wait('[data-open-gameplay]')).click();
      check(!document.querySelector('.tutorial-card'), 'The tutorial appeared for an existing account');
      const gameplayDialog = document.querySelector('.gameplay-dialog');
      check(gameplayDialog.querySelector('[name=channel]').value === '292'
        && gameplayDialog.querySelector('[name=members]').value === '2902', 'Gameplay used a lobby channel or member');
      const background = element => getComputedStyle(element).backgroundColor;
      const gameplaySurface = background(gameplayDialog);
      check(background(gameplayDialog.querySelector('.settings-header')) === gameplaySurface, 'Gameplay header and body use different colors');
      const gameplayField = background(gameplayDialog.querySelector('[name=comment]'));
      gameplayDialog.querySelector('[data-close]').click();

      (await wait('[data-server-settings]')).click();
      const name = await wait('.server-dialog [name=name]');
      check(background(name.closest('dialog')) === gameplaySurface && background(name) === gameplayField, 'Gameplay does not match the settings palette');
      name.value = 'Guilda atualizada';
      name.form.requestSubmit();
      await wait('.server-dialog :is(input, button):enabled');
      for (let i = 0; i < 80 && !document.querySelector('.server-dialog [role=status]').textContent.includes('não confirmou'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      check(document.querySelector('.server-dialog [role=status]').textContent.includes('não confirmou'), 'A response for the lobby was accepted as a guild save');
      name.form.requestSubmit();
      for (let i = 0; i < 80 && !document.querySelector('.server-dialog [role=status]').textContent.includes('Alterações salvas'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      (await wait('.server-dialog [data-tab=roles]')).click();
      (await wait('.server-dialog [data-order-role="292"][data-direction="-1"]')).click();
      for (let i = 0; i < 80 && !document.querySelector('.server-dialog [role=status]').textContent.includes('Ordem dos cargos salva'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      (await wait('.server-dialog [data-close]')).click();
      await wait('[data-server="29"][aria-label="Guilda atualizada"]');
      await wait('.workspace[data-desktop-server-name="Guilda atualizada"]');
      (await wait('[data-edit-channel="293"]')).click();
      const channel = await wait('.server-dialog [name=name]');
      channel.value = 'Voz da guilda';
      const limit = channel.form.elements.limitEnabled;
      limit.click();
      channel.form.elements.userLimit.value = '4';
      channel.form.requestSubmit();
      await wait('[data-edit-channel="293"][aria-label="Editar canal Voz da guilda"]');
    })()`);
    for (const selector of ['.server-menu > summary', '[data-account-profile]']) {
      const point = await evaluate(`(() => {
        const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      })()`);
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      assert.equal(await evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(selector)});
        const highlight = getComputedStyle(button, '::before');
        return button.matches(':hover') && getComputedStyle(button).backgroundColor === 'rgba(0, 0, 0, 0)'
          && highlight.backgroundColor === 'rgb(66, 39, 75)' && parseFloat(highlight.borderTopLeftRadius) > 0
          && parseFloat(highlight.left) > 0 && parseFloat(highlight.right) > 0
          && parseFloat(highlight.height) < button.getBoundingClientRect().height;
      })()`), true, 'The hover highlight should be rounded and inset for ' + selector);
    }
    const serverPoint = await evaluate(`(() => {
      const box = document.querySelector('[data-server="29"]').getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    })()`);
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', ...serverPoint });
    assert.equal(await evaluate(`(() => {
      const button = document.querySelector('[data-server="29"]');
      const tooltip = document.querySelector('#server-name-tooltip');
      const icon = button.getBoundingClientRect();
      const box = tooltip.getBoundingClientRect();
      return tooltip.matches(':popover-open') && tooltip.textContent === 'Guilda atualizada'
        && button.getAttribute('aria-describedby') === tooltip.id && !button.hasAttribute('title')
        && box.left >= icon.right + 8 && Math.abs((box.top + box.bottom - icon.top - icon.bottom) / 2) <= 1;
    })()`), true, 'Hover did not show the server name beside its icon');
    await command('Input.dispatchMouseEvent', { type:'mouseMoved', x:600, y:25 });
    assert.equal(await evaluate(`document.querySelector('#server-name-tooltip').matches(':popover-open')`), false, 'Server tooltip stayed open after the mouse left');
    assert.equal(await evaluate(`(() => {
      const button = document.querySelector('[data-lobby]');
      button.focus();
      const tooltip = document.querySelector('#server-name-tooltip');
      const accessible = tooltip.matches(':popover-open') && tooltip.textContent === 'Discordo Brasil';
      document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
      button.blur();
      return accessible && !tooltip.matches(':popover-open') && !button.hasAttribute('aria-describedby');
    })()`), true, 'Server tooltip did not support keyboard focus and Escape');
    await command('Input.dispatchMouseEvent', { type:'mousePressed', ...serverPoint, button:'right', buttons:2, clickCount:1 });
    await command('Input.dispatchMouseEvent', { type:'mouseReleased', ...serverPoint, button:'right', buttons:0, clickCount:1 });
    await evaluate(`(() => {
      const menu = document.querySelector('.server-context-menu:popover-open');
      if (!menu || menu.getAttribute('aria-label') !== 'Guilda atualizada'
        || menu.querySelectorAll('[data-action]').length !== 5) throw Error('Server context menu did not show the existing actions');
      menu.querySelector('[data-action=create-category]').click();
      const dialog = document.querySelector('.category-editor-dialog[open]');
      if (!dialog || menu.matches(':popover-open')) throw Error('Context action did not open the existing category editor');
      dialog.querySelector('[data-close]').click();
    })()`);
    const lobbyPermissions = entrance.permissions;
    entrance.permissions = 0;
    try {
      await evaluate(`(async () => {
        document.querySelector('[data-lobby]').dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true }));
        for (let i = 0; i < 100 && !document.querySelector('.server-context-menu [data-action]'); i++) {
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        const menu = document.querySelector('.server-context-menu:popover-open');
        if (menu?.querySelectorAll('button').length !== 1 || !menu.querySelector('[data-action=open-invites]')
          || !document.querySelector('[data-server="29"][aria-current=true]')) {
          throw Error('Context menu used the active server permissions for another server or changed servers on opening');
        }
        menu.hidePopover();
      })()`);
    } finally { entrance.permissions = lobbyPermissions; }
    const memberPoint = await evaluate(`(() => {
      if (!document.querySelector('.workspace.with-members')) document.querySelector('.members-toggle').click();
      const rect = document.querySelector('[data-member="2902"]').getBoundingClientRect();
      return { x: rect.right - 16, y: rect.top + rect.height / 2 };
    })()`);
    async function clickMember() {
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...memberPoint, button: 'left', buttons: 1, clickCount: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...memberPoint, button: 'left', buttons: 0, clickCount: 1 });
    }
    await clickMember();
    assert.equal(await evaluate(`document.querySelector('#member-profile').matches(':popover-open')`), true, 'First click did not open the member profile');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-member="2902"] .member-row-banner')).opacity`), '0.5', 'Opening a profile did not highlight its member banner');
    await clickMember();
    assert.equal(await evaluate(`document.querySelector('#member-profile').matches(':popover-open')`), false, 'Repeated pointer click reopened the profile after native dismissal');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('[data-member="2902"] .member-row-banner')).opacity`), '0.18', 'Closing a profile did not restore its member banner');
    await clickMember();
    assert.equal(await evaluate(`document.querySelector('#member-profile').matches(':popover-open')`), true, 'Third click did not reopen the member profile');
    assert.deepEqual(await evaluate(`(() => {
      const card = document.querySelector('#member-profile');
      return ['[data-card-roles] > span', '.profile-add-role'].map(selector => getComputedStyle(card.querySelector(selector)).color);
    })()`), ['rgb(201, 184, 187)', 'rgb(201, 184, 187)'], 'The custom gradient did not tint both role controls');
    const roleButtonPoint = await evaluate(`(() => {
      const bounds = document.querySelector('#member-profile .profile-add-role').getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...roleButtonPoint });
    await evaluate(`(() => {
      const tooltip = document.querySelector('.button-tooltip:popover-open');
      const button = document.querySelector('#member-profile .profile-add-role').getBoundingClientRect();
      if (tooltip?.textContent !== 'Adicionar cargo' || tooltip.getBoundingClientRect().bottom >= button.top) {
        throw Error('The role button did not show the tooltip above it');
      }
    })()`);
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...memberPoint });
    assert.equal(await evaluate(`Boolean(document.querySelector('.button-tooltip:popover-open'))`), false, 'The role tooltip stayed open after the mouse left');
    await evaluate(`(async () => {
      const button = document.querySelector('#member-profile [data-profile-friend]');
      for (let i = 0; i < 160 && button.getAttribute('aria-disabled') === 'true'; i++) await new Promise(resolve => setTimeout(resolve, 25));
      if (button.hidden || button.getAttribute('aria-label') !== 'Adicionar amigo') throw Error('Friend request action is missing from the member profile');
      const add = button.getBoundingClientRect();
      const close = document.querySelector('#member-profile .profile-card-close').getBoundingClientRect();
      if (add.top <= close.bottom || Math.abs(add.right - close.right) > 1) throw Error('The friend action should sit below the close button');
      button.click();
      for (let i = 0; i < 160 && button.getAttribute('aria-label') !== 'Pedido enviado'; i++) await new Promise(resolve => setTimeout(resolve, 25));
      if (button.getAttribute('aria-disabled') !== 'true' || button.getAttribute('aria-label') !== 'Pedido enviado') {
        throw Error('The profile did not reflect the sent friend request');
      }
    })()`);
    assert.equal(friendsFixture[2].status, 'sent');
    friendsFixture[2].status = null;
    await evaluate(`(async () => {
      const member = document.querySelector('[data-member="2902"]');
      const open = () => member.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const wait = async selector => {
        for (let i = 0; i < 160; i++) {
          const result = document.querySelector(selector);
          if (result) return result;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing ' + selector);
      };
      open();
      const add = await wait('.profile-context-menu:popover-open [data-profile-action=add]:not([hidden]):enabled');
      if (add.textContent.trim() !== 'Adicionar amigo') throw Error('The profile menu did not offer a new friend request');
      add.click();
      const feedback = await wait('.profile-menu-status:not([hidden])');
      if (!feedback.textContent.includes('Pedido de amizade enviado')) throw Error('The menu did not confirm the request');
      open();
      const sent = await wait('.profile-context-menu:popover-open [data-profile-action=add]:not([hidden]):disabled');
      if (sent.textContent.trim() !== 'Pedido enviado') throw Error('The menu allowed a duplicate request');
      sent.closest('.profile-context-menu').hidePopover();
    })()`);
    assert.equal(friendsFixture[2].status, 'sent');
    await evaluate(`(() => {
      document.querySelector('[data-member="2901"]').click();
      if (!document.querySelector('#member-profile').matches(':popover-open')
        || document.querySelector('[data-card-name]').textContent !== 'Player') throw Error('Clicking a different member did not switch profiles');
      const card = document.querySelector('#member-profile');
      if (!card.querySelector('[data-profile-friend]').hidden) throw Error('The account can send a friend request to itself');
      if (card.style.getPropertyValue('--card-role-color')) throw Error('The previous custom tint leaked into the default profile');
      if (!card.querySelector('[data-edit-profile]:not([hidden])')
          || !card.querySelector('.profile-roles [data-edit-member-roles]:not([hidden])')
          || card.querySelector('[data-card-switch-account]:not([hidden])')) {
        throw Error('The member roster offered the wrong actions on the current profile');
      }
      document.querySelector('[data-member="2901"]').click();
      if (document.querySelector('#member-profile').matches(':popover-open')) throw Error('Keyboard-style repeated activation did not close the profile');
      document.querySelector('.members-toggle').click();
    })()`);
    const resizeStart = await evaluate(`(() => {
      const panel = document.querySelector('.channel-panel').getBoundingClientRect();
      const handle = document.querySelector('.channel-resize-handle').getBoundingClientRect();
      return { x: handle.left + handle.width / 2, y: handle.top + 180, width: panel.width };
    })()`);
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: resizeStart.x, y: resizeStart.y, button: 'left', buttons: 1, clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: resizeStart.x + 65, y: resizeStart.y, button: 'left', buttons: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: resizeStart.x + 65, y: resizeStart.y, button: 'left', buttons: 0, clickCount: 1 });
    const resized = await evaluate(`(() => {
      const width = document.querySelector('.channel-panel').getBoundingClientRect().width;
      if (Math.abs(width - Number(localStorage.getItem('discordo:channel-panel-width'))) > 1) throw Error('Dragged width was not persisted');
      if (document.querySelector('.resizing-channels')) throw Error('Resizing state stayed active after releasing the mouse');
      return width;
    })()`);
    assert.ok(Math.abs(resized - resizeStart.width - 65) < 2, 'Dragging the panel edge did not resize it');
    await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 120; i++) {
          const node = document.querySelector(selector);
          if (node) return node;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing resized server: ' + selector);
      };
      document.querySelector('[data-lobby]').click();
      await wait('[data-lobby][aria-current="true"]');
      if (Math.abs(document.querySelector('.channel-panel').getBoundingClientRect().width - ${resized}) > 1) throw Error('Switching servers lost the preferred width');
      document.querySelector('[data-server="29"]').click();
      await wait('[data-server="29"][aria-current="true"]');
      document.querySelector('[data-channel="292"]').click();
      const handle = document.querySelector('.channel-resize-handle');
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      if (Number(handle.getAttribute('aria-valuenow')) !== ${resized} + 10) throw Error('Keyboard resizing failed');
      const channelPanel = document.querySelector('.channel-panel');
      const friendsButton = document.querySelector('[data-open-friends]');
      const customWidth = channelPanel.getBoundingClientRect().width;
      friendsButton.click();
      const friendsPanel = await wait('.friends-sidebar');
      if (friendsPanel.getBoundingClientRect().width !== customWidth) throw Error('Friends did not use the saved channel sidebar width');
      friendsButton.click();
      if (channelPanel.getBoundingClientRect().width !== customWidth) throw Error('Returning from Friends changed the channel sidebar width');
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      if (localStorage.getItem('discordo:channel-panel-width') !== null) throw Error('Reset did not clear the saved width');
    })()`);
    const scrollArea = await evaluate(`(() => {
      const area = document.querySelector('.channel-list');
      const filler = document.createElement('div');
      filler.dataset.scrollbarFixture = '';
      filler.style.height = '1600px';
      area.append(filler);
      document.activeElement?.blur();
      const box = area.getBoundingClientRect();
      return { x: box.left + 20, y: box.top + 20, width: area.clientWidth };
    })()`);
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 25 });
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.channel-list')).getPropertyValue('--scrollbar-thumb').trim()`), 'rgba(0, 0, 0, 0)');
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: scrollArea.x, y: scrollArea.y });
    await new Promise(resolve => setTimeout(resolve, 60));
    const duringFade = await evaluate(`getComputedStyle(document.querySelector('.channel-list')).getPropertyValue('--scrollbar-thumb').trim()`);
    assert.notEqual(duringFade, 'rgba(0, 0, 0, 0)', 'Scrollbar did not start fading in');
    assert.notEqual(duringFade, 'rgb(151, 115, 188)', 'Scrollbar appeared instantly instead of fading');
    await new Promise(resolve => setTimeout(resolve, 260));
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.channel-list')).getPropertyValue('--scrollbar-thumb').trim()`), 'rgb(151, 115, 188)');
    await command('Input.dispatchMouseEvent', { type: 'mouseWheel', x: scrollArea.x, y: scrollArea.y, deltaY: 140, deltaX: 0 });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(await evaluate(`(() => {
      const area = document.querySelector('.channel-list');
      return area.scrollTop > 0 && area.clientWidth === ${scrollArea.width}
        && getComputedStyle(document.querySelector('.voice-camera-previews')).scrollbarWidth === 'none';
    })()`), true, 'Hover changed layout, broke scrolling or exposed camera scrollbars');
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 600, y: 25 });
    await new Promise(resolve => setTimeout(resolve, 520));
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.channel-list')).getPropertyValue('--scrollbar-thumb').trim()`), 'rgba(0, 0, 0, 0)', 'Scrollbar did not fade out');
    await evaluate(`document.querySelector('[data-scrollbar-fixture]').remove(); document.querySelector('.channel-list').scrollTop = 0`);
    assert.deepEqual(writes.map(({ action, server }) => [action, server]),
      [['server', 29], ['server', 29], ['roleOrder', 29], ['channel', 29]]);
    assert.deepEqual(guild.roles.map(role => role.id), [292, 291]);
    assert.equal(guild.channels[2].userLimit, 4);
    assert.equal(entrance.name, 'Discordo Brasil');
    assert.equal(entrance.channels[2].userLimit, null);

    await command('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate(`(async () => {
      document.querySelector('[data-edit-channel="293"]').click();
      const editor = document.querySelector('.channel-editor-dialog[open]');
      const frame = editor.getBoundingClientRect();
      const actions = editor.querySelector('.channel-editor-actions').getBoundingClientRect();
      const buttons = [...editor.querySelectorAll('.channel-editor-actions button')].map(button => button.getBoundingClientRect());
      const closed = new Promise(resolve => editor.addEventListener('close', resolve, { once: true }));
      editor.querySelector('[data-close]').click();
      await closed;
      const gap = buttons[1].left - buttons[0].right;
      if (!(frame.left >= 0 && frame.right <= innerWidth && Math.abs(buttons[0].left - actions.left) <= 1
          && buttons[1].right <= actions.right && gap === 8 && buttons.every(button => button.height >= 44))) {
        throw Error('Unexpected channel editor spacing: ' + JSON.stringify({ frame, actions, buttons, gap }));
      }
      return true;
    })()`), true, 'The compact channel editor did not fit a narrow screen');
    await command('Emulation.clearDeviceMetricsOverride');

    const roleDisplayColor = await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 180; i++) {
          const node = document.querySelector(selector);
          if (node) return node;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing element: ' + selector);
      };
      (await wait('[data-server-settings]')).click();
      (await wait('.server-dialog [data-tab=roles]')).click();
      const mode = value => document.querySelector('.server-dialog [name=colorMode][value=' + value + ']');
      const picker = () => document.querySelector('[data-role-color-picker]');
      const hex = () => picker().querySelector('[data-color-hex]');
      const setColor = color => {
        hex().value = color;
        hex().dispatchEvent(new Event('input', { bubbles: true }));
      };

      (await wait('[data-new-role]')).click();
      if (!mode('none').checked || !picker().hidden) throw Error('New roles should start without a color');
      const name = document.querySelector('.server-dialog [name=name]');
      name.value = 'Sem cor ao criar';
      (await wait('.server-dialog [name=permissions][value="256"]')).click();
      name.form.requestSubmit();
      await wait('[data-edit-role="295"]');

      (await wait('[data-edit-role="291"]')).click();
      if (!mode('none').checked || !picker().hidden) throw Error('An uncolored role gained a color');
      mode('custom').click();
      if (picker().hidden || picker().querySelector('[data-color-mode=gradient]')) throw Error('Custom color should open a solid picker');
      setColor('#1ABC9C');
      mode('none').click();
      if (!picker().hidden) throw Error('The picker stayed open with no color selected');
      mode('custom').click();
      if (hex().value !== '#1ABC9C') throw Error('Switching modes lost the draft color');
      hex().form.requestSubmit();
      const roleEdit = await wait('[data-edit-role="291"]');
      const row = () => document.querySelector('[data-member="2902"]');
      const memberColor = () => row().style.getPropertyValue('--role-text');
      if (memberColor() !== '#1ABC9C') throw Error('The role color did not update immediately');
      roleEdit.click();
      if (!mode('custom').checked || hex().value !== '#1ABC9C') throw Error('The editor did not reopen with the saved color');
      setColor('#71368A');
      hex().form.requestSubmit();
      await wait('[data-edit-role="291"]');
      const group = row().closest('.member-group').querySelector('h3');
      if (getComputedStyle(row().querySelector('strong')).color !== 'rgb(113, 54, 138)'
          || getComputedStyle(group).color !== 'rgb(113, 54, 138)') {
        throw Error('The selected dark color was lightened on the roster');
      }
      (await wait('[data-edit-role="292"]')).click();
      if (!mode('custom').checked || hex().value !== '#0020BC') throw Error('An existing color was lost in the editor');
      mode('none').click();
      mode('none').form.requestSubmit();
      (await wait('[data-edit-role="292"]')).click();
      if (!mode('none').checked || !picker().hidden) throw Error('Clearing a role color did not persist');
      const displayColor = memberColor();
      (await wait('[data-role-back]')).click();
      if (document.querySelector('[data-edit-reserved-role="Criador"]')) throw Error('ADM received the Criador editor');
      (await wait('[data-edit-reserved-role="ADM"]')).click();
      if (document.querySelector('.server-dialog [name=name], .server-dialog [name=permissions], .server-dialog [data-delete-role]')) {
        throw Error('A reserved role editor allowed structural edits');
      }
      mode('custom').click();
      setColor('#3498DB');
      hex().form.requestSubmit();
      (await wait('[data-edit-reserved-role="ADM"]')).click();
      if (hex().value !== '#3498DB' || document.querySelector('[data-member="2901"]').style.getPropertyValue('--role-text') !== '#3498DB') {
        throw Error('The ADM color did not save and update the roster');
      }
      const workspace = document.querySelector('.workspace');
      (await wait('.server-dialog [data-close]')).click();
      for (let i = 0; i < 180 && workspace.isConnected; i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (workspace.isConnected) throw Error('Closing settings did not refresh the server');
      return displayColor;
    })()`);
    assert.deepEqual(writes.filter(write => write.action === 'role').map(({ server, role, color }) => [server, role, color]),
      [[29, undefined, null], [29, 291, '#1ABC9C'], [29, 291, '#71368A'], [29, 292, null]]);
    assert.equal(entrance.roles[0].color, undefined);
    assert.deepEqual(writes.at(-1), { action: 'reservedRoleColor', server: 29, title: 'ADM', color: '#3498DB' });

    guild.members[0].title = 'Criador';
    guild.reservedRoles.unshift({ title: 'Criador', color: '#E91E63' });
    guild.members[0].titleColor = guild.reservedRoles[0].color;
    const beforeReload = visits.length;
    await navigatePage();
    assert.equal(await evaluate(`(async () => {
      for (let i = 0; i < 180; i++) {
        if (document.querySelector('[data-voice-room="video-demo-29"]')) {
          return document.querySelector('[data-channel="292"][aria-current="true"]') !== null
            && document.querySelector('[data-voice-room="local-video-demo"]') === null
            && document.querySelector('[data-member="2902"]').style.getPropertyValue('--role-text') === ${JSON.stringify(roleDisplayColor)}
            && document.querySelector('[data-member="2901"]').style.getPropertyValue('--role-text') === '#E91E63';
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return false;
    })()`), true, 'Reload did not restore the guild, channel and guild-specific test room');
    assert.deepEqual(visits.slice(beforeReload), [29]);
    assert.equal(await evaluate(`(() => {
      document.querySelector('[data-server-settings]').click();
      document.querySelector('[data-tab=roles]').click();
      const titles = [...document.querySelectorAll('[data-edit-reserved-role]')].map(button => button.dataset.editReservedRole);
      document.querySelector('.server-dialog [data-close]').click();
      return titles;
    })()`).then(titles => titles.join(',')), 'Criador,ADM');

    guild.admin = false;
    guild.permissions = 2;
    await navigatePage();
    await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 160; i++) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing ' + selector);
      };
      const profile = await wait('.voice-member-profile[aria-label="Perfil de Membro da guilda"]');
      profile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      (await wait('.profile-context-menu:popover-open [data-profile-action=roles]:not([hidden])')).click();
      const member = await wait('.server-dialog[open] [name=member]');
      if (member.value !== '2902') throw Error('The editor loaded the wrong participant');
      member.form.requestSubmit();
      for (let i = 0; i < 160 && member.isConnected; i++) await new Promise(resolve => setTimeout(resolve, 25));
      if (member.isConnected) throw Error('The voice menu role edit could not be saved');
    })()`);
    assert.deepEqual(writes.at(-1), { action: 'memberRoles', server: 29, member: 2902, roles: [291] });

    assert.equal(guild.roles.find(role => role.id === 295)?.permissions, 256, 'The message deletion permission was not saved');
    guild.permissions = 0;
    const sample = { time: '2026-11-22T16:00:00Z', author: 'Player', userId: 1, video: false };
    chatMessages.set(291, [
      { ...sample, id: 42, text: 'Minha mensagem', own: true },
      { ...sample, id: 43, text: 'Mensagem de outra pessoa', own: false, userId: 30 },
    ]);
    await navigatePage();
    await evaluate(`(async () => {
      let profile;
      for (let i = 0; i < 160 && !profile; i++) {
        profile = document.querySelector('.voice-member-profile[aria-label="Perfil de Membro da guilda"]');
        if (!profile) await new Promise(resolve => setTimeout(resolve, 25));
      }
      profile.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      const menu = document.querySelector('.profile-context-menu:popover-open');
      if (!menu || menu.querySelector('[data-profile-action=roles]:not([hidden])')) throw Error('Editing roles was offered without permission');
    })()`);
    await evaluate(`(async () => {
      document.querySelector('.profile-context-menu:popover-open')?.hidePopover();
      document.querySelector('[data-channel="291"]').click();
      const wait = async selector => {
        for (let i = 0; i < 180; i++) {
          const node = document.querySelector(selector);
          if (node) return node;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing ' + selector);
      };
      const own = await wait('[data-message="42"]');
      const other = await wait('[data-message="43"]');
      const options = own.querySelector('[data-message-options]');
      if (!options || own.querySelector('[data-delete-message]') || other.querySelector('[data-delete-message]')) {
        throw Error('Message rows must offer deletion through the options menu only');
      }
      const rowBounds = own.getBoundingClientRect();
      const buttonBounds = options.getBoundingClientRect();
      if (Math.abs(rowBounds.top + rowBounds.height / 2 - buttonBounds.top - buttonBounds.height / 2) > 1) {
        throw Error('The options button is not vertically centered on the message');
      }
      other.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 640, clientY: 400 }));
      const actions = await wait('.message-context-menu:popover-open');
      if ([...actions.querySelectorAll('button')].map(button => button.textContent.trim()).join('|')
          !== 'Responder|Encaminhar|Copiar texto') throw Error('Unexpected actions on another member’s message');
      actions.querySelector('[data-message-action=reply]').click();
      if (!document.querySelector('[data-chat-reply]:not([hidden])').textContent.includes('Mensagem de outra pessoa')) {
        throw Error('Reply did not quote the selected message');
      }
      document.querySelector('[data-chat-reply] button').click();
      const openDelete = async () => {
        options.click();
        (await wait('.message-context-menu:popover-open [data-message-action=delete]')).click();
      };
      await openDelete();
      const dialog = await wait('dialog[open]:has(#message-delete-title)');
      dialog.querySelector('[value=cancel]').click();
      await new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
      if (!own.isConnected) throw Error('Cancel removed the message');
      await openDelete();
      (await wait('dialog[open]:has(#message-delete-title) [value=delete]')).click();
      for (let i = 0; i < 180 && own.isConnected; i++) await new Promise(resolve => setTimeout(resolve, 25));
      if (own.isConnected || !other.isConnected) throw Error('Confirmed deletion removed the wrong message');
    })()`);
    assert.deepEqual(chatDeletes, [{ channel: 291, id: 42 }]);
    const pastedBytes = await evaluate(`(async () => {
      const form = document.querySelector('.chat .composer');
      const input = form.querySelector('[name=message]');
      const canvas = document.createElement('canvas');
      canvas.width = 24;
      canvas.height = 12;
      const painting = canvas.getContext('2d');
      painting.fillStyle = '#7b4aa3';
      painting.fillRect(0, 0, 24, 12);
      const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const clipboard = new DataTransfer();
      clipboard.items.add(new File([image], 'imagem.png', { type: image.type }));
      const paste = () => input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
      const draft = form.querySelector('[data-chat-attachment]');
      const preview = draft.querySelector('img');
      const text = new DataTransfer();
      text.setData('text/plain', 'texto simples');
      if (!input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: text, bubbles: true, cancelable: true }))) {
        throw Error('Plain text paste was intercepted');
      }
      if (paste() || draft.hidden || draft.querySelector('span').textContent !== 'imagem.png') {
        throw Error('The pasted image was not attached to the composer');
      }
      await preview.decode();
      if (preview.hidden || preview.naturalWidth !== 24 || preview.naturalHeight !== 12 ||
          !preview.getClientRects().length || preview.getBoundingClientRect().bottom >= input.getBoundingClientRect().top) {
        throw Error('The image preview was not displayed above the message before sending');
      }
      const originalUrl = preview.src;
      const picker = form.querySelector('[name=media]');
      picker.files = clipboard.files;
      picker.dispatchEvent(new Event('change'));
      await preview.decode();
      if (preview.hidden || preview.src === originalUrl || await fetch(originalUrl).then(() => true, () => false)) {
        throw Error('Replacing an attachment through the file picker left a stale preview');
      }
      const replacedUrl = preview.src;
      draft.querySelector('button').click();
      if (!draft.hidden || preview.hasAttribute('src') || await fetch(replacedUrl).then(() => true, () => false)) {
        throw Error('The pasted attachment preview could not be removed');
      }
      input.value = 'Imagem copiada';
      paste();
      await preview.decode();
      form.requestSubmit();
      for (let i = 0; i < 160 && !draft.hidden; i++) await new Promise(resolve => setTimeout(resolve, 25));
      if (!draft.hidden || preview.hasAttribute('src') || input.value) throw Error('The pasted image was not sent and cleared');
      return Array.from(new Uint8Array(await image.arrayBuffer()));
    })()`);
    assert.deepEqual(chatUploads, [{ channel: 291, text: 'Imagem copiada', name: 'imagem.png', type: 'image/png', bytes: pastedBytes }]);
    const moderatorRole = guild.roles.find(role => role.id === 295);
    guild.members[0].roles = [moderatorRole];
    const moderatorAction = visible => evaluate(`(async () => {
      window.dispatchEvent(new Event('focus'));
      for (let i = 0; i < 160; i++) {
        const row = document.querySelector('[data-message="43"]');
        row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 640, clientY: 400 }));
        const menu = document.querySelector('.message-context-menu:popover-open');
        const canDelete = Boolean(menu?.querySelector('[data-message-action=delete]'));
        menu?.hidePopover();
        if (menu && canDelete === ${visible}) return true;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return false;
    })()`);
    assert.equal(await moderatorAction(true), true, 'Granting the role did not enable message deletion in the open chat');
    guild.members[0].roles = [];
    assert.equal(await moderatorAction(false), true, 'Revoking the role did not remove the delete action');
    chatMessages.set(291, []);
    assert.equal(await evaluate(`(async () => {
      for (let i = 0; i < 160 && document.querySelector('[data-message="43"]'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return !document.querySelector('[data-message="43"]');
    })()`), true, 'A remote deletion was not reflected in the open chat');
    guild.admin = true;
    guild.permissions = 255;
    guildUnavailable = true;
    const beforeFailure = visits.length;
    await navigatePage();
    assert.equal(await evaluate(`(async () => {
      for (let i = 0; i < 180; i++) {
        if (document.querySelector('.chat-note')?.textContent.includes('Não foi possível carregar')) {
          return new URL(location.href).searchParams.get('servidor') === '29' && !document.querySelector('[data-channel]');
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return false;
    })()`), true, 'An unavailable guild was silently replaced with a different server');
    assert.deepEqual(visits.slice(beforeFailure), [29]);
    guildUnavailable = false;
    await navigatePage();
    assert.equal(await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 150; i++) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing ' + selector);
      };
      for (const [id, label, selector] of [
        [292, 'partidas', '[data-channel="292"]'],
        [293, 'Voz da guilda', '[data-voice-room="channel-293"]'],
      ]) {
        const gear = '[data-edit-channel="' + id + '"]';
        (await wait(gear)).click();
        const editor = await wait('.channel-editor-dialog[open]');
        const frame = editor.getBoundingClientRect();
        const header = editor.querySelector('.settings-header').getBoundingClientRect();
        if (Math.abs(header.left - frame.left - 1) > 1 || Math.abs(frame.right - header.right - 1) > 1) {
          throw Error('Channel editor header lost space to the scrollbar gutter');
        }
        const save = editor.querySelector('button[type=submit]').getBoundingClientRect();
        const deleteButton = editor.querySelector('[data-delete-channel]');
        const remove = deleteButton.getBoundingClientRect();
        const name = editor.querySelector('[name=name]').getBoundingClientRect();
        if (frame.width > 480 || Math.abs(save.top - remove.top) > 1 || Math.abs(save.left - name.left) > 1
            || remove.left - save.right !== 8 || remove.width !== 44 || remove.height !== 44
            || deleteButton.getAttribute('aria-label') !== 'Excluir canal' || !deleteButton.querySelector('svg')
            || deleteButton.textContent.trim()) {
          throw Error('Channel editor did not show left-aligned save and trash buttons');
        }
        (await wait('[data-delete-channel]')).click();
        const confirmation = await wait('.settings-confirm[open]');
        if (!confirmation.textContent.includes(label)) throw Error('The confirmation did not identify the channel');
        confirmation.querySelector('[value=cancel]').click();
        for (let i = 0; i < 150 && confirmation.isConnected; i++) await new Promise(resolve => setTimeout(resolve, 25));
        if (!document.querySelector(selector)) throw Error('Canceling removed the channel');
        (await wait('[data-delete-channel]')).click();
        (await wait('.settings-confirm[open] [value=delete]')).click();
        for (let i = 0; i < 150 && document.querySelector(gear); i++) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (document.querySelector(selector)) throw Error('A deleted channel is still displayed');
      }
      if (!document.querySelector('[data-channel="291"][aria-current=true]')) throw Error('The text chat did not switch to a remaining channel');

      const trigger = await wait('.server-heading > [data-open-invites]');
      const name = document.querySelector('.server-heading summary').getBoundingClientRect();
      const icon = trigger.getBoundingClientRect();
      if (icon.left < name.right || icon.height < 32) return false;
      let copied = '';
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(value) { copied = value; } } });
      trigger.click();
      const input = await wait('.server-invite-dialog input[readonly]');
      const button = await wait('.server-invite-dialog .server-invite button');
      const frame = input.closest('dialog').getBoundingClientRect();
      const header = input.closest('dialog').querySelector('.settings-header').getBoundingClientRect();
      if (Math.abs(header.left - frame.left - 1) > 1 || Math.abs(frame.right - header.right - 1) > 1) {
        throw Error('Server invite header lost space to the scrollbar gutter');
      }
      for (let i = 0; i < 150 && button.disabled; i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!input.value || document.querySelector('.server-invite-dialog select, .server-invite-dialog ul')) return false;
      button.click();
      await Promise.resolve();
      const shortcutWorks = copied === input.value && new URL(copied).searchParams.get('convite')?.length === 48;
      document.querySelector('.server-invite-dialog [data-close]').click();
      document.querySelector('[data-server-settings]').click();
      if (document.querySelector('[data-tab=invites]')) return false;
      document.querySelector('.server-dialog [data-close]').click();
      const summary = document.querySelector('.server-menu summary');
      summary.click();
      const menuInvite = await wait('.server-actions > [data-create-category] + [data-open-invites]');
      menuInvite.click();
      const menuInput = await wait('.server-invite-dialog[open] input');
      for (let i = 0; i < 150 && !menuInput.value; i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return shortcutWorks && menuInput.value === copied && !summary.parentElement.open;
    })()`), true, 'The server menu did not expose the same copyable invite link');
    assert.deepEqual(writes.slice(-2), [
      { action: 'shareInvite', server: 29 },
      { action: 'shareInvite', server: 29 },
    ]);

    assert.deepEqual(writes.filter(write => write.action === 'deleteChannel'), [
      { action: 'deleteChannel', server: 29, channel: 292, name: 'partidas' },
      { action: 'deleteChannel', server: 29, channel: 293, name: 'Voz da guilda' },
    ]);
    assert.deepEqual(guild.channels.map(channel => channel.id), [291]);
    assert.equal(entrance.channels.length, 3);

    guild.admin = false;
    guild.permissions = 0;
    guild.reservedRoles = [];
    await navigatePage();
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: false });
    assert.equal(await evaluate(`(async () => {
      for (let i = 0; i < 150 && !document.querySelector('[data-server="29"][aria-current=true]'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (document.querySelector('[data-server-settings], [data-delete-channel]')) return false;
      document.querySelector('.mobile-menu').click();
      document.querySelector('.server-menu summary').click();
      const trigger = document.querySelector('.server-actions > [data-open-invites]');
      if (!trigger.getClientRects().length) return false;
      trigger.click();
      const modal = document.querySelector('.server-invite-dialog');
      const field = modal.querySelector('input');
      const button = modal.querySelector('.server-invite button');
      for (let i = 0; i < 150 && button.disabled; i++) await new Promise(resolve => setTimeout(resolve, 25));
      const frame = modal.getBoundingClientRect();
      const link = field.getBoundingClientRect();
      const copy = button.getBoundingClientRect();
      return Boolean(field.value) && frame.left >= 0 && frame.right <= innerWidth
        && link.left >= frame.left && link.right < copy.left && copy.right < frame.right;
    })()`), true, 'A regular member could not open the mobile invitation shortcut');
    assert.deepEqual(writes.at(-1), { action: 'shareInvite', server: 29 });
    await command('Emulation.clearDeviceMetricsOverride');

    signedIn = false;
    await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 920, deviceScaleFactor: 1, mobile: false });
    await navigatePage(vite.resolvedUrls.local[0] + '?convite=' + guestInvitation);
    assert.equal(await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 160; i++) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing ' + selector);
      };
      await wait('#invite-title');
      if (document.querySelector('#invite-title').textContent !== 'Guilda atualizada') return false;
      (await wait('[data-invite-continue]')).click();
      for (const mode of ['register', 'login']) {
        (await wait('[data-mode=' + mode + ']')).click();
        const logo = await wait('.entry-logo');
        if (!logo.src.endsWith('/art/logo-principal.webp')) throw Error('The ' + mode + ' screen did not use the new Discordo logo');
        await logo.decode();
        const artwork = logo.getBoundingClientRect();
        if (artwork.width < 510 || artwork.bottom >= document.querySelector('.auth-box').getBoundingClientRect().top) {
          throw Error('The desktop logo was undersized or overlapped the ' + mode + ' form');
        }
      }
      const email = await wait('#email');
      const background = getComputedStyle(email.closest('.entry')).backgroundImage;
      if (!background.includes('/art/new-background.webp')) throw Error('Login did not use its original artwork');
      email.value = 'player@example.test';
      document.querySelector('#password').value = 'senha-valida';
      document.querySelector('.auth-form').requestSubmit();
      const code = await wait('#verification-code');
      code.value = '012345';
      code.form.requestSubmit();
      (await wait('[data-invite-continue]')).click();
      await wait('[data-server="29"][aria-current="true"]');
      const params = new URL(location.href).searchParams;
      return params.get('servidor') === '29' && !params.has('convite');
    })()`), true, 'The link did not survive login, verification and acceptance');
    assert.equal(acceptCount, 1);

    await navigatePage(vite.resolvedUrls.local[0]);
    await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 160; i++) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing ' + selector);
      };
      const create = await wait('[data-create-server]');
      if (document.querySelector('[data-join-server]')) throw Error('The removed join shortcut is still visible');
      create.disabled = false;
      create.click();
      const dialog = await wait('.server-create-dialog[open]');
      const header = dialog.querySelector('.settings-header').getBoundingClientRect();
      const bounds = dialog.getBoundingClientRect();
      if (bounds.width > 520 || bounds.width < 460 ||
          Math.abs(header.width - (bounds.width - 2)) > 1 ||
          dialog.scrollWidth > dialog.clientWidth) {
        throw Error('The create server dialog is oversized or its header is inset');
      }
      dialog.querySelector('[data-close]').click();
    })()`);

    await navigatePage(vite.resolvedUrls.local[0] + '?convite=' + expired);
    assert.equal(await evaluate(`(async () => {
      for (let i = 0; i < 150; i++) {
        if (document.querySelector('.invite-landing')) {
          return document.querySelector('.invite-landing').textContent.includes('Este convite expirou.')
            && !document.querySelector('[data-invite-continue]');
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return false;
    })()`), true, 'Expired invitation still offered acceptance');
    assert.equal(acceptCount, 1);

    signedIn = false;
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: false });
    await navigatePage(vite.resolvedUrls.local[0]);
    await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 160; i++) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing ' + selector);
      };
      (await wait('[data-mode=register]')).click();
      const artwork = document.querySelector('.entry-logo').getBoundingClientRect();
      if (artwork.width < 350 || artwork.left < 0 || artwork.right > innerWidth
        || artwork.bottom >= document.querySelector('.auth-box').getBoundingClientRect().top) {
        throw Error('The mobile registration logo was undersized or did not fit above the form');
      }
      document.querySelector('#email').value = 'player@example.test';
      document.querySelector('#name').value = 'Player';
      document.querySelector('#password').value = 'senha-valida';
      document.querySelector('#birth-date').value = '2000-01-01';
      document.querySelector('.auth-form').requestSubmit();
      const code = await wait('#verification-code');
      if (document.querySelector('.tutorial-card')) throw Error('Tour opened before verification');
      code.value = '012345';
      code.form.requestSubmit();
      const tour = await wait('.tutorial-card[open][data-step="0"]');
      const frame = tour.getBoundingClientRect();
      if (frame.left < 0 || frame.right > innerWidth || frame.bottom > innerHeight
          || Math.abs(frame.top + frame.height / 2 - innerHeight / 2) > 2) throw Error('The mobile welcome was not centered');
      if (tour.querySelector('[data-tutorial-skip]')
          || tour.dispatchEvent(new Event('cancel', { cancelable: true }))) throw Error('The first tour could be skipped');
      if (!getComputedStyle(tour, '::backdrop').backdropFilter.includes('blur')) throw Error('The tutorial backdrop was not blurred');
      const logo = tour.querySelector('img.tutorial-welcome-art');
      if (!logo || new URL(logo.src).pathname !== '/art/logo-principal.webp') throw Error('The welcome screen did not use the new Discordo logo');
      await logo.decode();
      tour.querySelector('[data-tutorial-next]').click();
      if (tour.dataset.step !== '0' || !tour.querySelector('.tutorial-content').getAnimations().length) {
        throw Error('The previous tutorial step vanished before its transition');
      }
      await wait('.tutorial-card[open][data-step="1"][data-anchored]');
      const settingsTarget = document.querySelector('.account-menu[open] [data-settings]').getBoundingClientRect();
      const spotlight = document.querySelector('.tutorial-spotlight').getBoundingClientRect();
      if (Math.abs(spotlight.top + 3 - settingsTarget.top) > 1 || Math.abs(spotlight.left + 3 - settingsTarget.left) > 1
          || tour.getBoundingClientRect().bottom > settingsTarget.top
          || tour.querySelector('[data-tutorial-next]').getBoundingClientRect().bottom > tour.getBoundingClientRect().bottom) {
        throw Error('The audio step did not highlight the real settings button on mobile');
      }
      if (tour.dataset.step !== '1' || !tour.querySelector('[data-profile-sound="entrySound"] [data-sound-action="record"]:disabled')) {
        throw Error('The tutorial did not show the actual sound controls in a demonstration');
      }
      if (!tour.querySelector('#tutorial-description').textContent.includes('os outros participantes da chamada ouvem')
          || tour.querySelector('[data-check-absence]')) {
        throw Error('The audio step did not explain who hears the call sounds separately');
      }
    })()`);
    await navigatePage();
    await evaluate(`(async () => {
      let tour;
      for (let i = 0; i < 160 && !tour; i++) {
        tour = document.querySelector('.tutorial-card[open][data-step="1"]');
        if (!tour) await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!tour) throw Error('Reloading skipped or reset the mandatory tutorial');
      tour.querySelector('[data-tutorial-next]').click();
      for (let i = 0; i < 160 && tour.dataset.step !== '2'; i++) await new Promise(resolve => setTimeout(resolve, 25));
      const voice = document.querySelector('[data-voice-room^="channel-"]').getBoundingClientRect();
      if (!tour.querySelector('.tutorial-voice-menu [data-voice-edit-roles] + [data-check-absence]:disabled')
          || !tour.querySelector('.tutorial-voice-person')?.textContent.includes('Discordo')
          || tour.querySelectorAll('.tutorial-voice-muted[aria-label="Microfone e fone silenciados"] svg').length !== 2
          || !tour.querySelector('#tutorial-description').textContent.includes('Só essa pessoa recebe o aviso')
          || Math.abs(document.querySelector('.tutorial-spotlight').getBoundingClientRect().top + 3 - voice.top) > 1) {
        throw Error('The second tutorial step did not explain and locate the absence check');
      }
      tour.querySelector('[data-tutorial-next]').click();
      for (let i = 0; i < 160 && tour.dataset.step !== '3'; i++) await new Promise(resolve => setTimeout(resolve, 25));
      const gameplay = document.querySelector('[data-open-gameplay]').getBoundingClientRect();
      const spotlight = document.querySelector('.tutorial-spotlight').getBoundingClientRect();
      if (!tour.hasAttribute('data-anchored') || Math.abs(spotlight.top + 3 - gameplay.top) > 1
          || Math.abs(spotlight.left + 3 - gameplay.left) > 1 || tour.getBoundingClientRect().top < gameplay.bottom) {
        throw Error('The Gameplay step did not highlight the real button');
      }
      if (tour.dataset.step !== '3' || !tour.querySelector('.gameplay-form [name=game]:disabled')
          || !tour.textContent.includes('enquete')) throw Error('The tutorial did not show Gameplay and its purpose');
      tour.querySelector('[data-tutorial-next]').click();
      for (let i = 0; i < 160 && tour.isConnected; i++) await new Promise(resolve => setTimeout(resolve, 25));
      if (tour.isConnected || document.querySelector('.tutorial-spotlight')) throw Error('The completed tour stayed open');
    })()`);

    await command('Emulation.clearDeviceMetricsOverride');
    await navigatePage();
    await evaluate(`(async () => {
      for (let i = 0; i < 160 && !document.querySelector('.account-menu [data-settings]'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (document.querySelector('.tutorial-card')) throw Error('A completed tour reopened after reload');
      document.querySelector('[data-account-profile]').click();
      const ownCard = document.querySelector('#member-profile:popover-open');
      if (!ownCard?.querySelector('[data-edit-profile]:not([hidden])')
          || !ownCard.querySelector('[data-card-switch-account]:not([hidden])')
          || ownCard.querySelector('[data-edit-member-roles]:not([hidden])')) {
        throw Error('The account profile offered the wrong actions');
      }
      ownCard.hidePopover();
      document.querySelector('.account-menu [data-settings]').click();
      const settings = document.querySelector('.user-settings[open]');
      settings.querySelector('[aria-controls=settings-account]').click();
      await Promise.resolve();
      const actions = [...settings.querySelectorAll('#settings-account .profile-photo-actions button')];
      const labels = actions.map(button => button.textContent.trim());
      if (labels.join(',') !== 'Tutorial,Trocar de conta,Sair,Excluir conta') throw Error('Account actions are in the wrong order');
      if (new Set(actions.map(button => button.getBoundingClientRect().top)).size !== 1) throw Error('Account actions did not fit on one line at desktop width');
      const waitFor = async predicate => {
        for (let attempt = 0; attempt < 50; attempt++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 40));
        }
        throw Error('Account details did not update');
      };
      const nav = settings.querySelector('[data-parent-tab=settings-account]');
      if (nav.inert || !settings.querySelector('[data-parent-tab=settings-profile]').inert) throw Error('Wrong settings subsection links are shown');
      nav.querySelector('[data-settings-jump=account-security]').click();
      if (document.activeElement.id !== 'account-security') throw Error('Security link did not navigate to its section');
      const email = settings.querySelector('[data-account-value=email]');
      if (email.textContent.includes('player@')) throw Error('Account email was shown before reveal');
      settings.querySelector('[data-account-reveal=email]').click();
      if (!email.textContent.includes('@') || email.textContent.includes('••')) throw Error('Account email reveal did not work');
      await waitFor(() => settings.querySelector('[data-account-session-count]').textContent === '2 sessões');
      settings.querySelector('[data-account-edit=sessions]').click();
      if (settings.querySelectorAll('.account-session-list button').length !== 1) throw Error('Current session could be revoked or another session was missing');
      settings.querySelector('.account-session-list button').click();
      await waitFor(() => settings.querySelector('[data-account-session-count]').textContent === '1 sessão');
      settings.querySelector('[data-account-edit=sessions]').click();
    })()`);
    await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 920, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(async () => {
      const settings = document.querySelector('.user-settings[open]');
      settings.querySelector('[aria-controls=settings-voice]').click();
      await Promise.resolve();
      const content = settings.querySelector('.settings-content');
      const label = () => settings.querySelector('[data-parent-tab=settings-voice] [aria-current]').dataset.settingsJump;
      const max = content.scrollHeight - content.clientHeight;
      const sounds = settings.querySelector('#voice-sounds-section');
      if (max < 10 || sounds.getBoundingClientRect().top - content.getBoundingClientRect().top <= max + 24) {
        throw Error('Voice fixture did not reproduce the unreachable final heading');
      }
      const visited = [];
      for (let y = 0; y <= max; y++) {
        content.scrollTop = y;
        content.dispatchEvent(new Event('scroll'));
        if (visited.at(-1) !== label()) visited.push(label());
      }
      if (visited.join(',') !== 'voice-input-section,voice-output-section,voice-sounds-section') {
        throw Error('Section indicator skipped a voice section: ' + visited.join(','));
      }
      settings.querySelector('[data-settings-jump=voice-output-section]').click();
      if (label() !== 'voice-output-section' || content.scrollTop >= max) throw Error('Clicking the middle section moved to the end');
      content.scrollTop = 0;
      content.dispatchEvent(new Event('scroll'));
      if (label() !== 'voice-input-section') throw Error('Scrolling back up did not restore the first section');
      settings.querySelector('[aria-controls=settings-account]').click();
    })()`);
    await command('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(async () => {
      const settings = document.querySelector('.user-settings[open]');
      const layout = settings.querySelector('.settings-layout');
      settings.querySelector('[data-settings-jump=account-security]').click();
      if (layout.scrollWidth > layout.clientWidth + 1 || document.activeElement?.id !== 'account-security') throw Error('Account sections are unusable on mobile');
      const markers = [...settings.querySelectorAll('[data-expanded] [data-settings-jump]')];
      if (markers.length < 2 || markers.some(link => getComputedStyle(link, '::before').width !== '20px')) {
        throw Error('Mobile sidebar indicators change width with the label');
      }

      const frame = settings.getBoundingClientRect();
      settings.querySelector('[aria-controls=settings-shortcuts]').click();
      await Promise.resolve();
      const shortcuts = settings.getBoundingClientRect();
      if (frame.top < 0 || frame.bottom > innerHeight || Math.abs(shortcuts.height - frame.height) > 1
        || Math.abs(shortcuts.top - frame.top) > 1 || settings.querySelector('#settings-shortcuts').hidden) {
        throw Error('Mobile settings resized, moved or overflowed after switching tabs');
      }
      settings.querySelector('[aria-controls=settings-account]').click();

    })()`);
    const desktopCss = await readFile(new URL('../desktop/titlebar.css', import.meta.url), 'utf8');
    await evaluate(`(() => {
      const style = document.createElement('style');
      style.id = 'desktop-window-style-test';
      style.textContent = ${JSON.stringify(desktopCss)};
      document.head.append(style);
    })()`);
    for (const [width, height, compact] of [[1280, 900, false], [1060, 780, true], [390, 480, true]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(() => {
        const dialog = document.querySelector('.user-settings[open]');
        const box = dialog.getBoundingClientRect();
        const close = dialog.querySelector('[data-close]').getBoundingClientRect();
        const backdropTop = Number.parseFloat(getComputedStyle(dialog, '::backdrop').top);
        if (box.top < 31 || box.bottom > innerHeight + 1 || close.top < box.top || close.right > box.right) {
          throw Error('Desktop settings overlap the window controls or extend outside the window');
        }
        if (backdropTop !== 31) throw Error('Desktop settings dim the window controls');
        if (${compact} ? (Math.abs(box.top - 31) > 1 || Math.abs(box.width - innerWidth) > 1 ||
          Math.abs(box.bottom - innerHeight) > 1) : (box.top < 47 || box.width >= innerWidth)) {
          throw Error('Desktop settings did not adapt to the window size');
        }
        const content = dialog.querySelector('.settings-content');
        content.scrollTop = 50;
        if (!content.scrollTop) throw Error('Desktop settings content cannot scroll');
      })()`);
    }
    await evaluate("document.querySelector('#desktop-window-style-test').remove()");
    await command('Emulation.clearDeviceMetricsOverride');
    await evaluate(`(async () => {
      const settings = document.querySelector('.user-settings[open]');
      settings.querySelector('[data-reopen-tutorial]').click();
      const welcome = document.querySelector('.tutorial-card[data-step="0"]');
      if (!welcome) throw Error('The settings shortcut did not reopen the tour');
      welcome.querySelector('[data-tutorial-skip]').click();
      if (document.querySelector('.tutorial-card[open]')) throw Error('Closing did not dismiss the reopened tour');
    })()`);
    returningToVerifiedAccount = true;
    await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 920, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 160; i++) {
          const element = document.querySelector(selector);
          if (element) return element;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing element: ' + selector);
      };
      document.querySelector('[data-account-profile]').click();
      (await wait('#member-profile:popover-open [data-card-switch-account]')).click();
      const email = await wait('#email');
      email.value = 'player@example.test';
      const password = document.querySelector('#password');
      password.value = 'senha-incorreta';
      email.form.requestSubmit();
      const feedback = await wait('.auth-form [role=status]:not([hidden])');
      if (!feedback.textContent.includes('não confere')) throw Error('Wrong password opened the known account');
      password.value = 'senha-valida';
      email.form.requestSubmit();
      await wait('.workspace');
      if (document.querySelector('#verification-code')) throw Error('A trusted login opened the verification form');
      const defaultWidth = document.querySelector('.channel-panel').getBoundingClientRect().width;
      document.querySelector('[data-open-friends]').click();
      const friends = await wait('.friends-page');
      const mural = friends.querySelector('.friends-mural');
      const chat = document.querySelector('.chat');
      if (getComputedStyle(mural).backgroundImage !== getComputedStyle(chat).backgroundImage ||
          !getComputedStyle(mural).backgroundImage.includes('/art/chat-parede-ultrawide.webp')) {
        throw Error('Friends must use the same continuous background as server chats');
      }
      const sidebar = friends.querySelector('.friends-sidebar');
      const bar = document.querySelector('.voice-account-bar').getBoundingClientRect();
      const rail = document.querySelector('.server-rail').getBoundingClientRect();
      const navigation = sidebar.getBoundingClientRect();
      if (navigation.width !== defaultWidth) throw Error('Friends did not use the default channel sidebar width');
      if (bar.left !== rail.left || bar.right !== navigation.right || bar.top !== navigation.bottom ||
          bar.top !== rail.bottom || document.querySelectorAll('[data-account-profile]').length !== 1) {
        throw Error('Friends must share the account bar across both sidebars');
      }
      if ([null, '::before', '::after'].some(layer => getComputedStyle(sidebar, layer).backgroundImage !== 'none')) {
        throw Error('Friends navigation should have a plain background');
      }
      const add = sidebar.querySelector('[data-add-friend]');
      if (friends.querySelector('.friends-page-heading button')) throw Error('The Friends header still contains an action');
      add.click();
      const searchPanel = document.getElementById(add.getAttribute('aria-controls'));
      if (searchPanel.hidden || document.activeElement.id !== 'friend-search') throw Error('The sidebar did not open friend search');
      add.click();
      if (!searchPanel.hidden) throw Error('The sidebar did not close friend search');
      const roster = friends.querySelector('[data-friend-list]');
      if (!friends.querySelector('[data-requests]').hidden || friends.querySelector('.friends-active')) {
        throw Error('The Friends overview still shows a removed panel');
      }
      friends.querySelector('[data-friends-tab="requests"]').click();
      const requestsPanel = await wait('[data-requests]:not([hidden])');
      const received = await wait('.friends-request-row');
      const nextReceived = received.nextElementSibling;
      if (!roster.hidden || friends.querySelector('[data-next-game], [data-available]') ||
          !requestsPanel.getClientRects().length ||
          !nextReceived || nextReceived.getBoundingClientRect().top <= received.getBoundingClientRect().bottom ||
          received.querySelectorAll('button svg').length !== 2 || !received.textContent.includes('Quer ser seu amigo')) {
        throw Error('Friend requests should be available only in the Requests view');
      }
      friends.querySelector('[data-friends-tab="all"]').click();
      friends.querySelector('[data-add-friend]').click();
      const search = friends.querySelector('[name=search]');
      search.value = 'bru';
      search.form.requestSubmit();
      (await wait('.friends-results [aria-label="Adicionar · Bruno"]')).click();
      friends.querySelector('[data-friends-tab="requests"]').click();
      await wait('[data-requests] [aria-label="Cancelar pedido · Bruno"]');
      (await wait('[data-requests] [aria-label="Aceitar · Ana"]')).click();
      friends.querySelector('[data-friends-tab="all"]').click();
      const ana = await wait('.friends-card-person[data-friend-id="2"]');
      if (!ana.querySelector('.friends-card-banner img') || !ana.querySelector('.avatar') ||
          !friends.querySelector('.friends-card-person[data-friend-id="35"]')) throw Error('All friends must have a profile card, including friends without banners');
      ana.click();
      const call = await wait('[data-start-call]:enabled');
      call.click();
      for (let i = 0; i < 160 && !document.querySelector('.friends-call-status').textContent.includes('Aguardando'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!document.querySelector('.friends-call-status').textContent.includes('Aguardando')) throw Error('The private voice call did not connect');
      call.click();
      const message = await wait('.friends-composer [name=message]');
      message.value = 'Olá <Ana>!';
      message.form.requestSubmit();
      if ((await wait('.friends-message[data-own-message] p')).textContent !== 'Olá <Ana>!') throw Error('Direct message was not shown as text');
      document.querySelector('[data-open-friends]').click();
    })()`);
    assert.equal(directMessages.at(0)?.text, 'Olá <Ana>!');
    assert.equal(privateVoiceRequests.includes('join'), true);
    const previousCalls = privateVoiceRequests.filter(action => action === 'join').length;
    await evaluate(`(async () => {
      const wait = async selector => {
        for (let i = 0; i < 180; i++) {
          const node = document.querySelector(selector);
          if (node) return node;
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        throw Error('Missing ' + selector);
      };
      const open = anchor => anchor.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 720, clientY: 140 }));
      const action = name => wait('.profile-context-menu:popover-open [data-profile-action=' + name + ']:not([hidden])');
      const member = await wait('[data-member="102"]');
      open(member);
      (await action('profile')).click();
      await wait('#member-profile:popover-open');
      open(member);
      (await action('invite')).dispatchEvent(new PointerEvent('pointerenter'));
      const guild = await wait('.profile-context-menu:popover-open .profile-invite-options:not([hidden]) button');
      if (guild.textContent !== '${guild.name}' || guild.parentElement.querySelectorAll('button').length !== 1) {
        throw Error('The invite submenu exposed a server the friend already shares');
      }
      guild.click();
      await wait('.profile-menu-status:not([hidden])');
      open(member);
      const message = await action('message');
      if (!message.closest('.profile-context-menu').querySelector('[data-profile-action=add]').hidden) {
        throw Error('The menu offered to add an existing friend');
      }
      message.click();
      const field = await wait('.friends-conversation:not([hidden]) [name=message]');
      if (document.activeElement !== field) throw Error('Message did not open the private composer');
      const link = await wait('.friends-conversation a[href*="convite="]');
      if (new URL(link.href).searchParams.get('convite') !== '${invitation}') throw Error('The saved private invite is not usable');
      document.querySelector('[data-open-friends]').click();
      open(member);
      (await action('call')).click();
      await wait('.friends-conversation [data-start-call][data-hangup]');
      for (let i = 0; i < 160 && !document.querySelector('.friends-call-status').textContent.includes('Aguardando'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!document.querySelector('.friends-call-status').textContent.includes('Aguardando')) throw Error('The profile call did not connect');
      document.querySelector('[data-open-friends]').click();
      document.querySelector('[data-open-friends]').click();
      open(await wait('.friends-card-person[data-friend-id="35"]'));
      const confirm = window.confirm;
      try {
        window.confirm = () => true;
        (await action('remove')).click();
        for (let i = 0; i < 160 && document.querySelector('.friends-card-person[data-friend-id="35"]'); i++) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (document.querySelector('.friends-card-person[data-friend-id="35"]')) throw Error('The removed friend stayed in the roster');
      } finally { window.confirm = confirm; }
    })()`);
    assert.deepEqual(profileInvites, [{ user: 2, server: 29 }]);
    assert.equal(privateVoiceRequests.filter(action => action === 'join').length, previousCalls + 1);
    const muralGeometry = () => evaluate(`(() => {
      const mural = document.querySelector('.friends-mural');
      const style = getComputedStyle(mural);
      return [style.backgroundPosition, style.backgroundSize, style.backgroundRepeat];
    })()`);
    const desktopMural = await muralGeometry();
    await command('Emulation.setDeviceMetricsOverride', { width: 2520, height: 1080, deviceScaleFactor: 1, mobile: false });
    assert.deepEqual(await muralGeometry(), desktopMural, 'The graffiti moved or scaled on an ultrawide screen');
    await evaluate(`document.querySelector('[data-open-friends]').click()`);
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(async () => {
      document.querySelector('.mobile-menu').click();
      const shortcut = document.querySelector('[data-open-friends]');
      if (!shortcut.getClientRects().length) throw Error('Friends shortcut is hidden in the mobile rail');
      shortcut.click();
      const dialog = document.querySelector('.friends-page');
      const mural = dialog.querySelector('.friends-mural');
      const style = getComputedStyle(mural);
      const size = parseFloat(style.backgroundSize.split(', ').at(-1));
      const artWidth = size * 1536 / 8192;
      if (mural.clientWidth < artWidth * .46 || artWidth * .38 > mural.clientHeight ||
          size * 2304 / 8192 < mural.clientHeight ||
          mural.getBoundingClientRect().top !== dialog.querySelector('.friends-sidebar').getBoundingClientRect().bottom) {
        throw Error('Mobile Friends must fit the full-size graffiti beneath its navigation');
      }
      const footer = document.querySelector('.voice-account-bar').getBoundingClientRect();
      if (footer.left !== 0 || footer.right !== innerWidth || footer.top !== dialog.getBoundingClientRect().bottom) {
        throw Error('The mobile Friends view must meet the full-width account bar');
      }
      for (let i = 0; i < 160 && !dialog.querySelector('[data-friend-id="2"]'); i++) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      const card = dialog.querySelector('.friends-card-person[data-friend-id="2"]');
      if (card.getBoundingClientRect().right > innerWidth) throw Error('The friend card overflows on mobile');
      card.click();
      const layout = dialog.querySelector('.friends-layout');
      const composer = dialog.querySelector('.friends-composer');
      if (layout.getClientRects().length || !composer.getClientRects().length || dialog.scrollWidth > dialog.clientWidth) {
        throw Error('The mobile direct conversation did not fit');
      }
      dialog.querySelector('.friends-back').click();
      if (!layout.getClientRects().length) throw Error('Back did not restore the mobile friends list');
      dialog.querySelector('[data-friends-tab="requests"]').click();
      if (dialog.querySelector('.friends-list').getClientRects().length ||
          dialog.querySelector('[data-requests]').getBoundingClientRect().right > innerWidth) {
        throw Error('The mobile requests tab should show the panel within the screen');
      }
      const back = dialog.querySelector('[data-friends-return]');
      if (!back.getClientRects().length) throw Error('Mobile Friends needs a return control in the sidebar');
      back.click();
      if (dialog.isConnected) throw Error('The mobile return control did not reopen the server');
    })()`);
  } catch (error) {
    console.error(error, { visits, writes });
    throw error;
  } finally {
    socket?.close();
    const closed = once(chrome, 'exit');
    chrome.kill();
    await closed;
    await vite.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
});


