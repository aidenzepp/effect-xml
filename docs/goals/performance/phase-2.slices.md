# Slices: performance phase 2 (fixes and library-layer optimization)

- plan: `docs/goals/performance/GOAL.md` (Implementation shape, phase 2; constraints, classes, layers, correctness gates, and the tokenizer decision rule are settled there and quoted, not re-asked). Evidence: `docs/rd/performance.md` at `1da2ad4` (Findings for phase 2, Per-layer profile, Tokenizer decision rule, Caveats). Mind scope: task `d0b3419c` items 1-6.
- slice file: `docs/goals/performance/phase-2.slices.md`
- size target: 5-15 minutes per Hand. Witness rows `perf2-5` and `perf2-6` are run time, not edit time (see Notes).
- cut against: commit `5a8e267`, `effect@4.1.2`, Bun 1.4.2 and Node 26.13.0 (the `bun` and `node` the repository resolves; `bun --version` in the repository root prints `1.4.2`). Every line number below was read on that checkout. A slice later in a file's chain re-reads the file first.
- phase constraints (Mind): `src/` changes are allowed; the public API is unchanged (the effect-native-api batch is accepted); the GOAL correctness gates stay green at every commit; no test is removed, skipped, or weakened (`git diff 5a8e267..HEAD -- test src/*.test.ts` shows additions only); benchmark witness runs need the machine alone.
- slice count: 8 numbered (`perf2-1`..`perf2-8`) + `perf2-tidy` = 9, plus the optimization slices `perf2-opt-*` that a rework cut adds from the `perf2-4` inventory (gap G2).
- longest chain: 7 (`perf2-2, perf2-4, perf2-opt-*, perf2-tidy, perf2-5, perf2-6, perf2-7`), assuming the optimization slices form one wave.
- width per wave (a slice dispatches once its `deps` are accepted and its `write_scope` overlaps no active slice): w1 3 (`perf2-1`, `perf2-2`, `perf2-3`); w2 1 (`perf2-4`; `perf2-1` may still be running); w3 n (`perf2-opt-*`, cut later); w4 1 (`perf2-tidy`); w5 1 (`perf2-5`); w6 1 (`perf2-6`); w7 2 (`perf2-7`, `perf2-8`).
- Mind gates: `perf2-3` takes gap G1's default unless the Mind rules otherwise before dispatch. `perf2-5` and `perf2-6` are exclusive: nothing else runs on the machine while they run. Every slice is integrable alone.

## Diagnosis receipts (run at cut time on `5a8e267`)

Items 1-3 were cut as investigate+fix pairs in the Mind's scope. Each cause was observed at cut time with the command below, so each pair collapses to one red-first fix slice; the receipt is the investigation. Probe scripts live under `work/perf2-plan/` (gitignored, machine-local, retained for the fix seats).

Item 1, encode stack overflow. The stack names the frame:

```console
$ node work/perf2-plan/encode-stack.ts
records 164234
RangeError: Maximum call stack size exceeded
    at toElements (file:///.../src/compile.ts:301:14)
    at toElements.next (<anonymous>)
    at xml.encodeString (file:///.../src/document.ts:99:37)
    at xml.encodeString (definition) (file:///.../src/codec.ts:366:10)
```

`src/compile.ts:301` is `children.push(...items)`: a call spread passes every element of a `many` slot as one argument. V8's argument limit is stack-bound; at cut time `[].push(...new Array(n))` passed at n = 120,000 and threw `RangeError: Maximum call stack size exceeded` at n = 150,000 on Node 26.13.0. `bank-64m` holds 164,234 records, `bank-4m` 10,442. The only other call spread in `src/` (non-test) is `src/compile.ts:313`, `children.push(...undeclared)`, in the same function (`grep -nE '\(\.\.\.[a-zA-Z]|, \.\.\.[a-zA-Z][a-zA-Z.]*\)' src/*.ts | grep -v '\.test\.ts'` prints exactly those two lines).

Item 2, positions superlinear on Node. `decodeStringWithPositions` (`src/positions.ts:386`) queues every `<`-led piece of an input chunk in `queue: string[]` (`:398`) and dequeues with `queue.shift()` (`:452`). On Node 26.13.0, `shift` on a large array copies the array:

```console
$ node -e 'for (const n of [10000, 40000, 160000]) { const q=[]; for (let i=0;i<n;i++) q.push("x"+i); const t=performance.now(); while (q.shift()!==undefined); console.log(n, (performance.now()-t).toFixed(1),"ms") }'
10000 0.2 ms
40000 90.4 ms
160000 14200.0 ms
```

The same loop on Bun takes 11.4 ms, 0.7 ms, and 2.6 ms. The bench feeds a whole bank as one stream chunk (item 3), so the queue holds every piece of the document.

Item 3, time to first record with `positions` off. `bench/cases/effect-xml-stream.ts` feeds `Stream.fromIterable(chunks)`; for an array that is `Stream.fromArray` (`node_modules/effect/src/Stream.ts:1005-1006`), which emits the whole array as one stream chunk (`:1100-1101`). The unpositioned parser is the tokenizer's `decodeString` (`src/channel.ts:414-419`), which emits one output chunk per input chunk, so no record leaves before the whole input is tokenized. The positioned path re-chunks to one piece per pull and is incremental. On `bank-4m`, `work/perf2-plan/ttfr.ts`:

| Source chunking                                  | positions | Node first (ms) | Node total (ms) | Bun first (ms) | Bun total (ms) |
| ------------------------------------------------ | --------- | --------------- | --------------- | -------------- | -------------- |
| `Stream.fromIterable(chunks)` (one stream chunk) | off       | 80.7            | 223.2           | 67.9           | 199.4          |
| `Stream.fromIterable(chunks)` (one stream chunk) | on        | 3.0             | 3253.4          | 4.2            | 254.0          |
| `Stream.fromIterable(chunks, { chunkSize: 1 })`  | off       | 2.6             | 182.8           | 2.5            | 162.2          |
| `Stream.fromIterable(chunks, { chunkSize: 1 })`  | on        | 0.4             | 304.6           | 0.6            | 246.0          |

The table confirms both mechanisms: one string per pull removes the first-record delay with `positions` off, and on Node it removes the positioned slowdown because the queue stays small.

The observing commands the fix slices use, with their output at `5a8e267`:

```console
$ node bench/case-process.ts --case effect-xml/encode-typed --input bank-64m --tokenizer upstream --smoke | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(o.failure ? "failure: " + o.failure.reason : "observed " + o.result.observed + " expected " + o.result.expected)'
failure: the case threw: RangeError: Maximum call stack size exceeded
$ node bench/case-process.ts --case effect-xml/stream/positions --input bank-4m --tokenizer upstream --smoke | node -e 'const m = JSON.parse(require("fs").readFileSync(0, "utf8")).result.metrics; console.log("first", m.timeToFirstRecordMs.median.toFixed(1), "wall", m.wallMs.median.toFixed(1))'
first 2.9 wall 3042.0
$ node bench/case-process.ts --case effect-xml/stream --input bank-4m --tokenizer upstream --smoke | node -e 'const m = JSON.parse(require("fs").readFileSync(0, "utf8")).result.metrics; console.log("first", m.timeToFirstRecordMs.median.toFixed(1), "wall", m.wallMs.median.toFixed(1))'
first 75.9 wall 202.0
```

`bench/case-process.ts` exits 0 on a case failure and prints a `failure` object, so a check reads the JSON, never the exit code. The smoke figures are one sample on a shared machine: they show the mechanism, not a benchmark result.

## Standing rules (every brief below is bound by these; a brief names the ones it leans on)

- R-effect: Effect error channels only. `try`/`catch` is a lint error (`workspace/no-built-in-try-catch`); `no-await-in-loop` is an error.
- R-guide: follow `node_modules/effect/AGENTS.md` (read it completely before writing Effect code) and `.agents/skills/effect-design/SKILL.md`. Use `Predicate` helpers, never hand-written guards. Before custom glue, add one `// Native: <API checked> lacks <requirement>.` line comment above the declaration's JSDoc block.
- R-doc: multiline JSDoc on every module-scope function, type, interface, and `const`, with `@param`/`@returns` on functions (`.agents/skills/document-code/SKILL.md`). A changed behavior updates the JSDoc that describes it.
- R-api: public signatures, schemas, codec shapes, and error shapes are unchanged (`src/index.ts` exports nothing new and loses nothing). A speedup that needs one is not made; report it to the Mind (GOAL Stop conditions).
- R-test: library tests sit beside their implementation (`src/<module>.test.ts`), import `{ describe, expect, it } from "@effect/vitest"`, use `it.effect` for effectful cases, and assert on structured values (counts, `_tag`, field presence), never on message text. Vitest runs on Node. A timing assertion is allowed only where a brief asks for a scaling regression, and then as a ratio of best-of-three times between two sizes with a bound at least 3x the linear ratio, measured with `performance.now()` inside `Effect.sync` (`it.effect` provides a `TestClock`, so `Clock` does not advance). Add tests; never edit or delete an existing assertion.
- R-check: the slice check is the command its brief names: `bun x vp test <file>` (one file per invocation; chain with `&&`), `bun x vp check <files>`, or the named `bun`/`node` command. The type check is program-wide: an error it reports outside your `write_scope` is a `blocked-scope` report, never an edit. `bun run check`, `bun run build`, and `bun run test` are the gate seats' job, not the slice's.
- R-commit: one conventional commit per slice (`.agents/skills/conventional-commits/SKILL.md`), path-limited to the slice's `write_scope`, with the module as scope (`fix(compile):`, `perf(resolve):`, `docs(rd):`). Never amend, reset, rebase, or stash.
- R-bench: `bench/` is not changed in this phase. A finding that needs a harness change is reported to the Mind, not made.
- R-scope (ends every brief): change only the files in `write_scope`. If the work needs any other path, change nothing and report `blocked-scope` with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### R-opt: rules for the optimization slices a rework cut adds from `perf2-4`

- One cause per slice, taken from one row of `docs/goals/performance/phase-2.inventory.md`; the slice quotes that row.
- Behavior is unchanged: `red_first: no`. The existing tests covering the slice's `write_scope` are the guard and pass unchanged. A new internal helper with its own behavior gets its own test in the slice.
- Each slice header carries two extra lines the witness rows read: `ab_filter:` (a `--filter` substring of the cases the change targets) and `ab_inputs:` (the `--input` ids, from `bank-4m` and `bank-64m`). `--filter` is a substring match: `effect-xml/typed-decode` also selects `computis-effect-xml/typed-decode`.
- The slice reports an indicative before/after from `<runtime> bench/case-process.ts --case <id> --input bank-4m --tokenizer upstream --smoke` on both runtimes, taken before the edit and after it, labeled "shared machine, one sample". It commits no numbers. The attributable before/after is measured by `perf2-5` and `perf2-6` on clean worktrees of the slice's parent and commit, on a quiet machine.
- Commit as `perf(<module>): <what got cheaper>`.

