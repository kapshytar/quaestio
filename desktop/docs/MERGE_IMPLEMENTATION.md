# Merge Feature Implementation Summary

**Date:** February 18, 2026  
**Ported from:** Android Build 119 (Gunshi)  
**Target:** Windows Electron App (C:\chat-aggregator)

---

## What Was Implemented

### 1. Side Panel UI (Option B)
- **Collapsible side panel** (420px wide, resizable) for Merge functionality
- **Toggle button** in bottom toolbar ("Merge ▸/◂")
- **Close button** in panel header
- **Drag-to-resize** handle between main content and panel

### 2. Provider Configuration
- **8 LLM Providers** supported (same as Android):
  - ChatGPT API (OpenAI)
  - Claude API (Anthropic)
  - Gemini API (Google)
  - Perplexity API
  - DeepSeek API
  - OpenRouter
  - Hugging Face
  - Custom OpenAI-Compatible

- **Per-provider settings**:
  - API Key (password field)
  - Endpoint (editable)
  - Model (editable)
  - Fallback Models (comma-separated, shown only for relevant providers)

### 3. Merge Instructions
- **Collapsible section** with custom instructions textarea
- **Default instructions** for consensus/disagreement synthesis
- **Reset to Default** button

### 4. Merge Result Display
- **Markdown rendering** using marked.js CDN
- **Metadata footer** showing provider, model, fallback usage
- **Status indicator** (idle/running/error)

### 5. Clarification Flow
- **Follow-up question input** appears after successful merge
- **Cumulative history** maintained for context
- **Strips metadata footer** before accumulating history

### 6. Config Persistence
- **localStorage** for all merge settings
- **Auto-restore** on app restart
- **Per-provider** API keys and endpoints

---

## Perplexity Fixes (from Android Build 114)

### The Problem
Perplexity's React UI only renders the send button AFTER the first character is typed. Direct message injection would fail because the button didn't exist yet.

### The Solution: "Warm-up" Script
```javascript
if (serviceId === 'perplexity') {
  // Step 1: Insert a space to trigger React to render the send button
  fillInput(inputEl, ' ');
  
  // Step 2: Wait 100ms for React to render
  setTimeout(() => {
    // Step 3: Replace with real message
    fillInput(inputEl, message);
    
    // Step 4: Click send button after 400ms
    setTimeout(() => {
      const btn = findSendButton(inputEl);
      if (btn) btn.click();
      else pressEnter(inputEl);
    }, 400);
  }, 100);
}
```

### Additional Perplexity Optimizations
- **Article filter**: `!el.closest('article')` prevents interacting with historical messages
- **Cache clear**: (Android only) `webView.clearCache(true)` to avoid CORS/QUIC blocks
- **Prose selector**: Prefer content inside `[class*="prose"]` when scraping replies

---

## File Changes

### New Files
- `merge-api-client.js` - API client for 8 LLM providers
- `renderer.js` (updated) - Full rewrite with merge logic

### Modified Files
- `index.html` - Added side panel HTML, CSS, and marked.js script

### Backup Files
- `index.html.backup` - Original HTML before modifications

---

## Key Architecture Differences (Android vs Windows)

| Aspect | Android | Windows (Electron) |
|--------|---------|-------------------|
| **WebView** | Android WebView | Electron `<webview>` |
| **JS Injection** | `evaluateJavascript()` | `executeJavaScript()` |
| **HTTP Client** | `HttpURLConnection` | `fetch()` API |
| **Storage** | `SharedPreferences` | `localStorage` |
| **Markdown** | Markwon (Java) | marked.js (JS) |
| **Threading** | `thread {}` + `runOnUiThread` | `async/await` |
| **UI** | ViewPager2 + TabLayout | CSS Grid + Side Panel |

---

## Usage Flow

### 1. Initial Setup
1. Open app, click "Merge ▸" to open side panel
2. Select provider (e.g., "ChatGPT API")
3. Enter API key
4. (Optional) Customize endpoint/model
5. (Optional) Edit merge instructions

### 2. Send to All Services
1. Type message in bottom input
2. Press Enter or click "Send"
3. Message sent to all enabled slots (90ms stagger)
4. Status indicators show ✓/✗ per slot

### 3. Run Merge
1. Wait for all services to respond (or manually trigger)
2. Clear the message input (or leave empty)
3. Click "Run Merge" button (turns teal when active)
4. Shimmer effect on enabled slot indicators
5. Merge result appears in markdown format

### 4. Clarification
1. After merge completes, clarification input appears
2. Type follow-up question
3. Press Enter or click "Send"
4. Response maintains context from previous merge

---

## API Endpoints (Defaults)

| Provider | Endpoint | Default Model |
|----------|----------|---------------|
| ChatGPT | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| Claude | `https://api.anthropic.com/v1/messages` | `claude-3-5-sonnet-latest` |
| Gemini | `https://generativelanguage.googleapis.com/v1beta` | `gemini-2.0-flash` |
| Perplexity | `https://api.perplexity.ai/chat/completions` | `sonar` |
| DeepSeek | `https://api.deepseek.com/v1/chat/completions` | `deepseek-chat` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `openai/gpt-4o-mini` |
| Hugging Face | `https://router.huggingface.co/v1/chat/completions` | (user-specified) |
| Custom | (user-specified) | (user-specified) |

---

## Testing Checklist

- [ ] Side panel opens/closes correctly
- [ ] Provider dropdown changes UI (fallback models visibility)
- [ ] API key persists after restart
- [ ] Send message to all 4 slots works
- [ ] Perplexity warm-up fix triggers (space → wait → message → send)
- [ ] Merge collects responses from enabled slots only
- [ ] Markdown renders correctly
- [ ] Metadata footer shows correct provider/model
- [ ] Clarification input appears after merge
- [ ] Clarification maintains context
- [ ] Resizing side panel works smoothly
- [ ] Config collapses/expands correctly

---

## Known Limitations

1. **No model fallback retry** - Implemented but not extensively tested
2. **No cookie import for merge** - Merge uses API keys only
3. **No subscription check** - Unlike Android, no billing integration
4. **No shimmer drawable** - Uses CSS animation instead of Android's `LinearGradient`

---

## Next Steps (Optional Enhancements)

1. **Add local model support** (Ollama, LM Studio)
2. **Export merge results** to clipboard/file
3. **Merge history** - Save previous merges for reference
4. **Custom merge templates** - Save/load instruction presets
5. **Batch clarification** - Send same follow-up to all services
6. **Response comparison table** - Side-by-side view before merge

---

## Credits

- **Original Android App**: Gunshi (chat-aggregator-android)
- **Perplexity Fix**: Build 114 "Warm-up" technique
- **Merge Architecture**: Build 109-119 cumulative design
- **Ported to Windows**: February 2026
