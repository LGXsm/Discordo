import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const { findUpdate, startUpdates } = createRequire(import.meta.url)('../desktop/updates.cjs');

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

test('The Windows updater checks after startup and installs only on an explicit restart', {
  skip: process.platform !== 'win32' || process.arch !== 'x64',
}, async ({ mock }) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const autoUpdater = new EventEmitter();
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  let feed;
  let checks = 0;
  let restarts = 0;
  let notices = 0;
  autoUpdater.setFeedURL = options => { feed = options.url; };
  autoUpdater.checkForUpdates = () => { checks++; };
  autoUpdater.quitAndInstall = () => { restarts++; };
  const app = { isPackaged: true, getVersion: () => '0.2.0-beta.2' };
  const net = { fetch: async () => ({ ok: true, json: async () => [release('0.2.0-beta.3')] }) };
  let response = 1;
  const dialog = { showMessageBox: async () => { notices++; return { response }; } };

  startUpdates({ app, autoUpdater, dialog, net, window, onFirstRun: true });
  mock.timers.tick(14999);
  assert.equal(checks, 0);
  mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(checks, 1);
  assert.match(feed, /desktop-v0\.2\.0-beta\.3$/);

  autoUpdater.emit('update-downloaded');
  await Promise.resolve();
  assert.equal(notices, 1);
  assert.equal(restarts, 0);
  mock.timers.tick(30 * 60 * 1000);
  assert.equal(checks, 1);

  response = 0;
  autoUpdater.emit('update-downloaded');
  await Promise.resolve();
  assert.equal(restarts, 1);
  window.emit('closed');
});
