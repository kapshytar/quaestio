# chat-aggregator-mobile

Monorepo scaffold for the future shared mobile workspace:

- `android/`
- `ios/`
- `shared/`
- `docs/`

## Current Status

This repo is intentionally starting as a scaffold only.

- The live Android app still exists in the sibling repo:
  - `../chat-aggregator-android`
- iOS code has not been ported yet.
- `shared/js` is reserved for platform-agnostic WebView injection/scrape logic.

## Goal

Move from separate mobile clients toward one mobile monorepo where:

- Android lives under `android/`
- iOS lives under `ios/`
- shared JS lives under `shared/js/`
- shared payload/contracts docs live under `shared/contracts/`

## Planned Layout

```text
chat-aggregator-mobile/
├── android/
├── ios/
├── shared/
│   ├── js/
│   └── contracts/
└── docs/
```

## Immediate Next Steps

1. Define the shared JS surface area before copying code.
2. Document which Android files will become the migration source.
3. Create the iOS project shell around the same shared contracts.
4. Only then move Android code into `android/`.

