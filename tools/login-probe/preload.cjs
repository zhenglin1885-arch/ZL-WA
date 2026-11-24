const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('probe', {
  invoke: (action, ...args) => ipcRenderer.invoke('probe', action, ...args),
  onState: callback => ipcRenderer.on('probe-state', (_event, state) => callback(state)),
});
