# Spike perf3b-sp-builder: a precompiled builder

Unit `perf3b-sp-builder`. This is an R&D spike toward closing the typed decode gap to `@computis/effect-xml` (owner directive item 5). The prototype lives in `work/spikes/perf3b-sp-builder/` (gitignored); this file is the durable record. No file under `src/`, `bench/` or `test/` changed.

## Result

- **The builder runs 2.4 to 3.5 times faster.** A builder that compiles each plan once, links each slot to its child's compiled node, walks attributes with `for...in`, and checks blank text with `charCodeAt` costs 0.29 (Bun) and 0.42 (Node) of today's builder on `bank-4m`, in CPU time. It allocates a quarter of the bytes on Node. Its plain objects are identical to today's, key order included.
- **The typed decode drops about 6 to 11 percent.** Measured on the `typed/structural` path (tokenizer through structural decode), CPU falls by 11.0 ms on Bun and 7.4 ms on Node at `bank-4m`. That projects `T / C` for typed decode from 3.08 to about 2.72 on Bun and from 3.22 to about 3.04 on Node. It closes about 0.3 C on Bun and 0.2 C on Node.
- **Where the gain comes from.** `Object.entries` over the attributes is the largest single cost: replacing it with `for...in` takes the builder from 0.88 to 0.49 of today's on Bun `bank-4m`. Caching compiled nodes on their parents (no `WeakMap` read per element) and dropping the `Map` of slot groups takes it from 0.49 to 0.29. The `charCodeAt` blank check alone gives 0.88 on Bun and 0.91 on Node.
- **Do not fuse the builder into the collector.** After the rewrite the builder's whole walk is about 4.5 ms (Bun) and 9 ms (Node) per `bank-4m` decode, about 0.15 C and 0.22 C. Much of it is allocating the output objects, which a fused builder would still do. The collector must keep the `ResolvedElement` tree for the fallback decode and for positions, so fusion would save only the walk, at the cost of plan-specific code inside the shared record collector.
- **Structural decode has no builder-side lever.** Its cost is inside Effect Schema's struct and array parsers and the Exit machinery. The builder can only hand it the same objects, which the parsers copy.

