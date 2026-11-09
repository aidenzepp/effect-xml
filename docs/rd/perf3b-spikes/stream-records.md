# Spike perf3b-sp-stream-records: the fused resolver and collector on the stream path

Unit `perf3b-sp-stream-records`. This is an R&D spike toward closing the typed decode gap to `@computis/effect-xml` (owner directive item 5). Since `7e280b3`, document decode runs the fused `resolveCollect` machine, but the record channels in `src/channel.ts` (`decodeSchemaString`, `decodeSchema`) still pipe `resolveEvents` into `collect`. The prototype lives in `work/spikes/perf3b-sp-stream-records/` (gitignored); this file is the durable record. No file under `src/`, `bench/` or `test/` changed.

## Result

- **The fused path costs less in the resolve-and-collect layer.** At `bank-4m` the layer costs 0.75 of today's on Bun (0.461 C to 0.346 C) and 0.40 of today's on Node (0.863 C to 0.297 C). It allocates 12 MB (Bun) and 16 MB (Node) less per run. That is a third of the layer's bytes.
- **The whole stream gains little on Bun and more on Node.** At `bank-4m` without positions, stream CPU is 0.957 (0.904–0.993) of today's on Bun. On Node it is 0.733 (0.700–0.860), but most of that gain comes from V8's GC regime, not from the work removed. In the 8 of 28 rounds where today's stream ran with fewer collections, the Node ratio is 0.91.
- **Positioned streams barely move.** With `positions: true`, the ratio is 0.960 (Bun) and 0.967 (Node) at `bank-4m`, with intervals that reach 1.02 and 1.03. The positioned tokenizer dominates that path, at 1.5 to 2.2 C.
- **The collector is not where the stream's time goes.** Budget checks cost nothing measurable. Inside the fused layer, the collector's own functions take about 30% of the samples, about 0.09 C on Node. The largest per-record cost is the record decode: about 3 µs per record, 0.7 to 1.0 C at `bank-4m`.
- **Output is identical.** 2,070 comparisons per runtime cover values, failures, positions and records emitted before a failure. All 2,070 compare equal on Bun and on Node.

