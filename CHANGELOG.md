# Changelog

## 1.102.5
- make desktop Sessions treat database rows as the source of truth, so deleted/stale local session entries stop lingering after refresh
- restore desktop Sessions ordering after database refresh and show stable note-backed timestamps based on creation time instead of mutable note updates
- add a manual `Refresh` button to the desktop Sessions tab
- document renamed-title prompt identity hardening as a future option only, not current canon

## 1.102.4
- make desktop `Collect now` recover the existing aggregated root for the same `session_id + prompt` from note-backed session rows before creating a new root, so repeated collects stop duplicating `type=1` notes when current root context was lost
