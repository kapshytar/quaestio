package com.chataggregator.app

import java.net.URL

object IncognitoPolicy {
    private const val CHATGPT_TEMP_PARAM = "temporary-chat"
    private const val CHATGPT_TEMP_ROOT = "https://chatgpt.com/"
    private const val CLAUDE_TEMP_PARAM = "incognito"
    private const val CLAUDE_TEMP_ROOT = "https://claude.ai/new"

    fun normalizeUrl(serviceId: String?, rawUrl: String, enabled: Boolean): String {
        val trimmed = rawUrl.trim()
        if (trimmed.isBlank()) return trimmed
        if (serviceId == "claude") {
            return try {
                if (enabled) {
                    "$CLAUDE_TEMP_ROOT?$CLAUDE_TEMP_PARAM"
                } else {
                    val url = URL(trimmed)
                    val uri = android.net.Uri.parse(url.toString()).buildUpon().clearQuery()
                    val existing = android.net.Uri.parse(url.toString())
                    for (name in existing.queryParameterNames) {
                        if (name == CLAUDE_TEMP_PARAM) continue
                        existing.getQueryParameters(name).forEach { value -> uri.appendQueryParameter(name, value) }
                    }
                    uri.build().toString()
                }
            } catch (_: Exception) {
                if (enabled) "$CLAUDE_TEMP_ROOT?$CLAUDE_TEMP_PARAM" else trimmed
            }
        }
        if (serviceId != "chatgpt") return trimmed

        return try {
            if (enabled) {
                val uri = android.net.Uri.parse(CHATGPT_TEMP_ROOT).buildUpon()
                uri.appendQueryParameter(CHATGPT_TEMP_PARAM, "true")
                uri.build().toString()
            } else {
                val url = URL(trimmed)
                val uri = android.net.Uri.parse(url.toString()).buildUpon().clearQuery()
                val existing = android.net.Uri.parse(url.toString())
                for (name in existing.queryParameterNames) {
                    if (name == CHATGPT_TEMP_PARAM) continue
                    existing.getQueryParameters(name).forEach { value -> uri.appendQueryParameter(name, value) }
                }
                uri.build().toString()
            }
        } catch (_: Exception) {
            if (enabled) "$CHATGPT_TEMP_ROOT?$CHATGPT_TEMP_PARAM=true" else trimmed
        }
    }

    fun needsNativeActivation(serviceId: String?, enabled: Boolean): Boolean {
        if (!enabled) return false
        return serviceId != null && serviceId != "chatgpt" && serviceId != "claude"
    }

