# Inventory: phase-2 library-layer hotspots by cause

Slice `perf2-4` of `docs/goals/performance/phase-2.slices.md`. Each row below is one cause, ranked by the share it holds in the case it targets. The rework cut turns the library-owned rows into `perf2-opt-*` slices. Rows owned by `effect` or by the harness are reports to the Mind, not slices.

## What was measured

- Commit: `94bc3db` (`main`, after `perf2-1`, `perf2-2`, and `perf2-3`), `effect@4.1.2`.
- Runtimes: Bun 1.4.2 and Node 26.13.0, 14 cores, 48 GiB.
- Load average (`uptime`): 37.41 26.25 18.18 at start, 29.97 21.45 20.35 at end. The machine was shared with other seats for the whole run.
- Shares are CPU-profile self time over the whole case process, setup and warmup included. They are not wall times, and no number here belongs in `docs/rd/performance.md`. The attributable before and after numbers come from `perf2-5` and `perf2-6`.
- Scripts under `work/perf2/` are machine-local and gitignored, like the cut's receipts under `work/perf2-plan/`. `top.mjs` is the script in the slice brief. `group.mjs` charges each native frame (`entries`, `Map`, `map`) to its nearest caller with a source URL and sums self time by area. `callers.mjs` lists the caller chains of one function.

## Commands run

Run from the repository root, in this order.

```sh
uptime
bun bench/profile/cpu.ts --input bank-4m --out work/perf2/cpu-4m-bun.json
bun bench/profile/cpu.ts --input bank-64m --out work/perf2/cpu-64m-bun.json
node bench/profile/cpu.ts --input bank-4m --out work/perf2/cpu-4m-node.json
node bench/profile/cpu.ts --input bank-64m --out work/perf2/cpu-64m-node.json
for d in work/bench/profiles/bun-2026-11-06T04-58-44.633Z work/bench/profiles/bun-2026-11-06T04-59-27.400Z work/bench/profiles/node-2026-11-06T05-03-49.955Z work/bench/profiles/node-2026-11-06T05-04-28.672Z; do for c in effect-xml-typed-decode effect-xml-stream effect-xml-stream-positions; do echo "### $d $c"; node work/perf2/top.mjs $d/$c/*.cpuprofile 40; node work/perf2/group.mjs $d/$c/*.cpuprofile; done; done
node work/perf2/callers.mjs work/bench/profiles/bun-2026-11-06T04-58-44.633Z/effect-xml-stream/*.cpuprofile entries 2
node work/perf2/callers.mjs work/bench/profiles/bun-2026-11-06T04-58-44.633Z/effect-xml-stream/*.cpuprofile Map 2
node work/perf2/callers.mjs work/bench/profiles/bun-2026-11-06T04-58-44.633Z/effect-xml-stream/*.cpuprofile cloneObject 2
node work/perf2/callers.mjs work/bench/profiles/bun-2026-11-06T04-59-27.400Z/effect-xml-typed-decode/*.cpuprofile heapStats 6
bun bench/profile/layers.ts --input bank-4m --out work/perf2/layers-4m-bun.json
node bench/profile/layers.ts --input bank-4m --out work/perf2/layers-4m-node.json
bun bench/case-process.ts --case effect-xml/typed-decode --input bank-4m --tokenizer upstream --smoke > work/perf2/drop-bank-4m-bun.json
bun bench/case-process.ts --case effect-xml/typed-decode --input bank-64m --tokenizer upstream --smoke > work/perf2/drop-bank-64m-bun.json
bun bench/case-process.ts --case effect-xml/typed-decode --input bank-64m --tokenizer upstream > work/perf2/drop-bank-64m-bun-measured.json
bun bench/case-process.ts --case effect-xml/stream --input bank-64m --tokenizer upstream > work/perf2/stream-bank-64m-bun-measured.json
bun work/perf2/gcprof-probe.ts bank-64m 2
bun work/perf2/retain-probe.ts bank-64m 3
bun work/perf2/memusage-probe.ts bank-64m
bun work/perf2/eager-probe.ts bank-4m 5
node work/perf2/eager-probe.ts bank-4m 5
git worktree add --detach .worktrees/perf2-4-before 5a8e267
git worktree add --detach .worktrees/perf2-4-after 133a1ca
sh work/perf2/ab-stream.sh 5 --smoke
sh work/perf2/ab-stream.sh 3
(cd .worktrees/perf2-4-before && bun bench/case-process.ts --case effect-xml/typed-decode --input bank-64m --tokenizer upstream > ../../work/perf2/drop-bank-64m-bun-measured-5a8e267.json)
git worktree remove .worktrees/perf2-4-before
git worktree remove .worktrees/perf2-4-after
uptime
```

