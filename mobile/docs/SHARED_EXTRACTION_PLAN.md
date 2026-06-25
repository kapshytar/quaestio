# Shared Extraction Plan

## Goal

Define the Android-origin logic that should move into `shared/js/` and later be consumed by both:

- Android WebView wrappers
- iOS WKWebView wrappers

## Best First Candidates

### 1. Message send injection — DONE

- `MessageInjector.kt` removed. Logic now lives in `shared/js/sendMessage.js` (`globalThis.VeritySharedSendMessage.run(payload)`).
- Android: `ChatFragment.buildSharedSendScript(...)` loads the script from assets and invokes it.
- iOS: consumes the same JS via `WKWebView.evaluateJavaScript`.

### 2. File attach injection — DONE

- `MessageInjector.kt` removed. Logic now lives in `shared/js/attachFile.js` (`globalThis.VeritySharedAttachFile.run({})`).
- Android: `ChatFragment.buildSharedAttachScript(...)` loads the script from assets and invokes it.
- iOS: thin native wrapper around file chooser handling; DOM click logic is shared.

### 3. Reply scrape / prompt candidate extraction

Current source:

- scrape-related JavaScript embedded in:
  - `android/app/src/main/java/com/chataggregator/app/ChatFragment.kt`

Status:

- first extraction pass is now implemented in `shared/js/scrapeReply.js`
- native wrapper work is still pending

Target split:

- `shared/js/scrapeReply.js`
  - DOM traversal and normalized JSON payload generation
- Android/iOS wrappers
  - webview eval
  - JSON decode
  - lifecycle / retry / timeout handling

## Not Good First Shared Candidates

- `SlotManager.kt`
  - native persistence and slot config storage
- `SessionManager.kt`
  - native persistence + backend wiring, not WebView JS
- `MergeApiClient.kt`
  - may later inspire shared contracts, but should not be the first extraction
- `MainActivity.kt`
  - orchestration layer, too platform-bound

## Recommended Extraction Order

1. `sendMessage.js` — DONE
2. `attachFile.js` — DONE
3. `scrapeReply.js` (first pass extracted; native wrapper work still pending)
4. shared payload/JSON schema notes under `shared/contracts/`

## Practical Rule

The Android project now belongs in `android/`.

The migration should preserve Android as the first implementation source while shared behavior is extracted into `shared/js/`.

## Shared Space Rules

- `shared/js/` is the source of truth for provider DOM behavior.
- Android and iOS wrappers should execute the same shared DOM scripts, not fork them per platform.
- Platform wrappers may add:
  - webview lifecycle handling
  - retry/fallback timing
  - result verification
  - native UI integration
- Platform wrappers should not duplicate:
  - provider selectors
  - DOM traversal heuristics
  - input/button finding logic
  - scrape payload shape
- If a fix is about what exists in the page DOM, it belongs in `shared/js/`.
- If a fix is about when or how the script is executed in a platform webview, it belongs in the platform wrapper.

## Non-Goals For Shared JS

- `shared/js/` should not pretend to solve provider policy restrictions.
- If a provider blocks embedded auth with errors like `disallowed_useragent`, that is a compatibility limitation of the embedded browser path, not something to "fix" by adding more DOM selectors.
- Social login, OAuth handoff, cookie import/export, and native account/session bridging should stay documented as platform/provider compatibility concerns outside the shared DOM layer.
