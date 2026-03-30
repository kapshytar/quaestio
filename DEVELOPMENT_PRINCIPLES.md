# Development Principles

This repo follows a layered source-of-truth model.

1. Verity architecture first
- Product architecture is defined at the `Verity` workspace level.
- Mobile should align with the higher-level Verity model rather than inventing a separate product architecture.

2. Mobile truth second
- Inside mobile, we aim for one shared mobile truth across Android and iOS where possible.
- Shared contracts, shared JS, and shared assets should be preferred before creating platform-specific forks.

3. Android first during migration
- Android-first is a temporary migration rule only because the mobile client started there first.
- While Android is still the more mature mobile implementation, inspect Android first before inventing new mobile behavior.
- Treat Android as the first migration source until the shared mobile layer becomes the primary source of truth.

4. Shared first after migration
- The target state is not Android-first forever.
- The target state is shared-first: shared mobile logic becomes the primary source of truth, and both Android and iOS inherit from it.
- Once a behavior is cleanly established in shared code or shared assets, new work should start there first instead of re-deriving it from Android.

5. Native only where necessary
- Write platform-specific code only for parts that cannot be shared cleanly.
- Android and iOS wrappers should adapt platform lifecycle, system APIs, and native constraints around shared mobile logic instead of replacing it.

6. Versioning and changelog are mandatory
- Meaningful mobile milestones must be recorded in this repo's `CHANGELOG.md`.
- Version bump decisions must follow the global Verity `1.x.y` rule rather than being improvised per session.
- Do not treat release/version changes as optional cleanup after the fact.

Working rule:

`Verity architecture first -> Android first during migration -> shared first as the target state -> native only where necessary`