The profile directories map to runs as follows: `bun-2026-11-06T04-58-44.633Z` is Bun `bank-4m`, `bun-2026-11-06T04-59-27.400Z` is Bun `bank-64m`, `node-2026-11-06T05-03-49.955Z` is Node `bank-4m`, and `node-2026-11-06T05-04-28.672Z` is Node `bank-64m`.

The probes, each one alternating its two variants in one process:

- `eager-probe.ts` times the stream and typed decodes of a bank against two copies of `src/` under `work/perf2/`. `lazy` is `src/` as committed. `eager` differs only in `src/compile.ts`, where `fromEmpty`, `fromText`, `fromElements`, and `fromElement` use `Effect.fnUntracedEager` instead of `Effect.fnUntraced`.
- `gcprof-probe.ts` times `effect-xml/typed-decode` runs with and without a `v8.GCProfiler` around them.
- `retain-probe.ts` times `effect-xml/typed-decode` runs while the previous output is still referenced, as `sink` in `bench/harness/sample.ts` holds it, and after releasing it.
- `memusage-probe.ts` times one `process.memoryUsage()` and one `v8.getHeapStatistics()` call while a decoded bank is live.
- `ab-stream.sh` runs `effect-xml/stream` on `bank-4m` in the two worktrees, alternating before and after, on both runtimes.

## Share by area

`group.mjs` output for `bank-4m`, as a percentage of each profile's self time. `effect runtime` is every frame in `effect/dist` outside Schema and `encoding/Xml.js`.

| Area                                         | Bun typed-decode | Bun stream | Bun stream/positions | Node typed-decode | Node stream | Node stream/positions |
| -------------------------------------------- | ---------------- | ---------- | -------------------- | ----------------- | ----------- | --------------------- |
| `effect` runtime                             | 27.7             | 31.9       | 35.4                 | 25.9              | 34.5        | 34.1                  |
| `effect` Schema parse                        | 25.7             | 19.6       | 14.0                 | 24.4              | 20.2        | 13.5                  |
| `src/compile.ts` decoders                    | 16.0             | 19.2       | 14.8                 | 9.3               | 8.4         | 5.0                   |
| `src/resolve.ts` start tag (`makeMachine`)   | 12.8             | 14.0       | 11.6                 | 13.0              | 12.6        | 7.8                   |
| upstream tokenizer (`encoding/Xml.js`)       | 9.0              | 10.6       | 14.9                 | 11.1              | 11.1        | 11.5                  |
| `src/positions.ts`                           | -                | -          | 4.3                  | -                 | -           | 5.5                   |
| `src/resolve.ts` collector (`makeCollector`) | 4.0              | 1.6        | 1.9                  | 1.9               | 1.9         | 3.1                   |
| garbage collector                            | -                | -          | -                    | 6.9               | 4.6         | 14.2                  |
| harness (`bench/`)                           | 3.6              | 1.8        | 1.0                  | 0.2               | 0.1         | 0.1                   |

Bun profiles have no garbage-collector frame. The `bank-64m` groups keep the same order as `bank-4m`. Two shares grow with the input and dilute the rest: the Bun `typed-decode` harness share (18.4%, row `heapstats`) and the Node garbage-collector share (row `node-gc-64m`).

The `bank-4m` layer ladder, median and delta in ms, shared machine:

| Rung        | Bun median | Bun delta | Node median | Node delta |
| ----------- | ---------- | --------- | ----------- | ---------- |
| `tokenizer` | 15.5       | 15.5      | 22.7        | 22.7       |
| `resolver`  | 42.5       | 27.0      | 63.1        | 40.4       |
| `collector` | 48.3       | 5.8       | 103.0       | 39.9       |
| `schema`    | 171.5      | 123.2     | 322.2       | 219.3      |
| `positions` | 262.6      | 91.2      | 609.1       | 286.8      |

The `schema` delta is the largest delta of the `stream` pipeline on both runtimes. The `positions` delta is 35% (Bun) and 47% (Node) of the `positions` median.

