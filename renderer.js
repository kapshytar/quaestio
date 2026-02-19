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
  zoomLevels[slot] = 1.0;
  webviewReady[slot] = false;
  pendingNavigation[slot] = null;
});

const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const importCookiesBtn = document.getElementById('import-cookies-btn');
const toggleAddressBarBtn = document.getElementById('toggle-address-bar-btn');
const collapseBtn = document.getElementById('collapse-toolbar');
const togglesContainer = document.getElementById('toggles');

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
let selectedMergeProviderId = 'chatgpt_api';
let focusedSearchScope = 'global'; // global | merge | slot-1..slot-4
let searchSession = { query: '', scope: 'global' };
const mergeSearchState = { query: '', marks: [], index: -1 };

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

  // Try reload() first regardless of ready state — it works once webview is attached
  try {
    webview.reload();
    return;
  } catch (err) {
    console.warn(`[${slot}] reload() failed, trying loadURL fallback:`, err?.message || err);
  }

  // Fallback: get current URL via getURL() or pendingNavigation or static src
  let fallbackUrl = pendingNavigation[slot];
  if (!fallbackUrl) {
    try { fallbackUrl = webview.getURL(); } catch (e) {}
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
  if (preset) {
    webview.src = preset.url;
    const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
    if (urlInput) urlInput.value = preset.url;
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

    const preset = SERVICE_PRESETS[serviceId];
    if (preset) {
      safeLoadURL(slot, preset.url);
      const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
      if (urlInput) urlInput.value = preset.url;
    } else {
      // Custom — user types URL in address bar
      const urlInput = document.querySelector(`[data-slot="${slot}"] .webview-url`);
      if (urlInput) {
        urlInput.value = '';
        urlInput.focus();
      }
    }
  });
});

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
        zoomLevels[slot] = 1.0;
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

    const savedZoom = localStorage.getItem(`zoom-${slot}`);
    if (savedZoom) {
      zoomLevels[slot] = parseFloat(savedZoom);
      try {
        await webview.setZoomFactor(zoomLevels[slot]);
        updateZoomDisplay();
      } catch (err) {
        console.error(`Failed to restore zoom for ${slot}:`, err);
      }
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

// Apply mobile UA on startup (just set attribute, no reload needed — webviews load with it)
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

  console.log(`[MobileUA] ${mobileUaEnabled ? 'Mobile' : 'Desktop'} UA — all ${SLOTS.length} webviews reloading`);
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
    } catch (_) {}
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
      try { webviews[slot]?.findInPage(query, options); } catch (_) {}
    });
    return;
  }

  if (!SLOTS.includes(scope)) return;
  try { webviews[scope]?.findInPage(query, options); } catch (_) {}
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

  if (searchOverlay?.classList.contains('visible') && e.key === 'Escape') {
    e.preventDefault();
    closeSearchOverlay();
  }
});

