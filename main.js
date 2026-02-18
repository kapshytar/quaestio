const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// Lock userData path so renaming the app doesn't wipe sessions/cookies
app.setPath('userData', path.join(app.getPath('appData'), 'chat-aggregator'));

// Disable GPU acceleration to fix white screen issues on some Windows systems
app.disableHardwareAcceleration();

// Add switches to fix white screen / isolation issues
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('enable-mixed-content');
app.commandLine.appendSwitch('allow-running-insecure-content');

const { importCookiesFromJSON } = require('./cookie-import-simple');

let mainWindow;
let googleAuthWindow = null;
const MAX_COOKIE_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;
const CHROME_LIKE_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

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
  googleAuthWindow.webContents.setUserAgent(CHROME_LIKE_USER_AGENT);
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
      webSecurity: false
    },
    backgroundColor: '#1a1a1a',
    title: 'Gunshi (alpha)',
    icon: path.join(__dirname, 'icon.ico')
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.on('console-message', (event, level, message) => {
    const levelTag = ['LOG', 'WARN', 'ERR'][level] || 'LOG';
    console.log(`[renderer][${levelTag}] ${message}`);
  });

  let webviewCounter = 0;
  mainWindow.webContents.on('did-attach-webview', (event, webviewContents) => {
    webviewCounter++;
    const slotTag = `slot-${webviewCounter}`;
    webviewContents.setUserAgent(CHROME_LIKE_USER_AGENT);

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
  createWindow();

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
