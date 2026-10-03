// Stash main process.
// One transparent, click-through, always-on-top overlay covers the primary display.
// The squirrel, toasts, panel and menus are drawn inside it, so movement is smooth CSS
// instead of moving a window around.
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, dialog, globalShortcut, nativeImage, powerMonitor, clipboard, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { Store, ingestDrop, ingestBuffer, pickFromDrop, sourceLabel } = require('./core/stash-core');
const { createServer } = require('./core/server');
const { Settings } = require('./settings');
const { createUpdater } = require('./updater');

const ICONS = path.join(__dirname, '..', '..', 'assets', 'icons');
const CATCH_RADIUS = 260; // how close a drag must get before the overlay starts catching it
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let win, tray, store, settings, bridge;
let interactive = false, dragNear = false, hidden = false;
let spriteBox = null, panelBox = null;
let lastPluginPoll = 0, pluginWasUp = false, forceSendUntil = 0;
let batch = null;
let updater = null;
let pendingClip = null;

const log = (...a) => console.log('[stash]', ...a);
const send = (ch, ...args) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); };
const pluginUp = () => Date.now() - lastPluginPoll < 5000;

// ---------- overlay window ----------
function display() { return screen.getPrimaryDisplay(); }

function applyMouseMode() {
  if (!win || win.isDestroyed()) return;
  if (interactive || dragNear) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
}

function createWindow() {
  const b = display().bounds;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: false, hasShadow: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); applyMouseMode(); });
  screen.on('display-metrics-changed', () => {
    win.setBounds(display().bounds);
    send('screen', screenInfo());
  });
}

function screenInfo() {
  const d = display();
  return { width: d.bounds.width, height: d.bounds.height, work: { x: d.workArea.x - d.bounds.x, y: d.workArea.y - d.bounds.y, width: d.workArea.width, height: d.workArea.height } };
}

// ---------- data the UI needs ----------
function activeCollection() {
  const names = store.collectionNames();
  let c = settings.get('activeCollection');
  if (!names.includes(c)) { c = names[0]; settings.set('activeCollection', c); }
  return c;
}

function counts() {
  const c = activeCollection();
  return { count: store.count(c), unsent: store.unsent().length, collection: c };
}

function panelData() {
  const c = activeCollection();
  const items = store.itemsFor(c).map((i) => ({
    id: i.id, url: pathToFileURL(store.imagePath(i)).href, w: i.w, h: i.h,
    source: i.source, sourceUrl: i.sourceUrl, sent: !!i.sentAt,
  }));
  return {
    collection: c, collections: store.collections(), items,
    unsent: store.unsent(c).length, sent: items.filter((i) => i.sent).length,
    pluginUp: pluginUp(), autoSync: !!settings.get('autoSync'),
  };
}

// Tell the renderer that something about the stash changed.
function changed() { send('counts', counts()); send('panel-dirty'); }

// ---------- Figma plugin file + updates ----------
// The plugin ships inside the installed app; friends import it once from this file.
const pluginManifest = () => (app.isPackaged ? path.join(process.resourcesPath, 'figma-plugin', 'manifest.json') : path.join(__dirname, '..', '..', 'figma-plugin', 'manifest.json'));
function revealPlugin() { if (!process.env.STASH_SELFTEST) shell.showItemInFolder(pluginManifest()); }

async function checkForUpdates(manual) {
  if (!updater) return;
  if (!updater.state.enabled) { if (manual) send('update', { type: 'off' }); return; }
  if (updater.state.downloaded) { if (manual) send('update', { type: 'downloaded', version: updater.state.downloaded }); return; }
  const r = await updater.check(manual);
  // 'available' is announced by the updater's own event (so it is not shown twice)
  if (manual && r.status !== 'available') send('update', { type: r.status === 'current' ? 'current' : 'error', version: r.version });
}

