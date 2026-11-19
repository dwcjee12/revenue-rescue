const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('RR_DESKTOP', true);
contextBridge.exposeInMainWorld('rrDesktop', { setServer: url => ipcRenderer.invoke('set-server', url), config: () => ipcRenderer.invoke('get-config') });
