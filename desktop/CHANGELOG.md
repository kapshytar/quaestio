# Changelog

## 1.112.8

- New "◫" side-by-side view toggle next to Split in each slot header: lays out
  every enabled chat as a full-height vertical column in a single row (2 enabled
  → 2 vertical panes, N enabled → N columns; disabled slots hidden). Mutually
  exclusive with the per-slot Split/Full modes — entering one clears the other.
  Active state is highlighted, persisted to `localStorage`, restored on startup,
  and the column layout recomputes when chats are enabled/disabled.

## 1.112.7

- Merge-panel toggle restyled into a round neon disc: layered radial gradients
  in the brand violet/blue (ported from the web `.landing-neon-bg`), each
  fading to its own transparent hue (no grey banding), softened by a radial
  mask so the disc has no hard edge. `clip-path` keeps the transparent corners
  click-through so the slot buttons underneath stay clickable, and the disc's
  right half tucks under the panel edge (`#side-panel` z-index above it).
- The disc is dim and static by default, and pulses bright (opacity + filter
  brightness) only while webviews are waiting for replies, driven by the
  existing `hasActiveWebviewWork()` signal via a new `llm-busy` class.
  Class removal is debounced (1.2s) so brief busy gaps between phases don't
  restart the animation, and the pulse fades out smoothly by freezing the
  animated value inline before transitioning back to dim.

## 1.112.6

- Fix: loading a saved session now also restores its project. Bridge `list`
  rows carry a derived `project_tag_id`; `loadSession()` activates it via
  `setActiveProject(..., { applySlotUrls: false })` — a new option so project
  activation no longer re-applies the project's slot URLs over the session's
  just-restored ones. Old backend rows without the field → no-op.

## 1.112.5

- Open-sourcing prep: dual licensing added — LICENSE (AGPL-3.0), NOTICE
  (`AGPL-3.0-only OR LicenseRef-Commercial`, proprietary option by contact),
  CONTRIBUTING.md with inbound license grant; package.json license field fixed
  from stale MIT to AGPL-3.0-only.
- README rewritten as a product page (English): Quaestio positioning, features,
  quick start, shortcuts, related repos, license section. Secrets sweep of the
  repo (working tree + full git history) came back clean — no scrub needed.

## 1.112.4

- fix signed-in client silently degrading to local-only after the access token
  expired: `auth-store.js` `refresh()` cleared the session on *any* non-2xx, so
  an expired ~1h token whose refresh hit a transient error nuked a valid session
  — the gate then returned null and the Sessions list showed stale local rows
  while the account looked signed in. `refresh()` now clears only on a
  definitive auth rejection (HTTP 400 `invalid_grant` / 401) and keeps the
  session on transient 5xx/network failures (later call retries); it logs the
  failure code+body.
- surface session expiry: a definitive refresh rejection raises a one-shot
  flag (`consumeSessionExpired`, exposed via the new `auth-consume-session-expired`
  IPC). The Sessions loader consumes it and shows "session expired — sign in
  again" + refreshes the Account panel to signed-out, instead of quietly
  returning the local cache. A fresh sign-in and an explicit sign-out clear it.
  Mirrors iOS/Android and `shared/contracts/AUTH_AND_SESSION_SYNC.md` (in the
  chat-aggregator-mobile repo).

## 1.112.3

- late-login session migration: after signing in, the desktop offers to upload
  local-only sessions (saved while signed out) to the account. It uses the new
  `aggregator_sessions_bridge_v1` `migrate` action, which allocates a fresh real
  `session_id` server-side (instead of persisting the local 900000+ number, which
  collides across devices) and stamps `owner_id` from the JWT. New
  `dream-migrate-session` IPC / `migrateSession` bridge.
- fix new question resurrecting a pre-login session: after sign-in/migration the
  slot-fingerprint context restore could attach a new question to an old session
  sharing the slot layout. A one-shot suppress flag (set on sign-in, lifted on
  explicit load or fresh ingest) makes the first post-login question start fresh.
- fix migrated sessions vanishing from the Sessions list: after late-login
  migration, note-less session rows (`session_id >= 900000`, `note_id = null`)
  uploaded to the account were dropped by `dream-load-sessions`, which returned
  only note-backed rows whenever any existed. The migrated rows persisted on the
  server (verified) but disappeared from the UI because their local copies were
  removed. The handler now appends session-only snapshots (no matching note)
  alongside the note-backed rows so they stay visible.

## 1.112.2

- fix signed-out local sessions: a signed-out send produced no session at all
  because the auto-save only ran inside the ingest success path
  (`finalizeAggregatedIngest`), which never executes when the backend is gated
  off. `sendToAll` now detects signed-out (`authGetStatus`), allocates a local
  session number (base 900000, parity with iOS/Android), saves the slot snapshot
  to the local cache, and skips the ingest/aggregation arming entirely. Sending
  to the chat webviews still works; only the backend calls are skipped.
- Local-only Sessions tab: when signed out, `loadSessionsList` and
  `deleteSession` no longer call the backend (which threw "Not signed in" and
  surfaced a scary `DB load failed` banner on every load/delete). They now read
  and write the local cache directly, so loading and deleting locally-saved
  sessions works cleanly while signed out.

