# Claude Handoff: Scraper Timing + Copy-Button Fix

Date: 2026-02-25
Previous: `CLAUDE_HANDOFF_SCRAPER_2026-02-25.md`

## Final Result

**All 6 providers working (verified)**

| Provider | Extraction | Source | Status |
|----------|-----------|--------|--------|
| Perplexity | copy | interceptor | ✅ |
| Gemini | copy | interceptor | ✅ |
| Grok | copy | interceptor | ✅ |
| Claude | copy | interceptor | ✅ |
| ChatGPT | copy | clipboard | ✅ |
| DeepSeek | dom (fallback) | — | ✅ |

All responses: clean markdown, no UI garbage, full content captured.

## Problem

Scraper was firing 2-3 seconds after sending the message. No LLM responds that fast, so it scraped garbage:
- **DeepSeek**: 34 chars — truncated response (still generating)
- **Perplexity**: 174 chars — UI navigation elements, not the answer
- **Gemini**: 1729 chars — entire sidebar chat history
- **Grok**: 24 chars — user's own prompt echoed back
- **ChatGPT**: incomplete responses, cutting off mid-paragraph
- **Claude**: incomplete responses

All 4 providers fell back to DOM scraping (`extraction_method: "dom"`, `copy_diagnostics: null`). Copy-button extraction failed silently for all.

### Root causes

