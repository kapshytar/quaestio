# Handoff — iOS duplicate sessions/roots on Collect + state of the 2.8.x merge fixes

Audience: Claude Code (or any worker) picking this up on the user's Mac, with
DB (Supabase), device logs, and git push access. Authoring environment was
Cowork (sandboxed, no Xcode/DB/git-creds), so the verification steps below were
NOT run — they are the first things to do here.

## TL;DR

- A batch of iOS-only merge fixes (versions **2.8.2 → 2.8.5**) is sitting
  **UNCOMMITTED** in the working tree on top of `HEAD` (which is the 2.8.1
  commit `9165ca4`). 2.8.5 has been built and installed on the physical iPhone
  and is confirmed working for: inline **bold**/italic/code, GFM tables,
  nested bullets, the "Collected N/M" status, and persistent merge API key.
- There is an OPEN bug: on iPhone, pressing **Collect** repeatedly spawns
  duplicate aggregated note-roots under the same session id (Sessions list shows
  several rows with the same `#id` but different titles, plus fresh sessions).
  Root cause analysis is below. It appears to be a **latent ordering bug**, not
  introduced by the 2.8.x changes — but that must be confirmed against the DB +
  git history before fixing.
- The user's strong prior is "it worked fine before, something is off now."
  Respect that: verify with DB/log evidence rather than asserting.

## Current version / build state

- `MARKETING_VERSION = 2.8.5`, build `287` (`mobile/project.yml` +
  `mobile/android/version.properties` in sync; `./scripts/check-versioning.sh`
  passes).
- Everything for 2.8.2–2.8.5 is **uncommitted working-tree changes**. `git status`
  (in `chat-aggregator`) shows modified: `mobile/CHANGELOG.md`,
  `mobile/project.yml`, `mobile/android/version.properties`,
  `mobile/ios/VerityMobile/MobileAppState.swift`,
  `mobile/ios/VerityMobile/MergeView.swift`,
  `mobile/ios/VerityMobile/MergeMarkdownView.swift`,
  `mobile/scripts/deploy-ios-device.sh`.
- Nothing has been committed for these. A first task is to review the diff and
  commit per-version (or as one squashed merge-fixes commit) following
  `VERSIONING.md` / repo convention, then push.

## What each version changed (all iOS-only, all in the working tree)

- **2.8.2** — first attempt at three fixes; all targeted the right symptom at the
  wrong layer and did NOT work on device. Superseded by 2.8.4. (Kept in CHANGELOG
  for honesty.)
- **2.8.3** — GFM pipe-tables on iOS (`MergeMarkdownView.swift`). Android (Markwon
  + TablePlugin) and desktop (marked.js GFM) already rendered tables.
- **2.8.4** — corrections that actually work on device:
  - bold/italic/code: a view-level `.font(.system(weight:))` modifier on a
    `Text(AttributedString)` was overriding the parser's per-run
    `inlinePresentationIntent`. Fix bakes a SwiftUI `Font` into each run and drops
    the competing modifier (`MergeMarkdownView.swift`).
  - status: `mergeAggregationSummary` was stuck on "All N slot(s) ready.
    Collecting now…" at the all-ready early-exit of `collectLatestRepliesForMerge`;
    now writes "Collected N/N source reply(s)" (`MobileAppState.swift`).
  - key: `selectedProviderId` was never persisted, so on cold launch the Keychain
    load ran against the default provider; and `usePreinstalledKey` stayed `true`,
    hiding the field and making `resolvedApiKey()` ignore the loaded key. Now the
    provider id is persisted to UserDefaults and restored before the Keychain load,
    and `usePreinstalledKey` is set false when a custom key exists (`MergeView.swift`).
- **2.8.5** — nested/indented bullets on iOS (`MergeMarkdownView.swift`): the block
  parser trimmed lines before bullet detection, flattening sub-lists. Added
  `bulletIndentLevel(of:)` (leading whitespace → level; tab=4 cols; ~2 cols/level;
  cap 3); `.bullet` now carries `level`, renders with `level*18pt` indent and
  tiered markers •/◦/▪ to match the desktop/web canon.

NOTE: `mobile/scripts/deploy-ios-device.sh` is also modified — a partial hardening
of `resolve_device_udid` (it previously accepted a paired-but-offline device and
fed a dead UDID to xcodebuild). Review/verify this diff; it built fine for the
on-device 2.8.5 deploy, but confirm the availability check is sound.

## Related (separate repo) — dream-tracker, already pushed

- Notion takeaways export bug ("Connect a Notion parent page first" even after
  selecting an existing page). Root cause: `onSelectParent` stored the raw
  `candidate.url` (e.g. `app.notion.com/p/Title-<id>` or
  `notion.so/<workspace-slug>/Title-<id>`), which `extractNotionPageId`'s regex
  (`notion\.so/(?:[^/?#]+-)?<32hex>`) could not parse → `notionPageId = null` →
  guard fired. Fix builds a clean `https://www.notion.so/<cleanId>` from
  `candidate.id`. File: `dream-tracker/src/components/editor/NoteEditor.tsx`
  (~line 6219). Committed + pushed: `2aa3494` on `main`, changelog `0.27.21`.
  The user was testing a not-yet-deployed build (the field still showed the raw
  `app.notion.com/p/...` URL) — confirm Vercel redeployed and the picker now
  stores the clean URL.

## THE OPEN BUG — iOS duplicate sessions / multiple roots on Collect

Symptom: Sessions list shows several rows sharing one session `#id` (e.g. `#277`)
with different titles, plus new `#278`/`#279`. Android does NOT do this and is the
reference.

