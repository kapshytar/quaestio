(function attachIncognitoPolicy(global) {
  const CHATGPT_TEMP_PARAM = 'temporary-chat';
  const CHATGPT_TEMP_ROOT = 'https://chatgpt.com/';
  const CLAUDE_TEMP_PARAM = 'incognito';
  const CLAUDE_TEMP_ROOT = 'https://claude.ai/new';
  const ACTIVE_TEXT_PATTERNS = [
    /temporary\s+chat/i,
    /incognito/i,
    /private\s+chat/i,
    /history\s+off/i
  ];
  const TARGET_TEXT_PATTERNS = [
    /temporary\s+chat/i,
    /start\s+temporary\s+chat/i,
    /incognito/i,
    /private\s+chat/i,
    /history\s+off/i,
    /turn\s+off\s+history/i
  ];

  function normalizeUrl(serviceId, rawUrl, enabled) {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return '';
    if (serviceId === 'claude') {
      try {
        if (enabled) {
          const tempUrl = new URL(CLAUDE_TEMP_ROOT);
          tempUrl.searchParams.set(CLAUDE_TEMP_PARAM, '');
          return tempUrl.toString().replace(/=$/, '');
        }
        const parsed = new URL(trimmed);
        parsed.searchParams.delete(CLAUDE_TEMP_PARAM);
        return parsed.toString();
      } catch (_) {
        return enabled ? `${CLAUDE_TEMP_ROOT}?${CLAUDE_TEMP_PARAM}` : trimmed;
      }
    }
    if (serviceId !== 'chatgpt') return trimmed;

    try {
      if (enabled) {
        const tempUrl = new URL(CHATGPT_TEMP_ROOT);
        tempUrl.searchParams.set(CHATGPT_TEMP_PARAM, 'true');
        return tempUrl.toString();
      }
      const parsed = new URL(trimmed);
      parsed.searchParams.delete(CHATGPT_TEMP_PARAM);
      return parsed.toString();
    } catch (_) {
      return enabled ? `${CHATGPT_TEMP_ROOT}?${CHATGPT_TEMP_PARAM}=true` : trimmed;
    }
  }

  function needsNativeActivation(serviceId, enabled) {
    return Boolean(enabled && serviceId !== 'chatgpt' && serviceId !== 'claude');
  }

  function buildEnsureScript(serviceId) {
    const service = JSON.stringify(String(serviceId || '').trim().toLowerCase());
    return `
      (async () => {
        try {
          const serviceId = ${service};
          const ACTIVE_PATTERNS = ${JSON.stringify(ACTIVE_TEXT_PATTERNS.map((pattern) => pattern.source))}.map((source) => new RegExp(source, 'i'));
          const TARGET_PATTERNS = ${JSON.stringify(TARGET_TEXT_PATTERNS.map((pattern) => pattern.source))}.map((source) => new RegExp(source, 'i'));
          const MENU_SELECTORS = [
            'button[data-test-id="side-nav-menu-button"]',
            'button[aria-label="Main menu"]',
            'button[aria-label*="menu" i]',
            '[role="button"][aria-label*="menu" i]',
            'button[aria-haspopup="menu"]'
          ];
          const GEMINI_MENU_BUTTON_SELECTOR = '#app-root > main > div > side-nav-menu-button > button';
          const GEMINI_TEMP_BUTTON_SELECTOR = '#app-root > main > side-navigation-v2 > bard-sidenav-container > bard-sidenav > side-navigation-content > div > div > mat-action-list.mat-mdc-action-list.mat-mdc-list-base.mdc-list.top-action-list.ng-star-inserted > side-nav-action-button > temp-chat-button > button';
          const GEMINI_SIDENAV_SELECTOR = '#app-root > main > side-navigation-v2 > bard-sidenav-container > bard-sidenav > side-navigation-content > div > div';
          const GROK_PRIVATE_SELECTOR = 'a[href="/c#private"], a[href$="#private"]';
          const CLAUDE_PRIVATE_BUTTON_SELECTOR = '#main-content > div > div > div > button';

          const visible = (el) => {
            if (!el || !(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

          const readText = (el) => {
            return [
              el?.innerText,
              el?.textContent,
              el?.getAttribute?.('aria-label'),
              el?.getAttribute?.('title'),
              el?.getAttribute?.('data-placeholder'),
              el?.getAttribute?.('data-test-id')
            ]
              .filter(Boolean)
              .join(' ')
              .replace(/\\s+/g, ' ')
              .trim();
          };

          const isInsideGeminiSidenav = (el) => {
            const sidenav = document.querySelector(GEMINI_SIDENAV_SELECTOR);
            return Boolean(sidenav && el instanceof Element && sidenav.contains(el));
          };

          const hasGeminiStrongMarker = () => {
            const selectors = [
              '[data-test-id="temporary-chat-header"]',
              '[data-placeholder*="temporary chat" i]',
              '[data-placeholder*="incognito" i]',
              '[data-placeholder*="private chat" i]'
            ];
            return selectors.some((selector) => {
              const node = document.querySelector(selector);
              return node && visible(node) && !isInsideGeminiSidenav(node);
            });
          };

          const clickGeminiMenuButton = async () => {
            const button = document.querySelector(GEMINI_MENU_BUTTON_SELECTOR);
            if (!button || !visible(button)) {
              return { ok: false, stage: 'gemini-menu-missing' };
            }
            button.click();
            await wait(220);
            return { ok: true, stage: 'gemini-menu-opened' };
          };

          const waitForGeminiTempButton = async () => {
            for (let attempt = 0; attempt < 10; attempt += 1) {
              const button = document.querySelector(GEMINI_TEMP_BUTTON_SELECTOR);
              if (button && visible(button)) return button;
              await wait(120);
            }
            return null;
          };

          const closeGeminiSidePanel = async () => {
            const sidenav = document.querySelector(GEMINI_SIDENAV_SELECTOR);
            if (!sidenav || !visible(sidenav)) {
              return { ok: true, stage: 'gemini-sidepanel-closed' };
            }
            const button = document.querySelector(GEMINI_MENU_BUTTON_SELECTOR);
            if (button && visible(button)) {
              button.click();
              await wait(260);
            } else {
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
              await wait(260);
            }
            const stillOpen = (() => {
              const next = document.querySelector(GEMINI_SIDENAV_SELECTOR);
              return Boolean(next && visible(next));
            })();
            return { ok: !stillOpen, stage: stillOpen ? 'gemini-sidepanel-still-open' : 'gemini-sidepanel-closed' };
          };

          const documentLooksIncognito = () => {
            if (serviceId === 'grok') {
              return /#private$/i.test(String(location.hash || '')) || /#private$/i.test(String(location.href || ''));
            }
            if (serviceId === 'claude') {
              const button = document.querySelector(CLAUDE_PRIVATE_BUTTON_SELECTOR);
              const stateNode = button?.closest('[data-state]');
              const stateValue = stateNode?.getAttribute('data-state');
              return Boolean(stateValue && stateValue !== 'closed');
            }
            const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [data-testid], [data-test-id], [aria-label], [title], [data-placeholder]'));
            return candidates.some((node) => {
              if (!visible(node)) return false;
              if (serviceId === 'gemini' && isInsideGeminiSidenav(node)) return false;
              const text = readText(node);
              return ACTIVE_PATTERNS.some((pattern) => pattern.test(text));
            });
          };

          const clickMatchingTarget = () => {
            const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [data-testid], [data-test-id], [aria-label], [title], [data-placeholder]'));
            for (const node of candidates) {
              if (!visible(node)) continue;
              if (serviceId === 'gemini' && isInsideGeminiSidenav(node)) continue;
              const text = readText(node);
              if (!TARGET_PATTERNS.some((pattern) => pattern.test(text))) continue;
              node.click();
              return { ok: true, stage: 'clicked-target', text };
            }
            return { ok: false, stage: 'target-not-found' };
          };

          if (serviceId === 'gemini') {
            if (hasGeminiStrongMarker()) {
              const closeResult = await closeGeminiSidePanel();
              return { ok: true, serviceId, stage: closeResult.stage };
            }
            const openResult = await clickGeminiMenuButton();
            if (!openResult.ok) return { ok: false, serviceId, stage: openResult.stage };
            const tempButton = await waitForGeminiTempButton();
            if (!tempButton) return { ok: false, serviceId, stage: 'gemini-temp-button-missing' };
            tempButton.click();
            await wait(320);
            const closeResult = await closeGeminiSidePanel();
            return { ok: true, serviceId, stage: closeResult.stage };
          }

          if (serviceId === 'grok') {
            if (documentLooksIncognito()) {
              return { ok: true, serviceId, stage: 'already-active' };
            }
            const target = document.querySelector(GROK_PRIVATE_SELECTOR);
            if (!target || !visible(target)) {
              return { ok: false, serviceId, stage: 'grok-private-missing' };
            }
            target.click();
            await wait(320);
            return { ok: documentLooksIncognito(), serviceId, stage: 'grok-private-clicked', label: readText(target) };
          }

          if (serviceId === 'claude') {
            if (documentLooksIncognito()) {
              return { ok: true, serviceId, stage: 'already-active' };
            }
            const button = document.querySelector(CLAUDE_PRIVATE_BUTTON_SELECTOR);
            if (!button || !visible(button)) {
              return { ok: false, serviceId, stage: 'claude-private-missing' };
            }
            button.click();
            await wait(320);
            return { ok: documentLooksIncognito(), serviceId, stage: 'claude-private-clicked' };
          }

          if (documentLooksIncognito()) {
            return { ok: true, serviceId, stage: 'already-active' };
          }

          let targetResult = clickMatchingTarget();
          if (targetResult.ok) {
            await wait(250);
            return { ok: documentLooksIncognito(), serviceId, stage: targetResult.stage, label: targetResult.text };
          }

          for (const selector of MENU_SELECTORS) {
            const menuButton = document.querySelector(selector);
            if (!menuButton || !visible(menuButton)) continue;
            menuButton.click();
            await wait(150);
            targetResult = clickMatchingTarget();
            if (targetResult.ok) {
              await wait(250);
              return { ok: documentLooksIncognito(), serviceId, stage: 'opened-menu-then-clicked', label: targetResult.text, menuSelector: selector };
            }
          }

          return { ok: false, serviceId, stage: 'no-native-toggle-found' };
        } catch (error) {
          return { ok: false, stage: 'exception', error: String((error && error.message) || error) };
        }
      })();
    `;
  }

  function buildProbeScript(serviceId) {
    const service = JSON.stringify(String(serviceId || '').trim().toLowerCase());
    return `
      (() => {
        try {
          const serviceId = ${service};
          const limit = 80;
          const visible = (el) => {
            if (!el || !(el instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
          };
          const readText = (el) => {
            return [
              el?.innerText,
              el?.textContent,
              el?.getAttribute?.('aria-label'),
              el?.getAttribute?.('title'),
              el?.getAttribute?.('data-placeholder'),
              el?.getAttribute?.('data-test-id')
            ]
              .filter(Boolean)
              .join(' ')
              .replace(/\\s+/g, ' ')
              .trim()
              .slice(0, 240);
          };
          const cssPath = (el) => {
            if (!el || !(el instanceof Element)) return '';
            const parts = [];
            let node = el;
            while (node && node.nodeType === 1 && parts.length < 6) {
              let part = node.tagName.toLowerCase();
              if (node.id) {
                part += '#' + node.id;
                parts.unshift(part);
                break;
              }
              const dataTestId = node.getAttribute('data-test-id');
              if (dataTestId) part += '[data-test-id="' + dataTestId + '"]';
              else if (node.classList.length > 0) part += '.' + Array.from(node.classList).slice(0, 2).join('.');
              parts.unshift(part);
              node = node.parentElement;
            }
            return parts.join(' > ');
          };
          const snapshotNode = (el) => ({
            tag: el.tagName.toLowerCase(),
            text: readText(el),
            path: cssPath(el),
            ariaLabel: el.getAttribute('aria-label') || '',
            title: el.getAttribute('title') || '',
            dataTestId: el.getAttribute('data-test-id') || '',
            role: el.getAttribute('role') || '',
            placeholder: el.getAttribute('data-placeholder') || ''
          });

          const menuSelectors = [
            'button[data-test-id="bard-mode-menu-button"]',
            'button[data-test-id="side-nav-menu-button"]',
            'button[aria-label="Main menu"]',
            'button[aria-label*="menu" i]',
            '[role="button"][aria-label*="menu" i]',
            'button[aria-haspopup="menu"]'
          ];
          const activeSelectors = [
            '[data-test-id="temporary-chat-header"]',
            '[data-placeholder*="temporary chat" i]',
            '[data-placeholder*="incognito" i]',
            '[data-placeholder*="private chat" i]'
          ];
          const menus = menuSelectors
            .map((selector) => ({ selector, node: document.querySelector(selector) }))
            .filter((entry) => entry.node && visible(entry.node))
            .map((entry) => ({ selector: entry.selector, ...snapshotNode(entry.node) }));
          const activeMarkers = activeSelectors
            .map((selector) => ({ selector, node: document.querySelector(selector) }))
            .filter((entry) => entry.node && visible(entry.node))
            .map((entry) => ({ selector: entry.selector, ...snapshotNode(entry.node) }));
          const clickable = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [tabindex]'))
            .filter(visible)
            .map(snapshotNode)
            .filter((entry) => entry.text || entry.ariaLabel || entry.dataTestId)
            .slice(0, limit);
          const tempish = clickable.filter((entry) =>
            /temporary|incognito|private chat|history off|turn off history|mode/i.test(
              [entry.text, entry.ariaLabel, entry.title, entry.dataTestId].join(' ')
            )
          );
          return {
            ok: true,
            serviceId,
            url: location.href,
            title: document.title,
            activeMarkers,
            menus,
            tempish,
            clickableCount: clickable.length,
            clickable
          };
        } catch (error) {
          return { ok: false, error: String((error && error.message) || error) };
        }
      })();
    `;
  }

  global.IncognitoPolicy = {
    normalizeUrl,
    needsNativeActivation,
    buildEnsureScript,
    buildProbeScript
  };
})(window);