1. **No wait for generation completion.** Polling found *some* text in each slot (old messages, UI, prompt) → counted as 4/4 replies → exited on first attempt.
2. **Copy-button selectors didn't match actual DOM.**
   - Gemini uses `data-test-id="copy-button"` — selector looked for `data-testid` (no hyphen)
   - Grok uses `aria-label="Копировать"` — selector looked for `"Скоп"` (doesn't match "Копир")
   - ChatGPT uses `data-testid="copy-turn-action-button"` — not in selector list
3. **Grok hides copy buttons via `opacity: 0`** until hover. The `visible()` check filtered them out.
4. **No quality gate.** Any non-empty string counted as a valid reply.
5. **Clipboard permission denied in Electron webviews.** Copy buttons clicked successfully but `navigator.clipboard.writeText()` and `navigator.clipboard.write()` fail silently — Electron doesn't grant clipboard permission to webview content.
6. **Stop button disappears early in ChatGPT.** Generation detection relies on stop button visibility, but ChatGPT removes the button before content finishes rendering.

## What was done

### File: `renderer.js`

#### 1. Three-phase polling (`ingestAfterSlotsPolling`)

Old: scrape immediately, exit when count matches.

New:
- **Phase 1**: Initial delay (`INGEST_INITIAL_DELAY_MS = 5000`) — no LLM responds in under 5 seconds.
- **Phase 2**: `isSlotStillGenerating()` loop — checks for "Stop" buttons, spinners, thinking indicators per provider. Waits up to 30s (`INGEST_GENERATION_WAIT_ATTEMPTS = 15` × `INGEST_GENERATION_CHECK_MS = 2000`).
- **Phase 2.5**: Safety delay (`3000ms`) — wait after all stop buttons disappear to ensure content fully renders.
- **Phase 3**: Polling with quality validation.

#### 2. `isSlotStillGenerating(slot, serviceId)` — new function

Executes JS inside webview. Checks provider-specific streaming indicators:

| Provider | Selectors checked |
|----------|------------------|
| DeepSeek | `div[class*="ds-thinking"]`, `div[class*="generating"]` |
| Gemini | `button[aria-label*="Stop"]`, `mat-icon[data-mat-icon-name="stop_circle"]`, `button[data-test-id="stop-button"]` |
| Grok | `button[aria-label*="Stop"]` |
| ChatGPT | `button[data-testid="stop-button"]`, `button[aria-label="Stop streaming"]`, `button[aria-label="Stop generating"]` |
| Generic | `button[aria-label*="Stop generating" i]`, `button[aria-label*="Stop response" i]`, `button[aria-label="Stop" i]` |

Note: Removed overly broad selectors that caused false positives:
- `[class*="cursor"]` — matched Tailwind `cursor-pointer` on every button
- `[class*="searching"]` — matched permanent Perplexity UI elements
- `button[class*="stop"]` — too broad
- `[class*="blink"]`, `[class*="typing"]`, `[class*="streaming"]` — matched static classes

#### 3. Copy-button selectors (16 total for `tryCopyLatestAssistantReply`)

Full selector list:
```
[data-testid="copy-turn-action-button"]      ← ChatGPT (exact match, skips excluded-area check)
button[aria-label*="Copy" i]
button[title*="Copy" i]
[role="button"][aria-label*="Copy" i]
[data-testid*="copy" i]
[data-test-id*="copy" i]                     ← Gemini (was missing hyphen)
button[aria-label*="Копир" i]                ← Grok ("Копировать")
[role="button"][aria-label*="Копир" i]
button[aria-label*="Скоп" i]
button[title*="Скоп" i]
button[mattooltip*="Copy" i]                 ← Gemini (Angular tooltip)
copy-button button                           ← Gemini (custom element)
.dl-btn:has(.dl-icon-copy)                   ← DeepSeek
.ds-icon-button:has(.dl-icon-copy)           ← DeepSeek
[role="button"]:has([class*="copy"])         ← DeepSeek (role="button" divs)
.ds-markdown-code-copy-button                ← DeepSeek code blocks
```

Plus 11 fallback selectors for unknown providers:
```
button[aria-label*="Duplicate" i]
button[title*="Duplicate" i]
button[aria-label*="Clone" i]
button[title*="Clone" i]
[role="button"]:has(svg use[*="copy" i])
button:has(svg use[href*="copy" i])
button:has([class*="copy-icon"])
[class*="action-btn"]:has([class*="copy"])
[class*="toolbar-btn"]:has([class*="copy"])
button[class*="copy"]
[class*="message-action"] button:first-child
```

Extended `messageContainer()`:
```
[class*="prose"]          ← Perplexity
[id^="response-"]         ← Grok response containers
model-response            ← Gemini custom element
response-container        ← Gemini custom element
[class*="message-bubble"] ← Grok message content
+ DOM-walking fallback (up to 15 ancestor levels)
```

Added `mattooltip` to `labelOf()` for Gemini.

`isCopyLike(label, el)` also checks CSS classes on element and children for `copy`-related strings.

#### 4. Hover-to-reveal for hidden buttons

- Before searching for copy buttons, hovers the last visible message container to trigger CSS `group-hover:opacity-100` (Grok pattern).
- Renamed `visible()` → `hasLayout()` — no longer filters by `opacity`, only checks dimensions + display/visibility.
- After finding the target button, hovers `[class*="group"]` parent (Grok's Tailwind pattern) before clicking.

#### 5. Clipboard interceptor (monkey-patching)

Electron webviews don't grant clipboard permission to hosted pages. Buttons click successfully but the clipboard API calls fail silently. Solution: monkey-patch clipboard APIs inside the webview before clicking the copy button.

Three interception layers:
```javascript
// 1. navigator.clipboard.writeText() — used by Perplexity, ChatGPT
navigator.clipboard.writeText = function(text) {
  window.__gunshiCopyCapture = text;
  return origWrite(text).catch(() => {});
};

// 2. navigator.clipboard.write() (ClipboardItem API) — used by Gemini, Grok, Claude
navigator.clipboard.write = async function(items) {
  for (const item of items) {
    if (item.types.includes('text/plain')) {
      window.__gunshiCopyCapture = await (await item.getType('text/plain')).text();
      break;
    } else if (item.types.includes('text/html') && !window.__gunshiCopyCapture) {
      // Strip HTML tags to get plain text
      const blob = await item.getType('text/html');
      const html = await blob.text();
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      window.__gunshiCopyCapture = tmp.textContent || tmp.innerText || '';
    }
  }
  return origClipWrite(items).catch(() => {});
};

// 3. document.execCommand('copy') — legacy fallback
document.execCommand = function(cmd) {
  if (cmd === 'copy') {
    window.__gunshiCopyCapture = window.getSelection().toString();
  }
  return origExec.apply(document, arguments);
};
```

Polling loop checks both system clipboard AND `window.__gunshiCopyCapture` (20 attempts × 200ms).

#### 6. ChatGPT-specific fix

Added exact match selector `[data-testid="copy-turn-action-button"]` with special handling: skips `excluded-area` check for this selector since it's guaranteed to be the correct copy button.

#### 7. Safety delay after generation complete

After `isSlotStillGenerating()` returns false for all slots, wait 3 seconds before scraping. This allows content to fully render, especially important for ChatGPT which removes the stop button before all content is written.

#### 8. Quality gate (`isQualityReply`)

New function, called instead of `cleanedReply.trim().length > 0`:
- Rejects text shorter than 30 chars (`INGEST_MIN_REPLY_CHARS`).
- Rejects text that exactly matches the user's prompt.
- Rejects text that is mostly the prompt with minor wrapping (< 1.5× prompt length and contains the prompt).

#### 9. Diagnostics always returned

`tryCopyLatestAssistantReply` always returns `{text, diagnostics}` — never `null`. Diagnostics include:
- `clicked: true/false`
- `source: 'clipboard' | 'interceptor'` (when successful)
- `reason: 'no-copy-button' | 'clipboardTimeout' | error message` (when failed)
- `debug.selectorHits` — raw match counts per CSS selector
- `debug.rejected` — reasons each candidate was filtered out
- `debug.allButtonsSample` — last 20 `button, [role="button"]` elements for debugging

## Constants

```javascript
const INGEST_POLL_ATTEMPTS = 30;
const INGEST_POLL_INTERVAL_MS = 2000;
const INGEST_INITIAL_DELAY_MS = 5000;
const INGEST_GENERATION_WAIT_ATTEMPTS = 15;
const INGEST_GENERATION_CHECK_MS = 2000;
const INGEST_SAFETY_DELAY_MS = 3000;  // NEW
const INGEST_MIN_REPLY_CHARS = 30;
```

## Current rules to keep

1. Do not reintroduce aggressive container exclusion/scoring that drops valid replies.
2. Do not trim/cut reply bodies on ingest receiver side.
3. Sender-side cleanup should be minimal and explicit.
4. For Windows scraping: `copy-first`, then DOM fallback.
5. Do not scrape before generation completes — always run `isSlotStillGenerating` check.
6. Always wait 3 seconds after stop buttons disappear before scraping.
7. Do not count replies shorter than 30 chars or prompt echoes.
8. Always return diagnostics from `tryCopyLatestAssistantReply` (never `null`).
9. Do not use overly broad CSS class selectors in `isSlotStillGenerating` (avoid `[class*="cursor"]`, `[class*="searching"]`, etc.).
10. For ChatGPT's copy button: skip `excluded-area` check (it's always valid).

## Known limitations

- **DeepSeek**: Copy button uses hashed CSS classes with no identifiable attributes (no aria-label, no title, no data-testid). DOM scrape fallback works fine.
- **Gemini**: Clicks "Copy table" when response contains a table. For non-table responses, clicks generic "Copy" button.
- **Clipboard interceptor**: Must be injected before each click (cannot persist across navigations).
- **ChatGPT**: Stop button disappears before content finishes rendering — requires 3-second safety delay.

## Useful artifacts

- ChatGPT copy button: `button[data-testid="copy-turn-action-button"]`, `aria-label="Copy"`, `data-state="closed"`
- Claude copy button: standard `button[aria-label="Copy"]`
- Gemini copy button: `button[data-test-id="copy-button"]`, `aria-label="Copy"`, inside `<copy-button>` → `<message-actions>` → `<model-response>`
- Grok copy button: `button[aria-label="Копировать"]`, `opacity: 0` by default, `group-hover:opacity-100`, inside `div.action-buttons` → `div[id^="response-"]`
- DeepSeek buttons: `<div role="button" class="ds-icon-button ...">` with hashed prefix classes, no copy-specific attributes
- Perplexity copy button: `button[aria-label="Copy"]` with SVG icon `#pplx-icon-copy`
- Local HTML snapshot for ChatGPT: `C:\Users\kvita\OneDrive\Desktop\Приветствие пользователя.mhtml`
- Local HTML snapshot for Gemini: `C:\Users\kvita\OneDrive\Desktop\Google Gemini.htm`
- Local MHTML snapshot for Grok: `C:\Users\kvita\OneDrive\Desktop\Остаточная социальная ангедония после депрессии - Grok.mhtml`
- Local MHTML snapshot for DeepSeek: `C:\Users\kvita\OneDrive\Desktop\Случайная таблица супергероев - DeepSeek.mhtml`
- Local MHTML snapshot for Perplexity: `C:\Users\kvita\OneDrive\Desktop\table random please.mhtml`
- Local run traces: `C:\chat-aggregator\debug-runs\*.json`

## Supabase trace check

```sql
select * from get_ingest_debug_trace_v1('trace_xxx');
```

Focus on:
- `scrape_meta[].extraction_method` — should be `copy` (except DeepSeek → `dom`)
- `scrape_meta[].copy_diagnostics` — should have `clicked: true`, `source: "clipboard" | "interceptor"`
- `responses[].markdown` — should be clean reply text, no UI garbage
- generation wait log entries in debug trace
- safety delay log: `Waiting 3000ms for content to fully settle before scraping`
