# chat-aggregator-mobile - Working Notes

Repo entry: see `../VERITY_MAP.md` and `./CURRENT_STATE.md`.

## Layout

- `android/` — active Android source. The sibling `../chat-aggregator-android` repo is frozen legacy; do not edit it.
- `ios/VerityMobile/` — iOS source (Xcode project generated from `project.yml` via `xcodegen`).
- `shared/js/` — WebView injection (`sendMessage.js`, `scrapeReply.js`, `extractLatestAssistantRaw.js`, `mergeStreamParser.js`, `attachFile.js`). Both clients consume these as bundled assets.
- `shared/contracts/` — JSON specs + cross-client rule docs (`servicePresets.json`, `mergeConfig.json`, `streamParserConfig.json`, `QUESTION_IDENTITY_RULES.md`).

## Priority Rules

- When a bug spans both clients, fix both in the same change or extract to `shared/`. Drift between Android and iOS implementations of "same semantics" has repeatedly produced regressions — see [feedback_unify_cross_client_logic](../../.claude/projects/-Users-v-Verity/memory/feedback_unify_cross_client_logic.md) and the cross-client parity rituals in `tools/`.
- Do not invent new shared abstractions without two existing duplicates to justify them.
- Canonical scripts: `./scripts/deploy-ios-device.sh`, `./scripts/deploy-android-device.sh`, `./scripts/mobile-doctor.sh`, `./scripts/ingest-smoke-check.sh`.

## Non-Shared Areas

- Native UI + lifecycle glue (Android `MainActivity`/`Fragment*`, iOS `*View.swift`/`MobileAppState`).
- Billing / subscription code.
- Platform-specific cookie / login flows.
