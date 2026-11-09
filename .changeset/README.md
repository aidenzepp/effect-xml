# Changesets

A changeset is a small Markdown file in this folder that names the package, the version bump, and a one-line summary for the changelog. Add it in the same pull request as the change it describes:

```sh
bunx changeset add --patch @aidenzepp/effect-xml -m "<one-line summary>"
```

Use `--minor` for a breaking change, or `bunx changeset add --empty` for a change that releases nothing. Humans may run bare `bunx changeset` for the interactive prompt; agents never do.

effect-xml is pre-1.0, so bumps follow this policy:

- A breaking change is a `minor` bump.
- A `feat` or `fix` is a `patch` bump.
- `test`, `docs`, `bench`, `spike`, and tooling-only changes need no changeset and no release.

The rules live in `AGENTS.md`.
