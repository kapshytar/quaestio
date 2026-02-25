const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

contextBridge.exposeInMainWorld('electronAPI', {
  importCookies: (jsonContent) => ipcRenderer.invoke('import-cookies', jsonContent),
  sendAggregated: (params) => ipcRenderer.invoke('dream-send-aggregated', params),
  sendMerge: (params) => ipcRenderer.invoke('dream-send-merge', params),
  sendClarification: (params) => ipcRenderer.invoke('dream-send-clarification', params),
  readClipboardText: () => ipcRenderer.invoke('clipboard-read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard-write-text', text)
});
