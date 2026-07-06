# Changelog

All notable changes to this project are documented here.

Versioning: Android runtime builds are published as `v1.x.y+<gitCount>.<gitSha>`, with debug builds adding `-debug`.

## [Unreleased] - 2026-07-06

### Fixed
- WebView missing in every tab after the app process is killed in the background and the Activity is recreated from `savedInstanceState`: `MainActivity.loadSlotWithSessionOverride` now looks up the restored `ChatFragment` via `findFragmentByTag("f$slotIndex")` (falling back to the pager adapter's map) instead of relying solely on `ChatPagerAdapter`'s in-memory map, which `FragmentStateAdapter` never repopulates when it restores fragments directly from the `FragmentManager`.
- Black screen after returning to the app from long background: `ChatFragment.onRenderProcessGone` now saves the crashed WebView's state (`saveState`) before recreating it, and `recreateRetainedWebView` always loads something on the new WebView — restored state, else the fallback URL, else the last known page URL (`savedWebViewUrl`), else the slot's default service URL — instead of silently loading nothing when `url` was null/blank.
- `MainActivity` now calls `resumeTimers()`/`pauseTimers()` on a live WebView from `onResume`/`onStop` (whole-app foreground/background transitions only, not per-tab `ChatFragment.onPause` during ViewPager2 swipes, which would have frozen background tabs' JS timers).
- `MainActivity.onTrimMemory(level)` flushes `CookieManager` on `TRIM_MEMORY_UI_HIDDEN`+ without touching WebView lifecycles.

## [v1.102.0] - 2026-03-28

### Added
- Android settings menu now includes `About` and `Changelog` dialogs inside the client.
- Latest 30 changelog entries are bundled into the APK at build time, so the changelog dialog works offline.

### Changed
- Android visible runtime versioning now includes git metadata (`commit count + short sha`), so every new pushed commit produces a distinct client build string without manual hand-editing of version labels.

## [v1.0.102] - 2026-03-28

### Fixed
- Android manual `Collect now` no longer fails with a false `Server ingest failed` when session context recovery touches `WebView.url` from a background thread; current slot URL collection is now marshalled to the main thread safely.
- Project selection now applies immediately on tap instead of waiting for the project panel close animation, so `Collect now` can attach the selected project reliably even during quick follow-up actions.

## [v1.0.102] - 2026-03-27

### Changed
- Android versioning now reads its increment from checked-in `version.properties` instead of silently collapsing local builds to the same fallback version forever.
- Debug ingest logs now include a `-debug` suffix in `app_version`, so local APK traces are distinguishable from packaged/release builds.

## [v1.0.x] - 2026-03-27

### Changed
- Android `Collect now` now mirrors desktop prompt resolution:
  - prefer fresh pending prompt from in-app send
  - otherwise recover fresh question identity from DOM `prompt_candidate`
  - only then fall back to the loaded/root question prompt
- Android scrape metadata now includes `document_title` and `prompt_candidate` so the collect path can reason about the actual latest question in already-open chats.

### Fixed
- Manual Android `Collect now` no longer overwrites the currently loaded aggregated root just because the same chat URLs are still open.
- If the user asks a newer question in the same chats and the first ingest glitched, Android now creates a new aggregated question root instead of rewriting the first one with the second answer set.

## [v1.0.x] - 2026-03-26

### Added
- Android sessions dialog now supports inline search by session number or title.
- Long Android session titles can now be expanded/collapsed inside the sessions dialog.

### Changed
- Sessions dialog title styling is lighter and calmer, so the session number stays visually distinct from the session title.
- Search field styling and `More` / `Hide` tap targets were adjusted for better readability and fewer mis-taps.
- Long-title expansion now uses actual rendered line count instead of a rough character-length guess.

### Fixed
- Android sessions dialog now deduplicates overlapping local/remote rows more reliably when the same note-backed question exists in both sources.

## [v1.0.x] - 2026-03-25

### Changed
- Android `Collect now` is now enabled whenever at least one slot is enabled, even if no prompt was sent through the in-app input.
- Sessionless manual collect now reuses pending prompt when available and otherwise allows a direct aggregated ingest from already open chats.

### Fixed
- Android no longer blocks `Collect now` with `Prompt is empty` when the user wants to create/update a question from existing open chats instead of the standard send flow.

## [v1.0.x] - 2026-03-21

### Changed
- Android now restores the current question context from saved slot URL snapshots before `Collect now` and merge-style writes, instead of depending only on in-memory/runtime ingest state.
- Android startup now delays non-critical session UI work and no longer auto-loads disabled slots during initial WebView scheduling.

### Fixed
- Reopening the same conversations on Android after runtime loss no longer creates fresh note-backed sessions when the slot URLs still point at the same logical chats.
- Android startup is lighter because disabled slots are no longer eagerly loaded and hard refresh paths avoid unnecessary full WebView recreation.

## [v1.0.x] - 2026-03-17

### Changed
- Android merge ingest now sends exact `aggregated_note_id` for the active question root instead of relying on session-level parent fallback.
- Slot context menu now separates light `Reload` from explicit `Hard Reload`.

### Fixed
- Merge notes created after a fresh collect now attach to the current question root instead of an older type-1 note in the same session.
- Regular tab reload no longer pays the full cost of a hard WebView recreation unless explicitly requested.

## [v1.0.x] - 2026-03-14

### Changed
- Android `Collect now` and background aggregation now abort instead of overwriting a note with only a partial subset of enabled slot replies.
- Merge debug messaging now reports the concrete failure reason when collection is blocked, including which enabled slots were missing.
- ChatGPT reply normalization on Android no longer runs the aggressive table conversion pass that was turning prose into fake markdown tables.

### Fixed
- Partial Android collects no longer erase provider tabs in web by overwriting a note with only one provider segment.
- Manual collection on Android now preserves the current note when one or more enabled providers fail to return a reply.

## [v1.0.x] - 2026-03-14

### Changed
- Android session list now uses note-backed question rows as the primary source, matching desktop and web semantics for multi-question sessions.
- `aggregator_sessions` on Android is now treated as slot-state support data instead of the canonical visible session-question list.
- Android CI artifact retention was shortened to keep GitHub artifact storage under control.

### Fixed
- Android no longer mixes remote note-backed session rows with stale local snapshot cache into one oversized duplicate-filled session dialog.
- Kotlin build cache noise (`.kotlin/`) is now excluded from normal git hygiene.

## [v1.0.x] - 2026-03-14

### Changed
- Android session snapshots now use `note_id` as the per-question snapshot key name instead of `question_note_id`.

### Fixed
- Mobile session sync and restore remain compatible with older snapshot payloads while the backend and clients converge on the shorter field name.

## [v1.0.x] - 2026-03-13

### Changed
- Android session snapshots now store the active aggregated root note UUID, so one `sessionId` can expose multiple questions without collapsing them into one latest row.

### Fixed
- Mobile session history no longer hides earlier questions in the same session just because they share the same `sessionId`.

## [v1.0.x] - 2026-03-13

### Added
- Android merge screen now exposes an in-app debug log under debug mode so aggregation and merge phases are visible without attaching logcat.

### Changed
- Android merge controls keep `Refresh statuses`, `Pause aggregation`, and `Collect now` in a single-row layout with stable tap targets.
- Project URL overrides now normalize slot key casing so selected-project links resolve more consistently on mobile.

### Fixed
- Automatic merge preparation no longer triggers a second aggregated ingest write after the background auto-aggregation path has already written the session note.
- `Collect now` remains the only explicit manual re-ingest path for aggregated notes on Android.
- Android session history now collapses repeated snapshots of the same logical `session_id` instead of showing duplicate saved states.
- Saving a session on Android now reuses the latest local snapshot for the same `session_id` instead of appending another clone.

## [v1.0.x] - 2026-03-11

### Changed
- Android now tracks the active aggregated root note separately from `session_id`, matching desktop semantics for repeated aggregation within a multi-question session.
- Android `Collect now` re-ingests the exact current aggregated note when available instead of relying on session-wide latest-note overwrite behavior.

### Fixed
- Restoring a session and then asking a new question no longer risks rewriting the previous aggregated root when forcing a new collection.
- Android now stores backend note UUIDs correctly for aggregated ingest instead of assuming numeric note IDs.

## [v1.0.x] - 2026-03-11

### Added
- Android merge screen now has explicit aggregation controls: `Refresh statuses`, `Pause/Resume aggregation`, and `Collect now`.
- Per-slot aggregation status summaries are now rendered in the merge tab before the actual merge call runs.

### Changed
- Aggregation state is now modeled in dedicated Android helper types instead of being implied inside `MergeFragment` callbacks.
- Android merge now waits for slot readiness first, then auto-collects or hands control back for manual collection.

### Fixed
- Slow/stuck Android slots no longer force immediate merge scraping without visibility into readiness.
- Manual intervention is now possible during Android aggregation without abandoning the pending merge flow.

## [v1.0.x] - 2026-03-10

### Changed
- Android structured extraction now mirrors the desktop Gemini/DOM walker more closely for inline math, nested lists, tables, and code blocks before ingest normalization.

### Fixed
- Gemini replies with KaTeX-backed table cells and nested lists no longer degrade as aggressively during Android scraping.
- Android scrape normalization now stays aligned with desktop for the same provider responses, reducing cross-client formatting drift.

## [v1.0.x] - 2026-03-10

### Changed
- Android aggregated, merge, and clarification ingest now send `platform_code = AND` so Dream Tracker can stamp each created note with immutable stage origin.
- Android post-normalization of scraped replies now matches desktop more closely for lists, pipe tables, whitespace cleanup, and UI-artifact stripping across providers.

### Fixed
- Mixed-device session chains can now distinguish Android-created merge/clarification steps from notes created on desktop or web.
- Structured Gemini/Grok replies keep more of their original markdown-style layout before ingest.

## [v1.0.x] - 2026-03-07

### Changed
- Android aggregated ingest now forwards the selected Dream Tracker project as `project_tag_id`.

### Fixed
- Notes created from Android while a project is selected now attach to that project, and downstream merge/clarification notes inherit the same project membership through backend ingest.

## [v1.0.x] - 2026-03-07

### Changed
- Android merge/clarification ingest now sends raw `prompt_text` to Dream Tracker and relies on backend title normalization.

### Fixed
- Merge note naming is now aligned with desktop/web through the shared backend ingest rule instead of duplicated client-side formatting.

## [v1.0.x] - 2026-03-06

### Added
- Project tree selector in Android app tied to Dream Tracker backend projects.
- Bridge RPC session CRUD integration aligned with desktop/web.
- Session list improvements (history behavior, timing, ordering updates).

### Changed
- WebView lifecycle and message delivery handling stabilized.
- Tab/project URL behavior updated to use project-specific slot defaults.
- Debug/release separation and CI release hardening continued.

### Fixed
- Table rendering issues in WebView.
- Intermittent delivery and lifecycle-related UI glitches.
- Session list consistency issues after project/session actions.

## [v1.0.x] - 2026-02-28

### Added
- Play-testing readiness work (branding, packaging, CI artifacts).
- Credential protection/obfuscation and release build hardening.

### Changed
- Top bar/tab visual system and color normalization.

### Fixed
- Black-screen and layout/background regressions across startup flows.
