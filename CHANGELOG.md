# Changelog

Parent / entry point:
- Start from [../VERITY_MAP.md](../VERITY_MAP.md)
- Repo state and current contracts live in [CURRENT_STATE.md](./CURRENT_STATE.md)

## 1.107.0
- add a sessions popup above the bottom session indicator with session-only actions, search, load, new-window, and delete controls
- make split view follow the current visual slot order after dragging slots between positions
- dim disabled slot windows with a translucent glass overlay while preserving the existing slot toggle controls
- remove misleading `disable-* = false` Chromium switches so background throttling can work normally again

## 1.106.0
- preserve multiline prompt sending for ChatGPT/Claude/Grok with the paste-based contenteditable path while keeping Gemini on its proven legacy send path
- add a Debug mode checkbox that gates slot send diagnostics in the Debug tab
- allow desktop slots to be visually swapped by dragging slot toggles without reloading the underlying webviews

## 1.105.0
- add a `Reset` action to the desktop Sessions tab that clears the current local session/aggregated-note context without deleting saved database sessions, so the next send or collect starts from a fresh question root

## 1.104.0
- preserve desktop composer line breaks when sending prompts while keeping the provider input-fill method on the proven pre-regression path

## 1.103.0
- add per-slot desktop view controls near the address bar: `Split` expands a slot within its side while preserving the opposite side, `Full` expands one slot to the whole webview workspace, and `Escape` exits either focused view mode

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
