# Quaestio — ask every AI at once, keep the best answer

**Quaestio is a chat aggregator that lets you work with multiple AI assistants simultaneously.** One prompt goes to **ChatGPT, Claude, Gemini, Grok, DeepSeek and Perplexity side by side**; you see every answer next to the others, and a one-click **Merge** synthesizes them into a single, best-of-all response.

The part nobody else gives you: the slots are **real sessions of your own accounts** — your subscriptions, your settings, and most importantly **your conversation history**. Every model keeps its own context between questions, exactly as if you were using it directly. No API metering for the chats themselves; an API key is needed only for the optional Merge step (bring your own — DeepSeek, OpenAI, Gemini, Claude, OpenRouter, or any OpenAI-compatible endpoint).

> Why: every model is good at different things, and the same model answers the same question differently run to run. Asking several of them at once — with their full context — and merging is the cheapest reliability trick there is. Quaestio makes it one click instead of eight copy-pastes.

## Clients in this repo

| Directory | Client | Stack |
| --- | --- | --- |
| [`desktop/`](desktop/) | Windows / macOS / Linux | Electron |
| [`mobile/`](mobile/) | iOS + Android | SwiftUI / Kotlin, shared JS provider core |

Both clients consume the same provider contracts (`mobile/shared/contracts/`) and injected DOM scripts (`mobile/shared/js/`), so "how to talk to each chat service" is defined once.

Quick start — desktop:

```bash
cd desktop && npm install && npm start
```

Mobile builds: see [`mobile/README.md`](mobile/README.md).

## Verity — the knowledge base behind it *(invite-only for now)*

Quaestio can run fully standalone and local. But signed-in, it syncs into **Verity** ([veritydb.vercel.app](https://veritydb.vercel.app)) — the part that turns aggregated answers into something you keep:

- **Every aggregated Q&A becomes a note** — the question, each model's answer, and the merged synthesis land as a structured record, automatically.
- **Graph-hierarchical structure at your fingertips** — notes form a tree (question → answers → merges → clarifications), reorganizable by drag, with tag trees on top.
- **You cannot lose a chat.** Search across everything you ever aggregated — full-text, instant. The conversation you half-remember from a month ago is three keystrokes away.
- **Multi-project binding** — the same knowledge base slices into separate projects/workspaces.
- **Cross-device** — sessions and notes sync between desktop, iOS, Android and the web app.
- **Notion export** — push takeaways or whole notes into Notion via a server-side OAuth integration.

Accounts are currently **invite-only**: request access at [veritydb.vercel.app](https://veritydb.vercel.app). Until approved — and entirely by choice — the apps work in local mode: everything stays on your device, zero backend calls.

## Privacy

- The apps ship **no LLM provider keys and no secrets**. Merge uses your own key, stored on-device.
- Chat slots authenticate through each service's own login inside the WebView; credentials never pass through any Quaestio/Verity server.
- No analytics, no telemetry, no chat content collection. In local mode the apps make zero backend calls (covered by tests on all platforms).

## License

Dual-licensed (see [NOTICE](NOTICE)): `AGPL-3.0-only OR LicenseRef-Commercial`

- **AGPL-3.0** ([LICENSE](LICENSE)) — use it for anything, commercial included.
  The condition is copyleft: if you distribute the app or let users interact
  with a modified version over a network, you must offer your complete
  modified source under AGPL-3.0, attribution retained.
- **Proprietary option** — a separate non-AGPL license (no copyleft
  conditions) is available from the owner: k.vitaliq@gmail.com.

Contributions are welcome under the inbound-license terms in
[CONTRIBUTING.md](CONTRIBUTING.md). Changelogs: [desktop](desktop/CHANGELOG.md) · [mobile](mobile/CHANGELOG.md).

---

*Keywords: multi-LLM client, AI chat aggregator, compare ChatGPT Claude Gemini Grok DeepSeek Perplexity side by side, one prompt to multiple AI models, merge AI answers, LLM answer synthesis, ensemble prompting, AI knowledge base, personal AI notes, Electron iOS Android.*
