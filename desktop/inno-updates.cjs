const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { lstat, mkdir, rename, rm } = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { selectRelease, releasesApi, interval } = require('./updates.cjs');

const installerName = 'Discordo-Instalador-Windows-x64.exe';

function selectInnoUpdate(releases, version) {
  return selectRelease(releases, version, assets => assets.find(asset =>
    asset.name === installerName && asset.state === 'uploaded' &&
    Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 512 * 1024 * 1024 &&
    /^sha256:[a-f0-9]{64}$/.test(asset.digest)));
}

async function verifiedInstaller(file, asset) {
  try {
    const stats = await lstat(file);
    if (!stats.isFile() || stats.size !== asset.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return `sha256:${hash.digest('hex')}` === asset.digest;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function downloadInstaller({ fetch, update, directory, signal, onProgress }) {
  const { asset, feed } = update;
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, installerName);
  const partial = file + '.part';
  if (await verifiedInstaller(file, asset)) {
    onProgress(100);
    return file;
  }

  await rm(partial, { force: true });
  const response = await fetch(`${feed}/${installerName}`, { signal, headers: { 'Accept-Encoding': 'identity' } });
  if (!response.ok || !response.body) throw Error(`Download do instalador falhou com HTTP ${response.status}.`);

  const hash = createHash('sha256');
  let bytes = 0;
  let percent = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > asset.size) return callback(Error('O instalador excedeu o tamanho publicado.'));
      hash.update(chunk);
      const next = Math.min(99, Math.floor(bytes * 100 / asset.size));
      if (next !== percent) onProgress(percent = next);
      callback(null, chunk);
    },
  });
  try {
    onProgress(0);
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(partial, { flags: 'wx' }), { signal });
    if (bytes !== asset.size || `sha256:${hash.digest('hex')}` !== asset.digest) {
      throw Error('O instalador não corresponde ao arquivo publicado.');
    }
    await rename(partial, file);
    onProgress(100);
    return file;
  } finally {
    await rm(partial, { force: true });
  }
}

function launchInstaller(file, directory) {
  return new Promise((resolve, reject) => {
    const installer = spawn(file, ['/SP-', '/VERYSILENT', '/NORESTART', '/NOCLOSEAPPLICATIONS',
      `/DIR=${directory}`, `/DISCORDOWAITPID=${process.pid}`, `/LOG=${path.join(path.dirname(file), 'update.log')}`],
    { detached: true, windowsHide: true, stdio: 'ignore' });
    installer.once('error', reject);
    installer.once('spawn', () => {
      installer.unref();
      resolve();
    });
  });
}

function startInnoUpdates({ app, net, window, showUpdateNotice, onStatus = () => {},
  install = launchInstaller, download = downloadInstaller, execPath = process.execPath }) {
  if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64') return;
  const lifetime = new AbortController();
  const directory = path.join(app.getPath('userData'), 'inno-updates');
  const version = app.getVersion();
  let state = { version, status: 'idle' };
  let pending;
  let restarting = false;
  const getState = () => state;
  function paint(status, availableVersion, downloadPercent) {
    state = { version, status, availableVersion, downloadPercent };
    if (!window.isDestroyed()) onStatus(state);
  }
  function failed(error) {
    if (lifetime.signal.aborted) return;
    pending = undefined;
    paint('error');
    console.error('Não foi possível atualizar o Discordo.', error);
  }
  async function restart() {
    if (!pending || state.status !== 'ready' || restarting || window.isDestroyed()) return;
    restarting = true;
    try {
      if (!await verifiedInstaller(pending.file, pending.asset)) throw Error('O instalador salvo foi alterado.');
      if (window.isDestroyed()) return;
      await install(pending.file, path.dirname(execPath));
      pending = undefined;
      app.quit();
    } catch (error) {
      failed(error);
    } finally {
      restarting = false;
    }
  }
  async function check() {
    if (['checking', 'downloading', 'ready'].includes(state.status) || window.isDestroyed()) return;
    paint('checking');
    try {
      const response = await net.fetch(releasesApi, { signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw Error(`GitHub respondeu com HTTP ${response.status}.`);
      const update = selectInnoUpdate(await response.json(), version);
      if (window.isDestroyed()) return;
      if (!update) {
        paint('current');
        await rm(path.join(directory, installerName), { force: true }).catch(() => {});
        return;
      }
      paint('downloading', update.version);
      const file = await download({ fetch: net.fetch.bind(net), update, directory,
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(15 * 60 * 1000)]),
        onProgress: percent => paint('downloading', update.version, percent) });
      if (window.isDestroyed()) return;
      pending = { file, asset: update.asset };
      paint('ready', update.version);
      if (await showUpdateNotice(window, update.version)) await restart();
    } catch (error) {
      failed(error);
    }
  }

  const firstCheck = setTimeout(check, 3000);
  const poll = setInterval(check, interval);
  window.once('closed', () => {
    lifetime.abort();
    clearTimeout(firstCheck);
    clearInterval(poll);
  });
  return { getState, check, restart };
}

module.exports = { startInnoUpdates, selectInnoUpdate, downloadInstaller };
