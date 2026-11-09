# Spike perf3b-sp-effect-overhead: Effect runtime overhead on the fast path

Unit `perf3b-sp-effect-overhead`. This R&D spike asks how much of the structural decode (0.3 to 0.5 `C`) and structural encode (about 0.9 `C`) is Effect fiber and runtime overhead rather than Schema parsing, and whether a cheaper Effect-native call path closes part of the typed gap to `@computis/effect-xml` (owner directive item 5). The prototype lives in `work/spikes/perf3b-sp-effect-overhead/` (gitignored); this file is the durable record. No file under `src/`, `bench/` or `test/` changed.

## Result

- **There is no fiber overhead to remove inside the structural codec.** For a synchronous codec, Effect 4.1.2's Schema parser already returns a finished `Exit` without starting a fiber: `SchemaParser.runWithCompiler` returns the compiled parser's result as is, the struct parser has an eager path for the default parse options, and arrays iterate eagerly (`iterateEager`). `Schema.decodeUnknownEffect` and `Schema.encodeEffect` therefore already are the "synchronous parser entry". `decodeUnknownExit` and `decodeUnknownSync` call the same parser and add a `runSyncExit`.
- **Effect primitives inside Schema's interpreter cost 6 to 11 percent of the structural codec's self time.** This is mostly one `Exit` allocated per parsed node (`ExitPrimitive`), plus `effectIsExit` checks and eager iteration. That is about 0.04 `C` of decode and 0.09 `C` of encode at `bank-4m` on Node. It lives inside Schema's interpreter, so this library cannot reach it without replacing that interpreter. The only cheaper parser Effect ships is the Schema JIT, which is excluded.
- **The Effect layers around the attempt cost a few microseconds per call.** The decode shell (the `xml.decodeString` span, the generator, `Effect.option`, `flatMap` and `Option.match`, `annotateCurrentSpan`, `logDebug`) costs about 3 µs. The span alone costs 1.5 to 1.8 µs. The tokenizer's encode stream has a fixed cost of 1.5 to 1.8 µs per call. Measured against no Effect layer at all (`floor`), the attempt's layers cost 3.4 µs at `bank-16k` on both runtimes. That is under 1.5 percent of `T` at `bank-16k`, and nothing at `bank-4m`.
- **The prototype changes no end-to-end result.** It switches to `Effect.matchEager`, drops the attempt's generator, writes a straight-line shell, and builds the fallback lazily. It removes 3.6 µs (Bun) and 7.3 µs (Node) from the isolated `bank-16k` attempt. On the whole decode and encode, `bank-16k` and `bank-4m`, both runtimes, every proto/base CPU ratio lies between 0.91 and 1.06. Signs disagree between runtimes and rungs. `T / C` is unchanged within its intervals.
- **Correctness holds.** Values, errors, paths, positions, defects, interruptions and span attributes match `HEAD` on every probe. See [Correctness](#correctness).

Recommendation: do not implement. The Effect runtime is not where the structural codec's time goes. Close this lever and spend effort on the work Schema's interpreter does per node. Details are in [Recommendation](#recommendation).

## Where the time goes

### Inside the structural codec

Node 26.13.0 `--cpu-prof` of the structural codec's parse alone (`prof.ts`), over a fixed plain object or value, JIT off. Self time inside the parse call's subtree is bucketed by module. GC is not attributed to a frame and is excluded.

| Bucket                                                      | decode `bank-4m` | encode `bank-4m` | decode `bank-16k` | encode `bank-16k` |
| ----------------------------------------------------------- | ---------------- | ---------------- | ----------------- | ----------------- |
| `SchemaAST.js` (struct, array, union, literal walk; checks) | 58.0%            | 51.9%            | 49.0%             | 53.2%             |
| `record.js` `assignProperty` (building output objects)      | 14.2%            | 14.9%            | 7.1%              | 19.5%             |
| Schema interpreter (`interpreter.js`, links, checks)        | 12.3%            | 19.0%            | 36.7%             | 15.6%             |
| Effect primitives (`core.js`, `effect.js`)                  | 8.3%             | 10.5%            | 6.0%              | 11.4%             |
| `Predicate.js` and other                                    | 7.2%             | 3.7%             | 1.2%              | 0.3%              |

The Effect primitives are `ExitPrimitive` (2.8 to 5.8 percent: one `Exit` per parsed node), `effectIsExit` (0.9 to 7.2 percent) and `runSequential`, the eager array iteration (1.0 to 3.2 percent). The split between the interpreter and `SchemaAST.js` moves with V8's inlining, so read those two rows together, at about 70 percent of self time.

Profiles of the whole attempt at `bank-16k` (`Effect.runSync(attemptDecode(ItemBank)(root))`, and `attemptEncode` with the tokenizer):

- **Decode attempt.** Builder 41 percent, Schema walk and interpreter 38 percent, `record.js` 6 percent, Effect runtime and primitives 7.5 percent. The fiber runs one generator step; nearly all the Effect share is `ExitPrimitive` inside the parse.
- **Encode attempt.** Schema 35 percent, tokenizer encode (`Xml.js`) 24 percent, writer 14 percent, `record.js` 8 percent. Effect runtime and primitives are 7.3 percent; stream and channel code is 1.6 percent.

### Around the structural codec

In-process microbenchmarks (`shell.ts`, `stream-fixed.ts`) give the per-call cost of each Effect layer with a trivial payload. Each value is the median of 7 rounds, under load.

| Per call                                                           | Bun 1.4.2 | Node 26.13.0 |
| ------------------------------------------------------------------ | --------- | ------------ |
| `Effect.runSync` of a finished `Exit`                              | 0.00 µs   | 0.01 µs      |
| `Effect.fn("xml.decodeString")` span and generator                 | 1.46 µs   | 1.81 µs      |
| span and `logDebug` with `annotateLogs`                            | 1.98 µs   | 2.30 µs      |
| today's decode shell (span, attempt generator, option, match, log) | 3.20 µs   | 3.01 µs      |
| prototype decode shell                                             | 2.27 µs   | 2.43 µs      |
| tokenizer encode stream, 2-event document                          | 1.83 µs   | 1.53 µs      |

`T` is about 240 µs at `bank-16k` and 65 to 93 ms at `bank-4m`. The whole decode shell is 1.2 percent of `T` at `bank-16k`. The prototype removes 0.6 to 0.9 µs of it.

The phase 3 layer profile showed an `encodeString glue` of 0.77 `C` (37 µs) on Bun at `bank-16k`. These layers cannot explain that: they total under 10 µs per call. That row is a difference of two units from different harnesses, and its interval reached 0.13 `C`.

## What the prototype changes

`work/spikes/perf3b-sp-effect-overhead/proto/src/` is a copy of `HEAD` with three files changed. The public API is unchanged, and the prototype adds no dependency and no JIT import.

1. **`fast-decode.ts`.** The attempt is a plain function rather than an `Effect.fnUntraced` generator. It returns `Effect.succeedNone` when it declines. Otherwise it returns `Effect.matchEager(decoded, { onFailure: Option.none, onSuccess: Option.some })`. `matchEager` reads a finished `Exit` without a fiber step. For any other effect, such as an async leaf or one that needs services, it runs `Effect.match`. Its failure split (`findRecoverableError`) is the one `Effect.option` uses, so a defect or an interruption still propagates.
2. **`fast-encode.ts`.** `yield* Effect.option(encoded)` becomes the same `Effect.matchEager`. The tokenizer stream stays as it is (M5).
3. **`codec.ts`.** In `decodeString` and `encodeString`, the shell is straight-line generator code: `yield*` the attempt, then `if (Option.isSome(fast))`. This replaces `attempt(...).pipe(Effect.flatMap(Option.match(...)))`. The standard effect is built by a thunk on the paths that run it, and the fallback pipeline is built only on `None`. The span, its `xml.codec` and `xml.fallback` attributes, and the debug log are unchanged.

## Measurements

### Method

- **Trees.** `base` is `git archive` of `HEAD` (`0acc9db`, whose `src/` matches `a310ba3`) into `work/spikes/perf3b-sp-effect-overhead/base/`. `proto` is the same archive with the edits above. Both trees import the repository's pinned `effect` 4.1.2.
- **Driver.** `ab.ts`, one driver per runtime. The two drivers ran at the same time, beside other seats' work. Every round runs every cell for each of its variants, each in its own child process of the same runtime. The variant order reverses every other round, and the cell order rotates. JIT off: nothing imports the Schema JIT.
- **Rungs (`case.ts`).**
  - `typed-decode`: the `effect-xml/typed-decode` case shape, `XmlSchema.fromString(ItemBank)` through `runSync`.
  - `encode-typed`: `fromString` encode without the XML declaration.
  - `decode-string` and `encode-string`: the bare `decodeString` and `encodeString`.
  - `attempt-decode`: `attemptDecode(ItemBank)` over a root collected outside the loop.
  - `attempt-encode`: `attemptEncode(ItemBank)` with the tokenizer.
- **Variants.**
  - `base` and `proto`.
  - `computis` on the two typed rungs: `@computis/effect-xml`'s own cases, run in the same rounds, which give `C`.
  - `floor` on the attempt rungs: the same work with no Effect layer. For decode, that is `build` plus reading the structural parser's `Exit`. For encode, it is the parser's `Exit`, the writer, and the tokenizer stream through `runSync`.
- **Samples.** Each child runs 3 warm-up samples, then 7 samples through `bench/harness/metrics.ts` `measureResources`. Each per-operation value is the median of the 7. Operations per sample: 400 to 2,000 at `bank-16k`, and 3 to 6 at `bank-4m`.
- **Rounds and statistics.** 12 rounds per runtime, none repeated. A ratio is a variant's value over `base`'s in the same round. The tables give the median over rounds with the distribution-free sign-test interval: ranks 3 to 10 of 12, 96 percent coverage. The spike's `report.py` returned ranks 4 to 9 (about 85 percent coverage); every interval in this file was recomputed at ranks 3 to 10 from the raw rounds (final audit `4705e240`, residual R3). The medians did not change, and neither did the conclusion: no end-to-end gain is resolvable.
- **Load.** The 1-minute load average ran from 37 to 181, recorded per child.
- **Runtimes.** Bun 1.4.2 and Node 26.13.0.

### CPU ratio to base (primary)

| Runtime | Input      | Rung             | proto / base        | floor / base        |
| ------- | ---------- | ---------------- | ------------------- | ------------------- |
| bun     | `bank-16k` | `attempt-decode` | 0.922 (0.890–0.967) | 0.932 (0.872–0.992) |
| bun     | `bank-16k` | `attempt-encode` | 0.983 (0.913–1.049) | 0.897 (0.810–0.952) |
| bun     | `bank-16k` | `decode-string`  | 1.016 (0.976–1.096) |                     |
| bun     | `bank-16k` | `encode-string`  | 0.955 (0.871–0.995) |                     |
| bun     | `bank-16k` | `typed-decode`   | 1.050 (1.000–1.096) |                     |
| bun     | `bank-16k` | `encode-typed`   | 0.914 (0.858–1.012) |                     |
| bun     | `bank-4m`  | `attempt-decode` | 1.027 (0.965–1.066) | 1.015 (0.972–1.061) |
| bun     | `bank-4m`  | `attempt-encode` | 1.043 (0.987–1.155) | 1.029 (0.915–1.124) |
| bun     | `bank-4m`  | `decode-string`  | 1.029 (0.956–1.101) |                     |
| bun     | `bank-4m`  | `encode-string`  | 0.960 (0.890–1.054) |                     |
| bun     | `bank-4m`  | `typed-decode`   | 1.023 (0.913–1.093) |                     |
| bun     | `bank-4m`  | `encode-typed`   | 1.054 (1.007–1.174) |                     |
| node    | `bank-16k` | `attempt-decode` | 0.882 (0.867–0.897) | 0.944 (0.925–1.004) |
| node    | `bank-16k` | `attempt-encode` | 0.959 (0.934–1.005) | 0.968 (0.897–1.033) |
| node    | `bank-16k` | `decode-string`  | 1.005 (0.977–1.026) |                     |
| node    | `bank-16k` | `encode-string`  | 0.972 (0.921–1.017) |                     |
| node    | `bank-16k` | `typed-decode`   | 0.994 (0.976–1.021) |                     |
| node    | `bank-16k` | `encode-typed`   | 1.000 (0.961–1.026) |                     |
| node    | `bank-4m`  | `attempt-decode` | 0.938 (0.897–0.995) | 0.973 (0.947–1.010) |
| node    | `bank-4m`  | `attempt-encode` | 0.992 (0.963–1.075) | 0.992 (0.936–1.040) |
| node    | `bank-4m`  | `decode-string`  | 0.976 (0.935–0.988) |                     |
| node    | `bank-4m`  | `encode-string`  | 1.040 (0.928–1.120) |                     |
| node    | `bank-4m`  | `typed-decode`   | 1.058 (0.974–1.104) |                     |
| node    | `bank-4m`  | `encode-typed`   | 1.001 (0.956–1.130) |                     |

How to read it:

- **Isolated attempt at `bank-16k`.** This is the only cell with a consistent gain. `base - floor` is 3.40 µs (0.37–6.22) on Bun and 3.40 µs (−0.25–4.98) on Node: the whole cost of the Effect layers around the decode attempt. `proto` removes 3.63 µs (1.62–5.34) on Bun and 7.28 µs (5.84–8.82) on Node.
- **`proto` beats `floor` on Node.** The floor has no Effect layer at all, so this extra gain is a V8 compilation or layout effect of calling `build` from a plain function rather than from a generator. Removing Effect work does not explain it.
- **End to end.** At `bank-16k` the attempt's savings are 1.5 to 3 percent of `T`. They do not survive into `decode-string` or `typed-decode`: Bun reads 1.016 and 1.050, with intervals that cross 1 or start at it, and Node reads about 1.00. Encode moves both ways: Bun `encode-typed` reads 0.914 and Node reads 1.000.
- **`bank-4m`.** Every median lies within about 6 percent of 1. Three intervals exclude 1: Bun `encode-typed` (1.054) is slower, and Node `attempt-decode` (0.938) and `decode-string` (0.976) are faster. Bun `attempt-encode` (1.043) crosses 1. Node `typed-decode`, which wraps that same `decode-string`, reads 1.058 (0.974–1.104).
- **Conclusion.** The deltas are a few microseconds against JIT and harness noise of ±5 percent. No end-to-end gain is resolvable.

### Wall ratio (secondary)

Wall medians agree with the CPU ratios. Every end-to-end cell lies between 0.940 and 1.047, and the intervals are wider: up to 0.817–1.338.

### Projected T / C

`T` is `base` or `proto`, and `C` is `computis`, all from the same rounds (CPU, JIT off):

| Runtime | Input      | Rung           | C ms   | T / C now           | T / C with proto    |
| ------- | ---------- | -------------- | ------ | ------------------- | ------------------- |
| bun     | `bank-16k` | `typed-decode` | 0.0907 | 2.656 (2.539–2.873) | 2.813 (2.654–2.872) |
| bun     | `bank-4m`  | `typed-decode` | 33.93  | 1.975 (1.806–2.085) | 1.922 (1.844–2.120) |
| node    | `bank-16k` | `typed-decode` | 0.0947 | 2.372 (2.343–2.513) | 2.372 (2.337–2.500) |
| node    | `bank-4m`  | `typed-decode` | 42.26  | 2.248 (2.112–2.369) | 2.364 (2.253–2.451) |
| bun     | `bank-16k` | `encode-typed` | 0.0451 | 2.762 (2.578–3.063) | 2.559 (2.396–2.739) |
| bun     | `bank-4m`  | `encode-typed` | 14.35  | 2.596 (2.427–2.846) | 2.753 (2.589–3.055) |
| node    | `bank-16k` | `encode-typed` | 0.0588 | 2.656 (2.292–2.836) | 2.634 (2.361–2.837) |
| node    | `bank-4m`  | `encode-typed` | 20.47  | 2.502 (2.375–2.632) | 2.487 (2.380–2.731) |

Every projected interval overlaps today's. The medians move in both directions: down for Bun `bank-16k` encode, up for Bun `bank-4m` encode and Node `bank-4m` decode. The ceiling is the whole Effect shell: about 3 µs of decode and under 10 µs of encode per call, which is at most 0.03 to 0.2 `C` at `bank-16k` and nothing at `bank-4m`.

### Allocation and GC

On Node at `bank-16k`, the prototype allocates 2.2 KB less per isolated decode attempt (0.9816 of base), and 3.0 to 3.5 KB less per whole decode or encode (about 0.99). GC counts per operation are equal in every cell.

The harness also reports 4.0 MB less per decode at `bank-4m` on Node. That is an artifact of its heap-statistics estimate, which depends on when GC runs. An exact count of a single operation on Node, with GC forced before it and a 2 GB young generation so that no collection runs during it (`alloc.ts`), gives the same allocation for all three variants: 25.36 MB (`base`), 25.53 MB (`proto`) and 25.53 MB (`floor`), of which `build` is 11.6 MB. Bun's allocation column is unverified, as the harness marks it.

## Correctness

- **Equivalence probes.** `equiv.ts`, run on Bun 1.4.2 and Node 26.13.0, makes 138 comparisons, with 0 differences on both runtimes. Each comparison is a deep equality of the outcome. The outcome covers the value, or the error's constructor, own fields, message, path, `position` and reason, plus defects and the interrupt flag. Outcomes: 42 successes, 90 failures, 2 defects, 4 interruptions. The probes cover:
  - `decodeString` and `fromString` decode, under default parse options and `errors: "all"`.
  - `bank-16k`, `bank-4m`, and every QTI corpus document (`corpus-all`).
  - Five mutations of each bank: a number leaf rejected mid-document, a boolean leaf rejected at the last record, a misspelled child, an undeclared prefix, and truncated text. These give `SchemaFailure`, `UndeclaredPrefix` and `WellFormedness` errors with positions.
  - `encodeString` and `fromString` encode of each decoded value.
  - Two encode faults: a U+0000 identifier, which gives `InvalidEvent` through the fallback, and a wrong-typed field, which gives `EncodeSchemaFailure`, also under `errors: "all"`.
  - Small codecs whose leaf decode and encode are asynchronous (`Effect.sleep`), require a service (`Effect.service`, provided), die, interrupt (`Effect.interrupt`), are plain, or are slow and interrupted from outside the fiber mid-leaf.
- **Test suite.** The repository's own suite ran against the prototype tree, which is a copy of `test/` importing `proto/src`. 1,205 tests passed. The one failure was a 5-second timeout on a 300,000-child encode under load. `base` failed the same test, plus one timing assertion. With `--testTimeout 120000`, the timing-sensitive files and the fast-path files pass on `proto`: 126 tests in `compile`, `positions`, `fast-decode`, `decode-string-fast-path`, `encode-string-fast-path` and `standard-laziness`. Together these files cover the `xml.codec` and `xml.fallback` span attributes, leaf run counts on each path, services provided around the attempt, defects and interruptions.

## Risks

- **Semantics.** `Effect.matchEager` documents itself as `match` for resolved effects. Its failure split is `findRecoverableError`, the same as `Effect.option`'s `MatchImpl`, so typed failures become `None` while defects and interruptions propagate on both paths. An effect that is not an `Exit` falls through to `Effect.match`.
- **Laziness.** Building the standard effect inside a thunk keeps `Effect.suspend` around today's decode and encode, so a leaf still runs only when the standard path runs. `standard-laziness.test.ts` passes.
- **Measurement.** The rounds ran at load 37 to 181. The per-call deltas (1 to 7 µs) are smaller than the run-to-run spread of the end-to-end rungs. Better measurement would show only a smaller number: the decode shell's entire cost is 3 µs.
- **What this does not cover.** Spans were measured with no tracer installed. A real tracer makes the span cost larger. That cost belongs to the caller's tracer, and the span is the library's observability contract, so the library should keep it.

## Recommendation

1. **Do not implement the prototype as a performance change.** It saves under 1 µs per decode call and under 10 µs per encode call. That is unresolvable end to end and changes no `T / C` cell. If the straight-line shell is wanted for readability, land it as a refactor, with no performance claim.
2. **Close "Effect runtime overhead" as a lever for item 5.** The structural codec runs fiber-free already. The Effect share that remains (6 to 11 percent of the codec, about 0.04 `C` decode and 0.09 `C` encode at `bank-4m`) is `Exit` allocation inside Schema's interpreter. Only the Schema JIT, which is excluded, or a parser outside Schema would remove it.
3. **Spend the next effort on the work Schema does per node.** About 70 percent of the structural codec's self time is Schema's own AST walk and link and check handling, and another 7 to 20 percent is building output objects. A lever there is fewer nodes for the parser to visit on the fast path: for example, fewer per-leaf encoding links from `toCodecStringTree`, or carried checks only where a plan has them. That is a hypothesis for a separate spike; this spike did not measure it.

## Files

`work/spikes/perf3b-sp-effect-overhead/` (gitignored):

- **Trees.** `base/` and `proto/`, with `BASE` holding the pinned commit.
- **A/B.** `case.ts`, `ab.ts`, `report.py`, the raw rounds `ab-bun.jsonl` and `ab-node.jsonl`, and `report.txt`.
- **Profiles.** `prof.ts`, `subtree.py`, and `prof/*.cpuprofile`.
- **Microbenchmarks.** `shell.ts`, `stream-fixed.ts`, `alloc.ts` and `explore.ts`.
- **Correctness.** `equiv.ts`, `equiv-bun.txt` and `equiv-node.txt`.
