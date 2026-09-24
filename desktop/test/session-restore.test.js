// Regression guard for S327 (2026-09-24): after a relaunch, fresh home-page
// chats must NOT resurrect the stored session by slot fingerprint; a slot on a
// real chat id may. The same guard existed once (96302df, 2026-02-25) and was
// lost untested in a rewrite a day later (fec73f6) — this test pins it.
// renderer.js is a browser script, so the functions under test are lifted from
// its source into a vm sandbox with stubbed dependencies. Run with: npm test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');

function liftFunction(name) {
  const bare = SOURCE.indexOf(`function ${name}(`);
  assert.ok(bare >= 0, `function ${name} not found in renderer.js`);
  const start = SOURCE.startsWith('async ', bare - 6) ? bare - 6 : bare;
  const open = SOURCE.indexOf('{', SOURCE.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < SOURCE.length; i += 1) {
    if (SOURCE[i] === '{') depth += 1;
    else if (SOURCE[i] === '}' && (depth -= 1) === 0) return SOURCE.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const STORED = { session_id: 327, fingerprint: 'fp_same', aggregated_note_id: 'root-327', source_prompt: 'old' };
const SLOTS = ['slot-1', 'slot-2'];

function restoreWith(slotUrls) {
  const sandbox = {
    URL,
    slotConfig: { 'slot-1': 'chatgpt', 'slot-2': 'claude' },
    getSuppressSlotRestore: () => false,
    getWebviewCurrentUrl: (slot) => slotUrls[slot] || '',
    detectServiceByUrl: (url) => (url.includes('chatgpt') ? 'chatgpt' : url.includes('claude') ? 'claude' : null),
    getStoredSessionContextForFingerprint: (fp) => (fp === STORED.fingerprint ? { ...STORED } : null),
    persistSessionContext: () => {},
    setIngestSessionIndicator: () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(
    'var activeSessionId = null, activeAggregatedNoteId = null, activeSessionPrompt = "", activeSessionFingerprint = null;',
    sandbox
  );
  for (const name of [
    'conversationKeyTailIsReal',
    'extractConversationKey',
    'slotsHaveRealConversation',
    'restoreStoredQuestionContextForFingerprint'
  ]) {
    vm.runInContext(liftFunction(name), sandbox);
  }
  const restored = vm.runInContext(
    `restoreStoredQuestionContextForFingerprint('fp_same', ${JSON.stringify(SLOTS)})`,
    sandbox
  );
  return { restored, activeSessionId: vm.runInContext('activeSessionId', sandbox) };
}

test('relaunch on empty home-page chats does not resurrect the stored session', () => {
  const { restored, activeSessionId } = restoreWith({
    'slot-1': 'https://chatgpt.com/',
    'slot-2': 'https://claude.ai/new'
  });
  assert.strictEqual(restored, null);
  assert.strictEqual(activeSessionId, null);
});

test('a slot on a real chat id still continues the stored session', () => {
  const { restored, activeSessionId } = restoreWith({
    'slot-1': 'https://chatgpt.com/c/6ab446e8-2664-83eb-be00-67bd60024f68',
    'slot-2': 'https://claude.ai/new'
  });
  assert.strictEqual(restored?.session_id, 327);
  assert.strictEqual(activeSessionId, 327);
});

// Save Current right after a relaunch must not reuse the raw stored id: the
// bridge 'save' UPDATEs an existing snapshot by session_id, so it would clobber
// the previous session's name and slot URLs with the fresh home pages.
async function saveWith(activeSessionId) {
  const sent = [];
  const sandbox = {
    console: { log() {}, error() {} },
    localStorage: {
      getItem: (k) => (k === 'aggregated-ingest-session-id' ? '327' : null),
      setItem() {},
      removeItem() {}
    },
    window: { electronAPI: { saveSession: async (data) => { sent.push(data); return { id: 'row-1' }; } } },
    AGGREGATED_SESSION_ID_KEY: 'aggregated-ingest-session-id',
    SESSIONS_KEY: 'sessions',
    SESSIONS_META_KEY: 'sessions-meta',
    SLOTS: ['slot-1'],
    webviews: { 'slot-1': { src: 'https://chatgpt.com/' } },
    slotConfig: { 'slot-1': 'chatgpt' },
    getCurrentSlotEnabledState: () => ({ 'slot-1': true }),
    setSessionsNotice() {},
    loadSessionsList: async () => [],
    mergeSessionSnapshots: (a, b) => [...a, ...b],
    updateSessionsUI: async () => {}
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `var activeSessionId = ${JSON.stringify(activeSessionId)}, activeAggregatedNoteId = null, activeProjectId = null, sessionsListMemoryCache = null;`,
    sandbox
  );
  vm.runInContext(liftFunction('saveSessionSnapshot'), sandbox);
  await vm.runInContext('saveSessionSnapshot()', sandbox);
  assert.strictEqual(sent.length, 1);
  return sent[0].sessionId;
}

test('manual Save after relaunch does not target the stale stored session', async () => {
  assert.strictEqual(await saveWith(null), null);
});

test('manual Save inside a live session keeps that session id', async () => {
  assert.strictEqual(await saveWith(330), 330);
});
