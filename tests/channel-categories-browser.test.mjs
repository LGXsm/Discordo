import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { launchTestChrome } from './browser-chrome.mjs';

test('Categories mix text and voice, support editing and moves, and respect server permissions', { timeout: 30000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'discordo-categories-ui-'));
  const fixture = id => ({ id, name: 'Servidor ' + id, hasIcon: false, admin: false, lobby: id === 1, permissions: 1,
    members: [], roles: [], categories: [{ id: 'text', name: 'Conversas' }, { id: 'voice', name: 'Chamadas' }],
    channels: [{ id: id * 10 + 1, name: 'geral', type: 'TEXTO', private: false, categoryId: 'text', position: 0 },
      { id: id * 10 + 2, name: 'Resenha', type: 'VOZ', private: false, categoryId: 'voice', position: 0 },
      { id: id * 10 + 3, name: 'jogos', type: 'TEXTO', private: false, categoryId: 'text', position: 1 }] });
  const lobby = fixture(1), guild = fixture(29);
  const baseline = JSON.stringify(lobby);
  const writes = [];
  const vite = await createServer({ logLevel: 'silent', server: { port: 0 }, plugins: [{ name: 'categories-fixture', configureServer(server) {
    server.middlewares.use('/category-test', (_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Categories</title>'); });
    server.middlewares.use('/category-state', (_request, response) => { response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(guild)); });
    server.middlewares.use('/servers.php', async (request, response) => {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks));
      writes.push(data);
      response.setHeader('Content-Type', 'application/json');
      if (data.server !== 29 || !(guild.permissions & 1)) { response.statusCode = 403; return response.end(JSON.stringify({ error: 'Sem permissão' })); }
      if (data.action === 'category') {
        const category = guild.categories.find(c => c.id === data.category);
        if (category) category.name = data.name; else guild.categories.push({ id: 'games', name: data.name });
      } else if (data.action === 'deleteCategory') {
        guild.categories = guild.categories.filter(c => c.id !== data.category);
        guild.channels.filter(c => c.categoryId === data.category).forEach(c => { c.categoryId = null; });
      } else if (data.action === 'moveChannel') {
        const channel = guild.channels.find(c => c.id === data.channel);
        if (!channel) { response.statusCode = 404; return response.end(JSON.stringify({ error: 'Outro servidor' })); }
        const ordered = guild.channels.filter(c => c.id !== channel.id && c.categoryId === data.category).sort((a,b) => a.position-b.position);
        const target = data.before == null ? ordered.length : ordered.findIndex(c => c.id === data.before);
        ordered.splice(target, 0, channel);
        ordered.forEach((c,position) => { c.categoryId = data.category; c.position = position; });
      } else if (data.action === 'moveCategory') {
        const category = guild.categories.find(c => c.id === data.category);
        guild.categories = guild.categories.filter(c => c !== category);
        const at = data.before == null ? guild.categories.length : guild.categories.findIndex(c => c.id === data.before);
        guild.categories.splice(at, 0, category);
      }
      response.end(JSON.stringify({ id: guild.id }));
    });
  } }] });
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

    await navigatePage(vite.resolvedUrls.local[0] + 'category-test');
    await evaluate(`(async () => {
      await import('/src/style.css');
      const { channelCategoriesMarkup, mountChannelCategories } = await import('/src/channel-categories.ts');
      const { openServerDialog } = await import('/src/servers.ts');
      const initial = ${JSON.stringify(guild)};
      let server = initial;
      let revision = 0;
      let dispose;
      const root = document.body.appendChild(document.createElement('main'));
      const render = () => {
        dispose?.();
        root.innerHTML = (server.permissions & 1 ? '<button data-create-category>Criar categoria</button>' : '')
          + '<div class="channel-list">' + channelCategoriesMarkup(server,
            channel => '<button class="channel" data-channel-kind="' + channel.type + '">' + channel.name + '</button>', '') + '</div>';
        dispose = mountChannelCategories(root, server, 'player@example.test', async id => {
          const response = await fetch('/fixture-layout?id=' + id);
          server = await response.json();
          render(); revision++;
        });
      };
      const original = window.fetch;
      window.fetch = async (url, options) => String(url).includes('/fixture-layout')
        ? Response.json(JSON.parse(await original('/category-state').then(r => r.text()))) : original(url, options);
      window.categoryTest = { root, render, setServer(next) { server = next; render(); }, revision: () => revision, server: () => server, openEditor: () => openServerDialog(root, 'edit-channel', async () => {}, server, 'channels', 292) };
      render();
    })()`);
    await evaluate(`(async () => {
      const t = window.categoryTest;
      const waitRevision = async old => {
        for (let i=0; i<100 && t.revision() === old; i++) await new Promise(r => setTimeout(r,20));
        if (t.revision() === old) throw Error('Organization was not refreshed');
      };
      const check = (value, message) => { if (!value) throw Error(message); };
      t.root.querySelector('[data-create-category]').click();
      const categoryDialog = t.root.querySelector('dialog');
      const titleBox = categoryDialog.querySelector('h2').getBoundingClientRect();
      const closeBox = categoryDialog.querySelector('[data-close]').getBoundingClientRect();
      const dialogBox = categoryDialog.getBoundingClientRect();
      check(Math.abs((titleBox.top + titleBox.bottom - closeBox.top - closeBox.bottom) / 2) <= 1,
        'Category close button is not on the same row as its title');
      check(titleBox.left - dialogBox.left >= 16 && dialogBox.right - closeBox.right >= 16,
        'Category header is pressed against the dialog border');
      let form = t.root.querySelector('dialog form');
      form.elements.name.value = 'Jogos';
      form.requestSubmit();
      await waitRevision(0);
      check(t.root.querySelector('[data-channel-category=games]'), 'New category is missing');
      const drop = id => {
        const item = t.root.querySelector('[data-channel-item="' + id + '"]');
        const transfer = new DataTransfer();
        item.dispatchEvent(new DragEvent('dragstart', { bubbles:true, dataTransfer:transfer }));
        t.root.querySelector('[data-category-items=games]').dispatchEvent(new DragEvent('drop', { bubbles:true, dataTransfer:transfer }));
      };
      drop(291); await waitRevision(1);
      drop(292); await waitRevision(2);
      const group = () => t.root.querySelector('[data-channel-category=games]');
      check(group().querySelector('[data-channel-kind=TEXTO]') && group().querySelector('[data-channel-kind=VOZ]'), 'Category cannot mix text and voice');
      check(!group().querySelector('[data-channel-direction], .channel-order-actions'), 'Removed channel arrows are still present');
      const secondChannel = group().querySelector('[data-channel-item="292"]');
      const firstChannel = group().querySelector('[data-channel-item="291"]');
      const reorderTransfer = new DataTransfer();
      secondChannel.dispatchEvent(new DragEvent('dragstart', { bubbles:true, dataTransfer:reorderTransfer }));
      const firstBounds = firstChannel.getBoundingClientRect();
      firstChannel.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer:reorderTransfer, clientY:firstBounds.top + 1 }));
      check(firstChannel.dataset.channelInsertion === 'before' && getComputedStyle(firstChannel, '::before').height === '3px'
        && getComputedStyle(firstChannel).outlineStyle === 'none', 'Dragging above a channel did not show only an insertion line');
      firstChannel.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer:reorderTransfer, clientY:firstBounds.bottom - 1 }));
      check(firstChannel.dataset.channelInsertion === 'after' && getComputedStyle(firstChannel, '::after').height === '3px',
        'Dragging below a channel did not move the insertion line');
      firstChannel.dispatchEvent(new DragEvent('dragleave', { bubbles:true, relatedTarget:document.body }));
      check(!t.root.querySelector('[data-channel-insertion]'), 'Insertion line stayed visible outside the channel list');
      firstChannel.dispatchEvent(new DragEvent('drop', { bubbles:true, dataTransfer:reorderTransfer, clientY:firstChannel.getBoundingClientRect().top + 1 }));
      check(!t.root.querySelector('[data-channel-insertion]'), 'Insertion line remained visible after drop');
      await waitRevision(3);
      check(group().querySelector('[data-channel-item]').dataset.channelItem === '292', 'Dragging did not reorder channels');
      group().querySelector('[data-category-direction="-1"]').click(); await waitRevision(4);
      check([...t.root.querySelectorAll('[data-channel-category]')].filter(node => node.dataset.channelCategory)[1].dataset.channelCategory === 'games', 'Category did not move above the previous one');
      group().querySelector('[data-collapse-category]').click();
      check(group().querySelector('[data-category-items]').hidden, 'Category did not collapse');
      t.render();
      check(group().querySelector('[data-category-items]').hidden, 'Collapsed state was lost');
      group().querySelector('[data-collapse-category]').click();
      const heading = () => group().querySelector('[data-collapse-category]');
      const context = title => title.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true, button:2 }));
      const openEdit = () => {
        const title = heading();
        const expanded = title.getAttribute('aria-expanded');
        check(!context(title), 'Category did not handle the right click');
        check(title.getAttribute('aria-expanded') === expanded, 'Right click collapsed the category');
        const edit = t.root.querySelector('.category-context-menu:popover-open [data-edit-category]');
        check(edit?.textContent.includes('Editar categoria'), 'The category menu did not offer editing');
        edit.click();
        check(!t.root.querySelector('.category-context-menu:popover-open'), 'The category menu remained open');
      };
      heading().focus();
      check(!group().querySelector('[data-edit-category]') && !t.root.querySelector('dialog[open]')
        && getComputedStyle(group().querySelector('.channel-category-tools')).opacity === '0',
        'Focusing the category title revealed controls');
      openEdit();
      t.root.querySelector('.category-editor-dialog [data-close]').click();
      check(!t.root.querySelector('dialog[open]') && getComputedStyle(group().querySelector('.channel-category-tools')).opacity === '0',
        'Closing the category editor left controls visible');
      openEdit();
      form = t.root.querySelector('dialog form'); form.elements.name.value = 'Partidas'; form.requestSubmit(); await waitRevision(5);
      check(group().querySelector('h2').textContent.includes('Partidas'), 'Category rename did not persist');
      t.openEditor();
      check(t.root.querySelector('.server-dialog [name=category]').value === 'games', 'Channel editor did not select its category');
      t.root.querySelector('.server-dialog [data-close]').click();
      await new Promise(r => setTimeout(r,30));
      openEdit();
      form = t.root.querySelector('dialog form'); form.querySelector('[data-delete-category]').click(); form.requestSubmit(); await waitRevision(6);
      check(!group() && t.root.querySelector('[data-channel-category=""] [data-channel-item="292"]'), 'Deleting a category removed its channels');
      const readOnly = { ...t.server(), permissions:0 };
      t.setServer(readOnly);
      check(context(t.root.querySelector('[data-collapse-category]')) && !t.root.querySelector('.category-context-menu:popover-open'),
        'An ordinary member could open the edit menu');
      check(!t.root.querySelector('[data-create-category], [data-edit-category], [data-channel-direction], [draggable=true]'), 'An ordinary member can organize channels');
      window.categoryTest.server = () => readOnly;
    })()`);
    assert.ok(writes.length >= 7 && writes.every(write => write.server === 29));
    assert.equal(JSON.stringify(lobby), baseline, 'Discordo Brasil changed while organizing another server');
    await command('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(() => {
      const t = window.categoryTest;
      t.setServer({ ...t.server(), permissions:1 });
      t.root.querySelector('[data-create-category]').click();
      const dialog = t.root.querySelector('dialog');
      const box = dialog.getBoundingClientRect();
      const heading = dialog.querySelector('h2').getBoundingClientRect();
      const close = dialog.querySelector('[data-close]').getBoundingClientRect();
      if (box.left < 0 || box.right > innerWidth || dialog.scrollWidth > dialog.clientWidth
        || Math.abs((heading.top + heading.bottom - close.top - close.bottom) / 2) > 1) {
        throw Error('Category dialog header breaks on mobile');
      }
      dialog.querySelector('[data-close]').click();
    })()`);

  } finally {
    socket?.close();
    const exited = once(chrome, 'exit'); chrome.kill(); await exited;
    await vite.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
