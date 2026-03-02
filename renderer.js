// ========== SERVICE PRESETS ==========
const SERVICE_PRESETS = {
  chatgpt: {
    name: 'ChatGPT',
    url: 'https://chat.openai.com',
    selectors: {
      textarea: 'textarea[id*="prompt"]',
      button: 'button[data-testid="send-button"]'
    }
  },
  claude: {
    name: 'Claude',
    url: 'https://claude.ai',
    selectors: {
      contenteditable: 'div[contenteditable="true"][enterkeyhint="enter"]',
      button: 'button[aria-label*="Send"]'
    }
  },
  gemini: {
    name: 'Gemini',
    url: 'https://gemini.google.com',
    selectors: {
      contenteditable: 'div.ql-editor[contenteditable="true"]',
      button: 'button[aria-label*="Send"]'
    }
  },
  grok: {
    name: 'Grok',
    url: 'https://grok.com',
    selectors: {
      contenteditable: 'div[contenteditable="true"]',
      button: 'button[data-testid="sendButton"]'
    }
  },
  deepseek: {
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com',
    selectors: {
      textarea: [
        'textarea#chat-input',
        'textarea[placeholder*="Message"]',
        'textarea[placeholder*="Ask"]',
        'textarea'
      ],
      contenteditable: [
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]'
      ],
      button: [
        'button[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]'
      ]
    }
  },
  perplexity: {
    name: 'Perplexity',
    url: 'https://www.perplexity.ai',
    selectors: {
      textarea: [
        'textarea[placeholder*="Ask"]',
        'textarea[placeholder*="Message"]',
        'textarea'
      ],
      contenteditable: [
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        '[role="textbox"][contenteditable="true"]'
      ],
      button: [
        'button[aria-label*="Submit"]',
        'button[aria-label*="Send"]',
        'button[data-testid*="submit"]',
        'button[data-testid*="send"]',
        'button[type="submit"]'
      ]
    }
  }
};

// ========== SLOT IDS ==========
const SLOTS = ['slot-1', 'slot-2', 'slot-3', 'slot-4'];
const DEFAULT_ZOOM_FACTOR = 0.7;

// Default services per slot
const DEFAULT_SLOT_CONFIG = {
  'slot-1': 'chatgpt',
  'slot-2': 'claude',
  'slot-3': 'gemini',
  'slot-4': 'grok'
};

// DEFAULT_MERGE_INSTRUCTIONS is defined in merge-api-client.js

// ========== DETECT SERVICE BY URL ==========
function detectServiceByUrl(url) {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('openai.com') || u.includes('chatgpt.com')) return 'chatgpt';
  if (u.includes('claude.ai')) return 'claude';
  if (u.includes('gemini.google.com') || u.includes('aistudio.google.com')) return 'gemini';
  if (u.includes('grok.com') || u.includes('grok.x.com')) return 'grok';
  if (u.includes('deepseek.com')) return 'deepseek';
  if (u.includes('perplexity.ai')) return 'perplexity';
  return null;
}

// ========== GET ELEMENTS ==========
const webviews = {};
const toggles = {};
const statuses = {};
const labels = {};
const zoomLevels = {};
const statusTimeouts = {};
const webviewReady = {};
const pendingNavigation = {};

SLOTS.forEach(slot => {
  webviews[slot] = document.getElementById(`webview-${slot}`);
  toggles[slot] = document.getElementById(`toggle-${slot}`);
  statuses[slot] = document.getElementById(`status-${slot}`);
  labels[slot] = document.getElementById(`label-${slot}`);
  zoomLevels[slot] = DEFAULT_ZOOM_FACTOR;
  webviewReady[slot] = false;
  pendingNavigation[slot] = null;
});

const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const importCookiesBtn = document.getElementById('import-cookies-btn');
const toggleAddressBarBtn = document.getElementById('toggle-address-bar-btn');
const collapseBtn = document.getElementById('collapse-toolbar');
const togglesContainer = document.getElementById('toggles');
const projectSelectorBtn = document.getElementById('project-selector-btn');
const projectPanelEl = document.getElementById('project-panel');
const projectPanelScrimEl = document.getElementById('project-panel-scrim');
const projectPanelCloseBtn = document.getElementById('project-panel-close');
const projectTreeEl = document.getElementById('project-tree');

// Merge panel elements (populated after DOM ready)
let mergeProviderSelect, mergeApiKeyInput, mergeEndpointInput, mergeModelInput;
let mergeFallbackInput, mergeInstructionsInput, mergeResultDiv, mergeStatusDiv;
let clarificationContainer, clarificationInput, clarificationSendBtn, resetInstructionsBtn;
let fallbackModelsField, runMergeBtn;
let debugLogDiv, debugClearBtn;

// Merge state
let mergeInProgress = false;
let mergeHistory = '';
let lastScrapedResponses = {}; // saved after first merge, passed to clarification for context
let lastAggregatedResponses = [];
let lastScrapeMeta = [];
let selectedMergeProviderId = 'chatgpt_api';
const MERGE_SETUP_NEEDED_HINT = 'Merge setup needed: pick a provider, paste its API key, then tap Run Merge. Free-tier options often include OpenRouter and Hugging Face (availability/rate limits vary).';
let focusedSearchScope = 'global'; // global | merge | slot-1..slot-4
let searchSession = { query: '', scope: 'global' };
const mergeSearchState = { query: '', marks: [], index: -1 };
let searchDebounceTimer = null;
let activeProjectId = null;
let activeProjectSlotUrls = {};
let projectTreeNodes = [];
let isProjectPanelVisible = false;
let isProjectTreeLoaded = false;
const expandedProjectNodeIds = new Set();
let projectSlotUrlLoadGeneration = 0;
const AGGREGATED_SESSION_ID_KEY = 'aggregated-ingest-session-id';
const AGGREGATED_SESSION_CONTEXT_KEY = 'aggregated-ingest-session-context';
const SLOT_ENABLED_STATE_KEY = 'slot-enabled-state';
const INGEST_POLL_ATTEMPTS = 30;
const INGEST_POLL_INTERVAL_MS = 2000;
const INGEST_INITIAL_DELAY_MS = 5000;
const INGEST_GENERATION_WAIT_ATTEMPTS = 15;
const INGEST_GENERATION_CHECK_MS = 2000;
const INGEST_MIN_REPLY_CHARS = 20;
let activeIngestTraceId = '';
let ingestSequenceCounter = 0;
let ingestSequenceBySourceMessageId = new Map();
let activeSessionFingerprint = '';
let activeSessionId = null; // in-memory session_id — set immediately when RPC returns

function stableStringify(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc, key) => {
        acc[key] = sort(v[key]);
        return acc;
      }, {});
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

