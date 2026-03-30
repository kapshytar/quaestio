# IDE Connection Troubleshooting Progress (Antigravity)

## Current Status
- **Issue**: Gemini CLI reports `Disconnected: Failed to connect to IDE companion extension in Antigravity.`
- **IDE Server**: Active and listening on `127.0.0.1:56619`.
- **Process**: Process ID `18084` (Antigravity) is managing the listener.
- **Authentication**: The server enforces authentication and returns `401 Unauthorized` for anonymous requests.

## Findings so far
1. **Companion Extension**:
   - Location: `C:\Users\kvita\.antigravity\extensions\google.gemini-cli-vscode-ide-companion-0.20.0-universal`
   - Verified activation in `exthost.log`.
2. **Gemini CLI**:
   - Location: `C:\Users\kvita\AppData\Roaming\npm\node_modules\@google\gemini-cli`
   - Entry point: `dist\index.js`.
3. **Authentication Attempts**:
   - Tested Header: `Authorization: token <token>` -> `401`
   - Tested Header: `X-Gemini-IDE-Auth-Token: <token>` -> `401`
   - Tested Header: `X-Auth-Token: <token>` -> `401`
   - Note: The token `786034ad-2520-4922-821b-920d6c71fb8d` was identified during the session (need to re-verify source if this persistent file is used later).

## Technical Details
- **Port**: `56619` (static for Antigravity's Gemini companion).
- **Extension Log**: `C:\Users\kvita\AppData\Roaming\Antigravity\logs\20260221T011457\window1\exthost\exthost.log` shows the extension is active.

## Next Steps for Next Session
1. **Reverse Engineer Auth Header**: Search the extension's `dist/extension.cjs` for the exact string used to validate the incoming request (search for `.headers`, `.get(`, `.header(`).
2. **Verify Token Storage**: Locating where the CLI stores or generates the `IDE_AUTH_TOKEN`. Check `C:\Users\kvita\.gemini\config.json` more thoroughly or environment variables.
3. **Check for "No Sandbox"**: The user noticed `No Sandbox` in the terminal; verify if this affects the companion's ability to communicate over the local socket.
