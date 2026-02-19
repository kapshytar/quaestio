const { app, BrowserWindow, Menu, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_DATA_PATH = app.getPath('appData');
const FIXED_USER_DATA_PATH = path.join(APP_DATA_PATH, 'chat-aggregator');

// NOTE:
// Full profile-directory merge (including Local State / Network DBs) can break
// Chromium OS-crypt decryption and invalidate existing sessions.
// Keep fixed userData, but avoid auto-merging entire legacy profiles.
// Legacy session recovery is handled via cookie-level migration below.
app.setPath('userData', FIXED_USER_DATA_PATH);

// GPU acceleration enabled by default — needed for 4 webviews to not melt CPU.
// If you see a white screen on launch, uncomment the next line:
// app.disableHardwareAcceleration();

// Add switches to fix white screen / isolation issues
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('enable-mixed-content');
app.commandLine.appendSwitch('allow-running-insecure-content');

// Throttle background rendering to reduce idle CPU usage
app.commandLine.appendSwitch('disable-background-timer-throttling', 'false');
app.commandLine.appendSwitch('disable-renderer-backgrounding', 'false');

const { importCookiesFromJSON } = require('./cookie-import-simple');

let mainWindow;
let googleAuthWindow = null;
const IS_MAC = process.platform === 'darwin';

const DESKTOP_USER_AGENT = IS_MAC
  ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
  : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// Throttle all webviews when app is minimized/hidden to save CPU
function setAllWebviewsBackgrounded(backgrounded) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const { webContents } = require('electron');
    const allContents = webContents.getAllWebContents();
    for (const wc of allContents) {
      if (wc.getType() === 'webview') {
        // Electron's built-in throttling: slows timers, rAF, etc. when backgrounded
        wc.setBackgroundThrottling(true);
        // Mute audio when minimized (optional comfort)
        wc.setAudioMuted(backgrounded);
      }
    }
    console.log(`[Throttle] Webviews backgrounded=${backgrounded}, count=${allContents.filter(w => w.getType() === 'webview').length}`);
  } catch (err) {
    console.warn('[Throttle] Error:', err.message);
  }
}
const MAX_COOKIE_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;

function runRendererScript(script) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(script).catch((err) => {
    console.error('Failed to execute renderer script:', err);
  });
}

function notifyRenderer(message) {
  const safeMessage = JSON.stringify(String(message));
  runRendererScript(`window.alert(${safeMessage});`);
}

function reloadAllWebviews() {
  runRendererScript(`
    document.querySelectorAll('webview').forEach(wv => {
      wv.reload();
    });
  `);
}

function triggerFindInRenderer() {
  runRendererScript(`window.dispatchEvent(new Event('app-find'))`);
}

async function migrateLegacyPartitionsToShared() {
  const legacyPartitions = [
    'persist:slot-1',
    'persist:slot-2',
    'persist:slot-3',
    'persist:slot-4',
    'persist:chatgpt',
    'persist:claude',
    'persist:gemini',
    'persist:grok',
    'persist:deepseek',
    'persist:perplexity'
  ];

  const shared = session.fromPartition('persist:shared');
  const sharedCookies = await shared.cookies.get({});

  // Skip expensive migration work when shared already appears authenticated.
  const authCookieNames = new Set([
    'sessionKey',
    '__Secure-1PSID',
    '__Secure-next-auth.session-token',
    'auth_token',
    'oai-did'
  ]);
  const hasAuthCookies = sharedCookies.some(c => authCookieNames.has(c.name));
  if (hasAuthCookies || sharedCookies.length >= 80) {
    return;
  }

  let totalImported = 0;
  let totalFailed = 0;

  for (const partitionId of legacyPartitions) {
    try {
      const source = session.fromPartition(partitionId);
      const cookies = await source.cookies.get({});
      if (!cookies.length) {
        continue;
      }

      let importedFromPartition = 0;
      for (const cookie of cookies) {
        try {
          const host = String(cookie.domain || '').replace(/^\./, '');
          if (!host) continue;
          const scheme = cookie.secure ? 'https' : 'http';
          const cookiePath = cookie.path || '/';

          const details = {
            url: `${scheme}://${host}${cookiePath}`,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookiePath,
            secure: !!cookie.secure,
            httpOnly: !!cookie.httpOnly,
            sameSite: cookie.sameSite || 'no_restriction'
          };

          if (typeof cookie.expirationDate === 'number' && cookie.expirationDate > 0) {
            details.expirationDate = cookie.expirationDate;
          }

          await shared.cookies.set(details);
          importedFromPartition++;
        } catch (_) {
          totalFailed++;
        }
      }

      if (importedFromPartition > 0) {
        console.log(`[CookieMigration] ${partitionId} -> persist:shared : ${importedFromPartition} cookies`);
      }
      totalImported += importedFromPartition;
    } catch (err) {
      console.warn(`[CookieMigration] Failed reading ${partitionId}:`, err.message);
    }
  }

  if (totalImported > 0 || totalFailed > 0) {
    console.log(`[CookieMigration] Done. imported=${totalImported}, failed=${totalFailed}`);
  }
}