function hashString(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createIngestTraceId() {
  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function startIngestTrace() {
  activeIngestTraceId = createIngestTraceId();
  ingestSequenceCounter = 0;
  ingestSequenceBySourceMessageId = new Map();
  return activeIngestTraceId;
}

function getIngestTraceContext(sourceMessageId) {
  if (!activeIngestTraceId) startIngestTrace();

  const sourceKey = String(sourceMessageId || '').trim();
  if (sourceKey && ingestSequenceBySourceMessageId.has(sourceKey)) {
    return {
      traceId: activeIngestTraceId,
      sequence: ingestSequenceBySourceMessageId.get(sourceKey)
    };
  }

  ingestSequenceCounter += 1;
  const sequence = ingestSequenceCounter;
  if (sourceKey) ingestSequenceBySourceMessageId.set(sourceKey, sequence);

  return {
    traceId: activeIngestTraceId,
    sequence
  };
}

function getWebviewCurrentUrl(slot) {
  const webview = webviews[slot];
  if (!webview) return '';
  try {
    return String(webview.getURL?.() || webview.getAttribute?.('src') || '').trim();
  } catch (_) {
    return String(webview.getAttribute?.('src') || '').trim();
  }
}

async function readClipboardTextSafe() {
  if (!window.electronAPI || typeof window.electronAPI.readClipboardText !== 'function') return '';
  try {
    return String(await window.electronAPI.readClipboardText() || '');
  } catch (_) {
    return '';
  }
}

async function writeClipboardTextSafe(text) {
  if (!window.electronAPI || typeof window.electronAPI.writeClipboardText !== 'function') return false;
  try {
    return !!(await window.electronAPI.writeClipboardText(String(text || '')));
  } catch (_) {
    return false;
  }
}

async function isSlotStillGenerating(slot, serviceId = '') {
  const webview = webviews[slot];
  if (!webview || !webviewReady[slot]) return false;

  const code = `
(function() {
  try {
    const sid = ${JSON.stringify(serviceId)};
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    }

    // Provider-specific streaming indicators
    const checks = [];

    if (sid === 'deepseek') {
      checks.push(
        'div[class*="ds-thinking"]',
        'div[class*="generating"]'
      );
    } else if (sid === 'gemini') {
      checks.push(
        'mat-icon[data-mat-icon-name="stop_circle"]',
        'button[data-test-id="stop-button"]'
      );
    } else if (sid === 'chatgpt') {
      checks.push(
        'button[data-testid="stop-button"]',
        'button[aria-label="Stop streaming"]',
        'button[aria-label="Stop generating"]'
      );
    }

    // Generic: only match explicit "Stop generating" / "Stop response" buttons
    checks.push(
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop response" i]',
      'button[aria-label="Stop" i]'
    );

    for (const sel of checks) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (visible(el)) return true;
        }
      } catch (_) {}
    }

    return false;
  } catch (_) { return false; }
})();
`;

  try {
    return !!(await webview.executeJavaScript(code));
  } catch (_) {
    return false;
  }
}

async function tryCopyLatestAssistantReply(slot, serviceId = '') {
  const webview = webviews[slot];
  if (!webview || !webviewReady[slot]) {
    return { text: null, diagnostics: { method: 'copy', clicked: false, reason: 'webview-not-ready' } };
  }
  if (!window.electronAPI || typeof window.electronAPI.readClipboardText !== 'function' || typeof window.electronAPI.writeClipboardText !== 'function') {
    return { text: null, diagnostics: { method: 'copy', clicked: false, reason: 'no-clipboard-bridge' } };
  }

  const previousClipboard = await readClipboardTextSafe();
  const probeText = `__gunshi_copy_probe_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  await writeClipboardTextSafe(probeText);

  const code = `
(function() {
  try {
    const sid = ${JSON.stringify(serviceId || '')};
    function hasLayout(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    }
    function labelOf(el) {
      return String(
        el?.getAttribute?.('aria-label') ||
        el?.getAttribute?.('title') ||
        el?.getAttribute?.('mattooltip') ||
        el?.textContent ||
        ''
      ).replace(/\\s+/g, ' ').trim();
    }
    function isCopyLike(label, el) {
      const l = String(label || '').toLowerCase();
      if (l && (l.includes('copy') || l.includes('╤ü╨║╨╛╨┐') || l.includes('╨║╨╛╨┐╨╕╤Ç'))) return true;
      // Check CSS classes on element + children (DeepSeek uses class-based icons, not aria-labels)
      try {
        const own = (el?.className || '').toString().toLowerCase();
        if (own.includes('copy')) return true;
        if (el?.querySelector?.('.dl-icon-copy, [class*="copy-icon"], [class*="copy-btn"], [class*="copy-button"]')) return true;
      } catch (_) {}
      return false;
    }
    function inExcludedArea(el) {
      if (!el) return true;
      // Only exclude buttons literally inside text input elements
      return !!el.closest('textarea, [contenteditable="true"], [role="textbox"], [data-testid*="composer"], [class*="composer"]');
    }
    function messageContainer(el) {
      // Try specific message selectors first
      const specific = el?.closest?.('[data-message-author-role="assistant"], [data-testid*="assistant"], [class*="assistant"][class*="message"], article, [class*="response"], [class*="answer"], [id^="response-"], model-response, response-container, [class*="message-bubble"], [class*="prose"]');
      if (specific) return specific;
      // Fallback: walk up the DOM to find nearest ancestor with enough text
      let parent = el?.parentElement;
      for (let i = 0; i < 15 && parent; i += 1) {
        const text = (parent.innerText || parent.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text.length >= 30) return parent;
        parent = parent.parentElement;
      }
      return null;
    }

    // Hover the last message container to reveal hidden copy buttons (Grok hides them until hover)
    const msgContainers = document.querySelectorAll('[id^="response-"], model-response, response-container, [data-message-author-role="assistant"], article, [class*="response"]');
    const lastContainer = Array.from(msgContainers).filter(hasLayout).pop();
    if (lastContainer) {
      ['mouseenter', 'mouseover', 'mousemove'].forEach((evt) => {
        try { lastContainer.dispatchEvent(new MouseEvent(evt, { bubbles: true, clientX: 100, clientY: 100 })); } catch (_) {}
      });
    }

    const selectors = [
      '[data-testid="copy-turn-action-button"]',  // ChatGPT (exact match)
      'button[aria-label*="Copy" i]',
      'button[title*="Copy" i]',
      '[role="button"][aria-label*="Copy" i]',
      '[data-testid*="copy" i]',
      '[data-test-id*="copy" i]',
      'button[aria-label*="╨Ü╨╛╨┐╨╕╤Ç" i]',
      '[role="button"][aria-label*="╨Ü╨╛╨┐╨╕╤Ç" i]',
      'button[aria-label*="╨í╨║╨╛╨┐" i]',
      'button[title*="╨í╨║╨╛╨┐" i]',
      'button[mattooltip*="Copy" i]',
      'copy-button button',
      '.dl-btn:has(.dl-icon-copy)',
      '.ds-icon-button:has(.dl-icon-copy)',
      '[role="button"]:has([class*="copy"])',
      '.ds-markdown-code-copy-button',
      // Fallback for unknown/new providers
      'button[aria-label*="Duplicate" i]',
      'button[title*="Duplicate" i]',
      'button[aria-label*="Clone" i]',
      'button[title*="Clone" i]',
      '[role="button"]:has(svg use[*="copy" i])',
      'button:has(svg use[href*="copy" i])',
      'button:has([class*="copy-icon"])',
      '[class*="action-btn"]:has([class*="copy"])',
      '[class*="toolbar-btn"]:has([class*="copy"])',
      'button[class*="copy"]',
      '[class*="message-action"] button:first-child'
    ];

    const seen = new Set();
    const candidates = [];
    const selectorHits = {};
    const rejected = [];
    selectors.forEach((sel) => {
      try {
        const found = document.querySelectorAll(sel);
        selectorHits[sel] = found.length;
        found.forEach((el) => {
          if (!el || seen.has(el)) return;
          seen.add(el);
          // Skip excluded-area check for ChatGPT's exact copy button (data-testid="copy-turn-action-button")
          const isExactChatGPT = sel === '[data-testid="copy-turn-action-button"]';
          if (!isExactChatGPT && inExcludedArea(el)) { rejected.push({ sel, reason: 'excluded-area', tag: el.tagName, label: labelOf(el).slice(0, 40) }); return; }
          if (!hasLayout(el)) { rejected.push({ sel, reason: 'no-layout', tag: el.tagName, label: labelOf(el).slice(0, 40) }); return; }
          const label = labelOf(el);
          if (!isCopyLike(label, el)) { rejected.push({ sel, reason: 'not-copy-like', tag: el.tagName, label: label.slice(0, 40) }); return; }
          const rect = el.getBoundingClientRect();
          const msg = messageContainer(el);
          const msgText = (msg?.innerText || msg?.textContent || '').replace(/\\s+/g, ' ').trim();
          if (!msgText || msgText.length < 20) { rejected.push({ sel, reason: 'msg-too-short', tag: el.tagName, label: label.slice(0, 40), msgLen: msgText.length, hasContainer: !!msg }); return; }
          let score = rect.bottom + Math.min(msgText.length, 5000) * 0.04;
          if (sid === 'perplexity' && msgText.toLowerCase().includes('ask a follow-up')) score -= 1200;
          candidates.push({ el, label, score, bottom: rect.bottom });
        });
      } catch (_) {}
    });

    // Fallback: scan ALL buttons on the page for debug
    let allButtonsSample = [];
    if (candidates.length === 0) {
      try {
        allButtonsSample = Array.from(document.querySelectorAll('button, [role="button"]')).slice(-20).map((el) => {
          const lbl = (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('mattooltip') || '').slice(0, 50);
          const txt = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 50);
          const tid = el.getAttribute('data-testid') || el.getAttribute('data-test-id') || '';
          const cls = (el.className || '').toString().slice(0, 80);
          return { tag: el.tagName, lbl, txt, tid, cls, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) };
        });
      } catch (_) {}
    }

    if (candidates.length === 0) return { clicked: false, reason: 'no-copy-button', debug: { lastContainerFound: !!lastContainer, selectorsChecked: selectors.length, selectorHits, rejected: rejected.slice(0, 10), allButtonsSample } };
    candidates.sort((a, b) => (b.score - a.score) || (b.bottom - a.bottom));
    const target = candidates[0];
    // Hover the button itself + its parent to ensure it becomes interactive
    const hoverTarget = target.el.closest('[class*="group"]') || target.el.parentElement || target.el;
    ['mouseenter', 'mouseover', 'mousemove'].forEach((evt) => {
      try { hoverTarget.dispatchEvent(new MouseEvent(evt, { bubbles: true })); } catch (_) {}
      try { target.el.dispatchEvent(new MouseEvent(evt, { bubbles: true })); } catch (_) {}
    });
    try { target.el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
    try { window.focus(); } catch (_) {}

    // Intercept clipboard.writeText so we capture the text even if clipboard permission is denied
    window.__gunshiCopyCapture = null;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        const origWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = function(text) {
          window.__gunshiCopyCapture = text;
          return origWrite(text).catch(() => {});
        };
      }
    } catch (_) {}
    // Intercept clipboard.write() (ClipboardItem API) ΓÇö used by Gemini, Grok
    try {
      if (navigator.clipboard && navigator.clipboard.write) {
        const origClipWrite = navigator.clipboard.write.bind(navigator.clipboard);
        navigator.clipboard.write = async function(items) {
          try {
            for (const item of items) {
              if (item.types && item.types.includes('text/plain')) {
                const blob = await item.getType('text/plain');
                window.__gunshiCopyCapture = await blob.text();
                break;
              }
              // Also try text/html ΓåÆ strip tags as fallback
              if (item.types && item.types.includes('text/html') && !window.__gunshiCopyCapture) {
                const blob = await item.getType('text/html');
                const html = await blob.text();
                const tmp = document.createElement('div');
                tmp.innerHTML = html;
                window.__gunshiCopyCapture = tmp.textContent || tmp.innerText || '';
              }
            }
          } catch (_) {}
          return origClipWrite(items).catch(() => {});
        };
      }
    } catch (_) {}
    // Also intercept execCommand('copy') for older implementations
    try {
      const origExec = document.execCommand.bind(document);
      document.execCommand = function(cmd) {
        if (cmd === 'copy') {
          try { window.__gunshiCopyCapture = window.getSelection().toString(); } catch (_) {}
        }
        return origExec.apply(document, arguments);
      };
    } catch (_) {}

    target.el.click();
    return { clicked: true, label: target.label, score: target.score, candidates: candidates.length };
  } catch (e) {
    return { clicked: false, reason: String(e && e.message || e) };
  }
})();
`;

  try {
    // Focus the webview so the page's clipboard API works
    try { webview.focus(); } catch (_) { }
    await sleep(100);

    const clickInfo = await webview.executeJavaScript(code);
    if (!clickInfo || !clickInfo.clicked) {
      return {
        text: null,
        diagnostics: {
          method: 'copy',
          clicked: false,
          reason: clickInfo?.reason || 'unknown',
          debug: clickInfo?.debug || null,
          candidates: clickInfo?.candidates || 0
        }
      };
    }

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      await sleep(200);
      // Try system clipboard first
      const current = await readClipboardTextSafe();
      const normalized = normalizeMultilineText(current);
      if (normalized && current !== probeText) {
        return {
          text: current,
          diagnostics: {
            method: 'copy',
            clicked: true,
            source: 'clipboard',
            attempts: attempt,
            label: clickInfo.label || '',
            candidates: clickInfo.candidates || 0
          }
        };
      }
      // Fallback: check intercepted clipboard.writeText inside webview
      try {
        const captured = await webview.executeJavaScript('window.__gunshiCopyCapture');
        if (captured && typeof captured === 'string' && captured.trim().length > 0) {
          return {
            text: captured,
            diagnostics: {
              method: 'copy',
              clicked: true,
              source: 'interceptor',
              attempts: attempt,
              label: clickInfo.label || '',
              candidates: clickInfo.candidates || 0
            }
          };
        }
      } catch (_) { }
    }
    return {
      text: null,
      diagnostics: {
        method: 'copy',
        clicked: true,
        clipboardTimeout: true,
        label: clickInfo.label || '',
        candidates: clickInfo.candidates || 0
      }
    };
  } catch (err) {
    return {
      text: null,
      diagnostics: {
        method: 'copy',
        clicked: false,
        reason: 'exception',
        error: String(err?.message || err)
      }
    };
  } finally {
    await writeClipboardTextSafe(previousClipboard);
  }
}

function readSessionContext() {
  const raw = localStorage.getItem(AGGREGATED_SESSION_CONTEXT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const sessionId = Number(parsed?.session_id);
    const fingerprint = String(parsed?.fingerprint || '').trim();
    if (!Number.isInteger(sessionId) || sessionId <= 0 || !fingerprint) return null;
    return {
      session_id: sessionId,
      fingerprint
    };
  } catch (_) {
    return null;
  }
}

function persistSessionContext(sessionId, fingerprint) {
  if (!Number.isInteger(sessionId) || sessionId <= 0 || !fingerprint) return;
  activeSessionId = sessionId; // always keep in-memory copy
  const context = {
    session_id: sessionId,
    fingerprint,
    updated_at: new Date().toISOString()
  };
  localStorage.setItem(AGGREGATED_SESSION_CONTEXT_KEY, JSON.stringify(context));
  localStorage.setItem(AGGREGATED_SESSION_ID_KEY, String(sessionId));
}

function clearStoredSessionContext() {
  activeSessionId = null;
  localStorage.removeItem(AGGREGATED_SESSION_CONTEXT_KEY);
  localStorage.removeItem(AGGREGATED_SESSION_ID_KEY);
}

function getStoredSessionIdForFingerprint(fingerprint) {
  const normalizedFingerprint = String(fingerprint || '').trim();
  if (!normalizedFingerprint) return null;
  const context = readSessionContext();
  if (!context) return null;
  return context.fingerprint === normalizedFingerprint ? context.session_id : null;
}

function extractConversationKey(serviceId, rawUrl) {
  const sid = String(serviceId || 'unknown').toLowerCase();
  const fallback = `${sid}:no-url`;
  if (!rawUrl) return fallback;

  try {
    const parsed = new URL(rawUrl);
    const origin = parsed.origin.toLowerCase();
    const path = (parsed.pathname || '/').replace(/\/+$/g, '') || '/';
    const segments = path.split('/').filter(Boolean);
    const looksLikeId = (value) => /^[a-z0-9][a-z0-9_-]{5,}$/i.test(String(value || ''));

    const firstAfter = (label) => {
      const idx = segments.findIndex((part) => part.toLowerCase() === label);
      if (idx >= 0 && segments[idx + 1]) return segments[idx + 1];
      return '';
    };

    let chatId = '';
    if (sid === 'chatgpt') {
      chatId = firstAfter('c') || firstAfter('chat');
      if (!chatId && parsed.searchParams.get('temporary-chat')) chatId = 'temporary';
    } else if (sid === 'claude') {
      chatId = firstAfter('chat');
    } else if (sid === 'deepseek') {
      chatId = firstAfter('s') || firstAfter('chat');
    } else if (sid === 'perplexity') {
      chatId = firstAfter('search');
    } else if (sid === 'grok') {
      chatId = firstAfter('c') || firstAfter('chat');
    } else if (sid === 'gemini') {
      chatId = firstAfter('chat');
    }

    if (!chatId) {
      const tail = segments[segments.length - 1] || '';
      if (looksLikeId(tail)) chatId = tail;
    }

    if (chatId) return `${sid}:${chatId}`;
    return `${sid}:${origin}${path.toLowerCase()}`;
  } catch (_) {
    return `${sid}:${String(rawUrl).trim().toLowerCase()}`;
  }
}

function buildSessionFingerprint(slots) {
  const slotList = Array.isArray(slots) ? slots : [];
  const parts = slotList.map((slot) => {
    const url = getWebviewCurrentUrl(slot);
    const serviceId = detectServiceByUrl(url) || slotConfig[slot] || 'unknown';
    const conversationKey = extractConversationKey(serviceId, url);
    return `${slot}:${conversationKey}`;
  }).sort();

  if (parts.length === 0) return '';
  return `fp_${hashString(stableStringify(parts))}`;
}

function getStoredAggregatedSessionId() {
  const context = readSessionContext();
  if (context?.session_id) return context.session_id;
  const raw = localStorage.getItem(AGGREGATED_SESSION_ID_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildAggregatedPayload(params) {
  const sourcePrompt = (params.sourcePrompt || '').trim();
  const title = sourcePrompt || `Gunshi merge ${new Date().toISOString()}`;
  const sessionId = Number.isInteger(params?.sessionId) && params.sessionId > 0
    ? params.sessionId
    : null;
  const responses = Array.isArray(params?.responses) ? params.responses : [];

  return {
    payload: {
      schema: 'aggregated_ingest_v1',
      session_id: sessionId,
      title,
      responses
    },
    sessionId
  };
}

async function ingestAggregatedPayload(payload, providerId, externalChatId, traceContext = null) {
  if (!window.electronAPI || typeof window.electronAPI.sendAggregated !== 'function') {
    return { ok: false, error: 'Ingest bridge is not available in preload.' };
  }
  return window.electronAPI.sendAggregated({
    payload,
    scrapeMeta: Array.isArray(traceContext?.scrapeMeta) ? traceContext.scrapeMeta : [],
    sourceMessageId: externalChatId || `${providerId || 'aggregated'}:${hashString(stableStringify(payload))}`,
    traceId: traceContext?.traceId || activeIngestTraceId || startIngestTrace(),
    sequence: Number.isInteger(traceContext?.sequence) ? traceContext.sequence : undefined
  });
}

function pickMarkdown(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return '';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeMultilineText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeTableDividerCell(cell) {
  const raw = String(cell || '').trim();
  if (!raw) return '---';
  const left = raw.startsWith(':');
  const right = raw.endsWith(':');
  const hyphenCount = (raw.match(/-/g) || []).length;
  const core = '-'.repeat(Math.max(3, hyphenCount));
  return `${left ? ':' : ''}${core}${right ? ':' : ''}`;
}

function looksLikePipeRow(line) {
  const text = String(line || '').trim();
  if (!text.includes('|')) return false;
  const bars = (text.match(/\|/g) || []).length;
  return bars >= 2;
}

function looksLikeTableDivider(line) {
  const text = String(line || '').trim();
  if (!looksLikePipeRow(text)) return false;
  return /^[\s|:\-]+$/.test(text);
}

function normalizePipeTableMarkdown(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = i + 1 < lines.length ? lines[i + 1] : '';

    if (looksLikePipeRow(line) && looksLikeTableDivider(next)) {
      if (out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
      out.push(line);
      const cells = next
        .split('|')
        .map((cell) => normalizeTableDividerCell(cell))
        .join('|');
      out.push(cells);
      i += 1;
      continue;
    }

    out.push(line);
  }
  return out.join('\n');
}

function isUnorderedListLine(line) {
  return /^\s*[-*+]\s+(?:\[[ xX]\]\s+)?\S/.test(String(line || ''));
}

function isOrderedListLine(line) {
  return /^\s*\d+[.)]\s+\S/.test(String(line || ''));
}

function normalizeListLine(line) {
  let out = String(line || '');
  // UI bullets / dashes -> markdown list marker
  out = out.replace(/^\s*[ΓÇóΓùªΓùÅΓû¬Γû½ΓÇúΓêÖ]\s+/, '- ');
  out = out.replace(/^\s*[ΓÇôΓÇöΓêÆ]\s+/, '- ');
  // "1) item" -> "1. item"
  out = out.replace(/^(\s*)(\d+)\)\s+/, '$1$2. ');
  return out;
}

function normalizeListMarkdown(text) {
  const source = String(text || '').replace(/\r/g, '').split('\n').map(normalizeListLine);
  const out = [];
  for (let i = 0; i < source.length; i += 1) {
    const line = source[i];
    const isList = isUnorderedListLine(line) || isOrderedListLine(line);
    if (isList) {
      const prev = out.length > 0 ? out[out.length - 1] : '';
      const prevIsBlank = !String(prev || '').trim();
      const prevIsList = isUnorderedListLine(prev) || isOrderedListLine(prev);
      if (!prevIsBlank && !prevIsList) out.push('');
    }
    out.push(line);
  }
  return out.join('\n');
}

function toNoteTitle(rawText, fallback) {
  const text = pickMarkdown(rawText);
  if (!text) return fallback;
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}...` : oneLine;
}

function isQualityReply(text, sourcePrompt = '') {
  if (!text || text.trim().length < INGEST_MIN_REPLY_CHARS) return false;
  const flat = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const promptFlat = (sourcePrompt || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Reject if the scraped text is just the user's prompt
  if (promptFlat && flat === promptFlat) return false;
  if (promptFlat && flat.length < promptFlat.length * 1.5 && flat.includes(promptFlat)) return false;
  return true;
}

// ========== TABLE FORMAT CONVERSION ==========
// LLMs export tables in different formats:
//   CSV  (Grok, Gemini)    ΓåÆ  col1,col2,col3
//   Space-aligned (DeepSeek) ΓåÆ  col1  col2  col3   (2+ spaces as separator)
//   Markdown (Perplexity, ChatGPT, Claude) ΓåÆ | col1 | col2 |  (already fine)
// We convert CSV and space-aligned ΓåÆ markdown so the frontend renders properly.

function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (ch === ',' && !inQ) {
      fields.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur.trim());
  return fields;
}

