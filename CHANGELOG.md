# Changelog

## 2.2.0

- add `-allowProvisioningUpdates` to the canonical iPhone deploy script so local device installs can refresh Apple development provisioning automatically after profile/certificate changes


Parent / entry point:
- Start from [../VERITY_MAP.md](../VERITY_MAP.md)
- Repo state and current contracts live in [CURRENT_STATE.md](./CURRENT_STATE.md)
- Repo-specific versioning contract lives in [VERSIONING.md](./VERSIONING.md)

## 2.1.10

- deduplicate session snapshots by session ID in `loadNoteBackedSessions` so sessions with multiple notes don't produce duplicate entries with mismatched slot configs
- add full fallback chain for `slotConfig` and `slotEnabled` in note-backed session loading, falling through to the original RPC response when no local snapshot matches
- query the latest note for a session when loading a note-backed session to restore the correct active aggregated note ID, so new questions attach to the chain tip
- add debug logging to session slot URL and config resolution for diagnosing slot mismatches

## 2.1.9

- fix note-backed session loading on iPhone so new questions attach to the current tip of the note chain instead of creating parallel root notes under the session root
- restore the active aggregated note ID by querying the latest note for the session when loading a note-backed session

## 2.1.8

- fix iPhone session slot URL restoration when the device has no local cached session snapshot, by falling back to the original RPC snapshot from `aggregator_sessions_bridge_v1` instead of returning empty URLs
- apply the same fallback fix to Android and Desktop so all three platforms restore slot URLs consistently even after cache loss

## 2.1.7

- keep the iPhone logical session link when sending or collecting a different question, clearing only the active aggregated note so the backend creates the next question root as a child instead of starting a separate session
- preserve the iPhone active session link across app startup instead of clearing it unconditionally, avoiding split roots after a cold restart while still resetting slots when no valid note-backed context exists

## 2.1.6

- prefer latest/bottom Claude scrape candidates before falling back to length-based ordering, so Android Claude collection is less likely to pick an older prompt/container instead of the current assistant answer

## 2.1.5

- relax the Android post-scrape quality gate so DOM `promptCandidate` is not treated as authoritative prompt text; this restores valid Claude/Gemini replies while keeping direct prompt-echo rejection against the known scrape seed prompt

## 2.1.4

- block Android manual collect from overwriting an existing aggregated root when the current scrape is partial, so dropping a bad Claude prompt echo cannot delete the previously valid Claude segment

## 2.1.3

- add an Android post-scrape quality gate before aggregation ingest so prompt echoes such as `Сделай саммари видео и вытащи ключевые идеи` cannot be saved as Claude replies
- compare Android cleaned replies against both the scrape seed prompt and the DOM prompt candidate, covering cases where the WebView selected the prompt node instead of the assistant answer
- keep the iPhone scrape path unchanged; this patch targets the Android-only Claude failure seen on session `134`

## 2.1.2

- persist canonical per-slot live chat URLs during iPhone ingest instead of falling back to preset/project URLs, so cold-start collects stop saving stale ChatGPT/Claude/Gemini/Grok links
- simplify mobile aggregate segment IDs to stable slot IDs while keeping provider metadata separate, preventing doubled markers such as `slot-1:chatgpt:chatgpt`
- reject short scrape artifacts such as `Glasp`, `Searched the web`, and `Fetching from...` before they can be stored as model replies
- keep Android on the same shared segment-ID and quality-gate behavior without changing its working scrape flow

## 2.1.1

- prefer canonical `slot_urls` over stale `slot_live_urls` when restoring iPhone sessions after a cold app restart, so note-backed sessions stop reopening older in-chat navigation targets


Versioning contract:
- canonical doc: [VERSIONING.md](./VERSIONING.md)
- bump script: [scripts/bump-version.sh](./scripts/bump-version.sh)
- validation script: [scripts/check-versioning.sh](./scripts/check-versioning.sh)

## 2.1.0

- push milestone after landing the iPhone collector parity/debugging cycle and the canonical versioning workflow
- standardize repo versioning mechanics around `VERSIONING.md`, `bump-version.sh`, and `check-versioning.sh` so push milestones consistently roll `2.x.y -> 2.(x+1).0`

## 2.0.38

- bundle `shared/js/extractLatestAssistantRaw.js` into the iPhone app so the on-device raw DOM extractor is actually available at runtime instead of silently falling back because the script was missing from app resources
- harden iPhone collect diagnostics with per-slot method/collector logging, a `Recent activity` copy action, and compact error output so Gemini/Grok/WebKit scrape failures can be debugged on-device without relying on backend payload inspection first
- align the iPhone collector closer to desktop behavior for `Gemini` and `Grok` by restoring the raw DOM extraction path on device while keeping copy-based fallback for providers that still need it

## 2.0.30

