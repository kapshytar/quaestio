# Changelog

All notable changes to this project are documented here.

Versioning: `vMAJOR.MINOR.PATCH`.

## [v0.1.18] - 2026-03-27

### Changed
- Desktop runtime version reporting now uses the repo semver from `package.json` instead of the long-stale `0.1.0`.
- Unpackaged desktop runs now label themselves as `-dev` in ingest debug logs so local testing is distinguishable from packaged builds.
- Desktop sessions no longer use a local `dismissed session ids` overlay; deleting from the Sessions dialog now removes only the selected row, matching Android behavior more closely.

## [v0.1.17] - 2026-03-27

### Changed
- Manual desktop `Collect now` now prefers a freshly scraped question prompt from the open chats before falling back to the loaded-session stored prompt.
- DOM scrape summaries now retain `prompt_candidate` metadata so post-scrape prompt recovery can actually use the nearest user turn instead of only the conversation title.

### Fixed
- `Collect now` on a loaded desktop session no longer reuses a stale session title/prompt so aggressively that a newer question in the same chats can overwrite the previous root note.

## [v0.1.16] - 2026-03-26

### Added
- Desktop `Sessions` tab now has inline search by session number or title.
- Long desktop session titles can now be expanded/collapsed with a `More` / `Hide` toggle.

### Changed
- Session-list interactions now reuse an in-memory list cache so simple UI actions do not repeatedly wait on a fresh DB-backed session reload.

### Fixed
- Desktop session rows no longer show duplicate local/remote entries when the same note-backed question is present in both sources.
- Manual merge still works when aggregation is paused.
- Session list rendering no longer regresses because of the long-title toggle UI.

## [v0.1.15] - 2026-03-25

### Changed
- Desktop `Collect now` is now enabled whenever at least one slot is enabled, even if there is no pending merge or locally remembered prompt.
- Sessionless manual collect now tries to create/update the current aggregated root directly from already open chats instead of insisting on a prior merge/send cycle.
- Session snapshot fallback now merges local cache with DB-backed rows instead of hiding locally saved entries after a reload.

### Fixed
- `Collect now` on desktop no longer stays inert before the first merge just because no prompt was sent through the app input.
- Stuck resize overlays are force-cleared on desktop window blur/visibility changes so merge-panel buttons do not silently lose clicks.
- Desktop session snapshot save uses the currently deployed bridge signature again (`p_note_id`), avoiding `404` bridge errors while saving slot-state rows.

### Known Limitations
- Best-effort source prompt recovery for sessionless `Collect now` now uses the existing DOM scrape pass, but it can still fall back to the conversation title instead of the exact last user question on some providers.

## [v0.1.14] - 2026-03-21

### Changed
- Desktop session context now persists both `session_id` and the active aggregated root note UUID in the local question-context cache.
- Desktop send, `Collect now`, and `Merge` flows now attempt to restore the current question by matching the active slot conversation fingerprint before creating a new session/root.

### Fixed
- Reopening the same LLM conversations after a restart or device handoff no longer creates a fresh note-backed session row when the question should continue in the existing chain.
- Multi-question session resume on desktop now preserves exact-note targeting instead of falling back to stale runtime-only state.

## [v0.1.13] - 2026-03-17

### Changed
- Desktop merge ingest now sends exact `aggregated_note_id` instead of relying on backend fallback by latest `session_id` note.

### Fixed
- Merge notes created after `Collect now` now attach to the current aggregated question root instead of an older type-1 note in the same session.

## [v0.1.12] - 2026-03-14

### Changed
- Merge panel labels now use plain ASCII text so Windows codepage issues do not render broken glyphs in the desktop UI.

### Fixed
- Desktop merge/session controls no longer show broken non-ASCII symbols in panel headers and buttons.

## [v0.1.11] - 2026-03-14

### Changed
- Desktop session list now uses note-backed rows as the primary source, matching web session/history behavior.
- Session snapshots are now treated as slot-state metadata instead of the canonical visible list of questions.

### Fixed
- Desktop sessions now show all questions inside the same `session_id` instead of collapsing to whichever snapshot happened to be latest.

## [v0.1.10] - 2026-03-14

### Changed
- Desktop session snapshots now send and read `note_id` as the per-question key instead of the more verbose `question_note_id`.

### Fixed
- Desktop session loading remains compatible with older rows while the database and clients roll forward to the shorter field name.

## [v0.1.9] - 2026-03-13

### Changed
- Desktop session snapshots now carry the current aggregated root note UUID so multi-question sessions can keep one row per question instead of collapsing everything into a single latest snapshot.

### Fixed
- Session history no longer treats every note inside the same `session_id` as the same logical row when loading from local cache or the database.

