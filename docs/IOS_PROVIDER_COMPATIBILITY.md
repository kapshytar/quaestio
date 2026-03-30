# iOS Provider Compatibility

## Authority

- This file is a working compatibility matrix for the iOS client.
- It is narrower than `CURRENT_STATE.md`: use it to track what is known about provider behavior on iPhone.
- If provider behavior changes after real-device testing, update this file.

## Ratings

- `works`: validated on current iPhone build
- `partial`: shell/path exists but not fully proven across real flows
- `blocked`: known provider or platform limitation
- `unknown`: not yet validated

## Current Matrix

| Provider | Load in WKWebView | Direct Web Login | Google/Social Login In Embedded WebView | Send From Shared Composer | Scrape Latest Reply |
| --- | --- | --- | --- | --- | --- |
| ChatGPT | works | unknown | blocked | partial | unknown |
| Claude | works | unknown | unknown | partial | unknown |
| Gemini | works | unknown | unknown | partial | unknown |
| Grok | works | unknown | unknown | partial | unknown |
| DeepSeek | unknown | unknown | unknown | unknown | unknown |
| Perplexity | unknown | unknown | unknown | unknown | unknown |

## Known Findings

### ChatGPT

- The page loads correctly inside `WKWebView`.
- `Sign in with Google` currently fails on iPhone with:
  - `Access blocked`
  - `Error 403: disallowed_useragent`
- Treat this as a provider-policy limitation of embedded auth, not a bug in our selector or UI shell.

## Platform Rules

- Do not assume that social/OAuth login working in Android WebView or desktop Electron implies it will work in iOS `WKWebView`.
- For iOS, provider compatibility must be validated on a real device, not only in the simulator.
- Preserve existing login state during updates:
  - do not uninstall the app
  - do not change the bundle identifier
  - do not clear `WKWebsiteDataStore.default()`

## Next Validation Order

1. ChatGPT:
   - direct non-Google login path
   - shared-composer send
   - latest-reply scrape
2. Claude:
   - direct login
   - send
   - scrape
3. Gemini
4. Grok
5. DeepSeek
6. Perplexity
