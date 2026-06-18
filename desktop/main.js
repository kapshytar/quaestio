const { app, BrowserWindow, Menu, dialog, ipcMain, session, clipboard, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const authStore = require('./auth-store');
const { bearerOrNull } = require('./auth-gate');

const APP_DATA_PATH = app.getPath('appData');
const FIXED_USER_DATA_PATH = path.join(APP_DATA_PATH, 'chat-aggregator');
app.setName('Quaestio');

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

const { importCookiesFromJSON } = require('./cookie-import-simple');

let mainWindow;
let googleAuthWindow = null;
let webviewsBackgrounded = false;
let rendererHasActiveWebviewWork = false;
const lowPowerFrozenWebContents = new Set();
const lowPowerAttachedWebContents = new Set();
const IS_MAC = process.platform === 'darwin';
const gotSingleInstanceLock = app.requestSingleInstanceLock();

function getAppIconPath() {
  const suffix = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  const ext = IS_MAC ? 'png' : 'ico';
  return path.join(__dirname, `icon-${suffix}.${ext}`);
}

function refreshDockIcon() {
  if (IS_MAC && app.dock) {
    app.dock.setIcon(getAppIconPath());
  }
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed() && typeof win.setIcon === 'function') {
      win.setIcon(getAppIconPath());
    }
  });
}

const DESKTOP_USER_AGENT = IS_MAC
  ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
  : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

function getRuntimeAppVersion() {
  const baseVersion = String(app.getVersion() || '').trim() || '0.0.0';
  const gitMeta = getGitBuildMeta();
  const suffix = gitMeta ? `+${gitMeta.commitCount}.${gitMeta.shortSha}` : '';
  return app.isPackaged ? `${baseVersion}${suffix}` : `${baseVersion}${suffix}-dev`;
}

function getGitBuildMeta() {
  try {
    const shortSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const commitCount = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (!shortSha || !commitCount) return null;
    return { shortSha, commitCount };
  } catch (_) {
    return null;
  }
}

function extractRecentChangelogEntries(markdown, limit = 30) {
  const lines = String(markdown || '').split(/\r?\n/);
  const entries = [];
  let version = '';
  let section = '';
  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Accept both "## [1.2.3]" and bare "## 1.2.3" headings.
    const versionMatch = line.match(/^##\s+(?:\[([^\]]+)\]|(.+?))\s*$/);
    if (versionMatch) {
      version = (versionMatch[1] || versionMatch[2] || '').trim();
      section = '';
      continue;
    }
    const sectionMatch = line.match(/^###\s+(.+)/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const bulletMatch = line.match(/^-\s+(.+)/);
    if (!bulletMatch) continue;
    entries.push({
      version,
      section,
      text: bulletMatch[1].trim()
    });
    if (entries.length >= limit) break;
  }
  return entries;
}

function getDesktopAboutInfo() {
  const changelogPath = path.join(__dirname, 'CHANGELOG.md');
  const changelogMarkdown = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, 'utf8')
    : '';
  const gitMeta = getGitBuildMeta();
  return {
    appName: app.getName(),
    version: getRuntimeAppVersion(),
    baseVersion: String(app.getVersion() || '').trim() || '0.0.0',
    gitShortSha: gitMeta?.shortSha || '',
    gitCommitCount: gitMeta?.commitCount || '',
    changelogEntries: extractRecentChangelogEntries(changelogMarkdown, 30)
  };
}

function getAllGuestWebContents() {
  const { webContents } = require('electron');
  return webContents.getAllWebContents().filter((wc) => wc.getType() === 'webview');
}

async function setWebContentsLifecycle(wc, state) {
  if (!wc || wc.isDestroyed()) return false;
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach('1.3');
    lowPowerAttachedWebContents.add(wc.id);
  }
  await wc.debugger.sendCommand('Page.setWebLifecycleState', { state });
  return true;
}

async function freezeIdleWebview(wc) {
  if (!wc || wc.isDestroyed() || lowPowerFrozenWebContents.has(wc.id)) return;
  try {
    await setWebContentsLifecycle(wc, 'frozen');
    lowPowerFrozenWebContents.add(wc.id);
  } catch (err) {
    console.warn(`[Throttle] Freeze skipped for webview ${wc.id}:`, err?.message || err);
  }
}

async function resumeFrozenWebview(wc) {
  if (!wc || wc.isDestroyed() || !lowPowerFrozenWebContents.has(wc.id)) return;
  try {
    await setWebContentsLifecycle(wc, 'active');
  } catch (err) {
    console.warn(`[Throttle] Resume skipped for webview ${wc.id}:`, err?.message || err);
  } finally {
    lowPowerFrozenWebContents.delete(wc.id);
    try {
      if (lowPowerAttachedWebContents.has(wc.id) && wc.debugger.isAttached()) wc.debugger.detach();
    } catch (_) {}
    lowPowerAttachedWebContents.delete(wc.id);
  }
}

function broadcastBackgroundMode() {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send('app-background-mode-changed', webviewsBackgrounded);
    }
  });
}

async function applyWebviewsPowerState() {
  try {
    const guestContents = getAllGuestWebContents();
    const shouldFreeze = webviewsBackgrounded && !rendererHasActiveWebviewWork;
    const frameRate = webviewsBackgrounded ? 1 : 60;

    for (const wc of guestContents) {
      wc.setBackgroundThrottling(true);
      if (typeof wc.setFrameRate === 'function') {
        wc.setFrameRate(frameRate);
      }
      wc.setAudioMuted(webviewsBackgrounded);

      if (shouldFreeze) {
        await freezeIdleWebview(wc);
      } else {
        await resumeFrozenWebview(wc);
      }
    }

    console.log(`[Throttle] Webviews backgrounded=${webviewsBackgrounded}, busy=${rendererHasActiveWebviewWork}, frozen=${shouldFreeze}, count=${guestContents.length}`);
  } catch (err) {
    console.warn('[Throttle] Error:', err.message);
  }
}

