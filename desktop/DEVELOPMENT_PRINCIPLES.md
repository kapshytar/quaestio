# Development Principles

This desktop repo follows a layered source-of-truth model.

1. Verity architecture first
- Align with the shared Verity product model and cross-repo behavior.
- Keep project-level architecture consistent with the wider Verity workspace.

2. Desktop truth second
- Desktop should keep one shared truth for the desktop client across Windows and macOS.
- Reuse shared contracts, shared JS, shared assets, and shared product rules when they fit cleanly.
- Prefer one desktop implementation direction over platform drift inside the desktop repo.

3. Platform-specific where necessary
- Desktop may implement its own native solutions when the platform runtime is materially different from mobile.
- Matching architecture matters more than forcing identical code where the execution model differs.

Working rule:

`Verity architecture first -> shared desktop truth where possible -> platform-specific where necessary`