## Rows

Effect's run loop is a trampoline, so stack ancestry does not attribute `effect` runtime time to the library code that caused it. Each row names the evidence it uses: frame self time, the ladder, or a differential probe. A share is the `bank-4m` self time on Bun and on Node, in that order, unless the row says otherwise.

| Id               | Cause                                                                                                                                                                                                                                                                                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Owner files                                 | Observing command                                                                                                       | `ab_filter`                   | `ab_inputs`           | Guard tests                                                                                                                                                                                                 | Risk                                                                                                                                                                                                                                                                                                                                                         | Owner                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `positions-pull` | With `positions: true`, `decodeStringWithPositions` feeds the parser one `<`-led piece per pull, so every piece makes its own Effect pull through the parser, `resolveEvents`, and `collect` stages.                                                                                            | Ladder: the `positions` rung adds 91.2 ms to 171.5 ms (Bun) and 286.8 ms to 322.2 ms (Node). Frames, `stream/positions` against `stream`: `runLoop` `effect.js:463` 9.6% against 5.4% and `getCont` `effect.js:512` 2.8% against 1.3% on Bun; garbage collector 14.2% against 4.6% and `evaluate` `effect.js:407` 4.6% against 3.6% on Node. The `pieces` pull is `src/positions.ts:454`.                                                                                                                                                                                                                                                                                                                                                    | `src/positions.ts`, `src/positions.test.ts` | `node bench/profile/layers.ts --input bank-4m --out work/perf2/layers-4m-node.json`                                     | `effect-xml/stream/positions` | `bank-4m`, `bank-64m` | `src/positions.test.ts`, `test/streaming/positions.test.ts`, `src/channel.test.ts`                                                                                                                          | High. Each event's position comes from the piece it was parsed from, so a batch of pieces needs another way to stamp positions. Probe needed: feed every queued piece of one input string in one pull and stamp each start from a running offset; check `test/streaming/positions.test.ts`.                                                                  | library                       |
| `eager-decode`   | The element decoders in `src/compile.ts` are built with `Effect.fnUntraced`, which returns a suspended effect, so Schema's Struct and Array parsers leave their `Exit` fast path at every element and run the rest of the decode through the fiber run loop.                                    | Differential (`eager-probe.ts`, 5 alternating rounds, median ms, lazy against eager): `stream` 360.6 against 284.9 (Bun, -21%) and 187.1 against 152.8 (Node, -18%); `typed` 346.3 against 340.7 (Bun, inside the noise) and 209.8 against 173.2 (Node, -17%). Code: the Struct fast path `SchemaAST.js:1655` calls `resume` at `:1638` when a property parser returns a non-`Exit`, and `runSequential` `effect.js:2257` calls `resumeSequential`. Frames: `runSequential` 3.5%, `OnFailure` `effect.js:1417` 4.0%, and `ExitPrimitive` `core.js:330` 2.0% on Bun `stream`; `runLoop` 6.6% and `evaluate` 3.6% on Node `stream`. Decoders: `fromEmpty` `src/compile.ts:95`, `fromText` `:121`, `fromElements` `:153`, `fromElement` `:428`. | `src/compile.ts`, `src/compile.test.ts`     | `node work/perf2/eager-probe.ts bank-4m 5`                                                                              | `effect-xml/`                 | `bank-4m`, `bank-64m` | `src/compile.test.ts`, `src/codec.test.ts`, `src/channel.test.ts`, `test/qti/errors.test.ts`, `test/qti/open.test.ts`, `test/qti/mixed.test.ts`, `test/round-trip.test.ts`, `test/streaming/decode.test.ts` | Low. `Effect.fnUntracedEager` (public in `effect@4.1.2`, `node_modules/effect/src/Effect.ts:28011`) runs the generator when Schema calls the decoder instead of when the effect runs. The decoders read only their arguments, so the result and the failure are the same. The encoders (`toText`, `toElements`, `toMixed`, `toElement`) have the same shape. | library                       |
| `schema-struct`  | Effect Schema's own per-property work for each element's target Struct: the `key in input` check, property assignment, and check pass.                                                                                                                                                          | Frames, `typed-decode`: `SchemaAST.js:1655` 6.7% and 4.3%; `hasPropertySignature` `SchemaAST.js:1921` 3.7% (Bun); `assignProperty` `record.js:2` 3.1% (Node); `parseChecks` `interpreter.js:97` 1.5% (Node); `interpreter.js:155` 1.3% and 2.3%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | none in this library                        | `node work/perf2/top.mjs work/bench/profiles/node-2026-11-06T05-03-49.955Z/effect-xml-typed-decode/*.cpuprofile 40`     | -                             | -                     | -                                                                                                                                                                                                           | Report only.                                                                                                                                                                                                                                                                                                                                                 | `effect` (upstream)           |
| `resolver-start` | `push` in `makeMachine` does several allocations for every start tag that serve only a failure or an empty case: two `Object.entries` passes over the attributes (the `size` reduce and `splitAttributes`), the `elementPath` array, two `Object.fromEntries` calls, and a new `spelled` `Map`. | Area share 14.0% and 12.6% (`stream`), 12.8% and 13.0% (`typed-decode`). Frames, `stream`: `push` `src/resolve.ts:374` 5.2% and 9.6%; `entries` charged to `push` and `splitAttributes` `src/resolve.ts:324` 4.3% (Bun); `splitAttributes` 2.3% (Node); `splitQName` `src/element.ts:72` 1.0% (Bun). Ladder: the `resolver` rung adds 27.0 ms (Bun) and 40.4 ms (Node). Code: `elementPath` at `src/resolve.ts:399` is read only by `illegal` and `undeclared`.                                                                                                                                                                                                                                                                              | `src/resolve.ts`, `src/resolve.test.ts`     | `node work/perf2/callers.mjs work/bench/profiles/bun-2026-11-06T04-58-44.633Z/effect-xml-stream/*.cpuprofile entries 2` | `effect-xml/`                 | `bank-4m`, `bank-64m` | `src/resolve.test.ts`, `test/namespace.test.ts`, `src/codec.test.ts`, `test/streaming/node-budget.test.ts`                                                                                                  | Medium. A failure must still report the same `elementPath`, path, and position, so `elementPath` has to be built from the stack when a failure is recorded. The `size` stamp feeds `maxElementSize` and must keep upstream's formula.                                                                                                                        | library                       |
| `tokenizer`      | The upstream tokenizer's per-tag scanning.                                                                                                                                                                                                                                                      | Area share 10.6% and 11.1% (`stream`). Frames: `startTag` `encoding/Xml.js:917` 5.1% and 3.8%; `scanName` `encoding/Xml.js:384` 1.8% and 1.6%.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | none in this library                        | `node work/perf2/top.mjs work/bench/profiles/node-2026-11-06T05-03-49.955Z/effect-xml-stream/*.cpuprofile 40`           | -                             | -                     | -                                                                                                                                                                                                           | Report only. The tokenizer decision rule in `docs/rd/performance.md` already covers it.                                                                                                                                                                                                                                                                      | `effect` (upstream)           |
| `compile-alloc`  | The decoders rebuild per-plan data for every element: `fromElement` builds the `declared` `Map` from `plan.attributes` and merges with `{ ...out, ...fields }`, `fromElements` builds the `slots` `Map` from `content.children`, and `isBlank` trims every whitespace text child.               | Frames, Bun `stream`, charged by `callers.mjs`: under `fromElement` `src/compile.ts:428`, `entries` 2.8%, `Map` 1.9%, `cloneObject` 0.7%, and `copyDataProperties` 1.0%; under `fromElements` `src/compile.ts:157`, `Map` 1.1%; `isBlank` `src/compile.ts:40` 2.3%. Node inlines these into `fromElement` (self 5.5%) and `fromElements` (self 2.3%). Code: `declared` at `src/compile.ts:430`, `slots` at `:158`.                                                                                                                                                                                                                                                                                                                           | `src/compile.ts`, `src/compile.test.ts`     | `node work/perf2/callers.mjs work/bench/profiles/bun-2026-11-06T04-58-44.633Z/effect-xml-stream/*.cpuprofile Map 2`     | `effect-xml/`                 | `bank-4m`, `bank-64m` | Same as `eager-decode`                                                                                                                                                                                      | Low. The maps depend only on the plan, so `decodeElement(plan)` and `decodeElements` can build them once per plan. A failure message lists the declared names in the same order. Shares `src/compile.ts` with `eager-decode`, so the two slices chain.                                                                                                       | library                       |
| `positions-scan` | `advance` counts lines by reading every character of every piece with `codePointAt`.                                                                                                                                                                                                            | Frames, `stream/positions`: `codeAt` `src/positions.ts:101` 3.0% and 2.6%; `advance` `src/positions.ts:407` 1.3% (Node).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `src/positions.ts`, `src/positions.test.ts` | `node work/perf2/top.mjs work/bench/profiles/node-2026-11-06T05-03-49.955Z/effect-xml-stream-positions/*.cpuprofile 40` | `effect-xml/stream/positions` | `bank-4m`, `bank-64m` | `src/positions.test.ts`, `test/streaming/positions.test.ts`                                                                                                                                                 | Low. Line and column must count CR, LF, and CRLF as now, and a column counts code points. Shares `src/positions.ts` with `positions-pull`, so the two slices chain.                                                                                                                                                                                          | library                       |
| `wire-check`     | Each element's encoded-side Struct (`wireElement`) checks the `attributes` record and every child against `Schema.Union([Schema.String, ResolvedElementSchema])` before the decoder runs, although `collect` built that element.                                                                | Frames: `SchemaAST.js:1536` (record index signatures) 2.8% and 1.4% (`typed-decode`), 2.2% and 1.5% (`stream`); union `SchemaAST.js:2084` 0.9% and 1.1% (`typed-decode`), 1.6% and 1.3% (`stream`); refinement `SchemaAST.js:2821` 1.1% (Bun `typed-decode`). Code: `wireElement` at `src/compile.ts:509`.                                                                                                                                                                                                                                                                                                                                                                                                                                   | `src/compile.ts`, `src/compile.test.ts`     | `node work/perf2/top.mjs work/bench/profiles/bun-2026-11-06T04-58-44.633Z/effect-xml-typed-decode/*.cpuprofile 40`      | `effect-xml/`                 | `bank-4m`, `bank-64m` | Same as `eager-decode`, plus `src/element.test.ts`                                                                                                                                                          | High. The wire Struct is the encoded side of every compiled codec, so a cheaper check changes the codec's AST, which R-api forbids without a Mind ruling. A caller can also decode a hand-built value that `collect` did not make. Ask the Mind before slicing.                                                                                              | library (needs a Mind ruling) |
| `heapstats`      | On Bun, `v8.getHeapStatistics()` calls `jsc.heapStats()`, which walks the heap, and `measureResources` (`bench/harness/metrics.ts:129`) calls it before and after the timed loop.                                                                                                               | `memusage-probe.ts` on Bun: 451.0 ms per call with a decoded `bank-64m` live, 35.8 ms with `bank-4m`; 0.1 ms on Node. Frames: `heapStats` 3.2% (Bun `bank-4m` `typed-decode`) and 18.2% (Bun `bank-64m` `typed-decode`), all under `measureResources`. Both calls sit outside `startMs` and `elapsedMs`, so wall time does not include them.                                                                                                                                                                                                                                                                                                                                                                                                 | `bench/harness/metrics.ts`                  | `bun work/perf2/memusage-probe.ts bank-64m`                                                                             | -                             | -                     | -                                                                                                                                                                                                           | Report only (R-bench). It inflates the harness share of Bun CPU profiles, so Bun `bank-64m` bucket shares need it subtracted.                                                                                                                                                                                                                                | harness                       |
| `node-gc-64m`    | On Node, the garbage collector's share of `effect-xml/stream` grows with the input.                                                                                                                                                                                                             | Garbage collector 4.6% (`bank-4m`) against 22.2% (`bank-64m`) in `stream`, and 14.2% against 18.3% in `stream/positions`. The measured phase-1 Node `stream` throughput holds (22.21 MB/s and 21.85 MB/s), so the share moves without a wall-time drop.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | not determined                              | `node work/perf2/group.mjs work/bench/profiles/node-2026-11-06T05-04-28.672Z/effect-xml-stream/*.cpuprofile`            | -                             | -                     | -                                                                                                                                                                                                           | Not determined. The case process keeps the whole input text and its chunks live, which a larger heap scans on each major collection. Probe needed: the same case with only the chunks live.                                                                                                                                                                  | not determined                |

