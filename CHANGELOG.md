# Changelog

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
