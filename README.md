# Quaestio — Verity Desktop: ask every AI at once, keep the best answer

**Quaestio** is the desktop client of **Verity**, a multi-LLM chat aggregator: one prompt goes to **ChatGPT, Claude, Gemini, Grok, DeepSeek and Perplexity side by side**, you see all the answers next to each other, and a one-click **Merge** synthesizes them into a single, best-of-all response. Electron app for Windows / macOS / Linux.

No per-message API costs for the chats themselves: the slots are real WebView sessions of the services you already use, logged in with **your own accounts and subscriptions**. An API key is only needed for the optional Merge step (bring your own — DeepSeek, OpenAI, Gemini, Claude, OpenRouter, or any OpenAI-compatible endpoint).

> Why: every model is good at different things, and the same model answers the same question differently run to run. Asking four of them at once and merging is the cheapest reliability trick there is — Quaestio makes it one click instead of eight copy-pastes.

## Features

- **4-slot chat grid** — four simultaneous WebView sessions; assign any supported AI service to any slot, with per-slot URL and zoom control.
- **Broadcast send** — type once, `Enter` sends to all enabled slots at the same time.
- **Merge / synthesis** — collect all replies and feed them to an LLM API of your choice for one consolidated answer; right-side panel manages providers and API keys.
- **Cookie import** — pull sessions from Chrome/Edge (`Ctrl+I`) for instant sign-in to the chat services.
- **Sessions** — save and restore grid layouts; signed-in sessions sync across devices (desktop ↔ [iOS/Android](https://github.com/kapshytar/chat-aggregator-mobile) ↔ web).
- **Local-first** — choose *Use Locally* at first run and nothing leaves your machine. Optional accounts are **invite-only**: request access at [veritydb.vercel.app](https://veritydb.vercel.app).
- **Search** — `Ctrl+F` across a slot, the merge output, or all slots at once.

## Quick start

```bash
npm install
npm start        # or start.bat (Windows) / start.sh (macOS, Linux)
```

Then sign in to the chat services inside the slots (or import cookies — see [docs/COOKIE_IMPORT.md](docs/COOKIE_IMPORT.md)).

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Enter` | Send to all active slots |
| `Shift+Enter` | New line |
| `Ctrl+I` | Import cookies |
| `Ctrl+F` | Search (slot / merge / all) |
| `Ctrl+R` | Reload all slots |
| `Ctrl +/−/0` | Zoom / reset |
| `F12` | DevTools |

## Project structure

- `main.js` — Electron main process
- `renderer.js` — front-end logic and broadcast send
- `index.html` — UI (4 WebViews + merge panel)
- `merge-api-client.js` — LLM API client for the Merge step
- `auth-store.js` — optional account sign-in (user JWT; no privileged keys ship in the app)

More docs: [QUICKSTART.md](QUICKSTART.md), [TECHNICAL_DOCS.md](TECHNICAL_DOCS.md), [docs/](docs/).

## Related repos

- [chat-aggregator-mobile](https://github.com/kapshytar/chat-aggregator-mobile) — native iOS + Android clients sharing the same provider contracts.

## License

Dual-licensed (see [NOTICE](NOTICE)): `AGPL-3.0-only OR LicenseRef-Commercial`

- **AGPL-3.0** ([LICENSE](LICENSE)) — use it for anything, commercial included.
  The condition is copyleft: if you distribute the app or let users interact
  with a modified version over a network, you must offer your complete
  modified source under AGPL-3.0, attribution retained.
- **Proprietary option** — a separate non-AGPL license (no copyleft
  conditions) is available from the owner: k.vitaliq@gmail.com.

Contributions are welcome under the inbound-license terms in
[CONTRIBUTING.md](CONTRIBUTING.md).

---

*Keywords: multi-LLM desktop client, AI chat aggregator, compare ChatGPT Claude Gemini Grok DeepSeek Perplexity side by side, send one prompt to multiple AI models, merge AI answers, LLM answer synthesis, ensemble prompting, Electron AI app.*