function csvBlockToMarkdown(csvText) {
  const lines = csvText.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;
  // Must not already be markdown table
  if (lines.some(l => l.startsWith('|'))) return null;
  // Must not look like markdown heading, list, or code
  if (lines.some(l => /^[#>\-*`]/.test(l))) return null;
  // All lines must have at least one comma
  if (!lines.every(l => l.includes(','))) return null;

  const rows = lines.map(parseCsvLine);
  const expectedCols = rows[0].length;
  if (expectedCols < 2) return null;
  // Column count must be consistent (allow trailing empty cell)
  if (!rows.every(r => r.length === expectedCols || r.length === expectedCols - 1)) return null;

  const esc = s => String(s).replace(/\|/g, '\\|');
  const fmtRow = r => '| ' + r.map(esc).join(' | ') + ' |';
  const sep = '| ' + rows[0].map(() => '---').join(' | ') + ' |';
  return [fmtRow(rows[0]), sep, ...rows.slice(1).map(fmtRow)].join('\n');
}

// Convert pure-CSV reply OR CSV blocks embedded within text
function convertCsvTablesToMarkdown(text) {
  if (!text) return text;

  // Case 1: entire text is one CSV table
  const full = csvBlockToMarkdown(text);
  if (full) return full;

  // Case 2: CSV blocks separated by blank lines within mixed content
  const blocks = text.split(/\n{2,}/);
  const converted = blocks.map(block => csvBlockToMarkdown(block) || block);
  // Only return the joined result if at least one block was converted
  if (converted.some((b, i) => b !== blocks[i])) {
    return converted.join('\n\n');
  }

  return text;
}

// Convert space-aligned tables (DeepSeek format) ΓåÆ markdown tables.
// DeepSeek uses 2+ spaces as column separator; single spaces appear inside values.
// Works on mixed content: text lines and table rows can be adjacent (no blank line needed).
function convertSpaceAlignedTables(text) {
  if (!text) return text;

  const esc = s => String(s).replace(/\|/g, '\\|');
  const fmtRow = (parts, cols) => {
    const padded = [...parts];
    while (padded.length < cols) padded.push('');
    return '| ' + padded.map(esc).join(' | ') + ' |';
  };

  const inputLines = text.split('\n');
  const output = [];
  let tableBuf = [];   // array of string[] (parsed rows)
  let colCount = 0;

  function flushTable() {
    if (tableBuf.length < 2) {
      // Single line or empty ΓÇö not a real table, output raw
      tableBuf.forEach((_, i) => {
        // Reconstruct original-ish line
        output.push(tableBuf[i].join('  '));
      });
    } else {
      const sep = '| ' + tableBuf[0].map(() => '---').join(' | ') + ' |';
      output.push(fmtRow(tableBuf[0], colCount));
      output.push(sep);
      tableBuf.slice(1).forEach(r => output.push(fmtRow(r, colCount)));
    }
    tableBuf = [];
    colCount = 0;
  }

  for (const rawLine of inputLines) {
    const line = rawLine.trim();

    // Empty line ΓåÆ flush any pending table, pass through blank
    if (!line) {
      flushTable();
      output.push('');
      continue;
    }

    // Already a markdown element ΓåÆ flush and pass through
    if (/^[|#>\-*`]/.test(line)) {
      flushTable();
      output.push(rawLine);
      continue;
    }

    // Check for 2+ space separator
    if (!/\s{2,}/.test(line)) {
      flushTable();
      output.push(rawLine);
      continue;
    }

    const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(p => p);
    if (parts.length < 2) {
      flushTable();
      output.push(rawLine);
      continue;
    }

    if (tableBuf.length === 0) {
      // Start new table block
      colCount = parts.length;
      tableBuf.push(parts);
    } else if (parts.length >= 2 && parts.length <= colCount) {
      // Same or fewer cols (e.g. summary row like "╨ÿ╤é╨╛╨│╨╛  6 150 Γé╜") ΓåÆ keep in table
      tableBuf.push(parts);
    } else if (parts.length > colCount) {
      // More columns than current header ΓåÆ end table, start new one
      flushTable();
      colCount = parts.length;
      tableBuf.push(parts);
    } else {
      flushTable();
      output.push(rawLine);
    }
  }
  flushTable();

  const result = output.join('\n').trim();
  // Only return if we actually changed something
  return result !== text.trim() ? result : text;
}

function sanitizeScrapedReply(serviceId, rawReply, sourcePrompt = '') {
  let text = normalizeMultilineText(pickMarkdown(rawReply));
  if (!text) return '';

  const normalizedPrompt = normalizeMultilineText(sourcePrompt).replace(/\n+/g, ' ').trim();
  if (normalizedPrompt) {
    const escapedPrompt = escapeRegExp(normalizedPrompt);
    text = text
      .replace(new RegExp(`^\\s*${escapedPrompt}[\\s:ΓÇö\\-]*\\n+`, 'i'), '')
      .replace(new RegExp(`^(?:you said|╨▓╤ï ╤ü╨║╨░╨╖╨░╨╗╨╕)\\s+${escapedPrompt}[\\s:ΓÇö\\-]*`, 'i'), '')
      .replace(new RegExp(`\\b(?:you said|╨▓╤ï ╤ü╨║╨░╨╖╨░╨╗╨╕)\\s+${escapedPrompt}\\b`, 'ig'), '')
      .trim();
  }

  if (serviceId === 'gemini') {
    text = text
      .replace(/^conversation with gemini\s*/i, '')
      .replace(/\byou said\b[\s\S]*?\bgemini said\b[:\s]*/i, '')
      .replace(/\bgemini said\b[:\s]*/i, '')
      // Strip "Opens in a new window [url] Open" image link artifacts (may span one line)
      .replace(/opens in a new window[^\n]*/gi, '')
      .trim();
  }

  if (serviceId === 'grok') {
    // Strip leading user-prompt echo (happens when wrong container is scraped)
    if (normalizedPrompt) {
      const escapedPrompt = escapeRegExp(normalizedPrompt);
      text = text.replace(new RegExp(`^\\s*${escapedPrompt}\\s*\\n?`, 'i'), '').trim();
    }
    // Strip trailing timing / suggestion-chip lines
    text = text
      .replace(/\n\d[\d,.]*\s*[╤üs]\s*$/im, '')   // e.g. "\n1,1╤ü"
      .replace(/\n╨▒╤ï╤ü╤é╤Ç╨╛\s*$/im, '')
      .trim();
  }

  const dropLine = (lineLower) => {
    if (!lineLower) return true;
    if (lineLower === 'source') return true;
    if (lineLower === 'share' || lineLower === 'edit' || lineLower === 'retry' || lineLower === 'copy' || lineLower === 'regenerate') return true;
    if (lineLower === 'open sidebar' || lineLower === 'reply...' || lineLower === 'temporary chat' || lineLower === 'incognito chat') return true;
    if (lineLower === 'tools' || lineLower === 'fast') return true;
    if (lineLower.startsWith('model:') || lineLower.includes('window.__')) return true;
    if (lineLower.includes('╨┐╨╡╤Ç╨╡╨║╨╗╤Ä╤ç╨╕╤é╤î ╨▒╨╛╨║╨╛╨▓╤â╤Ä ╨┐╨░╨╜╨╡╨╗╤î')) return true;
    if (lineLower.includes('can make mistakes') || lineLower.includes('please double-check responses')) return true;
    if (lineLower.includes('check important info') || lineLower.includes('see cookie preferences')) return true;
    // Gemini image result artifacts
    if (lineLower === 'opens in a new window' || lineLower === 'open') return true;
    if (/^www\.[^\s]+$/.test(lineLower)) return true;  // bare domain lines (e.g. www.ozon.ru)
    // Grok UI artifacts: timing lines, suggestion chips
    if (/^\d[\d,.]*\s*[╤üs]$/.test(lineLower)) return true;  // "1,1╤ü" / "1.1s"
    if (lineLower === '╨▒╤ï╤ü╤é╤Ç╨╛' || lineLower === '╨┐╨╛╨┤╤Ç╨╛╨▒╨╜╨╡╨╡') return true;
    if (lineLower.startsWith('╤Ç╨░╤ü╤ü╨║╨░╨╢╨╕ ╨▒╨╛╨╗╤î╤ê╨╡')) return true;
    return false;
  };

  const lines = text.split('\n');
  const cleanedLines = [];
  let pendingBlank = false;

  lines.forEach((rawLine) => {
    const line = rawLine.replace(/\t/g, '  ').replace(/[ \t]+$/g, '');
    const compact = line.replace(/[ \t]+/g, ' ').trim();
    const lower = compact.toLowerCase();

    if (dropLine(lower)) return;

    if (!compact) {
      if (cleanedLines.length > 0) pendingBlank = true;
      return;
    }

    if (pendingBlank) {
      cleanedLines.push('');
      pendingBlank = false;
    }
    cleanedLines.push(line);
  });

  text = cleanedLines.join('\n').trim();

  text = text
    .replace(/(?:^|\n)(?:share|edit|retry|copy|regenerate)(?:\s+(?:share|edit|retry|copy|regenerate))*\s*$/i, '')
    .replace(/(?:^|\n)(?:reply\.\.\.|open sidebar)\s*$/ig, '')
    .trim();

  text = text.replace(/^source\s*\n+/i, '');
  text = normalizeListMarkdown(text);
  text = normalizePipeTableMarkdown(text);

  // Convert CSV tables (Grok/Gemini) and space-aligned tables (DeepSeek) ΓåÆ markdown
  text = convertCsvTablesToMarkdown(text);
  text = convertSpaceAlignedTables(text);

  return normalizeMultilineText(text);
}

function extractSessionId(result) {
  const raw = result?.data;
  if (Number.isInteger(raw?.session_id)) return raw.session_id;
  if (Array.isArray(raw) && Number.isInteger(raw[0]?.session_id)) return raw[0].session_id;
  return null;
}

async function sendAggregated(sessionId, title, responses, scrapeMeta = []) {
  const normalizedResponses = Array.isArray(responses)
    ? responses.map((item, idx) => ({
      segment_id: String(item?.segment_id || `segment_${idx + 1}`),
      provider: String(item?.provider || 'unknown'),
      source_url: String(item?.source_url || ''),
      markdown: pickMarkdown(item?.markdown || item?.content || item?.text || item?.answer || item?.response)
    })).filter(item => item.markdown)
    : [];

  const payload = {
    schema: 'aggregated_ingest_v1',
    session_id: Number.isInteger(sessionId) ? sessionId : null,
    title: title || `Aggregated ${new Date().toISOString()}`,
    responses: normalizedResponses
  };

  const sourceMessageId = `msg_${hashString(stableStringify(payload))}`;
  const traceContext = getIngestTraceContext(sourceMessageId);
  traceContext.scrapeMeta = Array.isArray(scrapeMeta) ? scrapeMeta : [];
  return ingestAggregatedPayload(payload, 'aggregated', sourceMessageId, traceContext);
}

async function sendMerge(sessionId, title, markdown, scrapeMeta = []) {
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { ok: false, error: 'session_id is required for merge.' };
  }
  if (!window.electronAPI || typeof window.electronAPI.sendMerge !== 'function') {
    return { ok: false, error: 'Merge bridge is not available in preload.' };
  }

  const payload = {
    schema: 'merge_ingest_v1',
    session_id: sessionId,
    title: title || `Merge ${new Date().toISOString()}`,
    markdown: pickMarkdown(markdown)
  };
  const sourceMessageId = `msg_${hashString(stableStringify(payload))}`;
  const traceContext = getIngestTraceContext(sourceMessageId);
  return window.electronAPI.sendMerge({
    payload,
    scrapeMeta: Array.isArray(scrapeMeta) ? scrapeMeta : [],
    sourceMessageId,
    traceId: traceContext.traceId,
    sequence: traceContext.sequence
  });
}

async function sendClarification(sessionId, title, markdown, scrapeMeta = []) {
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { ok: false, error: 'session_id is required for clarification.' };
  }
  if (!window.electronAPI || typeof window.electronAPI.sendClarification !== 'function') {
    return { ok: false, error: 'Clarification bridge is not available in preload.' };
  }

  const payload = {
    schema: 'clarification_ingest_v1',
    session_id: sessionId,
    title: title || `Clarification ${new Date().toISOString()}`,
    markdown: pickMarkdown(markdown)
  };
  const sourceMessageId = `msg_${hashString(stableStringify(payload))}`;
  const traceContext = getIngestTraceContext(sourceMessageId);
  return window.electronAPI.sendClarification({
    payload,
    scrapeMeta: Array.isArray(scrapeMeta) ? scrapeMeta : [],
    sourceMessageId,
    traceId: traceContext.traceId,
    sequence: traceContext.sequence
  });
}

function stripMergeMetadataFooter(text) {
  return String(text || '')
    .replace(/\r?\n\r?\n---\r?\nMerge provider:[\s\S]*$/i, '')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeLoadURL(slot, url) {
  const webview = webviews[slot];
  if (!webview || !url) return;

  const normalizedUrl = String(url).trim();
  if (!normalizedUrl) return;

  if (webviewReady[slot]) {
    try {
      webview.loadURL(normalizedUrl);
      pendingNavigation[slot] = null;
      return;
    } catch (err) {
      console.warn(`[${slot}] loadURL failed before ready sync, fallback to src:`, err?.message || err);
    }
  }

  pendingNavigation[slot] = normalizedUrl;
  webview.src = normalizedUrl;
}

function safeReload(slot) {
  const webview = webviews[slot];
  if (!webview) return;

  // Try reload() first regardless of ready state ΓÇö it works once webview is attached
  try {
    webview.reload();
    return;
  } catch (err) {
    console.warn(`[${slot}] reload() failed, trying loadURL fallback:`, err?.message || err);
  }

  // Fallback: get current URL via getURL() or pendingNavigation or static src
  let fallbackUrl = pendingNavigation[slot];
  if (!fallbackUrl) {
    try { fallbackUrl = webview.getURL(); } catch (e) { }
  }
  if (!fallbackUrl) {
    fallbackUrl = webview.getAttribute('src');
  }
  if (fallbackUrl) {
    try {
      webview.loadURL(fallbackUrl);
    } catch (e) {
      webview.src = fallbackUrl;
    }
  }
}

// ========== LOAD SLOT CONFIG FROM LOCALSTORAGE ==========
function loadSlotConfig() {
  const saved = localStorage.getItem('slot-config');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch (e) {
      // corrupted, use defaults
    }
  }
  return { ...DEFAULT_SLOT_CONFIG };
}

function saveSlotConfig(config) {
  localStorage.setItem('slot-config', JSON.stringify(config));
}

const slotConfig = loadSlotConfig();

function parseSlotIndex(slotId) {
  const match = String(slotId || '').match(/^slot-(\d+)$/);
  if (!match) return -1;
  const idx = Number(match[1]) - 1;
  return Number.isInteger(idx) && idx >= 0 ? idx : -1;
}

function buildProjectUrlLookupKeys(slotId, serviceId) {
  const slotIndex = parseSlotIndex(slotId);
  const slotKey = slotIndex >= 0 ? `slot-${slotIndex + 1}` : String(slotId || '').trim().toLowerCase();
  const normalizedServiceId = String(serviceId || '').trim().toLowerCase();
  return Array.from(new Set([slotKey, normalizedServiceId].filter(Boolean)));
}

function resolveActiveProjectUrlForSlot(slotId, serviceId) {
  if (!activeProjectId || !activeProjectSlotUrls || typeof activeProjectSlotUrls !== 'object') return '';
  const keys = buildProjectUrlLookupKeys(slotId, serviceId);
  for (const key of keys) {
    const value = String(activeProjectSlotUrls[key] || '').trim();
    if (value) return value;
  }
  return '';
}

function getCurrentSlotUrl(slotId) {
  const webview = webviews[slotId];
  if (!webview) return '';
  try {
    return String(webview.getURL?.() || webview.getAttribute?.('src') || '').trim();
  } catch (_) {
    return String(webview.getAttribute?.('src') || '').trim();
  }
}

function applyProjectOverridesToVisibleSlots() {
  SLOTS.forEach((slot) => {
    const serviceId = String(slotConfig[slot] || '').trim();
    if (!serviceId) return;
    const overrideUrl = resolveActiveProjectUrlForSlot(slot, serviceId);
    if (!overrideUrl) return;
    safeLoadURL(slot, overrideUrl);
    const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
    if (urlInput) urlInput.value = overrideUrl;
  });
}

async function loadProjectSlotUrls(projectId) {
  if (!window.electronAPI || typeof window.electronAPI.getProjectSlotUrls !== 'function') {
    return {};
  }
  const response = await window.electronAPI.getProjectSlotUrls(projectId);
  if (!response || response.ok !== true || !response.slotUrls || typeof response.slotUrls !== 'object') {
    return {};
  }
  return response.slotUrls;
}

function buildProjectTreeNodes(tags, tagParents) {
  const namesById = new Map();
  (Array.isArray(tags) ? tags : []).forEach((row) => {
    const id = String(row?.id || '').trim();
    const name = String(row?.name || '').trim();
    if (!id || !name) return;
    namesById.set(id, name);
  });
  if (namesById.size === 0) return [];

  const parentIdsByChild = new Map();
  namesById.forEach((_, id) => parentIdsByChild.set(id, new Set()));
  (Array.isArray(tagParents) ? tagParents : []).forEach((edge) => {
    const childId = String(edge?.tag_id || edge?.tagId || '').trim();
    const parentId = String(edge?.parent_id || edge?.parentId || '').trim();
    if (!childId || !parentId) return;
    if (!namesById.has(childId) || !namesById.has(parentId) || childId === parentId) return;
    parentIdsByChild.get(childId)?.add(parentId);
  });

  const childrenByParent = new Map();
  const pushChild = (parentId, childId) => {
    const list = childrenByParent.get(parentId) || [];
    list.push(childId);
    childrenByParent.set(parentId, list);
  };

  parentIdsByChild.forEach((parentIds, childId) => {
    if (!parentIds || parentIds.size === 0) {
      pushChild(null, childId);
      return;
    }
    parentIds.forEach((parentId) => pushChild(parentId, childId));
  });

  childrenByParent.forEach((list, parentId) => {
    const deduped = Array.from(new Set(list));
    deduped.sort((a, b) => {
      const an = String(namesById.get(a) || '').toLowerCase();
      const bn = String(namesById.get(b) || '').toLowerCase();
      return an.localeCompare(bn);
    });
    childrenByParent.set(parentId, deduped);
  });

  const buildNode = (nodeId, pathSet) => {
    const nextPath = new Set(pathSet);
    nextPath.add(nodeId);
    const childNodes = (childrenByParent.get(nodeId) || [])
      .filter((childId) => !nextPath.has(childId))
      .map((childId) => buildNode(childId, nextPath));
    return { id: nodeId, name: namesById.get(nodeId) || '', children: childNodes };
  };

  const rootIds = childrenByParent.get(null) || [];
  const finalRootIds = rootIds.length > 0
    ? rootIds
    : Array.from(namesById.keys()).sort((a, b) => {
      const an = String(namesById.get(a) || '').toLowerCase();
      const bn = String(namesById.get(b) || '').toLowerCase();
      return an.localeCompare(bn);
    });

  return Array.from(new Set(finalRootIds)).map((rootId) => buildNode(rootId, new Set()));
}

function ensureExpandedProjectNodes(nodes) {
  if (expandedProjectNodeIds.size > 0) return;
  const walk = (list) => {
    list.forEach((node) => {
      if (!node || !Array.isArray(node.children) || node.children.length === 0) return;
      expandedProjectNodeIds.add(node.id);
      walk(node.children);
    });
  };
  walk(Array.isArray(nodes) ? nodes : []);
}

function renderProjectTreeNode(container, node, depth) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const isExpanded = expandedProjectNodeIds.has(node.id);
  const isSelected = activeProjectId === node.id;

  const row = document.createElement('div');
  row.className = `project-tree-row${isSelected ? ' selected' : ''}`;
  row.style.paddingLeft = `${6 + depth * 14}px`;

  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = `project-tree-chevron${hasChildren ? '' : ' placeholder'}`;
  chevron.textContent = hasChildren ? (isExpanded ? '\u25BE' : '\u25B8') : '\u25B8';
  if (hasChildren) {
    chevron.addEventListener('click', (event) => {
      event.stopPropagation();
      if (expandedProjectNodeIds.has(node.id)) expandedProjectNodeIds.delete(node.id);
      else expandedProjectNodeIds.add(node.id);
      renderProjectPanel(projectTreeNodes);
    });
  }
  row.appendChild(chevron);

  const name = document.createElement('span');
  name.className = 'project-tree-name';
  name.textContent = node.name || 'Untitled';
  row.appendChild(name);

  row.addEventListener('click', async () => {
    await setActiveProject(node.id);
    hideProjectPanel();
  });

  container.appendChild(row);

  if (hasChildren && isExpanded) {
    node.children.forEach((child) => renderProjectTreeNode(container, child, depth + 1));
  }
}

function renderProjectPanel(nodes = projectTreeNodes) {
  if (!projectTreeEl) return;
  projectTreeEl.innerHTML = '';

  const noProjectRow = document.createElement('div');
  noProjectRow.className = `project-tree-row${!activeProjectId ? ' selected' : ''}`;
  noProjectRow.style.paddingLeft = '6px';
  noProjectRow.innerHTML = '<button type="button" class="project-tree-chevron placeholder">▸</button><span class="project-tree-name">No Project</span>';
  noProjectRow.addEventListener('click', async () => {
    await setActiveProject(null);
    hideProjectPanel();
  });
  projectTreeEl.appendChild(noProjectRow);

  if (!Array.isArray(nodes) || nodes.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '8px 10px';
    empty.style.color = '#888';
    empty.style.fontSize = '12px';
    empty.textContent = 'No projects found';
    projectTreeEl.appendChild(empty);
    return;
  }

  nodes.forEach((node) => renderProjectTreeNode(projectTreeEl, node, 0));
}

function setProjectPanelVisible(visible) {
  isProjectPanelVisible = !!visible;
  if (projectPanelEl) projectPanelEl.classList.toggle('visible', isProjectPanelVisible);
  if (projectPanelScrimEl) projectPanelScrimEl.classList.toggle('visible', isProjectPanelVisible);
}

async function loadAndRenderProjectTree() {
  if (!window.electronAPI || typeof window.electronAPI.listProjectTreeData !== 'function') {
    projectTreeNodes = [];
    renderProjectPanel(projectTreeNodes);
    return;
  }
  try {
    const response = await window.electronAPI.listProjectTreeData();
    if (!response || response.ok !== true) {
      projectTreeNodes = [];
      renderProjectPanel(projectTreeNodes);
      return;
    }
    projectTreeNodes = buildProjectTreeNodes(response.tags, response.tagParents);
    ensureExpandedProjectNodes(projectTreeNodes);
    renderProjectPanel(projectTreeNodes);
    isProjectTreeLoaded = true;
  } catch (error) {
    console.warn('[projects] load failed:', error?.message || error);
    projectTreeNodes = [];
    renderProjectPanel(projectTreeNodes);
  }
}

function showProjectPanel() {
  setProjectPanelVisible(true);
  if (!isProjectTreeLoaded) {
    loadAndRenderProjectTree();
    return;
  }
  renderProjectPanel(projectTreeNodes);
}

function hideProjectPanel() {
  setProjectPanelVisible(false);
}

async function setActiveProject(projectId) {
  const normalizedId = projectId ? String(projectId).trim() : '';
  activeProjectId = normalizedId || null;
  if (projectSelectorBtn) {
    projectSelectorBtn.classList.toggle('active', !!activeProjectId);
  }
  renderProjectPanel(projectTreeNodes);

  const loadGen = ++projectSlotUrlLoadGeneration;
  if (!activeProjectId) {
    activeProjectSlotUrls = {};
    SLOTS.forEach((slot) => {
      const serviceId = String(slotConfig[slot] || '').trim();
      const preset = SERVICE_PRESETS[serviceId];
      if (preset?.url) {
        safeLoadURL(slot, preset.url);
        const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
        if (urlInput) urlInput.value = preset.url;
      }
    });
    return;
  }

  const slotUrls = await loadProjectSlotUrls(activeProjectId);
  if (loadGen !== projectSlotUrlLoadGeneration || activeProjectId !== normalizedId) return;
  activeProjectSlotUrls = slotUrls;
  applyProjectOverridesToVisibleSlots();
}

function loadSlotEnabledState() {
  const defaults = {};
  SLOTS.forEach(slot => { defaults[slot] = true; });

  const saved = localStorage.getItem(SLOT_ENABLED_STATE_KEY);
  if (!saved) return defaults;

  try {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) {
      const normalized = {};
      SLOTS.forEach(slot => {
        normalized[slot] = parsed.includes(slot);
      });
      return normalized;
    }
    if (!parsed || typeof parsed !== 'object') return defaults;
    const normalized = { ...defaults };
    SLOTS.forEach(slot => {
      if (typeof parsed[slot] === 'boolean') normalized[slot] = parsed[slot];
    });
    return normalized;
  } catch (_) {
    return defaults;
  }
}

