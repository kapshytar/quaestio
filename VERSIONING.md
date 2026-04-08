# Versioning

Parent / entry point:
- Start from [../VERITY_MAP.md](../VERITY_MAP.md)
- Cross-repo parent rule: [../docs/domains/CLIENT_VERSIONING_AND_RELEASE_RULES.md](../docs/domains/CLIENT_VERSIONING_AND_RELEASE_RULES.md)
- This file is the repo-local child doc for `chat-aggregator-mobile` version bumps and validation commands.

This file is the canonical versioning contract for `chat-aggregator-mobile`.

Related files:
- [CURRENT_STATE.md](./CURRENT_STATE.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [scripts/bump-version.sh](./scripts/bump-version.sh)
- [scripts/check-versioning.sh](./scripts/check-versioning.sh)
- [scripts/mobile-doctor.sh](./scripts/mobile-doctor.sh)

## Current Line

- The repo currently ships on the `2.x.y` line.
- `x` is the push/release milestone.
- `y` is the ordinary code-change patch number.
- Android `VERSION_CODE` and iOS `CURRENT_PROJECT_VERSION` move together as the monotonic build number.

## Rules

- Ordinary code changes increment `y`.
- Git push / release milestones increment `x`.
- After incrementing `x`, `y` resets to `0`.
- Every meaningful mobile milestone must be recorded in [CHANGELOG.md](./CHANGELOG.md).
- `project.yml` and `android/version.properties` must stay in sync.

## Canonical Commands

- Patch bump:
  - `./scripts/bump-version.sh patch`
- Push/release bump:
  - `./scripts/bump-version.sh push`
- Validation:
  - `./scripts/check-versioning.sh`
- Combined environment/version inspection:
  - `./scripts/mobile-doctor.sh`

## Expected State After A Bump

- `project.yml`
  - `MARKETING_VERSION` matches the new semver
  - `CURRENT_PROJECT_VERSION` increments by `1`
- `android/version.properties`
  - `VERSION_BASE` matches the semver major/minor pair
  - `VERSION_PATCH` matches the semver patch
  - `VERSION_CODE` increments by `1`
- [CHANGELOG.md](./CHANGELOG.md)
  - has a top entry for the new version
