(function registerSendMessageScript(global) {
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function findInput(selectors) {
    const candidates = [];
    for (const sel of [...(selectors.textarea || []), ...(selectors.contenteditable || [])]) {
      document.querySelectorAll(sel).forEach((el) => {
        if (isVisible(el) && !el.closest('article')) candidates.push(el);
      });
    }
    if (candidates.length > 0) return candidates[0];

    const generic = document.querySelectorAll('textarea, [contenteditable="true"], [role="textbox"]');
    let best = null;
    let bestBottom = -1;
    for (const el of generic) {
      if (isVisible(el) && !el.closest('article')) {
        const bottom = el.getBoundingClientRect().bottom;
        if (bottom > bestBottom) {
          bestBottom = bottom;
          best = el;
        }
      }
    }
    return best;
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
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
  }

  function fillInput(el, value, serviceId) {
    el.focus();

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      document.execCommand('selectAll', false, null);
      if (!document.execCommand('insertText', false, value)) {
        el.value = value;
      }
      ['input', 'change', 'beforeinput'].forEach((name) => {
        el.dispatchEvent(new Event(name, { bubbles: true }));
      });
      return;
    }

    // Contenteditable (Claude/Gemini/Grok). Mirror the working desktop path:
    // execCommand('insertText') fills the DOM but doesn't reliably update the
    // editor's ProseMirror/React model in a WebView, so the send button stays
    // aria-disabled and Enter is a no-op. A real InputEvent('beforeinput')
    // registers; multiline needs a synthetic paste so line breaks survive
    // (textContent alone collapses them). Gemini's Quill editor uses textContent.
    const hasNewline = String(value || '').indexOf('\n') !== -1;
    if (serviceId === 'gemini' || !hasNewline) {
      el.textContent = value;
      dispatchInputEvents(el, value);
      return;
    }
    try {
      pasteIntoContentEditable(el, value);
    } catch (_) {
      el.textContent = value;
      dispatchInputEvents(el, value);
    }
  }

  function findSendButton(inputEl, selectors) {
    for (const sel of selectors.button || []) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true' && isVisible(btn)) return btn;
    }

    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
    let best = null;
    let maxScore = -1;

    buttons.forEach((btn) => {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || !isVisible(btn)) return;
      if (btn.closest('article')) return;

      const cls = btn.className || '';
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const html = btn.innerHTML.toLowerCase();

      let score = 0;
      if (aria === 'submit' || aria === 'send' || aria === 'ask') score += 50;
      else if (aria.includes('submit') || aria.includes('send') || aria.includes('ask') || aria.includes('query')) score += 30;

      if (html.includes('arrow-up') || html.includes('m12 19') || html.includes('path d=')) score += 20;
      if (cls.includes('bg-button-bg') || cls.includes('bg-super')) score += 15;

      if (inputEl) {
        const container = inputEl.closest('form, [class*="composer"], [class*="input"], [class*="relative"]');
        if (container && container.contains(btn)) score += 20;
      }

      if (aria.includes('edit') || aria.includes('new') || aria.includes('thread') || cls.includes('side') || cls.includes('thread')) score -= 100;

      if (score > maxScore) {
        maxScore = score;
        best = btn;
      }
    });

    return maxScore > 10 ? best : null;
  }

  function pressEnter(el, ctrl) {
    const opts = {
      bubbles: true,
      cancelable: true,
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      ctrlKey: Boolean(ctrl),
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  function run(payload) {
    try {
      const message = String(payload?.message || '');
      const serviceId = String(payload?.serviceId || '');
      const selectors = payload?.selectors && typeof payload.selectors === 'object'
        ? payload.selectors
        : { textarea: [], contenteditable: [], button: [] };

      const inputEl = findInput(selectors);
      if (!inputEl) {
        return JSON.stringify({ success: false, error: 'Input not found' });
      }

      if (serviceId === 'perplexity') {
        fillInput(inputEl, ' ', serviceId);
        setTimeout(() => {
          fillInput(inputEl, message, serviceId);
          setTimeout(() => {
            const btn = findSendButton(inputEl, selectors);
            if (btn) {
              btn.click();
            } else {
              pressEnter(inputEl, true);
              pressEnter(inputEl, false);
            }
          }, 400);
        }, 100);
      } else {
        fillInput(inputEl, message, serviceId);
        const delay = serviceId === 'deepseek' ? 400 : 150;
        setTimeout(() => {
          const btn = findSendButton(inputEl, selectors);
          if (btn) {
            btn.click();
          } else if (inputEl.form && typeof inputEl.form.requestSubmit === 'function') {
            inputEl.form.requestSubmit();
          } else {
            pressEnter(inputEl, false);
          }
        }, delay);
      }

      return JSON.stringify({ success: true, via: 'shared-send-message-v1', sent: true });
    } catch (error) {
      return JSON.stringify({ success: false, error: error?.message || String(error) });
    }
  }

  global.VeritySharedSendMessage = {
    run,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
