# Changelog

## 2.0.0
- ship the first full iPhone client milestone with Supabase-backed sessions, project selection, collect/merge flows, shared scrape fixes, deploy tooling, and cross-platform UI parity work across iPhone and Android
- promote mobile to a major release marker after the multi-pass iOS client buildout and Android parity/polish work completed in this cycle

## 1.105.42
- remove the extra Android panel chrome around the top left chevron, settings button, and bottom input area after live device review, keeping the cleaner selector pills without the boxed-in wrappers

## 1.105.41
- refine the Android 12 refresh after live screenshot review by smoothing the top-bar edges and restoring Projects/Sessions pill readability without bringing back the old bulky density

## 1.105.40
- give Android the first cohesive Android-12-style surface refresh by turning the top bar and bottom composer area into rounded elevated panels, tightening the composer actions, and restyling the Projects/Sessions popups onto shared dialog surfaces

## 1.105.39
- make the Android Projects and Sessions pills substantially denser after live screenshot review by shrinking their height, internal padding, chevrons, max width, and the adjacent session status dot

## 1.105.38
- on iPhone, cold launch without an active session now resets slots back to each service's default home link instead of reopening the last live chat URL
- persist iPhone workspace state in a session-aware way so clearing or changing session/project no longer leaves stale chat URLs waiting to come back on the next launch
- tighten the mobile session indicator so its status dot sits closer to the Sessions label instead of floating with an oversized gap
- add Android selector chevrons to the Projects and Sessions pills so they match the iPhone control language and read more clearly as popups

## 1.105.37
- reset the active session whenever a project change rewires slot URLs, on both iPhone and Android, so a new project cannot silently keep writing into the old session
- tighten the Android session status indicator into a small dot placed directly before the Sessions pill instead of a larger detached marker

## 1.105.36
- restore the iPhone top-tab service dots to reflect slot enabled state directly so enabled slots stay color-lit and disabled slots go gray regardless of which tab is currently selected

## 1.105.35
- restore the Android session status dot before the Sessions pill and make the mobile slot pills icon-only across iPhone and Android instead of showing fallback slot text

## 1.105.34
- gray out the iPhone bottom slot-pill service icons when a slot is disabled so inactive slots read as clearly off instead of still colorful

## 1.105.33
- dim the iPhone top tab service dots to gray for inactive tabs so only the active slot keeps its service color

## 1.105.32
- replace the iPhone composer input with a real multiline editor so Enter inserts a newline instead of failing to create a line break

## 1.105.31
- replace the iPhone bottom slot pill labels with cached service favicons where available, with a safe fallback back to `S1/S2/...` if an icon cannot load

## 1.105.30
- tighten the iPhone Projects / Sessions pills by removing the extra spacer gap before the chevrons and truncating long project/session labels cleanly

## 1.105.29
- move the iPhone Projects / Sessions controls up onto the same horizontal control row as the slot pills so context selection sits at the slot level instead of below it

## 1.105.28
- move the visible mobile version badge out of the main iPhone screen into Settings and compact the Projects / Sessions controls down next to the slot controls so the Chats screen stays tighter

## 1.105.27
- relax shared prompt freshness matching for short prompts and strip leading prompt echoes from Gemini-style combined wrappers so iPhone no longer rejects the current reply over minor punctuation/spacing/one-character prompt variations

## 1.105.26
- add shared candidate-trace diagnostics for Gemini/Grok scrape failures and surface them in iPhone per-slot diagnostics so failed collects show why each ranked reply candidate was accepted or rejected

## 1.105.25
- make the shared Gemini/Grok candidate picker continue past the first stale reply candidate instead of failing immediately, so iPhone scrape can recover when the top-ranked candidate belongs to a previous prompt but a valid current candidate still exists lower in the ranked pool

