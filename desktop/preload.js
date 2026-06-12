const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

contextBridge.exposeInMainWorld('electronAPI', {
  getAboutInfo: () => ipcRenderer.invoke('app-get-about-info'),
  importCookies: (jsonContent) => ipcRenderer.invoke('import-cookies', jsonContent),
  sendAggregated: (params) => ipcRenderer.invoke('dream-send-aggregated', params),
  sendMerge: (params) => ipcRenderer.invoke('dream-send-merge', params),
  sendClarification: (params) => ipcRenderer.invoke('dream-send-clarification', params),
  appendTraceArtifact: (traceId, eventPayload, files = []) =>
    ipcRenderer.invoke('dream-append-trace-artifact', { traceId, eventPayload, files }),
  readClipboardText: () => ipcRenderer.invoke('clipboard-read-text'),
  writeClipboardText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
  savePage: (pageContent, pageUrl) => ipcRenderer.invoke('save-page', { pageContent, pageUrl }),
  saveAllPages: (pages) => ipcRenderer.invoke('save-all-pages', pages),
  // Auth (multi-user)
  authSignIn: (email, password) => ipcRenderer.invoke('auth-sign-in', { email, password }),
  authSignOut: () => ipcRenderer.invoke('auth-sign-out'),
  authGetStatus: () => ipcRenderer.invoke('auth-get-status'),
  authConsumeSessionExpired: () => ipcRenderer.invoke('auth-consume-session-expired'),
  // Session management
  saveSession: (params) => ipcRenderer.invoke('dream-save-session', params),
  migrateSession: (params) => ipcRenderer.invoke('dream-migrate-session', params),
  loadSessions: (sessionId) => ipcRenderer.invoke('dream-load-sessions', sessionId),
  deleteSession: (sessionId) => ipcRenderer.invoke('dream-delete-session', sessionId),
  openSessionWindow: (session) => ipcRenderer.invoke('dream-open-session-window', session),
  listProjectTreeData: () => ipcRenderer.invoke('dream-list-project-tree-data'),
  getProjectSlotUrls: (projectId) => ipcRenderer.invoke('dream-get-project-slot-urls', projectId),
  onAppBackgroundModeChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, backgrounded) => callback(Boolean(backgrounded));
    ipcRenderer.on('app-background-mode-changed', listener);
    return () => ipcRenderer.removeListener('app-background-mode-changed', listener);
  },
  setAppBackgroundWorkActive: (busy) =>
    ipcRenderer.send('app-background-work-state-changed', Boolean(busy)),
});
