import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findUpdate, startUpdates } = require('../desktop/updates.cjs');
const { measureDownload } = require('../desktop/update-download.cjs');

function release(version, options = {}) {
  return {
    tag_name: `desktop-v${version}`,
    draft: false,
    prerelease: version.includes('-'),
    assets: [{ name: 'RELEASES' }, { name: `Discordo-${version}-full.nupkg` }],
    ...options,
  };
}

test('Update selection ignores draft, unrelated and incomplete releases and keeps stable users on stable', () => {
  const releases = [
    release('0.2.1'),
    release('0.2.0-beta.1'),
    release('0.3.0-beta.10'),
    release('0.3.0-beta.2'),
    release('0.4.0', { draft: true }),
    release('0.5.0', { assets: [{ name: 'Discordo-Setup.exe' }] }),
    release('0.6.0', { tag_name: 'v0.6.0' }),
  ];
  const base = 'https://github.com/LGXsm/Discordo/releases/download/';
  assert.equal(findUpdate(releases, '0.2.0-beta.2'), base + 'desktop-v0.3.0-beta.10');
  assert.equal(findUpdate(releases, '0.2.0'), base + 'desktop-v0.2.1');
  assert.equal(findUpdate(releases, '0.2.1'), undefined);
});

test('Only the update package counts toward real download progress', async t => {
  const progress = [];
  const asset = 'Discordo-0.2.1-beta4-full.nupkg';
  let body;
  const downloads = await measureDownload({
    assets: [{ name: asset, size: 10 }],
    feed: 'https://updates.example.test',
    onProgress: percent => progress.push(percent),
    fetch: async url => {
      if (url.endsWith('/RELEASES')) return new Response('manifest');
      assert.equal(url, 'https://updates.example.test/' + asset);
      return new Response(new ReadableStream({
        start(controller) {
          body = controller;
          body.enqueue(Uint8Array.from([1, 2, 3, 4]));
        },
      }));
    },
  });
  t.after(() => downloads.close());
  assert.equal((await fetch(new URL('/RELEASES', downloads.url))).status, 404);
  assert.equal(await (await fetch(downloads.url + 'RELEASES?id=Discordo')).text(), 'manifest');
  assert.deepEqual(progress, []);
  const response = await fetch(downloads.url + asset);
  assert.deepEqual(progress, [0, 40]);
  body.enqueue(Uint8Array.from([5, 6, 7, 8, 9, 10]));
  body.close();
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(progress, [0, 40, 99, 100]);
});

for (const accept of [false, true]) test(`The Windows update notice handles ${accept ? 'Restart now' : 'Later'}`, {
  skip: process.platform !== 'win32' || process.arch !== 'x64',
  timeout: 2000,
}, async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const autoUpdater = new EventEmitter();
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  let feed;
  let checks = 0;
  let restarts = 0;
  let notices = 0;
  let progress;
  let closed = 0;
  const statuses = [];
  autoUpdater.setFeedURL = options => { feed = options.url; };
  const didCheck = Promise.withResolvers();
  autoUpdater.checkForUpdates = () => { checks++; didCheck.resolve(); };
  autoUpdater.quitAndInstall = () => { restarts++; };
  const app = { isPackaged: true, getVersion: () => '0.2.0-beta.2' };
  let requests = 0;
  const net = { fetch: async () => {
    requests++;
    return { ok: true, json: async () => [release('0.2.0-beta.3')] };
  } };
  const showUpdateNotice = async (parent, version) => {
    assert.equal(parent, window);
    assert.equal(version, '0.2.0-beta.3');
    notices++;
    return accept;
  };

  const updater = startUpdates({ app, autoUpdater, showUpdateNotice, net, window, onFirstRun: true,
    onStatus: state => statuses.push([state.status, state.downloadPercent]),
    openDownload: async ({ feed: upstream, onProgress }) => {
      assert.match(upstream, /desktop-v0\.2\.0-beta\.3$/);
      progress = onProgress;
      return { url: 'http://127.0.0.1:12345/feed/', close() { closed++; } };
    } });
  assert.equal(updater.getState().status, 'idle');
  updater.restart();
  assert.equal(restarts, 0);
  mock.timers.tick(14999);
  assert.equal(checks, 0);
  mock.timers.tick(1);
  await didCheck.promise;
  assert.equal(checks, 1);
  assert.equal(feed, 'http://127.0.0.1:12345/feed/');
  await updater.check();
  assert.equal(requests, 1);
  autoUpdater.emit('update-available');
  progress(42);
  progress(42);
  progress(100);
  await updater.check();
  assert.equal(requests, 1);

  autoUpdater.emit('update-downloaded');
  await Promise.resolve();
  assert.equal(notices, 1);
  assert.equal(restarts, Number(accept));
  assert.deepEqual(statuses, [['checking', undefined], ['downloading', undefined], ['downloading', 42],
    ['downloading', 100], ['ready', undefined]]);
  assert.equal(closed, 1);
  assert.equal(updater.getState().availableVersion, '0.2.0-beta.3');
  mock.timers.tick(30 * 60 * 1000);
  assert.equal(checks, 1);

  autoUpdater.emit('update-downloaded');
  await Promise.resolve();
  assert.equal(notices, 1);
  assert.equal(restarts, Number(accept));
  if (!accept) {
    updater.restart();
    assert.equal(restarts, 1);
  }
  window.emit('closed');
});
