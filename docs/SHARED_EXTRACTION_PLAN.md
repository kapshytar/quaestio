# Shared Extraction Plan

## Goal

Define the first Android-origin logic that should move into `shared/js/` and later be consumed by both:

- Android WebView wrappers
- iOS WKWebView wrappers

## Best First Candidates

### 1. Message send injection

Current source:

- `../chat-aggregator-android/app/src/main/java/com/chataggregator/app/MessageInjector.kt`

Why it is a good first move:

- it already generates platform-agnostic DOM JavaScript
- native Android code here is mostly string assembly / wrapper glue
- iOS can consume the same JS via `WKWebView.evaluateJavaScript`

Expected split:

- `shared/js/sendMessage.js`
  - pure DOM logic
  - service-specific button/input heuristics
- Android wrapper
  - passes message + selectors into the JS runtime
- iOS wrapper
  - passes message + selectors into the JS runtime

### 2. File attach injection

Current source:

- `../chat-aggregator-android/app/src/main/java/com/chataggregator/app/MessageInjector.kt`

Why it is a good candidate:

- DOM search/click logic is already platform-neutral
- only native file picker glue should stay platform-specific

Expected split:

- `shared/js/attachFile.js`
- thin Android/iOS wrappers around file chooser handling

### 3. Reply scrape / prompt candidate extraction

Current source:

- scrape-related JavaScript embedded in:
  - `../chat-aggregator-android/app/src/main/java/com/chataggregator/app/ChatFragment.kt`

Why it should move later, not first:

- it is larger and more entangled with Android-side callback/result shaping
- it still needs a clean boundary between:
  - pure DOM traversal
  - native result parsing / state updates

Suggested target split:

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

1. `sendMessage.js`
2. `attachFile.js`
3. `scrapeReply.js`
4. shared payload/JSON schema notes under `shared/contracts/`

## Practical Rule

Do not move the Android project into `android/` until at least the first shared JS extraction is real.

The monorepo should prove it can hold shared behavior before it absorbs the full native project.

