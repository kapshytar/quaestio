# Changelog

## 2.8.6

- **Fix (iOS + Android): re-asking a question or re-opening an old session no longer spawns duplicate sessions**
  After an app relaunch the WebViews reload their chats from scratch and a slot is briefly on
  the service home page; the session match compared the whole fingerprint, failed against that
  transient home URL, and cleared the session — so the next Collect minted a new
  `note_session_id` instead of appending. The match now keys on the per-slot conversation id,
  ignores slots not yet on a real conversation, and only treats a slot that loaded a *different*
  real conversation as a context switch. Re-asking the same question, and continuing in a
  re-opened old session, now append to the existing session; a genuinely new chat still
  correctly starts a new session. Shared `conversationKeyTailIsReal` predicate so the matcher
  and the restore guard cannot drift.

## 2.8.5

- **Fix (cross-client parity): nested/indented bullets now render on iOS**
  (`ios/VerityMobile/MergeMarkdownView.swift`).
  The block parser trimmed each line before detecting bullets, discarding leading
  indentation — so every sub-bullet collapsed to the top level and the output
  looked flat, while the desktop/web canon showed indented sub-lists. Added
  `bulletIndentLevel(of:)` (leading whitespace → nesting level; tab = 4 columns,
  ~2 columns per level, capped at 3); `.bullet` now carries a `level`, renders
  with `level * 18pt` leading indent and a tiered marker (•/◦/▪) mirroring the
  canon. Bold/italic/code inside bullets continues to work (unchanged inline path).
  Not yet verified by an Xcode build/on-device run — needs a build + device pass.


## 2.8.4

Three corrections to the 2.8.2/2.8.3 fixes that addressed the right symptoms at
the wrong layer and therefore did not work on a real device.

- **Correction (BUG C): bold/italic/code Markdown now actually renders on iOS**
  (`ios/VerityMobile/MergeMarkdownView.swift`).
  The 2.8.2 fix added `inlineMarkdown(_:)` (using `AttributedString(markdown:)`)
  and changed block renders to `Text(inlineMarkdown(text))` — correct direction,
  wrong detail.  Every block also carried a `.font(.system(size:weight:))` view
  modifier.  On iOS, a view-level `.font()` modifier applied to a `Text` built
  from an `AttributedString` overrides every per-run `inlinePresentationIntent`
  the markdown parser set on the string: all runs receive the uniform modifier
  weight, so `**bold**` renders at `.medium` just like plain text.  Desktop's
  `<strong>` is a CSS property independent of the container font; Markwon on
  Android sets span-level typeface flags that survive the layout pass.  Fix:
  replaced `inlineMarkdown(_:)` with a version that accepts `baseSize`/
  `baseWeight` parameters and bakes a SwiftUI `Font` attribute directly into each
  `AttributedString` run (`.stronglyEmphasized` → `.bold`, `.emphasized` →
  `.italic()`, `.code` → `.monospaced`), then removed the competing `.font(weight:)`
  modifiers from all block and table-cell renders.  Heading size+weight are now
  baked via a new `inlineMarkdownHeading(_:level:)` helper so bold-inside-heading
  still works.  `headingFont(for:)` removed (no longer needed).  Table cells
  benefit from the same fix — they already called `inlineMarkdown()` and now
  also get per-run bold/italic/code.
  Not yet verified by an Xcode build/on-device run — needs a build + device
  pass before release.

- **Correction (BUG A): aggregation summary no longer stuck on "Collecting now..."**
  (`ios/VerityMobile/MobileAppState.swift`).
  The 2.8.2 fix added a `.collected` case to `MergeAggregationSlotStatus` and
  wired `makeCollectedSnapshots` to set it — the per-slot chips were correct.
  But `mergeAggregationSummary` (the line of text directly below the Collect
  button that the user actually reads) was set to
  `"All N slot(s) ready. Collecting now..."` at the all-ready early-exit point
  inside `collectLatestRepliesForMerge`, and then the function immediately
  returned without updating it.  The partial-result path at the bottom of the
  same function correctly wrote `"Collected N/M source reply(s)"`, but that path
  is only reached when polling times out; the common all-ready success path was
  never fixed.  Fix: changed the all-ready early-exit to write
  `"Collected N/N source reply(s)"` before returning, matching Android
  `AggregationStatusFormatter` which summarizes a post-collect state the same way.
  Not yet verified by an Xcode build/on-device run — needs a build + device
  pass before release.