// ---------- tray ----------
function buildTrayMenu() {
  const roam = settings.get('roam');
  return Menu.buildFromTemplate([
    { label: hidden ? 'Show Stash' : 'Hide Stash', accelerator: 'Ctrl+Shift+S', click: toggleHidden },
    { label: 'Open stash', click: () => send('menu-action', 'open-stash') },
    { label: 'Settings', click: () => send('menu-action', 'settings') },
    { label: 'Show intro', click: () => send('menu-action', 'onboarding') },
    { label: 'Set up the Figma plugin...', click: () => { revealPlugin(); send('menu-action', 'plugin-setup'); } },
    { type: 'separator' },
    { label: 'Let Stash roam', type: 'checkbox', checked: settings.get('roamEnabled'), click: (i) => changeSetting('roamEnabled', i.checked) },
    { label: 'Roam how often', submenu: ['chill', 'normal', 'hyper'].map((r) => ({ label: r[0].toUpperCase() + r.slice(1), type: 'radio', checked: roam === r, click: () => changeSetting('roam', r) })) },
    { label: '15-minute patrol reminder', type: 'checkbox', checked: settings.get('patrolReminder'), click: (i) => changeSetting('patrolReminder', i.checked) },
    { label: 'Launch at startup', type: 'checkbox', checked: settings.get('launchAtStartup'), click: (i) => changeSetting('launchAtStartup', i.checked) },
    { type: 'separator' },
    ...(updater && updater.state.downloaded ? [{ label: 'Restart to update Stash', click: () => updater.install() }] : [{ label: 'Check for updates', click: () => checkForUpdates(true) }]),
    { label: 'Stash v' + app.getVersion(), enabled: false },
    { label: 'Quit Stash', click: () => app.quit() },
  ]);
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(ICONS, 'tray-color.png')).resize({ width: 32, height: 32 });
  tray = new Tray(img);
  tray.setToolTip('Stash');
  tray.setContextMenu(buildTrayMenu());
  tray.on('click', toggleHidden);
}
function refreshTray() { if (tray) tray.setContextMenu(buildTrayMenu()); }

function changeSetting(k, v) {
  if (!settings.set(k, v)) return;
  if (k === 'launchAtStartup') applyLoginItem();
  send('settings', settings.all());
  if (k === 'autoSync') send('panel-dirty');
  refreshTray();
}

// Only register a login item for the packaged app; in dev it would point at bare electron.exe.
function applyLoginItem() {
  if (!app.isPackaged || process.env.STASH_NO_LOGIN_ITEM) return;
  app.setLoginItemSettings({ openAtLogin: !!settings.get('launchAtStartup') });
}

function toggleHidden() {
  hidden = !hidden;
  if (hidden) win.hide(); else { win.showInactive(); send('summon'); }
  refreshTray();
}

// ---------- cursor feed ----------
// The overlay is click-through, and Windows does not reliably pass mouse movement to a click-through window.
// So we read the real cursor ourselves (about 60 times a second) and tell the page where it is.
function startCursorFeed() {
  let lx = null, ly = null;
  setInterval(() => {
    if (!win || win.isDestroyed() || hidden) return;
    const p = screen.getCursorScreenPoint(), b = display().bounds;
    const x = p.x - b.x, y = p.y - b.y;
    if (x === lx && y === ly) return;
    lx = x; ly = y;
    win.webContents.send('cursor', x, y);
  }, 16);
}

// ---------- global drag watcher ----------
// Windows gives apps no signal for drags that start in other windows, so we watch the
// mouse ourselves and only start catching drops when a drag gets near the squirrel or the open panel.
function startDragWatcher() {
  let uIOhook;
  try { ({ uIOhook } = require('uiohook-napi')); }
  catch (e) { log('drag watcher unavailable:', e.message); return; }
  let down = false, origin = null, dragging = false, releaseTimer = null;
  const setNear = (v) => {
    if (v === dragNear) return;
    dragNear = v; applyMouseMode(); send('drag-near', v);
  };
  uIOhook.on('mousedown', (e) => { if (e.button === 1) { down = true; dragging = false; origin = screen.getCursorScreenPoint(); clearTimeout(releaseTimer); } });
  uIOhook.on('mousemove', () => {
    if (!down || !spriteBox) return;
    const p = screen.getCursorScreenPoint();
    if (!dragging && Math.hypot(p.x - origin.x, p.y - origin.y) > 12) dragging = true;
    if (!dragging) return;
    const b = display().bounds;
    const cx = b.x + spriteBox.x + spriteBox.w / 2, cy = b.y + spriteBox.y + spriteBox.h / 2;
    let near = Math.hypot(p.x - cx, p.y - cy) < CATCH_RADIUS;
    if (!near && panelBox) {
      const m = 24;
      near = p.x >= b.x + panelBox.x - m && p.x <= b.x + panelBox.x + panelBox.w + m && p.y >= b.y + panelBox.y - m && p.y <= b.y + panelBox.y + panelBox.h + m;
    }
    setNear(near);
  });
  uIOhook.on('mouseup', (e) => {
    if (e.button !== 1) return;
    down = false; dragging = false;
    releaseTimer = setTimeout(() => setNear(false), 450); // let the drop event land first
  });
  uIOhook.start();
  app.on('will-quit', () => { try { uIOhook.stop(); } catch (_) { /* ignore */ } });
  log('drag watcher running');
}