function openGoogleAuthWindow() {
  if (googleAuthWindow && !googleAuthWindow.isDestroyed()) {
    googleAuthWindow.focus();
    return;
  }

  googleAuthWindow = new BrowserWindow({
    width: 520,
    height: 760,
    autoHideMenuBar: true,
    title: 'Google Sign-In',
    parent: mainWindow,
    webPreferences: {
      partition: 'persist:shared',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Keep OAuth flow in this helper window.
  googleAuthWindow.webContents.setUserAgent(DESKTOP_USER_AGENT);
  googleAuthWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      googleAuthWindow.loadURL(url);
    }
    return { action: 'deny' };
  });

  googleAuthWindow.loadURL('https://accounts.google.com/');

  googleAuthWindow.on('closed', () => {
    googleAuthWindow = null;
    reloadAllWebviews();
    notifyRenderer('Google sign-in window closed. Webviews reloaded.');
  });
}

ipcMain.handle('import-cookies', async (event, jsonContent) => {
  console.log('Received import-cookies IPC message');

  if (typeof jsonContent !== 'string') {
    return { ok: false, message: 'Invalid payload: expected JSON string.' };
  }

  console.log('Content length:', jsonContent.length);

  if (Buffer.byteLength(jsonContent, 'utf8') > MAX_COOKIE_IMPORT_SIZE_BYTES) {
    return {
      ok: false,
      message: `File is too large. Max size is ${Math.round(MAX_COOKIE_IMPORT_SIZE_BYTES / 1024 / 1024)} MB.`
    };
  }

  try {
    const tempPath = path.join(app.getPath('temp'), 'temp-cookies.json');
    fs.writeFileSync(tempPath, jsonContent, 'utf8');

    const success = await importCookiesFromJSON(tempPath);

    try {
      fs.unlinkSync(tempPath);
    } catch (e) {
      // Ignore temp-file cleanup errors
    }

    if (!success) {
      return { ok: false, message: 'Failed to import cookies. Check console (F12) for details.' };
    }

    setTimeout(() => {
      console.log('Reloading all webviews with new cookies...');
      reloadAllWebviews();
    }, 2000);

    return { ok: true, message: 'Cookies imported. Webviews are reloading...' };
  } catch (err) {
    console.error('IPC import error:', err);
    return { ok: false, message: `Error: ${err.message}` };
  }
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      webSecurity: false,
      backgroundThrottling: true
    },
    backgroundColor: '#1a1a1a',
    title: 'Gunshi (alpha)',
    icon: path.join(__dirname, IS_MAC ? 'icon.png' : 'icon.ico')
  });

  mainWindow.loadFile('index.html');

  // ---- Throttle webviews when window is hidden/minimized to save CPU ----
  mainWindow.on('minimize', () => {
    setAllWebviewsBackgrounded(true);
  });
  mainWindow.on('restore', () => {
    setAllWebviewsBackgrounded(false);
  });
  mainWindow.on('hide', () => {
    setAllWebviewsBackgrounded(true);
  });
  mainWindow.on('show', () => {
    setAllWebviewsBackgrounded(false);
  });

  mainWindow.webContents.on('console-message', (event, level, message) => {
    const levelTag = ['LOG', 'WARN', 'ERR'][level] || 'LOG';
    console.log(`[renderer][${levelTag}] ${message}`);
  });

  let webviewCounter = 0;
  mainWindow.webContents.on('did-attach-webview', (event, webviewContents) => {
    webviewCounter++;
    const slotTag = `slot-${webviewCounter}`;
    webviewContents.setUserAgent(DESKTOP_USER_AGENT);

    webviewContents.on('console-message', (event, level, message) => {
      if (level >= 2) {
        const levelTag = ['LOG', 'WARN', 'ERR'][level] || 'LOG';
        console.log(`[webview:${slotTag}][${levelTag}] ${message}`);
      }
    });

    webviewContents.setWindowOpenHandler(({ url }) => {
      console.log(`[webview:${slotTag}] Window open request: ${url}`);

      // OAuth flows (Google, etc.) require real popup behavior.
      // Denying + redirecting into the same webview can break login.
      if (!url || !/^https?:\/\//i.test(url)) {
        return { action: 'deny' };
      }

      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        }
      };
    });
  });

  const menuTemplate = [
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            triggerFindInRenderer();
          }
        },
        { type: 'separator' },
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Import Cookies from File...',
          accelerator: 'CmdOrCtrl+I',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              title: 'Select cookies.json file',
              filters: [
                { name: 'JSON Files', extensions: ['json'] },
                { name: 'All Files', extensions: ['*'] }
              ],
              properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
              const success = await importCookiesFromJSON(result.filePaths[0]);
              if (success) {
                reloadAllWebviews();
                notifyRenderer('Cookies imported. Webviews reloaded.');
              } else {
                notifyRenderer('Failed to import cookies. Check console for errors.');
              }
            }
          }
        },
        {
          label: 'Google Login Helper',
          accelerator: 'CmdOrCtrl+Shift+G',
          click: () => {
            openGoogleAuthWindow();
          }
        },
        {
          label: 'Reload All WebViews',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            reloadAllWebviews();
          }
        },
        { type: 'separator' },
        {
          label: 'Toggle DevTools',
          accelerator: 'F12',
          click: () => {
            mainWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => {
            runRendererScript(`
              SLOTS.forEach(async slot => {
                zoomLevels[slot] = Math.min(zoomLevels[slot] + 0.1, 3.0);
                await webviews[slot].setZoomFactor(zoomLevels[slot]);
                document.querySelector(\`[data-slot="\${slot}"] .zoom-level\`).textContent =
                  Math.round(zoomLevels[slot] * 100) + '%';
              });
            `);
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => {
            runRendererScript(`
              SLOTS.forEach(async slot => {
                zoomLevels[slot] = Math.max(zoomLevels[slot] - 0.1, 0.25);
                await webviews[slot].setZoomFactor(zoomLevels[slot]);
                document.querySelector(\`[data-slot="\${slot}"] .zoom-level\`).textContent =
                  Math.round(zoomLevels[slot] * 100) + '%';
              });
            `);
          }
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            runRendererScript(`
              SLOTS.forEach(async slot => {
                zoomLevels[slot] = 1.0;
                await webviews[slot].setZoomFactor(1.0);
                document.querySelector(\`[data-slot="\${slot}"] .zoom-level\`).textContent = '100%';
              });
            `);
          }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  if (process.env.OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  Promise.resolve()
    .then(() => migrateLegacyPartitionsToShared())
    .catch((err) => console.warn('[CookieMigration] Unexpected error:', err.message))
    .finally(() => createWindow());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