## Cut 1: slice

- answer: sliced
- longest chain: perf2-2, perf2-4, perf2-opt-*, perf2-tidy, perf2-5, perf2-6, perf2-7

### perf2-1: Encode a `many` slot of any length without a call spread

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: none
- red_first: yes
- status: pending

What is wrong: `effect-xml/encode-typed` on `bank-64m` throws `RangeError: Maximum call stack size exceeded` on Node 26.13.0 and passes on Bun 1.4.2 (`docs/rd/performance.md`, Findings for phase 2, item 1). The receipt above traces it to `encodeElements` (`src/compile.ts:280`, generator `toElements`): `children.push(...items)` at `:301` passes every element of a `many` slot as a call argument, and V8 overflows its stack between 120,000 and 150,000 arguments. `children.push(...undeclared)` at `:313` has the same defect for open content (`GENERIC`, `:48`).

Change: append `items` and `undeclared` to `children` without a call spread (a `for...of` push, or an `effect/Array` concatenation that does not spread into a call; check `Arr.appendAll` and its implementation before choosing it). Keep the slot order and the open-content order exactly as now. Nothing else in the file.

Test, in `src/compile.test.ts`: build a codec with a `many` slot of an empty child element (follow the plans and `compile(...)` calls already in the file; `planOf` and the DSL `Element` are imported at `:8-10`) and encode a value holding 300,000 children; assert the encode succeeds and the resolved element has 300,000 element children. Add a second case with open content whose `GENERIC` slot holds 300,000 resolved elements, asserting the same count. Build the values in the test; no fixture file. red_first yes: before the change each case fails with a `RangeError` defect raised at `src/compile.ts:301` (slot) or `:313` (open content), because 300,000 exceeds Node's spread-argument limit (overflow observed from 150,000). If the open-content case does not fail red, report that with its output and keep the slot case as the red test.

Rules: R-effect, R-guide, R-doc, R-api, R-test, R-check, R-commit (`fix(compile): encode a many slot of any length without a call spread`).

