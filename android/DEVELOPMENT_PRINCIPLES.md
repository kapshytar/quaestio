# Development Principles

These rules are the default implementation order for this project.

1. Android first
- Before inventing a new flow, UI pattern, asset, or behavior, inspect the Android implementation first.
- Treat Android as the first migration source unless there is a strong documented reason not to.

2. Shared where possible
- If an Android solution can be moved into shared code, shared contracts, shared JS, or shared assets, do that before creating a new platform-specific version.
- Prefer one source of truth over parallel implementations.

3. Native only where necessary
- Write platform-specific code only for the parts that cannot be shared cleanly.
- Native wrappers should adapt lifecycle, system APIs, and platform constraints around shared logic rather than replacing it.

Working rule:

`Android first -> shared where possible -> native only where necessary`
