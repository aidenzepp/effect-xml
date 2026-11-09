# Slices: performance phase 1 (measurement only)

- plan: `docs/goals/performance/GOAL.md` (Implementation shape, phase 1; constraints, classes, layers, and metric set are settled there and quoted, not re-asked). Source want `86a9ce88` with owner amendments `85f587a7` and `54fece78`.
- slice file: `docs/goals/performance/phase-1.slices.md`
- size target: 5-15 minutes per Hand (witness rows `perf1-23` and `perf1-24` are run time, not edit time; see Notes)
- cut against: commit `28a045b`, `effect@4.1.2`, Bun 1.4.2, Node 26.13.0; every line number below was read on that checkout. A slice later in a file's chain re-reads the file first.
- phase invariant: phase 1 changes no file under `src/`. Oracle: `git diff --name-only 28a045b..HEAD -- src` prints nothing.
- slice count: 25 numbered (`perf1-1`..`perf1-25`) + `perf1-tidy` = 26
- longest chain: 8 (`perf1-1, perf1-3, perf1-20, perf1-22, perf1-tidy, perf1-23, perf1-24, perf1-25`)
- width per wave (a slice dispatches once its `deps` are accepted and its `write_scope` overlaps no active slice): w1 1 (`perf1-1`); w2 11 (`perf1-2`..`perf1-12`); w3 9 (`perf1-13`..`perf1-21`; `perf1-13`..`perf1-19` wait on `perf1-2`); w4 1 (`perf1-22`); w5 1 (`perf1-tidy`); w6 1 (`perf1-23`); w7 1 (`perf1-24`); w8 1 (`perf1-25`).
- Mind gates: `perf1-2` adds devDependencies and needs the Mind's approval of the list first (GOAL Constraints); `perf1-23` and `perf1-24` are exclusive: nothing else runs on the machine while they run.

## Standing rules (every brief below is bound by these; a brief names the ones it leans on)