Check: `bun x vp test src/compile.test.ts && bun x vp check src/compile.ts src/compile.test.ts`, then the end-to-end observer: `node bench/case-process.ts --case effect-xml/encode-typed --input bank-64m --tokenizer upstream --smoke | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(o.failure ? "failure: " + o.failure.reason : "observed " + o.result.observed + " expected " + o.result.expected)'` prints `observed N expected N` with both numbers equal (it prints `failure: ... RangeError ...` at `5a8e267`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-2: Dequeue positioned pieces in constant time

- write_scope: `src/positions.ts`, `src/positions.test.ts`
- deps: none
- red_first: yes
- status: pending

What is wrong: `effect-xml/stream/positions` grows superlinearly on Node (0.09 MB/s on `bank-64m`, 789,275 ms for one sample; the Node CPU profile puts 87.7% in the `positions` bucket). The receipt above traces it to `decodeStringWithPositions` (`src/positions.ts:386`): `refill` (`:426`) splits every string of an input chunk into `<`-led pieces on `queue` (`:398`), and `pieces` (`:451`) dequeues with `queue.shift()` (`:452`). On Node, `shift` on a large array copies the remainder, so draining n pieces costs O(n^2) once the queue is large (90 ms at 40,000 pieces, 14,200 ms at 160,000). One input string of many tags is enough to reach that size; `perf2-3` does not change this, because it splits input chunks per string, not per piece.

Change: dequeue in constant time, for example a read index into `queue` that resets both the array and the index when the queue drains, so memory does not grow across refills. Keep every other behavior of the channel: the same pieces in the same order, the same `fedLine`/`fedColumn` stamping, the carry, and the flush at end of input. Nothing else in the file; `record-path.ts` is not involved (it shares the profile bucket only).

Test, in `src/positions.test.ts` under `describe("decodeStringWithPositions", ...)` (`:227`): a scaling regression per R-test. Feed one stream chunk holding one string `"<r>" + "<a/>".repeat(n) + "</r>"` through `decodeStringWithPositions()` and `Stream.runCount`, for a small `n` and for `8 * n`; time each as best of three after one warm run; assert the ratio of the large time to the small time is below 24 (linear is 8). Choose `n` so that, before the change, the ratio is well above 24 on Node (the receipt suggests `n` of 10,000 to 20,000; a large side of 160,000 pieces takes about 14 s before the change), set the test's timeout to cover the red run, and record both measured ratios in the slice report. Also assert the event count equals that of plain `decodeString` on the same input, so the fix cannot drop pieces. red_first yes: before the change the ratio exceeds the bound because `queue.shift()` copies the queue on every dequeue.

Rules: R-effect, R-guide, R-doc (the JSDoc cost note at `:376-379` stays accurate; do not change its numbers), R-api, R-test, R-check, R-commit (`fix(positions): dequeue positioned pieces in constant time`).

Check: `bun x vp test src/positions.test.ts && bun x vp check src/positions.ts src/positions.test.ts`, then `node bench/case-process.ts --case effect-xml/stream/positions --input bank-4m --tokenizer upstream --smoke | node -e 'const m = JSON.parse(require("fs").readFileSync(0, "utf8")).result.metrics; console.log("first", m.timeToFirstRecordMs.median.toFixed(1), "wall", m.wallMs.median.toFixed(1))'`: the wall median is within 3x of the same command with `--case effect-xml/stream` (at `5a8e267` it is 15x: 3042.0 ms against 202.0 ms). Report both outputs.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-3: Feed the parser one input string at a time so records stream with `positions` off

- write_scope: `src/channel.ts`, `src/channel.test.ts`
- deps: none (gap G1: dispatch with its default unless the Mind rules otherwise first)
- red_first: yes
- status: pending

What is wrong: with `positions` off, time to first record grows with the input (Bun 45.593 ms on `bank-4m`, 1,827.307 ms on `bank-64m`), while `positions: true` stays near constant. The receipt above gives the mechanism: when a source delivers several strings in one stream chunk (as `Stream.fromIterable(array)` does), `records` (`src/channel.ts:293`) hands that whole chunk to the parser (`const events = yield* parser`, `:313`). The unpositioned parser is the tokenizer's `decodeString` (`:414-419`), or `decode` for bytes (`:480-485`), which emits one output chunk per input chunk, so no record is collected until every string of the chunk is tokenized. The positioned non-native path already re-chunks per piece.

Change (G1 default): in `records`, before the parser, split each incoming non-empty array into one single-element chunk per element, in order, so the parser receives one string (or one `Uint8Array`) per pull. Put the re-chunking in `records` so all four parser variants (text and bytes, each with and without positions) share it. Look for a native `Channel` combinator first (`Channel.flattenArray` at `node_modules/effect/src/Channel.ts:3770` followed by re-wrapping each element is one route) and record the `// Native:` line if you write glue. Keep the span, the record ordinal, the error mapping, and the leftover/`Done` handling unchanged. Update the `decodeSchemaString` and `decodeSchema` JSDoc (`:353-390`, `:433-455`) with one sentence: each element of an input chunk is parsed on its own pull, so a record is emitted once the input that completes it is parsed.

Test, in `src/channel.test.ts` under `describe("decodeSchemaString and decodeSchema", ...)` (`:194`): a counting tokenizer that delegates to `defaultTokenizer` and counts the input strings its `decodeString` channel receives (pipe a counting identity channel into `defaultTokenizer.decodeString(...)`), and a source of 8 strings in one stream chunk (`Stream.fromIterable` of an array), each string holding one complete record of the vocabulary the file already uses (the first string also opens the root, the last also closes it). Record the count at the first record with `Stream.tap`, run with `positions` off, and assert the count is below 8 and every record decodes. Add the same assertion for `decodeSchema` over 8 `Uint8Array`s, counting in `decode`. red_first yes: before the change the count at the first record is 8, because the tokenizer receives the whole chunk in one pull.

Rules: R-effect, R-guide, R-doc, R-api, R-test, R-check, R-commit (`fix(channel): parse each string of an input chunk on its own pull`).

Check: `bun x vp test src/channel.test.ts && bun x vp check src/channel.ts src/channel.test.ts`, then `node bench/case-process.ts --case effect-xml/stream --input bank-4m --tokenizer upstream --smoke | node -e 'const m = JSON.parse(require("fs").readFileSync(0, "utf8")).result.metrics; console.log("first", m.timeToFirstRecordMs.median.toFixed(1), "wall", m.wallMs.median.toFixed(1))'` and the same with `bun`: the first-record median is under 10% of the wall median on both runtimes (at `5a8e267` it is 38%: 75.9 ms of 202.0 ms on Node). Report both outputs.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-4: Inventory: rank the library-layer hotspots by cause

- write_scope: `docs/goals/performance/phase-2.inventory.md`
- deps: perf2-2, perf2-3
- red_first: no (diagnosis only; edits nothing but its own document)
- status: pending

What is missing: Mind item 4 asks for one optimization slice per measured hotspot where the profile points (the `schema` and `effect-runtime` buckets, 21.9% to 42.4% each of `typed-decode` and `stream` on `bank-4m`; the Bun `bank-64m` drop, `typed-decode` 20.07 to 6.74 MB/s). Phase 1 profiled by file bucket only, so no hotspot is named at function level and no optimization row can name its observing command yet. This slice produces that inventory; a planner rework cut turns its rows into `perf2-opt-*` slices (gap G2).

Run, writing only under `work/perf2/` (gitignored), on both runtimes (`<rt>` is `bun` then `node`):

1. `<rt> bench/profile/cpu.ts --input bank-4m --out work/perf2/cpu-4m-<rt>.json` and `<rt> bench/profile/cpu.ts --input bank-64m --out work/perf2/cpu-64m-<rt>.json`. Each keeps raw profiles under `work/bench/profiles/<runtime>-<time>/<case>/`.
2. Function-level self time for `effect-xml/typed-decode`, `effect-xml/stream`, and `effect-xml/stream/positions` of each run, with the script below saved as `work/perf2/top.mjs`: `node work/perf2/top.mjs <file.cpuprofile> 40`.
3. `<rt> bench/profile/layers.ts --input bank-4m --out work/perf2/layers-4m-<rt>.json` for the rung deltas.
4. For the Bun `bank-64m` drop: `bun bench/case-process.ts --case effect-xml/typed-decode --input bank-4m --tokenizer upstream --smoke` and the same on `bank-64m`, comparing `wallMs`, `gcPauseMs`, `gcCount`, and `heapUsedBytes`, plus the two Bun self-time tables. Lead to confirm or refute, not a conclusion: the Bun `typed-decode` profile at phase 1 has `heapStats` (6.5%) and `entries` (6.1%) among its top native frames; `heapStats` may come from the harness (`bench/harness/metrics.ts:84` `heapProbe`, or Bun's `GCProfiler`), which would make part of the drop a measurement artifact. A harness cause is reported to the Mind (R-bench), not fixed.

```js
// Usage: node top.mjs <file.cpuprofile> [rows] -- self time per function, largest first.
import fs from "node:fs";
const [file, rows = "25"] = process.argv.slice(2);
const p = JSON.parse(fs.readFileSync(file, "utf8"));
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const label = ({ callFrame: f }) =>
  `${f.functionName || "(anon)"} ${f.url.replace(/.*effect-xml\//, "").replace(/.*node_modules\//, "nm/")}:${f.lineNumber + 1}`;
const agg = new Map();
let total = 0;
p.samples.forEach((id, i) => {
  const t = p.timeDeltas[i] ?? 0;
  const k = label(byId.get(id));
  agg.set(k, (agg.get(k) ?? 0) + t);
  total += t;
});
for (const [k, t] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, Number(rows)))
  console.log(
    `${(t / 1000).toFixed(0).padStart(6)} ms ${((100 * t) / total).toFixed(1).padStart(5)}% ${k}`,
  );
```

At cut time this script on the phase-1 Node `typed-decode` profile ranks `push src/resolve.ts:374` (9.6%), `SchemaAST.js:1655` (5.0%), `fromElement src/compile.ts:420` (5.0%), and Effect's `runLoop` (4.5%) near the top. Effect's run loop is a trampoline, so stack ancestry does not attribute `effect-runtime` time to the library call that caused it: 72.9% of those samples have no `src/` frame above them. Attribute `effect-runtime` cost by differential evidence instead (ladder rungs, the count of Effect operations the library runs per record or per element, read from the code), and say which evidence each row uses.

Write `docs/goals/performance/phase-2.inventory.md`: the commit and runtimes measured, the commands run, the machine's load average at start and end (`uptime`), and one table row per cause (bucket by cause, not by function or file: one cause can span several frames, and one frame can hold several causes). Each row has: a short candidate id; the cause in one sentence; the evidence (function, `file:line`, self-time share per runtime, case, and input; or the differential numbers); the owner files an optimization would change (exact paths, tests included); the observing command that shows the mechanism; `ab_filter` and `ab_inputs` per R-opt; the existing test files that guard the behavior; the risk; and whether the cost is in this library, in `effect` (upstream, report only), or in the harness (report only). Order rows by measured share. Add a short section for the Bun `bank-64m` drop with a verdict: library cause (with its row), harness artifact, runtime behavior outside the library, or not determined (with the reason). Profiles from this slice measure shares on a possibly shared machine: quote shares, not wall times, and never in `docs/rd/performance.md`.

Do not edit `src/`, `bench/`, or tests, even to try a hypothesis: the checkout is shared with other seats. A hypothesis that needs an edit to confirm goes in its row as "probe needed" with the edit described.

Rules: R-bench, R-check, R-commit (`docs(goals): inventory the phase-2 library-layer hotspots`). Prose follows the `technical-writing` skill.

Check: `bun x vp fmt docs/goals/performance/phase-2.inventory.md && bun x vp fmt --check docs/goals/performance/phase-2.inventory.md`, and every command the document lists runs as written.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-opt-\*: Optimization slices (cut by rework from `perf2-4`)

Cut in `## Cut 2` below (Mind task `0472e75c`), from the accepted `perf2-4` inventory. This section keeps the rule the rework followed: one `perf2-opt-<k>` per library-owned row worth a slice, each bound by R-opt, with write scopes from the row and `deps` chaining any two that share a file. Rows owned by `perf2-1`'s, `perf2-2`'s, or `perf2-3`'s files depend on that slice. The rework adds every `perf2-opt-*` to `perf2-tidy`'s `deps`, and adds the union of their write scopes to `perf2-tidy`'s.

### perf2-tidy: Tidy the phase-2 library changes

- write_scope: `src/compile.ts`, `src/compile.test.ts`, `src/positions.ts`, `src/positions.test.ts`, `src/channel.ts`, `src/channel.test.ts`, `src/resolve.ts`, `src/resolve.test.ts`, `test/wire-fast-path.test.ts` (when `perf2-opt-wire-check` committed it), the two paths of `perf2-opt-gc` (when it was dispatched), plus new files under `src/`. Not `bench/` (R-bench; `perf2-bench-heapstats` is the phase's one harness change).
- deps: perf2-1, perf2-2, perf2-3, perf2-opt-eager-decode, perf2-opt-compile-alloc, perf2-opt-wire-check, perf2-opt-positions-pull, perf2-opt-positions-scan, perf2-opt-resolver-start, perf2-bench-heapstats, perf2-gc-probe, perf2-opt-gc (only when dispatched). A dep that closes as `blocked` or `not-built` satisfies its edge (Cut 2).
- red_first: no
- status: pending

Apply the cleanliness lens (the `cleanliness` skill) to the files this phase changed, with no behavior change and no public API change (R-api). You may restructure tests without changing what they assert; add none. Do not undo an optimization for readability: the witness rows that follow measure this code. A behavior change found while tidying is not made; report it as a follow-up. `bench/` is out of scope (R-bench).

Check: each test file in `write_scope` passes unchanged (`bun x vp test <file>`, one per invocation, chained with `&&`) and `bun x vp check <every file in write_scope>`.

Rules: R-doc, R-api, R-check, R-commit (`refactor: tidy the performance phase-2 changes`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-5: Witness: phase-2 runs on Bun, with the optimization A/B

- write_scope: `docs/rd/performance/phase-2-bun.json`, `docs/rd/performance/phase-2-layers-bun.json`, `docs/rd/performance/phase-2-cpu-bun.json`, `docs/rd/performance/phase-2-cpu-64m-bun.json`, `docs/rd/performance/phase-2-ab/<opt id>-before-bun.json` and `docs/rd/performance/phase-2-ab/<opt id>-after-bun.json` for every accepted `perf2-opt-*` slice
- deps: perf2-tidy
- red_first: no
- status: pending

Exclusive: nothing else runs on the machine (no other seat, test, build, or benchmark), on AC power, and `git status --porcelain` is empty before starting. Record `uptime` (load average) and the time at start and end in the slice report. Every `--out` below writes under `work/perf2/witness/` (gitignored), so no run sees another run's output as a dirty tree; step 4 copies the files into place.

1. Matrix and profiles, from the repository root, each exiting 0:
   - `bun bench/run.ts --out work/perf2/witness/phase-2-bun.json`
   - `bun bench/profile/layers.ts --input bank-256k --input bank-4m --input bank-64m --out work/perf2/witness/phase-2-layers-bun.json`
   - `bun bench/profile/cpu.ts --input bank-4m --out work/perf2/witness/phase-2-cpu-bun.json`
   - `bun bench/profile/cpu.ts --input bank-64m --out work/perf2/witness/phase-2-cpu-64m-bun.json`
2. A/B, for each accepted `perf2-opt-<k>` (its `status: accepted <sha>` line in this file), in commit order: let `C` be its commit and `P` be `C^`. First check `git diff --quiet P HEAD -- package.json bun.lock` (exit 0: the dependency tree is unchanged, so the root `node_modules` serves both). For each of `P` and `C`: `git worktree add --detach .worktrees/perf2-ab-<sha> <sha>`, `ln -s "$PWD/node_modules" .worktrees/perf2-ab-<sha>/node_modules`, then from inside that worktree `bun bench/run.ts --filter <ab_filter> --input <each ab_input> --out <root>/work/perf2/witness/phase-2-ab/perf2-opt-<k>-<before|after>-bun.json` (`before` at `P`, `after` at `C`), then `rm .worktrees/perf2-ab-<sha>/node_modules && git worktree remove .worktrees/perf2-ab-<sha>`. `bench/` is unchanged in this phase (R-bench), so both sides run the same harness. If no `perf2-opt-*` slice was accepted, skip this step and say so.
3. Done-when, all on the `work/perf2/witness/` files:
   - matrix: `bun -e 'for (const f of process.argv.slice(1)) { const j = JSON.parse(require("fs").readFileSync(f, "utf8")); console.log(f, j.failures.length, j.results.filter((r) => r.observed !== r.expected).length, j.results.length, j.environment.dirty, j.environment.commit.slice(0, 7)) }' work/perf2/witness/phase-2-bun.json work/perf2/witness/phase-2-ab/*-bun.json` prints `0 0 <count> false <commit>` for every file; the matrix's commit is `HEAD`, each A/B file's is its `P` or `C`.
   - ladder: `bun -e 'for (const f of process.argv.slice(1)) { const j = JSON.parse(require("fs").readFileSync(f, "utf8")); console.log(f, j.ladders.map((l) => l.input + ":" + l.rungs.length).join(" ")) }' work/perf2/witness/phase-2-layers-bun.json` lists `bank-256k`, `bank-4m`, and `bank-64m`, each with the same rung count.
   - CPU: `bun -e 'for (const f of process.argv.slice(1)) { const j = JSON.parse(require("fs").readFileSync(f, "utf8")); console.log(f, j.profiles.length, j.profiles.every((p) => p.totalMs > 0)) }' work/perf2/witness/phase-2-cpu-bun.json work/perf2/witness/phase-2-cpu-64m-bun.json` prints `5 true` for each.
4. Copy the files to their `write_scope` paths under `docs/rd/performance/` (the A/B files into `docs/rd/performance/phase-2-ab/`), then `bun x vp fmt` on every copied file.

A case failure or a check mismatch is a stop condition (GOAL): commit nothing, report the failure lines, and remove any worktree this slice created. No test: measurement output only.

Rules: R-bench, R-commit (`docs(rd): record the phase-2 runs on Bun`). Temporary storage: the `.worktrees/perf2-ab-*` worktrees are removed before the slice ends; `work/perf2/witness/` stays as the raw copy.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-6: Witness: phase-2 runs on Node, with the optimization A/B

- write_scope: the `perf2-5` paths with `-node` in place of `-bun`
- deps: perf2-5
- red_first: no
- status: pending

The `perf2-5` brief with `node` in place of `bun` for every benchmark command (`node bench/run.ts ...`, `node bench/profile/layers.ts ...`, `node bench/profile/cpu.ts ...`) and `-node` in every file name; `bun -e` checks and `bun x vp fmt` stay as written. The dependency on `perf2-5` serializes the two exclusive runs; it is not a data dependency. The matrix commit must equal the one `perf2-5` measured, apart from `perf2-5`'s own results commit: `git log --oneline <perf2-5 commit>..HEAD -- bench src` prints nothing. The `effect-xml/encode-typed` row on `bank-64m` is present and passes (phase 1 recorded it as the Node matrix's one failure).

Rules: R-bench, R-commit (`docs(rd): record the phase-2 runs on Node`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-7: docs/rd/performance.md: phase-2 results and the tokenizer rule

- write_scope: `docs/rd/performance.md`
- deps: perf2-6
- red_first: no
- status: pending

What is missing: the phase-2 record the GOAL acceptance criteria ask for: the fixes and optimizations with before and after numbers, the `bank-64m` ladder and CPU profile, and the decision-rule verdict.

Update `docs/rd/performance.md`. Every number comes from a committed file through a command, never retyped:

- Matrix tables: `bun bench/report.ts docs/rd/performance/phase-2-bun.json docs/rd/performance/phase-2-node.json`.
- Ladder: `bun -e 'for (const f of process.argv.slice(1)) { const j = JSON.parse(require("fs").readFileSync(f, "utf8")); for (const l of j.ladders) for (const r of l.rungs) console.log([f, l.input, r.id, r.wallMs.median, r.deltaMedianMs ?? "-"].join(" | ")) }' docs/rd/performance/phase-2-layers-bun.json docs/rd/performance/phase-2-layers-node.json`.
- CPU buckets: `bun -e 'for (const f of process.argv.slice(1)) { const j = JSON.parse(require("fs").readFileSync(f, "utf8")); for (const p of j.profiles) console.log([f, p.caseId, p.input, p.totalMs.toFixed(0), ...Object.entries(p.buckets).map(([k, v]) => k + " " + ((100 * v) / p.totalMs).toFixed(1) + "%")].join(" | ")) }' docs/rd/performance/phase-2-cpu-bun.json docs/rd/performance/phase-2-cpu-64m-bun.json docs/rd/performance/phase-2-cpu-node.json docs/rd/performance/phase-2-cpu-64m-node.json`.
- A/B: `bun bench/report.ts` over each `docs/rd/performance/phase-2-ab/<opt id>-before-<rt>.json` and `-after-<rt>.json` pair.

Sections:

1. Status: phase 2 complete at the measured commit; the six phase-2 result files plus the A/B files join the phase-1 table of files; the phase-2 runs had the machine alone (quote the load averages `perf2-5` and `perf2-6` reported).
2. Phase 2 changes (replacing "Findings for phase 2"): per finding, what was wrong, the slice and commit that fixed it, and before (phase-1 file) and after (phase-2 file) for the affected rows: `encode-typed` on `bank-64m` (failure, then a result), `stream/positions` throughput per bank size on Node, and time to first record of `effect-xml/stream` per bank size. Then one entry per `perf2-opt-*` with its A/B medians and MB/s per runtime and input. Phase-1 numbers came from a shared machine; say so where one is the "before".
3. Results per class, Scaling curve: regenerated from the phase-2 files.
4. Per-layer profile: ladders on `bank-256k`, `bank-4m`, and `bank-64m`; CPU buckets on `bank-4m` and `bank-64m`; both runtimes.
5. Tokenizer decision rule: evaluate the GOAL's operational default on phase-2 numbers at `bank-4m` and `bank-64m` on both runtimes. A table of the values it reads (the largest differential layer and the tokenizer's delta for `stream` and `typed-decode`; the `tokenizer` CPU bucket; effect-xml's `events` rank against the fastest competitor), then one verdict line: the rule fires or does not, and which condition decides it.
6. Upstream: `npm view effect version` on the day of writing and the state of Effect-TS/effect#10406.
7. Caveats: drop the shared-machine caveat for phase-2 numbers; keep the Bun GC, peak RSS, heap, and WebAssembly notes; update sample counts at `bank-64m` from the phase-2 files; replace the positions-ratio follow-up with a pointer to the README change (`perf2-8`); record the `perf2-4` verdict on the Bun `bank-64m` drop.

Prose follows the `technical-writing` skill: present tense, numbers with units, no adjectives a table does not support. No test: documentation. Check: `bun x vp fmt docs/rd/performance.md && bun x vp fmt --check docs/rd/performance.md`, and each command above runs as written.

Rules: R-commit (`docs(rd): record performance phase 2`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-8: README: state the measured cost of stream positions

- write_scope: `README.md`
- deps: perf2-6
- red_first: no
- status: pending

What is wrong: `README.md:215` says "With the default tokenizer, positions on a stream cost about ten times a plain decode", from one earlier run (41,671 ms against 4,032 ms). Phase 1 measured 0.90x to 1.86x on Bun and 1.52x to 257x on Node; after `perf2-2` and `perf2-3` the ratio changes again.

Change: replace the first two sentences of that paragraph with the measured ratio of `effect-xml/stream/positions` to `effect-xml/stream` medians from the phase-2 files, per runtime, as a range over the bank sizes, naming the runtimes, the machine, and that the numbers are from `docs/rd/performance.md`. Get the ratios from `bun -e 'for (const f of process.argv.slice(1)) { const j = JSON.parse(require("fs").readFileSync(f, "utf8")); const m = (c, i) => j.results.find((r) => r.caseId === c && r.input === i)?.metrics.wallMs.median; for (const i of ["bank-16k", "bank-256k", "bank-4m", "bank-64m"]) console.log(f, i, (m("effect-xml/stream/positions", i) / m("effect-xml/stream", i)).toFixed(2)) }' docs/rd/performance/phase-2-bun.json docs/rd/performance/phase-2-node.json` (on the phase-1 files this prints the 1.86, 1.79, 1.47, 0.90 and 1.75, 1.52, 16.95, 257.00 that `docs/rd/performance.md` Caveats quotes). Keep the paragraph's last sentence about `fromString`. Keep the README's voice; follow the `readme-authoring` skill. Touch nothing else.

No test: documentation; `test/readme.test.ts` must still pass. Check: `bun x vp fmt README.md && bun x vp fmt --check README.md && bun x vp test test/readme.test.ts`.

Rules: R-commit (`docs(readme): state the measured cost of stream positions`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Gaps for the Mind (each with the planner's default)

- G1 (item 3 fix location). The trigger is the bench's source, `Stream.fromIterable(chunks)`, which delivers a whole bank as one stream chunk; a file or socket source delivers one buffer per pull. Options: (a) library: `records` parses each string of an input chunk on its own pull (`perf2-3` as cut), so a batching source still streams, and the bench and its phase-1 rows stay comparable; (b) bench only: feed `Stream.fromIterable(chunks, { chunkSize: 1 })`, no `src/` change, phase-1 `stream` rows no longer comparable; (c) both. Default (a): the Mind's item 3 asks for a fix with a first-record test, and only (a) gives the library a red test. Cost of (a): one pull per input string, negligible at 64 KiB strings; a source that batches many tiny strings pays one pull each.
- G2 (item 4 granularity). Phase 1 profiled by file bucket, so no optimization row can name its mechanism or observing command yet. Default: `perf2-4` inventories by cause first, and a planner rework cut adds the `perf2-opt-*` slices. Option: pre-cut from the phase-1 profile now (`resolve.ts:374`, `compile.ts:420`), at the risk of rows whose mechanism is a guess.
- G3 (A/B measurement). Parallel optimization seats share one checkout, so a seat's own before/after run would measure siblings' uncommitted edits and a loaded machine. Default: seats report indicative smoke numbers only; the exclusive witness rows measure each accepted optimization at its parent and its commit on clean worktrees (`.worktrees/`, gitignored), so A/B and the final matrix share one quiet window. Option: each optimization seat takes its own exclusive window, which serializes the optimization wave.
- G4 (no-gain optimizations). Default: an optimization whose A/B median improves less than 5% on both runtimes at its `ab_inputs` is reported by `perf2-7` as no measurable gain, and the Mind decides whether to revert it. No slice reverts on its own.
- G5 (class-level "before"). The phase-1 matrix ran on a shared machine (load average 5.9 to 11). Default: `perf2-7` compares phase-1 and phase-2 rows with that caveat, and the attributable numbers are the A/B files. Option: rerun the phase-1 commit's matrix on a quiet machine first (about 15 to 45 minutes of exclusive time per runtime).

### Notes

- Nothing of phase 2 is delivered at `5a8e267`: `git diff --name-only 28a045b..5a8e267 -- src` prints nothing.
- Investigate+fix pairs: items 1-3 were diagnosed at cut time (Diagnosis receipts), so each is one red-first fix slice. Item 4 keeps the pair shape: `perf2-4` investigates, the rework cut fixes.
- Hot files: `src/compile.ts`, `src/positions.ts`, and `src/channel.ts` each belong to one w1 slice; any `perf2-opt-*` row touching one depends on its owner slice. `src/resolve.ts` (the top `src/` frame at phase 1) is untouched by w1, so optimizations there can start as soon as they are cut.
- `bench/` is frozen this phase (R-bench), so the A/B worktrees at a parent commit and the final matrix run the same harness.
- Witness rows are run time: the phase-1 matrix took 15 to 45 minutes per runtime; phase 2 adds the `bank-64m` ladder and CPU profile and one A/B pair per optimization. `perf2-2` removes the 789 s Node `stream/positions` sample on `bank-64m`, which phase 2's witnesses would otherwise repeat.
- Tidy order: `perf2-tidy` precedes the witness rows, so the measured code is the final code (as in phase 1).
- Machine-local probes retained for the fix seats: `work/perf2-plan/encode-stack.ts`, `work/perf2-plan/ttfr.ts`, `work/perf2-plan/top.mjs`.

## Cut 2: rework from the `perf2-4` inventory

- answer: sliced (gap G2's rework cut, Mind task `0472e75c`)
- input: `docs/goals/performance/phase-2.inventory.md` at `1e89bf0` (rows quoted by id); GOAL rulings G1-G5 (`docs/goals/performance/GOAL.md`, "Mind rulings on the phase-2 cut").
- cut against: commit `1e89bf0`, whose `src/`, `bench/`, and `test/` equal the inventory's measured commit (`git diff --quiet 94bc3db 1e89bf0 -- src bench test` exits 0), `effect@4.1.2`, Bun 1.4.2, Node 26.13.0. Line numbers below were read on `1e89bf0`. A slice later in a file's chain re-reads the file first.
- slices: 8 (`perf2-opt-eager-decode`, `perf2-opt-compile-alloc`, `perf2-opt-wire-check`, `perf2-opt-positions-pull`, `perf2-opt-positions-scan`, `perf2-opt-resolver-start`, `perf2-bench-heapstats`, `perf2-gc-probe`) plus 1 conditional (`perf2-opt-gc`, dispatched only on a `fix-ready` report from `perf2-gc-probe`). `perf2-tidy`'s `deps` and `write_scope` above now list them.
- chains: `src/compile.ts`: `perf2-opt-eager-decode`, `perf2-opt-compile-alloc`, `perf2-opt-wire-check`. `src/positions.ts`: `perf2-opt-positions-pull`, `perf2-opt-positions-scan` (the inventory ranks `positions-pull` above `positions-scan`). `perf2-opt-positions-pull` and `perf2-gc-probe` also depend on `perf2-opt-eager-decode` (R-hot). `perf2-opt-resolver-start` and `perf2-bench-heapstats` have no deps.
- longest chain: 7 (`perf2-opt-eager-decode, perf2-opt-compile-alloc, perf2-opt-wire-check, perf2-tidy, perf2-5, perf2-6, perf2-7`); 8 when `perf2-opt-gc` waits on a chain tail.
- width per wave (same dispatch rule as Cut 1): c1 3 (`perf2-opt-eager-decode`, `perf2-opt-resolver-start`, `perf2-bench-heapstats`); c2 3 (`perf2-opt-compile-alloc`, `perf2-opt-positions-pull`, `perf2-gc-probe`); c3 2 (`perf2-opt-wire-check`, `perf2-opt-positions-scan`), 3 if `perf2-opt-gc`'s file is free; c4 0 or 1 (`perf2-opt-gc`); then `perf2-tidy` and the Cut 1 tail.
- outcomes: an opt slice ends `accepted` (committed), `blocked` (`perf2-opt-positions-pull`: no safe change), or `not-built` (`perf2-opt-wire-check`: no proof). `blocked` and `not-built` commit nothing and satisfy every edge that waits on them.
- rows not cut: `schema-struct` and `tokenizer` (owner `effect`, report only). `heapstats` is `perf2-bench-heapstats` and `node-gc-64m` is `perf2-gc-probe`, both by Mind ruling. The encoders `toText`, `toElements`, `toMixed`, and `toElement` share `eager-decode`'s shape but have no measured row (gap G8).

### Cut 2 rules (with the standing rules and R-opt)

- R-opt2 (Mind ruling; amends R-opt's `red_first: no` for every `perf2-opt-*`): test first. Before the edit, add the benchmark-free unit or `it.effect.prop` test (`@effect/vitest`) the brief names, covering the behavior the change could alter, and run it at the parent: it passes there, because the change keeps behavior, and the oracle is that it still passes after the edit. Report the count of tests each check command ran; a check that runs zero tests is a failed check.
- R-hot (Mind ruling): a slice whose cost runs through Effect's run loop or Schema's parser on the decode path depends on `perf2-opt-eager-decode`. A new Effect-runtime row needs a re-profile (`bench/profile/cpu.ts` and `work/perf2/group.mjs`) at or after that commit before it is cut; `perf2-opt-positions-pull`'s step 1 is that re-profile for its row. `perf2-opt-resolver-start` (`push` in `makeMachine` is synchronous code under `Effect.sync`) and `perf2-bench-heapstats` (harness) are outside the rule.
- R-bench2 (Mind ruling; narrows R-bench): `perf2-bench-heapstats` is the one `bench/` change of phase 2. Invariant: a case process started without `--cpu-prof` prints the same metric fields with the same `source` strings as before, so the `perf2-5` and `perf2-6` A/B pairs on either side of that commit run the same measured harness.
- R-gain (G4): a gain under 5% on both runtimes is reported by `perf2-7` as no gain, for a Mind revert decision. No slice reverts on its own.
- Smoke block: R-opt's indicative before/after, one sample per runtime on a shared machine. Set `CASE` as the brief says and run from the repository root:

```sh
CASE=effect-xml/stream; for rt in bun node; do printf '%s %s ' "$rt" "$CASE"; $rt bench/case-process.ts --case "$CASE" --input bank-4m --tokenizer upstream --smoke | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(o.failure ? "failure: " + o.failure.reason : "wall " + o.result.metrics.wallMs.median.toFixed(1) + " ms, observed " + o.result.observed + ", expected " + o.result.expected)'; done
```

It prints one line per runtime with `observed` equal to `expected`. Receipt at `1e89bf0`, load average 97.96 (shared, so the walls show the form, not a baseline): `bun effect-xml/stream wall 507.3 ms, observed 10442, expected 10442` and `node effect-xml/stream wall 572.4 ms, observed 10442, expected 10442`; `effect-xml/typed-decode` and `effect-xml/stream/positions` print the same form.

- Ladder read: the `perf2-7` ladder command over the slice's `layers` files under `work/` (receipt: on `work/perf2/layers-4m-bun.json` it prints the inventory's `positions | 262.624834000002 | 91.15929200000028` row).
- Profile observers name the newest profile directory as `"$(ls -d work/bench/profiles/<rt>-* | tail -1)"`. A sibling's profile run can be newer; the slice report names the directory it read.

### perf2-opt-eager-decode: Run the element decoders eagerly

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: perf2-1 (accepted, `8ce6741`)
- red_first: test-first (R-opt2)
- ab_filter: `effect-xml/`
- ab_inputs: `bank-4m`, `bank-64m`
- risk: low (inventory row)
- integrable: yes
- status: pending

Row `eager-decode`: the element decoders in `src/compile.ts` are built with `Effect.fnUntraced`, which returns a suspended effect, so Schema's Struct and Array parsers leave their `Exit` fast path at every element and run the rest of the decode through the fiber run loop. The inventory's probe (`node work/perf2/eager-probe.ts bank-4m 5`) measured `stream` 21% faster on Bun and 18% on Node, and `typed` 17% faster on Node, with only this change.

Change: build `fromEmpty` (`:95`), `fromText` (`:121`), `fromElements` (`:153`), and `fromElement` (`:428`) with `Effect.fnUntracedEager` (`node_modules/effect/src/Effect.ts:28011`) instead of `Effect.fnUntraced`, and update any JSDoc that says when the decoder runs (R-doc). The encoders (`toText` `:250`, `toElements` `:284`, `toMixed` `:340`, `toElement` `:466`) stay as they are (G8). Nothing else.

Invariant: each decoder reads only its arguments, so running the generator when Schema calls the decoder gives the same success value and the same failure (issue, path, message) as running it later, and inside one element an attribute failure still precedes a content failure.

Test first, in `src/compile.test.ts`, a new `describe("compile: decoder evaluation", ...)` using the file's plans and helpers: (1) for `empty`, `text`, and `elements` content, `Schema.decodeUnknownExit` (synchronous) succeeds on a valid element and fails on an invalid one with the same issue path that `Schema.decodeUnknownEffect` gives for that input; (2) an element with both an undeclared attribute and an undeclared child fails at the attribute's path (`@<name>`); (3) a failure two `elements` levels deep reports the full path.

Check: `bun x vp test src/compile.test.ts && bun x vp test src/codec.test.ts && bun x vp test src/channel.test.ts && bun x vp test test/qti/errors.test.ts && bun x vp test test/qti/open.test.ts && bun x vp test test/qti/mixed.test.ts && bun x vp test test/round-trip.test.ts && bun x vp test test/streaming/decode.test.ts && bun x vp check src/compile.ts src/compile.test.ts`. Smoke block with `CASE=effect-xml/stream` and with `CASE=effect-xml/typed-decode`, before and after the edit.

Rules: R-effect, R-guide, R-doc, R-api, R-test, R-check, R-opt, R-opt2, R-commit (`perf(compile): run the element decoders eagerly`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-opt-compile-alloc: Build each plan's decode lookups once

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: perf2-opt-eager-decode
- red_first: test-first (R-opt2)
- ab_filter: `effect-xml/`
- ab_inputs: `bank-4m`, `bank-64m`
- risk: low (inventory row)
- integrable: yes
- status: pending

Row `compile-alloc`: the decoders rebuild per-plan data for every element: `fromElement` builds the `declared` `Map` from `plan.attributes` and merges with `{ ...out, ...fields }`, `fromElements` builds the `slots` `Map` from `content.children`, and `isBlank` trims every whitespace text child. Observer: `node work/perf2/callers.mjs work/bench/profiles/bun-2026-11-06T04-58-44.633Z/effect-xml-stream/*.cpuprofile Map 2` (the inventory's Bun `stream` profile).

Change: build `declared` (`:430`) once per plan in `decodeElement(plan)`, outside the generator, and the `slots` map (`:158`) once per `elements` content instead of once per element; replace the merge at `:451` with one that allocates less; make `isBlank` (`:40`) cheaper. Plans are immutable (`Plan`, `ChildPlan`: `readonly` fields in `src/plan.ts`), so a cached lookup cannot go stale.

Invariants: the undeclared-attribute message lists the declared names in `plan.attributes` order, then `data-*`; the merged result has the same keys in the same order with content fields winning, as the spread does; `isBlank(text)` equals `text.trim() === ""` for every string, which counts U+00A0, U+FEFF, U+2028, and U+2029 as blank, so a scan over XML whitespace alone does not qualify; `groups` and `undeclared` stay per call.

Test first, in `src/compile.test.ts`: (1) one codec decodes three elements in a row (valid, undeclared attribute, valid with different slot children) and each result matches decoding that element with a fresh codec, so no per-call state leaks through a cached lookup; (2) a plan with three attributes declared out of alphabetical order lists them in declaration order in the undeclared-attribute failure; (3) under `elements` content, children `" "`, `"﻿"`, and `" \t\r\n"` are dropped as blank, and `"​"` (not trimmed) fails as non-blank text.

Check: the `perf2-opt-eager-decode` check, unchanged. Smoke block with `CASE=effect-xml/stream`, before and after.

Rules: R-effect, R-guide, R-doc, R-api, R-test, R-check, R-opt, R-opt2, R-commit (`perf(compile): build each plan's decode lookups once`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-opt-wire-check: Prove, then build, an internal fast path for the element wire check

- write_scope: `src/compile.ts`, `src/compile.test.ts`, `test/wire-fast-path.test.ts` (new)
- deps: perf2-opt-compile-alloc
- red_first: proof-first (step 1)
- ab_filter: `effect-xml/`
- ab_inputs: `bank-4m`, `bank-64m`
- risk: high (inventory row)
- integrable: yes
- outcome: `accepted` or `not-built`
- status: pending

Row `wire-check`: each element's encoded-side Struct (`wireElement`, `:509`) checks the `attributes` record and every child against `Schema.Union([Schema.String, ResolvedElementSchema])` before the decoder runs, although `collect` built that element. Shares: record index signatures `SchemaAST.js:1536` 2.8% (Bun) and 1.4% (Node) of `typed-decode`.

Mind ruling: allowed only as an internal fast path that leaves every public codec's behavior identical: the same accepted and rejected inputs, the same errors, paths, messages, and positions, for direct Schema use of an element codec as well as through `fromString` and the channels. If tests cannot show that, it is not built.

1. Proof corpus, before any `src/` edit: write `test/wire-fast-path.test.ts` with expectations captured by running the parent's code and written into the test as literals. The ruling requires identical messages, so this file asserts message text (an R-test exception for this file only). Surfaces:
   - Direct: `Schema.decodeUnknownExit` and `Schema.decodeUnknownEffect` of `XmlSchema.Element` codecs (one per content mode, open `elements`, open `mixed`, and one with `data`) over hand-built values: valid; `attributes` not an object; an attribute value that is not a string; `children` not an array; a child that is a number, an object without `name`, or a resolved element with a non-string attribute; the wrong `name`. Each failure asserts the issue `_tag`, path, and `message`. `Schema.encodeUnknownExit` of every decoded valid value round-trips.
   - Document: `XmlSchema.fromString` over documents whose element fails at an undeclared attribute, an undeclared child, a text value its schema rejects, and a mixed member: error `_tag`, path, message, and position.
   - Channels: `XmlSchema.decodeSchemaString` and `XmlSchema.decodeSchema` over the same documents, `positions` off and on: the same fields per failing record.

   Run it at the parent: every case passes. Report the case count.

2. Build the fast path inside `src/compile.ts`. Step 1, every guard test, and the type check stay green. If the route changes the codec's encoded-side AST, follow gap G9 and list the AST change in the report.
3. Outcome. Built: commit the test file and the change. Otherwise `not-built`: restore your own edits, commit nothing, and report the step-1 cases that changed, with their before and after values, and the smoke numbers of the attempt.

Check: `bun x vp test test/wire-fast-path.test.ts && bun x vp test src/element.test.ts`, then the `perf2-opt-eager-decode` check with `test/wire-fast-path.test.ts` added to `bun x vp check`. Smoke block with `CASE=effect-xml/typed-decode`, before and after.

Rules: R-effect, R-guide, R-doc, R-api, R-test (except as step 1 states), R-check, R-opt, R-commit (`perf(compile): skip the wire re-check of collected elements` or the name of the route built).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-opt-positions-pull: Probe, then cut the per-piece pull of positioned decoding

- write_scope: `src/positions.ts`, `src/positions.test.ts`
- deps: perf2-opt-eager-decode (R-hot), perf2-2 (accepted, `94bc3db`)
- red_first: test-first (R-opt2), after the probe's baseline
- ab_filter: `effect-xml/stream/positions`
- ab_inputs: `bank-4m`, `bank-64m`
- risk: high (inventory row)
- integrable: yes
- outcome: `accepted` or `blocked`
- status: pending

Row `positions-pull`: with `positions: true`, `decodeStringWithPositions` feeds the parser one `<`-led piece per pull, so every piece makes its own Effect pull through the parser, `resolveEvents`, and `collect` stages. The `positions` rung adds 91.2 ms to 171.5 ms on Bun and 286.8 ms to 322.2 ms on Node (`bank-4m`, shared machine).

1. Probe baseline (the R-hot re-profile), at the parent and before any edit: `bun bench/profile/layers.ts --input bank-4m --out work/perf2-opt-positions-pull/layers-before-bun.json` and `node bench/profile/layers.ts --input bank-4m --out work/perf2-opt-positions-pull/layers-before-node.json`; read the `positions` delta with the ladder read. Run the smoke block with `CASE=effect-xml/stream/positions`.
2. Test first, in `src/positions.test.ts` under `describe("decodeStringWithPositions chunking", ...)` (`:417`): an `it.effect.prop` over documents built from start, end, and empty tags, text holding LF, CR, CRLF, a tab, and a surrogate pair, a comment holding `<`, and a CDATA section holding `<`, each split at arbitrary points into strings and the strings into stream chunks. Assert: (a) the events without positions equal `Xml.decodeString` over the joined text; (b) every `StartElement` and `EndElement` position equals the line and column of its `<` in the joined text, counted by a plain loop in the test with the `Position` rules (`src/positions.ts:16`: lines end at LF, CR, or CRLF; columns count UTF-16 code units); (c) the positioned events are the same for every split of one document.
3. The probe: lower the per-piece cost while every positioned event keeps its current position. Constraint: the channel attributes events to pieces only through the one-output-chunk-per-input-chunk contract of a `positions: "none"` tokenizer (JSDoc `:361-363`), and `Tokenizer` is a service, so a change must hold for every such tokenizer, not upstream's alone. Routes, in order:
   - A (the inventory's): feed several queued pieces in one tokenizer pull and stamp each event from a running offset. Safe only if each event can be traced to the piece that completed it without reading tokenizer internals.
   - B (gap G6): keep one piece per tokenizer pull and gather the tagged events of the queued pieces of one input string into one output chunk, so `resolveEvents` and `collect` pull once per input string instead of once per piece. Events produced before a tokenizer failure still leave before the failure.
4. Outcome. Safe means step 2, the guard tests, and the type check pass. Safe: rerun step 1 into `layers-after-*` files, run the smoke block, commit. No safe route: restore your own edits, commit nothing, and report `blocked` with step 1's deltas, each route tried, the after deltas if measured, and the failing test lines.

Check: `bun x vp test src/positions.test.ts && bun x vp test test/streaming/positions.test.ts && bun x vp test src/channel.test.ts && bun x vp test src/resolve.test.ts && bun x vp check src/positions.ts src/positions.test.ts`.

Rules: R-effect, R-guide, R-doc (the cost note at `:376-379` keeps its numbers; add one sentence on the batching if built), R-api, R-test, R-check, R-opt, R-opt2, R-commit (`perf(positions): <what got cheaper>`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-opt-positions-scan: Count lines without reading every character as a code point

- write_scope: `src/positions.ts`, `src/positions.test.ts`
- deps: perf2-opt-positions-pull (`accepted` or `blocked`)
- red_first: test-first (R-opt2)
- ab_filter: `effect-xml/stream/positions`
- ab_inputs: `bank-4m`, `bank-64m`
- risk: low (inventory row)
- integrable: yes
- status: pending

Row `positions-scan`: `advance` counts lines by reading every character of every piece with `codePointAt`. Shares: `codeAt` (`:101`) 3.0% (Bun) and 2.6% (Node) of `stream/positions`. Correction to the row's risk cell: a column counts UTF-16 code units (the `Position` JSDoc, `:16`, and `advance`, which steps one code unit at a time), not code points.

Change: `advance` (`:407`) finds CR and LF with `indexOf` or a `charCodeAt` loop and adds the code-unit distance to `column`, instead of calling `codeAt` per character. `codeAt` stays for its other callers.

Invariant: for every piece, `line` and `column` after `advance` equal today's: LF, CR, and CRLF each end one line, a CR that ends a piece ends one line, and every other code unit, each half of a surrogate pair included, adds one column.

Test first: if `perf2-opt-positions-pull` committed step 2's property, extend its generator with long text runs mixing CR, LF, CRLF, and surrogate pairs between tags; otherwise add that property as `perf2-opt-positions-pull` step 2 describes it.

Check: the `perf2-opt-positions-pull` check, unchanged. Smoke block with `CASE=effect-xml/stream/positions`, before and after. Observer, after the edit: `node bench/profile/cpu.ts --input bank-4m --out work/perf2-opt-positions-scan/cpu-after-node.json && node work/perf2/top.mjs "$(ls -d work/bench/profiles/node-* | tail -1)"/effect-xml-stream-positions/*.cpuprofile 40 | grep 'src/positions.ts'`: report the `codeAt` and `advance` lines against the row's shares.

Rules: R-effect, R-guide, R-doc, R-api, R-test, R-check, R-opt, R-opt2, R-commit (`perf(positions): count lines without a code-point read per character`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-opt-resolver-start: Allocate only what a start tag needs

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: none
- red_first: test-first (R-opt2)
- ab_filter: `effect-xml/`
- ab_inputs: `bank-4m`, `bank-64m`
- risk: medium (inventory row)
- integrable: yes
- status: pending

Row `resolver-start`: `push` in `makeMachine` does several allocations for every start tag that serve only a failure or an empty case: two `Object.entries` passes over the attributes (the `size` reduce and `splitAttributes`), the `elementPath` array, two `Object.fromEntries` calls, and a new `spelled` `Map`. Area share 14.0% (Bun) and 12.6% (Node) of `stream`.

Change, in `push` (`:374`) and the helpers it calls: one pass over the attributes serves both the `size` sum (`:391`) and `splitAttributes` (`:324`); `elementPath` (`:399`) is built only when a failure is recorded, from the same stack frames and `step`; `Object.fromEntries(declaredEntries)` (`:411`) runs only when the tag declares a namespace; the `spelled` `Map` (`:448`) exists only for two or more plain attributes.

Invariants: `size` is the name length plus the key and value lengths of every as-written attribute, `xmlns` declarations included (upstream's formula, read by `maxElementSize`); every `UndeclaredPrefix` and namespace-rule `WellFormedness` failure carries the same `elementPath` and position as now; the `attributes` record keeps `__proto__` as an own key (`record`, `:200`, explains why it uses `Object.fromEntries`); the duplicate-expanded-name failure names the attribute that came first.

Test first, in `src/resolve.test.ts`, skipping any case an existing test already pins (name those in the report): (1) `UndeclaredPrefix` on an element and on an attribute at depth 3, `positions` off and on: the `elementPath` steps and the position; (2) each namespace-rule failure (the `xmlns` prefix declared, a prefix bound to `""`, `xml` bound to another URI, a duplicate expanded attribute name) at depth 2: `elementPath` and reason `_tag`; (3) `size` for a start with no attributes, one attribute, and several attributes including an `xmlns:p` declaration; (4) an attribute named `__proto__` resolves as an own key.

Check: `bun x vp test src/resolve.test.ts && bun x vp test test/namespace.test.ts && bun x vp test src/codec.test.ts && bun x vp test test/streaming/node-budget.test.ts && bun x vp check src/resolve.ts src/resolve.test.ts`. Smoke block with `CASE=effect-xml/stream`, before and after. Observer, after the edit: `bun bench/profile/cpu.ts --input bank-4m --out work/perf2-opt-resolver-start/cpu-after-bun.json && node work/perf2/callers.mjs "$(ls -d work/bench/profiles/bun-* | tail -1)"/effect-xml-stream/*.cpuprofile entries 2 | grep 'resolve.ts'`: report the `entries` share under `push` and `splitAttributes` against the row's 4.3%.

Rules: R-effect, R-guide, R-doc, R-api, R-test, R-check, R-opt, R-opt2, R-commit (`perf(resolve): allocate only what a start tag needs`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-bench-heapstats: Keep heap statistics out of profiled case processes

- write_scope: `bench/harness/metrics.ts`, `bench/case-process.ts`, `test/bench/metrics.test.ts`
- deps: none
- red_first: yes (the option is new)
- risk: low (outside the timed loop; R-bench2 states the invariant)
- integrable: yes
- status: pending

Row `heapstats`: on Bun, `v8.getHeapStatistics()` calls `jsc.heapStats()`, which walks the heap, and `measureResources` (`bench/harness/metrics.ts:129`) calls it before and after the timed loop. 451.0 ms per call with a decoded `bank-64m` live; `heapStats` is 18.2% of the Bun `bank-64m` `typed-decode` profile. Both calls sit outside the timed loop, so wall times are unaffected; CPU profiles count them.

Change: `measureResources` takes an option that skips both `v8.getHeapStatistics()` reads (`:134`, `:144`); when skipped, `allocationBytesPerSecond` is `{ unavailable: <reason naming --cpu-prof> }` and every other field is measured as now. `bench/case-process.ts` skips them when `process.execArgv` includes `--cpu-prof`, which both runtimes list there (receipt: `bun --cpu-prof --cpu-prof-dir=<dir> -e 'console.log(JSON.stringify(process.execArgv))'` prints `["--cpu-prof","--cpu-prof-dir=<dir>",...]`, and Node prints the same). `bench/profile/cpu.ts` and `profileArgs` are unchanged, so `test/bench/cpu.test.ts`'s exact argument list still holds. Update the JSDoc of `measureResources` and the case-process module comment (R-doc). The profile driver discards the case process's standard output, so no consumer reads the skipped field.

Test, in `test/bench/metrics.test.ts`: with the skip option, the allocation field is `unavailable` and names `--cpu-prof`, and CPU, RSS, heap, and GC count and pause stay measured. red_first yes: the option does not exist before the change.

Check: `bun x vp test test/bench/metrics.test.ts && bun x vp test test/bench/cpu.test.ts && bun x vp test test/bench/run.test.ts && bun x vp check bench/harness/metrics.ts bench/case-process.ts test/bench/metrics.test.ts`. Invariant: `for rt in bun node; do printf '%s ' "$rt"; $rt bench/case-process.ts --case effect-xml/typed-decode --input bank-4m --tokenizer upstream --smoke | node -e 'const o = JSON.parse(require("fs").readFileSync(0, "utf8")); const a = o.result.metrics.allocationBytesPerSecond; console.log("source" in a ? "measured " + a.source : "unavailable " + a.unavailable)'; done` prints, after the change as at `1e89bf0`, `bun measured node:v8 GCProfiler on Bun (fidelity unverified)` and `node measured node:v8 GCProfiler`. Observer: `bun bench/profile/cpu.ts --input bank-4m --out work/perf2-bench-heapstats/cpu-after-bun.json && node work/perf2/callers.mjs "$(ls -d work/bench/profiles/bun-* | tail -1)"/effect-xml-typed-decode/*.cpuprofile heapStats 6 | grep -c measureResources` prints `0` (on the inventory's profile `work/bench/profiles/bun-2026-11-06T04-58-44.633Z` it prints `1`).

Rules: R-effect, R-guide, R-doc, R-test, R-check, R-bench2, R-commit (`fix(bench): keep heap statistics out of profiled case processes`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-gc-probe: Probe the Node GC share growth of `effect-xml/stream`

- write_scope: `docs/goals/performance/phase-2.inventory.md` (one new section at its end)
- deps: perf2-opt-eager-decode (R-hot: the probe measures the decode path after it)
- red_first: no (diagnosis: edits nothing but its section)
- risk: low
- integrable: yes
- outcome: one bucket: `fix-ready`, `harness`, `runtime`, or `INCONCLUSIVE`
- status: pending

Row `node-gc-64m`: on Node, the garbage collector's share of `effect-xml/stream` is 4.6% at `bank-4m` and 22.2% at `bank-64m` (`stream/positions`: 14.2% and 18.3%), with no matching wall-time drop. Inventory lead: the case process keeps the whole input text and its chunks live, which a larger heap scans on each major collection.

Run on a clean tree, so siblings' uncommitted edits stay out: `git worktree add --detach .worktrees/perf2-gc HEAD`, `ln -s "$PWD/node_modules" .worktrees/perf2-gc/node_modules`, run every command below from inside it, writing only under `<root>/work/perf2-gc/`; at the end `rm .worktrees/perf2-gc/node_modules && git worktree remove .worktrees/perf2-gc`. Record `uptime` at start and end.

1. Signal: `node bench/profile/cpu.ts --input bank-4m --out <root>/work/perf2-gc/cpu-4m-node.json` and the same with `bank-64m`, then `node <root>/work/perf2/group.mjs <the run's profile dir>/effect-xml-stream/*.cpuprofile` for each: the `gc` line per input (receipt: `22.2% gc` on the inventory's `bank-64m` profile, `work/bench/profiles/node-2026-11-06T05-04-28.672Z`).
2. Retention, probe scripts saved under `<root>/work/perf2-gc/` that drive `XmlSchema.decodeSchemaString` the way `bench/cases/effect-xml-stream.ts` does: (a) the input text and its chunks live, as the case keeps them, against the chunks alone, alternated in one process, with GC time from `v8.GCProfiler` and the `Mark-Compact` line count from `node --trace-gc`; (b) under `node --expose-gc`, `v8.getHeapStatistics().used_heap_size` after `gc()` at the first record, the middle record, and the last record of `bank-64m`, from a `Stream.tap`; (c) if (b) grows with records, a `v8.writeHeapSnapshot()` pair at the middle and last records, and the retainer path of the largest growing constructor.
3. Bucket. `fix-ready`: the growth is held by `src/`, and one file's local edit releases it; name the file, the edit, and the step-1 and step-2 numbers that show it. `harness`: the case or harness holds the memory (report only; R-bench2 covers one change). `runtime`: Node's collector cost grows with the live input, and nothing in `src/` holds more than its records need. `INCONCLUSIVE`: one line on why the signal could not be separated. Record any other failure in the output verbatim as residual, without diagnosis.

Write the section `## Node GC share at bank-64m (perf2-gc-probe)`: the commit, `uptime` at start and end, the commands as run, the numbers, the bucket, and the residual. Shares, not wall times; none of it goes in `docs/rd/performance.md`.

Check: `bun x vp fmt docs/goals/performance/phase-2.inventory.md && bun x vp fmt --check docs/goals/performance/phase-2.inventory.md`; every command the section lists runs as written; `git worktree list` shows no `.worktrees/perf2-gc`.

Rules: R-bench (no `bench/` edit), R-check, R-commit (`docs(goals): record the Node GC probe at bank-64m`). Prose follows the `technical-writing` skill.

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### perf2-opt-gc: Release what the GC probe found held (conditional)

- dispatch: only when `perf2-gc-probe` reports `fix-ready`. On any other bucket, the Mind closes this row without dispatch, and the edge from `perf2-tidy` is satisfied.
- write_scope: the one `src/<module>.ts` the probe names and its `src/<module>.test.ts`; the Mind writes the two exact paths into the task at dispatch.
- deps: perf2-gc-probe, and the last Cut 2 slice that writes either path (`perf2-opt-wire-check` for `src/compile.ts`, `perf2-opt-positions-scan` for `src/positions.ts`, `perf2-opt-resolver-start` for `src/resolve.ts`; none for another file)
- red_first: test-first (R-opt2): a structural test that the reference the probe named is released (for example, a stage holds no buffer once a record completes), never a heap measurement
- ab_filter: `effect-xml/stream`
- ab_inputs: `bank-4m`, `bank-64m`
- risk: set by the probe report
- integrable: yes
- status: pending

Change: the probe's named edit, nothing more. Check: `bun x vp test <the test path> && bun x vp check <both paths>`, plus the guard tests the Mind lists from the inventory row of that file. Observer: the probe's steps 1 and 2(b) on Node `bank-64m`, before and after, in a clean worktree as the probe ran them. Smoke block with `CASE=effect-xml/stream`.

Rules: R-effect, R-guide, R-doc, R-api, R-test, R-check, R-opt, R-opt2, R-commit (`perf(<module>): <what is released>`).

Change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Cut 2 gaps for the Mind (each with the planner's default)

- G6 (`perf2-opt-positions-pull` route B). The inventory names route A only. Route B is the planner's reading of the same row's cause (the per-piece pull through `resolveEvents` and `collect`). Default: allowed, tried after A. Option: A only, which likely ends `blocked`, because a batch of pieces in one tokenizer pull loses the per-piece attribution the channel relies on.
- G7 (the GC slice's shape). The ruling asks for one slice that fixes when the cause is local. A probe cannot name its fix's file in advance, so one slice would need an open write scope. Default: the probe `perf2-gc-probe` plus the conditional `perf2-opt-gc`, whose two paths the Mind fills from the probe report. Option: one slice with a declared fix scope of `src/channel.ts` and `src/channel.test.ts` only, which no other Cut 2 slice writes.
- G8 (encoders). `toText`, `toElements`, `toMixed`, and `toElement` have the decoders' shape but no measured row. Default: not cut. Option: `perf2-opt-eager-encode` after `perf2-opt-wire-check` on the `src/compile.ts` chain, with `ab_filter` `effect-xml/encode-typed`.
- G9 (`perf2-opt-wire-check` AST). The ruling lists behavior, not the AST, but R-api says codec shapes stay unchanged, and the encoded side's AST is readable through `.ast`. Default: an AST change is allowed only if step 1 and every guard test pass unchanged, and the report lists the change. Option: the AST stays identical, which leaves almost no route and likely ends `not-built`.
- G10 (tests of a `blocked` or `not-built` slice). Default: commit nothing; the tests travel in the report. Option: commit them alone as `test(<module>): ...`, which keeps the coverage and, for `test/wire-fast-path.test.ts`, pins message text.
- Inventory correction, not made here: the `positions-scan` row's risk cell says a column counts code points; `src/positions.ts:16` says UTF-16 code units. `perf2-opt-positions-scan` follows the JSDoc.
- `perf2-5` and `perf2-6` need no edit: their A/B covers every accepted `perf2-opt-*` (`perf2-opt-gc` included when dispatched; a `not-built` or `blocked` slice has no commit and is skipped), and R-bench2 keeps both sides of `perf2-bench-heapstats` on the same measured harness.

## Cut 3 (Mind, 2026-11-06)

### perf2-6b: Alternating decode recheck on both runtimes

- write_scope: `docs/rd/performance/phase-2-ab/decode-recheck-bun.json`, `docs/rd/performance/phase-2-ab/decode-recheck-node.json`
- deps: `perf2-6`
- red_first: no (measurement)
- status: pending

The single-run Node A/B in `perf2-6` (`f85a801`) swings ±40-90% under load, so it cannot settle G4 for the decode rows. Repeat the alternating method of the encode rechecks (`encode-recheck-{bun,node}.json`): on `bank-4m`, 5 alternating rounds (P, C, P, C, ...) of `bench/case-process.ts` per pair, each P being the optimization commit's real parent (`C^`), run in clean `.worktrees/` and removed afterwards, on Bun and then on Node, with the machine otherwise idle of our work. Record uptime and the top 3 CPU processes per round. The pairs and cases:

- `fd314ba` eager-decode: `effect-xml/typed-decode`, `effect-xml/stream`
- `28fe69f` compile-alloc: `effect-xml/typed-decode`, `effect-xml/stream`
- `b1210ce` positions-pull: `effect-xml/stream/positions`
- `7c88ef5` wire-check: `effect-xml/typed-decode`, `effect-xml/stream`
- `0dc703f` resolver-start: `effect-xml/tree`, `effect-xml/stream`

Write each runtime's rounds and medians (the median of the per-round `wallMs.median`) to its JSON file, in the shape of the encode recheck files. A pair with any failure or mismatch stops the run, and is reported. A tree dirty only because of the per-worktree `node_modules` symlink passes, as perf2-5 ruled.

Rules: R-check, R-commit (`docs(rd):`), R-scope. Check: both files exist; every round has 0 failures and observed equal to expected; `git worktree list` shows only main.

## Cut 4 (gate audit `fcdf6fa5` findings, 2026-11-06)

Both slices are fix-or-revert. If the fix cannot meet every requirement, revert the commit named with `git revert --no-edit <sha>` (path-limited to the slice's files, and resolve any conflict inside them), keep the new tests, and report `reverted`. Probe scripts that reproduce each finding are in `work/audit-fcdf6fa5/probes/`.

### perf2-fix-batch: positioned events never wait on upstream, and batches are bounded (audit P1, P3; from `b1210ce`)

- write_scope: `src/positions.ts`, `src/positions.test.ts`, `src/channel.test.ts`
- deps: none
- red_first: yes
- status: pending

`gathered` in `src/positions.ts` (positions-pull, `b1210ce`) holds the positioned events of an input string until the string is done. Two consequences:

- **P1, liveness.** When the last piece of a string yields no events (a comment, CDATA section, PI or DOCTYPE internal subset containing `<`), `pieces` waits on upstream with earlier events still held, so a complete record does not leave until the next string arrives, or never does. Repro: `Stream.make('<r><x id="1"/><!-- a < b -->')` followed by `Stream.never`, through `decodeSchemaString(X, ["r","x"])({ positions: true })` with `take(1)`. At `a56b886` the record arrives; at `8a6dc7f` it does not arrive within 1 s.
- **P3, time to first record.** A single large positioned string buffers every event before any leaves: one 200k-record string took 165.7 ms to its first record, against 4.7 ms at `a56b886`.

Required:

1. Emit every gathered event before pulling upstream again.
2. Bound the batch, for example by flushing after a fixed number of pieces (choose and state the bound), so time to first record does not grow with the length of one string.
3. Positions, event order and failure ordering stay as they are. The chunking property test must still pass.

Red first:

- In `src/channel.test.ts`, the P1 repro for comment, CDATA and PI tails, asserting the first record arrives (use a bounded `Effect.timeout`; it fails before the fix).
- In `src/positions.test.ts`, a bound on events held: for one string of N records, the first record leaves before the tokenizer has seen the whole string. Count pieces or pulls, not time.

Report: smoke medians for `effect-xml/stream/positions` on `bank-4m`, before and after, one sample each. If the fix gives back the whole gain, say so; the Mind decides from the recheck.

Rules: R-effect, R-guide, R-doc, R-test, R-check, R-commit (`fix(positions):`), R-scope. Check: `bun x vp test src/positions.test.ts && bun x vp test src/channel.test.ts && bun x vp test test/streaming/positions.test.ts && bun x vp check src/positions.ts src/positions.test.ts src/channel.test.ts`, and `bun work/audit-fcdf6fa5/probes/liveness.ts .` (or the probe's documented invocation) reports the record arrives.

### perf2-fix-wire: the wire fast path keeps every Schema derivation identical (audit P2; from `7c88ef5`)

- write_scope: `src/compile.ts`, `src/compile.test.ts`, `test/wire-fast-path.test.ts`
- deps: none
- red_first: yes
- status: pending

`WireAttributes` and `WireChildren` (`7c88ef5`) are declarations with no annotations, so derivations of an element codec's encoded side changed. `Schema.toJsonSchemaDocument` and `Schema.toStandardJSONSchemaV1` of `Schema.toEncoded(element)` give `{}` for `attributes` and `children`, where `a56b886` gave an object of strings and an array schema. `Schema.toFormatter` output also differs. `toEquivalence` and `toRepresentation` are unchanged.

Required: every derivation Effect 4.1.2 offers for a schema (`toJsonSchemaDocument`, `toStandardJSONSchemaV1`, `toFormatter`, `toArbitrary` where it is defined, `toEquivalence`, `toRepresentation`, and any other `to*` derivation on `Schema` that takes a codec) gives the same result at the fix as at `a56b886`, for each content kind in the wire corpus. Do this by giving the two declarations the annotations Effect reads for each derivation, delegating to the original `Schema.Record(String, String)` and `Schema.Array(Union(String, ResolvedElementSchema))`. Read `node_modules/effect/src/Schema.ts` and `SchemaAST.ts` for the annotation keys; do not use `@internal` APIs.

If any derivation cannot be made identical with public APIs, revert `7c88ef5` as the cut header says, keep the corpus, and report `reverted`.

Red first: in `test/wire-fast-path.test.ts`, capture each derivation's output at `a56b886` as literals (as the corpus does) and assert equality. These fail at `8a6dc7f`.

Rules: R-effect, R-native, R-doc, R-test, R-check, R-commit (`fix(compile):`), R-scope. Check: `bun x vp test test/wire-fast-path.test.ts && bun x vp test src/compile.test.ts && bun x vp check src/compile.ts src/compile.test.ts test/wire-fast-path.test.ts`, and `bun work/audit-fcdf6fa5/probes/<the derivation probe> .` shows no difference.

### perf2-fix-doctype: positioned records are never held by subset comments, PIs or trailing text (re-audit `92933bf6`)

- write_scope: `src/positions.ts`, `src/positions.test.ts`, `src/channel.test.ts`
- deps: `perf2-fix-batch`
- red_first: yes
- status: pending

Two holds remain with `positions: true`, where `positions: false` emits. Probes are in `work/audit-92933bf6/probes/` (`live2.ts`, `carry.ts`; run as `bun <probe> "$PWD"`).

1. **Residual P2, from `f4387f0`.** `scanDoctype`/`opensTag` (`src/positions.ts:161-199`, `:515-524`) do not skip comments and PIs inside a DOCTYPE internal subset, as the upstream Scanner does. A `[` or a quote inside one leaves the classifier inside the DOCTYPE past the real `]>`. A later content comment or PI then yields a `<name` piece that is taken for a tag, and the batch waits on upstream with a complete record in it. Repro: `<!DOCTYPE r [<!-- it's -->]><r><x id="1"/><!-- don't ] > <b <c`, then `Stream.never` and `take(1)`. It is held on both the string and the byte channel. Fix: track subset comments (`<!--` to `-->`) and PIs (`<?` to `?>`) in the DOCTYPE scan the way upstream's Scanner does (read `node_modules/effect/src/encoding/Xml.ts`). Quotes and brackets inside them must not count.
2. **O1, before phase 2 (also at `a56b886`).** A string that ends in a record followed by text with no `<` (`<r><x id="1"/>`, or the same with a trailing `\n`) holds that record until the next string arrives. Fix it so every event that the tokenizer can emit from the text already received is emitted before pulling upstream. Text after the last `>` may stay carried until its end is known, because a `Text` event's extent is not final until then. Keep every position, the event order, and the failure ordering.

Red first:

- In `src/channel.test.ts`, the P2 repro and the O1 repro (both with and without the trailing `\n`), on the string and byte channels, each followed by `Stream.never`, asserting that the first record arrives within a bounded `Effect.timeoutOption`.
- In `src/positions.test.ts`, extend the chunking property's generator with DOCTYPE internal subsets that contain comments and PIs holding `[`, `]`, `>` and quotes. It must still pass.

Also pin the batch bound: assert that the number of pieces fed before the first event leaves is at most the `BATCH_PIECES` constant plus the pieces of one tag. Re-audit item 6 noted the current test does not pin 64.

Report: the outputs of the probes `live2.ts` and `carry.ts`, plus a smoke run of `effect-xml/stream/positions` on `bank-4m` (one sample per runtime).

Rules: R-effect, R-guide, R-doc, R-test, R-check, R-commit (`fix(positions):`), R-scope. Check: `bun x vp test src/positions.test.ts && bun x vp test src/channel.test.ts && bun x vp test test/streaming/positions.test.ts && bun x vp test src/resolve.test.ts && bun x vp check src/positions.ts src/positions.test.ts src/channel.test.ts`.

### perf2-9: Final re-measure and documentation for the shipped code

- write_scope: `docs/rd/performance/phase-2-final-bun.json`, `docs/rd/performance/phase-2-final-node.json`, `docs/rd/performance/phase-2-ab/final-recheck-bun.json`, `docs/rd/performance/phase-2-ab/final-recheck-node.json`, `docs/rd/performance.md`, `README.md`
- deps: `perf2-fix-doctype`
- red_first: no (measurement and docs)
- status: pending

After `perf2-7`, the code changed. `6dc514f` reverted the wire fast path. `f4387f0` and `ffe543c` changed the positions batch. The doc's numbers come from `75d46bd`/`76aa910`, so they no longer describe the shipped code.

1. Wait until the 1-minute load stays under 6 for 2 minutes (give up after 60 minutes and run anyway). Record `uptime` and the top 3 CPU processes before and after every step.
2. Run `bench/run.ts --filter effect-xml/` on Bun and then on Node at HEAD, writing `phase-2-final-{bun,node}.json`. The filter also selects the `computis-effect-xml` cases, which is fine.
3. Run alternating rechecks: 5 rounds on `bank-4m` in clean `.worktrees/`, removed afterwards, on both runtimes. The pairs:
   - `effect-xml/stream/positions` at the real parent of `b1210ce` against HEAD, for the net effect of positions-pull plus both fixes;
   - `effect-xml/typed-decode` and `effect-xml/stream` at `7c88ef5^` against HEAD, to confirm the wire revert;
   - `effect-xml/stream/positions` at `f4387f0` against HEAD, for the cost of `ffe543c`.

   Write them to `final-recheck-{bun,node}.json` in the shape of the earlier recheck files.

4. Update `docs/rd/performance.md`:
   - The optimization list: wire-check is reverted (`6dc514f`), with the reason.
   - The positions-pull entry: the fixes `f4387f0` and `ffe543c` and the net gain.
   - The Status, Phase 2 changes, effect-xml rows of the class and scaling tables (from the final files, labelled as such), and the Caveats.
   - Add the audit results (`fcdf6fa5` failed; `92933bf6` passed with findings, now fixed), and the known limit O2: time to the first positioned record still grows with the length of one input string, at 17-25 ms on 12.7 MB.
   - Keep the competitor rows from `phase-2-{bun,node}.json` and say so.
5. Update the README Positions ratio from the final files if it changed.

Rules: R-readme, R-check, R-commit (`docs(rd):`), R-scope. Check: the final files have 0 failures and observed equal to expected; `bun x vp fmt --check` on every file written; `git worktree list` shows only main; `bun x vp test test/readme.test.ts` passes.