    fun buildEnsureScript(serviceId: String?): String {
        val serviceLiteral = jsStringLiteral(serviceId?.trim()?.lowercase().orEmpty())
        return """
            (async () => {
              try {
                const serviceId = $serviceLiteral;
                const ACTIVE_PATTERNS = ['temporary\\s+chat', 'incognito', 'private\\s+chat', 'history\\s+off']
                  .map((source) => new RegExp(source, 'i'));
                const TARGET_PATTERNS = ['temporary\\s+chat', 'start\\s+temporary\\s+chat', 'incognito', 'private\\s+chat', 'history\\s+off', 'turn\\s+off\\s+history']
                  .map((source) => new RegExp(source, 'i'));
                const MENU_SELECTORS = [
                  'button[data-test-id="temp-chat-button"]',
                  'button[data-test-id="side-nav-menu-button"]',
                  'button[aria-label="Main menu"]',
                  'button[aria-label*="menu" i]',
                  '[role="button"][aria-label*="menu" i]',
                  'button[aria-haspopup="menu"]'
                ];

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
                    el?.getAttribute?.('data-placeholder')
                  ]
                    .filter(Boolean)
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                };

                const documentLooksIncognito = () => {
                  const selectors = [
                    '[data-test-id="temporary-chat-header"]',
                    '[data-placeholder*="temporary chat" i]',
                    '[data-placeholder*="incognito" i]',
                    '[data-placeholder*="private chat" i]'
                  ];
                  for (const selector of selectors) {
                    const node = document.querySelector(selector);
                    if (node && visible(node)) return true;
                  }

                  if (serviceId === 'gemini') {
                    return false;
                  }

                  const nodes = Array.from(document.querySelectorAll('body *')).filter(visible).slice(0, 400);
                  for (const node of nodes) {
                    const text = readText(node);
                    if (!text) continue;
                    if (ACTIVE_PATTERNS.some((pattern) => pattern.test(text))) return true;
                  }
                  return false;
                };

                const clickMatchingTarget = () => {
                  const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], [role="menuitem"], [tabindex]'))
                    .filter(visible);
                  for (const candidate of candidates) {
                    const text = readText(candidate);
                    if (!text) continue;
                    if (TARGET_PATTERNS.some((pattern) => pattern.test(text))) {
                      candidate.click();
                      return { ok: true, stage: 'clicked-target', text };
                    }
                  }
                  return { ok: false, stage: 'target-missing' };
                };

                const clickGeminiTempButton = () => {
                  const button = document.querySelector('#app-root > main > side-navigation-v2 > bard-sidenav-container > bard-sidenav > side-navigation-content > div > div > mat-action-list.mat-mdc-action-list.mat-mdc-list-base.mdc-list.top-action-list.ng-star-inserted > side-nav-action-button > temp-chat-button > button')
                    || document.querySelector('button[data-test-id="temp-chat-button"][aria-label="Temporary chat"]')
                    || document.querySelector('button[data-test-id="temp-chat-button"]');
                  if (!button || !visible(button)) return { ok: false, stage: 'gemini-temp-button-missing' };
                  const text = readText(button);
                  button.click();
                  return { ok: true, stage: 'clicked-gemini-temp-button', text };
                };

                const clickGeminiMenuButton = () => {
                  const button = document.querySelector('#app-root > main > div > side-nav-menu-button > button')
                    || document.querySelector('button[data-test-id="side-nav-menu-button"]')
                    || document.querySelector('button[aria-label="Main menu"]');
                  if (!button || !visible(button)) return { ok: false, stage: 'gemini-main-menu-missing' };
                  const text = readText(button);
                  button.click();
                  return { ok: true, stage: 'clicked-gemini-main-menu', text };
                };

                const geminiSidenavSelector = '#app-root > main > side-navigation-v2 > bard-sidenav-container > bard-sidenav > side-navigation-content > div > div';
                const isInsideGeminiSidenav = (node) => !!node?.closest?.('side-navigation-v2, bard-sidenav-container, bard-sidenav, side-navigation-content, temp-chat-button');

                const waitForGeminiSidenavOpen = async () => {
                  for (let probe = 1; probe <= 8; probe += 1) {
                    await wait(150);
                    const panel = document.querySelector(geminiSidenavSelector);
                    if (panel && visible(panel)) {
                      return { ok: true, stage: 'gemini-sidenav-open', probe };
                    }
                  }
                  return { ok: false, stage: 'gemini-sidenav-not-open' };
                };

                const waitForGeminiTempButton = async () => {
                  for (let probe = 1; probe <= 8; probe += 1) {
                    await wait(200);
                    const button = document.querySelector('#app-root > main > side-navigation-v2 > bard-sidenav-container > bard-sidenav > side-navigation-content > div > div > mat-action-list.mat-mdc-action-list.mat-mdc-list-base.mdc-list.top-action-list.ng-star-inserted > side-nav-action-button > temp-chat-button > button')
                      || document.querySelector('button[data-test-id="temp-chat-button"][aria-label="Temporary chat"]')
                      || document.querySelector('button[data-test-id="temp-chat-button"]');
                    if (button && visible(button)) {
                      return { ok: true, stage: 'gemini-temp-button-visible', probe };
                    }
                  }
                  return { ok: false, stage: 'gemini-temp-button-still-missing' };
                };

                const closeGeminiSidePanel = async () => {
                  const getCloseButton = () =>
                    document.querySelector('#app-root > main > div > side-nav-menu-button > button')
                    || document.querySelector('button[data-test-id="side-nav-menu-button"]')
                    || document.querySelector('button[aria-label="Main menu"]');

                  for (let attempt = 1; attempt <= 3; attempt += 1) {
                    const closeButton = getCloseButton();
                    if (!closeButton || !visible(closeButton)) {
                      return { ok: false, stage: 'gemini-sidenav-close-button-missing', attempt };
                    }
                    closeButton.click();
                    await wait(320);
                    const panel = document.querySelector(geminiSidenavSelector);
                    if (!panel || !visible(panel)) {
                      return { ok: true, stage: 'gemini-sidenav-closed', attempt };
                    }
                  }
                  return { ok: false, stage: 'gemini-sidenav-still-open' };
                };

                const closeGeminiMenus = () => {
                  const closeCandidates = [
                    'button[data-test-id="side-nav-menu-button"]',
                    'button[aria-label="Main menu"]',
                    '[aria-label*="close" i]',
                    'button[aria-label*="close" i]'
                  ];
                  for (const selector of closeCandidates) {
                    const node = document.querySelector(selector);
                    if (node && visible(node)) {
                      try { node.click(); } catch (_) {}
                    }
                  }
                  try { document.body.click(); } catch (_) {}
                  try {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                  } catch (_) {}
                };

                if (serviceId === 'gemini') {
                  const hasGeminiStrongMarker = () => {
                  const selectors = [
                    '[data-test-id="temporary-chat-header"]',
                    '[data-placeholder*="temporary chat" i]',
                    '[data-placeholder*="incognito" i]',
                    '[data-placeholder*="private chat" i]'
                  ];
                  for (const selector of selectors) {
                    const node = document.querySelector(selector);
                    if (node && visible(node) && !isInsideGeminiSidenav(node)) return true;
                  }
                  return false;
                };

                  if (hasGeminiStrongMarker()) {
                    const closeResult = await closeGeminiSidePanel();
                    return JSON.stringify({ ok: true, serviceId, stage: 'already-active', closeResult });
                  }

                  for (let attempt = 1; attempt <= 4; attempt += 1) {
                    let geminiResult = clickGeminiTempButton();
                    if (!geminiResult.ok) {
                      const menuResult = clickGeminiMenuButton();
                      if (!menuResult.ok) {
                        return JSON.stringify({ ok: false, serviceId, stage: menuResult.stage });
                      }
                      const openResult = await waitForGeminiSidenavOpen();
                      if (!openResult.ok) {
                        return JSON.stringify({ ok: false, serviceId, stage: openResult.stage, menuStage: menuResult.stage });
                      }
                      const waitResult = await waitForGeminiTempButton();
                      if (!waitResult.ok) {
                        return JSON.stringify({ ok: false, serviceId, stage: waitResult.stage, menuStage: menuResult.stage });
                      }
                      geminiResult = clickGeminiTempButton();
                      if (!geminiResult.ok) {
                        return JSON.stringify({ ok: false, serviceId, stage: geminiResult.stage, menuStage: menuResult.stage });
                      }
                    }
                    for (let probe = 1; probe <= 8; probe += 1) {
                      await wait(250);
                      if (hasGeminiStrongMarker() || probe >= 2) {
                        await wait(200);
                        const closeResult = await closeGeminiSidePanel();
                        return JSON.stringify({ ok: true, serviceId, stage: geminiResult.stage, label: geminiResult.text, attempt, probe, closeResult });
                      }
                    }
                    await wait(400);
                  }
                  return JSON.stringify({ ok: false, serviceId, stage: 'gemini-temp-button-timeout' });
                }

                if (documentLooksIncognito()) {
                  return JSON.stringify({ ok: true, serviceId, stage: 'already-active' });
                }

                let targetResult = clickMatchingTarget();
                if (targetResult.ok) {
                  await wait(250);
                  return JSON.stringify({ ok: documentLooksIncognito(), serviceId, stage: targetResult.stage, label: targetResult.text });
                }

                for (const selector of MENU_SELECTORS) {
                  const menuButton = document.querySelector(selector);
                  if (!menuButton || !visible(menuButton)) continue;
                  menuButton.click();
                  await wait(150);
                  targetResult = clickMatchingTarget();
                  if (targetResult.ok) {
                    await wait(250);
                    return JSON.stringify({ ok: documentLooksIncognito(), serviceId, stage: 'opened-menu-then-clicked', label: targetResult.text, menuSelector: selector });
                  }
                }

                return JSON.stringify({ ok: false, serviceId, stage: 'no-native-toggle-found' });
              } catch (error) {
                return JSON.stringify({ ok: false, stage: 'exception', error: String(error && error.message || error) });
              }
            })();
        """.trimIndent()
    }

    private fun jsStringLiteral(value: String): String {
        return "\"" + value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"") + "\""
    }
}
