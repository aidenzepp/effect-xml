# Spike perf3b-sp-tokenizer-encode: the upstream tokenizer encode and what the library can change

Unit `perf3b-sp-tokenizer-encode`. This is an R&D spike. The prototype lives in `work/spikes/perf3b-tokenizer-encode/` (gitignored); this file is the durable record. The evidence it starts from is the tokenizer-encode row of [Phase 3 layer profile (new code)](../performance.md#phase-3-layer-profile-new-code): 1.74 `C` on Bun and 1.06 `C` on Node at `bank-4m`, JIT off.

## Result

The library has no lever on this layer that pays at `bank-4m`. The events already reach upstream as one array in one chunk, and the cost is upstream's per-event work: the character check, string building, and escaping. A hand-written direct text writer (which conflicts with M5) is no faster than upstream at `bank-4m`. On Node it is 1.74 times slower when it joins an array, and equal when it builds a rope, as upstream does. The one material gain is at `bank-16k` on Node, where running upstream's own writer without the Effect channel wrapper saves a little over a third of the writer-plus-tokenizer CPU (Bun gains under 0.1 `C`). That needs an upstream export, so it is a feature-request candidate and not a library change.

Recommendation: keep M5 as ruled. Do not build a direct writer. Do not change how the events are handed over. Spend the encode effort on the library's own writer (1.91 `C` on Bun, 1.60 `C` on Node). Raise a synchronous `Xml` encode entry point with upstream only if small-document encode matters.

**Coverage.** Both drives completed all 12 planned rounds, above the directive's 10, and every table below comes from all 12. The first version of this record used the 6 to 8 rounds finished at the time. The full rounds change no conclusion. The largest shift is the Node `bank-4m` in-pipeline cost of the direct writer, from 9.23 to 5.57 ms. To reproduce the tables, run `analyze.ts` and `aux/paired.ts` on `ab-*.jsonl` in `work/spikes/perf3b-tokenizer-encode/`.

## Method

- **Harness.** `spike.ts drive` runs every variant in its own child process, interleaved within each round, and reverses the order every other round. The rounds are per input (`bank-16k`, `bank-4m`), with Bun 1.4.2 and Node 26.13.0, JIT off. Each child warms up for at least 1.5 s or 30 operations. It then takes 7 samples of K operations, with K sized to about 250 ms, through `bench/harness/metrics.ts` `measureResources`. It reports per-operation medians of CPU (user plus system, the primary metric), wall time, GC pause, and allocated bytes, using `v8.GCProfiler` (unverified on Bun). The 1-minute load is recorded per child: 11–105 over the run. The Bun and Node drives ran at the same time as each other and beside other seats' work.
- **Ratios.** Each variant is divided by `current` from the same round, and the result is reduced to the median with a distribution-free order-statistic interval of at least 95% coverage.
- **Events.** The events come from the library's own path, imported from the working tree. That was `main` at `240ad37` when the drives started; `659480f` changed the library writer partway through (see Measurement under Risks). The bank value is decoded once and encoded once with `checkedStructuralOf`. `toEventsFrom(writerOf(plan, plan.prefixes), plain, { declaration: false })` then writes the events. The "isolated" variants encode one event array built once. The "in-pipeline" variants (`writer+…`) build fresh events every operation and then encode them, as `encodeString` does. The in-pipeline step is `(writer+X) − writer` per round.
- **Input shape.** `bank-4m` has 125,306 events: 62,653 `StartElement` and 62,653 `EndElement`, with 104,421 attributes on 52,211 elements. It has no `Text` events, and no attribute value needs escaping. `bank-16k` has 506 events of the same shape. The output is 4,048,243 and 15,910 characters.

## Variants

| Variant                       | What it does                                                                                                                                 | M5                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `current`                     | `Stream.fromIterable(events)` → `pipeThroughChannel(Xml.encodeString())` → `Stream.mkString` → `Effect.runSync`, as `src/fast-encode.ts:325` | —                        |
| `channel`                     | `Channel.runFold(Channel.pipeTo(Channel.succeed(events), Xml.encodeString()))`, with no `Stream` wrapper                                     | compatible               |
| `chunked-1024`                | the same, with events in chunks of 1024                                                                                                      | compatible               |
| `normalized`                  | `current` over events rebuilt as fresh literals, with attributes re-inserted in order (tests event shape)                                    | compatible               |
| `upstream-sync`               | upstream's private `Writer` class driven in a plain loop: the same algorithm, with no Channel or Effect                                      | needs an upstream export |
| `direct`                      | a hand copy of upstream's checks and escaping that joins an array; any refusal falls back to upstream for the exact error                    | **conflicts**            |
| `direct-batch`                | `direct` with ropes, and one character check over the whole output instead of per tag                                                        | **conflicts**            |
| `copy-full` … `copy-dispatch` | decomposition: the hand copy with checks, escaping, string building, and concatenation removed one at a time                                 | analysis only            |

`Stream.fromIterable` on an array is already `fromArray`, one chunk (`effect/dist/Stream.js:696`, `:783`). Upstream appends each event's text with `out[0] += text` (`Xml.js:1488`), so the whole document becomes one rope and one output chunk.

## Where the time goes

CPU profile of `current` at `bank-4m` (`prof/top-current.txt`). Self time, encode frames only:

- **Bun:** `searchInvalid` 1158 ms, plus `isWellFormed` 67 and its regex 55 (about 43% of the encode frames); `escapeAttribute` 425, plus its regex 346 (26%); `write` 649 (22%); `push` 186; `isName` 115.
- **Node:** `(garbage collector)` 857 ms; `searchInvalid` 485, plus its regex 182 and `isWellFormed` 76; `push` 450 (the rope append); `write` 416; `escapeAttribute` 206, plus its regex 249; `isName` 78.

Decomposition, isolated, CPU share of `copy-full` (median ms per operation; each removed cost is the median of the per-round paired differences):

| Cost removed                                 | Bun `16k`    | Bun `4m`     | Node `16k`   | Node `4m`  |
| -------------------------------------------- | ------------ | ------------ | ------------ | ---------- |
| `copy-full` (equals upstream)                | 0.0375       | 13.64        | 0.0473       | 12.42      |
| character and name checks                    | 0.0203 (54%) | 3.08 (23%)   | 0.0210 (44%) | 3.62 (29%) |
| attribute escaping (finds nothing to escape) | 0.0037 (10%) | within noise | 0.0064 (14%) | 1.43 (12%) |
| appending to the output rope                 | 0.0026 (7%)  | 5.76 (42%)   | 0.0027 (6%)  | 3.05 (25%) |
| building tag strings                         | 0.0076 (20%) | 1.89 (14%)   | 0.0097 (21%) | 2.28 (18%) |
| dispatch, `for…in` over attributes, stack    | 0.0033 (9%)  | 2.25 (17%)   | 0.0073 (15%) | 1.96 (16%) |

The tokenizer's own algorithm accounts for all of it. Per event it checks characters and names, scans for escapes, builds a template string, and appends to a rope. No event is redundant: the bank has no empty or split text.

## Measured ratios (CPU per operation, prototype / `current`, same round)

Isolated, one prebuilt event array:

| Variant         | Bun `16k`           | Bun `4m`          | Node `16k`          | Node `4m`          |
| --------------- | ------------------- | ----------------- | ------------------- | ------------------ |
| `channel`       | 1.01 (0.983–1.04)   | 1.03 (0.883–1.14) | 0.982 (0.906–1.00)  | 1.00 (0.971–1.02)  |
| `chunked-1024`  | 1.12 (1.09–1.14)    | 1.13 (1.06–1.20)  | 1.08 (1.01–1.09)    | 1.91 (1.82–1.95)   |
| `normalized`    | 1.02 (0.969–1.03)   | 1.01 (0.914–1.12) | 0.987 (0.957–1.01)  | 1.02 (0.997–1.05)  |
| `upstream-sync` | 0.920 (0.905–0.943) | 1.09 (0.939–1.16) | 0.927 (0.809–0.957) | 0.989 (0.954–1.01) |
| `direct`        | 1.07 (1.04–1.09)    | 1.02 (0.963–1.14) | 1.09 (0.987–1.12)   | 1.74 (1.63–1.80)   |
| `direct-batch`  | 0.758 (0.748–0.770) | 1.02 (0.873–1.22) | 0.985 (0.847–0.996) | 1.32 (1.29–1.35)   |

In-pipeline (fresh events every operation). Medians in ms per operation, with the step as `(writer+X) − writer`:

| Pipeline                           | Bun `16k`                | Bun `4m`           | Node `16k`             | Node `4m`            |
| ---------------------------------- | ------------------------ | ------------------ | ---------------------- | -------------------- |
| `writer` alone                     | 0.0118                   | 6.14               | 0.0134                 | 10.05                |
| `writer+current`                   | 0.0586                   | 22.13              | 0.104                  | 28.91                |
| `writer+upstream-sync`             | 0.0535                   | 21.86              | 0.0640                 | 29.24                |
| `writer+direct`                    | 0.0610                   | 20.59              | 0.0732                 | 33.81                |
| `(writer+direct)/(writer+current)` | 1.05 (0.986–1.10)        | 0.977 (0.783–1.07) | 0.708 (0.683–0.732)    | 1.19 (1.12–1.29)     |
| step saving, `current − direct`    | −0.0045 (−0.0057–0.0015) | 0.67 (−1.72–4.82)  | 0.0325 (0.0270–0.0442) | −5.57 (−10.54–−3.20) |

GC and allocation per operation (in-pipeline, medians): Node `bank-4m` allocates 44.5 MB for `writer+current` (31.3 MB of it is the tokenizer step), with 7.7 ms of GC pause. `writer+direct` allocates 49.7 MB with 10.1 ms of pause. Node `bank-16k`: `writer+current` allocates 183 KB with 0.014 ms of pause; `writer+upstream-sync` allocates 176 KB with 0.0026 ms. Bun's GC fields come from `GCProfiler` on Bun, which is unverified, and are omitted from the argument. The full tables, including `wall / current`, are in `work/spikes/perf3b-tokenizer-encode/analysis-full.md`.

Two readings:

1. The in-pipeline step costs more than the isolated encode (Node `bank-16k`: 0.091 against 0.049 ms; Bun `bank-4m`: 16.0 against 13.4 ms). Fresh events make GC pressure. The profile's layer deltas point the same way (Node `16k` 0.114, Bun `4m` 23.1).
2. At Node `bank-16k`, the cost above upstream's algorithm is the Effect channel run. `writer+upstream-sync` and `writer+copy-full` land at 0.064 and 0.065 ms, against 0.104 ms for `writer+current` (paired ratio 0.634, 0.609–0.663), and the GC pause drops fivefold. At `bank-4m` the same comparison shows no difference (paired ratio 0.996, 0.970–1.03): the per-call overhead amortizes over 125k events.

## Projected T / C (JIT off, from the layer profile's `T` and `C`)

| Change                                                 | Bun `4m`                                  | Node `4m`                  | Node `16k`            | Bun `16k`        |
| ------------------------------------------------------ | ----------------------------------------- | -------------------------- | --------------------- | ---------------- |
| today                                                  | 5.25                                      | 4.35                       | 4.31                  | 3.61             |
| any handover lever (`channel`, chunking, shape)        | no change (chunking makes it worse)       | no change (chunking: +0.5) | no change             | no change        |
| direct writer (conflicts with M5)                      | 5.20, with an interval spanning no change | 4.62 (worse)               | 3.77 (−0.54 `C`)      | no change        |
| synchronous upstream writer (needs an upstream export) | no change, within noise                   | no change, within noise    | about 3.6 (−0.69 `C`) | 3.53 (−0.08 `C`) |

Method: `T − saving`, with the saving measured in-pipeline in this spike's rounds, divided by the profile's `C` (Bun `4m` `C` 12.47 ms, Node `4m` 20.43, Node `16k` 0.0600, Bun `16k` 0.0480). The machine and the load differ from the profile run, so read these as directions, not as point predictions.

## Correctness

`spike.ts verify` compares every variant's text with `current`'s, on both runtimes (`verify.txt`): byte-identical on `bank-16k`, `bank-4m`, `corpus-items` (4 fixtures, `AssessmentItem` writer events), and `corpus-all` (15 fixtures, upstream decoder events, including declarations with `standalone`, comments, and prolog whitespace). The hand copy wrote every document itself; none fell back. On invalid events (a control character in text or in an attribute, an invalid name, a lone surrogate, an unclosed element), the hand copy refuses, and `direct` falls back to upstream, which produces the exact `XmlError`.

## Risks

- **The direct writer.** It duplicates upstream escaping and validation, which M5 forbids for a reason. It bypasses a provided `Tokenizer`, and it must track upstream changes to escaping and validation. It also bought nothing here.
- **Coverage.** The bank has no `Text` events and no escapes, so text-heavy documents weigh escaping and text checks differently. The corpus check covers correctness, not cost.
- **Measurement.** The `writer` rows shift partway through the drives. In rounds 0–4 on Node, `writer` alone at `bank-4m` takes 22–26 ms and allocates 57.5 MB; in rounds 5–11 it takes 8–10 ms and 13.3 MB. Bun shifts the same way after round 3. The spike imports the library writer from the working tree, and `659480f` (attributes written straight into the start tag) landed during the drives. The isolated rows do not move, and every step and paired ratio is taken within one round, so the conclusions hold; the in-pipeline medians mix the two writers. The load was heavy and variable; Bun's GC numbers are unverified; process CPU includes background GC threads.
- **The `upstream-sync` gain** relies on a private upstream class. It is evidence for a feature request, not a design.

## Recommendation

1. Keep M5. Record that the direct writer was measured and gains nothing at `bank-4m`: −0.67 ms (interval spanning zero) on Bun, +5.6 ms (worse) on Node.
2. Change nothing in how `fast-encode.ts` hands the events over. One array is already one chunk. `Channel` without `Stream` is the same. Chunking costs 1.1–1.9 times as much.
3. Put the next encode slice on the library writer (`attributesOf`, `writeNode`, the spread at `src/writer.ts:439`). It is the largest encode cost the library owns, and it drives the GC pressure that makes the tokenizer step cost more in-pipeline than isolated.
4. Optionally, ask upstream for a synchronous encode of an event array to text with the same checks (the shape of `upstream-sync`). It is worth about 0.7 `C` on Node at `bank-16k`, under 0.1 `C` on Bun there, and nothing at `bank-4m`. Draft it with the `feature-request-authoring` skill if small-document encode becomes a target.
