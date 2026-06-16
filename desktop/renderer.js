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
        'button[class*="send"]',
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
        'button[aria-label*="Ask"]',
        'button[aria-label*="Submit"]',
        'button[aria-label*="Send"]',
        'button[aria-label*="query"]',
        'button[data-testid*="submit"]',
        'button[data-testid*="send"]',
        'button[type="submit"]',
        'button.bg-super',
        'button.bg-sideBar'
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

function serviceIconMarkup(serviceId, faviconUrl) {
  const sid = String(serviceId || '').trim().toLowerCase();

  if (faviconUrl) {
    return `<img src="${faviconUrl}" alt="${sid}" style="width:100%;height:100%;object-fit:contain;border-radius:3px;" draggable="false">`;
  }

  const meta = {
    chatgpt: { bg: '#10a37f', fg: '#ffffff', glyph: 'C' },
    claude: { bg: '#d97706', fg: '#ffffff', glyph: 'A' },
    gemini: { bg: '#2563eb', fg: '#ffffff', glyph: 'G' },
    grok: { bg: '#7c3aed', fg: '#ffffff', glyph: 'X' },
    deepseek: { bg: '#0f766e', fg: '#ffffff', glyph: 'D' },
    perplexity: { bg: '#0f172a', fg: '#ffffff', glyph: 'P' }
  }[sid] || { bg: '#756858', fg: '#f4efe4', glyph: '?' };

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" fill="${meta.bg}"/>
      <circle cx="12" cy="12" r="8.4" fill="rgba(255,255,255,0.12)"/>
      <text x="12" y="16" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="11" font-weight="800" fill="${meta.fg}">${meta.glyph}</text>
    </svg>
  `;
}

function updateSlotToggleIcon(slot, serviceId = slotConfig[slot]) {
  const toggle = toggles[slot];
  const icon = toggle?.closest('.toggle')?.querySelector('.toggle-icon');
  if (!toggle || !icon) return;

  const sid = String(serviceId || '').trim().toLowerCase();
  const faviconUrl = slotFavicons[slot] || null;
  const markup = serviceIconMarkup(sid, faviconUrl);
  if (icon.dataset.serviceId === sid && icon.dataset.faviconUrl === (faviconUrl || '') && icon.dataset.iconMarkup === markup) return;

  icon.dataset.serviceId = sid;
  icon.dataset.faviconUrl = faviconUrl || '';
  icon.dataset.iconMarkup = markup;
  icon.innerHTML = markup;
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
const incognitoEnsureTimers = {};
const incognitoEnsureState = {};
const slotFavicons = {};
let expandedSlot = null;
let leftSplitSlot = null;
let rightSplitSlot = null;
let appBackgrounded = false;

function applyAppBackgroundMode(backgrounded) {
  appBackgrounded = !!backgrounded;
  document.documentElement.classList.toggle('app-backgrounded', appBackgrounded);
  document.body?.classList.toggle('app-backgrounded', appBackgrounded);

  SLOTS.forEach(slot => {
    const webview = webviews[slot];
    if (!webview) return;
    try {
      webview.setAudioMuted?.(appBackgrounded);
    } catch (_) {
      // Some Electron versions expose muting only on the backing WebContents.
    }
  });
}

SLOTS.forEach(slot => {
  webviews[slot] = document.getElementById(`webview-${slot}`);
  toggles[slot] = document.getElementById(`toggle-${slot}`);
  statuses[slot] = document.getElementById(`status-${slot}`);
  labels[slot] = document.getElementById(`label-${slot}`);
  zoomLevels[slot] = DEFAULT_ZOOM_FACTOR;
  webviewReady[slot] = false;
  pendingNavigation[slot] = null;
  incognitoEnsureTimers[slot] = null;
  incognitoEnsureState[slot] = {
    inFlight: false,
    inFlightKey: '',
    lastSuccessKey: '',
    lastSuccessAt: 0
  };
});

const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const importCookiesBtn = document.getElementById('import-cookies-btn');
const incognitoModeBtn = document.getElementById('incognito-mode-btn');
const toggleAddressBarBtn = document.getElementById('toggle-address-bar-btn');
const collapseBtn = document.getElementById('collapse-toolbar');
const togglesContainer = document.getElementById('toggles');
const projectSelectorBtn = document.getElementById('project-selector-btn');
const projectToolbarBtn = document.getElementById('project-toolbar-btn');
const activeProjectNameEl = document.getElementById('active-project-name');
const projectPanelEl = document.getElementById('project-panel');
const projectPanelScrimEl = document.getElementById('project-panel-scrim');
const projectPanelCloseBtn = document.getElementById('project-panel-close');
const projectTreeEl = document.getElementById('project-tree');
const projectPanelFooterEl = document.getElementById('project-panel-footer');
const refreshProjectsBtn = document.getElementById('refresh-projects-btn');
const aboutModalEl = document.getElementById('about-modal');
const aboutCloseBtn = document.getElementById('about-close-btn');
const aboutAppNameEl = document.getElementById('about-app-name');
const aboutVersionEl = document.getElementById('about-version');
const aboutBaseVersionEl = document.getElementById('about-base-version');
const aboutGitMetaEl = document.getElementById('about-git-meta');
const aboutChangelogListEl = document.getElementById('about-changelog-list');
const aboutChangelogEmptyEl = document.getElementById('about-changelog-empty');
const webviewGridEl = document.getElementById('webview-grid');

window.electronAPI?.onAppBackgroundModeChanged?.(applyAppBackgroundMode);

// Merge panel elements (populated after DOM ready)
let mergeProviderSelect, mergeApiKeyInput, mergeEndpointInput, mergeModelInput;
let mergeFallbackInput, mergeInstructionsInput, mergeResultDiv, mergeStatusDiv;
let clarificationContainer, clarificationInput, clarificationSendBtn, resetInstructionsBtn;
let fallbackModelsField, runMergeBtn;
let aggregationSummaryDiv, pauseAggregationBtn, collectNowBtn, refreshAggregationBtn;
let debugLogDiv, debugClearBtn, debugModeToggle;

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
let activeProjectPathKey = null;
let activeProjectSlotUrls = {};
let projectTreeNodes = [];
let isProjectPanelVisible = false;
let isProjectTreeLoaded = false;
const expandedProjectNodeIds = new Set();
let projectSlotUrlLoadGeneration = 0;
const REMOTE_LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROJECT_TREE_CACHE_KEY = 'chat-aggregator-project-tree-v2';
const PROJECT_TREE_CACHE_META_KEY = 'chat-aggregator-project-tree-meta';
const REFRESH_COOLDOWN_MS = 3000;
let projectRefreshInFlight = false;
let projectRefreshLockedUntil = 0;
let sessionsRefreshInFlight = false;
let sessionsRefreshLockedUntil = 0;
let desktopAboutInfoCache = null;
const AGGREGATED_SESSION_ID_KEY = 'aggregated-ingest-session-id';
const AGGREGATED_SESSION_CONTEXT_KEY = 'aggregated-ingest-session-context';
const SLOT_ENABLED_STATE_KEY = 'slot-enabled-state';
const DEBUG_MODE_STATE_KEY = 'debug-mode-enabled';
const SLOT_VISUAL_ORDER_KEY = 'slot-visual-order';
const INGEST_POLL_ATTEMPTS = 30;
const INGEST_POLL_INTERVAL_MS = 2000;
const INGEST_INITIAL_DELAY_MS = 5000;
const INGEST_GENERATION_WAIT_ATTEMPTS = 15;
const INGEST_GENERATION_CHECK_MS = 2000;
const INGEST_MIN_REPLY_CHARS = 20;
let activeIngestTraceId = '';
let ingestSequenceCounter = 0;
let ingestSequenceBySourceMessageId = new Map();
const lastDomScrapeDebugBySlot = new Map();
let activeSendCount = 0;
let lastReportedBackgroundWorkActive = null;
let activeSessionFingerprint = '';
let activeSessionId = null; // in-memory session_id � set immediately when RPC returns
let activeAggregatedNoteId = null; // current question root note for manual Collect now overwrite
let activeSessionPrompt = '';
const aggregationControl = window.AggregationControl
  ? new window.AggregationControl.AggregationControlState()
  : {
    paused: false,
    pendingMerge: null,
    pendingAggregation: null,
    beginPendingMerge(payload) { this.pendingMerge = payload; },
    clearPendingMerge() { this.pendingMerge = null; if (!this.pendingAggregation) this.paused = false; },
    hasPendingMerge() { return !!this.pendingMerge; },
    beginPendingAggregation(payload) { this.pendingAggregation = payload; this.paused = false; },
    clearPendingAggregation() { this.pendingAggregation = null; if (!this.pendingMerge) this.paused = false; },
    hasPendingAggregation() { return !!this.pendingAggregation; },
    pause() { this.paused = true; },
    resume() { this.paused = false; }
  };
const slotAggregationStatuses = {};
const AGGREGATION_WAIT_MAX_CHECKS = 12;
const AGGREGATION_WAIT_INTERVAL_MS = 2500;
const AGGREGATION_SETTLE_DELAY_MS = 1500;

function hasActiveWebviewWork() {
  const waitingStatus = window.AggregationControl?.SLOT_STATUS?.WAITING || 'waiting';
  const scrapingStatus = window.AggregationControl?.SLOT_STATUS?.SCRAPING || 'scraping';
  const sendingStatus = window.AggregationControl?.SLOT_STATUS?.SENDING || 'pending';
  const pendingAggregationIsWaiting = !!aggregationControl.pendingAggregation?.waiting && !aggregationControl.paused;
  const anySlotBusy = Object.values(slotAggregationStatuses).some((status) =>
    status === waitingStatus || status === scrapingStatus || status === sendingStatus
  );
  return activeSendCount > 0
    || mergeInProgress
    || aggregationControl.hasPendingMerge()
    || pendingAggregationIsWaiting
    || anySlotBusy;
}

function reportBackgroundWorkState() {
  const busy = hasActiveWebviewWork();
  if (busy === lastReportedBackgroundWorkActive) return;
  lastReportedBackgroundWorkActive = busy;
  window.electronAPI?.setAppBackgroundWorkActive?.(busy);
}

function resizeMessageInput() {
  if (!messageInput) return;
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 160)}px`;
}

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

