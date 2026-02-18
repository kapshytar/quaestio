# Gemini CLI Project Context

This file serves as the foundational mandate for Gemini CLI in the `chat-aggregator` project.

## Project Overview
- **Goal:** Electron-based multi-chat aggregator (ChatGPT, Claude, Gemini, Grok, etc.).
- **Architecture:** 4-slot grid with a right-side "Merge" panel.
- **Key Features:** Unified message sending, response merging via LLM APIs, cookie-based session sharing.

## Current Documentation Structure
- `README.md`: Main entry point (currently outdated, needs sync with `TECHNICAL_DOCS.md`).
- `PROJECT_STATUS.md`: Live status and next priorities.
- `TECHNICAL_DOCS.md`: Comprehensive architecture overview.
- `QUICKSTART.md`: Fast setup guide.
- `docs/`: (Proposed) Storage for implementation details and guides.

## Engineering Mandates
- **Language:** Code is primarily English; user-facing docs (README) are currently Russian (needs update/translation for consistency if requested).
- **Style:** No semicolons, single quotes, 2-space indentation (as per `TECHNICAL_DOCS.md`).
- **Safety:** Preserve session partitions (`persist:shared`) and Chrome-like User-Agent.

## Active Tasks
- [ ] Initialize/Consolidate scattered documentation.
- [ ] Update README.md to reflect current 4-slot + Merge architecture.
- [ ] Implement missing diagnostic tools or health panel (as per PROJECT_STATUS.md).
