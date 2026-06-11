# Changelog

## 2.5.10

- Fix jittery iOS bottom tray around the keyboard. Previously a tap recognizer
  on the slot webview collapsed the tray on ANY tap, then a 450ms timer and the
  `keyboardWillHide` handler raced each other to restore it — tapping the work
  area to dismiss the keyboard randomly hid/showed the tray. The tap heuristic
  and timer are gone; tray visibility is now a pure function of state:
  collapsed iff the keyboard is up and the native composer is not focused
  (composer focus tracked via `UITextViewDelegate`). Swipe-up restore still
  works via an explicit `keepsTrayDuringWebInput` override that resets when the
  keyboard hides or the slot changes. Composer focus flags are set synchronously
  (before `keyboardWillShow` lands), and sheet keyboards (project/session
  search) don't collapse the tray behind the sheet.
- Move iOS chrome onto floating glass islands: top slot tab bar (now capsule
  chips), bottom composer tray, slot control strip, and the settings quick
  popover use a shared `glassIsland` modifier — native Liquid Glass
  (`glassEffect`) on iOS 26+, `ultraThinMaterial` + stroke + shadow fallback on
  iOS 17–25, and an opaque fill when Reduce Transparency is enabled.


## 2.5.9

- Fix offline (signed-out) sends allocating a new local session number on every
  question (iOS + Android). Offline there are no notes, so the question-context
  reset — which clears the parallel-ingest session id so a fresh question starts
  a new note — fired on every send (its `hadCurrentQuestionContext` guard is
  always false without a note), wiping the local id and bumping `S9000xx` each
  time. That reset is now applied only on the signed-in ingest path; offline, the
  local session id stays stable so consecutive questions in the same slot layout
  reuse one session (one session per layout, matching the desktop). Starting a
  new local session is done via the sessions UI / clear-active action.

## 2.5.8

- Fix Android session delete not propagating to the backend / web: long-press
  delete sent only `p_record_id` = the snapshot UUID to the bridge `delete`
  action. With no `p_note_id`, the bridge falls back to
  `delete_aggregator_session(p_record_id::integer)`, and casting a UUID to int
  throws — the fire-and-forget thread swallowed the error, so the session was
  removed from the on-device list but survived in Supabase and kept showing in
  the web. Delete now passes the integer `p_session_id` and the `p_note_id` (like
  the desktop client), so the bridge deletes the note subtree (removing it from
  the web's notes tree) and the `aggregator_sessions` rows.
- Note: iOS still has no per-session delete (only "Clear Active Session") — a
  known parity gap to close separately.

## 2.5.7

- Fix local-only sessions being wiped from the list after signing in (iOS +
  Android): `loadSessions`/`showSessionsDialog` replaced the on-device store with
  the cloud list, which never contains local-only sessions (`session_id >=
  900000`, saved while signed out and not yet migrated) — so signing in silently
  deleted any pending local session before the user could migrate it. The cloud
  list now preserves local-only sessions it doesn't already represent.
- iOS: show the session indicator for note-less sessions. `makeSessionIndicator`
  required a non-empty aggregated note id, so loading or saving a local session
  (which has no note) left the `S…` indicator blank. It now shows `S<id>`
  whenever a session is active, matching the desktop and Android indicators.

## 2.5.6

- Fix a new question getting attached to an unrelated old session (observed on
  Android: a fresh prompt saved into stale session 158 instead of the open one).
  The slot-fingerprint session restore matched any old session whose slot layout
  reduced to the same value — and on a ChatGPT **Temporary Chat** or a fresh home
  page there is no conversation id, so `extractConversationKey` degrades to a
  generic origin (or "temporary") that collides with old sessions; the blank
  source-prompt escape then let it match on slots alone. Restore now requires the
  current slots to reference a *real, identifiable conversation* (a chat id) via
  the new `fingerprintHasRealConversation` guard — on generic/temporary pages it
  starts fresh instead of resurrecting a stale session. This converges iOS +
  Android onto the desktop behaviour (desktop keys context by the exact
  real-conversation fingerprint, so a generic page never hits a stored session).

## 2.5.5

- Fix locally-saved sessions never appearing in the iOS Sessions list while the
  local counter kept advancing (observed: status "Saved locally (S900004)" but
  the list stayed empty). `SessionSnapshot` decoding was all-or-nothing: a single
  legacy/partial stored row missing a non-optional field (e.g. an older entry
  without `slot_live_urls`) threw and emptied the **entire** decoded array, so
  `getAllSessions()` returned nothing even though new rows were written. Decoding
  is now tolerant per-row (missing fields fall back to empty defaults), so one
  bad row can't hide all sessions.
- iOS Shell diagnostics now show a "Sessions: stored X / shown Y" status row, so
  a save-vs-display mismatch is visible on-device without log tooling.

## 2.5.4

- Fix signed-in clients silently falling back to local-only after the access
  token expired (iOS + Android). Supabase access tokens live ~1h; when one
  expired, `refresh()` cleared the session on *any* non-2xx response — so the
  gate returned null, every Supabase call was skipped, and the Sessions list
  quietly showed stale **local** rows while the Account UI still said "signed
  in" (observed on Android: 328 stale local sessions instead of the 333 cloud
  ones; re-sign-in fixed it). `refresh()` now clears the session only on a
  definitive auth rejection (HTTP 400 `invalid_grant` / 401 — refresh token
  revoked/expired) and **keeps** it on transient 5xx/network failures so a later
  call retries; it also logs the failure code+body.
