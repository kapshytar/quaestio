# Changelog

All notable changes to this project are documented here.

Versioning: `vMAJOR.MINOR.PATCH`.

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
- Gemini table cells with KaTeX content such as `E = mc^2` and `±0.01` no longer split across rows during desktop ingest.
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
