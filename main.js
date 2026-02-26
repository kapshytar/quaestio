const { app, BrowserWindow, Menu, dialog, ipcMain, session, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
const gotSingleInstanceLock = app.requestSingleInstanceLock();

const DESKTOP_USER_AGENT = IS_MAC
  ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`
  : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;

// Throttle all webviews when app is minimized/hidden to save CPU
function setAllWebviewsBackgrounded(backgrounded) {
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
const INGEST_DEBUG_PLATFORM = 'windows';
const INGEST_DEBUG_APP_NAME = 'chat-aggregator-windows';
const DEFAULT_SUPABASE_URL = 'https://bjqkvlsneujrcfpvcvzf.supabase.co';
const DEFAULT_SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJqcWt2bHNuZXVqcmNmcHZjdnpmIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTc3OTcyMywiZXhwIjoyMDg3MzU1NzIzfQ.NJQV4V8yZ_qDaPKlbDkbw-iRbYl8ePUkp1KpqEU1HBo';

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
        platform: INGEST_DEBUG_PLATFORM,
        app_name: INGEST_DEBUG_APP_NAME,
        app_version: app.getVersion(),
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
    platform: INGEST_DEBUG_PLATFORM,
    app_name: INGEST_DEBUG_APP_NAME,
    app_version: app.getVersion(),
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

  try {
    const response = await fetch(`${supabaseUrl}${DREAM_DEBUG_RPC_PATH}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
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

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
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

    const response = await fetch(`${supabaseUrl}${DREAM_RPC_PATHS[kind]}`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
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

ipcMain.handle('dream-save-session', async (_event, params) => {
  try {
    const raw = await callSupabaseRpc('save_aggregator_session', {
      p_session_id: params?.sessionId ?? null,
      p_name: String(params?.name || '').trim(),
      p_slot_config: params?.slotConfig || {},
      p_slot_urls: params?.slotUrls || {},
      p_slot_enabled: params?.slotEnabled || {}
    });
    // Supabase RETURNS TABLE gives back an array — unwrap first row
    const result = Array.isArray(raw) ? raw[0] : raw;
    logSessionRpc('save_aggregator_session result', { id: result?.id, name: result?.name });
    return result || null;
  } catch (error) {
    console.error('[dream-save-session] failed:', error);
    throw error;
  }
});

ipcMain.handle('dream-load-sessions', async (_event, sessionId) => {
  try {
    const parsedSessionId = Number.isInteger(sessionId) ? sessionId : null;
    const data = await callSupabaseRpc('list_aggregator_sessions', {
      p_session_id: parsedSessionId,
      p_limit: 20
    });
    const rows = Array.isArray(data) ? data : [];
    // Map snake_case DB fields → camelCase for renderer
    return rows.map(row => ({
      id: row.id,
      sessionId: Number.isInteger(row.session_id)
        ? row.session_id
        : (Number.isInteger(row.sessionId) ? row.sessionId : null),
      name: row.name,
      slotConfig: row.slot_config || row.slotConfig || {},
      slotUrls: row.slot_urls || row.slotUrls || {},
      slotEnabled: row.slot_enabled || row.slotEnabled || {},
      updatedAt: row.updated_at || row.updatedAt || null
    }));
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
      title: `Gunshi — ${session?.name || 'Session'}`,
      icon: path.join(__dirname, IS_MAC ? 'icon.png' : 'icon.ico')
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

ipcMain.handle('dream-delete-session', async (_event, sessionId) => {
  try {
    return await callSupabaseRpc('delete_aggregator_session', {
      p_session_id: String(sessionId || '')
    });
  } catch (error) {
    console.error('[dream-delete-session] failed:', error);
    throw error;
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
    title: 'Gunshi (alpha)',
    icon: path.join(__dirname, IS_MAC ? 'icon.png' : 'icon.ico')
  });

  mainWindow = window;

  window.loadFile('index.html');

  // ---- Throttle webviews when window is hidden/minimized to save CPU ----
  window.on('minimize', () => {
    setAllWebviewsBackgrounded(true);
  });
  window.on('restore', () => {
    setAllWebviewsBackgrounded(false);
  });
  window.on('hide', () => {
    setAllWebviewsBackgrounded(true);
  });
  window.on('show', () => {
    setAllWebviewsBackgrounded(false);
  });

  window.webContents.on('console-message', (event, level, message) => {
    const levelTag = ['LOG', 'WARN', 'ERR'][level] || 'LOG';
    console.log(`[renderer][${levelTag}] ${message}`);
  });

  window.on('focus', () => {
    mainWindow = window;
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
