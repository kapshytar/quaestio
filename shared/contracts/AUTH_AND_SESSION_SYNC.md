# Auth & Session Sync — cross-client contract

Parent / entry point:
- Start from [../../../VERITY_MAP.md](../../../VERITY_MAP.md)
- Cross-repo rollout plan: [../../../docs/domains/MULTI_USER_ROLLOUT.md](../../../docs/domains/MULTI_USER_ROLLOUT.md)
- Sibling clients: desktop `chat-aggregator/auth-store.js`, web `dream-tracker`.

This file is the canonical contract for **how every native client authenticates
to Supabase and what it is allowed to store locally**. iOS and Android MUST
implement the same semantics — drift here means one platform silently writes
rows under the wrong owner (or none). See
[feedback_unify_cross_client_logic](../../../.claude/projects/-Users-v-Verity/memory/feedback_unify_cross_client_logic.md).

## Backend

- Project: Frankfurt `pphntxcslmbymvcwvhnr` (`https://pphntxcslmbymvcwvhnr.supabase.co`).
  Never point a client at the deleted Sydney project `bjqkvlsneujrcfpvcvzf`.
- Identity backbone: Supabase Auth (`auth.users`, UUID PK). Every ownable table
  carries `owner_id uuid` FK→`auth.users(id)`; backend triggers stamp
  `owner_id = auth.uid()` on insert. `profiles.id` (uuid) = the auth user;
  `profiles.human_id` is a UI-only bigint.

## The single rule: signed out ⇒ zero Supabase

The gate is now strict (no anonymous fallback). A request reaches Supabase
**only** when the user is signed in:

| state      | `apikey`               | `Authorization`              | backend calls |
|------------|------------------------|------------------------------|---------------|
| signed in  | publishable (anon) key | `Bearer <user access token>` | yes           |
| signed out | —                      | —                            | **none**      |

The publishable key never leaves; the JWT only changes who `auth.uid()` resolves
to so the `owner_id` triggers attribute rows to the signed-in user. **Signed out,
the client makes no Supabase REST/RPC call at all** — no ingest, no session
bridge, no REST read, no debug-log upload. There is no publishable-key fallback
(removing it is what stopped signed-out clients writing `owner_id = null` rows).

Each platform resolves the token through one gate helper that returns null when
signed out; callers that get null skip the backend (read → empty, write → throw
a `NotSignedIn` error / local-only path):

- iOS: `AuthStore.accessToken()` → `String?`. Tests: `AnonGateTests`.
- Android: `AuthStore.gateBearer(AuthStore.accessToken(ctx))` → `String?`. Tests: `AuthGateTest`.
- Desktop: `auth-gate.js` `bearerOrNull(authStore.getValidAccessToken())`. Tests: `test/auth-gate.test.js`.

Route **all** Supabase Authorization headers through that gate:

- iOS: `AggregatedIngestClient`, `MobileAppState` (project tree + REST read/write),
  `SessionManager` (session bridge + note refresh).
- Android: `AggregatedIngestClient`, `MainActivity` (REST read/write),
  `SessionManager` (session bridge).

**Excluded: `MergeApiClient`.** Merge calls hit the LLM providers
(OpenAI-compatible / Claude / Gemini) directly with the *user's own* model API
key — never Supabase. Do not swap its bearer.

## Auth endpoints (Supabase GoTrue REST)

- Sign in: `POST {url}/auth/v1/token?grant_type=password`
  headers `apikey`, `Content-Type: application/json`; body `{ "email", "password" }`.
- Refresh: `POST {url}/auth/v1/token?grant_type=refresh_token`
  body `{ "refresh_token" }`.
- Sign out (best-effort revoke): `POST {url}/auth/v1/logout`
  headers `apikey`, `Authorization: Bearer <access_token>`.

Response carries `access_token`, `refresh_token`, `expires_at` (epoch sec) and/or
`expires_in`, and `user.{id,email}`. Refresh when
`expires_at - now <= 60s` (REFRESH_SKEW). Mirrors desktop `auth-store.js`.

### Refresh failure: clear only on a real rejection, never on a blip

`refresh()` must distinguish the two failure classes, or it silently destroys
valid sessions:

- **Definitive auth rejection** — GoTrue returns **400** (`invalid_grant`) or
  **401**: the refresh token is revoked/expired and nothing local recovers it.
  Clear the session (→ signed-out) **and** raise the one-shot **session-expired
  flag** below.
- **Transient failure** — 5xx, an unexpected/unparseable response, or a network
  exception: **keep** the session so a later call retries. Do **not** clear a
  valid session over a server blip or offline moment.

Always log the failure `code` + a truncated body so the cause is diagnosable.