// Throttle or freeze all webviews when app is minimized/hidden to save CPU/GPU.
function setAllWebviewsBackgrounded(backgrounded) {
  webviewsBackgrounded = !!backgrounded;
  broadcastBackgroundMode();
  applyWebviewsPowerState();
}
const MAX_COOKIE_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;
const DREAM_RPC_PATHS = {
  aggregated: '/rest/v1/rpc/ingest_aggregated_v1',
  merge: '/rest/v1/rpc/ingest_merge_v1',
  clarification: '/rest/v1/rpc/ingest_clarification_v1'
};
const DREAM_RPC_NAMES = {
  aggregated: 'ingest_aggregated_v1',
  merge: 'ingest_merge_v1',
  clarification: 'ingest_clarification_v1'
};
const DREAM_DEBUG_RPC_PATH = '/rest/v1/rpc/log_ingest_debug_v1';
const INGEST_DEBUG_SOURCE_PLATFORM_CODE = process.platform === 'win32'
  ? 'WIN'
  : process.platform === 'darwin'
    ? 'MAC'
    : process.platform === 'linux'
      ? 'LNX'
      : 'WEB';
const INGEST_DEBUG_APP_NAME = 'chat-aggregator-windows';
const DEFAULT_SUPABASE_URL = 'https://pphntxcslmbymvcwvhnr.supabase.co';
// Publishable (anon) key — NOT service_role. The ingest/session RPCs are
// SECURITY DEFINER and granted to anon, so the client never needs a secret key.
// NOTE: bjqkvlsneujrcfpvcvzf = OLD Sydney project (DELETED). The new EU/Frankfurt
// project is pphntxcslmbymvcwvhnr — do not revert this to the Sydney ref.
const DEFAULT_SUPABASE_SERVICE_ROLE_KEY = 'sb_publishable_ofhf4igULLa20waOrI34pA_LXqzvphb';

function parseEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key] && value) process.env[key] = value;
    }
  } catch (error) {
    console.warn('[env] failed to parse', filePath, error?.message || error);
  }
}

function loadSupabaseEnv() {
  const candidates = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', 'dream-tracker', '.env')
  ];
  candidates.forEach(parseEnvFile);
}

function getSupabaseConfig() {
  return {
    supabaseUrl:
      process.env.SUPABASE_URL ||
      process.env.DREAM_TRACKER_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      DEFAULT_SUPABASE_URL,
    serviceRoleKey:
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.DREAM_TRACKER_SERVICE_ROLE_KEY ||
      DEFAULT_SUPABASE_SERVICE_ROLE_KEY
  };
}

function logSessionRpc(message, meta = null) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`;
  try {
    const logsDir = path.join(__dirname, 'debug-runs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.appendFileSync(path.join(logsDir, 'session-rpc.log'), line, 'utf8');
  } catch (_) {
    // Ignore logging failure.
  }
  console.log(`[SessionRPC] ${message}`, meta || '');
}

loadSupabaseEnv();
{
  const cfg = getSupabaseConfig();
  logSessionRpc('Supabase config resolved', {
    hasUrl: Boolean(cfg.supabaseUrl),
    hasKey: Boolean(cfg.serviceRoleKey),
    url: cfg.supabaseUrl,
    keyPrefix: cfg.serviceRoleKey ? `${cfg.serviceRoleKey.slice(0, 12)}...` : ''
  });
  // serviceRoleKey here is actually the publishable/anon key (see comment at
  // its definition). Auth uses it as the `apikey` for the token endpoint.
  authStore.configure({ supabaseUrl: cfg.supabaseUrl, apikey: cfg.serviceRoleKey });
}

// Resolve the `Authorization: Bearer` token for Supabase calls: the signed-in
// user's access token when available (so backend owner_id triggers attribute
// rows to them), otherwise the publishable key (legacy anon behaviour).
// Multi-user gate: the user's JWT, or null when signed out. There is no
// publishable-key fallback — signed out means local-only, so callers must skip
// the backend entirely (no anonymous writes/reads). Mirrors the mobile
// AuthStore gate and shared/contracts/AUTH_AND_SESSION_SYNC.md.
async function userBearerOrNull() {
  try {
    return bearerOrNull(await authStore.getValidAccessToken());
  } catch (error) {
    console.warn('[auth] token resolution failed; treating as local-only:', error?.message || error);
    return null;
  }
}

class NotSignedInError extends Error {
  constructor() {
    super('Not signed in — local-only mode');
    this.code = 'NOT_SIGNED_IN';
  }
}

function getPrimaryWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  const all = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
  return all.length > 0 ? all[0] : null;
}

function runRendererScript(script, targetWindow = null) {
  const win = targetWindow || getPrimaryWindow();
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(script).catch((err) => {
    console.error('Failed to execute renderer script:', err);
  });
}

function runRendererScriptAll(script) {
  BrowserWindow.getAllWindows().forEach((win) => runRendererScript(script, win));
}

function notifyRenderer(message) {
  const safeMessage = JSON.stringify(String(message));
  runRendererScriptAll(`window.alert(${safeMessage});`);
}

function reloadAllWebviews() {
  runRendererScriptAll(`
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

  // Skip migration only when shared partition already looks authenticated.
  const authCookieNames = new Set([
    'sessionKey',
    '__Secure-1PSID',
    '__Secure-next-auth.session-token',
    'auth_token',
    'oai-did'
  ]);
  const sharedAuthCount = sharedCookies.filter(c => authCookieNames.has(c.name)).length;
  if (sharedAuthCount > 0) {
    return;
  }
  console.log(`[CookieMigration] shared has no known auth cookies (total=${sharedCookies.length}). Trying legacy partitions...`);

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
    parent: getPrimaryWindow() || undefined,
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

