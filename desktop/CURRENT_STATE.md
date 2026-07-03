# Current State

## Document Authority

- This file is the authoritative summary of the current functional state and contracts for `chat-aggregator`.
- Root docs in `Verity/` still win for workspace-wide or cross-repo rules.
- `CHANGELOG.md`, dated handoff docs, and older session notes are historical context only.
- `CLAUDE.md` is operational/task-entry guidance; if it disagrees with this file about current product behavior, treat that as a doc mismatch and update the docs instead of guessing.
- 2026-07-03: this monorepo (`desktop/` + `mobile/`) is now under push-ritual doc-coverage enforcement — see `../.docs-coverage-map.txt` at the repo root and `rituals/push-ritual.sh` step `[4/6]`; pushing desktop code without a matching doc/CURRENT_STATE.md touch is blocked in strict mode.

## Stable

- Cross-cutting ecosystem rules are now split into root handoff docs:
  - `SYSTEM_CAPABILITIES.md`
  - `SESSION_AND_INGEST_RULES.md`
  - `ACTION_HISTORY_AND_DB_CHANGE_LOG.md`
  - `CLIENT_VERSIONING_AND_RELEASE_RULES.md`

- Desktop runtime/app debug version now comes from `package.json` plus git metadata and is reported as:
  - packaged build: `1.x.y+<gitCount>.<gitSha>`
  - unpackaged/dev run: same build string plus `-dev`
- Desktop native top menu now includes `About -> About / Changelog`, which opens a dialog that shows:
  - runtime version
  - base semver
  - git build metadata
  - latest 30 changelog entries from local `CHANGELOG.md`
- Desktop session CRUD uses the bridge RPC path.
- Desktop session list is note-backed, matching web:
  - question rows come from `notes.note_type = 1`
  - one `session_id` can contain many visible questions
  - session snapshots are only used for slot state recovery
- Desktop aggregation state tracks:
  - `session_id`
  - `activeAggregatedNoteId`
  - question fingerprint-backed local resume context
- `Collect now` is for aggregation, not merge.
- Desktop `Collect now` is available even before merge, as long as at least one slot is enabled.
- New questions always clear the active aggregated root before the first collect.
- Restored sessions can continue with new questions without overwriting older aggregated roots.
- Manual desktop `Collect now` now resolves question identity/title in this order:
  - explicit pending prompt from a fresh send
  - fresh DOM-derived `prompt_candidate` from the open chats
  - loaded-session stored prompt only as a fallback
- When a current root is already loaded for the active branch, manual `Collect now` prefers that loaded branch over any stale pending prompt if they disagree
- Desktop `Sessions` UI now supports:
  - search by `session_id`
  - search by title
  - expand/collapse for long session titles
  - resetting the current local session/aggregated-note context without deleting saved database sessions
- Desktop session list interaction is cached in-memory after refresh so the sessions dialog feels immediate during local filtering/toggling.
- Desktop slot chips are icon-only now: the checkbox glyph is hidden, the current service icon is an inline SVG badge, and disabled slots dim to a colorless state matching mobile.
- Desktop webview headers now have per-slot focused view controls:
  - `Split` expands a slot within its own side while preserving the opposite side
  - `Full` expands one slot to the whole webview workspace
  - `Escape` exits either focused view mode
- Desktop composer preserves line breaks when sending prompts, while provider input fill still uses the proven `textContent` + input/change event path for contenteditable chat boxes.
- Desktop no longer keeps a separate `dismissed session ids` filter in local storage; local session deletion now removes only the selected row instead of hiding the whole numeric `session_id`.
- Desktop ingest sends:
  - `prompt_text`
  - `platform_code`
  - `project_tag_id` when a project is selected
  - exact `aggregated_note_id` for merge ingest, so merge notes attach to the current question root instead of whichever type-1 note was latest by session timestamp
- debug-runs/ is now a local forensic workspace. Trace artifacts stay local and are not tracked by git.
- Merge panel labels use plain ASCII text to avoid codepage-dependent UI garbage on Windows.
- Desktop is currently the scrape reference implementation; do not reintroduce shared scraper experiments here without proving parity first.
- Routine desktop verification is `../rituals/check-desktop.sh` from the workspace root, not `npm run build`.
- `npm run build` runs `electron-builder` and is a packaging/release step:
  it can write `dist/`, sign app bundles, touch `~/Library/Caches/electron`,
  and download Electron runtime zips even when Electron is already installed as
  an npm dependency. Do not run or escalate it unless a packaged artifact is
  explicitly needed.

## Stable Scrape Behavior

- Structured DOM-to-markdown extraction is active for provider replies.
- Forensic artifacts now include:
  - trace JSON
  - selected DOM snapshot
  - parent DOM snapshot
  - full-page snapshot
  - raw markdown/text
  - cleaned markdown
- Recent fixes improved:
  - Gemini math extraction
  - nested lists
  - table preservation
  - code fences

## In Progress

- Aggregation controls UX may still need iteration, but semantics are now correct:
  - `Pause aggregation`
  - `Resume aggregation`
  - `Refresh statuses`
  - `Collect now`
- Sessionless title recovery for `Collect now` is best-effort:
  - current pass reuses the existing reply DOM scrape to look for the preceding user turn
  - some providers may still fall back to the conversation title instead of the exact user message if no usable `prompt_candidate` is found in the page

## Known Issues

- `debug-runs/session-rpc.log` is local debug output and should remain out of product commits unless explicitly needed.
- Desktop scrape quality is much better than before, but provider-specific DOM changes can still regress extraction. Use `debug-runs` first before changing renderers.
- Deleting a visible session row does not necessarily destroy the underlying note-backed question context; the same chat fingerprint can still reattach to the existing question root on the next collect.
- Current local repo should stay clean except for fresh debug artifacts if you run new traces.
- If git blocks on `.git/index.lock`, first verify whether a real git process is still running. If not, remove the stale lock once and retry instead of looping failed git commands.

## Current Contracts

- Aggregated overwrite must be exact-note overwrite via `aggregated_note_id`.
- Merge ingest should also pass exact `aggregated_note_id`; `session_id` alone is not enough to identify the current question root in a multi-question session.
- `session_id` must not be used as a proxy for "current question".
- Continuing the same question after restart/device handoff is allowed again, but only when the current slot URLs match the stored question fingerprint.
- Desktop owns only thin client state; canonical note semantics live in Dream Tracker backend.

## Next Steps

- If aggregation UX is revisited again, separate clearly:
  - prompt send
  - waiting for replies
  - aggregation collect
  - merge
- If scrape quality regresses, inspect latest `debug-runs` traces before adding provider-specific patches.
- Future option only: if manual root-note renames start causing repeated desktop `same question vs new question` false positives, we can harden prompt identity by preferring fresh scrape prompt metadata or stored canonical source prompt before falling back to `title`. Current behavior remains acceptable and unchanged.
