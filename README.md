# Verity Mobile — ask every AI at once, keep the best answer

**Verity** is a multi-LLM chat aggregator: one prompt goes to **ChatGPT, Claude, Gemini, Grok, DeepSeek and Perplexity side by side**, you see all the answers next to each other, and a one-tap **Merge** synthesizes them into a single, best-of-all response. This repo is the mobile half of the project — native **iOS and Android** apps sharing one provider-logic core.

No per-message API costs for the chats themselves: the slots are real WebView sessions of the services you already use, logged in with **your own accounts and subscriptions**. API keys are only needed for the optional Merge step (bring your own key — DeepSeek, OpenAI, Gemini, Claude, OpenRouter, Hugging Face, or any OpenAI-compatible endpoint).

> Why: every model is good at different things, and the same model answers the same question differently run to run. Asking four of them at once and merging is the cheapest reliability trick there is — Verity makes it one tap instead of eight copy-pastes.

## Features

- **Parallel chat grid** — 4 simultaneous chat slots (WebView), each running a real session of ChatGPT, Claude, Gemini, Grok, DeepSeek or Perplexity. Swap any slot to any service.
- **Broadcast send** — type once, send to all enabled slots at the same time. File attachments supported where the service allows it.
- **Answer collection** — replies are scraped from each slot and aggregated into a single structured record per question.
- **Merge / synthesis** — feed all collected answers to an LLM API of your choice and get one consolidated answer (with streaming). Provider catalog is config-driven (`shared/contracts/mergeConfig.json`).
- **Sessions** — save a working layout (which services, which conversations) and restore it later; per-session history.
- **Local-first** — works fully offline-from-the-backend: choose *Use Locally* at first run and nothing ever leaves the device.
- **Optional account sync** — sign in to sync sessions and aggregated notes across devices (mobile ↔ desktop ↔ web) to a Supabase backend. Accounts are currently **invite-only**: request access at [veritydb.vercel.app](https://veritydb.vercel.app). Until approved, everything works in local mode.
- **Notes / journal backend** — aggregated Q&A lands in a personal notes tree (the [dream-tracker](https://github.com/kapshytar/dream-tracker) web app), with tagging and Notion export.

## How it works

```text
            ┌────────────────────────────────────────────┐
 one prompt │  slot 1     slot 2     slot 3     slot 4   │
 ──────────▶│ ChatGPT     Gemini      Grok     DeepSeek  │  real WebView sessions,
            │  answer      answer     answer    answer   │  your own accounts
            └──────┬──────────┬──────────┬─────────┬─────┘
                   └────── collected & aggregated ─┘
                                  │
                          Merge (your API key)
                                  │
                       one synthesized answer
                                  │
              local store ── or ── account sync (Supabase)
```

The DOM logic that knows how to type into / read out of each chat service is **shared JavaScript** (`shared/js/`), injected into the WebViews on both platforms, so iOS and Android stay in lockstep. Per-service selectors and behavior live in JSON contracts (`shared/contracts/servicePresets.json`).

## Repo layout

```text
chat-aggregator-mobile/
├── android/   # Kotlin, single-activity, 4 WebView slots + Merge tab
├── ios/       # SwiftUI (VerityMobile), xcodegen project
├── shared/
│   ├── js/         # injected provider scripts: send, scrape, attach, stream-parse
│   └── contracts/  # servicePresets.json, mergeConfig.json, cross-client rules
├── docs/
└── scripts/   # canonical build/deploy/smoke-check scripts
```

Sibling repos: [dream-tracker](https://github.com/kapshytar/dream-tracker) (web app + Supabase backend), `chat-aggregator` (Electron desktop client).

## Build

```bash
./scripts/mobile-doctor.sh           # environment / device sanity check
./scripts/deploy-ios-device.sh      # build & install on a connected iPhone
./scripts/deploy-android-device.sh  # build & install on a connected Android device
```

iOS: the Xcode project is generated — `cd ios && xcodegen` (config in `project.yml`).
Android: pinned JDK comes from `android/gradle.properties`; use the script rather than raw `./gradlew`.

## Keys & privacy

- The app ships **no API keys**. Merge requires your own key, entered in the app and stored on-device.
- Chat slots authenticate through each service's own login inside the WebView; credentials never pass through any Verity server.
- In local mode the app makes zero backend calls (enforced and covered by tests on both platforms).

## License

Dual-licensed (see [NOTICE](NOTICE)):

- **AGPL-3.0** ([LICENSE](LICENSE)) — free to use, fork, and modify; but if
  you distribute it or run a modified version as a service, you must publish
  your complete modified source under AGPL-3.0 with attribution retained.
- **Commercial** — to build a closed-source or commercial product on this code
  without AGPL obligations, contact k.vitaliq@gmail.com for a commercial
  license.

---

*Keywords: multi-LLM client, AI chat aggregator, compare ChatGPT Claude Gemini Grok DeepSeek Perplexity side by side, send one prompt to multiple AI models, merge AI answers, LLM answer synthesis, ensemble prompting, iOS Android AI app.*