function stableStringify(obj) {
  const sort = (value) => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = sort(value[key]);
        return acc;
      }, {});
    }
    return value;
  };

  return JSON.stringify(sort(obj));
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function sanitizeTraceId(rawTraceId) {
  const normalized = String(rawTraceId || '').trim();
  if (normalized) return normalized;
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeSequence(rawSequence, fallbackValue = '') {
  const parsed = Number.parseInt(rawSequence, 10);
  if (Number.isInteger(parsed) && parsed > 0) return String(parsed);

  const fallback = String(fallbackValue || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  return fallback || '1';
}

function buildIdempotencyKey({ kind, sessionId, sequence, traceId }) {
  const sessionPart = Number.isInteger(sessionId) && sessionId > 0 ? String(sessionId) : 'tmp';
  return `windows:${kind}:${sessionPart}:${sequence}:${traceId}`;
}

function extractRpcSessionId(rpcResult) {
  if (Number.isInteger(rpcResult?.session_id)) return rpcResult.session_id;
  if (Array.isArray(rpcResult) && Number.isInteger(rpcResult[0]?.session_id)) return rpcResult[0].session_id;
  return null;
}

function ensureDebugRunsDir() {
  const cwdDir = path.join(process.cwd(), 'debug-runs');
  try {
    fs.mkdirSync(cwdDir, { recursive: true });
    return cwdDir;
  } catch (cwdError) {
    const fallbackDir = path.join(app.getPath('userData'), 'debug-runs');
    fs.mkdirSync(fallbackDir, { recursive: true });
    return fallbackDir;
  }
}

function appendDebugArtifact(traceId, eventPayload) {
  try {
    const dir = ensureDebugRunsDir();
    const safeTraceId = String(traceId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
    const artifactPath = path.join(dir, `${safeTraceId}.json`);
    const nowIso = new Date().toISOString();

    let artifact = null;
    if (fs.existsSync(artifactPath)) {
      try {
        artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      } catch (_) {
        artifact = null;
      }
    }

    if (!artifact || typeof artifact !== 'object') {
      artifact = {
        trace_id: traceId,
        source_platform_code: INGEST_DEBUG_SOURCE_PLATFORM_CODE,
        app_name: INGEST_DEBUG_APP_NAME,
        app_version: getRuntimeAppVersion(),
        created_at: nowIso,
        updated_at: nowIso,
        events: []
      };
    }

    artifact.updated_at = nowIso;
    if (!Array.isArray(artifact.events)) artifact.events = [];
    artifact.events.push({
      ts: nowIso,
      ...eventPayload
    });

    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');
  } catch (error) {
    console.warn('[IngestDebug] Failed to write local artifact:', error?.message || error);
  }
}

async function emitIngestDebugEvent({ supabaseUrl, serviceRoleKey, eventPayload }) {
  const payload = {
    trace_id: eventPayload?.trace_id || sanitizeTraceId(),
    source_platform_code: INGEST_DEBUG_SOURCE_PLATFORM_CODE,
    app_name: INGEST_DEBUG_APP_NAME,
    app_version: getRuntimeAppVersion(),
    session_id: Number.isInteger(eventPayload?.session_id) ? eventPayload.session_id : null,
    step: eventPayload?.step || 'error',
    rpc_name: eventPayload?.rpc_name || '',
    idempotency_key: eventPayload?.idempotency_key || '',
    payload: eventPayload?.payload ?? null,
    request_body: eventPayload?.request_body ?? null,
    scrape_meta: eventPayload?.scrape_meta ?? null,
    rpc_result: eventPayload?.rpc_result ?? null,
    error_text: eventPayload?.error_text ? String(eventPayload.error_text) : null
  };

  appendDebugArtifact(payload.trace_id, payload);

  if (!supabaseUrl || !serviceRoleKey) return;

  // Gate: signed out = no remote debug log (the local artifact is kept above).
  const bearer = await userBearerOrNull();
  if (!bearer) return;

  try {
    const response = await fetch(`${supabaseUrl}${DREAM_DEBUG_RPC_PATH}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_event: payload })
    });

    if (!response.ok) {
      const responseText = await response.text();
      console.warn('[IngestDebug] Supabase logging failed:', response.status, responseText);
    }
  } catch (error) {
    console.warn('[IngestDebug] Supabase logging exception:', error?.message || error);
  }
}

function normalizeDreamKind(kind) {
  const raw = String(kind || '').trim().toLowerCase();
  if (raw === 'aggregated' || raw === 'merge' || raw === 'clarification') return raw;
  return null;
}

async function callSupabaseRpc(rpcName, body) {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  }

  // Gate: signed out = local-only; never call the backend anonymously. The
  // session handlers fall back to the local store on this error.
  const bearer = await userBearerOrNull();
  if (!bearer) throw new NotSignedInError();

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });

  const rawText = await response.text();
  if (!response.ok) {
    logSessionRpc(`RPC ${rpcName} error`, { status: response.status, body: rawText });
    throw new Error(`RPC ${rpcName} failed: ${response.status} ${rawText}`);
  }
  logSessionRpc(`RPC ${rpcName} ok`);

  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch (_) {
    return rawText;
  }
}

function writeTraceArtifactFiles(traceId, files = []) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const dir = ensureDebugRunsDir();
  const safeTraceId = String(traceId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  const written = [];

  for (const file of files) {
    try {
      const content = typeof file?.content === 'string' ? file.content : '';
      if (!content) continue;
      const extension = String(file?.extension || 'txt').replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'txt';
      const safeName = String(file?.name || 'artifact').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'artifact';
      const fileName = `${safeTraceId}_${safeName}.${extension}`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, content, 'utf8');
      written.push({
        name: fileName,
        path: filePath,
        bytes: Buffer.byteLength(content, 'utf8')
      });
    } catch (error) {
      console.warn('[IngestDebug] Failed to write trace file:', error?.message || error);
    }
  }

  return written;
}

function buildSupabaseRestUrl(endpointPath) {
  const { supabaseUrl } = getSupabaseConfig();
  const base = String(supabaseUrl || '').replace(/\/+$/, '');
  const endpoint = String(endpointPath || '').replace(/^\/+/, '');
  return `${base}/rest/v1/${endpoint}`;
}

async function callSupabaseRestGet(endpointPath, allow404 = false) {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  }

  // Gate: signed out = no remote reads (local-only mode).
  const bearer = await userBearerOrNull();
  if (!bearer) return [];

  const response = await fetch(buildSupabaseRestUrl(endpointPath), {
    method: 'GET',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${bearer}`,
      Accept: 'application/json'
    }
  });

  const rawText = await response.text();
  if (allow404 && response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`REST ${endpointPath} failed: ${response.status} ${rawText}`);
  }
  if (!rawText) return [];
  try {
    return JSON.parse(rawText);
  } catch (_) {
    return [];
  }
}

async function callSupabaseRestWrite(method, endpointPath, payload = null, options = {}) {
  const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase env is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).');
  }

  // Gate: signed out = local-only; never write to the backend anonymously.
  const bearer = await userBearerOrNull();
  if (!bearer) throw new NotSignedInError();

  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${bearer}`,
    Accept: 'application/json',
    Prefer: options?.prefer || 'return=minimal'
  };
  if (payload != null) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(buildSupabaseRestUrl(endpointPath), {
    method,
    headers,
    body: payload != null ? JSON.stringify(payload) : undefined
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`REST ${method} ${endpointPath} failed: ${response.status} ${rawText}`);
  }
  if (!rawText) return null;
  try {
    return JSON.parse(rawText);
  } catch (_) {
    return rawText;
  }
}

async function callSupabaseRestPatch(endpointPath, payload, options = {}) {
  return callSupabaseRestWrite('PATCH', endpointPath, payload, options);
}

async function callSupabaseRestDelete(endpointPath, options = {}) {
  return callSupabaseRestWrite('DELETE', endpointPath, null, options);
}

function encodeFilterValue(value) {
  return encodeURIComponent(String(value ?? '').trim());
}

async function deleteSessionViaRestFallback(target) {
  const recordId = String(target?.recordId || '').trim();
  let noteId = String(target?.noteId || '').trim();
  let sessionId = Number.isInteger(target?.sessionId) && target.sessionId > 0 ? target.sessionId : null;

  if (!sessionId && /^\d+$/.test(recordId)) {
    sessionId = Number.parseInt(recordId, 10);
  }

  if (!noteId && sessionId) {
    const noteRows = await callSupabaseRestGet(`notes?select=id&note_session_id=eq.${sessionId}&order=updated_at.desc&limit=1`);
    const note = Array.isArray(noteRows) && noteRows.length > 0 ? noteRows[0] : null;
    noteId = typeof note?.id === 'string' ? note.id : '';
  }

  if (noteId) {
    const noteRows = await callSupabaseRestGet(`notes?select=id,parent_id,note_session_id&id=eq.${encodeFilterValue(noteId)}&limit=1`);
    const note = Array.isArray(noteRows) && noteRows.length > 0 ? noteRows[0] : null;
    if (note?.id) {
      const allRows = await callSupabaseRestGet('notes?select=id,parent_id,note_type,note_session_id');
      const childIdsByParent = new Map();
      const rowsById = new Map();
      (Array.isArray(allRows) ? allRows : []).forEach((row) => {
        const parentId = String(row?.parent_id || '').trim();
        const id = String(row?.id || '').trim();
        if (!id) return;
        rowsById.set(id, row);
        if (parentId) {
          const list = childIdsByParent.get(parentId) || [];
          list.push(id);
          childIdsByParent.set(parentId, list);
        }
      });

      const subtreeIds = new Set([String(note.id)]);
      const stack = [String(note.id)];
      while (stack.length > 0) {
        const current = stack.pop();
        (childIdsByParent.get(current) || []).forEach((childId) => {
          if (subtreeIds.has(childId)) return;
          subtreeIds.add(childId);
          stack.push(childId);
        });
      }

      const deleteIds = new Set(
        [...subtreeIds].filter((id) => {
          const row = rowsById.get(id);
          return id === String(note.id) || row?.note_type === 2 || row?.note_type === 3;
        })
      );
      const preservedIds = [...subtreeIds].filter((id) => !deleteIds.has(id));
      const rootParentId = note.parent_id ?? null;
      for (const preservedId of preservedIds) {
        const row = rowsById.get(preservedId);
        const parentId = String(row?.parent_id || '').trim();
        if (parentId && deleteIds.has(parentId)) {
          await callSupabaseRestPatch(`notes?id=eq.${encodeFilterValue(preservedId)}`, { parent_id: rootParentId });
        }
      }

      const filter = [...deleteIds].map(encodeFilterValue).join(',');
      if (filter) {
        await callSupabaseRestDelete(`notes?id=in.(${filter})`);
      }
    }

    await callSupabaseRestDelete(`aggregator_sessions?note_id=eq.${encodeFilterValue(noteId)}`);
  }

  if (sessionId) {
    const remainingNotes = await callSupabaseRestGet(`notes?select=id&note_session_id=eq.${sessionId}&limit=1`);
    if (!Array.isArray(remainingNotes) || remainingNotes.length === 0) {
      await callSupabaseRestDelete(`aggregator_sessions?session_id=eq.${sessionId}`);
    }
  } else if (recordId && !noteId) {
    await callSupabaseRestDelete(`aggregator_sessions?id=eq.${encodeFilterValue(recordId)}`);
  }

  return { ok: true, fallback: 'rest' };
}

function normalizeSlotUrlEntry(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  if (typeof value.url === 'string' && value.url.trim()) return value.url.trim();
  if (typeof value.value === 'string' && value.value.trim()) return value.value.trim();
  return '';
}

function isValidDreamPayload(kind, payload) {
  if (!payload || typeof payload !== 'object') return false;

  if (kind === 'aggregated') {
    return payload.schema === 'aggregated_ingest_v1' && Array.isArray(payload.responses);
  }
  if (kind === 'merge') {
    return payload.schema === 'merge_ingest_v1' && Number.isInteger(payload.session_id);
  }
  if (kind === 'clarification') {
    return payload.schema === 'clarification_ingest_v1' && Number.isInteger(payload.session_id);
  }
  return false;
}

async function ingestDreamRpc(kindInput, params) {
  const startedAt = Date.now();
  const traceId = sanitizeTraceId(params?.traceId);
  const payload = params?.payload;
  const sourceMessageId = String(params?.sourceMessageId || '').trim();
  const scrapeMeta = Array.isArray(params?.scrapeMeta) ? params.scrapeMeta : [];

  try {
    const kind = normalizeDreamKind(kindInput);
    if (!kind) {
      const errorText = 'Unsupported ingest kind.';
      await emitIngestDebugEvent({
        eventPayload: {
          trace_id: traceId,
          step: 'error',
          rpc_name: '',
          payload,
          error_text: errorText
        }
      });
      return { ok: false, error: errorText, traceId };
    }

    const rpcName = DREAM_RPC_NAMES[kind];

    const { supabaseUrl, serviceRoleKey } = getSupabaseConfig();
    if (!isValidDreamPayload(kind, payload)) {
      const errorText = `Invalid payload for kind=${kind}.`;
      await emitIngestDebugEvent({
        supabaseUrl,
        serviceRoleKey,
        eventPayload: {
          trace_id: traceId,
          step: 'error',
          rpc_name: rpcName,
          payload,
          error_text: errorText
        }
      });
      return { ok: false, error: errorText, traceId };
    }

    const payloadStr = stableStringify(payload);
    const payloadHash = sha256(payloadStr);
    const normalizedSourceMessageId = sourceMessageId || payloadHash.slice(0, 16);
    const sequence = sanitizeSequence(params?.sequence, normalizedSourceMessageId);
    if (!normalizedSourceMessageId) {
      const errorText = 'sourceMessageId is required.';
      await emitIngestDebugEvent({
        supabaseUrl,
        serviceRoleKey,
        eventPayload: {
          trace_id: traceId,
          session_id: Number.isInteger(payload?.session_id) ? payload.session_id : null,
          step: 'error',
          rpc_name: rpcName,
          payload,
          error_text: errorText
        }
      });
      return { ok: false, error: errorText, traceId };
    }

    const sessionId = Number.isInteger(payload.session_id) ? payload.session_id : null;
    const idempotencyKey = buildIdempotencyKey({
      kind,
      sessionId,
      sequence,
      traceId
    });

    const requestBody = {
      p_payload: payload,
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash
    };

    await emitIngestDebugEvent({
      supabaseUrl,
      serviceRoleKey,
      eventPayload: {
        trace_id: traceId,
        session_id: sessionId,
        step: kind,
        rpc_name: rpcName,
        idempotency_key: idempotencyKey,
        payload,
        request_body: requestBody,
        scrape_meta: scrapeMeta
      }
    });

    if (!supabaseUrl || !serviceRoleKey) {
      const errorText = 'Supabase env is not configured (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).';
      await emitIngestDebugEvent({
        eventPayload: {
          trace_id: traceId,
          session_id: sessionId,
          step: 'error',
          rpc_name: rpcName,
          idempotency_key: idempotencyKey,
          payload,
          error_text: errorText
        }
      });
      return { ok: false, error: errorText, traceId, payloadHash, idempotencyKey };
    }

    console.log('[IngestRPC] Request', {
      url: `${supabaseUrl}${DREAM_RPC_PATHS[kind]}`,
      kind,
      sourceMessageId: normalizedSourceMessageId,
      sequence,
      traceId,
      idempotencyKey,
      payloadHash,
      sessionId
    });

    // Gate: signed out = local-only; never ingest to the backend anonymously.
    const bearer = await userBearerOrNull();
    if (!bearer) throw new NotSignedInError();

    const response = await fetch(`${supabaseUrl}${DREAM_RPC_PATHS[kind]}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const rawText = await response.text();
    let parsed;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (_) {
      parsed = null;
    }

    if (!response.ok) {
      const errorText = `RPC ${kind} failed: ${response.status}`;
      console.error('[IngestRPC] HTTP error', {
        kind,
        status: response.status,
        body: rawText
      });
      await emitIngestDebugEvent({
        supabaseUrl,
        serviceRoleKey,
        eventPayload: {
          trace_id: traceId,
          session_id: sessionId,
          step: 'error',
          rpc_name: rpcName,
          idempotency_key: idempotencyKey,
          payload,
          request_body: requestBody,
          scrape_meta: scrapeMeta,
          rpc_result: parsed || rawText || null,
          error_text: errorText
        }
      });
      return {
        ok: false,
        error: errorText,
        status: response.status,
        responseText: rawText,
        payloadHash,
        idempotencyKey,
        traceId
      };
    }

    console.log('[IngestRPC] Response', {
      kind,
      status: response.status,
      durationMs: Date.now() - startedAt,
      body: parsed
    });

    const resultSessionId = extractRpcSessionId(parsed);
    await emitIngestDebugEvent({
      supabaseUrl,
      serviceRoleKey,
      eventPayload: {
        trace_id: traceId,
        session_id: Number.isInteger(resultSessionId) ? resultSessionId : sessionId,
        step: 'result',
        rpc_name: rpcName,
        idempotency_key: idempotencyKey,
        payload,
        request_body: requestBody,
        scrape_meta: scrapeMeta,
        rpc_result: parsed
      }
    });

    return {
      ok: true,
      data: parsed,
      status: response.status,
      payloadHash,
      idempotencyKey,
      kind,
      traceId,
      sequence
    };
  } catch (error) {
    console.error('[IngestRPC] Unexpected error', error);
    await emitIngestDebugEvent({
      eventPayload: {
        trace_id: traceId,
        session_id: Number.isInteger(payload?.session_id) ? payload.session_id : null,
        step: 'error',
        rpc_name: DREAM_RPC_NAMES[normalizeDreamKind(kindInput)] || '',
        payload,
        error_text: error?.message || 'Unexpected ingest error'
      }
    });
    return {
      ok: false,
      error: error.message || 'Unexpected ingest error',
      traceId
    };
  }
}