## 1.112.1

- Multi-user local-only gate: when signed out the desktop now makes **zero**
  Supabase calls (ingest, session bridge, REST reads, debug log all skipped) —
  the publishable-key fallback in `getAuthBearer` is removed and replaced with
  `userBearerOrNull` + a shared `auth-gate.js` rule, so a signed-out desktop no
  longer writes rows anonymously (`owner_id = null`). Signed-in behaviour is
  unchanged. Sessions still fall back to the local store when signed out.
- New `auth-gate.js` (pure `bearerOrNull` gate rule) and `test/auth-gate.test.js`
  (run with `npm test`): proves signed out ⇒ no usable bearer ⇒ no backend call.
  Mirrors the mobile `AuthStore` gate and `shared/contracts/AUTH_AND_SESSION_SYNC.md`.

## 1.112.0

- Multi-user (desktop step A+B): add Supabase Auth sign-in. New **Account** tab
  in the config panel (email/password sign in, status, sign out). When signed
  in, every Supabase RPC/REST call sends the user's access token as
  `Authorization: Bearer` (the `apikey` stays the publishable key), so the
  backend `owner_id` triggers attribute ingested notes/sessions to the account.
  When signed out, behaviour is unchanged (legacy anon). Tokens are persisted
  encrypted via Electron `safeStorage` and auto-refreshed.
- New `auth-store.js` (main-process Supabase Auth: sign-in/out, token refresh,
  secure persistence).
- First-run onboarding modal: on first launch (no prior choice, not already
  signed in) the app asks whether to **Sign In** (inline email/password) or
  **Use Locally** (sessions only). The choice is remembered in `verity-mode`.

## 1.111.12

- fix desktop Supabase fallback: 1.111.11 repointed it to the DELETED Sydney
  project (`bjqkvlsneujrcfpvcvzf`, mislabeled "European") with a service_role
  JWT, causing `fetch failed` on session load and `Ingest RPC failed`. Point it
  at the real EU/Frankfurt project (`pphntxcslmbymvcwvhnr`) with the publishable
  anon key. Restart the desktop to pick it up.

## 1.111.11

- repoint Supabase fallback URL and service role key to the new European server project (bjqkvlsneujrcfpvcvzf) so the desktop application correctly loads sessions and projects after migration

## 1.111.10

- repoint Supabase to the new Frankfurt project (eu-central-1) and switch from
  the embedded service_role JWT to the publishable (anon) key. The ingest/session
  RPCs are SECURITY DEFINER granted to anon, so the desktop no longer ships a
  secret key. Restart the app to pick up the new endpoint.

## 1.111.9

- fall back from ChatGPT copy extraction to DOM extraction when the copied text is only the user's prompt, so the assistant reply reaches aggregated ingest

## 1.111.8

- prevent duplicate desktop question roots when the same prompt is sent again in the same slot fingerprint by overwriting the known aggregated root instead of forcing a new one
- keep desktop webviews fully active when the app merely loses focus on the same visible workspace; low-power mode now only follows real hide/minimize state

## 1.111.7

- refresh the desktop color system from the finalized Q app icons with a minimal dark glow palette and a softer light-theme palette
- reduce desktop background GPU work by throttling webview frame rate and pausing local UI animation when the window loses focus
- add an idle-only desktop low-power mode that freezes background webviews through Chromium lifecycle controls while preserving active sends, aggregation, and merge work

## 1.111.4

- replace the macOS desktop icon PNGs with finalized Icon Kitchen exports so the Quaestio Q app icon matches native macOS launcher styling

## 1.111.3

- refresh the desktop app icon set with the new Quaestio Q artwork, including light and dark runtime variants for theme-aware window/dock icons

## 1.111.2

- make desktop session deletion remove the note-backed question root plus merge/clarification children, while preserving other child notes by reparenting them to the previous parent

## 1.111.1

- fix Grok desktop DOM scraping to reject right-aligned user bubbles before ranking response candidates, so a still-loading Grok answer cannot ingest the user's prompt as the Grok slot

## 1.111.0

- fix desktop slot chips: service icons now show real favicons captured from the live webview via `page-favicon-updated`, falling back to letter-badge SVG before any page loads
- fix root cause of icons never rendering: `toggles[slot]` was the checkbox `<input>`, not the `.toggle` wrapper, so `.querySelector('.toggle-icon')` always returned null — fixed with `closest('.toggle')`
- hide checkbox glyph: added `position: relative` to `.toggle` and `appearance: none` + `overflow: hidden` to `.toggle input`

## 1.110.3

- switch the desktop slot chips to inline SVG icons so they render reliably without relying on image loading

## 1.110.2

- replace the desktop slot-chip checkboxes with icon-only chips and make the service icons deterministic so they always render

## 1.110.1

- add service icons to the desktop slot chips and gray them out when the slot is disabled

## 1.110.0

- pending summary


Parent / entry point:
- Start from [../VERITY_MAP.md](../VERITY_MAP.md)
- Repo state and current contracts live in [CURRENT_STATE.md](./CURRENT_STATE.md)

## 1.109.2
- make desktop manual Collect now prefer the currently loaded question context when the pending prompt is stale, so re-ingest does not reuse an older branch title

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
