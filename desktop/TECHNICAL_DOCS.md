# Chat Aggregator Windows - Technical Documentation

**Project:** Chat Aggregator for Windows (Electron)  
**Ported from:** Gunshi Android (Build 119)  
**Date:** February 18, 2026  
**Location:** `C:\chat-aggregator`

---

## 📁 Project Structure

```
C:\chat-aggregator/
├── index.html              # Main UI (4 WebView grid + right merge panel)
├── renderer.js             # Main renderer logic (send, merge, scraping)
├── merge-api-client.js     # API client for 8 LLM providers
├── side-panel-controls.js  # Right panel toggle & resize logic
├── main.js                 # Electron main process
├── preload.js              # Electron preload script
├── package.json            # Dependencies & build config
└── docs/
    ├── ADB_DEBUG_COMMANDS.md
    ├── CHANGELOG_AGENT.md
    ├── PLAY_RELEASE_CHECKLIST.md
    └── PLAY_STORE_COPY.md
```

---

## 🏗 Architecture

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  [WebView 1: ChatGPT]  [WebView 2: Claude] │               │
│                                            │  Merge Panel  │
│  [WebView 3: Gemini]   [WebView 4: Grok]   │  (Right Side) │
│                                            │  - Provider   │
│                                            │  - API Key    │
│                                            │  - Run Merge  │
│                                            │  - Result     │
├────────────────────────────────────────────┼───────────────┤
│ [✓] Slot1 [✓] Slot2 [✓] Slot3 [✓] Slot4   │               │
│ [Input________________] [Send] [Merge ▸]   │               │
└────────────────────────────────────────────┴───────────────┘
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| **WebView Grid** | `index.html` | 4x2 grid of Electron `<webview>` tags |
| **Bottom Panel** | `index.html` | Slot toggles, message input, send button |
| **Merge Panel** | `index.html` | Right side panel (collapsible, resizable) |
| **Send Logic** | `renderer.js` | Sends message to all enabled slots |
| **Merge Logic** | `renderer.js` | Collects responses, calls merge API |
| **API Client** | `merge-api-client.js` | HTTP calls to 8 LLM providers |
| **Panel Controls** | `side-panel-controls.js` | Toggle, resize, persistence |

---

## 🔧 Key Features

### 1. Multi-Slot Messaging

**Flow:**
1. User types message in bottom input
2. Clicks "Send" or presses Enter
3. Message sent to all enabled slots (250ms stagger)
4. Status indicators update (✓/✗/⏳)

**Code:** `renderer.js` → `sendToAll()` → `sendMessage()`

### 2. Merge Feature

**Flow:**
1. User opens right panel (clicks "Merge ▸")
2. Enters API key, selects provider
3. Clicks "⚡ Run Merge" (teal button)
4. App collects responses from enabled slots
5. Calls merge API with collected responses
6. Displays markdown result
7. Shows clarification input for follow-up

**Code:** `renderer.js` → `runMerge()` → `MergeApiClient.merge()`

### 3. Perplexity Warm-up Fix

**Problem:** Perplexity's React UI only renders send button AFTER first character is typed.

**Solution:**
```javascript
if (serviceId === 'perplexity') {
  fillInput(inputEl, ' ');        // Step 1: Insert space
  setTimeout(() => {
    fillInput(inputEl, message);  // Step 2: Replace with real message
    setTimeout(() => {
      const btn = findSendButton(inputEl);
      if (btn) btn.click();       // Step 3: Click send
    }, 400);
  }, 100);
}
```

**Location:** `renderer.js` → `sendMessage()` → JS injection code

### 4. WebView Reply Scraping

**Purpose:** Collect assistant responses for merge.

**Selectors:**
- `[data-message-author-role="assistant"]`
- `[data-testid*="assistant"]`
- `[class*="assistant"]`, `[class*="response"]`, `[class*="answer"]`

**Perplexity Special:** Prefer content inside `[class*="prose"]`

**Code:** `renderer.js` → `getLatestAssistantReply()`

---

## 🎨 UI Components

### Bottom Panel

| Element | ID | Action |
|---------|----|--------|
| Slot toggles | `toggle-slot-1`..`4` | Enable/disable slots |
| Message input | `message-input` | Type message |
| Send button | `send-btn` | Send to all enabled slots |
| Merge toggle | `toggle-merge-panel-btn` | Open/close right panel |

