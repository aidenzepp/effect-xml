# Agent instructions

Start with `docs/onboarding.md` when entering this repository. It records what Effect already provides for XML, the source map, and the decisions that are still open.

Use `.agents/skills/conventional-commits/SKILL.md` when committing and `.agents/skills/document-code/SKILL.md` when writing or reviewing code.

Use Effect error channels; built-in try/catch is prohibited by lint. Do not add function-decomposition, type-design, or require-doc-comment lint policies.

Run `bun run check`, `bun run build`, then `bun run test` before completing implementation. `bun run test` runs two runners: `bun test tools` for the lint-rule suites (plain `.mjs` files importing `bun:test`), then `vp test` (Vitest with `@effect/vitest`) for library tests. Library tests are `*.test.ts` under `src/` or `test/` and use `it.effect` for effectful cases. A pre-push hook (`.vite-hooks/pre-push`, installed by `bun install`) runs the same checks and blocks the push if any fail; fix the problems rather than bypassing it with `--no-verify` or `VP_GIT_HOOKS=0`.

## Learning more about Effect

Before writing Effect code, read `node_modules/effect/AGENTS.md` completely and follow its relevant links. For APIs not covered there, consult `node_modules/effect/src` matching the installed version.

Preserve the pinned dependency versions when applying upstream guidance.

Use `.agents/skills/effect-design/SKILL.md` for the native-capability review and this repository's local Effect rulings. Effect structure and style stay with the installed guide above. Effect ships `effect/encoding/Xml` and `Schema.toEncoderXml`; build on them and justify any parallel implementation with the verified gap it fills.

Use `.agents/skills/trace-effect/SKILL.md` when adding or changing public effectful operations or reviewing their observability. The library emits spans and logs; it never installs a tracer, logger, or exporter.

Use `.agents/skills/error-messages/SKILL.md` when adding or changing caller-facing errors, including decode failures that point at a position in the input.

## Library structure

Source lives in `src/`; `src/index.ts` is the single published entry point, built by `vp pack` into `dist/`. Use relative imports inside `src/` so the generated declarations resolve for consumers. Keep focused tests beside their implementation and cross-module or upstream-contract tests in `test/`. Name files and directories in kebab-case; `unicorn/filename-case` and `workspace/kebab-case-paths` (in `tools/lint/`) enforce it.

`effect` is a peer dependency and a pinned dev dependency. Do not add runtime dependencies without a stated reason.

## Schema intent

Data models shape the rest of the library. Before changing a public schema or codec shape, establish the expected meaning and compatibility preferences from the user's instructions and current project context. If those expectations are unclear, check with the user before making consequential assumptions. Do not ask again when the relevant expectation is already settled.

Do not introduce nullable fields, legacy repair paths, transitional models, or compatibility layers merely because earlier development iterations used a different shape. Nullability must represent an actual optional value; backwards compatibility must serve an established requirement.

## Coordination

This repository coordinates through Vivi (`.vivi/`, machine-local and never committed). Load the `vivi` skill, run `vivi boot --project <root>` first, and use the `vivi` CLI only; never edit `.vivi/` files directly.