Recommendation: implement the precompiled builder and the `charCodeAt` `isBlank` as one slice. Details are in [Recommendation](#recommendation).

## Where the time goes today

Bucketed CPU profiles of `effect-xml/typed-decode` on `bank-4m`, JIT off, from the phase 3 layer profile (`docs/rd/performance/phase-3-ab/profile-cpu-*-jit-off-bank-4m.json`, commit `ee496cc`):

| Function (self time)                   | Bun 1.4.2 | Node 26.13.0 | Where                                                             |
| -------------------------------------- | --------- | ------------ | ----------------------------------------------------------------- |
| `codePointAt` called by `isBlank`      | 538 ms    | inlined      | `compile.ts` `isBlank`, once per text child of `elements` content |
| `isBlank`                              | (small)   | 486 ms       | the same                                                          |
| `Object.entries` called by the builder | 465 ms    | inlined      | `builder.ts` `buildElement`, once per element                     |
| `buildElement`                         | 323 ms    | 1,071 ms     | attribute loop, `rulesOf`, dispatch                               |
| `writeElements`                        | 285 ms    | 348 ms       | `Map` of groups, an array per group                               |
| profile total                          | 9,064 ms  | 20,640 ms    | (garbage collector on Node: 7,200 ms)                             |

On Bun the builder and the `isBlank` it calls take about 1.6 s of 9.1 s, about 18 percent of the case. On Node the builder's self time is about 1.9 s, and it is a large share of the allocation behind the 7.2 s of GC.

A Node CPU profile of the builder alone (`case.ts <variant> build bank-4m`, 160 builds of a fixed root, `--cpu-prof`) splits the builder's own cost:

| Today's builder     | self ms | Prototype           | self ms |
| ------------------- | ------- | ------------------- | ------- |
| `buildElement`      | 2,830   | `buildNode`         | 1,181   |
| (garbage collector) | 2,628   | (garbage collector) | 1,284   |
| `writeElements`     | 1,068   | `isBlankFast`       | 273     |
| `isBlank`           | 1,004   | `childValue`        | 153     |
| `rulesOf`           | 149     |                     |         |
| `childValue`        | 126     |                     |         |
| sum of the above    | 7,805   | sum of the above    | 2,891   |

The bank's text children are mostly indentation between elements, so `isBlank` runs on nearly every other child. `Object.entries` allocates an array of pairs per element; `rulesOf` reads a `WeakMap` per element; `writeElements` allocates a `Map` and a one-element array per present slot even for `one` and `optional` slots.

## What the prototype changes

`work/spikes/perf3b-sp-builder/builder-fast.ts`, `buildFast(plan, element)`, has the same signature, contract and refusals as `src/builder.ts` `build`. It reads its rules from the same sources (`attributeKeysOf`, `slotsOf`, `isData`, `GENERIC`, `ITEM_VALUE`, `structuralPlan`).

1. **One compiled node per plan.** A `WeakMap<Plan, Node>` still caches nodes, but each slot and mixed member holds a link that caches its child's node after the first use. The per-element `WeakMap` read becomes a field read. Links resolve lazily, so `suspend` recursion terminates. The node carries the content mode as a small integer, the open flag, the text or items key, the slot keys and `many` flags as arrays, and the slot index of each Clark name.
2. **`for...in` over the attributes** instead of `Object.entries`. Same order: both visit own string keys in property order.
3. **Slot values in an index-addressed array** instead of a `Map` of groups. A `one` or `optional` slot stores its value directly; only a `many` slot allocates its array. A second child of a `one` or `optional` slot still refuses before its own build runs, as today.
4. **The `undeclared` array only for open content.**
5. **`isBlankFast`**: the same loop as `isBlank` with `charCodeAt` in place of `codePointAt`. The result is identical: a surrogate is at least `0x80`, so both defer to `trim` on the same strings.
6. `typeof child === "string"` in place of `Predicate.isString`, and indexed loops.

Ablations measured the steps separately: `blank` is today's builder with only change 5; `blank-forin` adds change 2; `proto` is all changes. `proto-lint` is `proto` written to pass the repository's lint rules (see [Risks](#risks)).

## Measurements

### Method

- **Driver.** `work/spikes/perf3b-sp-builder/ab.ts`, one per runtime, both running at the same time beside other seats' work. Every round runs every cell for every variant, each in its own child process of the same runtime; the variant order reverses every other round. JIT off (shipped): nothing preloads the Schema JIT.
- **Cells.** Two rungs on `bank-4m` and `bank-16k`:
  - `build`: the builder alone, over a root collected once outside the timed loop. 5 operations per sample at `bank-4m`, 400 at `bank-16k`.
  - `typed`: tokenizer, resolver, collector, builder, and one `Schema.decodeUnknownEffect` of `checkedStructuralOf(ItemBank)`. This is the `typed/structural` rung of `bench/profile/layers.ts`: a whole typed decode minus the `decodeString` glue and the `fromString` wrapper. 2 operations per sample at `bank-4m`, 100 at `bank-16k`.
- **Samples.** Per child: 3 warm-up samples, then 7 samples through `bench/harness/metrics.ts` `measureResources`. Per-operation CPU (user plus system, from `process.resourceUsage`), wall, allocated bytes and GC count and pause (`node:v8` `GCProfiler`) are each the median of the 7 samples.
- **Statistics.** A variant's ratio is its value over `current`'s in the same round. The table gives the median over rounds with the distribution-free (sign-test) interval: ranks 3 to 10 of 12 rounds (96 percent coverage), ranks 2 to 9 of 10 rounds (98 percent). No round was repeated.
- **Load.** 1-minute load average 31 to 80 in run 1 and 34 to 90 in run 2 (recorded per child).
- **Runtimes.** Bun 1.4.2 and Node 26.13.0, `effect` as pinned. Commit `240ad37` sources.

### CPU ratio to today's builder (primary)

Run 1, 12 rounds, variants `current`, `blank`, `blank-forin`, `proto`:

| Runtime | Input      | Rung    | `blank`             | `blank-forin`       | `proto`             |
| ------- | ---------- | ------- | ------------------- | ------------------- | ------------------- |
| bun     | `bank-4m`  | `build` | 0.880 (0.828–0.901) | 0.487 (0.476–0.498) | 0.285 (0.260–0.301) |
| bun     | `bank-4m`  | `typed` | 0.985 (0.972–1.030) | 0.932 (0.882–0.973) | 0.893 (0.849–0.942) |
| bun     | `bank-16k` | `build` | 0.903 (0.878–0.942) | 0.520 (0.473–0.536) | 0.365 (0.334–0.384) |
| bun     | `bank-16k` | `typed` | 0.952 (0.875–1.009) | 0.864 (0.820–0.934) | 0.895 (0.804–0.965) |
| node    | `bank-4m`  | `build` | 0.905 (0.866–0.964) | 0.554 (0.532–0.599) | 0.417 (0.352–0.460) |
| node    | `bank-4m`  | `typed` | 0.980 (0.960–1.000) | 0.948 (0.914–0.988) | 0.938 (0.913–0.954) |
| node    | `bank-16k` | `build` | 0.825 (0.801–0.844) | 0.494 (0.465–0.501) | 0.348 (0.338–0.352) |
| node    | `bank-16k` | `typed` | 1.009 (0.971–1.067) | 0.945 (0.916–0.997) | 0.919 (0.889–0.924) |

### Wall ratio (secondary)

| Runtime | Input      | Rung    | `blank`             | `blank-forin`       | `proto`             |
| ------- | ---------- | ------- | ------------------- | ------------------- | ------------------- |
| bun     | `bank-4m`  | `build` | 0.905 (0.883–0.952) | 0.527 (0.431–0.555) | 0.324 (0.207–0.352) |
| bun     | `bank-4m`  | `typed` | 0.979 (0.949–1.046) | 0.881 (0.744–0.981) | 0.764 (0.590–0.902) |
| bun     | `bank-16k` | `build` | 0.882 (0.825–0.965) | 0.530 (0.438–0.588) | 0.268 (0.236–0.358) |
| bun     | `bank-16k` | `typed` | 0.969 (0.900–1.119) | 0.864 (0.833–0.985) | 0.881 (0.834–0.992) |
| node    | `bank-4m`  | `build` | 0.930 (0.743–1.040) | 0.562 (0.522–0.628) | 0.397 (0.307–0.450) |
| node    | `bank-4m`  | `typed` | 1.011 (0.945–1.106) | 1.039 (0.966–1.085) | 0.962 (0.867–1.050) |
| node    | `bank-16k` | `build` | 0.818 (0.774–0.904) | 0.486 (0.359–0.539) | 0.347 (0.244–0.371) |
| node    | `bank-16k` | `typed` | 0.932 (0.925–1.119) | 0.874 (0.780–1.015) | 0.860 (0.756–0.935) |

### Per operation: CPU, allocation and GC

Medians over the 12 rounds of run 1. Allocation is `node:v8` heap statistics around the timed loop; on Bun the harness marks it unverified, and the `proto` `build` cell read 0 bytes because no GC ran inside the sample, so only Node's allocation column is trustworthy.

| Runtime | Input     | Rung    | Variant   | CPU ms | Wall ms | Alloc MB | GC count | GC pause ms |
| ------- | --------- | ------- | --------- | ------ | ------- | -------- | -------- | ----------- |
| bun     | `bank-4m` | `build` | `current` | 16.17  | 15.56   | 26.3     | 0.4      | 1.96        |
| bun     | `bank-4m` | `build` | `proto`   | 4.54   | 4.85    | (0)      | 0        | 0           |
| bun     | `bank-4m` | `typed` | `current` | 103.1  | 148.5   | 145.9    | 1        | 17.8        |
| bun     | `bank-4m` | `typed` | `proto`   | 92.57  | 83.97   | 132.6    | 1        | 12.7        |
| node    | `bank-4m` | `build` | `current` | 21.93  | 25.60   | 25.1     | 1        | 5.71        |
| node    | `bank-4m` | `build` | `proto`   | 9.22   | 10.83   | 6.4      | 0.2      | 1.67        |
| node    | `bank-4m` | `typed` | `current` | 122.8  | 124.7   | 167.1    | 5        | 27.4        |
| node    | `bank-4m` | `typed` | `proto`   | 113.2  | 167.0   | 148.4    | 4.5      | 52.3        |

On Node the prototype cuts the builder's allocation from 25.1 MB to 6.4 MB per `bank-4m` decode (minus 75 percent) and the whole typed path's from 167 MB to 148 MB (minus 11 percent), with half a GC fewer per operation. The `typed` GC pause medians are dominated by when a major collection lands in a sample and are not a stable comparison; the CPU ratios above include GC work.

### Projected T / C

`T` and `C` are the typed-decode CPU totals of the phase 3 layer profile (JIT off, 7 rounds). The projection subtracts the per-round CPU delta of the `typed` rung (`current` minus `proto`) from `T`:

| Runtime | Input      | Delta CPU ms (95%)     | T     | C      | T / C now | T / C projected (95%) |
| ------- | ---------- | ---------------------- | ----- | ------ | --------- | --------------------- |
| bun     | `bank-4m`  | 10.96 (5.71–15.66)     | 94.42 | 30.65  | 3.08      | 2.72 (2.57–2.89)      |
| bun     | `bank-16k` | 0.0363 (0.0115–0.0655) | 0.276 | 0.0974 | 2.83      | 2.46 (2.16–2.72)      |
| node    | `bank-4m`  | 7.42 (5.65–11.54)      | 133.2 | 41.43  | 3.22      | 3.04 (2.94–3.08)      |
| node    | `bank-16k` | 0.0258 (0.0245–0.0432) | 0.355 | 0.0982 | 3.62      | 3.35 (3.18–3.37)      |

"T / C now" is `T` over `C` from the profile's medians; the profile's own per-round median ratios (3.115, 3.246, 2.763, 3.618) differ slightly. The `typed` delta on Bun (11 ms) matches the `build` delta (11.6 ms), as it should. On Node the `typed` delta (7.4 ms) is below the `build` delta (12.7 ms): less allocation in the builder moves some collection work around rather than removing it all from a whole decode.

### Run 2: the lint-conformant prototype

Run 2, 10 rounds, variants `current`, `proto`, `proto-lint`, same cells, 1-minute load 34 to 90. It repeats run 1's `proto` result and shows that the lint-conformant form keeps it. CPU ratio to `current`:

| Runtime | Input      | Rung    | `proto`             | `proto-lint`        |
| ------- | ---------- | ------- | ------------------- | ------------------- |
| bun     | `bank-4m`  | `build` | 0.282 (0.258–0.321) | 0.287 (0.256–0.292) |
| bun     | `bank-4m`  | `typed` | 0.885 (0.824–1.023) | 0.892 (0.773–0.926) |
| bun     | `bank-16k` | `build` | 0.371 (0.358–0.381) | 0.364 (0.340–0.382) |
| bun     | `bank-16k` | `typed` | 0.809 (0.779–0.881) | 0.880 (0.822–0.970) |
| node    | `bank-4m`  | `build` | 0.411 (0.323–0.421) | 0.450 (0.434–0.464) |
| node    | `bank-4m`  | `typed` | 0.943 (0.926–0.966) | 0.929 (0.908–0.961) |
| node    | `bank-16k` | `build` | 0.351 (0.334–0.372) | 0.400 (0.384–0.409) |
| node    | `bank-16k` | `typed` | 0.899 (0.877–0.936) | 0.889 (0.869–0.918) |

The `Object.hasOwn` guard costs Node about 4 points of the builder alone and nothing measurable on the whole path. Projected `T / C` from run 2's `typed` deltas, `proto-lint`: Bun `bank-4m` 2.74 (2.25–3.04), Node `bank-4m` 3.02 (2.94–3.37), Bun `bank-16k` 2.42, Node `bank-16k` 3.28. Run 2's `typed` intervals at `bank-4m` are wider than run 1's (load reached 90), and both runs agree on the medians.

## Correctness

`work/spikes/perf3b-sp-builder/equiv.ts` runs today's `build` and the candidate on the same collected root and compares: deep equality (`node:util` `isDeepStrictEqual`), the same own-key order at every level, the same refusal, and the same structural decode result (deep-equal values, or the same failure cause). Run on Bun and Node for `proto`, and on Bun for `blank`, `blank-forin` and `proto-lint`:

| Input                                                                                                                                                                                                              | Vocabulary                                | Result                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `bank-16k`, `bank-4m`                                                                                                                                                                                              | `bench/vocabulary.ts` `ItemBank`          | equal, same key order, same decoded value                                                           |
| `bank-256k-bad-last`, `bank-4m-bad-last`                                                                                                                                                                           | `ItemBank`                                | equal plain objects, same decode failure                                                            |
| QTI corpus `corpus-items` (4 fixtures)                                                                                                                                                                             | `test/qti/vocabulary.ts` `AssessmentItem` | 4 equal                                                                                             |
| QTI corpus `corpus-all` (15 fixtures)                                                                                                                                                                              | `AssessmentItem`                          | 4 equal, 11 refused by both                                                                         |
| 1,000 mutated documents (`bank-16k` and `corpus-all`; attribute deleted or made non-numeric, stray text, non-ASCII and `U+000B` whitespace, element duplicated, renamed or added, unknown and `data-*` attributes) | both                                      | 42 equal, 42 equal with the same decode failure, 524 refused by both, 392 not well-formed; 0 differ |
| `isBlank` against `isBlankFast`: every UTF-16 code unit in four contexts, plus astral and Unicode-space strings                                                                                                    | —                                         | 0 differences                                                                                       |

The corpus covers `suspend` recursion, mixed content, open content, `data-*` attributes and repeated and optional slots.

## Risks

- **Lint.** The repository's `ultracite` preset errors on `guard-for-in`, `unicorn/prefer-code-point` and `typescript/prefer-for-of`. The prototype breaks all three. `proto-lint` (`builder-lint.ts`) adds an `Object.hasOwn` guard and uses `for...of` over children, at no measurable cost to the whole path (run 2). `charCodeAt` still needs a disable comment with its reason, because `codePointAt` is the measured cost on Bun (the `blank` ablation: 0.88 of the builder on Bun `bank-4m`).
- **Attribute objects with inherited keys.** `for...in` also visits inherited enumerable keys. The resolver builds attribute records as plain objects, so there are none today; the `Object.hasOwn` guard in `proto-lint` removes the dependency.
- **Node's whole-decode gain is smaller than its builder gain.** Allocation removed from the builder lowers GC pressure, but the typed path still allocates 148 MB per `bank-4m` decode on Node, mostly in the resolver, collector and Schema. GC remains the largest Node cost.
- **Error behavior.** Unchanged: the builder only refuses, and its refusals are the same as today's, so the fallback decode and its messages are untouched.
- **Load.** All numbers were taken with a 1-minute load average of 31 to 90. Ratios are interleaved per round; absolutes are not publishable.

## Recommendation

Implement the precompiled builder as one slice in `src/builder.ts`, with `isBlank` in `src/compile.ts` switched to `charCodeAt` (it is shared with `decodeElement`, which gains too):

1. Compile a node per plan with linked child nodes, slot values in an index-addressed array, and the content mode resolved once.
2. Walk attributes with `for...in` and an `Object.hasOwn` guard.
3. Keep `isBlank`'s contract and its `trim` fallback; use `charCodeAt`, with a disable comment that cites this file.

No public API changes, no Schema JIT import, no change to record budgets, `Limit` positions or record emission, and M5 is untouched (decode only). Do not fuse the builder into the collector. Expected gain at `bank-4m`: about 0.3 C on Bun and 0.2 C on Node for typed decode. The rest of the gap sits in the tokenizer, the resolver and Schema's struct parsing, which are other units' targets.
