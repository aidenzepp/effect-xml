# Slices: performance phase 3 (guardrail track and step-1 codec track)

- plan: `docs/goals/performance/phase-3.md` (problem, guardrails, metric set, step-2 rule, and the settled [Design](phase-3.md#design-settled-2026-11-06) are there and quoted, not re-asked). Phase authority: `work/perf3-mind-brief.md`, Step 1 and Guardrails. Architecture: head-cto ruling on task `8aa826d9` (F1-F9, F7.1-F7.7), adopted by the Mind as written, then revised by head-cto's merit ruling on task `16f993dd` (M1-M7), adopted by the Mind.
- slice file: `docs/goals/performance/phase-3.slices.md`
- Mind scope: task `83ce75cc` cut 1 (the guardrail track); task `6c66e48a` revised cut 1 after delivery audit `ea39772d` and cut 2 (the step-1 codec track); task `d390991c` (perf3-plan-rev2) folded in the merit ruling `16f993dd`, codec delivery audit `5d57e2b4`, guardrail re-audit `e2d82410`, and the structural-codec addendum (mail `a1c78477`). See [Revision rev2](#revision-rev2-task-d390991c) for each slice's state.
- size target: 5-15 minutes per Hand.
- cut 1 was cut against `a7a93d5`; cut 2 and the cut-1 revision against `bd60a0e` (`effect@4.1.2`, Bun 1.4.2, Node 26.13.0). Every line number below was read on the named checkout. A slice later in a file's chain re-reads the file first.
- state at 2026-11-08: phase 3 stopped by owner ruling (`phase-3.md`, "The stop rule"); no further slice is cut, and step 2 was not cut or built. Final numbers: `docs/rd/performance.md`, "Phase 3: stop and final status". The oracle is deleted in `e35151d`; the differential suites compare the fast and standard paths; derivation outputs are pinned by 260 digests (`a620c4d`, which took `derivations.test.ts` from 14 tests, 1 plus 13 per subject, to 2, with the 260 keys, 13 subjects by 20 derivations, preserving the coverage; the plan's ruling O2, revised by Mind mail `ac13cc7f` from a committed file snapshot to inline digests); plan [`docs/rd/perf3-oracle-removal.md`](../../rd/perf3-oracle-removal.md).
- not cut here: step 2 (cut only if the rule in `phase-3.md` fires). The bench JIT selector (task `280175c8`, landed `3184848`, `964fbf2`) and the phase-3 baseline (task `048d51ee`, gap D6) are dispatched outside this file.
- state at `aa39c12`: every guardrail and codec slice has landed; see [Landed receipts](#landed-receipts-at-aa39c12), which supersedes the counts and wave lists below (they are the counts at cut time). `perf3-witness` and `perf3-reprofile` were replaced by `perf3-measure` (task `cf5f437e`) under the owner directive to measure under load (`work/owner-directive-perf3-loaded.md`), and the baseline task `048d51ee` was superseded. Swap gate, audits, and residuals: [Swap gate status](#swap-gate-status-at-aa39c12), [Audits](#audits-step-1-close), [Residuals](#residuals-at-aa39c12).
- slice count: 9 guardrail (`perf3-oracle` and `perf3-diff-harness` landed; `perf3-diff-corpus`, `perf3-diff-bank`, `perf3-diff-generated`, `perf3-diff-fuzz`, `perf3-derivations`, `perf3-diff-wrapped`, `perf3-diff-noeval` to go) and, after rev2, 15 codec: 5 landed (`perf3-decisions`, `perf3-revert-jit`, `perf3-slot-predicate`, `perf3-structural-codec`, `perf3-writer-events`) and 10 to go (`perf3-builder`, `perf3-fast-decode`, `perf3-fast-encode`, the three `perf3-wire-*`, `perf3-acceptance`, `perf3-checked-wrappers`, `perf3-witness`, `perf3-reprofile`). `perf3-jit-helper` is retired and `perf3-writer-text` dropped.
- waves and widths: see "Waves" after cut 2. A slice dispatches once its `deps` are accepted and its `write_scope` overlaps no active slice.
- Mind gates: every guardrail slice is integrable alone. The guardrail suites `perf3-diff-corpus`, `perf3-diff-bank`, `perf3-diff-generated`, `perf3-diff-fuzz`, `perf3-derivations`, and `perf3-diff-wrapped` are accepted before the first wiring slice (`perf3-wire-*`) dispatches. Codec slices before the wiring only add internal modules no surface calls, so they may run beside the guardrail track (planner proposal, gap Q2; the cut-1 rule was "all guardrail slices before the first step-1 `src/` slice"). The swap is accepted only after `perf3-acceptance`, `perf3-diff-noeval`, and `perf3-witness` pass.

## Revision rev2 (task `d390991c`)

Revised at `9eccea0` (slice states refreshed at `644bdf3`) against head-cto's merit ruling `16f993dd` (M1-M7 with edit lists E1-E11 and S1-S11), codec delivery audit `5d57e2b4`, guardrail re-audit `e2d82410` (V1-V4), and the structural-codec addendum (mail `a1c78477`). The design changes are in `phase-3.md` "Design" and `docs/rd/decisions.md` "Phase-3 policy revised". "Needs re-audit" marks a slice whose brief changed in substance in this revision; "admitted" marks one the audits admitted and this revision left unchanged or changed only by recording. The [ledger](#revision-rev2-ledger) at the end maps every finding to where it closed.

| Slice                      | State at `9eccea0`                                                  | Changed in rev2                                                               |
| -------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `perf3-oracle`             | landed `bd60a0e`                                                    | no                                                                            |
| `perf3-diff-harness`       | landed `a3e5d8d` (task `8d8a0afe`, dispatched with V1, M6, V3)      | amendments recorded                                                           |
| `perf3-diff-corpus`        | landed `644bdf3`                                                    | no                                                                            |
| `perf3-diff-bank`          | landed `827b7cf`                                                    | no                                                                            |
| `perf3-diff-generated`     | **needs re-audit**                                                  | V1 encode inputs, V4 wording, P1t reworded (M5), addendum corruption          |
| `perf3-diff-fuzz`          | admitted                                                            | no                                                                            |
| `perf3-derivations`        | admitted                                                            | no                                                                            |
| `perf3-diff-wrapped`       | landed `025a463`                                                    | no                                                                            |
| `perf3-diff-noeval`        | **needs re-audit**                                                  | re-scoped by M3 (default against the global JIT import); V2 recorded residual |
| `perf3-jit-helper`         | retired: landed `aa8309a`, reverted `ea23128`                       | retired (S1)                                                                  |
| `perf3-revert-jit`         | landed `ea23128` (task `f7f7a062`)                                  | recorded                                                                      |
| `perf3-slot-predicate`     | landed `7421796` (task `06af9c65`, dispatched with four amendments) | amendments recorded                                                           |
| `perf3-decisions`          | landed `30cdb29`; superseded in part by rev2's decisions section    | recorded                                                                      |
| `perf3-structural-codec`   | landed `6cf5d58` (task `096852e8`)                                  | follow-ups recorded                                                           |
| `perf3-writer-events`      | landed `9eccea0` (task `c8ec11a2`, dispatched with the M5 note)     | recorded                                                                      |
| `perf3-builder`            | **needs re-audit**                                                  | M1 rule sources, receipt C7 refusals (audit P1), M6 key order                 |
| `perf3-fast-decode`        | **needs re-audit**                                                  | no JIT, M2 outcome rule, M6, audit optional rows                              |
| `perf3-writer-text`        | dropped (M5)                                                        | dropped (S2)                                                                  |
| `perf3-fast-encode`        | **needs re-audit**                                                  | events only (M5), no JIT, M2, invalid-name rows, addendum guard               |
| `perf3-wire-decode-string` | **needs re-audit**                                                  | `xml.fallback`, fail-then-succeed row, consumer JSDoc (M2)                    |
| `perf3-wire-channels`      | **needs re-audit**                                                  | `xml.records.fallback.accepted`, fail-then-succeed row, JSDoc                 |
| `perf3-wire-encode`        | **needs re-audit**                                                  | `xml.fallback`, fail-then-succeed row, addendum row, JSDoc                    |
| `perf3-acceptance`         | **needs re-audit**                                                  | audit (a)-(e), M6, encode inputs through V1                                   |
| `perf3-checked-wrappers`   | **new, needs audit**                                                | M4                                                                            |
| `perf3-witness`            | **needs re-audit**                                                  | JitMode JSDoc correction removed (S8); depends on `perf3-checked-wrappers`    |
| `perf3-reprofile`          | admitted                                                            | no                                                                            |
| Standing rule R-proof      | in force                                                            | sabotage only in a private worktree under `work/` (mail `023e5f02`)           |

## Receipts (run at cut time on `a7a93d5`)

R1. `src/` had not changed since phase 2 closed (at `a7a93d5`):

```console
$ git diff --name-only a7a93d5 -- src | wc -l
       0
```

Revision (audit `ea39772d` O1, Mind ruling: ratify the `a7a93d5` freeze). After the cut, `6e7724a` changed `src/positions.ts` and `src/channel.test.ts`. The `positions.ts` change is JSDoc only (no non-comment line differs), so behavior is unchanged and the oracle stays pinned at `a7a93d5`. `src/` may change after the freeze; the oracle may not. At `bd60a0e`:

```console
$ git diff --name-only a7a93d5 bd60a0e -- src
src/channel.test.ts
src/positions.ts
$ git diff a7a93d5 bd60a0e -- src/positions.ts | grep '^[-+]' | grep -v '^[-+][-+]' | grep -v '^[-+]\s*\*' | grep -v '^[-+]\s*/\*\*' | wc -l
       0
```

R2. The oracle inventory, every non-test file under `src/`:

```console
$ git ls-tree --name-only a7a93d5 src/ | grep -v '\.test\.ts$'
src/canonical.ts
src/channel.ts
src/codec.ts
src/compile.ts
src/document.ts
src/dsl.ts
src/element.ts
src/equivalence.ts
src/index.ts
src/issue.ts
src/plan.ts
src/positions.ts
src/record-path.ts
src/resolve.ts
src/tokenizer.ts
src/xml-schema.ts
```

Their only module specifiers are relative (`./*.ts`) or `effect/*`; the one other match is a JSDoc `@example` line (`src/xml-schema.ts:17`), so a copy under `test/oracle/` is self-contained:

```console
$ git ls-tree --name-only a7a93d5 src/ | grep -v '\.test\.ts$' | xargs grep -ho 'from "[^"]*"' | sort -u | grep -v 'from "\./' | grep -v 'from "effect'
from "@aidenzepp/effect-xml"
```

Before `perf3-oracle`, the verbatim check prints one line per missing copy:

```console
$ for f in $(git ls-tree --name-only a7a93d5 src/ | grep -v '\.test\.ts$'); do git show a7a93d5:$f | cmp -s - test/oracle/${f#src/} || echo DIFF $f; done | wc -l
      16
```

R3. One lint rule is path-scoped to `src/issue.ts`: the `unicorn/throw-new-error` override (`vite.config.ts:35-40`), because the rule misreads `Schema.TaggedError` factories. Its copy needs the same override.

R4. The public runtime surface, which the feature vocabulary covers and which phase 3 must not change:

```console
$ bun -e 'import("./src/xml-schema.ts").then((m) => console.log(Object.keys(m).sort().join(" ")))'
Array DecodeError DefinitionError Element ElementFromString EncodeError EncodeSchemaFailure InvalidEvent Limit SchemaFailure Tokenizer UndeclaredPrefix UnmappedNamespace Unsupported WellFormedness clark decodeErrorOf decodeSchema decodeSchemaString elements encodeErrorOf equivalence fromString isDecodeError isEncodeError mixed namespaces optionalKey suspend text
```

R5. The derivations Effect 4.1.2 offers on `Schema` (plus `Arbitrary.schema`, `node_modules/effect/src/Arbitrary.ts:423`):

```console
$ grep -nE '^export (const|function|declare function) to[A-Z]' node_modules/effect/src/Schema.ts | sed -E 's/^([0-9]+):export (const|function|declare function) (to[A-Za-z0-9]+).*/\1 \3/'
1397 toStandardSchemaV1
1418 toStandardJSONSchemaV1
2598 toType
2641 toEncoded
6443 toTaggedUnion
18021 toFormatter
18064 toEquivalence
18089 toRepresentation
18253 toJsonSchemaDocument
18316 toCodecJson
18362 toCodecIso
18441 toCodecStringTree
18511 toCodecArrayFromSingle
18632 toCodecGoJson
18731 toEncoderXml
18758 toIso
18768 toIsoSource
18778 toIsoFocus
18865 toDifferJsonPatch
```

R6. Inputs. Corpus (16 files):

```console
$ ls spikes/fixtures/qti/*.xml test/fixtures/*.xml | wc -l
      16
$ bun -e 'import("./bench/inputs/synthetic.ts").then((m) => console.log(m.inputIds.join(" ")))'
bank-16k bank-256k bank-4m bank-64m bank-256k-bad-last bank-4m-bad-last
```

The bench typed case decodes with `{ maxElementNodes: Infinity, maxElementSize: Infinity }` (`bench/cases/effect-xml-typed.ts:29`); the stream case uses `XmlSchema.decodeSchemaString(ItemRef, bankPath)` (`bench/cases/effect-xml-stream.ts:36`).

R7. Existing pins phase 3 must keep: `test/wire-fast-path.test.ts` captures direct element-codec outcomes, including issue trees with AST tags, and every derivation of seven direct codecs (`empty`, `text`, `elements`, `mixed`, `open elements`, `open mixed`, `data`; `:106-128`) as literals.

```console
$ grep -c 'tree: "' test/wire-fast-path.test.ts
474
```

R8. `fast-check` is not installed (`ls node_modules/fast-check` fails); `effect/Arbitrary` provides `schema`, `sampleEffect`, and `checkEffect` with seeds and shrinking (`node_modules/effect/src/Arbitrary.ts:423`, `:820`, `:855`) and is already imported by `test/wire-fast-path.test.ts:11`.

R9. The check forms work: `bun x vp test test/readme.test.ts` (one file) and `bun x vp test test/qti/` (a directory) each run and print their test counts.

## Oracle decision (gap D2, planner's default)

The reference is a **frozen, test-only copy of today's `src/`** at `test/oracle/`, byte-identical to `a7a93d5`, and not recorded golden outputs.

- Generated and fuzzed inputs are open-ended: a golden file can only hold the inputs chosen when it was recorded, while a live oracle answers any input the generator produces, including shrunk counterexamples.
- Errors and positions come for free: the oracle is the same code, so its `XmlDecodeError` reasons, messages, paths, positions, issue trees, records-before-failure, and encode text are today's by construction, on every surface (direct codec, document, both channels, positions off and on).
- No large fixtures: `bank-4m` outputs and derivation JSON would be megabytes of literals (`test/wire-fast-path.test.ts` already holds about 1,800 lines of derivation literals for seven small codecs).
- Drift is ruled out structurally: the copy imports only itself and `effect`, so a `src/` change cannot reach it; `test/oracle/frozen.test.ts` pins each file's SHA-256.

Cost: 7,260 duplicated lines under lint and type check, and vocabulary copies built on the oracle's `XmlSchema` (an element built with `src` cannot be decoded by the oracle without mixing both implementations). Option: golden outputs, with fixed seeds for generated and fuzzed inputs.

## Standing rules (every brief below is bound by these; a brief names the ones it leans on)

- R-effect: Effect error channels only. `try`/`catch` is a lint error (`workspace/no-built-in-try-catch`); `no-await-in-loop` is an error. A derivation or generator that throws is wrapped in `Effect.try`, as `arbitraryOf` does (`test/wire-fast-path.test.ts:4010`).
- R-guide: follow `node_modules/effect/AGENTS.md` (read it completely before writing Effect code) and `.agents/skills/effect-design/SKILL.md`. Use `Predicate` helpers, never hand-written guards. Before custom glue, add one `// Native: <API checked> lacks <requirement>.` line comment above the declaration's JSDoc block.
- R-doc: multiline JSDoc on every module-scope function, type, interface, and `const`, with `@param`/`@returns` on functions (`.agents/skills/document-code/SKILL.md`).
- R-nosrc (guardrail track only): no file under `src/` or `bench/` changes. A finding that needs one is reported to the Mind. Codec-track slices are bound by R-src instead.
- R-oracle: nothing outside `perf3-oracle` writes `test/oracle/`. Every differential test builds the oracle side from `test/oracle/index.ts` and the vocabulary copies under `test/differential/vocabulary/`, and the `src` side from `src/index.ts` and the original vocabularies; it never passes a codec built by one implementation to the other. Compare the two sides only through the harness summaries, never with `instanceof` (the two `XmlDecodeError` classes are distinct). Revision (audit H5): both copies define `XmlSchema.Tokenizer` as the same key, `Context.Reference("@aidenzepp/effect-xml/Tokenizer")` (`src/tokenizer.ts:131` and `test/oracle/tokenizer.ts`), so a tokenizer provided around both sides reaches both. Never provide `Tokenizer` across sides: the harness runs each side's effect on its own and owns any `provideService`, per side, with that side's own tokenizer value. Never use `test/tokenizer/fakes.ts` on the oracle side (it imports `src/positions.ts`). Revision (re-audit V3): `defaultTokenizer` is not on the public index (`src/xml-schema.ts:36` exports only `Tokenizer`), so a src-side test may import it from `src/tokenizer.ts` (`:114`) and the oracle side from `test/oracle/tokenizer.ts`; reading each side's default with `yield* X.Tokenizer` is the alternative. A test names which one it uses.
- R-cases (revision, F7.1 and F7.7): a differential suite's inputs live in a `<suite>.cases.ts` module beside the test. It exports its text inputs as `DocumentInput` values and its value inputs as `EncodeInput` values (harness types, `test/differential/harness.ts`, landed `a3e5d8d`; re-audit V1: `{ id, value, roots, options?, parseOptions?, intended? }`, where `intended` names the encode reason a corruption is built to provoke) and imports neither `@effect/vitest` nor any other test runner, so `perf3-acceptance` and the `node` child processes of `perf3-diff-noeval` reuse exactly the inputs the suite compares. It uses only erasable TypeScript syntax (Node runs it with type stripping).
- R-test: tests import `{ describe, expect, it } from "@effect/vitest"` and use `it.effect` for effectful cases. Comparisons are `expect(src).toStrictEqual(oracle)` over harness summaries; a value summary carries its own-key order (`valueSummary`, `keyOrderOf`), so the comparison includes key order at every depth (M6); messages are compared between the two implementations, never against literal text. Add tests; never edit or delete an existing assertion. Vitest runs on Node.
- R-seed: every generated or fuzzed run uses `effect/Arbitrary` with a fixed seed and a fixed run count written in the test, and a failure names the seed and the shrunk input (`Arbitrary.formatCheckFailure`, `:374`).
- R-proof: a differential test that passes is not yet proof that it compares anything. Before committing, the seat (1) reports the number of compared cases the test executed (a count the test computes and asserts is above zero), and (2) sabotages the oracle (for example change one message string in `test/oracle/issue.ts`, or the order two attributes are written in `test/oracle/compile.ts`), runs the test, and records that it fails and how many cases failed. Report both numbers. Revision (rev2, Mind ruling, mail `023e5f02`): sabotage happens only in a private git worktree under `work/`, never in the shared checkout, because a sabotaged shared file makes a concurrent seat's run fail or pass falsely. The steps: `git worktree add work/rproof-<slice> HEAD`; copy the slice's uncommitted `write_scope` files into it; `ln -s "$PWD/node_modules" work/rproof-<slice>/node_modules`; sabotage and run the slice's test inside `work/rproof-<slice>`; then `git worktree remove --force work/rproof-<slice>`. `git status --short test/oracle` in the shared checkout prints nothing before the commit, and `git worktree list` no longer shows the private worktree. A codec-track test proves itself the same way against its own subject: sabotage the `src` module under test in the private worktree, record the failure, remove the worktree; `git status --short src` in the shared checkout shows only the slice's own files.
- R-check: the slice check is the command its brief names: `bun x vp test <file>` (one file or directory per invocation; chain with `&&`) and `bun x vp check <files>`. The type check is program-wide: an error it reports outside your `write_scope` is a `blocked-scope` report, never an edit. `bun run check`, `bun run build`, and `bun run test` are the gate seats' job.
- R-commit: one conventional commit per slice (`.agents/skills/conventional-commits/SKILL.md`), path-limited to the slice's `write_scope` (`git add <files> && git commit -m '<message>' -- <files>`). Guardrail slices use scope `test`; codec slices use the type and scope their brief names. Never amend, reset, rebase, or stash. Retry if `.git/index.lock` exists.
- R-src (codec track): new logic goes in the new files the brief names. An existing `src/` file changes only as the brief states, and the hot files are serialized as "Waves" lists. No export of `src/index.ts` changes: `bun -e 'import("./src/xml-schema.ts").then((m) => console.log(Object.keys(m).sort().join(" ")))'` prints receipt R4's list. No public AST changes: `compile()` output and the codecs `fromString` and `ElementFromString` return are as today, so `bun x vp test test/wire-fast-path.test.ts` stays green with the file unedited. No module writes an annotation onto a schema it did not create. No `src/` module imports `effect/schema/SchemaJITCompiler` or `effect/schema/SchemaJITCompiler/enable` (M3; receipt C6). Hot-loop code (builder, writer) uses no Schema and no Effect.
- R-trace (codec wiring): `.agents/skills/trace-effect/SKILL.md` governs any span or log change; the library never installs a tracer, logger, or exporter.
- R-scope (ends every brief): change only the files in `write_scope`. If the work needs any other path, change nothing and report `blocked-scope` with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

## Cut 1: slice

- answer: sliced (revised under task `6c66e48a` after delivery audit `ea39772d`: oracle, bank, and derivations admitted; harness, corpus, generated, and fuzz revised; wrapped and noeval added)
- longest chain: perf3-oracle, perf3-diff-harness, perf3-diff-generated, perf3-diff-fuzz, perf3-diff-noeval

### perf3-oracle: Freeze today's implementation as a test-only oracle

- write_scope: the 16 files `test/oracle/<name>.ts` for each `src/<name>.ts` in receipt R2 (new), `test/oracle/frozen.test.ts` (new), `vite.config.ts`
- deps: none
- red_first: no (R-proof sabotage instead)
- risk: low (verbatim copy; the risk is a lint rule scoped by path)
- integrable: yes
- status: landed `bd60a0e` (audit `ea39772d`: admitted)

Revision (task `6c66e48a`). Audit O1: step 1's stop condition fired literally, because `6e7724a` changed `src/positions.ts` (JSDoc only) and `src/channel.test.ts` after the cut; the Mind ratified the `a7a93d5` freeze (receipt R1). Audit O2: the smoke test's decoded value is `{ $text: "First" }`, not `"First"` (`README.md:156`); the landed test uses the correct shape. Read step 1 and step 4 below with both corrections.

Why: every differential suite in this phase compares the new implementation against today's. Receipt R2 and the oracle decision above give the shape.

Change:

1. Confirm `git diff --name-only a7a93d5 HEAD -- src` prints nothing. If it prints anything, stop and report: the oracle must freeze `a7a93d5`'s behavior.
2. Copy each file: `for f in $(git ls-tree --name-only a7a93d5 src/ | grep -v '\.test\.ts$'); do mkdir -p test/oracle && git show a7a93d5:$f > test/oracle/${f#src/}; done`. Do not edit the copies, format them, or add headers.
3. In `vite.config.ts`, add `"test/oracle/issue.ts"` to the `files` array of the existing `unicorn/throw-new-error` override (`:38`) and extend its comment by one clause naming the oracle copy. No other config change. If `bun x vp check` reports any other rule on a copy, report `blocked-scope` with the rule and file.
4. `test/oracle/frozen.test.ts`: its module JSDoc states that `test/oracle/` is `src/` frozen at `a7a93d5` for the phase-3 differential tests, changes only by a Mind-approved re-freeze, and is deleted when phase 3 closes. One test asserts the SHA-256 (`node:crypto` `createHash`) of each of the 16 copies equals a literal map keyed by file name, computed from `git show a7a93d5:src/<name>.ts`. A second test decodes `<item>First</item>` with the oracle's `XmlSchema.fromString(XmlSchema.Element("item", { content: XmlSchema.text(Schema.String) }))` and asserts `"First"`, so the copy runs.

R-proof here: change one byte of one copy, run the test, record that the hash test fails, restore.

Rules: R-effect, R-doc (the new test only), R-nosrc, R-test, R-proof, R-check, R-commit (`test(oracle): freeze the current implementation as the phase-3 differential oracle`), R-scope.

Check: `bun x vp test test/oracle/frozen.test.ts && bun x vp check test/oracle/*.ts vite.config.ts`, and the receipt-R2 verbatim loop prints nothing:

```sh
for f in $(git ls-tree --name-only a7a93d5 src/ | grep -v '\.test\.ts$'); do git show a7a93d5:$f | cmp -s - test/oracle/${f#src/} || echo DIFF $f; done
```

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf3-diff-harness: Differential harness and oracle-side vocabularies

- write_scope: `test/differential/harness.ts` (new), `test/differential/harness.test.ts` (new), `test/differential/vocabulary/qti.ts` (new), `test/differential/vocabulary/streaming.ts` (new), `test/differential/vocabulary/bank.ts` (new), `test/differential/vocabulary.test.ts` (new)
- deps: perf3-oracle
- red_first: no (R-proof sabotage instead)
- risk: high (a summary that drops a field makes every suite blind to it; audit H1)
- integrable: yes
- status: landed `a3e5d8d` (task `8d8a0afe`). Revised: audit `ea39772d` H1-H6, amendment A1; dispatched with the rev2 amendments below in its task body.

Amendments (rev2, recorded as dispatched; re-audit `e2d82410` V1, V3 and merit ruling M6):

- V1: the harness exports `EncodeInput` beside `DocumentInput`, so cases modules can export encode inputs (generated values, hand-built samples, and corruptions with their intended reason). Values are plain data and serve both sides (`isResolvedElement` is structural, `src/element.ts:227-233`).
- M6: value equality is `toStrictEqual` plus identical own-key order at every depth (`valueSummary` carries `keyOrderOf`); reference identity is not compared; encode text is compared byte for byte. The seat showed the key-order check can fail (R-proof).
- V3: the src side may import `defaultTokenizer` from `src/tokenizer.ts`, or read each side's default with `yield* X.Tokenizer` (R-oracle).

Why: every suite needs the same vocabularies on both sides and one definition of "same outcome". The summary must hold every field a caller can read, because the fast path's riskiest divergence (`reason.elementPath` across slots, errors spike `cae1912`) is visible in no other field when `positions` is off.

1. Vocabulary copies. Each copy is its source with only import specifiers rewritten:

   | Copy                                        | Source                         | Specifier rewrites                                                                                  |
   | ------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
   | `test/differential/vocabulary/qti.ts`       | `test/qti/vocabulary.ts`       | `../../src/index.ts` to `../../oracle/index.ts`                                                     |
   | `test/differential/vocabulary/streaming.ts` | `test/streaming/vocabulary.ts` | `../../src/index.ts` to `../../oracle/index.ts`                                                     |
   | `test/differential/vocabulary/bank.ts`      | `bench/vocabulary.ts`          | `../src/index.ts` to `../../oracle/index.ts`; `../test/streaming/vocabulary.ts` to `./streaming.ts` |

   `test/differential/vocabulary.test.ts` reads each source and copy as text with `node:fs` (it never imports `bench/`), applies the table's rewrites to the source, and asserts the result equals the copy. A later edit to a source vocabulary then fails this test instead of silently comparing different vocabularies.

2. `test/differential/harness.ts`, structural summaries that read only public fields. It imports no test runner (R-cases).
   - `treeOf(issue)`: the issue tree on one line, AST `_tag`s included, exactly as `test/wire-fast-path.test.ts:250-265` writes it (copy it; do not import from that file).
   - `causeOf(error: Schema.SchemaError)`: `{ tree: treeOf(error.issue), leaves, count }`, where `leaves` is the StandardSchemaV1 issue list (`SchemaIssue.makeFormatterStandardSchemaV1()`, path and message per leaf) and `count` its length. This is the strict cause comparison the Mind kept (audit X3, ruling F2).
   - `xmlCauseOf(error: Xml.XmlError)`: `{ kind, message, line, column }` (`node_modules/effect/src/encoding/Xml.ts:51-56`; absent fields as `"none"`).
   - `directOutcome(exit)`: `{ value }` on success, `{ message, tree }` on a `Fail`, `{ defect }` otherwise.
   - `decodeErrorSummary(error)` (audit H1, H2): `_tag`, `message`, `path`, `position` (or `"none"`), `record` (or `"none"`), and `reason` with every public field of its class (`src/issue.ts:43-110`):

     | Reason             | Fields summarized                                                 |
     | ------------------ | ----------------------------------------------------------------- |
     | `SchemaFailure`    | `elementPath`, `cause` as `causeOf`                               |
     | `UndeclaredPrefix` | `prefix`, `where`, `elementPath`                                  |
     | `Limit`            | `limit`, `max`, `element` (or `"none"`), `measured` (or `"none"`) |
     | `WellFormedness`   | `elementPath` (or `"none"`), `cause` as `xmlCauseOf`              |
     | `Unsupported`      | `cause` as `xmlCauseOf`                                           |

     A reason `_tag` the table does not list is a test failure naming it, so a new reason cannot pass unsummarized. `work/spikes/perf3-errors/cases.ts` (machine-local, gitignored) has a summary of this shape to start from (`errors.md:205`).

   - `encodeErrorSummary(error)` (audit H3): `_tag`, `message`, `path`, and `reason`: `EncodeSchemaFailure` with `cause` as `causeOf`; `UnmappedNamespace` with `namespace` and `what`; `InvalidEvent` with `cause` as `xmlCauseOf` (`src/issue.ts:112-140`).
   - `documentDecode(codec, text, parseOptions?)`, `documentEncode(codec, value, parseOptions?)` (audit H4): Effects that never fail. On success they yield `{ value }` or `{ text }`. On failure they yield `{ schema: { message, tree }, xml }`: `schema` is the outer `Schema.SchemaError` a plain Schema caller of `fromString` sees, and `xml` is `decodeErrorOf`/`encodeErrorOf` of its issue summarized, or `"none"` when the option is `None`. A defect yields `{ defect }`.
   - `channelDecode(channel, source, options, parseOptions?)`: runs a `decodeSchemaString` or `decodeSchema` channel over a `Stream` source and yields `{ records, end }`, where `records` are the values emitted before the end and `end` is `"done"` or a `decodeErrorSummary`, so records emitted before a failure are compared too.
   - `withTokenizer(effect, tokenizer)`: provides `Tokenizer` to one side's effect only (R-oracle, audit H5). Suites call it once per side with that side's own value.
   - `DocumentInput` (R-cases): `{ id, text, roots }` where `roots` holds the record or root definitions per side (`{ src, oracle }`), plus optional `options`, `parseOptions`, `path` (for channels), and `pieces` (split points). Cases modules export arrays of it; the harness exports no inputs of its own.

3. `test/differential/harness.test.ts` (audit H6): for one small element built on each side, every surface's summary is equal across the two sides, and the summaries of one side differ from each other (the summaries do not flatten distinct outcomes), on:
   - decode through `fromString`: valid text, a value the leaf schema rejects, malformed markup, an unbound prefix, and a document over `maxElementNodes: 1`;
   - encode through `fromString`: a valid value, a value the leaf schema rejects on encode, and an attribute in a namespace no prefix spells (`UnmappedNamespace`);
   - one `decodeSchemaString` run with a record the schema rejects after one valid record (`records` length 1, then an error).

Rules: R-effect, R-guide, R-doc, R-nosrc, R-oracle, R-cases, R-test, R-proof, R-check, R-commit (`test(differential): add the phase-3 differential harness and oracle vocabularies`), R-scope.

Check: `bun x vp test test/differential/harness.test.ts && bun x vp test test/differential/vocabulary.test.ts && bun x vp check test/differential/harness.ts test/differential/harness.test.ts test/differential/vocabulary/qti.ts test/differential/vocabulary/streaming.ts test/differential/vocabulary/bank.ts test/differential/vocabulary.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf3-diff-corpus: Differential suite over the QTI corpus

- write_scope: `test/differential/corpus.cases.ts` (new), `test/differential/corpus.test.ts` (new)
- deps: perf3-diff-harness
- red_first: no (R-proof)
- risk: medium
- integrable: yes
- status: landed `644bdf3` (revised: audit `ea39772d` C1, C2; amendment A2)

Inputs (`corpus.cases.ts`, R-cases): every file `ls spikes/fixtures/qti/*.xml test/fixtures/*.xml` lists (16 at cut time; read the directory at run time, as `test/round-trip.test.ts:26-32` does, so a new fixture joins automatically), as `DocumentInput` values for each root below.

Per input, `src` against oracle through the harness:

1. `XmlSchema.ElementFromString`: decode, then encode of the decoded tree.
2. `XmlSchema.fromString(AssessmentItem)`: decode, and encode of every decoded value. Run it on all 16 files: the files the vocabulary does not cover produce errors, and those errors are compared too.
3. Direct: `Schema.decodeUnknownExit(AssessmentItem)` over each side's own `ElementFromString` root.
4. Channels: `decodeSchemaString` and `decodeSchema` (the text as UTF-8 bytes) with one record codec and root-anchored path from the QTI vocabulary that occurs in the corpus (choose one; state it in the test's JSDoc and the report), `positions` off and on, with the source as one string and as 64-character pieces.
5. Parse-option variants (audit C1): surfaces 2, 3, and 4 again with `parseOptions` `{ errors: "all" }` and again with `{ onExcessProperty: "error" }`. `errors: "all"` has its own path, message, and position rule (`src/channel.ts:379-380`, `src/codec.ts:222-226`); `onExcessProperty` reaches the structural decode unchanged under F9, so a key-set difference shows here.

The test computes and asserts the number of compared cases, the number that were errors, the number of channel records, and the number of cases per parse-option variant (each above zero).

Residual (audit C2, recorded, not covered): the native-position path (`positions: "native"`, `nativePositions`) gets no differential coverage. Covering it needs an honest native tokenizer per side, built from that side's own positions module (`test/tokenizer/fakes.ts` imports `src/positions.ts`, R-oracle). Step 1 changes no tokenizer or positions code, and on failure the fallback attaches positions through today's code (F1 (a)), so the residual does not cover a step-1 change.

Rules: R-effect, R-guide, R-doc, R-nosrc, R-oracle, R-cases, R-test, R-proof, R-check, R-commit (`test(differential): compare decode and encode over the QTI corpus against the oracle`), R-scope.

Check: `bun x vp test test/differential/corpus.test.ts && bun x vp check test/differential/corpus.cases.ts test/differential/corpus.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf3-diff-bank: Differential suite over the synthetic bank inputs

- write_scope: `test/bench/bank-differential.test.ts` (new)
- deps: perf3-diff-harness
- red_first: no (R-proof)
- risk: medium (large inputs: time and memory inside Vitest)
- integrable: yes
- status: landed `827b7cf` (audit `ea39772d`: admitted)

Amendment A3 (optional, additive; audit suggestion): on each `-bad-last` input, also assert that `end` is an error summary on both sides, so the suite cannot pass on two sides that both stop early with `"done"`.

Why `test/bench/`: the bank generator (`loadInput`, `bench/inputs/synthetic.ts:150`) and `ItemBank` (`bench/vocabulary.ts:18`) live in `bench/`, and only `test/bench/` may import `bench/` (parent goal, Constraints). The oracle side imports `test/differential/vocabulary/bank.ts`.

Inputs: `bank-16k`, `bank-256k`, `bank-4m`, `bank-256k-bad-last`, `bank-4m-bad-last` from `loadInput`. Not `bank-64m` (gap D4).

Per input, `src` against oracle through the harness:

1. `XmlSchema.fromString(ItemBank, { maxElementNodes: Infinity, maxElementSize: Infinity })`, the bench typed case's options (`bench/cases/effect-xml-typed.ts:29`): decode, and encode of the decoded value (text compared exactly).
2. `XmlSchema.decodeSchemaString(ItemRef, bankPath)` over the input's 64 KiB chunks (`documents[0].chunks`), `positions` off and on; and `XmlSchema.decodeSchema` over the same chunks as UTF-8 bytes, `positions` off and on. On the `-bad-last` inputs this compares the records emitted before the failure, and the failure's reason, message, path, and position.

Assert the record count of each valid input's channel run equals `reference.records` on both sides, so the test cannot pass on empty output. Give each test a timeout that covers both sides at `bank-4m` with `positions` on (Bun `positions` rung about 158 ms, `docs/rd/performance.md`, "Layer ladder"; Vitest runs on Node).

Rules: R-effect, R-guide, R-doc, R-nosrc, R-oracle, R-test, R-proof, R-check, R-commit (`test(bench): compare bank decode, encode, and streaming against the oracle`), R-scope.

Check: `bun x vp test test/bench/bank-differential.test.ts && bun x vp check test/bench/bank-differential.test.ts`. Report the run's duration.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf3-diff-generated: Differential properties over generated values and a feature vocabulary

- write_scope: `test/differential/features.ts` (new), `test/differential/generated.cases.ts` (new), `test/differential/generated.test.ts` (new)
- deps: perf3-diff-harness
- red_first: no (R-proof)
- risk: medium (`Arbitrary.schema` may not derive some roots)
- integrable: yes
- status: landed `4f9b41a`, with follow-up `perf3-diff-generated-valid` (`789e700`: generated values held to XML characters; audit `7aa62827` residual R3) (revised: audit `ea39772d` G1-G3; guards F7.4 and F5; amendments A4, A5, A6; rev2: re-audit `e2d82410` V1 and V4, M5, structural-codec addendum)

Why: the corpus and bank cover two vocabularies; the builder spike's coverage map spans every Plan feature, so the properties need a vocabulary that has each one, and the encode path needs invalid values as well as valid ones.

1. `test/differential/features.ts` exports `makeFeatures(X)`, taking an `XmlSchema` namespace and returning element codecs that together use every declaration export of receipt R4 (`Element`, `namespaces` with a default and a prefixed namespace, `suspend` recursion, `text`, `elements` with a plain, an `optionalKey`, and an `Array` slot and with `{ open: true }`, `mixed` closed and open, attributes required and optional, `data-*` rest) and leaf schemas of four kinds: plain `Schema.String`, a transforming leaf (`Schema.Finite` through `XmlSchema.text`), a checked leaf (a `Schema.String` with a check), and a `Schema.Literals` enum. Amendment A6 (F7.4) adds: an attribute in a prefixed namespace, and a child element in a second namespace that the root's `namespaces` map does not declare, so the writer must declare it below the root. The test builds it twice, `makeFeatures(src XmlSchema)` and `makeFeatures(oracle XmlSchema)`. If the two namespace types are not assignable to one parameter type, type the parameter as a `Pick` of the members it uses and report it. `features.ts` also exports `samples(X)`: at least one hand-built typed value for each feature root `Arbitrary.schema` cannot derive (open content holds `ResolvedElement`s under a `Schema.declare`), so every root has an encoded value.
2. `test/differential/generated.cases.ts` (R-cases) builds the inputs with a fixed seed and run count (R-seed): per root (each feature root, streaming `ItemRef` and `AssessmentTest`, and QTI `AssessmentItem`), values from `Arbitrary.schema(Schema.toType(src root))` plus `samples`, and their P1 texts as `DocumentInput` values. Revision (re-audit V1): it also exports the encode inputs as `EncodeInput` values: every generated value, every `samples` value, and every P5 corruption with its `intended` reason, so `perf3-acceptance` and `perf3-diff-noeval` reuse exactly the values this suite encodes instead of regenerating them.
3. `test/differential/generated.test.ts`, per root:
   - P1 encode: `fromString(root)` encode on both sides gives the same text or the same encode error summary.
   - P1t encode through a provided tokenizer (the R9 seam): the same encode with `Tokenizer` provided per side (R-oracle, `withTokenizer`) as a spread copy of that side's own `defaultTokenizer` (`src/tokenizer.ts:114`, `test/oracle/tokenizer.ts`; R-oracle V3). The copy behaves the same and is a provided value, not the default; every encode goes through the current tokenizer (M5), so the text equals P1's on both sides.
   - P2 decode: decoding P1's text on both sides gives the same outcome.
   - P3 direct: `Schema.encodeUnknownExit` then `Schema.decodeUnknownExit` of the element codec gives the same direct outcomes.
   - P4 channels (audit G2): `decodeSchemaString` over each P1 text with the root as the record codec and the one-step path `[<root's Clark name>]`, `positions` off and on.
   - P5 invalid values (audit G1, N3): each generated value corrupted at one leaf, on the `fromString` encode and the direct `Schema.encodeUnknownExit` surfaces. Corruptions: a value its leaf schema rejects on encode (a failing check, `NaN` for `Finite`, a value outside the `Literals`), a string holding U+0000 or a lone surrogate in an attribute or text (`InvalidEvent`), an attribute, on a declared or an open-content element, in a namespace no prefix spells (`UnmappedNamespace`; src raises it for attributes only, `src/resolve.ts:1213-1225`, re-audit V4), and an open-`mixed` `*` item whose element is named after a declared member (`EncodeSchemaFailure` from the open member's guard, `src/compile.ts` `openItem`; structural-codec addendum). The test asserts at least one case of each encode reason, `EncodeSchemaFailure`, `InvalidEvent`, and `UnmappedNamespace`, on both sides.

   A root `Arbitrary.schema` cannot derive is not skipped: the test derives it on both sides and asserts both fail with the same error message (audit G3), uses `samples` for it, and the report lists it with that message.

The test computes and asserts the count of encoded values per feature (attributes, prefixed attributes, `data-*`, `text`, each slot cardinality, open `elements`, `mixed` closed and open, `suspend`, second-namespace child), each above zero (F7.4). Report the roots, the run count per property, the per-feature counts, the per-reason counts of P5, and the derived-or-not list.

Rules: R-effect, R-guide, R-doc, R-nosrc, R-oracle, R-cases, R-test, R-seed, R-proof, R-check, R-commit (`test(differential): compare generated values over a feature vocabulary against the oracle`), R-scope.

Check: `bun x vp test test/differential/generated.test.ts && bun x vp check test/differential/features.ts test/differential/generated.cases.ts test/differential/generated.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf3-diff-fuzz: Differential suite over fuzzed documents (errors, limits, and positions)

- write_scope: `test/differential/fuzz.cases.ts` (new), `test/differential/fuzz.test.ts` (new)
- deps: perf3-diff-harness, perf3-diff-generated (reads `features.ts` and `generated.cases.ts` for seeds)
- red_first: no (R-proof)
- risk: medium
- integrable: yes
- status: landed `c63014a`, with follow-up `perf3-fuzz-timeout` (`aaf9b25`: a loaded-machine timeout) (revised: audit `ea39772d` F1-F4; guard F7.1; amendment A7); rev3 adds the streaming seed's `record` export (audit `c972014c` A1, fuzz note)

Why: valid inputs do not exercise the fallback, the budgets, or the acceptance edges where a fast path could accept what today rejects (F7.1).

Seeds (`fuzz.cases.ts`, R-cases): the corpus files of `perf3-diff-corpus`, the streaming fixture text (`syntheticParts()` concatenated, `test/streaming/synthetic.ts:30`), and (audit F4, covered because F7.1 needs it) a fixed sample of P1 texts of the feature roots from `generated.cases.ts`, which bring open elements, open mixed, checked leaves, prefixed attributes, and `data-*`.

Record definition (rev3, audit `c972014c` A1): each streaming-seed input carries `roots` = the `AssessmentTest` pair, `path` = `itemRefPath`, and `record: { oracle: <oracle ItemRef>, src: <src ItemRef> }` (`test/differential/vocabulary/streaming.ts:67`, `:84`, `:92`), exported the way `wrapped.cases.ts` exports `record` (`:57`, `:226`), so `perf3-acceptance` decodes each record with the record definition. `fuzz.cases.ts` declares the input type as `DocumentInput` plus `record: Sides`; `harness.ts` is unchanged.

Mutation operators, chosen and parameterized by `effect/Arbitrary` (R-seed): remove an attribute; replace an attribute value with a generated string (empty, non-numeric, an entity reference, an escaped `<`); remove an element with its content; duplicate an element; rename an element (an undeclared local name, an unbound prefix, and the same local name in another namespace); insert text, a comment, a processing instruction, CDATA, or whitespace at a tag boundary; replace an element's text with empty text and with whitespace only, in every content mode; add an undeclared attribute beside `data-*` attributes; truncate at an offset; insert a stray end tag; insert a DOCTYPE with an internal entity.

Surfaces per mutated document, `src` against oracle:

- `ElementFromString` decode; `fromString(AssessmentItem)` decode (corpus seeds), `fromString(AssessmentTest)` decode (streaming seed), and `fromString(<feature root>)` decode (feature seeds);
- direct (audit F3): `Schema.decodeUnknownExit(<root>)` over each side's own `ElementFromString` root of the mutant, when that decode succeeds;
- `decodeSchemaString` with `positions` off and on, using the streaming vocabulary's `ItemRef` and `itemRefPath` for the streaming seed, with the source split at Arbitrary-chosen offsets into two to five pieces (audit F2: the piece rule across string boundaries, as `6e7724a` pinned for a malformed tag at a string end);
- small budgets (audit F1): the document surfaces with `{ maxElementNodes, maxElementSize }` drawn small enough to trip, and with `maxDepth` and `maxTokenSize` small, and the channel surface with the same record budgets;
- `errors: "all"` (audit F3): the document and direct surfaces again with `parseOptions` `{ errors: "all" }`.

The test counts outcomes by kind and asserts at least one each of a decoded value, `SchemaFailure`, `WellFormedness`, `UndeclaredPrefix`, and `Limit` (for each of `maxElementNodes`, `maxElementSize`, `maxDepth`, and `maxTokenSize`), so the run cannot pass on a generator that only produces valid or only malformed input. Report the counts.

Rules: R-effect, R-guide, R-doc, R-nosrc, R-oracle, R-cases, R-test, R-seed, R-proof, R-check, R-commit (`test(differential): compare fuzzed documents' errors, limits, and positions against the oracle`), R-scope.

Check: `bun x vp test test/differential/fuzz.test.ts && bun x vp check test/differential/fuzz.cases.ts test/differential/fuzz.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf3-derivations: Schema derivations of element and document codecs match the oracle

- write_scope: `test/differential/derivations.test.ts` (new)
- deps: perf3-diff-harness
- red_first: no (R-proof)
- risk: medium (some derivations return functions or codecs, which need an observable form)
- integrable: yes
- status: landed `eb2c82c` (audit `ea39772d`: admitted)

Note (audit minor, not required): no open-elements or open-mixed document codec is a subject; the direct open codecs are pinned by `test/wire-fast-path.test.ts` (receipt R7). Under F3 no public AST changes, so this suite guards the invariant rather than a planned change.

Why: guardrail 2 (`phase-3.md`); `6dc514f` is the precedent. `test/wire-fast-path.test.ts` pins seven direct codecs as literals (R7) and stays as it is; this test covers the vocabularies and the document codecs by comparing against the oracle, so it needs no literals.

Subjects, each built on both sides: QTI `AssessmentItem`, `ChoiceInteraction`, `MathElement` (mixed), and `Div` (`suspend` recursion); streaming `ItemRef` and `AssessmentTest`; `XmlSchema.fromString` of each of those six; `XmlSchema.ElementFromString`. Each subject's valid value comes from decoding a corpus fixture or the streaming fixture on that side.

Derivations: every name of receipt R5 and `Arbitrary.schema`, observed as:

| Derivation                                                                                                         | Observable compared                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `toJsonSchemaDocument`, `toRepresentation`, `toStandardJSONSchemaV1` (its `jsonSchema` input and output)           | the JSON value                                                                                                        |
| `toType`, `toEncoded`, `toCodecJson`, `toCodecIso`, `toCodecStringTree`, `toCodecArrayFromSingle`, `toCodecGoJson` | `toRepresentation` of the result, and its decode and encode of the valid value (harness summaries)                    |
| `toStandardSchemaV1`                                                                                               | `validate` on the valid value and on one invalid value                                                                |
| `toFormatter`, `toEncoderXml`                                                                                      | the output for the valid value                                                                                        |
| `toEquivalence`                                                                                                    | the result on (valid, valid) and on (valid, a different valid value)                                                  |
| `toIso`, `toIsoSource`, `toIsoFocus`, `toDifferJsonPatch`                                                          | the optic's get and set on the valid value; the patch between two valid values and its application                    |
| `Arbitrary.schema`                                                                                                 | derived or the error message; when derived, `Arbitrary.sampleEffect` with one fixed seed and size gives equal samples |
| `toTaggedUnion`                                                                                                    | not applicable unless a subject is a union; list it as not applicable with that reason                                |

A derivation that throws on a subject is compared by its error message (R-effect: `Effect.try`). Report the matrix size (subjects times derivations) and the not-applicable list.

Rules: R-effect, R-guide, R-doc, R-nosrc, R-oracle, R-test, R-proof, R-check, R-commit (`test(differential): pin the Schema derivations of element and document codecs to the oracle`), R-scope.

Check: `bun x vp test test/differential/derivations.test.ts && bun x vp check test/differential/derivations.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf3-diff-wrapped: Differential suite over wrapped element codecs (guard F7.2)

- write_scope: `test/differential/wrapped.cases.ts` (new), `test/differential/wrapped.test.ts` (new)
- deps: perf3-diff-harness
- red_first: no (R-proof)
- risk: medium (the case that a `planOf`-based fast path would get wrong)
- integrable: yes
- status: landed `025a463` (new under task `6c66e48a`; amendment A8)

Why: `planOf` sees through `.check` and `Schema.decodeTo` (`src/plan.ts:138-187`), so a fast path that treated every marked slot as structural would skip a user's check or transformation and accept a value today rejects, or return an untransformed value (head-cto F7.2). The suite pins today's behavior for each wrapper so the F4 predicate is tested through every surface.

Vocabulary (`wrapped.cases.ts`, built per side from that side's `XmlSchema`): one small element `Leaf` with an attribute and `text` content, and one parent `Holder` with `elements` slots and `mixed` members. Four wrappers, each applied to `Leaf` used as a child slot, as a `mixed` member, and as the document root:

| Wrapper        | Applied as                                                               | An input that separates it from the bare element                   |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `.check`       | `Leaf.check(Schema.makeFilter(...))` refusing one attribute value        | a document the bare `Leaf` accepts and the check rejects           |
| `decodeTo`     | `Leaf.pipe(Schema.decodeTo(Model, transformation))` to a different shape | any valid document (the value must be `Model`, not `Leaf`'s value) |
| `.annotate`    | `Leaf.annotate({ title: "leaf" })`                                       | none (behaves as bare; kept to show it stays equal)                |
| `Schema.brand` | `Leaf.pipe(Schema.brand("Leaf"))`                                        | none (same AST, `node_modules/effect/src/Schema.ts:5319`)          |

Surfaces per (wrapper, placement, input), `src` against oracle: `fromString(<root>)` decode and encode of the decoded value; direct `Schema.decodeUnknownExit` and `Schema.encodeUnknownExit`; `decodeSchemaString` with the wrapped codec as the record (`positions` off and on); and `fromString` decode with `{ errors: "all" }`.

The test asserts, on both sides, at least one rejection caused by `.check` at each placement and at least one `decodeTo` value that differs from the bare element's value at each placement, so the suite cannot pass if neither side applies the wrapper. Report the matrix size.

Rules: R-effect, R-guide, R-doc, R-nosrc, R-oracle, R-cases, R-test, R-proof, R-check, R-commit (`test(differential): compare wrapped element codecs against the oracle`), R-scope.

Check: `bun x vp test test/differential/wrapped.test.ts && bun x vp check test/differential/wrapped.cases.ts test/differential/wrapped.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf3-diff-noeval: The differential inputs with and without the application's global JIT import (guard F7.7, re-scoped by M3)

- write_scope: `test/differential/fingerprint.ts` (new), `test/differential/jit-parity.test.ts` (new), `test/bench/bank-fingerprint.ts` (new), `test/bench/bank-jit-parity.test.ts` (new)
- deps: perf3-diff-corpus, perf3-diff-generated, perf3-diff-fuzz, perf3-diff-wrapped, perf3-diff-bank
- red_first: no (R-proof)
- risk: medium (child processes under Vitest; Node must run the cases modules with type stripping)
- integrable: yes
- status: landed `01766d3` (new under task `6c66e48a`, amendment A9; re-scoped by rev2 per M3 and S7; the slice id is kept, the files are renamed to say what they compare; settles D5 and J4)

Why: the library enables no JIT (M3), so its default and a run with code generation disallowed both interpret, and A9's comparison would be equal by construction. The risk F7.7 names remains for an application that imports Effect's global JIT: that import compiles the library's internal structural codecs and every user leaf they reach, and the oracle in the same process runs the same compiled registry entries, so a miscompile both sides share is invisible to a single-mode run. Running the same inputs once interpreted and once with the global import preloaded closes that gap, so an application's opt-in compiles the structural codec without divergence. The Mind may drop this slice if its cost matters (head-cto S7).

1. `test/differential/fingerprint.ts`, a script run with `node` (no test runner, R-cases): it imports `corpus.cases.ts`, `generated.cases.ts` (its `DocumentInput` and `EncodeInput` exports, re-audit V1), `fuzz.cases.ts`, and `wrapped.cases.ts`, runs every surface its suite runs for every input on both sides through the harness, and prints one JSON line. Per suite: the SHA-256 of the canonical JSON of the ordered `[id, src summary, oracle summary]` list (value summaries carry key order, M6), the case count, and the names of the surfaces it ran. For the run, two counts of `globalThis.Function` constructions while the surfaces ran, taken by a wrapper the script installs before the first surface and removes after the last (keep `Function.prototype`; `work/spikes/perf3-jit/introspect.ts` counts the same way): `compiled`, the constructions whose parameter list is `("ast", "R", "resolve", source)`, the compiler's own construction (`node_modules/effect/src/schema/SchemaJITCompiler.ts:40`); and `probes`, every other construction. The compiler's support probe, `Function("return true")` (`:23-30`), re-runs whenever `globalThis.Function` changes, so the wrapper itself triggers one; it is a probe, not a compiled function (rev3, audit `c972014c` N1).
2. `test/differential/jit-parity.test.ts` spawns `node test/differential/fingerprint.ts` and `node --import effect/schema/SchemaJITCompiler/enable test/differential/fingerprint.ts`. The second is the application's global import, the module `bench/harness/jit/on.ts` imports, named directly so `test/differential/` imports nothing from `bench/` (`node --import effect/schema/SchemaJITCompiler/enable -e 'console.log("loaded")'` prints `loaded` on Node 26.13). It asserts: both exit 0; `compiled` is 0 in the first run and above 0 in the second, so the JIT demonstrably compiled the codecs (a JIT run that compiled nothing still makes one probe construction, so counting every construction would pass trivially); `probes` is reported, not asserted; every suite's case count is above zero and equal across the two; every suite's surface list and hash are equal across the two.
3. `test/bench/bank-fingerprint.ts` and `test/bench/bank-jit-parity.test.ts` do the same for the bank surfaces of `perf3-diff-bank` (`fromString(ItemBank, { maxElementNodes: Infinity, maxElementSize: Infinity })` decode and encode; `decodeSchemaString` and `decodeSchema` over `documents[0].chunks`, `positions` off and on) on `bank-16k`, `bank-256k`, `bank-4m`, `bank-256k-bad-last`, and `bank-4m-bad-last`. They live in `test/bench/` because only it may import `bench/` (receipt R6, parent goal Constraints).

Give each spawning test a timeout that covers two child runs; report both durations and both runs' `compiled` and `probes` counts.

Coverage at landing (rev3, audit `c972014c` N1 P3): in w4 the structural codec is reachable only through `perf3-wire-decode-string` and `perf3-wire-channels`; `encodeString` reaches it only after `perf3-wire-encode` (w5). The counts this slice reports at landing therefore cover the structural decode path at most. The swap gate's rerun of `test/differential/` and `test/bench/` (gate item 2) is what covers the structural encode path; the gate seat records both runs' `compiled` counts and durations beside its green result.

R-proof here (in the private worktree R-proof names): make the script drop one case only when `process.execArgv` includes `--import`, run, record that the hash assertion fails, restore.

Residual (re-audit V2, low, recorded): `fingerprint.ts` re-lists each suite's surfaces by hand, so it can drift from the suites. A drift only narrows what the JIT comparison covers; it cannot fake a divergence, and the printed surface lists make it reviewable. The fix the re-audit offered, each cases module exporting its surface runner, would re-scope four admitted suites and is not taken.

Rules: R-effect, R-guide, R-doc, R-nosrc, R-oracle, R-cases, R-test, R-proof, R-check, R-commit (`test(differential): compare the differential outcomes with and without the global Schema JIT`), R-scope.

Check: `bun x vp test test/differential/jit-parity.test.ts && bun x vp test test/bench/bank-jit-parity.test.ts && bun x vp check test/differential/fingerprint.ts test/differential/jit-parity.test.ts test/bench/bank-fingerprint.ts test/bench/bank-jit-parity.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Gate-owned validation (named once; revised: audit `ea39772d` X1, X2)

After the guardrail suites: the gate seats run `bun run check`, `bun run build`, `bun run test`, and `bun x vp test test/differential/ && bun x vp test test/bench/bank-differential.test.ts` passes. The cut-1 check "`git diff --name-only a7a93d5..HEAD -- src bench` prints nothing" is withdrawn: it already listed the bench JIT selector (`3184848`, `964fbf2`) and `6e7724a` before any guardrail suite existed. What the guardrail needs instead:

- the oracle is byte-identical to `a7a93d5`'s `src/`: the receipt-R2 verbatim loop prints nothing, and `bun x vp test test/oracle/frozen.test.ts` passes (ended: the oracle was deleted in `e35151d`);
- a guardrail slice writes nothing under `src/` or `bench/`: `git show --name-only --format= <slice commit> -- src bench` prints nothing for that commit;
- no existing test is weakened, judged per diff: `git show --numstat --format= <slice commit> -- test 'src/*.test.ts' | awk '$2>0'` prints nothing for each phase-3 slice commit, and the phase-wide `git diff --numstat a7a93d5..HEAD -- test 'src/*.test.ts' | awk '$2>0 {print $3}'` lists only reviewed exceptions. At `bd60a0e` it lists `test/bench/run.test.ts` alone (`3184848`, the Mind-approved bench JIT selector, which renamed and extended one case). At `7474d56` it also lists five files that the poker-face audit `32ea357b` inspected, each reviewed: no weakening. They are `src/compile.test.ts` (`dc3e505`, `7f1cff8`), `src/document.test.ts` (`c891d70`, `c3536ff`, `b27de29`), `src/resolve.test.ts` (`07240f0`), `test/bench/cpu-buckets.test.ts` (`f731a8c`), and `test/bench/layers.test.ts` (`f731a8c`).

### Gaps for the Mind (each with the planner's default; status after task `6c66e48a`)

- D1 (step-2 rule operationalization; `phase-3.md`, "The step-2 decision rule"). Closed 2026-11-07: the owner left the wording to the Mind. Mind ruling: Build the custom tokenizer only if, after step 1, effect-xml's typed decode costs more CPU than computis's (`T > C`) and would not without the tokenizer and resolver (`T - K <= C`), measured as CPU per operation in the interleaved A/B on both Bun and Node at `bank-4m` and `bank-64m` with the Schema JIT off (the shipped default). First verdict (`perf3-measure`, `10d347f`, pre-fusion `K`): does not fire; `T > C` but `T - K > C` in every cell, `(T - K) / C` from 1.283 to 2.288 (`docs/rd/performance.md`, "Phase 3 step-2 evaluation"). Amended by Mind ruling after the re-evaluation `a310ba3`: `K` is the CPU per operation of the tokenizer plus the resolver as the shipped decode path runs them (since `7e280b3` the fused resolve-and-collect; measured by the bench rung `typed/resolve-fused`, `30169e6`), because the rule asks whether the tokenizer and resolver the library actually runs stand between it and computis, and the pre-fusion separate resolver no longer runs. Verdict on the optimized code: does not fire; Node `bank-4m` `(T - K) / C` is 1.146 (1.051–1.225) in the case harness and 1.171 (1.070–1.292) in the rung harness, the Bun cells fire or straddle 1, and the rule needs both runtimes (`docs/rd/performance.md`, "Phase 3: step-2 rule re-evaluated on the optimized code"). With the literal pre-fusion `K` the rule would fire at `bank-4m` only: `bank-64m` stays inconclusive (Node in both harnesses, Bun in the rung harness), so overruling `K` alone gives "inconclusive", not "fires" (`docs/rd/performance.md`, "Caveats and what would settle it").
- D2 (oracle form). Ruled: the frozen copy (see "Oracle decision").
- D3 (oracle lifetime). Ruled: `test/oracle/`, `test/differential/vocabulary/`, and the suites that import them are deleted in one commit when the Mind closes phase 3, once the swap's suites have passed; a legitimate behavior change during the phase is a Mind-approved re-freeze commit (re-copy and new hashes), never an edit. Superseded on 2026-11-08 (ruling O1): the oracle and vocabulary copies were deleted in `e35151d`, and the suites were retargeted to compare the fast path with the standard path rather than deleted ([`docs/rd/perf3-oracle-removal.md`](../../rd/perf3-oracle-removal.md)). Accepted loss L1 (ruling O4): the standard path is no longer guarded against drift from `a7a93d5`. `ElementFromString` and direct Schema use never take the fast path (`src/codec.ts:238-240`), so these surfaces compare the standard path with itself and stay only as smoke coverage of it (final audit `4705e240`, R1):
  - corpus (`corpus.test.ts`): the raw-tree decode, the encode of each decoded tree, and the direct `Schema.decodeUnknownExit`;
  - fuzz (`fuzz.test.ts`): the raw-tree decode and the direct decode of the raw tree;
  - generated (`generated.test.ts`): P3, the direct encode and its round-trip decode, and P5's direct encodes of its corruptions;
  - wrapped (`wrapped.test.ts`): `resolved`, `direct`, `directEncode`, and `directEncodeBare`, plus the `fromString` surfaces of the `Schema.decodeTo` roots, which are opaque on both sides;
  - the fingerprint mirrors of each of these (`test/differential/fingerprint.ts`);
  - the fallback rows: a failed fast-path attempt returns the standard path's result (`src/codec.ts:231-236`), so every failing `decodeString` or `fromString` outcome, including `test/decode-string-fast-path.test.ts` "falls back when a leaf rejects", compares the standard path with itself. These rows guard against false accepts only; false rejects stay covered by acceptance R1 and R2 (`test/differential/acceptance.test.ts`, `test/bench/bank-acceptance.test.ts`).

  The test module comments declare the same split (`2dfb1aa`, `45b647d`). A change to the compiled codec, the direct path, `ElementFromString`, or issue translation therefore shows on no differential surface.

  Accepted residual (final audit `4705e240`, R2): no reference to the pre-rewrite resolver remains. The oracle froze at `a7a93d5`, before the resolver rewrite `07240f0`, and carried the old resolver; `test/resolve-collect.test.ts` compares two arrangements of the new machine (`makeMachine`), so it shows that fusion equals the split, not that the rewrite kept behavior. The final audit fuzzed `07240f0^`'s `src/resolve.ts` against `HEAD` with adversarial event arrays: 0 differences in 18,000 runs, for `resolveEvents` and for `resolveEvents` piped into `collect` against `resolveCollect`. Accepted residual: a future resolver regression is caught only by the hand rows in `src/resolve.test.ts`. The probe (`work/audit-4705e240/probe.ts`, gitignored) is not promoted.

- D4 (`bank-64m`). Ruled: excluded from Vitest; the bench witness rows' output checks cover it.
- D5 (JIT mode of the suites). Settled by F7.7: the suites run in the process default, and `perf3-diff-noeval` runs the same inputs a second time and asserts equal fingerprints (audit X4). Rev2 (M3): the second run preloads the application's global JIT import instead of disallowing code generation, because with no library JIT a no-eval run equals the default.
- D6 (baseline measurement). Dispatched by the Mind as task `048d51ee` (`perf3-baseline`), not cut here. Its result files are the "before" every codec measurement reads. Superseded by the owner directive to measure under load (`work/owner-directive-perf3-loaded.md`): the task stopped with nothing committed, and `perf3-measure` (task `cf5f437e`) runs `bd60a0e` as the OLD side in the same interleaved rounds as NEW.

### Notes

- Every suite passes at the cut commit by construction (both sides are `a7a93d5`'s code); R-proof is what shows each one can fail.
- `test/oracle/` adds 7,260 lines (`wc -l` of the 16 files at `a7a93d5`) to lint and the type check.
- The step-1 slices (cut 2) write `src/compile.ts`, `src/plan.ts`, `src/resolve.ts`, `src/codec.ts`, and `src/channel.ts` plus new modules; no guardrail slice writes them, so cut 2's early slices run beside the guardrail track (gap Q2).

## Cut 2: the step-1 codec track

- answer: sliced (task `6c66e48a`), from the settled [Design](phase-3.md#design-settled-2026-11-06): spikes `builder.md`, `errors.md`, `jit.md`, `encode.md`, and head-cto rulings F1-F9 and F7.1-F7.7 (task `8aa826d9`). Owner questions take their defaults and are not sliced (no `jit: false`; AOT later).
- revised: task `d390991c` (rev2) after merit ruling `16f993dd` and audits `5d57e2b4`, `e2d82410`; see [Revision rev2](#revision-rev2-task-d390991c).
- longest chain from `9eccea0`: perf3-builder, perf3-fast-decode, perf3-wire-decode-string, perf3-wire-encode, perf3-checked-wrappers, perf3-witness, perf3-reprofile (7 steps over w2-w7 below; w5 runs as two serial steps).
- the prototypes the briefs cite live under `work/spikes/` (machine-local, gitignored): `perf3-builder/structural.ts` (builder and structural codec), `perf3-encode/proto.ts` (structural encode and writer), `perf3-jit/introspect.ts` (counting generated functions; `perf3-diff-noeval` counts the same way), `perf3-errors/cases.ts`. Read them as references, not as code to copy unreviewed.

### Receipts (run on `bd60a0e`)

C1. Every Schema decode or encode of a root or record codec in `src/` is one of three call sites; the three wiring slices cover exactly these (`src/document.ts` reaches them through `decodeString` and `encodeString`, `:93`, `:99`):

```console
$ grep -n 'Schema\.\(decodeUnknownEffect\|decodeEffect\|encodeEffect\|encodeUnknownEffect\)' src/*.ts | grep -v '\.test\.ts' | grep -v ':[0-9]*: \*'
src/channel.ts:312:  const decodeRecord = Schema.decodeUnknownEffect(def);
src/codec.ts:249:    const value = yield* Schema.decodeUnknownEffect(def)(element, parseOptions).pipe(
src/codec.ts:376:    const element = yield* Schema.encodeEffect(def)(value, parseOptions).pipe(
```

C2. Superseded by C6 (M3): there is no `src/jit.ts`, and no `src/` module may import the JIT. The string grep this receipt used would also match a JSDoc mention (audit `5d57e2b4`, cross-cutting P3).

C3. The private helpers cut 2 exports without changing them:

```console
$ grep -n '^const markerAt\|^const isBlank\|^const GENERIC\|^const isData' src/plan.ts src/compile.ts
src/plan.ts:118:const markerAt = (ast: SchemaAST.AST): Marker | undefined => {
src/compile.ts:47:const isBlank = (text: string): boolean => {
src/compile.ts:73:const GENERIC = "*" as const;
src/compile.ts:451:const isData = (plan: Plan, name: string): boolean =>
$ grep -n '^const prefixFor\|^const spell \|^const declarationFor\|^const spellAttributes' src/resolve.ts
1085:const prefixFor = (
1107:const spell = (scope: PrefixMap, clarkName: string, isAttribute: boolean): string | undefined => {
1136:const declarationFor = (
1196:const spellAttributes = (
```

C4. The entry points the design relies on (revised by M3 and M5): the `Tokenizer` reference (`src/tokenizer.ts:131`; `defaultTokenizer` at `:114` is not on the public index, `src/xml-schema.ts:36`); the spans `xml.decodeString` (`src/codec.ts:238`) and `xml.encodeString` (`:366`). No identity check on `defaultTokenizer` and no JIT entry point is used any more.

C5. The bench cases the witness reads: `effect-xml/typed-decode`, `effect-xml/encode-typed` (`bench/cases/effect-xml-typed.ts:216`, `:223`), `effect-xml/stream` and `effect-xml/stream/positions` (`bench/cases/effect-xml-stream.ts:76-77`), `computis-effect-xml/typed-decode` and `computis-effect-xml/encode-typed` (`bench/cases/computis-effect-xml.ts:185-186`).

C6 (rev2, M3 and audit `5d57e2b4` cross-cutting P3). The swap gate's JIT check greps the import specifier, so a JSDoc mention cannot trip it. It prints nothing for `src/` at `9eccea0`, and the same pattern finds both bench preloads, so it matches the side-effect import form it guards:

```console
$ grep -rnE "['\"]effect/schema/SchemaJITCompiler(/enable)?['\"]" src | wc -l
       0
$ grep -rnE "['\"]effect/schema/SchemaJITCompiler(/enable)?['\"]" bench | sort
bench/harness/jit/noeval.ts:12:import "effect/schema/SchemaJITCompiler/enable";
bench/harness/jit/on.ts:5:import "effect/schema/SchemaJITCompiler/enable";
```

C7 (rev2, M1 and audit `5d57e2b4` item 4). The builder's refusals are derived from today's decode failure sites, not paraphrased. The decode-side sites are every `invalid(` call under a `decode*` header, plus the two Schema-level rejections in the element codec. At `9eccea0`:

```console
$ grep -n '^const \(decode\|encode\)[A-Za-z]* = \|return yield\* invalid(' src/compile.ts
121:const decodeEmpty = Effect.fnUntracedEager(function* fromEmpty(plan: Plan, children: Children) {
129:    return yield* invalid(
147:const decodeText = Effect.fnUntracedEager(function* fromText(
155:    return yield* invalid(
180:const decodeElements = Effect.fnUntracedEager(function* fromElements(
192:        return yield* invalid(
229:      return yield* invalid(
242:      return yield* invalid(
277:const encodeText = Effect.fnUntraced(function* toText(
285:    return yield* invalid(
311:const encodeElements = Effect.fnUntraced(function* toElements(
326:      return yield* invalid(
340:    return yield* invalid(
367:const encodeMixed = Effect.fnUntraced(function* toMixed(
375:    return yield* invalid(
405:const decodeContent = (plan: Plan, slots: ReadonlyMap<string, ChildPlan>, children: Children) => {
428:const encodeContent = (plan: Plan, value: TargetEncoded) => {
480:const decodeElement = (plan: Plan) => {
495:        return yield* invalid(
521:const encodeElement = (plan: Plan) =>
529:        return yield* invalid(
542:        return yield* invalid(
$ grep -n 'Schema.Union(\|wireElement(' src/compile.ts
568:    children: Schema.Array(Schema.Union([Schema.String, ResolvedElementSchema])),
655:  return wireElement(Schema.String.check(guard)).pipe(
691:  return Schema.Array(Schema.Union(content.open ? [...items, openItem(plan, content)] : items));
743:  const from = wireElement(Schema.Literal(plan.name));
```

The `invalid(` sites under `decodeEmpty`, `decodeText`, `decodeElements`, and `decodeElement` are six decode refusals; the sites under `encode*` headers are encode failures and not builder rows. `:568` accepts every collected child, so it rejects nothing. `:655` is the open-`mixed` member guard: the builder routes a declared member's element to that member, so a failing member fails the structural decode, not the builder. That leaves eight rows. The property: every decode-side site and the two Schema-level rejections map to exactly one row, and a decode site added later is a row the builder lacks (re-run both greps).

| Row | Today's rejection (site at `9eccea0`)             | Builder refusal                                                                                  |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| B1  | `wireElement(Schema.Literal(plan.name))` (`:743`) | the root's Clark name is not `plan.name`                                                         |
| B2  | `decodeElement` (`:495`)                          | an attribute neither in the declared attribute map nor admitted by `isData`                      |
| B3  | `decodeEmpty` (`:129`)                            | `empty` content holding an element child, or a string child that is not `isBlank` (audit item 4) |
| B4  | `decodeText` (`:155`)                             | `text` content holding an element child                                                          |
| B5  | `decodeElements` (`:192`)                         | `elements` content holding a string child that is not `isBlank`                                  |
| B6  | `decodeElements` (`:229`)                         | closed `elements` content holding a child `slotsOf` does not name                                |
| B7  | `decodeElements` (`:242`)                         | a second child for a `one` or `optional` slot                                                    |
| B8  | the items `Schema.Union` of `mixedField` (`:691`) | closed `mixed` content holding an element child that names no member (audit item 4)              |

### Hot files (R-src)

| File                                          | Written by (in this order)                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/compile.ts`                              | `perf3-slot-predicate` (landed `7421796`: registers its link; exports `GENERIC`, `isData`, `isBlank`), then `perf3-builder` (exports `slotsOf` and the declared attribute map) |
| `src/plan.ts`                                 | `perf3-slot-predicate` only (landed; exports `markerAt`)                                                                                                                       |
| `src/resolve.ts`                              | `perf3-writer-events` only (landed `9eccea0`; exports the spelling helpers)                                                                                                    |
| `src/structural-slot.ts`, `src/structural.ts` | their slices (landed `7421796`, `6cf5d58`), then `perf3-checked-wrappers`                                                                                                      |
| `src/fast-decode.ts`                          | `perf3-fast-decode`, then `perf3-checked-wrappers`                                                                                                                             |
| `src/fast-encode.ts`                          | `perf3-fast-encode`, then `perf3-checked-wrappers`                                                                                                                             |
| `src/codec.ts`                                | `perf3-wire-decode-string`, then `perf3-wire-encode`                                                                                                                           |
| `src/channel.ts`                              | `perf3-wire-channels` only                                                                                                                                                     |
| `src/document.ts`                             | none: `fromString` reaches the fast path through `decodeString` and `encodeString`                                                                                             |
| `src/issue.ts`                                | none: errors come from the fallback (F1 (a))                                                                                                                                   |

Everything else is a new file, so the early waves are wide.

### Standing codec rules

Every codec brief is bound by R-effect, R-guide, R-doc, R-src, R-test, R-proof, R-check, R-commit, and R-scope; the wiring briefs add R-trace. Rev2 rules for every codec brief: no JIT enable and no JIT import (M3); only a Schema failure (`Fail`), a refusal, or an `XmlError` from `encodeString` sends a fast attempt to the fallback, and defects and interruption propagate (M2); "same value" is `toStrictEqual` plus equal own-key order, checked with `JSON.stringify` equality in `src/` tests and with the harness's `valueSummary` in `test/differential/` (M6). A test that needs an opaque root or slot uses `decodeTo`, which stays opaque; a `.check` stays opaque only until `perf3-checked-wrappers` (M4). Focused tests sit beside their module (`src/<module>.test.ts`); tests that compose several modules or read the QTI corpus sit in `test/`. Library tests are Vitest with `@effect/vitest`.

### perf3-jit-helper: retired (M3)

- status: landed `aa8309a` (task `4f489a19`), then reverted by `perf3-revert-jit` (`ea23128`). The library enables no JIT (merit ruling M3, edit S1), so `src/jit.ts` would have no caller. Audit `5d57e2b4` found that its first done_when row could not fail without the memo; that finding is moot with the slice retired.

### perf3-revert-jit: Revert the per-AST JIT helper (M3)

- outcome: `src/jit.ts` and `src/jit.test.ts` are deleted in one path-limited commit, and nothing imports `src/jit.ts`.
- write_scope: `src/jit.ts`, `src/jit.test.ts` (both deleted)
- deps: none
- risk: low
- integrable: yes
- status: landed `ea23128` (task `f7f7a062`, dispatched by the Mind outside this file). Before the delete, only `src/jit.test.ts` imported `src/jit.ts`; `src/index.ts` never exported it, and `bench/harness/jit.ts` is a different file. `bun x vp test src/codec.test.ts` passed 37/37.
- commit: `revert: drop the per-AST JIT helper` (body cites `aa8309a` and ruling `16f993dd` M3).

### perf3-slot-predicate: The structural-slot predicate (F4, guard F7.2)

- outcome: `src/structural-slot.ts` exports `structuralPlan(schema: Schema.Top): Plan | undefined`, the F4 gate. It returns the schema's Plan only when its AST is unmodified `compile()` output modulo annotations: the marker is on the top node (`markerAt`), the top node has no `checks`, its `encoding` is exactly one link and that link is `compile`'s own (registered by `compile` in a module `WeakSet` the new module exports), and the top node's annotations carry no `parseOptions`. A marked `Suspend` (`XmlSchema.suspend`, `src/dsl.ts:339`) is unwrapped by forcing its thunk once, memoized, and the result is tested the same way. Anything else returns `undefined` (opaque). `.annotate` and `Schema.brand` stay structural; `.check`, `decodeTo`, and any transformation are opaque. It is not `planOf`: `planOf` sees through `.check` and `decodeTo` (`src/plan.ts:138-187`).
- write_scope: `src/structural-slot.ts` (new), `src/structural-slot.test.ts` (new), `src/compile.ts` (register the link `compile` builds, read back from the codec's `ast.encoding[0]` before `.annotate`; export `GENERIC`, `isData`, `isBlank`; no other change), `src/plan.ts` (export `markerAt`; no other change)
- deps: none
- red_first: yes (the `.check` and `decodeTo` rows fail against a `planOf`-based draft)
- risk: high (a wrong "structural" answer lets the fast path skip a user's check or transformation)
- integrable: yes (no caller yet; the registry writes no annotation and changes no AST)
- non_goals: the structural codec, the builder; any change to `planOf` or `markerOf`; treating annotations other than `parseOptions` as opaque (gap Q3).
- done_when:
  - a table test over each wrapper, on an element and on a `suspend` reference to it: bare `Element`, `.annotate({ title })`, `Schema.brand`, and `XmlSchema.suspend` give the plan; `.check(...)`, `.pipe(Schema.decodeTo(Model, ...))`, `.annotate({ parseOptions: { errors: "all" } })`, and `Schema.String` give `undefined`; for the `.check` and `decodeTo` rows the test also asserts `planOf` returns a plan, so the predicate is shown not to be `planOf`;
  - the identity `structuralPlan` reads survives `.annotate` and `Schema.brand` (asserted, not assumed: if Effect copies the link, register what does survive and say so in the report);
  - `test/wire-fast-path.test.ts` is unedited and green.
- check: `bun x vp test src/structural-slot.test.ts && bun x vp test src/compile.test.ts && bun x vp test test/wire-fast-path.test.ts && bun x vp check src/structural-slot.ts src/structural-slot.test.ts src/compile.ts src/plan.ts`
- commit: `perf(codec): add the structural-slot predicate for wrapped element codecs`
- status: landed `7421796` (task `06af9c65`; the Mind reconciled four files in scope, red shown, `test/wire-fast-path.test.ts` unedited and green). Dispatched with four amendments in its task body, recorded here, not re-scoped:
  1. M4: it ships strict. Any `.check`, `Schema.fromBrand` included, makes the slot opaque at today's speed; `.annotate` and `brand` stay structural; `decodeTo` is opaque. `perf3-checked-wrappers` relaxes checks later (gap Q5).
  2. Audit `5d57e2b4` item 1 (a): Effect 4.1.2 throws "Cannot add checks to Suspend" (`node_modules/effect/src/SchemaAST.ts:4040`, `:4410`), so the suspend rows are `suspend(name, () => Leaf.check(...))` and `suspend(name, () => Leaf.pipe(Schema.decodeTo(...)))` for the thunk result, with `.annotate` and `brand` applied to the suspend node itself.
  3. Audit item 1 (b): the predicate tests the `Suspend` node itself for an encoding link and for annotations before it unwraps the thunk. `Schema.String.pipe(Schema.decodeTo(suspendRef, t))` appends a link to the `Suspend` node, and `.annotate` on a suspend writes to that node.
  4. M3: it neither imports nor calls `src/jit.ts`.

  Information (audit item 1, no change): Effect 4.1.2 has no runtime reader of a `parseOptions` annotation, so gap Q3's default is exact but makes such codecs opaque for no behavioral reason.

### perf3-decisions: Record the JIT policy and the fallback consequences (F8, F7.6)

- outcome: a `docs/rd/decisions.md` entry (brief Step 1 item 6 requires the recorded policy; `phase-3.md` Non-goals require a recorded justification for any process-wide side effect). It records F8 (a) with its evidence (`jit.md`: per-AST equals global within noise; nothing installed for unrelated schemas; no import-time effect; no-eval degrades to the interpreter at no cost; `@computis/effect-xml` 0.4.0 does the same), every side effect (the process-wide `compilerAdaptersEnabled` flag, measured no-op; compiled entries in Effect's shared registry for user leaf ASTs reachable from the library's codecs, so an application's own standalone decode of such a leaf afterwards runs the compiled entry; lazy `new Function` calls; one failed support probe, and possibly one CSP violation report, under a strict CSP), the rejected options (global import; documented opt-in), and the owner's later options with their defaults (`jit: false`: none in phase 3; AOT install hook: later, it needs a public hook exposing structural ASTs). It also records F1 (a) and F5's fallback, F3's scope (direct Schema use keeps today's codec), F9, and F7.6: a user leaf transformation, or an effectful or service-using leaf, may run twice on a failed decode or encode; not a stated contract, accepted.
- write_scope: `docs/rd/decisions.md` (one new section; no other section edited)
- deps: none
- red_first: no (documentation)
- risk: low
- integrable: yes (it records a ruling; the wiring slices make it true)
- non_goals: `docs/rd/performance.md` (the witness and re-profile slices own it); JSDoc (the wiring slices).
- done_when: the section names F8 with every side effect above and the evidence paths; each claim cites `docs/rd/perf3-spikes/jit.md`, `encode.md`, `builder.md`, or task `8aa826d9`; `git show --stat --format= HEAD` lists only `docs/rd/decisions.md`.
- check: `bun x vp check docs/rd/decisions.md` (formatting) and `grep -n 'F8\|compilerAdaptersEnabled\|run twice' docs/rd/decisions.md` shows the entry.
- commit: `docs(rd): record the phase-3 Schema JIT policy and its side effects`
- status: landed `30cdb29` (task `c9c776e5`; audit `5d57e2b4`: admitted). Its F8, F5, F1 (a) trigger, and F7.6 parts are superseded by the section "Phase-3 policy revised (task `16f993dd`)" that rev2 (`d390991c`) appends to `docs/rd/decisions.md`, with a one-line pointer at the top of this slice's section. The new section also folds in the audit's P3 wording: leaves run twice when the fast attempt fails and the fallback then succeeds, and a tokenizer's `encodeString` can run twice.

### perf3-structural-codec: One structural Schema codec per Plan (F3, F9)

- outcome: `src/structural.ts` exports `structuralOf(plan: Plan)`, a `Schema.Codec` whose Type is the element codec's Type and whose Encoded side is the plain object the builder emits. It is cached per Plan in a module `WeakMap`, built lazily, and written to no public AST. Fields, with the same keys as `compile`'s target Struct (`src/compile.ts:714-762`): attributes and `text` (`"$text"`) through `Schema.toCodecStringTree(schema)`, exactly as `compile`; an `elements` slot is the child's `structuralOf` when `structuralPlan(slot.schema)` gives a plan and the slot's own schema otherwise (opaque: Encoded is a `ResolvedElement`), wrapped in `Schema.Array` for `many` and `Schema.optionalKey` for `optional`; open `elements` adds `GENERIC` (`"*"`) as `Schema.Array(ResolvedElementSchema)`; `mixed` is `"$children"`: `Schema.Array(Schema.Union([...]))` of Structs tagged by a `_tag` literal (`{ _tag: "$text", text }`, `{ _tag: <wire>, [ITEM_VALUE]: <member> }` with the member structural or opaque by the same predicate, and for open content `{ _tag: "*", element }`); `data` uses `Schema.StructWithRest` with the same `Schema.Record(Schema.TemplateLiteral([DATA_PREFIX, Schema.String]), Schema.toCodecStringTree(plan.data))` as `compile`; recursion goes through `Schema.suspend` with the cache seeded before the children are built. No `onExcessProperty`, no `encodingChecks` (F9).
- write_scope: `src/structural.ts` (new), `src/structural.test.ts` (new)
- deps: perf3-slot-predicate
- red_first: yes (the value-equality rows fail before the module exists; the opaque-slot row fails against a draft that recurses through `planOf`)
- risk: medium (a Type that differs from the element codec's Type is a wrong value)
- integrable: yes (no caller yet)
- non_goals: the builder; JIT enable (`perf3-fast-decode`, `perf3-fast-encode`); any fast path for direct use of an element codec.
- done_when:
  - for a small vocabulary in the test that has each shape (attributes, `data-*`, `text`, `one`/`optional`/`many` slots, open `elements`, `mixed` closed and open, `suspend`, a namespaced child, a `.check`-wrapped child and a `decodeTo`-wrapped member): decoding a hand-built plain object with `structuralOf(plan)` gives a value `toStrictEqual` to `Schema.decodeUnknownEffect(def)` of the matching `ResolvedElement`, and encoding that value gives back the plain object;
  - the wrapped child's value is the user's `Model` (opaque slot), and a value its `.check` rejects fails the structural decode;
  - `def.ast` and its annotations are reference-equal before and after `structuralOf(planOf(def))`.
- check: `bun x vp test src/structural.test.ts && bun x vp check src/structural.ts src/structural.test.ts`
- commit: `perf(codec): derive one structural Schema codec per element plan`
- status: landed `6cf5d58` (task `096852e8`), as briefed. Follow-ups from the seat (mail `a1c78477`):
  1. The structural open-`mixed` item `{ _tag: "*", element }` has no guard against a declared member's name, while `compile`'s `openItem` has one, so such an item would encode structurally where today's codec fails. Closed downstream: `perf3-fast-encode` refuses it before the structural encode, `perf3-wire-encode` has its fallback row, and `perf3-diff-generated` P5 adds the corruption.
  2. Recorded, no change: the `$children` union lists members in author order, not `compile`'s text, named, then `suspend` order. The `_tag` literals are disjoint, so selection is unaffected.

  M6 key order is not asserted by its rows; the `perf3-fast-decode`, `perf3-builder`, and `perf3-acceptance` comparators assert it. The audit's optional rows (an empty `"$text"`, an empty mixed text item) are carried by `perf3-fast-decode`.

### perf3-builder: The plan-driven builder over collected records (F6, F9, M1, M6)

- outcome: `src/builder.ts` exports `build(plan: Plan, element: ResolvedElement): unknown`, plain JavaScript with no Schema and no Effect, compiled once per Plan (module `WeakMap`). It returns the plain encoded object that `structuralOf(plan)` (`src/structural.ts`, landed `6cf5d58`) decodes, or `undefined` (a refusal). It reads its rules from the sources `decodeElement` itself uses (M1), exported from `src/compile.ts` and never restated: the declared attribute map (Clark name to struct key, built once per plan), `slotsOf`, `isData`, `isBlank`, `GENERIC`, and for `mixed` the plan's own `content.members`. Its refusals are exactly receipt C7's rows B1-B8. It emits raw strings, reshaped under the keys `structuralOf` declares, in today's key order (M6): attributes in the element's attribute order (declared ones under their struct keys, `data-*` ones under their own names), then the content keys; `"$text"` as the joined string children; slot keys in `content.children` order, an array for `many` and the key omitted for an absent `optional`; `"*"` holding the raw `ResolvedElement`s of open `elements` content in document order; `"$children"` items in document order, whitespace runs kept, with an undeclared element of open `mixed` content as `{ _tag: "*", element }`. An opaque slot or member (`structuralPlan` gives `undefined`) receives the raw `ResolvedElement`. It never emits a key the structural Struct does not declare (F9), runs no user code, and never throws on any `ResolvedElement`.
- write_scope: `src/builder.ts` (new), `src/builder.test.ts` (new), `src/compile.ts` (export `slotsOf`; move the attribute map `decodeElement` builds (`:481` at `9eccea0`) into an exported function that `decodeElement` then calls; no other change)
- deps: perf3-slot-predicate (landed), perf3-structural-codec (landed: the keys the builder emits)
- red_first: yes (the refusal table and the round-trip rows fail before the module exists)
- risk: high (a builder that accepts a shape today rejects is a false accept, which the fallback cannot see; F7.1)
- integrable: yes (no caller yet)
- non_goals: error messages or positions (F1 (a): the builder only refuses); fusing into `collect` (F6); Schema validation of leaf strings; the open-`mixed` declared-member guard on encode (`perf3-fast-encode`); a row pinning a `.check`-wrapped slot as opaque (`perf3-checked-wrappers` makes it structural, M4; use `decodeTo` for the opaque row).
- done_when:
  - a refusal table with exactly one row per receipt C7 row, B1 to B8, each naming its row id: a `ResolvedElement` that today's `Schema.decodeUnknownEffect(def)` rejects for that reason, and `build` returns `undefined` for it;
  - an acceptance table over the shapes `src/structural.test.ts` uses (attributes, `data-*`, `text` including empty text, `one`, `optional` absent and present, and `many` slots, a namespaced child, open `elements`, `mixed` closed and open with whitespace runs and an empty text run, `suspend`, and a `decodeTo`-wrapped opaque slot), each `build` result equal to a hand-written expected object by `toStrictEqual` and by `JSON.stringify` equality (key order, M6);
  - for every element of the acceptance table, `Schema.decodeUnknownEffect(structuralOf(plan))(build(plan, element))` gives a value equal to `Schema.decodeUnknownEffect(def)(element)`'s by `toStrictEqual` and by `JSON.stringify` equality;
  - for every built object in the test, its own keys at every level are a subset of the keys the plan declares (F9);
  - `src/compile.test.ts` and `test/wire-fast-path.test.ts` pass unedited (the export and the extraction change no behavior).
- sanity: re-run receipt C7's two greps; a decode-side site they list that has no row is a gap to report, not to fill silently.
- check: `bun x vp test src/builder.test.ts && bun x vp test src/compile.test.ts && bun x vp test test/wire-fast-path.test.ts && bun x vp check src/builder.ts src/builder.test.ts src/compile.ts`
- commit: `perf(codec): build the plain encoded object from collected records`
- status: landed `c8ec6ae`. Aggregate audit `7aa62827` B1 (mixed members that share a wire tag or Clark name decode to a different member's value) traced to its by-name member routing and to the writer; repaired by `dae32dd`, which makes ambiguous mixed content opaque in `src/structural-slot.ts`, so the builder never sees it.

### perf3-writer-events: The plan-driven writer to events (F5, events half)

- outcome: `src/writer.ts` exports `writerOf(plan: Plan, prefixes: PrefixMap)`, which precomputes per (plan, in-scope bindings) each element's spelled name, `xmlns` declarations, attribute spellings, and close tag, and `toEventsFrom(writer, plain, { declaration })`, which returns the `Xml.Event[]` today's `toEvents(element, { declaration, prefixes })` (`src/resolve.ts:1325`) returns for the element today's `Schema.encodeEffect(def)` produces, or `undefined` (a refusal). It uses the `prefixFor`, `spell`, `declarationFor`, and `spellAttributes` rules of `src/resolve.ts`, exported unchanged, not copies. It writes attributes (namespaced and `data-*`), `text`, `elements` slots (structural children as nested plain objects; opaque slots and `"*"` values are `ResolvedElement`s written with today's generic rules), and `$children` items. It refuses a leaf value that is not a string (the `typeof` guard `encodeElement` applies today; encode.md recommendation 5) and an attribute namespace no prefix spells (today `UnmappedNamespace`; the fallback reports it). Plain JavaScript, no Schema, no Effect.
- write_scope: `src/writer.ts` (new), `src/writer.test.ts` (new), `src/resolve.ts` (export the four helpers; no other change)
- deps: perf3-slot-predicate
- red_first: yes (event equality rows)
- risk: medium
- integrable: yes (no caller yet)
- non_goals: text output (`perf3-writer-text`); escaping; illegal characters; tokenizer choice.
- done_when: for the same small vocabulary shapes as `perf3-structural-codec`, plus a root and child in different namespaces and an open element carrying an attribute in an undeclared namespace, `JSON.stringify(toEventsFrom(...))` equals `JSON.stringify` of today's events for the same value, with `declaration` true and false; a non-string leaf and an unspellable attribute namespace give `undefined`.
- check: `bun x vp test src/writer.test.ts && bun x vp test src/resolve.test.ts && bun x vp check src/writer.ts src/writer.test.ts src/resolve.ts`
- commit: `perf(codec): write events from the plain encoded object through the plan`
- status: landed `9eccea0` (task `c8ec11a2`), dispatched as written above plus the M5 note (no direct text writer; the events always go to `tokenizer.encodeString()`; do not copy upstream escaping). Audit `5d57e2b4` item 5's P3 notes were not in its task body. The landed `toEventsFrom` JSDoc names `spellAttributes` rejections and wrong-shape values as refusals, and `perf3-fast-encode` checks them downstream: its `xmlns`-spelled and same-qualified-name rows, and its empty `$text` row. A "non-element in an element position" fails the structural encode first (`"*"` is `Schema.Array(ResolvedElementSchema)`), so it falls back whatever the writer does.

### perf3-fast-decode: The fast decode attempt (F1 (a), F3, M2, M6)

- outcome: `src/fast-decode.ts` exports `attemptDecode(def)`, returning `(element: ResolvedElement, parseOptions?: SchemaAST.ParseOptions) => Effect<Option<Def["Type"]>, never, Def["DecodingServices"]>`. When `structuralPlan(def)` is `undefined` (an opaque root) it gives `None` and runs no user code. Otherwise it builds (`build`), and a refusal gives `None` with no user code run. It then runs `Schema.decodeUnknownEffect(structuralOf(plan))(plain, parseOptions)` inside the caller's Effect, with the caller's services and environment (an async leaf suspends as today): success gives `Some(value)`; a Schema failure (`Fail`, the `SchemaError` channel) gives `None`; a defect or an interruption propagates unchanged and is not caught (M2 outcome rule; audit `5d57e2b4` item 7 recorded "Defects propagate" as intended). The caller's `parseOptions` pass through unchanged (F9). No JIT enable and no JIT import (M3).
- write_scope: `src/fast-decode.ts` (new), `test/fast-decode.test.ts` (new)
- deps: perf3-structural-codec (landed), perf3-builder
- red_first: yes
- risk: medium
- integrable: yes (no caller yet)
- non_goals: wiring into any surface; positions or errors; checks carried onto the structural node (`perf3-checked-wrappers`).
- done_when:
  - over the README `ChoiceInteraction` example and every QTI corpus file with `AssessmentItem` (each root from `decodeTree`): `Some(value)` for every file today decodes, with `value` equal to today's decode value by `toStrictEqual` and by `JSON.stringify` equality (M6); `None` for every file today rejects;
  - the audit's optional shapes (`5d57e2b4` item 3): an element with an empty `"$text"`, and a `mixed` element with an empty text item, each give `Some` equal to today's value;
  - `None` for a `decodeTo`-wrapped root (opaque; a `.check` root is not the opaque row, because `perf3-checked-wrappers` makes it structural);
  - with `{ errors: "all" }` and with `{ onExcessProperty: "error" }`, the same `Some`/`None` split as with default options;
  - the outcome rule, each row with a leaf that counts its runs: a leaf transformation that fails gives `None` and the leaf ran once; a leaf that dies gives an attempt that dies with the same defect and the leaf ran once; a leaf that interrupts gives an interrupted attempt; a leaf that reads a service the test provides around the attempt gives `Some` (the caller's environment is used);
  - a document `build` refuses (row B2, an undeclared attribute) with a counting leaf gives `None` and the leaf ran zero times.
    Report the counts.
- check: `bun x vp test test/fast-decode.test.ts && bun x vp check src/fast-decode.ts test/fast-decode.test.ts`
- commit: `perf(codec): attempt a typed decode through the builder and the structural codec`
- status: landed `926c3e7`.

### perf3-writer-text: dropped (M5)

- status: dropped by merit ruling `16f993dd` M5 (edit S2). Encode always emits events into the current tokenizer's `encodeString()`, so no module writes XML text directly. Audit `5d57e2b4` item 6 (the direct writer skipped upstream's name check, an encode false accept) is moot; its three invalid-name rows move to `perf3-fast-encode`, where the events path must still give `None`.

### perf3-fast-encode: The fast encode attempt (M2, M5)

- outcome: `src/fast-encode.ts` exports `attemptEncode(def, options?: EncodeOptions)`, returning `(value: Def["Type"], parseOptions?: SchemaAST.ParseOptions) => Effect<Option<string>, never, Def["EncodingServices"]>`. An opaque root gives `None`. Before the structural encode, a value holding an open-`mixed` item `{ _tag: "*", element }` whose element's Clark name is a declared member of that `mixed` content gives `None`: today's `openItem` guard (`src/compile.ts:641-655` at `9eccea0`) rejects it on encode, and the structural codec has no such guard (structural-codec follow-up 1, mail `a1c78477`). The check reads the member names from the plan (`content.members`) and visits only the open-`mixed` positions the plan has. Then `Schema.encodeEffect(structuralOf(plan))(value, parseOptions)` runs inside the caller's Effect: a Schema failure (`Fail`) gives `None`, and a defect or an interruption propagates unchanged (M2). Then `toEventsFrom(writerOf(plan, prefixes), plain, { declaration })` (`src/writer.ts`, landed `9eccea0`, with the prefixes today's `encodeString` passes to `toEvents`): a refusal gives `None`. Then the events go into the current `Tokenizer`'s `encodeString()`, read with `yield* Tokenizer`, default or provided, with no identity check (M5), and the text is collected; an `XmlError` gives `None`. No JIT enable and no JIT import (M3).
- write_scope: `src/fast-encode.ts` (new), `test/fast-encode.test.ts` (new)
- deps: perf3-structural-codec (landed), perf3-writer-events (landed)
- red_first: yes
- risk: medium (a fast encode must never yield text where today's encode fails)
- integrable: yes (no caller yet)
- non_goals: wiring into `encodeString`; error translation; a direct text writer (M5).
- done_when:
  - for the README value, the README value with an empty `$text`, and the decoded values of every QTI corpus file `AssessmentItem` decodes: `Some(text)`, byte-identical to today's `encodeString` text, with `declaration` true and false;
  - with a provided tokenizer that is a spread copy of `defaultTokenizer` wrapping `encodeString` with a call counter, the text is the same and the counter is 1 (every tokenizer runs exactly once on the fast path);
  - `None`, each beside an assertion that today's `encodeString` fails on the same value: a value its leaf schema rejects on encode; a value holding U+0000 (an `XmlError` from `encodeString`); an attribute in a namespace no prefix spells; an open-`mixed` `*` item named after a declared member (mail `a1c78477`); a `*` element whose local name is not an XML name, an open element with an attribute name that is not an XML name, and a `data-` key holding a space (audit `5d57e2b4` item 6: these reach `encodeString` and fail its name check); an open element with an attribute spelled `xmlns`, and one with two attributes that spell to the same qualified name (audit item 5, the writer's `spellAttributes` refusals); a `decodeTo`-wrapped root;
  - a leaf encode that dies gives an attempt that dies with the same defect, and the leaf ran once.
- check: `bun x vp test test/fast-encode.test.ts && bun x vp check src/fast-encode.ts test/fast-encode.test.ts`
- commit: `perf(codec): attempt a typed encode through the structural codec and the tokenizer`
- status: landed `e162f68`. Follow-ups: `35cfbcb` (`perf3-fix-attempt-tests`: the attempt rows compare with the frozen oracle's standard path) and `390bdca` (the duplicate-wire guard that `dae32dd` made unreachable is dropped; re-review `b5643b60` r4).

### perf3-wire-decode-string: `decodeString` takes the fast path, today's decode as fallback (F1 (a), F3, M2)

- outcome: `decodeString` (`src/codec.ts:237-260`) first runs `attemptDecode(def)(element, parseOptions)` on the root `readRoot` collected. `Some(value)` is the result. `None` runs today's line unchanged, `Schema.decodeUnknownEffect(def)(element, parseOptions)` with its `attachPosition`/`toDecodeError` mapping, and that outcome, success or error, is the result (authoritative). A defect or an interruption from the attempt propagates (M2). The success debug log and the span stay as they are. `fromString` decode reaches it through `src/document.ts:93`. `attemptDecode` returns only an `Option`, so `None` cannot tell an opaque root from a decline: `decodeString` computes `structuralPlan(def)` (`src/structural-slot.ts:63`) once per factory call, beside `attemptDecode(def)`, and when it is `undefined` runs no attempt and records `"element"` (rev3, audit `c972014c` P3). The `xml.decodeString` span gains `xml.codec`: `"structural"` (fast path), `"fallback"` (attempted, then today's decode), or `"element"` (opaque root) (gap Q1); when it is `"fallback"`, also `xml.fallback`: `"success"` or `"failure"`, the fallback's outcome (M2). The function's JSDoc states the double-run rule in consumer words, with no F- or M-numbers (head-cto S5), for example: "This decode first tries a faster path. When that path declines the document, or a leaf schema rejects a value on it, the decode runs again the standard way and returns that result, success or failure. A document the faster path declines for its shape runs no leaf code before the standard decode. When a leaf rejects a value on the faster path, the leaf transformations can run on both paths, and a leaf whose result varies between runs can fail the first time and succeed the second; the second result is returned. A defect or an interruption is not retried. A root wrapped with `decodeTo` or another transformation always decodes the standard way. Only `decodeString`, `fromString`, `decodeSchema`, and `decodeSchemaString` take the faster path; decoding an element codec directly with Schema, or inside your own Schema, runs the standard way."
- write_scope: `src/codec.ts`, `test/decode-string-fast-path.test.ts` (new)
- deps: perf3-fast-decode; the guardrail gate (Mind gates, header)
- red_first: yes (the `xml.codec` rows fail before the wiring)
- risk: high (the first surface whose behavior can change)
- integrable: yes (exact by fallback; reverting this commit alone restores today's `decodeString`)
- non_goals: `encodeString` (`perf3-wire-encode`); the channels; `decodeTree`.
- done_when, with a test tracer:
  - the README example gives `xml.codec` `"structural"` and no `xml.fallback`;
  - a document a leaf rejects gives `"fallback"` and `xml.fallback` `"failure"`, with an `XmlDecodeError` summary equal to the oracle's for the same input (`test/oracle/index.ts`, frozen at `a7a93d5`; audit `5d57e2b4` item 9 cosmetic);
  - a document whose leaf fails on its first run and succeeds after (a run counter) gives `"fallback"` and `"success"`, with the value equal (M6) to the oracle's decode of the same document with a leaf that always succeeds (audit item 9);
  - a `decodeTo`-wrapped root gives `"element"` and no `xml.fallback`;
  - a leaf that dies makes `decodeString` die with that defect, and the leaf ran once;
  - `bun x vp test src/codec.test.ts src/document.test.ts` passes unedited.
- check: `bun x vp test test/decode-string-fast-path.test.ts && bun x vp test src/codec.test.ts && bun x vp test src/document.test.ts && bun x vp check src/codec.ts test/decode-string-fast-path.test.ts`
- commit: `perf(codec): decode documents through the builder and the structural codec`
- status: landed `8255ccc`. Follow-ups: `5cda277` (`perf3-factory-tidy`: `fromString` builds its decoder once) and `5d5e049` (`perf3-fix-eager-standard`: the standard decode runs only on a fallback; head-cto `ae30d930` N1).

### perf3-wire-channels: Record channels take the fast path per record (F1 (a), F3, M2)

- outcome: in `records` (`src/channel.ts:296-340`), each collected record first runs `attemptDecode(def)(element, parseOptions)`; `None` runs today's `decodeRecord(element, parseOptions)` with its `attachRecordPosition`/`toDecodeError(plan, element, failure, index + 1)` mapping unchanged, and that outcome is authoritative. A defect or an interruption from the attempt propagates (M2). The channel builds the attempt once per factory call, `attemptDecode(def)` beside `decodeRecord` (`src/channel.ts:312`), not once per record, and computes `structuralPlan(def)` once with it: an opaque record codec (`undefined`) makes no attempt, and its records are counted in neither `xml.records.fallback` nor `xml.records.fallback.accepted`, which count only records whose attempt ran and fell back (rev3, audit `c972014c` P3: counting every record of an opaque codec would tell operators the cost doubled when it did not). `decodeSchema` and `decodeSchemaString` both reach it. The run span gains, set on exit beside `xml.records`, `xml.records.fallback` (records whose fast attempt fell back, gap Q1) and `xml.records.fallback.accepted` (those whose fallback succeeded, M2). The JSDoc of both factories states the double-run rule per record in consumer words, with no F- or M-numbers, worded as `perf3-wire-decode-string` gives it, with "a record codec wrapped with `decodeTo` or another transformation always decodes the standard way".
- write_scope: `src/channel.ts`, `test/channel-fast-path.test.ts` (new)
- deps: perf3-fast-decode; the guardrail gate (Mind gates, header)
- red_first: yes
- risk: high (per-record overhead on small records is unmeasured, F7.3)
- integrable: yes (exact by fallback; reverting this commit alone restores today's channels)
- non_goals: `collect`, positions, budgets (F6: unchanged).
- done_when, with a test tracer:
  - a run over three valid records then one a leaf rejects gives `xml.records` 3, `xml.records.fallback` 1, and `xml.records.fallback.accepted` 0, emits the three values, and ends with the same error summary as the oracle;
  - a run where one record's leaf fails on its first run and succeeds after emits that record with the value of the oracle's run with an always-succeeding leaf, counts it in `xml.records.fallback` and in `xml.records.fallback.accepted`, and continues to the records after it (audit `5d57e2b4` item 10);
  - a run over valid records only gives `xml.records.fallback` 0 and `xml.records.fallback.accepted` 0;
  - a run with a `decodeTo`-wrapped record codec over valid records gives `xml.records.fallback` 0 and `xml.records.fallback.accepted` 0, with the values equal (M6) to the oracle's (rev3);
  - a record whose leaf dies makes the run die with that defect, and the leaf ran once (rev3, as `perf3-wire-decode-string`'s row);
  - `bun x vp test src/channel.test.ts` passes unedited.
- check: `bun x vp test test/channel-fast-path.test.ts && bun x vp test src/channel.test.ts && bun x vp check src/channel.ts test/channel-fast-path.test.ts`
- commit: `perf(channel): decode records through the builder and the structural codec`
- status: landed `b020a37`.

### perf3-wire-encode: `encodeString` takes the fast path, today's encode as fallback (M2, M5)

- outcome: `encodeString` (`src/codec.ts:365-381`) first runs `attemptEncode(def, options)(value, parseOptions)`. `Some(text)` is the result; `None` runs today's body unchanged (`Schema.encodeEffect(def)` with `toEncodeError`, then `encodeTree`), and that outcome is authoritative. A defect or an interruption from the attempt propagates (M2). `fromString` encode reaches it through `src/document.ts:99`. As on decode, `encodeString` computes `structuralPlan(def)` once per factory call, beside `attemptEncode(def, options)`, and when it is `undefined` runs no attempt and records `"element"` (rev3, audit `c972014c` P3). The `xml.encodeString` span gains `xml.codec` with the same three values as decode (gap Q1) and, when it is `"fallback"`, `xml.fallback` (`"success"` or `"failure"`, M2). The JSDoc states the double-run rule for encode in consumer words, with no F- or M-numbers, following `docs/rd/decisions.md` "Double runs" (rev3, audit `490bd813` E4): the writer and the tokenizer run after the structural encode, so after a writer refusal or a tokenizer error the leaf encodes have already run and the standard encode runs them again. For example: "This encode first tries a faster path. When that path declines the value, a leaf schema rejects it, or writing the XML fails, the encode runs again the standard way and returns that result, success or failure. Only a value the faster path declines before encoding, an open-content item named after a declared member, runs no leaf code before the standard encode. In every other fallback the leaf encodes that ran on the faster path run again, and the tokenizer's `encodeString`, default or provided, can run twice for one call; a leaf whose result varies between runs can fail the first time and succeed the second, and the second result is returned. A defect or an interruption is not retried. A root wrapped with `decodeTo` or another transformation always encodes the standard way. Only `encodeString` and `fromString` take the faster path; encoding an element codec directly with Schema, or inside your own Schema, runs the standard way."
- write_scope: `src/codec.ts`, `test/encode-string-fast-path.test.ts` (new)
- deps: perf3-fast-encode, perf3-wire-decode-string (same file)
- red_first: yes
- risk: high
- integrable: yes (exact by fallback; reverting this commit alone restores today's `encodeString`)
- non_goals: `encodeTree` and `toEvents` (the fallback keeps them).
- done_when, with a test tracer:
  - the README value gives `xml.codec` `"structural"` and no `xml.fallback`, through the default tokenizer and through a spread-copy tokenizer;
  - a value holding U+0000 gives `"fallback"` and `xml.fallback` `"failure"`, with an `XmlEncodeError` summary equal to the oracle's (`InvalidEvent`);
  - a value holding U+0000 in a leaf whose encode counts its runs gives `"fallback"` and `"failure"`, and the leaf ran twice: once on the faster path before the tokenizer's `XmlError`, once in the fallback (rev3, audit `490bd813` E4);
  - a value whose leaf encode fails on its first run and succeeds after gives `"fallback"` and `"success"`, with text byte-identical to the oracle's for an always-succeeding leaf (audit `5d57e2b4` item 11);
  - an open-`mixed` `*` item named after a declared member gives `"fallback"` and `"failure"`, with the oracle's error summary (mail `a1c78477`);
  - a `decodeTo`-wrapped root gives `"element"` and no `xml.fallback`;
  - `bun x vp test src/codec.test.ts src/document.test.ts` passes unedited.
- check: `bun x vp test test/encode-string-fast-path.test.ts && bun x vp test src/codec.test.ts && bun x vp test src/document.test.ts && bun x vp check src/codec.ts test/encode-string-fast-path.test.ts`
- commit: `perf(codec): encode documents through the structural codec and the tokenizer`
- status: landed `c5b43af`. Follow-up: `5d5e049` (the standard encode runs only on a fallback; head-cto `ae30d930` N1).

### perf3-acceptance: Fast-path acceptance parity in both directions (guard F7.1)

- outcome: under F1 (a) a fast-path false reject costs only time and a false accept has no safety net, so this suite checks the attempts themselves, not only the public outcome. `test/differential/acceptance.test.ts` runs over the inputs of `corpus.cases.ts`, `generated.cases.ts`, `fuzz.cases.ts`, and `wrapped.cases.ts`, each with its own options and parse options.
  - Decode cases (audit `5d57e2b4` item 12 (d), (e); rev3, audit `c972014c` A1): an input is a case only when the src side's `decodeTree` of its text, with `input.options`, succeeds, because only those inputs reach the fast path (a `WellFormedness`, `Limit`, or `UndeclaredPrefix` failure never does). Every input contributes its root case, decoded with `input.roots`. An input with a `path` (corpus `channelInputs`, wrapped inputs, fuzz's streaming seed, generated P4) also contributes one case per record collected at `path` from each side's `decodeTree` root, decoded with the input's record definition: `input.record` when the input carries one (`wrapped.cases.ts:226`; fuzz's streaming seed, see `perf3-diff-fuzz`), else `input.roots` (corpus `channelInputs`, `corpus.cases.ts:254`, and generated P4, whose `roots` is the record codec). The oracle's outcome for a record case is the oracle record codec's direct decode, `Schema.decodeUnknownExit` of that definition's oracle side over the oracle side's record at the same ordinal: the same call the channel makes per record (`src/channel.ts:312`), made directly so an outcome exists for every record, including those after the first failure, where the oracle's channel run stops.
  - Two hard rules for every decode case (item 12 (a)): (R1) the oracle rejects, so `attemptDecode` gives `None`; (R2) `attemptDecode` gives `Some(value)`, so the oracle accepts and its value is the same (M6, through the harness's `valueSummary`). An opaque root, one where `structuralPlan(root)` is `undefined`, must give `None` and is counted apart. Which roots are opaque is computed from the predicate, never listed, so the count shrinks without a test edit when `perf3-checked-wrappers` lands. A false reject (the oracle accepts, the root is structural, the attempt gives `None`) is a builder or writer gap, not a divergence; each is listed by id.
  - Encode cases (item 12 (c)): the `EncodeInput` values `generated.cases.ts` exports (generated values, `samples`, and P5 corruptions; re-audit V1), and the values each side decodes from the corpus and wrapped inputs. The mirror rules hold: the oracle's encode fails, so `attemptEncode` gives `None`; `attemptEncode` gives `Some(text)`, so the oracle's encode succeeds with byte-identical text.
  - `test/bench/bank-acceptance.test.ts` does the same for `bank-16k`, `bank-256k`, `bank-4m`, and both `-bad-last` inputs (each document as its root case, and its records at `bankPath` as record cases by the rule above).
- write_scope: `test/differential/acceptance.test.ts` (new), `test/bench/bank-acceptance.test.ts` (new)
- deps: perf3-fast-decode, perf3-fast-encode, perf3-diff-corpus, perf3-diff-generated, perf3-diff-fuzz, perf3-diff-wrapped
- red_first: no (R-proof, in the private worktree: sabotage `src/builder.ts` to accept an undeclared attribute and record the count of cases R1 then fails; restore)
- risk: medium
- integrable: yes (test only)
- non_goals: public outcomes (the guardrail suites compare them).
- done_when:
  - R1, R2, and the encode mirrors hold on every case;
  - per suite the test reports the decode cases, the oracle's accepts and rejects among them, the opaque count, the false rejects, and the encode cases with the oracle's accepts and rejects;
  - it asserts above zero (item 12 (b), (d)): decode accepts in every suite; decode rejects in fuzz and wrapped, the two suites built to produce Schema failures that reach the fast path; encode accepts in corpus, generated, and wrapped; encode rejects in generated (its P5 corruptions). Fuzz has no encode inputs and reports zero encode cases with that reason; the corpus decode rejects are reported, not asserted;
  - the false-reject list is empty on the corpus inputs and on the bank valid inputs; the bank test also asserts a record count above zero and at least one reject on each `-bad-last` input.
- check: `bun x vp test test/differential/acceptance.test.ts && bun x vp test test/bench/bank-acceptance.test.ts && bun x vp check test/differential/acceptance.test.ts test/bench/bank-acceptance.test.ts`
- commit: `test(differential): check fast-path acceptance against the oracle in both directions`
- status: landed `50d5abc`. Its violation count does not cover members that share a wire tag (audit `7aa62827` B1); `dae32dd` and `6aa5ea7` add those rows in `test/mixed-ambiguity.test.ts`.

### perf3-checked-wrappers: Carry top-node checks onto the structural node (M4)

- outcome: checks on the top node of an otherwise unmodified `compile()` output, written as `.check(...)` or as `Schema.fromBrand(...)` (`.check(...ctor.checks)` then `brand`, `node_modules/effect/src/Schema.ts:5343-5352`), no longer make a root, slot, or member opaque. The structural codec carries them with the same `Filter` objects, read from the user's node: a checked root's checks run on the structural Type value, and a checked slot's or member's checks go onto that child's structural node. `decodeTo`, every transformation, and a `parseOptions` annotation stay opaque (Q3). The checked structural node is cached per user AST in a module `WeakMap` and written to no public AST (F3). Suggested shape, not binding: `structuralPlan` admits top-node checks; a new export of `src/structural-slot.ts` gives a schema's carried checks; `src/structural.ts` builds a child through the checked node; `attemptDecode` and `attemptEncode` take the root through it. `src/builder.ts` needs no change: it already follows `structuralPlan`, so a checked slot gets a nested plain object.
- write_scope: `src/structural-slot.ts`, `src/structural-slot.test.ts`, `src/structural.ts`, `src/structural.test.ts`, `src/writer.test.ts` (rev3, audit `c972014c` CW1), `src/fast-decode.ts`, `src/fast-encode.ts`, `test/checked-wrappers.test.ts` (new)
- deps: perf3-acceptance, perf3-diff-wrapped, perf3-wire-decode-string (the `xml.codec` observable), perf3-fast-encode, perf3-wire-encode (rev3, audit `c972014c` w5 note: this slice edits `src/fast-encode.ts`, which `perf3-wire-encode`'s tests and type check read, and its done_when reads `src/codec.ts`, which `perf3-wire-encode` edits; the writes are disjoint but the reads couple in one checkout, so w5 runs serially, `perf3-wire-encode` first)
- red_first: yes (the `.check` root row gives `"element"` before the change)
- risk: high (a dropped check is a false accept with no safety net)
- integrable: yes (a checked root or slot that the carried checks reject falls back for today's exact error)
- non_goals: `decodeTo` and transformations; `parseOptions` annotations; AST surgery; a `SchemaCompiler.set` path; the builder.
- Guardrail 3 exception (gap Q5, Mind ruling; extended by the Mind to `src/writer.test.ts` after audit `c972014c` CW1; lines corrected by CW2 and verified at `eb2c82c`): this slice may edit exactly these rows of the landed tests, which pin a checked schema as opaque, and no others.
  - `src/structural-slot.test.ts`: the `wrapped` table's entries "a checked element" (`:54`) and "a suspend reference to a checked element" (`:60`) move to the structural table, keeping the `planOf` assertion.
  - `src/structural.test.ts`: the `PositiveCount` JSDoc "the slot is opaque" (`:57`); the JSDoc of the opaque `count` input (`:165-167`), reworded, because `count` (`:168`) stays as the resolved child of the `Box` element row (`:215`); `boxPlain`'s `count` (`:179`), which becomes the nested plain object `{ n: "5" }`; and the check-reject row (starting `:283`), whose input at `:289` becomes `count: { n: "0" }` and which keeps its rejection assertion. The value assertion at `:278` stays unedited.
  - `src/writer.test.ts`: the `Checked` JSDoc "opaque, so its slot holds a resolved element" (`:64`, definition `:64-68`); the `Root` JSDoc's "an opaque child" (`:110`); and `rootPlain`'s `checked` (`:223`), which becomes `{ $text: "ok" }`. The slot `checked: Checked` (`:117`) and the resolved child in `rootElement` (`:194`) stay; the "optional, many, and open slots empty" row takes the change through `withoutNote` (`:254`). The writer resolves slots through `structuralPlan` (`src/writer.ts:126`, `:134`), so without this edit the "full vocabulary" and "optional, many, and open slots empty" rows fail; `src/writer.ts` needs no change.
    The commit body lists every edited line; `git show --numstat` shows no other deletion in any test file.
- done_when, with a test tracer through `decodeString`:
  - a `.check` root carrying a cross-field rule, a `Schema.fromBrand` root, and a `.check` slot each give `xml.codec` `"structural"`, with the value equal (M6) to the oracle's;
  - a value the check rejects gives `"fallback"` and `xml.fallback` `"failure"`, with the oracle's error summary;
  - encode through `attemptEncode`: the checked root's valid value gives `Some` with text byte-identical to the oracle's; a check-failing value gives what the oracle's encode gives (`None` when it fails, equal text when it succeeds; the test asserts the oracle's outcome first);
  - `bun x vp test test/differential/acceptance.test.ts` passes, and its wrapped opaque count drops by the checked inputs (report both counts);
  - `bun x vp test test/wire-fast-path.test.ts` passes unedited;
  - `bun x vp test test/decode-string-fast-path.test.ts` and `bun x vp test test/encode-string-fast-path.test.ts` pass unedited (rev3: this slice edits the attempts both wiring suites run).
- check: `bun x vp test test/checked-wrappers.test.ts && bun x vp test src/structural-slot.test.ts && bun x vp test src/structural.test.ts && bun x vp test src/writer.test.ts && bun x vp test test/differential/acceptance.test.ts && bun x vp test test/decode-string-fast-path.test.ts && bun x vp test test/encode-string-fast-path.test.ts && bun x vp check src/structural-slot.ts src/structural-slot.test.ts src/structural.ts src/structural.test.ts src/writer.test.ts src/fast-decode.ts src/fast-encode.ts test/checked-wrappers.test.ts`
- commit: `perf(codec): carry element checks onto the structural codec`
- status: landed `813755c`, with gate follow-up `849e8e6` (`perf3-gate-fix`: declarations build). Audit `7aa62827` R1, a carried filter that reads its node argument can pass where today's codec rejects, is accepted by head-cto `ae30d930` and documented by `2643757` (`docs/rd/decisions.md`, "Carried checks").

### perf3-witness: Stream, positions, and small-record witness before the swap is accepted (guard F7.3)

- outcome: the spikes timed `decodeUnknownSync`; the shipped path is `decodeUnknownEffect` inside `Effect.fn` spans, once per record on streams, and per-record overhead on small records was never measured (builder.md "Coverage map", Records). This slice measures the wired commit against the phase-3 baseline (task `048d51ee`, `docs/rd/performance/phase-3-baseline-*.json`) with the same method: `bun bench/run.ts` and `node bench/run.ts` with `--filter effect-xml/` (a substring match, `bench/run.ts:193`, so it selects 9 case ids: the seven `effect-xml/` cases and both `computis-effect-xml/` cases, the same 9 ids the baseline files hold; rev3, audit `c972014c`) in `--jit off`, `on`, and `noeval`, inputs `bank-16k` (small documents and records), `bank-4m`, and `bank-64m`, waiting for the 1-minute load average to stay under 6 for 2 minutes before each runtime matrix and recording start and end load. The new section in `docs/rd/performance.md` gives, per runtime, JIT mode, case, and input, the median, p95, and p99 before and after and the change, the full metric set where the runtime reports it, and the verdict: a `stream` or `stream/positions` median worse by more than 5% on either runtime at `bank-4m` or `bank-64m` is a regression (`phase-3.md` Non-goals). The `--jit` modes keep their meaning across the swap (M3, `phase-3.md` "Bench JIT modes"), so `--jit off` rows compare like for like with the baseline's library-default rows, and the `on` and `noeval` rows show the application's global import and its no-eval case. No `JitMode` JSDoc changes (head-cto S8).
- write_scope: `docs/rd/performance/phase-3-witness-{bun,node}-jit-{off,on,noeval}.json` (6 new files), `docs/rd/performance.md` (one new section, "Phase 3 witness"; no other section edited)
- deps: perf3-wire-decode-string, perf3-wire-channels, perf3-wire-encode, perf3-acceptance, perf3-diff-noeval, perf3-checked-wrappers (rev2: the witness measures every step-1 `src/` change, and no codec Hand runs during its measurement window), and task `048d51ee` (baseline committed)
- red_first: no (measurement)
- risk: medium (a shared, loaded machine skews medians; the load rule is the control)
- integrable: yes (docs)
- non_goals: the layer ladder and the step-2 evaluation (`perf3-reprofile`); any `src/` or bench change, `bench/harness/jit.ts` included.
- done_when: the six result files and the section are committed in one path-limited commit; every number traces to a committed file; the section states the verdict per (runtime, input) for `stream` and `stream/positions`. A regression verdict is reported to the Mind before the swap is accepted (the Mind rules: revert `perf3-wire-channels`, which restores today's channels alone, or take it to the owner).
- check: `bun x vp check docs/rd/performance.md` and `git show --stat --format= HEAD` lists only the write scope.
- commit: `docs(rd): record the phase-3 step-1 witness against the baseline`
- status: replaced, not run. Under the owner directive of 2026-11-06 (`work/owner-directive-perf3-loaded.md`: measure under load, interleaved A/B rounds, CPU time per operation, decide on ratios), the Mind replaced this slice and `perf3-reprofile` with `perf3-measure` (task `cf5f437e`; driver `97bd29e`, records `10d347f`). The witness verdict is in `docs/rd/performance.md`, "Phase 3 under load (A/B)", "Witness verdict": no regression. The baseline this slice depended on (task `048d51ee`) was superseded with nothing committed; the A/B's OLD side is `bd60a0e`. The brief above is kept as written.

### perf3-reprofile: Per-layer re-profile and the step-2 evaluation

- outcome: after the witness, on the same quiet-machine rule: `bench/profile/layers.ts` on Bun and Node in each JIT mode (it runs in-process and takes no `--jit` flag, so install the mode with the preload `bench/run.ts` uses: no preload for `off`, `bun --preload bench/harness/jit/<mode>.ts` or `node --import ./bench/harness/jit/<mode>.ts` otherwise, `bench/harness/jit.ts:74-84`; the schema rung decodes through the shipped `decodeSchemaString`, `bench/profile/layers.ts:166-181`, so it measures the new path), `bench/profile/cpu.ts` on Bun and Node with no preload, as the baseline ran it, and `bun bench/run.ts` / `node bench/run.ts` with `--filter typed-decode` for `effect-xml/` and `computis-effect-xml/` at `bank-4m` and `bank-64m`. A new `docs/rd/performance.md` section records the per-layer split before (baseline) and after, and the step-2 inputs per (runtime, size, JIT mode): `T` (effect-xml typed decode median), `C` (computis), `K` (tokenizer plus resolver deltas), and `T - K`, with the verdict of the planner's D1 default (pending owner) and, beside it, the verdicts of options (a) and (b). It also records F7.5 (the failure path is today's path plus the fast attempt; `errors.md`'s cheaper-failure figure does not apply) with the failure-path time on `bank-4m-bad-last` before and after, and the `SchemaAOTCompiler` evaluation from `jit.md` Q7 (brief Step 1 item 7).
- write_scope: `docs/rd/performance/phase-3-after-layers-{bun,node}-jit-{off,on,noeval}.json` (6 new), `docs/rd/performance/phase-3-after-cpu-{bun,node}.json` (2 new), `docs/rd/performance/phase-3-after-typed-{bun,node}-jit-{off,on,noeval}.json` (6 new), `docs/rd/performance.md` (one new section, "Phase 3 step 1: layers and the step-2 rule"; no other section edited)
- deps: perf3-witness
- red_first: no (measurement)
- risk: medium
- integrable: yes (docs)
- non_goals: deciding step 2 (the Mind reports the verdict to the owner, brief "Check-ins"); any tokenizer work.
- done_when: the files and the section are committed in one path-limited commit; every number traces to a committed file; the section shows `T`, `C`, `K`, `T - K`, and the verdict for every (runtime, size) at the shipped mode and beside it for the other two modes.
- check: `bun x vp check docs/rd/performance.md` and `git show --stat --format= HEAD` lists only the write scope.
- commit: `docs(rd): record the phase-3 step-1 layer profile and the step-2 inputs`
- status: replaced, not run (see `perf3-witness`). `perf3-measure` (`10d347f`) evaluates the step-2 rule from the same A/B rounds, with `K` from child-process runs of the `bench/profile/layers.ts` rungs: `docs/rd/performance.md`, "Phase 3 step-2 evaluation". The rule does not fire in the shipped mode. No `phase-3-after-*` files exist; the result files are under `docs/rd/performance/phase-3-ab/`.

### Waves (both tracks; recomputed by rev2 at `9eccea0`)

A slice dispatches once its `deps` are accepted, its `write_scope` overlaps no active slice, and, when rev2 marks it "needs re-audit", the Mind has re-admitted it. Within each wave the write scopes are disjoint files. w1 is done: `perf3-diff-harness` (`a3e5d8d`), `perf3-revert-jit` (`ea23128`), `perf3-slot-predicate` (`7421796`), `perf3-structural-codec` (`6cf5d58`), `perf3-writer-events` (`9eccea0`), and earlier `perf3-oracle` and `perf3-decisions`. Of w2's guardrail column, `perf3-diff-bank` (`827b7cf`), `perf3-diff-wrapped` (`025a463`), and `perf3-diff-corpus` (`644bdf3`) have landed since. At `aa39c12`, w2 to w5 have landed, and w6 and w7 were replaced by `perf3-measure`; the ledger below is current.

| Wave | Guardrail track                                                                                           | Codec track                                                                                                                                                                   | Width |
| ---- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| w2   | `perf3-diff-corpus`, `perf3-diff-bank`, `perf3-diff-generated`, `perf3-derivations`, `perf3-diff-wrapped` | `perf3-builder`, `perf3-fast-encode`                                                                                                                                          | 7     |
| w3   | `perf3-diff-fuzz`                                                                                         | `perf3-fast-decode`                                                                                                                                                           | 2     |
| w4   | `perf3-diff-noeval`                                                                                       | `perf3-acceptance`, `perf3-wire-decode-string`, `perf3-wire-channels` (the wiring waits for the guardrail gate: corpus, bank, generated, derivations, wrapped, fuzz accepted) | 4     |
| w5   |                                                                                                           | `perf3-wire-encode`, then `perf3-checked-wrappers` (serial: disjoint writes, coupled reads; rev3 P3)                                                                          | 1     |
| w6   |                                                                                                           | `perf3-witness` (after the swap gate below; quiet machine, no Hand running)                                                                                                   | 1     |
| w7   |                                                                                                           | `perf3-reprofile`                                                                                                                                                             | 1     |

Longest chain: `perf3-builder`, `perf3-fast-decode`, `perf3-wire-decode-string`, `perf3-wire-encode`, `perf3-checked-wrappers`, `perf3-witness`, `perf3-reprofile` (seven steps, because w5 runs as two). The acceptance chain, `perf3-diff-generated`, `perf3-diff-fuzz`, `perf3-acceptance`, `perf3-checked-wrappers`, `perf3-witness`, `perf3-reprofile`, waits for `perf3-wire-encode` before `perf3-checked-wrappers` and ends at the same step. Shared files are serialized by deps: `src/codec.ts` (`perf3-wire-encode` after `perf3-wire-decode-string`), `src/fast-decode.ts` and `src/fast-encode.ts` (`perf3-checked-wrappers` after their slices), and `src/compile.ts` (`perf3-builder` after the landed `perf3-slot-predicate`). In w5 the writes are disjoint (`perf3-wire-encode` writes `src/codec.ts`, which `perf3-checked-wrappers` does not write), but the reads couple: `perf3-checked-wrappers` edits `src/fast-encode.ts`, which `perf3-wire-encode`'s tests and type check read, and its done_when reads `src/codec.ts`. So w5 runs serially, `perf3-wire-encode` first.

### Landed receipts (at `aa39c12`)

Slice id to commit, from `git log --oneline a7a93d5..HEAD`. This ledger is current where a slice's own status line or the Waves paragraph above lags.

| Slice                                                            | Commit                           |
| ---------------------------------------------------------------- | -------------------------------- |
| `perf3-oracle`                                                   | `bd60a0e`                        |
| `perf3-decisions`                                                | `30cdb29`                        |
| `perf3-jit-helper` (retired, M3)                                 | `aa8309a`, reverted by `ea23128` |
| `perf3-revert-jit`                                               | `ea23128`                        |
| `perf3-slot-predicate`                                           | `7421796`                        |
| `perf3-structural-codec`                                         | `6cf5d58`                        |
| `perf3-diff-harness`                                             | `a3e5d8d`                        |
| `perf3-writer-events`                                            | `9eccea0`                        |
| `perf3-diff-bank`                                                | `827b7cf`                        |
| `perf3-diff-wrapped`                                             | `025a463`                        |
| `perf3-diff-corpus`                                              | `644bdf3`                        |
| `perf3-derivations`                                              | `eb2c82c`                        |
| `perf3-builder`                                                  | `c8ec6ae`                        |
| `perf3-fast-encode`                                              | `e162f68`                        |
| `perf3-diff-generated`                                           | `4f9b41a`                        |
| `perf3-fast-decode`                                              | `926c3e7`                        |
| `perf3-diff-generated-valid` (follow-up)                         | `789e700`                        |
| `perf3-diff-fuzz`                                                | `c63014a`                        |
| `perf3-wire-decode-string`                                       | `8255ccc`                        |
| `perf3-wire-channels`                                            | `b020a37`                        |
| `perf3-acceptance`                                               | `50d5abc`                        |
| `perf3-fuzz-timeout` (follow-up)                                 | `aaf9b25`                        |
| `perf3-diff-noeval`                                              | `01766d3`                        |
| `perf3-factory-tidy` (follow-up)                                 | `5cda277`                        |
| `perf3-wire-encode`                                              | `c5b43af`                        |
| `perf3-fix-attempt-tests` (follow-up)                            | `35cfbcb`                        |
| `perf3-checked-wrappers`                                         | `813755c`                        |
| `perf3-gate-fix` (follow-up)                                     | `849e8e6`                        |
| `perf3-fix-mixed-ambiguity` (repair, audit `7aa62827` B1)        | `dae32dd`                        |
| `perf3-fix-eager-standard` (repair, head-cto `ae30d930` N1)      | `5d5e049`                        |
| `perf3-docs-r1r5` (follow-up, audit R1 and R5 texts)             | `2643757`                        |
| `perf3-cleanup` (follow-up, re-review `b5643b60` r1, r2, r4)     | `6aa5ea7`, `390bdca`             |
| `perf3-measure` (replaces `perf3-witness` and `perf3-reprofile`) | `97bd29e`, `10d347f`             |
| `perf3-witness`                                                  | replaced by `perf3-measure`      |
| `perf3-reprofile`                                                | replaced by `perf3-measure`      |

`perf3-writer-text` was dropped (M5). The other commits in the range are not slices: the spikes (`3ec8e6d`, `3ca760c`, `cae1912`, `1d425f7`), the bench JIT selector (`3184848`, `964fbf2`), the positions pin (`6e7724a`), and the plan and goal documents (`035839c`, `e9a1fc2`, `7eedb36`, `ba1fd06`, `e0cd066`, `aa39c12`). `perf3-measure` replaced `perf3-witness` and `perf3-reprofile` under the owner directive `work/owner-directive-perf3-loaded.md` (measure under load; decide on interleaved CPU-time ratios), and the quiet-machine baseline (task `048d51ee`) was superseded with nothing committed.

### Integration gate: the swap (gate-owned; named once)

Every codec slice is integrable alone, because no surface calls the new modules until its wiring slice lands, and each wiring slice is exact by its fallback. The swap as a whole is accepted when:

1. `perf3-wire-decode-string`, `perf3-wire-channels`, and `perf3-wire-encode` are on main;
2. the gate seats run `bun run check`, `bun run build`, and `bun run test` green, and `bun x vp test test/differential/ && bun x vp test test/bench/` green (the guardrail suites, `perf3-acceptance`, and `perf3-diff-noeval` included), with `test/wire-fast-path.test.ts` unedited;
3. R-src's export check prints receipt R4's list; receipt C6's import-specifier grep, `grep -rnE "['\"]effect/schema/SchemaJITCompiler(/enable)?['\"]" src`, prints nothing (M3; audit `5d57e2b4` cross-cutting P3: a string grep would trip on a JSDoc mention); and the test-weakening checks of the cut-1 gate hold for every codec commit, with `perf3-checked-wrappers`' named exception (gap Q5);
4. `perf3-witness` reports no regression, or the Mind has ruled on the one it reports. `perf3-checked-wrappers` is not a swap gate item, but the witness depends on it, so it has landed by then.

Then `perf3-reprofile` runs and the Mind makes the brief's step-1 check-in (numbers, JIT policy, step-2 verdict).

### Swap gate status (at `aa39c12`)

- Items 1 to 3: green at `2643757` (gate task `3a7444f9`, logs `work/gate-perf3c-*.log`): `bun run check`, `bun run build`, and `bun run test` exit 0 (1161 passed, 2 skipped); `test/differential/` 113 passed and `test/bench/` 135 passed; JIT parity equal; `test/wire-fast-path.test.ts` unedited since `a7a93d5`; no `SchemaJITCompiler` import in `src/`; no export change; `test/oracle/` byte-identical to `a7a93d5`'s `src/`; no test weakened in `849e8e6..2643757`.
- Item 4: satisfied by the A/B witness of `perf3-measure`, which replaced `perf3-witness`. No `stream` or `stream/positions` regression: the worst JIT-off median NEW / OLD is 0.769 (Node, `stream/positions`, `bank-4m`) and the highest interval bound 0.837, against the 1.05 limit (`docs/rd/performance.md`, "Phase 3 under load (A/B)", "Witness verdict"). The quiet-machine witness was not run.
- After the gate: the step-2 evaluation (`docs/rd/performance.md`, "Phase 3 step-2 evaluation") finds that the rule does not fire in the shipped mode; step 2 is not started. The brief's step-1 check-in reads from these two sections.

### Audits (step-1 close)

| Audit                    | Task       | Scope                                            | Verdict                                     | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ---------- | ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aggregate implementation | `7aa62827` | `a7a93d5..813755c`                               | `block_range` on B1                         | B1 (mixed members that share a wire tag or Clark name decode to a different value and encode to different text, with no error) repaired by `dae32dd`; residuals R1 to R5 below                                                                                                                                                                                                                                                                                                                                              |
| head-cto ruling          | `ae30d930` | audit R1 and R5                                  | R1 accepted and documented; R5 wording only | texts landed in `2643757`; new finding N1 (the standard decode and encode were built eagerly beside the fast attempt, so leaves ran on a fast success) repaired by `5d5e049`                                                                                                                                                                                                                                                                                                                                                |
| Repair re-review         | `b5643b60` | `dae32dd`, `5d5e049`                             | `residual`: B1 and N1 closed                | r1 (nested ambiguous-slot decode rows did not discriminate) and r2 (no encode-fallback order row) closed by `6aa5ea7`; r3 (no shipped-path timing receipt) closed by `perf3-measure`; r4 (unreachable duplicate-wire guard) closed by `390bdca`                                                                                                                                                                                                                                                                             |
| Close-out                | `ee3a512f` | `2643757..aa39c12`, measurement honesty included | `residual`                                  | R1 (stream memory witnessed on CPU only) answered by `bad1854`: Node `stream/positions` peak heap at `bank-64m` is inconclusive (Residuals); R2 to R5 (`performance.md` wording and disclosed scope) closed by `bad1854`; R6 (head not through the full ladder) closed by ladder `21a598c3`, green at `aa39c12` (1169 passed, 2 skipped); N1 (stale Positions JSDoc) closed by `17a3187`; N2 (kept writer guard untested) accepted; N3 (GOAL status wording) closed by `perf3-final-docs`, the commit that records this row |

### Residuals (at `aa39c12`)

| Residual                                                                                                                                                                                    | Source                                                                               | State                                                                                                                                                                                                                                                                                            | Owner                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| A carried check whose verdict reads its node argument can pass on the faster path where today's codec rejects, with no fallback                                                             | audit `7aa62827` R1                                                                  | accepted: `docs/rd/decisions.md`, "Carried checks", and the JSDoc of `carriedChecks`, `decodeString`, and `encodeString` (`2643757`)                                                                                                                                                             | head-cto ruling `ae30d930`; no further work |
| The native-position path (`positions: "native"`) has no differential coverage                                                                                                               | gap C2; audit `7aa62827` R2                                                          | open, low risk: the fast path runs after collect, and positions attach only on a fallback through the unchanged error path (`test/differential/corpus.test.ts:16-17`)                                                                                                                            | Mind                                        |
| Generated draws are not constrained by plan feature, and since `789e700` they are XML characters only; coverage leans on the hand-built samples and corruptions                             | audit `7aa62827` R3                                                                  | open                                                                                                                                                                                                                                                                                             | Mind                                        |
| The `suspend()` marker re-runs the user thunk on every `planOf` (pre-existing; `src/dsl.ts` unchanged in phase 3)                                                                           | audit `7aa62827` R4                                                                  | open                                                                                                                                                                                                                                                                                             | want `7e935faa`                             |
| `fromString` runs a second, type-side pass that decodes overlapping mixed members differently from `decodeString` and drops fields (pre-existing; phase 3 keeps it byte for byte)           | head-cto `53621056`; re-review `b5643b60` carry-forward                              | resolved: the owner chose option B (drop the type-side pass; mail `076d28ea`), merged `efea83e`; collision-group encode merged `f1870a1`; recorded in `docs/rd/decisions.md`, "Phase-3 residual: fromString second pass"                                                                         | no further work                             |
| The step-2 rule's wording (D1, Q4)                                                                                                                                                          | gap D1                                                                               | closed: the owner left the wording to the Mind (2026-11-07); under the amended `K` (`0acc9db`) the rule does not fire on the optimized code: Node `bank-4m` `(T - K) / C` 1.146 (case) and 1.171 (rung) (`performance.md`, "Phase 3: step-2 rule re-evaluated on the optimized code", `a310ba3`) | no further work                             |
| Node `stream/positions` peak heap used at `bank-64m`, JIT off, is inconclusive: NEW / OLD 1.138 (interval 0.969-2.991, 12 rounds); every other streaming memory metric is at or below 1.014 | audit `ee3a512f` R1; `performance.md`, "Streaming memory, Node, JIT off" (`bad1854`) | open: peak heap is read at a run's end and depends on collector timing; resolving it to 5% needs post-GC heap reads, which the driver does not take                                                                                                                                              | Mind                                        |
| Bun streaming memory was not re-run; the R1 blocks ran on Node only                                                                                                                         | audit `ee3a512f` R1; `bad1854`                                                       | open                                                                                                                                                                                                                                                                                             | Mind                                        |
| A failing whole-document `fromString` decode costs 1.13-1.14x OLD CPU (`bank-4m-bad-last`): the fast attempt runs to the bad record, then today's decode runs                               | `performance.md`, "Failure path (F7.5)" (`bad1854`)                                  | accepted by design (F1; `docs/rd/decisions.md`, "Fallback trigger and outcome rule"); a failing record stream stays at 0.57-0.65                                                                                                                                                                 | no further work                             |

### Gaps for the Mind (cut 2; each with the planner's default)

- Q1 (observing the fast path). Rule 5 needs a command that observes the mechanism, and outcomes are identical by design. Default (accepted by the Mind; extended by M2): the wiring slices add the span attributes `xml.codec` (`"structural"`, `"fallback"`, `"element"`) and, on a fallback, `xml.fallback` (`"success"` or `"failure"`) to `xml.decodeString` and `xml.encodeString`, and `xml.records.fallback` and `xml.records.fallback.accepted` to the channel run span; they are additive observability (no export, type, or option changes), and they let an operator see fallbacks, which double the cost of a call. Option: no attribute; the wiring tests then observe the fallback only through a leaf that counts its runs (it runs twice on a failed call, F7.6) and the fast path only through the witness timings.
- Q2 (guardrail gate scope). Default: the guardrail suites must be accepted before the first wiring slice, not before the first codec slice; the earlier codec slices add internal modules nothing calls. Option: cut 1's rule (all guardrail slices before any step-1 `src/` slice), which serializes the tracks.
- Q3 (annotations that change parsing). The F4 predicate treats `.annotate` as structural, but an element codec annotated with `parseOptions` would lose them in the structural codec. Default: the predicate makes such a slot or root opaque (exact, today's speed). Option: carry `parseOptions` annotations onto the structural node, which needs its own differential case. Information (audit `5d57e2b4` item 1): Effect 4.1.2 has no runtime reader of a `parseOptions` annotation (the only `parseOptions` are `MakeOptions`, `Schema.ts:150`, `toStandardSchemaV1`, `:1402`, and `standardSchema.ts:34`), so the default is exact but costs speed for no behavioral reason. The default stands; `perf3-checked-wrappers` keeps such annotations opaque.
- Q5 (rev2: Guardrail 3 and `perf3-checked-wrappers`). Relaxing checks (M4) necessarily inverts the landed rows that pin a checked schema as opaque in `src/structural-slot.test.ts` and `src/structural.test.ts`; the per-commit check `git show --numstat <commit> -- test 'src/*.test.ts' | awk '$2>0'` will print those two files for that commit. Default: a named, Mind-reviewed exception limited to the rows the slice lists (each inverted, its value or rejection assertion kept). Option: carry checks on the root only, in `attemptDecode` and `attemptEncode`, and leave checked slots opaque; no test edit is needed, but a `.check` slot keeps today's speed, short of head-cto's `done_when`.
- Q6 (rev2, owner, non-blocking). A public `jit` opt-in, only if Node encode parity with `@computis/effect-xml` matters (Node fast encode about 29.4 ms with the JIT off against computis at about 14 ms, a figure derived from a `docs/rd/performance.md` ratio, not measured). Default: none in phase 3; the M3 default stands without an answer.
- Q4 (step-2 formula). D1 above; closed by the Mind's ruling of 2026-11-07 (the owner left the wording to the Mind). First evaluated by `perf3-measure` (`10d347f`, pre-fusion `K`). Re-evaluated on the optimized code (`a310ba3`) under the amended `K` (`0acc9db`): the rule does not fire; Node `bank-4m` `(T - K) / C` is 1.146 (1.051–1.225) in the case harness and 1.171 (1.070–1.292) in the rung harness (`docs/rd/performance.md`, "Phase 3: step-2 rule re-evaluated on the optimized code").

### Amendments to the guardrail slices (task `6c66e48a`)

Audit `ea39772d` findings and head-cto guards, folded into cut 1 above. Every amendment adds coverage; none removes a check.

| Id  | Slice                      | Source                   | Change                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `perf3-diff-harness`       | audit H1-H6; F2          | every public reason field (`elementPath`, `prefix`/`where`, `Limit` fields, `XmlError` causes); `XmlDecodeError.record`; encode reason fields; the outer `SchemaError` plus `decodeErrorOf`/`encodeErrorOf` for document surfaces; strict cause (`causeOf`); `withTokenizer` per side; encode and channel cases in `harness.test.ts`; `DocumentInput` type; risk raised to high |
| A2  | `perf3-diff-corpus`        | audit C1, C2; R-cases    | `errors: "all"` and `onExcessProperty: "error"` variants on the document, direct, and channel surfaces; `corpus.cases.ts`; native-position path recorded as residual                                                                                                                                                                                                            |
| A3  | `perf3-diff-bank`          | audit suggestion         | optional: `-bad-last` ends in an error on both sides                                                                                                                                                                                                                                                                                                                            |
| A4  | `perf3-diff-generated`     | audit G2, G3; R-cases    | channel surface P4 over the feature roots; both sides derive or fail to derive; `generated.cases.ts`                                                                                                                                                                                                                                                                            |
| A5  | `perf3-diff-generated`     | audit G1; N3; F5         | P5 invalid values with each encode reason asserted; P1t encode through a non-default tokenizer identity                                                                                                                                                                                                                                                                         |
| A6  | `perf3-diff-generated`     | F7.4                     | prefixed attribute and second-namespace child in `features.ts`; `samples` for roots `Arbitrary` cannot derive; per-feature encode counts                                                                                                                                                                                                                                        |
| A7  | `perf3-diff-fuzz`          | audit F1-F4; F7.1        | small budgets with each `Limit` kind asserted; split points across pieces; direct surface; `errors: "all"`; feature seeds (F4 covered, so it is no longer a residual); F7.1 mutation operators (namespace-only renames, empty and whitespace text in every mode, undeclared attribute beside `data-*`); `fuzz.cases.ts`; deps add `perf3-diff-generated`                        |
| A8  | `perf3-diff-wrapped` (new) | F7.2                     | `.check`, `decodeTo`, `.annotate`, `brand` on a child, a member, and the root, on every surface                                                                                                                                                                                                                                                                                 |
| A9  | `perf3-diff-noeval` (new)  | F7.7, audit X4; M3       | the differential inputs run by default and with `--disallow-code-generation-from-strings`; fingerprints equal; settles D5 and J4. Re-scoped by rev2: by default and with the application's global JIT import preloaded, the JIT run reporting generated functions                                                                                                               |
| A10 | header, receipts, gate     | audit O1, O2, X1, X2, X3 | `a7a93d5` freeze ratified (R1); smoke-test shape corrected; "src and bench unchanged since `a7a93d5`" and "additions only" replaced by per-commit checks and named exceptions; the strict cause comparison stands (F2)                                                                                                                                                          |

## Revision rev2 ledger

Every finding of the inputs to task `d390991c`, mapped to where it closed. "Moot" means a ruling removed the thing the finding was about.

### Merit ruling `16f993dd`

| Id                                   | Closed in                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1                                   | `phase-3.md` rulings row M1; `decisions.md` "Builder rule sources"; `perf3-builder` (rule sources, receipt C7)                                                                                                                                                |
| M2                                   | `phase-3.md` F1 (a), Invariant 2, F7.6; `decisions.md` "Fallback trigger and outcome rule", "Double runs"; `perf3-fast-decode`, `perf3-fast-encode`, the three `perf3-wire-*`; gap Q1                                                                         |
| M3                                   | `phase-3.md` Goal 4, Non-goals, F8, Invariant 4, "Bench JIT modes", Release posture; `decisions.md` "JIT: off by default"; `perf3-revert-jit` (landed), `perf3-jit-helper` retired, `perf3-diff-noeval`, `perf3-witness`, receipt C6, swap gate item 3, R-src |
| M4                                   | `phase-3.md` F4 (a), "Out of step 1" spelling paragraph; `decisions.md` "Checks carry-over and spelling"; `perf3-checked-wrappers`; `perf3-slot-predicate` amendment 1; gap Q5                                                                                |
| M5                                   | `phase-3.md` F5, Constraints, Shape; `decisions.md` "Encode: always through the tokenizer"; `perf3-writer-text` dropped; `perf3-fast-encode`; `perf3-diff-generated` P1t                                                                                      |
| M6                                   | `phase-3.md` rulings row M6, Invariant 3; `decisions.md` "Same value"; `perf3-diff-harness` amendment (landed `a3e5d8d`), R-test, codec rules, `perf3-builder`, `perf3-fast-decode`, `perf3-acceptance`, `perf3-diff-noeval`                                  |
| M7                                   | E1-E4 below                                                                                                                                                                                                                                                   |
| E1                                   | `phase-3.md` Summary, Goal 1, Shape                                                                                                                                                                                                                           |
| E2                                   | `phase-3.md` Goal 3                                                                                                                                                                                                                                           |
| E3                                   | `phase-3.md` Goal 4 and Non-goals (inline, not by pointer)                                                                                                                                                                                                    |
| E4                                   | `phase-3.md` F8 row; "Bench JIT modes (unchanged by the swap, M3)" replaces "Bench JIT modes after F8"                                                                                                                                                        |
| E5                                   | `phase-3.md` F5 row; Shape diagram without the `tokenizer === defaultTokenizer` branch; fallback triggers listed                                                                                                                                              |
| E6                                   | `phase-3.md` Invariant 2 and the F7.6 row                                                                                                                                                                                                                     |
| E7                                   | `phase-3.md` Invariant 3                                                                                                                                                                                                                                      |
| E8                                   | `phase-3.md` Invariant 4                                                                                                                                                                                                                                      |
| E9                                   | `phase-3.md` F4 (a) row, `fromBrand` named                                                                                                                                                                                                                    |
| E10                                  | `phase-3.md` F7.7 row (re-scoped); "Out of step 1" adds the JIT on by default, a direct text writer, `SchemaCompiler.set`                                                                                                                                     |
| E11                                  | `phase-3.md` "How each spike question closed": J2, N2, N4 (and J3, J4, N3)                                                                                                                                                                                    |
| S1                                   | `perf3-jit-helper` retired; `perf3-revert-jit` (`ea23128`, task `f7f7a062`) did the revert; fast-decode and fast-encode deps drop it                                                                                                                          |
| S2                                   | `perf3-writer-text` dropped                                                                                                                                                                                                                                   |
| S3                                   | `perf3-fast-encode`: events into the current tokenizer only, no JIT, deps `perf3-writer-events` and `perf3-structural-codec`, counter row kept as "counter is 1"                                                                                              |
| S4                                   | `perf3-fast-decode`: no JIT, the outcome rule, the caller's services and environment                                                                                                                                                                          |
| S5                                   | the three `perf3-wire-*`: `xml.fallback` / `xml.records.fallback.accepted`, fail-then-succeed rows, consumer JSDoc without F-numbers                                                                                                                          |
| S6                                   | `perf3-builder`: rule sources, receipt C7 rows B3 and B8, key order                                                                                                                                                                                           |
| S7                                   | `perf3-diff-noeval` re-scoped; the Mind may drop it                                                                                                                                                                                                           |
| S8                                   | `perf3-witness`: no `JitMode` JSDoc change; `--jit off` like for like with `048d51ee`                                                                                                                                                                         |
| S9                                   | `perf3-diff-harness` (amendments recorded, landed) and `perf3-acceptance` (key order, audit (a)-(e))                                                                                                                                                          |
| S10                                  | `perf3-checked-wrappers` (new), after `perf3-acceptance` and `perf3-diff-wrapped`                                                                                                                                                                             |
| S11                                  | receipt C6; swap gate item 3                                                                                                                                                                                                                                  |
| Hater reports `7a660078`, `4c83df29` | disposed by head-cto through M1-M7 (classification in the ruling); no separate planner edit                                                                                                                                                                   |

### Codec delivery audit `5d57e2b4`

| Finding                                                                        | Closed in                                                                                          |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| jit-helper done_when row 1 cannot fail                                         | moot: `perf3-jit-helper` retired (M3)                                                              |
| decisions P3 (double-run wording)                                              | `decisions.md` "Double runs"                                                                       |
| 1 slot-predicate P2 (a), (b)                                                   | `perf3-slot-predicate` amendments 2 and 3 (dispatched, landed `7421796`)                           |
| 1 Q3 information                                                               | gap Q3                                                                                             |
| 3 structural-codec optional rows                                               | `perf3-fast-decode` done_when (empty `"$text"`, empty mixed text item)                             |
| 4 builder P1 (empty-content element child; undeclared element in closed mixed) | receipt C7 rows B3, B8; `perf3-builder` refusal table                                              |
| 5 writer-events P3 notes                                                       | `perf3-writer-events` status (landed writer refuses them); `perf3-fast-encode` rows                |
| 6 writer-text P1 (name check)                                                  | moot (M5); its invalid-name rows in `perf3-fast-encode`                                            |
| 7 fast-decode P3 (defects propagate)                                           | M2 outcome rule; `perf3-fast-decode` outcome and rows                                              |
| 8 fast-encode invalid-name row                                                 | `perf3-fast-encode` done_when                                                                      |
| 9 wire-decode-string row; oracle-commit cosmetic                               | `perf3-wire-decode-string` done_when (oracle at `a7a93d5`)                                         |
| 10 wire-channels row                                                           | `perf3-wire-channels` done_when                                                                    |
| 11 wire-encode row                                                             | `perf3-wire-encode` done_when                                                                      |
| 12 acceptance (a)                                                              | `perf3-acceptance`: rules R1, R2; opaque roots computed and counted apart                          |
| 12 acceptance (b)                                                              | `perf3-acceptance`: encode rejects asserted in generated only                                      |
| 12 acceptance (c)                                                              | V1 `EncodeInput` (harness landed); `perf3-diff-generated` exports; `perf3-acceptance` encode cases |
| 12 acceptance (d)                                                              | `perf3-acceptance`: only inputs whose src `decodeTree` succeeds are cases                          |
| 12 acceptance (e)                                                              | `perf3-acceptance`: per-record cases at `path`                                                     |
| 13 witness, 14 reprofile                                                       | admitted; witness changed only by S8                                                               |
| cross-cutting F5 identity                                                      | moot (M5)                                                                                          |
| cross-cutting P3 gate grep                                                     | receipt C6; swap gate item 3; `phase-3.md` Invariant 4                                             |

### Guardrail re-audit `e2d82410`

| Finding                            | Closed in                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 (no typed-value input type)     | `perf3-diff-harness` amendment (landed `a3e5d8d`: `EncodeInput`); R-cases; `perf3-diff-generated` item 2; `perf3-acceptance`; `perf3-diff-noeval` item 1 |
| V2 (fingerprint re-lists surfaces) | residual, recorded in `perf3-diff-noeval` with its rationale; surface lists printed and compared                                                         |
| V3 (`defaultTokenizer` import)     | R-oracle; `perf3-diff-harness` amendment; `perf3-diff-generated` P1t                                                                                     |
| V4 (`UnmappedNamespace` wording)   | `perf3-diff-generated` P5                                                                                                                                |

### Addendum `a1c78477` (structural-codec seat)

| Finding                                                                  | Closed in                                                                                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| open-`mixed` `*` item named after a declared member encodes structurally | `perf3-fast-encode` (refusal before the structural encode, row); `perf3-wire-encode` row; `perf3-diff-generated` P5 corruption |
| note 2: union member order                                               | recorded in `perf3-structural-codec` status, no change                                                                         |

### Mind addendum `023e5f02` (process hazard)

| Finding                                                          | Closed in                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| concurrent R-proofs sabotaged the shared `test/oracle/` in place | standing rule R-proof: sabotage only in a private worktree under `work/`, removed after the run; extended to codec-track sabotage of `src/` modules, which has the same hazard |

### Rev3 repair (task `095e0177`): delivery re-audit `c972014c` and audit `490bd813` E4

Repair round 1 of the rev2 later-slice audit. Line numbers re-read at `eb2c82c`. Only the sections in the rev3 write scope changed; the rev2 table and the Waves section were not edited (see the w5 row).

| Finding                                                                          | Closed in                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 acceptance (P2): path inputs lose their root case; record definition          | `perf3-acceptance` decode cases: every input keeps its root case; record cases use `input.record`, else `input.roots`; the oracle side is the oracle record codec's direct decode (`src/channel.ts:312`), so an outcome exists after a failure; self-reference to `bank-acceptance` dropped                                           |
| A1 / fuzz note: streaming seed needs `record`                                    | `perf3-diff-fuzz` "Record definition" paragraph and status (admitted, not yet dispatched)                                                                                                                                                                                                                                             |
| CW1 checked-wrappers (P2): `src/writer.test.ts` pins `.check` as opaque          | Mind extended Q5; `perf3-checked-wrappers` write_scope, exception list (`:64`, `:110`, `:223`; `:117`, `:194`, `:254` unchanged), and check line                                                                                                                                                                                      |
| CW2 checked-wrappers (P2): wrong `src/structural.test.ts` lines                  | `perf3-checked-wrappers` exception list: `:57`, `:165-167`, `:179`, reject row `:283` with input `:289`; `:168` kept for the element row at `:215`                                                                                                                                                                                    |
| N1 diff-noeval (P2): the JIT probe counts as a function                          | `perf3-diff-noeval` items 1 and 2: `compiled` counts only `("ast", "R", "resolve", source)` constructions (`SchemaJITCompiler.ts:40`) and is asserted; `probes` reported                                                                                                                                                              |
| N1 P3: landing counts precede the structural encode path                         | `perf3-diff-noeval` "Coverage at landing": the swap gate's item 2 rerun covers it, and the gate seat records both runs' `compiled` counts                                                                                                                                                                                             |
| P3 wire: `"element"` against `"fallback"` needs the root's shape                 | `perf3-wire-decode-string` and `perf3-wire-encode` outcomes: `structuralPlan(def)` once per factory call in `src/codec.ts`; no attempt for an opaque root                                                                                                                                                                             |
| P3 wire: JSDoc "run once on each path" overstates                                | `perf3-wire-decode-string` JSDoc: "can run on both paths"; a `decodeTo` or transformed root always decodes the standard way                                                                                                                                                                                                           |
| P3 wire-channels: opaque record counting, rows, attempt per channel              | `perf3-wire-channels` outcome (attempt and `structuralPlan` once per factory call; opaque record codec counted in neither), JSDoc sentence, `decodeTo` record row, leaf-defect row                                                                                                                                                    |
| P3 fast-decode: "None for every file today rejects" may be vacuous               | not edited (outside the rev3 write scope); its done_when already ends "Report the counts". The Mind carries "report the corpus reject count, which may be zero" in the Hand body                                                                                                                                                      |
| P3 witness: `--filter` selects 9 ids; stale integrable note                      | `perf3-witness` outcome (9 case ids, same as the baseline) and `integrable: yes (docs)`                                                                                                                                                                                                                                               |
| P3 w5: disjoint writes, coupled reads                                            | `perf3-checked-wrappers` deps add `perf3-wire-encode` (w5 serial, `perf3-wire-encode` first) and its check runs both wiring suites. The Waves table's w5 row and its "w5 is disjoint" sentence are stale and outside the rev3 write scope; read w5 as two serial steps. The acceptance chain to the witness grows by one wave         |
| E4 (`490bd813`): encode leaves already ran before a writer or tokenizer fallback | `docs/rd/decisions.md` "Double runs" (decode and encode stated apart); `perf3-wire-encode` JSDoc example and the U+0000 counting-leaf row (the leaf ran twice). The suggested `perf3-fast-encode` row (U+0000 with a counting leaf: `None`, the leaf ran once) is outside the rev3 write scope; the Mind carries it in that Hand body |
