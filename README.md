<sub>Q U A E S T I O&nbsp;&nbsp;|&nbsp;&nbsp;V E R I T Y _ D B</sub>

# Quaestio + VerityDB

**Ask EVERY major AI at once — then ACTUALLY KEEP and ORGANIZE what they tell you.**

I use ChatGPT, Claude, Gemini and Grok every day. And every day, the SAME PAIN:
my best thinking ended up SCATTERED across a dozen chat tabs — impossible to BRANCH,
impossible to PRUNE, impossible to FIND a week later. NOT ONE provider lets you
STRUCTURE your AI work: branch a project, fork a note, throw out the JUNK and keep
only the GOLD.

So I BUILT IT MYSELF.

Quaestio fires ONE prompt at ALL of them — your REAL WEB ACCOUNTS, not APIs — MERGES
the answers, and turns the whole thing into a KNOWLEDGE GRAPH — a 2-WAY MULTIBRANCHING
TREE YOU OWN.

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

## The part NO PROVIDER gives you: STRUCTURE YOU OWN *(invite-only for now)*

Quaestio runs fully standalone and local. Signed in, every aggregated Q&A flows into **VerityDB** ([veritydb.vercel.app](https://veritydb.vercel.app)) — NOT a chat log, a LIVING GRAPH / 2-WAY MULTIBRANCHING TREE:

- **Every aggregated Q&A becomes a note** — the question, each model's answer, and the merged synthesis land as a structured record, automatically.
- **A GRAPH / 2-WAY MULTIBRANCHING TREE, not a folder.** The SAME note lives in MANY trees at once; a sub-project belongs to SEVERAL projects. Your work is NOT trapped in one linear thread — it's a WEB you re-slice however you think.
- **CONTINUE ANY VECTOR INSTANTLY.** Grab ANY note, ANYWHERE in the graph, and pick that exact thread back up across ALL the models — a month-old line of thinking is THREE KEYSTROKES away.
- **PRUNE TO THE GOLD.** Kill the noise, keep the signal, restructure by drag, tag-trees on top. What's left is a CLEAN MAP of what you actually learned — NOT a pile of transcripts.
- **You CANNOT lose a chat.** INSTANT full-text search across EVERYTHING you ever aggregated.
- **CROSS-DEVICE + Notion export.** Desktop, iOS, Android and web stay synced; push takeaways straight into Notion via server-side OAuth.

I built this because NO AI PROVIDER gives you ANY of it. Accounts are INVITE-ONLY for now — request access at [veritydb.vercel.app](https://veritydb.vercel.app). Until approved (and by CHOICE anytime) the apps run FULLY LOCAL: everything stays on device, ZERO backend calls.

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