## 1.105.24
- teach the shared reply scraper to recognize Gemini-style combined “You said / Gemini said” wrappers so the current prompt can be matched from the selected reply itself instead of being rejected as a previous prompt
- surface the selected reply preview in iPhone scrape diagnostics when a scrape fails so Gemini debugging shows the chosen candidate instead of opaque raw JSON

## 1.105.23
- roll the mobile version forward to a clean Gemini-debug milestone so the iPhone build under test is unambiguous after the Claude Gemini pass

## 1.105.22
- add a canonical `ingest-smoke-check` script for mobile so collect/ingest debugging can show the latest note rows, ingest debug logs, and payload providers from one shared command instead of repeating ad-hoc Supabase queries

## 1.105.21
- add a canonical iPhone deploy script that regenerates the Xcode project, builds, installs with direct `devicectl`, verifies the installed version on-device, and only then relaunches so mobile deploys stop silently leaving the phone on an older build

## 1.105.20
- add real per-slot scrape diagnostics on iPhone so Gemini/other empty states expose the shared scraper error, document title, prompt candidate, and preview instead of forcing blind guesswork

## 1.105.19
- make iPhone manual collect reuse the current aggregated note when the prompt still matches the loaded question, mirroring Android instead of creating a fresh root on every repeated collect
- add visible in-app ingest event lines and a running collect state on iPhone so repeated collects and RPC outcomes are no longer invisible from the Merge screen

## 1.105.18
- make the shared reply scraper prefer prompt-matching user blocks over mere recency so Gemini/Grok/ChatGPT stop dropping or mis-scoping the current reply on iPhone while keeping Android on the same shared freshness rule

## 1.105.17
- fix iPhone `Collect now` so the Merge screen actually runs aggregated ingest to Dream Tracker instead of only scraping replies locally

## 1.105.16
- align mobile ingest debug events to canonical `source_platform_code` / `platform_code` naming so iPhone and Android stop sending legacy plain `platform` values into Dream Tracker

## 1.105.15
- fix iPhone auto-collect so a post-settle re-scrape that drops from `4/4` to `3/4` no longer lies with an “All ready” summary or returns a fake full-ready state

## 1.105.14
- move prompt-scoped reply freshness toward a shared rule so Gemini/Grok stale replies stop being ingested from the previous prompt on iPhone
- make iPhone aggregation treat actively generating slots as `waiting` instead of scraping stale completed answers too early
- sort locally restored iPhone sessions through the same newest-first display comparator as the remote session list

## 1.105.13
- stop mutating iPhone session-list state during SwiftUI rendering so the Sessions sheet no longer self-updates into hangs and stale loading behavior
- make iPhone session loading reuse the app-level session manager instead of creating a throwaway loader instance

## 1.105.12
- make iPhone user-agent defaults service-specific so ChatGPT, Claude, and Grok start on Safari Full while Gemini stays on the default WKWebView path
- apply those per-service UA defaults on startup so old manual experiment values stop forcing the wrong login path by default

## 1.105.10
- add iPhone session loading UI with searchable saved-session picker, remote session fetch, and Android-like application of older session snapshots to slots/webviews

## 1.105.11
- align iPhone saved-session ordering with the Android session comparator so older snapshots stop appearing upside down in the picker

## 1.105.9
- preserve the current Android aggregated session/root across follow-up sends instead of clearing session state before every message

## 1.105.8
- move mobile reply scraping toward a shared Android-grade extractor and route Android latest-reply collection through the shared scrape asset
- add stronger filtering for UI chrome, action/footer blocks, tables, and math so iOS stops ingesting banner/system text as model output

## 1.105.7
- keep the current iOS aggregated session/root linked across follow-up sends instead of clearing session state before every message

## 1.105.6
- fix iOS Supabase service-role key fallback and strip accidental Bearer prefixes so projects, sessions, and ingest can authenticate
- align mobile fallback key constants so the repo does not carry a corrupted Supabase key path

## 1.105.5
- add visible in-app version badges on iOS so fresh installs are immediately verifiable
- continue making session/project context explicit in Chats and Merge UI