ipcMain.handle('dream-send-aggregated', async (_event, params) => {
  return ingestDreamRpc('aggregated', params);
});

ipcMain.handle('dream-send-merge', async (_event, params) => {
  return ingestDreamRpc('merge', params);
});

ipcMain.handle('dream-send-clarification', async (_event, params) => {
  return ingestDreamRpc('clarification', params);
});

// --- Supabase Auth (multi-user) ---
// Signed-in ingest/session writes carry the user JWT, so backend owner_id
// triggers attribute rows to this account. Signed out = legacy anon behaviour.
ipcMain.handle('auth-sign-in', async (_event, params) => {
  return authStore.signIn(params?.email, params?.password);
});

ipcMain.handle('auth-sign-out', async () => {
  return authStore.signOut();
});

ipcMain.handle('auth-get-status', async () => {
  return authStore.getStatus();
});

ipcMain.handle('auth-consume-session-expired', async () => {
  return authStore.consumeSessionExpired();
});

ipcMain.handle('dream-append-trace-artifact', async (_event, params) => {
  const traceId = params?.traceId || sanitizeTraceId();
  const eventPayload = params?.eventPayload && typeof params.eventPayload === 'object'
    ? { ...params.eventPayload }
    : {};
  const files = Array.isArray(params?.files) ? params.files : [];
  const writtenFiles = writeTraceArtifactFiles(traceId, files);
  if (writtenFiles.length > 0) eventPayload.trace_files = writtenFiles;
  appendDebugArtifact(traceId, eventPayload);
  return { ok: true, traceId, fileCount: writtenFiles.length };
});

