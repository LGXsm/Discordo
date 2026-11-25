const semver = require('semver');
const { measureDownload, packageName } = require('./update-download.cjs');

const releasesApi = 'https://api.github.com/repos/LGXsm/Discordo/releases?per_page=30';
const downloads = 'https://github.com/LGXsm/Discordo/releases/download';
const interval = 30 * 60 * 1000;

function selectUpdate(releases, version) {
  const beta = semver.prerelease(version) !== null;
  let newest = version;
  let update;
  for (const release of releases) {
    const candidate = /^desktop-v([\d.A-Za-z-]+)$/.exec(release.tag_name)?.[1];
    if (!candidate || !semver.valid(candidate) || !semver.gt(candidate, newest) ||
        release.draft || (!beta && (release.prerelease || semver.prerelease(candidate)))) continue;

    const assets = release.assets.map(asset => asset.name);
    if (!assets.includes('RELEASES') ||
        !assets.some(name => packageName.test(name))) continue;

    newest = candidate;
    update = { version: candidate, feed: `${downloads}/${release.tag_name}`, assets: release.assets };
  }
  return update;
}

function findUpdate(releases, version) {
  return selectUpdate(releases, version)?.feed;
}

function startUpdates({ app, autoUpdater, showUpdateNotice, net, window, onFirstRun,
  onStatus = () => {}, openDownload = measureDownload }) {
  if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64') return;
  let status = 'idle';
  let pendingVersion;
  let percent;
  let download;
  const getState = () => ({ version: app.getVersion(), status, availableVersion: pendingVersion, downloadPercent: percent });

  function setStatus(next) {
    status = next;
    if (!window.isDestroyed()) onStatus(getState());
  }

  function clearDownload() {
    download?.close();
    download = undefined;
    percent = undefined;
  }

  function failed(error) {
    clearDownload();
    pendingVersion = undefined;
    setStatus('error');
    console.error('Não foi possível atualizar o Discordo.', error);
  }

  async function check() {
    if (['checking', 'downloading', 'ready'].includes(status) || window.isDestroyed()) return;
    pendingVersion = undefined;
    setStatus('checking');
    try {
      const response = await net.fetch(releasesApi, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`GitHub respondeu com HTTP ${response.status}`);
      const update = selectUpdate(await response.json(), app.getVersion());
      if (window.isDestroyed()) return;
      if (!update) {
        setStatus('current');
        return;
      }
      pendingVersion = update.version;
      const measured = await openDownload({ ...update, fetch: net.fetch.bind(net), onProgress: next => {
        if (status !== 'downloading' || next === percent) return;
        percent = next;
        setStatus('downloading');
      } }).catch(() => undefined);
      if (window.isDestroyed()) { measured?.close(); return; }
      download = measured;
      autoUpdater.setFeedURL({ url: download?.url ?? update.feed });
      autoUpdater.checkForUpdates();
    } catch (error) {
      failed(error);
    }
  }

  autoUpdater.on('error', failed);
  autoUpdater.on('update-available', () => setStatus('downloading'));
  autoUpdater.on('update-not-available', () => {
    clearDownload();
    pendingVersion = undefined;
    setStatus('current');
  });
  function restart() {
    if (status === 'ready' && !window.isDestroyed()) autoUpdater.quitAndInstall();
  }
  autoUpdater.on('update-downloaded', async () => {
    if (status === 'ready') return;
    clearDownload();
    setStatus('ready');
    if (window.isDestroyed()) return;
    try {
      if (await showUpdateNotice(window, pendingVersion)) restart();
    } catch (error) {
      console.error(error);
    }
  });

  const firstCheck = setTimeout(check, onFirstRun ? 15000 : 3000);
  const poll = setInterval(check, interval);
  window.once('closed', () => {
    clearDownload();
    clearTimeout(firstCheck);
    clearInterval(poll);
  });
  return { getState, check, restart };
}

module.exports = { findUpdate, startUpdates };
