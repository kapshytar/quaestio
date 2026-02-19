# Repository Guidelines

## Project Structure & Module Organization
Gunshi is a lightweight Electron app with a flat source layout.
- `main.js`: Electron main process, window/session lifecycle, app menu, global shortcuts.
- `renderer.js`: UI behavior, slot orchestration, merge/search interactions.
- `index.html`: single-page shell (webview grid + merge sidebar).
- `merge-api-client.js`: provider adapters and merge request routing.
- `preload.js`: secure renderer bridge.
- `side-panel-controls.js`: merge panel form/state logic.
- `docs/`: feature and operational documentation.
- `icon.png`, `icon.ico`: app/build assets.

Keep new runtime code near the process where it executes (`main` vs `renderer`) and avoid adding deep folders unless scope clearly grows.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm start`: run app locally.
- `npm run dev`: run with Electron inspector enabled.
- `npm run build`: package for current platform defaults.
- `npm run build:win`: Windows release build (NSIS installer).
- `npm run build:win:fast`: quicker Windows build for local verification.
- `npm run build:mac` / `npm run build:linux`: platform packages.
- `start.bat` / `start.sh`: convenience launchers.

## Coding Style & Naming Conventions
- JavaScript: 2-space indentation, semicolon-terminated statements, single quotes preferred.
- Use `camelCase` for variables/functions, `UPPER_SNAKE_CASE` for constants, and descriptive event/channel names (e.g., `app-find`).
- Keep functions focused; move provider-specific branching into `merge-api-client.js` instead of UI handlers.
- Avoid non-ASCII in source unless already required by file content.

## Testing Guidelines
There is no formal automated test suite yet. Validate changes with targeted manual checks:
- startup and slot loading,
- merge flow (including provider fallback inputs),
- scoped `Ctrl/Cmd+F` behavior,
- session persistence across restarts.

When adding non-trivial logic, include a reproducible test checklist in the PR description.

## Commit & Pull Request Guidelines
Recent history favors short imperative subjects (e.g., `Optimize startup migration and debounce scoped search`).
- Commit format: `<Verb> <area> <outcome>`.
- Keep commits focused; avoid bundling unrelated refactors.
- PRs should include: summary, risk notes, manual test steps, and screenshots/GIFs for UI changes.
- Link related issues/tasks when available.

## Security & Configuration Tips
- Never commit cookies, tokens, or provider API keys.
- Treat merge provider credentials as provider-scoped settings; do not reintroduce shared-key behavior.
- Review session migration code in `main.js` carefully before changing persistence logic.