ipcMain.handle('dream-save-session', async (_event, params) => {
  try {
    const raw = await callSupabaseRpc('aggregator_sessions_bridge_v1', {
      p_action: 'save',
      p_record_id: null,
      p_session_id: params?.sessionId ?? null,
      p_note_id: params?.noteId ?? null,
      p_name: String(params?.name || '').trim(),
      p_slot_config: params?.slotConfig || {},
      p_slot_urls: params?.slotUrls || {},
      p_slot_enabled: params?.slotEnabled || {},
      p_limit: 1000
    });
    const result = raw?.data ?? null;
    logSessionRpc('save_aggregator_session result', { id: result?.id, name: result?.name });
    return result || null;
  } catch (error) {
    console.error('[dream-save-session] failed:', error);
    throw error;
  }
});

ipcMain.handle('dream-migrate-session', async (_event, params) => {
  // Late-login migration of a local-only session: the backend allocates a fresh
  // real session_id (ignores the local 900000+ number) so it never collides
  // across devices, and the owner trigger stamps owner_id = auth.uid(). Requires
  // a signed-in caller (callSupabaseRpc throws NotSignedInError when signed out).
  try {
    const raw = await callSupabaseRpc('aggregator_sessions_bridge_v1', {
      p_action: 'migrate',
      p_record_id: null,
      p_session_id: null,
      p_note_id: null,
      p_name: String(params?.name || '').trim() || 'Session',
      p_slot_config: params?.slotConfig || {},
      p_slot_urls: params?.slotUrls || {},
      p_slot_enabled: params?.slotEnabled || {},
      p_limit: 1
    });
    return raw?.data ?? null;
  } catch (error) {
    console.error('[dream-migrate-session] failed:', error);
    throw error;
  }
});