- stabilize iPhone mobile zoom behavior by keeping the shared pre-load viewport path, expanding viewport diagnostics, and rolling back the extra ChatGPT-only compensation layers after they created contradictory sizing behavior
- improve iPhone Claude resilience with a blank-screen recovery path and broader scrape/state hardening while keeping live chat URLs in new session snapshots
- document the canonical pinned-JDK Android path on this Mac and add `scripts/android-gradlew.sh` as the safe manual Gradle wrapper

## 2.0.29

- keep Android bottom slot chips icon-only even after session restore/load paths, instead of reintroducing LLM names into the mobile selector row
- add `scripts/android-gradlew.sh` as the canonical pinned-JDK wrapper for manual Android Gradle runs on this Mac

## 2.0.28
- save live iPhone chat URLs into session snapshots when available instead of persisting project preset URLs
- improve iPhone Claude scrape reliability with broader stop-state detection and desktop-aligned shared candidate selectors

## 2.0.27
- tighten the iPhone settings reveal so opening keeps chats underneath until expansion completes and closing collapses the settings screen back into the same button

## 2.0.26
- fix the iPhone settings reveal by separating opening and closing overlay content so the animation keeps the correct screen underneath and avoids the double-render flicker

## 2.0.25
- fix the iPhone settings reveal flicker by keeping the destination screen under the opening reveal and the chats screen under the closing collapse

## 2.0.24
- remove the flicker from the iPhone settings reveal, add a reverse collapse back into the same button, and replace the short settings sheet with a contextual popover beside the button

## 2.0.23
- slow down the iPhone long-press settings reveal and render the settings screen inside the expanding circle instead of a delayed shell fill

## 2.0.22
- make a normal tap on the iPhone settings button open a quick actions popup and keep the long-press circular reveal for full settings

## 2.0.21
- add a long-press circular reveal animation from the iPhone settings button while keeping normal tap behavior unchanged

## 2.0.20
- reduce the iPhone top utility controls so they align more closely with the tab pill height

## 2.0.19
- restyle the iPhone top-right utility button as a compact circular glass control aligned to the tab height

## 2.0.18
- restore the Android gear menu flow instead of the separate settings page so Find in page and the other quick actions stay one tap away in the same place as before

## 2.0.17
- add a global phone zoom control in iPhone Settings and turn per-slot diagnostics into a default-collapsed tabbed inspector so debugging stays available without flooding the whole screen

## 2.0.16
- move the iPhone clarification section below merged output so follow-up questions come after the generated answer instead of above it

## 2.0.15
- make the iPhone Merge screen much calmer by turning provider, aggregation, instructions, clarify, and output blocks into collapsible sections, while also removing noisy session-load status text and restoring the Android lavender divider before Merge as a visible foreground element again

## 2.0.14
- remove session-specific noise from the iPhone Merge screen, make recent ingest/status details collapsible, and stretch the aggregation action area across the full card width so the screen reads cleaner and more calmly

## 2.0.13
- clean up the iPhone Merge screen into a tighter Android-like structure by removing the oversized hero treatment, compacting provider and aggregation controls, and hiding secondary merge settings behind disclosure rows instead of leaving the whole screen expanded

## 2.0.12
- make the iPhone shell background fully black as a stable fallback so the top and bottom safe-area bands no longer fight a mismatched dark tint around the preserved framed chat area

## 2.0.11
- restore the iPhone chat shell visuals back toward the `2.0.0` baseline by bringing back the framed working area, the original top-tab shape, and the denser neutral bottom surfaces while keeping the newer native swipe pager and shared 90% phone zoom

## 2.0.10
- roll back the phone shell backdrop color experiments while keeping the useful structural wins: native iPhone swipe paging, normal top/content/bottom content geometry, the Settings close action, and the shared 90% phone zoom rule

## 2.0.6
- switch iPhone `Chats <-> Merge` back to a native interactive pager so swipe follows the finger instead of a custom drag approximation
- apply the shared 90% phone zoom through viewport semantics instead of raw `WKWebView.pageZoom`
- keep Android content constrained cleanly between the top bar and the bottom controls so tabs and composer no longer overlap page content

## 2.0.4
- restore the shared `90%` mobile zoom rule for every provider instead of keeping provider-specific zoom exceptions
- tighten the iPhone primary-section transition so `Chats <-> Merge` no longer feels like a hard cut

## 2.0.3
- add the shared mobile navigation rule that `Chats` and `Merge` must be reachable with horizontal swipe gestures, wire iPhone to that edge-swipe flow, and widen Android's existing edge swipe affordance so the gesture is easier to discover
- simplify the iPhone Merge screen structure by removing the extra nested navigation shell and tightening it into one cleaner primary section container

## 2.0.1
- make iPhone project selection actually pull `tags.slot_urls` from Dream Tracker and rewire slot links the same way Android already does, instead of only resetting session state
- set the default phone zoom to 90% on both iPhone and Android so mobile pages render slightly denser without per-service manual zooming

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
- roll back the extra ChatGPT-only iPhone zoom compensation layers and return it to the shared mobile viewport path, while keeping the newer diagnostics so future cold-start investigation can start from evidence instead of stacked runtime overrides
