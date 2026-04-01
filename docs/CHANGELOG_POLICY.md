# Changelog Policy

Every logic/config/runtime behavior change must update at least one changelog artifact in the same PR:
- `docs/CHANGELOG_CURRENT.md` for active stream notes, or
- a dated changelog entry if a release process is used.

Minimum entry content:
- What changed
- Why it changed
- Validation performed (tests/e2e/manual)
