package com.chataggregator.app

import com.google.gson.Gson

/**
 * Generates JavaScript code to inject a message into an AI chat webpage.
 * Optimized for modern React/Next.js interfaces like Perplexity.
 */
object MessageInjector {

    private val gson = Gson()

    fun buildSendScript(message: String, selectors: ServiceSelectors, serviceId: String? = null): String {
        val messageJson = gson.toJson(message)
        val serviceIdJson = gson.toJson(serviceId ?: "")
        val selectorsMap = mapOf(
            "textarea" to selectors.textarea,
            "contenteditable" to selectors.contenteditable,
            "button" to selectors.button
        )
        val selectorsJson = gson.toJson(selectorsMap)

        return """
(function() {
  try {
    const message = $messageJson;
    const serviceId = $serviceIdJson;
    const selectors = $selectorsJson;

    function isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function findInput() {
      const candidates = [];
      for (const sel of [...(selectors.textarea || []), ...(selectors.contenteditable || [])]) {
        document.querySelectorAll(sel).forEach(el => {
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
          if (bottom > bestBottom) { bestBottom = bottom; best = el; }
        }
      }
      return best;
    }

    function fillInput(el, value) {
      el.focus();
      document.execCommand('selectAll', false, null);
      if (!document.execCommand('insertText', false, value)) {
        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
          el.value = value;
        } else {
          el.innerText = value;
        }
      }
      const evts = ['input', 'change', 'beforeinput'];
      evts.forEach(name => {
        el.dispatchEvent(new Event(name, { bubbles: true }));
      });
    }

    function findSendButton(inputEl) {
      for (const sel of (selectors.button || [])) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && isVisible(btn)) return btn;
      }
      
      const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
      let best = null;
      let maxScore = -1;

      buttons.forEach(btn => {
        if (btn.disabled || !isVisible(btn)) return;
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

    function pressEnter(el, ctrl = false) {
      const opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: ctrl };
      el.dispatchEvent(new KeyboardEvent('keydown', opts));
      el.dispatchEvent(new KeyboardEvent('keypress', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', opts));
    }

    const inputEl = findInput();
    if (!inputEl) {
      console.log('Gunshi-JS: Input not found');
      return JSON.stringify({ success: false, error: 'Input not found' });
    }

    console.log('Gunshi-JS: Found input: ' + inputEl.tagName);

    if (serviceId === 'perplexity') {
      fillInput(inputEl, ' '); 
      setTimeout(() => {
        fillInput(inputEl, message);
        console.log('Gunshi-JS: Real message filled');
        setTimeout(() => {
          const btn = findSendButton(inputEl);
          if (btn) {
            console.log('Gunshi-JS: Clicking button: ' + (btn.getAttribute('aria-label') || 'unlabeled'));
            btn.click();
          } else {
            console.log('Gunshi-JS: No button found, using Enter');
            pressEnter(inputEl, true);
            pressEnter(inputEl, false);
          }
        }, 400);
      }, 100);
    } else {
      fillInput(inputEl, message);
      const delay = (serviceId === 'deepseek') ? 400 : 150;
      setTimeout(() => {
        const btn = findSendButton(inputEl);
        if (btn) btn.click();
        pressEnter(inputEl, false);
      }, delay);
    }

    return JSON.stringify({ success: true, via: 'optimized-hybrid-v5', sent: true });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message || String(e) });
  }
})();
"""
    }

    fun buildAttachFileScript(): String {
        return """
(function() {
  try {
    function isVisible(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(el => !el.disabled);
    if (fileInputs.length > 0) {
      fileInputs[0].click();
      return JSON.stringify({ success: true, mode: 'input-file' });
    }
    const buttons = Array.from(document.querySelectorAll('button,[role="button"],label')).filter(isVisible);
    const attachBtn = buttons.find((el) => {
      const joined = (el.textContent + ' ' + el.getAttribute('aria-label') + ' ' + el.className).toLowerCase();
      return joined.includes('attach') || joined.includes('upload') || joined.includes('file');
    });
    if (attachBtn) {
      attachBtn.click();
      return JSON.stringify({ success: true, mode: 'attach-button' });
    }
    return JSON.stringify({ success: false, error: 'Attach control not found' });
  } catch (e) {
    return JSON.stringify({ success: false, error: e.message || String(e) });
  }
})();
"""
    }
}