searchInput?.addEventListener('input', () => runScopedSearch('forward'));
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
  } catch (e) {}

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
  try { currentUrl = webview.getURL(); } catch (e) {}
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

  for (const slot of SLOTS) {
    if (toggles[slot] && toggles[slot].checked) {
      await sendMessage(slot, text);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  messageInput.value = '';
  messageInput.focus();
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

  // Hook client log → debug panel
  if (window.mergeApiClient) {
    window.mergeApiClient.onLog = (msg, type, detail) => mergeLog(msg, type, detail);
  }

  loadMergeConfig();

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
  // Always start collapsed — user can expand manually during session
  let tabsCollapsed = true;

  function applyTabsCollapsed() {
    if (tabsCollapsed) {
      tabsBody?.classList.add('collapsed');
      if (tabsCollapseBtn) tabsCollapseBtn.textContent = '▼';
    } else {
      tabsBody?.classList.remove('collapsed');
      if (tabsCollapseBtn) tabsCollapseBtn.textContent = '▲';
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
  } catch (e) {}
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

    function cleanText(t) { return (t || '').replace(/\\s+/g, ' ').trim(); }

    const selectors = [
      '[data-message-author-role="assistant"]',
      '[data-testid*="assistant"]',
      '[class*="assistant"]',
      '[class*="response"]',
      '[class*="answer"]',
      '[class*="message"]'
    ];

    // Perplexity: prepend prose selector
    if (serviceId === 'perplexity') { selectors.unshift('div[class*="prose"]'); }

    const candidates = [];
    selectors.forEach((sel) => {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!visible(el)) return;
          const txt = cleanText(el.innerText || el.textContent);
          if (txt.length >= 20) { candidates.push({ el: el, text: txt, bottom: el.getBoundingClientRect().bottom }); }
        });
      } catch (_) {}
    });

    // Fallback: any visible article/div with enough text
    if (candidates.length === 0) {
      Array.from(document.querySelectorAll('article, div')).filter(visible).forEach((el) => {
        const txt = cleanText(el.innerText || el.textContent);
        if (txt.length >= 80) { candidates.push({ el: el, text: txt, bottom: el.getBoundingClientRect().bottom }); }
      });
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.bottom - a.bottom);
    return candidates[0].text;

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
  const results = {};

  for (const slot of enabledSlots) {
    // Use service name from preset, not toggle label
    let currentUrl = '';
    try { currentUrl = webviews[slot]?.getURL() || ''; } catch (e) {}
    const serviceId = detectServiceByUrl(currentUrl) || slotConfig[slot] || slot;
    const serviceName = SERVICE_PRESETS[serviceId]?.name || labels[slot]?.textContent || slot;

    const reply = await getLatestAssistantReply(slot);
    if (reply && reply.trim().length > 0) {
      const preview = reply.length > 120 ? reply.slice(0, 120) + '…' : reply;
      mergeLog(`${serviceName}: scraped ${reply.length} chars — "${preview}"`, 'scrape', reply);
      results[serviceName] = reply;
    } else {
      mergeLog(`${serviceName}: no reply found (slot=${slot}, url=${currentUrl.slice(0,60)})`, 'warn');
    }
  }

  return results;
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

  const prefix = { info: '·', send: '↑', recv: '↓', error: '✗', warn: '!', scrape: '◎' }[type] || '·';

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
    header.innerHTML = `<span class="debug-ts">${ts}</span><span>${prefix} ${message}</span>`;
    header.appendChild(expandBtn);
    entry.appendChild(header);
    entry.appendChild(body);
  } else {
    entry.innerHTML = `<span class="debug-ts">${ts}</span>${prefix} ${message}`;
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

  if (!window.mergeApiClient.apiKey) {
    setMergeStatus('API key required', 'error');
    return;
  }

  // Sync UI → client before calling API
  saveMergeConfig();

  const client = window.mergeApiClient;
  const providerInfo = `${client.provider?.id || '?'} / ${client.model || client.provider?.defaultModel || '?'}`;
  mergeLog(isClarification ? `Follow-up: "${clarificationText}"` : `Starting merge`, 'info');
  mergeLog(`Provider: ${providerInfo}`, 'info');

  mergeInProgress = true;
  setMergeStatus(isClarification ? 'Processing follow-up...' : 'Collecting responses...', 'running');
  if (runMergeBtn) runMergeBtn.disabled = true;
  if (isClarification && clarificationSendBtn) clarificationSendBtn.disabled = true;

  let responses;

  if (isClarification) {
    // Reuse saved responses from first merge for context
    responses = lastScrapedResponses;
  } else {
    responses = await collectLatestRepliesFromEnabledSlots();

    if (Object.keys(responses).length === 0) {
      mergeLog('No responses collected — nothing to merge', 'error');
      mergeInProgress = false;
      if (runMergeBtn) runMergeBtn.disabled = false;
      if (clarificationSendBtn) clarificationSendBtn.disabled = false;
      setMergeStatus('No responses to merge. Send messages first.', 'error');
      return;
    }
    lastScrapedResponses = responses; // save for clarification context
    mergeHistory = ''; // reset conversation on new merge
    mergeLog(`Collected from: ${Object.keys(responses).join(', ')}`, 'info');
  }

  setMergeStatus(isClarification ? 'Processing follow-up...' : 'Running merge...', 'running');

  const result = await window.mergeApiClient.merge(
    responses,
    isClarification,
    clarificationText,
    previousSummary
  );

  mergeInProgress = false;
  if (runMergeBtn) runMergeBtn.disabled = false;
  if (clarificationSendBtn) clarificationSendBtn.disabled = false;

  if (result.success) {
    const cleanResponse = result.text.split('\n\n---')[0].trim();
    if (mergeHistory === '') {
      mergeHistory = `Assistant: ${cleanResponse}`;
    } else {
      mergeHistory += `\n\nAssistant: ${cleanResponse}`;
    }

    updateMergeResult(result.text);
    setMergeStatus(isClarification ? 'Follow-up complete' : 'Merge complete', 'idle');

    if (clarificationContainer) {
      clarificationContainer.classList.add('visible');
      clarificationInput?.focus();
    }
  } else {
    setMergeStatus(`Failed: ${result.error}`, 'error');
  }
}

console.log('Renderer initialized');
