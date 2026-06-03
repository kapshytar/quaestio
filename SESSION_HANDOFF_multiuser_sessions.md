# Session handoff — multi-user + session-sync fixes (2026-06-02)

Scratch/handoff for the in-flight multi-user (owner_id + Supabase Auth) work across
desktop + iOS + Android. Written before a `/compact`. Delete when fully landed.

## Backend (NEVER get this wrong)
- Frankfurt project ONLY: `pphntxcslmbymvcwvhnr` (https://pphntxcslmbymvcwvhnr.supabase.co).
  Sydney `bjqkvlsneujrcfpvcvzf` is DELETED — never touch it.
- Clients use the publishable/anon key as `apikey`; signed-in adds `Authorization: Bearer <user JWT>`.
  service_role is server-only.
- Strict gate invariant: **signed out ⇒ ZERO Supabase calls** (no anon fallback).
- Test user owner_id: `510c88a5-8d3d-41f8-9e15-acbb2e7a8de2`.

## Current versions (all deployed to both devices)
- Mobile: **2.5.9 (278)** — Android `R58M550RNCH`, iPhone `iPhone Chepuha` (D0768EB4-…).
  Bump via `./scripts/bump-version.sh patch` + `./scripts/check-versioning.sh`
  (syncs project.yml MARKETING_VERSION + android/version.properties).
- Desktop: **1.112.4** (package.json + manual CHANGELOG). User runs desktop directly; not "deployed".
- Deploy scripts: `./scripts/deploy-android-device.sh`, `./scripts/deploy-ios-device.sh`.
  Android compile: `./scripts/android-gradlew.sh :app:compileDebugKotlin`.
  iOS standalone build must `cd ios && xcodegen generate` first (deploy script does this).
- I do NOT commit/push — that's the user's ritual (per-chat `chat/<name>` branches, hook-blocks push from main).

## What shipped THIS session (2.5.4 → 2.5.9, desktop 1.112.4)

1. **Token-expiry / refresh robustness (all 3 clients, mobile 2.5.4 / desktop 1.112.4).**
   - Root cause of "Android signed-in but Sessions list empty": access token (~1h) expired,
     `refresh()` cleared the session on ANY non-2xx → gate returned null → silent local-only
     degrade showing stale local rows while UI said "signed in". (Proven via logcat:
     `loadSessionsFromDatabase failed: Not signed in`; re-sign-in → RPC 200, count=333.)
   - Fix: `refresh()` clears session ONLY on 400/401 (invalid_grant); keeps it on 5xx/network
     (retries later); logs failure code+body.
   - Session-expired one-shot flag → UI prompts "session expired — sign in again" instead of
     stale local list. Cleared on fresh sign-in and explicit sign-out.
     - Android: `AuthStore.consumeSessionExpired(ctx)` (pref `session_expired`), `promptSessionExpired()` in MainActivity.
     - iOS: `AuthStore.consumeSessionExpired()` (UserDefaults `verity.auth.sessionExpired`), `@Published sessionExpiredPrompt` → alert in RootTabView.
     - Desktop: `auth-store.consumeSessionExpired()`, IPC `auth-consume-session-expired`, consumed in `loadSessionsList` (renderer `maybePromptSessionExpired`).

2. **iOS local sessions not listed (2.5.5).** `SessionSnapshot` Codable decode was all-or-nothing:
   one legacy/partial stored row (missing a non-optional field like `slot_live_urls`) threw and
   emptied the WHOLE array → `getAllSessions()` returned []. Fix: tolerant `init(from:)` in an
   extension (decodeIfPresent + defaults). Added diagnostic row "Sessions: stored X / shown Y"
   in Settings → Shell diagnostics STATUS (`appState.diagnosticSessionCounts`).

3. **Fingerprint restore resurrecting old sessions (2.5.6, iOS+Android).** A new question on a
   ChatGPT Temporary Chat / home page (no real conversation id) matched stale session 158:
   `extractConversationKey` degrades to generic origin / "temporary" → collides; blank-prompt
   escape let it match on slots alone. Fix: `fingerprintHasRealConversation(...)` guard — restore
   only continues a session when current slots reference a real chat id. Converges to desktop
   (desktop keys context by exact real-conversation fingerprint string, so generic → fresh).

4. **Local sessions wiped on sign-in (2.5.7, iOS+Android).** `loadSessions` / `showSessionsDialog`
   did `replaceSessions(remoteSessions)` (cloud-only) → deleted un-migrated local-only sessions
   (`session_id >= 900000`). Fix: preserve local-only sessions the cloud doesn't represent.

5. **iOS indicator blank for local sessions (2.5.7).** `makeSessionIndicator` required a non-empty
   `activeNoteId`; local sessions are note-less. Now shows `S<id>` whenever a session id exists
   (matches desktop/Android indicators).

6. **Android delete didn't reach backend / web (2.5.8).** Long-press delete sent only
   `p_record_id` = snapshot UUID; with no `p_note_id` the bridge falls back to
   `delete_aggregator_session(p_record_id::integer)` → UUID→int cast THROWS → swallowed by
   fire-and-forget thread → nothing deleted server-side → still shows in web (web renders NOTES).
   Fix: `deleteSessionFromDatabase(recordId, sessionId, noteId, ...)` now passes integer
   `p_session_id` + `p_note_id` like desktop → bridge deletes the note subtree + aggregator_sessions rows.

7. **Offline bumped local session number every question (2.5.9, iOS+Android).** Offline has no
   note, so the question-context reset (clears parallel-ingest session id) fired on every send,
   wiping the local id → `saveLocalSession` allocated fresh `S9000xx`. Fix: gate that reset on
   signed-in; offline keeps the local id stable. **User chose "one session per layout (match
   desktop)".** New local session started via load-session / clear-active.

