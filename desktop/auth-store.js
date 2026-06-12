// Supabase Auth for the Electron main process.
//
// Multi-user: when the user is signed in we send their access token as the
// `Authorization: Bearer` on every Supabase REST/RPC call, so the backend's
// owner_id triggers stamp rows to this user (the `apikey` header stays the
// publishable/anon key). When signed out, callers fall back to the
// publishable key and the app behaves as the legacy anon client.
//
// Tokens are persisted encrypted via Electron `safeStorage` under userData,
// so the session survives restarts without storing a plaintext refresh token.

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const SESSION_FILE = 'verity-auth-session.bin';
// Refresh a little before the token actually expires to avoid edge races.
const REFRESH_SKEW_SECONDS = 60;

let config = { supabaseUrl: '', apikey: '' };
let session = null; // { access_token, refresh_token, expires_at, email, user_id }
let loaded = false;
// Set when a refresh is definitively rejected (token revoked/expired). Consumed
// by the renderer to prompt re-sign-in. In-memory: a restart re-derives it on
// the next failed refresh.
let sessionExpired = false;

function configure({ supabaseUrl, apikey }) {
  config = {
    supabaseUrl: String(supabaseUrl || '').replace(/\/+$/, ''),
    apikey: String(apikey || '')
  };
}

function sessionFilePath() {
  return path.join(app.getPath('userData'), SESSION_FILE);
}

function persist() {
  try {
    const filePath = sessionFilePath();
    if (!session) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return;
    }
    const json = JSON.stringify(session);
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(json);
      fs.writeFileSync(filePath, enc);
    } else {
      // No OS keychain (rare on dev Linux). Fall back to plaintext but flag it.
      fs.writeFileSync(filePath, `PLAINTEXT:${json}`, 'utf8');
    }
  } catch (error) {
    console.warn('[auth] failed to persist session:', error?.message || error);
  }
}

function loadFromDisk() {
  if (loaded) return;
  loaded = true;
  try {
    const filePath = sessionFilePath();
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath);
    let json;
    if (raw.slice(0, 10).toString('utf8') === 'PLAINTEXT:') {
      json = raw.toString('utf8').slice('PLAINTEXT:'.length);
    } else if (safeStorage.isEncryptionAvailable()) {
      json = safeStorage.decryptString(raw);
    } else {
      return;
    }
    session = JSON.parse(json);
  } catch (error) {
    console.warn('[auth] failed to load session:', error?.message || error);
    session = null;
  }
}

function tokenUrl(grantType) {
  return `${config.supabaseUrl}/auth/v1/token?grant_type=${grantType}`;
}

function setSessionFromResponse(data) {
  if (!data || !data.access_token) return null;
  // A fresh token clears any pending expiry prompt.
  sessionExpired = false;
  const nowSec = Math.floor(Date.now() / 1000);
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    // Supabase returns expires_at (epoch sec) and/or expires_in (sec).
    expires_at: data.expires_at || (nowSec + (data.expires_in || 3600)),
    email: data.user?.email || session?.email || null,
    user_id: data.user?.id || session?.user_id || null
  };
  persist();
  return session;
}

async function signIn(email, password) {
  if (!config.supabaseUrl || !config.apikey) {
    return { ok: false, error: 'Supabase is not configured.' };
  }
  try {
    const response = await fetch(tokenUrl('password'), {
      method: 'POST',
      headers: { apikey: config.apikey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const msg = data?.error_description || data?.msg || data?.error || `Sign-in failed (${response.status})`;
      return { ok: false, error: msg };
    }
    setSessionFromResponse(data);
    return { ok: true, status: getStatus() };
  } catch (error) {
    return { ok: false, error: error?.message || 'Network error during sign-in.' };
  }
}

async function refresh() {
  loadFromDisk();
  if (!session?.refresh_token) return false;
  try {
    const response = await fetch(tokenUrl('refresh_token'), {
      method: 'POST',
      headers: { apikey: config.apikey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    const data = await response.json().catch(() => null);
    if (response.ok && setSessionFromResponse(data)) {
      return true;
    }
    if (response.status === 400 || response.status === 401) {
      // Definitive auth rejection: the refresh token is invalid/revoked/expired.
      // Nothing local recovers it — clear the session and flag the expiry so the
      // UI can prompt re-sign-in instead of silently degrading to local-only.
      console.warn(`[auth] refresh rejected (${response.status}): ${(data?.error_description || data?.msg || data?.error || '').toString().slice(0, 200)} — clearing session`);
      session = null;
      persist();
      sessionExpired = true;
      return false;
    }
    // Transient failure (5xx / unexpected): keep the session so a later call can
    // retry instead of nuking a valid session over a server blip.
    console.warn(`[auth] refresh transient failure (${response.status}) — keeping session`);
    return false;
  } catch (error) {
    // Network error: keep the session and retry on a later call.
    console.warn('[auth] refresh error:', error?.message || error, '— keeping session');
    return false;
  }
}

// True exactly once after a refresh was definitively rejected (token
// revoked/expired); consuming clears it. The renderer polls this so it can show
// "session expired — sign in again" instead of silently showing stale sessions.
function consumeSessionExpired() {
  if (!sessionExpired) return false;
  sessionExpired = false;
  return true;
}

// Returns a valid user access token, refreshing if near expiry. Null if the
// user is not signed in (caller should fall back to the publishable key).
async function getValidAccessToken() {
  loadFromDisk();
  if (!session?.access_token) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - nowSec <= REFRESH_SKEW_SECONDS) {
    const ok = await refresh();
    if (!ok) return null;
  }
  return session?.access_token || null;
}

async function signOut() {
  loadFromDisk();
  const token = session?.access_token;
  // Best-effort server-side revoke; local clear is what matters.
  if (token && config.supabaseUrl) {
    try {
      await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
        method: 'POST',
        headers: { apikey: config.apikey, Authorization: `Bearer ${token}` }
      });
    } catch (_) { /* ignore */ }
  }
  session = null;
  persist();
  // Deliberate sign-out is not an expiry — drop any pending prompt.
  sessionExpired = false;
  return { ok: true, status: getStatus() };
}

function getStatus() {
  loadFromDisk();
  return {
    signedIn: !!session?.access_token,
    email: session?.email || null,
    userId: session?.user_id || null
  };
}

module.exports = {
  configure,
  signIn,
  signOut,
  getStatus,
  getValidAccessToken,
  consumeSessionExpired
};
