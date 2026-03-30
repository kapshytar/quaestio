# Current State

## Document Authority

- This file is the authoritative summary of the current functional state and migration intent for `chat-aggregator-mobile`.
- Root docs in `Verity/` still win for workspace-wide or cross-repo rules.
- `README.md` explains repo purpose and directory layout.
- `CHANGELOG.md` is the required running history for meaningful mobile milestones.
- Migration notes under `docs/` explain the move into this repo and should reflect actual migration status.

## Stable

- `chat-aggregator-mobile` now exists as a separate git repo inside the `Verity` workspace.
- The repo now contains a running iOS device-tested MVP shell, but it is still not a shipping mobile app.
- Expected monorepo structure is:
  - `android/`
  - `ios/`
  - `shared/js/`
  - `shared/contracts/`
  - `docs/`
- This repo is now the intended long-term home for both mobile clients.
- Android source is now present under `android/` in this repo.
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
- iOS slot webviews currently use `WKWebsiteDataStore.default()`, so normal app updates should preserve cookies and logged-in web sessions as long as the app is not uninstalled and the bundle identifier stays stable.
- Root development rule for this repo is now explicit:
  - Android first during migration
  - shared first as the target state
  - native only where necessary
- Versioning/changelog rule for this repo is now explicit:
  - meaningful mobile milestones must be recorded in `CHANGELOG.md`
  - version bump decisions must follow the global Verity `1.x.y` policy instead of being implied

## In Progress

- Android-first is temporary because the original mobile implementation started there first.
- The intended steady state is shared-first, where shared mobile logic becomes the source of truth for both Android and iOS.
- Shared JS boundaries are still being finalized against real provider behavior.
- First shared-surface candidates are now identified:
  - `android/app/src/main/java/com/chataggregator/app/MessageInjector.kt`
  - scrape/injection fragments currently embedded in `android/app/src/main/java/com/chataggregator/app/ChatFragment.kt`
- First pass of shared reply scraping is now extracted into `shared/js/scrapeReply.js`.
- iOS `send-to-all` is partially wired but not yet fully reliable across all providers.
- Inactive slots are now preloaded and slot switching no longer forces a reload back to the service home URL.
- iOS visual iteration is currently done in the simulator, but simulator-side system services can still create noisy CPU spikes.
- Real-device validation has now confirmed that `Sign in with Google` inside embedded `WKWebView` can be blocked by provider policy. On iPhone, ChatGPT currently fails with Google/OpenAI embedded auth using `Error 403: disallowed_useragent`.

## Current Contracts

- Do not delete the old standalone Android repo until the migrated copy in `android/` is validated, committed here, and used as the active working copy.
- The new mobile repo is the place where future Android and iOS work should converge.
- Shared logic should prefer:
  - WebView JS injection payloads
  - scrape/extraction JS
  - cross-client payload schemas/contracts
- Shared provider DOM logic should stay in `shared/js/`; platform wrappers should add lifecycle/retry/verification behavior around it, not fork the DOM logic.
- Shared logic should not prematurely absorb:
  - native UI layers
  - billing
  - platform-specific cookie/file plumbing
- Normal iOS app updates must not wipe cookies or login state. Do not change the bundle identifier, clear website data, or uninstall the app unless that destructive step is explicitly chosen.
- Embedded social/OAuth login should be treated as provider-compatibility-sensitive, not assumed to work just because the page renders inside a webview.
- Do not ship meaningful mobile client changes without updating this repo's `CHANGELOG.md`.

## Next Steps

- Treat `android/` in this repo as the active Android home and stop landing new Android work only in the sibling repo.
- Finish real provider validation for iOS `send-to-all`, starting with `ChatGPT` and then other default slots.
- Build a provider compatibility matrix for iOS covering:
  - direct web login
  - embedded Google/social login
  - send-to-all
  - scrape/latest-reply extraction
- Move Android onto the same shared JS contract without duplicating provider DOM logic.
- Keep reducing platform-specific forks by pushing provider DOM behavior into `shared/js/`.