## Key invariants / gotchas
- Local session numbering: base 900000, per-device monotonic counter; `session_id >= 900000` =
  canonical "local-only, not yet uploaded" marker.
- Late-login migration: bridge `migrate` action allocates a fresh real session_id via
  `next_note_session_id()` (ignores 9000xx), stamps owner from JWT, raises if `auth.uid()` null.
- `aggregator_sessions_bridge_v1` `delete`: WITH `p_note_id` → recursive note-subtree delete
  (note_type 2/3 children + root) + aggregator_sessions rows; WITHOUT → `delete_aggregator_session(coalesce(p_session_id, p_record_id::int))`.
- Web (dream-tracker) renders the NOTES tree, not note-less aggregator_sessions slot snapshots —
  migrated/note-less sessions are invisible in web by design.
- suppressSlotRestore one-shot flag still exists (set on sign-in/migration; lifted on explicit
  load / fresh ingest) — keep it; the fingerprintHasRealConversation guard is the real fix.
- Contract doc: `shared/contracts/AUTH_AND_SESSION_SYNC.md` (updated with refresh-clear + expiry rules).

## OUTSTANDING — needs on-device confirmation
- iPhone: **Settings → Shell diagnostics → "Sessions: stored X / shown Y"** + signed in/out.
  This is THE datapoint to confirm the local-sessions-list fix. (stored0 ⇒ storage; storedN/shown0 ⇒ display; storedN/shownN ⇒ fixed.)
- Offline: several questions in same layout → `S9000xx` stays constant (no bump).
- Android: delete a session → gone from web too.
- Temporary Chat → send → new session, never 158.
- Login on expired session → "session expired" prompt, not silent stale list.

## PENDING (await explicit user go-ahead — do NOT start unprompted)
- Task #13 — **Backend cutover (step D)**: revoke anon EXECUTE on ingest/session/debug RPCs,
  close `anon_read_project_tree`, `owner_id NOT NULL`, RLS `owner_id = auth.uid()`. ONLY after all
  gate+expiry+session behavior confirmed on all devices.
- **Cleanup**: stale note-less rows `900001 "хуй"` / `900002 "чик"` in aggregator_sessions
  (leftovers from earlier save-based migration test, duplicated by 227/228). User said "логично"
  but never explicitly said "да, удаляй". Leave orphan session 224 "kuku".
- Task #21 — **iOS per-session delete** (parity gap): iOS session sheet only has "Clear Active
  Session", no per-row delete. Add swipe-to-delete calling a new SessionManager delete
  (bridge delete with p_session_id + p_note_id) + local snapshot removal.

## Cross-client unify reminder
Per `.claude/.../feedback_unify_cross_client_logic.md`: when a bug spans clients, fix all or
extract to shared. Desktop `renderer.js` / `auth-store.js` is the reference that "just works";
converge iOS (`MobileAppState.swift`, `SessionManager.swift`, `AuthStore.swift`) and Android
(`MainActivity.kt`, `SessionManager.kt`, `AuthStore.kt`) to it.