- Surface session expiry instead of lying about being signed in (iOS +
  Android): a definitive refresh rejection raises a one-shot session-expired
  flag; the Sessions load consumes it and shows "session expired — sign in
  again" (Android prompts the Account dialog; iOS shows an alert) rather than
  silently degrading to stale local sessions. A fresh sign-in and an explicit
  sign-out both clear the flag. See `shared/contracts/AUTH_AND_SESSION_SYNC.md`.

## 2.5.3

- Late-login session migration (iOS + Android): after signing in, if any
  local-only sessions exist (`session_id >= 900000`, saved while signed out),
  the client offers to upload them to the account. On confirm, each is re-saved
  through the gated `aggregator_sessions_bridge_v1` `migrate` action with the
  JWT: the backend allocates a fresh real `session_id` (instead of the local
  900000+ number, which collides across devices) and stamps `owner_id` from the
  JWT. Migrated copies are then removed locally so the next refresh shows the
  now-owned rows from the DB (no duplicates). "Not now" leaves them local; the offer recurs on
  the next sign-in. Purely client-side, no backend change. Mirrors the desktop
  implementation and `shared/contracts/AUTH_AND_SESSION_SYNC.md`.
- Fix local session numbering (iOS + Android): a signed-out send reused the
  leftover parallel-ingest `session_id` from a prior signed-in session (e.g. a
  real backend id like 199), so the local session collided with a real DB row
  and was invisible to late-login migration (`< 900000`). `saveLocalSession` now
  reuses an id only when it is itself local (`>= 900000`), otherwise allocates a
  fresh local number. This is also why the migration prompt did not appear after
  signing in — the local row was numbered 199, not 9000xx.
- Fix Android invisible tap-blocker at the top-right of each chat: the
  transparent edge-swipe strips (slot switching) consumed every touch in the
  right/left 36dp on the full height of the WebView (their
  `GestureDetector.onDown` returns true), swallowing taps on the LLM page's own
  top-right controls (temporary-chat / incognito, account). The strips now start
  88dp below the top so that control row is tappable; edge-swipe still works
  below it.
- Fix note-less sessions vanishing from the list (iOS + Android): when any
  note-backed session existed, `loadSessionsFromDatabase` returned only the
  note-backed rows and dropped note-less ones (`note_id = null`, e.g. sessions
  migrated on login). Note-less snapshots whose session_id isn't already
  represented are now appended, mirroring the desktop `dream-load-sessions` fix.
