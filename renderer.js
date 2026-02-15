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
    url: 'https://grok.x.com',
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

// ========== DETECT SERVICE BY URL ==========
function detectServiceByUrl(url) {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('openai.com') || u.includes('chatgpt.com')) return 'chatgpt';
  if (u.includes('claude.ai')) return 'claude';
  if (u.includes('gemini.google.com') || u.includes('aistudio.google.com')) return 'gemini';
  if (u.includes('grok') || u.includes('x.com')) return 'grok';
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

  if (webviewReady[slot]) {
    try {
      webview.reload();
      return;
    } catch (err) {
      console.warn(`[${slot}] reload failed before ready sync, fallback to src:`, err?.message || err);
    }
  }

  const fallbackUrl = pendingNavigation[slot] || webview.getAttribute('src');
  if (fallbackUrl) {
    webview.src = fallbackUrl;
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

  const messageJson = JSON.stringify(text);
  const selectorsJson = JSON.stringify(selector);

  const code = `
   (async function() {
     const message = ${messageJson};
     const selectors = ${selectorsJson};
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

console.log('Renderer initialized');
