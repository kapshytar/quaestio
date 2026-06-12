<sub>Q U A E S T I O&nbsp;&nbsp;|&nbsp;&nbsp;V E R I T Y _ D B</sub>

# The only AI aggregator where YOUR OWN accounts and YOUR OWN history actually work!

<p>
Love web ChatGPT, Gemini, Grok and Claude? Want to know what they ALL think?<br>
&nbsp;&nbsp;&nbsp;&nbsp;Want to COMPARE answers SIDE BY SIDE fast? NOT via API, via REAL WEB UI?<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;With YOUR OWN account, YOUR OWN history, YOUR OWN context?
</p>

**Welcome, you FOUND IT!!!**

<p>
You also can MERGE everything so you don't need to read every LLM's answer separately.<br>
&nbsp;&nbsp;&nbsp;&nbsp;Also you can JUMP BACK into PREVIOUS DISCUSSIONS across multiple LLMs,<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;manage REAL PROJECTS and subPROJECTS,<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;run FAST SEARCH,<br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;compress giant model outputs into CLEAN COMPACT notes.
</p>

**It is all here.**

<sub>No API metering for the chats — the slots are the real provider websites with your real account state (subscriptions, settings, memory). A key is needed only for the optional Merge step: bring your own — DeepSeek, OpenAI, Gemini, Claude, OpenRouter, or any OpenAI-compatible endpoint.</sub>

🔗 **Waitlist / early access: [veritydb.vercel.app](https://veritydb.vercel.app)**

![Quaestio desktop — Grok, Gemini and ChatGPT answering side by side with one-click Merge consensus](docs/screens/desktop.png)

![VerityDB web — chats become a searchable project tree with per-model answers and the merged synthesis](docs/screens/web-dark.png)

<p align="center">
  <img src="docs/screens/ios.png" alt="Quaestio on iPhone" width="32%" />
  <img src="docs/screens/android.png" alt="Quaestio on Android" width="32%" />
</p>

<sub>VerityDB web also ships a light mode: [docs/screens/web-light.png](docs/screens/web-light.png)</sub>

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

## ⚠️ KNOWN ISSUES

**Google sign-in inside the chat slots is a pain.** Google actively blocks
sign-in from embedded WebViews ("This browser or app may not be secure"), so
logging into Gemini — and into ChatGPT/Grok via the "Continue with Google"
button — can take a few attempts. Workarounds, in order of reliability:

1. **Cookie import — the bulletproof option.** Sign in to the service in your
   normal browser, export the cookies, import them into the app (desktop:
   `Ctrl+I` / Import 🍪, see [desktop/docs/COOKIE_IMPORT.md](desktop/docs/COOKIE_IMPORT.md)).
   The slot picks up your real session instantly.
2. **User-agent switching (iOS).** The iPhone app can change the WebView
   user agent specifically so Google's WebView detection backs off — switch
   the UA, sign in, switch back if needed.
3. Sign in with the service's **native email/password** login instead of the
   "Continue with Google" button where possible — it usually passes.

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