Root cause (read-only analysis; verify against DB/logs before trusting):

- `MobileAppState.manualCollectCurrentQuestion` computes `sameQuestionAsCurrentRoot`
  by comparing the resolved/typed prompt against
  `sessionManager.getParallelIngestState().sourcePrompt` (lines ~624–631).
- Then it calls `collectLatestRepliesForMerge` → `scrapeRepliesRecoveringPromptIfNeeded`
  (lines ~1161–1179), which **unconditionally persists the DOM-recovered prompt**
  via `sessionManager.rememberSourcePrompt(recoveredPrompt)`.
- Consequence: on the NEXT Collect, the "reference" prompt is the DOM-scraped
  text from the prior pass, not the user's typed text. `promptsReferToSameQuestion`
  (exact lowercased equality, line ~2110, identical to Android) then returns false,
  so `startNewQuestionInCurrentSession` fires and `ingestCollectedResponses` runs
  with `targetAggregatedNoteId = nil` → backend creates a NEW root under the same
  session. Repeated Collects ⇒ many roots ⇒ the screenshot.
- Android avoids this: `collectNowAggregation` resolves the scraped prompt with
  `allowDirectFallback = false, persist = false` (MainActivity ~2667) — it uses the
  scraped text for the decision WITHOUT overwriting the stored `sourcePrompt`, and
  the new-question branch clears only the note id (`clearParallelIngestActiveNoteId`),
  keeping the session.
- Secondary contributor: `hasCurrentQuestionContextForCurrentSlots` (line ~1520)
  requires a stored `SessionSnapshot` matching `sessionId + activeNoteId +
  current slot fingerprint`; if URLs/fingerprint drift, `manualCollectCurrentQuestion`
  (lines ~616–619) calls `clearParallelIngestState()` and forces a new root.

The comparator is fine; the bug is WHAT it compares (iOS feeds a DOM-recovered
prompt as the reference; Android always feeds the last user-typed text).

### Suggested fix direction (do NOT ship without DB verification)

1. Primary — `scrapeRepliesRecoveringPromptIfNeeded`: do not persist the
   DOM-recovered prompt to `sessionManager.sourcePrompt` when a root already exists
   (`currentQuestionAggregatedNoteId() != nil`). Mirror Android's
   `allowDirectFallback = false, persist = false` semantics for the same-question
   decision path.
2. Secondary — `manualCollectCurrentQuestion`: capture `loadedQuestionPrompt`
   BEFORE the `await collectLatestRepliesForMerge` call and use the captured value
   for the same-question test (the state can mutate during the await on @MainActor).
3. Tertiary — `hasCurrentQuestionContextForCurrentSlots`: when a valid
   `sessionId + activeNoteId` already exists from a recent ingest, consider matching
   on `sessionId` alone rather than the full slot fingerprint.

## "Did the 2.8.x merge changes break this?" — how to settle it

Evidence already in hand: the working-tree diff of `MobileAppState.swift` only
touches the `MergeAggregationSlotStatus` enum, two `mergeAggregationSummary`
strings, `makeCollectedSnapshots`, and `formatAggregationSummary`. It does NOT
touch `scrapeRepliesRecoveringPromptIfNeeded`, `manualCollectCurrentQuestion`'s
identity logic, `promptsReferToSameQuestion`, or any ingest/session call. So the
diff does not implicate the session path. Confirm with:

- `git diff HEAD -- mobile/ios/VerityMobile/MobileAppState.swift` and
  `git diff HEAD -- mobile/ios/VerityMobile/MergeView.swift` — verify no
  session/ingest/prompt-identity lines changed.
- DB (Supabase) forensics: query the aggregated note roots and sessions for this
  user, ordered by `created_at`. Correlate the timestamps of the duplicate roots
  with when 2.8.x builds were installed (the device install happened ~04:36 today;
  earlier builds before that). If duplicates predate the 2.8.x install, the bug is
  pre-existing. Look at the visible question rows (`notes.note_type = 1`) and their
  `aggregated_note_id` linkage; check whether multiple roots share a `session_id`.
- Device logs during a Collect: confirm whether `startNewQuestionInCurrentSession`
  / a nil `targetAggregatedNoteId` path is being hit on same-question re-Collect.

## Build / deploy / versioning / git mechanics

- Versioning contract: `mobile/VERSIONING.md`. Bump with
  `./scripts/bump-version.sh patch` (keeps `project.yml` + `android/version.properties`
  in sync and inserts a CHANGELOG stub); validate with
  `./scripts/check-versioning.sh`.
- iOS device build+install (canonical):
  `cd mobile && ./scripts/deploy-ios-device.sh` — builds Debug, installs via
  `devicectl`, verifies installed version, launches. Requires the iPhone connected
  (cable or same-WiFi) and visible to Xcode. It prints
  `Installed version verified: <ver> (<build>)` on success.
- Commit the uncommitted 2.8.x changes and push once reviewed.

## Open tasks for the next session

1. Pull DB evidence to confirm whether the duplicate-roots bug pre-dates the 2.8.x
   builds (settle the "did you break it" question with data, not assertion).
2. Implement the primary (+secondary) fix above, bump to 2.8.6, rebuild on device,
   and verify repeated Collect on the same question reuses one root.
3. Review + commit + push the 2.8.2–2.8.5 working-tree changes (and the deploy
   script hardening) with proper messages.
4. Confirm dream-tracker `2aa3494` deployed and the Notion export works end-to-end.