function summarizeDomDiagnostics(diagnostics) {
  if (!diagnostics || typeof diagnostics !== 'object') return null;
  const selected = diagnostics.selected && typeof diagnostics.selected === 'object'
    ? {
        flat_length: diagnostics.selected.flat_length,
        html_length: diagnostics.selected.html_length,
        line_count: diagnostics.selected.metrics?.lineCount ?? diagnostics.selected.line_count ?? null,
        heading_count: diagnostics.selected.metrics?.headingCount ?? diagnostics.selected.heading_count ?? null,
        unordered_count: diagnostics.selected.metrics?.unorderedCount ?? diagnostics.selected.unordered_count ?? null,
        ordered_count: diagnostics.selected.metrics?.orderedCount ?? diagnostics.selected.ordered_count ?? null,
        table_line_count: diagnostics.selected.metrics?.tableLineCount ?? diagnostics.selected.table_line_count ?? null,
        fragment_only: diagnostics.selected.fragment_only ?? false,
        tag: diagnostics.selected.tag || '',
        selector_hint: diagnostics.selected.selector_hint || '',
        preview: diagnostics.selected.preview || ''
      }
    : null;
  const promptCandidate = diagnostics.prompt_candidate && typeof diagnostics.prompt_candidate === 'object'
    ? {
        text: String(diagnostics.prompt_candidate.text || '').trim(),
        top: diagnostics.prompt_candidate.top ?? null,
        bottom: diagnostics.prompt_candidate.bottom ?? null,
        html_length: diagnostics.prompt_candidate.html_length ?? null
      }
    : null;
  return {
    service_id: diagnostics.service_id || '',
    document_title: diagnostics.document_title || '',
    candidate_count: diagnostics.candidate_count ?? 0,
    pruned_count: diagnostics.pruned_count ?? 0,
    pool_count: diagnostics.pool_count ?? 0,
    prompt_candidate: promptCandidate,
    selected
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAboutDialog(info) {
  if (!aboutAppNameEl || !aboutVersionEl || !aboutBaseVersionEl || !aboutGitMetaEl || !aboutChangelogListEl || !aboutChangelogEmptyEl) {
    return;
  }

  const gitBits = [];
  if (info?.gitCommitCount) gitBits.push(`#${info.gitCommitCount}`);
  if (info?.gitShortSha) gitBits.push(info.gitShortSha);

  aboutAppNameEl.textContent = String(info?.appName || 'Verity');
  aboutVersionEl.textContent = String(info?.version || '-');
  aboutBaseVersionEl.textContent = String(info?.baseVersion || '-');
  aboutGitMetaEl.textContent = gitBits.length > 0 ? gitBits.join(' · ') : 'Not available';

  const entries = Array.isArray(info?.changelogEntries) ? info.changelogEntries : [];
  if (entries.length === 0) {
    aboutChangelogListEl.innerHTML = '';
    aboutChangelogEmptyEl.style.display = '';
    return;
  }

  aboutChangelogEmptyEl.style.display = 'none';
  aboutChangelogListEl.innerHTML = entries.map((entry) => {
    const version = escapeHtml(entry?.version || 'Unversioned');
    const section = escapeHtml(entry?.section || 'Changes');
    const text = escapeHtml(entry?.text || '');
    return `
      <div class="about-changelog-item">
        <div class="about-changelog-meta">
          <span class="about-changelog-version">${version}</span>
          <span class="about-changelog-section">${section}</span>
        </div>
        <div class="about-changelog-text">${text}</div>
      </div>
    `;
  }).join('');
}

function updateAboutButtonLabel(info) {
  desktopAboutInfoCache = info || desktopAboutInfoCache;
}

function showAboutModal() {
  if (!aboutModalEl) return;
  aboutModalEl.classList.add('visible');
  aboutModalEl.setAttribute('aria-hidden', 'false');
}

function hideAboutModal() {
  if (!aboutModalEl) return;
  aboutModalEl.classList.remove('visible');
  aboutModalEl.setAttribute('aria-hidden', 'true');
}

async function openAboutDialog() {
  if (!window.electronAPI?.getAboutInfo) return;
  try {
    if (!desktopAboutInfoCache) {
      const info = await window.electronAPI.getAboutInfo();
      if (!info?.ok) throw new Error(info?.error || 'Failed to load about info');
      desktopAboutInfoCache = info;
    }
    updateAboutButtonLabel(desktopAboutInfoCache);
    renderAboutDialog(desktopAboutInfoCache);
    showAboutModal();
  } catch (error) {
    console.error('[about] Failed to open dialog:', error);
  }
}
window.openAboutDialog = openAboutDialog;

async function initAboutButton() {
  if (!window.electronAPI?.getAboutInfo) return;
  try {
    const info = await window.electronAPI.getAboutInfo();
    if (!info?.ok) return;
    desktopAboutInfoCache = info;
  } catch (_) {}
}

async function appendTraceScrapeArtifact(traceId, slot, serviceId, serviceName, diagnostics, extraMeta = {}, extraFiles = []) {
  if (!traceId || !window.electronAPI || typeof window.electronAPI.appendTraceArtifact !== 'function') return;
  if (!diagnostics || typeof diagnostics !== 'object') return;

  const files = [];
  if (typeof diagnostics.selected_html === 'string' && diagnostics.selected_html.trim()) {
    files.push({ name: `${slot}-${serviceId}-selected`, extension: 'html', content: diagnostics.selected_html });
  }
  if (typeof diagnostics.parent_html === 'string' && diagnostics.parent_html.trim()) {
    files.push({ name: `${slot}-${serviceId}-parent`, extension: 'html', content: diagnostics.parent_html });
  }
  if (typeof diagnostics.page_html === 'string' && diagnostics.page_html.trim()) {
    files.push({ name: `${slot}-${serviceId}-page`, extension: 'html', content: diagnostics.page_html });
  }
  if (Array.isArray(extraFiles) && extraFiles.length > 0) files.push(...extraFiles);

  const eventPayload = {
    step: 'scrape_dom_snapshot',
    slot,
    service_id: serviceId,
    service_name: serviceName,
    page_url: diagnostics.page_url || '',
    document_title: diagnostics.document_title || '',
    candidate_count: diagnostics.candidate_count ?? 0,
    pruned_count: diagnostics.pruned_count ?? 0,
    pool_count: diagnostics.pool_count ?? 0,
    fallback_used: diagnostics.fallback_used ?? false,
    extraction_meta: extraMeta,
    selected: diagnostics.selected || null,
    candidates: Array.isArray(diagnostics.candidates) ? diagnostics.candidates : [],
    no_candidate_reason: diagnostics.no_candidate_reason || ''
  };

  try {
    await window.electronAPI.appendTraceArtifact(traceId, eventPayload, files);
  } catch (error) {
    console.warn(`[${slot}] Failed to append trace artifact:`, error?.message || error);
  }
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
      if (l && (l.includes('copy') || l.includes('-�-�-+-+') || l.includes('-�-+-+-+-�'))) return true;
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
      'button[aria-label*="-�-+-+-+-�" i]',
      '[role="button"][aria-label*="-�-+-+-+-�" i]',
      'button[aria-label*="-�-�-+-+" i]',
      'button[title*="-�-�-+-+" i]',
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
    // Intercept clipboard.write() (ClipboardItem API) G�� used by Gemini, Grok
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
              // Also try text/html G�� strip tags as fallback
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
    const aggregatedNoteId = String(
      parsed?.aggregated_note_id
      || parsed?.note_id
      || ''
    ).trim() || null;
    const sourcePrompt = String(parsed?.source_prompt || '').trim() || null;
    return {
      session_id: sessionId,
      fingerprint,
      aggregated_note_id: aggregatedNoteId,
      source_prompt: sourcePrompt
    };
  } catch (_) {
    return null;
  }
}

function persistSessionContext(sessionId, fingerprint, aggregatedNoteId = null, sourcePrompt = null) {
  if (!Number.isInteger(sessionId) || sessionId <= 0 || !fingerprint) return;
  activeSessionId = sessionId; // always keep in-memory copy
  // Fingerprint ties the cached question context to the current enabled-slot layout,
  // so we do not accidentally restore one question into a different slot combination.
  const normalizedAggregatedNoteId = String(aggregatedNoteId || '').trim() || null;
  const normalizedSourcePrompt = String(sourcePrompt ?? activeSessionPrompt ?? '').trim() || null;
  if (normalizedAggregatedNoteId) {
    activeAggregatedNoteId = normalizedAggregatedNoteId;
  }
  if (normalizedSourcePrompt) {
    activeSessionPrompt = normalizedSourcePrompt;
  }
  const context = {
    session_id: sessionId,
    fingerprint,
    aggregated_note_id: normalizedAggregatedNoteId,
    source_prompt: normalizedSourcePrompt,
    updated_at: new Date().toISOString()
  };
  localStorage.setItem(AGGREGATED_SESSION_CONTEXT_KEY, JSON.stringify(context));
  localStorage.setItem(AGGREGATED_SESSION_ID_KEY, String(sessionId));
}

function clearStoredSessionContext() {
  activeSessionId = null;
  activeAggregatedNoteId = null;
  activeSessionPrompt = '';
  activeSessionFingerprint = null;
  localStorage.removeItem(AGGREGATED_SESSION_CONTEXT_KEY);
  localStorage.removeItem(AGGREGATED_SESSION_ID_KEY);
}

function resetActiveSessionContext() {
  clearStoredSessionContext();
  clearIngestSessionIndicator();
  if (window.mergeApiClient) {
    window.mergeApiClient.lastSourcePrompt = '';
  }
  mergeLog('Session context reset by user from Sessions tab', 'info');
}

// Switching projects mid-work must not keep appending new questions to the
// previous project's session. The cached context is keyed only by slot
// fingerprint (not by project), so without this the next send/collect reuses
// the old session id (e.g. everything piling under #250). Clearing it makes the
// next send resolve or create a fresh question root under the new project.
function resetSessionContextOnProjectSwitch(nextProjectId) {
  const hasActiveContext = Number.isInteger(activeSessionId) || !!readSessionContext();
  if (!hasActiveContext) return; // nothing in flight -> no reset needed
  clearStoredSessionContext();
  clearIngestSessionIndicator();
  if (window.mergeApiClient) {
    window.mergeApiClient.lastSourcePrompt = '';
  }
  mergeLog(`Session context auto-reset on project switch -> ${nextProjectId || 'No Project'}`, 'info');
  try { updateSessionsUI(); } catch (_) { /* sessions tab may be unmounted */ }
}

function getStoredSessionIdForFingerprint(fingerprint) {
  const normalizedFingerprint = String(fingerprint || '').trim();
  if (!normalizedFingerprint) return null;
  const context = readSessionContext();
  if (!context) return null;
  return context.fingerprint === normalizedFingerprint ? context.session_id : null;
}

function getStoredSessionContextForFingerprint(fingerprint) {
  const normalizedFingerprint = String(fingerprint || '').trim();
  if (!normalizedFingerprint) return null;
  const context = readSessionContext();
  if (!context || context.fingerprint !== normalizedFingerprint) return null;
  return context;
}

// One-shot guard: after sign-in / late-login migration, suppress restoring a
// pre-login session by slot fingerprint so a new question starts fresh. Lifted
// on explicit session load or when a fresh ingest creates a session.
const SUPPRESS_SLOT_RESTORE_KEY = 'verity-suppress-slot-restore';
function setSuppressSlotRestore(value) {
  try {
    if (value) localStorage.setItem(SUPPRESS_SLOT_RESTORE_KEY, '1');
    else localStorage.removeItem(SUPPRESS_SLOT_RESTORE_KEY);
  } catch (_) { /* ignore */ }
}
function getSuppressSlotRestore() {
  try { return localStorage.getItem(SUPPRESS_SLOT_RESTORE_KEY) === '1'; }
  catch (_) { return false; }
}

function restoreStoredQuestionContextForFingerprint(fingerprint) {
  if (getSuppressSlotRestore()) return null;
  const context = getStoredSessionContextForFingerprint(fingerprint);
  if (!context?.session_id) return null;
  activeSessionId = context.session_id;
  activeAggregatedNoteId = String(context.aggregated_note_id || '').trim() || null;
  activeSessionPrompt = String(context.source_prompt || '').trim() || activeSessionPrompt;
  activeSessionFingerprint = fingerprint;
  persistSessionContext(context.session_id, fingerprint, activeAggregatedNoteId, context.source_prompt || null);
  setIngestSessionIndicator(context.session_id);
  return context;
}

function normalizePromptForComparison(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function promptsReferToSameQuestion(currentPrompt, storedPrompt) {
  const current = normalizePromptForComparison(currentPrompt);
  const stored = normalizePromptForComparison(storedPrompt);
  if (!current || !stored) return false;
  return current === stored;
}

function sessionSnapshotSortTimestamp(session) {
  const updated = Date.parse(session?.updatedAt || session?.updated_at || '');
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(session?.createdAt || session?.created_at || '');
  if (Number.isFinite(created)) return created;
  const timestamp = Number(session?.timestamp || 0);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function findExistingAggregatedRootForQuestion(sessionId, prompt) {
  const numericSessionId = Number(sessionId);
  const normalizedPrompt = String(prompt || '').trim();
  if (!Number.isInteger(numericSessionId) || numericSessionId <= 0 || !normalizedPrompt) {
    return null;
  }

  const sessions = await loadSessionsList();
  const matches = (Array.isArray(sessions) ? sessions : []).filter((session) => {
    const rowSessionId = Number(session?.sessionId ?? session?.session_id ?? null);
    if (!Number.isInteger(rowSessionId) || rowSessionId !== numericSessionId) return false;
    const noteId = String(session?.noteId ?? session?.note_id ?? '').trim();
    if (!noteId) return false;
    const rowPrompt = String(session?.name || session?.title || '').trim();
    return promptsReferToSameQuestion(normalizedPrompt, rowPrompt);
  });

  if (matches.length === 0) return null;
  matches.sort((a, b) => sessionSnapshotSortTimestamp(b) - sessionSnapshotSortTimestamp(a));
  return matches[0];
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

function getCurrentQuestionSessionId() {
  const activeRootId = String(activeAggregatedNoteId || '').trim();
  if (!activeRootId) return null;
  if (Number.isInteger(activeSessionId) && activeSessionId > 0) return activeSessionId;
  return getStoredAggregatedSessionId();
}

function buildAggregatedPayload(params) {
  const sourcePrompt = (params.sourcePrompt || '').trim();
  const title = sourcePrompt || `Verity merge ${new Date().toISOString()}`;
  const sessionId = Number.isInteger(params?.sessionId) && params.sessionId > 0
    ? params.sessionId
    : null;
  const projectTagId = String(params?.projectTagId || '').trim() || null;
  const aggregatedNoteId = String(params?.aggregatedNoteId || '').trim() || null;
  const replaceExisting = !!params?.replaceExisting;
  const responses = Array.isArray(params?.responses) ? params.responses : [];

  return {
    payload: {
      schema: 'aggregated_ingest_v1',
      session_id: sessionId,
      project_tag_id: projectTagId,
      aggregated_note_id: aggregatedNoteId,
      replace_existing: replaceExisting,
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
      const headerCells = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
        .filter((cell) => cell.length > 0);
      out.push(line);
      out.push(`| ${headerCells.map(() => '---').join(' | ')} |`);
      i += 1;
      continue;
    }

    out.push(line);
  }
  return out.join('\n');
}

function repairMarkdownArtifacts(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const out = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const next = i + 1 < lines.length ? lines[i + 1] : '';
    const nextTrimmed = next.trim();

    if (/^export to sheets$/i.test(trimmed)) continue;

    if (trimmed === '-' && nextTrimmed && !/^[-*+]\s+/.test(nextTrimmed) && !/^\d+[.)]\s+/.test(nextTrimmed)) {
      out.push(`- ${nextTrimmed}`);
      i += 1;
      continue;
    }

    if (/^\d+[.)]$/.test(trimmed) && nextTrimmed && !/^[-*+]\s+/.test(nextTrimmed) && !/^\d+[.)]\s+/.test(nextTrimmed)) {
      out.push(`${trimmed.replace(/\)$/, '.')} ${nextTrimmed}`);
      i += 1;
      continue;
    }

    if (out.length > 0 && /^\s*-\s+/.test(trimmed)) {
      const prev = out[out.length - 1].trim();
      if (/^\d+\.\s+/.test(prev)) {
        out.push(`  ${trimmed}`);
        continue;
      }
    }

    out.push(line);
  }

  return out
    .join('\n')
    .replace(/([A-Za-z)])\n(\d+)\s+\|/g, '$1^$2 |')
    .replace(/^##\s+Gemini said\b[:\s-]*/gim, '')
    .replace(/^You said\s*$/gim, '')
    .trim();
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
  out = out.replace(/^\s*[G��G��G��G��G��G��G��]\s+/, '- ');
  out = out.replace(/^\s*[G��G��G��]\s+/, '- ');
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
  if (flat.length < 180 && /\b(glasp|searched the web|fetching from)\b/i.test(flat)) return false;
  const promptFlat = (sourcePrompt || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Reject if the scraped text is just the user's prompt
  if (promptFlat && flat === promptFlat) return false;
  if (promptFlat && flat.length < promptFlat.length * 1.5 && flat.includes(promptFlat)) return false;
  return true;
}

// ========== TABLE FORMAT CONVERSION ==========
// LLMs export tables in different formats:
//   CSV  (Grok, Gemini)    G��  col1,col2,col3
//   Space-aligned (DeepSeek) G��  col1  col2  col3   (2+ spaces as separator)
//   Markdown (Perplexity, ChatGPT, Claude) G�� | col1 | col2 |  (already fine)
// We convert CSV and space-aligned G�� markdown so the frontend renders properly.

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

// Convert space-aligned tables (DeepSeek format) G�� markdown tables.
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
      // Single line or empty G�� not a real table, output raw
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

    // Empty line G�� flush any pending table, pass through blank
    if (!line) {
      flushTable();
      output.push('');
      continue;
    }

    // Already a markdown element G�� flush and pass through
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
      // Same or fewer cols (e.g. summary row like "-�-�-+-�-+  6 150 G�+") G�� keep in table
      tableBuf.push(parts);
    } else if (parts.length > colCount) {
      // More columns than current header G�� end table, start new one
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
      .replace(new RegExp(`^\\s*${escapedPrompt}[\\s:G��\\-]*\\n+`, 'i'), '')
      .replace(new RegExp(`^(?:you said|-�-� -�-�-�-+-�-+-+)\\s+${escapedPrompt}[\\s:G��\\-]*`, 'i'), '')
      .replace(new RegExp(`\\b(?:you said|-�-� -�-�-�-+-�-+-+)\\s+${escapedPrompt}\\b`, 'ig'), '')
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
      .replace(/\n\d[\d,.]*\s*[-�s]\s*$/im, '')   // e.g. "\n1,1-�"
      .replace(/\n-�-�-�-�-�-+\s*$/im, '')
      .trim();
  }

  const dropLine = (lineLower) => {
    if (!lineLower) return true;
    if (lineLower === 'source') return true;
    if (lineLower === 'share' || lineLower === 'edit' || lineLower === 'retry' || lineLower === 'copy' || lineLower === 'regenerate') return true;
    if (lineLower === 'open sidebar' || lineLower === 'reply...' || lineLower === 'temporary chat' || lineLower === 'incognito chat') return true;
    if (lineLower === 'tools' || lineLower === 'fast') return true;
    if (lineLower.startsWith('model:') || lineLower.includes('window.__')) return true;
    if (lineLower.includes('-+-�-�-�-�-+-�-�-+-�-� -�-+-�-+-�-�-� -+-�-+-�-+-�')) return true;
    if (lineLower.includes('can make mistakes') || lineLower.includes('please double-check responses')) return true;
    if (lineLower.includes('check important info') || lineLower.includes('see cookie preferences')) return true;
    // Gemini image result artifacts
    if (lineLower === 'opens in a new window' || lineLower === 'open') return true;
    if (/^www\.[^\s]+$/.test(lineLower)) return true;  // bare domain lines (e.g. www.ozon.ru)
    // Grok UI artifacts: timing lines, suggestion chips
    if (/^\d[\d,.]*\s*[-�s]$/.test(lineLower)) return true;  // "1,1-�" / "1.1s"
    if (lineLower === '-�-�-�-�-�-+' || lineLower === '-+-+-�-�-+-�-+-�-�') return true;
    if (lineLower.startsWith('-�-�-�-�-�-�-�-+ -�-+-+-�-�-�')) return true;
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
  text = repairMarkdownArtifacts(text);

  // Convert CSV tables (Grok/Gemini) and space-aligned tables (DeepSeek) G�� markdown
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

function getOriginPlatformCode() {
  const platform = String(navigator?.platform || '').toLowerCase();
  const userAgent = String(navigator?.userAgent || '').toLowerCase();

  if (userAgent.includes('android')) return 'AND';
  if (/(iphone|ipad|ipod)/.test(userAgent) || /(iphone|ipad|ipod)/.test(platform)) return 'IOS';
  if (platform.includes('win') || userAgent.includes('windows')) return 'WIN';
  if (platform.includes('mac') || userAgent.includes('mac os')) return 'MAC';
  if (platform.includes('linux') || userAgent.includes('linux')) return 'LNX';
  return 'WEB';
}

async function sendAggregated(sessionId, title, responses, scrapeMeta = [], projectTagId = null, replaceExisting = false, aggregatedNoteId = null) {
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
    project_tag_id: String(projectTagId || '').trim() || null,
    aggregated_note_id: String(aggregatedNoteId || '').trim() || null,
    replace_existing: !!replaceExisting,
    platform_code: getOriginPlatformCode(),
    title: title || `Aggregated ${new Date().toISOString()}`,
    responses: normalizedResponses
  };

  const sourceMessageId = `msg_${hashString(stableStringify(payload))}`;
  const traceContext = getIngestTraceContext(sourceMessageId);
  traceContext.scrapeMeta = Array.isArray(scrapeMeta) ? scrapeMeta : [];
  return ingestAggregatedPayload(payload, 'aggregated', sourceMessageId, traceContext);
}

