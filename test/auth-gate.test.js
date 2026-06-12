// Regression guard for the desktop multi-user gate (mirrors Android AuthGateTest
// and iOS AnonGateTests): signed out ⇒ no usable bearer ⇒ callers skip the
// backend, never fall back to the publishable key. Run with: npm test.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// --- Pure gate rule ---------------------------------------------------------
const { bearerOrNull } = require('../auth-gate');

test('bearerOrNull: signed out (null/blank) skips the backend', () => {
  assert.strictEqual(bearerOrNull(null), null);
  assert.strictEqual(bearerOrNull(undefined), null);
  assert.strictEqual(bearerOrNull(''), null);
  assert.strictEqual(bearerOrNull('   '), null);
});

test('bearerOrNull: a real token passes through (trimmed)', () => {
  assert.strictEqual(bearerOrNull('jwt-abc'), 'jwt-abc');
  assert.strictEqual(bearerOrNull('  jwt-abc  '), 'jwt-abc');
});

// --- auth-store getValidAccessToken with no session -------------------------
// Stub the 'electron' module so auth-store.js can load outside Electron.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'verity-auth-test-'));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: { getPath: () => tmpUserData },
      safeStorage: { isEncryptionAvailable: () => false }
    };
  }
  return origLoad.apply(this, arguments);
};
const authStore = require('../auth-store');
Module._load = origLoad;

test('auth-store: getValidAccessToken is null when there is no session', async () => {
  authStore.configure({ supabaseUrl: 'https://example.supabase.co', apikey: 'sb_publishable_x' });
  const token = await authStore.getValidAccessToken();
  assert.strictEqual(token, null, 'no session must yield no token (no anon fallback)');
  assert.strictEqual(authStore.getStatus().signedIn, false);
});
