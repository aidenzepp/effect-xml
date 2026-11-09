# Changesets

A changeset is a small Markdown file in this folder that names the package, the version bump, and a one-line summary for the changelog. Create one with `bunx changeset` in the same pull request as the change it describes.

effect-xml is pre-1.0, so bumps follow this policy:

- A breaking change is a `minor` bump.
- A `feat` or `fix` is a `patch` bump.
- `test`, `docs`, `bench`, `spike`, and tooling-only changes need no changeset and no release.

The rules live in `AGENTS.md`.