## [v0.1.8] - 2026-03-11

### Changed
- `debug-runs` is now treated as a local forensic workspace instead of tracked repo content; only a short policy README remains versioned.

### Fixed
- New scrape trace artifacts no longer pollute git status for normal work, while still staying available locally for regression investigation.

### Removed
- Old one-off scraper handoff/report docs from 2026-02-25 were dropped from the repo.
- Legacy tracked `debug-runs/trace_*.json` artifacts were removed from version control.

## [v0.1.7] - 2026-03-11

### Changed
- `Collect now` in desktop aggregation now re-scrapes the latest slot replies and re-ingests the current aggregated root note instead of overwriting the most recent type-1 note by session.
- Desktop aggregation state now tracks the active aggregated note UUID separately from `session_id`, so restored sessions can continue with a new question without corrupting older roots in the same session.

### Fixed
- After restoring a session and asking a new question, forced aggregation no longer rewrites the previous question root just because both notes share the same session number.
- Manual re-collection now overwrites only the exact current aggregated note when one already exists; otherwise it creates the first aggregated note for the current question.

## [v0.1.6] - 2026-03-11

### Added
- Desktop merge panel now has explicit aggregation controls: `Refresh statuses`, `Pause/Resume aggregation`, and `Collect now`.
- Slot chips now expose aggregation-stage state independently of prompt-send state, so waiting/paused/scraping/collected phases are visible before merge execution.

### Changed
- Aggregation slot-state logic is now centralized in a dedicated desktop helper instead of being buried in merge button handlers.
- Merge no longer scrapes immediately on button press; it first waits for slots to become ready, then auto-collects or hands control back for manual collection.

### Fixed
- Slow or stuck provider slots no longer force blind merge attempts without visibility into which slot is still loading.
- Desktop merge flow now supports pausing aggregation while manually fixing a broken slot, then resuming or forcing collection explicitly.

## [v0.1.5] - 2026-03-10

### Added
- Desktop scrape traces now persist raw markdown, cleaned markdown, selected DOM snapshots, parent DOM snapshots, and full-page snapshots for provider replies to make extraction regressions inspectable after the fact.

### Changed
- Provider reply extraction now uses a more structured DOM-to-markdown pass for inline math, nested lists, tables, inline formatting, and code blocks instead of flattening too much content into plain text.

### Fixed
- Gemini table cells with KaTeX content such as `E = mc^2` and `Â±0.01` no longer split across rows during desktop ingest.
- Nested list items and other structured Gemini content now survive scraping without collapsing into stray `-` markers as often.

## [v0.1.4] - 2026-03-10

### Changed
- Desktop aggregated, merge, and clarification ingest now send `platform_code` so Dream Tracker can stamp each created note with its immutable stage origin (`WIN`/`MAC`/`LNX`).
- Desktop reply extraction now preserves headings, lists, inline formatting, code fences, and tables through structured DOM-to-markdown scraping instead of flat `innerText` capture.

### Fixed
- Cross-device session chains can now be diagnosed per note stage instead of only at session level.
- Gemini and other providers no longer lose as much structural formatting before ingest into Dream Tracker.

## [v0.1.3] - 2026-03-07

### Changed
- Desktop aggregated ingest now forwards the selected project as `project_tag_id` so newly created notes land in the active Dream Tracker project.

### Fixed
- Project-selected desktop chats now create aggregated notes that attach to the chosen project and keep that attachment for downstream merge/clarification notes via backend inheritance.

## [v0.1.2] - 2026-03-07

### Changed
- Desktop merge/clarification ingest now sends raw `prompt_text` to Dream Tracker instead of generating canonical note titles locally.

### Fixed
- Merge notes created from desktop now inherit the same canonical `Merge:` title behavior as Android through backend ingest normalization.

## [v0.1.1] - 2026-03-05

### Added
- Session bridge RPC integration for desktop session CRUD.
- Session contract notes and operational docs.

### Changed
- Desktop session layer switched to bridge endpoint.
- Session restore/load behavior hardened (no stale session reuse on cold start).
- Desktop project tree panel integrated with immediate project URL overrides.

### Fixed
- Session ID race conditions and auto-refresh inconsistencies in sessions tab.
- Merge tab UI state/icon issues and mojibake fixes.
- Scrape robustness improvements to reduce prompt echo/UI noise leaks.

## [v0.1.0] - 2026-02-26

### Added
- Initial session management for desktop app.
- IPC integration for database-backed sessions.

### Changed
- Merge and ingestion workflows stabilized across providers.

### Fixed
- Crash and reliability fixes around send/ingest paths.