// ---------- Figma bridge ----------
async function startBridge() {
  bridge = createServer(store, {
    log,
    onPoll: () => { lastPluginPoll = Date.now(); if (!pluginWasUp) { pluginWasUp = true; send('plugin', true); } },
    canSend: ({ auto, force }) => force || Date.now() < forceSendUntil || (auto && !!settings.get('autoSync')),
    getConfig: () => ({
      layout: settings.get('layout'), imageWidth: settings.get('imageWidth'), gap: settings.get('gap'),
      showSourceLinks: settings.get('showSourceLinks'), oneFramePerCollection: settings.get('oneFramePerCollection'),
    }),
    onAck: () => {
      if (!batch) { batch = { n: 0, timer: null }; send('sync', { phase: 'start' }); }
      batch.n++;
      clearTimeout(batch.timer);
      batch.timer = setTimeout(() => {
        const n = batch.n; batch = null;
        send('sync', { phase: 'done', n, ...counts() });
        if (settings.get('afterSync') === 'clear') clearSent();
        send('panel-dirty');
      }, 1400);
      changed();
    },
    approve: async () => {
      if (process.env.STASH_AUTOALLOW) return true;   // self-test only
      const { response } = await dialog.showMessageBox({
        type: 'question', buttons: ['Allow', 'Not now'], defaultId: 0, cancelId: 1,
        title: 'Stash', message: 'Figma wants to connect', detail: 'Allow the Stash plugin in Figma to pick up your saved images?',
      });
      return response === 0;
    },
  });
  try { log('bridge on port', await bridge.listen()); }
  catch (e) { dialog.showErrorBox('Stash', 'Port 47821 is busy, so Figma sync is off. Is another copy of Stash running?\n' + e.message); }
  // notice when the plugin goes away (it polls every second while open)
  setInterval(() => { if (pluginWasUp && !pluginUp()) { pluginWasUp = false; send('plugin', false); } }, 1500);
}

function clearSent() {
  const doomed = store.items.filter((i) => i.sentAt).map((i) => i.id);
  for (const id of doomed) store.remove(id);
  changed();
}

// ---------- clipboard: "Keep this image?" ----------
function startClipboardWatcher() {
  let lastCheap = null, lastFull = null, lastFullAt = 0, primed = false;
  const hashBitmap = (img) => {
    const bmp = img.toBitmap();
    const step = Math.max(1, Math.floor(bmp.length / 4096));
    const h = crypto.createHash('md5');
    for (let i = 0; i < bmp.length; i += step) h.update(bmp.subarray(i, i + 1));
    const s = img.getSize();
    return `${s.width}x${s.height}:${h.digest('hex')}`;
  };
  setInterval(() => {
    if (hidden || !win || win.isDestroyed()) return;
    let formats;
    try { formats = clipboard.availableFormats(); } catch (_) { return; }
    if (!formats.some((f) => f.startsWith('image/'))) { lastCheap = lastFull = null; primed = true; return; }
    const html = clipboard.readHTML();
    const cheap = formats.join(',') + '|' + html.slice(0, 400) + '|' + clipboard.readText().slice(0, 200);
    const now = Date.now();
    if (cheap === lastCheap && now - lastFullAt < 3000) return;   // same clipboard, recheck the pixels only every 3s
    lastCheap = cheap; lastFullAt = now;
    const img = clipboard.readImage();
    if (img.isEmpty()) return;
    const sig = hashBitmap(img);
    if (sig === lastFull) return;
    lastFull = sig;
    if (!primed) { primed = true; return; }                        // whatever was on the clipboard when Stash started
    onClipboardImage(img, html);
  }, 900);
}

