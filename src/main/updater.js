// Auto-update via electron-updater. It only runs in the installed app, and only once the release
// location is real (the placeholder GitHub name in package.json is replaced, see RELEASING.md).
// For testing, STASH_UPDATE_URL points it at any folder that serves latest.yml.
const fs = require('fs');
const path = require('path');

function readFeed(app) {
  if (process.env.STASH_UPDATE_URL) return { kind: 'url', url: process.env.STASH_UPDATE_URL };
  if (!app.isPackaged) return null;
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    if (/REPLACE/i.test(yml)) return null;            // placeholder owner: updates are not set up yet
    return { kind: 'file' };
  } catch (_) { return null; }
}

function createUpdater({ app, notify, log }) {
  const feed = readFeed(app);
  const state = { enabled: !!feed, downloaded: null, checking: false };
  if (!feed) return { state, check: async () => ({ status: 'off' }), install() {} };

  const { autoUpdater } = require('electron-updater');
  autoUpdater.logger = { info: log, warn: log, error: log, debug() {} };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (feed.kind === 'url') { autoUpdater.setFeedURL({ provider: 'generic', url: feed.url }); autoUpdater.forceDevUpdateConfig = true; }

  autoUpdater.on('update-available', (i) => notify({ type: 'available', version: i.version }));
  autoUpdater.on('update-downloaded', (i) => { state.downloaded = i.version; notify({ type: 'downloaded', version: i.version }); });
  autoUpdater.on('error', (e) => log('updater error: ' + (e && e.message)));

  async function check(manual) {
    if (state.checking) return { status: 'busy' };
    state.checking = true;
    try {
      const r = await autoUpdater.checkForUpdates();
      const newer = r && r.updateInfo && r.updateInfo.version && r.updateInfo.version !== app.getVersion() && (r.isUpdateAvailable !== false);
      return { status: newer ? 'available' : 'current', version: r && r.updateInfo && r.updateInfo.version };
    } catch (e) { log('update check failed: ' + e.message); return { status: manual ? 'error' : 'quiet' }; }
    finally { state.checking = false; }
  }

  return {
    state, check,
    install() { if (state.downloaded) autoUpdater.quitAndInstall(false, true); },
    // look once shortly after launch, then every 6 hours
    start() { setTimeout(() => check(false), 20000); setInterval(() => check(false), 6 * 3600 * 1000); },
  };
}

module.exports = { createUpdater, readFeed };
