# Gunshi — AI Chat Aggregator for Android

## Quick init (copy-paste this to start a session)

```
Read the file GEMINI.md from the project root — it contains the full architecture, file structure, data flows, coding conventions, and common pitfalls for this project. Use it as your primary reference before making any changes. After reading, confirm what you understood and ask what I need.
```

Or if the AI has file access, just say:

```
init
```

and it should read `GEMINI.md` automatically if instructed to do so in its system prompt.

---

## Environment Requirements (STRICT)

To ensure build reproducibility across different OS (Windows/macOS) and CLI agents, the following must be met:

- **JDK:** Version 17 exactly (required for Gradle 8.x compatibility).
- **Android SDK:** API Level 34-36 (Compile/Target), Build Tools 34.0.0+.
- **Build Tool:** Use `./gradlew` (Unix) or `gradlew.bat` (Windows) exclusively. Do NOT use global `gradle`.
- **Shell:** PowerShell 7+ (Windows) or Zsh/Bash (macOS).
- **Line Endings:** LF (forced via `.editorconfig`), except for `.bat`/`.ps1`.
- **Diagnostics:** Run `./check-env.ps1` (Windows) or `sh check-env.sh` (Mac) to verify your environment before building.

---

## What this app does

Gunshi is a single-Activity Android app that opens 4 AI chat services simultaneously in WebViews (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity — user picks which 4) and lets the user send one message to all of them at once. A 5th "Merge" tab collects the latest replies from each and sends them to an AI API to produce a synthesized summary.

## Tech stack

- Kotlin, minSdk 26, targetSdk/compileSdk 34
- Single Activity (`MainActivity`), no Jetpack Navigation
- ViewPager2 + TabLayoutMediator for tab switching
- WebView-based chat (no SDK integrations — the app automates the real web UIs via JS injection)
- Material 3 components (Chips, MaterialButton, TabLayout)
- Markwon 4.6.2 for rendering Markdown in merge results
- Google Play Billing (subscription `gunshi_monthly`)
- Plain `HttpURLConnection` for merge API calls (no Retrofit/OkHttp)
- Gson for JSON
- GitHub Actions CI: push to `main` triggers `assembleRelease`, uploads signed APK as artifact

## Project structure

```
app/src/main/java/com/chataggregator/app/
├── MainActivity.kt          — The only Activity. Hosts ViewPager2, bottom panel, settings menu
├── ChatFragment.kt          — One per slot (0-3). Holds WebView, injects JS to send/scrape
├── MergeFragment.kt         — Tab 4. Provider picker, API key, runs merge, shows Markdown result
├── ChatPagerAdapter.kt      — FragmentStateAdapter: 4 ChatFragments + 1 MergeFragment
├── SlotManager.kt           — SharedPrefs wrapper for slot service IDs, enabled states, custom URLs
├── ServiceConfig.kt         — Defines 6 AI services (id, name, url, CSS selectors for input/button)
├── MessageInjector.kt       — Builds JS code to fill chat input + click Send in each WebView
├── MergeApiClient.kt        — HTTP calls to 8 merge providers. Enum MergeProvider has defaults
├── SettingsManager.kt       — SharedPrefs for app-wide settings (logging, merge enabled, etc.)
├── CookieImporter.kt        — Imports cookies from Cookie-Editor JSON into Android CookieManager
├── PlayBillingManager.kt    — Google Play Billing wrapper (subscription)
└── AdbControlReceiver.kt    — BroadcastReceiver for ADB debug commands

app/src/main/res/
├── layout/activity_main.xml    — TabLayout + ViewPager2 + bottom panel (chips, input, buttons)
├── layout/fragment_chat.xml    — WebView + loading spinner
├── layout/fragment_merge.xml   — Provider spinner, API key, endpoint, model, result TextView, clarification input
├── menu/settings_menu.xml      — Logging, cache cleanup, subscription
├── menu/tab_context_menu.xml   — Change service, reload, import cookies
├── menu/merge_tab_menu.xml     — Edit instructions, toggle provider/model visibility
├── values/strings.xml          — 72 strings (Russian + English)
├── values/colors.xml           — Light theme colors
├── values-night/colors.xml     — Dark theme colors
└── drawable/bg_input.xml       — Rounded rect background for EditText fields
```

## Architecture diagram

```
MainActivity
  ├── ViewPager2 (offscreenPageLimit=4, all tabs alive)
  │   ├── ChatFragment[0] ─── WebView → ChatGPT (or user-chosen service)
  │   ├── ChatFragment[1] ─── WebView → Claude
  │   ├── ChatFragment[2] ─── WebView → Gemini
  │   ├── ChatFragment[3] ─── WebView → Grok
  │   └── MergeFragment    ─── Provider config UI + Markwon result
  │
  └── Bottom Panel (always visible, outside ViewPager)
      ├── HorizontalScrollView with 5 Chips (slot toggles + merge toggle)
      ├── EditText (message input)
      ├── MaterialButton "Attach" (hidden unless unstable features on)
      └── MaterialButton "Send" / "Run Merge" (changes based on current tab)
```