ipcMain.handle('dream-load-sessions', async (_event, sessionId) => {
  try {
    const parsedSessionId = Number.isInteger(sessionId) ? sessionId : null;
    const data = await callSupabaseRpc('aggregator_sessions_bridge_v1', {
      p_action: 'list',
      p_record_id: null,
      p_session_id: parsedSessionId,
      p_name: null,
      p_slot_config: null,
      p_slot_urls: null,
      p_slot_enabled: null,
      p_limit: 1000
    });
    const snapshots = (Array.isArray(data?.data) ? data.data : []).map(row => ({
      id: row.id,
      sessionId: Number.isInteger(row.session_id)
        ? row.session_id
        : (Number.isInteger(row.sessionId) ? row.sessionId : null),
      noteId: typeof row.note_id === 'string'
        ? row.note_id
        : (typeof row.noteId === 'string'
          ? row.noteId
          : (typeof row.question_note_id === 'string'
            ? row.question_note_id
            : (typeof row.questionNoteId === 'string' ? row.questionNoteId : null))),
      name: row.name,
      slotConfig: row.slot_config || row.slotConfig || {},
      slotUrls: row.slot_urls || row.slotUrls || {},
      slotEnabled: row.slot_enabled || row.slotEnabled || {},
      projectTagId: typeof row.project_tag_id === 'string'
        ? row.project_tag_id
        : (typeof row.projectTagId === 'string' ? row.projectTagId : null),
      updatedAt: row.updated_at || row.updatedAt || null
    }));

    const noteQuery = [
      'select=id,note_session_id,title,updated_at,created_at',
      'note_type=eq.1',
      'order=updated_at.desc',
      'limit=1000'
    ];
    if (Number.isInteger(parsedSessionId) && parsedSessionId > 0) {
      noteQuery.push(`note_session_id=eq.${parsedSessionId}`);
    } else {
      noteQuery.push('note_session_id=not.is.null');
    }
    const noteRows = await callSupabaseRestGet(`notes?${noteQuery.join('&')}`);

    const snapshotByNote = new Map();
    const latestSnapshotBySession = new Map();
    const rpcBySession = new Map();
    for (const snapshot of snapshots) {
      if (snapshot.noteId) snapshotByNote.set(snapshot.noteId, snapshot);
      if (snapshot.sessionId == null) continue;
      const existing = latestSnapshotBySession.get(snapshot.sessionId);
      const existingTs = Date.parse(existing?.updatedAt || '') || 0;
      const currentTs = Date.parse(snapshot.updatedAt || '') || 0;
      if (!existing || currentTs >= existingTs) {
        latestSnapshotBySession.set(snapshot.sessionId, snapshot);
      }
      // Keep original RPC snapshots as fallback for note-backed rows
      // when no local snapshot matches the note row's session ID.
      rpcBySession.set(snapshot.sessionId, snapshot);
    }

    const noteBackedRows = (Array.isArray(noteRows) ? noteRows : []).map((note) => {
      const noteId = typeof note.id === 'string' ? note.id : null;
      const rowSessionId = Number.isInteger(note.note_session_id) ? note.note_session_id : null;
      const matchingSnapshot = (noteId ? snapshotByNote.get(noteId) : null)
        || (rowSessionId != null ? latestSnapshotBySession.get(rowSessionId) : null)
        || null;
      const rpcFallback = rowSessionId != null ? rpcBySession.get(rowSessionId) : null;
      return {
        id: matchingSnapshot?.id || (noteId ? `note:${noteId}` : `session:${rowSessionId ?? 'unknown'}`),
        sessionId: rowSessionId,
        noteId,
        name: String(note.title || '').trim()
          || matchingSnapshot?.name
          || (rowSessionId != null ? `Session #${rowSessionId}` : 'Session'),
        slotConfig: matchingSnapshot?.slotConfig || rpcFallback?.slotConfig || {},
        slotUrls: matchingSnapshot?.slotUrls || rpcFallback?.slotUrls || {},
        slotEnabled: matchingSnapshot?.slotEnabled || rpcFallback?.slotEnabled || {},
        projectTagId: matchingSnapshot?.projectTagId || rpcFallback?.projectTagId || null,
        // Session history should be stable even if the underlying note is edited later.
        // Use note creation time for note-backed rows and keep the live snapshot update as
        // auxiliary metadata only.
        updatedAt: matchingSnapshot?.updatedAt || note.updated_at || null,
        createdAt: note.created_at || null,
        sortAt: note.created_at || matchingSnapshot?.updatedAt || note.updated_at || null,
        displayAt: note.created_at || note.updated_at || matchingSnapshot?.updatedAt || null
      };
    });

    if (noteBackedRows.length === 0) return snapshots;

    // Note-less session snapshots (e.g. local sessions migrated on login:
    // session_id >= 900000, note_id = null) have no row in the notes table, so
    // they are absent from noteBackedRows. Append them so they still appear in
    // the Sessions list instead of silently vanishing after migration.
    const noteBackedSessionIds = new Set(
      noteBackedRows.map((row) => row.sessionId).filter((id) => Number.isInteger(id))
    );
    const sessionOnlyRows = snapshots.filter(
      (s) => !s.noteId && Number.isInteger(s.sessionId) && !noteBackedSessionIds.has(s.sessionId)
    );
    return [...noteBackedRows, ...sessionOnlyRows];
  } catch (error) {
    console.error('[dream-load-sessions] failed:', error);
    throw error;
  }
});