## The Bun `bank-64m` drop

Verdict: not determined, because the drop does not reproduce. No library cause was found, and none of the rows above explains it.

Phase 1 measured `effect-xml/typed-decode` at 20.07 MB/s on `bank-4m` and 6.74 MB/s on `bank-64m` on Bun at `5a8e267`, from 4 samples with a p95 of 13,698.662 ms. The same command now gives these figures:

| Commit    | Command                                                                                | Samples | Median (ms) | GC count | GC pause (ms) | Heap used (MiB) | MB/s  |
| --------- | -------------------------------------------------------------------------------------- | ------- | ----------- | -------- | ------------- | --------------- | ----- |
| `94bc3db` | `typed-decode`, `bank-4m`, `--smoke`                                                   | 1       | 177.8       | 4        | 15.3          | 110             | 23.58 |
| `94bc3db` | `typed-decode`, `bank-64m`, `--smoke`                                                  | 1       | 3926.9      | 7        | 296.3         | 1021            | 17.09 |
| `94bc3db` | `typed-decode`, `bank-64m`, measured                                                   | 15      | 3112.7      | 98       | 4339.2        | 2519            | 21.56 |
| `5a8e267` | `typed-decode`, `bank-64m`, measured, in a clean worktree                              | 16      | 3008.6      | 110      | 3902.2        | 2625            | 22.31 |
| `94bc3db` | `stream`, `bank-64m`, measured (phase 1 had 11.16 MB/s at `5a8e267`, before `133a1ca`) | 19      | 2437.4      | 1009     | 3155.4        | 403             | 27.53 |

