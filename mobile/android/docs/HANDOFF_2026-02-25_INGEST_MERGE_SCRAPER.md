# Handoff (2026-02-25): Dream Tracker ingest + merge/clarification + scraper cleanup

## Scope completed

### 1) Dream Tracker RPC v2 flow implemented
- `ingest_aggregated_v1`
- `ingest_merge_v1`
- `ingest_clarification_v1`

Implemented explicit send methods in Android code:
- `sendAggregated(...)`
- `sendMerge(...)`
- `sendClarification(...)`

Files:
- `app/src/main/java/com/chataggregator/app/AggregatedIngestClient.kt`
- `app/src/main/java/com/chataggregator/app/MainActivity.kt`
- `app/src/main/java/com/chataggregator/app/MergeFragment.kt`

### 2) Unified Supabase debug trace logging added
DB RPCs used:
- `log_ingest_debug_v1(p_event jsonb)`
- `get_ingest_debug_trace_v1(p_trace_id text)`

Logged steps:
- before aggregated: `step='aggregated'`
- after aggregated: `step='result'`
- before merge: `step='merge'`
- after merge: `step='result'`
- before clarification: `step='clarification'`
- after clarification: `step='result'`
- on exception: `step='error'`

Local debug artifact:
- `filesDir/debug-runs/{trace_id}.json`

Current idempotency format:
- `android:{kind}:{session_id_or_tmp}:{sequence}:{trace_id}`

### 3) Session indicator behavior
- Indicator added near chips.
- Fixed: session state is reset on cold app start (new app run starts new ingest session).

### 4) Streaming in API + UI
- API streaming enabled for OpenAI-compatible providers (`stream=true`).
- SSE parsing implemented with fallback for non-standard responses.
- UI now renders partial chunks during stream in Merge panel.

Files:
- `app/src/main/java/com/chataggregator/app/MergeApiClient.kt`
- `app/src/main/java/com/chataggregator/app/MergeFragment.kt`

### 5) Scraper and sanitize improvements
- Unified sanitize is applied in one place: `collectLatestRepliesFromEnabledSlots(...)`.
- Same cleaned text now feeds both:
  - merge input
  - ingest payload (`responses[].markdown`)
- Added stricter DOM candidate selection (especially for Perplexity) and stronger noise filtering.

Files:
- `app/src/main/java/com/chataggregator/app/ChatFragment.kt`
- `app/src/main/java/com/chataggregator/app/MainActivity.kt`

---

## Important findings from DB trace

Trace checked:
- `498f4e45-2372-4d94-bb3f-df2b8b024705`

Observed in old run payload (before latest scraper hardening):
- `gemini.markdown` contained `You said ... Gemini said ...`
- `perplexity.markdown` contained `Thinking`, `Searching`, `Reviewing sources`, domains, `+2 more`

Saved trace dump:
- `ci-output/latest/trace-498f4e45.json`

---

## Device screenshots captured

- `ci-output/phone-screen-before-fix.png`
- `ci-output/phone-screen-now.png`
- `ci-output/phone-screen-perplexity-now.png`

---

## Latest relevant commits (chronological)

- `922fd7a` `!!!!!!! feat: add unified supabase ingest debug trace logging`
- `c880cd7` `!!!!!!! fix: sanitize scraped replies before merge and ingest`
- `1d4a031` `!!!!!!! fix: tighten reply scraping and perplexity noise filtering`

---

## Latest CI run

- `22377719631` (for `1d4a031`) status: success

---

## App install status (device)

Verified on device:
- `versionCode=156`
- `versionName=1.0.156`

---

## Known residual risk / next verification checklist

1. Run a fresh Perplexity-included merge cycle on device.
2. Fetch newest `trace_id` from logs.
3. Query `get_ingest_debug_trace_v1(trace_id)` and confirm `responses[].markdown` no longer contains:
   - `source`
   - `You said ... said`
   - `Thinking/Searching/Reviewing sources`
   - domain dump / `+N more`
4. Confirm merge output is not truncated and includes full answer body.

---

## Security note

`SUPABASE_SERVICE_ROLE_KEY` is currently embedded in app build config.
Recommendation: rotate key and move RPC calls to trusted backend/proxy for production.
