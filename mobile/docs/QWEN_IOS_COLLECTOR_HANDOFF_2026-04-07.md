# Qwen Handoff: iOS collector parity vs desktop

Repository: `/Users/v/Verity/chat-aggregator-mobile`
Reference desktop repo: `/Users/v/Verity/chat-aggregator`
Date: 2026-04-07

## User goal
Make iOS collect/ingest replies the same way desktop does for already-working sessions, especially session `130`.
Desktop session 130 is known-good. iOS is not.

## Hard constraints
- Do **not** break Android.
- Do **not** keep changing session URL persistence / restore logic unless strictly necessary.
- Focus on **collector parity**, not more speculative session heuristics.
- Success criterion is **backend payload**, not green UI.
- Verify via `ingest_debug_logs.payload.responses[].markdown` for platform `IOS`.

## What went wrong so far
The previous agent spent too long fixing the wrong layers:
- prompt matching
- session restore
- sanitize heuristics
- note/session identity

Some of those changes helped symptoms, but the root issue remains:
- desktop can collect session 130 correctly
- iOS on the same type of session ingests prompt/fragment garbage for some providers

The agent also introduced a regression by changing iOS session URL restore semantics:
- preferring `slotURLs` over `slotLiveURLs` for note-backed sessions
- zeroing `slotLiveURLs` in note-backed restore
Those changes were just rolled back because the user reported Gemini/Grok links getting messed up on session save/load.

## Current root diagnosis
This is now considered an **iOS collector parity** problem.
Not a generic session problem.
Not a merge-status problem.
Not a backend problem.

Desktop collector is stronger than iOS collector.
Desktop uses provider-specific orchestration:
- `copy-first` or `dom-first` depending on provider
- then sanitize
- then quality gate
- then ingest

iOS originally had a weaker path.
Latest work started porting desktop-style extraction to iOS, but parity is not yet confirmed.

## Important backend evidence already proven
For iOS `ingest_aggregated_v1` payloads:
- session 132:
  - `chatgpt` correct
  - `claude/gemini/grok` mostly sent prompt or prompt-prefixed garbage
- session 133:
  - at one point `claude` became correct after moving it to copy-first
  - `gemini` still prompt-ish
  - `grok` became fragment-only/table-ish instead of full reply

That means:
- Claude improved when copy extraction was preferred
- ChatGPT regressed when moved to copy-first and later recovered on DOM-first/copy mix
- Gemini and Grok remain the main parity failures

## Current code state you inherit
### Files already changed
- `ios/VerityMobile/SlotWebViewModel.swift`
- `ios/VerityMobile/MobileAppState.swift`
- `ios/VerityMobile/SessionManager.swift`
- `ios/VerityMobile/SharedScriptBridge.swift`
- `shared/js/scrapeReply.js`
- `shared/js/extractLatestAssistantRaw.js`
- `shared/contracts/QUESTION_IDENTITY_RULES.md`
- meta docs in `/Users/v/Verity/docs/domains/SESSION_AND_INGEST_RULES.md`

### Important extractor work already in place
1. `shared/js/extractLatestAssistantRaw.js`
   - desktop-style raw candidate extractor ported from desktop `getLatestAssistantReply()`
   - returns JSON with `raw` and `diagnostics`
   - includes candidate ranking and `fragment_only`

2. `ios/VerityMobile/SharedScriptBridge.swift`
   - already wired to load `VeritySharedExtractLatestAssistantRaw`

3. `ios/VerityMobile/SlotWebViewModel.swift`
   - now has iOS-only collector wrapper around the shared sanitizer
   - supports:
     - copy capture
     - desktop-style DOM raw extraction
     - passing raw text back through `scrapeReply.js` via `rawReplyOverride`

### Latest collector orchestration in SlotWebViewModel.swift
Current intent:
- `Gemini` and `Grok` use desktop-style DOM extraction plus copy fallback
- a new `pickPreferredReply(...)` prefers copy if DOM is `fragmentOnly` or clearly much shorter
- copy capture now waits in a desktop-like retry loop instead of one fixed sleep
- `ChatGPT/Claude` still follow the non-Android-risky path already in file

### Current mobile shared scraper state
`shared/js/scrapeReply.js` already contains:
- `rawReplyOverride`
- WebKit-specific prompt mismatch relaxations
- `isQualityReply`
- sanitize logic

Do **not** assume this is correct enough. Compare against desktop rather than piling on more heuristics.

## Most important task
Take over completely and debug this with a strict differential method.

### Required approach
1. Use desktop session `130` as the canonical reference.
2. Compare desktop collector and iOS collector for the same providers, especially `Gemini` and `Grok`.
3. Stop reasoning from UI state like `Ready`.
4. Measure success only by actual backend payload sent by iOS.
5. Avoid touching Android behavior.
6. Avoid changing session link persistence unless strictly necessary.

### What to verify
- Does iOS now produce the same kind of raw extracted text as desktop for `Gemini/Grok`?
- If not, is the divergence in:
  - extractor selection
  - clipboard capture
  - sanitize
  - quality gate
- Which exact layer still differs from desktop for `Gemini/Grok`?

## Suggested immediate steps
1. Inspect current `SlotWebViewModel.collectLatestReply(...)`
2. Inspect desktop `renderer.js` around:
   - `tryCopyLatestAssistantReply()`
   - `getLatestAssistantReply()`
   - `collectLatestRepliesFromEnabledSlots()`
   - `sanitizeScrapedReply()`
   - `isQualityReply()`
3. Verify whether iOS provider ordering truly matches desktop behavior for `Gemini` and `Grok`.
4. Run a fresh iOS collect on session `130` or `133`.
5. Query backend `ingest_debug_logs` and inspect the newest `responses[].markdown` for `IOS`.
6. Fix only the proven differing layer.

## Backend verification hint
Use the Supabase URL/key from:
- `/Users/v/Verity/docs/handoff/INTEGRATIONS_AND_KEYS.md`

Target table/filters already used successfully:
- `ingest_debug_logs`
- `session_id=eq.130` or `133`
- `source_platform_code=eq.IOS`
- `rpc_name=eq.ingest_aggregated_v1`

## Output expected from you
Return:
1. Exact remaining root cause for iOS vs desktop parity
2. Files changed
3. Why the change is safe for Android
4. Evidence from latest backend payload after the fix