## Key data flows

### 1. Send message to all services
```
User types message → taps Send
  → MainActivity.sendToAll()
  → iterates enabled slots with 90ms stagger
  → ChatFragment.sendMessage(text)
    → MessageInjector.buildSendScript(text, selectors, serviceId)
    → WebView.evaluateJavascript(jsCode)
    → JS fills input via React-compatible native setter + InputEvent dispatch
    → JS finds and clicks Send button (scored by aria-label/testid/proximity)
    → Returns JSON {success, via, remainingText}
    → Kotlin retries on failure (1s delay, up to 2 retries; Grok skips retry)
```

### 2. Merge responses
```
User on Merge tab + empty text input → taps "Run Merge"
  → MergeFragment.runMerge()
  → validates: merge enabled, API key present, model present (HuggingFace)
  → saves config to SharedPreferences
  → MainActivity.collectLatestRepliesFromEnabledSlots(callback)
    → for each enabled slot: ChatFragment.getLatestAssistantReply()
      → JS scrapes last assistant message from DOM
  → MergeApiClient.merge(config, responses) on background thread
    → buildPrompt(instructions + language rule + each slot's response)
    → HTTP POST to chosen provider API
    → parses response, appends metadata footer (provider, model, fallbacks)
  → markwon.setMarkdown(binding.mergeResult, resultText)
  → shows clarificationInputContainer for follow-up questions
```

### 2a. Clarification (follow-up to merge)
```
After successful merge → clarification input becomes visible
  → user types question → taps Send
  → MergeFragment.runClarificationMerge()
  → calls runMerge(isClarificationRequest=true, previousSummary=lastMergedText, clarificationText=...)
  → skips collecting slot responses (uses previousSummary instead)
  → MergeApiClient.merge() builds a simplified clarification prompt
  → result rendered, clarification input shown again for further follow-ups
```

### 3. Service change
```
Long-press tab → popup menu → "Change Service"
  → showServicePicker() dialog (list from ServiceConfig.SERVICES + "Custom URL")
  → SlotManager.setServiceId(slotIndex, newId)
  → ChatFragment.loadService(newId) → WebView navigates to service URL
  → tab label updates on onPageFinished via ServiceConfig.detectServiceByUrl()
```

## SharedPreferences layout

| Prefs file      | Key pattern                          | What it stores                        |
|-----------------|--------------------------------------|---------------------------------------|
| `slot_config`   | `slot_0`..`slot_3`                   | Service ID per slot (chatgpt, claude…) |
| `slot_config`   | `slot_enabled_0`..`slot_enabled_3`   | Boolean: is slot enabled              |
| `slot_config`   | `slot_custom_url_0`..`slot_custom_url_3` | Custom URL (if service = custom)  |
| `merge_config`  | `selected_provider`                  | Current MergeProvider ID              |
| `merge_config`  | `merge_{providerId}_api_key`         | API key per provider                  |
| `merge_config`  | `merge_{providerId}_custom_endpoint` | Endpoint per provider                 |
| `merge_config`  | `merge_{providerId}_custom_model`    | Model per provider                    |
| `merge_config`  | `merge_{providerId}_fallback_models` | Fallback model list per provider      |
| `merge_config`  | `config_expanded`                    | Boolean: is config panel expanded     |
| `app_settings`  | `detailed_logging`                   | Boolean: verbose logcat output        |
| `app_settings`  | `merge_enabled`                      | Boolean: global merge toggle          |
| `app_settings`  | `merge_instructions`                 | Custom merge prompt (overrides default)|
| `app_settings`  | `last_user_prompt`                   | Last sent message, Base64-encoded UTF-8 (used in merge prompt for language detection) |

## MergeProvider enum (MergeApiClient.kt)

Each provider has: `id`, `title`, `defaultEndpoint`, `defaultModel`. All are editable in the UI.

| Enum        | ID               | Default endpoint                                         | Default model              |
|-------------|------------------|----------------------------------------------------------|----------------------------|
| CHATGPT     | chatgpt_api      | https://api.openai.com/v1/chat/completions               | gpt-4o-mini                |
| DEEPSEEK    | deepseek_api     | https://api.deepseek.com/v1/chat/completions             | deepseek-chat              |
| GEMINI      | gemini_api       | https://generativelanguage.googleapis.com/v1beta         | gemini-2.0-flash           |
| PERPLEXITY  | perplexity_api   | https://api.perplexity.ai/chat/completions               | sonar                      |
| CLAUDE      | claude_api       | https://api.anthropic.com/v1/messages                    | claude-3-5-sonnet-latest   |
| OPENROUTER  | openrouter_api   | https://openrouter.ai/api/v1/chat/completions            | openai/gpt-4o-mini         |
| HUGGINGFACE | huggingface_api  | https://router.huggingface.co/v1/chat/completions        | (user must specify)        |
| CUSTOM      | custom_api       | (user must specify)                                       | (user must specify)        |

