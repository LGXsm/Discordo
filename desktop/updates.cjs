const semver = require('semver');

const releasesApi = 'https://api.github.com/repos/LGXsm/Discordo/releases?per_page=30';
const downloads = 'https://github.com/LGXsm/Discordo/releases/download';
const interval = 30 * 60 * 1000;

function findUpdate(releases, version) {
  const beta = semver.prerelease(version) !== null;
  let newest = version;
  let feed;
  for (const release of releases) {
    const candidate = /^desktop-v([\d.A-Za-z-]+)$/.exec(release.tag_name)?.[1];
    if (!candidate || !semver.valid(candidate) || !semver.gt(candidate, newest) ||
        release.draft || (!beta && (release.prerelease || semver.prerelease(candidate)))) continue;

    const assets = release.assets.map(asset => asset.name);
    if (!assets.includes('RELEASES') ||
        !assets.some(name => /^Discordo-[\d.A-Za-z-]+-full\.nupkg$/i.test(name))) continue;

    newest = candidate;
    feed = `${downloads}/${release.tag_name}`;
  }
  return feed;
}

function startUpdates({ app, autoUpdater, dialog, net, window, onFirstRun }) {
  if (!app.isPackaged || process.platform !== 'win32' || process.arch !== 'x64') return;
  let checking = false;
  let downloaded = false;
  let pendingVersion;

  function failed(error) {
    checking = false;
    console.error('Não foi possível atualizar o Discordo.', error);
  }

  async function check() {
    if (checking || downloaded) return;
    checking = true;
    try {
      const response = await net.fetch(releasesApi, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw Error(`GitHub respondeu com HTTP ${response.status}`);
      const feed = findUpdate(await response.json(), app.getVersion());
      if (!feed || window.isDestroyed()) {
        checking = false;
        return;
      }
      pendingVersion = feed.slice(feed.lastIndexOf('/desktop-v') + '/desktop-v'.length);
      autoUpdater.setFeedURL({ url: feed });
      autoUpdater.checkForUpdates();
    } catch (error) {
      failed(error);
    }
  }

  autoUpdater.on('error', failed);
  autoUpdater.on('update-not-available', () => { checking = false; });
  autoUpdater.on('update-downloaded', async () => {
    downloaded = true;
    checking = false;
    if (window.isDestroyed()) return;
    try {
      const { response } = await dialog.showMessageBox(window, {
        type: 'info',
        title: 'Atualização do Discordo',
        message: pendingVersion ? `A versão ${pendingVersion} está pronta.` : 'Uma atualização está pronta.',
        detail: 'Reinicie o Discordo para instalar agora ou deixe para a próxima vez que abrir o aplicativo.',
        buttons: ['Reiniciar agora', 'Mais tarde'],
        defaultId: 1,
        cancelId: 1,
      });
      if (response === 0 && !window.isDestroyed()) autoUpdater.quitAndInstall();
    } catch (error) {
      console.error(error);
    }
  });

  const firstCheck = setTimeout(check, onFirstRun ? 15000 : 3000);
  const poll = setInterval(check, interval);
  window.once('closed', () => {
    clearTimeout(firstCheck);
    clearInterval(poll);
  });
}

module.exports = { findUpdate, startUpdates };