Leads checked and refuted:

- The harness `heapStats` cost (row `heapstats`) is real but falls outside the timed loop.
- A `v8.GCProfiler` around the run costs nothing measurable. `gcprof-probe.ts` on `bank-64m` gave 5242 ms and 5192 ms without the profiler and 4978 ms and 5379 ms with it.
- `sink` holding the previous output does not slow the next run. `retain-probe.ts` gave 2722, 3290, and 2968 ms retained against 2849, 2792, and 2931 ms released.

The phase-1 run had 2516 ms of system CPU and a 5888.8 MiB peak RSS, against 1203.8 ms and 6831 MiB now. The cause of the phase-1 figure is not determined from this checkout. The `perf2-5` and `perf2-6` witness runs re-measure Bun `bank-64m` on a quiet machine; the Mind decides whether phase-1's Bun `bank-64m` rows stand.

## The `133a1ca` stream cost

`133a1ca` (`records` parses each input string on its own pull) does not cost `effect-xml/stream` wall time on `bank-4m`. In 5 alternating smoke rounds (`sh work/perf2/ab-stream.sh 5 --smoke`), the commit's side was faster in every round on both runtimes:

| Runtime | `5a8e267` wall (ms)               | `133a1ca` wall (ms)               | `5a8e267` first record (ms) | `133a1ca` first record (ms) |
| ------- | --------------------------------- | --------------------------------- | --------------------------- | --------------------------- |
| Bun     | 187.6, 173.0, 176.2, 184.5, 182.1 | 152.0, 163.2, 154.4, 170.3, 157.6 | 56.7 to 59.4                | 2.0 to 2.2                  |
| Node    | 212.5, 207.7, 205.2, 211.5, 208.4 | 191.9, 192.7, 197.7, 195.5, 194.8 | 73.9 to 79.7                | 3.2 to 3.5                  |