API dispatch in `merge()`:
- **Claude** → custom `callClaude()` (Anthropic format: `x-api-key` header, `anthropic-version`, `content[].text` response)
- **Gemini** → custom `callGemini()` (Google format: API key in URL, `contents[].parts[].text`, `candidates` response)
- **OpenRouter** → `callOpenAiWithFallbacks()` with extra headers (`HTTP-Referer`, `X-Title`)
- **HuggingFace, Custom** → `callOpenAiWithFallbacks()` (OpenAI-compatible)
- **ChatGPT, DeepSeek, Perplexity** → `callOpenAiWithFallbacks()` (OpenAI-compatible, `else` branch)

Fallback chain: on 429/rate-limit errors, tries next model from `fallbackModelsRaw` list.

## WebView JS injection (MessageInjector.kt)

`buildSendScript(message, selectors, serviceId)` returns a JS IIFE that:
1. Searches for chat input: tries service-specific CSS selectors first, then generic fallback (bottom-most visible textarea or contenteditable)
2. Fills input using `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text)` + `new Event('input', {bubbles: true})` (React-compatible)
3. For contenteditable: `el.innerHTML = text` + dispatch InputEvent
4. Finds Send button: queries candidates, scores them by keyword matches in aria-label/data-testid/textContent, picks highest score
5. Clicks button (or dispatches Enter keypress as fallback)
6. Returns JSON result

`buildAttachFileScript(serviceId)` clicks the file input or attach button to trigger the OS file chooser.

## WebView reply scraping (ChatFragment.kt)

`getLatestAssistantReply()` injects JS that:
1. Queries elements matching: `[data-message-author-role="assistant"]`, `[data-testid*="assistant"]`, `[class*="assistant"]`, `[class*="response"]`, `[class*="answer"]`
2. Filters: must be visible, text length >= 20 chars
3. Sorts by `getBoundingClientRect().bottom` (higher = more recent)
4. Returns `.innerText` of the bottom-most match

## Build & deploy

### CI (GitHub Actions)
Push to `main` → `.github/workflows/build-apk.yml` runs:
- JDK 17 + Android SDK + Gradle cache
- `assembleRelease` with signing from GitHub secrets (or `assembleDebug` fallback)
- Uploads APK as artifact `chat-aggregator-build-{run_number}`

### Local (PowerShell helpers in profile)
```
ca           # cd to project root
ca-build     # ./gradlew assembleDebug
ca-install   # adb install debug APK
ca-logs      # adb logcat filtered
```

### Deploy via Automated Script (Recommended)
Run the following to pull the latest successful CI build and install it via ADB:
```powershell
.\install-latest-ci.ps1
```
This script automatically connects to `192.168.0.101`, finds the latest successful run on `main`, downloads the artifact, and performs the install.

### Deploy via CI + ADB
```bash
git add <files> && git commit -m "message" && git push origin main
gh run watch <run_id> --exit-status     # wait for CI
gh run download <run_id> --dir ./ci-output
adb install -r ./ci-output/chat-aggregator-build-<N>/app-release.apk
```

## Coding conventions

- Kotlin, no coroutines (uses `thread {}` + `runOnUiThread` for background work)
- ViewBinding (not DataBinding)
- No ViewModel/LiveData — state stored directly in Fragments + SharedPreferences
- No dependency injection (all objects are singletons or created inline)
- No Retrofit/OkHttp — plain `HttpURLConnection` in `MergeApiClient`
- Strings in `strings.xml`, not hardcoded
- Colors in `colors.xml` with day/night variants
- `Log.d(TAG, ...)` for debug logging, gated by `SettingsManager.isDetailedLoggingEnabled()`

## Common pitfalls

1. **FragmentStateAdapter restore**: After Activity recreation, `FragmentStateAdapter` restores fragments without calling `createFragment()`. The adapter's `mergeFragment` field stays null. Fix: `findMergeFragment()` in MainActivity falls back to `supportFragmentManager.findFragmentByTag("f$MERGE_TAB_INDEX")`.

2. **WebView JS injection timing**: Services load asynchronously. `sendMessage()` may fail if the page isn't ready. There's retry logic with delays.

3. **React-compatible input filling**: Direct `.value = text` doesn't work in React apps. Must use native property descriptor setter + synthetic input events.

4. **offscreenPageLimit**: Must be >= NUM_SLOTS (4) to keep all tabs including Merge alive. Currently set to `SlotManager.NUM_SLOTS` (4).

5. **Merge API key persistence**: Keys are saved per-provider using `merge_{providerId}_api_key` in `merge_config` prefs. `saveCurrentFields()` is called before switching providers so keys don't get lost.

## Key constants

- `SlotManager.NUM_SLOTS = 4` (number of WebView chat slots)
- `MERGE_TAB_INDEX = SlotManager.NUM_SLOTS` (= 4, the last tab)
- Services: `chatgpt`, `claude`, `gemini`, `grok`, `deepseek`, `perplexity`
- Default slots: `chatgpt`, `claude`, `gemini`, `grok`
