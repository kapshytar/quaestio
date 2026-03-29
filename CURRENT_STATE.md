# Current State

## Document Authority

- This file is the authoritative summary of the current functional state and migration intent for `chat-aggregator-mobile`.
- Root docs in `Verity/` still win for workspace-wide or cross-repo rules.
- `README.md` explains repo purpose and directory layout.
- Migration notes under `docs/` are planning context, not proof that code has already moved.

## Stable

- `chat-aggregator-mobile` now exists as a separate git repo inside the `Verity` workspace.
- The repo now contains a running iOS simulator-tested MVP shell, but it is still not a shipping mobile app.
- Expected monorepo structure is:
  - `android/`
  - `ios/`
  - `shared/js/`
  - `shared/contracts/`
  - `docs/`
- Shared mobile assets now include:
  - `shared/js/sendMessage.js`
  - `shared/js/attachFile.js`
  - `shared/js/scrapeReply.js`
  - `shared/contracts/servicePresets.json`
- iOS source now exists under `ios/VerityMobile/` with:
  - SwiftUI app entry
  - top provider tabs
  - shared bottom composer for send-to-all
  - merge/settings entry points aligned with the tab row
  - persistent `WKWebView` models per slot
  - `project.yml` for XcodeGen-driven project generation
  - `scripts/bootstrap-ios.sh` for local iOS project bootstrap
- Shared JS resources are now bundled into the iOS app, not only read from workspace-relative dev paths.

## In Progress

- Android code has not been moved yet from `../chat-aggregator-android`.
- Shared JS boundaries are still being finalized against real provider behavior.
- First shared-surface candidates are now identified:
  - `../chat-aggregator-android/app/src/main/java/com/chataggregator/app/MessageInjector.kt`
  - scrape/injection fragments currently embedded in `ChatFragment.kt`
- First pass of shared reply scraping is now extracted into `shared/js/scrapeReply.js`.
- iOS `send-to-all` is partially wired but not yet fully reliable across all providers.
- Inactive slots are now preloaded and slot switching no longer forces a reload back to the service home URL.
- iOS visual iteration is currently done in the simulator, but simulator-side system services can still create noisy CPU spikes.

## Current Contracts

- Do not delete or rewrite the current standalone Android repo during the scaffold phase.
- Shared logic should prefer:
  - WebView JS injection payloads
  - scrape/extraction JS
  - cross-client payload schemas/contracts
- Shared provider DOM logic should stay in `shared/js/`; platform wrappers should add lifecycle/retry/verification behavior around it, not fork the DOM logic.
- Shared logic should not prematurely absorb:
  - native UI layers
  - billing
  - platform-specific cookie/file plumbing

## Next Steps

- Finish real provider validation for iOS `send-to-all`, starting with `ChatGPT` and then other default slots.
- Move Android onto the same shared JS contract without duplicating provider DOM logic.
- Decide when the Android repo is ready to move into `android/`.