async function onClipboardImage(img, html) {
  const { imageUrl } = pickFromDrop({ html });
  const source = imageUrl ? (sourceLabel(imageUrl) || 'a website') : 'your clipboard';
  const png = img.toPNG();
  pendingClip = { png, html, source };
  if (settings.get('askBeforeKeep')) {
    const t = img.resize({ width: 112 });
    send('clip-prompt', { thumb: t.toDataURL(), source });
  } else {
    send('ingested', await keepClip());
  }
}

async function keepClip() {
  const clip = pendingClip; pendingClip = null;
  if (!clip) return { status: 'error', message: 'nothing to keep', ...counts() };
  const collection = activeCollection();
  let r = null;
  if (clip.html) { try { r = await ingestDrop(store, { html: clip.html }, collection); } catch (_) { r = null; } }   // prefer the full-size original when the page's image link works
  if (!r || (r.status !== 'stashed' && r.status !== 'duplicate')) r = ingestBuffer(store, clip.png, { collection, source: clip.source });
  changed();
  return shape(r);
}

const shape = (r) => ({
  status: r.status, message: r.message, upgraded: r.upgraded,
  filePath: r.item ? store.imagePath(r.item) : null, ...counts(),
});

// ---------- IPC ----------
function wireIpc() {
  ipcMain.handle('boot', () => ({
    settings: settings.all(), screen: screenInfo(), ...counts(), version: app.getVersion(),
    spriteSize: 112,
    timeScale: Number(process.env.STASH_TIME_SCALE) || 1,   // test hook: >1 makes timers run faster
  }));
  ipcMain.on('set-interactive', (_e, v) => { interactive = !!v; applyMouseMode(); });
  ipcMain.on('sprite-box', (_e, b) => { spriteBox = b; });
  ipcMain.on('panel-box', (_e, b) => { panelBox = b; });
  ipcMain.handle('idle-seconds', () => powerMonitor.getSystemIdleTime());
  ipcMain.handle('plugin-up', () => pluginUp());
  ipcMain.on('set-setting', (_e, k, v) => changeSetting(k, v));
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('focusable', (_e, v) => { if (!win) return; win.setFocusable(!!v); if (v) win.focus(); });

  ipcMain.handle('ingest', async (_e, payload) => {
    const r = await ingestDrop(store, payload, activeCollection());
    changed();
    return shape(r);
  });

  // collection panel
  ipcMain.handle('panel-data', () => panelData());
  ipcMain.handle('set-collection', (_e, name) => {
    if (store.collectionNames().includes(name)) { settings.set('activeCollection', name); changed(); }
    return panelData();
  });
  ipcMain.handle('new-collection', (_e, name) => {
    const r = store.addCollection(name);
    if (r.ok) { settings.set('activeCollection', r.name); changed(); }
    return { ...r, data: panelData() };
  });
  ipcMain.handle('delete-item', (_e, id) => { store.remove(id); changed(); return panelData(); });
  ipcMain.handle('reorder', (_e, ids) => { store.reorder(activeCollection(), ids); send('panel-dirty'); return panelData(); });
  ipcMain.handle('send-now', () => { forceSendUntil = Date.now() + 60000; return { pluginUp: pluginUp(), unsent: store.unsent().length }; });
  ipcMain.handle('toggle-sync', () => { changeSetting('autoSync', !settings.get('autoSync')); return settings.get('autoSync'); });
  ipcMain.on('reveal-plugin', () => revealPlugin());
  ipcMain.handle('check-updates', () => checkForUpdates(true));
  ipcMain.on('open-figma', () => { shell.openExternal('figma://').catch(() => shell.openExternal('https://www.figma.com')); });

  // clipboard prompt
  ipcMain.handle('clip-keep', () => keepClip());
  ipcMain.on('clip-drop', () => { pendingClip = null; });

  // hotkey: only switch if the new combination can really be registered
  ipcMain.handle('set-hotkey', (_e, accel) => {
    const old = settings.get('hotkey');
    if (accel === old) return { ok: true };
    try {
      globalShortcut.unregister(old);
      if (globalShortcut.register(accel, toggleHidden)) { changeSetting('hotkey', accel); return { ok: true }; }
    } catch (_) { /* invalid accelerator */ }
    try { globalShortcut.register(old, toggleHidden); } catch (_) { /* keep going without it */ }
    return { ok: false };
  });

  // "Drag out all": copy the images to a plain temp folder with simple names, then start a native file drag.
  const DRAG_ROOT = path.join(os.tmpdir(), 'stash-drag');
  ipcMain.on('drag-all', (event) => {
    const items = store.itemsFor(activeCollection());
    if (!items.length) return;
    try { fs.rmSync(DRAG_ROOT, { recursive: true, force: true }); } catch (_) { /* a previous drag may still hold files */ }
    const dir = path.join(DRAG_ROOT, String(Date.now()));
    fs.mkdirSync(dir, { recursive: true });
    const files = items.map((it, n) => {
      const out = path.join(dir, `stash-${String(n + 1).padStart(2, '0')}.${it.ext}`);
      fs.copyFileSync(store.imagePath(it), out);
      return out;
    });
    let icon = nativeImage.createFromPath(files[0]);
    icon = icon.isEmpty() ? nativeImage.createFromDataURL(TINY_PNG) : icon.resize({ width: 64 });
    event.sender.startDrag({ file: files[0], files, icon });
  });
}