- **Correction (BUG B): pasted merge API key now actually persists across restart**
  (`ios/VerityMobile/MergeView.swift`).
  The 2.8.2 fix added Keychain save/load correctly, but two ordering bugs meant
  the loaded key was never used in practice.  (1) `selectedProviderId` (a
  `@State` var) was never written to UserDefaults, so on cold launch
  `bootstrapDefaults` always resolved it from `catalog?.defaultProviderId` — if
  the user had previously selected a non-default provider, the Keychain load in
  `syncProviderDefaults` ran against the wrong provider id and returned "".
  (2) `usePreinstalledKey` defaults to `true`; `syncProviderDefaults` only reset
  it to `false` for providers where `!supportsPreinstalledKey`.  For providers
  that do support a preinstalled key (e.g. DeepSeek), `usePreinstalledKey` stayed
  `true` even after loading a non-empty custom key, which (a) kept the API key
  field hidden so `.onChange` never fired to re-save, and (b) caused
  `resolvedApiKey()` to return the preinstalled key instead of the Keychain-loaded
  custom key, silently discarding it.  Fix: `selectedProviderId` is now persisted
  to UserDefaults on every change and restored in `bootstrapDefaults` before the
  Keychain load runs; `syncProviderDefaults` now sets `usePreinstalledKey = false`
  whenever a non-empty custom key is found in the Keychain for the selected
  provider, regardless of provider type.  Mirrors Android where selecting a
  provider always loads the saved key into the field.  Provider id is stored in
  plain UserDefaults (non-secret); key stays in Keychain.
  Not yet verified by an Xcode build/on-device run — needs a build + device
  pass before release.


## 2.8.3

- **Fix (cross-client parity): GFM pipe-tables now render on iOS** (`ios/VerityMobile/MergeMarkdownView.swift`).
  The custom block parser recognised headings, bullets, fenced code, `---`, and
  inline bold/italic/code (added in 2.8.2) but had no table case; any pipe-table
  in merge output fell through to `.paragraph` and was shown as raw `| … |` text.
  Added GFM pipe-table parsing: a pipe row followed immediately by a
  separator row (`| --- | --- |`) is recognised as a table header; all
  subsequent pipe rows become body rows. Rendered as a SwiftUI `VStack`/`HStack`
  grid with a tinted header background (`AppTheme.panelStrong` at 45% opacity),
  a bold header/body divider, alternating-row shading for body rows, and a
  rounded-rectangle border — matching the visual style of the existing block
  elements. Cell content goes through the existing `inlineMarkdown()` helper so
  bold/italic/code inside cells is rendered. Android already renders tables via
  `Markwon` + `TablePlugin` (correctly wired); desktop renders tables via
  `marked.js` (GFM on by default). This change brings iOS to parity with both.
  Not yet verified by an Xcode build/on-device run (no macOS/Xcode in the
  authoring environment) — needs a build + device pass before release.


## 2.8.2