## 1.105.4
- add iOS Supabase aggregated-ingest client and session manager
- wire iOS manual collect and send-to-all into parallel ingest/session state
- mirror Android's sessionless-ingest guard on iOS so a new question does not reuse an old session without a current aggregated root
- embed the Android-mirrored Supabase URL/service-role key path in iOS key obfuscation
- bump mobile build/version sources for the iOS ingestion + session tracking phase

## 1.105.3
- replace iOS and Android app icons with `/Users/v/Desktop/ChatGPT Image Mar 31, 2026, 01_54_38 AM.png`

## 1.105.2
- pin Android Gradle to the local Temurin 17 JDK at `/Users/v/.jdks/temurin-17/Contents/Home` so builds do not depend on shell session state

## 1.105.1
- replace iOS and Android app icons with the Firefly V concept from `/Users/v/Desktop/Firefly.jpg`

All notable changes to this repo are documented here.

Versioning policy:
- mobile follows the shared Verity client `1.x.y` family
- during the Android/iOS migration period, iOS and Android version sources may still live in different files
- every code change in this repo increments `y`
- every commit/push milestone in this repo increments `x`
- after incrementing `x`, `y` resets to `0`
- meaningful mobile milestones must still be recorded here even before version-source unification is complete

## [Unreleased] - 2026-03-30

### Added
- `chat-aggregator-mobile` now has its own repo-level changelog and is treated as the active history surface for mobile work.
- First shared merge catalog added under `shared/contracts/mergeConfig.json`.
- iOS merge now has a real provider-backed API path instead of only a placeholder shell.
- iOS clarification/history flow now follows the Android merge conversation model more closely.
- iOS now mirrors Android's preinstalled `DeepSeek` key path with the same “preinstalled vs custom” merge-key behavior.

### Changed
- Android project is now migrated into `chat-aggregator-mobile/android/` as part of the intended mobile monorepo structure.
- Mobile docs now explicitly describe the target architecture:
  - Verity architecture first
  - Android first only during migration
  - shared first as the target state
  - native only where necessary
- iOS auth/browser-like behavior was hardened with shared session state, popup handling, diagnostics, and provider login experiments.
- iOS `Merge` now follows Android more closely for first-run defaults and aggregation behavior:
  - `DeepSeek API` is now the default provider because it has the preinstalled key path
  - `DeepSeek` no longer shows a cluttered config by default
  - merge aggregation now polls for replies before giving up instead of doing one naive scrape pass
  - iOS merge screen now exposes Android-like aggregation status refresh/collect controls
- merge provider visibility and aggregation retry policy now live in the shared `mergeConfig.json` contract and are consumed by both mobile clients
- Android and iOS now use the same mobile repo version milestone `1.105.0` for the current merge-and-streaming milestone
- SSE parsing now lives in shared `mergeStreamParser.js`, with Android and iOS acting as transport wrappers around the same parser surface
- mobile merge streaming now reads chunk/model extraction rules from shared `streamParserConfig.json` instead of hardcoding SSE parsing behavior separately in Swift and Kotlin
- shared merge streaming parser now preserves whitespace and markdown structure instead of trimming chunk/final text into a single collapsed line
- Android now clears the full parallel-ingest session context on a brand new prompt, so merge notes stop attaching themselves to an old carried-over session like `#115`
- iOS merge output now uses a pure SwiftUI markdown-like block renderer so final merge results wrap naturally inside the merge card without UIKit text-container clipping or one-line layout failures
- iOS merge now uses the last sent user prompt automatically, so the duplicate prompt field is removed from the merge screen instead of asking for the same intent twice
- Android now refuses to restore a stored parallel-ingest session from slot fingerprints alone when the current source prompt is a different question, preventing old sessions like `#115` from reattaching after a new prompt starts

### Fixed
- iOS merge build path is now reproducible from `project.yml` + `xcodegen` instead of depending only on Xcode GUI state.