function saveSlotEnabledState(state) {
  localStorage.setItem(SLOT_ENABLED_STATE_KEY, JSON.stringify(state));
}

function getCurrentSlotEnabledState() {
  const state = {};
  SLOTS.forEach(slot => {
    state[slot] = !!toggles[slot]?.checked;
  });
  return state;
}

const slotEnabledState = loadSlotEnabledState();
SLOTS.forEach(slot => {
  if (!toggles[slot]) return;
  toggles[slot].checked = slotEnabledState[slot] !== false;
  toggles[slot].addEventListener('change', () => {
    slotEnabledState[slot] = !!toggles[slot].checked;
    saveSlotEnabledState(slotEnabledState);
  });
});
saveSlotEnabledState(getCurrentSlotEnabledState());
window.addEventListener('beforeunload', () => {
  saveSlotEnabledState(getCurrentSlotEnabledState());
});

// ========== INITIALIZE SLOTS ==========
function initSlot(slot) {
  const serviceId = slotConfig[slot];
  const webview = webviews[slot];
  const select = document.querySelector(`.service-select[data-slot="${slot}"]`);

  if (!webview) return;

  // Set dropdown to current service
  if (select && serviceId) {
    select.value = serviceId;
  }

  // Update toggle label
  updateSlotLabel(slot, serviceId);

  // Load URL
  const preset = SERVICE_PRESETS[serviceId];
  const projectOverride = resolveActiveProjectUrlForSlot(slot, serviceId);
  const targetUrl = projectOverride || (preset ? preset.url : '');
  if (targetUrl) {
    webview.src = targetUrl;
    const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
    if (urlInput) urlInput.value = targetUrl;
  }
}

function updateSlotLabel(slot, serviceId) {
  const label = labels[slot];
  if (!label) return;
  const preset = SERVICE_PRESETS[serviceId];
  label.textContent = preset ? preset.name : 'Custom';
}

// Initialize all slots
SLOTS.forEach(slot => initSlot(slot));

// Mobile UA startup is handled in the MOBILE UA TOGGLE section via setAttribute

// ========== SERVICE SELECT CHANGE ==========
document.querySelectorAll('.service-select').forEach(select => {
  select.addEventListener('change', (e) => {
    const slot = select.dataset.slot;
    const serviceId = e.target.value;
    const webview = webviews[slot];

    if (!webview) return;

    slotConfig[slot] = serviceId;
    saveSlotConfig(slotConfig);
    updateSlotLabel(slot, serviceId);

    const projectOverride = resolveActiveProjectUrlForSlot(slot, serviceId);
    const preset = SERVICE_PRESETS[serviceId];
    if (projectOverride) {
      safeLoadURL(slot, projectOverride);
      const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
      if (urlInput) urlInput.value = projectOverride;
    } else if (preset) {
      safeLoadURL(slot, preset.url);
      const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
      if (urlInput) urlInput.value = preset.url;
    } else {
      // Custom URL: keep current URL visible for editing.
      const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
      if (urlInput) {
        urlInput.value = getCurrentSlotUrl(slot);
        urlInput.focus();
      }
    }
  });
});

if (projectSelectorBtn) {
  projectSelectorBtn.addEventListener('click', () => {
    if (isProjectPanelVisible) {
      hideProjectPanel();
    } else {
      showProjectPanel();
    }
  });
}
if (projectPanelCloseBtn) {
  projectPanelCloseBtn.addEventListener('click', hideProjectPanel);
}
if (projectPanelScrimEl) {
  projectPanelScrimEl.addEventListener('click', hideProjectPanel);
}

// ========== COLLAPSE TOOLBAR TOGGLE ==========
let collapsed = localStorage.getItem('top-collapsed');
collapsed = collapsed === 'true';

if (collapsed) {
  togglesContainer.classList.add('hidden');
}

collapseBtn.addEventListener('click', () => {
  collapsed = !collapsed;
  togglesContainer.classList.toggle('hidden', collapsed);
  localStorage.setItem('top-collapsed', collapsed);
});

// ========== ADDRESS BAR TOGGLE ==========
let addressBarVisible = true;

toggleAddressBarBtn.addEventListener('click', () => {
  addressBarVisible = !addressBarVisible;
  const headers = document.querySelectorAll('.webview-header');

  headers.forEach(header => {
    if (addressBarVisible) {
      header.classList.remove('hidden');
    } else {
      header.classList.add('hidden');
    }
  });

  toggleAddressBarBtn.textContent = addressBarVisible ? 'Hide Address Bar' : 'Show Address Bar';
  localStorage.setItem('show-address-bar', addressBarVisible);
});

// Restore address bar setting
const showAddressBar = localStorage.getItem('show-address-bar');
if (showAddressBar === 'false') {
  toggleAddressBarBtn.click();
}

// ========== WEBVIEW CONTROLS ==========
document.querySelectorAll('.webview-header').forEach(header => {
  const slot = header.dataset.slot;
  const webview = webviews[slot];
  if (!webview) return;

  const zoomLevelDisplay = header.querySelector('.zoom-level');
  const urlInput = header.querySelector('.webview-url');
  const backBtn = header.querySelector('[data-action="back"]');
  const forwardBtn = header.querySelector('[data-action="forward"]');
  const reloadBtn = header.querySelector('[data-action="reload"]');

  // ===== URL NAVIGATION =====

  // Update URL display when webview navigates
  webview.addEventListener('did-navigate', (e) => {
    urlInput.value = e.url;
    updateNavButtons();

    // Auto-detect service and update dropdown
    const detected = detectServiceByUrl(e.url);
    const select = header.querySelector('.service-select');
    if (detected && select && select.value !== detected) {
      select.value = detected;
      slotConfig[slot] = detected;
      saveSlotConfig(slotConfig);
      updateSlotLabel(slot, detected);
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    urlInput.value = e.url;
  });

  // Navigate to URL when user presses Enter
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      let url = urlInput.value.trim();

      if (!url) return;

      // Already has protocol
      if (url.startsWith('http://') || url.startsWith('https://')) {
        safeLoadURL(slot, url);
        urlInput.blur();
        return;
      }

      // Looks like a domain
      if (url.includes('.') && !url.includes(' ')) {
        safeLoadURL(slot, 'https://' + url);
        urlInput.blur();
        return;
      }

      // Search query
      const searchUrl = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      safeLoadURL(slot, searchUrl);
      urlInput.value = searchUrl;
      urlInput.blur();
    }
  });

  // Update navigation button states
  const updateNavButtons = () => {
    if (!webviewReady[slot]) {
      if (backBtn) backBtn.disabled = true;
      if (forwardBtn) forwardBtn.disabled = true;
      return;
    }

    try {
      if (backBtn) backBtn.disabled = !webview.canGoBack();
      if (forwardBtn) forwardBtn.disabled = !webview.canGoForward();
    } catch (err) {
      if (backBtn) backBtn.disabled = true;
      if (forwardBtn) forwardBtn.disabled = true;
    }
  };

  // Navigation buttons
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (!webviewReady[slot]) return;
      if (webview.canGoBack()) webview.goBack();
    });
  }

  if (forwardBtn) {
    forwardBtn.addEventListener('click', () => {
      if (!webviewReady[slot]) return;
      if (webview.canGoForward()) webview.goForward();
    });
  }

  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => {
      safeReload(slot);
    });
  }

  // Stop button
  const stopBtn = header.querySelector('[data-action="stop"]');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      if (!webviewReady[slot]) return;
      webview.stop();
      console.log(`[${slot}] Stopped loading`);
    });
  }

  // Save Page button
  const savePageBtn = header.querySelector('[data-action="save-page"]');
  if (savePageBtn) {
    savePageBtn.addEventListener('click', async () => {
      if (!webviewReady[slot]) {
        alert('Page is not ready yet');
        return;
      }

      const pageUrl = getWebviewCurrentUrl(slot);
      if (!pageUrl) {
        alert('No page loaded');
        return;
      }

      try {
        savePageBtn.disabled = true;
        savePageBtn.style.opacity = '0.5';

        // Get page content via executeJavaScript
        const pageContent = await webview.executeJavaScript(`
          (function() {
            const html = document.documentElement.outerHTML;
            return html;
          })()
        `);

        if (!pageContent) {
          alert('Failed to get page content');
          return;
        }

        // Call Electron API to show save dialog
        const result = await window.electronAPI.savePage(pageContent, pageUrl);

        if (result.ok) {
          alert(result.message);
        } else {
          alert('Save failed: ' + result.message);
        }
      } catch (err) {
        console.error(`[${slot}] Save page error:`, err);
        alert('Error saving page: ' + err.message);
      } finally {
        savePageBtn.disabled = false;
        savePageBtn.style.opacity = '1';
      }
    });
  }

  // ===== ZOOM CONTROLS =====

  const updateZoomDisplay = () => {
    const percent = Math.round(zoomLevels[slot] * 100);
    zoomLevelDisplay.textContent = `${percent}%`;
  };

  header.querySelectorAll('.zoom-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;

      if (action === 'zoom-in') {
        zoomLevels[slot] = Math.min(zoomLevels[slot] + 0.1, 3.0);
      } else if (action === 'zoom-out') {
        zoomLevels[slot] = Math.max(zoomLevels[slot] - 0.1, 0.25);
      } else if (action === 'zoom-reset') {
        zoomLevels[slot] = DEFAULT_ZOOM_FACTOR;
      }

      try {
        await webview.setZoomFactor(zoomLevels[slot]);
        updateZoomDisplay();
        localStorage.setItem(`zoom-${slot}`, zoomLevels[slot]);
      } catch (err) {
        console.error(`Failed to set zoom for ${slot}:`, err);
      }
    });
  });

  // Restore saved zoom
  webview.addEventListener('dom-ready', async () => {
    webviewReady[slot] = true;

    if (pendingNavigation[slot]) {
      try {
        const currentUrl = webview.getURL();
        if (!currentUrl || currentUrl !== pendingNavigation[slot]) {
          webview.loadURL(pendingNavigation[slot]);
        }
      } catch (_) {
        // Ignore transient ready races
      }
      pendingNavigation[slot] = null;
    }

    const savedZoomRaw = localStorage.getItem(`zoom-${slot}`);
    const savedZoom = Number.parseFloat(savedZoomRaw);
    const hasValidSavedZoom = Number.isFinite(savedZoom) && savedZoom >= 0.25 && savedZoom <= 3.0;
    zoomLevels[slot] = hasValidSavedZoom ? savedZoom : DEFAULT_ZOOM_FACTOR;

    try {
      await webview.setZoomFactor(zoomLevels[slot]);
      updateZoomDisplay();
    } catch (err) {
      console.error(`Failed to apply zoom for ${slot}:`, err);
    }

    // Update URL input to reflect current webview URL
    try {
      const currentUrl = webview.getURL();
      if (currentUrl) urlInput.value = currentUrl;
    } catch (e) {
      // webview not ready yet
    }

    updateNavButtons();
  });

  // Update nav buttons on load
  webview.addEventListener('did-stop-loading', updateNavButtons);

});