- **Fix (iOS parity): merge slot status stuck on "collecting", never "collected".**
  iOS `MergeAggregationSlotStatus` (`MobileAppState.swift`) only had
  `ready`/`waiting`/`error` and never mirrored Android's
  `AggregationSlotStatus.COLLECTED`, so after a successful collect the per-slot
  chips never flipped to a done state (Android already did via
  `AggregationState.kt`). Added the `collected` case (rawValue `"collected"`,
  matching Android's code), rebuilt the post-collect snapshots so slots that
  returned a reply become `.collected` and the rest `.error` (mirrors
  `MergeFragment`'s post-collect loop) at both the all-ready and partial return
  paths, and updated `formatAggregationSummary` to count `collected` as ready
  (mirrors `AggregationStatusFormatter.summarize`). UI label/color in
  `MergeView.swift` handle the new case.
- **Fix (iOS parity): pasted merge API key not persisted across app restart.**
  The merge key lived only in `MergeView`'s in-memory `@State`, with no store
  write, so every relaunch lost it; Android already persists per-provider in
  `EncryptedSharedPreferences`. iOS now persists the key in the Keychain — the
  same secure store and access pattern as `AuthStore` (session tokens), service
  `verity.merge.apikey`, per-provider account `merge.<providerId>.api_key`,
  `kSecAttrAccessibleAfterFirstUnlock`. Saved on edit, loaded on launch and on
  provider switch, and consumed by `resolvedApiKey` -> `MergeApiClient`. Not
  cleared on sign-out (matches Android, where merge keys live outside the auth
  session store).
- **Fix (iOS parity): merge output did not render inline Markdown (bold).**
  `MergeMarkdownView` parsed block syntax (headings, bullets, fences) but
  rendered each block as plain `Text(String)`, so `**bold**`/`*italic*`/inline
  code showed their literal markers; Android renders the same output through
  Markwon. iOS now converts inline spans via `AttributedString(markdown:)`
  (`.inlineOnlyPreservingWhitespace`, `.returnPartiallyParsedIfPossible`, with a
  plain-text fallback) for paragraph/heading/bullet text; code blocks stay
  verbatim. Note: Markwon tables on Android are still not at parity on iOS
  (tracked separately).
- Scope: all three are iOS-native catch-ups to existing Android behavior; no
  Android or shared code changed. Not yet verified by an Xcode build/on-device
  run (no macOS/Xcode in the authoring environment) — needs a build + device
  pass before release.


## 2.8.1

- **Fix (real): Claude prompt still not submitting on Android.** 2.8.0's
  `InputEvent('beforeinput')` + synthetic-paste fill carries `isTrusted=false`,
  which claude.ai's TipTap/ProseMirror editor ignores inside Android System
  WebView — the model stayed empty, Send never rendered, and submit then clicked
  the wrong button (the account/Settings button: `findSendButton`'s generic
  scoring gave any icon button `+20` for `path d=`, so it won). Verified on-device
  via CDP. Fixes in `shared/js/sendMessage.js`: (1) non-Gemini contenteditable
  now fills via `document.execCommand('insertText')` — the only path that routes
  through the editor's real `beforeinput` and updates the model (multiline → `<p>`
  paragraph breaks); paste/textContent kept as fallbacks. (2) `findSendButton`
  drops the over-broad `path d=` heuristic and hard-negatives composer-adjacent
  controls (settings/account/voice/attach/model/…) so Send can't be mistaken.
  (3) submit polls for the enabled Send button instead of a single fixed-delay
  click. Applies to iOS too (shared injector).
- Debug builds enable `WebView.setWebContentsDebuggingEnabled(true)` for
  `chrome://inspect` on-device DOM debugging (no-op in release).


## 2.8.0

- **Fix: prompt not sent to Claude on mobile** (Android + iOS). The injector
  filled claude.ai's ProseMirror composer via `execCommand('insertText')` +
  generic events, which does not reliably update the editor's React/ProseMirror
  model inside a WebView — so the Send button stayed `aria-disabled` and a
  synthetic Enter was a no-op (text appeared but never submitted; desktop was
  unaffected). `shared/js/sendMessage.js` now mirrors the working desktop path:
  contenteditable fill uses a real `InputEvent('beforeinput', {inputType:
  'insertText', data})` (multiline via synthetic paste so line breaks survive),
  `findSendButton` rejects `aria-disabled="true"`, and submit is mutually
  exclusive (click XOR `requestSubmit` XOR Enter).
- **Consolidation: Android off its divergent injector.** Deleted
  `MessageInjector.kt` (a Kotlin copy of the send/attach JS) and routed Android
  through the same shared `shared/js/sendMessage.js` + `shared/js/attachFile.js`
  that iOS already uses (loaded from assets via the `prepareSharedStreamingJs`
  gradle task, invoked from `ChatFragment`), so both clients share one
  implementation. Docs updated to match.
- **Android tabs: selected tab text purple → pastel pink** (`tab_selected_text`
  #F9A8D4 day / #F472B6 night), on the Merge tab and the LLM tabs; removed the
  old `action_secondary` purple.


## 2.7.3

- Fix: restoring a saved session now also restores its project. The bridge
  `list` rows carry a derived `project_tag_id` (a tag on the session's note;
  dream-tracker migration `20260612150000_bridge_list_project_tag`), and both
  clients activate it on load — project identity/state only, so the session's
  just-restored slot URLs are not clobbered by the project's own URL set.
  iOS additionally stamps `projectTagId` into snapshots on save. Old backend /
  rows without the field → behavior unchanged.

## 2.7.2

Codex (gpt-5.5) adversarial review of the open-source prep — fixes:

- **Android Merge fix**: `isPreinstalledKeySelected()` now returns false when
  the selected provider has no catalog `supportsPreinstalledKey` — previously
  the stored preference defaulted to true, so after the embedded DeepSeek key
  was removed, DeepSeek merges silently sent an empty key even when the user
  had typed their own (runMerge / handleMergeResponses / saveCurrentFields all
  routed through the stale check).
- **Approval check at sign-in (iOS + Android)**: after a successful sign-in
  the client reads `profiles.approved`; if false it shows "access request
  pending" guidance (veritydb.vercel.app), keeps the session, and skips the
  local-session migration offer instead of letting RPCs fail later with a raw
  `account_pending_approval` error — which is now also mapped to friendly text
  at the visible error sites on both platforms.
- **Public naming**: apps are publicly **Quaestio** (README, NOTICE, both
  onboarding screens); Verity stays the project/backend name. Internal
  identifiers (bundle ids, VerityMobile scheme, prefs keys) unchanged.
- **Licensing hygiene**: NOTICE/README rephrased (AGPL permits commercial use;
  the paid option is a separate proprietary license), SPDX expression
  `AGPL-3.0-only OR LicenseRef-Commercial`, new CONTRIBUTING.md with an
  inbound license grant (DCO + Apache-2.0 to the owner) so dual licensing
  survives external PRs.
- **Stale security comments** in both KeyObfuscation files corrected
  (publishable key, SECURITY INVOKER + RLS — no anon grants, no service_role).

## 2.7.1

- License switched from Apache-2.0 to dual licensing: AGPL-3.0 (LICENSE) +
  commercial license by contact (NOTICE, README). Commercial/closed-source use
  without publishing modified source now requires a separate license.
- Git history scrubbed of the revoked embedded DeepSeek key
  (raw + base64 forms) via git-filter-repo before opening the repo.

## 2.7.0

- Open-sourcing prep: removed the embedded DeepSeek test key from both clients
  (iOS `KeyObfuscation.swift`, Android `KeyObfuscation.kt`) and disabled the
  "Use Preinstalled Key" option via `shared/contracts/mergeConfig.json`
  (`deepseek_api.supportsPreinstalledKey=false`). Users now supply their own
  key. The old key was present in git history and must be revoked on the
  DeepSeek platform before the repo goes public.
- Added `LICENSE` (Apache-2.0) and `NOTICE` (attribution required on forks per
  §4(d)); README license section.
- Onboarding (iOS modal + Android first-run dialog) now explains that accounts
  are invite-only: request access at veritydb.vercel.app; until approval the
  app works fully in local mode.
- Backend (dream-tracker migration `20260612090000_bridge_rpc_owner_scope`):
  `aggregator_sessions_bridge_v1` and `delete_aggregator_session` switch from
  SECURITY DEFINER to SECURITY INVOKER so strict owner_id+approved RLS scopes
  every read/write (previously list/save/delete crossed user boundaries), plus
  an explicit `account_pending_approval` error for unapproved users.

## 2.6.0

- Push milestone for the 2.5.10 iOS work: deterministic bottom tray around the
  keyboard (tap-heuristic and timer races removed) and glass-island chrome
  (Liquid Glass on iOS 26+ with material / Reduce Transparency fallbacks).
  Device-tested on iPhone 15 Pro Max.


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
