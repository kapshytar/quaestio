const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

contextBridge.exposeInMainWorld('electronAPI', {
  importCookies: (jsonContent) => ipcRenderer.invoke('import-cookies', jsonContent)
});
