const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ctl', {
  act: (name) => ipcRenderer.send('ctl-act', name),
  state: () => ipcRenderer.invoke('ctl-state'),
  onState: (fn) => ipcRenderer.on('ctl-state', (_e, s) => fn(s)),
});