> Why this matters (observed 2026-06-02): an Android client whose ~1h access
> token had expired hit a refresh that returned non-2xx; the old code cleared on
> *any* non-2xx, so the gate returned null and the Sessions list silently fell
> back to **328 stale local rows** while the Account UI still said "signed in".
> The cloud sessions looked gone. Re-sign-in fixed it (RPC → 200, count=333).

### Session-expired signal (don't lie about being signed in)

When a refresh is definitively rejected, the client sets a **one-shot
session-expired flag**; the next UI checkpoint (Sessions load) **consumes** it
and surfaces "session expired — sign in again" instead of quietly showing stale
local sessions as if still in account mode. A fresh sign-in/refresh and an
*explicit* sign-out both clear the flag (a deliberate sign-out is not an expiry).
Keys/APIs: Android `AuthStore.consumeSessionExpired(ctx)` (pref
`session_expired`), iOS `AuthStore.consumeSessionExpired()` (UserDefaults
`verity.auth.sessionExpired`), desktop `auth-store.consumeSessionExpired()`
(in-memory, re-derived on the next failed refresh) exposed via IPC
`auth-consume-session-expired`.

## Secure token storage

Persist `{ access_token, refresh_token, expires_at, email, user_id }` so the
session survives restarts, in the platform secure store:

- iOS: Keychain (`kSecClassGenericPassword`), service `verity.auth.session`.
- Android: `EncryptedSharedPreferences` (file `verity_auth_session`).
- Desktop (reference): Electron `safeStorage` → `verity-auth-session.bin`.

Never log tokens. Never write them to plain `UserDefaults` / `SharedPreferences`.

## Client modes

| client            | modes                          |
|-------------------|--------------------------------|
| web (dream-tracker) | login only                   |
| desktop / iOS / Android | login **or** local-only toggle |

### Local-only mode = sessions only

When the user chooses local-only (not signed in), the client stores **only
sessions** locally and makes **no** backend writes:

- A session = slot config, slot URLs, slot enabled flags, session name, session
  number — exactly the `aggregator_sessions_bridge_v1` `save` payload shape, kept
  on-device so the user can reopen a slot layout.
- No notes, no ingest, no merge persistence, no debug-log upload offline.

## Local session numbering

A session created while signed out has no backend `session_id`. Each client
allocates a **local** number from a shared base so the three clients never
collide and a local row is recognisable on sight:

- Base `900000`; a monotonic per-device counter increments from there
  (`900001, 900002, …`). iOS `SessionManager.nextLocalSessionNumber()`, Android
  `SessionManager.nextLocalSessionNumber()`, desktop `getNextLocalSessionId()`.
- **`session_id >= 900000` is the canonical "local-only, not yet uploaded" flag.**

## Late-login migration (offer to upload local sessions)

When the user signs in (transition signed-out → signed-in), the client offers to
push **local sessions only** (never fabricated notes) up to the account:

1. Collect local sessions = stored snapshots with `session_id >= 900000`.
2. If any, prompt once: "Upload N local sessions to your account?" (Yes / Not now).
3. On Yes, for each, call `aggregator_sessions_bridge_v1` **`migrate`** with the
   JWT, passing `name`, `slot_config`, `slot_urls`, `slot_enabled`. The backend
   **ignores the local number and allocates a fresh real `session_id`** from
   `next_note_session_id()` (the ingest allocator) — so local rows never collide
   across devices (every device's local counter starts at 900001). The
   `set_owner_from_note` trigger stamps `owner_id = auth.uid()`; the `migrate`
   action raises if `auth.uid()` is null (anon cannot use it). Do **not** use the
   `save` action for migration — it would persist the colliding 900000+ number.
4. On success, remove the local-only copy so the next list refresh shows the
   now-owned row from the DB (no duplicate). On failure, keep the local copy and
   surface a non-fatal notice; the offer can recur next sign-in.

"Not now" leaves the local sessions untouched; they remain usable locally and the
offer recurs on the next sign-in while any `>= 900000` session still exists.

### Fresh context after sign-in (suppressSlotRestore)

The session model is "session_id = slot-layout workspace; new questions become new
notes within it", and clients restore an active session by slot fingerprint. That
restore must NOT silently attach a brand-new question to a *pre-login* session
that merely shares the slot layout. So on sign-in (and migration) each client:

1. clears the active question context, and
2. sets a one-shot `suppressSlotRestore` flag that makes the slot-fingerprint
   restore return nothing.

The flag is lifted when the user **explicitly loads a session** or when a **fresh
ingest assigns a session_id** — after which normal continuation resumes. Keys:
Android `SettingsManager` `suppress_slot_restore`, iOS `SessionManager.suppressSlotRestore`,
desktop `localStorage` `verity-suppress-slot-restore`.

> Status: strict gate (signed out ⇒ zero Supabase) + JWT-on-ingest + local-only
> sessions ship on all three native clients. Late-login migration implemented in
> lockstep across desktop/iOS/Android per this section.