### Right Merge Panel

| Element | ID | Action |
|---------|----|--------|
| Provider select | `merge-provider` | Select LLM provider |
| API key input | `merge-api-key` | Enter API key |
| Endpoint input | `merge-endpoint` | Custom API endpoint |
| Model input | `merge-model` | Custom model name |
| Fallback input | `merge-fallback-models` | Fallback models (comma-separated) |
| **Run Merge button** | `run-merge-btn` | **Trigger merge** |
| Merge result | `merge-result` | Markdown output |
| Clarification input | `clarification-input` | Follow-up question |
| Clarification send | `clarification-send-btn` | Send follow-up |

---

## 🔌 Merge API Providers

| Provider | ID | Default Endpoint | Default Model |
|----------|----|------------------|---------------|
| ChatGPT | `chatgpt_api` | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| Claude | `claude_api` | `https://api.anthropic.com/v1/messages` | `claude-3-5-sonnet-latest` |
| Gemini | `gemini_api` | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.0-flash` |
| Perplexity | `perplexity_api` | `https://api.perplexity.ai/chat/completions` | `sonar` |
| DeepSeek | `deepseek_api` | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| OpenRouter | `openrouter_api` | `https://openrouter.ai/api/v1/chat/completions` | `openai/gpt-4o-mini` |
| Hugging Face | `huggingface_api` | `https://router.huggingface.co/v1/chat/completions` | (user-specified) |
| Custom | `custom_api` | (user-specified) | (user-specified) |

**Special Handling:**
- **Claude:** Uses `callClaude()` (Anthropic format: `x-api-key` header, `content[].text`)
- **Gemini:** Uses `callGemini()` (Google format: API key in URL, `candidates[].content`)
- **OpenRouter:** Extra headers (`HTTP-Referer`, `X-Title`)
- **Others:** Standard OpenAI-compatible format

---

## 💾 Data Persistence

### localStorage Keys

| Key | Purpose | Default |
|-----|---------|---------|
| `slot-config` | Service ID per slot | `{"slot-1":"chatgpt",...}` |
| `top-collapsed` | Toolbar collapsed state | `"false"` |
| `show-address-bar` | Address bar visibility | `"true"` |
| `merge-panel-collapsed` | Right panel state | `"false"` |
| `zoom-slot-1`..`4` | Zoom level per slot | `1.0` |
| `merge-config` | Merge provider config | JSON object |

### merge-config Structure

```json
{
  "providerId": "chatgpt_api",
  "apiKey": "sk-...",
  "endpoint": "https://api.openai.com/v1/chat/completions",
  "model": "gpt-4o-mini",
  "fallbackModels": ["gpt-4o", "gpt-3.5-turbo"],
  "mergeInstructions": "You are a neutral synthesis engine..."
}
```

---

## 🔍 Key Functions

### renderer.js

| Function | Purpose |
|----------|---------|
| `sendToAll()` | Send message to all enabled slots |
| `sendMessage(slot, text)` | Send to single slot with retry logic |
| `getLatestAssistantReply(slot)` | Scrape last assistant message from WebView |
| `collectLatestRepliesFromEnabledSlots()` | Collect from all enabled slots |
| `runMerge(isClarification, text, summary)` | Run merge or clarification |
| `startMergeShimmer()` | Start shimmer effect on slot indicators |
| `stopMergeShimmer()` | Stop shimmer effect |

### merge-api-client.js

| Function | Purpose |
|----------|---------|
| `merge(responses, isClarification, text, summary)` | Main merge entry point |
| `callOpenAiWithFallbacks(config, prompt)` | OpenAI-compatible with retry |
| `callClaude(config, prompt)` | Claude-specific API call |
| `callGemini(config, prompt)` | Gemini-specific API call |
| `buildPrompt(config, responses)` | Build merge prompt |
| `appendMetadata(result, provider)` | Add metadata footer |

### side-panel-controls.js

| Function | Purpose |
|----------|---------|
| `toggleSidePanel()` | Toggle panel open/closed |
| Resize handlers | Drag to resize panel (380-600px) |
| State restoration | Load saved state from localStorage |

---