The measured runs (`sh work/perf2/ab-stream.sh 3`) gave medians of 162.1, 167.6, and 155.9 ms before against 143.4, 154.6, and 165.9 ms after on Bun, and 179.8, 176.9, and 314.1 ms before against 168.5, 176.1, and 342.5 ms after on Node. The third round ran under load on both sides. The noisy smoke from the cut (Node 202 to 370 ms, Bun 199 to 304 ms) was machine noise. No row.

## Rows not cut

- `effect-runtime` remainder: the effect runtime area holds 25.9% to 35.4% of each profile. `eager-decode` explains part of it by differential. The rest has no differential yet, so it is not a row. After `eager-decode` lands, re-profile and re-run `group.mjs` before cutting another runtime row.
- The per-record stage in `records` (`src/channel.ts:331-343`: `Channel.flattenArray`, then `Channel.mapEffect` with `Effect.mapError` and `Effect.map` per record) runs a few Effect operations per record against many per element, so it has no measurable share of its own here.

## Node GC share at bank-64m (perf2-gc-probe)

Slice `perf2-gc-probe`, row `node-gc-64m`. Bucket: `runtime`. The growth is the Node scavenger's pause time, which rises about tenfold in windows of a long case process and falls back without any change in the live heap. Neither `src/` nor the input the case keeps alive holds the memory.

