# Current State

## Document Authority

- This file is the authoritative summary of the current functional state and contracts for the `android/` module of `chat-aggregator-mobile`.
- Root docs in `Verity/` still win for workspace-wide or cross-repo rules.
- `CHANGELOG.md`, dated handoff docs, and older session notes are historical context only.
- `CLAUDE.md` is operational/task-entry guidance; if it disagrees with this file about current product behavior, treat that as a doc mismatch and update the docs instead of guessing.

## Stable

- Saved conversation URLs survive provider SPA redirects (2.9.0/2.9.1): `ChatFragment.rememberLoadUrl` refuses to overwrite a saved conversation URL with the provider's home URL (Gemini could client-side redirect to home and silently clobber `savedWebViewUrl`); since 2.9.1 the guard also blocks the navigation itself — `rememberLoadUrl` returns acceptance and `loadTrackedUrl` skips `webView.loadUrl` when a home default would clobber a live conversation (previously `loadService` re-loaded provider home right after session restore → ~11s home/new window where Send didn't fire). `doUpdateVisitedHistory` logs slot+url. Collect targets the server-resolved chain tail (`SessionManager.getChainTailNoteId`, created_at order) with local fallback.
- Merge aggregation readiness (2.8.10): `MergeFragment.waitForAggregationReadyOrPause` adds a text-stability gate on top of the slot READY status — after all slots report READY (stop-button check), it re-scrapes via `collectLatestRepliesFromEnabledSlots` and only collects once every slot's text is non-empty AND unchanged from the previous poll, so a still-streaming reply that slipped past the stop-button selectors is no longer frozen into the note.
- WebView renderer-crash recovery (`ChatFragment`) always loads a page after `onRenderProcessGone`: restores saved state if possible, else falls back to last known URL / slot default, fixing the black-screen-after-background bug; `MainActivity` resumes/pauses WebView JS timers on whole-app foreground/background (not per-tab) and flushes cookies on `onTrimMemory`.
- Cross-cutting ecosystem rules are now split into root handoff docs:
  - `SYSTEM_CAPABILITIES.md`
  - `SESSION_AND_INGEST_RULES.md`
  - `ACTION_HISTORY_AND_DB_CHANGE_LOG.md`
  - `CLIENT_VERSIONING_AND_RELEASE_RULES.md`

- Android app/debug version now comes from checked-in `version.properties` plus git metadata:
  - `VERSION_CODE` remains the monotonic Android store/build code source
  - visible runtime version is built as `VERSION_BASE.VERSION_PATCH+gitCount.gitSha`
  - debug builds add `-debug`
- Android settings menu now includes:
  - `About` with runtime version + git build metadata
  - `Changelog` with the latest 30 bundled entries from `CHANGELOG.md`
- Android and desktop versions are now meant to read as the same visible `1.x.y+git` family, even though Android still keeps its own monotonic `VERSION_CODE` for install/build semantics.
- Android session management is aligned with desktop on bridge/session semantics.
- Android session list is now note-backed like desktop/web:
  - visible question rows come from `notes.note_type = 1`
  - one `session_id` can contain many questions
  - `aggregator_sessions` is used only for slot state recovery/fallback
- Android performs one background startup session reconcile only when the last successful web refresh is at least 15 minutes old; it preserves local-only rows, leaves the active session context untouched, and shows the persisted web-sync time in the sessions dialog.
- Android aggregation now tracks:
  - `session_id`
  - `activeAggregatedNoteId`
  - slot URL-backed resume context
- Collect now re-ingests the exact current aggregated root when available.
- Android `Collect now` can also start from already open chats without a fresh in-app prompt send, as long as at least one slot is enabled.
- Android `Collect now` now resolves question identity with the same order as desktop:
  - fresh pending prompt from in-app send
  - fresh DOM `prompt_candidate` from the currently open chats
  - loaded/root question prompt fallback
- Android scrape metadata now preserves:
  - `document_title`
  - `prompt_candidate.text`
  - `prompt_candidate.top/bottom`
- Android merge ingest now also sends exact `aggregated_note_id`, so merge notes attach to the currently active question root instead of relying on session-level fallback.
- Android manual `Collect now` now follows desktop semantics for partial results:
  - partial reply sets may still be ingested
  - prompt mismatch must still force a new root instead of overwriting the current one
- Android sessions dialog now supports:
  - search by `session_id`
  - search by title
  - expand/collapse for long titles
- Android sessions dialog title typography is intentionally lighter than the session id label.
- Android ingest sends:
  - `prompt_text`
  - `platform_code = AND`
  - `project_tag_id` when a project is selected
- Merge/clarification ingest relies on backend title normalization.

## Stable Scrape Behavior

- ChatGPT prose keeps list formatting without aggressive pseudo-table conversion.
- Merge debug now reports explicit collect failure reasons such as missing slots.
- Android manual `Collect now` can safely recover current slot URLs during ingest-related session context checks without tripping `WebView` thread violations.
- Project selection is applied immediately on tap, so project-linked collect/ingest actions do not depend on panel close timing.

- Android structured extraction is aligned with desktop more closely for:
  - tables
  - nested lists
  - inline math
  - code blocks
  - whitespace cleanup

## In Progress

- `WebView` lifecycle hardening to reduce:
  - black-screen flashes
  - cold reload feel
  - unnecessary page restarts
- First pass is implemented:
  - `WebView` is reattached on `onDestroyView()` instead of being destroyed immediately
  - fallback `saveState/restoreState`
  - avoid redundant `loadUrl()` to the same URL
  - slot menu now separates light `Reload` from explicit `Hard Reload`

## Known Issues

- Android black-screen/cold-reload issue is improved but not yet declared closed.
- If the remaining issue persists after this first pass, the next step is activity-level `WebView` pooling/store instead of fragment-level retention.
- Old deleted docs/log files may still exist historically in the repo; current functional state should be tracked here and in changelog instead.
- Android CI artifact storage is now kept on short retention; if GitHub quota errors reappear, first inspect workflow artifact retention before changing build logic.

## Current Contracts

- Same aggregation overwrite contract as desktop:
  - overwrite only by exact `aggregated_note_id`
  - never by "latest note in session"
- Android manual `Collect now` now only overwrites the current aggregated root when the recovered prompt still matches that root question.
- Same merge parent contract as desktop:
  - merge should target exact `aggregated_note_id` when available
  - session fallback exists only for legacy clients
- `session_id` can contain many question roots; do not use it as question identity.
- Android may resume the current question only when the active slot URLs match a previously saved logical conversation snapshot.
- `origin_platform_code` on notes records platform of the created stage, not device hardware identity.
- Android `Collect now` false `Server ingest failed` errors caused by background-thread `WebView.url` access are considered fixed in the current client.

## Next Steps

- Validate whether the current `WebView` retention pass materially reduces black-screen behavior in real usage.
- If not enough, move to activity-level retained `WebView` instances per slot.
- Validate the new Android prompt-aware `Collect now` against long multi-question chats, especially ChatGPT fallback paths with no exact prompt anchor.