- R-effect: Effect error channels only. `try`/`catch` is a lint error (`workspace/no-built-in-try-catch`). A competitor call that can throw is wrapped once per batch in `Effect.try`, never per sample. `no-await-in-loop` is an error: loops that wait are Effect loops (`Effect.forEach` with `{ concurrency: 1 }`), and the timed loop is synchronous.
- R-guide: follow `node_modules/effect/AGENTS.md` (read it completely before writing Effect code). Use `Predicate` helpers, never hand-written guards. Before custom glue, add one `// Native: <API checked> lacks <requirement>.` line comment above the declaration's JSDoc block (`.agents/skills/effect-design/SKILL.md`). Child processes use `node:child_process` (`effect/unstable/process` needs a platform layer, which is not a dependency); file I/O uses `node:fs` inside `Effect.sync`, as `test/streaming/synthetic.ts` does.
- R-doc: multiline JSDoc (`/**` on its own line) on every module-scope function, type, interface, and `const`, with `@param`/`@returns` on functions (`.agents/skills/document-code/SKILL.md`).
- R-files: kebab-case file and directory names (`unicorn/filename-case`, `workspace/kebab-case-paths`). Relative imports with the `.ts` extension. `bench/` never imports `spikes/`; it reads the corpus by path with `new URL("../../spikes/fixtures/qti/", import.meta.url)` (adjust `../` to the file's depth). `bench/` may import `src/` internals and, read-only, `test/qti/vocabulary.ts`, `test/streaming/vocabulary.ts`, `test/streaming/heap.ts`, `test/tokenizer/fakes.ts` (fakes in `test/bench/` only). `src/` and `test/` (outside `test/bench/`) never import `bench/`.
- R-node: every file under `bench/` runs unmodified under `bun <file>` and `node <file>` (Node 26 strips types with no flag): `import type` for every type-only import, `.ts` extensions, no `enum`, no value `namespace`, no parameter properties, no `Bun.*` global except behind `Predicate.hasProperty(globalThis, "Bun")` (as `test/streaming/heap.ts:35` does). Runtime label: `process.versions.bun` present means Bun.
- R-test: harness tests are `test/bench/<name>.test.ts`, import `{ describe, expect, it } from "@effect/vitest"`, use `it.effect` for effectful cases, run on tiny inline inputs (each file well under a second), and assert on structured values (ids, counts read from the value, field presence, `_tag`), never on timing values or message text. Vitest runs on Node, so a Bun-only branch is checked by the slice's `bun` sanity command, not by the test.
- R-case: a case is "prepare once, then a synchronous `run`". Every effect-xml entry runs under `Effect.runSync` (probed on both runtimes at `28a045b`). `check(output)` returns the count the case claims (elements for `events`/`tree`/`encode-*`, records for `typed-decode`/`stream`) and runs once per process outside the timed loop; the harness compares it with `expected` and fails the case on mismatch. The timed loop keeps each output alive in a module-level sink so it is not optimized away.
- R-check: the slice check is the command its brief names: `bun x vp test <file>` (one file per invocation; chain with `&&`), `bun x vp check <files>`, or the named `bun`/`node` command. The type check is program-wide: an error it reports in a file outside your `write_scope` is a `blocked-scope` report, never an edit. `bun run check`, `bun run build`, `bun run test` are the gate seats' job, not the slice's.
- R-commit: one conventional commit per slice (`.agents/skills/conventional-commits/SKILL.md`), path-limited to the slice's `write_scope`: `build(bench):` for `perf1-1` and `perf1-2`, `feat(bench):` for harness, case, input, and profile slices, `refactor(bench):` for the tidy slice, `docs(rd):` for result and document slices. Never amend, reset, rebase, or stash.
- R-scope (ends every brief): change only the files in `write_scope`. If the work needs any other path, change nothing and report `blocked-scope` with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

## Shared contract (`bench/types.ts`, written by `perf1-1`; every later brief codes against it)

```ts
import type { Tokenizer } from "../src/tokenizer.ts";

/**
 * The six like-for-like classes (GOAL "Like-for-like comparison classes").
 */
export type BenchClass =
  | "events"
  | "tree"
  | "typed-decode"
  | "encode-tree"
  | "encode-typed"
  | "stream";

/**
 * One XML document of an input; `chunks` are 64 KiB slices of `text` for the stream class.
 */
export interface BenchDocument {
  readonly name: string;
  readonly text: string;
  readonly chunks: readonly string[];
}

/**
 * One benchmark input; `bytes` is the UTF-8 length of all documents together.
 */
export interface BenchInput {
  readonly id: string; // "corpus-all" | "corpus-items" | "bank-16k" | "bank-256k" | "bank-4m" | "bank-64m" | "bank-<size>-bad-last"
  readonly family: "corpus" | "synthetic";
  readonly bytes: number;
  readonly documents: readonly BenchDocument[];
  readonly reference: { readonly elements: number; readonly records: number };
}

/**
 * A prepared case: `run` is timed; `mark` is called once when the first record is out (stream class
 * only).
 */
export interface PreparedCase {
  readonly run: (mark: () => void) => unknown;
  readonly check: (output: unknown) => number;
  readonly expected: number;
}

/**
 * The capability record of one library, measured by probe (GOAL Competitors).
 */
export interface LibraryProfile {
  readonly library: string; // npm package name, or "@aidenzepp/effect-xml"
  readonly rejectsMalformed: boolean; // `<a><b></a>` fails
  readonly resolvesNamespaces: boolean; // prefixes become namespace URIs in the output
  readonly decodesEntities: boolean; // `&amp;` becomes `&`
  readonly expandsDoctypeEntities: boolean;
  readonly reportsPositions: boolean;
  readonly streams: boolean;
  readonly typed: boolean;
  readonly notes: readonly string[];
}

/**
 * One benchmark case.
 */
export interface BenchCase {
  readonly id: string; // "<library>/<class>[/<variant>]"
  readonly library: string;
  readonly class: BenchClass;
  readonly accepts: (input: Pick<BenchInput, "id" | "family">) => boolean; // decided from the id, so the driver never loads an input to plan the matrix
  readonly prepare: (
    input: BenchInput,
    tokenizer: Tokenizer,
  ) => Effect.Effect<PreparedCase, CaseError>;
}

/**
 * A measured value with its source, or the reason it is unavailable on this runtime.
 */
export type Measured =
  | { readonly value: number; readonly unit: string; readonly source: string }
  | { readonly unavailable: string };

/**
 * Latency quantiles in milliseconds (nearest-rank).
 */
export interface Quantiles {
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Every metric of the owner's set for one case on one input.
 */
export interface CaseMetrics {
  readonly samples: number;
  readonly wallMs: Quantiles;
  readonly throughputMBps: Measured; // bytes / median seconds / 1e6
  readonly timeToFirstRecordMs: Quantiles | undefined; // stream class only
  readonly cpuUserMs: Measured;
  readonly cpuSystemMs: Measured;
  readonly peakRssBytes: Measured;
  readonly heapUsedBytes: Measured;
  readonly allocationBytesPerSecond: Measured;
  readonly gcCount: Measured;
  readonly gcPauseMs: Measured;
}

/**
 * One case result; `observed` is `check`'s count.
 */
export interface CaseResult {
  readonly caseId: string;
  readonly library: string;
  readonly class: BenchClass;
  readonly input: string;
  readonly tokenizer: string;
  readonly bytes: number;
  readonly expected: number;
  readonly observed: number;
  readonly metrics: CaseMetrics;
}

/**
 * A case that failed to prepare, run, or check.
 */
export interface CaseFailure {
  readonly caseId: string;
  readonly input: string;
  readonly reason: string;
}

/**
 * The machine, versions, and commit a run measured on.
 */
export interface Environment {
  readonly runtime: "bun" | "node";
  readonly runtimeVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cores: number;
  readonly totalMemoryBytes: number;
  readonly commit: string;
  readonly dirty: boolean;
  readonly packages: Readonly<Record<string, string>>; // package name -> installed version, or "absent"
}

/**
 * The sampling method a run used.
 */
export interface Method {
  readonly warmupIterations: number;
  readonly warmupMs: number;
  readonly minSamples: number;
  readonly minMs: number;
  readonly maxSamples: number;
  readonly maxMs: number;
  readonly chunkBytes: number;
  readonly quantile: "nearest-rank";
  readonly isolation: "process-per-case";
  readonly floorMs: Quantiles; // the sampler's own cost on a no-op case
}

/**
 * One results file.
 */
export interface RunFile {
  readonly environment: Environment;
  readonly method: Method;
  readonly results: readonly CaseResult[];
  readonly failures: readonly CaseFailure[];
}
```

`CaseError` is a `Data.TaggedError("CaseError")<{ readonly caseId: string; readonly reason: string }>` declared in the same file (`import * as Data from "effect/Data"`; `import type * as Effect from "effect/Effect"` for the type). The trailing `//` comments above document the contract here; the file itself carries JSDoc per R-doc instead.

Probe definitions (used by every `LibraryProfile`; each adapter's test runs them against the library and asserts they equal the exported profile, so no capability is claimed from memory):

- `rejectsMalformed`: parsing `<a><b></a>` fails (throws, returns an error, or reports an error event).
- `resolvesNamespaces`: parsing `<p:a xmlns:p="urn:x"/>` with the options the case uses exposes `urn:x` as the element's namespace.
- `decodesEntities`: the text of `<a>&amp;</a>` is `&`.
- `expandsDoctypeEntities`: the text of `<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>` is `x` (a failure or `&e;` left as is counts as `false`).
- `reportsPositions`, `streams`, `typed`: read from the library's API and stated in `notes` with the API name; `streams` means it accepts input chunk by chunk.

Input ids are fixed: `corpus-all` (every `spikes/fixtures/qti/*.xml`, 15 files at `28a045b`, enumerated, never counted by hand), `corpus-items` (the four `AssessmentItem` acceptance fixtures of `test/qti/vocabulary.test.ts:22-27`), `bank-16k`, `bank-256k`, `bank-4m`, `bank-64m` (the synthetic item bank at 16 KiB, 256 KiB, 4 MiB, 64 MiB), and `bank-256k-bad-last`, `bank-4m-bad-last` (the same with the last record's `href` removed; error-path inputs, used by the layer ladder only). `unlimited` below means `{ maxElementSize: Infinity, maxElementNodes: Infinity }`, which a whole-document decode of a large input needs (`defaultMaxElementSize` is 16 MiB, `src/resolve.ts:639`).

## Cut 1: slice

- answer: sliced
- longest chain: perf1-1, perf1-3, perf1-20, perf1-22, perf1-tidy, perf1-23, perf1-24, perf1-25

### perf1-1: Bench skeleton: program wiring, shared contract, registry, stubs, shared helpers

- write_scope: `tsconfig.json`, `package.json`, `bench/types.ts`, `bench/registry.ts`, `bench/tokenizers.ts`, `bench/vocabulary.ts`, `bench/inputs/chunk.ts`, `bench/inputs/reference.ts`, `bench/inputs/corpus.ts`, `bench/inputs/synthetic.ts`, `bench/cases/effect-xml-parse.ts`, `bench/cases/effect-xml-typed.ts`, `bench/cases/effect-xml-stream.ts`, `bench/cases/fast-xml-parser.ts`, `bench/cases/saxes.ts`, `bench/cases/sax.ts`, `bench/cases/txml.ts`, `bench/cases/parse-xml.ts`, `bench/cases/libxml2-wasm.ts`, `bench/cases/computis-effect-xml.ts`, `test/bench/registry.test.ts`
- deps: none
- red_first: yes
- status: pending

What is missing: there is no `bench/` directory, and `tsconfig.json:13` (`"include": ["src", "test", "tools", "vite.config.ts"]`) would leave it outside the type check. Every later slice of this phase codes against one contract and one registry; this slice creates them so the rest fan out without sharing a file.

Change:

- `tsconfig.json`: add `"bench"` to `include`. Nothing else.
- `package.json` `scripts`: add `"bench": "bun bench/run.ts"` and `"bench:node": "node bench/run.ts"`. Touch no dependency (`perf1-2` owns those).
- `bench/types.ts`: the Shared contract above, verbatim in shape, with JSDoc per R-doc.
- `bench/tokenizers.ts`: `tokenizers: Readonly<Record<string, Tokenizer>> = { upstream: defaultTokenizer }` (`defaultTokenizer` from `../src/tokenizer.ts:114`), and `tokenizerNames`.
- `bench/vocabulary.ts`: `bank = XmlSchema.namespaces({ "": QTI })`; `ItemBank = bank.Element("qti-item-bank", { content: XmlSchema.elements({ refs: XmlSchema.Array(ItemRef) }) })`; `bankPath = [XmlSchema.clark(Option.some(QTI), "qti-item-bank"), XmlSchema.clark(Option.some(QTI), "qti-assessment-item-ref")]`; `bankPrefixes = { "": QTI }`. `ItemRef` and `QTI` come from `../test/streaming/vocabulary.ts` (`:67`, `:16`); `XmlSchema` from `../src/index.ts`.
- `bench/inputs/chunk.ts`: `chunkBytes = 65_536` and `chunk(text, size = chunkBytes): readonly string[]` (consecutive slices of `size` UTF-16 code units; a lone surrogate split across slices is fine for the upstream text parser, which buffers; the test covers a split pair).
- `bench/inputs/reference.ts`: `countElements(text): Effect.Effect<number, Xml.XmlError>`: the number of `StartElement` events `Xml.decodeString()` yields for `Stream.make(text)` (the upstream tokenizer is the reference, as `test/round-trip.test.ts:46-56` pipes it); and `countTreeElements(element: ResolvedElement): number` (the root plus every element descendant; string children are not counted).
- `bench/inputs/corpus.ts` and `bench/inputs/synthetic.ts`: each exports `inputIds: readonly string[]` (the ids of the Shared contract that module owns: `corpus-all`, `corpus-items`; the six `bank-*` ids) and `loadInput(id: string): Effect.Effect<Option.Option<BenchInput>>` returning `Option.none()` for now (stubs; `perf1-6` and `perf1-7` fill them).
- Every `bench/cases/*.ts` file above: `export const cases: readonly BenchCase[] = []` and `export const libraries: readonly LibraryProfile[] = []` (stubs; one later slice owns each file). Import nothing from a competitor package.
- `bench/registry.ts`: `cases` (concatenation of every case module's `cases`), `libraries` (same), `inputIds` (concatenation of both input modules' ids), and `loadInput(id)` (the first module that returns `Some`). `perf1-6`, `perf1-7`, and the case slices never edit this file.

Test `test/bench/registry.test.ts`: case ids are unique (vacuous now, real once cases land); every case's `class` is one of the six; `inputIds` equals the eight Shared-contract ids; `tokenizers.upstream` is `defaultTokenizer`; `chunk` of a 150,000-character string yields three slices that join back to it, and of a string whose surrogate pair straddles a boundary still joins back; `countElements("<a><b/><c>t</c></a>")` is 3; `countTreeElements` of the `ElementFromString` decode of the same text is 3; `ItemBank` decodes an inline two-record bank (copy one record of the template in `perf1-7`) to `refs.length === 2`. red_first yes: write the test with `chunk` returning `[]` and `countElements` returning `Effect.succeed(0)`; it fails on those assertions, then implement.

Rules: R-effect, R-guide, R-doc, R-files, R-node, R-test, R-commit (`build(bench): add the benchmark skeleton and shared contract`).

Check: `bun x vp test test/bench/registry.test.ts && bun x vp check tsconfig.json package.json bench test/bench && bun -e 'await import("./bench/registry.ts")' && node --input-type=module -e 'await import("./bench/registry.ts")'`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-2: Add the competitor devDependencies (Mind-approved list only)

- write_scope: `package.json`, `bun.lock`
- deps: perf1-1
- red_first: no
- status: pending

Gate: dispatch only after the Mind approves this exact list (GOAL Constraints: "adding them needs the Mind's approval").

What is missing: no competitor library is installed (`package.json` `devDependencies` holds `@effect/vitest`, `@stylistic/eslint-plugin`, `@types/bun`, `@types/node`, `effect`, `typescript`, `ultracite`, `vite`, `vite-plus`).

Change: run once, from the repository root, `bun add --dev --exact fast-xml-parser@5.12.0 saxes@6.0.0 sax@1.6.1 @types/sax@1.2.7 txml@6.0.3 @rgrove/parse-xml@5.1.0 libxml2-wasm@0.7.2 @computis/effect-xml@0.4.0`. Reasons (one per package, for the commit body): each is a benchmark competitor named in want `86a9ce88` or GOAL Competitors; `@types/sax` because `sax` ships no types; `@computis/effect-xml` is the Effect Schema typed-decode competitor and brings `libxml2-wasm@0.7.2` (the same pin). Its `@effect/platform-bun` and `@effect/platform-node` peers are optional; if `bun add` installs either, or any package runs a postinstall script beyond its own build, stop and report it (GOAL Stop conditions). `effect` must stay at `4.1.2` in `bun.lock` (one copy); if a package resolves a second `effect`, stop and report.

No test: dependency metadata only. Check: `bun install --frozen-lockfile && grep -c '"effect@' bun.lock` (the second command prints how many `effect@` entries the lockfile holds; it must be 1) `&& bun -e 'await Promise.all(["fast-xml-parser","saxes","sax","txml","@rgrove/parse-xml","libxml2-wasm","@computis/effect-xml"].map((p) => import(p)))'`.

Rules: R-commit (`build(bench): add the benchmark competitor devDependencies`, with the reasons in the body).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-3: Timing sampler with nearest-rank quantiles and a measured floor

- write_scope: `bench/harness/sample.ts`, `test/bench/sample.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: a timing loop that yields the latency distribution the owner asked for (median, p95, p99) and time to first record.

Change: new `bench/harness/sample.ts` exporting:

- `SamplePolicy` (`warmupIterations`, `warmupMs`, `minSamples`, `minMs`, `maxSamples`, `maxMs`) and `defaultPolicy = { warmupIterations: 5, warmupMs: 1000, minSamples: 30, minMs: 3000, maxSamples: 200, maxMs: 60_000 }` and `smokePolicy = { warmupIterations: 0, warmupMs: 0, minSamples: 1, minMs: 0, maxSamples: 1, maxMs: 0 }`.
- `sample(prepared: PreparedCase, policy): { readonly wallMs: readonly number[]; readonly firstRecordMs: readonly number[] }`, synchronous: warm up until both warmup bounds are met (warmup stops at `maxMs` too), then time each `prepared.run(mark)` with `performance.now()`, storing the output in a module-level sink; stop once `samples >= minSamples && elapsed >= minMs`, or at `maxSamples`, or at `maxMs` (always at least one sample). `mark` records the offset from that iteration's start the first time it is called in the iteration; `firstRecordMs` is empty when `mark` was never called.
- `quantiles(xs: readonly number[]): Quantiles` (nearest-rank: `sorted[Math.ceil(q * n) - 1]`; `min`, `max`); a defect (`throw` is not allowed; return via `Option` or require a non-empty array type) on an empty array: take `Arr.NonEmptyReadonlyArray<number>`.
- `floor(policy): Quantiles`: `quantiles(sample(noop, policy).wallMs)` where `noop` returns `undefined`.

Test `test/bench/sample.test.ts`: `quantiles([1..100])` has median 50, p95 95, p99 99, min 1, max 100; `quantiles([7])` is all 7; `sample` with `smokePolicy` calls `run` exactly once after zero warmups (count calls in the fake) and returns one sample; with `{ ...smokePolicy, minSamples: 5, maxSamples: 5 }` it returns five; a fake whose `run` calls `mark` twice records one `firstRecordMs` per iteration; a fake that never calls `mark` yields an empty `firstRecordMs`. Assert counts, never timing values. red_first yes: stub `sample` to return empty arrays and `quantiles` to return zeros; the tests fail on the counts and quantile values.

Rules: R-effect (the loop is synchronous; `no-await-in-loop` does not arise), R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/sample.test.ts && bun x vp check bench/harness/sample.ts test/bench/sample.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-4: Resource metrics: CPU, peak RSS, heap, allocation rate, GC count and pause

- write_scope: `bench/harness/metrics.ts`, `test/bench/metrics.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: the non-time half of the owner's metric set (GOAL "The owner's metric set"): CPU user and system, peak RSS, heap used, allocation rate, GC count and pause.

Change: new `bench/harness/metrics.ts` exporting `measureResources<A>(body: () => A): { readonly value: A; readonly elapsedMs: number; readonly resources: Resources }`, where `Resources` holds the `Measured` fields of `CaseMetrics` other than throughput and latency (`cpuUserMs`, `cpuSystemMs`, `peakRssBytes`, `heapUsedBytes`, `allocationBytesPerSecond`, `gcCount`, `gcPauseMs`), and `heapProbe(): void` (records `process.memoryUsage().heapUsed` into a running maximum the current `measureResources` call reports; the sampler is not changed, so `perf1-20` calls `heapProbe` between samples by wrapping the case's `run`).

- CPU: the `process.resourceUsage()` delta of `userCPUTime` and `systemCPUTime` (microseconds) converted to ms; source `process.resourceUsage`.
- Peak RSS: `process.resourceUsage().maxRSS` after the body, converted from kilobytes to bytes; source `process.resourceUsage maxRSS (process lifetime)`. Process-per-case isolation (`perf1-20`) makes it the case's.
- Heap used: the running maximum of `heapUsed` (start, every `heapProbe`, end); source `process.memoryUsage heapUsed`.
- GC: `new v8.GCProfiler()` (`node:v8`) started before and stopped after the body. `gcCount` is `statistics.length`; `gcPauseMs` is the sum of `cost` (microseconds) in ms. Allocation bytes over the body: with `used(x) = x.heapStatistics.usedHeapSize`, sum over GCs of `used(beforeGC_i) - used(afterGC_{i-1})` (with `afterGC_{-1}` the start reading) plus the end reading minus `used(afterGC_last)`; `allocationBytesPerSecond` is that over `elapsedMs / 1000`. Source on Node: `node:v8 GCProfiler`. On Bun the same API returns statistics (probed at `28a045b`) whose fidelity is unverified: source `node:v8 GCProfiler on Bun (fidelity unverified)` (GOAL open question 3). If `GCProfiler` is not a function, every GC-derived field is `{ unavailable: "node:v8 GCProfiler absent on <runtime> <version>" }`.

Test `test/bench/metrics.test.ts` (Node): `measureResources` over a body that allocates and drops about 50 MiB of small objects returns the body's value, `cpuUserMs` with a non-negative value, `peakRssBytes` at least `process.memoryUsage().rss` measured inside the body, `gcCount` greater than 0, and `allocationBytesPerSecond` greater than 0; every field is either `{ value, unit, source }` or `{ unavailable }` (structure check over all seven). red_first yes: stub every field as `{ unavailable: "stub" }`; the value assertions fail.

Sanity on Bun (record the printed object in the slice report): `bun -e 'const m = await import("./bench/harness/metrics.ts"); console.log(JSON.stringify(m.measureResources(() => { let a = []; for (let i = 0; i < 2e6; i++) { a.push({ i }); if (a.length > 1e4) a = []; } return 0; }).resources))'`.

Rules: R-guide (`// Native:` line: `Effect.Metric` measures application metrics, not process resources), R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/metrics.test.ts && bun x vp check bench/harness/metrics.ts test/bench/metrics.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-5: Environment record: machine, OS, runtime, package versions, commit

- write_scope: `bench/harness/environment.ts`, `test/bench/environment.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: the owner requires "the machine, versions, and method stated, so the runs reproduce".

Change: new `bench/harness/environment.ts` exporting `measuredPackages` (`effect`, `fast-xml-parser`, `saxes`, `sax`, `txml`, `@rgrove/parse-xml`, `libxml2-wasm`, `@computis/effect-xml`) and `environment: Effect.Effect<Environment>`: `runtime` and `runtimeVersion` from `process.versions.bun` (Bun) or `process.versions.node`; `os` (`os.type()` plus `os.release()`), `arch`, `cpuModel` (`os.cpus()[0]` model), `cores` (`os.availableParallelism()`), `totalMemoryBytes` (`os.totalmem()`); `commit` from `git rev-parse HEAD` and `dirty` from a non-empty `git status --porcelain`, both via `execFileSync` inside `Effect.try` (on failure `commit` is `"unknown"` and `dirty` `true`); `packages[name]` the `version` of `node_modules/<name>/package.json` read relative to this file, or `"absent"` when the file does not exist.

Test `test/bench/environment.test.ts`: `runtime` is `"node"` under Vitest; `packages.effect` equals the version in `node_modules/effect/package.json` read by the test; every `measuredPackages` name is a key; `commit` matches `/^[0-9a-f]{40}$|^unknown$/`; `cores` and `totalMemoryBytes` are positive. red_first yes: stub `environment` with empty strings, zeros, and `{}`; the assertions fail.

Rules: R-effect, R-guide, R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/environment.test.ts && bun x vp check bench/harness/environment.ts test/bench/environment.test.ts && bun -e 'const m = await import("./bench/harness/environment.ts"); const E = await import("effect/Effect"); console.log(E.runSync(m.environment).runtime)'` (prints `bun`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-6: Corpus inputs: every QTI fixture, and the four typed-decode fixtures

- write_scope: `bench/inputs/corpus.ts`, `test/bench/corpus.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: `loadInput` in `bench/inputs/corpus.ts` (stub from `perf1-1`) returns `Option.none()` for `corpus-all` and `corpus-items`.

Change: `corpus-all` is every `*.xml` in `spikes/fixtures/qti/` (enumerate with `readdirSync`, sorted by name, as `test/round-trip.test.ts:31-33` enumerates; never a hand-written list), `corpus-items` the four files of `test/qti/vocabulary.test.ts:22-27` (`bg007-true-false.xml`, `bpig-hotspot.xml`, `bg010-missing-word.xml`, `extended-text-postcard.xml`). Each document is `{ name, text, chunks: chunk(text) }`; `bytes` is `Buffer.byteLength` summed; `reference.elements` is `countElements` (`bench/inputs/reference.ts`) summed over documents; `reference.records` is the number of documents. Any other id returns `Option.none()`.

Test `test/bench/corpus.test.ts`: `corpus-all` holds as many documents as `readdirSync` of the fixture directory lists `.xml` files (measured in the test); `corpus-items` holds four, named as above; `reference.elements` of `corpus-items` equals the sum of `countElements` over the four files read by the test; `bytes` equals the summed `Buffer.byteLength`; `loadInput("bank-16k")` is `None`. red_first yes: the stub returns `None` for both ids, so the first assertion fails.

Rules: R-effect, R-guide, R-doc, R-files (read by path, never import `spikes/`), R-node, R-test, R-commit.

Check: `bun x vp test test/bench/corpus.test.ts && bun x vp check bench/inputs/corpus.ts test/bench/corpus.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-7: Synthetic item bank at four sizes, plus bad-last error-path variants

- write_scope: `bench/inputs/synthetic.ts`, `test/bench/synthetic.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: the large documents for the scaling curve (GOAL open question 2, default): `loadInput` in `bench/inputs/synthetic.ts` returns `Option.none()`.

Change: generate in memory, deterministically, no file written. A bank is `<?xml version="1.0" encoding="UTF-8"?>\n<qti-item-bank xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">\n`, then records `i = 0, 1, ...`, then `</qti-item-bank>\n`. Record `i`:

```xml
  <qti-assessment-item-ref identifier="item-{i}" href="items/item-{i}.xml" category="section-{i % 8}" required="true" fixed="false">
    <qti-weight identifier="W{i % 4}" value="{(i % 10) / 2 + 0.5}"/>
    <qti-branch-rule target="item-{i + 1}">
      <qti-match>
        <qti-variable identifier="SCORE-{i}"/>
        <qti-correct identifier="RESPONSE-{i}"/>
      </qti-match>
    </qti-branch-rule>
  </qti-assessment-item-ref>
```

Add records until the document reaches the target (16,384; 262,144; 4,194,304; 67,108,864 UTF-8 bytes for `bank-16k`, `bank-256k`, `bank-4m`, `bank-64m`); it may exceed the target by less than one record. `reference.records` is the record count; `reference.elements` is `1 + 6 * records`. The `-bad-last` ids (`bank-256k-bad-last`, `bank-4m-bad-last`) are the same documents with ` href="items/item-{last}.xml"` removed from the last record only. One document per input; `chunks = chunk(text)`.

Test `test/bench/synthetic.test.ts`: `bank-16k` `bytes` is at least 16,384 and below 16,384 plus one record's byte length; `countElements(text)` equals `reference.elements`; `Schema.decodeUnknownEffect(XmlSchema.fromString(ItemBank))(text)` yields `refs.length === reference.records`; `bank-256k-bad-last` fails that decode and `XmlSchema.decodeErrorOf` on the failure's `issue` is `Some` with `reason._tag === "SchemaFailure"`; two loads of `bank-16k` are equal strings. Do not load `bank-64m` in the test (a sanity command below covers it). red_first yes: the stub returns `None`, so the first load fails.

Rules: R-effect, R-guide, R-doc, R-files, R-node, R-test (`ItemBank` from `bench/vocabulary.ts`), R-commit.

Check: `bun x vp test test/bench/synthetic.test.ts && bun x vp check bench/inputs/synthetic.ts test/bench/synthetic.test.ts && bun -e 'const m = await import("./bench/inputs/synthetic.ts"); const E = await import("effect/Effect"); const i = E.runSync(m.loadInput("bank-64m")); console.log(i._tag, i._tag === "Some" ? i.value.bytes : 0)'` (prints `Some` and a size of at least 67108864).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-8: CPU-profile self time bucketed by layer

- write_scope: `bench/profile/cpu-buckets.ts`, `test/bench/cpu-buckets.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: the cross-check of the differential profile (GOAL "Per-layer profile targets"): which layer a CPU sample's self time belongs to. Both runtimes write Chrome `.cpuprofile` JSON under `--cpu-prof` (`nodes[].callFrame.{functionName,url,lineNumber}`, `samples`, `timeDeltas`; probed at `28a045b`).

Change: new `bench/profile/cpu-buckets.ts` exporting `Layer` (`"tokenizer" | "resolver-collector" | "schema" | "positions" | "effect-runtime" | "harness" | "other"`), `layerOf(url: string): Layer`, and `bucket(profile): Readonly<Record<Layer, number>>` (self time in ms per layer: sample `i` adds `timeDeltas[i]` microseconds to the node `samples[i]`; a node's layer is `layerOf(node.callFrame.url)`). Rules for `layerOf`, first match wins: a path containing `/effect/dist/encoding/Xml` or ending `/src/tokenizer.ts` is `tokenizer`; ending `/src/resolve.ts` is `resolver-collector` (one file holds both; the ladder of `perf1-21` separates them); ending `/src/positions.ts` or `/src/record-path.ts` is `positions`; any other `/src/*.ts` or a `/effect/dist/Schema` path is `schema`; any other `/effect/dist/` path is `effect-runtime`; a `/bench/` path is `harness`; everything else (empty URL, `(garbage collector)`, `(program)`, `(idle)`, `node:` URLs) is `other`. A CLI entry when run directly (`import.meta.main` on Bun, or `process.argv[1]` equal to this file's path) prints the JSON of `bucket` for the file in `process.argv[2]`.

Test `test/bench/cpu-buckets.test.ts`: an inline profile with nodes whose URLs end in `node_modules/effect/dist/encoding/Xml.js`, `src/resolve.ts`, and `node_modules/effect/dist/Stream.js`, samples `[1, 2, 3, 3]` and `timeDeltas` `[1000, 2000, 3000, 4000]`, buckets to `tokenizer` 1, `resolver-collector` 2, `effect-runtime` 7, and 0 for the rest; `layerOf` maps each rule's example. red_first yes: stub `bucket` to all zeros.

Rules: R-effect, R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/cpu-buckets.test.ts && bun x vp check bench/profile/cpu-buckets.ts test/bench/cpu-buckets.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-9: effect-xml cases: events, tree, encode-tree, and the library profile

- write_scope: `bench/cases/effect-xml-parse.ts`, `test/bench/effect-xml-parse.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: `bench/cases/effect-xml-parse.ts` (stub) has no cases.

Change: three cases, each accepting every input id except the `-bad-last` ones, each `run` iterating the input's documents:

- `effect-xml/events`: per document `Stream.fromIterable(doc.chunks).pipe(Stream.pipeThroughChannel(tokenizer.decodeString()), Stream.runFold(() => 0, (n, e) => (e._tag === "StartElement" ? n + 1 : n)), Effect.runSync)`, summed. It calls the tokenizer passed to `prepare`, so swapping the tokenizer swaps this case. `check` is the sum; `expected` is `reference.elements`. Every `events` competitor counts start tags the same way.
- `effect-xml/tree`: per document `Schema.decodeUnknownEffect(XmlSchema.ElementFromString(prefixes, unlimited))(doc.text).pipe(Effect.provideService(XmlSchema.Tokenizer, tokenizer), Effect.runSync)`; `check` sums `countTreeElements` (`bench/inputs/reference.ts`); `expected` is `reference.elements`. `prefixes` is read from each document's `xmlns` declarations with the regex of `test/round-trip.test.ts:67-73` (copy it; it is not exported).
- `effect-xml/encode-tree`: `prepare` decodes each document once as above; `run` encodes each tree with `Schema.encodeEffect(XmlSchema.ElementFromString(prefixes, { ...unlimited, declaration: false }))`, same provide and `runSync`; `check` sums `countElements` of the outputs (`Effect.runSync`); `expected` is `reference.elements`.

`libraries` holds one `LibraryProfile` for `@aidenzepp/effect-xml`, set from the probes of the Shared contract run against `XmlSchema.ElementFromString` (and `typed`/`streams`/`reportsPositions` from the public API: `fromString`, `decodeSchemaString`, `positions: true`).

Test `test/bench/effect-xml-parse.test.ts`: for an inline input built in the test (a two-document `BenchInput` with known counts, so this slice needs no input module), each case's `check(run(() => {}))` equals `expected`; with `spyTokenizer()` (`test/tokenizer/fakes.ts:35`) passed to `prepare`, running each case records at least one call in `spy.calls` (proves the swap is real); every probe of the exported profile matches a probe the test runs. red_first yes: export the three cases with `run` returning `0` and the test fails on the count.

Rules: R-effect, R-guide, R-case, R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/effect-xml-parse.test.ts && bun x vp check bench/cases/effect-xml-parse.ts test/bench/effect-xml-parse.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-10: effect-xml cases: typed-decode and encode-typed

- write_scope: `bench/cases/effect-xml-typed.ts`, `test/bench/effect-xml-typed.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: `bench/cases/effect-xml-typed.ts` (stub) has no cases.

Change: two cases accepting `corpus-items` and the four `bank-*` sizes (not `-bad-last`, not `corpus-all`). The definition is `AssessmentItem` (`test/qti/vocabulary.ts:365`) for `corpus-items` and `ItemBank` (`bench/vocabulary.ts`) for a bank; build `XmlSchema.fromString(Def, unlimited)` once in `prepare`.

- `effect-xml/typed-decode`: `run` decodes each document with `Schema.decodeUnknownEffect(codec)(doc.text).pipe(Effect.provideService(XmlSchema.Tokenizer, tokenizer), Effect.runSync)`; `check` is the number of decoded documents for `corpus-items` and `refs.length` for a bank; `expected` is `reference.records`.
- `effect-xml/encode-typed`: `prepare` decodes once; `run` encodes each value with `Schema.encodeEffect(XmlSchema.fromString(Def, { ...unlimited, declaration: false }))`, same provide and `runSync`; `check` re-decodes the outputs and counts as `typed-decode` does; `expected` is `reference.records`.

Test `test/bench/effect-xml-typed.test.ts`: on an inline two-record bank and on `bg007-true-false.xml` read by path (both as `BenchInput`s built in the test), `check(run(() => {}))` equals `expected` for both cases; with `spyTokenizer()` each case records at least one tokenizer call; `accepts` is true for `corpus-items` and `bank-4m` and false for `corpus-all` and `bank-4m-bad-last`. red_first yes: export the cases with `run` returning an empty value and the count fails.

Rules: R-effect, R-guide, R-case, R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/effect-xml-typed.test.ts && bun x vp check bench/cases/effect-xml-typed.ts test/bench/effect-xml-typed.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-11: effect-xml cases: stream with time to first record, positions off and on

- write_scope: `bench/cases/effect-xml-stream.ts`, `test/bench/effect-xml-stream.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: `bench/cases/effect-xml-stream.ts` (stub) has no cases; the owner asks for "time to first record when streaming".

Change: two cases accepting the four `bank-*` sizes: `effect-xml/stream` and `effect-xml/stream/positions`. `prepare` builds `XmlSchema.decodeSchemaString(ItemRef, bankPath)` once (`src/channel.ts:392`; `ItemRef` from `test/streaming/vocabulary.ts:67`, `bankPath` from `bench/vocabulary.ts`). `run(mark)` is `Stream.fromIterable(doc.chunks).pipe(Stream.pipeThroughChannel(channel({ positions })), Stream.tap(...) that calls mark() once on the first record, Stream.runCount, Effect.provideService(XmlSchema.Tokenizer, tokenizer), Effect.runSync)` with `positions` `false` and `true` respectively; `check` is the count; `expected` is `reference.records`.

Test `test/bench/effect-xml-stream.test.ts`: on an inline three-record bank split into two chunks, both cases' `check(run(mark))` equals 3 and `mark` was called exactly once per run; with `spyTokenizer()`, the plain case records a `decodeString` call (the positions case with the default tokenizer scans instead, `src/channel.ts:417-425`, so assert only that it succeeds). red_first yes: export the cases with `run` returning 0 and never calling `mark`.

Rules: R-effect, R-guide, R-case, R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/effect-xml-stream.test.ts && bun x vp check bench/cases/effect-xml-stream.ts test/bench/effect-xml-stream.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-12: Report renderer: results JSON to Markdown tables

- write_scope: `bench/report.ts`, `test/bench/report.test.ts`
- deps: perf1-1
- red_first: yes
- status: pending

What is missing: a way to turn `RunFile` JSON into the tables `docs/rd/performance.md` carries, so the document is generated, not hand-copied.

Change: new `bench/report.ts` exporting `render(files: readonly RunFile[], libraries: readonly LibraryProfile[]): string`:

1. An environment table (one column per runtime) and a method list per file.
2. A capability table from `libraries` (one row per library, one column per probe, plus notes).
3. Per class, per input, one table per runtime: library, case id, samples, median, p95, p99 (ms), MB/s, ratio to the fastest median in that table (`1.00x` for the fastest), CPU user and system (ms), peak RSS (MiB), heap used (MiB), allocation (MB/s), GC count, GC pause (ms), and for `stream` time to first record median/p95/p99. A `Measured` that is `unavailable` renders `n/a` with a numbered footnote carrying its reason. Rows are ordered by median.
4. A scaling-curve table per runtime: one row per case id with a result on a `bank-*` input, one column per bank size (median ms and MB/s).
5. A failures list when any file has failures.

A CLI entry when run directly reads the JSON files named in `process.argv` and prints `render(files, libraries)` with `libraries` from `bench/registry.ts`.

Test `test/bench/report.test.ts`: an inline `RunFile` with three results in one class and input and one `unavailable` GC field renders a table with three data rows in median order, `1.00x` on the fastest row, `n/a` with a footnote containing the reason, and a scaling row for each case on a `bank-*` input. Assert on row counts and cell values parsed from the output lines, not on whole-output text. red_first yes: stub `render` to return `""`.

Rules: R-effect, R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/report.test.ts && bun x vp check bench/report.ts test/bench/report.test.ts`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Competitor adapters (`perf1-13`..`perf1-19`)

Each adapter fills its stub `bench/cases/<library>.ts` with the cases its row names and one `LibraryProfile`, and adds `test/bench/<library>.test.ts`. Shared brief for all seven:

- Every case follows R-case. A library call that can throw is wrapped once around the batch by the harness; the adapter adds no `try`. Compile or construct the parser once in `prepare` when the library allows reuse; otherwise construct it in `run` and say so in a one-line comment (a user pays that cost too).
- `check` counts from the library's own output, outside the timed loop: start-tag events for `events`, elements in the tree for `tree`, `countElements` (`bench/inputs/reference.ts`) of the output text for `encode-tree`, decoded records for `typed-decode`/`encode-typed`/`stream`. `expected` is `reference.elements` or `reference.records`.
- Use the library's default options except where the row says otherwise, and name every non-default option in the profile's `notes` with the reason.
- `accepts`: the row's inputs; never a `-bad-last` input.
- Test: on an inline two-record bank (copy one record of the `perf1-7` template) and on `bg007-true-false.xml` read by path, each case's `check(run(() => {}))` equals `expected`; each probe of the Shared contract, run against the library in the test, equals the exported profile. red_first yes: export the cases with `run` returning an empty result; the count fails.
- Rules: R-effect, R-guide, R-case, R-doc, R-files, R-node, R-test, R-commit. If the library's published types do not cover a call the case needs, report `blocked-scope` rather than adding a declaration file.
- Check: `bun x vp test test/bench/<library>.test.ts && bun x vp check bench/cases/<library>.ts test/bench/<library>.test.ts && node --input-type=module -e 'const m = await import("./bench/cases/<library>.ts"); console.log(m.cases.length)'` (proves the adapter also loads on Node).
- Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-13: fast-xml-parser adapter: tree, encode-tree, typed-decode

- write_scope: `bench/cases/fast-xml-parser.ts`, `test/bench/fast-xml-parser.test.ts`
- deps: perf1-1, perf1-2
- red_first: yes
- status: pending

Cases: `fast-xml-parser/tree` (every input): `new XMLParser({ ignoreAttributes: false, preserveOrder: true })` built once; `run` is `parser.parse(doc.text)` per document; `check` walks the ordered output (each element is an object whose one non-`:@` key is the tag name). `preserveOrder` and `ignoreAttributes: false` are non-default: order and attributes are data in QTI, and effect-xml keeps both. `fast-xml-parser/encode-tree` (every input): `prepare` parses once; `run` is `new XMLBuilder({ ignoreAttributes: false, preserveOrder: true }).build(tree)` (builder built once). `fast-xml-parser/typed-decode` (the four `bank-*` sizes; GOAL open question 4): `new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", isArray })`, where `isArray` returns true for `qti-assessment-item-ref`, `qti-branch-rule`, `qti-weight`, followed by `Schema.decodeUnknownSync(PlainBank)` on the parsed object; `PlainBank` is a plain `Schema.Struct` built once that mirrors `ItemRef` (`test/streaming/vocabulary.ts:67-82`): the same attribute names and decoded types (`value` a finite number and `fixed`/`required` booleans decoded from their strings with the matching Effect `Schema` transformations; read `node_modules/effect/src/Schema.ts` for the names), `rules` and `weights` arrays. `check` is the number of decoded refs.

### perf1-14: saxes adapter: events, stream with time to first record

- write_scope: `bench/cases/saxes.ts`, `test/bench/saxes.test.ts`
- deps: perf1-1, perf1-2
- red_first: yes
- status: pending

Cases: `saxes/events` (every input): a new `SaxesParser()` per document (default `xmlns: false`, like the upstream tokenizer, which reports names as written); `opentag` handler counts; `run` writes each of `doc.chunks` then `close()`. `saxes/stream` (the four `bank-*` sizes): `new SaxesParser({ xmlns: true })` (non-default: the record path is namespace-qualified, as effect-xml's is), a record extractor that builds a plain object per `qti-assessment-item-ref` in the QTI namespace (attributes, and the names of its child elements) and, on its `closetag`, counts it and calls `mark()` on the first; `check` is the record count. Record `xmlns: true` support as `resolvesNamespaces: true` in the profile with that option named in `notes`.

### perf1-15: sax adapter: events

- write_scope: `bench/cases/sax.ts`, `test/bench/sax.test.ts`
- deps: perf1-1, perf1-2
- red_first: yes
- status: pending

Case: `sax/events` (every input): `sax.parser(true)` per document (strict mode, non-default: non-strict mode accepts malformed input, and every other entry is strict); `onopentag` counts; `run` writes each chunk then `close()`. Types come from `@types/sax` (`perf1-2`).

### perf1-16: txml adapter: tree, encode-tree

- write_scope: `bench/cases/txml.ts`, `test/bench/txml.test.ts`
- deps: perf1-1, perf1-2
- red_first: yes
- status: pending

Cases: `txml/tree` (every input): `parse(doc.text)` with default options; `check` walks nodes that have a `tagName` (string children are text; the `?xml` declaration node, if returned, is not an element: state how it is counted in a comment). `txml/encode-tree` (every input): `prepare` parses once; `run` is txml's `stringify` of the tree.

### perf1-17: @rgrove/parse-xml adapter: tree

- write_scope: `bench/cases/parse-xml.ts`, `test/bench/parse-xml.test.ts`
- deps: perf1-1, perf1-2
- red_first: yes
- status: pending

Case: `parse-xml/tree` (every input): `parseXml(doc.text)` with default options; `check` counts `XmlElement` nodes. The library has no serializer; record that in `notes` (it enters no encode class).

### perf1-18: libxml2-wasm adapter: tree, encode-tree

- write_scope: `bench/cases/libxml2-wasm.ts`, `test/bench/libxml2-wasm.test.ts`
- deps: perf1-1, perf1-2
- red_first: yes
- status: pending

Cases: `libxml2-wasm/tree` (every input): `XmlDocument.fromString(doc.text)`. Its README requires `dispose()` to avoid a leak, so `run` first disposes the documents the previous iteration returned (inside the timed region: a user pays it), then parses; `check` traverses the returned documents' elements. `libxml2-wasm/encode-tree` (every input): `prepare` parses once (disposed by a finalizer the case registers with the batch, or at process exit since each case runs in its own process; say which in a comment); `run` serializes each document with the library's to-string API (read its `.d.ts` for the name and the no-formatting option). Record in `notes` that the WebAssembly heap is outside the JavaScript heap, so `heapUsedBytes` understates its memory and peak RSS is the comparable figure.

### perf1-19: @computis/effect-xml adapter: typed-decode, encode-typed

- write_scope: `bench/cases/computis-effect-xml.ts`, `test/bench/computis-effect-xml.test.ts`
- deps: perf1-1, perf1-2
- red_first: yes
- status: pending

Cases: `computis-effect-xml/typed-decode` and `computis-effect-xml/encode-typed` (the four `bank-*` sizes): a Schema for the bank in that library's own annotation style (`root("qti-item-bank", { namespace })` with the QTI namespace, an array of `qti-assessment-item-ref` structs whose listed fields are attributes via `element({ attributes })`, with `rules` and `weights` as in `ItemRef`), compiled once with `codec(schema)` in `prepare` (`Effect.fromResult`; an `XmlPlanError` fails `prepare` with `CaseError`). `run` is `decode(doc.text)` (or `encode(value)` on a value decoded once in `prepare`) under `Effect.runSync`. Leave `jit` at its default (`true`) and record it. If the library cannot express the bank (repeated sibling arrays, the default namespace, or the nested branch rule), export no case for that class, record exactly what it cannot express in `notes`, and make the test assert that `cases` omits it; that is a valid result, not a blocker. It enters no `tree`, `events`, or `stream` class.

### perf1-20: Runner: process-per-case child and the matrix driver

- write_scope: `bench/case-process.ts`, `bench/run.ts`, `test/bench/run.test.ts`
- deps: perf1-3, perf1-4, perf1-5, perf1-6, perf1-7, perf1-9, perf1-10, perf1-11
- red_first: yes
- status: pending

What is missing: the entry points `package.json` `bench` and `bench:node` name (`perf1-1`).

Change:

- `bench/case-process.ts` (child): arguments `--case <id> --input <id> --tokenizer <name> [--smoke]`. Resolve the case (`bench/registry.ts` `cases`), input (`loadInput`), and tokenizer (`bench/tokenizers.ts`); an unknown name prints `{ "failure": ... }` and exits 2. Run `prepare`, then `check(run(() => {}))` against `expected` once (mismatch: failure, exit 1). Then `measureResources` (`bench/harness/metrics.ts`) around `sample` (`bench/harness/sample.ts`, `defaultPolicy` or `smokePolicy`), wrapping `run` so `heapProbe()` runs after each call (the probe sits inside the timed call; a single `process.memoryUsage()` read, stated in the module JSDoc). Build `CaseMetrics`: `wallMs = quantiles(wall)`, `throughputMBps = bytes / (median / 1000) / 1e6` with source `input UTF-8 bytes / median`, `timeToFirstRecordMs` only when the case marked, the `Resources` fields as measured. Print exactly one line, `{ "result": CaseResult }` or `{ "failure": CaseFailure }`, to stdout, and exit 0 or 1. A thrown library error is caught by `Effect.try` around the batch and becomes a failure.
- `bench/run.ts` (driver): arguments `[--smoke] [--filter <substring of case id>] [--input <id>]... [--tokenizer <name>] [--out <path>]`. `matrix(cases, inputIds, filter, inputs)`: every pair with `case.accepts({ id, family })`, minus `-bad-last` ids; `--smoke` limits inputs to `corpus-items`, `corpus-all`, `bank-16k`. Run each pair, one at a time, as `execFileSync(process.execPath, [caseProcessPath, ...args])` (`process.execPath` is `bun` under Bun and `node` under Node, so the child runs on the driver's runtime) inside `Effect.try`, parse its line, collect results and failures. Build `Method` from the policy, `chunkBytes`, and `floorMs = floor(policy)`, and `Environment` from `bench/harness/environment.ts`. Write the `RunFile` JSON (two-space indent) to `--out`, default `work/bench/<runtime>-<ISO time with ":" replaced by "-">.json`, creating the directory. Print one summary line (results, failures, output path). Exit 1 when there is any failure.

Test `test/bench/run.test.ts` (pure parts only; no child process in Vitest): `matrix` with two fake cases (one accepting only `bank-*`) and the eight input ids (`inputIds` from `bench/registry.ts`) yields the expected pairs and never a `-bad-last` id; `--smoke` limits inputs as stated; argument parsing maps each flag. red_first yes: stub `matrix` to return `[]`.

Rules: R-effect, R-guide (`// Native:` line on the spawn: `effect/unstable/process` needs a platform layer that is not a dependency), R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/run.test.ts && bun x vp check bench/case-process.ts bench/run.ts test/bench/run.test.ts && bun bench/run.ts --smoke --filter effect-xml --out work/bench/smoke-bun.json && node bench/run.ts --smoke --filter effect-xml --out work/bench/smoke-node.json` (both exit 0; `work/` is gitignored). Competitor cases join the smoke run once their slices are accepted; `perf1-tidy` runs the unfiltered smoke.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-21: Differential layer ladder

- write_scope: `bench/profile/layers.ts`, `test/bench/layers.test.ts`
- deps: perf1-3, perf1-7
- red_first: yes
- status: pending

What is missing: the per-layer profile (GOAL "Per-layer profile targets"), timed by adding one layer at a time.

Change: new `bench/profile/layers.ts` exporting `rungs` and a CLI. Each rung is a `PreparedCase` over one bank input (default inputs `bank-256k` and `bank-4m`; `--input` overrides), all with the upstream tokenizer from `bench/tokenizers.ts` unless `--tokenizer` names another:

| Rung                   | Pipeline over the input's chunks (`Effect.runSync`)                                                                            | `check` / `expected`                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `transport`            | `Stream.fromIterable(chunks)`, `Stream.runCount`                                                                               | chunk count / `chunks.length`                                      |
| `tokenizer`            | + `tokenizer.decodeString()`, count `StartElement`                                                                             | / `reference.elements`                                             |
| `resolver`             | + `resolveEvents()` (`src/resolve.ts:527`), count resolved starts                                                              | / `reference.elements`                                             |
| `collector`            | + `collect(bankPath)` (`src/resolve.ts:934`), `runCount`                                                                       | / `reference.records`                                              |
| `schema`               | `decodeSchemaString(ItemRef, bankPath)()` in place of the three channels                                                       | / `reference.records`                                              |
| `positions`            | the same with `{ positions: true }`                                                                                            | / `reference.records`                                              |
| `tree-document`        | `XmlSchema.ElementFromString(bankPrefixes, unlimited)` decode of the text                                                      | `countTreeElements` / `reference.elements`                         |
| `typed-document`       | `XmlSchema.fromString(ItemBank, unlimited)` decode of the text                                                                 | `refs.length` / `reference.records`                                |
| `error-document`       | `XmlSchema.fromString(ItemBank, unlimited)` decode of the matching `-bad-last` text, failure kept as a value (`Effect.result`) | 1 when `decodeErrorOf` gives `reason._tag === "SchemaFailure"` / 1 |
| `chunk-4k`, `chunk-1m` | the `tokenizer` rung re-chunked at 4,096 and 1,048,576 characters (`chunk` from `bench/inputs/chunk.ts`)                       | / `reference.elements`                                             |

Read the current signatures of `resolveEvents`, `collect`, and the resolved event type in `src/resolve.ts` before wiring them (cut-time anchors above). The CLI samples every rung with `defaultPolicy` (or `smokePolicy` under `--smoke`), checks each rung once before sampling (a mismatch fails the run), and writes `{ environment, method, ladders: [{ input, rungs: [{ id, wallMs: Quantiles, deltaMedianMs }] }] }` to `--out` (default `work/bench/layers-<runtime>-<time>.json`), where `deltaMedianMs` is the rung's median minus the previous streaming rung's (`transport` through `positions`; the document rungs have none). Wall time only: the ladder runs in one process and reports no memory metrics; state that in the module JSDoc.

Test `test/bench/layers.test.ts`: on `bank-16k` every rung's `check(run(() => {}))` equals its `expected`, rung ids are unique and in table order. red_first yes: stub every rung's `run` to return 0.

Rules: R-effect, R-guide, R-case, R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/layers.test.ts && bun x vp check bench/profile/layers.ts test/bench/layers.test.ts && bun bench/profile/layers.ts --smoke --input bank-16k --out work/bench/layers-smoke-bun.json && node bench/profile/layers.ts --smoke --input bank-16k --out work/bench/layers-smoke-node.json`.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-22: CPU-profile driver

- write_scope: `bench/profile/cpu.ts`, `test/bench/cpu.test.ts`
- deps: perf1-8, perf1-20
- red_first: yes
- status: pending

What is missing: a reproducible way to produce and bucket CPU profiles on both runtimes.

Change: new `bench/profile/cpu.ts`. For the case ids `effect-xml/events`, `effect-xml/tree`, `effect-xml/typed-decode`, `effect-xml/stream`, `effect-xml/stream/positions` on `--input` (default `bank-4m`), run `execFileSync(process.execPath, ["--cpu-prof", "--cpu-prof-dir=<dir>", caseProcessPath, "--case", id, "--input", input, "--tokenizer", name])` with `<dir>` a fresh `work/bench/profiles/<runtime>-<time>/<case id with "/" replaced by "-">/` (both runtimes accept `--cpu-prof` and `--cpu-prof-dir=`; probed at `28a045b`), read the one `.cpuprofile` written there, `bucket` it (`bench/profile/cpu-buckets.ts`), and write `{ environment, profiles: [{ caseId, input, totalMs, buckets }] }` to `--out` (default `work/bench/cpu-<runtime>-<time>.json`). The profile spans the whole child (prepare, check, warmup, samples); state that in the module JSDoc. Export the pure `profileArgs(execArgs, dir, caseProcessPath, id, input, tokenizer)` for the test.

Test `test/bench/cpu.test.ts`: `profileArgs` puts `--cpu-prof` and `--cpu-prof-dir=<dir>` before the script path and the case arguments after it. red_first yes: stub `profileArgs` to return `[]`.

Rules: R-effect, R-guide, R-doc, R-files, R-node, R-test, R-commit.

Check: `bun x vp test test/bench/cpu.test.ts && bun x vp check bench/profile/cpu.ts test/bench/cpu.test.ts && bun bench/profile/cpu.ts --input bank-16k --out work/bench/cpu-smoke-bun.json && node bench/profile/cpu.ts --input bank-16k --out work/bench/cpu-smoke-node.json` (each writes five profiles whose bucket totals are positive).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-tidy: Tidy the benchmark harness

- write_scope: `tsconfig.json`, `package.json` (scripts only), every file under `bench/` and `test/bench/`, plus new files under those two directories
- deps: perf1-1, perf1-2, perf1-3, perf1-4, perf1-5, perf1-6, perf1-7, perf1-8, perf1-9, perf1-10, perf1-11, perf1-12, perf1-13, perf1-14, perf1-15, perf1-16, perf1-17, perf1-18, perf1-19, perf1-20, perf1-21, perf1-22
- red_first: no
- status: pending

Apply the cleanliness lens (the `cleanliness` skill) to the files this phase changed, with no behavior change: shared walking or option code duplicated across adapters may move into a new file under `bench/cases/`; names stay consistent with the Shared contract. Do not change the sampling policy, the metric formulas, the case options, or any `check`: the witness runs that follow measure this code. You may restructure tests without changing what they assert; add none. A behavior change found while tidying is not made; report it as a follow-up.

Check: every `test/bench/*.test.ts` passes unchanged (`for f in test/bench/*.test.ts; do bun x vp test "$f" || exit 1; done`), `bun x vp check bench test/bench tsconfig.json package.json`, and the unfiltered smoke on both runtimes: `bun bench/run.ts --smoke --out work/bench/smoke-bun.json && node bench/run.ts --smoke --out work/bench/smoke-node.json` (both exit 0 with zero failures).

Rules: R-doc, R-files, R-node, R-commit (`refactor(bench): tidy the benchmark harness`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-23: Witness: phase-1 baseline run on Bun

- write_scope: `docs/rd/performance/phase-1-bun.json`, `docs/rd/performance/phase-1-layers-bun.json`, `docs/rd/performance/phase-1-cpu-bun.json`
- deps: perf1-tidy
- red_first: no
- status: pending

Exclusive: nothing else runs on the machine (no other Hand, test, build, or benchmark), on AC power, with `git status --porcelain` empty before starting. Record the start and end times in the slice report.

Run, in order, each exiting 0: `bun bench/run.ts --out docs/rd/performance/phase-1-bun.json`, `bun bench/profile/layers.ts --out docs/rd/performance/phase-1-layers-bun.json`, `bun bench/profile/cpu.ts --out docs/rd/performance/phase-1-cpu-bun.json`, then `bun x vp fmt docs/rd/performance/phase-1-bun.json docs/rd/performance/phase-1-layers-bun.json docs/rd/performance/phase-1-cpu-bun.json`.

Done when: the three files exist, `phase-1-bun.json` has an empty `failures` array and `environment.dirty` `false`, and every result's `observed` equals its `expected` (`bun -e 'const f = JSON.parse(require("fs").readFileSync("docs/rd/performance/phase-1-bun.json", "utf8")); console.log(f.failures.length, f.results.filter((r) => r.observed !== r.expected).length, f.results.length)'` prints `0 0` and the result count). A case failure is a stop condition (GOAL): commit nothing and report it with the failure lines. No test: measurement output only.

Rules: R-commit (`docs(rd): record the phase-1 baseline on Bun`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-24: Witness: phase-1 baseline run on Node

- write_scope: `docs/rd/performance/phase-1-node.json`, `docs/rd/performance/phase-1-layers-node.json`, `docs/rd/performance/phase-1-cpu-node.json`
- deps: perf1-23
- red_first: no
- status: pending

The `perf1-23` brief with `node` in place of `bun` for the three benchmark commands (`node bench/run.ts --out docs/rd/performance/phase-1-node.json`, `node bench/profile/layers.ts --out docs/rd/performance/phase-1-layers-node.json`, `node bench/profile/cpu.ts --out docs/rd/performance/phase-1-cpu-node.json`; `bun x vp fmt` still formats) and `-node` in every file name. The dependency on `perf1-23` serializes the two exclusive runs; it is not a data dependency. `environment.commit` must equal the commit `perf1-23` measured, apart from `perf1-23`'s own results commit (check `git log --oneline <perf1-23 commit>..HEAD -- bench src` prints nothing).

Rules: R-commit (`docs(rd): record the phase-1 baseline on Node`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf1-25: docs/rd/performance.md: the phase-1 baseline

- write_scope: `docs/rd/performance.md`
- deps: perf1-24
- red_first: no
- status: pending

What is missing: the document the want's done_when names. Phase 1 writes its baseline; later phases extend it.

Write `docs/rd/performance.md` with these sections, generated tables pasted from `bun bench/report.ts docs/rd/performance/phase-1-bun.json docs/rd/performance/phase-1-node.json` (never retyped):

1. Status: phase-1 baseline; no optimization has landed (the phase invariant: `git diff --name-only 28a045b..HEAD -- src` prints nothing; paste its empty output).
2. How to run: the `bench`, `bench:node`, `--smoke`, `--filter`, `--input`, `--tokenizer`, and `--out` usage, the layer and CPU drivers, and the report command.
3. Environment and method: from the two results files (machine, OS, runtimes, package versions, commit; policy, chunk size, nearest-rank quantiles, process-per-case isolation, the measured floor).
4. Libraries and what they do: the capability table and notes from the report.
5. Results per class: the report's class tables for Bun and for Node, each class headed by one sentence naming what its entries do beyond the class minimum.
6. Scaling curve: the report's scaling tables.
7. Per-layer profile: the ladder medians and deltas from `phase-1-layers-*.json` and the CPU bucket shares from `phase-1-cpu-*.json`, per runtime, as tables.
8. Tokenizer decision rule: quote `85f587a7` item 1 and the GOAL's operational default; state the phase-1 values it reads (the tokenizer's share of the ladder and of the CPU buckets, and effect-xml's `events` rank at `bank-4m` and `bank-64m`) and that the rule is evaluated after phase 2.
9. Upstream: the output of `npm view effect version` on the day of writing and the state of Effect-TS/effect#10406.
10. Caveats: Bun GC fidelity as measured (`perf1-4`'s source labels), sample counts at `bank-64m`, the WebAssembly heap note, and anything a result's notes flag. Where the positions ratio differs from the README's "about ten times", say so here as a follow-up for the README; do not edit `README.md`.

Prose follows the `technical-writing` skill: present tense, numbers with units, no adjectives a table does not support. No test: documentation. Check: `bun x vp fmt docs/rd/performance.md && bun x vp fmt --check docs/rd/performance.md` (`vp check` on a Markdown file alone exits 1 with "No files found to lint", so the check is format only).

Rules: R-commit (`docs(rd): write the phase-1 performance baseline`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Notes

- Nothing of phase 1 is already delivered: `bench/` and `docs/rd/performance.md` do not exist at `28a045b`.
- Tidy order: `perf1-tidy` is the last slice that changes code, but it precedes the witness rows (`perf1-23`, `perf1-24`) and the document (`perf1-25`) on purpose, so the harness that produced the committed numbers is the final harness. The slicer's default puts tidy last; the Mind may move it after `perf1-25` at the cost of numbers measured on pre-tidy code.
- Witness rows are run time, not edit time: a full matrix is about 100 case-input pairs, each in its own process, each sampled for 3-60 s, so expect 15-45 minutes per runtime. They are separate rows so no implementation seat waits on them.
- Toolchain: Node 26.13.0 and Bun 1.4.2 are installed and run `bench/` files directly (Node type stripping, probed at `28a045b`); no new toolchain is needed. Vitest already runs on Node.
- New devDependencies (all in `perf1-2`, Mind approval first): `fast-xml-parser@5.12.0`, `saxes@6.0.0`, `sax@1.6.1`, `@types/sax@1.2.7`, `txml@6.0.3`, `@rgrove/parse-xml@5.1.0`, `libxml2-wasm@0.7.2`, `@computis/effect-xml@0.4.0`. No benchmark framework (`mitata`, `tinybench`) is added: p95/p99 need the raw samples, which the in-house sampler keeps.
- Hot shared files: `tsconfig.json`, `package.json`, and `bench/registry.ts` are edited only by `perf1-1` (and `package.json`/`bun.lock` by `perf1-2`, chained after it; the tidy slice last). The case and input modules are stubbed by `perf1-1`, so each later slice owns exactly one module and its test.
- Test files share no path: each slice adds its own `test/bench/<name>.test.ts`.

### perf1-26: `inputIds` follows the shared-contract order

- write_scope: `bench/inputs/synthetic.ts`
- deps: `perf1-tidy`
- red_first: no (the existing `test/bench/registry.test.ts` "owns exactly the fixed input ids" is red at `36fdf57` and is the failing check)
- status: pending

Found by `perf1-tidy` (`36fdf57`). `perf1-7` (`adb67ba`) builds the synthetic `inputIds` as `Object.keys(banks)`. The repository's `sort-keys` lint keeps the `banks` object in alphabetical order, so `bank-256k-bad-last` lands before `bank-4m`. Mind ruling: the intended order is the shared contract's, which `test/bench/registry.test.ts` pins: the four sizes ascending (`bank-16k`, `bank-256k`, `bank-4m`, `bank-64m`), then the bad-last variants (`bank-256k-bad-last`, `bank-4m-bad-last`). Declare the synthetic id order once as an explicit `as const` tuple in `bench/inputs/synthetic.ts`, and derive `inputIds` from it rather than from object key order. Keep the `banks` lookup keyed for `loadInput`. Do not edit the test.

Rules: R-doc, R-check, R-commit (`fix(bench):`), R-scope. Check: `bun x vp test test/bench/registry.test.ts && bun x vp test test/bench/synthetic.test.ts && bun x vp check bench/inputs/synthetic.ts`, then `bun bench/run.ts --smoke` exits 0 with 0 failures.