// ---------- test hooks (dev only) ----------
async function runSnapshots(dir) {
  const run = (js) => win.webContents.executeJavaScript(js);
  await new Promise((r) => setTimeout(r, 1200));
  const names = await run('window.__stash.stateNames()');
  const box = await run('window.__stash.box()');
  const pad = 70;
  const rect = { x: Math.max(0, Math.round(box.x - pad)), y: Math.max(0, Math.round(box.y - pad)), width: Math.round(box.w + pad * 2), height: Math.round(box.h + pad * 2) };
  for (let i = 0; i < names.length; i++) {
    await run(`window.__stash.show(${JSON.stringify(names[i])})`);
    await new Promise((r) => setTimeout(r, 450));
    const img = await win.webContents.capturePage(rect);
    fs.writeFileSync(path.join(dir, `state-${String(i + 1).padStart(2, '0')}-${names[i].replace(/\s+/g, '_')}.png`), img.toPNG());
  }
  log('snapshots done');
  app.quit();
}

// ---------- boot ----------
app.whenReady().then(async () => {
  if (!process.env.STASH_MULTI && !app.requestSingleInstanceLock()) return app.quit();
  const dataDir = process.env.STASH_DATA || app.getPath('userData');
  store = new Store(path.join(dataDir, 'data'));
  settings = new Settings(dataDir);
  log('data', dataDir, '| items', store.items.length);
  wireIpc();
  createWindow();
  createTray();
  applyLoginItem();
  updater = createUpdater({
    app, log,
    notify: (e) => { send('update', e); refreshTray(); },
  });
  refreshTray();
  if (!process.env.STASH_SELFTEST && updater.start) updater.start();
  if (!process.env.STASH_NO_BRIDGE) await startBridge();
  startDragWatcher();
  startCursorFeed();
  if (!process.env.STASH_SELFTEST) startClipboardWatcher();
  const hk = settings.get('hotkey');
  try { if (!globalShortcut.register(hk, toggleHidden)) log('hotkey busy:', hk); } catch (e) { log('bad hotkey', hk); }
  if (process.env.STASH_SNAPSHOTS) win.webContents.once('did-finish-load', () => runSnapshots(process.env.STASH_SNAPSHOTS));
  if (process.env.STASH_SELFTEST) {
    win.webContents.once('did-finish-load', async () => {
      let ok = false;
      try { ok = await require('./selftest').run({ win, send, outDir: process.env.STASH_SELFTEST_OUT, ctx: { store, settings, onClipboardImage, nativeImage } }); }
      catch (e) { console.log('selftest crashed:', e); }
      app.exit(ok ? 0 : 1);
    });
  }
});

app.on('second-instance', () => { if (hidden) toggleHidden(); else send('summon'); });
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (bridge) bridge.close(); });