// ========== COOKIE IMPORT ==========
importCookiesBtn.addEventListener('click', () => {
  console.log('Import Cookies button clicked');

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    console.log('File selected:', file.name);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        console.log('Reading file content...');
        const content = event.target.result;
        console.log('File size:', content.length, 'bytes');

        if (!window.electronAPI?.importCookies) {
          alert('Cookie import API is unavailable. Restart the app.');
          return;
        }

        const result = await window.electronAPI.importCookies(content);
        if (!result?.ok) {
          alert(result?.message || 'Failed to import cookies.');
          return;
        }

        alert(result.message || 'Cookies imported.');

      } catch (err) {
        console.error('Error reading file:', err);
        alert('Error reading file: ' + err.message);
      }
    };

    reader.readAsText(file);
  };

  input.click();
});

// ========== MOBILE UA TOGGLE ==========
const mobileUaToggle = document.getElementById('mobile-ua-toggle');
const ingestSessionIndicator = document.getElementById('ingest-session-indicator');
const ingestSessionLabel = document.getElementById('ingest-session-label');
let mobileUaEnabled = localStorage.getItem('mobile-ua') === 'true';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function applyMobileUaState() {
  if (mobileUaEnabled) {
    mobileUaToggle?.classList.add('active');
  } else {
    mobileUaToggle?.classList.remove('active');
  }
}

applyMobileUaState();

function clearIngestSessionIndicator() {
  ingestSessionIndicator?.classList.remove('active');
  if (ingestSessionLabel) ingestSessionLabel.textContent = 'Session ID';
}

clearIngestSessionIndicator();

function setIngestSessionIndicator(sessionId) {
  const isActive = Number.isInteger(sessionId) && sessionId > 0;
  ingestSessionIndicator?.classList.toggle('active', isActive);
  if (ingestSessionLabel) {
    ingestSessionLabel.textContent = isActive ? `Session ${sessionId}` : 'Session ID';
  }
}

// Apply mobile UA on startup (just set attribute, no reload needed ΓÇö webviews load with it)
if (mobileUaEnabled) {
  SLOTS.forEach(slot => {
    const wv = webviews[slot];
    if (wv) wv.setAttribute('useragent', MOBILE_UA);
  });
}

mobileUaToggle?.addEventListener('click', () => {
  mobileUaEnabled = !mobileUaEnabled;
  localStorage.setItem('mobile-ua', mobileUaEnabled.toString());
  applyMobileUaState();

  SLOTS.forEach(slot => {
    const wv = webviews[slot];
    if (!wv) return;
    if (mobileUaEnabled) {
      wv.setAttribute('useragent', MOBILE_UA);
    } else {
      wv.removeAttribute('useragent');
    }
    // Get current URL and reload by reassigning src
    const url = wv.getURL?.() || wv.getAttribute('src') || pendingNavigation[slot];
    if (url) {
      wv.src = url;
    }
  });

  console.log(`[MobileUA] ${mobileUaEnabled ? 'Mobile' : 'Desktop'} UA ΓÇö all ${SLOTS.length} webviews reloading`);
});

// ========== SCOPED FIND (CMD/CTRL+F) ==========
const searchOverlay = document.getElementById('search-overlay');
const searchInput = document.getElementById('search-input');
const searchPrevBtn = document.getElementById('search-prev-btn');
const searchNextBtn = document.getElementById('search-next-btn');
const searchCloseBtn = document.getElementById('search-close-btn');
const searchScopeLabel = document.getElementById('search-scope-label');
const sidePanelContentEl = document.getElementById('side-panel-content');
const bottomPanelEl = document.getElementById('bottom-panel');
const mainContentEl = document.getElementById('main-content');

function hasMergeSearchContent() {
  const mergeText = (document.getElementById('merge-result')?.innerText || '').trim();
  return mergeText.length > 0;
}

function setFocusedSearchScope(scope) {
  focusedSearchScope = scope || 'global';
}

function resolveSlotFromActiveElement(activeEl) {
  if (!activeEl) return null;
  if (activeEl.tagName === 'WEBVIEW' && activeEl.id?.startsWith('webview-')) {
    return activeEl.id.replace('webview-', '');
  }
  const header = activeEl.closest?.('.webview-header[data-slot]');
  if (header?.dataset?.slot) return header.dataset.slot;
  const container = activeEl.closest?.('.webview-container');
  if (container) {
    const cHeader = container.querySelector('.webview-header[data-slot]');
    if (cHeader?.dataset?.slot) return cHeader.dataset.slot;
  }
  return null;
}

function resolveCurrentSearchScope() {
  const activeEl = document.activeElement;
  const activeSlot = resolveSlotFromActiveElement(activeEl);
  if (activeSlot) return activeSlot;

  if (activeEl?.closest?.('#side-panel') && hasMergeSearchContent()) {
    return 'merge';
  }

  if (focusedSearchScope === 'merge' && !hasMergeSearchContent()) {
    return 'global';
  }

  return focusedSearchScope || 'global';
}

function scopeLabel(scope) {
  if (scope === 'global') return 'scope: all';
  if (scope === 'merge') return 'scope: merge';
  const n = scope.replace('slot-', '');
  return `scope: slot ${n}`;
}

function updateScopeLabel() {
  if (!searchScopeLabel) return;
  searchScopeLabel.textContent = scopeLabel(resolveCurrentSearchScope());
}

function clearWebviewFindSelections() {
  SLOTS.forEach(slot => {
    try {
      webviews[slot]?.stopFindInPage('clearSelection');
    } catch (_) { }
  });
}

function clearMergeHighlights() {
  const root = document.getElementById('merge-result');
  if (!root) return;
  root.querySelectorAll('mark.search-hit').forEach(mark => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
    parent.normalize();
  });
  mergeSearchState.query = '';
  mergeSearchState.marks = [];
  mergeSearchState.index = -1;
}

function highlightMergeMatches(query) {
  const root = document.getElementById('merge-result');
  if (!root) return [];

  clearMergeHighlights();
  if (!query) return [];

  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: node => {
      const value = node?.nodeValue || '';
      if (!value.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.closest('mark.search-hit')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  for (const textNode of textNodes) {
    const original = textNode.nodeValue || '';
    const lower = original.toLowerCase();
    let idx = lower.indexOf(lowerQuery);
    if (idx === -1) continue;

    const frag = document.createDocumentFragment();
    let cursor = 0;
    while (idx !== -1) {
      if (idx > cursor) {
        frag.appendChild(document.createTextNode(original.slice(cursor, idx)));
      }
      const mark = document.createElement('mark');
      mark.className = 'search-hit';
      mark.textContent = original.slice(idx, idx + query.length);
      frag.appendChild(mark);
      cursor = idx + query.length;
      idx = lower.indexOf(lowerQuery, cursor);
    }
    if (cursor < original.length) {
      frag.appendChild(document.createTextNode(original.slice(cursor)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return Array.from(root.querySelectorAll('mark.search-hit'));
}

function stepMergeSearch(query, direction = 'forward') {
  if (!query) {
    clearMergeHighlights();
    return;
  }

  const isNewQuery = mergeSearchState.query !== query || mergeSearchState.marks.length === 0;
  if (isNewQuery) {
    mergeSearchState.query = query;
    mergeSearchState.marks = highlightMergeMatches(query);
    mergeSearchState.index = direction === 'backward'
      ? mergeSearchState.marks.length - 1
      : 0;
  } else if (mergeSearchState.marks.length > 0) {
    const step = direction === 'backward' ? -1 : 1;
    mergeSearchState.index = (mergeSearchState.index + step + mergeSearchState.marks.length) % mergeSearchState.marks.length;
  }

  mergeSearchState.marks.forEach(m => m.classList.remove('active'));
  const activeMark = mergeSearchState.marks[mergeSearchState.index];
  if (activeMark) {
    activeMark.classList.add('active');
    activeMark.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function searchWebviews(scope, query, direction, isNewSearch) {
  const forward = direction !== 'backward';
  const options = { forward, findNext: !isNewSearch };

  if (scope === 'global') {
    SLOTS.forEach(slot => {
      try { webviews[slot]?.findInPage(query, options); } catch (_) { }
    });
    return;
  }

  if (!SLOTS.includes(scope)) return;
  try { webviews[scope]?.findInPage(query, options); } catch (_) { }
}

function runScopedSearch(direction = 'forward') {
  const query = searchInput?.value.trim() || '';
  const scope = resolveCurrentSearchScope();
  const isNewSearch = query !== searchSession.query || scope !== searchSession.scope;
  searchSession = { query, scope };

  updateScopeLabel();

  if (!query) {
    clearWebviewFindSelections();
    clearMergeHighlights();
    return;
  }

  if (isNewSearch) {
    clearWebviewFindSelections();
  }

  if (scope === 'merge') {
    clearWebviewFindSelections();
    stepMergeSearch(query, direction);
    return;
  }

  if (scope === 'global') {
    searchWebviews(scope, query, direction, isNewSearch);
    stepMergeSearch(query, direction);
    return;
  }

  clearMergeHighlights();
  searchWebviews(scope, query, direction, isNewSearch);
}

function openSearchOverlay() {
  if (!searchOverlay || !searchInput) return;
  updateScopeLabel();
  searchOverlay.classList.add('visible');
  searchOverlay.setAttribute('aria-hidden', 'false');
  searchInput.focus();
  searchInput.select();
}

function closeSearchOverlay() {
  if (!searchOverlay) return;
  searchOverlay.classList.remove('visible');
  searchOverlay.setAttribute('aria-hidden', 'true');
}

SLOTS.forEach(slot => {
  const container = document.querySelector(`.webview-header[data-slot="${slot}"]`)?.closest('.webview-container');
  container?.addEventListener('mousedown', () => setFocusedSearchScope(slot));
  webviews[slot]?.addEventListener('focus', () => setFocusedSearchScope(slot));
});

sidePanelContentEl?.addEventListener('mousedown', () => {
  setFocusedSearchScope(hasMergeSearchContent() ? 'merge' : 'global');
});

bottomPanelEl?.addEventListener('mousedown', () => setFocusedSearchScope('global'));
mainContentEl?.addEventListener('mousedown', (e) => {
  if (e.target === mainContentEl) setFocusedSearchScope('global');
});
messageInput?.addEventListener('focus', () => setFocusedSearchScope('global'));

window.addEventListener('app-find', () => openSearchOverlay());

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openSearchOverlay();
    return;
  }

  if (isProjectPanelVisible && e.key === 'Escape') {
    e.preventDefault();
    hideProjectPanel();
    return;
  }

  if (searchOverlay?.classList.contains('visible') && e.key === 'Escape') {
    e.preventDefault();
    closeSearchOverlay();
  }
});

searchInput?.addEventListener('input', () => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => runScopedSearch('forward'), 160);
});
searchInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runScopedSearch(e.shiftKey ? 'backward' : 'forward');
  }
});
searchPrevBtn?.addEventListener('click', () => runScopedSearch('backward'));
searchNextBtn?.addEventListener('click', () => runScopedSearch('forward'));
searchCloseBtn?.addEventListener('click', closeSearchOverlay);

// ========== MESSAGE SENDING ==========

function setStatus(slot, status) {
  const el = statuses[slot];
  if (!el) return;

  if (statusTimeouts[slot]) {
    clearTimeout(statusTimeouts[slot]);
    statusTimeouts[slot] = null;
  }

  el.className = `status ${status}`;

  if (status === 'success') {
    el.textContent = '\u2713';
  } else if (status === 'pending') {
    el.textContent = '\u23F3';
  } else if (status === 'error') {
    el.textContent = '\u2717';
  } else {
    el.textContent = '';
  }

  if (status === 'success' || status === 'error') {
    statusTimeouts[slot] = setTimeout(() => {
      el.textContent = '';
      el.className = 'status';
      statusTimeouts[slot] = null;
    }, 4000);
  }
}

function getSelectorsForSlot(slot) {
  const webview = webviews[slot];
  if (!webview) return null;

  // Try to detect service by current URL
  let currentUrl = '';
  try {
    currentUrl = webview.getURL();
  } catch (e) { }

  const serviceId = detectServiceByUrl(currentUrl);

  if (serviceId && SERVICE_PRESETS[serviceId]) {
    return SERVICE_PRESETS[serviceId].selectors;
  }

  // Generic fallback selectors for unknown services
  return {
    textarea: ['textarea'],
    contenteditable: ['div[contenteditable="true"]', '[role="textbox"]'],
    button: ['button[type="submit"]']
  };
}

function normalizeSelectors(rawSelectors) {
  const toArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value === 'string') return [value];
    return [];
  };

  return {
    textarea: toArray(rawSelectors?.textarea),
    contenteditable: toArray(rawSelectors?.contenteditable),
    button: toArray(rawSelectors?.button)
  };
}

