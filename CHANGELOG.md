# Changelog

Parent / entry point:
- Start from [../VERITY_MAP.md](../VERITY_MAP.md)
- Repo state and current contracts live in [CURRENT_STATE.md](./CURRENT_STATE.md)

## 1.109.1
- make Claude reply collection on desktop prefer the DOM path before clipboard fallback, so merge ingest stops carrying clipboard-shaped formatting noise into the database

## 1.109.0
- inherit project LLM slot URLs through the clicked Projects tree path, so shared subprojects can use different root-project links depending on the selected branch

## 1.108.4
- keep the desktop Projects toolbar trigger icon-only until a project is selected
- fix desktop Sessions `More` expansion by normalizing session title expansion keys

## 1.108.3
- restore the desktop Projects trigger beside the slot chips while keeping the left chevron as a duplicate sidebar toggle
- show the active project name beside the Projects icon and tint both project triggers with the selected project database color
- move the desktop `No Project` action to the bottom of the Projects sidebar

## 1.108.2
- add icon refresh controls for desktop Projects and Sessions lists
- cache remote Projects/Sessions list loads for up to one day so startup/opening panels does not eagerly hit the database unless the user explicitly refreshes
- guard refresh actions with a short single-flight cooldown so double-clicks do not dispatch duplicate database loads

## 1.108.1
- apply the minimal public Quaestio branding layer to desktop visible titles and labels while keeping internal identifiers unchanged
- add the subtle `Quaestio veritatis` italic line between Run Merge and the merge status

## 1.108.0
- replace the desktop Projects text button with a left-aligned side-panel chevron that inherits project color from the database
- fix the desktop center address-bar chevron to properly hide address bars in split and full modes
- shift the desktop address-bar chevron to the top edge when in full mode or when both sides are in split mode

## 1.107.28
- smooth desktop right-panel and bottom-tools transitions and mask WebView resize flashes during panel layout changes

## 1.107.27
- align desktop DeepSeek and Perplexity send selectors with the shared mobile service presets so selector parity checks pass across desktop, iOS, and Android

## 1.107.26
- size the desktop side-panel wrapper to the webview grid height so the side-panel chevron stays centered between the slot rows while remaining above the panel

## 1.107.25
- move the desktop side-panel chevron into the side-panel wrapper so it stays visible above the open panel at the panel boundary

## 1.107.24
- keep the desktop side-panel chevron at the right grid midpoint while raising it above the side panel so it remains visible when open

## 1.107.23
- move the desktop side-panel chevron to the top of the right grid edge

## 1.107.22
- move the desktop Tools chevron to the bottom edge of the webview grid so it sits between the lower slots and the controls panel

## 1.107.21
- flip the desktop center address-bar chevron direction while keeping its grid-centered placement

## 1.107.20
- align the desktop side-panel chevron flush with the right edge of the webview grid

## 1.107.19
- extend inactive-slot blur to the top of each slot when address bars are hidden so no unblurred header strip remains

## 1.107.18
- reverse the desktop address-bar chevron direction to match the side-panel affordance

## 1.107.17
- anchor desktop grid chevrons inside the webview grid itself and reverse the side-panel chevron direction for clearer open/close affordance

## 1.107.16
- remove the desktop side panel header area and its `Merge Responses` title now that the panel is controlled by the external chevron

## 1.107.15
- align desktop center-grid chevrons to the slot-row divider and keep the address-bar chevron visible when the bottom tools row is collapsed

## 1.107.14
- move the desktop side-panel toggle into the right center gap as a transparent chevron and replace the Projects text button with a folder icon

## 1.107.13
- move the desktop address-bar toggle out of the bottom controls and render it as a transparent center-grid chevron between slot rows

## 1.107.12
- anchor the desktop Tools chevron to the composer so it does not jump when tools collapse, and render it as a CSS chevron instead of a text glyph

## 1.107.11
- make the desktop Tools chevron fully transparent except for the glyph, match the side-panel chevron size, and correct its open/closed direction

## 1.107.10
- make inactive desktop slot headers visually match active headers by removing stale dimming opacity/background differences from the toolbar chrome

## 1.107.9
- move the desktop Tools chevron into the gap above the composer and make its button chrome fully transparent

## 1.107.8
- normalize all four desktop slot headers to the same compact dimensions across active and inactive states

## 1.107.7
- make the desktop Tools chevron centered above the composer with a transparent hit target and muted hover-only affordance

## 1.107.6
- further compact all four desktop webview headers so split/full controls fit even when the merge side panel is wide

## 1.107.5
- make desktop webview headers compact again so provider, navigation, URL, zoom, split, and full controls remain visible when the side panel is wide

## 1.107.4
- replace the bottom Tools text button with a compact composer-adjacent chevron and keep Merge config sections collapsed by default on startup

## 1.107.3
- compact the desktop bottom controls, restore the composer to its prior size, and replace the text Merge toggle with a right-aligned side-panel chevron

## 1.107.2
- refresh the desktop visual system with a quieter Notion/Codex-style palette, softer surfaces, compact controls, and cleaner composer/panel styling

## 1.107.1
- fix split view placement after visual slot reordering so the focused split slot fills its side without leaving an empty black quadrant

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
