const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('stash', {
  boot: () => ipcRenderer.invoke('boot'),
  setInteractive: (v) => ipcRenderer.send('set-interactive', v),
  spriteBox: (b) => ipcRenderer.send('sprite-box', b),
  panelBox: (b) => ipcRenderer.send('panel-box', b),
  selfDrag: (v) => ipcRenderer.send('self-drag', v),
  idleSeconds: () => ipcRenderer.invoke('idle-seconds'),
  pluginUp: () => ipcRenderer.invoke('plugin-up'),
  setSetting: (k, v) => ipcRenderer.send('set-setting', k, v),
  setFocusable: (v) => ipcRenderer.send('focusable', v),
  quit: () => ipcRenderer.send('quit'),
  ingest: (payload) => ipcRenderer.invoke('ingest', payload),
  pathFor: (file) => webUtils.getPathForFile(file),
  // panel
  panelData: () => ipcRenderer.invoke('panel-data'),
  setCollection: (name) => ipcRenderer.invoke('set-collection', name),
  newCollection: (name) => ipcRenderer.invoke('new-collection', name),
  deleteItem: (id) => ipcRenderer.invoke('delete-item', id),
  reorder: (ids) => ipcRenderer.invoke('reorder', ids),
  sendNow: () => ipcRenderer.invoke('send-now'),
  toggleSync: () => ipcRenderer.invoke('toggle-sync'),
  openFigma: () => ipcRenderer.send('open-figma'),
  revealPlugin: () => ipcRenderer.send('reveal-plugin'),
  checkUpdates: () => ipcRenderer.invoke('check-updates'),
  dragAll: () => ipcRenderer.send('drag-all'),
  // clipboard prompt
  clipKeep: () => ipcRenderer.invoke('clip-keep'),
  clipDrop: () => ipcRenderer.send('clip-drop'),
  // settings
  setHotkey: (accel) => ipcRenderer.invoke('set-hotkey', accel),
  on: (channel, cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args)),
});
