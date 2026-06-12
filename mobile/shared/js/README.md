# Shared JS

This directory will hold platform-agnostic WebView scripts that both Android and iOS can reuse.

Candidate first scripts:

- `sendMessage.js`
- `attachFile.js`
- `scrapeReply.js`
- provider-specific DOM helpers if they stay platform-neutral

The target is one JS behavior surface with thin native wrappers per platform.
