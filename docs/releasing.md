# Releasing

Releases run from [`.github/workflows/release.yml`](../.github/workflows/release.yml) on every push to `main`. Nobody publishes from a laptop, and no npm token exists.

## How a release happens

1. A pull request that changes the published package adds a changeset (`bunx changeset`, or `bunx changeset add --empty` for a change that releases nothing). [`AGENTS.md`](../AGENTS.md) states when one is required.
2. The pull request merges to `main`. The release workflow runs `bun run check`, `bun run build` and `bun run test`, then opens or updates a pull request titled `chore(release): version packages`. That pull request bumps the version, writes `CHANGELOG.md` and deletes the consumed changesets.
3. The version pull request merges to `main`. The release workflow runs the same checks, then `bunx changeset publish` publishes every version that is not yet on npm, with provenance, through npm trusted publishing. It also pushes the git tag and creates the GitHub release.

A push with no pending changesets and no unpublished version does nothing after the checks.

## GitHub settings

Apply these once on `aidenzepp/effect-xml`.

1. **Ruleset on `main`** (Settings > Rules > Rulesets, target the default branch):
   1. Require a pull request before merging.
   2. Require status checks to pass: `checks` and `changeset` (the job names in [`ci.yml`](../.github/workflows/ci.yml)).
   3. Add Repository admin to the bypass list.
2. **GitHub App** (recommended). A pull request opened with the default `GITHUB_TOKEN` starts no workflows, so the version pull request would show no checks and need an admin bypass to merge. An App token avoids that.
   1. Create a GitHub App (Settings > Developer settings > GitHub Apps > New GitHub App) with no webhook and these repository permissions: Contents: Read and write; Pull requests: Read and write.
   2. Install it on `aidenzepp/effect-xml` only.
   3. Generate a private key.
   4. In the repository, set the variable `RELEASE_APP_CLIENT_ID` to the App's Client ID (Settings > Secrets and variables > Actions > Variables).
   5. Set the secret `RELEASE_APP_PRIVATE_KEY` to the full contents of the private key file.
3. **Without the App**, enable Settings > Actions > General > Workflow permissions > "Allow GitHub Actions to create and approve pull requests". The version pull request then has no checks and an admin merges it with the bypass. Nothing unchecked ships: the release workflow runs check, build and test before it publishes.

## npm settings

The package owner applies these on npmjs.com.

1. Open `@aidenzepp/effect-xml` > Settings > Trusted publisher, and choose GitHub Actions.
2. Enter:
   - Organization or user: `aidenzepp`
   - Repository: `effect-xml`
   - Workflow filename: `release.yml`
   - Environment name: leave empty
3. Allow `npm publish` for this trusted publisher. Changesets publishes with `npm publish`, not `npm stage publish`.
4. Optional, after the first trusted publish succeeds: Settings > Publishing access > "Require two-factor authentication and disallow tokens". Trusted publishing keeps working.