### What was measured

- Commit: `0dc703f` (`main`, after `perf2-opt-eager-decode`), in a clean worktree at `.worktrees/perf2-gc`, removed at the end. Node 26.13.0, 14 cores.
- Load average (`uptime`): 77.07 58.31 52.07 at start, 10.33 17.24 30.50 at end. The machine was shared with other seats for the whole run.
- Scripts and raw output under `work/perf2-gc/`, machine-local and gitignored. `case-stream.ts` loads `src/` and `bench/` from the current directory and runs `effect-xml/stream` the way `bench/cases/effect-xml-stream.ts` does. `phase-gc.mjs` splits a profile at its last `bench/inputs/` sample. `gc-bins.mjs` and `scavenge-bins.mjs` give the GC share of each 5 s bin of a profile and of a `--trace-gc` log.

### Commands run

Run from the repository root, in this order.

```sh
R="$PWD"
git worktree add --detach .worktrees/perf2-gc 0dc703f
ln -s "$R/node_modules" .worktrees/perf2-gc/node_modules
cd .worktrees/perf2-gc
uptime
node bench/profile/cpu.ts --input bank-4m --out "$R/work/perf2-gc/cpu-4m-node.json"
node bench/profile/cpu.ts --input bank-64m --out "$R/work/perf2-gc/cpu-64m-node.json"
mkdir -p "$R/work/perf2-gc/profiles" && mv work/bench/profiles/node-* "$R/work/perf2-gc/profiles/"
for d in node-2026-11-06T05-41-17.241Z node-2026-11-06T05-41-47.551Z; do for c in effect-xml-stream effect-xml-stream-positions; do echo "### $d $c"; node "$R/work/perf2/group.mjs" "$R/work/perf2-gc/profiles/$d/$c/"*.cpuprofile | head -9; node "$R/work/perf2-gc/phase-gc.mjs" "$R/work/perf2-gc/profiles/$d/$c/"*.cpuprofile; done; done
node --expose-gc --trace-gc "$R/work/perf2-gc/retention-probe.ts" bank-64m 3 > "$R/work/perf2-gc/retention-64m.log"
awk '/^=== begin/{v=$3; n=0; next} /^=== end/{print v, "Mark-Compact lines", n; next} /Mark-Compact/{n++}' "$R/work/perf2-gc/retention-64m.log"
node --expose-gc "$R/work/perf2-gc/heap-probe.ts" bank-64m
node --trace-gc bench/case-process.ts --case effect-xml/stream --input bank-64m --tokenizer upstream > "$R/work/perf2-gc/case-64m-tracegc.log"
node --trace-gc bench/case-process.ts --case effect-xml/stream --input bank-64m --tokenizer upstream > "$R/work/perf2-gc/case-64m-tracegc-2.log"
node "$R/work/perf2-gc/scavenge-bins.mjs" "$R/work/perf2-gc/case-64m-tracegc.log" 5
node "$R/work/perf2-gc/scavenge-bins.mjs" "$R/work/perf2-gc/case-64m-tracegc-2.log" 5
node --cpu-prof --cpu-prof-dir="$R/work/perf2-gc/profile-stream-64m" bench/case-process.ts --case effect-xml/stream --input bank-64m --tokenizer upstream > /dev/null
node "$R/work/perf2-gc/gc-bins.mjs" "$R/work/perf2-gc/profiles/node-2026-11-06T05-41-47.551Z/effect-xml-stream/"*.cpuprofile 5
node "$R/work/perf2-gc/gc-bins.mjs" "$R/work/perf2-gc/profile-stream-64m/"*.cpuprofile 5
node --trace-gc-nvp bench/case-process.ts --case effect-xml/stream --input bank-64m --tokenizer upstream > "$R/work/perf2-gc/case-64m-nvp.log"
uptime
cd "$R" && rm .worktrees/perf2-gc/node_modules && git worktree remove .worktrees/perf2-gc
```

### Step 1: the signal

The share reproduces on `0dc703f`. `load` is the profile up to its last `bench/inputs/` sample, input generation and chunking; `after load` is the `check` run, warmup, and samples.