async function sendMerge(sessionId, promptText, markdown, scrapeMeta = [], aggregatedNoteId = null) {
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { ok: false, error: 'session_id is required for merge.' };
  }
  if (!window.electronAPI || typeof window.electronAPI.sendMerge !== 'function') {
    return { ok: false, error: 'Merge bridge is not available in preload.' };
  }

  const payload = {
    schema: 'merge_ingest_v1',
    session_id: sessionId,
    aggregated_note_id: String(aggregatedNoteId || activeAggregatedNoteId || '').trim() || null,
    platform_code: getOriginPlatformCode(),
    prompt_text: String(promptText || '').trim(),
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

async function sendClarification(sessionId, promptText, markdown, scrapeMeta = []) {
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return { ok: false, error: 'session_id is required for clarification.' };
  }
  if (!window.electronAPI || typeof window.electronAPI.sendClarification !== 'function') {
    return { ok: false, error: 'Clarification bridge is not available in preload.' };
  }

  const payload = {
    schema: 'clarification_ingest_v1',
    session_id: sessionId,
    platform_code: getOriginPlatformCode(),
    prompt_text: String(promptText || '').trim(),
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

  const rawUrl = String(url).trim();
  if (!rawUrl) return;
  const serviceId = detectServiceByUrl(rawUrl) || slotConfig[slot] || null;
  const normalizedUrl = window.IncognitoPolicy?.normalizeUrl
    ? window.IncognitoPolicy.normalizeUrl(serviceId, rawUrl, incognitoModeEnabled)
    : rawUrl;

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

async function ensureNativeIncognitoForSlot(slot, reason = 'load') {
  if (!incognitoModeEnabled) return;
  const webview = webviews[slot];
  if (!webview || !webviewReady[slot]) return;

  let currentUrl = '';
  try {
    currentUrl = webview.getURL() || '';
  } catch (_) {
    currentUrl = '';
  }

  const serviceId = detectServiceByUrl(currentUrl) || slotConfig[slot] || null;
  if (!serviceId || !window.IncognitoPolicy?.needsNativeActivation?.(serviceId, true)) return;

  const ensureKey = `${serviceId}|${String(currentUrl || '').trim()}`;
  const ensureState = incognitoEnsureState[slot];
  const now = Date.now();
  if (ensureState?.inFlight && ensureState.inFlightKey === ensureKey) {
    console.info(`[Incognito][${slot}] ${reason} skipped-inflight ${ensureKey}`);
    return;
  }
  if (
    ensureState?.lastSuccessKey === ensureKey &&
    now - Number(ensureState.lastSuccessAt || 0) < 4000
  ) {
    console.info(`[Incognito][${slot}] ${reason} skipped-recent-success ${ensureKey}`);
    return;
  }
  if (ensureState) {
    ensureState.inFlight = true;
    ensureState.inFlightKey = ensureKey;
  }

  try {
    if (serviceId === 'gemini' && window.IncognitoPolicy?.buildProbeScript) {
      try {
        const beforeProbe = await webview.executeJavaScript(window.IncognitoPolicy.buildProbeScript(serviceId), true);
        console.info(`[IncognitoProbe][${slot}] ${reason}:before ${safeStringifyForLog(beforeProbe)}`);
      } catch (probeErr) {
        console.warn(`[IncognitoProbe][${slot}] before probe failed during ${reason}:`, probeErr?.message || probeErr);
      }
    }
    const result = await webview.executeJavaScript(window.IncognitoPolicy.buildEnsureScript(serviceId), true);
    console.info(`[Incognito][${slot}] ${reason} ${safeStringifyForLog(result)}`);
    if (result?.ok && ensureState) {
      ensureState.lastSuccessKey = ensureKey;
      ensureState.lastSuccessAt = Date.now();
    }
    if (serviceId === 'gemini' && window.IncognitoPolicy?.buildProbeScript) {
      try {
        const afterProbe = await webview.executeJavaScript(window.IncognitoPolicy.buildProbeScript(serviceId), true);
        console.info(`[IncognitoProbe][${slot}] ${reason}:after ${safeStringifyForLog(afterProbe)}`);
      } catch (probeErr) {
        console.warn(`[IncognitoProbe][${slot}] after probe failed during ${reason}:`, probeErr?.message || probeErr);
      }
    }
  } catch (err) {
    console.warn(`[Incognito][${slot}] ensure failed during ${reason}:`, err?.message || err);
  } finally {
    if (ensureState) {
      ensureState.inFlight = false;
      ensureState.inFlightKey = '';
    }
  }
}

function scheduleNativeIncognitoEnsure(slot, reason = 'load') {
  if (incognitoEnsureTimers[slot]) clearTimeout(incognitoEnsureTimers[slot]);
  incognitoEnsureTimers[slot] = setTimeout(() => {
    incognitoEnsureTimers[slot] = null;
    ensureNativeIncognitoForSlot(slot, reason);
  }, 900);
}

function safeStringifyForLog(value) {
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
}

function safeReload(slot) {
  const webview = webviews[slot];
  if (!webview) return;

  // Try reload() first regardless of ready state G�� it works once webview is attached
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

function normalizeProjectSlotUrls(rawSlotUrls) {
  if (!rawSlotUrls || typeof rawSlotUrls !== 'object') return {};
  const slotUrls = {};
  Object.entries(rawSlotUrls).forEach(([rawKey, rawValue]) => {
    const key = String(rawKey || '').trim();
    if (!key) return;
    const url = typeof rawValue === 'string'
      ? rawValue.trim()
      : String(rawValue?.url || rawValue?.href || '').trim();
    if (!url) return;
    slotUrls[key] = url;
    slotUrls[key.toLowerCase()] = url;
  });
  return slotUrls;
}

function buildProjectTreeNodes(tags, tagParents) {
  const namesById = new Map();
  const colorsById = new Map();
  const slotUrlsById = new Map();
  (Array.isArray(tags) ? tags : []).forEach((row) => {
    const id = String(row?.id || '').trim();
    const name = String(row?.name || '').trim();
    if (!id || !name) return;
    namesById.set(id, name);
    if (row?.color) colorsById.set(id, String(row.color).trim());
    slotUrlsById.set(id, normalizeProjectSlotUrls(row?.slot_urls || row?.slotUrls || {}));
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

  const buildNode = (nodeId, pathSet, ancestorSlotUrls = {}, pathKey = nodeId) => {
    const nextPath = new Set(pathSet);
    nextPath.add(nodeId);
    const inheritedSlotUrls = {
      ...ancestorSlotUrls,
      ...(slotUrlsById.get(nodeId) || {})
    };
    const childNodes = (childrenByParent.get(nodeId) || [])
      .filter((childId) => !nextPath.has(childId))
      .map((childId) => buildNode(childId, nextPath, inheritedSlotUrls, `${pathKey}>${childId}`));
    return { 
      id: nodeId, 
      pathKey,
      name: namesById.get(nodeId) || '', 
      color: colorsById.get(nodeId) || '',
      slotUrls: inheritedSlotUrls,
      children: childNodes 
    };
  };

  const rootIds = childrenByParent.get(null) || [];
  const finalRootIds = rootIds.length > 0
    ? rootIds
    : Array.from(namesById.keys()).sort((a, b) => {
      const an = String(namesById.get(a) || '').toLowerCase();
      const bn = String(namesById.get(b) || '').toLowerCase();
      return an.localeCompare(bn);
    });

  return Array.from(new Set(finalRootIds)).map((rootId) => buildNode(rootId, new Set(), {}, rootId));
}

function ensureExpandedProjectNodes(nodes) {
  if (expandedProjectNodeIds.size > 0) return;
  const walk = (list) => {
    list.forEach((node) => {
      if (!node || !Array.isArray(node.children) || node.children.length === 0) return;
      expandedProjectNodeIds.add(node.pathKey || node.id);
      walk(node.children);
    });
  };
  walk(Array.isArray(nodes) ? nodes : []);
}

function findProjectNodeById(nodes, projectId) {
  const targetId = String(projectId || '').trim();
  if (!targetId) return null;
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) continue;
    if (node.id === targetId) return node;
    const child = findProjectNodeById(node.children, targetId);
    if (child) return child;
  }
  return null;
}

function findProjectNodeByPathKey(nodes, pathKey) {
  const targetKey = String(pathKey || '').trim();
  if (!targetKey) return null;
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) continue;
    if ((node.pathKey || node.id) === targetKey) return node;
    const child = findProjectNodeByPathKey(node.children, targetKey);
    if (child) return child;
  }
  return null;
}

function updateProjectSelectorAppearance() {
  const activeNode = activeProjectId ? findProjectNodeByPathKey(projectTreeNodes, activeProjectPathKey) || findProjectNodeById(projectTreeNodes, activeProjectId) : null;
  const activeProjectColor = String(activeNode?.color || '').trim();
  const activeProjectName = String(activeNode?.name || '').trim();
  const displayName = activeProjectId ? (activeProjectName || 'Project') : '';
  const selectorColor = activeProjectId && activeProjectColor ? activeProjectColor : '';

  [projectSelectorBtn, projectToolbarBtn].forEach((button) => {
    if (!button) return;
    button.classList.toggle('active', !!activeProjectId);
    button.style.color = selectorColor;
  });

  if (activeProjectNameEl) {
    activeProjectNameEl.textContent = displayName;
  }
  if (projectToolbarBtn) {
    projectToolbarBtn.title = activeProjectId ? `Project: ${displayName}` : 'Projects';
    projectToolbarBtn.setAttribute('aria-label', projectToolbarBtn.title);
  }
}

function renderProjectTreeNode(container, node, depth) {
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;
  const nodeKey = node.pathKey || node.id;
  const isExpanded = expandedProjectNodeIds.has(nodeKey);
  const isSelected = activeProjectId === node.id && (!activeProjectPathKey || activeProjectPathKey === nodeKey);

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
      if (expandedProjectNodeIds.has(nodeKey)) expandedProjectNodeIds.delete(nodeKey);
      else expandedProjectNodeIds.add(nodeKey);
      renderProjectPanel(projectTreeNodes);
    });
  }
  row.appendChild(chevron);

  const name = document.createElement('span');
  name.className = 'project-tree-name';
  name.textContent = node.name || 'Untitled';
  row.appendChild(name);

  row.addEventListener('click', async () => {
    const nextId = String(node?.id || '').trim() || null;
    const projectChanged = (activeProjectId || null) !== nextId;
    await setActiveProject(node);
    if (projectChanged) resetSessionContextOnProjectSwitch(nextId);
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
  if (projectPanelFooterEl) projectPanelFooterEl.innerHTML = '';

  if (!Array.isArray(nodes) || nodes.length === 0) {
    const empty = document.createElement('div');
    empty.style.padding = '8px 10px';
    empty.style.color = '#888';
    empty.style.fontSize = '12px';
    empty.textContent = 'No projects found';
    projectTreeEl.appendChild(empty);
  } else {
    nodes.forEach((node) => renderProjectTreeNode(projectTreeEl, node, 0));
  }

  const noProjectRow = document.createElement('div');
  noProjectRow.className = `project-tree-row${!activeProjectId ? ' selected' : ''}`;
  noProjectRow.style.paddingLeft = '6px';
  noProjectRow.innerHTML = '<button type="button" class="project-tree-chevron placeholder">?</button><span class="project-tree-name">No Project</span>';
  noProjectRow.addEventListener('click', async () => {
    const projectChanged = (activeProjectId || null) !== null;
    await setActiveProject(null);
    if (projectChanged) resetSessionContextOnProjectSwitch(null);
    hideProjectPanel();
  });
  if (projectPanelFooterEl) {
    projectPanelFooterEl.appendChild(noProjectRow);
  } else {
    projectTreeEl.appendChild(noProjectRow);
  }
}

function setProjectPanelVisible(visible) {
  isProjectPanelVisible = !!visible;
  if (projectPanelEl) projectPanelEl.classList.toggle('visible', isProjectPanelVisible);
  if (projectPanelScrimEl) projectPanelScrimEl.classList.toggle('visible', isProjectPanelVisible);
  document.body.classList.toggle('project-panel-open', isProjectPanelVisible);
}

function isFreshRemoteListCache(timestamp) {
  const value = Number(timestamp || 0);
  return Number.isFinite(value) && value > 0 && Date.now() - value < REMOTE_LIST_CACHE_TTL_MS;
}

function readJsonCache(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonCache(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function readCachedProjectTree() {
  const nodes = readJsonCache(PROJECT_TREE_CACHE_KEY, []);
  const meta = readJsonCache(PROJECT_TREE_CACHE_META_KEY, {});
  return {
    nodes: Array.isArray(nodes) ? nodes : [],
    fetchedAt: Number(meta?.fetchedAt || 0)
  };
}

function writeCachedProjectTree(nodes) {
  writeJsonCache(PROJECT_TREE_CACHE_KEY, Array.isArray(nodes) ? nodes : []);
  writeJsonCache(PROJECT_TREE_CACHE_META_KEY, { fetchedAt: Date.now() });
}

async function loadAndRenderProjectTree(options = {}) {
  const forceRefresh = options?.forceRefresh === true;
  const cached = readCachedProjectTree();
  if (!forceRefresh && cached.nodes.length > 0 && isFreshRemoteListCache(cached.fetchedAt)) {
    projectTreeNodes = cached.nodes;
    ensureExpandedProjectNodes(projectTreeNodes);
    renderProjectPanel(projectTreeNodes);
    updateProjectSelectorAppearance();
    isProjectTreeLoaded = true;
    return;
  }

  if (!window.electronAPI || typeof window.electronAPI.listProjectTreeData !== 'function') {
    projectTreeNodes = cached.nodes;
    renderProjectPanel(projectTreeNodes);
    updateProjectSelectorAppearance();
    isProjectTreeLoaded = true;
    return;
  }
  try {
    const response = await window.electronAPI.listProjectTreeData();
    if (!response || response.ok !== true) {
      projectTreeNodes = cached.nodes;
      renderProjectPanel(projectTreeNodes);
      updateProjectSelectorAppearance();
      isProjectTreeLoaded = true;
      return;
    }
    projectTreeNodes = buildProjectTreeNodes(response.tags, response.tagParents);
    ensureExpandedProjectNodes(projectTreeNodes);
    renderProjectPanel(projectTreeNodes);
    updateProjectSelectorAppearance();
    writeCachedProjectTree(projectTreeNodes);
    isProjectTreeLoaded = true;
  } catch (error) {
    console.warn('[projects] load failed:', error?.message || error);
    projectTreeNodes = cached.nodes;
    renderProjectPanel(projectTreeNodes);
    updateProjectSelectorAppearance();
    isProjectTreeLoaded = true;
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

async function setActiveProject(project, options = {}) {
  // applySlotUrls=false activates only the project state/chip without
  // navigating slots (used when slot URLs were already restored elsewhere).
  const applySlotUrls = options?.applySlotUrls !== false;
  const projectNode = project && typeof project === 'object' ? project : null;
  const normalizedId = projectNode
    ? String(projectNode.id || '').trim()
    : project ? String(project).trim() : '';
  const normalizedPathKey = projectNode ? String(projectNode.pathKey || projectNode.id || '').trim() : normalizedId;
  activeProjectId = normalizedId || null;
  activeProjectPathKey = activeProjectId ? normalizedPathKey : null;
  updateProjectSelectorAppearance();
  renderProjectPanel(projectTreeNodes);

  const loadGen = ++projectSlotUrlLoadGeneration;
  if (!activeProjectId) {
    activeProjectPathKey = null;
    activeProjectSlotUrls = {};
    if (applySlotUrls) {
      SLOTS.forEach((slot) => {
        const serviceId = String(slotConfig[slot] || '').trim();
        const preset = SERVICE_PRESETS[serviceId];
        if (preset?.url) {
          safeLoadURL(slot, preset.url);
          const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
          if (urlInput) urlInput.value = preset.url;
        }
      });
    }
    return;
  }

  const inheritedSlotUrls = projectNode?.slotUrls && typeof projectNode.slotUrls === 'object'
    ? projectNode.slotUrls
    : {};
  const slotUrls = Object.keys(inheritedSlotUrls).length > 0
    ? inheritedSlotUrls
    : await loadProjectSlotUrls(activeProjectId);
  if (loadGen !== projectSlotUrlLoadGeneration || activeProjectId !== normalizedId || activeProjectPathKey !== normalizedPathKey) return;
  activeProjectSlotUrls = slotUrls;
  if (applySlotUrls) applyProjectOverridesToVisibleSlots();
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

function updateSlotToggleVisualState(slot) {
  const checkbox = toggles[slot];
  const wrapper = checkbox?.closest('.toggle');
  if (!wrapper || !checkbox) return;
  wrapper.classList.toggle('inactive', !checkbox.checked);
}

function updateSlotWindowVisualState(slot) {
  const checkbox = toggles[slot];
  const container = getSlotContainer(slot);
  if (!container || !checkbox) return;
  container.classList.toggle('inactive', !checkbox.checked);
}

SLOTS.forEach(slot => {
  if (!toggles[slot]) return;
  toggles[slot].checked = slotEnabledState[slot] !== false;
  updateSlotToggleVisualState(slot);
  updateSlotToggleIcon(slot, slotConfig[slot]);
  updateSlotWindowVisualState(slot);
  toggles[slot].addEventListener('change', () => {
    slotEnabledState[slot] = !!toggles[slot].checked;
    updateSlotToggleVisualState(slot);
    updateSlotWindowVisualState(slot);
    saveSlotEnabledState(slotEnabledState);
  });
});
saveSlotEnabledState(getCurrentSlotEnabledState());
window.addEventListener('beforeunload', () => {
  saveSlotEnabledState(getCurrentSlotEnabledState());
});

function normalizeSlotVisualOrder(value) {
  const seen = new Set();
  const normalized = [];
  (Array.isArray(value) ? value : []).forEach((slot) => {
    if (SLOTS.includes(slot) && !seen.has(slot)) {
      seen.add(slot);
      normalized.push(slot);
    }
  });
  SLOTS.forEach((slot) => {
    if (!seen.has(slot)) normalized.push(slot);
  });
  return normalized;
}

function loadSlotVisualOrder() {
  try {
    return normalizeSlotVisualOrder(JSON.parse(localStorage.getItem(SLOT_VISUAL_ORDER_KEY) || '[]'));
  } catch (_) {
    return [...SLOTS];
  }
}

let slotVisualOrder = loadSlotVisualOrder();

function saveSlotVisualOrder() {
  localStorage.setItem(SLOT_VISUAL_ORDER_KEY, JSON.stringify(slotVisualOrder));
}

function getSlotContainer(slot) {
  return document.querySelector(`.webview-header[data-slot="${slot}"]`)?.closest('.webview-container') || null;
}

function getSlotToggleWrapper(slot) {
  return toggles[slot]?.closest('.toggle') || null;
}

function getSlotVisualIndex(slot) {
  const visualIndex = slotVisualOrder.indexOf(slot);
  if (visualIndex >= 0) return visualIndex;
  return SLOTS.indexOf(slot);
}

function getSlotSplitSide(slot) {
  const visualIndex = getSlotVisualIndex(slot);
  return visualIndex === 0 || visualIndex === 2 ? 'left' : 'right';
}

function getSlotVisualCell(slot) {
  const visualIndex = Math.max(0, getSlotVisualIndex(slot));
  const column = (visualIndex % 2) + 1;
  const row = Math.floor(visualIndex / 2) + 1;
  return { column, row };
}

function clearSlotGridPlacement(container) {
  if (!container) return;
  container.style.gridColumn = '';
  container.style.gridRow = '';
}

function placeSlotInGridCell(container, slot) {
  if (!container) return;
  const { column, row } = getSlotVisualCell(slot);
  container.style.gridColumn = `${column} / ${column + 1}`;
  container.style.gridRow = `${row} / ${row + 1}`;
}

function normalizeSplitSlotsForVisualOrder() {
  const activeSlots = [leftSplitSlot, rightSplitSlot].filter((slot) => slot && SLOTS.includes(slot));
  leftSplitSlot = null;
  rightSplitSlot = null;

  activeSlots.forEach((slot) => {
    const side = getSlotSplitSide(slot);
    if (side === 'left' && !leftSplitSlot) {
      leftSplitSlot = slot;
    } else if (side === 'right' && !rightSplitSlot) {
      rightSplitSlot = slot;
    }
  });
}

function applySlotVisualOrder() {
  slotVisualOrder.forEach((slot, index) => {
    const container = getSlotContainer(slot);
    if (container) container.style.order = String(index);
  });

  if (togglesContainer) {
    Array.from(togglesContainer.children).forEach((child) => {
      if (!child.matches?.('.toggle[data-slot]')) child.style.order = '100';
    });
    slotVisualOrder.forEach((slot, index) => {
      const toggle = getSlotToggleWrapper(slot);
      if (toggle) toggle.style.order = String(index);
    });
  }

  if (leftSplitSlot || rightSplitSlot) {
    normalizeSplitSlotsForVisualOrder();
    renderSplitSlotLayout();
  }
}

function swapSlotVisualOrder(sourceSlot, targetSlot) {
  if (!SLOTS.includes(sourceSlot) || !SLOTS.includes(targetSlot) || sourceSlot === targetSlot) return false;
  const sourceIndex = slotVisualOrder.indexOf(sourceSlot);
  const targetIndex = slotVisualOrder.indexOf(targetSlot);
  if (sourceIndex < 0 || targetIndex < 0) return false;
  [slotVisualOrder[sourceIndex], slotVisualOrder[targetIndex]] = [slotVisualOrder[targetIndex], slotVisualOrder[sourceIndex]];
  saveSlotVisualOrder();
  applySlotVisualOrder();
  mergeLog(`Swapped visual slots: ${sourceSlot} <-> ${targetSlot}`, 'info');
  return true;
}

function initSlotDragAndDrop() {
  document.querySelectorAll('#toggles .toggle[data-slot]').forEach((toggleEl) => {
    toggleEl.addEventListener('dragstart', (event) => {
      const slot = toggleEl.dataset.slot || '';
      toggleEl.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', slot);
    });

    toggleEl.addEventListener('dragend', () => {
      document.querySelectorAll('#toggles .toggle').forEach((el) => {
        el.classList.remove('dragging', 'drag-over');
      });
    });

    toggleEl.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      toggleEl.classList.add('drag-over');
    });

    toggleEl.addEventListener('dragleave', () => {
      toggleEl.classList.remove('drag-over');
    });

    toggleEl.addEventListener('drop', (event) => {
      event.preventDefault();
      toggleEl.classList.remove('drag-over');
      const sourceSlot = event.dataTransfer.getData('text/plain');
      const targetSlot = toggleEl.dataset.slot || '';
      swapSlotVisualOrder(sourceSlot, targetSlot);
    });
  });
}

applySlotVisualOrder();
initSlotDragAndDrop();

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
  updateSlotToggleIcon(slot, serviceId);

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
    updateSlotToggleIcon(slot, serviceId);

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

function toggleProjectPanel() {
    if (isProjectPanelVisible) {
      hideProjectPanel();
    } else {
      showProjectPanel();
    }
}

if (projectSelectorBtn) {
  projectSelectorBtn.addEventListener('click', toggleProjectPanel);
}
if (projectToolbarBtn) {
  projectToolbarBtn.addEventListener('click', toggleProjectPanel);
}
if (projectPanelCloseBtn) {
  projectPanelCloseBtn.addEventListener('click', hideProjectPanel);
}
if (refreshProjectsBtn) {
  refreshProjectsBtn.addEventListener('click', async () => {
    const now = Date.now();
    if (projectRefreshInFlight || now < projectRefreshLockedUntil) return;
    projectRefreshInFlight = true;
    projectRefreshLockedUntil = now + REFRESH_COOLDOWN_MS;
    const originalText = refreshProjectsBtn.textContent || '↻';
    refreshProjectsBtn.disabled = true;
    refreshProjectsBtn.textContent = '…';
    try {
      await loadAndRenderProjectTree({ forceRefresh: true });
      refreshProjectsBtn.textContent = '✓';
    } catch (error) {
      console.warn('[projects] refresh failed:', error?.message || error);
      refreshProjectsBtn.textContent = '!';
    } finally {
      setTimeout(() => {
        projectRefreshInFlight = false;
        refreshProjectsBtn.disabled = false;
        refreshProjectsBtn.textContent = originalText;
      }, Math.max(0, projectRefreshLockedUntil - Date.now()));
    }
  });
}
if (projectPanelScrimEl) {
  projectPanelScrimEl.addEventListener('click', hideProjectPanel);
}
if (aboutCloseBtn) {
  aboutCloseBtn.addEventListener('click', hideAboutModal);
}
if (aboutModalEl) {
  aboutModalEl.addEventListener('click', (event) => {
    if (event.target === aboutModalEl) {
      hideAboutModal();
    }
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && aboutModalEl?.classList.contains('visible')) {
    hideAboutModal();
  }
});

// ========== COLLAPSE TOOLBAR TOGGLE ==========
let collapsed = localStorage.getItem('top-collapsed');
collapsed = collapsed === 'true';

togglesContainer?.classList.remove('hidden');

function updateToolsChevron() {
  collapseBtn?.classList.toggle('tools-open', !collapsed);
  collapseBtn?.setAttribute('aria-expanded', (!collapsed).toString());
  document.getElementById('bottom-panel')?.classList.toggle('tools-collapsed', collapsed);
}

function syncBottomPanelHeightVar() {
  const bottomPanel = document.getElementById('bottom-panel');
  if (!bottomPanel) return;
  document.documentElement.style.setProperty('--bottom-panel-height', `${bottomPanel.offsetHeight}px`);
}

updateToolsChevron();
syncBottomPanelHeightVar();

collapseBtn.addEventListener('click', () => {
  collapsed = !collapsed;
  localStorage.setItem('top-collapsed', collapsed);
  updateToolsChevron();
  requestAnimationFrame(syncBottomPanelHeightVar);
});

window.addEventListener('resize', syncBottomPanelHeightVar);

// ========== ADDRESS BAR TOGGLE ==========
let addressBarVisible = true;

function applyAddressBarVisibility() {
  const headers = document.querySelectorAll('.webview-header');

  headers.forEach(header => {
    if (addressBarVisible) {
      header.classList.remove('hidden');
    } else {
      header.classList.add('hidden');
    }
  });

  webviewGridEl?.classList.toggle('address-bars-hidden', !addressBarVisible);
  toggleAddressBarBtn.classList.toggle('address-open', addressBarVisible);
  toggleAddressBarBtn.setAttribute('aria-expanded', addressBarVisible.toString());
  localStorage.setItem('show-address-bar', addressBarVisible);
}

toggleAddressBarBtn.addEventListener('click', () => {
  addressBarVisible = !addressBarVisible;
  applyAddressBarVisibility();
});

// Restore address bar setting
const showAddressBar = localStorage.getItem('show-address-bar');
if (showAddressBar === 'false') {
  addressBarVisible = false;
}
applyAddressBarVisibility();

function updateExpandedSlotControls() {
  document.querySelectorAll('.webview-header[data-slot]').forEach(header => {
    const slot = header.dataset.slot;
    const splitBtn = header.querySelector('[data-action="split-toggle"]');
    const expandBtn = header.querySelector('[data-action="expand-toggle"]');
    const isSplitActive = leftSplitSlot === slot || rightSplitSlot === slot;
    const isFullActive = expandedSlot === slot;

    if (splitBtn) {
      splitBtn.classList.toggle('active', isSplitActive);
      splitBtn.textContent = isSplitActive ? 'Exit' : 'Split';
      splitBtn.title = isSplitActive ? 'Return to all slots' : 'Split this slot to its side';
      splitBtn.setAttribute('aria-pressed', isSplitActive ? 'true' : 'false');
    }

    if (expandBtn) {
      expandBtn.classList.toggle('active', isFullActive);
      expandBtn.textContent = isFullActive ? 'Exit' : 'Full';
      expandBtn.title = isFullActive ? 'Return to all slots' : 'Expand this slot';
      expandBtn.setAttribute('aria-pressed', isFullActive ? 'true' : 'false');
    }
  });
}

function renderSplitSlotLayout() {
  const hasSplitSlot = !!leftSplitSlot || !!rightSplitSlot;
  webviewGridEl?.classList.toggle('split-slot', hasSplitSlot);
  webviewGridEl?.classList.toggle('both-split', !!leftSplitSlot && !!rightSplitSlot);
  webviewGridEl?.classList.toggle('expanded-slot', false);

  SLOTS.forEach(candidateSlot => {
    const container = document
      .querySelector(`.webview-header[data-slot="${candidateSlot}"]`)
      ?.closest('.webview-container');
    if (!container) return;
    const isActive = leftSplitSlot === candidateSlot || rightSplitSlot === candidateSlot;
    const side = isActive ? getSlotSplitSide(candidateSlot) : null;
    const candidateSide = getSlotSplitSide(candidateSlot);
    const sameSideSplitSlot = candidateSide === 'left' ? leftSplitSlot : rightSplitSlot;
    const shouldHide = !!sameSideSplitSlot && sameSideSplitSlot !== candidateSlot;
    if (!hasSplitSlot) {
      clearSlotGridPlacement(container);
    } else if (side) {
      const column = side === 'left' ? 1 : 2;
      container.style.gridColumn = `${column} / ${column + 1}`;
      container.style.gridRow = '1 / -1';
    } else {
      placeSlotInGridCell(container, candidateSlot);
    }
    container.classList.toggle('expanded', false);
    container.classList.toggle('split-left', side === 'left');
    container.classList.toggle('split-right', side === 'right');
    container.classList.toggle('hidden-by-expansion', shouldHide);
  });

  updateExpandedSlotControls();
}

function setSplitSlot(slot) {
  const nextSlot = slot && SLOTS.includes(slot) ? slot : null;
  normalizeSplitSlotsForVisualOrder();

  if (nextSlot) {
    expandedSlot = null;
    const wasActive = leftSplitSlot === nextSlot || rightSplitSlot === nextSlot;
    if (wasActive) {
      if (leftSplitSlot === nextSlot) leftSplitSlot = null;
      if (rightSplitSlot === nextSlot) rightSplitSlot = null;
    } else if (getSlotSplitSide(nextSlot) === 'left') {
      leftSplitSlot = nextSlot;
    } else {
      rightSplitSlot = nextSlot;
    }
  } else {
    leftSplitSlot = null;
    rightSplitSlot = null;
  }

  renderSplitSlotLayout();
}

function setExpandedSlot(slot) {
  expandedSlot = slot && SLOTS.includes(slot) ? slot : null;
  if (expandedSlot) {
    leftSplitSlot = null;
    rightSplitSlot = null;
  }

  webviewGridEl?.classList.toggle('expanded-slot', !!expandedSlot);
  webviewGridEl?.classList.toggle('split-slot', false);

  SLOTS.forEach(candidateSlot => {
    const container = document
      .querySelector(`.webview-header[data-slot="${candidateSlot}"]`)
      ?.closest('.webview-container');
    if (!container) return;
    const isActive = expandedSlot === candidateSlot;
    clearSlotGridPlacement(container);
    container.classList.toggle('expanded', isActive);
    container.classList.toggle('split-left', false);
    container.classList.toggle('split-right', false);
    container.classList.toggle('hidden-by-expansion', !!expandedSlot && !isActive);
  });

  updateExpandedSlotControls();
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
      updateSlotToggleIcon(slot, detected);
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

  const expandBtn = header.querySelector('[data-action="expand-toggle"]');
  if (expandBtn) {
    expandBtn.addEventListener('click', () => {
      setExpandedSlot(expandedSlot === slot ? null : slot);
    });
  }

  const splitBtn = header.querySelector('[data-action="split-toggle"]');
  if (splitBtn) {
    splitBtn.addEventListener('click', () => {
      setSplitSlot(slot);
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
    scheduleNativeIncognitoEnsure(slot, 'dom-ready');
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    const urls = e.favicons || [];
    const best = urls.find(u => /\.png|\.svg/i.test(u)) || urls[0];
    if (best && best !== slotFavicons[slot]) {
      slotFavicons[slot] = best;
      updateSlotToggleIcon(slot, slotConfig[slot]);
    }
  });

  // Update nav buttons on load
  webview.addEventListener('did-stop-loading', () => {
    updateNavButtons();
    scheduleNativeIncognitoEnsure(slot, 'did-stop-loading');
  });

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
try { localStorage.removeItem('incognito-mode'); } catch (_) {}
let incognitoModeEnabled = false;
let mobileUaEnabled = localStorage.getItem('mobile-ua') === 'true';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function applyMobileUaState() {
  if (mobileUaEnabled) {
    mobileUaToggle?.classList.add('active');
  } else {
    mobileUaToggle?.classList.remove('active');
  }
}

function applyIncognitoModeState() {
  if (incognitoModeEnabled) incognitoModeBtn?.classList.add('active');
  else incognitoModeBtn?.classList.remove('active');
  if (incognitoModeBtn) {
    incognitoModeBtn.textContent = incognitoModeEnabled ? 'Temp ON' : 'Temp mode';
  }
}

applyMobileUaState();
applyIncognitoModeState();

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

// Apply mobile UA on startup (just set attribute, no reload needed G�� webviews load with it)
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

  console.log(`[MobileUA] ${mobileUaEnabled ? 'Mobile' : 'Desktop'} UA G�� all ${SLOTS.length} webviews reloading`);
});

incognitoModeBtn?.addEventListener('click', () => {
  incognitoModeEnabled = !incognitoModeEnabled;
  applyIncognitoModeState();

  if (!incognitoModeEnabled) {
    SLOTS.forEach((slot) => {
      if (!incognitoEnsureState[slot]) return;
      incognitoEnsureState[slot].lastSuccessKey = '';
      incognitoEnsureState[slot].lastSuccessAt = 0;
    });
  }

  SLOTS.forEach((slot) => {
    const webview = webviews[slot];
    if (!webview) return;
    let currentUrl = pendingNavigation[slot] || '';
    if (!currentUrl) {
      try {
        currentUrl = webview.getURL() || webview.getAttribute('src') || '';
      } catch (_) {
        currentUrl = webview.getAttribute('src') || '';
      }
    }
    if (currentUrl) safeLoadURL(slot, currentUrl);
    if (incognitoModeEnabled) scheduleNativeIncognitoEnsure(slot, 'toggle');
  });

  console.info(`[Incognito] ${incognitoModeEnabled ? 'enabled' : 'disabled'} for new loads`);
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

  if ((expandedSlot || leftSplitSlot || rightSplitSlot) && e.key === 'Escape') {
    e.preventDefault();
    setExpandedSlot(null);
    setSplitSlot(null);
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

function setStatus(slot, status, options = {}) {
  const el = statuses[slot];
  if (!el) return;
  const temporary = options.temporary === true;

  if (statusTimeouts[slot]) {
    clearTimeout(statusTimeouts[slot]);
    statusTimeouts[slot] = null;
  }

  const meta = window.AggregationControl?.slotStatusMeta
    ? window.AggregationControl.slotStatusMeta(status)
    : { text: status === 'success' ? '\u2713' : status === 'pending' ? '\u23F3' : status === 'error' ? '\u2717' : '', className: `status ${status}`, title: '' };

  el.className = meta.className;
  el.textContent = meta.text;
  el.title = meta.title || '';

  if (temporary) {
    statusTimeouts[slot] = setTimeout(() => {
      const nextStatus = slotAggregationStatuses[slot] || window.AggregationControl?.SLOT_STATUS?.IDLE || 'idle';
      setStatus(slot, nextStatus, { temporary: false });
      statusTimeouts[slot] = null;
    }, 4000);
  }
  reportBackgroundWorkState();
}

function setAggregationSummary(text = '') {
  if (aggregationSummaryDiv) aggregationSummaryDiv.textContent = text;
}

function getSlotDisplayName(slot) {
  return labels[slot]?.textContent?.trim() || slot;
}

function setAggregationSlotStatus(slot, status) {
  slotAggregationStatuses[slot] = status;
  setStatus(slot, status, { temporary: false });
  reportBackgroundWorkState();
}

function resetAggregationSlotStatuses(enabledSlots = SLOTS.filter((slot) => toggles[slot]?.checked)) {
  const idle = window.AggregationControl?.SLOT_STATUS?.IDLE || 'idle';
  SLOTS.forEach((slot) => {
    if (!enabledSlots.includes(slot)) {
      delete slotAggregationStatuses[slot];
      setStatus(slot, idle, { temporary: false });
      return;
    }
    setAggregationSlotStatus(slot, idle);
  });
}

function renderAggregationSummary(enabledSlots = SLOTS.filter((slot) => toggles[slot]?.checked)) {
  const summary = window.AggregationControl?.summarizeStatuses
    ? window.AggregationControl.summarizeStatuses(slotAggregationStatuses, enabledSlots, getSlotDisplayName)
    : '';
  setAggregationSummary(summary || 'Slot aggregation idle');
}

function updateAggregationActionButtons() {
  const hasPending = aggregationControl.hasPendingMerge() || aggregationControl.hasPendingAggregation();
  const canPauseAggregation = !!aggregationControl.pendingAggregation?.waiting || aggregationControl.hasPendingMerge();
  if (pauseAggregationBtn) {
    pauseAggregationBtn.disabled = !hasPending || !canPauseAggregation;
    pauseAggregationBtn.textContent = aggregationControl.paused ? 'Resume aggregation' : 'Pause aggregation';
    pauseAggregationBtn.classList.toggle('active', aggregationControl.paused);
  }
  if (collectNowBtn) {
    const hasEnabledSlots = SLOTS.some((slot) => toggles[slot]?.checked);
    collectNowBtn.disabled = !hasEnabledSlots;
  }
  reportBackgroundWorkState();
}

async function readAggregationStatuses(options = {}) {
  const enabledSlots = SLOTS.filter((slot) => toggles[slot]?.checked);
  const waiting = window.AggregationControl?.SLOT_STATUS?.WAITING || 'waiting';
  const ready = window.AggregationControl?.SLOT_STATUS?.READY || 'ready';
  const paused = window.AggregationControl?.SLOT_STATUS?.PAUSED || 'paused';
  const error = window.AggregationControl?.SLOT_STATUS?.ERROR || 'error';

  const statusesBySlot = {};
  for (const slot of enabledSlots) {
    const webview = webviews[slot];
    if (!webview || !webviewReady[slot]) {
      statusesBySlot[slot] = error;
      continue;
    }
    const serviceId = detectServiceByUrl(getWebviewCurrentUrl(slot)) || slotConfig[slot] || '';
    try {
      const generating = await isSlotStillGenerating(slot, serviceId);
      statusesBySlot[slot] = generating ? waiting : ready;
    } catch (err) {
      console.warn(`[aggregation] status probe failed for ${slot}`, err);
      statusesBySlot[slot] = error;
    }
  }

  enabledSlots.forEach((slot) => {
    const nextStatus = aggregationControl.paused && statusesBySlot[slot] === waiting
      ? paused
      : statusesBySlot[slot];
    setAggregationSlotStatus(slot, nextStatus);
  });
  renderAggregationSummary(enabledSlots);

  if (!options.silent) {
    const readyCount = enabledSlots.filter((slot) => statusesBySlot[slot] === ready).length;
    setMergeStatus(`Aggregation status: ${readyCount}/${enabledSlots.length} ready`, aggregationControl.paused ? 'paused' : 'idle');
  }

  return statusesBySlot;
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
  activeSendCount += 1;
  reportBackgroundWorkState();
  const webview = webviews[slot];
  const selector = normalizeSelectors(getSelectorsForSlot(slot));

  if (!webview || !selector) {
    setStatus(slot, window.AggregationControl?.SLOT_STATUS?.ERROR || 'error', { temporary: true });
    activeSendCount = Math.max(0, activeSendCount - 1);
    reportBackgroundWorkState();
    return;
  }

  setStatus(slot, window.AggregationControl?.SLOT_STATUS?.SENDING || 'pending', { temporary: true });

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

     const diag = { serviceId, steps: [] };

     function snapEl(label, el, value) {
       const NL = String.fromCharCode(10);
       const tc = el ? (el.textContent || '') : '';
       const it = el ? (el.innerText || '') : '';
       const v = String(value || '');
       diag.steps.push({
         step: label,
         tag: el ? el.tagName : null,
         role: el ? (el.getAttribute('role') || '') : null,
         ce: el ? el.isContentEditable : null,
         tc_len: tc.length, tc_nl: tc.split(NL).length - 1,
         it_len: it.length, it_nl: it.split(NL).length - 1,
         val_len: v.length, val_nl: v.split(NL).length - 1
       });
     }

     function pasteIntoContentEditable(el, value) {
       const sel = window.getSelection ? window.getSelection() : null;
       if (sel) {
         try {
           const r = document.createRange();
           r.selectNodeContents(el);
           sel.removeAllRanges();
           sel.addRange(r);
         } catch (_) {}
       }

       const dt = new DataTransfer();
       dt.setData('text/plain', value);
       el.dispatchEvent(new ClipboardEvent('paste', {
         bubbles: true,
         cancelable: true,
         clipboardData: dt
       }));
     }

     function fillInput(el, value) {
       el.focus();
       snapEl('before-fill', el, value);

       if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
         setNativeValue(el, value);
         dispatchInputEvents(el, value);
         snapEl('after-fill-textarea', el, value);
         return;
       }

       if (el.isContentEditable) {
         const hasNewline = String(value || '').includes(String.fromCharCode(10));
         if (serviceId === 'gemini' || !hasNewline) {
           el.textContent = value;
           dispatchInputEvents(el, value);
           snapEl(serviceId === 'gemini' ? 'after-fill-ce-gemini-legacy' : 'after-fill-ce-plain', el, value);
           return;
         }

         try {
           pasteIntoContentEditable(el, value);
           snapEl('after-fill-ce-paste', el, value);
         } catch (_) {
           el.textContent = value;
           dispatchInputEvents(el, value);
           snapEl('after-fill-ce-paste-fallback', el, value);
         }
         return;
       }

       el.textContent = value;
       dispatchInputEvents(el, value);
       snapEl('after-fill-generic', el, value);
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
       return { success: false, error: 'Input not found', diag };
     }
     snapEl('input-found', inputEl, message);

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
       return { success: true, diag };
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
     return { success: sent, diag };
   })();
 `;

  try {
    let result;
    try {
      result = await webview.executeJavaScript(code);
      if (debugModeToggle?.checked) {
        console.log(`[${slot}] send-diag:`, JSON.stringify(result?.diag || {}));
        mergeLog(`${slot} send diagnostic`, 'info', result?.diag || {});
      }
      if (!result || !result.success) {
        throw new Error("First attempt failed");
      }
    } catch (err) {
      console.warn("[" + slot + "] Retry sending...");
      await new Promise(r => setTimeout(r, 1000));
      result = await webview.executeJavaScript(code);
      if (debugModeToggle?.checked) {
        console.log(`[${slot}] send-diag (retry):`, JSON.stringify(result?.diag || {}));
        mergeLog(`${slot} send diagnostic retry`, 'info', result?.diag || {});
      }
    }

    if (result && result.success === false) {
      console.error(`[${slot}] Error:`, result.error, debugModeToggle?.checked ? `| diag: ${JSON.stringify(result?.diag || {})}` : '');
      setStatus(slot, window.AggregationControl?.SLOT_STATUS?.ERROR || 'error', { temporary: true });
    } else {
      setStatus(slot, window.AggregationControl?.SLOT_STATUS?.SENT || 'success', { temporary: true });
    }
  } catch (error) {
    console.error(`[${slot}] Exception:`, error);
    setStatus(slot, window.AggregationControl?.SLOT_STATUS?.ERROR || 'error', { temporary: true });
  } finally {
    activeSendCount = Math.max(0, activeSendCount - 1);
    reportBackgroundWorkState();
  }
}

async function sendToAll() {
  const text = (messageInput.value || '').replace(/\r\n/g, '\n');

  if (!text.trim()) {
    alert('Please enter a message');
    return;
  }

  if (window.mergeApiClient) {
    window.mergeApiClient.lastSourcePrompt = text;
  }
  activeSessionPrompt = text;

  const traceId = startIngestTrace();
  mergeLog(`Ingest trace started: ${traceId}`, 'info');
  activeAggregatedNoteId = null;

  const enabledSlots = SLOTS.filter(slot => toggles[slot] && toggles[slot].checked);
  const sessionFingerprint = buildSessionFingerprint(enabledSlots);
  activeSessionFingerprint = sessionFingerprint;
  const storedContext = restoreStoredQuestionContextForFingerprint(sessionFingerprint);
  const sessionIdHint = Number.isInteger(activeSessionId) && activeSessionId > 0
    ? activeSessionId
    : (storedContext?.session_id || null);
  const restoredNoteId = String(activeAggregatedNoteId || storedContext?.aggregated_note_id || '').trim() || null;
  const restoredPrompt = String(storedContext?.source_prompt || '').trim();
  const sameQuestionAsRestored = !!restoredNoteId
    && promptsReferToSameQuestion(text, restoredPrompt);

  if (Number.isInteger(sessionIdHint) && sessionIdHint > 0) {
    if (sessionFingerprint) {
      persistSessionContext(sessionIdHint, sessionFingerprint, restoredNoteId, storedContext?.source_prompt || activeSessionPrompt || null);
    } else {
      activeSessionId = sessionIdHint;
      activeAggregatedNoteId = restoredNoteId;
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
  resizeMessageInput();
  messageInput.focus();

  // Local-only parity: when signed out we make zero backend calls, so the
  // ingest/aggregation path (which would throw NotSignedInError) is skipped and
  // we persist the session snapshot locally on send — mirrors the iOS/Android
  // saveLocalSession-on-send behaviour.
  try {
    const authStatus = await window.electronAPI?.authGetStatus?.();
    if (!authStatus?.signedIn) {
      const localId = Number.isInteger(activeSessionId) && activeSessionId > 0
        ? activeSessionId
        : getNextLocalSessionId();
      activeSessionId = localId;
      setIngestSessionIndicator(localId);
      const localName = text.trim().slice(0, 60) || undefined;
      await saveSessionSnapshot(localName, localId, null);
      mergeLog(`Signed out — saved session ${localId} locally, skipping ingest`, 'info');
      return;
    }
  } catch (e) {
    mergeLog(`Local session save (signed out) failed: ${e?.message || e}`, 'warn');
    return;
  }

  const pendingAggregation = {
    sourcePrompt: text,
    expectedSlotCount: enabledSlots.length,
    waiting: true,
    forceNewRoot: !sameQuestionAsRestored,
    allowOverwriteExisting: sameQuestionAsRestored,
    ingestContext: {
      sessionFingerprint,
      sessionIdHint
    },
    aggregatedNoteId: sameQuestionAsRestored ? restoredNoteId : null,
    runId: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  };
  aggregationControl.beginPendingAggregation(pendingAggregation);
  resetAggregationSlotStatuses(enabledSlots);
  enabledSlots.forEach((slot) => setAggregationSlotStatus(slot, window.AggregationControl?.SLOT_STATUS?.WAITING || 'waiting'));
  renderAggregationSummary(enabledSlots);
  updateAggregationActionButtons();
  mergeLog(`Aggregation armed for ${enabledSlots.length} slot(s)`, 'info', pendingAggregation);

  ingestAfterSlotsPolling(text, enabledSlots.length, {
    sessionFingerprint,
    sessionIdHint
  }, pendingAggregation.runId).catch((error) => {
    mergeLog(`Ingest polling failed: ${error?.message || error}`, 'error');
  });
}

sendBtn.addEventListener('click', sendToAll);

messageInput?.addEventListener('input', resizeMessageInput);

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
  aggregationSummaryDiv = document.getElementById('aggregation-status-summary');
  pauseAggregationBtn = document.getElementById('pause-aggregation-btn');
  collectNowBtn = document.getElementById('collect-now-btn');
  refreshAggregationBtn = document.getElementById('refresh-aggregation-btn');
  debugLogDiv = document.getElementById('merge-debug-log');
  debugClearBtn = document.getElementById('debug-clear-btn');
  debugModeToggle = document.getElementById('debug-mode-toggle');

  // Only wire up if panel elements exist
  if (!runMergeBtn) return;

  // Hook client log G�� debug panel
  if (window.mergeApiClient) {
    window.mergeApiClient.onLog = (msg, type, detail) => mergeLog(msg, type, detail);
  }

  loadMergeConfig();
  maybeShowMergeSetupHint(true);
  resetAggregationSlotStatuses();
  renderAggregationSummary();
  updateAggregationActionButtons();

  runMergeBtn.addEventListener('click', () => runMerge(false, '', ''));
  pauseAggregationBtn?.addEventListener('click', async () => {
    const hasPendingAggregation = aggregationControl.hasPendingAggregation();
    const hasPendingMerge = aggregationControl.hasPendingMerge();
    if (!hasPendingAggregation && !hasPendingMerge) return;
    if (aggregationControl.paused) {
      aggregationControl.resume();
      updateAggregationActionButtons();
      setMergeStatus('Resuming aggregation...', 'running');
      mergeLog('Aggregation resumed', 'info');
      if (hasPendingAggregation) {
        const pendingAggregation = aggregationControl.pendingAggregation;
        if (pendingAggregation) {
          ingestAfterSlotsPolling(
            pendingAggregation.sourcePrompt,
            pendingAggregation.expectedSlotCount,
            pendingAggregation.ingestContext,
            pendingAggregation.runId
          ).catch((error) => {
            mergeLog(`Aggregation resume failed: ${error?.message || error}`, 'error');
          });
        }
        return;
      }
      const ready = await waitForAggregationReadyOrPause();
      if (ready) {
        await collectAndMaybeRunPendingMerge(false);
      }
      return;
    }
    aggregationControl.pause();
    updateAggregationActionButtons();
    await readAggregationStatuses({ silent: true });
    setMergeStatus('Aggregation paused. Fix slots and press Resume or Collect now.', 'paused');
  });
  collectNowBtn?.addEventListener('click', async () => {
    activateConfigTab('debug');
    const enabledSlots = SLOTS.filter((slot) => toggles[slot]?.checked);
    mergeLog('Collect now button clicked', 'info', {
      hasPendingAggregation: aggregationControl.hasPendingAggregation(),
      hasPendingMerge: aggregationControl.hasPendingMerge(),
      enabledSlots,
      activeSessionId: activeSessionId || null,
      activeAggregatedNoteId: activeAggregatedNoteId || null,
      lastSourcePrompt: String(window.mergeApiClient?.lastSourcePrompt || '').trim() || null,
      activeSessionPrompt: activeSessionPrompt || null
    });

    if (enabledSlots.length === 0) {
      mergeLog('Collect now ignored: no enabled slots', 'warn');
      setMergeStatus('Nothing to collect. Enable at least one slot first.', 'warn');
      return;
    }

    if (aggregationControl.hasPendingAggregation() || String(window.mergeApiClient?.lastSourcePrompt || activeSessionPrompt || '').trim() || (activeSessionId && activeAggregatedNoteId)) {
      await collectNowAggregation(true);
      return;
    }

    if (!aggregationControl.hasPendingMerge()) {
      mergeLog('Collect now proceeding without prior session context; will create a session directly from open chats', 'info');
      await collectNowAggregation(true);
      return;
    }

    await collectAndMaybeRunPendingMerge(true);
  });
  refreshAggregationBtn?.addEventListener('click', async () => {
    await readAggregationStatuses();
  });

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

  if (debugModeToggle) {
    debugModeToggle.checked = localStorage.getItem(DEBUG_MODE_STATE_KEY) === 'true';
    debugModeToggle.addEventListener('change', () => {
      localStorage.setItem(DEBUG_MODE_STATE_KEY, debugModeToggle.checked ? 'true' : 'false');
      mergeLog(`Debug mode ${debugModeToggle.checked ? 'enabled' : 'disabled'}`, 'info');
    });
  }

  // ---- Config Tabs ----
  const tabsBody = document.getElementById('config-tabs-body');
  const tabsCollapseBtn = document.getElementById('config-tabs-collapse');
  // Always start collapsed; user can expand manually during the session.
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

  function activateConfigTab(tab) {
    document.querySelectorAll('.cfg-tab').forEach(b => b.classList.remove('active'));
    document.querySelector(`.cfg-tab[data-tab="${tab}"]`)?.classList.add('active');
    document.querySelectorAll('.cfg-tab-pane').forEach(p => p.classList.remove('active'));
    document.getElementById(`cfg-pane-${tab}`)?.classList.add('active');
    if (tabsCollapsed) {
      tabsCollapsed = false;
      localStorage.setItem('cfg-tabs-collapsed', 'false');
      applyTabsCollapsed();
    }
    localStorage.setItem('cfg-tabs-active', tab);
    if (tab === 'sessions') {
      updateSessionsUI({ forceRefresh: true }).catch(err => console.warn('[sessions] refresh failed:', err));
    }
    if (tab === 'account') {
      refreshAccountUI().catch(err => console.warn('[account] status refresh failed:', err));
    }
  }

  document.querySelectorAll('.cfg-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activateConfigTab(btn.dataset.tab);
    });
  });

  initAccountTab();

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

// ========== ACCOUNT (multi-user auth) ==========
async function refreshAccountUI() {
  const signedOut = document.getElementById('account-signed-out');
  const signedIn = document.getElementById('account-signed-in');
  const emailDisplay = document.getElementById('account-email-display');
  if (!signedOut || !signedIn) return;
  let status = { signedIn: false };
  try {
    status = await window.electronAPI.authGetStatus();
  } catch (err) {
    console.warn('[account] status failed:', err);
  }
  if (status?.signedIn) {
    signedOut.style.display = 'none';
    signedIn.style.display = 'block';
    if (emailDisplay) emailDisplay.textContent = status.email || '(signed in)';
  } else {
    signedOut.style.display = 'block';
    signedIn.style.display = 'none';
  }
}

function setAccountMsg(text, isError = true) {
  const el = document.getElementById('account-status-msg');
  if (!el) return;
  el.style.color = isError ? '#c66' : '#6a6';
  el.textContent = text || '';
}

function initAccountTab() {
  const signInBtn = document.getElementById('account-signin-btn');
  const signOutBtn = document.getElementById('account-signout-btn');
  if (signInBtn && !signInBtn.dataset.wired) {
    signInBtn.dataset.wired = '1';
    signInBtn.addEventListener('click', async () => {
      const email = document.getElementById('account-email')?.value || '';
      const password = document.getElementById('account-password')?.value || '';
      if (!email || !password) { setAccountMsg('Enter email and password.'); return; }
      signInBtn.disabled = true;
      setAccountMsg('Signing in…', false);
      try {
        const res = await window.electronAPI.authSignIn(email, password);
        if (res?.ok) {
          setAccountMsg('', false);
          const pw = document.getElementById('account-password');
          if (pw) pw.value = '';
          await refreshAccountUI();
          await migrateLocalSessionsOnLogin().catch((e) =>
            console.error('[account sign-in] local session migration failed:', e));
        } else {
          setAccountMsg(res?.error || 'Sign-in failed.');
        }
      } catch (err) {
        setAccountMsg(err?.message || 'Sign-in error.');
      } finally {
        signInBtn.disabled = false;
      }
    });
  }
  if (signOutBtn && !signOutBtn.dataset.wired) {
    signOutBtn.dataset.wired = '1';
    signOutBtn.addEventListener('click', async () => {
      signOutBtn.disabled = true;
      try {
        await window.electronAPI.authSignOut();
        await refreshAccountUI();
      } catch (err) {
        setAccountMsg(err?.message || 'Sign-out error.');
      } finally {
        signOutBtn.disabled = false;
      }
    });
  }
  refreshAccountUI().catch(() => {});
}

// ========== FIRST-RUN ONBOARDING (local vs sign in) ==========
const ONBOARD_DONE_KEY = 'verity-onboard-done';
const APP_MODE_KEY = 'verity-mode'; // 'account' | 'local'

function hideOnboardModal() {
  const m = document.getElementById('onboard-modal');
  if (!m) return;
  m.classList.remove('visible');
  m.setAttribute('aria-hidden', 'true');
}

function finishOnboarding(mode) {
  localStorage.setItem(APP_MODE_KEY, mode);
  localStorage.setItem(ONBOARD_DONE_KEY, '1');
  hideOnboardModal();
}

async function initOnboarding() {
  const modal = document.getElementById('onboard-modal');
  if (!modal) return;

  // Already chosen, or already signed in from a previous run → skip.
  if (localStorage.getItem(ONBOARD_DONE_KEY)) return;
  try {
    const status = await window.electronAPI.authGetStatus();
    if (status?.signedIn) { finishOnboarding('account'); return; }
  } catch (_) {}

  const choices = document.getElementById('onboard-choices');
  const loginBox = document.getElementById('onboard-login');
  const msg = document.getElementById('onboard-status-msg');
  const setMsg = (t, err = true) => { if (msg) { msg.style.color = err ? '#c66' : '#6a6'; msg.textContent = t || ''; } };

  document.getElementById('onboard-signin-choice')?.addEventListener('click', () => {
    if (choices) choices.style.display = 'none';
    if (loginBox) loginBox.style.display = 'block';
    setMsg('');
  });
  document.getElementById('onboard-login-back')?.addEventListener('click', () => {
    if (loginBox) loginBox.style.display = 'none';
    if (choices) choices.style.display = 'flex';
    setMsg('');
  });
  document.getElementById('onboard-local-choice')?.addEventListener('click', () => {
    finishOnboarding('local');
  });
  document.getElementById('onboard-login-submit')?.addEventListener('click', async () => {
    const email = document.getElementById('onboard-email')?.value || '';
    const password = document.getElementById('onboard-password')?.value || '';
    if (!email || !password) { setMsg('Enter email and password.'); return; }
    const btn = document.getElementById('onboard-login-submit');
    if (btn) btn.disabled = true;
    setMsg('Signing in…', false);
    try {
      const res = await window.electronAPI.authSignIn(email, password);
      if (res?.ok) {
        finishOnboarding('account');
        refreshAccountUI().catch(() => {});
        migrateLocalSessionsOnLogin().catch((e) =>
          console.error('[onboarding sign-in] local session migration failed:', e));
      } else {
        setMsg(res?.error || 'Sign-in failed.');
      }
    } catch (err) {
      setMsg(err?.message || 'Sign-in error.');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  modal.classList.add('visible');
  modal.setAttribute('aria-hidden', 'false');
}

// Initialize merge panel after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initMergePanel(); initOnboarding(); });
} else {
  initMergePanel();
  initOnboarding();
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
    const MAX_HTML_SNAPSHOT_CHARS = 1500000;
    const MAX_NODE_HTML_CHARS = 250000;

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

    function normalizeInlineText(t) {
      return String(t || '')
        .replace(/\\r/g, '')
        .replace(/\\u00a0/g, ' ')
        .replace(/[ \\t]+/g, ' ')
        .trim();
    }

    function truncateHtml(value, limit) {
      const text = String(value || '');
      if (text.length <= limit) return text;
      return text.slice(0, limit) + '\\n<!-- truncated -->';
    }

    function safeOuterHtml(el, limit = MAX_NODE_HTML_CHARS) {
      if (!el || typeof el.outerHTML !== 'string') return '';
      return truncateHtml(el.outerHTML, limit);
    }

    function normalizeMathText(value) {
      return String(value || '')
        .replace(/\\text\{([^}]*)\}/g, '$1')
        .replace(/\\circ/g, '�')
        .replace(/\\pm/g, '�')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function shouldSkipElement(el) {
      if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
      const tag = (el.tagName || '').toUpperCase();
      if (['BUTTON', 'SVG', 'PATH', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'MAT-ICON'].includes(tag)) return true;
      if (el.getAttribute('aria-hidden') === 'true') return true;
      const className = String(el.className || '');
      return /table-footer|action-button|copy-button|buttons-container|response-container-header|response-container-footer/i.test(className)
        || !!el.closest('.table-footer, [hide-from-message-actions]');
    }

    function extractInlineText(node) {
      if (!node) return '';
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const el = node;
      if (shouldSkipElement(el)) return '';
      if (el.classList?.contains('math-inline') || el.classList?.contains('katex') || (el.tagName || '').toUpperCase() === 'MATH') {
        const math = el.getAttribute('data-math')
          || el.querySelector?.('annotation[encoding="application/x-tex"]')?.textContent
          || el.querySelector?.('annotation')?.textContent;
        if (math) return normalizeMathText(math);
      }
      const tag = (el.tagName || '').toUpperCase();
      if (tag === 'BR') return '\\n';
      if (tag === 'STRONG' || tag === 'B') return '**' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '**';
      if (tag === 'EM' || tag === 'I') return '*' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '*';
      if (tag === 'CODE' && !el.closest('pre')) return '\`' + Array.from(el.childNodes || []).map(extractInlineText).join('') + '\`';
      if (tag === 'P') return Array.from(el.childNodes || []).map(extractInlineText).join('');
      return Array.from(el.childNodes || []).map(extractInlineText).join('');
    }

    function tableToMarkdown(tableEl) {
      const rows = Array.from(tableEl.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => normalizeInlineText(extractInlineText(cell))))
        .filter((row) => row.some((cell) => cell.length > 0));
      if (rows.length < 2) return '';
      const colCount = rows.reduce((acc, row) => Math.max(acc, row.length), 0);
      if (colCount < 2) return '';

      const esc = (value) => String(value || '').replace(/\\|/g, '\\\\|');
      const pad = (row) => {
        const out = row.slice(0, colCount);
        while (out.length < colCount) out.push('');
        return out;
      };

      const header = pad(rows[0]);
      const body = rows.slice(1).map(pad);
      const sep = Array(colCount).fill('---');

      const lines = [];
      lines.push('| ' + header.map(esc).join(' | ') + ' |');
      lines.push('| ' + sep.join(' | ') + ' |');
      body.forEach((row) => lines.push('| ' + row.map(esc).join(' | ') + ' |'));
      return lines.join('\\n');
    }

    function extractStructuredText(rootEl) {
      if (!rootEl) return '';
      const parts = [];
      const blockTags = new Set([
        'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FIGCAPTION', 'FIGURE',
        'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV',
        'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR', 'UL'
      ]);

      function pushNewline() {
        const last = parts.length > 0 ? parts[parts.length - 1] : '';
        if (!String(last).endsWith('\\n')) parts.push('\\n');
      }

      function walk(node) {
        if (!node) return;
        if (node.nodeType === Node.TEXT_NODE) {
          parts.push(node.textContent || '');
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node;
        if (shouldSkipElement(el)) return;
        if (el !== rootEl && !visible(el)) return;

        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'BR') {
          parts.push('\\n');
          return;
        }
        if (tag === 'TABLE') {
          const md = tableToMarkdown(el);
          if (md) {
            pushNewline();
            parts.push(md);
            parts.push('\\n');
            return;
          }
        }
        if (tag === 'STRONG' || tag === 'B') {
          parts.push('**');
          Array.from(el.childNodes || []).forEach(walk);
          parts.push('**');
          return;
        }
        if (tag === 'EM' || tag === 'I') {
          parts.push('*');
          Array.from(el.childNodes || []).forEach(walk);
          parts.push('*');
          return;
        }
        if (tag === 'CODE' && !el.closest('pre')) {
          parts.push('\`');
          Array.from(el.childNodes || []).forEach(walk);
          parts.push('\`');
          return;
        }
        if (tag === 'PRE') {
          pushNewline();
          const codeEl = el.querySelector('code');
          const lang = (codeEl?.className || '').match(/language-(\\w+)/)?.[1] || '';
          parts.push('\`\`\`' + lang + '\\n');
          Array.from((codeEl || el).childNodes || []).forEach(walk);
          if (!String(parts[parts.length - 1]).endsWith('\\n')) parts.push('\\n');
          parts.push('\`\`\`');
          pushNewline();
          return;
        }
        const headingMatch = tag.match(/^H([1-6])$/);
        if (headingMatch) {
          pushNewline();
          parts.push('#'.repeat(parseInt(headingMatch[1], 10)) + ' ');
          Array.from(el.childNodes || []).forEach(walk);
          pushNewline();
          return;
        }
        if (tag === 'LI') {
          pushNewline();
          let depth = 0;
          let parent = el.parentElement;
          while (parent) {
            const parentTag = (parent.tagName || '').toUpperCase();
            if (parentTag === 'UL' || parentTag === 'OL') depth += 1;
            if (parent === rootEl) break;
            parent = parent.parentElement;
          }
          const indent = '  '.repeat(Math.max(0, depth - 1));
          const parentTag = (el.parentElement?.tagName || '').toUpperCase();
          parts.push(indent);
          if (parentTag === 'OL') {
            const idx = Array.from(el.parentElement.children).indexOf(el) + 1;
            parts.push(idx + '. ');
          } else {
            parts.push('- ');
          }
          const nestedLists = [];
          const inlineSegments = [];
          Array.from(el.childNodes || []).forEach((child) => {
            if (child?.nodeType === Node.ELEMENT_NODE) {
              const childTag = (child.tagName || '').toUpperCase();
              if (childTag === 'UL' || childTag === 'OL') {
                nestedLists.push(child);
                return;
              }
            }
            const segment = extractInlineText(child);
            if (segment) inlineSegments.push(segment);
          });
          parts.push(inlineSegments.join('').trim());
          pushNewline();
          nestedLists.forEach((child) => walk(child));
          return;
        }

        const isBlock = blockTags.has(tag);
        if (isBlock) pushNewline();
        Array.from(el.childNodes || []).forEach(walk);
        if (isBlock) pushNewline();
      }

      walk(rootEl);
      const structured = normalizeText(parts.join(''));
      if (structured) return structured;
      return normalizeText(rootEl.innerText || rootEl.textContent);
    }

    function flatText(t) {
      return normalizeInlineText(t).replace(/\\n+/g, ' ').replace(/\\s+/g, ' ').trim();
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

    function countMatches(text, regex) {
      const match = String(text || '').match(regex);
      return match ? match.length : 0;
    }

    function computeStructureMetrics(raw) {
      const text = String(raw || '');
      const lines = text.split('\\n');
      return {
        headingCount: countMatches(text, /^#{1,6}\\s+/gm),
        unorderedCount: countMatches(text, /^\\s*[-*+]\\s+\\S/gm),
        orderedCount: countMatches(text, /^\\s*\\d+[.)]\\s+\\S/gm),
        tableLineCount: countMatches(text, /^\\|.*\\|$/gm),
        codeFenceCount: countMatches(text, /^\`\`\`/gm),
        blankLineCount: countMatches(text, /^\\s*$/gm),
        lineCount: lines.filter((line) => line.trim().length > 0).length
      };
    }

    function structureScore(metrics) {
      return (
        metrics.headingCount * 30 +
        metrics.unorderedCount * 12 +
        metrics.orderedCount * 12 +
        metrics.tableLineCount * 8 +
        metrics.codeFenceCount * 16 +
        metrics.blankLineCount * 2 +
        metrics.lineCount
      );
    }

    function isFragmentOnly(metrics, flatLength) {
      const hasSingleTable = metrics.tableLineCount >= 2 && metrics.lineCount <= metrics.tableLineCount + 1;
      const hasSingleList = (metrics.unorderedCount + metrics.orderedCount) > 0 && metrics.lineCount <= (metrics.unorderedCount + metrics.orderedCount) + 1;
      const hasSingleCode = metrics.codeFenceCount >= 2 && metrics.lineCount <= 4;
      return flatLength < 1200 && (hasSingleTable || hasSingleList || hasSingleCode);
    }

    function summarizeCandidate(candidate, selectorHint = '', extra = {}) {
      return {
        selector_hint: selectorHint,
        tag: candidate.el?.tagName || '',
        class_name: candidate.el?.className || '',
        top: Math.round(candidate.top || 0),
        bottom: Math.round(candidate.bottom || 0),
        flat_length: candidate.flat.length,
        raw_length: candidate.raw.length,
        structure: candidate.structure,
        metrics: candidate.metrics,
        fragment_only: isFragmentOnly(candidate.metrics, candidate.flat.length),
        preview: candidate.flat.slice(0, 240),
        ...extra
      };
    }

    function findNearestPromptCandidate(selectedCandidate) {
      if (!selectedCandidate?.el) return null;
      const userSelectors = [
        '[data-message-author-role="user"]',
        '[data-testid*="user"]',
        '[class*="user"][class*="message"]',
        '[class*="query"]',
        '[class*="request"]',
        'user-query'
      ];

      const candidates = [];
      const seen = new Set();
      userSelectors.forEach((sel) => {
        try {
          document.querySelectorAll(sel).forEach((el) => {
            if (seen.has(el)) return;
            seen.add(el);
            if (!visible(el)) return;
            if (isComposerElement(el)) return;
            const relation = el.compareDocumentPosition(selectedCandidate.el);
            if (!(relation & Node.DOCUMENT_POSITION_FOLLOWING)) return;
            const raw = extractStructuredText(el);
            const flat = flatText(raw);
            if (flat.length < 6 || isMetadataLikeText(flat)) return;
            const rect = el.getBoundingClientRect();
            candidates.push({
              el,
              raw,
              flat,
              top: rect.top,
              bottom: rect.bottom
            });
          });
        } catch (_) {}
      });

      if (candidates.length === 0) return null;

      candidates.sort((a, b) => {
        const aDistance = Math.abs((selectedCandidate.top || 0) - a.bottom);
        const bDistance = Math.abs((selectedCandidate.top || 0) - b.bottom);
        if (aDistance !== bDistance) return aDistance - bDistance;
        if (b.bottom !== a.bottom) return b.bottom - a.bottom;
        return b.flat.length - a.flat.length;
      });

      return candidates[0];
    }

    function isRejectedServiceCandidate(el) {
      if (serviceId !== 'grok' || !el) return false;

      // Grok aligns user turns to the right (items-end) and assistant turns
      // to the left (items-start). Its generic response wrappers can
      // match both, so reject the user-side bubble before ranking.
      let node = el;
      for (let depth = 0; node && depth < 6; depth += 1, node = node.parentElement) {
        const className = String(node.className || '').toLowerCase();
        if (className.includes('items-start')) return false;
        if (className.includes('items-end')) return true;
      }
      return false;
    }

    const selectorEntries = [
      ['[data-testid*="conversation-turn"]', '[data-testid*="conversation-turn"]'],
      ['[data-testid*="message-content"]', '[data-testid*="message-content"]'],
      ['[data-message-author-role="assistant"]', '[data-message-author-role="assistant"]'],
      ['[data-testid*="assistant"]', '[data-testid*="assistant"]'],
      ['[class*="assistant"]', '[class*="assistant"]'],
      ['[class*="response"]', '[class*="response"]'],
      ['[class*="answer"]', '[class*="answer"]'],
      ['[class*="message"]', '[class*="message"]']
    ];

    if (serviceId === 'perplexity') selectorEntries.unshift(['div[class*="prose"]', 'div[class*="prose"]']);
    if (serviceId === 'gemini') selectorEntries.unshift(['response-container', 'response-container'], ['model-response', 'model-response']);
    if (serviceId === 'grok') selectorEntries.unshift(['[class*="message-bubble"]', '[class*="message-bubble"]'], ['div[id^="response-"]', 'div[id^="response-"]']);

    const candidates = [];
    selectorEntries.forEach(([sel, hint]) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!visible(el)) return;
          if (isComposerElement(el)) return;
          if (isRejectedServiceCandidate(el)) return;
          const raw = extractStructuredText(el);
          const flat = flatText(raw);
          if (flat.length < 20 || isMetadataLikeText(flat)) return;
          const rect = el.getBoundingClientRect();
          const metrics = computeStructureMetrics(raw);
          candidates.push({
            el,
            raw,
            flat,
            bottom: rect.bottom,
            top: rect.top,
            metrics,
            structure: structureScore(metrics),
            selectorHint: hint
          });
        });
      } catch (_) {}
    });

    if (candidates.length === 0) {
      Array.from(document.querySelectorAll('article, div')).filter(visible).forEach((el) => {
        if (isComposerElement(el)) return;
        if (isRejectedServiceCandidate(el)) return;
        const raw = extractStructuredText(el);
        const flat = flatText(raw);
        if (flat.length < 20 || isMetadataLikeText(flat)) return;
        const rect = el.getBoundingClientRect();
        const metrics = computeStructureMetrics(raw);
        candidates.push({
          el,
          raw,
          flat,
          bottom: rect.bottom,
          top: rect.top,
          metrics,
          structure: structureScore(metrics),
          selectorHint: 'article,div:fallback'
        });
      });
    }

    if (candidates.length === 0) {
      return {
        raw: null,
        diagnostics: {
          service_id: serviceId,
          page_url: location.href,
          document_title: document.title || '',
          candidate_count: 0,
          pruned_count: 0,
          pool_count: 0,
          no_candidate_reason: 'no-candidates',
          candidates: [],
          selected: null,
          selected_html: '',
          parent_html: '',
          page_html: truncateHtml(document.documentElement?.outerHTML || '', MAX_HTML_SNAPSHOT_CHARS)
        }
      };
    }

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
    const nearBottom = source.filter((c) => c.bottom >= maxBottom - 260);
    const pool = nearBottom.length > 0 ? nearBottom : source;

    const ranked = pool.map((candidate) => {
      const childPeers = pool.filter((other) => {
        if (other === candidate) return false;
        if (!candidate.el.contains(other.el)) return false;
        if (other.flat.length < 40) return false;
        return Math.abs(other.bottom - candidate.bottom) <= 260;
      });
      const containsPeer = childPeers.length > 0;
      const fragmentOnly = isFragmentOnly(candidate.metrics, candidate.flat.length);
      const hasRicherChild = childPeers.some((other) => other.structure >= candidate.structure + 20);
      const richerParent = pool.find((other) => {
        if (other === candidate) return false;
        if (!other.el.contains(candidate.el)) return false;
        if (other.flat.length < candidate.flat.length * 1.35) return false;
        return other.structure >= candidate.structure;
      });
      return { candidate, containsPeer, fragmentOnly, hasRicherChild, richerParent };
    });

    ranked.sort((a, b) => {
      if (a.fragmentOnly !== b.fragmentOnly) return a.fragmentOnly ? 1 : -1;
      if (!!a.richerParent !== !!b.richerParent) return a.richerParent ? 1 : -1;
      if (a.hasRicherChild !== b.hasRicherChild) return a.hasRicherChild ? 1 : -1;
      if (b.candidate.structure !== a.candidate.structure) return b.candidate.structure - a.candidate.structure;
      if (b.candidate.flat.length !== a.candidate.flat.length) return b.candidate.flat.length - a.candidate.flat.length;
      if (b.candidate.bottom !== a.candidate.bottom) return b.candidate.bottom - a.candidate.bottom;
      if (b.candidate.top !== a.candidate.top) return b.candidate.top - a.candidate.top;
      if (a.containsPeer !== b.containsPeer) return a.containsPeer ? 1 : -1;
      return 0;
    });

    const selectedWrapped = ranked[0];
    const selected = selectedWrapped.candidate;
    const promptCandidate = findNearestPromptCandidate(selected);
    const candidateDiagnostics = ranked.slice(0, 12).map((entry, index) =>
      summarizeCandidate(entry.candidate, entry.candidate.selectorHint, {
        rank: index + 1,
        contains_peer: entry.containsPeer,
        has_richer_child: entry.hasRicherChild,
        richer_parent: !!entry.richerParent
      })
    );

    return {
      raw: selected.raw,
      diagnostics: {
        service_id: serviceId,
        page_url: location.href,
        document_title: document.title || '',
        candidate_count: candidates.length,
        pruned_count: source.length,
        pool_count: pool.length,
        fallback_used: pruned.length === 0,
        selected: summarizeCandidate(selected, selected.selectorHint, {
          html_length: (selected.el?.outerHTML || '').length,
          parent_html_length: (selected.el?.parentElement?.outerHTML || '').length
        }),
        prompt_candidate: promptCandidate ? {
          text: promptCandidate.flat,
          top: Math.round(promptCandidate.top || 0),
          bottom: Math.round(promptCandidate.bottom || 0),
          html_length: (promptCandidate.el?.outerHTML || '').length
        } : null,
        candidates: candidateDiagnostics,
        selected_html: safeOuterHtml(selected.el),
        parent_html: safeOuterHtml(selected.el?.parentElement),
        page_html: truncateHtml(document.documentElement?.outerHTML || '', MAX_HTML_SNAPSHOT_CHARS)
      }
    };

  } catch (e) {
    return {
      raw: null,
      diagnostics: {
        service_id: ${JSON.stringify(serviceId)},
        page_url: location.href,
        document_title: document.title || '',
        no_candidate_reason: e?.message || String(e || 'unknown-error'),
        candidates: [],
        selected: null,
        selected_html: '',
        parent_html: '',
        page_html: ''
      }
    };
  }
})();
`;

  try {
    const result = await webview.executeJavaScript(code);
    const diagnostics = result?.diagnostics && typeof result.diagnostics === 'object'
      ? result.diagnostics
      : null;
    lastDomScrapeDebugBySlot.set(slot, diagnostics);
    return {
      raw: typeof result?.raw === 'string' ? result.raw : '',
      diagnostics
    };
  } catch (e) {
    console.error(`[${slot}] Failed to scrape reply:`, e);
    const diagnostics = {
      service_id: serviceId,
      page_url: currentUrl,
      document_title: '',
      no_candidate_reason: e?.message || String(e || 'executeJavaScript failed'),
      candidates: [],
      selected: null,
      selected_html: '',
      parent_html: '',
      page_html: ''
    };
    lastDomScrapeDebugBySlot.set(slot, diagnostics);
    return { raw: '', diagnostics };
  }
}

function rememberResolvedSourcePrompt(prompt) {
  const normalized = String(prompt || '').trim();
  if (!normalized) return '';
  activeSessionPrompt = normalized;
  if (window.mergeApiClient) {
    window.mergeApiClient.lastSourcePrompt = normalized;
  }
  return normalized;
}

function normalizeCollectedPromptCandidate(value) {
  return String(value || '')
    .replace(/^\s*(?:you said|you asked|user(?: asked| said)?|вы сказали|ты спросил[аи]?)\s*[:\-]?\s*/i, '')
    .replace(/\s*##\s*(?:chatgpt|gemini|claude|grok|perplexity)\s+said\b[\s\S]*$/i, '')
    .replace(/\s*(?:chatgpt|gemini|claude|grok|perplexity)\s+said\b[\s\S]*$/i, '')
    .replace(/^[#>*\s"'`]+/, '')
    .replace(/[\s"'`]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveSourcePromptFromCollectedScrape(scrapeMeta = [], options = {}) {
  const allowDirectFallback = options?.allowDirectFallback !== false;
  const persist = options?.persist !== false;
  const direct = allowDirectFallback
    ? String(window.mergeApiClient?.lastSourcePrompt || activeSessionPrompt || '').trim()
    : '';
  if (direct) return direct;

  const promptEntries = (Array.isArray(scrapeMeta) ? scrapeMeta : [])
    .map((item) => {
      const rawPrompt = String(item?.dom_diagnostics?.prompt_candidate?.text || '').trim();
      const prompt = normalizeCollectedPromptCandidate(rawPrompt);
      if (!prompt) return null;
      const preview = String(item?.dom_diagnostics?.selected?.preview || '').trim();
      const normalizedPreview = String(preview || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const normalizedPrompt = prompt.toLowerCase();
      let score = 0;
      if (prompt) score += 100;
      if (normalizedPreview && normalizedPrompt && normalizedPreview.includes(normalizedPrompt)) score += 80;
      if (/^\s*(?:you said|you asked|вы сказали)/i.test(rawPrompt)) score += 30;
      if (prompt.length >= 20) score += 20;
      if (prompt.length <= 8) score -= 40;
      score += Math.min(prompt.length, 120) / 10;
      const promptBottom = Number(item?.dom_diagnostics?.prompt_candidate?.bottom);
      return {
        prompt,
        score,
        bottom: Number.isFinite(promptBottom) ? promptBottom : Number.NEGATIVE_INFINITY
      };
    })
    .filter(Boolean);

  const aggregatedPromptEntries = Array.from(
    promptEntries.reduce((map, entry) => {
      const key = String(entry.prompt || '').toLowerCase();
      if (!key) return map;
      const current = map.get(key);
      if (!current) {
        map.set(key, {
          prompt: entry.prompt,
          score: entry.score,
          count: 1,
          maxBottom: entry.bottom
        });
      } else {
        current.score += entry.score;
        current.count += 1;
        current.maxBottom = Math.max(current.maxBottom, entry.bottom);
      }
      return map;
    }, new Map()).values()
  );

  const latestBottom = aggregatedPromptEntries.reduce(
    (best, entry) => Math.max(best, Number.isFinite(entry.maxBottom) ? entry.maxBottom : Number.NEGATIVE_INFINITY),
    Number.NEGATIVE_INFINITY
  );
  const recentPromptEntries = Number.isFinite(latestBottom)
    ? aggregatedPromptEntries.filter((entry) => (entry.maxBottom ?? Number.NEGATIVE_INFINITY) >= latestBottom - 320)
    : aggregatedPromptEntries;

  recentPromptEntries.sort((a, b) => {
    if ((b.maxBottom ?? Number.NEGATIVE_INFINITY) !== (a.maxBottom ?? Number.NEGATIVE_INFINITY)) {
      return (b.maxBottom ?? Number.NEGATIVE_INFINITY) - (a.maxBottom ?? Number.NEGATIVE_INFINITY);
    }
    if (b.score !== a.score) return b.score - a.score;
    if (b.count !== a.count) return b.count - a.count;
    return b.prompt.length - a.prompt.length;
  });

  const prompt = recentPromptEntries[0]?.prompt || '';
  if (prompt) {
    return persist ? rememberResolvedSourcePrompt(prompt) : prompt;
  }

  const titles = (Array.isArray(scrapeMeta) ? scrapeMeta : [])
    .map((item) => String(item?.dom_diagnostics?.document_title || '').trim())
    .filter(Boolean)
    .map((title) => title
      .replace(/\s*[-|]\s*(ChatGPT|Gemini|Claude|Grok|Perplexity).*$/i, '')
      .replace(/\s*[·•]\s*(ChatGPT|Gemini|Claude|Grok|Perplexity).*$/i, '')
      .trim()
    )
    .filter((title) => title.length >= 6);

  const fallbackTitle = titles.sort((a, b) => b.length - a.length)[0] || '';
  if (fallbackTitle) {
    return persist ? rememberResolvedSourcePrompt(fallbackTitle) : fallbackTitle;
  }
  return '';
}

// ========== COLLECT REPLIES FROM ALL SLOTS ==========
async function collectLatestRepliesFromEnabledSlots() {
  const enabledSlots = SLOTS.filter(slot => toggles[slot]?.checked);
  mergeLog(`Scraping ${enabledSlots.length} slot(s): ${enabledSlots.join(', ')}`, 'scrape');
  const responsesByModel = {};
  const aggregatedResponses = [];
  const scrapeMeta = [];
  const sourcePrompt = String(window.mergeApiClient?.lastSourcePrompt || activeSessionPrompt || '').trim();
  const traceId = activeIngestTraceId || startIngestTrace();

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

    // Claude copy buttons sometimes capture wrapper noise or partial formatting,
    // while the DOM extractor is stable enough to prefer first on desktop.
    const preferDomFirst = serviceId === 'gemini' || serviceId === 'grok' || serviceId === 'claude';
    let copied = null;
    let reply = '';
    let domReply = null;
    let extractionMethod = 'dom';

    if (preferDomFirst) {
      domReply = await getLatestAssistantReply(slot);
      reply = domReply?.raw || '';
      if (!reply || String(reply).trim().length < 20) {
        copied = await tryCopyLatestAssistantReply(slot, serviceId);
        if (copied?.text) {
          reply = copied.text;
          extractionMethod = 'copy-fallback';
        }
      }
    } else {
      copied = await tryCopyLatestAssistantReply(slot, serviceId);
      if (copied?.text) {
        reply = copied.text;
        extractionMethod = 'copy';
        domReply = await getLatestAssistantReply(slot);
      } else {
        domReply = await getLatestAssistantReply(slot);
        reply = domReply?.raw || '';
        extractionMethod = 'dom';
      }
    }
    let cleanedReply = sanitizeScrapedReply(serviceId, reply || '', sourcePrompt);
    if (!isQualityReply(cleanedReply, sourcePrompt) && copied?.text && domReply?.raw) {
      const domCleanedReply = sanitizeScrapedReply(serviceId, domReply.raw, sourcePrompt);
      if (isQualityReply(domCleanedReply, sourcePrompt)) {
        reply = domReply.raw;
        cleanedReply = domCleanedReply;
        extractionMethod = 'dom-fallback';
      }
    }
    const domDiagnostics = domReply?.diagnostics || lastDomScrapeDebugBySlot.get(slot) || null;
    await appendTraceScrapeArtifact(traceId, slot, serviceId, serviceName, domDiagnostics, {
      extraction_method: extractionMethod,
      raw_chars: String(reply || '').length,
      clean_chars: cleanedReply.length,
      source_url: currentUrl || SERVICE_PRESETS[serviceId]?.url || '',
      copy_diagnostics: copied?.diagnostics || null
    }, [
      {
        name: `${slot}-${serviceId}-raw`,
        extension: 'md',
        content: String(reply || '')
      },
      {
        name: `${slot}-${serviceId}-clean`,
        extension: 'md',
        content: String(cleanedReply || '')
      }
    ]);
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
        copy_diagnostics: copied?.diagnostics || null,
        dom_diagnostics: summarizeDomDiagnostics(domDiagnostics)
      };
      scrapeMeta.push(meta);
      mergeLog(`${serviceName}: scraped ${cleanedReply.length} chars - "${preview}"`, 'scrape', meta);
      const modelName = reserveModelName(serviceName);
      responsesByModel[modelName] = cleanedReply;
      aggregatedResponses.push({
        segment_id: slot,
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

async function ingestAfterSlotsPolling(sourcePrompt, expectedSlotCount, ingestContext = {}, runId = '') {
  mergeLog(`Ingest polling started (expected slots: ${expectedSlotCount})`, 'info');

  // Phase 1: Initial delay G�� no LLM responds in under 5 seconds
  mergeLog(`Waiting ${INGEST_INITIAL_DELAY_MS}ms before first scrape attempt`, 'info');
  await sleep(INGEST_INITIAL_DELAY_MS);
  if (!isSamePendingAggregation(runId)) return;

  // Phase 2: Wait for all slots to finish generating
  const enabledSlots = SLOTS.filter(slot => toggles[slot]?.checked);
  for (let waitAttempt = 1; waitAttempt <= INGEST_GENERATION_WAIT_ATTEMPTS; waitAttempt += 1) {
    if (!isSamePendingAggregation(runId)) return;
    if (aggregationControl.paused) {
      enabledSlots.forEach((slot) => {
        if (slotAggregationStatuses[slot] === (window.AggregationControl?.SLOT_STATUS?.WAITING || 'waiting')) {
          setAggregationSlotStatus(slot, window.AggregationControl?.SLOT_STATUS?.PAUSED || 'paused');
        }
      });
      renderAggregationSummary(enabledSlots);
      setMergeStatus('Aggregation paused. Fix slots and press Resume or Collect now.', 'paused');
      mergeLog('Auto aggregation paused before scrape collection', 'warn');
      return;
    }
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
  if (!isSamePendingAggregation(runId)) return;
  if (aggregationControl.paused) {
    enabledSlots.forEach((slot) => {
      if (slotAggregationStatuses[slot] === (window.AggregationControl?.SLOT_STATUS?.WAITING || 'waiting')) {
        setAggregationSlotStatus(slot, window.AggregationControl?.SLOT_STATUS?.PAUSED || 'paused');
      }
    });
    renderAggregationSummary(enabledSlots);
    setMergeStatus('Aggregation paused. Fix slots and press Resume or Collect now.', 'paused');
    mergeLog('Auto aggregation paused during settle delay', 'warn');
    return;
  }

  await collectNowAggregation(false);
}

// ========== MERGE FUNCTIONALITY ==========
function setMergeStatus(text, type = 'idle') {
  if (!mergeStatusDiv) return;
  mergeStatusDiv.textContent = text;
  mergeStatusDiv.className = `merge-status ${type}`;
}

function clearPendingAggregationState() {
  aggregationControl.clearPendingMerge();
  updateAggregationActionButtons();
  reportBackgroundWorkState();
}

function clearPendingAutoAggregationState() {
  aggregationControl.clearPendingAggregation();
  updateAggregationActionButtons();
  reportBackgroundWorkState();
}

function isSamePendingAggregation(runId) {
  return !!runId && aggregationControl.pendingAggregation?.runId === runId;
}

async function finalizeAggregatedIngest(ingestResult, sourcePrompt, ingestContext = {}) {
  const sessionId = extractSessionId(ingestResult);
  const noteId = String(ingestResult?.data?.note_id || '').trim() || null;
  if (ingestResult?.ok && sessionId) {
    // A fresh ingest established the active session; normal slot-fingerprint
    // continuation is safe again.
    setSuppressSlotRestore(false);
    activeSessionId = sessionId;
    if (noteId) activeAggregatedNoteId = noteId;
    if (String(sourcePrompt || '').trim()) {
      activeSessionPrompt = String(sourcePrompt || '').trim();
    }
    const fingerprint = String(ingestContext.sessionFingerprint || activeSessionFingerprint || '').trim();
    if (fingerprint) {
      persistSessionContext(sessionId, fingerprint, noteId || activeAggregatedNoteId, sourcePrompt);
    } else {
      localStorage.setItem(AGGREGATED_SESSION_ID_KEY, String(sessionId));
    }
    setIngestSessionIndicator(sessionId);
    const autoSaveName = String(sourcePrompt || '').trim().slice(0, 60) ||
      `Session ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
    saveSessionSnapshot(autoSaveName, sessionId, noteId).catch(e =>
      mergeLog(`Auto-save after ingest failed: ${e?.message || e}`, 'warn')
    );
  }

  mergeLog(
    ingestResult?.ok ? 'Ingest RPC success' : 'Ingest RPC failed',
    ingestResult?.ok ? 'recv' : 'warn',
    ingestResult
  );

  return { sessionId, noteId };
}

async function collectNowAggregation(manual = true) {
  if (manual) {
    const traceId = startIngestTrace();
    mergeLog(`Ingest trace restarted for manual collect: ${traceId}`, 'info');
  }
  const pending = aggregationControl.pendingAggregation;
  const enabledSlots = SLOTS.filter((slot) => toggles[slot]?.checked);
  const runtimeFingerprint = buildSessionFingerprint(enabledSlots);
  const restoredContext = runtimeFingerprint
    ? restoreStoredQuestionContextForFingerprint(runtimeFingerprint)
    : null;
  const existingAggregatedNoteId = String(pending?.aggregatedNoteId || activeAggregatedNoteId || '').trim() || null;
  const ingestContext = pending?.ingestContext || {
    sessionFingerprint: runtimeFingerprint || activeSessionFingerprint,
    sessionIdHint: getCurrentQuestionSessionId()
  };
  const hasLoadedQuestionContext = Number.isInteger(ingestContext.sessionIdHint) && ingestContext.sessionIdHint > 0 && !!existingAggregatedNoteId;
  const pendingPrompt = String(pending?.sourcePrompt || '').trim();
  const loadedQuestionPrompt = hasLoadedQuestionContext
    ? String(restoredContext?.source_prompt || activeSessionPrompt || '').trim()
    : '';
  const scraping = window.AggregationControl?.SLOT_STATUS?.SCRAPING || 'scraping';
  const collected = window.AggregationControl?.SLOT_STATUS?.COLLECTED || 'collected';
  const error = window.AggregationControl?.SLOT_STATUS?.ERROR || 'error';

  if (enabledSlots.length === 0) {
    setMergeStatus('No enabled slots to collect from.', 'error');
    mergeLog('Collect now aborted: no enabled slots', 'warn');
    return null;
  }

  enabledSlots.forEach((slot) => setAggregationSlotStatus(slot, scraping));
  renderAggregationSummary(enabledSlots);
  setMergeStatus(manual ? 'Collecting latest replies and re-ingesting...' : 'Collecting latest replies...', 'running');
  mergeLog(manual ? 'Collect now requested' : 'Auto aggregation collecting latest replies', 'info', {
    sourcePrompt: pendingPrompt,
    sessionIdHint: ingestContext.sessionIdHint || null,
    sessionFingerprint: ingestContext.sessionFingerprint || null,
    enabledSlots
  });

  const collectedPayload = await collectLatestRepliesFromEnabledSlots();
  const aggregatedResponses = collectedPayload.aggregatedResponses || [];
  lastScrapeMeta = collectedPayload.scrapeMeta || [];
  const scrapedPrompt = resolveSourcePromptFromCollectedScrape(lastScrapeMeta, {
    allowDirectFallback: false,
    persist: false
  });
  let sourcePrompt = pendingPrompt;
  // If the loaded root already represents the current question, prefer that branch
  // over any stale pending prompt when deciding what to re-ingest.
  if (manual && hasLoadedQuestionContext) {
    const pendingMatchesLoaded = promptsReferToSameQuestion(pendingPrompt, loadedQuestionPrompt);
    if (!pendingMatchesLoaded) {
      sourcePrompt = scrapedPrompt || loadedQuestionPrompt || pendingPrompt;
    } else {
      sourcePrompt = pendingPrompt || scrapedPrompt || loadedQuestionPrompt;
    }
  } else {
    sourcePrompt = pendingPrompt || scrapedPrompt || loadedQuestionPrompt;
  }
  if (sourcePrompt) {
    rememberResolvedSourcePrompt(sourcePrompt);
  }
  let resolvedExistingAggregatedNoteId = existingAggregatedNoteId;
  let storedPrompt = loadedQuestionPrompt;
  const forceNewRoot = !!pending?.forceNewRoot;
  const allowPendingOverwrite = !!pending?.allowOverwriteExisting;

  enabledSlots.forEach((slot) => {
    const serviceId = detectServiceByUrl(getWebviewCurrentUrl(slot)) || slotConfig[slot] || slot;
    const hasReply = aggregatedResponses.some((item) => item.segment_id === slot || item.segment_id === `${slot}:${serviceId}` || item.provider === serviceId);
    setAggregationSlotStatus(slot, hasReply ? collected : error);
  });
  renderAggregationSummary(enabledSlots);

  if (aggregatedResponses.length === 0) {
    setMergeStatus('Aggregation collect found no replies.', 'error');
    mergeLog('Collect now failed: no replies collected', 'error');
    return null;
  }

  // A numeric session can accumulate multiple user questions inside the same chat tabs.
  // We only overwrite the current aggregated root when the recovered prompt still points
  // to that exact question; matching session_id alone is not safe enough.
  let sameQuestionAsCurrentRoot = hasLoadedQuestionContext
    ? promptsReferToSameQuestion(sourcePrompt, storedPrompt)
    : false;
  if (
    (manual || allowPendingOverwrite)
    && !forceNewRoot
    && sourcePrompt
    && Number.isInteger(ingestContext.sessionIdHint)
    && ingestContext.sessionIdHint > 0
    && (!resolvedExistingAggregatedNoteId || !sameQuestionAsCurrentRoot)
  ) {
    const existingRoot = await findExistingAggregatedRootForQuestion(ingestContext.sessionIdHint, sourcePrompt);
    const recoveredNoteId = String(existingRoot?.noteId ?? existingRoot?.note_id ?? '').trim() || null;
    const recoveredPrompt = String(existingRoot?.name || existingRoot?.title || '').trim();
    if (recoveredNoteId) {
      resolvedExistingAggregatedNoteId = recoveredNoteId;
      if (recoveredPrompt) storedPrompt = recoveredPrompt;
      sameQuestionAsCurrentRoot = promptsReferToSameQuestion(sourcePrompt, storedPrompt);
      activeAggregatedNoteId = recoveredNoteId;
      if (sameQuestionAsCurrentRoot) {
        mergeLog('Recovered existing aggregated root for current question before Collect now overwrite', 'info', {
          sessionIdHint: ingestContext.sessionIdHint,
          recoveredAggregatedNoteId: recoveredNoteId,
          sourcePrompt,
          storedPrompt
        });
      }
    }
  }
  const replaceExisting = !forceNewRoot
    && (manual || allowPendingOverwrite)
    && Number.isInteger(ingestContext.sessionIdHint)
    && ingestContext.sessionIdHint > 0
    && !!resolvedExistingAggregatedNoteId
    && sameQuestionAsCurrentRoot;
  const targetAggregatedNoteId = replaceExisting ? resolvedExistingAggregatedNoteId : null;
  if (forceNewRoot && resolvedExistingAggregatedNoteId) {
    mergeLog('Collect now is running for a freshly sent prompt; forcing creation of a new aggregated root instead of overwriting the previous one', 'info', {
      sessionIdHint: ingestContext.sessionIdHint || null,
      previousAggregatedNoteId: resolvedExistingAggregatedNoteId,
      sourcePrompt
    });
  }
  if (
    manual
    && hasLoadedQuestionContext
    && resolvedExistingAggregatedNoteId
    && sourcePrompt
    && storedPrompt
    && !sameQuestionAsCurrentRoot
  ) {
    mergeLog('Collect now detected a new question in the same chats; creating a new note instead of overwriting the current root', 'info', {
      current_root_prompt: storedPrompt,
      collected_prompt: sourcePrompt,
      sessionIdHint: ingestContext.sessionIdHint || null,
      previousAggregatedNoteId: resolvedExistingAggregatedNoteId
    });
  }
  const payloadBuild = buildAggregatedPayload({
    sourcePrompt,
    responses: aggregatedResponses,
    sessionId: ingestContext.sessionIdHint,
    projectTagId: activeProjectId,
    aggregatedNoteId: targetAggregatedNoteId,
    replaceExisting
  });

  mergeLog(replaceExisting ? 'Re-ingesting aggregated note with overwrite' : 'Creating aggregated note from Collect now', 'send', {
    payload: payloadBuild.payload,
    scrape_meta: lastScrapeMeta
  });

  const ingestResult = await sendAggregated(
    payloadBuild.sessionId,
    payloadBuild.payload.title,
    payloadBuild.payload.responses,
    lastScrapeMeta,
    payloadBuild.payload.project_tag_id,
    payloadBuild.payload.replace_existing,
    payloadBuild.payload.aggregated_note_id
  );

  const finalized = await finalizeAggregatedIngest(ingestResult, sourcePrompt, ingestContext);
  if (pending && finalized?.noteId) {
    pending.aggregatedNoteId = finalized.noteId;
    pending.waiting = false;
  }
  if (ingestResult?.ok) {
    setMergeStatus(replaceExisting ? 'Aggregation refreshed in database.' : 'Aggregation collected and session created.', 'idle');
    if (!manual) clearPendingAutoAggregationState();
  } else {
    setMergeStatus('Aggregation collect failed.', 'error');
  }
  return ingestResult;
}

async function waitForAggregationReadyOrPause() {
  const enabledSlots = SLOTS.filter((slot) => toggles[slot]?.checked);
  const ready = window.AggregationControl?.SLOT_STATUS?.READY || 'ready';

  for (let attempt = 1; attempt <= AGGREGATION_WAIT_MAX_CHECKS; attempt += 1) {
    if (!aggregationControl.hasPendingMerge()) return false;
    if (aggregationControl.paused) {
      setMergeStatus('Aggregation paused. Fix slots and press Resume or Collect now.', 'paused');
      enabledSlots.forEach((slot) => {
        if (slotAggregationStatuses[slot] === (window.AggregationControl?.SLOT_STATUS?.WAITING || 'waiting')) {
          setAggregationSlotStatus(slot, window.AggregationControl?.SLOT_STATUS?.PAUSED || 'paused');
        }
      });
      renderAggregationSummary(enabledSlots);
      return false;
    }

    const statusesBySlot = await readAggregationStatuses({ silent: true });
    const readyCount = enabledSlots.filter((slot) => statusesBySlot[slot] === ready).length;
    if (readyCount >= enabledSlots.length) {
      setMergeStatus(`All ${enabledSlots.length} slot(s) ready. Collecting now...`, 'running');
      await sleep(AGGREGATION_SETTLE_DELAY_MS);
      return true;
    }

    setMergeStatus(`Waiting for replies: ${readyCount}/${enabledSlots.length} ready`, 'running');
    if (attempt < AGGREGATION_WAIT_MAX_CHECKS) {
      await sleep(AGGREGATION_WAIT_INTERVAL_MS);
    }
  }

  setMergeStatus('Aggregation still waiting. Use Collect now or Pause aggregation.', 'idle');
  return false;
}

async function collectAndMaybeRunPendingMerge(manual = false) {
  const pending = aggregationControl.pendingMerge;
  if (!pending) return;

  const scraping = window.AggregationControl?.SLOT_STATUS?.SCRAPING || 'scraping';
  const collected = window.AggregationControl?.SLOT_STATUS?.COLLECTED || 'collected';
  const error = window.AggregationControl?.SLOT_STATUS?.ERROR || 'error';
  const enabledSlots = SLOTS.filter((slot) => toggles[slot]?.checked);
  enabledSlots.forEach((slot) => setAggregationSlotStatus(slot, scraping));
  renderAggregationSummary(enabledSlots);
  setMergeStatus(manual ? 'Collecting current slot replies...' : 'Collecting replies...', 'running');

  const collectedPayload = await collectLatestRepliesFromEnabledSlots();
  const responses = collectedPayload.responsesByModel || {};
  const aggregatedResponses = collectedPayload.aggregatedResponses || [];
  lastScrapeMeta = collectedPayload.scrapeMeta || [];

  enabledSlots.forEach((slot) => {
    const serviceId = detectServiceByUrl(getWebviewCurrentUrl(slot)) || slotConfig[slot] || slot;
    const serviceName = SERVICE_PRESETS[serviceId]?.name || labels[slot]?.textContent || slot;
    const hasReply = Object.prototype.hasOwnProperty.call(responses, serviceName)
      || Object.keys(responses).some((key) => key === serviceName || key.startsWith(`${serviceName} (`));
    setAggregationSlotStatus(slot, hasReply ? collected : error);
  });
  renderAggregationSummary(enabledSlots);

  if (Object.keys(responses).length === 0) {
    setMergeStatus('No responses to merge. Send messages first.', 'error');
    mergeLog('No responses collected � nothing to merge', 'error');
    mergeInProgress = false;
    reportBackgroundWorkState();
    if (runMergeBtn) runMergeBtn.disabled = false;
    if (clarificationSendBtn) clarificationSendBtn.disabled = false;
    clearPendingAggregationState();
    return;
  }

  lastScrapedResponses = responses;
  lastAggregatedResponses = aggregatedResponses;
  mergeHistory = '';
  mergeLog(`Collected from: ${Object.keys(responses).join(', ')}`, 'info');

  clearPendingAggregationState();
  await executeMergeRequest(pending.isClarification, pending.clarificationText, pending.previousSummary, responses, aggregatedResponses);
}

async function executeMergeRequest(isClarification, clarificationText, previousSummary, responses, aggregatedResponses) {
  const client = window.mergeApiClient;
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

  const result = await client.merge(
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
  reportBackgroundWorkState();
  if (runMergeBtn) runMergeBtn.disabled = false;
  if (clarificationSendBtn) clarificationSendBtn.disabled = false;
  updateAggregationActionButtons();

  if (result.success) {
    const cleanResponse = stripMergeMetadataFooter(result.text);
    if (mergeHistory === '') {
      mergeHistory = `Assistant: ${cleanResponse}`;
    } else {
      mergeHistory += `\n\nAssistant: ${cleanResponse}`;
    }

    updateMergeResult(result.text);
    setMergeStatus(isClarification ? 'Follow-up complete' : 'Merge complete', 'idle');

    const enabledSlots = SLOTS.filter((slot) => toggles[slot]?.checked);
    const runtimeFingerprint = buildSessionFingerprint(enabledSlots);
    if (runtimeFingerprint) {
      restoreStoredQuestionContextForFingerprint(runtimeFingerprint);
    }
    let sessionId = getCurrentQuestionSessionId();
    if ((!Number.isInteger(sessionId) || sessionId <= 0) && !isClarification && Array.isArray(aggregatedResponses) && aggregatedResponses.length > 0) {
      const bootstrapPrompt = String(client.lastSourcePrompt || activeSessionPrompt || '').trim();
      // Merge notes are children of an aggregated root. If a loaded question has no
      // current root note yet, we bootstrap that root first instead of creating an
      // orphaned merge row.
      mergeLog('No active session for merge ingest; bootstrapping aggregated note first', 'info', {
        sourcePrompt: bootstrapPrompt || null,
        aggregatedResponses: aggregatedResponses.length
      });
      const bootstrapIngest = await sendAggregated(
        null,
        bootstrapPrompt || `Collected ${new Date().toISOString()}`,
        aggregatedResponses,
        lastScrapeMeta,
        activeProjectId,
        false,
        null
      );
      const finalized = await finalizeAggregatedIngest(
        bootstrapIngest,
        bootstrapPrompt,
        {
          sessionFingerprint: runtimeFingerprint || activeSessionFingerprint,
          sessionIdHint: null
        }
      );
      sessionId = finalized?.sessionId ?? getCurrentQuestionSessionId();
      mergeLog(
        bootstrapIngest?.ok ? 'Bootstrap aggregated ingest success' : 'Bootstrap aggregated ingest failed',
        bootstrapIngest?.ok ? 'recv' : 'warn',
        bootstrapIngest
      );
    }

    if (Number.isInteger(sessionId) && sessionId > 0) {
      const promptText = isClarification
        ? clarificationText
        : String(client.lastSourcePrompt || activeSessionPrompt || '').trim();
      const sendResult = isClarification
        ? await sendClarification(sessionId, promptText, cleanResponse, lastScrapeMeta)
        : await sendMerge(sessionId, promptText, cleanResponse, lastScrapeMeta, activeAggregatedNoteId);
      mergeLog(
        sendResult?.ok ? (isClarification ? 'Clarification RPC success' : 'Merge RPC success') : (isClarification ? 'Clarification RPC failed' : 'Merge RPC failed'),
        sendResult?.ok ? 'recv' : 'warn',
        sendResult
      );
    } else if (!isClarification) {
      mergeLog('Session ID missing; merge note not ingested', 'warn');
    }

    if (clarificationContainer) {
      clarificationContainer.classList.add('visible');
      clarificationInput?.focus();
    }
  } else {
    mergeLog(`API error: ${result.error}`, 'error');
    setMergeStatus(`Failed: ${result.error}`, 'error');
  }
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

  // Sync UI G�� client before checking config state and calling API.
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
  reportBackgroundWorkState();
  setMergeStatus(isClarification ? 'Processing follow-up...' : 'Collecting responses...', 'running');
  if (runMergeBtn) runMergeBtn.disabled = true;
  if (isClarification && clarificationSendBtn) clarificationSendBtn.disabled = true;

  if (isClarification) {
    await executeMergeRequest(true, clarificationText, previousSummary, lastScrapedResponses, lastAggregatedResponses);
    return;
  }
  resetAggregationSlotStatuses();
  renderAggregationSummary();
  aggregationControl.beginPendingMerge({ isClarification: false, clarificationText: '', previousSummary: '' });
  updateAggregationActionButtons();
  if (aggregationControl.paused) {
    mergeLog('Aggregation is paused, running merge from currently available replies', 'info');
    setMergeStatus('Aggregation paused. Running merge from current replies...', 'running');
    await collectAndMaybeRunPendingMerge(true);
    return;
  }
  const ready = await waitForAggregationReadyOrPause();
  if (ready) {
    await collectAndMaybeRunPendingMerge(false);
  }
}

// ========== SESSION MANAGEMENT ==========
  const SESSIONS_KEY = 'chat-aggregator-sessions';
  const SESSIONS_META_KEY = 'chat-aggregator-sessions-meta';
  const LOCAL_SESSION_COUNTER_KEY = 'chat-aggregator-local-session-counter';
  const LOCAL_SESSION_BASE = 900000;
  const MAX_SESSIONS = 1000;

  // Local-only session numbering (signed-out parity with iOS/Android, base
  // 900000) so locally-saved sessions never collide with backend session ids.
  function getNextLocalSessionId() {
    let current = parseInt(localStorage.getItem(LOCAL_SESSION_COUNTER_KEY) || '0', 10);
    if (!Number.isInteger(current) || current < LOCAL_SESSION_BASE) current = LOCAL_SESSION_BASE;
    const next = current + 1;
    localStorage.setItem(LOCAL_SESSION_COUNTER_KEY, String(next));
    return next;
  }
  let sessionsNotice = { text: '', kind: 'info' };
  let sessionsSearchQuery = '';
  const expandedSessionTitleIds = new Set();
  let sessionsListMemoryCache = null;

function sessionSnapshotKey(session) {
  const sessionPart = session?.sessionId != null ? String(session.sessionId) : 'id:' + String(session?.id ?? '');
  const notePart = String(session?.noteId || session?.note_id || '').trim() || ('row:' + String(session?.id ?? ''));
  return `${sessionPart}|${notePart}`;
}

function sessionSnapshotFreshness(session) {
  const sortAt = Date.parse(session?.sortAt || session?.sort_at || '');
  if (Number.isFinite(sortAt)) return sortAt;
  const updated = Date.parse(session?.updatedAt || session?.updated_at || '');
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(session?.createdAt || session?.created_at || '');
  if (Number.isFinite(created)) return created;
  const timestamp = Number(session?.timestamp || 0);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function dedupeLatestSessionSnapshots(sessions) {
  const latestByKey = new Map();
  (Array.isArray(sessions) ? sessions : []).forEach((session) => {
    const key = sessionSnapshotKey(session);
    const existing = latestByKey.get(key);
    if (!existing || sessionSnapshotFreshness(session) >= sessionSnapshotFreshness(existing)) {
      latestByKey.set(key, session);
    }
  });
  return [...latestByKey.values()]
    .sort((a, b) => sessionSnapshotFreshness(b) - sessionSnapshotFreshness(a))
    .slice(0, MAX_SESSIONS);
}

function mergeSessionSnapshots(primary, secondary) {
  const primaryList = Array.isArray(primary) ? primary : [];
  const secondaryList = Array.isArray(secondary) ? secondary : [];

  const normalizeName = (value) => String(value || '').trim().toLowerCase();
  const sameSessionEntry = (left, right) => {
    const leftNoteId = String(left?.noteId || left?.note_id || '').trim();
    const rightNoteId = String(right?.noteId || right?.note_id || '').trim();
    if (leftNoteId && rightNoteId) return leftNoteId === rightNoteId;

    const leftSessionId = Number(left?.sessionId ?? left?.session_id ?? null);
    const rightSessionId = Number(right?.sessionId ?? right?.session_id ?? null);
    if (!Number.isInteger(leftSessionId) || !Number.isInteger(rightSessionId) || leftSessionId !== rightSessionId) {
      return false;
    }

    const leftName = normalizeName(left?.name || left?.title);
    const rightName = normalizeName(right?.name || right?.title);
    return Boolean(leftName) && leftName === rightName;
  };

  const filteredSecondary = secondaryList.filter((candidate) => !primaryList.some((existing) => sameSessionEntry(existing, candidate)));
  return dedupeLatestSessionSnapshots([
    ...primaryList,
    ...filteredSecondary
  ]);
}

  function clearLegacyDismissedSessionsStorage() {
    try {
      localStorage.removeItem('chat-aggregator-dismissed-session-ids');
    } catch (_) {}
  }

  clearLegacyDismissedSessionsStorage();

function setSessionsNotice(text, kind = 'info') {
  sessionsNotice = { text: String(text || '').trim(), kind };
}

function errorToText(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return String(error.message || error);
}

async function saveSessionSnapshot(customName, ingestSessionId, noteId = null) {
  console.log('[saveSessionSnapshot] invoked', {
    customName: customName || null,
    ingestSessionId: ingestSessionId ?? null,
    noteId: noteId ?? activeAggregatedNoteId ?? null
  });
  const sessionData = {
    sessionId: ingestSessionId ?? getCurrentSessionId() ?? activeSessionId,
    noteId: String(noteId || activeAggregatedNoteId || '').trim() || null,
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
        const cachedSessions = await loadSessionsList({ preferCache: true });
        const sessions = mergeSessionSnapshots([result], cachedSessions);
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
        writeJsonCache(SESSIONS_META_KEY, { fetchedAt: Date.now() });
        sessionsListMemoryCache = sessions;
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

  const cachedSessions = await loadSessionsList({ preferCache: true });
  const sessions = mergeSessionSnapshots([snapshot], cachedSessions);

  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  writeJsonCache(SESSIONS_META_KEY, { fetchedAt: Date.now() });
  sessionsListMemoryCache = sessions;
  setSessionsNotice('Saved to local cache only.', 'warn');
  await updateSessionsUI();
  return snapshot;
}

  // Late-login migration: after sign-in, offer to push local-only sessions
  // (session_id >= LOCAL_SESSION_BASE) up to the account. Saving while signed in
  // carries the JWT, so the backend set_owner_from_note trigger stamps owner_id
  // = auth.uid(). Purely client-side; see shared/contracts/AUTH_AND_SESSION_SYNC.md.
  async function migrateLocalSessionsOnLogin() {
    // Start the account clean: a new question must not resurrect a pre-login
    // session by slot fingerprint. Lifted on explicit load / fresh ingest.
    clearStoredSessionContext();
    clearIngestSessionIndicator();
    setSuppressSlotRestore(true);

    let cached = [];
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      cached = raw ? JSON.parse(raw) : [];
    } catch (_) {
      cached = [];
    }
    if (!Array.isArray(cached) || cached.length === 0) return;

    const isLocal = (s) => {
      const sid = Number(s?.sessionId ?? s?.session_id);
      return Number.isInteger(sid) && sid >= LOCAL_SESSION_BASE;
    };
    const locals = cached.filter(isLocal);
    if (locals.length === 0) return;

    const ok = window.confirm(
      `You have ${locals.length} local session(s) saved while signed out.\n\n` +
      `Upload them to your account so they sync across your devices?`
    );
    if (!ok) return;

    let migrated = 0;
    const migratedIds = new Set();
    for (const s of locals) {
      try {
        // Use the `migrate` action: the backend allocates a fresh real
        // session_id (not the local 900000+ one) so it never collides across
        // devices. Owner is stamped server-side from the JWT.
        const result = await window.electronAPI.migrateSession({
          name: s.name || s.title || 'Session',
          slotConfig: s.slotConfig || s.slot_config || {},
          slotUrls: s.slotUrls || s.slot_urls || {},
          slotEnabled: s.slotEnabled || s.slot_enabled || {}
        });
        if (result && result.id) {
          migrated += 1;
          migratedIds.add(s.id);
        }
      } catch (err) {
        console.error('[migrateLocalSessionsOnLogin] failed for', s?.id, err);
        // Keep this local copy; the offer recurs next sign-in.
      }
    }

    if (migratedIds.size > 0) {
      const remaining = cached.filter((s) => !migratedIds.has(s.id));
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(remaining));
      sessionsListMemoryCache = remaining;
    }
    setSessionsNotice(
      migrated === locals.length
        ? `Uploaded ${migrated} local session(s) to your account.`
        : `Uploaded ${migrated} of ${locals.length} local session(s); the rest stayed local.`,
      migrated === locals.length ? 'ok' : 'warn'
    );
    await updateSessionsUI({ forceRefresh: true });
  }

  // If a gated call just found the account session expired (refresh token
  // rejected), say so loudly and refresh the account panel to "signed out"
  // instead of silently degrading to the local cache while the UI implies
  // we're still signed in.
  async function maybePromptSessionExpired() {
    try {
      const expired = await window.electronAPI?.authConsumeSessionExpired?.();
      if (expired) {
        setSessionsNotice('Your account session expired. Sign in again (Account) to see and sync your cloud sessions.', 'warn');
        await refreshAccountUI().catch(() => {});
        return true;
      }
    } catch (_) { /* non-fatal */ }
    return false;
  }

  async function loadSessionsList(options = {}) {
    const preferCache = options?.preferCache === true;
    const forceRefresh = options?.forceRefresh === true;
    clearLegacyDismissedSessionsStorage();
    if (!forceRefresh && Array.isArray(sessionsListMemoryCache)) {
      return sessionsListMemoryCache;
    }
  let cachedSessions = [];

  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    cachedSessions = raw ? JSON.parse(raw) : [];
  } catch (_) {
    cachedSessions = [];
  }

    if (preferCache) {
      sessionsListMemoryCache = Array.isArray(cachedSessions) ? cachedSessions : [];
      return sessionsListMemoryCache;
    }

    const sessionsMeta = readJsonCache(SESSIONS_META_KEY, {});
    if (!forceRefresh && Array.isArray(cachedSessions) && cachedSessions.length > 0 && isFreshRemoteListCache(sessionsMeta?.fetchedAt)) {
      sessionsListMemoryCache = cachedSessions;
      setSessionsNotice('Loaded from local cache. Use refresh for latest.', 'info');
      return sessionsListMemoryCache;
    }

  // Local-only mode: when signed out we never call the backend. Use the local
  // cache directly so loading a locally-saved session does not surface a
  // "Not signed in" DB error.
  try {
    const authStatus = await window.electronAPI?.authGetStatus?.();
    if (!authStatus?.signedIn) {
      sessionsListMemoryCache = Array.isArray(cachedSessions) ? cachedSessions : [];
      setSessionsNotice('Local-only mode (signed out): showing local sessions.', 'info');
      return sessionsListMemoryCache;
    }
  } catch (_) {
    // If the status check itself fails, fall through to the existing path.
  }

  // Try to load from database first
  if (window.electronAPI?.loadSessions) {
    try {
      // Sessions tab should show global history, not only current ingest session.
      const dbSessions = await window.electronAPI.loadSessions(null);
      if (Array.isArray(dbSessions) && dbSessions.length > 0) {
        const normalizedSessions = dedupeLatestSessionSnapshots(dbSessions);
        // Database is the source of truth when available. Replace local cache so
        // deleted/stale rows do not linger in the Sessions tab.
          localStorage.setItem(SESSIONS_KEY, JSON.stringify(normalizedSessions));
          writeJsonCache(SESSIONS_META_KEY, { fetchedAt: Date.now() });
          sessionsListMemoryCache = normalizedSessions;
          setSessionsNotice('Loaded from database.', 'ok');
          return normalizedSessions;
        }
      if (Array.isArray(dbSessions) && dbSessions.length === 0) {
        // An empty result can mean the account session silently expired during
        // this call (gate refresh was rejected). Prefer the expiry prompt and
        // the local cache over a misleading "0 sessions" against the account.
        if (await maybePromptSessionExpired()) {
          sessionsListMemoryCache = Array.isArray(cachedSessions) ? cachedSessions : [];
          return sessionsListMemoryCache;
        }
        localStorage.setItem(SESSIONS_KEY, JSON.stringify([]));
        writeJsonCache(SESSIONS_META_KEY, { fetchedAt: Date.now() });
        sessionsListMemoryCache = [];
        setSessionsNotice('Database returned 0 sessions.', 'info');
        return [];
      }
    } catch (error) {
      console.error('[loadSessionsList] DB load failed:', error);
      if (!(await maybePromptSessionExpired())) {
        setSessionsNotice(`DB load failed, using local cache: ${errorToText(error)}`, 'warn');
      }
      // Fall through to localStorage
    }
  }

    // Fallback to localStorage
    sessionsListMemoryCache = Array.isArray(cachedSessions) ? cachedSessions : [];
    return sessionsListMemoryCache;
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

  // Explicit load = the user chose this session; normal slot-fingerprint
  // continuation is intended again.
  setSuppressSlotRestore(false);
  const sessionSlotConfig = session.slotConfig || session.slot_config || {};
  const sessionSlotUrls = session.slotUrls || session.slot_urls || {};
  const sessionSlotEnabled = session.slotEnabled || session.slot_enabled || {};
  const sessionPrompt = String(session.name || session.title || '').trim();

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
      updateSlotToggleVisualState(slot);
      updateSlotWindowVisualState(slot);
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
      updateSlotToggleIcon(slot, serviceId);
    }

    if (!slotEnabled[slot]) {
      updateSlotLabel(slot, serviceId || slotConfig[slot]);
      updateSlotToggleIcon(slot, serviceId || slotConfig[slot]);
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
    updateSlotToggleIcon(slot, serviceId || slotConfig[slot]);
  });
  saveSlotConfig(slotConfig);

  // Restore session context so subsequent messages continue in THIS session
  const numericId = Number(session.sessionId ?? session.session_id ?? sessionId);
  const restoredAggregatedNoteId = String(session.noteId ?? session.note_id ?? '').trim() || null;
  if (Number.isInteger(numericId) && numericId > 0) {
    activeSessionId = numericId;
    activeAggregatedNoteId = restoredAggregatedNoteId;
    activeSessionPrompt = sessionPrompt;
    if (window.mergeApiClient && sessionPrompt) {
      window.mergeApiClient.lastSourcePrompt = sessionPrompt;
    }
    const enabledSlots = SLOTS.filter(slot => slotEnabled[slot]);
    const fingerprint = buildSessionFingerprint(enabledSlots);
    activeSessionFingerprint = fingerprint;
    persistSessionContext(numericId, fingerprint, restoredAggregatedNoteId);
    setIngestSessionIndicator(numericId);
  } else {
    clearStoredSessionContext();
    clearIngestSessionIndicator();
  }

  // Restore the session's project (state/chip only). The session's own slot
  // URLs were just applied above, so project activation must not clobber them.
  const sessionProjectTagId = String(session.projectTagId ?? session.project_tag_id ?? '').trim() || null;
  if (sessionProjectTagId && sessionProjectTagId !== activeProjectId) {
    const projectNode = findProjectNodeById(projectTreeNodes, sessionProjectTagId);
    await setActiveProject(projectNode || sessionProjectTagId, { applySlotUrls: false });
  }

  console.log('Session loaded:', sessionId, '? activeSessionId =', activeSessionId);
  setSessionsNotice(`Session loaded: ${session.name || sessionId}`, 'ok');
  updateAggregationActionButtons();
  await updateSessionsUI({ forceRefresh: true });
}

  async function deleteSession(sessionId) {
    const sessions = await loadSessionsList();
    const session = sessions.find((s) => s.id === sessionId) || null;

    // Delete from database first (skip entirely in local-only / signed-out mode)
    let signedInForDelete = false;
    try {
      const authStatus = await window.electronAPI?.authGetStatus?.();
      signedInForDelete = !!authStatus?.signedIn;
    } catch (_) {
      signedInForDelete = false;
    }
    if (signedInForDelete && window.electronAPI?.deleteSession) {
      try {
        await window.electronAPI.deleteSession({
          recordId: String(session?.id ?? sessionId),
          sessionId: Number.isInteger(session?.sessionId)
            ? session.sessionId
            : (Number.isInteger(session?.session_id) ? session.session_id : null),
          noteId: String(session?.noteId ?? session?.note_id ?? '').trim() || null
        });
      console.log('[deleteSession] Deleted from DB:', sessionId);
      setSessionsNotice(`Deleted from database: ${sessionId}`, 'ok');
    } catch (error) {
      console.error('[deleteSession] DB delete failed:', error);
        setSessionsNotice(`DB delete failed, cleaning local cache only: ${errorToText(error)}`, 'warn');
      }
    }

    // Update local cache
    const filtered = sessions.filter((s) => s.id !== sessionId);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(filtered));
    writeJsonCache(SESSIONS_META_KEY, { fetchedAt: Date.now() });
    sessionsListMemoryCache = filtered;
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

function renderSessionsIntoContainer(container, sessions) {
  if (!container) return;
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

    const displayTime = session.displayAt || session.display_at || session.createdAt || session.created_at || session.updatedAt || session.updated_at || session.timestamp || Date.now();
    const timeStr = new Date(displayTime).toLocaleString('ru-RU', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const activeSlots = SLOTS.filter(s => slotEnabledMap[s] !== false).map(s => {
      const service = slotConfigMap[s] || 'unknown';
      return service.replace(/_api$/, '').toUpperCase();
    }).join(', ');
    const sessionKey = String(session.id || '');
    const sessionTitle = String(session.name || activeSlots || '(no slots)');
    const expanded = expandedSessionTitleIds.has(sessionKey);

    item.innerHTML = `
      <div class="session-item-header">
        <div class="session-item-title-line">
          <span class="session-item-id">#${displaySessionId}</span>
          <span class="session-item-title ${expanded ? 'expanded' : ''}">${sessionTitle}</span>
        </div>
        <button class="session-item-chevron" data-session-toggle="${sessionKey}" style="display:none;"></button>
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

  container.querySelectorAll('.session-item').forEach((item) => {
    const titleEl = item.querySelector('.session-item-title');
    const button = item.querySelector('[data-session-toggle]');
    const sessionId = String(button?.getAttribute('data-session-toggle') || '');
    if (!titleEl || !button || !sessionId) return;

    const wasExpanded = titleEl.classList.contains('expanded');
    if (wasExpanded) titleEl.classList.remove('expanded');
    const shouldShowChevron = titleEl.scrollHeight > titleEl.clientHeight + 1;
    if (wasExpanded) titleEl.classList.add('expanded');

    if (!shouldShowChevron) {
      expandedSessionTitleIds.delete(sessionId);
      button.remove();
      return;
    }

    button.style.display = '';
    button.textContent = expandedSessionTitleIds.has(sessionId) ? '\u25B4 Hide' : '\u25BE More';
  });

  container.querySelectorAll('[data-session-toggle]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sessionId = String(button.getAttribute('data-session-toggle') || '');
      if (!sessionId) return;
      if (expandedSessionTitleIds.has(sessionId)) {
        expandedSessionTitleIds.delete(sessionId);
      } else {
        expandedSessionTitleIds.add(sessionId);
      }
      updateSessionsUI().catch(err => console.warn('[sessions-toggle] refresh failed:', err));
    });
  });
}

async function updateSessionsUI(options = {}) {
  const containers = Array.from(document.querySelectorAll('.sessions-list'));
  if (containers.length === 0) return;

  const allSessions = await loadSessionsList(options);
  const query = String(sessionsSearchQuery || '').trim().toLowerCase();
  const sessions = query
    ? allSessions.filter((session) => {
        const sessionId = String(session.sessionId ?? session.session_id ?? '').trim().toLowerCase();
        const name = String(session.name || session.title || '').trim().toLowerCase();
        return sessionId.includes(query) || name.includes(query);
      })
    : allSessions;
  containers.forEach((container) => renderSessionsIntoContainer(container, sessions));
}

// Initialize sessions UI and save button
async function initSessionsTab() {
  await updateSessionsUI();

  const sessionsPopup = document.getElementById('sessions-popup');
  const sessionsPopupClose = document.getElementById('sessions-popup-close');
  const syncSessionsSearchInputs = () => {
    document.querySelectorAll('.sessions-search-input').forEach((input) => {
      if (input.value !== sessionsSearchQuery) input.value = sessionsSearchQuery;
    });
  };

  document.querySelectorAll('.sessions-search-input').forEach((sessionsSearchInput) => {
    sessionsSearchInput.value = sessionsSearchQuery;
    sessionsSearchInput.addEventListener('input', (event) => {
      sessionsSearchQuery = String(event?.target?.value || '');
      syncSessionsSearchInputs();
      updateSessionsUI().catch(err => console.warn('[sessions-search] refresh failed:', err));
    });
  });

  document.querySelectorAll('.save-session-action').forEach((saveSessionBtn) => {
    saveSessionBtn.addEventListener('click', async () => {
      const originalText = 'Save Current';
      saveSessionBtn.disabled = true;
      saveSessionBtn.textContent = 'Saving...';
      try {
        const saved = await saveSessionSnapshot();
        saveSessionBtn.textContent = saved?.id ? 'Saved!' : 'Saved locally';
      } catch (error) {
        console.error('[saveSessionBtn] save failed:', error);
        saveSessionBtn.textContent = 'Save failed';
      } finally {
        setTimeout(() => {
          saveSessionBtn.disabled = false;
          saveSessionBtn.textContent = originalText;
        }, 1500);
      }
    });
  });

  document.querySelectorAll('.reset-session-action').forEach((resetSessionBtn) => {
    resetSessionBtn.addEventListener('click', async () => {
      const originalText = 'Reset';
      resetSessionBtn.disabled = true;
      resetSessionBtn.textContent = 'Resetting...';
      try {
        resetActiveSessionContext();
        setSessionsNotice('Current session context reset. Next send/collect will create or resolve a fresh question root.', 'ok');
        await updateSessionsUI();
        resetSessionBtn.textContent = 'Reset';
      } catch (error) {
        console.error('[resetSessionBtn] reset failed:', error);
        setSessionsNotice(`Session reset failed: ${errorToText(error)}`, 'warn');
        resetSessionBtn.textContent = 'Reset failed';
      } finally {
        setTimeout(() => {
          resetSessionBtn.disabled = false;
          resetSessionBtn.textContent = originalText;
        }, 1200);
      }
    });
  });

  document.querySelectorAll('.refresh-sessions-action').forEach((refreshSessionsBtn) => {
    refreshSessionsBtn.addEventListener('click', async () => {
      const now = Date.now();
      if (sessionsRefreshInFlight || now < sessionsRefreshLockedUntil) return;
      sessionsRefreshInFlight = true;
      sessionsRefreshLockedUntil = now + REFRESH_COOLDOWN_MS;
      const originalText = refreshSessionsBtn.textContent || '↻';
      refreshSessionsBtn.disabled = true;
      refreshSessionsBtn.textContent = '…';
      try {
        await updateSessionsUI({ forceRefresh: true });
        refreshSessionsBtn.textContent = '✓';
      } catch (error) {
        console.error('[refreshSessionsBtn] refresh failed:', error);
        refreshSessionsBtn.textContent = '!';
      } finally {
        setTimeout(() => {
          sessionsRefreshInFlight = false;
          refreshSessionsBtn.disabled = false;
          refreshSessionsBtn.textContent = originalText;
        }, Math.max(0, sessionsRefreshLockedUntil - Date.now()));
      }
    });
  });

  const closeSessionsPopup = () => {
    sessionsPopup?.classList.remove('open');
    ingestSessionIndicator?.classList.remove('open');
  };

  const positionSessionsPopup = () => {
    if (!sessionsPopup || !ingestSessionIndicator) return;
    const indicatorRect = ingestSessionIndicator.getBoundingClientRect();
    const popupWidth = Math.min(430, window.innerWidth - 28);
    const estimatedHeight = Math.min(620, window.innerHeight - 96);
    const left = Math.max(14, Math.min(window.innerWidth - popupWidth - 14, indicatorRect.left + indicatorRect.width / 2 - popupWidth / 2));
    const top = Math.max(14, indicatorRect.top - estimatedHeight - 10);
    sessionsPopup.style.setProperty('--sessions-popup-left', `${Math.round(left)}px`);
    sessionsPopup.style.setProperty('--sessions-popup-top', `${Math.round(top)}px`);
  };

  const toggleSessionsPopup = async () => {
    if (!sessionsPopup || !ingestSessionIndicator) return;
    const nextOpen = !sessionsPopup.classList.contains('open');
    if (nextOpen) positionSessionsPopup();
    sessionsPopup.classList.toggle('open', nextOpen);
    ingestSessionIndicator.classList.toggle('open', nextOpen);
    if (nextOpen) {
      await updateSessionsUI();
      positionSessionsPopup();
    }
  };

  ingestSessionIndicator?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSessionsPopup().catch(err => console.warn('[sessions-popup] open failed:', err));
  });
  sessionsPopupClose?.addEventListener('click', (event) => {
    event.preventDefault();
    closeSessionsPopup();
  });
  sessionsPopup?.addEventListener('click', (event) => {
    event.stopPropagation();
  });
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (sessionsPopup?.contains(target) || ingestSessionIndicator?.contains(target)) return;
    closeSessionsPopup();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSessionsPopup();
  });
  window.addEventListener('resize', () => {
    if (sessionsPopup?.classList.contains('open')) positionSessionsPopup();
  });

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
  document.addEventListener('DOMContentLoaded', initAboutButton);
} else {
  initSessionsTab();
  initAboutButton();
}

console.log('Renderer initialized');
