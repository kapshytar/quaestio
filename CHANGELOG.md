# Changelog

Parent / entry point:
- Start from [../VERITY_MAP.md](../VERITY_MAP.md)
- Repo state and current contracts live in [CURRENT_STATE.md](./CURRENT_STATE.md)

## 1.102.7
- make the desktop composer multiline by switching it to an auto-growing textarea; `Enter` still sends and `Shift+Enter` inserts a line break

## 1.102.6
- store desktop aggregate segments with stable slot IDs while keeping provider metadata separate, matching the mobile ingest contract
- reject short scrape artifacts such as `Glasp`, `Searched the web`, and `Fetching from...` before they can be saved as provider replies
- keep backward-compatible status detection for legacy `slot:provider` segment IDs during the transition

## 1.102.5
- make desktop Sessions treat database rows as the source of truth, so deleted/stale local session entries stop lingering after refresh
- restore desktop Sessions ordering after database refresh and show stable note-backed timestamps based on creation time instead of mutable note updates
- add a manual `Refresh` button to the desktop Sessions tab
- document renamed-title prompt identity hardening as a future option only, not current canon

## 1.102.4
- make desktop `Collect now` recover the existing aggregated root for the same `session_id + prompt` from note-backed session rows before creating a new root, so repeated collects stop duplicating `type=1` notes when current root context was lost
