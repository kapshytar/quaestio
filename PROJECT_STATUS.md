# Project Status

Last updated: 2026-02-15

## Current Stage
- Stage: stabilization after rapid feature additions.
- Goal now: make navigation/auth/sending robust across providers with minimal regressions.

## What Is Implemented
- 4-slot aggregator UI with per-slot service selector and URL bar.
- Shared session partition (`persist:shared`) across webviews.
- Cookie import via IPC (`renderer -> preload -> main`) with result reporting and size guard.
- Google login helper window in main process (same partition) to reuse session in webviews.
- Popup handling for OAuth/new windows moved to main process `setWindowOpenHandler`.
- Chrome-like User-Agent for webviews/window contents (without `Electron/...` token).
- Unified message sending engine with fallback pipeline:
  - find input (textarea/contenteditable/role textbox)
  - set value + input/change events
  - click send button if found
  - fallback to `requestSubmit()`
  - fallback to Enter key events
- Webview readiness safeguards:
  - `safeLoadURL`/`safeReload`
  - `webviewReady` and `pendingNavigation` per slot
  - avoid calling webview methods before `dom-ready`

## Known Open Issues
- Some providers may still detect embedded environment (policy-side limitation).
- Selectors can drift when provider UI changes.
- `README.md` and some docs are outdated vs current slot-based architecture.
- No automated tests yet for renderer message-sending logic.

## Resume Checklist
- Start app: `npm start`
- Reproduce target issue in one slot only first.
- Capture:
  - provider URL in slot
  - behavior (input set / submit not triggered / no input found)
  - renderer console error line
- Patch only selectors or one fallback step, then re-test across at least:
  - ChatGPT
  - DeepSeek
  - Perplexity

## Next Priority Options
1. Add provider-specific diagnostics mode (show which send strategy succeeded).
2. Add minimal automated tests for selector normalization and send pipeline builders.
3. Update `README.md` to reflect current architecture and keyboard shortcuts.
4. Add a small in-app "health panel" for each slot (ready state, current URL, last send result).

## Decision Log
- 2026-02-15: Moved cookie import IPC to request/response (`ipcRenderer.invoke` / `ipcMain.handle`).
- 2026-02-15: Added payload size validation for cookie import.
- 2026-02-15: Stopped forcing OAuth popups into same webview; allowed popup windows.
- 2026-02-15: Added Google Login Helper window with shared partition.
- 2026-02-15: Removed static hardcoded webview useragent in HTML.
- 2026-02-15: Applied Chrome-like UA from Electron Chromium version in main process.
- 2026-02-15: Reworked send pipeline to be selector+fallback based.
- 2026-02-15: Added safe webview navigation/reload guards for pre-`dom-ready` calls.

## How To Continue In Next Session
- Open `PROJECT_STATUS.md` first.
- Pick one item from `Next Priority Options`.
- Keep edits narrow; verify with `node --check main.js renderer.js preload.js`.