async function sendMessage(slot, text) {
  const webview = webviews[slot];
  const selector = normalizeSelectors(getSelectorsForSlot(slot));

  if (!webview || !selector) {
    setStatus(slot, 'error');
    return;
  }

  setStatus(slot, 'pending');

  // Detect service for Perplexity-specific hack
  let currentUrl = '';
  try { currentUrl = webview.getURL(); } catch (e) { }
  const serviceId = detectServiceByUrl(currentUrl) || '';

  const messageJson = JSON.stringify(text);
  const selectorsJson = JSON.stringify(selector);
  const serviceJson = JSON.stringify(serviceId);

  const code = `
   (async function() {
     const message = ${messageJson};
     const selectors = ${selectorsJson};
     const serviceId = ${serviceJson};
     const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

     function isVisible(el) {
       if (!el) return false;
       const rect = el.getBoundingClientRect();
       const style = window.getComputedStyle(el);
       return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
     }

     function firstVisibleBySelectors(selectorList) {
       for (const sel of selectorList || []) {
         try {
           const el = document.querySelector(sel);
           if (isVisible(el)) return el;
         } catch (_) {}
       }
       return null;
     }

     function firstVisibleInList(list) {
       return (list || []).find(isVisible) || null;
     }

     function findInput() {
       let el = firstVisibleBySelectors(selectors.textarea);
       if (el) return el;

       el = firstVisibleBySelectors(selectors.contenteditable);
       if (el) return el;

       el = firstVisibleInList(Array.from(document.querySelectorAll('textarea, div[contenteditable="true"], [role="textbox"]')));
       return el;
     }

     function setNativeValue(el, value) {
       const prototype = Object.getPrototypeOf(el);
       const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
       if (descriptor && descriptor.set) {
         descriptor.set.call(el, value);
       } else {
         el.value = value;
       }
     }

     function dispatchInputEvents(el, value) {
       try {
         el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));
       } catch (_) {
         el.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
       }
       el.dispatchEvent(new Event('input', { bubbles: true }));
       el.dispatchEvent(new Event('change', { bubbles: true }));
       el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
     }

     function fillInput(el, value) {
       el.focus();

       if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
         setNativeValue(el, value);
         dispatchInputEvents(el, value);
         return;
       }

       if (el.isContentEditable) {
         el.textContent = value;
         dispatchInputEvents(el, value);
         return;
       }

       el.textContent = value;
       dispatchInputEvents(el, value);
     }

     function isActionableButton(btn) {
       if (!btn || !isVisible(btn)) return false;
       return !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
     }

     function findSendButton() {
       const explicit = [];
       for (const sel of selectors.button || []) {
         try {
           explicit.push(...document.querySelectorAll(sel));
         } catch (_) {}
       }
       const explicitVisible = explicit.find(isActionableButton);
       if (explicitVisible) return explicitVisible;

       const candidates = Array.from(document.querySelectorAll('button,[role="button"]'));
       return candidates.find((btn) => {
         if (!isActionableButton(btn)) return false;
         const text = (btn.textContent || '').toLowerCase();
         const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
         const title = (btn.getAttribute('title') || '').toLowerCase();
         const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
         const joined = [text, aria, title, testid].join(' ');
         return joined.includes('send') || joined.includes('submit') || joined.includes('ask') || joined.includes('arrow');
       }) || null;
     }

     function pressEnter(el) {
       const keyboardOpts = {
         bubbles: true,
         cancelable: true,
         key: 'Enter',
         code: 'Enter',
         keyCode: 13,
         which: 13
       };
       el.dispatchEvent(new KeyboardEvent('keydown', keyboardOpts));
       el.dispatchEvent(new KeyboardEvent('keypress', keyboardOpts));
       el.dispatchEvent(new KeyboardEvent('keyup', keyboardOpts));
     }

     const inputEl = findInput();
     if (!inputEl) {
       return { success: false, error: 'Input not found' };
     }

     // Perplexity warm-up hack: React UI only enables send button after first keystroke
     if (serviceId === 'perplexity') {
       fillInput(inputEl, ' ');
       await wait(100);
       fillInput(inputEl, message);
       await wait(400);
       const btn = findSendButton();
       if (btn) {
         btn.click();
       } else {
         pressEnter(inputEl);
       }
       await wait(60);
       return { success: true };
     }

     fillInput(inputEl, message);
     await wait(140);

     let sent = false;
     const sendBtn = findSendButton();
     if (sendBtn) {
       sendBtn.click();
       sent = true;
     }

     if (!sent && inputEl.form && typeof inputEl.form.requestSubmit === 'function') {
       inputEl.form.requestSubmit();
       sent = true;
     }

     if (!sent) {
       pressEnter(inputEl);
       sent = true;
     }

     await wait(60);
     return { success: sent };
   })();
 `;

  try {
    let result;
    try {
      result = await webview.executeJavaScript(code);
      if (!result || !result.success) {
        throw new Error("First attempt failed");
      }
    } catch (err) {
      console.warn("[" + slot + "] Retry sending...");
      await new Promise(r => setTimeout(r, 1000));
      result = await webview.executeJavaScript(code);
    }

    if (result && result.success === false) {
      console.error(`[${slot}] Error:`, result.error);
      setStatus(slot, 'error');
    } else {
      setStatus(slot, 'success');
    }
  } catch (error) {
    console.error(`[${slot}] Exception:`, error);
    setStatus(slot, 'error');
  }
}

async function sendToAll() {
  const text = messageInput.value.trim();

  if (!text) {
    alert('Please enter a message');
    return;
  }

  if (window.mergeApiClient) {
    window.mergeApiClient.lastSourcePrompt = text;
  }

  const traceId = startIngestTrace();
  mergeLog(`Ingest trace started: ${traceId}`, 'info');

  const enabledSlots = SLOTS.filter(slot => toggles[slot] && toggles[slot].checked);
  const sessionFingerprint = buildSessionFingerprint(enabledSlots);
  activeSessionFingerprint = sessionFingerprint;
  const sessionIdByFingerprint = getStoredSessionIdForFingerprint(sessionFingerprint);
  const lastStoredSessionId = getStoredAggregatedSessionId();
  // activeSessionId is set immediately when ingest RPC returns, bridging the gap
  // if a second message fires before the first ingest has written to localStorage.
  const sessionIdHint = Number.isInteger(sessionIdByFingerprint) && sessionIdByFingerprint > 0
    ? sessionIdByFingerprint
    : (Number.isInteger(activeSessionId) && activeSessionId > 0
      ? activeSessionId
      : (Number.isInteger(lastStoredSessionId) && lastStoredSessionId > 0 ? lastStoredSessionId : null));

  if (Number.isInteger(sessionIdHint) && sessionIdHint > 0) {
    if (sessionFingerprint) {
      persistSessionContext(sessionIdHint, sessionFingerprint);
    } else {
      activeSessionId = sessionIdHint;
      localStorage.setItem(AGGREGATED_SESSION_ID_KEY, String(sessionIdHint));
    }
    setIngestSessionIndicator(sessionIdHint);
  } else {
    clearStoredSessionContext();
    clearIngestSessionIndicator();
    mergeLog('Session context reset: no prior session_id found', 'info');
  }

  for (const slot of enabledSlots) {
    await sendMessage(slot, text);
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  messageInput.value = '';
  messageInput.focus();

  ingestAfterSlotsPolling(text, enabledSlots.length, {
    sessionFingerprint,
    sessionIdHint
  }).catch((error) => {
    mergeLog(`Ingest polling failed: ${error?.message || error}`, 'error');
  });
}

sendBtn.addEventListener('click', sendToAll);

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendToAll();
  }
});

// Log webview loading
SLOTS.forEach(slot => {
  const webview = webviews[slot];
  if (!webview) return;

  webview.addEventListener('dom-ready', () => {
    console.log(`[${slot}] WebView loaded`);
  });

  webview.addEventListener('did-fail-load', (e) => {
    console.error(`[${slot}] Failed to load:`, e);
  });
});

// ========== MERGE CONFIG ==========
// Delegates to MergeApiClient which owns the format and localStorage key

function loadMergeConfig() {
  if (!window.mergeApiClient || !mergeProviderSelect) return;

  // Let the client load from localStorage
  window.mergeApiClient.loadConfig();

  renderProviderFieldsFromClient();
  updateProviderUI();
}

function renderProviderFieldsFromClient() {
  if (!window.mergeApiClient || !mergeProviderSelect) return;

  // Populate UI fields from client state
  const client = window.mergeApiClient;
  if (mergeProviderSelect) mergeProviderSelect.value = client.provider?.id || 'chatgpt_api';
  selectedMergeProviderId = mergeProviderSelect?.value || 'chatgpt_api';
  if (mergeApiKeyInput) mergeApiKeyInput.value = client.apiKey || '';
  if (mergeEndpointInput) mergeEndpointInput.value = client.endpoint || '';
  if (mergeModelInput) mergeModelInput.value = client.model || '';
  if (mergeFallbackInput) mergeFallbackInput.value = Array.isArray(client.fallbackModels)
    ? client.fallbackModels.join(', ')
    : (client.fallbackModels || '');
  if (mergeInstructionsInput) mergeInstructionsInput.value = client.mergeInstructions || '';
  const clarificationInstructionsInputEl = document.getElementById('clarification-instructions');
  if (clarificationInstructionsInputEl) {
    clarificationInstructionsInputEl.value = client.clarificationInstructions || '';
  }
}

function saveMergeConfig() {
  if (!window.mergeApiClient || !mergeProviderSelect) return;
  // saveConfig() reads directly from DOM elements
  window.mergeApiClient.saveConfig();
}

function syncMergeApiClient() {
  // No-op: saveMergeConfig/loadMergeConfig go directly through client
}

function updateProviderUI() {
  const provider = mergeProviderSelect?.value || 'chatgpt_api';
  const supportsFallback = ['openrouter_api', 'huggingface_api', 'custom_api', 'chatgpt_api'].includes(provider);

  // Show/hide custom endpoint field
  const endpointField = mergeEndpointInput?.closest('.config-field');
  if (endpointField) {
    endpointField.style.display = provider === 'custom_api' ? '' : 'none';
  }

  // Show/hide fallback models field
  if (fallbackModelsField) {
    fallbackModelsField.style.display = supportsFallback ? '' : 'none';
  }

  // Update default model placeholder based on provider
  if (mergeModelInput) {
    const defaults = {
      chatgpt_api: 'gpt-4o-mini',
      claude_api: 'claude-3-5-sonnet-latest',
      gemini_api: 'gemini-2.0-flash',
      perplexity_api: 'sonar',
      deepseek_api: 'deepseek-chat',
      openrouter_api: 'openai/gpt-4o-mini',
      huggingface_api: 'Qwen/Qwen2.5-72B-Instruct',
      custom_api: ''
    };
    const fallbackTip = supportsFallback
      ? ' (tip: add fallbacks with comma or new line)'
      : '';
    mergeModelInput.placeholder = `${defaults[provider] || ''}${fallbackTip}`;
  }

  if (mergeFallbackInput) {
    mergeFallbackInput.placeholder = supportsFallback
      ? 'Optional: model-a, model-b (or one model per line)'
      : 'Not used by this provider';
  }
}

function maybeShowMergeSetupHint(force = false) {
  if (!window.mergeApiClient || typeof window.mergeApiClient.hasAnyConfiguredApiKey !== 'function') return;
  if (window.mergeApiClient.hasAnyConfiguredApiKey()) return;

  const current = mergeStatusDiv?.textContent?.trim() || '';
  if (force || current === 'Ready to merge') {
    setMergeStatus(MERGE_SETUP_NEEDED_HINT, 'idle');
  }
}

// ========== MERGE PANEL INIT ==========
function initMergePanel() {
  mergeProviderSelect = document.getElementById('merge-provider');
  mergeApiKeyInput = document.getElementById('merge-api-key');
  mergeEndpointInput = document.getElementById('merge-endpoint');
  mergeModelInput = document.getElementById('merge-model');
  mergeFallbackInput = document.getElementById('merge-fallback-models');
  mergeInstructionsInput = document.getElementById('merge-instructions');
  mergeResultDiv = document.getElementById('merge-result');
  mergeStatusDiv = document.getElementById('merge-status');
  clarificationContainer = document.getElementById('clarification-container');
  clarificationInput = document.getElementById('clarification-input');
  clarificationSendBtn = document.getElementById('clarification-send-btn');
  resetInstructionsBtn = document.getElementById('reset-instructions-btn');
  fallbackModelsField = document.getElementById('fallback-models-field');
  runMergeBtn = document.getElementById('run-merge-btn');
  debugLogDiv = document.getElementById('merge-debug-log');
  debugClearBtn = document.getElementById('debug-clear-btn');

  // Only wire up if panel elements exist
  if (!runMergeBtn) return;

  // Hook client log ΓåÆ debug panel
  if (window.mergeApiClient) {
    window.mergeApiClient.onLog = (msg, type, detail) => mergeLog(msg, type, detail);
  }

  loadMergeConfig();
  maybeShowMergeSetupHint(true);

  runMergeBtn.addEventListener('click', () => runMerge(false, '', ''));

  clarificationSendBtn?.addEventListener('click', () => {
    const text = clarificationInput?.value.trim();
    if (!text) return;
    clarificationInput.value = '';
    // Append user question to history BEFORE calling (same as Android)
    if (mergeHistory) {
      mergeHistory += `\n\nUser: ${text}`;
    }
    runMerge(true, text, mergeHistory);
  });

  clarificationInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clarificationSendBtn?.click();
    }
  });

  mergeProviderSelect?.addEventListener('change', () => {
    if (!window.mergeApiClient) return;
    window.mergeApiClient.saveFormForProvider(selectedMergeProviderId);
    window.mergeApiClient.setProviderById(mergeProviderSelect.value);
    renderProviderFieldsFromClient();
    updateProviderUI();
    saveMergeConfig();
  });

  const clarificationInstructionsInput = document.getElementById('clarification-instructions');
  const resetClarificationBtn = document.getElementById('reset-clarification-btn');

  const DEFAULT_CLARIFICATION_INSTRUCTIONS = 'You are a helpful assistant continuing a conversation. Respond naturally and helpfully.';

  [mergeApiKeyInput, mergeEndpointInput, mergeModelInput, mergeFallbackInput, mergeInstructionsInput, clarificationInstructionsInput].forEach(input => {
    input?.addEventListener('change', saveMergeConfig);
    input?.addEventListener('blur', saveMergeConfig);
  });

  resetInstructionsBtn?.addEventListener('click', () => {
    if (mergeInstructionsInput) {
      mergeInstructionsInput.value = DEFAULT_MERGE_INSTRUCTIONS;
      saveMergeConfig();
    }
  });

  resetClarificationBtn?.addEventListener('click', () => {
    if (clarificationInstructionsInput) {
      clarificationInstructionsInput.value = DEFAULT_CLARIFICATION_INSTRUCTIONS;
      saveMergeConfig();
    }
  });

  // ---- Prompt sub-tabs ----
  document.querySelectorAll('.prompt-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.prompt-subtab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.prompt-subtab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById(`prompt-pane-${btn.dataset.subtab}`)?.classList.add('active');
    });
  });

  debugClearBtn?.addEventListener('click', () => {
    if (debugLogDiv) debugLogDiv.innerHTML = '';
  });

  // ---- Config Tabs ----
  const tabsBody = document.getElementById('config-tabs-body');
  const tabsCollapseBtn = document.getElementById('config-tabs-collapse');
  // Always start collapsed ΓÇö user can expand manually during session
  let tabsCollapsed = true;

  function applyTabsCollapsed() {
    if (tabsCollapsed) {
      tabsBody?.classList.add('collapsed');
      if (tabsCollapseBtn) tabsCollapseBtn.textContent = 'v';
    } else {
      tabsBody?.classList.remove('collapsed');
      if (tabsCollapseBtn) tabsCollapseBtn.textContent = '^';
    }
  }
  applyTabsCollapsed();

  tabsCollapseBtn?.addEventListener('click', () => {
    tabsCollapsed = !tabsCollapsed;
    localStorage.setItem('cfg-tabs-collapsed', tabsCollapsed.toString());
    applyTabsCollapsed();
  });

  document.querySelectorAll('.cfg-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      // Activate tab button
      document.querySelectorAll('.cfg-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Show pane
      document.querySelectorAll('.cfg-tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById(`cfg-pane-${tab}`)?.classList.add('active');
      // Auto-expand if collapsed
      if (tabsCollapsed) {
        tabsCollapsed = false;
        localStorage.setItem('cfg-tabs-collapsed', 'false');
        applyTabsCollapsed();
      }
      localStorage.setItem('cfg-tabs-active', tab);
      // Refresh sessions list whenever the sessions tab is opened
      if (tab === 'sessions') {
        updateSessionsUI().catch(err => console.warn('[sessions] refresh failed:', err));
      }
    });
  });

  // Restore active tab
  const savedTab = localStorage.getItem('cfg-tabs-active') || 'provider';
  const savedTabBtn = document.querySelector(`.cfg-tab[data-tab="${savedTab}"]`);
  if (savedTabBtn) {
    document.querySelectorAll('.cfg-tab').forEach(b => b.classList.remove('active'));
    savedTabBtn.classList.add('active');
    document.querySelectorAll('.cfg-tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById(`cfg-pane-${savedTab}`)?.classList.add('active');
  }
}

// Initialize merge panel after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMergePanel);
} else {
  initMergePanel();
}