ipcMain.handle('dream-open-session-window', async (_event, session) => {
  try {
    const win = new BrowserWindow({
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
      title: `Quaestio — ${session?.name || 'Session'}`,
      icon: getAppIconPath()
    });
    // Pass session as query param so the new window can restore it
    const encoded = encodeURIComponent(JSON.stringify(session));
    win.loadFile('index.html', { query: { session: encoded } });
    win.on('focus', () => { mainWindow = win; });
    win.on('closed', () => { if (mainWindow === win) mainWindow = getPrimaryWindow(); });
    return { ok: true };
  } catch (error) {
    console.error('[dream-open-session-window] failed:', error);
    throw error;
  }
});

ipcMain.handle('dream-delete-session', async (_event, sessionTarget) => {
  try {
    const recordId = typeof sessionTarget === 'object' && sessionTarget
      ? String(sessionTarget.recordId ?? sessionTarget.id ?? '').trim()
      : String(sessionTarget || '').trim();
    const noteId = typeof sessionTarget === 'object' && sessionTarget
      ? String(sessionTarget.noteId ?? sessionTarget.note_id ?? '').trim()
      : '';
    const sessionId = typeof sessionTarget === 'object' && sessionTarget
      ? (Number.isInteger(sessionTarget.sessionId)
        ? sessionTarget.sessionId
        : (Number.isInteger(sessionTarget.session_id) ? sessionTarget.session_id : null))
      : null;

    return await callSupabaseRpc('aggregator_sessions_bridge_v1', {
      p_action: 'delete',
      p_record_id: recordId,
      p_session_id: sessionId,
      p_name: null,
      p_slot_config: null,
      p_slot_urls: null,
      p_slot_enabled: null,
      p_note_id: noteId || null,
      p_limit: 1
    });
  } catch (error) {
    console.error('[dream-delete-session] failed:', error);
    try {
      const fallbackResult = await deleteSessionViaRestFallback(sessionTarget);
      console.warn('[dream-delete-session] bridge failed, REST fallback used');
      return fallbackResult;
    } catch (fallbackError) {
      console.error('[dream-delete-session] REST fallback failed:', fallbackError);
      throw error;
    }
  }
});

ipcMain.handle('dream-list-project-tree-data', async () => {
  try {
    const tags = await callSupabaseRestGet('tags?select=id,name,color,slot_urls&order=name.asc');
    const tagParents = await callSupabaseRestGet('tag_parents?select=tag_id,parent_id', true);
    return {
      ok: true,
      tags: Array.isArray(tags) ? tags : [],
      tagParents: Array.isArray(tagParents) ? tagParents : []
    };
  } catch (error) {
    console.error('[dream-list-project-tree-data] failed:', error);
    return { ok: false, error: error?.message || 'Failed to load projects', tags: [], tagParents: [] };
  }
});

ipcMain.handle('dream-get-project-slot-urls', async (_event, projectId) => {
  const normalizedId = String(projectId || '').trim();
  if (!normalizedId) {
    return { ok: true, slotUrls: {} };
  }
  try {
    const encodedId = encodeURIComponent(normalizedId);
    const rows = await callSupabaseRestGet(`tags?select=id,slot_urls&id=eq.${encodedId}&limit=1`);
    const row = Array.isArray(rows) && rows.length > 0 && rows[0] && typeof rows[0] === 'object' ? rows[0] : null;
    const rawSlotUrls = row && row.slot_urls && typeof row.slot_urls === 'object' ? row.slot_urls : {};
    const slotUrls = {};
    Object.entries(rawSlotUrls).forEach(([key, value]) => {
      const url = normalizeSlotUrlEntry(value);
      if (url) slotUrls[key] = url;
    });
    return { ok: true, slotUrls };
  } catch (error) {
    console.error('[dream-get-project-slot-urls] failed:', error);
    return { ok: false, error: error?.message || 'Failed to load project URLs', slotUrls: {} };
  }
});

ipcMain.handle('clipboard-read-text', async () => {
  try {
    return clipboard.readText() || '';
  } catch (_) {
    return '';
  }
});

ipcMain.handle('clipboard-write-text', async (_event, text) => {
  try {
    clipboard.writeText(String(text || ''));
    return true;
  } catch (_) {
    return false;
  }
});

