# Instructions for AI Agents (Gunshi Project)

## Core Logic & "Secrets"

### 1. Message Injection (MessageInjector.kt)
- **Problem**: Perplexity and DeepSeek use complex React/Next.js states. Simply setting `textarea.value` often results in the UI thinking the input is empty, keeping the "Send" button disabled.
- **Solution**: Use `document.execCommand('insertText', false, value)`. This is the only reliable way to trigger internal React listeners.
- **Fallbacks**: Always dispatch `InputEvent`, `input`, and `change` events after filling.

### 2. Sending Strategies
- **Perplexity**: Often requires `Ctrl+Enter` or a click on a button with classes like `.bg-super` or `.bg-sideBar`.
- **Grok**: Avoid immediate retries as it can produce duplicate messages.
- **Retry Logic**: If `sent: false` is returned (meaning text remained in the input), wait 800ms-2000ms and try again.

### 3. Scraping Replies (ChatFragment.kt)
- **Selectors**: Use `[data-message-author-role="assistant"]`, `[class*="answer"]`, etc.
- **Perplexity Special**: The actual answer is usually inside `div[class*="prose"]`. This selector is prioritized for Perplexity.
- **Sorting**: Always sort candidates by `rect.bottom` descending to pick the most recent (bottom-most) message.

## Development Workflow
**CRITICAL**: The user prefers this sequence for any code change:
1. **Commit**: Use clear, descriptive messages (why, not just what).
2. **Push**: `git push origin main`.
3. **Wait for CI**: GitHub Actions build `assembleRelease`.
4. **Download & Install**: Download the APK artifact from the successful run and install via `adb install -r`.

## Project Structure
- `MainActivity.kt`: The conductor. Manages ViewPager2 and Bottom Panel.
- `ChatFragment.kt`: WebView host. Contains JS scraping logic.
- `MergeFragment.kt`: The synthesis UI. Uses `MergeApiClient` for LLM calls.
- `ServiceConfig.kt`: The source of truth for service URLs and CSS selectors.
- `MessageInjector.kt`: Generator for all JS injection scripts.

## Common Pitfalls
- **WebView User Agent**: We strip `; wv` to bypass Google Login blocks. Do not spoof the UA entirely to avoid Cloudflare loops.
- **Fragment Restoration**: After process death, `FragmentStateAdapter` might return null for `getFragment(index)`. Use `supportFragmentManager.findFragmentByTag("f<index>")` as a fallback.
- **Incognito Mode**: Does not clear cookies; it appends `?temporary-chat=true` for ChatGPT.
