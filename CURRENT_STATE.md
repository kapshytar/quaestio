# Current State

## Stable

- Desktop session CRUD uses the bridge RPC path.
- Desktop session list is note-backed, matching web:
  - question rows come from `notes.note_type = 1`
  - one `session_id` can contain many visible questions
  - session snapshots are only used for slot state recovery
- Desktop aggregation state tracks:
  - `session_id`
  - `activeAggregatedNoteId`
- `Collect now` is for aggregation, not merge.
- New questions always clear the active aggregated root before the first collect.
- Restored sessions can continue with new questions without overwriting older aggregated roots.
- Desktop ingest sends:
  - `prompt_text`
  - `platform_code`
  - `project_tag_id` when a project is selected
- `debug-runs/` is now a local forensic workspace. Trace artifacts stay local and are not tracked by git.

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

## Known Issues

- `debug-runs/session-rpc.log` is local debug output and should remain out of product commits unless explicitly needed.
- Desktop scrape quality is much better than before, but provider-specific DOM changes can still regress extraction. Use `debug-runs` first before changing renderers.
- Current local repo should stay clean except for fresh debug artifacts if you run new traces.

## Current Contracts

- Aggregated overwrite must be exact-note overwrite via `aggregated_note_id`.
- `session_id` must not be used as a proxy for “current question”.
- Desktop owns only thin client state; canonical note semantics live in Dream Tracker backend.

## Next Steps

- If aggregation UX is revisited again, separate clearly:
  - prompt send
  - waiting for replies
  - aggregation collect
  - merge
- If scrape quality regresses, inspect latest `debug-runs` traces before adding provider-specific patches.