| Case               | Input      | GC share (`group.mjs`) | GC share, load | GC share, after load |
| ------------------ | ---------- | ---------------------- | -------------- | -------------------- |
| `stream`           | `bank-4m`  | 2.8%                   | 1.8%           | 2.8%                 |
| `stream`           | `bank-64m` | 17.7%                  | 8.5%           | 17.8%                |
| `stream/positions` | `bank-4m`  | 5.2%                   | 3.4%           | 5.3%                 |
| `stream/positions` | `bank-64m` | 6.9%                   | 6.1%           | 6.9%                 |

The share is not steady within one process. In 5 s bins, the `bank-64m` `stream` profile above holds 20.0% to 26.9% from 5 s to 45 s, then 2.4% to 2.9% from 50 s to the end. A second `stream` profile at `bank-64m` (`profile-stream-64m`, 15.4% overall) holds 2.2% to 3.8% for its first 20 s, 9.6% from 20 s to 25 s, and 15.6% to 27.7% after that.

### Step 2: retention

(a) Input live against chunks alone, alternated in one process. `text+chunks` keeps the input object live, as the case process does; on V8 its chunks are sliced strings of the whole text. `chunks-only` runs on flat copies of the chunks with the input object released. Each run starts after a forced `gc()`.

| Round | Variant       | Heap before run (MiB) | GC share of the run | GC events | Mark-Compact (`--trace-gc`) |
| ----- | ------------- | --------------------- | ------------------- | --------- | --------------------------- |
| 1     | `text+chunks` | 92                    | 2.8%                | 228       | 0                           |
| 1     | `chunks-only` | 94                    | 3.1%                | 227       | 0                           |
| 2     | `text+chunks` | 158                   | 3.2%                | 227       | 0                           |
| 2     | `chunks-only` | 95                    | 3.3%                | 227       | 0                           |
| 3     | `text+chunks` | 159                   | 3.3%                | 227       | 0                           |
| 3     | `chunks-only` | 96                    | 3.2%                | 227       | 0                           |

Releasing the input text does not change the GC share. A `bank-64m` run costs about 227 collections either way, all scavenges.

(b) `used_heap_size` after `gc()` on `bank-64m`: 92.3 MiB before the run (the 64.0 MiB text is most of it), 93.6 MiB at the first record, 94.4 MiB at the middle record (82,117), 94.2 MiB at the last record (164,234), and 93.9 MiB after the run. The heap does not grow with records, so step (c) was not run.

The measured case process (`case-process.ts` without `--smoke`, about 50 s of samples) shows the same per-run collections at two very different costs:

| Log                      | Scavenge pause per 5 s bin                                                                   | Mark-Compact | GC pause, share of the timed loop |
| ------------------------ | -------------------------------------------------------------------------------------------- | ------------ | --------------------------------- |
| `case-64m-tracegc.log`   | 0.28 ms average for 0 s to 5 s and 0.19 ms to 0.32 ms after 55 s; 4.15 ms to 8.12 ms between | 2            | about 28%                         |
| `case-64m-tracegc-2.log` | 0.42 ms to 0.53 ms average in every bin                                                      | 31           | about 7%                          |

The scavenge count per run is the same in both, and in the first log the heap after each scavenge stays between 166.8 MiB and 173.3 MiB while the pause rises. The `--trace-gc-nvp` run held no slow window, but its 19 scavenges over 3 ms averaged 7.89 ms, of which `scavenge.roots` (2.15 ms) and `scavenge.parallel` (1.02 ms) account for less than half. A main thread that waits on scavenger helper threads would show this gap, and the load average reached 77 on 14 cores during the probe. That cause is consistent with the numbers but not proven by them.

### Bucket

`runtime`. Nothing in `src/` holds more than its records need: the heap is flat across a `bank-64m` run, and the isolated runs of step 2(a) trigger no Mark-Compact. The case's retention of the input text does not move the share either. The growth is the Node scavenger's pause, which rises about tenfold in windows of a process without a change in the live heap or the collection count. A `bank-64m` case process runs about 65 s against about 5 s for `bank-4m`, so it is more likely to span such a window. The bucket's other condition, that the collector cost grows with the live input, was not observed. No `src/` change follows from this row. A GC share from a shared machine needs its 5 s bins checked before it is read as a library cost.

Residual: none. Every command above exited 0.