## 🐛 Common Issues & Fixes

### 1. Run Merge Button Not Working

**Symptoms:** Click does nothing, no error in console.

**Causes:**
- API key not entered
- Merge API client not loaded
- Event listener not attached (script order issue)

**Fix:**
```javascript
// Check script order in index.html:
// 1. marked.js
// 2. merge-api-client.js
// 3. side-panel-controls.js
// 4. renderer.js (MUST be last)
```

### 2. Perplexity Not Sending

**Symptoms:** Input fills but send button doesn't click.

**Fix:** Warm-up script is already implemented. Check service detection:
```javascript
const serviceId = detectServiceByUrl(currentUrl);
// Should return 'perplexity' for perplexity.ai
```

### 3. Merge Returns Empty Responses

**Symptoms:** "No responses to merge" error.

**Causes:**
- No messages sent to slots yet
- WebView scraping failed
- Wrong CSS selectors

**Fix:** Check `getLatestAssistantReply()` console logs for scraping errors.

### 4. Panel Doesn't Toggle

**Symptoms:** Click "Merge ▸" but panel doesn't open.

**Fix:** Check browser console for:
```javascript
console.log('[SidePanel] Toggled, collapsed:', isPanelCollapsed);
```

---

## 🧪 Testing Checklist

### Basic Functionality
- [ ] All 4 WebViews load correctly
- [ ] Service dropdown changes URL
- [ ] Send button sends to all enabled slots
- [ ] Status indicators update (✓/✗)
- [ ] Address bar toggle works

### Merge Feature
- [ ] Right panel opens/closes
- [ ] Panel resizes (drag handle)
- [ ] API key saves after reload
- [ ] Run Merge button triggers merge
- [ ] Result displays in markdown
- [ ] Clarification input appears
- [ ] Clarification maintains context

### Perplexity Fix
- [ ] Message sends on first try
- [ ] No duplicate messages
- [ ] Input field clears after send

---

## 📝 Coding Conventions

### Style
- **No semicolons** (consistent with existing code)
- **Single quotes** for strings
- **2-space indentation**
- **Trailing commas** in multi-line objects

### Patterns
- **Optional chaining:** `element?.addEventListener()`
- **Nullish coalescing:** `value || defaultValue`
- **Async/await:** No callbacks, use async/await
- **Console logging:** Use `[Module]` prefix: `console.log('[SidePanel] ...')`

### State Management
- **No global state** in renderer.js (use `window` for cross-module)
- **localStorage** for persistence
- **Event listeners** with optional chaining (`?.`)

---

## 🚀 Development Workflow

### Local Development
```bash
cd C:\chat-aggregator
npm start           # Run app
npm run dev         # Run with DevTools open
```

### Debugging
1. **DevTools:** `Ctrl+Shift+I` or `F12`
2. **Console logs:** Filter by `[SidePanel]`, `[MergeApiClient]`, etc.
3. **WebView inspection:** Each `<webview>` has separate DevTools

### Build (Future)
```bash
npm run build       # Build for current platform
npm run build:win   # Build for Windows
```

---

## 📚 Related Documentation

- [docs/MERGE_FINAL.md](docs/MERGE_FINAL.md) - Merge feature UI/UX spec
- [docs/RIGHT_SIDE_PANEL.md](docs/RIGHT_SIDE_PANEL.md) - Side panel implementation details
- [docs/MERGE_IMPLEMENTATION.md](docs/MERGE_IMPLEMENTATION.md) - Full merge architecture
- `docs/` - Original Android documentation

---

## 🔗 External Resources

- **Electron Docs:** https://www.electronjs.org/docs
- **WebView Tag:** https://www.electronjs.org/docs/latest/api/webview-tag
- **Marked.js:** https://marked.js.org/

---

## 📞 Quick Reference

### Send Message to All Slots
```javascript
sendToAll();  // Uses messageInput.value
```

### Run Merge
```javascript
runMerge(false, '', '');  // isClarification, text, previousSummary
```

### Run Clarification
```javascript
runMerge(true, 'Your question', mergeHistory);
```

### Toggle Panel Programmatically
```javascript
toggleSidePanel();  // From side-panel-controls.js
```

---

**Last Updated:** February 18, 2026  
**Maintained By:** AI Assistant
