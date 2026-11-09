# Spike perf3b-sp-resolver: the namespace resolver on the decode path

Unit `perf3b-sp-resolver`. This is an R&D spike toward closing the typed decode gap to `@computis/effect-xml` (owner directive item 5). The phase 3 layer profile put `src/resolve.ts` at 0.89 C (Bun) and 0.85 C (Node) of typed decode at `bank-4m`. The prototypes live in `work/spikes/perf3b-resolver/` (gitignored); this file is the durable record. No file under `src/`, `bench/` or `test/` changed.

## Result

- **The resolver layer costs half as much.** A rewrite of the start-tag path with identical output takes the resolver layer from 0.93 C to 0.49 C on Bun and from 0.94 C to 0.50 C on Node at `bank-4m`. That is 0.52 (Bun) and 0.54 (Node) of today's layer, in CPU time. It allocates half the bytes: 87 to 43 MB per decode on Node.
- **Typed decode drops 14 to 16 percent.** CPU per decode is 0.84 (Bun) and 0.86 (Node) of today's at `bank-4m`, and 0.86 and 0.85 at `bank-16k`. `T / C` at `bank-4m` falls from 2.86 to 2.38 on Bun and from 2.87 to 2.44 on Node.
- **Fusing the resolver into the collector adds about 6 points.** A second prototype feeds the collector directly from the resolver, with no `ResolvedEvent` objects and no intermediate chunk. Resolver plus collector then cost 0.57 C (Bun) and 0.60 C (Node), against 1.31 C and 1.22 C today. Typed decode is 0.79 of today's on both runtimes at `bank-4m`, and `T / C` is 2.24 (Bun) and 2.30 (Node).
- **A custom tokenizer is not needed for this step.** After fusion, what remains in the two layers is per-element work that any design pays: one attributes object, one frame, one record node. A tokenizer that emitted Clark names could still save one attributes copy per element, but the tokenizer itself (0.80 C Bun, 0.88 C Node) is the larger cost, and that is the step-2 question.