// ========== GET LATEST ASSISTANT REPLY ==========
async function getLatestAssistantReply(slot) {
  const webview = webviews[slot];
  if (!webview || !webviewReady[slot]) return null;

  let currentUrl = '';
  try {
    currentUrl = webview.getURL();
  } catch (e) { }
  const serviceId = detectServiceByUrl(currentUrl) || '';

  const code = `
(function() {
  try {
    const serviceId = ${JSON.stringify(serviceId)};

    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    }

    function normalizeText(t) {
      return String(t || '')
        .replace(/\\r/g, '')
        .replace(/\\u00a0/g, ' ')
        .replace(/[ \\t]+\\n/g, '\\n')
        .replace(/\\n{3,}/g, '\\n\\n')
        .trim();
    }
    function flatText(t) {
      return normalizeText(t).replace(/\\n+/g, ' ').replace(/\\s+/g, ' ').trim();
    }
    function isComposerElement(el) {
      if (!el) return false;
      return !!el.closest('textarea, [contenteditable="true"], [role="textbox"], [data-testid*="composer"]');
    }
    function isMetadataLikeText(text) {
      const t = (text || '').toLowerCase();
      if (!t) return true;
      return (
        t === 'share' ||
        t === 'edit' ||
        t === 'retry' ||
        t === 'copy' ||
        t === 'regenerate' ||
        t.startsWith('model:') ||
        t.includes('window.__')
      );
    }

    const selectors = [
      '[data-testid*="conversation-turn"]',
      '[data-testid*="message-content"]',
      '[data-message-author-role="assistant"]',
      '[data-testid*="assistant"]',
      '[class*="assistant"]',
      '[class*="response"]',
      '[class*="answer"]',
      '[class*="message"]'
    ];

    // Perplexity: prepend prose selector
    if (serviceId === 'perplexity') { selectors.unshift('div[class*="prose"]'); }
    // Gemini: target model-response custom element (avoids full-page conversation wrapper)
    if (serviceId === 'gemini') { selectors.unshift('model-response', 'response-container'); }
    // Grok: target individual response container by id (avoids mixing user prompt)
    if (serviceId === 'grok') { selectors.unshift('div[id^="response-"]', '[class*="message-bubble"]'); }

    const candidates = [];
    selectors.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!visible(el)) return;
          if (isComposerElement(el)) return;
          const raw = normalizeText(el.innerText || el.textContent);
          const flat = flatText(raw);
          if (flat.length < 20 || isMetadataLikeText(flat)) return;
          const rect = el.getBoundingClientRect();
          candidates.push({ el, raw, flat, bottom: rect.bottom, top: rect.top });
        });
      } catch (_) {}
    });

    // Fallback: any visible article/div with enough text
    if (candidates.length === 0) {
      Array.from(document.querySelectorAll('article, div')).filter(visible).forEach((el) => {
        if (isComposerElement(el)) return;
        const raw = normalizeText(el.innerText || el.textContent);
        const flat = flatText(raw);
        if (flat.length < 20 || isMetadataLikeText(flat)) return;
        const rect = el.getBoundingClientRect();
        candidates.push({ el, raw, flat, bottom: rect.bottom, top: rect.top });
      });
    }

    if (candidates.length === 0) return null;

    // Drop nested short fragments when a parent candidate carries the full reply.
    const pruned = candidates.filter((candidate) => {
      return !candidates.some((other) => {
        if (other === candidate) return false;
        if (!other.el.contains(candidate.el)) return false;
        if (other.flat.length < 120) return false;
        if (candidate.flat.length >= other.flat.length * 0.8) return false;
        return Math.abs(other.bottom - candidate.bottom) <= 180;
      });
    });

    const source = pruned.length > 0 ? pruned : candidates;
    const maxBottom = source.reduce((acc, c) => Math.max(acc, c.bottom), -Infinity);
    const nearBottom = source.filter(c => c.bottom >= maxBottom - 260);
    const pool = nearBottom.length > 0 ? nearBottom : source;

    const isGeminiOrGrok = serviceId === 'gemini' || serviceId === 'grok';
    if (isGeminiOrGrok) {
      // Prefer the newest leaf-like container near bottom, not the longest wrapper.
      const wrapped = pool.map((candidate) => {
        const containsPeer = pool.some((other) => {
          if (other === candidate) return false;
          if (!candidate.el.contains(other.el)) return false;
          if (other.flat.length < 40) return false;
          return Math.abs(other.bottom - candidate.bottom) <= 200;
        });
        return { candidate, containsPeer };
      });

      wrapped.sort((a, b) => {
        if (b.candidate.bottom !== a.candidate.bottom) return b.candidate.bottom - a.candidate.bottom;
        if (b.candidate.top !== a.candidate.top) return b.candidate.top - a.candidate.top;
        if (a.containsPeer !== b.containsPeer) return a.containsPeer ? 1 : -1;
        if (a.candidate.flat.length !== b.candidate.flat.length) return a.candidate.flat.length - b.candidate.flat.length;
        return 0;
      });

      return wrapped[0].candidate.raw;
    }

    pool.sort((a, b) => {
      if (b.flat.length !== a.flat.length) return b.flat.length - a.flat.length;
      return b.bottom - a.bottom;
    });
    return pool[0].raw;

  } catch (e) { return null; }
})();
`;

  try {
    return await webview.executeJavaScript(code);
  } catch (e) {
    console.error(`[${slot}] Failed to scrape reply:`, e);
    return null;
  }
}

// ========== COLLECT REPLIES FROM ALL SLOTS ==========
async function collectLatestRepliesFromEnabledSlots() {
  const enabledSlots = SLOTS.filter(slot => toggles[slot]?.checked);
  mergeLog(`Scraping ${enabledSlots.length} slot(s): ${enabledSlots.join(', ')}`, 'scrape');
  const responsesByModel = {};
  const aggregatedResponses = [];
  const scrapeMeta = [];
  const sourcePrompt = (window.mergeApiClient?.lastSourcePrompt || '').trim();

  const reserveModelName = (baseName) => {
    if (!responsesByModel[baseName]) return baseName;
    let idx = 2;
    while (responsesByModel[`${baseName} (${idx})`]) idx += 1;
    return `${baseName} (${idx})`;
  };

  for (const slot of enabledSlots) {
    // Use service name from preset, not toggle label
    let currentUrl = '';
    try { currentUrl = webviews[slot]?.getURL() || ''; } catch (e) { }
    const serviceId = detectServiceByUrl(currentUrl) || slotConfig[slot] || slot;
    const serviceName = SERVICE_PRESETS[serviceId]?.name || labels[slot]?.textContent || slot;

    const preferDomFirst = serviceId === 'gemini' || serviceId === 'grok';
    let copied = null;
    let reply = '';
    let extractionMethod = 'dom';

    if (preferDomFirst) {
      reply = await getLatestAssistantReply(slot);
      if (!reply || String(reply).trim().length < 20) {
        copied = await tryCopyLatestAssistantReply(slot, serviceId);
        if (copied?.text) {
          reply = copied.text;
          extractionMethod = 'copy-fallback';
        }
      }
    } else {
      copied = await tryCopyLatestAssistantReply(slot, serviceId);
      reply = copied?.text || await getLatestAssistantReply(slot);
      extractionMethod = copied?.text ? 'copy' : 'dom';
    }
    const cleanedReply = sanitizeScrapedReply(serviceId, reply || '', sourcePrompt);
    if (cleanedReply && isQualityReply(cleanedReply, sourcePrompt)) {
      const preview = cleanedReply.length > 120 ? `${cleanedReply.slice(0, 120)}...` : cleanedReply;
      const meta = {
        slot,
        service_id: serviceId || 'unknown',
        service_name: serviceName,
        extraction_method: extractionMethod,
        source_url: currentUrl || SERVICE_PRESETS[serviceId]?.url || '',
        raw_chars: String(reply || '').length,
        clean_chars: cleanedReply.length,
        dropped_chars: Math.max(String(reply || '').length - cleanedReply.length, 0),
        clean_preview: preview,
        copy_diagnostics: copied?.diagnostics || null
      };
      scrapeMeta.push(meta);
      mergeLog(`${serviceName}: scraped ${cleanedReply.length} chars - "${preview}"`, 'scrape', meta);
      const modelName = reserveModelName(serviceName);
      responsesByModel[modelName] = cleanedReply;
      aggregatedResponses.push({
        segment_id: `${slot}:${serviceId || 'unknown'}`,
        provider: serviceId || 'unknown',
        source_url: currentUrl || SERVICE_PRESETS[serviceId]?.url || '',
        markdown: cleanedReply
      });
    } else {
      mergeLog(`${serviceName}: no reply found (slot=${slot}, url=${currentUrl.slice(0, 60)})`, 'warn');
      const diagnostics = await getScrapeDiagnostics(slot, serviceId);
      mergeLog(`${serviceName} scrape diagnostics`, 'warn', diagnostics);
    }
  }

  return { responsesByModel, aggregatedResponses, scrapeMeta };
}

async function getScrapeDiagnostics(slot, serviceIdHint = '') {
  const webview = webviews[slot];
  if (!webview || !webviewReady[slot]) return null;

  let currentUrl = '';
  try { currentUrl = webview.getURL() || ''; } catch (_) { }
  const serviceId = serviceIdHint || detectServiceByUrl(currentUrl) || '';

  const code = `
(function() {
  try {
    const serviceId = ${JSON.stringify(serviceId)};
    function visible(el) {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    }
    function cleanText(t) { return (t || '').replace(/\\s+/g, ' ').trim(); }
    const selectors = serviceId === 'grok'
      ? ['[data-testid*="assistant"]', '[data-testid*="response"]', '[class*="assistant"]', '[class*="message"]', 'article']
      : ['[data-testid*="assistant"]', '[data-message-author-role="assistant"]', '[class*="assistant"]', '[class*="message"]', 'article'];

    const counts = selectors.map((sel) => {
      let count = 0;
      try { count = Array.from(document.querySelectorAll(sel)).filter(visible).length; } catch (_) {}
      return { sel, count };
    });

    const sampleNodes = Array.from(document.querySelectorAll('article, section, div'))
      .filter(visible)
      .map((el) => {
        const txt = cleanText(el.innerText || el.textContent);
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          className: (el.className || '').toString().slice(0, 80),
          len: txt.length,
          bottom: Math.round(rect.bottom),
          text: txt.slice(0, 180)
        };
      })
      .filter((x) => x.len >= 20 && x.len <= 500)
      .sort((a, b) => b.bottom - a.bottom)
      .slice(0, 8);

    return {
      serviceId,
      href: location.href,
      counts,
      samples: sampleNodes
    };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
})();
`;

  try {
    return await webview.executeJavaScript(code);
  } catch (error) {
    return { error: error?.message || String(error), serviceId, href: currentUrl };
  }
}

