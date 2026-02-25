const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

contextBridge.exposeInMainWorld('electronAPI', {
  importCookies: (jsonContent) => ipcRenderer.invoke('import-cookies', jsonContent),
  sendAggregated: (params) => ipcRenderer.invoke('dream-send-aggregated', params),
  sendMerge: (params) => ipcRenderer.invoke('dream-send-merge', params),
  sendClarification: (params) => ipcRenderer.invoke('dream-send-clarification', params),
  readClipboardText: () => ipcRenderer.invoke('clipboard-read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
  savePage: (pageContent, pageUrl) => ipcRenderer.invoke('save-page', { pageContent, pageUrl }),
  saveAllPages: (pages) => ipcRenderer.invoke('save-all-pages', pages),
  // Session management
  saveSession: (params) => ipcRenderer.invoke('dream-save-session', params),
  loadSessions: (sessionId) => ipcRenderer.invoke('dream-load-sessions', sessionId),
  deleteSession: (sessionId) => ipcRenderer.invoke('dream-delete-session', sessionId),
});
