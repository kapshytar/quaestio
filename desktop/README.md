# Quaestio Desktop - ask every AI at once, keep the best answer

**Quaestio** is a multi-LLM chat aggregator: one prompt goes to **ChatGPT, Claude, Gemini, Grok, DeepSeek and Perplexity side by side**, you see all the answers next to each other, and one-click **Merge** synthesizes them into a single, best-of-all response. This directory is the desktop Electron client for **Windows, macOS and Linux**. (Quaestio is part of the Verity project; the optional sync backend is [VerityDB](https://veritydb.vercel.app).)

No per-message API costs for the chats themselves: the slots are real embedded browser sessions of the services you already use, logged in with **your own accounts and subscriptions**. API keys are only needed for the optional Merge step (bring your own key - DeepSeek, OpenAI, Gemini, Claude, OpenRouter, Hugging Face, or any OpenAI-compatible endpoint).

> Why: every model is good at different things, and the same model answers the same question differently run to run. Asking four of them at once and merging is the cheapest reliability trick there is - Quaestio makes it one click instead of eight copy-pastes.

![Quaestio desktop - Grok, Gemini and ChatGPT answering side by side with one-click Merge consensus](../docs/screens/desktop.png)

## Features

- **Parallel chat grid** - 4 simultaneous chat slots, each running a real session of ChatGPT, Claude, Gemini, Grok, DeepSeek or Perplexity. Swap any slot to any service.
- **Broadcast send** - type once, send to all enabled slots at the same time, with line breaks preserved.
- **Answer collection** - replies are scraped from each slot and aggregated into a structured record per question.
- **Merge / synthesis** - feed all collected answers to an LLM API of your choice and get one consolidated answer.
- **Sessions** - save and restore working layouts, service choices, conversation URLs and per-question aggregation context.
- **Focused slot views** - split or full-focus one slot without losing the rest of the workspace.
- **Cookie import** - bring existing browser sessions into the app for the least painful sign-in path.
- **Optional account sync** - sign in to sync sessions and aggregated notes across desktop, mobile and web to a Supabase backend. Accounts are currently **invite-only**: request access at [veritydb.vercel.app](https://veritydb.vercel.app). Until approved, everything works locally.
- **Notes / journal backend** - aggregated Q&A lands in a personal notes tree (the [dream-tracker](https://github.com/kapshytar/dream-tracker) web app), with tagging and Notion export.

## How it works

```text
            +------------------------------------------------+
 one prompt |  slot 1     slot 2     slot 3       slot 4     |
 ---------->| ChatGPT     Gemini      Grok       Claude      | real web sessions,
            |  answer      answer     answer      answer     | your own accounts
            +-----+----------+----------+-----------+---------+
                  +------ collected & aggregated ---+
                                 |
                         Merge (your API key)
                                 |
                      one synthesized answer
                                 |
             local store -- or -- account sync (Supabase)
```

The desktop client is the current scrape reference implementation. Provider selectors live in `renderer.js`, while ingestion, sessions, merge controls and secure renderer bridges are split across the flat Electron source files in this directory.

## Repo layout

```text
desktop/
├── main.js                 # Electron main process, windows, sessions, menus
├── renderer.js             # slot grid, provider presets, collect/scrape flow
├── preload.js              # secure renderer bridge
├── aggregation-control.js  # aggregation/session coordination
├── merge-api-client.js     # merge provider adapters
├── side-panel-controls.js  # merge panel state and inputs
├── cookie-import*.js       # cookie import helpers
├── docs/                   # feature docs and ingest/cookie contracts
└── debug-runs/             # local forensic scrape traces, not product data
```

Sibling client: [`mobile/`](../mobile/) (iOS + Android). Shared product semantics must stay aligned across desktop, iOS and Android, but desktop currently keeps its provider selectors inline.

## Build

```bash
npm install
npm start          # run locally
npm run dev        # run with Electron inspector
npm test           # Node test suite, when present
```

Packaging is explicit release work:

```bash
npm run build:win
npm run build:mac
npm run build:linux
```

`npm run build` uses `electron-builder`: it can write `dist/`, sign app bundles, touch Electron caches, and download runtime zips. For normal development, prefer `npm start` and targeted checks.

## Keys & privacy

- The app ships **no LLM provider keys and no secrets**. Merge requires your own key, entered in the app and stored locally.
- Chat slots authenticate through each service's own login inside the embedded browser; credentials never pass through any Quaestio/Verity server.
- Google sign-in inside embedded WebViews can be unreliable. The recommended path is cookie import: sign in with your normal browser, export cookies, then import them with `Ctrl+I`. See [docs/COOKIE_IMPORT.md](docs/COOKIE_IMPORT.md).
- In local mode, the app does not need the backend for chat collection or merge.

## License

Dual-licensed (see [NOTICE](../NOTICE)): `AGPL-3.0-only OR LicenseRef-Commercial`

- **AGPL-3.0** ([LICENSE](../LICENSE)) - use it for anything, commercial included.
  The condition is copyleft: if you distribute the app or let users interact
  with a modified version over a network, you must offer your complete
  modified source under AGPL-3.0, attribution retained.
- **Proprietary option** - a separate non-AGPL license (no copyleft
  conditions) is available from the owner: k.vitaliq@gmail.com.

Contributions are welcome under the inbound-license terms in
[CONTRIBUTING.md](../CONTRIBUTING.md).

---

*Keywords: multi-LLM desktop client, AI chat aggregator, compare ChatGPT Claude Gemini Grok DeepSeek Perplexity side by side, send one prompt to multiple AI models, merge AI answers, LLM answer synthesis, ensemble prompting, Electron AI app.*
