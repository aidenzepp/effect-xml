# Spikes

Throwaway R&D code that runs against real QTI documents. It exists to settle the open design decisions in `docs/onboarding.md` (mixed content, namespaces, round-trip fidelity, tree vs. streaming decode, how attributes and elements are declared) with evidence before the library API is built.

Status: the decisions are recorded in `docs/rd/decisions.md` and `docs/onboarding.md`; the spikes are retained as evidence and are not imported by `src/`.

Rules:

- Nothing under `spikes/` is library code. `src/` and `test/` never import from it, and it is not part of the `vp pack` entry.
- A spike is deleted or archived once its decision is recorded in `docs/onboarding.md` or a Shipyard artifact. The fixtures stay.
- Spikes may be ugly. They may not add runtime dependencies to `package.json`.

## Layout

```text
spikes/
  README.md                  this file
  fixtures/qti/              QTI 3 fixtures authored here, plus one Apache-2.0 PCI example; SOURCES.md records each file's origin, license, and what it exercises
  smoke/smoke.test.ts        proves the harness runs: one fixture through effect/encoding/Xml
  <spike-name>/              one directory per spike
    *.test.ts                the experiment, written as bun tests
    RESULT.md                what was tried, the criteria, the evidence, the recommendation
```

Name directories and files in kebab-case. Each spike reads fixtures by path relative to its own file (`new URL("../fixtures/qti/<file>.xml", import.meta.url)`), so it runs from any working directory.

## Running a spike

Spikes run under Bun's test runner, not Vitest:

```sh
bun test spikes/smoke          # the smoke spike
bun test spikes/<spike-name>   # any spike
bun test spikes                # everything under spikes/
```

Why `bun test` and not `vp test`: the Vitest `include` in `vite.config.ts` is pinned to `src/**` and `test/**`, and `vp test <filter>` only narrows that set, so a path under `spikes/` cannot be selected without widening the library's test include. Bun resolves `effect/*` the same way, so a spike that uses `Effect.runPromise` inside a plain `bun:test` case needs no extra setup. `@effect/vitest` (`it.effect`) is therefore not available in spikes; use `Effect.runPromise` as `smoke/smoke.test.ts` does.

## What the repo gates do with this directory

`bun run check`, `bun run build`, and `bun run test` all pass with `spikes/` present, and a broken or half-written spike cannot break them:

| Gate                         | Treatment of `spikes/`                                                                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp fmt --check`             | **Applied** to `.ts` and `.md` files under `spikes/` (fixtures are `.xml` and untouched). Run `bun x vp fmt spikes` before committing.                                                                                                                                                        |
| `vp lint` (incl. type-aware) | **Excluded** via `lint.ignorePatterns` in `vite.config.ts`. `spikes/` is not in `tsconfig.json`'s `include`, so the type-aware rules would otherwise fail on `bun:test` and `node:*` imports; excluding the throwaway tree is simpler than teaching the library's lint policy to tolerate it. |
| `tsc` type check             | **Excluded** (not in `tsconfig.json` `include`). Type errors in a spike surface when `bun test` runs it, or in the editor.                                                                                                                                                                    |
| `vp test` / `bun run test`   | **Excluded.** `bun run test` runs `bun test tools` and the Vitest include; neither matches `spikes/`.                                                                                                                                                                                         |
| `vp pack` / `bun run build`  | **Excluded.** The pack entry is `src/index.ts` only.                                                                                                                                                                                                                                          |

Spike code is still expected to follow the repo's Effect rules where it is cheap (error channels, no built-in `try`/`catch`); the lint exclusion removes the gate, not the guidance.