Recommendation: build the resolver rewrite as one slice, then the fused resolve-and-collect channel as a second slice. Details are in [Recommendation](#recommendation).

## Where the time goes today

CPU profiles of the resolver rung (tokenizer then `resolveEvents`, `bank-4m`, JIT off), `--cpu-prof`, run under load. The shares rank the costs; the A/B tables below give the measured CPU.

| Function (self time, share of samples)                    | Node 26.13.0 | Bun 1.4.2 | Where                                                        |
| --------------------------------------------------------- | ------------ | --------- | ------------------------------------------------------------ |
| (garbage collector)                                       | 25.1%        | not split | allocation of the per-element objects listed below           |
| upstream `startTag`                                       | 15.4%        | 26.6%     | the tokenizer, not the resolver                              |
| resolver `start` (the start-tag body)                     | 14.8%        | 18.4%     | `makeMachine`'s `start`                                      |
| `splitQName`                                              | inlined      | 8.5%      | `startStep`, once per start tag, cache hit or not            |
| machine `push`                                            | 5.6%         | 7.4%      | dispatch, a new `Text` or `EndElement` object, the out array |
| `intern` and its closures                                 | 1.7%         | 5.1%      | element name and every attribute, on hit and miss            |
| `splitAttributes`                                         | 2.8%         | 1.9%      | the attribute pass                                           |
| `Object.fromEntries`                                      | inlined      | 1.3%      | the resolved attributes                                      |
| resolver-owned functions per operation (self ms, sampled) | 32.8 ms      |           | prototype A: 17.3 ms; GC 31.3 ms, prototype A 15.5 ms        |

Today each start tag allocates, beyond the event it must emit:

1. `splitQName`'s result object, an `Option`, and for a prefixed name two slices, every time, through `startStep`, even when the Clark name is cached.
2. `Option.fromUndefinedOr(parent)`, and `Option.some(position)` on positioned input.
3. An `ElementStep` object, and a push onto the `written` name stack, kept only for failure messages.
4. In `splitAttributes`: the `Object.keys` array, a `plain` key array, and a result object.
5. One `intern` closure for the element name and one per attribute, on every call.
6. One `[key, value]` array per attribute, the entries array, and the object `Object.fromEntries` builds from them.
7. A `Map` for the duplicate check on every element with two or more attributes.
8. On positioned input, a spread copy of the resolved start to add `position`.

On Node the resolver layer allocates 86.8 MB per `bank-4m` decode (62,653 elements, 219,285 events), about 1.4 KB per element.

## What the prototypes change

Both prototypes keep `resolveEvents`, `collect`, `ResolvedEvent` and every public signature. Both keep the channel shape (`Channel.fromTransform` over a `Pull`, one output chunk per input chunk, output before a failure emitted first). Neither imports the Schema JIT, and neither touches encode, so the M5 ruling is unaffected.

**Prototype A, the resolver rewrite** (`work/spikes/perf3b-resolver/proto/src/resolve.ts`, `makeMachine` and its helpers; about 220 lines changed):

1. The per-scope element cache stores the Clark name and the local part together, so a cache hit does no splitting.
2. No `Option` on the hot path: the parent frame, the position stamp, and the prefix are plain `undefined` checks.
3. A frame holds the written name, local part and child index. The `ElementStep` path and the written-name path are built from the frames only when a failure is recorded.
4. One pass over `Object.keys` computes the size and checks the declarations. A second pass over the same keys resolves the attributes, skipping `xmlns*` keys only when the tag declared any. No `plain` array and no result object.
5. Inline `Map` lookups replace `intern` closures. An unprefixed attribute skips the cache: its Clark name is its written name.
6. The attributes object is built by assignment. A `__proto__` key goes through `Object.defineProperty`, so it stays an own data property, as `Object.fromEntries` makes it.
7. The duplicate expanded-name check runs only once a prefixed attribute has been seen, as `Object.hasOwn` on the object being built. Two unprefixed keys cannot collide, because object keys are distinct and their Clark names are the keys. On a collision the first attribute is found again by scanning the earlier keys.
8. The resolved start is built once, with `position` as its last key when stamped, the same key order as today's spread.

**Prototype B, resolve and collect fused** (`work/spikes/perf3b-resolver/proto2/src/resolve.ts` and `codec.ts`): prototype A plus a `resolveCollect(path, limits)` channel. `makeMachine` takes an optional sink. The collector's `push` is split into `start`, `end` and `text` methods, and the collector is that sink, so no `ResolvedStart`, `ResolvedEnd` or `ResolvedText` object and no intermediate chunk is built. The loop stops at the first failure of either part. That keeps today's precedence: the failure of the earlier event wins, and records completed before it are emitted first. `codec.ts` `readRoot` uses `resolveCollect` in place of `resolveEvents` piped into `collect`. `resolveEvents` and `collect` stay for the channel API.

Not taken: reusing the tokenizer's attributes object when no key needs rewriting. Upstream builds attributes from a null-prototype `Attributes` class and shares one frozen empty object, so reuse would change the prototype of `ResolvedElement.attributes` and tie the resolver to one tokenizer's internals. Passing upstream `Text` events through unchanged was not taken either, because another `Tokenizer` may add fields to them.

## Measurements

Method, per the owner directive on measuring under load:

- **Driver.** `work/spikes/perf3b-resolver/drive3.ts`. Each round runs 10 child processes: the tokenizer rung, the resolver rung (main, A), the collector rung (main, A, B), the typed decode (main, A, B), and `computis-effect-xml/typed-decode`. The order reverses every other round. A round whose decode ratio is an outlier (beyond 3 IQR) is repeated once; none was.
- **Rounds.** 12 rounds per runtime and input, Bun 1.4.2 and Node 26.13.0, JIT off. `bank-4m` children time about 2 s of operations after a warmup, `bank-16k` children about 1 s. The Bun and Node drivers ran at the same time, beside other seats' spikes. One-minute load: 17 to 105 at `bank-4m`, 19 to 31 at `bank-16k`.
- **Metrics.** CPU time (user plus system) per operation from `process.resourceUsage()` is primary; the wall median per operation is secondary. Allocation per operation and GC pause per operation come from `bench/harness/metrics.ts` (`v8.GCProfiler`; its fidelity on Bun is unverified). A layer's cost is its rung minus the rung before it, per round.
- **Reduction.** Each value is a median over the 12 rounds with a distribution-free interval on the order statistics, the 3rd to the 10th of 12, which covers 96.1%.
- **Baseline.** "Main" is a frozen copy of commit `7f1cff8` (`git archive` into the spike directory), so commits landing during the run could not change it. Prototypes A and B are that tree with only `resolve.ts` (and, for B, `codec.ts`) replaced. Main's later commits (`659480f`, the writer) do not touch decode.

### bank-4m, CPU per operation

| Quantity                            | Bun                 | Node                |
| ----------------------------------- | ------------------- | ------------------- |
| C, computis typed decode (ms)       | 30.56 (29.92–31.79) | 38.65 (37.73–42.12) |
| T, main typed decode (ms)           | 87.63 (84.88–92.41) | 112.3 (108.5–120.2) |
| tokenizer rung (ms)                 | 24.40 (24.03–25.11) | 33.89 (33.25–36.40) |
| resolver layer, main (ms)           | 28.64 (28.07–29.49) | 36.73 (35.10–39.32) |
| resolver layer, A (ms)              | 14.73 (13.71–15.83) | 19.90 (18.91–22.11) |
| resolver layer, A / main            | 0.516 (0.484–0.552) | 0.540 (0.498–0.593) |
| resolver layer / C, main            | 0.932 (0.895–0.959) | 0.936 (0.891–0.960) |
| resolver layer / C, A               | 0.486 (0.444–0.520) | 0.498 (0.478–0.540) |
| collector layer / C, main           | 0.357 (0.308–0.398) | 0.276 (0.233–0.361) |
| resolver + collector / C, main      | 1.312 (1.229–1.361) | 1.219 (1.181–1.362) |
| resolver + collector / C, A         | 0.729 (0.722–0.806) | 0.778 (0.746–0.851) |
| resolver + collector / C, B (fused) | 0.571 (0.550–0.632) | 0.599 (0.557–0.660) |
| resolver + collector, B / main      | 0.455 (0.414–0.482) | 0.488 (0.437–0.544) |
| typed decode, A / main              | 0.840 (0.802–0.865) | 0.860 (0.810–0.876) |
| typed decode, B / main              | 0.787 (0.767–0.795) | 0.794 (0.774–0.823) |
| T / C, main                         | 2.863 (2.751–2.972) | 2.870 (2.776–2.971) |
| T / C, A                            | 2.384 (2.307–2.496) | 2.437 (2.412–2.519) |
| T / C, B                            | 2.240 (2.195–2.278) | 2.296 (2.228–2.354) |
| wall median, typed decode, A / main | 0.843 (0.808–0.885) | 0.854 (0.814–0.895) |
| wall median, typed decode, B / main | 0.792 (0.745–0.823) | 0.782 (0.758–0.801) |

### bank-4m, allocation and GC per operation

| Quantity                                  | Bun                 | Node                  |
| ----------------------------------------- | ------------------- | --------------------- |
| tokenizer rung (MB)                       | 26.8                | 31.0                  |
| resolver layer, main → A (MB)             | 58.7 → 30.6         | 86.8 → 43.5           |
| resolver + collector, main → B (MB)       | 67.1 → 28.2         | 97.2 → 37.3           |
| typed decode, main → A → B (MB)           | 116.4 → 99.8 → 88.9 | 160.0 → 117.8 → 101.9 |
| typed decode, computis (MB)               | 51.0                | 43.5                  |
| GC pause, typed decode, main → A → B (ms) | 11.0 → 7.7 → 6.8    | 12.4 → 10.3 → 9.6     |
| GC pause, typed decode, computis (ms)     | 1.7                 | 3.8                   |

Values are medians. The GC pause intervals are wide (Node main 10.3–15.2 ms). GC pause is the main-thread cost `GCProfiler` reports, not the concurrent GC threads a CPU profile attributes to `(garbage collector)`.

### bank-16k, CPU per operation

| Quantity                                | Bun                    | Node                   |
| --------------------------------------- | ---------------------- | ---------------------- |
| C, computis typed decode (ms)           | 0.0991 (0.0971–0.1044) | 0.0969 (0.0958–0.0996) |
| T, main typed decode (ms)               | 0.3087 (0.2974–0.3288) | 0.2809 (0.2766–0.3200) |
| resolver layer, A / main                | 0.575 (0.509–0.613)    | 0.509 (0.475–0.524)    |
| resolver layer / C, main → A            | 0.845 → 0.478          | 0.801 → 0.404          |
| resolver + collector / C, main → B      | 1.102 → 0.607          | 1.054 → 0.485          |
| typed decode, A / main                  | 0.862 (0.835–0.888)    | 0.846 (0.804–0.871)    |
| typed decode, B / main                  | 0.821 (0.772–0.848)    | 0.779 (0.757–0.817)    |
| T / C, main → A → B                     | 3.094 → 2.639 → 2.527  | 2.873 → 2.478 → 2.290  |
| wall median, typed decode, B / main     | 0.832 (0.795–0.861)    | 0.798 (0.779–0.835)    |
| allocation, typed decode, main → B (MB) | 0.576 → 0.425          | 0.696 → 0.443          |

### Earlier batches

Two earlier batches against commit `240ad37` (before the precompiled builder, `7f1cff8`) agree. Batch 1, prototype A at `bank-4m`: resolver layer 0.555 (Bun) and 0.546 (Node) of main, typed decode 0.845 and 0.851. Batch 2, prototype B at `bank-4m`: typed decode 0.812 (Bun) and 0.795 (Node). Batch 2 at `bank-16k` was discarded: the shared checkout's `src/builder.ts` changed during it, and the live "main" picked up the new builder mid-run. That is why the final batch runs against a frozen copy.

### Projected effect

The measured `T / C` above is the projection: it is the whole typed decode against computis in the same rounds. Against the phase 3 layer table, prototype A removes about 0.45 C of resolver cost on both runtimes, and prototype B removes 0.74 C (Bun) and 0.62 C (Node) of resolver and collector cost together, at `bank-4m`. The gains add to the precompiled builder already on main; they do not overlap it, because the builder reads the same records.

## Correctness

Both prototypes produce output identical to main's.

- **Equivalence check** (`work/spikes/perf3b-resolver/equiv3.ts proto|proto2`, Bun and Node, against the frozen `7f1cff8` copy). For every document it compares, with `node:util` `isDeepStrictEqual`: the resolved events from plain upstream events (re-chunked as the bench chunks them) and from `decodeStringWithPositions`; the records of `collect(["*"])` from both, with their `recordPositions` trees; the fused channel against main's two channels, plain and positioned, and again with small budgets (`maxElementNodes` 40, `maxElementSize` 2000, path `["*", "*"]`) so `Limit` failures occur; and, for the banks, the typed `fromString(ItemBank)` value. Failures are compared by error class name, message, path, reason, element path and position.
- **Inputs:** `bank-16k`, `bank-4m`, `bank-4m-bad-last` (a typed failure at record 10,442), all 15 documents of the QTI corpus (`corpus-all`), and 12 hand-written namespace documents: prefixed elements and attributes, `xml:lang`, default-namespace re-binding and `xmlns=""`, `__proto__` and `constructor` attributes, a duplicate expanded attribute, a prefixed attribute beside an unprefixed one of the same local name, each reserved-prefix and reserved-URI rule, and undeclared prefixes on elements and attributes, including one under siblings so the element path has a non-zero index.
- **Result:** 213 checks per runtime per prototype, 0 differences. 56 of the 84 checks on the hand-written documents and 6 of the corpus `Limit` checks are failures, compared equal.
- **Library tests.** The library test suite, copied beside each prototype, passes against it: 1,055 of 1,056 tests run, with the `test/bench/` suites excluded (they import `bench/`). The one failure is a copy check that compares `test/differential/vocabulary/bank.ts` to `bench/vocabulary.ts`, which the copy lacks. One timing test in `positions.test.ts` failed once under load 99 and passed on three reruns; it does not run the resolver.

## Would a custom tokenizer be needed?

No, not for the resolver's share. After prototype B, the resolver and collector together allocate 28 to 37 MB per `bank-4m` decode, about the tokenizer's own 27 to 31 MB, and cost 0.57 to 0.60 C. Per start tag, what remains is the `Object.keys` array over the tokenizer's attributes, the new attributes object with Clark keys, the frame, and the record node with its children array. A tokenizer that resolved names while scanning could drop the `Object.keys` array and the attributes copy, and the upstream event objects it hands over. The record tree still has to be built. The larger lever is the tokenizer's own scanning, 0.80 C (Bun) and 0.88 C (Node), which fusion does not change. That is step-2 territory and was not built.

## Risks

- **Prototype-pollution edge.** Assignment differs from `Object.fromEntries` only for a key with a setter on `Object.prototype`. The prototype handles `__proto__`; a polluted prototype with another setter would be called. A slice can use `Object.defineProperty` for every key if that case matters, at some cost.
- **Duplicate check now conditional.** The `Object.hasOwn` check runs only after a prefixed attribute. The argument is above, and the reserved-rule and duplicate documents compare equal; a slice should keep a unit test for a prefixed attribute that collides with an earlier unprefixed key spelled as a Clark name, which only a non-validating `Tokenizer` can produce.
- **Failure paths rebuilt lazily.** The element path and written path are now built from frames on failure. The 71 `resolve.test.ts` cases and the hand-written failures compare equal, including element indexes.
- **Fused channel.** The collector's `push` becomes three methods, and `readRoot` composes one channel instead of two. Precedence between a resolver failure and a collector `Limit`, and records emitted before a failure, compare equal on the inputs above. The record channels in `channel.ts` still pipe `resolveEvents` into `collect`; switching them was not prototyped.
- **Lint.** The prototype was not linted. `parent.children++`, `"event" in input` and the long `start` function may need reshaping to pass `bun run check`; that is not expected to change the cost.
- **Downstream builder.** One in-process check timed main's builder and structural decode 3 to 9% slower on a root from prototype A than on a root from main at `bank-4m`. Rebuilding the same tree both ways (by `Object.fromEntries` and by assignment) removed the difference (0.96 to 0.97), so attribute construction is not the cause. The end-to-end A/B above includes any such effect.
- **Measurement.** The machine was loaded (load 17 to 105). `GCProfiler` on Bun is unverified. Profile self times are sampled under load and only rank costs.

## Recommendation

1. **Build prototype A as one slice.** Replace `makeMachine` and its helpers in `src/resolve.ts` with the rewrite above. Keep the public types and both channels. Port `resolve.test.ts` unchanged and add tests for the `__proto__` attribute and the conditional duplicate check. Expected: typed decode 0.84 to 0.86 of today's CPU, `T / C` at `bank-4m` from about 2.87 to about 2.4.
2. **Then fuse resolve and collect as a second slice.** Add an internal `resolveCollect` channel over the same machine and collector, use it in `codec.ts` `readRoot`, and measure the record channels in `channel.ts` before switching them. Expected: typed decode about 0.79 of today's, `T / C` about 2.24 (Bun) and 2.30 (Node) at `bank-4m`.
3. **Do not build a resolving tokenizer for this step.** Revisit it only with the step-2 tokenizer decision.

## Reproduce

From the repository root, with the spike directory in place:

```sh
bun work/spikes/perf3b-resolver/equiv3.ts proto      # or proto2; also under node
bun work/spikes/perf3b-resolver/drive3.ts bun bank-4m 12 2000 work/spikes/perf3b-resolver/results/b3-bun-bank-4m.json
python3 work/spikes/perf3b-resolver/analyze.py 3 work/spikes/perf3b-resolver/results/b3-bun-bank-4m.json
node --cpu-prof work/spikes/perf3b-resolver/prof.ts main 4000   # resolver rung profile; proto for prototype A
```

`drive3.ts` takes the runtime (`bun` or `node`), the input, the rounds, and the target milliseconds per child.