- iOS: show a "Saved locally (S…)" status after a signed-out send (parity with
  Android's toast), so local-only saves are visibly confirmed.
- Fix new question resurrecting a pre-login session (iOS + Android): after
  sign-in / migration, the slot-fingerprint "restore stored question context"
  could attach a brand-new question to an old session that merely shared the
  same slot layout (it appeared under e.g. session 86 with existing history). A
  one-shot `suppressSlotRestore` flag is now set on sign-in (active context
  cleared too) and lifted on explicit session load or when a fresh ingest
  assigns a session, so the first post-login question opens a fresh session. The
  session-accumulation model itself is unchanged.


## 2.5.2

- Multi-user (iOS + Android): add Supabase Auth sign-in on both clients. New
  **Account** entry in Settings (iOS: a card with email/password sign in, status,
  sign out; Android: an Account menu item / dialog). When signed in, every
  Supabase RPC/REST call sends the user's access token as `Authorization: Bearer`
  (the `apikey` stays the publishable key), so the backend `owner_id` triggers
  attribute ingested notes/sessions to the account. Signed out, behaviour is
  unchanged (legacy anon). `MergeApiClient` is unaffected — it still talks to the
  LLM providers with the user's own model key.
- New `AuthStore` per platform (iOS `AuthStore.swift` Keychain-backed; Android
  `AuthStore.kt` EncryptedSharedPreferences-backed): password sign-in, token
  refresh near expiry, secure persistence, best-effort sign-out revoke. Mirrors
  the desktop `auth-store.js` and the new shared contract
  `shared/contracts/AUTH_AND_SESSION_SYNC.md`.
- iOS local-only gate: when signed out the client now makes **zero** Supabase
  calls (no anonymous ingest/session-bridge/reads/debug-log) — the
  publishable-key fallback is removed, so a not-logged-in device no longer leaks
  rows with `owner_id = null`. New `VerityMobileTests/AnonGateTests` proves the
  invariant (signed out ⇒ `accessToken()` nil, ingest throws and sends nothing).
- iOS first-run onboarding (`OnboardingView`): on first launch (no prior choice,
  not signed in) the app asks **Sign In** vs **Use Locally**; the choice is
  stored in `AppMode`.
- iOS local sessions: in local-only mode, sending a prompt now auto-saves the
  current slot layout (config/URLs/enabled + name + a local session number) to
  the on-device store so it can be reopened — previously a session was only
  created as a side effect of a backend ingest, so signed-out users got nothing.
- Android: same multi-user behaviour as iOS — `AuthStore.accessToken()` gate so
  signed-out makes **zero** Supabase calls (ingest/session-bridge/reads/debug-log
  all skipped, no publishable-key fallback); first-run **Sign In / Use Locally**
  dialog (`SettingsManager` app mode); and local-only auto-save of the slot
  layout on send (`SessionManager.nextLocalSessionNumber`). New JVM unit test
  `AuthGateTest` covers the gate rule (`AuthStore.gateBearer`).


## 2.5.1

- repoint Supabase to the new Frankfurt project (eu-central-1) on both iOS and
  Android, switching from the embedded service_role JWT to the publishable (anon)
  key. Ingest/session RPCs are SECURITY DEFINER granted to anon, so the shipped
  binaries no longer carry a secret key. Requires a rebuild/redeploy of both apps.


## 2.5.0

- ship the iOS WebView typing tray behavior: focusing a slot WebView collapses the native bottom controls to a minimal invisible swipe-up restore zone, preserving WebView keyboard focus while maximizing visible page area


## 2.4.9

- shrink the collapsed iOS bottom tray to an invisible 12pt swipe-up zone, removing the visible chevron handle so WebView typing keeps almost the whole screen


## 2.4.8

- collapse the full iOS bottom tray while typing inside a slot WebView and leave a compact chevron handle that can be tapped or swiped upward to restore the tray


## 2.4.7

- hide only the native iOS send-to-all composer while the user is typing inside a slot WebView, keeping the WebView keyboard/focus active and restoring the composer after the keyboard closes


## 2.4.6

- dismiss the native iOS composer keyboard when the user taps back into a slot WebView, so the iPhone page area is restored without blocking the web tap


## 2.4.5

- prevent Android and iOS from reusing a stale saved ingest session when the current slot conversations no longer match the saved session snapshot; same-slot follow-up questions still keep the logical session but clear the exact active root before ingest


## 2.4.4

- replace iOS and Android launcher icons with finalized platform exports for both light and dark system appearances


## 2.4.3

- refresh iOS and Android launcher icons with the new Quaestio Q artwork, including dark appearance variants for system theme-aware launchers


Active changelog. Older entries (2.3.6 and below) live in
[CHANGELOG_ARCHIVE.md](./CHANGELOG_ARCHIVE.md). When this file grows past ~50
lines, move the oldest minor block down to the archive in the same shape.

## 2.4.2

- fix iOS reply-freshness gate so chatgpt/gemini on iPhone no longer accepts a stale assistant block from a previous question in the same chat: the WebKit prompt-mismatch bypass now only applies when no prompt candidate could be extracted at all, not when a candidate was found but does not match the current prompt (observed in S180: first Collect Now grabbed the prior answer because the new one was still generating)
- reuse the same scrape result that fed the LLM merge call when bootstrapping the aggregated root inside `persistMergeMarkdown`, so iOS Run Merge does not perform a second redundant scrape on potentially-different slot DOM state

## 2.4.1

- wire iOS Run Merge / Run Clarification to actually persist results to the dream-tracker DB via `ingest_merge_v1` / `ingest_clarification_v1` (previously the LLM call ran but nothing was sent to Supabase); auto-bootstraps an aggregated root via Collect Now if none exists yet for the current question
- widen Android merge-ingest bootstrap guard so it also fires when the loaded aggregated root belongs to a previous question in the same session (fixes merge attaching to a stale MAC-origin root after a fresh prompt)
- broaden `normalizeCollectedPromptCandidate` on both iOS and Android to also strip "<Provider> responded/replied/answered" wrappers and leading timestamp / regen-counter metadata, not just "said", so the DOM wrapper cannot bleed into an aggregated note title
- add `tools/ingest-parity-check.sh` (wired into `rituals/check-mobile.sh`) that fails when iOS/Android drift on required RPC callsites, bootstrap-before-merge guards, or scrape sanitization

## 2.4.0

- inherit project LLM slot URLs through the clicked Projects tree path on Android and iOS, so shared subprojects can use different root-project links depending on the selected branch


Parent / entry point:
- Start from [../VERITY_MAP.md](../VERITY_MAP.md)
- Repo state and current contracts live in [CURRENT_STATE.md](./CURRENT_STATE.md)
- Repo-specific versioning contract lives in [VERSIONING.md](./VERSIONING.md)

Versioning contract:
- canonical doc: [VERSIONING.md](./VERSIONING.md)
- bump script: [scripts/bump-version.sh](./scripts/bump-version.sh)
- validation script: [scripts/check-versioning.sh](./scripts/check-versioning.sh)

All notable changes to this repo are documented here.

Versioning policy:
- mobile follows the shared Verity client `2.x.y` family
- every code change in this repo increments `y`
- every commit/push milestone in this repo increments `x`
- after incrementing `x`, `y` resets to `0`