Recommendation: switch the record channels to `resolveCollect` as one small slice. The change is two lines, the output is identical, and stream and document decode then share one machine. Do not expect it to close the stream gap. The next stream levers are the per-record decode and the positioned tokenizer. Details are in [Recommendation](#recommendation).

## Where the time goes today

Layer costs come from rungs that cut the `records()` pipeline of `src/channel.ts` at successive stages. Every rung runs over the bank's 64 KiB chunks, with the per-element pull and the `parserError` map that `records()` uses:

| Rung     | What it runs                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `tok`    | the parser only: upstream `decodeString`, or `decodeStringWithPositions` with positions                                       |
| `rc`     | `tok` plus `resolveEvents` piped into `collect` (main) or `resolveCollect` (prototype), at the bank path, default budgets     |
| `rcinf`  | `rc` with both budgets `Infinity`                                                                                             |
| `glue`   | `rc` plus `records()`' per-record emission (`flattenArray`, `mapEffect` with an `Effect.succeed` decode, `onExit` annotation) |
| `stream` | the public `decodeSchemaString(ItemRef, bankPath)({ positions })` channel, as the `effect-xml/stream` bench case runs it      |

A layer is its rung minus the rung before it, per round. The `glue`, `rcinf` and positioned-layer rows come from the first batch only (12 rounds). The other rows pool both batches (28 rounds). See [Measurements](#measurements).

### bank-4m, prototype, CPU per run over C

| Layer                                     | Bun, plain            | Node, plain          | Bun, positions        | Node, positions        |
| ----------------------------------------- | --------------------- | -------------------- | --------------------- | ---------------------- |
| parser (`tok`)                            | 0.598 (0.560–0.614)   | 0.486 (0.476–0.510)  | 2.169 (2.086–2.207)   | 1.522 (1.439–1.545)    |
| resolve and collect, fused (`rc` − `tok`) | 0.346 (0.310–0.383)   | 0.297 (0.284–0.312)  | 0.641 (0.529–0.776)   | 1.047 (1.033–1.156)    |
| budget checks (`rc` − `rcinf`)            | −0.014 (−0.041–0.041) | 0.008 (−0.013–0.025) | −0.024 (−0.051–0.217) | −0.091 (−0.163–−0.020) |
| per-record emission (`glue` − `rc`)       | 0.105 (0.075–0.143)   | 0.138 (0.107–0.626)  | 0.057 (−0.301–0.104)  | 0.242 (0.108–0.494)    |
| record decode (`stream` − `glue`)         | 1.043 (0.890–1.111)   | 0.679 (0.211–0.788)  | 1.078 (0.910–1.360)   | 0.568 (0.454–0.798)    |
| whole stream (`stream`)                   | 2.037 (1.943–2.129)   | 1.582 (1.531–1.610)  | 3.941 (3.772–4.135)   | 3.456 (3.263–3.618)    |

Per record, at 10,442 records, the prototype stream costs 6.5 µs (Bun) and 6.8 µs (Node) without positions. The record decode is 3.4 µs and 2.9 µs of that, and the emission 0.3 µs and 0.6 µs.

Positions add cost in two places. The positioned parser costs 1.60 C (Bun) and 1.00 C (Node) more than the plain one. Positioned resolving and the position trees cost 0.34 C (Bun) and 0.74 C (Node) more than the plain fused layer. That difference covers the `position` key on each resolved start and the collector's `OpenTree` per element. Each tree node calls `parseClark` for its local name.

### CPU profile

One Node `--cpu-prof` run of the prototype stream at `bank-4m`, under load. Shares rank costs; they include process start-up.

| Share of samples | Self or inclusive | Where                                                     |
| ---------------- | ----------------- | --------------------------------------------------------- |
| 24.1%            | self              | garbage collector                                         |
| 22.3%            | self              | upstream tokenizer (`Xml.js`)                             |
| 17.1%            | inclusive         | `attempt` (`fast-decode.ts`), the per-record decode       |
| 6.1%             | inclusive         | of which the builder (`build`, `buildNode`)               |
| 15.5%            | self              | the Effect runtime (`effect.js`, `core.js`, `Context.js`) |
| 8.6%             | inclusive         | the fused machine's step (`resolveCollect` `onSuccess`)   |
| 2.6%             | inclusive         | of which the collector's `start`, `end`, `text`, `count`  |

The Effect runtime share is the cost of running one effect per record through `Channel.mapEffect`: fiber steps, exits, and context lookups. The collector's work inside the fused machine is about 30% of that machine's samples, which puts it near 0.09 C on Node. The separate `collect` channel measured 0.27 to 0.29 C in the phase 3 ladder. Fusion removes that channel's own chunk and event handling; what remains is building the record tree.

## What the prototype changes

`work/spikes/perf3b-sp-stream-records/proto/src/channel.ts` is `src/channel.ts` at `a310ba3` with one change in `records()`:

```ts
// today
Channel.pipeTo(resolveEvents<XmlDecodeError | IE, Done>()),
Channel.pipeTo(collect<XmlDecodeError | IE, Done>(path, { maxElementNodes, maxElementSize })),
// prototype
Channel.pipeTo(resolveCollect<XmlDecodeError | IE, Done>(path, { maxElementNodes, maxElementSize })),
```

The import list changes to match. `resolveCollect` already exists and backs `fromString`. Its contract matches the two piped channels: one output chunk per input chunk, the loop stops at the first failure of either part, and records completed before the failure are emitted first. No public signature, type, span attribute or error changes. Neither the Schema JIT nor encode is touched.

Not taken:

- **Faster position trees.** The collector could take the record's local name from the resolver instead of calling `parseClark` per element. That would trim part of the 0.34 to 0.74 C positioned-tree layer. It needs a `Sink.start` parameter and was left for a slice of its own.
- **Lighter per-record decode.** The decode costs about 3 µs per record, run as one effect per record. A synchronous fast path for records the attempt accepts would remove most of the Effect runtime share. That is a change to `records()` and `fast-decode.ts`, outside this unit's focus.

## Measurements

Method, per the owner directive on measuring under load:

- **Driver.** `work/spikes/perf3b-sp-stream-records/drive.ts`. Each round runs every child once, each in its own process. The order reverses every other round. The 1-minute load is recorded per round. A round whose stream ratio lies beyond 3 IQR is repeated once; one round was (Bun `bank-16k`, batch 1).
- **Batches.** Batch 1 ran 15 children per round: all rungs above for main and the prototype, plus `computis-effect-xml/typed-decode` (C), for 12 rounds. Batch 2 ran 8 children per round (`tok`, `rc` for both, `stream` and positioned `stream` for both, and C) for 16 rounds. The pooled rows use 28 rounds.
- **Runtimes and inputs.** Bun 1.4.2 and Node 26.13.0, JIT off, at `bank-4m` (10,442 records) and `bank-16k` (42 records). Children time about 2 s after a warm-up (1 s for `bank-16k` in batch 1). The Bun and Node drivers ran at the same time, beside other seats' work. The 1-minute load ran from 31 to 183 on 14 cores.
- **Metrics.** CPU time (user plus system) per run from `process.resourceUsage()` is primary; the wall median per run is secondary. Allocation and GC per run come from `bench/harness/metrics.ts` (`v8.GCProfiler`, unverified on Bun).
- **Reduction.** Each value is the median over rounds of a per-round quantity, with a distribution-free interval on the order statistics: the 3rd to 10th of 12 (96.1%), the 9th to 20th of 28 (96.4%).
- **Baseline.** Main is a frozen copy of `a310ba3` (`git archive`). The prototype is that copy with only `src/channel.ts` replaced. Main moved to `0acc9db` during the runs; that commit changes only `docs/goals/`.

### Stream, prototype over main, CPU per run (28 rounds)

| Cell             | Plain               | Positions           | Wall median, plain  |
| ---------------- | ------------------- | ------------------- | ------------------- |
| Bun, `bank-4m`   | 0.957 (0.904–0.993) | 0.960 (0.928–1.020) | 0.952 (0.914–1.018) |
| Node, `bank-4m`  | 0.733 (0.700–0.860) | 0.967 (0.932–1.029) | 0.899 (0.795–1.002) |
| Bun, `bank-16k`  | 0.931 (0.820–0.996) | 0.838 (0.802–0.906) | 0.954 (0.943–0.962) |
| Node, `bank-16k` | 0.963 (0.935–1.009) | 0.974 (0.932–1.028) | 0.967 (0.955–0.973) |

### bank-4m, absolute and over C (28 rounds)

| Quantity                                    | Bun                 | Node                 |
| ------------------------------------------- | ------------------- | -------------------- |
| C, computis typed decode (ms)               | 33.69 (31.81–34.61) | 44.50 (43.53–45.92)  |
| stream, main (ms)                           | 70.03 (67.11–75.24) | 96.31 (83.60–100.39) |
| stream, prototype (ms)                      | 67.75 (65.56–72.08) | 70.80 (68.54–73.72)  |
| stream / C, main → prototype                | 2.100 → 2.037       | 2.163 → 1.582        |
| positioned stream / C, main → prototype     | 4.053 → 3.941       | 3.494 → 3.456        |
| resolve and collect / C, main → prototype   | 0.461 → 0.346       | 0.863 → 0.297        |
| resolve and collect, prototype / main       | 0.745 (0.646–0.807) | 0.399 (0.327–0.691)  |
| saving per record (µs)                      | 0.27 (0.04–0.59)    | 2.46 (1.10–3.08)     |
| allocation, rc layer, main → prototype (MB) | 33.4 → 21.5         | 45.4 → 29.6          |
| allocation, stream, main → prototype (MB)   | 120.8 → 108.4       | 138.6 → 121.0        |
| allocation, positioned stream (MB)          | 242.5 → 227.0       | 283.0 → 264.6        |
| GC pause, stream, main → prototype (ms)     | 91.4 → 93.7         | 82.6 → 59.1          |

### bank-16k, over C (28 rounds)

| Quantity                                  | Bun                    | Node                   |
| ----------------------------------------- | ---------------------- | ---------------------- |
| C (ms)                                    | 0.1003 (0.0965–0.1049) | 0.0981 (0.0964–0.1054) |
| stream / C, main → prototype              | 3.717 → 3.432          | 4.586 → 4.350          |
| positioned stream / C, main → prototype   | 11.22 → 10.39          | 9.601 → 9.419          |
| resolve and collect, prototype / main     | 0.676 (0.640–0.746)    | 0.827 (0.799–0.919)    |
| allocation, stream, main → prototype (MB) | 0.537 → 0.476          | 0.619 → 0.542          |

At `bank-16k` the stream costs 3.4 to 4.6 C, against 2.0 to 2.2 C at `bank-4m`. The difference is per-run cost (channel build, span, tokenizer lookup, first-record plan) spread over 42 records.

### The Node GC regime

Node's `bank-4m` rungs run in one of two GC regimes per process. Allocation per run is the same in both; the number of collections per run is not. Today's `rc` rung runs 2.4 to 2.5 collections per run in its low regime and 2.8 to 3.1 in its high regime. The fused `rc` rung runs 1.9 to 2.0 in 26 of 28 rounds. The whole stream shows the same split, at 4.0 to 4.3 collections per run for today's low regime against 4.5 to 4.8 for its high one:

| Today's stream regime   | Rounds | Stream, prototype / main |
| ----------------------- | ------ | ------------------------ |
| low (≤ 4.3 collections) | 8      | 0.91                     |
| high (> 4.3)            | 20     | 0.71                     |

The fused path allocates less and lands in the low regime almost every time, so the measured median of 0.733 is real for these runs. It depends on V8's heap sizing under this load, though. A slice should expect between 0.91 and 0.73 on Node at `bank-4m`, and should not promise the lower figure. Bun shows no such split.

## Correctness

The prototype's output is identical to main's.

- **Equivalence check.** `work/spikes/perf3b-sp-stream-records/equiv.ts`, under Bun and Node, compares main's frozen copy with the prototype using `node:util` `isDeepStrictEqual`. Each probe collects every emitted item and the terminal failure, so records emitted before a failure are compared too. Failures are compared by class name and every own field: message, reason, path, record ordinal and position. Functions inside a failure's schema AST are compared by name, because each module copy has its own closures.
- **Probes per document.**
  - The public channels `decodeSchemaString` (text) and `decodeSchema` (UTF-8 bytes).
  - The pre-decode records with their `recordPositions` trees, through the same wiring as `records()`.
  - Each with positions off and on.
  - Each under five budget settings: default; `maxElementNodes` 12 (fails at record 1); `maxElementSize` 276 (10 records, then a `Limit` at record 11); `maxElementNodes` 5 and `maxElementSize` 200; and `maxElementNodes` 2 and `maxElementSize` 60.
  - For the banks, at the bank path and at `["*", "*"]`; for the corpus, at `["*", "*"]`, `["*", "*", "*"]` and `["*", "*", "*", "*"]`.
- **Inputs.**
  - `bank-16k`, `bank-4m`, and `bank-4m-bad-last`, which has a `SchemaFailure` at record 10,442.
  - `bank-16k` re-chunked at 97 characters, so records straddle chunk boundaries.
  - All 15 documents of the QTI corpus (`corpus-all`).
  - 7 hand-written documents, re-chunked at 23 characters. They cover a record missing `href` between two good ones, malformed input after a good record, an undeclared prefix between records and on an attribute inside a record, a reserved-prefix declaration inside a record, a duplicate expanded attribute, and a nested namespace document.
- **Result.** 2,070 checks per runtime, 0 differences, on Bun 1.4.2 and Node 26.13.0. 1,790 of the 2,070 outcomes on each runtime end in a failure, and those failures compare equal.
- **Library tests.** The library suite, run with `vitest` inside each frozen copy (excluding `test/bench/`), passes the same way against both: 1,070 passed and 2 skipped. That includes `channel.test.ts`, `codec.test.ts`, `resolve.test.ts`, `positions.test.ts`, `test/streaming` and `test/resolve-collect.test.ts`. Eight `spikes/` suites failed to load in both copies, because the copies reach them through a symlink. They do not exercise the channel.

## Risks

- **The gain depends on GC under load.** The Node win at `bank-4m` is mostly the GC regime (see [The Node GC regime](#the-node-gc-regime)). On an idle machine, or with another heap size, the stream ratio may sit near 0.91 on Node and near 0.96 on Bun.
- **The piped channels lose their only `src/` caller.** After the switch, nothing in `src/` calls `resolveEvents` or `collect`. Tests, the test oracle and the bench layer ladder still use both, and `test/resolve-collect.test.ts` checks the fused channel against the piped pair. Neither is public. Removing them is a separate decision.
- **Behavior.** The change replaces two channels with one whose contract is the same. The equivalence check covers failure precedence, records emitted before a failure and positions, and found no difference.
- **Measurement.** Load ran from 31 to 183 on 14 cores, and wall medians ran 2 to 10 times the CPU per run. `GCProfiler` on Bun is unverified. The profile shares are sampled under load and only rank costs.

## Projected effect

- **Stream.** At `bank-4m`, stream CPU over C moves from 2.10 to 2.04 on Bun and from 2.16 to 1.58 on Node in these runs. On Node, 1.97 is the figure if the GC-regime effect does not carry over. With positions, it moves from 4.05 to 3.94 (Bun) and from 3.49 to 3.46 (Node).
- **Typed decode `T / C`.** No change. `fromString` already runs `resolveCollect` (`7e280b3`), so the phase 3 `T / C` (2.20 on Node at `bank-4m`) is unaffected.
- **Closing the stream gap.** Without positions, the prototype stream is still 2.0 C (Bun) and 1.6 C (Node). Removing the whole fused layer would leave 1.7 C and 1.3 C. The remaining cost sits in the per-record decode and its Effect runtime share (0.7 to 1.0 C) and in the tokenizer (0.5 to 0.6 C).

## Recommendation

1. **Switch the record channels to `resolveCollect` as one slice.** Replace the `resolveEvents` and `collect` pair in `records()` with `resolveCollect(path, budgets)`, as in the prototype. Keep `test/resolve-collect.test.ts`, and add a channel test that a `Limit` on record 11 still emits records 1 to 10 first. Expected: stream CPU 0.93 to 0.96 of today's on Bun, and 0.73 to 0.91 on Node at `bank-4m`; about 12 to 16 MB less allocation per `bank-4m` run.
2. **Look next at the per-record decode, not the collector.** Budget checks cost nothing measurable, and the collector is about 0.09 C inside the fused machine. The record decode is 0.7 to 1.0 C at `bank-4m`, and much of it is running one effect per record. A synchronous path for records the attempt accepts is the next candidate for the stream.
3. **For positioned streams, the parser and the trees are the levers.** The positioned parser costs 1.0 to 1.6 C more than the plain one. Positioned resolving and trees cost 0.3 to 0.7 C more. Carrying the local name from the resolver into the tree would trim the second. A tokenizer with native positions would remove most of the first, which is step-2 territory.

## Reproduce

From the repository root, with the spike directory in place:

```sh
bun work/spikes/perf3b-sp-stream-records/equiv.ts         # also under node
bun work/spikes/perf3b-sp-stream-records/drive.ts bun bank-4m 12 2000 work/spikes/perf3b-sp-stream-records/results/bun-bank-4m.json
SCHEDULE=short node work/spikes/perf3b-sp-stream-records/drive.ts node bank-4m 16 2000 work/spikes/perf3b-sp-stream-records/results/b2-node-bank-4m.json
python3 work/spikes/perf3b-sp-stream-records/analyze.py work/spikes/perf3b-sp-stream-records/results/bun-bank-4m.json work/spikes/perf3b-sp-stream-records/results/b2-bun-bank-4m.json
node --cpu-prof work/spikes/perf3b-sp-stream-records/case.ts proto stream bank-4m 4000
```

`drive.ts` takes the runtime, the input, the rounds, the target milliseconds per child, and the output file. `case.ts` takes the variant (`main`, `proto` or `computis`), the rung, the input and the target.