ipcMain.handle('app-get-about-info', async () => {
  try {
    return { ok: true, ...getDesktopAboutInfo() };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.on('app-background-work-state-changed', (_event, busy) => {
  rendererHasActiveWebviewWork = Boolean(busy);
  if (webviewsBackgrounded) {
    applyWebviewsPowerState();
  }
});

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

ipcMain.handle('save-page', async (event, { pageContent, pageUrl }) => {
  try {
    const urlObj = new URL(pageUrl);
    const hostname = urlObj.hostname.replace(/[^a-z0-9.-]/gi, '_');
    const defaultFilename = `${hostname}_${Date.now()}.html`;

    const result = await dialog.showSaveDialog(getPrimaryWindow() || undefined, {
      title: 'Save Web Page',
      defaultPath: defaultFilename,
      filters: [
        { name: 'HTML Files', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, message: 'Save canceled' };
    }

    fs.writeFileSync(result.filePath, pageContent, 'utf8');
    console.log(`[SavePage] Saved to ${result.filePath}`);
    return { ok: true, message: `Saved to ${result.filePath}` };
  } catch (err) {
    console.error('[SavePage] Error:', err);
    return { ok: false, message: `Error: ${err.message}` };
  }
});

ipcMain.handle('save-all-pages', async (event, pages) => {
  try {
    const result = await dialog.showOpenDialog(getPrimaryWindow() || undefined, {
      title: 'Select Folder to Save All Pages',
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || !result.filePaths.length) {
      return { ok: false, message: 'Save canceled' };
    }

    const folderPath = result.filePaths[0];
    const timestamp = Date.now();
    const savedFiles = [];

    for (const page of pages) {
      if (!page.content || !page.url) continue;

      try {
        const urlObj = new URL(page.url);
        const hostname = urlObj.hostname.replace(/[^a-z0-9.-]/gi, '_');
        const filename = `${page.slot}_${hostname}_${timestamp}.html`;
        const filepath = path.join(folderPath, filename);

        fs.writeFileSync(filepath, page.content, 'utf8');
        savedFiles.push(filename);
        console.log(`[SaveAllPages] Saved ${page.slot} to ${filepath}`);
      } catch (pageErr) {
        console.error(`[SaveAllPages] Error saving ${page.slot}:`, pageErr);
      }
    }

    if (savedFiles.length === 0) {
      return { ok: false, message: 'Failed to save any pages' };
    }

    return {
      ok: true,
      message: `Saved ${savedFiles.length} page(s) to ${folderPath}`,
      files: savedFiles
    };
  } catch (err) {
    console.error('[SaveAllPages] Error:', err);
    return { ok: false, message: `Error: ${err.message}` };
  }
});

async function createWindow() {
  const window = new BrowserWindow({
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
    title: 'Quaestio (alpha)',
    icon: getAppIconPath()
  });

  mainWindow = window;

  window.loadFile('index.html');

  // ---- Throttle webviews when window is hidden/minimized to save CPU ----
  const restoreForegroundPowerState = () => {
    setAllWebviewsBackgrounded(false);
  };

  window.on('minimize', () => {
    setAllWebviewsBackgrounded(true);
  });
  window.on('restore', () => {
    restoreForegroundPowerState();
  });
  window.on('hide', () => {
    setAllWebviewsBackgrounded(true);
  });
  window.on('show', () => {
    restoreForegroundPowerState();
  });
  window.on('focus', () => {
    mainWindow = window;
    restoreForegroundPowerState();
  });

  window.webContents.on('console-message', (event) => {
    const levelMap = {
      info: 'LOG',
      warning: 'WARN',
      error: 'ERR',
      debug: 'DBG',
    };
    const levelTag = levelMap[event.level] || 'LOG';
    console.log(`[renderer][${levelTag}] ${event.message}`);
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = getPrimaryWindow();
    }
  });

  let webviewCounter = 0;
  window.webContents.on('did-attach-webview', (event, webviewContents) => {
    webviewCounter++;
    const slotTag = `slot-${webviewCounter}`;
    webviewContents.setUserAgent(DESKTOP_USER_AGENT);
    webviewContents.setBackgroundThrottling(true);
    if (typeof webviewContents.setFrameRate === 'function') {
      webviewContents.setFrameRate(webviewsBackgrounded ? 1 : 60);
    }
    webviewContents.setAudioMuted(webviewsBackgrounded);
    if (webviewsBackgrounded && !rendererHasActiveWebviewWork) {
      freezeIdleWebview(webviewContents);
    }
    webviewContents.on('destroyed', () => {
      lowPowerFrozenWebContents.delete(webviewContents.id);
      lowPowerAttachedWebContents.delete(webviewContents.id);
    });

    webviewContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') {
        const levelMap = {
          info: 'LOG',
          warning: 'WARN',
          error: 'ERR',
          debug: 'DBG',
        };
        const levelTag = levelMap[event.level] || 'LOG';
        console.log(`[webview:${slotTag}][${levelTag}] ${event.message}`);
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
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            createWindow();
          }
        },
        {
          label: 'Save All Pages...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            const win = getPrimaryWindow();
            if (win) {
              win.webContents.executeJavaScript(`
                (async function() {
                  const pages = [];
                  for (const slot of SLOTS) {
                    const webview = webviews[slot];
                    if (!webview) continue;

                    try {
                      const url = getWebviewCurrentUrl(slot);
                      if (!url) continue;

                      const content = await webview.executeJavaScript(\`
                        (function() {
                          return document.documentElement.outerHTML;
                        })()
                      \`);

                      if (content) {
                        pages.push({ slot, url, content });
                      }
                    } catch (err) {
                      console.error('Error getting page from ' + slot, err);
                    }
                  }

                  if (pages.length === 0) {
                    window.alert('No pages loaded to save');
                    return;
                  }

                  try {
                    const result = await window.electronAPI.saveAllPages(pages);
                    if (result.ok) {
                      window.alert(result.message);
                    } else {
                      window.alert('Error: ' + result.message);
                    }
                  } catch (err) {
                    window.alert('Error: ' + err.message);
                  }
                })();
              `).catch(err => console.error('Menu click error:', err));
            }
          }
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
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
            const result = await dialog.showOpenDialog(getPrimaryWindow() || undefined, {
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
            const win = getPrimaryWindow();
            if (win) win.webContents.toggleDevTools();
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
                zoomLevels[slot] = 0.7;
                await webviews[slot].setZoomFactor(0.7);
                document.querySelector(\`[data-slot="\${slot}"] .zoom-level\`).textContent = '70%';
              });
            `);
          }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'About',
      submenu: [
        {
          label: 'About / Changelog',
          accelerator: 'CmdOrCtrl+Shift+A',
          click: () => {
            const win = getPrimaryWindow();
            if (win) {
              win.webContents.executeJavaScript(`
                window.openAboutDialog?.();
              `).catch(err => console.error('About menu click error:', err));
            }
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  if (process.env.OPEN_DEVTOOLS === '1') {
    window.webContents.openDevTools();
  }
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = getPrimaryWindow();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    createWindow();
  });

  app.whenReady().then(() => {
    refreshDockIcon();
    nativeTheme.on('updated', refreshDockIcon);

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
}