async function ingestAfterSlotsPolling(sourcePrompt, expectedSlotCount, ingestContext = {}) {
  mergeLog(`Ingest polling started (expected slots: ${expectedSlotCount})`, 'info');

  // Phase 1: Initial delay ΓÇö no LLM responds in under 5 seconds
  mergeLog(`Waiting ${INGEST_INITIAL_DELAY_MS}ms before first scrape attempt`, 'info');
  await sleep(INGEST_INITIAL_DELAY_MS);

  // Phase 2: Wait for all slots to finish generating
  const enabledSlots = SLOTS.filter(slot => toggles[slot]?.checked);
  for (let waitAttempt = 1; waitAttempt <= INGEST_GENERATION_WAIT_ATTEMPTS; waitAttempt += 1) {
    let stillGenerating = 0;
    const generatingSlots = [];
    for (const slot of enabledSlots) {
      const serviceId = detectServiceByUrl(getWebviewCurrentUrl(slot)) || '';
      if (await isSlotStillGenerating(slot, serviceId)) {
        stillGenerating += 1;
        generatingSlots.push(`${slot}:${serviceId || '?'}`);
      }
    }
    if (stillGenerating === 0) {
      mergeLog(`All slots finished generating (after ${waitAttempt} check(s))`, 'info');
      break;
    }
    mergeLog(`Generation wait ${waitAttempt}/${INGEST_GENERATION_WAIT_ATTEMPTS}: ${stillGenerating} still generating [${generatingSlots.join(', ')}]`, 'info');
    if (waitAttempt < INGEST_GENERATION_WAIT_ATTEMPTS) await sleep(INGEST_GENERATION_CHECK_MS);
  }

  // Safety delay: wait a bit more to ensure content is fully rendered
  mergeLog('Waiting 3000ms for content to fully settle before scraping', 'info');
  await sleep(3000);

  // Phase 3: Scrape with quality validation
  let collected = { responsesByModel: {}, aggregatedResponses: [], scrapeMeta: [] };
  for (let attempt = 1; attempt <= INGEST_POLL_ATTEMPTS; attempt += 1) {
    collected = await collectLatestRepliesFromEnabledSlots();
    const count = Object.keys(collected.responsesByModel).length;
    mergeLog(`Ingest polling attempt ${attempt}/${INGEST_POLL_ATTEMPTS}: ${count}/${expectedSlotCount} replies`, 'info');

    if (count >= expectedSlotCount) break;
    if (attempt < INGEST_POLL_ATTEMPTS) await sleep(INGEST_POLL_INTERVAL_MS);
  }

  if (collected.aggregatedResponses.length === 0) {
    mergeLog('Ingest skipped: no replies collected after polling', 'warn');
    return;
  }

  const payloadBuild = buildAggregatedPayload({
    sourcePrompt: sourcePrompt || '',
    responses: collected.aggregatedResponses,
    sessionId: ingestContext.sessionIdHint
  });

  mergeLog('Ingest aggregated request prepared', 'send', {
    payload: payloadBuild.payload,
    scrape_meta: collected.scrapeMeta || []
  });

  const ingestResult = await sendAggregated(
    payloadBuild.sessionId,
    payloadBuild.payload.title,
    payloadBuild.payload.responses,
    collected.scrapeMeta || []
  );

  const sessionId = extractSessionId(ingestResult);
  if (ingestResult?.ok && sessionId) {
    activeSessionId = sessionId; // update in-memory immediately
    const fingerprint = String(ingestContext.sessionFingerprint || activeSessionFingerprint || '').trim();
    if (fingerprint) {
      persistSessionContext(sessionId, fingerprint);
    } else {
      localStorage.setItem(AGGREGATED_SESSION_ID_KEY, String(sessionId));
    }
    setIngestSessionIndicator(sessionId);
    // Auto-save session snapshot to DB after successful ingest
    // so the session appears in the list without manual "Save" click.
    // Fire-and-forget — don't block the ingest flow.
    const autoSaveName = String(sourcePrompt || '').trim().slice(0, 60) ||
      `Session ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    saveSessionSnapshot(autoSaveName, sessionId).catch(e =>
      mergeLog(`Auto-save after ingest failed: ${e?.message || e}`, 'warn')
    );
  }

  mergeLog(
    ingestResult?.ok ? 'Ingest RPC success' : 'Ingest RPC failed',
    ingestResult?.ok ? 'recv' : 'warn',
    ingestResult
  );
}

// ========== MERGE FUNCTIONALITY ==========
function setMergeStatus(text, type = 'idle') {
  if (!mergeStatusDiv) return;
  mergeStatusDiv.textContent = text;
  mergeStatusDiv.className = `merge-status ${type}`;
}

// ========== DEBUG LOG ==========
function mergeLog(message, type = 'info', detail = null) {
  if (!debugLogDiv) return;
  const ts = new Date().toLocaleTimeString('ru', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = `debug-entry ${type}`;
  const safePrefix = { info: '*', send: '>', recv: '<', error: 'x', warn: '!', scrape: 'o' }[type] || '*';

  if (detail) {
    const header = document.createElement('div');
    const expandBtn = document.createElement('span');
    expandBtn.className = 'debug-expand';
    expandBtn.textContent = ' [expand]';
    const body = document.createElement('pre');
    body.className = 'debug-body';
    const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
    body.textContent = detailStr;
    expandBtn.addEventListener('click', () => {
      body.classList.toggle('visible');
      expandBtn.textContent = body.classList.contains('visible') ? ' [collapse]' : ' [expand]';
    });
    header.innerHTML = `<span class="debug-ts">${ts}</span><span>${safePrefix} ${message}</span>`;
    header.appendChild(expandBtn);
    entry.appendChild(header);
    entry.appendChild(body);
  } else {
    entry.innerHTML = `<span class="debug-ts">${ts}</span>${safePrefix} ${message}`;
  }

  debugLogDiv.appendChild(entry);
  debugLogDiv.scrollTop = debugLogDiv.scrollHeight;
  console.log(`[MergeDebug][${type}] ${message}`);
}

function updateMergeResult(markdownText) {
  if (!mergeResultDiv) return;

  clearMergeHighlights();
  searchSession = { query: '', scope: searchSession.scope };

  if (typeof marked !== 'undefined') {
    mergeResultDiv.innerHTML = marked.parse(markdownText);
  } else {
    mergeResultDiv.textContent = markdownText;
  }
}

async function runMerge(isClarification = false, clarificationText = '', previousSummary = '') {
  if (mergeInProgress) return;
  if (!window.mergeApiClient) {
    setMergeStatus('Merge API client not loaded', 'error');
    return;
  }

  // Sync UI ΓåÆ client before checking config state and calling API.
  saveMergeConfig();

  if (!isClarification && !window.mergeApiClient.hasAnyConfiguredApiKey()) {
    setMergeStatus(MERGE_SETUP_NEEDED_HINT, 'idle');
    return;
  }

  if (!window.mergeApiClient.apiKey) {
    setMergeStatus('API key required', 'error');
    return;
  }

  const client = window.mergeApiClient;
  const providerInfo = `${client.provider?.id || '?'} / ${client.model || client.provider?.defaultModel || '?'}`;
  mergeLog(isClarification ? `Follow-up: "${clarificationText}"` : `Starting merge`, 'info');
  mergeLog(`Provider: ${providerInfo}`, 'info');

  mergeInProgress = true;
  setMergeStatus(isClarification ? 'Processing follow-up...' : 'Collecting responses...', 'running');
  if (runMergeBtn) runMergeBtn.disabled = true;
  if (isClarification && clarificationSendBtn) clarificationSendBtn.disabled = true;

  let responses;
  let aggregatedResponses;

  if (isClarification) {
    // Reuse saved responses from first merge for context
    responses = lastScrapedResponses;
    aggregatedResponses = lastAggregatedResponses;
  } else {
    const collected = await collectLatestRepliesFromEnabledSlots();
    responses = collected.responsesByModel;
    aggregatedResponses = collected.aggregatedResponses;
    lastScrapeMeta = collected.scrapeMeta || [];

    if (Object.keys(responses).length === 0) {
      mergeLog('No responses collected ΓÇö nothing to merge', 'error');
      mergeInProgress = false;
      if (runMergeBtn) runMergeBtn.disabled = false;
      if (clarificationSendBtn) clarificationSendBtn.disabled = false;
      setMergeStatus('No responses to merge. Send messages first.', 'error');
      return;
    }
    lastScrapedResponses = responses; // save for clarification context
    lastAggregatedResponses = aggregatedResponses;
    mergeHistory = ''; // reset conversation on new merge
    mergeLog(`Collected from: ${Object.keys(responses).join(', ')}`, 'info');

  }

  setMergeStatus(isClarification ? 'Processing follow-up...' : 'Running merge...', 'running');

  let latestPartialText = '';
  let partialFlushTimer = null;
  let partialStarted = false;
  const flushPartial = () => {
    partialFlushTimer = null;
    if (!latestPartialText) return;
    updateMergeResult(latestPartialText);
  };
  const onPartial = (partialText) => {
    if (typeof partialText !== 'string') return;
    if (!partialText) {
      latestPartialText = '';
      return;
    }
    latestPartialText = partialText;
    if (!partialStarted) {
      partialStarted = true;
      setMergeStatus(isClarification ? 'Streaming follow-up...' : 'Streaming merge...', 'running');
    }
    if (!partialFlushTimer) {
      partialFlushTimer = setTimeout(flushPartial, 120);
    }
  };

  const result = await window.mergeApiClient.merge(
    responses,
    isClarification,
    clarificationText,
    previousSummary,
    onPartial
  );

  if (partialFlushTimer) {
    clearTimeout(partialFlushTimer);
    partialFlushTimer = null;
  }
  if (latestPartialText) {
    updateMergeResult(latestPartialText);
  }

  mergeInProgress = false;
  if (runMergeBtn) runMergeBtn.disabled = false;
  if (clarificationSendBtn) clarificationSendBtn.disabled = false;

  if (result.success) {
    const cleanResponse = stripMergeMetadataFooter(result.text);
    if (mergeHistory === '') {
      mergeHistory = `Assistant: ${cleanResponse}`;
    } else {
      mergeHistory += `\n\nAssistant: ${cleanResponse}`;
    }

    updateMergeResult(result.text);
    setMergeStatus(isClarification ? 'Follow-up complete' : 'Merge complete', 'idle');

    const sessionId = getStoredAggregatedSessionId();
    if (Number.isInteger(sessionId) && sessionId > 0) {
      const clarificationTitle = toNoteTitle(clarificationText, `Clarification ${new Date().toISOString()}`);
      const mergeTitle = toNoteTitle(client.lastSourcePrompt, `Merge ${new Date().toISOString()}`);
      const rpcTitle = isClarification
        ? clarificationTitle
        : mergeTitle;
      const rpcResult = isClarification
        ? await sendClarification(sessionId, rpcTitle, cleanResponse, lastScrapeMeta)
        : await sendMerge(sessionId, rpcTitle, cleanResponse, lastScrapeMeta);

      mergeLog(
        rpcResult?.ok
          ? (isClarification ? 'Clarification RPC success' : 'Merge RPC success')
          : (isClarification ? 'Clarification RPC failed' : 'Merge RPC failed'),
        rpcResult?.ok ? 'recv' : 'warn',
        rpcResult
      );
    } else {
      mergeLog(
        isClarification
          ? 'Clarification RPC skipped: session_id is missing (send aggregated first)'
          : 'Merge RPC skipped: session_id is missing (send aggregated first)',
        'warn'
      );
    }

    if (clarificationContainer) {
      clarificationContainer.classList.add('visible');
      clarificationInput?.focus();
    }
  } else {
    setMergeStatus(`Failed: ${result.error}`, 'error');
  }
}

// ========== SESSION MANAGEMENT ==========
const SESSIONS_KEY = 'chat-aggregator-sessions';
const MAX_SESSIONS = 20;
let sessionsNotice = { text: '', kind: 'info' };

function setSessionsNotice(text, kind = 'info') {
  sessionsNotice = { text: String(text || '').trim(), kind };
}

function errorToText(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return String(error.message || error);
}

async function saveSessionSnapshot(customName, ingestSessionId) {
  const sessionData = {
    sessionId: ingestSessionId ?? getCurrentSessionId() ?? activeSessionId,
    name: customName ||
      `Session ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`,
    slotConfig: { ...slotConfig },
    slotUrls: {},
    slotEnabled: { ...getCurrentSlotEnabledState() }
  };

  SLOTS.forEach(slot => {
    const webview = webviews[slot];
    if (webview && webview.src) {
      sessionData.slotUrls[slot] = webview.src;
    }
  });

  // Save to database via IPC
  if (window.electronAPI?.saveSession) {
    try {
      const result = await window.electronAPI.saveSession(sessionData);
      if (!result || typeof result !== 'object' || !result.id) {
        throw new Error('DB save returned empty result');
      }
      console.log('[saveSessionSnapshot] Saved to DB:', result);
      setSessionsNotice('Saved to database.', 'ok');
      // Also update local cache
      let sessions = await loadSessionsList();
      sessions.unshift(result);
      if (sessions.length > MAX_SESSIONS) {
        sessions = sessions.slice(0, MAX_SESSIONS);
      }
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
      await updateSessionsUI();
      return result;
    } catch (error) {
      console.error('[saveSessionSnapshot] DB save failed:', error);
      setSessionsNotice(`DB save failed, using local cache: ${errorToText(error)}`, 'warn');
      // Fallback to localStorage only
    }
  }

  // Fallback: save to localStorage only
  const snapshot = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    timestamp: Date.now(),
    ...sessionData
  };

  let sessions = await loadSessionsList();
  sessions.unshift(snapshot);
  if (sessions.length > MAX_SESSIONS) {
    sessions = sessions.slice(0, MAX_SESSIONS);
  }

  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  setSessionsNotice('Saved to local cache only.', 'warn');
  await updateSessionsUI();
  return snapshot;
}

async function loadSessionsList() {
  // Try to load from database first
  if (window.electronAPI?.loadSessions) {
    try {
      // Sessions tab should show global history, not only current ingest session.
      const dbSessions = await window.electronAPI.loadSessions(null);
      if (Array.isArray(dbSessions) && dbSessions.length > 0) {
        // Cache in localStorage
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(dbSessions));
        setSessionsNotice('Loaded from database.', 'ok');
        return dbSessions;
      }
      if (Array.isArray(dbSessions) && dbSessions.length === 0) {
        setSessionsNotice('Database returned 0 sessions.', 'info');
      }
    } catch (error) {
      console.error('[loadSessionsList] DB load failed:', error);
      setSessionsNotice(`DB load failed, using local cache: ${errorToText(error)}`, 'warn');
      // Fall through to localStorage
    }
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function getCurrentSessionId() {
  try {
    const raw = localStorage.getItem(AGGREGATED_SESSION_ID_KEY);
    return raw ? Number(raw) : null;
  } catch (_) {
    return null;
  }
}

async function loadSession(sessionId) {
  const sessions = await loadSessionsList();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) {
    console.warn('Session not found:', sessionId);
    setSessionsNotice(`Session not found: ${sessionId}`, 'warn');
    return;
  }

  const sessionSlotConfig = session.slotConfig || session.slot_config || {};
  const sessionSlotUrls = session.slotUrls || session.slot_urls || {};
  const sessionSlotEnabled = session.slotEnabled || session.slot_enabled || {};

  // Restore slot configuration
  Object.assign(slotConfig, sessionSlotConfig);
  saveSlotConfig(slotConfig);

  // Restore enabled state
  const slotEnabled = {};
  SLOTS.forEach(slot => {
    const hasExplicitFlag = Object.prototype.hasOwnProperty.call(sessionSlotEnabled, slot);
    const hasSlotData = Boolean(sessionSlotConfig?.[slot] || sessionSlotUrls?.[slot]);
    slotEnabled[slot] = hasExplicitFlag ? sessionSlotEnabled[slot] !== false : hasSlotData;
    if (toggles[slot]) {
      toggles[slot].checked = slotEnabled[slot];
    }
  });
  saveSlotEnabledState(slotEnabled);

  // Restore service selectors and navigate webviews for active slots.
  SLOTS.forEach(slot => {
    const serviceId = sessionSlotConfig?.[slot];
    if (serviceId) {
      slotConfig[slot] = serviceId;
      const select = document.querySelector(`.service-select[data-slot="${slot}"]`);
      if (select && select.value !== serviceId) {
        select.value = serviceId;
      }
    }

    if (!slotEnabled[slot]) {
      updateSlotLabel(slot, serviceId || slotConfig[slot]);
      return;
    }

    const webview = webviews[slot];
    const url = sessionSlotUrls?.[slot] || SERVICE_PRESETS[serviceId]?.url || '';
    if (url && webview) {
      try {
        const currentUrl = webview.getURL?.() || webview.getAttribute?.('src') || '';
        if (!currentUrl || currentUrl !== url) {
          webview.loadURL(url);
        }
      } catch (_) {
        webview.src = url;
      }
      const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
      if (urlInput) urlInput.value = url;
    }
    updateSlotLabel(slot, serviceId || slotConfig[slot]);
  });
  saveSlotConfig(slotConfig);

  // Restore session context so subsequent messages continue in THIS session
  const numericId = Number(session.sessionId ?? session.session_id ?? sessionId);
  if (Number.isInteger(numericId) && numericId > 0) {
    activeSessionId = numericId;
    const enabledSlots = SLOTS.filter(slot => slotEnabled[slot]);
    const fingerprint = buildSessionFingerprint(enabledSlots);
    activeSessionFingerprint = fingerprint;
    persistSessionContext(numericId, fingerprint);
    setIngestSessionIndicator(numericId);
  } else {
    clearStoredSessionContext();
    clearIngestSessionIndicator();
  }

  console.log('Session loaded:', sessionId, '→ activeSessionId =', activeSessionId);
  setSessionsNotice(`Session loaded: ${session.name || sessionId}`, 'ok');
  await updateSessionsUI();
}

async function deleteSession(sessionId) {
  // Delete from database first
  if (window.electronAPI?.deleteSession) {
    try {
      await window.electronAPI.deleteSession(sessionId);
      console.log('[deleteSession] Deleted from DB:', sessionId);
      setSessionsNotice(`Deleted from database: ${sessionId}`, 'ok');
    } catch (error) {
      console.error('[deleteSession] DB delete failed:', error);
      setSessionsNotice(`DB delete failed, cleaning local cache only: ${errorToText(error)}`, 'warn');
    }
  }

  // Update local cache
  const sessions = await loadSessionsList();
  const filtered = sessions.filter(s => s.id !== sessionId);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
  await updateSessionsUI();
}

async function openSessionInNewWindow(sessionId) {
  const sessions = await loadSessionsList();
  const session = sessions.find(s => s.id === sessionId);
  if (!session) {
    setSessionsNotice(`Session not found: ${sessionId}`, 'warn');
    return;
  }
  if (!window.electronAPI?.openSessionWindow) {
    // Fallback: loadSession in current window
    await loadSession(sessionId);
    return;
  }
  try {
    await window.electronAPI.openSessionWindow(session);
  } catch (err) {
    console.error('[openSessionInNewWindow] failed:', err);
    setSessionsNotice(`Failed to open new window: ${err?.message || err}`, 'warn');
  }
}

async function updateSessionsUI() {
  const container = document.getElementById('sessions-list');
  if (!container) return;

  const sessions = await loadSessionsList();
  container.innerHTML = '';

  if (sessionsNotice.text) {
    const color = sessionsNotice.kind === 'warn' ? '#ffb366' : sessionsNotice.kind === 'ok' ? '#9ad89a' : '#9aa0aa';
    container.innerHTML += `<div style="padding:6px 8px;color:${color};font-size:10px;line-height:1.3;border:1px solid #333;border-radius:4px;margin-bottom:6px;">${sessionsNotice.text}</div>`;
  }

  if (sessions.length === 0) {
    container.innerHTML += '<div style="padding:8px;color:#666;font-size:11px;text-align:center;">No sessions saved yet</div>';
    return;
  }

  sessions.forEach(session => {
    const item = document.createElement('div');
    item.className = 'session-item';

    const slotConfigMap = session.slotConfig || session.slot_config || {};
    const slotEnabledMap = session.slotEnabled || session.slot_enabled || {};
    const displaySessionId = session.sessionId ?? session.session_id ?? session.id;

    const timeStr = new Date(session.updatedAt || session.updated_at || session.timestamp || Date.now()).toLocaleString('ru-RU', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const activeSlots = SLOTS.filter(s => slotEnabledMap[s] !== false).map(s => {
      const service = slotConfigMap[s] || 'unknown';
      return service.replace(/_api$/, '').toUpperCase();
    }).join(', ');

    item.innerHTML = `
      <div style="font-weight:600;color:#fff;">
        <span style="color:#9ad89a;font-size:10px;font-weight:400;margin-right:4px;">#${displaySessionId}</span>
        ${session.name || activeSlots || '(no slots)'}
      </div>
      <div class="session-item-time">${timeStr}</div>
      <div class="session-item-actions">
        <button class="session-item-action" onclick="loadSession('${session.id}')">Load</button>
        <button class="session-item-action" onclick="openSessionInNewWindow('${session.id}')">New Window</button>
        <button class="session-item-action" onclick="deleteSession('${session.id}')">Delete</button>
      </div>
    `;

    container.appendChild(item);
  });
}

// Initialize sessions UI and save button
async function initSessionsTab() {
  await updateSessionsUI();

  const saveSessionBtn = document.getElementById('save-session-btn');
  if (saveSessionBtn) {
    saveSessionBtn.addEventListener('click', async () => {
      await saveSessionSnapshot();
      saveSessionBtn.textContent = '✓ Saved!';
      setTimeout(() => { saveSessionBtn.textContent = '💾 Save Current'; }, 2000);
    });
  }

  // Auto-restore session passed via window query string (opened from another window)
  try {
    const params = new URLSearchParams(window.location.search);
    const sessionRaw = params.get('session');
    if (sessionRaw) {
      const session = JSON.parse(decodeURIComponent(sessionRaw));
      if (session && session.id) {
        // Small delay to let webviews init
        setTimeout(() => loadSession(session.id), 1500);
      }
    }
  } catch (e) {
    console.warn('[initSessionsTab] Failed to parse session from query:', e);
  }
}

// Call initialization after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSessionsTab);
} else {
  initSessionsTab();
}

console.log('Renderer initialized');

