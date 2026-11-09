# Performance

## Status

Phase 2 is complete. It fixes the two Node defects and the first-record delay that phase 1 found, and it keeps five of its six library-layer optimizations: `perf2-opt-wire-check` is reverted (see [Phase 2 optimizations](#phase-2-optimizations)). Two gate audits followed the phase-2 runs (see [Gate audits](#gate-audits)), and their fixes changed the shipped code, so phase 2 has two measurements:

- **The phase-2 run.** The Bun runs measure commit `75d46bd` and the Node runs measure `76aa910`. The commit between them adds only the Bun result files, so both runtimes ran the same library and harness:

  ```console
  $ git diff --name-only 75d46bd 76aa910 -- src bench
  $
  ```

- **The final re-measure** (`perf2-9`). `bench/run.ts --filter effect-xml/` ran on both runtimes at `45e6aed`, from a clean worktree. Since `76aa910`, `src/` changed in three commits: `6dc514f` reverts the wire fast path, and `f4387f0` and `ffe543c` fix the positions batch. `bench/` did not change:

  ```console
  $ git log --format=%h 76aa910..45e6aed -- src
  ffe543c
  f4387f0
  6dc514f
  $ git diff --name-only 76aa910 45e6aed -- bench
  $
  ```

Phase 3 stopped on 2026-11-08 by owner ruling, without step 2; [Phase 3: stop and final status](#phase-3-stop-and-final-status) records the stop rule and the final ratios. Phase 3 adds [Phase 3 under load (A/B)](#phase-3-under-load-ab) and [Phase 3 step-2 evaluation](#phase-3-step-2-evaluation). They compare the step-1 code with the phase-3 baseline in interleaved rounds on a loaded machine and report ratios, not throughput; the class, scaling, per-layer, and tokenizer sections below them still describe phase 2.

The effect-xml rows of the [class](#results-per-class) and [scaling](#scaling-curve) tables come from the final files. The competitor rows, `computis-effect-xml/*` included, come from the phase-2 files: the later commits change only this library, so the final re-measure keeps them. The [per-layer profile](#per-layer-profile) and the [tokenizer decision rule](#tokenizer-decision-rule) still describe the phase-2 commits.

Every number below comes from a committed result file in `docs/rd/performance/`:

| File                                                 | Driver                                     | Runtime      |
| ---------------------------------------------------- | ------------------------------------------ | ------------ |
| `phase-1-bun.json`                                   | `bench/run.ts`                             | Bun 1.4.2    |
| `phase-1-node.json`                                  | `bench/run.ts`                             | Node 26.13.0 |
| `phase-1-layers-bun.json`                            | `bench/profile/layers.ts`                  | Bun 1.4.2    |
| `phase-1-layers-node.json`                           | `bench/profile/layers.ts`                  | Node 26.13.0 |
| `phase-1-cpu-bun.json`                               | `bench/profile/cpu.ts`                     | Bun 1.4.2    |
| `phase-1-cpu-node.json`                              | `bench/profile/cpu.ts`                     | Node 26.13.0 |
| `phase-2-bun.json`                                   | `bench/run.ts`                             | Bun 1.4.2    |
| `phase-2-node.json`                                  | `bench/run.ts`                             | Node 26.13.0 |
| `phase-2-layers-bun.json`                            | `bench/profile/layers.ts`                  | Bun 1.4.2    |
| `phase-2-layers-node.json`                           | `bench/profile/layers.ts`                  | Node 26.13.0 |
| `phase-2-cpu-bun.json`, `phase-2-cpu-64m-bun.json`   | `bench/profile/cpu.ts`                     | Bun 1.4.2    |
| `phase-2-cpu-node.json`, `phase-2-cpu-64m-node.json` | `bench/profile/cpu.ts`                     | Node 26.13.0 |
| `phase-2-ab/perf2-opt-<id>-{before,after}-bun.json`  | `bench/run.ts`, one pair per optimization  | Bun 1.4.2    |
| `phase-2-ab/perf2-opt-<id>-{before,after}-node.json` | `bench/run.ts`, one pair per optimization  | Node 26.13.0 |
| `phase-2-ab/{decode,encode}-recheck-bun.json`        | alternating `bench/case-process.ts` rounds | Bun 1.4.2    |
| `phase-2-ab/{decode,encode}-recheck-node.json`       | alternating `bench/case-process.ts` rounds | Node 26.13.0 |
| `phase-2-final-bun.json`                             | `bench/run.ts --filter effect-xml/`        | Bun 1.4.2    |
| `phase-2-final-node.json`                            | `bench/run.ts --filter effect-xml/`        | Node 26.13.0 |
| `phase-2-ab/final-recheck-bun.json`                  | alternating `bench/case-process.ts` rounds | Bun 1.4.2    |
| `phase-2-ab/final-recheck-node.json`                 | alternating `bench/case-process.ts` rounds | Node 26.13.0 |
| `phase-3-ab/<runtime>-jit-<mode>-<input>.json`       | `bench/ab.ts` at `97bd29e`                 | Bun, Node    |
| `phase-3-ab/<runtime>-failure-*.json`                | `bench/ab.ts` at `df898ab`                 | Bun, Node    |
| `phase-3-ab/<runtime>-jit-on-vs-off-*.json`          | `bench/ab.ts` at `df898ab`                 | Bun, Node    |
| `phase-3-ab/node-memory-*.json`                      | `bench/ab.ts` at `df898ab`                 | Node 26.13.0 |
| `phase-3-ab/latency-jit-off.json`                    | derived from the JIT `off` files above     | Bun, Node    |

No other work of this project ran during the phase-2 runs, but other workspaces on the machine did. The `perf2-5` and `perf2-6` witness reports record the 1-minute load average:

| Run  | Start | Matrix end | Peak, during the single-run A/B | Finish |
| ---- | ----- | ---------- | ------------------------------- | ------ |
| Bun  | 3.00  | 4.60       | 17.37                           | 5.21   |
| Node | 3.52  | 5.32       | 25.64                           | 12.12  |

Both matrix runs therefore ran at a load between 3.00 and 5.32 on 14 cores. The reports give no separate load for the ladder and CPU steps. The single-run A/B files come from the loaded part of each run (see [Phase 2 optimizations](#phase-2-optimizations)).

The final re-measure waited until the 1-minute load stayed under 6 for 2 minutes. Its Bun matrix then ran from a load of 3.62 to 3.68, its Node matrix from 3.68 to 5.30, and its rechecks between 3.07 and 5.30. Other workspaces kept running: at every step boundary but the last, the busiest process was a Node process of another workspace, at 55% to 215% CPU.

## Phase 2 changes

### Phase 2 fixes

Each "before" below comes from a phase-1 file, measured on a shared machine at a load average of about 8 (Bun) and 5.9 to 11 (Node), so it likely overstates the time. Each "after" comes from a phase-2 file.

1. **`effect-xml/encode-typed` failed on `bank-64m` on Node.** `toElements` in `src/compile.ts` appended a `many` slot with `children.push(...items)`. The call spread passes every element as one argument, and V8 overflows its stack past about 150,000 arguments; `bank-64m` holds 164,234 records. `perf2-1` (`8ce6741`) appends one element at a time. `effect-xml/encode-typed` on `bank-64m`:

| Runtime      | Phase 1                                                               | Phase 2                               |
| ------------ | --------------------------------------------------------------------- | ------------------------------------- |
| Bun 1.4.2    | 2,797.947 ms, 23.99 MB/s (17 samples)                                 | 2,431.355 ms, 27.60 MB/s (21 samples) |
| Node 26.13.0 | failure: the case threw: RangeError: Maximum call stack size exceeded | 2,488.340 ms, 26.97 MB/s (19 samples) |

2. **`effect-xml/stream/positions` grew superlinearly on Node.** `decodeStringWithPositions` in `src/positions.ts` dequeued pieces with `Array.prototype.shift`, which copies the rest of a large array on V8, so one input string of many tags drained in quadratic time. `perf2-2` (`94bc3db`) reads the queue through an index and clears it once drained. `effect-xml/stream/positions` on Node 26.13.0:

| Input       | Phase 1                              | Phase 2                               |
| ----------- | ------------------------------------ | ------------------------------------- |
| `bank-16k`  | 1.177 ms, 14.05 MB/s (200 samples)   | 0.601 ms, 27.50 MB/s (200 samples)    |
| `bank-256k` | 18.892 ms, 13.89 MB/s (158 samples)  | 9.635 ms, 27.23 MB/s (200 samples)    |
| `bank-4m`   | 3,200.736 ms, 1.31 MB/s (14 samples) | 151.872 ms, 27.62 MB/s (30 samples)   |
| `bank-64m`  | 789,275.216 ms, 0.09 MB/s (1 sample) | 2,485.057 ms, 27.01 MB/s (20 samples) |

3. **With `positions` off, time to first record grew with the input.** The bench source `Stream.fromIterable(chunks)` emits the whole chunk array as one stream chunk, and the tokenizer's `decodeString` emits one output chunk per input chunk, so no record left before the whole input was tokenized. `perf2-3` (`133a1ca`) makes `records` split each input chunk into one-element chunks before the parser. First-record median of `effect-xml/stream`:

| Input       | Bun phase 1 (ms) | Bun phase 2 (ms) | Node phase 1 (ms) | Node phase 2 (ms) |
| ----------- | ---------------- | ---------------- | ----------------- | ----------------- |
| `bank-16k`  | 0.181            | 0.126            | 0.225             | 0.184             |
| `bank-256k` | 2.890            | 0.590            | 3.698             | 0.778             |
| `bank-4m`   | 45.593           | 0.710            | 59.897            | 0.862             |
| `bank-64m`  | 1,827.307        | 0.758            | 984.256           | 0.869             |

### Phase 2 optimizations

Each optimization has two measurements:

- A single-run A/B: `bench/run.ts` on `bank-4m` and `bank-64m` at the commit's parent (before) and at the commit (after), in the `phase-2-ab/perf2-opt-<id>-{before,after}-<runtime>.json` files.
- An alternating recheck on `bank-4m`: 5 rounds, each running the parent and then the commit in one `bench/case-process.ts` process per side, from clean worktrees. The value per round is the process's median wall time, and the summary is the median of the 5 round values. The rechecks are in `phase-2-ab/{decode,encode}-recheck-<runtime>.json`.

The single-run A/B files were taken under the load in the [Status](#status) table and swing in both directions. For example, the `perf2-opt-wire-check` pair puts Bun `effect-xml/typed-decode` on `bank-64m` at 2,240.609 ms before and 3,924.438 ms after, while the recheck measures 17.9% faster on `bank-4m`. Per-optimization attribution therefore uses the rechecks. The rechecks also ran beside other workspaces, at a 1-minute load of 5.86 to 37.43 (decode, Bun), 5.98 to 18.13 (decode, Node), 3.39 to 6.1 (encode, Bun), and 12.12 to 45.42 (encode, Node). Alternating the sides spreads that load over both of them.

The recheck medians, before to after:

| Optimization               | Before, after        | Case (`bank-4m`)              | Bun 1.4.2 (ms)              | Node 26.13.0 (ms)           |
| -------------------------- | -------------------- | ----------------------------- | --------------------------- | --------------------------- |
| `perf2-opt-eager-decode`   | `a3f8280`, `fd314ba` | `effect-xml/typed-decode`     | 179.400 to 144.868 (-19.2%) | 179.196 to 140.262 (-21.7%) |
| `perf2-opt-eager-decode`   | `a3f8280`, `fd314ba` | `effect-xml/stream`           | 151.871 to 164.107 (+8.1%)  | 176.930 to 132.591 (-25.1%) |
| `perf2-opt-resolver-start` | `24044c8`, `0dc703f` | `effect-xml/tree`             | 46.197 to 32.037 (-30.7%)   | 57.780 to 48.298 (-16.4%)   |
| `perf2-opt-resolver-start` | `24044c8`, `0dc703f` | `effect-xml/stream`           | 123.367 to 107.778 (-12.6%) | 136.791 to 122.966 (-10.1%) |
| `perf2-opt-resolver-start` | `24044c8`, `0dc703f` | `effect-xml/encode-typed`     | 162.193 to 163.271 (+0.7%)  | 291.550 to 235.053 (-19.4%) |
| `perf2-opt-compile-alloc`  | `0dc703f`, `28fe69f` | `effect-xml/typed-decode`     | 146.507 to 130.098 (-11.2%) | 128.612 to 128.060 (-0.4%)  |
| `perf2-opt-compile-alloc`  | `0dc703f`, `28fe69f` | `effect-xml/stream`           | 113.858 to 108.650 (-4.6%)  | 121.650 to 116.545 (-4.2%)  |
| `perf2-opt-positions-pull` | `28fe69f`, `b1210ce` | `effect-xml/stream/positions` | 190.545 to 162.732 (-14.6%) | 235.999 to 181.078 (-23.3%) |
| `perf2-opt-positions-scan` | `b1210ce`, `3b809e9` | `effect-xml/stream/positions` | -                           | 181.257 to 179.244 (-1.1%)  |
| `perf2-opt-wire-check`     | `1b0b2f7`, `7c88ef5` | `effect-xml/typed-decode`     | 122.851 to 100.883 (-17.9%) | 125.139 to 107.769 (-13.9%) |
| `perf2-opt-wire-check`     | `1b0b2f7`, `7c88ef5` | `effect-xml/stream`           | 102.727 to 86.375 (-15.9%)  | 114.160 to 99.761 (-12.6%)  |
| `perf2-opt-wire-check`     | `1b0b2f7`, `7c88ef5` | `effect-xml/encode-tree`      | 63.638 to 63.210 (-0.7%)    | 94.514 to 65.736 (-30.4%)   |
| `perf2-opt-wire-check`     | `1b0b2f7`, `7c88ef5` | `effect-xml/encode-typed`     | 159.718 to 140.258 (-12.2%) | 161.524 to 142.551 (-11.7%) |

The phase's gain rule (R-gain, gap G4 in `docs/goals/performance/phase-2.slices.md`) reports a gain under 5% on both runtimes as no gain. `perf2-opt-eager-decode`, `perf2-opt-resolver-start`, `perf2-opt-compile-alloc`, `perf2-opt-positions-pull`, and `perf2-opt-wire-check` each gain at least 5% on one runtime in the rechecks. `perf2-opt-positions-scan` does not: it measures +1.1% on Bun (the single-run A/B on `bank-4m`, 160.359 ms to 162.074 ms; the Bun encode recheck does not include it) and -1.1% on Node (the encode recheck). The Mind's G4 verdict keeps all six optimizations. The first gate audit then found that `perf2-opt-wire-check` changes the Schema derivations of every element codec, and `6dc514f` reverts it, so five optimizations ship.

The final recheck (`perf2-9`, `phase-2-ab/final-recheck-<runtime>.json`) uses the same method to compare the shipped code, `45e6aed`, with three earlier commits. Its rechecks ran at a 1-minute load of 3.68 to 5.30 (Bun) and 3.07 to 3.90 (Node):

| Question                                                          | Before    | Case (`bank-4m`)              | Bun 1.4.2 (ms)              | Node 26.13.0 (ms)           |
| ----------------------------------------------------------------- | --------- | ----------------------------- | --------------------------- | --------------------------- |
| Net effect of `perf2-opt-positions-pull` with both fixes          | `28fe69f` | `effect-xml/stream/positions` | 181.725 to 150.101 (-17.4%) | 235.850 to 175.671 (-25.5%) |
| The wire revert returns to the code before `perf2-opt-wire-check` | `1b0b2f7` | `effect-xml/typed-decode`     | 121.503 to 120.189 (-1.1%)  | 124.839 to 124.080 (-0.6%)  |
| The wire revert returns to the code before `perf2-opt-wire-check` | `1b0b2f7` | `effect-xml/stream`           | 99.822 to 98.703 (-1.1%)    | 116.629 to 117.622 (+0.9%)  |
| Cost of `ffe543c`                                                 | `f4387f0` | `effect-xml/stream/positions` | 145.398 to 145.765 (+0.3%)  | 174.888 to 176.019 (+0.6%)  |

The wire rows sit within 1.1% of the parent of `7c88ef5`, so the revert gives back that commit's gain and nothing more. The `ffe543c` row is under 1% on both runtimes.

Each entry below gives the change, its single-run A/B medians and throughput, and its trade-offs. A cell reads median, then throughput.

#### `perf2-opt-eager-decode` (`fd314ba`)

The element decoders `fromEmpty`, `fromText`, `fromElements`, and `fromElement` are built with `Effect.fnUntracedEager` instead of `Effect.fnUntraced`. The lazy decoders returned a suspended effect, so Schema's Struct and Array parsers left their synchronous `Exit` path at every element. Trade-off: in the recheck, `effect-xml/stream` is 8.1% slower on Bun and 25.1% faster on Node.

| Case                      | Input      | Bun before              | Bun after               | Node before             | Node after              |
| ------------------------- | ---------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| `effect-xml/typed-decode` | `bank-4m`  | 181.588 ms, 23.10 MB/s  | 147.299 ms, 28.48 MB/s  | 183.007 ms, 22.92 MB/s  | 138.674 ms, 30.25 MB/s  |
| `effect-xml/typed-decode` | `bank-64m` | 5530.992 ms, 12.13 MB/s | 2608.191 ms, 25.73 MB/s | 3171.474 ms, 21.16 MB/s | 2511.636 ms, 26.72 MB/s |
| `effect-xml/stream`       | `bank-4m`  | 154.446 ms, 27.16 MB/s  | 123.422 ms, 33.98 MB/s  | 176.174 ms, 23.81 MB/s  | 135.778 ms, 30.89 MB/s  |
| `effect-xml/stream`       | `bank-64m` | 2406.609 ms, 27.89 MB/s | 1896.494 ms, 35.39 MB/s | 2877.944 ms, 23.32 MB/s | 2152.661 ms, 31.17 MB/s |

#### `perf2-opt-resolver-start` (`0dc703f`)

The resolver measures a start tag in the same pass that splits out its namespace declarations, builds the element path only when it records a failure, copies the declared bindings only when the tag declares one, and creates the expanded-name map only for two or more plain attributes.

| Case                      | Input      | Bun before              | Bun after               | Node before             | Node after              |
| ------------------------- | ---------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| `effect-xml/tree`         | `bank-4m`  | 44.632 ms, 93.98 MB/s   | 31.623 ms, 132.64 MB/s  | 56.902 ms, 73.71 MB/s   | 112.525 ms, 37.28 MB/s  |
| `effect-xml/tree`         | `bank-64m` | 886.275 ms, 75.72 MB/s  | 638.293 ms, 105.14 MB/s | 1129.084 ms, 59.44 MB/s | 950.690 ms, 70.59 MB/s  |
| `effect-xml/stream`       | `bank-4m`  | 125.337 ms, 33.47 MB/s  | 112.696 ms, 37.22 MB/s  | 126.215 ms, 33.23 MB/s  | 123.330 ms, 34.01 MB/s  |
| `effect-xml/stream`       | `bank-64m` | 1842.319 ms, 36.43 MB/s | 1670.950 ms, 40.16 MB/s | 2036.260 ms, 32.96 MB/s | 1857.732 ms, 36.12 MB/s |
| `effect-xml/encode-typed` | `bank-4m`  | 158.498 ms, 26.46 MB/s  | 279.599 ms, 15.00 MB/s  | 159.729 ms, 26.26 MB/s  | 162.581 ms, 25.80 MB/s  |
| `effect-xml/encode-typed` | `bank-64m` | 2731.941 ms, 24.56 MB/s | 2756.473 ms, 24.35 MB/s | 2774.518 ms, 24.19 MB/s | 2836.128 ms, 23.66 MB/s |

#### `perf2-opt-compile-alloc` (`28fe69f`)

`decodeElement` builds the declared-attribute map and the elements slot map once per plan instead of once per element, merges content fields into the attribute record in place, and settles `isBlank` on ASCII text without `trim`. Trade-off: the gain is on Bun (`effect-xml/typed-decode` 11.2% faster in the recheck). On Node it is flat: 0.4% on `effect-xml/typed-decode` and 4.2% on `effect-xml/stream`.

| Case                      | Input      | Bun before              | Bun after               | Node before             | Node after              |
| ------------------------- | ---------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| `effect-xml/typed-decode` | `bank-4m`  | 132.718 ms, 31.60 MB/s  | 120.320 ms, 34.86 MB/s  | 127.909 ms, 32.79 MB/s  | 126.731 ms, 33.10 MB/s  |
| `effect-xml/typed-decode` | `bank-64m` | 2400.848 ms, 27.95 MB/s | 2212.754 ms, 30.33 MB/s | 2227.511 ms, 30.13 MB/s | 2255.992 ms, 29.75 MB/s |
| `effect-xml/stream`       | `bank-4m`  | 110.813 ms, 37.85 MB/s  | 105.067 ms, 39.92 MB/s  | 245.548 ms, 17.08 MB/s  | 254.735 ms, 16.47 MB/s  |
| `effect-xml/stream`       | `bank-64m` | 1690.759 ms, 39.69 MB/s | 1533.041 ms, 43.78 MB/s | 2030.141 ms, 33.06 MB/s | 1980.191 ms, 33.89 MB/s |

#### `perf2-opt-positions-pull` (`b1210ce`)

Positioned decoding gathers the tagged events of one input string's pieces into one output chunk, so `resolveEvents` and `collect` pull once per input string instead of once per piece. The tokenizer still takes one piece per pull, so every event keeps its position.

As committed, a trailing piece with no events held the batch until the next pull, and one long string held every event until it was read whole. The first gate audit failed on this (see [Gate audits](#gate-audits)). Two fixes followed:

- `f4387f0` releases a batch once 64 pieces have been fed, or once no queued piece of the current string opens a start or end tag, the last point at which the tokenizer is sure to stop before it pulls upstream.
- `ffe543c` skips comments and processing instructions inside a DOCTYPE internal subset, as the upstream scanner does, and queues the construct after the last `<` of a string once that string completes it.

Net of both fixes, the final recheck measures `effect-xml/stream/positions` on `bank-4m` 17.4% faster on Bun and 25.5% faster on Node than the parent of `b1210ce`. The table below is the single-run A/B of `b1210ce` alone.

| Case                          | Input      | Bun before              | Bun after               | Node before             | Node after              |
| ----------------------------- | ---------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| `effect-xml/stream/positions` | `bank-4m`  | 181.354 ms, 23.13 MB/s  | 167.765 ms, 25.00 MB/s  | 242.236 ms, 17.32 MB/s  | 400.664 ms, 10.47 MB/s  |
| `effect-xml/stream/positions` | `bank-64m` | 2820.607 ms, 23.79 MB/s | 2647.653 ms, 25.35 MB/s | 3994.608 ms, 16.80 MB/s | 2936.752 ms, 22.85 MB/s |

#### `perf2-opt-positions-scan` (`3b809e9`)

`advance` in `src/positions.ts` locates CR and LF with `indexOf` and sets the column from the UTF-16 code-unit distance past the last line end, instead of reading every character with `codeAt`. The gain is under 5% on both runtimes. The Mind keeps it by ruling: it is not slower, it removes `codeAt` from the profile, and its commit adds a stronger chunking property test (long text runs that mix CR, LF, CRLF, and surrogate pairs and end in a lone CR).

| Case                          | Input      | Bun before              | Bun after               | Node before             | Node after              |
| ----------------------------- | ---------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| `effect-xml/stream/positions` | `bank-4m`  | 160.359 ms, 26.16 MB/s  | 162.074 ms, 25.88 MB/s  | 178.076 ms, 23.55 MB/s  | 169.138 ms, 24.80 MB/s  |
| `effect-xml/stream/positions` | `bank-64m` | 2594.639 ms, 25.86 MB/s | 2592.705 ms, 25.88 MB/s | 2900.872 ms, 23.13 MB/s | 3131.391 ms, 21.43 MB/s |

#### `perf2-opt-wire-check` (`7c88ef5`), reverted by `6dc514f`

Reverted. The first gate audit found that the Declarations change what Schema derives from an element codec: `toJsonSchemaDocument` and `toStandardJSONSchemaV1` give `{}` for `attributes` and `children`, and `toFormatter` output changes. `toRepresentation` lowers every Declaration to a Declaration node whatever its annotations, so no annotation restores the derivations. `6dc514f` restores the Record and Array wire Struct, and `test/wire-fast-path.test.ts` now pins each direct codec's derivations. The final recheck confirms the shipped code runs at the speed of the parent of `7c88ef5`. The rest of this entry describes the reverted commit.

Each element codec's encoded-side Struct parsed `attributes` with Schema's Record index-signature parser and every child through a Union candidate search, although `collect` built that element. This commit changes the encoded-side AST: the `attributes` and `children` fields become Declarations. Each accepts a record of strings, or an array of strings and resolved elements, with one loop, and runs the general Record or Array parser for every other value, so a failure keeps its issue tree, path, and message. `test/wire-fast-path.test.ts` pins the parent's behavior.

| Case                      | Input      | Bun before              | Bun after               | Node before             | Node after              |
| ------------------------- | ---------- | ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| `effect-xml/typed-decode` | `bank-4m`  | 125.964 ms, 33.30 MB/s  | 105.139 ms, 39.89 MB/s  | 255.340 ms, 16.43 MB/s  | 109.581 ms, 38.28 MB/s  |
| `effect-xml/typed-decode` | `bank-64m` | 2240.609 ms, 29.95 MB/s | 3924.438 ms, 17.10 MB/s | 2227.354 ms, 30.13 MB/s | 1858.183 ms, 36.12 MB/s |
| `effect-xml/stream`       | `bank-4m`  | 101.892 ms, 41.17 MB/s  | 88.973 ms, 47.14 MB/s   | 123.593 ms, 33.94 MB/s  | 213.123 ms, 19.68 MB/s  |
| `effect-xml/stream`       | `bank-64m` | 1587.142 ms, 42.28 MB/s | 1324.204 ms, 50.68 MB/s | 1865.599 ms, 35.97 MB/s | 1587.953 ms, 42.26 MB/s |
| `effect-xml/encode-tree`  | `bank-4m`  | 63.765 ms, 65.78 MB/s   | 92.437 ms, 45.38 MB/s   | 61.611 ms, 68.08 MB/s   | 60.197 ms, 69.68 MB/s   |
| `effect-xml/encode-tree`  | `bank-64m` | 1049.972 ms, 63.92 MB/s | 1545.516 ms, 43.42 MB/s | 1673.658 ms, 40.10 MB/s | 1022.128 ms, 65.66 MB/s |
| `effect-xml/encode-typed` | `bank-4m`  | 161.489 ms, 25.97 MB/s  | 243.389 ms, 17.23 MB/s  | 165.414 ms, 25.36 MB/s  | 145.068 ms, 28.91 MB/s  |
| `effect-xml/encode-typed` | `bank-64m` | 2802.088 ms, 23.95 MB/s | 2525.213 ms, 26.58 MB/s | 2713.988 ms, 24.73 MB/s | 2623.780 ms, 25.58 MB/s |

### Probes without a library change

- **Node GC share at `bank-64m`** (`perf2-gc-probe`, `1b0b2f7`, in `docs/goals/performance/phase-2.inventory.md`). Bucket: `runtime`, with no cause in `src/`. The heap stays flat across a `bank-64m` run, and a run costs about 227 scavenges and no Mark-Compact whether or not the input text stays live. The scavenge pause rises about tenfold in windows of one process with no change in the live heap or the collection count. A main thread that waits on scavenger helper threads on a loaded machine would show this; the load average reached 77 on 14 cores during the probe, but the probe does not prove the cause.
- **Node GC share per 5 s bin in the phase-2 run** (`perf2-6`). On `bank-64m`: `effect-xml/typed-decode` 14.9% (bins 12.9% to 17.6%), `effect-xml/tree` 15.6% (14.3% to 17.5%), `effect-xml/stream` 6.8% (5.9% to 8.4%), `effect-xml/stream/positions` 8.6% (7.3% to 10.9%), and `effect-xml/events` 13.3% (12.8% to 14.1%). On `bank-4m` the shares are 6.0% to 11.9%. No bin holds a concentrated window.
- **Heap statistics in profiled processes** (`24044c8`, a harness fix). A case process started with `--cpu-prof` skips both `v8.getHeapStatistics()` reads around the timed loop, because on Bun each read walks the heap and took 18.2% of the `bank-64m` `effect-xml/typed-decode` profile. A process without `--cpu-prof` prints the same fields and sources as before, so the A/B pairs on either side of the commit measure the same harness.

### Gate audits

Two read-only audits checked the phase-2 library changes against public behaviour, the tests, and the public surface:

- **`fcdf6fa5`, at `8a6dc7f`: fail.** Three findings:
  - P1, from `b1210ce`: with `positions: true`, a stream held a complete record until the next input string arrived. It happened when the string's last piece was a comment, CDATA section, PI, or DOCTYPE internal subset holding `<`.
  - P2, from `7c88ef5`: the wire fast path changed the Schema derivations of element codecs.
  - P3, from `b1210ce`: one long positioned string buffered every event before the first left. For one 200,000-record string, the time to first record grew from 4.7 ms to 165.7 ms.

  `f4387f0` fixes P1 and P3, and `6dc514f` reverts the wire fast path for P2.

- **`92933bf6`, at `f4387f0`: pass with findings.** P1, P2, and P3 are closed. One residual remained in the P1 class: a `[` or a quote inside a comment or PI of a DOCTYPE internal subset left the position classifier inside the DOCTYPE, and a later record could again wait on upstream. The audit also observed that a string ending in a record followed by text with no `<`, such as a trailing newline, held that record. `ffe543c` fixes both, and `src/channel.test.ts` tests each reproduction.

Known limit (the second audit's O2): time to the first positioned record still grows with the length of one input string. At `f4387f0` the audit traced it to the channel scanning the whole string for `<`, and classifying every piece, before it feeds the first piece. On one 12.7 MB string, the first positioned record took 17 to 25 ms at `f4387f0`, against 11 to 14 ms at `a56b886`, before the phase-2 library changes (Bun, 3 runs each). The bench feeds strings of 65,536 bytes, so its first-record column does not show this limit.

## Phase 3 under load (A/B)

This section compares the phase-3 step-1 code (NEW) with the phase-3 baseline (OLD) and with `@computis/effect-xml`, on CPU time per operation. Every value is a median of per-round ratios. Pairing the two sides within a round reduces the effect of the load the machine carried but does not remove it: on unchanged code, the `tree` and `events` control intervals at `bank-4m` span 0.949 to 1.064. The absolute times in the files were taken on a loaded machine and are not throughput figures: this section gives no MB/s, and an idle-machine run for publishable absolutes is a later, separate task.

### Sides, driver, and machine

- **NEW**: commit `97bd29e`, run from the detached worktree `.worktrees/perf3-ab-new-97bd29e`. Its `src/` is the step-1 code at `390bdca`; the commit only adds the driver:

  ```console
  $ git diff --stat 390bdca 97bd29e
   bench/ab.ts | 1156 +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
   1 file changed, 1156 insertions(+)
  ```

- **OLD**: commit `bd60a0e`, the baseline worktree `.worktrees/perf3-baseline-bd60a0eb4e2e094832a3baa61526a308de319ba2`. Against `a7a93d5`, its `src/` changes one JSDoc comment in `src/positions.ts` and adds `src/channel.test.ts` rows, so it runs `a7a93d5`'s code. `bench/` is the same in both trees (`git diff --stat bd60a0e 390bdca -- bench` prints nothing).
- **Competitors**: `computis-effect-xml/typed-decode` and `computis-effect-xml/encode-typed`, run from the NEW tree. They do not depend on this library, so one run per round serves both comparisons.
- **Driver**: `bench/ab.ts` (`97bd29e`, committed separately). Each round runs every unit once, each in a child process of its own on the driver's runtime. The order reverses every round: NEW, OLD, ... on even rounds, and the reverse on odd rounds. A child loads the case or rung from its own tree, so each side measures its own `src/`. It runs the case's check once, warms up under the policy, and then meters `process.resourceUsage()` over the sampling phase only.
- **Why not `bench/case-process.ts`**: that process meters warmup and sampling together and does not report the warmup count, so its CPU fields cannot be divided per operation. The driver keeps its case, input, tokenizer, sampler, JIT preload, and resource meter, and changes only where the meter starts and stops.
- **Machine and versions**: Apple M4 Pro, 14 cores, 48 GiB, Darwin 27.2.0, arm64; Bun 1.4.2 and Node 26.13.0; `effect` 4.1.2 and `@computis/effect-xml` 0.4.0 (the `environment` block of every file).

| Policy  | Inputs                | Warmup                        | Sampling                               |
| ------- | --------------------- | ----------------------------- | -------------------------------------- |
| `ab`    | `bank-16k`, `bank-4m` | 5 iterations and at least 1 s | at least 10 runs and 2 s, at most 30 s |
| `large` | `bank-64m`            | 1 iteration                   | 2 runs                                 |

`ab` has no sample cap, so a `bank-16k` process meters thousands of runs, not the 200 runs (about 60 ms) of the matrix policy. `large` keeps a `bank-64m` process to five operations: the check run, two warmup runs, and 2 samples. Each takes seconds under this load.

### Metrics and statistics

- **CPU time per operation (primary)**: user plus system CPU of the whole child over the sampling phase, divided by the sample count. It includes the runtime's GC and compiler threads, so it can exceed the wall time.
- **Wall time (secondary)**: the median of the child's sampled run times. Across the case children of the kept rounds above 1 ms of CPU per operation, it runs from 0.64 to 2.27 times the CPU time (5th to 95th percentile) and swings more between rounds.
- **The other owner metrics**: each child also records peak RSS, peak heap used, allocation rate, GC count and pause, and the time to first record for the stream cases. These are per round in the files; a bank-4m summary is in [Other metrics](#other-metrics-bank-4m-jit-off).
- **Per-round ratio**: NEW / OLD of one case, or a case over the matching `computis-effect-xml` case, from the same round.
- **Summary**: the median of the per-round values, with a distribution-free interval. The interval spans the order statistics around the median that give 95% coverage under the binomial distribution. With 5 rounds no pair of ranks reaches 95%, so the `bank-64m` interval is the range of the 5 values, with 93.8% coverage. The coverage of every block is in the load table below.
- **Outlier rule**: a round is an outlier when:
  - its larger load reading exceeds twice the block's median of that reading;
  - any unit failed; or
  - any unit's CPU time per operation lies more than `3 x 1.4826 x MAD` from that unit's block median.

  Each outlier round ran once more after the planned rounds, and the repeat replaces it in the summary. The original stays in the file with `superseded` set to the test it failed. Of the 190 planned rounds, 78 were repeated: 25 for load and 53 for one unit's CPU time. Two of those were the `transport` rung, at about 0.002 ms per operation. No unit failed, and 190 rounds are kept. A repeat replaces its outlier round without a further test: against the planned rounds of its block, 48 of the 78 kept repeats would still fail the CPU test (and 25 the load test). Recomputed from the rounds that passed the test, without any repeat, no verdict cell changes (close-out audit, task `ee3a512f`).

### Matrix

| Block                          | Cases                                                                                               | Rungs (NEW only)                                                         | Rounds |
| ------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| `bank-4m`, JIT `off` and `on`  | `typed-decode`, `encode-typed`, `stream`, `stream/positions`, `tree`, `events`, both computis cases | `transport`, `tokenizer`, `resolver`, `collector`, `schema`, `positions` | 15     |
| `bank-64m`, JIT `off` and `on` | `typed-decode`, `encode-typed`, `stream`, `stream/positions`, both computis cases                   | `transport`, `tokenizer`, `resolver`, `collector`, `schema`              | 5      |
| `bank-16k`, JIT `off` and `on` | as `bank-4m`                                                                                        | none                                                                     | 20     |
| `bank-4m`, JIT `noeval`        | as `bank-4m`                                                                                        | none                                                                     | 15     |

The case names drop the `effect-xml/` prefix. JIT `off` is the library default. `on` imports `effect/schema/SchemaJITCompiler/enable` before the library loads, as an application would. `noeval` does the same and then refuses `Function`, so the JIT falls back to the interpreter. Each mode is installed by the `bench/harness/jit/` preload that `bench/run.ts` uses. `tree` and `events` are context: they do not use the step-1 codec, and their ratios show how much this method drifts on unchanged code.

### Files and load

The raw rounds and summaries are in `docs/rd/performance/phase-3-ab/<runtime>-jit-<mode>-<input>.json`, one file per block (14 files). Each file holds:

- `block`: the trees, commits, cases, rungs, and policy;
- `rounds`: every round with its order, its load at the start and end, and each unit's load at start and full child result;
- `repeated`: the number of repeated rounds;
- `summary`: per metric (`cpuPerOpMs`, `wallMedianMs`), the per-unit medians, `newOverOld`, `competitors`, `ladderDeltas`, and `step2`. Each value is a JSON-encoded `Option` of `{ n, median, low, high, coverage }`.

The tables below read the summaries, for example:

```sh
bun -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); for (const [c, o] of Object.entries(j.summary.cpuPerOpMs.newOverOld)) console.log(c, o.value.median.toFixed(3), o.value.low.toFixed(3), o.value.high.toFixed(3))' docs/rd/performance/phase-3-ab/bun-jit-off-bank-4m.json
```

The Bun chain and the Node chain ran at the same time from 2026-11-06 23:12 UTC: Bun until 2026-11-07 01:46 UTC and Node until 02:06 UTC. Each chain ran its blocks one after the other, so each added load to the other, on top of the other workspaces on the machine. At the block boundaries, `ps` named as the busiest processes the chains' own children, Node processes of other projects, system services such as Spotlight indexing, and other agent sessions. No other measurement of this project ran. The 1-minute load average over every round, the superseded ones included:

| Runtime | JIT    | Input    | Rounds kept | Repeated | Coverage | Load min | Load median | Load max | First round (UTC) | Last round (UTC) |
| ------- | ------ | -------- | ----------- | -------- | -------- | -------- | ----------- | -------- | ----------------- | ---------------- |
| bun     | off    | bank-16k | 20          | 9        | 95.9%    | 5.57     | 10.82       | 79.49    | 2026-11-07 00:41  | 2026-11-07 01:01 |
| bun     | off    | bank-4m  | 15          | 1        | 96.5%    | 15.30    | 48.50       | 86.33    | 2026-11-06 23:12  | 2026-11-06 23:32 |
| bun     | off    | bank-64m | 5           | 3        | 93.8%    | 13.84    | 38.46       | 74.01    | 2026-11-06 23:34  | 2026-11-06 23:55 |
| bun     | on     | bank-16k | 20          | 11       | 95.9%    | 8.08     | 32.40       | 142.70   | 2026-11-07 01:02  | 2026-11-07 01:25 |
| bun     | on     | bank-4m  | 15          | 3        | 96.5%    | 13.84    | 54.30       | 146.39   | 2026-11-06 23:57  | 2026-11-07 00:21 |
| bun     | on     | bank-64m | 5           | 2        | 93.8%    | 20.78    | 58.71       | 146.99   | 2026-11-07 00:22  | 2026-11-07 00:38 |
| bun     | noeval | bank-4m  | 15          | 6        | 96.5%    | 16.61    | 43.33       | 142.70   | 2026-11-07 01:26  | 2026-11-07 01:46 |
| node    | off    | bank-16k | 20          | 8        | 95.9%    | 5.51     | 10.83       | 80.18    | 2026-11-07 00:58  | 2026-11-07 01:19 |
| node    | off    | bank-4m  | 15          | 3        | 96.5%    | 12.76    | 42.33       | 82.96    | 2026-11-06 23:12  | 2026-11-06 23:36 |
| node    | off    | bank-64m | 5           | 4        | 93.8%    | 20.79    | 48.07       | 88.32    | 2026-11-06 23:38  | 2026-11-07 00:04 |
| node    | on     | bank-16k | 20          | 11       | 95.9%    | 15.52    | 50.71       | 140.60   | 2026-11-07 01:20  | 2026-11-07 01:44 |
| node    | on     | bank-4m  | 15          | 5        | 96.5%    | 17.43    | 62.66       | 143.97   | 2026-11-07 00:07  | 2026-11-07 00:37 |
| node    | on     | bank-64m | 5           | 4        | 93.8%    | 6.88     | 14.18       | 96.47    | 2026-11-07 00:39  | 2026-11-07 00:56 |
| node    | noeval | bank-4m  | 15          | 8        | 96.5%    | 9.64     | 23.16       | 60.50    | 2026-11-07 01:45  | 2026-11-07 02:05 |

### Witness verdict

The slice rule, on CPU-time ratios: a `stream` or `stream/positions` median NEW / OLD above 1.05 on either runtime at `bank-4m` or `bank-64m` is a regression.

No regression. In JIT `off`, the highest `stream` or `stream/positions` median is 0.769 (Node, `stream/positions`, `bank-4m`), and the highest interval bound is 0.837 (Node, `stream/positions`, `bank-64m`):

| Case               | Input      | Bun   | Node  |
| ------------------ | ---------- | ----- | ----- |
| `stream`           | `bank-4m`  | 0.555 | 0.639 |
| `stream`           | `bank-64m` | 0.548 | 0.620 |
| `stream/positions` | `bank-4m`  | 0.680 | 0.769 |
| `stream/positions` | `bank-64m` | 0.708 | 0.763 |

The JIT `on` and `noeval` medians of the same cells stay at or below 0.785. On the small-record input, `bank-16k`, `stream` measures 0.595 (Bun) and 0.680 (Node), and `stream/positions` 0.707 and 0.787. The per-record path therefore costs less CPU on NEW at every size.

The witness rule covers every stream and positions metric, not CPU alone. **Memory, Node, JIT `off`: no regression is shown, but peak heap is not resolved to 5%.** Peak heap NEW / OLD is 0.976 (`stream`) and 0.977 (`stream/positions`) at `bank-4m`, and 1.000 and 1.138 at `bank-64m`. The one median above 1.05 has an interval from 0.969 to 2.991, because a child's peak heap depends on collector timing. Peak RSS, time to first record, GC, and allocation per operation all have medians at or below 1.014. The data is in [Streaming memory, Node, JIT off](#streaming-memory-node-jit-off). Bun memory did not get the longer re-run; its `bank-4m` figures are in [Other metrics](#other-metrics-bank-4m-jit-off).

### NEW / OLD, CPU time per operation

Each cell gives the median ratio, with its interval in parentheses. Below 1, NEW uses less CPU.

#### JIT off (library default)

| Case                          | Input      | Bun NEW/OLD         | Node NEW/OLD        |
| ----------------------------- | ---------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.522 (0.517–0.525) | 0.617 (0.612–0.624) |
| `effect-xml/typed-decode`     | `bank-4m`  | 0.503 (0.489–0.519) | 0.710 (0.675–0.736) |
| `effect-xml/typed-decode`     | `bank-64m` | 0.597 (0.548–0.637) | 0.743 (0.682–0.800) |
| `effect-xml/encode-typed`     | `bank-16k` | 0.221 (0.219–0.225) | 0.320 (0.314–0.323) |
| `effect-xml/encode-typed`     | `bank-4m`  | 0.277 (0.249–0.285) | 0.362 (0.356–0.365) |
| `effect-xml/encode-typed`     | `bank-64m` | 0.327 (0.280–0.374) | 0.318 (0.296–0.376) |
| `effect-xml/stream`           | `bank-16k` | 0.595 (0.581–0.612) | 0.680 (0.668–0.687) |
| `effect-xml/stream`           | `bank-4m`  | 0.555 (0.542–0.567) | 0.639 (0.628–0.661) |
| `effect-xml/stream`           | `bank-64m` | 0.548 (0.463–0.589) | 0.620 (0.573–0.681) |
| `effect-xml/stream/positions` | `bank-16k` | 0.707 (0.701–0.743) | 0.787 (0.769–0.798) |
| `effect-xml/stream/positions` | `bank-4m`  | 0.680 (0.648–0.712) | 0.769 (0.749–0.789) |
| `effect-xml/stream/positions` | `bank-64m` | 0.708 (0.672–0.752) | 0.763 (0.643–0.837) |
| `effect-xml/tree`             | `bank-16k` | 1.001 (0.998–1.006) | 1.004 (0.995–1.011) |
| `effect-xml/tree`             | `bank-4m`  | 0.986 (0.964–1.039) | 0.990 (0.960–1.017) |
| `effect-xml/events`           | `bank-16k` | 1.001 (0.991–1.008) | 0.998 (0.990–1.009) |
| `effect-xml/events`           | `bank-4m`  | 0.993 (0.965–1.008) | 1.004 (0.993–1.030) |

#### JIT on

| Case                          | Input      | Bun NEW/OLD         | Node NEW/OLD        |
| ----------------------------- | ---------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.569 (0.559–0.585) | 0.602 (0.591–0.611) |
| `effect-xml/typed-decode`     | `bank-4m`  | 0.537 (0.527–0.551) | 0.759 (0.734–0.791) |
| `effect-xml/typed-decode`     | `bank-64m` | 0.574 (0.517–0.634) | 0.788 (0.704–0.910) |
| `effect-xml/encode-typed`     | `bank-16k` | 0.197 (0.192–0.214) | 0.274 (0.264–0.281) |
| `effect-xml/encode-typed`     | `bank-4m`  | 0.214 (0.207–0.232) | 0.335 (0.299–0.378) |
| `effect-xml/encode-typed`     | `bank-64m` | 0.251 (0.212–0.343) | 0.272 (0.249–0.365) |
| `effect-xml/stream`           | `bank-16k` | 0.595 (0.578–0.625) | 0.671 (0.667–0.696) |
| `effect-xml/stream`           | `bank-4m`  | 0.567 (0.547–0.589) | 0.643 (0.613–0.735) |
| `effect-xml/stream`           | `bank-64m` | 0.602 (0.570–0.640) | 0.649 (0.634–0.673) |
| `effect-xml/stream/positions` | `bank-16k` | 0.748 (0.687–0.778) | 0.782 (0.769–0.791) |
| `effect-xml/stream/positions` | `bank-4m`  | 0.740 (0.721–0.755) | 0.785 (0.755–0.802) |
| `effect-xml/stream/positions` | `bank-64m` | 0.739 (0.714–0.753) | 0.771 (0.755–0.784) |
| `effect-xml/tree`             | `bank-16k` | 0.998 (0.971–1.018) | 0.995 (0.980–1.020) |
| `effect-xml/tree`             | `bank-4m`  | 1.022 (0.949–1.046) | 0.999 (0.960–1.027) |
| `effect-xml/events`           | `bank-16k` | 1.007 (0.998–1.024) | 1.005 (0.993–1.015) |
| `effect-xml/events`           | `bank-4m`  | 1.015 (0.974–1.064) | 1.003 (0.982–1.027) |

#### JIT noeval

| Case                          | Input     | Bun NEW/OLD         | Node NEW/OLD        |
| ----------------------------- | --------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-4m` | 0.507 (0.497–0.512) | 0.746 (0.720–0.762) |
| `effect-xml/encode-typed`     | `bank-4m` | 0.261 (0.244–0.290) | 0.370 (0.368–0.374) |
| `effect-xml/stream`           | `bank-4m` | 0.519 (0.509–0.549) | 0.641 (0.632–0.659) |
| `effect-xml/stream/positions` | `bank-4m` | 0.695 (0.681–0.712) | 0.769 (0.759–0.780) |
| `effect-xml/tree`             | `bank-4m` | 1.016 (0.984–1.042) | 1.009 (0.991–1.022) |
| `effect-xml/events`           | `bank-4m` | 1.009 (0.991–1.032) | 1.004 (0.986–1.028) |

### NEW / OLD, wall time (secondary)

#### JIT off

| Case                          | Input      | Bun NEW/OLD         | Node NEW/OLD        |
| ----------------------------- | ---------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.520 (0.517–0.521) | 0.616 (0.612–0.619) |
| `effect-xml/typed-decode`     | `bank-4m`  | 0.481 (0.435–0.540) | 0.590 (0.568–0.619) |
| `effect-xml/typed-decode`     | `bank-64m` | 0.519 (0.332–0.572) | 0.646 (0.611–1.182) |
| `effect-xml/encode-typed`     | `bank-16k` | 0.235 (0.232–0.237) | 0.283 (0.279–0.286) |
| `effect-xml/encode-typed`     | `bank-4m`  | 0.233 (0.182–0.249) | 0.311 (0.282–0.317) |
| `effect-xml/encode-typed`     | `bank-64m` | 0.258 (0.210–0.404) | 0.299 (0.275–0.304) |
| `effect-xml/stream`           | `bank-16k` | 0.578 (0.572–0.586) | 0.665 (0.659–0.667) |
| `effect-xml/stream`           | `bank-4m`  | 0.558 (0.528–0.578) | 0.641 (0.625–0.659) |
| `effect-xml/stream`           | `bank-64m` | 0.535 (0.437–1.021) | 0.638 (0.615–1.251) |
| `effect-xml/stream/positions` | `bank-16k` | 0.725 (0.722–0.733) | 0.755 (0.749–0.759) |
| `effect-xml/stream/positions` | `bank-4m`  | 0.668 (0.540–0.696) | 0.751 (0.707–0.770) |
| `effect-xml/stream/positions` | `bank-64m` | 0.677 (0.603–0.765) | 0.760 (0.346–0.916) |
| `effect-xml/tree`             | `bank-16k` | 1.000 (0.996–1.008) | 1.002 (0.997–1.009) |
| `effect-xml/tree`             | `bank-4m`  | 1.036 (0.955–1.154) | 0.991 (0.964–1.005) |
| `effect-xml/events`           | `bank-16k` | 0.999 (0.992–1.005) | 1.001 (0.987–1.009) |
| `effect-xml/events`           | `bank-4m`  | 0.969 (0.869–1.011) | 1.015 (0.960–1.128) |

#### JIT on

| Case                          | Input      | Bun NEW/OLD         | Node NEW/OLD        |
| ----------------------------- | ---------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.569 (0.556–0.574) | 0.596 (0.591–0.610) |
| `effect-xml/typed-decode`     | `bank-4m`  | 0.524 (0.498–0.547) | 0.652 (0.606–0.747) |
| `effect-xml/typed-decode`     | `bank-64m` | 0.508 (0.455–0.574) | 0.655 (0.448–0.670) |
| `effect-xml/encode-typed`     | `bank-16k` | 0.209 (0.207–0.213) | 0.226 (0.221–0.230) |
| `effect-xml/encode-typed`     | `bank-4m`  | 0.176 (0.148–0.188) | 0.273 (0.219–0.315) |
| `effect-xml/encode-typed`     | `bank-64m` | 0.236 (0.212–0.248) | 0.277 (0.268–0.298) |
| `effect-xml/stream`           | `bank-16k` | 0.612 (0.598–0.625) | 0.666 (0.658–0.679) |
| `effect-xml/stream`           | `bank-4m`  | 0.546 (0.509–0.590) | 0.638 (0.554–0.659) |
| `effect-xml/stream`           | `bank-64m` | 0.575 (0.562–1.369) | 0.647 (0.620–0.673) |
| `effect-xml/stream/positions` | `bank-16k` | 0.759 (0.752–0.771) | 0.758 (0.744–0.764) |
| `effect-xml/stream/positions` | `bank-4m`  | 0.771 (0.725–0.984) | 0.760 (0.686–0.789) |
| `effect-xml/stream/positions` | `bank-64m` | 0.739 (0.678–0.803) | 0.751 (0.744–0.770) |
| `effect-xml/tree`             | `bank-16k` | 1.002 (0.994–1.014) | 0.997 (0.994–1.005) |
| `effect-xml/tree`             | `bank-4m`  | 0.988 (0.898–1.185) | 0.962 (0.798–1.012) |
| `effect-xml/events`           | `bank-16k` | 1.001 (0.998–1.007) | 1.004 (1.001–1.012) |
| `effect-xml/events`           | `bank-4m`  | 0.974 (0.798–1.038) | 0.992 (0.941–1.034) |

#### JIT noeval

| Case                          | Input     | Bun NEW/OLD         | Node NEW/OLD        |
| ----------------------------- | --------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-4m` | 0.477 (0.456–0.528) | 0.640 (0.618–0.667) |
| `effect-xml/encode-typed`     | `bank-4m` | 0.225 (0.219–0.233) | 0.323 (0.315–0.329) |
| `effect-xml/stream`           | `bank-4m` | 0.520 (0.496–0.578) | 0.648 (0.639–0.661) |
| `effect-xml/stream/positions` | `bank-4m` | 0.674 (0.558–0.764) | 0.753 (0.745–0.762) |
| `effect-xml/tree`             | `bank-4m` | 0.986 (0.807–1.123) | 1.007 (1.000–1.028) |
| `effect-xml/events`           | `bank-4m` | 0.999 (0.918–1.114) | 0.997 (0.990–1.005) |

### Against `@computis/effect-xml`, CPU time per operation

Each ratio is effect-xml over computis on the same input, from the same round. Above 1, computis uses less CPU.

#### JIT off

| Ratio                         | Input      | Bun                    | Node                   |
| ----------------------------- | ---------- | ---------------------- | ---------------------- |
| NEW `typed-decode` / computis | `bank-16k` | 2.747 (2.720–2.767)    | 3.488 (3.352–3.580)    |
| NEW `typed-decode` / computis | `bank-4m`  | 2.909 (2.868–3.112)    | 3.473 (3.166–3.569)    |
| NEW `typed-decode` / computis | `bank-64m` | 3.755 (2.511–4.262)    | 3.313 (2.944–3.956)    |
| OLD `typed-decode` / computis | `bank-16k` | 5.262 (5.232–5.292)    | 5.647 (5.541–5.759)    |
| OLD `typed-decode` / computis | `bank-4m`  | 5.840 (5.640–6.158)    | 4.858 (4.672–5.068)    |
| OLD `typed-decode` / computis | `bank-64m` | 6.422 (4.343–6.691)    | 4.639 (4.005–5.328)    |
| NEW `encode-typed` / computis | `bank-16k` | 3.374 (3.323–3.412)    | 3.922 (3.894–3.949)    |
| NEW `encode-typed` / computis | `bank-4m`  | 4.796 (4.379–5.850)    | 4.260 (4.191–4.412)    |
| NEW `encode-typed` / computis | `bank-64m` | 5.170 (4.401–5.658)    | 3.407 (2.699–4.363)    |
| OLD `encode-typed` / computis | `bank-16k` | 15.152 (14.987–15.462) | 12.344 (12.154–12.720) |
| OLD `encode-typed` / computis | `bank-4m`  | 18.265 (17.253–21.182) | 11.752 (11.317–12.369) |
| OLD `encode-typed` / computis | `bank-64m` | 15.845 (13.194–16.900) | 9.806 (8.495–13.745)   |

#### JIT on

| Ratio                         | Input      | Bun                    | Node                   |
| ----------------------------- | ---------- | ---------------------- | ---------------------- |
| NEW `typed-decode` / computis | `bank-16k` | 2.545 (2.501–2.752)    | 3.066 (2.975–3.127)    |
| NEW `typed-decode` / computis | `bank-4m`  | 2.753 (2.577–2.795)    | 2.984 (2.777–3.382)    |
| NEW `typed-decode` / computis | `bank-64m` | 2.881 (2.401–3.193)    | 2.962 (2.547–3.082)    |
| OLD `typed-decode` / computis | `bank-16k` | 4.457 (4.375–4.623)    | 5.017 (4.959–5.304)    |
| OLD `typed-decode` / computis | `bank-4m`  | 5.156 (4.582–5.319)    | 3.894 (3.547–4.097)    |
| OLD `typed-decode` / computis | `bank-64m` | 5.037 (4.237–5.466)    | 3.620 (3.388–4.078)    |
| NEW `encode-typed` / computis | `bank-16k` | 2.782 (2.761–2.851)    | 3.424 (3.279–3.496)    |
| NEW `encode-typed` / computis | `bank-4m`  | 3.664 (3.402–4.306)    | 3.362 (3.195–3.645)    |
| NEW `encode-typed` / computis | `bank-64m` | 3.914 (3.376–5.486)    | 2.514 (2.131–3.240)    |
| OLD `encode-typed` / computis | `bank-16k` | 14.193 (13.166–14.475) | 12.357 (11.995–12.891) |
| OLD `encode-typed` / computis | `bank-4m`  | 17.398 (16.426–18.749) | 10.127 (9.461–10.399)  |
| OLD `encode-typed` / computis | `bank-64m` | 15.596 (14.600–15.996) | 8.995 (7.488–10.082)   |

#### JIT noeval

| Ratio                         | Input     | Bun                    | Node                |
| ----------------------------- | --------- | ---------------------- | ------------------- |
| NEW `typed-decode` / computis | `bank-4m` | 2.410 (2.190–2.723)    | 2.848 (2.791–2.971) |
| OLD `typed-decode` / computis | `bank-4m` | 4.796 (4.352–5.107)    | 3.854 (3.703–3.935) |
| NEW `encode-typed` / computis | `bank-4m` | 3.441 (3.224–3.845)    | 3.259 (3.072–3.384) |
| OLD `encode-typed` / computis | `bank-4m` | 12.800 (12.693–13.883) | 8.900 (8.379–9.125) |

#### Wall time, JIT off (secondary)

| Ratio                         | Input      | Bun                    | Node                   |
| ----------------------------- | ---------- | ---------------------- | ---------------------- |
| NEW `typed-decode` / computis | `bank-16k` | 2.454 (2.442–2.462)    | 3.374 (3.324–3.411)    |
| NEW `typed-decode` / computis | `bank-4m`  | 2.862 (2.544–4.446)    | 3.372 (1.853–3.457)    |
| NEW `typed-decode` / computis | `bank-64m` | 3.176 (1.464–6.755)    | 4.250 (1.766–7.499)    |
| OLD `typed-decode` / computis | `bank-16k` | 4.724 (4.703–4.761)    | 5.462 (5.388–5.569)    |
| OLD `typed-decode` / computis | `bank-4m`  | 5.791 (5.298–8.424)    | 5.662 (5.058–5.909)    |
| OLD `typed-decode` / computis | `bank-64m` | 7.222 (2.822–16.944)   | 6.102 (2.817–10.613)   |
| NEW `encode-typed` / computis | `bank-16k` | 3.163 (3.141–3.206)    | 3.182 (3.159–3.220)    |
| NEW `encode-typed` / computis | `bank-4m`  | 3.756 (3.534–5.876)    | 3.601 (3.515–6.131)    |
| NEW `encode-typed` / computis | `bank-64m` | 3.178 (1.728–7.342)    | 3.320 (1.683–6.129)    |
| OLD `encode-typed` / computis | `bank-16k` | 13.449 (13.403–13.608) | 11.224 (11.120–11.463) |
| OLD `encode-typed` / computis | `bank-4m`  | 16.103 (14.795–27.107) | 12.358 (11.147–21.684) |
| OLD `encode-typed` / computis | `bank-64m` | 12.778 (6.815–23.046)  | 10.913 (5.721–20.296)  |

### CPU time per operation, JIT off (loaded machine)

These are the per-round medians, in ms per operation, with their intervals, for context. `new:` and `old:` name the tree a unit ran on. The values come from the loaded machine, so read them for scale only.

#### `bank-16k`

| Unit                                   | Bun                 | Node                |
| -------------------------------------- | ------------------- | ------------------- |
| `new:effect-xml/typed-decode`          | 0.226 (0.224–0.229) | 0.303 (0.303–0.316) |
| `old:effect-xml/typed-decode`          | 0.433 (0.429–0.437) | 0.497 (0.494–0.506) |
| `new:effect-xml/encode-typed`          | 0.135 (0.133–0.137) | 0.210 (0.210–0.211) |
| `old:effect-xml/encode-typed`          | 0.606 (0.600–0.618) | 0.660 (0.655–0.675) |
| `new:effect-xml/stream`                | 0.285 (0.283–0.289) | 0.372 (0.367–0.376) |
| `old:effect-xml/stream`                | 0.478 (0.474–0.497) | 0.547 (0.542–0.577) |
| `new:effect-xml/stream/positions`      | 0.547 (0.537–0.550) | 0.653 (0.647–0.715) |
| `old:effect-xml/stream/positions`      | 0.765 (0.741–0.790) | 0.833 (0.822–0.895) |
| `new:effect-xml/tree`                  | 0.143 (0.142–0.144) | 0.196 (0.194–0.201) |
| `old:effect-xml/tree`                  | 0.142 (0.141–0.143) | 0.195 (0.194–0.198) |
| `new:effect-xml/events`                | 0.060 (0.060–0.061) | 0.086 (0.085–0.087) |
| `old:effect-xml/events`                | 0.061 (0.060–0.061) | 0.086 (0.085–0.088) |
| `new:computis-effect-xml/typed-decode` | 0.083 (0.082–0.083) | 0.088 (0.087–0.092) |
| `new:computis-effect-xml/encode-typed` | 0.040 (0.040–0.040) | 0.054 (0.053–0.055) |

#### `bank-4m`

| Unit                                   | Bun                 | Node                |
| -------------------------------------- | ------------------- | ------------------- |
| `new:effect-xml/typed-decode`          | 93.71 (84.78–100.6) | 132.2 (131.3–145.6) |
| `old:effect-xml/typed-decode`          | 186.2 (166.5–199.8) | 192.0 (182.7–209.0) |
| `new:effect-xml/encode-typed`          | 65.64 (61.37–68.89) | 80.45 (76.82–90.35) |
| `old:effect-xml/encode-typed`          | 238.0 (233.7–245.6) | 224.1 (211.7–263.4) |
| `new:effect-xml/stream`                | 66.85 (64.19–68.67) | 84.76 (83.33–95.98) |
| `old:effect-xml/stream`                | 119.2 (117.7–123.3) | 133.4 (129.4–145.8) |
| `new:effect-xml/stream/positions`      | 113.2 (110.5–124.4) | 158.1 (150.2–178.1) |
| `old:effect-xml/stream/positions`      | 174.5 (159.2–185.4) | 204.0 (195.9–224.1) |
| `new:effect-xml/tree`                  | 55.24 (51.89–58.88) | 80.42 (76.42–86.81) |
| `old:effect-xml/tree`                  | 55.49 (49.87–59.57) | 86.04 (77.11–88.17) |
| `new:effect-xml/events`                | 19.03 (18.53–19.99) | 36.68 (33.34–38.37) |
| `old:effect-xml/events`                | 19.32 (18.71–20.62) | 35.72 (32.76–38.14) |
| `new:computis-effect-xml/typed-decode` | 31.76 (29.43–32.89) | 39.14 (37.00–44.44) |
| `new:computis-effect-xml/encode-typed` | 12.91 (11.78–14.00) | 20.38 (17.93–21.55) |
| `new:transport`                        | 0.001 (0.001–0.001) | 0.002 (0.001–0.002) |
| `new:tokenizer`                        | 24.46 (22.76–25.32) | 36.45 (33.41–38.21) |
| `new:resolver`                         | 51.62 (48.51–53.90) | 73.77 (63.62–75.36) |
| `new:collector`                        | 57.81 (54.02–61.99) | 83.43 (71.58–87.27) |
| `new:schema`                           | 79.42 (76.04–83.84) | 88.40 (77.86–106.7) |
| `new:positions`                        | 139.0 (131.7–150.6) | 166.2 (145.1–172.9) |

#### `bank-64m`

| Unit                                   | Bun                    | Node                   |
| -------------------------------------- | ---------------------- | ---------------------- |
| `new:effect-xml/typed-decode`          | 1814.1 (1588.1–1998.0) | 2380.1 (2348.6–2675.6) |
| `old:effect-xml/typed-decode`          | 3093.6 (2746.6–3269.8) | 3195.2 (2974.5–3608.0) |
| `new:effect-xml/encode-typed`          | 1192.2 (1155.4–1514.6) | 1263.9 (1131.6–1602.9) |
| `old:effect-xml/encode-typed`          | 4047.1 (3574.3–4132.3) | 3913.2 (3561.3–4343.8) |
| `new:effect-xml/stream`                | 908.7 (849.9–972.0)    | 1431.2 (1338.9–2004.7) |
| `old:effect-xml/stream`                | 1649.9 (1610.0–1836.2) | 2335.8 (2282.6–2941.7) |
| `new:effect-xml/stream/positions`      | 1763.7 (1750.7–2050.1) | 2381.3 (2293.8–2749.5) |
| `old:effect-xml/stream/positions`      | 2565.2 (2491.8–2861.4) | 3284.2 (3119.6–3577.3) |
| `new:computis-effect-xml/typed-decode` | 483.1 (468.8–632.5)    | 718.5 (658.7–797.8)    |
| `new:computis-effect-xml/encode-typed` | 260.8 (227.9–270.9)    | 380.7 (316.0–440.5)    |
| `new:transport`                        | 0.134 (0.122–0.176)    | 0.099 (0.073–0.200)    |
| `new:tokenizer`                        | 430.2 (365.1–443.5)    | 644.2 (543.8–800.5)    |
| `new:resolver`                         | 736.6 (691.0–830.6)    | 1100.0 (1041.3–1255.3) |
| `new:collector`                        | 847.7 (631.9–972.1)    | 1514.5 (1151.9–1662.5) |
| `new:schema`                           | 957.1 (918.1–1044.4)   | 1934.4 (1195.5–2049.6) |

### Other metrics, `bank-4m`, JIT off

Each cell is the median over the kept rounds. Peak RSS is the child's process lifetime maximum, including the input. Heap used is the peak `heapUsed`. Allocation rate, GC count, and GC pause cover the sampling phase. On Bun they carry the label `node:v8 GCProfiler on Bun (fidelity unverified)`. The time to first record is reported for the stream cases only.

| Unit                                   | Runtime | Peak RSS (MB) | Heap used (MB) | Alloc (MB/s) | GC count | GC pause (ms) | TTFR median (ms) |
| -------------------------------------- | ------- | ------------- | -------------- | ------------ | -------- | ------------- | ---------------- |
| `new:effect-xml/typed-decode`          | bun     | 656.9         | 305.9          | 1455.9       | 17.0     | 357.2         | -                |
| `old:effect-xml/typed-decode`          | bun     | 681.0         | 319.1          | 1397.0       | 22.0     | 345.4         | -                |
| `new:effect-xml/encode-typed`          | bun     | 706.3         | 347.0          | 1834.1       | 19.0     | 402.1         | -                |
| `old:effect-xml/encode-typed`          | bun     | 857.0         | 409.2          | 2438.4       | 22.0     | 282.2         | -                |
| `new:effect-xml/stream`                | bun     | 382.8         | 169.9          | 2938.9       | 62.0     | 108.7         | 0.8              |
| `old:effect-xml/stream`                | bun     | 384.4         | 172.8          | 3070.2       | 67.0     | 97.1          | 0.8              |
| `new:effect-xml/stream/positions`      | bun     | 263.5         | 71.5           | 2881.8       | 63.0     | 70.4          | 0.4              |
| `old:effect-xml/stream/positions`      | bun     | 267.4         | 75.4           | 1877.4       | 47.0     | 257.6         | 0.4              |
| `new:effect-xml/tree`                  | bun     | 842.3         | 399.1          | 2013.4       | 18.0     | 319.2         | -                |
| `old:effect-xml/tree`                  | bun     | 906.2         | 479.0          | 2171.4       | 18.0     | 267.6         | -                |
| `new:effect-xml/events`                | bun     | 544.3         | 251.2          | 1094.7       | 17.0     | 221.6         | -                |
| `old:effect-xml/events`                | bun     | 541.7         | 251.5          | 1023.5       | 14.0     | 183.7         | -                |
| `new:computis-effect-xml/typed-decode` | bun     | 503.2         | 240.4          | 1050.9       | 18.0     | 181.8         | -                |
| `new:computis-effect-xml/encode-typed` | bun     | 581.6         | 265.3          | 1973.2       | 28.0     | 152.8         | -                |
| `new:transport`                        | bun     | 149.4         | 13.4           | 2821.8       | 144.0    | 95.0          | -                |
| `new:tokenizer`                        | bun     | 316.9         | 102.1          | 1881.6       | 65.0     | 302.3         | -                |
| `new:resolver`                         | bun     | 421.1         | 156.2          | 2761.9       | 64.0     | 379.4         | -                |
| `new:collector`                        | bun     | 432.8         | 165.0          | 2741.9       | 62.0     | 388.8         | -                |
| `new:schema`                           | bun     | 184.5         | 52.6           | 2313.8       | 174.0    | 388.9         | -                |
| `new:positions`                        | bun     | 180.3         | 51.9           | 2274.2       | 186.0    | 201.3         | -                |
| `new:effect-xml/typed-decode`          | node    | 545.3         | 337.6          | 2216.7       | 151.0    | 311.0         | -                |
| `old:effect-xml/typed-decode`          | node    | 546.9         | 329.9          | 3018.7       | 191.0    | 239.9         | -                |
| `new:effect-xml/encode-typed`          | node    | 590.8         | 408.7          | 2241.3       | 167.0    | 512.7         | -                |
| `old:effect-xml/encode-typed`          | node    | 586.4         | 405.4          | 2837.7       | 186.0    | 325.0         | -                |
| `new:effect-xml/stream`                | node    | 221.2         | 78.4           | 2513.3       | 154.0    | 37.7          | 0.9              |
| `old:effect-xml/stream`                | node    | 221.4         | 77.3           | 3223.9       | 198.0    | 68.6          | 0.9              |
| `new:effect-xml/stream/positions`      | node    | 384.4         | 223.1          | 2407.7       | 155.0    | 136.0         | 0.3              |
| `old:effect-xml/stream/positions`      | node    | 382.7         | 215.9          | 2849.6       | 181.0    | 143.0         | 0.3              |
| `new:effect-xml/tree`                  | node    | 595.0         | 408.5          | 2318.3       | 136.0    | 296.0         | -                |
| `old:effect-xml/tree`                  | node    | 601.9         | 408.9          | 2054.8       | 125.0    | 389.5         | -                |
| `new:effect-xml/events`                | node    | 476.5         | 301.0          | 1141.6       | 77.0     | 372.9         | -                |
| `old:effect-xml/events`                | node    | 475.9         | 300.6          | 1352.5       | 88.0     | 246.0         | -                |
| `new:computis-effect-xml/typed-decode` | node    | 440.2         | 272.4          | 1595.0       | 118.0    | 322.6         | -                |
| `new:computis-effect-xml/encode-typed` | node    | 499.1         | 315.5          | 2540.2       | 107.0    | 265.6         | -                |
| `new:transport`                        | node    | 245.6         | 106.3          | 1956.4       | 101.0    | 21.9          | -                |
| `new:tokenizer`                        | node    | 449.8         | 275.3          | 819.2        | 53.0     | 451.1         | -                |
| `new:resolver`                         | node    | 507.4         | 315.0          | 1574.1       | 93.0     | 545.4         | -                |
| `new:collector`                        | node    | 499.4         | 303.5          | 1461.2       | 93.0     | 477.3         | -                |
| `new:schema`                           | node    | 212.8         | 70.8           | 1930.5       | 125.0    | 184.3         | -                |
| `new:positions`                        | node    | 362.1         | 184.2          | 1242.8       | 110.0    | 652.4         | -                |

### Measure-2 blocks

A second unit (`perf3-measure-2`) ran more blocks with the same driver, method, policies, and outlier rule, after the driver gained two options (`df898ab`, committed separately): `--failure` runs a failure-path unit on both trees, and `--old-jit` sets the old side's JIT mode, so one tree passed as both sides compares two JIT modes in the same rounds. The summaries of these files also hold `peakHeapUsedBytes`, `peakRssBytes`, `timeToFirstRecordMedianMs`, `gcCountPerOp`, `gcPauseMsPerOp`, and `allocationBytesPerOp`, each per unit and as `newOverOld`.

- **NEW**: commit `df898ab`, run from the detached worktree `.worktrees/perf3-m2-new-df898ab`, removed after the runs. Its `src/` runs the step-1 code: since `390bdca`, only the JSDoc comment of `Positions` in `src/fast-encode.ts` changed (`17a3187`).
- **OLD**: `bd60a0e`, as above.
- **Chains**: Bun and Node ran at the same time from 2026-11-07 02:21 UTC, each block after the other, as in the first unit.

| File (`docs/rd/performance/phase-3-ab/`)          | Units                                                    | Sides                         | Rounds |
| ------------------------------------------------- | -------------------------------------------------------- | ----------------------------- | ------ |
| `<runtime>-failure-jit-off-bank-4m-bad-last.json` | `failure/typed-decode`, `failure/stream`                 | NEW / OLD, JIT `off`          | 15     |
| `<runtime>-jit-on-vs-off-bank-4m.json`            | `typed-decode`, `encode-typed`                           | NEW JIT `on` / NEW JIT `off`  | 15     |
| `<runtime>-jit-on-vs-off-bank-16k.json`           | `typed-decode`, `encode-typed`                           | NEW JIT `on` / NEW JIT `off`  | 20     |
| `node-memory-jit-off-bank-4m.json`                | `stream`, `stream/positions`                             | NEW / OLD, JIT `off`          | 15     |
| `node-memory-jit-off-bank-64m.json`               | `stream`, `stream/positions`                             | NEW / OLD, JIT `off`, `large` | 12     |
| `latency-jit-off.json`                            | derived from the first unit's JIT `off` files; see below | NEW                           | -      |

The 1-minute load over every round of these blocks, the superseded ones included:

| Runtime | Block                              | Rounds kept | Repeated | Coverage | Load min | Load median | Load max | First round (UTC) | Last round (UTC) |
| ------- | ---------------------------------- | ----------- | -------- | -------- | -------- | ----------- | -------- | ----------------- | ---------------- |
| bun     | `failure-jit-off-bank-4m-bad-last` | 15          | 2        | 96.5%    | 8.06     | 15.48       | 40.59    | 2026-11-07 02:21  | 2026-11-07 02:26 |
| bun     | `jit-on-vs-off-bank-4m`            | 15          | 0        | 96.5%    | 18.17    | 33.69       | 50.48    | 2026-11-07 02:26  | 2026-11-07 02:29 |
| bun     | `jit-on-vs-off-bank-16k`           | 20          | 5        | 95.9%    | 10.39    | 18.52       | 46.01    | 2026-11-07 02:30  | 2026-11-07 02:35 |
| node    | `failure-jit-off-bank-4m-bad-last` | 15          | 3        | 96.5%    | 8.06     | 15.39       | 47.77    | 2026-11-07 02:21  | 2026-11-07 02:26 |
| node    | `jit-on-vs-off-bank-4m`            | 15          | 0        | 96.5%    | 18.88    | 33.67       | 50.43    | 2026-11-07 02:27  | 2026-11-07 02:30 |
| node    | `jit-on-vs-off-bank-16k`           | 20          | 8        | 95.9%    | 10.39    | 21.08       | 51.09    | 2026-11-07 02:31  | 2026-11-07 02:37 |
| node    | `memory-jit-off-bank-4m`           | 15          | 2        | 96.5%    | 20.04    | 44.28       | 67.49    | 2026-11-07 02:37  | 2026-11-07 02:42 |
| node    | `memory-jit-off-bank-64m`          | 12          | 2        | 96.1%    | 10.14    | 26.64       | 71.31    | 2026-11-07 02:42  | 2026-11-07 02:56 |

### Failure path (F7.5)

The phase-3 design says the failure path costs today's path plus the fast attempt, so `errors.md`'s cheaper-failure figure does not apply. Two failure-path units decode `bank-4m-bad-last`, whose last `qti-assessment-item-ref` lacks its required `href`, on NEW and OLD with JIT `off`. Each unit's run counts 1 only when the decode fails with a `SchemaFailure`, and every run of both blocks did.

- `failure/typed-decode`: `XmlSchema.fromString(ItemBank)`, the whole-document decode of `effect-xml/typed-decode`.
- `failure/stream`: `XmlSchema.decodeSchemaString(ItemRef)` over the 64 KiB chunks, the record stream of `effect-xml/stream`.

CPU time per operation, median with interval over 15 kept rounds. The delta is the per-round NEW minus OLD, median and range:

| Unit                   | Runtime | NEW (ms)            | OLD (ms)            | NEW / OLD           | NEW - OLD (ms)         | Wall NEW / OLD      |
| ---------------------- | ------- | ------------------- | ------------------- | ------------------- | ---------------------- | ------------------- |
| `failure/typed-decode` | bun     | 190.5 (179.3–214.3) | 169.2 (159.1–183.3) | 1.127 (1.106–1.149) | 21.1 (14.8 to 32.7)    | 1.120 (1.090–1.143) |
| `failure/typed-decode` | node    | 206.0 (199.3–218.1) | 177.7 (172.6–211.6) | 1.141 (1.096–1.182) | 24.1 (6.5 to 40.2)     | 1.120 (1.083–1.145) |
| `failure/stream`       | bun     | 63.33 (61.99–65.04) | 113.2 (108.8–114.5) | 0.568 (0.559–0.578) | -49.0 (-57.7 to -42.4) | 0.569 (0.549–0.582) |
| `failure/stream`       | node    | 83.99 (77.51–88.36) | 124.0 (121.6–128.7) | 0.646 (0.616–0.687) | -45.4 (-60.3 to -34.7) | 0.655 (0.624–0.673) |

Against the claim:

- **Whole-document decode: holds.** A failing `fromString` decode costs 13% to 14% more CPU on NEW than on OLD, and every interval lies above 1. NEW runs the fast attempt to the last record, fails there, and then runs today's decode on the same collected root. The extra 21 to 24 ms per operation is that attempt, net of any change in the steps both paths share. A failure is therefore not cheaper on NEW. For scale only, from other blocks under other load: NEW's successful decode of `bank-4m` costs 93.7 ms (Bun) and 132.2 ms (Node), of which the tokenizer and resolver (`K`) take 51.6 and 73.8 ms.
- **Record stream: holds per record.** A failing `decodeSchemaString` costs 0.568 (Bun) and 0.646 (Node) of OLD, the same as the successful stream at `bank-4m` (0.555 and 0.639). Every record before the bad one takes the fast path; only the failing record pays the fast attempt and today's decode, so the failure stays as cheap as success.
- **Memory.** NEW's peak heap used on the failure path is 0.899 (Bun) and 1.000 (Node) of OLD for `failure/typed-decode`, and 0.955 and 1.021 for `failure/stream`. Peak RSS lies between 0.982 and 1.002. The Node `failure/stream` heap interval reaches 2.544 because 4 of the 15 kept NEW children (and 1 OLD child) peaked at 142 to 227 MB against 74 to 80 MB in the rest: on Node, the heap used at a run's end depends on whether a collection ran just before it.

### JIT on against JIT off, same rounds

This measures what the Schema JIT is worth on the shipped path. Both sides run NEW (`df898ab`) in the same rounds: the new side with JIT `on` (the application's global import of `effect/schema/SchemaJITCompiler/enable`, preloaded before the library loads) and the old side with JIT `off`, the library default. The ratio is on / off; below 1, the JIT saves CPU. CPU time per operation, median with interval:

| Case           | Input      | Runtime | Rounds | JIT off (ms)        | JIT on (ms)         | On / off, CPU       | On / off, wall      |
| -------------- | ---------- | ------- | ------ | ------------------- | ------------------- | ------------------- | ------------------- |
| `typed-decode` | `bank-4m`  | bun     | 15     | 88.66 (81.07–100.9) | 80.44 (73.21–88.00) | 0.903 (0.879–0.915) | 0.848 (0.810–0.922) |
| `typed-decode` | `bank-4m`  | node    | 15     | 147.2 (125.7–149.5) | 116.8 (104.2–126.9) | 0.835 (0.816–0.862) | 0.844 (0.817–1.002) |
| `typed-decode` | `bank-16k` | bun     | 20     | 0.229 (0.228–0.231) | 0.208 (0.205–0.210) | 0.906 (0.899–0.915) | 0.907 (0.902–0.914) |
| `typed-decode` | `bank-16k` | node    | 20     | 0.311 (0.309–0.357) | 0.260 (0.256–0.302) | 0.832 (0.825–0.852) | 0.825 (0.821–0.830) |
| `encode-typed` | `bank-4m`  | bun     | 15     | 63.24 (59.61–67.88) | 52.76 (51.34–57.35) | 0.847 (0.826–0.887) | 0.795 (0.768–0.918) |
| `encode-typed` | `bank-4m`  | node    | 15     | 82.96 (75.96–89.62) | 59.69 (54.11–67.70) | 0.739 (0.704–0.761) | 0.729 (0.718–0.815) |
| `encode-typed` | `bank-16k` | bun     | 20     | 0.135 (0.133–0.140) | 0.113 (0.111–0.114) | 0.825 (0.813–0.844) | 0.827 (0.816–0.842) |
| `encode-typed` | `bank-16k` | node    | 20     | 0.220 (0.210–0.257) | 0.170 (0.162–0.201) | 0.772 (0.753–0.790) | 0.706 (0.700–0.708) |

The JIT saves about 10% of typed-decode CPU on Bun and 17% on Node, and 15% to 18% of typed-encode CPU on Bun and 23% to 26% on Node, at both sizes. Every interval lies below 1. It also lowers GC count and allocation per operation (on / off 0.81 to 0.96 and 0.86 to 0.94). Peak heap and peak RSS stay between 0.92 and 1.06, except the Node `bank-16k` encode heap at 1.064 (1.020–1.094). These gains are larger than the 3% to 6% decode figure that `decisions.md` first cited from the `builder.md` spike's prototype; they cover the whole operation on the step-1 code, in the same rounds. [`decisions.md`](decisions.md#jit-off-by-default-supersedes-f8) records the policy consequence: the default stays off.

### Streaming memory, Node, JIT off

The first unit's witness checked CPU only. The close-out audit (task `ee3a512f`) found the Node `stream/positions` peak heap NEW / OLD at 1.095 in the 5-round `bank-64m` JIT `off` block. Two more Node blocks ran `stream` and `stream/positions` on NEW and OLD with JIT `off`: `bank-4m` (15 rounds, `ab` policy) and `bank-64m` (12 rounds, `large` policy). NEW / OLD, median with interval:

| Metric            | `stream`, `bank-4m` | `stream/positions`, `bank-4m` | `stream`, `bank-64m` | `stream/positions`, `bank-64m` |
| ----------------- | ------------------- | ----------------------------- | -------------------- | ------------------------------ |
| Peak heap used    | 0.976 (0.411–1.032) | 0.977 (0.818–1.068)           | 1.000 (0.615–1.736)  | 1.138 (0.969–2.991)            |
| Peak RSS          | 0.986 (0.608–1.007) | 0.991 (0.955–1.001)           | 0.992 (0.553–1.780)  | 0.995 (0.979–1.893)            |
| TTFR median       | 0.990 (0.965–1.001) | 0.993 (0.969–1.038)           | 1.014 (0.964–1.039)  | 0.977 (0.928–1.027)            |
| GC count per op   | 0.485 (0.474–0.487) | 0.626 (0.620–0.626)           | 0.486 (0.481–0.502)  | 0.622 (0.615–0.624)            |
| GC pause per op   | 0.486 (0.415–0.597) | 0.667 (0.530–0.823)           | 0.802 (0.394–2.012)  | 0.779 (0.592–1.545)            |
| Allocation per op | 0.483 (0.483–0.483) | 0.617 (0.617–0.617)           | 0.484 (0.484–0.484)  | 0.617 (0.617–0.617)            |
| CPU per op        | 0.618 (0.590–0.643) | 0.773 (0.757–0.796)           | 0.688 (0.633–0.759)  | 0.781 (0.747–0.816)            |

Peak heap used is the largest `heapUsed` read at the end of each run, so it depends on whether a collection ran just before that read. The per-child values fall in two groups on both sides. At `bank-64m`, `stream` children peaked at 128 to 206 MB or at 334 to 479 MB, six of each on each side. For `stream/positions`, 4 of the 12 OLD children peaked at 143 to 151 MB and the rest at 363 to 484 MB; NEW children peaked at 295 MB once and at 398 to 486 MB otherwise. The four rounds where OLD's read fell into its low group give ratios of 2.98 to 3.29 and pull the median to 1.138; the high groups match.

Against 1.05: only `stream/positions` at `bank-64m` has a peak-heap median above 1.05, and its interval includes 1, so 12 rounds cannot show that the ratio exceeds 1.05. At `bank-4m` both medians are below 1. Every other memory metric has a median at or below 1.014: NEW allocates 0.48 to 0.62 of OLD's bytes per operation and runs 0.49 to 0.63 of its collections. Resolving peak heap to 5% needs a heap read that does not depend on collector timing, such as one after a forced collection, which the driver does not take.

### Latency, JIT off

Per-operation latency of NEW, from the first unit's JIT `off` files (`<runtime>-jit-off-bank-16k.json`, `<runtime>-jit-off-bank-4m.json`). `latency-jit-off.json` holds every row with its method. Each value is the median over the kept rounds of one child's figure, in ms. Wall median, p95, and p99 are the child's quantiles of its sampled run times. CPU per op is the child's CPU over the sampling phase divided by its sample count. CPU has no p95 or p99: the meter reads the process's CPU over the whole sampling phase, not per run.

At `bank-4m` a child takes 10 to 55 samples. Its p99 is therefore its slowest run in every round, and its p95 is its slowest run in some rounds. Those cells say "max" with the share of rounds. Read them as the slowest of a few dozen runs on a loaded machine, not as tail latency.

| Case               | Input      | Runtime | Samples per child   | Wall median | Wall p95               | Wall p99   | CPU per op |
| ------------------ | ---------- | ------- | ------------------- | ----------- | ---------------------- | ---------- | ---------- |
| `typed-decode`     | `bank-16k` | bun     | 9975 (9345–10087)   | 0.188       | 0.252                  | 0.324      | 0.226      |
| `typed-decode`     | `bank-16k` | node    | 6832 (2353–6954)    | 0.283       | 0.335                  | 0.539      | 0.303      |
| `encode-typed`     | `bank-16k` | bun     | 16019 (15498–16458) | 0.118       | 0.144                  | 0.181      | 0.135      |
| `encode-typed`     | `bank-16k` | node    | 11365 (4059–11467)  | 0.164       | 0.188                  | 0.712      | 0.210      |
| `stream`           | `bank-16k` | bun     | 8472 (8260–8574)    | 0.222       | 0.298                  | 0.386      | 0.285      |
| `stream`           | `bank-16k` | node    | 5746 (2514–6003)    | 0.332       | 0.422                  | 0.715      | 0.372      |
| `stream/positions` | `bank-16k` | bun     | 4244.5 (4107–4338)  | 0.446       | 0.542                  | 1.459      | 0.547      |
| `stream/positions` | `bank-16k` | node    | 3457 (811–3535)     | 0.536       | 0.850                  | 1.313      | 0.653      |
| `typed-decode`     | `bank-4m`  | bun     | 18 (10–35)          | 104.4       | 197.0, max in 8 of 15  | 197.0, max | 93.7       |
| `typed-decode`     | `bank-4m`  | node    | 23 (10–24)          | 84.5        | 107.2, max in 5 of 15  | 132.5, max | 132.2      |
| `encode-typed`     | `bank-4m`  | bun     | 42 (16–55)          | 42.5        | 71.7, max in 2 of 15   | 122.3, max | 65.6       |
| `encode-typed`     | `bank-4m`  | node    | 36 (12–39)          | 54.6        | 69.1, max in 5 of 15   | 90.4, max  | 80.4       |
| `stream`           | `bank-4m`  | bun     | 31 (14–35)          | 62.5        | 88.6, max in 6 of 15   | 113.7, max | 66.9       |
| `stream`           | `bank-4m`  | node    | 24 (10–26)          | 82.6        | 89.8, max in 5 of 15   | 100.0, max | 84.8       |
| `stream/positions` | `bank-4m`  | bun     | 19 (10–20)          | 109.5       | 169.1, max in 13 of 15 | 169.1, max | 113.2      |
| `stream/positions` | `bank-4m`  | node    | 14 (10–16)          | 147.2       | 183.6, max             | 183.6, max | 158.1      |

## Phase 3 step-2 evaluation

This section evaluates the owner's step-2 rule on the step-1 code. The rule says to build the custom tokenizer only if the tokenizer and resolver are what stands between effect-xml and computis on typed decode. It uses CPU time per operation from the same rounds as [Phase 3 under load (A/B)](#phase-3-under-load-ab), from the `bank-4m` and `bank-64m` blocks in JIT `off` and `on`.

### Inputs

- `T`: NEW `effect-xml/typed-decode`, a whole-document `fromString` decode.
- `C`: `computis-effect-xml/typed-decode`.
- `K`: the `resolver` rung minus the `transport` rung of the `bench/profile/layers.ts` ladder, run on NEW. That is the ladder's tokenizer delta plus its resolver delta.

The driver runs each rung in a child process of its own, through the rung definitions `bench/profile/layers.ts` exports. `layers.ts` itself runs every rung in one process and reports wall time only. Each round gives one value of `T`, `C`, `K`, `T - K`, `T / C`, `(T - K) / C`, and `K / (T - K)`. The table gives the median of each, with its interval.

| Runtime | Input      | JIT | T                      | C                   | K                      | T - K                  | T/C                 | (T-K)/C             | K/(T-K)             |
| ------- | ---------- | --- | ---------------------- | ------------------- | ---------------------- | ---------------------- | ------------------- | ------------------- | ------------------- |
| bun     | `bank-4m`  | off | 93.71 (84.78–100.6)    | 31.76 (29.43–32.89) | 51.61 (48.51–53.89)    | 42.21 (34.13–48.95)    | 2.909 (2.868–3.112) | 1.283 (1.174–1.515) | 1.303 (1.054–1.431) |
| bun     | `bank-4m`  | on  | 83.56 (78.91–87.78)    | 32.11 (28.47–33.64) | 53.69 (48.15–54.88)    | 32.70 (29.51–34.54)    | 2.753 (2.577–2.795) | 1.063 (0.972–1.111) | 1.589 (1.459–1.798) |
| bun     | `bank-64m` | off | 1814.1 (1588.1–1998.0) | 483.1 (468.8–632.5) | 736.5 (690.9–830.4)    | 1105.4 (757.7–1307.1)  | 3.755 (2.511–4.262) | 2.288 (1.198–2.788) | 0.641 (0.529–1.096) |
| bun     | `bank-64m` | on  | 1382.0 (1300.7–1536.8) | 478.2 (457.1–575.6) | 690.2 (583.7–840.8)    | 640.3 (541.2–943.1)    | 2.881 (2.401–3.193) | 1.401 (0.940–1.972) | 1.057 (0.619–1.554) |
| node    | `bank-4m`  | off | 132.2 (131.3–145.6)    | 39.14 (37.00–44.44) | 73.76 (63.62–75.36)    | 66.75 (61.81–71.34)    | 3.473 (3.166–3.569) | 1.606 (1.502–1.828) | 1.078 (0.940–1.202) |
| node    | `bank-4m`  | on  | 127.8 (119.0–133.4)    | 41.33 (37.45–46.01) | 72.12 (67.39–76.86)    | 53.10 (47.28–62.72)    | 2.984 (2.777–3.382) | 1.253 (1.144–1.596) | 1.355 (1.119–1.532) |
| node    | `bank-64m` | off | 2380.1 (2348.6–2675.6) | 718.5 (658.7–797.8) | 1099.9 (1041.2–1255.2) | 1278.9 (1093.4–1575.7) | 3.313 (2.944–3.956) | 1.863 (1.370–2.330) | 0.856 (0.698–1.148) |
| node    | `bank-64m` | on  | 2063.4 (1765.8–2165.1) | 696.7 (686.6–702.4) | 1077.1 (1049.6–1153.9) | 983.7 (705.1–1027.7)   | 2.962 (2.547–3.082) | 1.412 (1.017–1.465) | 1.141 (1.048–1.504) |

### Verdict

The planner's D1 default fires when `T > C` and `T - K <= C` on both runtimes at `bank-4m` and `bank-64m`, in the shipped mode (JIT `off`). Options: (a) replaces `T - K <= C` with `K >= T - K`; (b) asks for either runtime instead of both.

In the shipped mode the D1 default does not fire. `T > C` holds in every cell (`T / C` from 2.909 to 3.755), but so does `T - K > C`: `(T - K) / C` runs from 1.283 to 2.288, and every interval lies above 1. Some layer other than the tokenizer and resolver still stands between effect-xml and computis. Under the rule, that calls for more step-1 work, not a custom tokenizer.

| Rule                                             | JIT `off` (shipped)                                                                                                                       | JIT `on` (beside it)                                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 default: `T > C`, `T - K <= C`, both runtimes | Does not fire: `(T - K) / C` is 1.283 and 1.606 at `bank-4m`, 2.288 and 1.863 at `bank-64m` (Bun, Node)                                   | Does not fire: `(T - K) / C` is 1.063 and 1.253 at `bank-4m`, 1.401 and 1.412 at `bank-64m`; both Bun intervals include 1                  |
| (a): `T > C`, `K >= T - K`, both runtimes        | Does not fire: holds at `bank-4m` (`K / (T - K)` 1.303 and 1.078; the Node interval includes 1) and fails at `bank-64m` (0.641 and 0.856) | Fires on the medians: `K / (T - K)` is 1.589 and 1.355 at `bank-4m`, 1.057 and 1.141 at `bank-64m`; the Bun `bank-64m` interval includes 1 |
| (b): the default on either runtime               | Does not fire: `T - K > C` on both runtimes at both sizes                                                                                 | Does not fire                                                                                                                              |

Options (a) and (b) together do not fire in JIT `off` either: (a) holds on both runtimes at `bank-4m` and on neither at `bank-64m`. D1's wording was pending the owner when this ran; it has since been ruled (`docs/goals/performance/phase-3.md`, "The step-2 decision rule"; current verdict in [Phase 3: step-2 rule re-evaluated on the optimized code](#phase-3-step-2-rule-re-evaluated-on-the-optimized-code)). In the shipped mode the rule does not fire under the default or under any of its options.

### Ladder split on NEW

Each rung's value is its per-round median CPU time per operation. Its delta is the per-round difference from the rung above. The `schema` rung decodes records through `decodeSchemaString` with positions off, and `positions` turns them on. A negative delta is noise between two child processes.

#### JIT off, `bank-4m`

| Rung        | Bun rung            | Bun delta           | Node rung           | Node delta          |
| ----------- | ------------------- | ------------------- | ------------------- | ------------------- |
| `transport` | 0.001 (0.001–0.001) | -                   | 0.002 (0.001–0.002) | -                   |
| `tokenizer` | 24.46 (22.76–25.32) | 24.46 (22.76–25.31) | 36.45 (33.41–38.21) | 36.45 (33.41–38.20) |
| `resolver`  | 51.62 (48.51–53.90) | 27.76 (25.58–28.58) | 73.77 (63.62–75.36) | 35.69 (31.15–38.45) |
| `collector` | 57.81 (54.02–61.99) | 7.127 (4.873–10.00) | 83.43 (71.58–87.27) | 9.174 (7.453–11.23) |
| `schema`    | 79.42 (76.04–83.84) | 21.20 (19.78–22.53) | 88.40 (77.86–106.7) | 6.539 (3.833–23.26) |
| `positions` | 139.0 (131.7–150.6) | 61.62 (55.38–66.05) | 166.2 (145.1–172.9) | 69.37 (59.83–82.52) |

#### JIT off, `bank-64m`

| Rung        | Bun rung             | Bun delta             | Node rung              | Node delta          |
| ----------- | -------------------- | --------------------- | ---------------------- | ------------------- |
| `transport` | 0.134 (0.122–0.176)  | -                     | 0.099 (0.073–0.200)    | -                   |
| `tokenizer` | 430.2 (365.1–443.5)  | 430.1 (365.0–443.4)   | 644.2 (543.8–800.5)    | 644.1 (543.7–800.4) |
| `resolver`  | 736.6 (691.0–830.6)  | 311.8 (259.3–465.5)   | 1100.0 (1041.3–1255.3) | 492.8 (397.1–555.1) |
| `collector` | 847.7 (631.9–972.1)  | 63.33 (-59.061–141.6) | 1514.5 (1151.9–1662.5) | 300.2 (57.25–621.2) |
| `schema`    | 957.1 (918.1–1044.4) | 136.2 (72.26–286.2)   | 1934.4 (1195.5–2049.6) | 429.8 (43.59–480.9) |

#### JIT on, `bank-4m`

| Rung        | Bun rung            | Bun delta           | Node rung           | Node delta           |
| ----------- | ------------------- | ------------------- | ------------------- | -------------------- |
| `transport` | 0.001 (0.001–0.001) | -                   | 0.002 (0.001–0.002) | -                    |
| `tokenizer` | 24.02 (23.46–25.45) | 24.02 (23.46–25.45) | 35.68 (32.94–38.69) | 35.67 (32.94–38.69)  |
| `resolver`  | 53.69 (48.15–54.89) | 26.81 (24.84–30.21) | 72.12 (67.39–76.86) | 36.27 (34.23–38.57)  |
| `collector` | 59.82 (53.96–62.50) | 6.410 (5.140–9.762) | 84.95 (77.33–87.34) | 9.563 (7.574–12.69)  |
| `schema`    | 78.37 (75.28–81.64) | 18.23 (16.60–22.66) | 94.21 (74.71–113.5) | 22.10 (-3.353–28.52) |
| `positions` | 144.2 (132.7–152.7) | 63.03 (58.33–73.61) | 156.2 (142.1–163.7) | 50.11 (40.27–73.09)  |

#### JIT on, `bank-64m`

| Rung        | Bun rung             | Bun delta             | Node rung              | Node delta                   |
| ----------- | -------------------- | --------------------- | ---------------------- | ---------------------------- |
| `transport` | 0.164 (0.136–0.230)  | -                     | 0.075 (0.072–0.086)    | -                            |
| `tokenizer` | 376.8 (294.1–418.3)  | 376.7 (294.0–418.0)   | 564.0 (559.2–577.3)    | 563.9 (559.1–577.2)          |
| `resolver`  | 690.4 (583.9–841.0)  | 377.5 (166.1–422.8)   | 1077.2 (1049.7–1153.9) | 499.9 (484.9–594.8)          |
| `collector` | 807.3 (762.5–1105.8) | 178.6 (99.64–264.7)   | 1323.7 (1233.8–1362.5) | 263.0 (79.84–285.0)          |
| `schema`    | 860.0 (828.0–1055.7) | 50.61 (-50.064–118.7) | 1118.3 (1084.6–1177.2) | -184.995 (-244.169–-140.543) |

The ladder cannot split the new builder from the structural codec: its rungs stop at `collector` and then decode whole records. `bench/profile/cpu-buckets.ts` cannot split them either, because it files `src/builder.ts`, `src/structural.ts`, and `src/fast-decode.ts` under `schema` with every other top-level `src/` module. This unit did not run `bench/profile/cpu.ts`. The failure path on `bank-4m-bad-last` (F7.5), which the original `perf3-reprofile` slice names, is in [Failure path (F7.5)](#failure-path-f75). Its other item, the `SchemaAOTCompiler` evaluation, is the spike's: see the end of [Deferred to the idle-machine run](#deferred-to-the-idle-machine-run).

### Caveats

- **`bank-64m` ladder noise.** Each `bank-64m` child takes 2 samples, and each delta subtracts two such children. The JIT-on Node `schema` delta is negative across its whole interval, so treat the `bank-64m` deltas as rough. `T`, `C`, and `K` at `bank-64m` each come from a single child per round, and their intervals cover the 5 rounds.
- **Load.** The step-2 rounds ran at a 1-minute load of 6.88 to 146.99 (the `bank-4m` and `bank-64m` rows of the load table). The ratios pair values from the same round, but the absolute values describe that load only.

### Deferred to the idle-machine run

The owner's loaded-machine rule (`work/owner-directive-perf3-loaded.md`) defers one thing to a later idle-machine run, a separate task:

- Throughput in MB/s. These sections give ratios and loaded absolute times only.

The rule does not defer per-change numbers; it asks for them as interleaved ratios under load. The following were not measured after step 1. They are deferred, and no section of this record covers them:

- Bun memory (peak RSS, heap, allocation rate, GC) for any change after step 1. The later A/Bs report CPU and wall time, plus allocation and GC on Node only.
- Latency percentiles (p95, p99) and time to first record for any change after step 1.
- The scaling curve refreshed for phase 3, `bank-256k` included.
- JIT `noeval` beyond `bank-4m`, and on any code after step 1.
- JIT `on` typed decode at HEAD, until the HEAD A/B lands: the JIT `on` decode row in [Phase 3: stop and final status](#phase-3-stop-and-final-status) predates `07240f0` and `7e280b3`.
- A CPU bucket split of the new builder from the structural codec. `bench/profile/cpu-buckets.ts` files both under `schema` (see the note under the ladder split).

These runs also leave gaps that load does not explain:

- The step-2 table has no `noeval` row: the `noeval` block ran no rungs.
- The ladder split covers NEW only. No baseline per-layer split ran under this method.
- The A/B ran only the `computis-effect-xml` competitors. `saxes`, `sax`, `txml`, and `parse-xml` did not run.
- The p95 and p99 wall times were only in the JSON. [Latency, JIT off](#latency-jit-off) now tabulates them.
- Peak heap is read at the end of each run, so it depends on collector timing and cannot resolve the streaming heap ratio to 5%. A read after a forced collection would.

`SchemaAOTCompiler` was evaluated in the JIT spike, not in these runs. `docs/rd/perf3-spikes/jit.md` (Q7) finds that it matches the JIT without eval only when every composite node is passed as a target, and the library builds its structural codecs at runtime, so it would need a new public hook. `docs/rd/decisions.md` (owner options, AOT install hook) keeps it a later option.

## Phase 3 layer profile (new code)

This section attributes the CPU that NEW spends on typed decode and typed encode to its layers, and sizes each layer against `@computis/effect-xml`. It picks the target of the next optimization. No library code changed for it.

NEW is commit `ee496cc`, measured from a pinned worktree. That commit is before fromString option B (`efea83e`), so the `fromString` type-side pass is still in the code. Its rungs below are the prediction for option B's gain.

### Method

- **Driver.** `bench/ab.ts --new-only true`, with both trees set to the pinned worktree. Each round runs the four typed cases (`effect-xml/typed-decode`, `effect-xml/encode-typed`, and their `computis-effect-xml` counterparts) and the 12 typed rungs of `bench/profile/layers.ts`, each in a child process of its own. The schedule reverses every other round, and an outlier round is repeated once, as in [Phase 3 under load (A/B)](#phase-3-under-load-ab). CPU time (user plus system) per operation is the primary metric and the wall median the secondary one.
- **Rounds.** 7 rounds at `bank-16k` and `bank-4m` under the `ab` policy, and 3 rounds at `bank-64m` under the `large` policy (2 samples per child). Bun 1.4.2 and Node 26.13.0, each with JIT `off` (shipped) and `on` (preloaded). The Bun and Node blocks ran at the same time as each other and beside other seats' work. The totals tables give the load range.
- **Decode ladder.** Each rung runs a whole-document decode of the bank up to and including one layer: `typed/tokenizer`, `typed/resolver`, `typed/collector`, `typed/builder`, `typed/structural` (the structural codec's Schema decode), and `typed/decode-string` (`decodeString`, which adds the faster path's glue, the span, and the debug log). `effect-xml/typed-decode` adds the last layer, the `fromString` wrapper. `typed/to-type` runs the wrapper's second, type-side decode of an already decoded value, alone.
- **Encode ladder.** `typed/encode-structural` (the structural codec's Schema encode to the plain object), `typed/encode-writer` (adds the writer to events), `typed/encode-tokenizer` (adds the tokenizer's encode to text), and `typed/encode-string` (`encodeString`, which adds its glue and span). `effect-xml/encode-typed` adds the `fromString` wrapper, and `typed/encode-to-type` runs its type-side encode alone. Encode rungs write no XML declaration, as `effect-xml/encode-typed` does.
- **Derivation.** `bench/profile/layer-report.ts` computes, for every round, a layer's cost as its rung minus the rung before it. It then divides that cost by `T` (the share of the NEW total) and by `C` (the computis total), and computes `(T - cost) / C`: the `T / C` that would remain if that layer cost nothing. Each value is reduced over the kept rounds to a median with the driver's distribution-free interval: 95% at 7 rounds, and the range, with 75% coverage, at 3 rounds. A rung measured alone is not subtracted; its row uses its own value as the cost.
- **CPU profiles.** `bench/profile/cpu.ts` profiled the two NEW typed cases and the two computis cases on `bank-4m`, per runtime and JIT mode, from the same worktree. The JIT-on profiles used the `cpu.ts` of `d7ed23b`, which preloads the JIT into the case process; `src/` was unchanged.
- **Files.** `docs/rd/performance/phase-3-ab/profile-ab-<runtime>-jit-<mode>-<input>.json` (12 blocks, the raw rounds), `profile-layers.json` (every derived number in the tables below), and `profile-cpu-<runtime>-jit-<mode>-bank-4m.json` (4 profiles). Every file records `ee496cc` with `dirty: true`, because the worktree's `node_modules` symlink is untracked.

Every layer delta subtracts two child processes. A delta whose interval spans zero is within the noise of that pair. At `bank-64m`, 3 rounds of 2 samples each make the deltas rough, as in the step-2 ladder. At `bank-4m` the CPU intervals are much tighter than the wall intervals, because load spikes stretch wall time more than CPU time. At `bank-16k` the reverse holds: process CPU there includes background JIT and GC threads, which add to every run (Bun `T`: 0.276 ms of CPU against a 0.196 ms wall median).

### Totals, CPU time per operation

Typed decode:

| Runtime | Input      | JIT | Rounds | Load (1 min) | T                      | C                      | T/C                 |
| ------- | ---------- | --- | ------ | ------------ | ---------------------- | ---------------------- | ------------------- |
| bun     | `bank-16k` | off | 7      | 22.0–68.1    | 0.276 (0.231–0.340)    | 0.0974 (0.0837–0.106)  | 2.763 (2.696–3.208) |
| bun     | `bank-4m`  | off | 7      | 25.3–127.4   | 94.42 (85.43–106.5)    | 30.65 (29.45–33.75)    | 3.115 (2.889–3.206) |
| bun     | `bank-64m` | off | 3      | 7.7–14.4     | 1730.8 (1563.5–1763.7) | 492.4 (486.7–540.0)    | 3.212 (3.205–3.582) |
| node    | `bank-16k` | off | 7      | 22.1–72.0    | 0.355 (0.317–0.439)    | 0.0982 (0.0894–0.100)  | 3.618 (3.214–4.469) |
| node    | `bank-4m`  | off | 7      | 23.7–128.7   | 133.2 (127.7–150.1)    | 41.43 (37.08–43.89)    | 3.246 (3.200–3.504) |
| node    | `bank-64m` | off | 3      | 14.0–97.4    | 2575.5 (2296.0–2657.2) | 723.9 (627.9–810.6)    | 3.558 (3.278–3.657) |
| bun     | `bank-16k` | on  | 7      | 9.2–124.2    | 0.230 (0.207–0.258)    | 0.0864 (0.0834–0.0976) | 2.591 (2.402–2.755) |
| bun     | `bank-4m`  | on  | 7      | 13.3–182.9   | 76.44 (71.63–94.13)    | 30.34 (28.40–34.00)    | 2.523 (2.485–2.886) |
| bun     | `bank-64m` | on  | 3      | 10.6–109.0   | 1511.2 (1422.9–1558.1) | 507.9 (506.7–607.4)    | 2.808 (2.565–2.975) |
| node    | `bank-16k` | on  | 7      | 9.0–123.4    | 0.259 (0.253–0.309)    | 0.0874 (0.0859–0.0981) | 2.983 (2.912–3.234) |
| node    | `bank-4m`  | on  | 7      | 8.8–182.9    | 107.4 (105.4–126.6)    | 37.17 (35.19–44.93)    | 2.866 (2.702–3.053) |
| node    | `bank-64m` | on  | 3      | 40.4–110.3   | 1964.8 (1946.0–2449.1) | 784.5 (736.7–876.7)    | 2.641 (2.504–2.794) |

Typed encode:

| Runtime | Input      | JIT | Rounds | Load (1 min) | T                      | C                      | T/C                 |
| ------- | ---------- | --- | ------ | ------------ | ---------------------- | ---------------------- | ------------------- |
| bun     | `bank-16k` | off | 7      | 22.0–68.1    | 0.183 (0.136–0.198)    | 0.0480 (0.0408–0.0547) | 3.606 (3.305–3.919) |
| bun     | `bank-4m`  | off | 7      | 25.3–127.4   | 65.72 (56.29–69.50)    | 12.47 (11.63–13.82)    | 5.253 (4.252–5.907) |
| bun     | `bank-64m` | off | 3      | 7.7–14.4     | 1579.4 (1226.0–1595.0) | 257.4 (229.3–286.1)    | 5.521 (4.763–6.955) |
| node    | `bank-16k` | off | 7      | 22.1–72.0    | 0.269 (0.211–0.281)    | 0.0600 (0.0546–0.0632) | 4.312 (3.856–4.597) |
| node    | `bank-4m`  | off | 7      | 23.7–128.7   | 84.65 (79.19–90.86)    | 20.43 (18.44–21.01)    | 4.348 (4.030–4.423) |
| node    | `bank-64m` | off | 3      | 14.0–97.4    | 1480.0 (1372.4–1599.1) | 397.4 (388.0–479.4)    | 3.454 (3.087–4.122) |
| bun     | `bank-16k` | on  | 7      | 9.2–124.2    | 0.118 (0.115–0.148)    | 0.0414 (0.0406–0.0484) | 2.848 (2.771–3.066) |
| bun     | `bank-4m`  | on  | 7      | 13.3–182.9   | 54.34 (47.33–64.15)    | 12.24 (11.74–15.33)    | 4.438 (3.535–5.466) |
| bun     | `bank-64m` | on  | 3      | 10.6–109.0   | 1066.2 (881.8–1128.8)  | 239.0 (234.7–275.2)    | 4.461 (3.204–4.810) |
| node    | `bank-16k` | on  | 7      | 9.0–123.4    | 0.169 (0.162–0.208)    | 0.0542 (0.0529–0.0638) | 3.159 (2.983–3.255) |
| node    | `bank-4m`  | on  | 7      | 8.8–182.9    | 60.13 (54.37–70.43)    | 18.20 (17.28–21.61)    | 3.173 (3.067–3.748) |
| node    | `bank-64m` | on  | 3      | 40.4–110.3   | 1252.6 (1146.4–1406.6) | 395.3 (344.3–523.2)    | 3.330 (2.394–3.558) |

### Decode layers, JIT off (shipped)

CPU milliseconds per operation, per layer:

| Layer                                | bun `16k`               | bun `4m`              | bun `64m`             | node `16k`              | node `4m`            | node `64m`            |
| ------------------------------------ | ----------------------- | --------------------- | --------------------- | ----------------------- | -------------------- | --------------------- |
| tokenizer                            | 0.0891 (0.0728–0.0995)  | 22.51 (21.16–25.79)   | 440.3 (344.5–484.2)   | 0.0977 (0.0854–0.101)   | 33.31 (31.56–35.43)  | 695.0 (684.8–727.3)   |
| resolver                             | 0.0818 (0.0689–0.103)   | 27.80 (22.84–31.31)   | 411.0 (405.9–462.6)   | 0.0805 (0.0752–0.0911)  | 32.06 (26.97–40.69)  | 734.9 (483.3–798.7)   |
| collector                            | 0.0207 (0.0011–0.0242)  | 9.067 (4.654–11.97)   | -3.258 (-100.5–10.05) | 0.0255 (0.0151–0.0598)  | 12.34 (10.62–17.80)  | 474.4 (119.3–708.9)   |
| builder                              | 0.0628 (0.0538–0.0835)  | 23.44 (19.99–30.04)   | 480.5 (369.3–534.5)   | 0.0452 (0.0178–0.0538)  | 20.84 (14.35–24.38)  | 99.28 (-51.59–357.4)  |
| structural decode                    | 0.0291 (0.0075–0.0545)  | 8.544 (4.678–17.19)   | 310.3 (121.8–548.5)   | 0.0427 (0.0366–0.0530)  | 20.14 (4.115–33.48)  | 473.1 (155.6–514.8)   |
| decodeString glue                    | 0.0489 (0.0218–0.0846)  | -0.987 (-4.209–9.324) | 8.138 (-371.8–73.12)  | 0.0173 (0.0124–0.0324)  | 0.447 (-5.447–10.28) | 437.2 (-407.7–455.6)  |
| fromString wrapper                   | -0.0657 (-0.111–0.0085) | 0.0619 (-5.295–5.770) | 154.8 (102.4–271.7)   | 0.0393 (-0.0241–0.0953) | 17.34 (2.405–22.69)  | -1.735 (-119.0–189.0) |
| from-string type-side decode (alone) | 0.0211 (0.0191–0.0228)  | 7.677 (6.945–8.964)   | 103.9 (89.34–107.0)   | 0.0328 (0.0291–0.0346)  | 16.29 (12.99–17.43)  | 399.9 (299.6–407.8)   |

Share of `T`:

| Layer                                | bun `16k`              | bun `4m`                 | bun `64m`                | node `16k`            | node `4m`               | node `64m`               |
| ------------------------------------ | ---------------------- | ------------------------ | ------------------------ | --------------------- | ----------------------- | ------------------------ |
| tokenizer                            | 0.316 (0.292–0.351)    | 0.242 (0.231–0.260)      | 0.250 (0.220–0.280)      | 0.265 (0.229–0.309)   | 0.248 (0.217–0.268)     | 0.274 (0.270–0.298)      |
| resolver                             | 0.302 (0.295–0.360)    | 0.290 (0.267–0.313)      | 0.237 (0.230–0.296)      | 0.224 (0.208–0.280)   | 0.248 (0.202–0.284)     | 0.285 (0.211–0.301)      |
| collector                            | 0.0776 (0.0040–0.104)  | 0.102 (0.0437–0.123)     | -0.0021 (-0.0581–0.0057) | 0.0743 (0.0435–0.136) | 0.0913 (0.0832–0.134)   | 0.207 (0.0463–0.267)     |
| builder                              | 0.265 (0.158–0.297)    | 0.268 (0.205–0.282)      | 0.307 (0.209–0.309)      | 0.126 (0.0405–0.151)  | 0.139 (0.111–0.183)     | 0.0385 (-0.0194–0.156)   |
| structural decode                    | 0.106 (0.0267–0.233)   | 0.0932 (0.0495–0.176)    | 0.176 (0.0704–0.351)     | 0.123 (0.0926–0.163)  | 0.141 (0.0311–0.251)    | 0.184 (0.0586–0.224)     |
| decodeString glue                    | 0.175 (0.0941–0.297)   | -0.0111 (-0.0433–0.0876) | 0.0047 (-0.238–0.0415)   | 0.0486 (0.0349–0.102) | 0.0034 (-0.0427–0.0751) | 0.165 (-0.178–0.177)     |
| fromString wrapper                   | -0.230 (-0.476–0.0248) | 0.0006 (-0.0598–0.0611)  | 0.0878 (0.0655–0.157)    | 0.111 (-0.0757–0.217) | 0.116 (0.0181–0.178)    | -0.0007 (-0.0448–0.0823) |
| from-string type-side decode (alone) | 0.0798 (0.0562–0.0922) | 0.0828 (0.0813–0.0922)   | 0.0589 (0.0571–0.0618)   | 0.0909 (0.0788–0.106) | 0.113 (0.102–0.123)     | 0.153 (0.116–0.174)      |

Layer cost over `C`:

| Layer                                | bun `16k`              | bun `4m`               | bun `64m`               | node `16k`           | node `4m`             | node `64m`             |
| ------------------------------------ | ---------------------- | ---------------------- | ----------------------- | -------------------- | --------------------- | ---------------------- |
| tokenizer                            | 0.879 (0.840–0.965)    | 0.750 (0.690–0.781)    | 0.894 (0.708–0.897)     | 0.994 (0.946–1.024)  | 0.840 (0.738–0.898)   | 0.960 (0.897–1.091)    |
| resolver                             | 0.848 (0.795–1.012)    | 0.894 (0.773–0.935)    | 0.824 (0.761–0.950)     | 0.843 (0.786–0.927)  | 0.853 (0.651–0.950)   | 0.985 (0.770–1.015)    |
| collector                            | 0.220 (0.0113–0.279)   | 0.302 (0.138–0.384)    | -0.0067 (-0.186–0.0204) | 0.258 (0.158–0.609)  | 0.314 (0.274–0.434)   | 0.756 (0.165–0.875)    |
| builder                              | 0.730 (0.507–0.816)    | 0.773 (0.643–0.890)    | 0.987 (0.750–0.990)     | 0.465 (0.181–0.547)  | 0.486 (0.382–0.588)   | 0.137 (-0.0636–0.569)  |
| structural decode                    | 0.299 (0.0735–0.633)   | 0.279 (0.159–0.553)    | 0.630 (0.226–1.127)     | 0.446 (0.366–0.539)  | 0.473 (0.100–0.808)   | 0.654 (0.192–0.820)    |
| decodeString glue                    | 0.481 (0.260–0.835)    | -0.0329 (-0.135–0.276) | 0.0151 (-0.764–0.148)   | 0.194 (0.126–0.327)  | 0.0109 (-0.147–0.240) | 0.539 (-0.649–0.629)   |
| fromString wrapper                   | -0.645 (-1.293–0.0797) | 0.0020 (-0.176–0.196)  | 0.314 (0.210–0.503)     | 0.400 (-0.243–0.971) | 0.405 (0.0580–0.612)  | -0.0024 (-0.147–0.301) |
| from-string type-side decode (alone) | 0.224 (0.180–0.249)    | 0.261 (0.235–0.287)    | 0.198 (0.184–0.211)     | 0.339 (0.304–0.352)  | 0.381 (0.333–0.397)   | 0.503 (0.414–0.637)    |

`T / C` if the layer cost nothing:

| Layer                                | bun `16k`           | bun `4m`            | bun `64m`           | node `16k`          | node `4m`           | node `64m`          |
| ------------------------------------ | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| tokenizer                            | 1.886 (1.786–2.270) | 2.334 (2.140–2.442) | 2.504 (2.308–2.687) | 2.672 (2.219–3.445) | 2.462 (2.366–2.742) | 2.566 (2.381–2.598) |
| resolver                             | 1.901 (1.801–2.239) | 2.211 (2.055–2.321) | 2.444 (2.262–2.758) | 2.832 (2.315–3.541) | 2.554 (2.324–2.581) | 2.543 (2.293–2.887) |
| collector                            | 2.556 (2.416–3.066) | 2.731 (2.625–3.017) | 3.391 (3.219–3.561) | 3.369 (2.956–3.859) | 2.965 (2.796–3.161) | 2.901 (2.403–3.393) |
| builder                              | 2.031 (1.935–2.701) | 2.265 (2.116–2.491) | 2.225 (2.215–2.832) | 3.219 (2.757–4.288) | 2.809 (2.627–3.053) | 3.342 (3.087–3.421) |
| structural decode                    | 2.530 (2.083–2.944) | 2.686 (2.522–3.047) | 2.952 (2.085–2.979) | 3.172 (2.690–3.929) | 2.914 (2.407–3.130) | 2.904 (2.837–3.086) |
| decodeString glue                    | 2.327 (1.979–2.898) | 3.065 (2.834–3.250) | 3.433 (3.190–3.976) | 3.487 (2.887–4.252) | 3.277 (2.960–3.590) | 2.929 (2.739–4.306) |
| fromString wrapper                   | 3.436 (3.128–4.009) | 3.113 (2.848–3.228) | 3.002 (2.702–3.267) | 3.331 (2.891–3.498) | 2.906 (2.726–3.157) | 3.425 (3.356–3.560) |
| from-string type-side decode (alone) | 2.545 (2.447–3.027) | 2.828 (2.655–2.946) | 3.029 (3.007–3.371) | 3.314 (2.875–4.117) | 2.897 (2.819–3.110) | 3.020 (2.775–3.144) |

### Encode layers, JIT off (shipped)

CPU milliseconds per operation, per layer:

| Layer                                | bun `16k`                | bun `4m`              | bun `64m`            | node `16k`              | node `4m`            | node `64m`            |
| ------------------------------------ | ------------------------ | --------------------- | -------------------- | ----------------------- | -------------------- | --------------------- |
| structural encode                    | 0.0286 (0.0247–0.0298)   | 12.28 (10.60–13.56)   | 194.2 (120.0–231.0)  | 0.0425 (0.0377–0.0482)  | 17.59 (15.68–19.95)  | 431.1 (360.5–466.7)   |
| writer                               | 0.0779 (0.0698–0.0812)   | 23.25 (21.83–30.96)   | 414.0 (368.3–497.8)  | 0.0740 (0.0684–0.0790)  | 32.94 (26.66–39.06)  | 548.6 (200.9–572.6)   |
| tokenizer encode                     | 0.0556 (0.0401–0.0714)   | 23.08 (16.38–47.80)   | 513.3 (467.5–520.9)  | 0.114 (0.0663–0.132)    | 21.67 (12.10–29.82)  | 368.9 (358.8–770.5)   |
| encodeString glue                    | 0.0372 (0.0064–0.0471)   | 2.932 (-4.279–5.110)  | 103.8 (-209.9–338.9) | 0.0196 (0.0050–0.0375)  | 1.412 (-6.984–15.14) | -274.5 (-341.0–181.2) |
| fromString wrapper                   | -0.0203 (-0.0717–0.0230) | -0.848 (-18.94–9.821) | 333.0 (155.1–352.5)  | 0.0174 (-0.0251–0.0739) | 9.184 (-3.555–21.80) | 308.4 (115.9–383.0)   |
| from-string type-side encode (alone) | 0.0200 (0.0188–0.0213)   | 7.949 (7.229–9.135)   | 98.10 (93.33–104.8)  | 0.0308 (0.0295–0.0359)  | 13.36 (12.83–16.73)  | 412.5 (377.0–426.0)   |

Share of `T`:

| Layer                                | bun `16k`             | bun `4m`                | bun `64m`              | node `16k`             | node `4m`              | node `64m`            |
| ------------------------------------ | --------------------- | ----------------------- | ---------------------- | ---------------------- | ---------------------- | --------------------- |
| structural encode                    | 0.162 (0.146–0.213)   | 0.185 (0.166–0.241)     | 0.145 (0.0760–0.158)   | 0.165 (0.153–0.180)    | 0.208 (0.186–0.227)    | 0.314 (0.225–0.315)   |
| writer                               | 0.433 (0.391–0.557)   | 0.352 (0.331–0.494)     | 0.300 (0.260–0.315)    | 0.284 (0.268–0.325)    | 0.363 (0.317–0.461)    | 0.358 (0.136–0.400)   |
| tokenizer encode                     | 0.308 (0.243–0.486)   | 0.410 (0.248–0.723)     | 0.322 (0.296–0.425)    | 0.406 (0.240–0.488)    | 0.249 (0.143–0.328)    | 0.261 (0.231–0.521)   |
| encodeString glue                    | 0.213 (0.0351–0.346)  | 0.0427 (-0.0651–0.0735) | 0.0651 (-0.171–0.215)  | 0.0813 (0.0186–0.141)  | 0.0168 (-0.0864–0.176) | -0.200 (-0.230–0.113) |
| fromString wrapper                   | -0.111 (-0.488–0.126) | -0.0151 (-0.286–0.141)  | 0.209 (0.0982–0.288)   | 0.0619 (-0.0928–0.268) | 0.101 (-0.0414–0.259)  | 0.225 (0.0725–0.259)  |
| from-string type-side encode (alone) | 0.113 (0.107–0.147)   | 0.125 (0.110–0.146)     | 0.0664 (0.0615–0.0761) | 0.123 (0.109–0.140)    | 0.164 (0.152–0.195)    | 0.266 (0.255–0.301)   |

Layer cost over `C`:

| Layer                                | bun `16k`             | bun `4m`               | bun `64m`            | node `16k`           | node `4m`             | node `64m`            |
| ------------------------------------ | --------------------- | ---------------------- | -------------------- | -------------------- | --------------------- | --------------------- |
| structural encode                    | 0.599 (0.528–0.724)   | 0.946 (0.850–1.128)    | 0.754 (0.420–1.007)  | 0.705 (0.647–0.769)  | 0.897 (0.809–0.972)   | 0.973 (0.929–1.085)   |
| writer                               | 1.650 (1.439–1.991)   | 1.912 (1.756–2.240)    | 1.740 (1.431–1.805)  | 1.240 (1.181–1.253)  | 1.603 (1.380–1.859)   | 1.380 (0.419–1.476)   |
| tokenizer encode                     | 1.111 (0.927–1.750)   | 1.744 (1.185–4.085)    | 2.024 (1.634–2.238)  | 1.804 (1.104–2.104)  | 1.060 (0.576–1.452)   | 0.951 (0.903–1.607)   |
| encodeString glue                    | 0.771 (0.134–1.143)   | 0.252 (-0.364–0.386)   | 0.453 (-0.816–1.185) | 0.336 (0.0831–0.598) | 0.0728 (-0.379–0.741) | -0.691 (-0.711–0.467) |
| fromString wrapper                   | -0.400 (-1.758–0.480) | -0.0641 (-1.618–0.742) | 1.369 (0.542–1.452)  | 0.275 (-0.400–1.231) | 0.447 (-0.174–1.125)  | 0.776 (0.299–0.799)   |
| from-string type-side encode (alone) | 0.444 (0.389–0.496)   | 0.637 (0.592–0.737)    | 0.366 (0.363–0.428)  | 0.533 (0.499–0.576)  | 0.709 (0.636–0.818)   | 1.038 (0.786–1.098)   |

`T / C` if the layer cost nothing:

| Layer                                | bun `16k`           | bun `4m`            | bun `64m`           | node `16k`          | node `4m`           | node `64m`          |
| ------------------------------------ | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| structural encode                    | 3.073 (2.681–3.345) | 4.282 (3.228–4.779) | 5.101 (4.008–5.948) | 3.542 (3.162–3.893) | 3.428 (3.192–3.539) | 2.369 (2.114–3.193) |
| writer                               | 2.069 (1.463–2.388) | 3.404 (2.294–3.950) | 3.780 (3.332–5.150) | 3.072 (2.603–3.365) | 2.776 (2.170–2.968) | 2.646 (2.073–2.668) |
| tokenizer encode                     | 2.330 (1.848–2.882) | 3.006 (1.569–3.948) | 3.886 (2.739–4.717) | 2.567 (2.149–3.493) | 3.145 (2.972–3.454) | 2.551 (1.480–3.171) |
| encodeString glue                    | 2.842 (2.162–3.676) | 4.867 (4.436–5.948) | 5.578 (4.336–6.503) | 3.798 (3.536–4.394) | 4.275 (3.319–4.763) | 3.798 (3.654–4.144) |
| fromString wrapper                   | 4.044 (3.329–5.356) | 4.510 (4.316–7.272) | 4.978 (3.393–5.503) | 3.949 (3.367–4.712) | 3.895 (3.223–4.379) | 2.677 (2.288–3.823) |
| from-string type-side encode (alone) | 3.214 (2.819–3.475) | 4.599 (3.659–5.170) | 5.154 (4.400–6.527) | 3.738 (3.315–4.098) | 3.622 (3.387–3.686) | 2.415 (2.301–3.024) |

### Layers, JIT on

Decode, CPU milliseconds per operation:

| Layer                                | bun `16k`                | bun `4m`               | bun `64m`             | node `16k`              | node `4m`            | node `64m`            |
| ------------------------------------ | ------------------------ | ---------------------- | --------------------- | ----------------------- | -------------------- | --------------------- |
| tokenizer                            | 0.0738 (0.0717–0.101)    | 22.75 (21.14–24.23)    | 376.6 (367.4–458.0)   | 0.0860 (0.0834–0.0999)  | 32.53 (28.12–35.63)  | 763.2 (671.9–806.2)   |
| resolver                             | 0.0734 (0.0682–0.0780)   | 26.66 (24.58–31.83)    | 503.5 (425.7–515.4)   | 0.0791 (0.0708–0.0909)  | 34.07 (31.04–39.47)  | 524.7 (382.0–672.4)   |
| collector                            | 0.0239 (0.0127–0.0376)   | 8.588 (4.710–11.03)    | -32.08 (-211.1–15.60) | 0.0157 (0.0115–0.0244)  | 11.79 (8.479–14.47)  | 393.0 (304.8–581.7)   |
| builder                              | 0.0667 (0.0617–0.0830)   | 25.00 (23.97–35.50)    | 406.9 (306.9–432.9)   | 0.0449 (0.0369–0.0479)  | 17.53 (15.09–21.05)  | 250.2 (187.3–441.8)   |
| structural decode                    | 0.0198 (0.0106–0.0366)   | 3.138 (-3.159–6.484)   | 357.8 (93.07–458.8)   | 0.0183 (0.0152–0.0619)  | 9.907 (-2.991–15.38) | 134.3 (-40.22–210.0)  |
| decodeString glue                    | 0.0193 (0.0108–0.0524)   | 1.297 (-9.673–13.69)   | -185.6 (-218.6–465.7) | 0.0114 (-0.0239–0.0220) | 3.694 (-2.085–7.967) | -49.88 (-223.3–70.21) |
| fromString wrapper                   | -0.0565 (-0.110–-0.0409) | -10.97 (-12.56–-4.533) | 101.8 (-251.5–105.0)  | 0.0076 (-0.0233–0.0564) | 5.416 (-0.210–9.162) | 30.13 (-80.85–330.2)  |
| from-string type-side decode (alone) | 0.0036 (0.0033–0.0042)   | 1.246 (1.103–1.977)    | 36.38 (31.42–144.1)   | 0.0023 (0.0021–0.0025)  | 0.826 (0.802–1.080)  | 59.52 (57.29–60.23)   |

Decode, `T / C` if the layer cost nothing:

| Layer                                | bun `16k`           | bun `4m`            | bun `64m`           | node `16k`          | node `4m`           | node `64m`          |
| ------------------------------------ | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| tokenizer                            | 1.720 (1.482–1.899) | 1.766 (1.722–2.171) | 2.074 (1.945–2.083) | 1.990 (1.914–2.363) | 2.095 (1.877–2.258) | 1.729 (1.477–1.923) |
| resolver                             | 1.719 (1.612–1.891) | 1.652 (1.586–1.966) | 1.864 (1.815–1.961) | 2.097 (2.019–2.407) | 2.003 (1.842–2.171) | 2.123 (1.647–2.195) |
| collector                            | 2.328 (2.085–2.493) | 2.317 (2.122–2.609) | 2.872 (2.540–3.391) | 2.786 (2.730–3.066) | 2.546 (2.337–2.772) | 2.003 (1.852–2.446) |
| builder                              | 1.818 (1.629–1.959) | 1.675 (1.528–2.143) | 2.174 (1.853–2.203) | 2.498 (2.384–2.755) | 2.435 (2.171–2.624) | 2.290 (2.266–2.302) |
| structural decode                    | 2.355 (2.104–2.572) | 2.416 (2.294–2.861) | 2.102 (2.072–2.412) | 2.754 (2.404–2.839) | 2.647 (2.478–2.836) | 2.640 (2.237–2.696) |
| decodeString glue                    | 2.363 (1.923–2.615) | 2.498 (2.349–2.814) | 3.175 (1.798–3.406) | 2.781 (2.730–3.329) | 2.892 (2.501–3.019) | 2.789 (2.546–2.850) |
| fromString wrapper                   | 3.208 (3.056–3.787) | 2.926 (2.745–3.104) | 2.775 (2.601–2.979) | 2.883 (2.644–3.252) | 2.722 (2.701–2.896) | 2.601 (2.417–2.608) |
| from-string type-side decode (alone) | 2.551 (2.363–2.714) | 2.484 (2.447–2.838) | 2.524 (2.513–2.904) | 2.954 (2.887–3.209) | 2.843 (2.681–3.030) | 2.564 (2.429–2.725) |

Encode, CPU milliseconds per operation:

| Layer                                | bun `16k`                 | bun `4m`              | bun `64m`            | node `16k`                | node `4m`            | node `64m`            |
| ------------------------------------ | ------------------------- | --------------------- | -------------------- | ------------------------- | -------------------- | --------------------- |
| structural encode                    | 0.0161 (0.0152–0.0188)    | 7.403 (6.526–9.121)   | 80.10 (78.15–146.7)  | 0.0168 (0.0161–0.0188)    | 6.670 (6.398–9.166)  | 170.5 (146.1–174.5)   |
| writer                               | 0.0768 (0.0727–0.0794)    | 22.99 (21.29–24.82)   | 401.5 (371.5–441.1)  | 0.0664 (0.0644–0.0734)    | 27.93 (26.81–35.16)  | 416.7 (368.0–441.4)   |
| tokenizer encode                     | 0.0476 (0.0395–0.0709)    | 37.16 (19.34–50.07)   | 322.7 (300.1–775.8)  | 0.0788 (0.0772–0.114)     | 19.05 (17.04–32.18)  | 415.0 (324.7–609.2)   |
| encodeString glue                    | 0.0284 (0.0156–0.0345)    | -4.604 (-13.17–2.649) | 76.08 (-352.8–124.7) | 0.0182 (-0.0038–0.0349)   | 1.388 (-11.56–4.445) | -57.74 (-112.1–290.4) |
| fromString wrapper                   | -0.0493 (-0.0709–-0.0342) | -5.019 (-17.45–0.581) | 167.1 (-42.65–186.5) | -0.0160 (-0.0330–-0.0035) | 3.643 (-0.592–13.47) | 135.2 (21.66–462.1)   |
| from-string type-side encode (alone) | 0.0037 (0.0035–0.0042)    | 1.506 (1.140–1.870)   | 42.94 (35.86–140.6)  | 0.0024 (0.0024–0.0025)    | 0.984 (0.910–1.411)  | 55.19 (53.18–55.67)   |

Encode, `T / C` if the layer cost nothing:

| Layer                                | bun `16k`           | bun `4m`            | bun `64m`           | node `16k`          | node `4m`           | node `64m`          |
| ------------------------------------ | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- | ------------------- |
| structural encode                    | 2.462 (2.387–2.677) | 3.777 (3.011–4.899) | 4.126 (2.671–4.477) | 2.854 (2.673–2.961) | 2.803 (2.669–3.372) | 2.905 (2.060–3.127) |
| writer                               | 1.053 (0.925–1.431) | 2.487 (1.822–3.652) | 2.907 (1.745–2.930) | 1.928 (1.711–2.104) | 1.632 (1.555–2.171) | 2.261 (1.551–2.504) |
| tokenizer encode                     | 1.629 (1.249–1.856) | 1.582 (1.200–2.145) | 2.114 (1.504–3.111) | 1.576 (1.234–1.779) | 2.037 (1.672–2.685) | 1.773 (1.560–2.509) |
| encodeString glue                    | 2.113 (2.027–2.665) | 4.221 (3.465–6.035) | 3.940 (2.928–6.313) | 2.788 (2.661–3.089) | 3.093 (2.951–3.777) | 3.655 (1.839–3.704) |
| fromString wrapper                   | 4.096 (3.678–4.627) | 4.908 (3.497–6.168) | 3.762 (3.359–4.015) | 3.359 (3.250–3.771) | 3.045 (2.801–3.196) | 2.389 (2.353–2.937) |
| from-string type-side encode (alone) | 2.760 (2.684–2.980) | 4.340 (3.413–5.369) | 3.873 (3.048–4.657) | 3.114 (2.938–3.215) | 3.119 (3.014–3.695) | 3.168 (2.289–3.424) |

The JIT shrinks the type-side pass to 1–3% of `T` on both sides at `bank-4m`, and the structural codec's encode by 40% on Bun and 62% on Node. It leaves the tokenizer, the resolver, the builder, and the writer about where they were, because none of them runs Schema.

### CPU buckets, `bank-4m`

Each profile spans the whole case process: input generation, the check run, warmup, and every sample. Read the buckets as proportions, not as per-operation costs. These buckets charge a frame without a script URL (a builtin such as `Object.entries`, or code the Schema JIT compiled) to the layer of its nearest caller with one (`callerBuckets` in the files; `buckets` keeps the URL-only attribution). `structural` is near zero because the structural codec's work runs inside Effect's Schema modules, which file under `schema`. The Schema JIT's compiled parsers are called from Effect's runtime, so under JIT `on` they file under `effect-runtime`. Bun's profiler reports no garbage collector frame. On Node, `(garbage collector)` is most of `other`.

| Profile                       | Total ms | tokenizer | resolver-collector | builder | structural | fast-decode | fast-encode | writer | schema | positions | effect-runtime | harness | other |
| ----------------------------- | -------- | --------- | ------------------ | ------- | ---------- | ----------- | ----------- | ------ | ------ | --------- | -------------- | ------- | ----- |
| bun, JIT off, `typed-decode`  | 9064     | 24.1%     | 21.9%              | 12.1%   | 0.0%       | 0.5%        | 0.0%        | 0.0%   | 25.9%  | 0.0%      | 13.5%          | 1.2%    | 0.9%  |
| bun, JIT off, `encode-typed`  | 6843     | 22.8%     | 3.2%               | 1.4%    | 0.0%       | 0.0%        | 0.0%        | 27.4%  | 18.7%  | 0.0%      | 23.2%          | 1.7%    | 1.5%  |
| bun, JIT on, `typed-decode`   | 10991    | 25.2%     | 30.4%              | 16.0%   | 0.0%       | 0.0%        | 0.0%        | 0.0%   | 14.1%  | 0.0%      | 13.2%          | 0.5%    | 0.5%  |
| bun, JIT on, `encode-typed`   | 6200     | 25.9%     | 1.4%               | 0.5%    | 0.0%       | 0.0%        | 0.0%        | 40.4%  | 2.1%   | 0.0%      | 27.9%          | 0.8%    | 1.0%  |
| node, JIT off, `typed-decode` | 20640    | 14.5%     | 16.4%              | 7.1%    | 0.0%       | 0.0%        | 0.0%        | 0.0%   | 10.0%  | 0.0%      | 9.3%           | 0.0%    | 42.6% |
| node, JIT off, `encode-typed` | 12266    | 13.0%     | 1.0%               | 0.5%    | 0.0%       | 0.0%        | 0.3%        | 11.0%  | 12.9%  | 0.0%      | 8.7%           | 0.1%    | 52.6% |
| node, JIT on, `typed-decode`  | 16340    | 18.4%     | 19.4%              | 7.2%    | 0.0%       | 0.1%        | 0.0%        | 0.0%   | 4.0%   | 0.0%      | 10.9%          | 0.0%    | 40.0% |
| node, JIT on, `encode-typed`  | 10850    | 23.2%     | 0.9%               | 0.1%    | 0.0%       | 0.0%        | 0.0%        | 13.2%  | 2.5%   | 0.0%      | 7.5%           | 0.0%    | 52.5% |

### Top self-time functions, JIT off, `bank-4m`

Bun, `effect-xml/typed-decode`:

| Rank | Function        | Script:line       | Own layer          | Charged to         | Self ms |
| ---- | --------------- | ----------------- | ------------------ | ------------------ | ------- |
| 1    | `startTag`      | Xml.js:916        | tokenizer          | tokenizer          | 1215.6  |
| 2    | `(anonymous)`   | SchemaAST.js:1654 | schema             | schema             | 679.0   |
| 3    | `start`         | resolve.ts:421    | resolver-collector | resolver-collector | 634.0   |
| 4    | `codePointAt`   | (builtin)         | other              | schema             | 538.1   |
| 5    | `push`          | resolve.ts:855    | resolver-collector | resolver-collector | 530.7   |
| 6    | `(anonymous)`   | core.js:333       | effect-runtime     | effect-runtime     | 512.0   |
| 7    | `entries`       | (builtin)         | other              | builder            | 464.8   |
| 8    | `splitQName`    | element.ts:71     | schema             | schema             | 431.4   |
| 9    | `ExitPrimitive` | core.js:329       | effect-runtime     | effect-runtime     | 344.2   |
| 10   | `buildElement`  | builder.ts:292    | builder            | builder            | 323.0   |

Bun, `effect-xml/encode-typed`:

| Rank | Function          | Script:line       | Own layer      | Charged to     | Self ms |
| ---- | ----------------- | ----------------- | -------------- | -------------- | ------- |
| 1    | `(anonymous)`     | SchemaAST.js:1654 | schema         | schema         | 1037.0  |
| 2    | `entries`         | (builtin)         | other          | writer         | 988.1   |
| 3    | `(anonymous)`     | core.js:333       | effect-runtime | effect-runtime | 789.4   |
| 4    | `searchInvalid`   | Xml.js:370        | tokenizer      | tokenizer      | 694.0   |
| 5    | `attributesOf`    | writer.ts:259     | writer         | writer         | 351.3   |
| 6    | `ExitPrimitive`   | core.js:329       | effect-runtime | effect-runtime | 240.3   |
| 7    | `writeNode`       | writer.ts:426     | writer         | writer         | 227.6   |
| 8    | `write`           | Xml.js:1498       | tokenizer      | tokenizer      | 225.3   |
| 9    | `escapeAttribute` | Xml.js:1423       | tokenizer      | tokenizer      | 172.2   |
| 10   | `(anonymous)`     | interpreter.js:9  | effect-runtime | effect-runtime | 158.9   |

Node, `effect-xml/typed-decode`:

| Rank | Function              | Script:line       | Own layer          | Charged to         | Self ms |
| ---- | --------------------- | ----------------- | ------------------ | ------------------ | ------- |
| 1    | `(garbage collector)` | (builtin)         | other              | other              | 7199.6  |
| 2    | `start`               | resolve.ts:421    | resolver-collector | resolver-collector | 1347.5  |
| 3    | `startTag`            | Xml.js:916        | tokenizer          | tokenizer          | 1093.2  |
| 4    | `buildElement`        | builder.ts:292    | builder            | builder            | 1071.1  |
| 5    | `push`                | resolve.ts:855    | resolver-collector | resolver-collector | 671.6   |
| 6    | `push`                | resolve.ts:525    | resolver-collector | resolver-collector | 650.1   |
| 7    | `(anonymous)`         | SchemaAST.js:1654 | schema             | schema             | 545.6   |
| 8    | `assignProperty`      | record.js:1       | effect-runtime     | effect-runtime     | 519.8   |
| 9    | `isBlank`             | compile.ts:47     | schema             | schema             | 486.0   |
| 10   | `onItem`              | SchemaAST.js:1328 | schema             | schema             | 406.1   |

Node, `effect-xml/encode-typed`:

| Rank | Function               | Script:line       | Own layer      | Charged to     | Self ms |
| ---- | ---------------------- | ----------------- | -------------- | -------------- | ------- |
| 1    | `(garbage collector)`  | (builtin)         | other          | other          | 5114.6  |
| 2    | `attributesOf`         | writer.ts:259     | writer         | writer         | 681.1   |
| 3    | `(anonymous)`          | SchemaAST.js:1654 | schema         | schema         | 519.3   |
| 4    | `write`                | Xml.js:1498       | tokenizer      | tokenizer      | 427.8   |
| 5    | `writeNode`            | writer.ts:426     | writer         | writer         | 411.2   |
| 6    | `assignProperty`       | record.js:1       | effect-runtime | effect-runtime | 356.4   |
| 7    | `onItem`               | SchemaAST.js:1328 | schema         | schema         | 294.1   |
| 8    | `push`                 | Xml.js:1487       | tokenizer      | tokenizer      | 277.4   |
| 9    | `hasPropertySignature` | SchemaAST.js:1920 | schema         | schema         | 237.3   |
| 10   | `searchInvalid`        | Xml.js:370        | tokenizer      | tokenizer      | 227.1   |

Two `schema` entries belong to other layers. `splitQName` (`src/element.ts`) is called by the resolver (`src/resolve.ts:451` and `:476`), and `isBlank` (`src/compile.ts`) by the builder (`src/builder.ts:117` and `:172`). The JIT-on profiles and the top 15 of every profile are in the files.

### Biggest addressable costs

The list ranks the layers in the shipped mode (JIT `off`) by their `bank-4m` cost over `C`, Bun then Node. The ceiling is the median `T / C` if that layer alone cost nothing. The `bank-64m` blocks put the same layers on top, within wider intervals, except that Node's split between the collector and the builder differs there.

1. **Encode writer.** 1.91 `C` on Bun and 1.60 `C` on Node. The ceiling is encode `T / C` from 5.25 to 3.40 on Bun and from 4.35 to 2.78 on Node. The writer alone costs more CPU than computis's whole encode. Its top frames are `attributesOf` and `writeNode` (`src/writer.ts`), plus `Object.entries`, which is the largest builtin in the Bun encode profile and is charged to the writer.
2. **Tokenizer encode.** 1.74 `C` on Bun (interval 1.18–4.08) and 1.06 `C` on Node. The ceiling is 3.01 on Bun and 3.15 on Node. The time is in upstream `effect/encoding/Xml`: `searchInvalid`, `escapeAttribute`, `write`, and `push`.
3. **Decode resolver.** 0.89 `C` on Bun and 0.85 `C` on Node. The ceiling is decode `T / C` from 3.11 to 2.21 on Bun and from 3.25 to 2.55 on Node. Its top frames are `start` and `push` (`src/resolve.ts`), plus `splitQName`.
4. **Decode builder.** 0.77 `C` on Bun and 0.49 `C` on Node. The ceiling is 2.26 on Bun and 2.81 on Node. Its top frames are `buildElement` and `writeElements`, plus `Object.entries` and `isBlank`.
5. **Decode tokenizer.** 0.75 `C` on Bun and 0.84 `C` on Node. The ceiling is 2.33 on Bun and 2.46 on Node. It is upstream `effect/encoding/Xml`; `startTag` is its top frame in both decode profiles.
6. **Structural encode.** 0.95 `C` on Bun and 0.90 `C` on Node. The ceiling is 4.28 on Bun and 3.43 on Node. The JIT cuts it to 0.57 `C` and 0.38 `C`.
7. **The `fromString` type-side pass (option B).** Measured alone, the decode pass costs 0.26 `C` on Bun and 0.38 `C` on Node, a ceiling of 2.83 and 2.90. The encode pass costs 0.64 `C` and 0.71 `C`, a ceiling of 4.60 and 3.62. These are the predicted option-B gains at `bank-4m`: 8% (Bun) and 11% (Node) of decode `T`, and 12% and 16% of encode `T`. Under JIT `on` the pass is 1–3% of `T`, so option B gains little there. In place, the wrapper's ladder delta agrees on Node decode (17.3 ms against 16.3 ms alone). On Bun and on encode it lies within the noise of the two child processes it subtracts.
8. **Structural decode.** 0.28 `C` on Bun and 0.47 `C` on Node, with intervals of 0.16–0.55 and 0.10–0.81. The ceiling is 2.69 on Bun and 2.91 on Node.
9. **Decode collector.** 0.30 `C` on Bun and 0.31 `C` on Node. The ceiling is 2.73 on Bun and 2.96 on Node.
10. **`decodeString` and `encodeString` glue.** Within the noise at `bank-4m` on both runtimes, with every interval spanning zero.

Across layers, garbage collection is 35% of the Node typed-decode profile (7.2 s of 20.6 s) and 42% of the encode profile (5.1 s of 12.3 s). Allocation is a cost that spans the resolver, the builder, and the writer.

No single decode layer brings `T / C` below 2.2 in the shipped mode. The resolver, the builder, and the tokenizer each cost 0.5 to 0.9 `C`, so parity with computis on decode needs several of them cut. On encode, the writer and the tokenizer's encode each cost about `C` or more. The writer is the one largest step that is entirely this library's own code.

## Phase 3: fromString option B under load (A/B)

This section measures what fromString option B gained. It compares option B (NEW) with the commit before it (OLD) and with `@computis/effect-xml`, on CPU time per operation, with the method of [Phase 3 under load (A/B)](#phase-3-under-load-ab). Every value is a median of per-round ratios with its distribution-free interval. The absolute times in the files were taken on a loaded machine and are not throughput figures; this section gives no MB/s.

At `bank-16k` and `bank-4m`, option B saves 6–15% of typed-decode CPU and 12–19% of typed-encode CPU in the shipped mode (JIT `off`), and up to 8% under JIT `on`. The `decodeString`, `encodeString`, and `stream` controls measure from 0.982 to 1.024 there, and every control interval but one contains 1.00. The head-cto B5 prediction holds for decode on Node at `bank-4m` and sits at its upper edge on Bun; it misses on encode. The layer profile's predictions fall inside every `bank-4m` JIT `off` interval.

### Sides and runs

- **NEW**: commit `efea83e` (option B merged), from the detached worktree `work/perf3b-ab-new`.
- **OLD**: commit `ee496cc`, from `work/perf3b-ab-old`. Between the two, `src/` changes only `src/document.ts`, and `bench/` and `src/codec.ts` are identical (`git diff --stat ee496cc efea83e -- bench src/codec.ts` prints nothing).
- **Driver**: `bench/ab.ts` at `c6fc100`, run from a third worktree at that commit. `c6fc100` adds `--paired-rungs true`, which runs each `--rung` on both trees and reports its NEW/OLD ratio. The three worktrees were removed after the runs.
- **Units per round**: `effect-xml/typed-decode` and `effect-xml/encode-typed` (`XmlSchema.fromString(ItemBank)`), `effect-xml/stream`, and the rungs `typed/decode-string` and `typed/encode-string` (`decodeString` and `encodeString` alone, from `bench/profile/layers.ts`) on both trees; `computis-effect-xml/typed-decode` and `computis-effect-xml/encode-typed` on NEW only.
- **Controls**: option B changes `fromString` only, so `typed/decode-string`, `typed/encode-string`, and `effect-xml/stream` run unchanged code on both sides and should measure 1.00.
- **Rounds**: 15 at `bank-16k` and `bank-4m` under the `ab` policy, and 5 at `bank-64m` under the `large` policy (2 samples per child), on Bun 1.4.2 and Node 26.13.0, JIT `off` (shipped) and `on` (preloaded). Apple M4 Pro, 14 cores, Darwin 27.2.0; `effect` 4.1.2 and `@computis/effect-xml` 0.4.0.
- **Outliers**: of the 140 planned rounds, 52 were repeated by the driver's rule, 27 for load and 25 for one unit's CPU time; no unit failed.

The Bun and Node chains ran at the same time, beside other seats' work in this repository. The 1-minute load average read at the start and end of every round, superseded rounds included:

| Runtime | JIT | Input      | Rounds kept | Repeated | Coverage | Load min | Load median | Load max | First round (UTC) | Last round (UTC) |
| ------- | --- | ---------- | ----------- | -------- | -------- | -------- | ----------- | -------- | ----------------- | ---------------- |
| bun     | off | `bank-16k` | 15          | 7        | 96.5%    | 6.95     | 49.49       | 123.11   | 2026-11-07 17:00  | 2026-11-07 17:13 |
| bun     | off | `bank-4m`  | 15          | 2        | 96.5%    | 23.97    | 54.43       | 110.28   | 2026-11-07 17:14  | 2026-11-07 17:26 |
| bun     | off | `bank-64m` | 5           | 3        | 93.8%    | 29.18    | 47.89       | 97.60    | 2026-11-07 17:27  | 2026-11-07 17:43 |
| bun     | on  | `bank-16k` | 15          | 5        | 96.5%    | 20.53    | 44.14       | 88.29    | 2026-11-07 17:45  | 2026-11-07 17:57 |
| bun     | on  | `bank-4m`  | 15          | 8        | 96.5%    | 11.96    | 22.53       | 99.23    | 2026-11-07 17:57  | 2026-11-07 18:14 |
| bun     | on  | `bank-64m` | 5           | 1        | 93.8%    | 17.22    | 40.03       | 87.25    | 2026-11-07 18:15  | 2026-11-07 18:23 |
| node    | off | `bank-16k` | 15          | 6        | 96.5%    | 6.95     | 51.05       | 123.11   | 2026-11-07 17:00  | 2026-11-07 17:14 |
| node    | off | `bank-4m`  | 15          | 4        | 96.5%    | 27.76    | 62.96       | 124.73   | 2026-11-07 17:14  | 2026-11-07 17:31 |
| node    | off | `bank-64m` | 5           | 4        | 93.8%    | 26.30    | 47.14       | 87.12    | 2026-11-07 17:32  | 2026-11-07 17:51 |
| node    | on  | `bank-16k` | 15          | 2        | 96.5%    | 11.46    | 38.71       | 99.23    | 2026-11-07 17:53  | 2026-11-07 18:04 |
| node    | on  | `bank-4m`  | 15          | 7        | 96.5%    | 15.99    | 23.21       | 95.59    | 2026-11-07 18:05  | 2026-11-07 18:22 |
| node    | on  | `bank-64m` | 5           | 3        | 93.8%    | 8.16     | 12.54       | 47.47    | 2026-11-07 18:22  | 2026-11-07 18:32 |

The `bank-64m` blocks are context, not evidence: two of their controls leave 1.00 by more than the effect measured (Node JIT `on` `typed/encode-string` 0.680, Node JIT `off` `stream` 0.822 with an interval to 1.309). The verdicts below read `bank-16k` and `bank-4m`. The one control interval there without 1.00 is Bun JIT `on` `stream` at `bank-4m`, 1.018 (1.008–1.048).

### NEW / OLD, CPU time per operation

Below 1, NEW uses less CPU.

#### JIT off (library default)

| Unit                      | Input      | Bun NEW/OLD         | Node NEW/OLD        |
| ------------------------- | ---------- | ------------------- | ------------------- |
| `effect-xml/typed-decode` | `bank-16k` | 0.939 (0.923–0.973) | 0.903 (0.892–0.920) |
| `effect-xml/typed-decode` | `bank-4m`  | 0.901 (0.879–0.944) | 0.851 (0.824–0.906) |
| `effect-xml/typed-decode` | `bank-64m` | 0.927 (0.806–0.986) | 0.939 (0.857–1.072) |
| `effect-xml/encode-typed` | `bank-16k` | 0.868 (0.856–0.893) | 0.875 (0.851–0.880) |
| `effect-xml/encode-typed` | `bank-4m`  | 0.866 (0.845–0.920) | 0.810 (0.777–0.849) |
| `effect-xml/encode-typed` | `bank-64m` | 0.815 (0.552–0.844) | 0.854 (0.793–0.899) |
| `typed/decode-string`     | `bank-16k` | 1.016 (0.997–1.037) | 1.004 (0.977–1.012) |
| `typed/decode-string`     | `bank-4m`  | 0.994 (0.954–1.026) | 1.018 (0.980–1.060) |
| `typed/decode-string`     | `bank-64m` | 0.938 (0.850–1.094) | 1.089 (0.924–1.190) |
| `typed/encode-string`     | `bank-16k` | 1.008 (0.984–1.043) | 1.003 (0.975–1.034) |
| `typed/encode-string`     | `bank-4m`  | 1.004 (0.978–1.025) | 0.998 (0.909–1.071) |
| `typed/encode-string`     | `bank-64m` | 1.055 (0.925–1.169) | 0.994 (0.879–1.216) |
| `effect-xml/stream`       | `bank-16k` | 0.989 (0.929–1.023) | 1.010 (0.957–1.039) |
| `effect-xml/stream`       | `bank-4m`  | 0.997 (0.973–1.016) | 0.987 (0.940–1.030) |
| `effect-xml/stream`       | `bank-64m` | 1.048 (0.974–1.081) | 0.822 (0.710–1.309) |

#### JIT on

| Unit                      | Input      | Bun NEW/OLD         | Node NEW/OLD        |
| ------------------------- | ---------- | ------------------- | ------------------- |
| `effect-xml/typed-decode` | `bank-16k` | 0.984 (0.949–1.001) | 0.994 (0.978–1.007) |
| `effect-xml/typed-decode` | `bank-4m`  | 0.989 (0.940–1.003) | 0.937 (0.930–0.996) |
| `effect-xml/typed-decode` | `bank-64m` | 0.991 (0.907–1.152) | 0.921 (0.892–1.006) |
| `effect-xml/encode-typed` | `bank-16k` | 0.980 (0.973–0.992) | 0.999 (0.979–1.024) |
| `effect-xml/encode-typed` | `bank-4m`  | 0.971 (0.950–1.023) | 0.918 (0.829–0.975) |
| `effect-xml/encode-typed` | `bank-64m` | 0.988 (0.842–1.416) | 0.959 (0.936–1.088) |
| `typed/decode-string`     | `bank-16k` | 0.994 (0.987–1.036) | 0.997 (0.989–1.020) |
| `typed/decode-string`     | `bank-4m`  | 0.988 (0.972–1.010) | 0.982 (0.960–1.005) |
| `typed/decode-string`     | `bank-64m` | 1.046 (0.896–1.218) | 0.994 (0.936–0.998) |
| `typed/encode-string`     | `bank-16k` | 1.024 (0.971–1.063) | 1.007 (0.981–1.043) |
| `typed/encode-string`     | `bank-4m`  | 0.988 (0.926–1.069) | 1.008 (0.977–1.033) |
| `typed/encode-string`     | `bank-64m` | 1.059 (0.676–1.561) | 0.680 (0.660–0.847) |
| `effect-xml/stream`       | `bank-16k` | 0.994 (0.952–1.025) | 0.987 (0.977–1.010) |
| `effect-xml/stream`       | `bank-4m`  | 1.018 (1.008–1.048) | 1.003 (0.891–1.032) |
| `effect-xml/stream`       | `bank-64m` | 0.954 (0.913–1.088) | 0.990 (0.985–1.006) |

Wall time (secondary) agrees on the typed cases in JIT `off`: NEW/OLD typed decode is 0.942 and 0.896 on Bun at `bank-16k` and `bank-4m`, and 0.898 and 0.823 on Node; typed encode is 0.884 and 0.848 on Bun, and 0.824 and 0.854 on Node. Every wall cell, with its interval, is under `summary.wallMedianMs` in the files.

### Against computis, CPU time per operation

Each cell is effect-xml over `computis-effect-xml` in the same round; OLD uses the same computis run as NEW. Below 1, effect-xml uses less CPU.

| Class        | Input      | JIT | Bun NEW/computis    | Bun OLD/computis    | Node NEW/computis   | Node OLD/computis   |
| ------------ | ---------- | --- | ------------------- | ------------------- | ------------------- | ------------------- |
| typed decode | `bank-16k` | off | 2.661 (2.595–2.740) | 2.823 (2.750–2.937) | 3.212 (3.176–3.370) | 3.542 (3.481–3.661) |
| typed decode | `bank-4m`  | off | 2.696 (2.541–2.800) | 2.974 (2.870–3.074) | 3.016 (2.867–3.165) | 3.512 (3.363–3.583) |
| typed decode | `bank-64m` | off | 2.824 (2.748–3.333) | 3.381 (2.942–3.612) | 3.307 (2.748–3.449) | 3.441 (2.926–4.025) |
| typed encode | `bank-16k` | off | 3.043 (2.957–3.363) | 3.521 (3.417–3.655) | 3.602 (3.486–3.904) | 4.144 (4.022–4.449) |
| typed encode | `bank-4m`  | off | 4.134 (3.782–4.669) | 4.628 (4.249–5.566) | 3.446 (3.280–3.566) | 4.234 (4.048–4.453) |
| typed encode | `bank-64m` | off | 3.788 (3.433–4.015) | 4.647 (4.201–7.273) | 3.243 (2.776–3.796) | 3.867 (3.184–4.444) |
| typed decode | `bank-16k` | on  | 2.528 (2.388–2.691) | 2.527 (2.472–2.729) | 2.989 (2.880–3.169) | 2.963 (2.940–3.184) |
| typed decode | `bank-4m`  | on  | 2.642 (2.548–2.741) | 2.724 (2.666–2.908) | 2.688 (2.641–2.808) | 2.870 (2.716–2.913) |
| typed decode | `bank-64m` | on  | 2.616 (2.441–3.226) | 2.718 (2.255–3.256) | 2.552 (2.451–2.848) | 2.719 (2.518–3.193) |
| typed encode | `bank-16k` | on  | 3.182 (2.722–3.203) | 3.192 (2.748–3.262) | 3.293 (3.035–3.353) | 3.247 (3.077–3.407) |
| typed encode | `bank-4m`  | on  | 3.794 (3.537–4.020) | 3.875 (3.728–3.963) | 3.004 (2.924–3.545) | 3.398 (3.225–3.655) |
| typed encode | `bank-64m` | on  | 4.272 (3.191–4.569) | 4.133 (2.697–5.419) | 2.502 (1.608–3.625) | 2.498 (1.718–3.814) |

### fromString over decodeString and encodeString

Option B's claim is that `fromString(def)` now costs what `decodeString(def)` and `encodeString(def)` cost. Per round and per side, this table divides the `fromString` case by its string rung. On Node in JIT `off`, OLD's `fromString` costs 13% and 20% more than `decodeString` at `bank-16k` and `bank-4m`, and 16% more than `encodeString` at `bank-4m`. NEW's intervals contain 1.00 on decode at both sizes and on encode at `bank-4m`.

| JIT | Input      | Class  | Bun NEW             | Bun OLD             | Node NEW            | Node OLD            |
| --- | ---------- | ------ | ------------------- | ------------------- | ------------------- | ------------------- |
| off | `bank-16k` | decode | 0.766 (0.736–0.793) | 0.828 (0.791–0.862) | 1.003 (0.980–1.056) | 1.127 (1.064–1.141) |
| off | `bank-16k` | encode | 0.709 (0.695–0.748) | 0.820 (0.796–0.840) | 0.883 (0.866–0.919) | 1.027 (0.993–1.073) |
| off | `bank-4m`  | decode | 0.909 (0.848–0.929) | 0.964 (0.926–1.004) | 1.053 (0.976–1.082) | 1.203 (1.168–1.237) |
| off | `bank-4m`  | encode | 0.865 (0.826–0.898) | 0.990 (0.947–1.083) | 0.982 (0.933–1.030) | 1.156 (1.120–1.240) |
| on  | `bank-16k` | decode | 0.765 (0.739–0.800) | 0.777 (0.762–0.839) | 1.018 (0.989–1.041) | 1.043 (1.005–1.053) |
| on  | `bank-16k` | encode | 0.720 (0.706–0.765) | 0.754 (0.716–0.788) | 0.865 (0.845–0.889) | 0.880 (0.853–0.892) |
| on  | `bank-4m`  | decode | 0.898 (0.879–0.914) | 0.914 (0.880–0.949) | 1.019 (0.943–1.052) | 1.051 (0.990–1.069) |
| on  | `bank-4m`  | encode | 0.860 (0.791–0.902) | 0.876 (0.821–0.913) | 1.015 (0.951–1.112) | 1.104 (1.063–1.214) |

On Bun the `fromString` case costs less CPU than its own string rung on both trees, and on Node at `bank-16k` encode, although the case runs the rung's code plus a wrapper. The two units differ only in their harness (`bench/cases/effect-xml-typed.ts` against `bench/profile/layers.ts`), so the rung is a same-code control across trees, not a sub-layer of the case. This was not investigated. The ladder in [Phase 3 layer profile (new code)](#phase-3-layer-profile-new-code) subtracts the same two units, so the same harness difference enters its `fromString wrapper` row.

### Against the predictions

| Prediction                                   | Class  | Predicted NEW/OLD   | Bun, `bank-4m`, JIT off | Node, `bank-4m`, JIT off | Holds                              |
| -------------------------------------------- | ------ | ------------------- | ----------------------- | ------------------------ | ---------------------------------- |
| head-cto B5                                  | decode | 0.70–0.90           | 0.901 (0.879–0.944)     | 0.851 (0.824–0.906)      | Node yes; Bun at the upper edge    |
| head-cto B5                                  | encode | 0.45–0.65           | 0.866 (0.845–0.920)     | 0.810 (0.777–0.849)      | no: the gain is 12–19%, not 35–55% |
| Layer profile, type-side pass measured alone | decode | 0.92 Bun, 0.89 Node | 0.901 (0.879–0.944)     | 0.851 (0.824–0.906)      | yes, inside both intervals         |
| Layer profile, type-side pass measured alone | encode | 0.88 Bun, 0.84 Node | 0.866 (0.845–0.920)     | 0.810 (0.777–0.849)      | yes, inside both intervals         |

The layer-profile row reads its item 7: the type-side pass costs 8% (Bun) and 11% (Node) of decode `T`, and 12% and 16% of encode `T`, at `bank-4m` in JIT `off`. At `bank-16k` the decode gain is smaller on Bun (0.939) and the encode gain the same (0.868 and 0.875).

The profile also predicted that under JIT `on` the pass is 1–3% of `T`, so NEW/OLD 0.97–0.99. Bun measures that (0.989 decode, 0.971 encode at `bank-4m`). Node measures more, 0.937 (0.930–0.996) on decode and 0.918 (0.829–0.975) on encode; both intervals reach the predicted range only at their upper end.

The profile's `T / C` ceiling, the ratio left if the pass cost nothing, was 2.83 (Bun) and 2.90 (Node) on decode, and 4.60 and 3.62 on encode. NEW measures 2.696 (2.541–2.800) and 3.016 (2.867–3.165) on decode, and 4.134 (3.782–4.669) and 3.446 (3.280–3.566) on encode. Node decode and Bun encode contain their ceilings; Bun decode and Node encode land below theirs. The ceilings and these ratios come from different rounds under different load, so the comparison is approximate.

### Files

The raw rounds and summaries are in `docs/rd/performance/phase-3-ab/optionB-<runtime>-jit-<mode>-<input>.json`, one file per block (12 files), in the shape described in [Files and load](#files-and-load); `block.pairedRungs` is `true`. The NEW/OLD cells read `summary.cpuPerOpMs.newOverOld` and the computis cells `summary.cpuPerOpMs.competitors` (`new/` and `old/` keys). The fromString-over-string table is in `optionB-wrapper-over-string.json`, whose `method` field states the per-round computation from the kept rounds of the 12 files.

## Phase 3: option B, builder and writer under load (A/B)

This section measures what option B, the collision-group encode, the precompiled builder, and the attribute writer gained together. It compares their combined code (NEW) with phase-3 step 1 (STEP1) and with `@computis/effect-xml`, on CPU time per operation, with the method of [Phase 3 under load (A/B)](#phase-3-under-load-ab). Every value is a median of per-round ratios with its distribution-free interval. The absolute times in the files were taken on a loaded machine and are not throughput figures; this section gives no MB/s.

These numbers predate the resolver rewrite (`07240f0`), the fused decode (`7e280b3`), and the fused stream (`6eb5420`), which `main` has since landed. [Phase 3: what shipped, measured (HEAD A/B)](#phase-3-what-shipped-measured-head-ab) measures them; this section was not re-run for them.

At `bank-16k` and `bank-4m` in the shipped mode (JIT `off`), NEW costs 0.80–0.83 of STEP1's typed-decode CPU and 0.51–0.64 of its typed-encode CPU. Typed decode now costs 2.30–2.99 times computis's CPU and typed encode 1.78–2.84 times, down from 2.82–3.59 and 3.45–5.17. Against the phase-3 baseline `bd60a0e`, typed decode costs 0.43–0.56 and typed encode 0.13–0.22 of the baseline's CPU. At `bank-4m`, every spike and profile prediction holds or is beaten, except head-cto B5 on option B's encode share.

### Sides and runs

- **NEW**: commit `659480f`: option B (`efea83e`), the collision-group encode (`f1870a1`), the builder (`7f1cff8`), and the writer (`659480f`). Run from the detached worktree `work/perf3b-cum-new`.
- **STEP1**: commit `ee496cc`, phase-3 step 1 before option B, from `work/perf3b-cum-step1`.
- **Baseline**: commit `bd60a0e`, the phase-3 OLD side of [Phase 3 under load (A/B)](#phase-3-under-load-ab), from `work/perf3b-cum-base`, in two extra blocks against NEW.
- **Driver**: `bench/ab.ts` from the NEW tree. It is the same file as at `c6fc100` (`--paired-rungs true`). Each worktree linked the main checkout's `node_modules`, which is why every file's `environment.dirty` is `true`; `git status` in each tree showed only that link. The three worktrees were removed after the runs.
- **Units per round**: `effect-xml/typed-decode` and `effect-xml/encode-typed` (`XmlSchema.fromString(ItemBank)`), `effect-xml/stream`, `effect-xml/stream/positions`, and the rungs `typed/decode-string` and `typed/encode-string` (`decodeString` and `encodeString` alone) on both trees; `computis-effect-xml/typed-decode` and `computis-effect-xml/encode-typed` on NEW only. The baseline blocks run the two typed cases only.
- **No control**: every effect-xml unit runs changed code. The stream decodes each record through `src/fast-decode.ts`, which runs the builder. The controls of [Phase 3: fromString option B under load (A/B)](#phase-3-fromstring-option-b-under-load-ab) measured 0.982 to 1.024 at `bank-16k` and `bank-4m`; read that spread as this method's drift on unchanged code.
- **Rounds**: 15 at `bank-16k` and `bank-4m` under the `ab` policy, and 5 at `bank-64m` under the `large` policy, on Bun 1.4.2 and Node 26.13.0, JIT `off` (shipped) and `on` (preloaded). The baseline blocks ran 15 rounds at `bank-16k` and `bank-4m`, JIT `off`. Apple M4 Pro, 14 cores, Darwin 27.2.0; `effect` 4.1.2 and `@computis/effect-xml` 0.4.0.
- **computis JIT**: computis runs with its default, the Schema JIT on, in every block. The JIT `off` tables compare the two libraries as shipped, which is the basis of the step-2 rule. The JIT `on` tables compare them like for like.
- **Outliers**: of the 140 planned rounds, 64 were repeated by the driver's rule, 27 for load and 37 for one unit's CPU time. Of the 60 baseline rounds, 10 were repeated, all for CPU time. No unit failed.

The Bun and Node chains ran at the same time, beside other seats' work and two spikes in this repository. The 1-minute load average read at the start and end of every round, the superseded ones included:

| Runtime | JIT | Input      | Rounds kept | Repeated | Coverage | Load min | Load median | Load max | First round (UTC) | Last round (UTC) |
| ------- | --- | ---------- | ----------- | -------- | -------- | -------- | ----------- | -------- | ----------------- | ---------------- |
| bun     | off | `bank-16k` | 15          | 6        | 96.5%    | 14.84    | 25.97       | 95.70    | 2026-11-07 18:07  | 2026-11-07 18:22 |
| bun     | off | `bank-4m`  | 15          | 6        | 96.5%    | 7.25     | 22.48       | 80.78    | 2026-11-07 18:23  | 2026-11-07 18:40 |
| bun     | off | `bank-64m` | 5           | 5        | 93.8%    | 12.41    | 34.22       | 96.17    | 2026-11-07 18:41  | 2026-11-07 18:59 |
| bun     | on  | `bank-16k` | 15          | 7        | 96.5%    | 11.69    | 24.51       | 62.43    | 2026-11-07 19:00  | 2026-11-07 19:16 |
| bun     | on  | `bank-4m`  | 15          | 3        | 96.5%    | 15.21    | 43.15       | 93.91    | 2026-11-07 19:17  | 2026-11-07 19:33 |
| bun     | on  | `bank-64m` | 5           | 4        | 93.8%    | 13.62    | 53.45       | 109.82   | 2026-11-07 19:34  | 2026-11-07 19:57 |
| node    | off | `bank-16k` | 15          | 7        | 96.5%    | 16.87    | 27.34       | 95.70    | 2026-11-07 18:07  | 2026-11-07 18:24 |
| node    | off | `bank-4m`  | 15          | 8        | 96.5%    | 7.56     | 21.31       | 94.73    | 2026-11-07 18:25  | 2026-11-07 18:45 |
| node    | off | `bank-64m` | 5           | 5        | 93.8%    | 11.74    | 19.40       | 104.25   | 2026-11-07 18:46  | 2026-11-07 19:04 |
| node    | on  | `bank-16k` | 15          | 2        | 96.5%    | 16.55    | 30.46       | 62.55    | 2026-11-07 19:06  | 2026-11-07 19:19 |
| node    | on  | `bank-4m`  | 15          | 7        | 96.5%    | 15.40    | 44.40       | 96.40    | 2026-11-07 19:20  | 2026-11-07 19:42 |
| node    | on  | `bank-64m` | 5           | 4        | 93.8%    | 32.13    | 81.73       | 149.12   | 2026-11-07 19:42  | 2026-11-07 20:24 |

The `bank-64m` blocks are context, not evidence: with 5 rounds each interval is the range of the values, and several are wide (Bun JIT `off` `encode-typed` 0.396–0.693). The verdicts below read `bank-16k` and `bank-4m`.

### NEW / STEP1, CPU time per operation

Below 1, NEW uses less CPU.

#### JIT off (library default)

| Unit                          | Input      | Bun NEW/STEP1       | Node NEW/STEP1      |
| ----------------------------- | ---------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.816 (0.803–0.836) | 0.826 (0.822–0.845) |
| `effect-xml/typed-decode`     | `bank-4m`  | 0.818 (0.798–0.833) | 0.802 (0.775–0.813) |
| `effect-xml/typed-decode`     | `bank-64m` | 0.819 (0.776–0.976) | 0.843 (0.704–0.931) |
| `effect-xml/encode-typed`     | `bank-16k` | 0.511 (0.494–0.522) | 0.643 (0.626–0.657) |
| `effect-xml/encode-typed`     | `bank-4m`  | 0.552 (0.521–0.584) | 0.619 (0.609–0.640) |
| `effect-xml/encode-typed`     | `bank-64m` | 0.533 (0.396–0.693) | 0.511 (0.494–0.553) |
| `typed/decode-string`         | `bank-16k` | 0.871 (0.851–0.920) | 0.909 (0.885–0.931) |
| `typed/decode-string`         | `bank-4m`  | 0.906 (0.888–0.928) | 0.927 (0.888–0.946) |
| `typed/decode-string`         | `bank-64m` | 0.921 (0.823–1.062) | 0.922 (0.753–0.953) |
| `typed/encode-string`         | `bank-16k` | 0.626 (0.598–0.652) | 0.736 (0.723–0.750) |
| `typed/encode-string`         | `bank-4m`  | 0.586 (0.582–0.626) | 0.772 (0.662–0.784) |
| `typed/encode-string`         | `bank-64m` | 0.629 (0.354–0.704) | 0.786 (0.541–0.979) |
| `effect-xml/stream`           | `bank-16k` | 0.897 (0.873–0.926) | 0.946 (0.933–0.960) |
| `effect-xml/stream`           | `bank-4m`  | 0.884 (0.872–0.911) | 0.908 (0.897–0.933) |
| `effect-xml/stream`           | `bank-64m` | 0.938 (0.905–1.033) | 0.751 (0.688–0.932) |
| `effect-xml/stream/positions` | `bank-16k` | 0.941 (0.909–0.967) | 0.968 (0.951–0.993) |
| `effect-xml/stream/positions` | `bank-4m`  | 0.936 (0.933–0.961) | 0.955 (0.951–0.965) |
| `effect-xml/stream/positions` | `bank-64m` | 0.930 (0.883–0.974) | 0.952 (0.887–0.994) |

#### JIT on

| Unit                          | Input      | Bun NEW/STEP1       | Node NEW/STEP1      |
| ----------------------------- | ---------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.851 (0.831–0.864) | 0.895 (0.871–0.919) |
| `effect-xml/typed-decode`     | `bank-4m`  | 0.863 (0.829–0.884) | 0.890 (0.859–0.933) |
| `effect-xml/typed-decode`     | `bank-64m` | 0.837 (0.609–1.021) | 0.845 (0.779–0.922) |
| `effect-xml/encode-typed`     | `bank-16k` | 0.538 (0.534–0.554) | 0.684 (0.642–0.702) |
| `effect-xml/encode-typed`     | `bank-4m`  | 0.539 (0.520–0.566) | 0.672 (0.630–0.717) |
| `effect-xml/encode-typed`     | `bank-64m` | 0.537 (0.213–0.769) | 0.705 (0.607–0.885) |
| `typed/decode-string`         | `bank-16k` | 0.879 (0.852–0.906) | 0.892 (0.865–0.911) |
| `typed/decode-string`         | `bank-4m`  | 0.911 (0.890–0.921) | 0.925 (0.868–0.938) |
| `typed/decode-string`         | `bank-64m` | 0.754 (0.486–0.859) | 0.916 (0.750–0.961) |
| `typed/encode-string`         | `bank-16k` | 0.589 (0.543–0.610) | 0.693 (0.652–0.746) |
| `typed/encode-string`         | `bank-4m`  | 0.605 (0.591–0.689) | 0.744 (0.707–0.765) |
| `typed/encode-string`         | `bank-64m` | 0.641 (0.230–1.020) | 0.596 (0.484–0.757) |
| `effect-xml/stream`           | `bank-16k` | 0.874 (0.835–0.895) | 0.927 (0.916–0.980) |
| `effect-xml/stream`           | `bank-4m`  | 0.886 (0.857–0.929) | 0.890 (0.863–0.921) |
| `effect-xml/stream`           | `bank-64m` | 0.884 (0.841–0.995) | 1.045 (0.920–1.176) |
| `effect-xml/stream/positions` | `bank-16k` | 0.963 (0.932–0.978) | 0.961 (0.938–1.039) |
| `effect-xml/stream/positions` | `bank-4m`  | 0.925 (0.886–0.956) | 0.962 (0.919–0.985) |
| `effect-xml/stream/positions` | `bank-64m` | 0.930 (0.915–0.938) | 0.930 (0.835–1.042) |

Wall time (secondary) agrees in JIT `off`: NEW/STEP1 typed decode is 0.808 and 0.765 on Bun at `bank-16k` and `bank-4m`, and 0.817 and 0.820 on Node; typed encode is 0.534 and 0.533 on Bun, and 0.629 and 0.611 on Node. Every wall cell, with its interval, is under `summary.wallMedianMs` in the files.

### Against computis, CPU time per operation

Each cell is effect-xml over `computis-effect-xml` in the same round; STEP1 uses the same computis run as NEW. Below 1, effect-xml uses less CPU. `T` and `C` are the NEW typed case and the computis case, in ms per operation; they come from a loaded machine and only show the scale.

#### effect-xml JIT off against computis as shipped

| Class        | Input      | Runtime | STEP1/computis      | NEW/computis        | NEW `T` (ms)              | `C` (ms)               |
| ------------ | ---------- | ------- | ------------------- | ------------------- | ------------------------- | ---------------------- |
| typed decode | `bank-16k` | bun     | 2.818 (2.755–2.868) | 2.298 (2.250–2.357) | 0.2042 (0.1974–0.2360)    | 0.0904 (0.0877–0.0918) |
| typed decode | `bank-16k` | node    | 3.590 (3.521–3.688) | 2.986 (2.883–3.090) | 0.2862 (0.2723–0.3042)    | 0.0958 (0.0916–0.0989) |
| typed decode | `bank-4m`  | bun     | 2.988 (2.923–3.040) | 2.420 (2.381–2.486) | 73.58 (70.81–77.13)       | 30.20 (29.52–30.78)    |
| typed decode | `bank-4m`  | node    | 3.454 (3.410–3.539) | 2.765 (2.718–2.850) | 107.25 (105.07–110.66)    | 39.55 (37.69–42.85)    |
| typed decode | `bank-64m` | bun     | 3.207 (2.618–3.786) | 2.729 (2.031–3.423) | 1462.17 (1176.65–1663.68) | 514.74 (476.48–618.96) |
| typed decode | `bank-64m` | node    | 3.914 (2.875–4.269) | 3.143 (2.425–3.664) | 1888.02 (1847.31–2185.72) | 601.16 (595.39–778.65) |
| typed encode | `bank-16k` | bun     | 3.449 (3.356–3.740) | 1.777 (1.741–1.854) | 0.0771 (0.0748–0.0856)    | 0.0443 (0.0426–0.0462) |
| typed encode | `bank-16k` | node    | 4.314 (4.094–4.503) | 2.688 (2.646–2.893) | 0.1604 (0.1555–0.1764)    | 0.0596 (0.0561–0.0617) |
| typed encode | `bank-4m`  | bun     | 5.167 (4.538–5.830) | 2.836 (2.747–3.034) | 35.67 (35.01–36.36)       | 12.47 (11.71–13.12)    |
| typed encode | `bank-4m`  | node    | 4.263 (4.190–4.474) | 2.685 (2.628–2.725) | 52.15 (50.08–54.05)       | 19.09 (18.48–20.28)    |
| typed encode | `bank-64m` | bun     | 5.176 (3.445–5.994) | 2.388 (2.202–3.339) | 612.54 (555.25–857.40)    | 254.87 (235.95–281.05) |
| typed encode | `bank-64m` | node    | 4.291 (4.010–4.416) | 2.184 (2.048–2.373) | 738.36 (719.67–801.05)    | 337.52 (329.77–356.18) |

#### effect-xml JIT on against computis (like for like)

| Class        | Input      | Runtime | STEP1/computis      | NEW/computis        | NEW `T` (ms)              | `C` (ms)                |
| ------------ | ---------- | ------- | ------------------- | ------------------- | ------------------------- | ----------------------- |
| typed decode | `bank-16k` | bun     | 2.468 (2.389–2.560) | 2.091 (2.031–2.153) | 0.1851 (0.1813–0.1971)    | 0.0873 (0.0856–0.0935)  |
| typed decode | `bank-16k` | node    | 3.057 (2.805–3.279) | 2.744 (2.519–2.858) | 0.2544 (0.2415–0.2762)    | 0.0942 (0.0921–0.0984)  |
| typed decode | `bank-4m`  | bun     | 2.848 (2.682–3.032) | 2.425 (2.278–2.519) | 81.14 (77.71–85.06)       | 33.75 (31.86–34.78)     |
| typed decode | `bank-4m`  | node    | 2.901 (2.779–2.997) | 2.637 (2.515–2.786) | 114.37 (101.79–122.84)    | 44.94 (38.89–47.37)     |
| typed decode | `bank-64m` | bun     | 2.870 (1.290–5.256) | 2.564 (1.224–3.203) | 1409.39 (1362.67–1833.30) | 572.44 (495.65–1151.11) |
| typed decode | `bank-64m` | node    | 2.818 (2.640–3.463) | 2.598 (2.165–2.926) | 1910.81 (1766.74–2163.88) | 809.06 (653.00–822.45)  |
| typed encode | `bank-16k` | bun     | 2.755 (2.697–2.845) | 1.497 (1.438–1.564) | 0.0634 (0.0622–0.0641)    | 0.0433 (0.0414–0.0445)  |
| typed encode | `bank-16k` | node    | 3.374 (3.150–3.547) | 2.323 (2.170–2.426) | 0.1311 (0.1226–0.1409)    | 0.0570 (0.0561–0.0596)  |
| typed encode | `bank-4m`  | bun     | 3.913 (3.623–4.206) | 2.188 (2.016–2.317) | 30.46 (29.33–32.25)       | 14.12 (13.46–14.55)     |
| typed encode | `bank-4m`  | node    | 3.490 (3.116–3.686) | 2.210 (2.089–2.402) | 46.74 (44.25–49.02)       | 20.90 (19.73–23.46)     |
| typed encode | `bank-64m` | bun     | 3.648 (1.692–5.724) | 1.957 (0.983–2.508) | 582.29 (307.27–699.97)    | 279.06 (252.11–553.44)  |
| typed encode | `bank-64m` | node    | 2.590 (2.060–3.319) | 1.725 (1.455–2.877) | 746.59 (648.90–903.92)    | 402.90 (314.20–498.41)  |

Like for like, NEW's ratio at `bank-16k` and `bank-4m` is 0–9% lower on decode and 14–23% lower on encode than in the JIT `off` table; the two tables come from different rounds. Bun decode at `bank-4m` does not move (2.420 and 2.425).

### Node allocation and GC, JIT off

Per operation, medians over the kept rounds; NEW/STEP1 is the per-round ratio. GC pause is the `node:v8` `GCProfiler` total and swings with when a major collection lands in a sample.

| Unit                          | Input      | Alloc NEW (MB) | Alloc STEP1 (MB) | Alloc NEW/STEP1     | GC pause NEW (ms) | GC pause STEP1 (ms) | GC pause NEW/STEP1  |
| ----------------------------- | ---------- | -------------- | ---------------- | ------------------- | ----------------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.703          | 0.824            | 0.853 (0.853–0.853) | 0.0108            | 0.0084              | 0.931 (0.809–0.988) |
| `effect-xml/typed-decode`     | `bank-4m`  | 161.9          | 194.2            | 0.835 (0.818–0.854) | 9.98              | 13.48               | 0.742 (0.673–0.795) |
| `effect-xml/encode-typed`     | `bank-16k` | 0.278          | 0.529            | 0.526 (0.525–0.529) | 0.0203            | 0.0242              | 0.570 (0.463–0.622) |
| `effect-xml/encode-typed`     | `bank-4m`  | 64.6           | 126.6            | 0.511 (0.511–0.511) | 10.75             | 14.05               | 0.715 (0.631–0.774) |
| `effect-xml/stream`           | `bank-16k` | 0.844          | 0.898            | 0.939 (0.939–0.940) | 0.0144            | 0.0172              | 0.935 (0.811–1.035) |
| `effect-xml/stream`           | `bank-4m`  | 197.2          | 210.5            | 0.937 (0.936–0.937) | 1.64              | 1.86                | 0.925 (0.885–1.045) |
| `effect-xml/stream/positions` | `bank-16k` | 1.464          | 1.519            | 0.964 (0.964–0.965) | 0.0526            | 0.0641              | 0.976 (0.914–1.040) |
| `effect-xml/stream/positions` | `bank-4m`  | 349.0          | 362.6            | 0.963 (0.963–0.963) | 8.54              | 8.28                | 1.012 (0.960–1.078) |

Typed encode allocates half of STEP1's bytes and typed decode 15% fewer. JIT `on`, `bank-64m`, and every interval of the per-side values are under `summary.allocationBytesPerOp` and `summary.gcPauseMsPerOp` in the Node files.

### Against the predictions

All rows read `bank-4m`, JIT `off`. Two estimates stand in for changes that this A/B cannot run alone:

- **The string rungs** leave out option B, which changes `fromString` only. `typed/decode-string` measures the builder, plus any decode-side effect of the collision-group change; `typed/encode-string` measures the writer and the collision-group encode.
- **The option-B quotient** divides each side's `fromString` case by its string rung in the same round, and NEW's quotient by STEP1's. It removes what the rung shares with the case, but it is approximate: on Bun the case costs less than its own rung (see [fromString over decodeString and encodeString](#fromstring-over-decodestring-and-encodestring)), and a smaller rung raises the quotient when the wrapper is unchanged. It matches the direct option-B A/B: 0.901 and 0.851 on decode, 0.866 and 0.810 on encode.

| Prediction                                         | Predicted             | Measured as                     | Bun                 | Node                | Holds                             |
| -------------------------------------------------- | --------------------- | ------------------------------- | ------------------- | ------------------- | --------------------------------- |
| Builder spike, `typed/structural` proto/current    | 0.893 Bun, 0.938 Node | `typed/decode-string` NEW/STEP1 | 0.906 (0.888–0.928) | 0.927 (0.888–0.946) | yes, inside both intervals        |
| Writer spike, shipped encode proto/main            | 0.662 Bun, 0.751 Node | `typed/encode-string` NEW/STEP1 | 0.586 (0.582–0.626) | 0.772 (0.662–0.784) | Node yes; Bun beats it            |
| head-cto B5, option B decode                       | 0.70–0.90             | option-B quotient, decode       | 0.897 (0.854–0.932) | 0.862 (0.829–0.916) | yes; Bun at the upper edge        |
| head-cto B5, option B encode                       | 0.45–0.65             | option-B quotient, encode       | 0.914 (0.874–0.979) | 0.824 (0.798–0.901) | no: the gain is 9–18%, not 35–55% |
| Layer profile, option B 8–16% of `T`, decode       | 0.92 Bun, 0.89 Node   | option-B quotient, decode       | 0.897 (0.854–0.932) | 0.862 (0.829–0.916) | yes, inside both intervals        |
| Layer profile, option B 8–16% of `T`, encode       | 0.88 Bun, 0.84 Node   | option-B quotient, encode       | 0.914 (0.874–0.979) | 0.824 (0.798–0.901) | yes, inside both intervals        |
| Option B (profile) times builder (spike `T` delta) | 0.813 Bun, 0.840 Node | `typed-decode` NEW/STEP1        | 0.818 (0.798–0.833) | 0.802 (0.775–0.813) | Bun yes; Node beats it            |
| Option B (profile) times writer (spike)            | 0.583 Bun, 0.631 Node | `encode-typed` NEW/STEP1        | 0.552 (0.521–0.584) | 0.619 (0.609–0.640) | yes; Bun at the upper edge        |

The builder's `T` share comes from its spike's projection: the `typed` rung saved 10.96 ms of `T` = 94.42 ms on Bun and 7.42 ms of 133.2 ms on Node, so 0.884 and 0.944 of `T`. The writer spike's 0.662 and 0.751 already apply to the shipped encode. The two products assume the savings multiply; the option-B factors are the profile's 0.92 and 0.89 (decode) and 0.88 and 0.84 (encode).

The builder spike projected typed decode `T / C` from 3.08 to 2.72 on Bun and from 3.22 to 3.04 on Node; the writer spike projected typed encode `T / C` from 3.99 to 2.61 and from 3.31 to 2.48. Both exclude option B, and their `C` comes from other rounds. Here, with option B included, decode moves from 2.988 to 2.420 on Bun and from 3.454 to 2.765 on Node, and encode from 5.167 to 2.836 and from 4.263 to 2.685.

### Cumulative phase 3: NEW against the baseline

Two blocks per runtime pair NEW with the phase-3 baseline `bd60a0e`, JIT `off`, 15 rounds each. Below 1, NEW uses less CPU.

| Unit                      | Input      | Bun CPU             | Node CPU            | Bun wall            | Node wall           |
| ------------------------- | ---------- | ------------------- | ------------------- | ------------------- | ------------------- |
| `effect-xml/typed-decode` | `bank-16k` | 0.434 (0.407–0.446) | 0.487 (0.473–0.502) | 0.418 (0.407–0.423) | 0.482 (0.473–0.498) |
| `effect-xml/typed-decode` | `bank-4m`  | 0.425 (0.402–0.448) | 0.563 (0.554–0.592) | 0.387 (0.302–0.458) | 0.480 (0.404–0.555) |
| `effect-xml/encode-typed` | `bank-16k` | 0.134 (0.115–0.154) | 0.192 (0.189–0.206) | 0.124 (0.122–0.126) | 0.180 (0.172–0.182) |
| `effect-xml/encode-typed` | `bank-4m`  | 0.144 (0.139–0.151) | 0.223 (0.211–0.237) | 0.116 (0.058–0.144) | 0.182 (0.156–0.199) |

These blocks ran under the heaviest load of the session: the median of the 1-minute load average read at the start and end of every round, the superseded ones included, was 64.74 (Bun `bank-16k`), 157.36 (Bun `bank-4m`), 86.52 (Node `bank-16k`), and 78.69 (Node `bank-4m`), with a maximum of 178.59. The load rule repeated no round, because each block's median load was itself high. The chained estimate agrees: the step-1 A/B's STEP1/baseline at `bank-4m` (0.503 and 0.710 on decode, 0.277 and 0.362 on encode) times this section's NEW/STEP1 gives 0.411 and 0.569 on decode, and 0.153 and 0.224 on encode, each inside or next to the direct interval.

### Files

The raw rounds and summaries are in `docs/rd/performance/phase-3-ab/cumulative-<runtime>-jit-<mode>-<input>.json` (12 files, NEW against STEP1) and `cumulative-base-<runtime>-jit-off-<input>.json` (4 files, NEW against `bd60a0e`), in the shape described in [Files and load](#files-and-load). The NEW/STEP1 and baseline cells read `summary.cpuPerOpMs.newOverOld` and `summary.wallMedianMs.newOverOld`; the computis cells read `summary.cpuPerOpMs.competitors` (`new/` and `old/` keys) and `summary.cpuPerOpMs.units` for `T` and `C`; the Node allocation and GC cells read `summary.allocationBytesPerOp` and `summary.gcPauseMsPerOp`. The option-B quotients are in `cumulative-wrapper-over-string.json`, whose `method` field states the per-round computation from the kept rounds of the 12 files.

## Phase 3: what shipped, measured (HEAD A/B)

This section measures the code that phase 3 shipped. It adds the resolver rewrite (`07240f0`), the fused resolve-and-collect machine for document decode (`7e280b3`), and the fused record streams (`6eb5420`) to the code of [Phase 3: option B, builder and writer under load (A/B)](#phase-3-option-b-builder-and-writer-under-load-ab). It compares that code (HEAD) with phase-3 step 1 (STEP1), with the phase-3 baseline `bd60a0e` (BASE), and with `@computis/effect-xml`, on CPU time per operation, with the method of [Phase 3 under load (A/B)](#phase-3-under-load-ab). Every value is a median of per-round ratios with its distribution-free interval. The absolute times in the files were taken on a loaded machine and are not throughput figures; this section gives no MB/s.

At `bank-16k` and `bank-4m` in the shipped mode (JIT `off`), HEAD costs 0.55–0.68 of STEP1's typed-decode CPU and 0.29–0.48 of BASE's. Record streams cost 0.74–0.80 of STEP1's CPU and 0.41–0.54 of BASE's, and positioned streams 0.86–0.88 and 0.59–0.69. Typed decode costs 1.66–2.44 times computis's CPU, down from 2.83–3.64 at STEP1 in the same rounds. Typed encode, which no change since `659480f` touches, measures as it did there. Streaming CPU does not regress: every stream and positioned-stream interval against BASE lies below 0.78. One memory cell crossed the guardrail's 5% line: Node peak heap of the positioned stream at `bank-4m`, 1.111 of BASE's. `48d4bcf` and `9beee49` fix it, and the re-measure puts that cell at 0.409 of BASE's (see [Streaming guardrail](#streaming-guardrail)).

### Sides and runs

- **HEAD**: commit `7474d56`, whose `src/` tree `f3d1fa62778a5d9dd11a208efaa01573c790f491` is identical to `e35151d`'s. Run from the detached worktree `work/perf3-abh-head`.
- **STEP1**: commit `ee496cc`, from `work/perf3-abh-step1`.
- **BASE**: commit `bd60a0e`, the phase-3 OLD side of [Phase 3 under load (A/B)](#phase-3-under-load-ab), from `work/perf3-abh-base`, in blocks of its own against HEAD.
- **Driver**: `bench/ab.ts` from the HEAD tree, with `--paired-rungs true` in the STEP1 blocks. Each worktree linked the main checkout's `node_modules`, which is why every file's `environment.dirty` is `true`; `git status` in each tree showed only that link. The three worktrees were removed after the runs.
- **Units per round, STEP1 blocks**: `effect-xml/typed-decode` and `effect-xml/encode-typed` (`XmlSchema.fromString(ItemBank)`), `effect-xml/stream`, `effect-xml/stream/positions`, and the rungs `typed/decode-string` and `typed/encode-string` on both trees; `computis-effect-xml/typed-decode` and `computis-effect-xml/encode-typed` on HEAD only.
- **Units per round, BASE blocks**: `effect-xml/typed-decode`, `effect-xml/stream`, and `effect-xml/stream/positions` on both trees. BASE has no layer rungs.
- **Control**: typed encode. No encode `src/` change landed after `659480f`, so HEAD / STEP1 on encode should match `659480f` / STEP1 from the earlier section.
- **Rounds**: 12 at `bank-16k` and `bank-4m` under the `ab` policy, and 5 at `bank-64m` under the `large` policy, on Bun 1.4.2 and Node 26.13.0. The STEP1 blocks ran JIT `off` (shipped) and `on` (preloaded); the BASE blocks ran JIT `off`. Apple M4 Pro, 14 cores, Darwin 27.2.0; `effect` 4.1.2 and `@computis/effect-xml` 0.4.0.
- **computis JIT**: computis runs with its default, the Schema JIT on, in every block. The JIT `off` columns compare the two libraries as shipped; the JIT `on` columns compare them like for like.
- **Outliers**: of the 116 planned STEP1 rounds, 51 were repeated by the driver's rule, 10 for load and 41 for one unit's CPU time. Of the 58 BASE rounds, 15 were repeated, all for CPU time. No unit failed.

The Bun and Node chains ran at the same time, beside other seats' work in this repository. The 1-minute load average, read at the start and end of every round, superseded rounds included:

| Side  | Runtime | JIT | Input      | Rounds kept | Repeated | Coverage | Load min | Load median | Load max | First round (UTC) | Last round (UTC) |
| ----- | ------- | --- | ---------- | ----------- | -------- | -------- | -------- | ----------- | -------- | ----------------- | ---------------- |
| STEP1 | bun     | off | `bank-16k` | 12          | 4        | 96.1%    | 11.14    | 37.90       | 118.53   | 2026-11-08 15:11  | 2026-11-08 15:22 |
| STEP1 | bun     | off | `bank-4m`  | 12          | 6        | 96.1%    | 8.77     | 29.28       | 57.60    | 2026-11-08 15:23  | 2026-11-08 15:37 |
| STEP1 | bun     | off | `bank-64m` | 5           | 2        | 93.8%    | 8.77     | 45.38       | 168.59   | 2026-11-08 15:38  | 2026-11-08 15:49 |
| STEP1 | bun     | on  | `bank-16k` | 12          | 6        | 96.1%    | 6.86     | 78.85       | 155.87   | 2026-11-08 15:52  | 2026-11-08 16:04 |
| STEP1 | bun     | on  | `bank-4m`  | 12          | 2        | 96.1%    | 6.63     | 8.21        | 16.15    | 2026-11-08 16:05  | 2026-11-08 16:16 |
| STEP1 | bun     | on  | `bank-64m` | 5           | 5        | 93.8%    | 6.65     | 8.14        | 11.35    | 2026-11-08 16:16  | 2026-11-08 16:27 |
| STEP1 | node    | off | `bank-16k` | 12          | 5        | 96.1%    | 11.14    | 29.23       | 118.76   | 2026-11-08 15:11  | 2026-11-08 15:23 |
| STEP1 | node    | off | `bank-4m`  | 12          | 3        | 96.1%    | 9.36     | 28.87       | 64.69    | 2026-11-08 15:24  | 2026-11-08 15:37 |
| STEP1 | node    | off | `bank-64m` | 5           | 4        | 93.8%    | 9.36     | 69.70       | 193.80   | 2026-11-08 15:38  | 2026-11-08 15:59 |
| STEP1 | node    | on  | `bank-16k` | 12          | 5        | 96.1%    | 6.90     | 8.31        | 41.64    | 2026-11-08 16:01  | 2026-11-08 16:13 |
| STEP1 | node    | on  | `bank-4m`  | 12          | 4        | 96.1%    | 6.41     | 9.25        | 14.67    | 2026-11-08 16:14  | 2026-11-08 16:26 |
| STEP1 | node    | on  | `bank-64m` | 5           | 5        | 93.8%    | 5.59     | 6.50        | 7.48     | 2026-11-08 16:27  | 2026-11-08 16:38 |
| BASE  | bun     | off | `bank-16k` | 12          | 2        | 96.1%    | 5.74     | 6.62        | 7.19     | 2026-11-08 16:28  | 2026-11-08 16:32 |
| BASE  | bun     | off | `bank-4m`  | 12          | 2        | 96.1%    | 5.74     | 6.18        | 6.88     | 2026-11-08 16:32  | 2026-11-08 16:37 |
| BASE  | bun     | off | `bank-64m` | 5           | 3        | 93.8%    | 5.51     | 7.00        | 10.15    | 2026-11-08 16:37  | 2026-11-08 16:43 |
| BASE  | node    | off | `bank-16k` | 12          | 0        | 96.1%    | 6.49     | 7.27        | 10.71    | 2026-11-08 16:40  | 2026-11-08 16:43 |
| BASE  | node    | off | `bank-4m`  | 12          | 5        | 96.1%    | 4.58     | 5.68        | 7.09     | 2026-11-08 16:44  | 2026-11-08 16:49 |
| BASE  | node    | off | `bank-64m` | 5           | 3        | 93.8%    | 5.04     | 13.95       | 32.14    | 2026-11-08 16:50  | 2026-11-08 16:57 |

The JIT `off` STEP1 blocks and the Bun JIT `on` `bank-16k` block ran under heavy load; the other blocks ran with a 1-minute load median under 14. The ratios pair values from the same round, so the load level does not bias them. The `bank-64m` blocks are context, not evidence: with 5 rounds each interval is the range of the values, and the encode intervals are wide (Bun JIT `on` `typed/encode-string` 0.215–1.629). The verdicts below read `bank-16k` and `bank-4m`.

### HEAD / STEP1, CPU time per operation

Below 1, HEAD uses less CPU.

| Unit                          | Input      | Bun, JIT off        | Node, JIT off       | Bun, JIT on         | Node, JIT on        |
| ----------------------------- | ---------- | ------------------- | ------------------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.654 (0.637–0.698) | 0.669 (0.654–0.695) | 0.687 (0.670–0.722) | 0.736 (0.727–0.746) |
| `effect-xml/typed-decode`     | `bank-4m`  | 0.551 (0.540–0.564) | 0.676 (0.622–0.706) | 0.584 (0.580–0.604) | 0.693 (0.689–0.710) |
| `effect-xml/typed-decode`     | `bank-64m` | 0.577 (0.490–0.605) | 0.708 (0.625–0.794) | 0.636 (0.559–0.702) | 0.666 (0.599–0.783) |
| `typed/decode-string`         | `bank-16k` | 0.672 (0.660–0.700) | 0.725 (0.673–0.753) | 0.677 (0.654–0.705) | 0.748 (0.736–0.755) |
| `typed/decode-string`         | `bank-4m`  | 0.639 (0.613–0.652) | 0.755 (0.720–0.793) | 0.613 (0.601–0.623) | 0.740 (0.711–0.747) |
| `typed/decode-string`         | `bank-64m` | 0.730 (0.677–0.819) | 0.759 (0.683–0.778) | 0.625 (0.541–0.716) | 0.749 (0.731–0.771) |
| `effect-xml/stream`           | `bank-16k` | 0.771 (0.749–0.864) | 0.802 (0.788–0.836) | 0.731 (0.719–0.750) | 0.789 (0.783–0.798) |
| `effect-xml/stream`           | `bank-4m`  | 0.741 (0.731–0.760) | 0.778 (0.736–0.802) | 0.732 (0.727–0.745) | 0.770 (0.751–0.784) |
| `effect-xml/stream`           | `bank-64m` | 0.783 (0.745–0.812) | 0.622 (0.613–0.765) | 0.757 (0.731–0.778) | 0.767 (0.694–0.853) |
| `effect-xml/stream/positions` | `bank-16k` | 0.858 (0.836–0.883) | 0.861 (0.820–0.921) | 0.843 (0.795–0.879) | 0.868 (0.853–0.875) |
| `effect-xml/stream/positions` | `bank-4m`  | 0.865 (0.830–0.881) | 0.877 (0.863–0.905) | 0.847 (0.838–0.853) | 0.868 (0.850–0.885) |
| `effect-xml/stream/positions` | `bank-64m` | 0.848 (0.840–0.894) | 0.910 (0.833–1.005) | 0.843 (0.824–0.851) | 0.875 (0.837–0.882) |
| `effect-xml/encode-typed`     | `bank-16k` | 0.504 (0.489–0.529) | 0.624 (0.574–0.644) | 0.541 (0.513–0.551) | 0.684 (0.671–0.698) |
| `effect-xml/encode-typed`     | `bank-4m`  | 0.522 (0.496–0.558) | 0.601 (0.579–0.654) | 0.546 (0.539–0.562) | 0.715 (0.612–0.732) |
| `effect-xml/encode-typed`     | `bank-64m` | 0.617 (0.260–0.819) | 0.679 (0.460–0.827) | 0.651 (0.210–0.826) | 0.693 (0.543–0.923) |
| `typed/encode-string`         | `bank-16k` | 0.653 (0.602–0.676) | 0.749 (0.728–0.801) | 0.616 (0.524–0.672) | 0.697 (0.672–0.712) |
| `typed/encode-string`         | `bank-4m`  | 0.603 (0.576–0.643) | 0.758 (0.717–0.794) | 0.554 (0.527–0.579) | 0.758 (0.710–0.767) |
| `typed/encode-string`         | `bank-64m` | 0.739 (0.566–1.050) | 0.914 (0.814–1.151) | 0.936 (0.215–1.629) | 0.809 (0.779–1.057) |

Wall time agrees. At `bank-16k` and `bank-4m`, JIT `off`, the wall-median HEAD / STEP1 is 0.545–0.680 for typed decode, 0.734–0.810 for the stream, 0.855–0.871 for the positioned stream, and 0.492–0.629 for typed encode.

On Node, HEAD allocates 0.47–0.49 of STEP1's bytes per typed decode, 0.59–0.61 per stream, and 0.74 per positioned stream, at every input, JIT `off`. GC pause per operation falls with it, with wide intervals: 0.52–0.75 for the stream at `bank-16k` and `bank-4m`.

### HEAD / BASE and the streaming no-regression verdict

JIT `off`. Below 1, HEAD uses less.

| Unit                          | Input      | Bun CPU             | Node CPU            | Bun wall            | Node wall           |
| ----------------------------- | ---------- | ------------------- | ------------------- | ------------------- | ------------------- |
| `effect-xml/typed-decode`     | `bank-16k` | 0.340 (0.338–0.343) | 0.414 (0.412–0.418) | 0.361 (0.357–0.363) | 0.413 (0.411–0.415) |
| `effect-xml/typed-decode`     | `bank-4m`  | 0.292 (0.288–0.299) | 0.479 (0.468–0.490) | 0.283 (0.279–0.286) | 0.427 (0.411–0.431) |
| `effect-xml/typed-decode`     | `bank-64m` | 0.312 (0.306–0.333) | 0.483 (0.465–0.500) | 0.305 (0.299–0.323) | 0.429 (0.424–0.452) |
| `effect-xml/stream`           | `bank-16k` | 0.444 (0.436–0.471) | 0.538 (0.530–0.548) | 0.453 (0.444–0.455) | 0.525 (0.522–0.540) |
| `effect-xml/stream`           | `bank-4m`  | 0.410 (0.407–0.413) | 0.491 (0.482–0.493) | 0.414 (0.411–0.418) | 0.499 (0.495–0.501) |
| `effect-xml/stream`           | `bank-64m` | 0.439 (0.426–0.452) | 0.463 (0.419–0.519) | 0.433 (0.417–0.443) | 0.480 (0.473–0.523) |
| `effect-xml/stream/positions` | `bank-16k` | 0.623 (0.607–0.627) | 0.694 (0.690–0.708) | 0.634 (0.627–0.639) | 0.650 (0.644–0.664) |
| `effect-xml/stream/positions` | `bank-4m`  | 0.594 (0.588–0.606) | 0.682 (0.675–0.691) | 0.597 (0.591–0.607) | 0.658 (0.647–0.664) |
| `effect-xml/stream/positions` | `bank-64m` | 0.590 (0.583–0.602) | 0.669 (0.663–0.779) | 0.598 (0.581–0.609) | 0.656 (0.642–1.161) |

**Verdict: no streaming regression.** The phase-3 guardrail ([`phase-3.md`](../goals/performance/phase-3.md), "Non-goals") reports any stream-class or positions median that worsens by more than 5% on either runtime at `bank-4m` or `bank-64m`. Every CPU interval for `effect-xml/stream` and `effect-xml/stream/positions` against BASE lies below 0.78, on both runtimes at every input. The other stream metrics, from the same files:

| Metric, HEAD / BASE                  | Stream, `bank-4m`                         | Stream, `bank-64m`                        | Positions, `bank-4m`                      | Positions, `bank-64m`                     |
| ------------------------------------ | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| Time to first record, Bun / Node     | 0.774 (0.765–0.807) / 0.808 (0.792–0.825) | 0.880 (0.810–0.942) / 0.627 (0.593–0.669) | 0.917 (0.882–0.929) / 0.945 (0.922–0.999) | 0.926 (0.817–1.019) / 0.874 (0.855–0.926) |
| Allocation per operation, Bun / Node | 0.317 (0.315–0.322) / 0.287 (0.287–0.287) | 0.323 (0.314–0.326) / 0.286 (0.283–0.286) | 0.474 (0.467–0.477) / 0.455 (0.455–0.455) | 0.474 (0.471–0.483) / 0.456 (0.456–0.456) |
| Peak heap used, Bun / Node           | 0.750 (0.746–0.765) / 1.025 (1.008–1.033) | 0.777 (0.618–0.824) / 0.581 (0.299–1.532) | 0.877 (0.868–0.887) / 1.111 (1.018–1.225) | 0.661 (0.465–1.175) / 0.990 (0.946–3.244) |
| Peak RSS, Bun / Node                 | 0.853 (0.845–0.864) / 0.997 (0.985–1.007) | 0.812 (0.800–0.837) / 0.556 (0.415–1.028) | 0.957 (0.949–0.966) / 1.065 (1.014–1.099) | 0.939 (0.859–0.989) / 1.001 (0.993–1.863) |

The time-to-first-record median improves at every cell, and every allocation interval lies below 0.49. Peak heap and RSS are the child process's peaks. One cell crosses the guardrail's 5% line: on Node at `bank-4m`, the positioned stream's peak heap median is 11% above BASE's (1.111, 1.018–1.225) and its peak RSS 6.5% above (1.065, 1.014–1.099), while it allocates 0.455 of BASE's bytes. At `bank-16k` the same unit is 1.061 (1.031–1.281) and 1.041 (1.022–1.151); at `bank-64m` it straddles 1. The unpositioned stream on Node is 1.025 (1.008–1.033) in heap and 0.997 (0.985–1.007) in RSS at `bank-4m`. Bun is below 1 in every heap and RSS cell. The table and these figures are HEAD before the fix below.

The spike [stream-heap.md](perf3b-spikes/stream-heap.md) investigated the cell. HEAD held nothing alive longer: the positioned stream's live heap is 1.000 (1.000–1.003) of BASE's. The peak counted garbage. Each positioned record's position tree, kept in the `recordTrees` `WeakMap` in `src/resolve.ts`, was pretenured and waited in the old generation for a mark-compact; BASE has the same mechanism. `48d4bcf` and `9beee49` forget each positioned record's tree once it has decoded. Re-measured on Node at `bank-4m`, JIT `off`, 12 interleaved rounds, the positioned stream's peak heap is 0.409 (0.363–0.442) of BASE's, its peak RSS 0.607 (0.583–0.649), and its CPU 0.547 (0.532–0.552). Against unfixed HEAD the plain stream is unchanged: 1.000 (0.992–1.006) in peak heap and 0.999 (0.987–1.013) in CPU. Bun, `bank-16k`, and `bank-64m` were not re-measured. [Streaming guardrail](#streaming-guardrail) has the full re-measure. Peak heap and RSS are under `summary.peakHeapUsedBytes` and `summary.peakRssBytes`.

### Against computis, CPU time per operation

`T / C` is effect-xml's typed CPU over computis's in the same round, for the STEP1 and the HEAD side of the same blocks. computis runs with the Schema JIT on.

| Unit           | Input      | Runtime | STEP1 `T / C`, JIT off | HEAD `T / C`, JIT off | STEP1 `T / C`, JIT on | HEAD `T / C`, JIT on |
| -------------- | ---------- | ------- | ---------------------- | --------------------- | --------------------- | -------------------- |
| `typed-decode` | `bank-16k` | bun     | 2.829 (2.706–2.919)    | 1.870 (1.792–2.007)   | 2.506 (2.453–2.765)   | 1.732 (1.663–2.024)  |
| `typed-decode` | `bank-16k` | node    | 3.639 (3.439–3.857)    | 2.436 (2.336–2.621)   | 2.944 (2.864–2.985)   | 2.166 (2.120–2.179)  |
| `typed-decode` | `bank-4m`  | bun     | 2.977 (2.880–3.117)    | 1.662 (1.603–1.724)   | 2.640 (2.513–2.708)   | 1.540 (1.505–1.580)  |
| `typed-decode` | `bank-4m`  | node    | 3.330 (3.256–3.599)    | 2.204 (2.086–2.378)   | 2.936 (2.862–2.953)   | 2.025 (2.006–2.052)  |
| `typed-decode` | `bank-64m` | bun     | 3.462 (3.121–5.172)    | 1.998 (1.787–2.532)   | 2.921 (2.681–3.236)   | 1.809 (1.775–2.051)  |
| `typed-decode` | `bank-64m` | node    | 3.905 (3.304–4.122)    | 2.765 (2.410–2.826)   | 3.016 (2.546–3.246)   | 1.959 (1.903–2.163)  |
| `encode-typed` | `bank-16k` | bun     | 3.697 (3.384–4.100)    | 1.843 (1.723–1.974)   | 2.886 (2.787–3.457)   | 1.518 (1.479–1.854)  |
| `encode-typed` | `bank-16k` | node    | 4.017 (3.869–4.571)    | 2.560 (2.376–2.652)   | 2.966 (2.915–3.064)   | 2.064 (1.976–2.101)  |
| `encode-typed` | `bank-4m`  | bun     | 5.374 (4.324–5.699)    | 2.663 (2.334–2.935)   | 4.925 (4.785–5.064)   | 2.707 (2.563–2.850)  |
| `encode-typed` | `bank-4m`  | node    | 4.248 (4.057–4.489)    | 2.611 (2.505–2.657)   | 3.259 (3.078–3.809)   | 2.294 (2.233–2.308)  |
| `encode-typed` | `bank-64m` | bun     | 6.265 (4.530–7.788)    | 3.507 (1.455–5.131)   | 5.923 (5.477–6.377)   | 4.149 (1.326–4.637)  |
| `encode-typed` | `bank-64m` | node    | 3.433 (2.637–4.027)    | 2.332 (1.649–2.430)   | 2.520 (1.741–2.820)   | 1.747 (1.207–2.323)  |

The HEAD JIT `off` decode `T / C` at `bank-4m`, 1.662 on Bun and 2.204 on Node, matches the step-2 re-evaluation's 1.715 and 2.200 on the same `src/` decode ([T, C, and K](#t-c-and-k-cpu-time-per-operation)).

### Encode control

No encode `src/` change landed after `659480f`. HEAD / STEP1 on encode here, over `659480f` / STEP1 in [NEW / STEP1, CPU time per operation](#new--step1-cpu-time-per-operation), is a ratio of medians from two sessions:

| Unit                      | Input      | Bun, JIT off | Node, JIT off | Bun, JIT on | Node, JIT on |
| ------------------------- | ---------- | ------------ | ------------- | ----------- | ------------ |
| `effect-xml/encode-typed` | `bank-16k` | 0.986        | 0.971         | 1.006       | 1.000        |
| `effect-xml/encode-typed` | `bank-4m`  | 0.944        | 0.972         | 1.013       | 1.065        |
| `typed/encode-string`     | `bank-16k` | 1.044        | 1.018         | 1.045       | 1.006        |
| `typed/encode-string`     | `bank-4m`  | 1.030        | 0.981         | 0.916       | 1.018        |

Every cell is 0.92–1.07. Every HEAD interval overlaps the earlier one except Bun JIT `on` `typed/encode-string` at `bank-4m`, 0.554 (0.527–0.579) against 0.605 (0.591–0.689). The control holds within the drift of [Phase 3: fromString option B under load (A/B)](#phase-3-fromstring-option-b-under-load-ab), whose controls measured 0.982 to 1.024. At `bank-64m` the same quotients run from 0.98 to 1.46, inside the width of the 5-round intervals.

### Against the predictions

All rows read `bank-4m`, JIT `off`. The resolver spike ([resolver.md](perf3b-spikes/resolver.md)) predicted typed decode against `7f1cff8`, whose decode `659480f` keeps. The stream-records spike ([stream-records.md](perf3b-spikes/stream-records.md)) predicted `6eb5420` alone, against `a310ba3`. This A/B has no `659480f` side, so "implied HEAD / `659480f`" divides HEAD / STEP1 here by `659480f` / STEP1 in [NEW / STEP1, CPU time per operation](#new--step1-cpu-time-per-operation): a ratio of medians from two sessions, with no interval.

| Prediction                                               | Predicted                            | Measured as                         | Bun                 | Node                | Holds                                  |
| -------------------------------------------------------- | ------------------------------------ | ----------------------------------- | ------------------- | ------------------- | -------------------------------------- |
| Resolver spike, typed decode B / main                    | 0.787 Bun, 0.794 Node                | implied HEAD / `659480f`            | 0.674               | 0.842               | Bun beats it; Node misses by 5 points  |
| Resolver spike, `T / C` with B                           | 2.24 Bun, 2.30 Node                  | HEAD `T / C`                        | 1.662 (1.603–1.724) | 2.204 (2.086–2.378) | Bun beats it; Node yes, inside         |
| Stream-records spike, stream                             | 0.93–0.96 Bun, 0.73–0.91 Node        | implied HEAD / `659480f`, stream    | 0.839               | 0.857               | Bun below the range; Node inside it    |
| Stream-records spike, positioned stream                  | 0.960 Bun, 0.967 Node                | implied HEAD / `659480f`, positions | 0.924               | 0.919               | both below it                          |
| Chained: `659480f` / BASE times implied HEAD / `659480f` | 0.287 Bun, 0.474 Node (typed decode) | HEAD / BASE, typed decode           | 0.292 (0.288–0.299) | 0.479 (0.468–0.490) | yes; Node inside, Bun just below 0.288 |

The two stream rows include the resolver rewrite (`07240f0`), which also runs in the record channels and which no spike predicted for the stream. They overstate what `6eb5420` alone saved by whatever `07240f0` saved on the stream, so they do not test the stream-records prediction on its own. The Node typed-decode miss is a chained estimate across sessions; the `T / C` row, from one session, holds on Node. The chained row multiplies `659480f` / BASE from [Cumulative phase 3: NEW against the baseline](#cumulative-phase-3-new-against-the-baseline) (0.425 Bun, 0.563 Node) by the implied row above; it agrees with the direct HEAD / BASE block to within 0.005.

### Files

The raw rounds and summaries are in `docs/rd/performance/phase-3-ab/head-<runtime>-jit-<mode>-<input>.json` (12 files, HEAD against STEP1) and `head-base-<runtime>-jit-off-<input>.json` (6 files, HEAD against BASE), in the shape described in [Files and load](#files-and-load). The HEAD / STEP1 and HEAD / BASE cells read `summary.cpuPerOpMs.newOverOld` and `summary.wallMedianMs.newOverOld`; the computis cells read `summary.cpuPerOpMs.competitors` (`new/` and `old/` keys); the stream cells read `summary.timeToFirstRecordMedianMs`, `summary.allocationBytesPerOp`, `summary.peakHeapUsedBytes`, and `summary.peakRssBytes`. The encode control and the implied rows divide a median here by the matching median in the `cumulative-*.json` files.

## Phase 3: step-2 rule re-evaluated on the optimized code

This section re-evaluates the step-2 rule ([`docs/goals/performance/phase-3.md`](../goals/performance/phase-3.md), "The step-2 decision rule") on the code after option B, the builder (`7f1cff8`), the writer (`659480f`), the resolver (`07240f0`), and the fused resolve-collect channel (`7e280b3`). The rule builds the custom tokenizer only if `T > C` and `T - K <= C` on both Bun and Node at `bank-4m` and `bank-64m`, JIT `off`.

### Verdict

**Does not fire.** At `bank-4m` on Node, `T > C` holds (`T / C` 2.20), but `(T - K) / C` is 1.146 (1.051–1.225), with `K` the tokenizer and resolver of the shipped path. The interval lies above 1 when `T` is measured in the case harness and when it is measured in the rung harness. The rule needs all four cells, so this one cell decides the verdict.

The other cells:

- Bun fires at both sizes when `T` comes from the case harness.
- Bun is inconclusive at both sizes when `T` comes from the rung harness: the intervals straddle 1.
- Node at `bank-64m` is inconclusive: its case-harness interval is 0.991–1.422.

The verdict depends on how `K` is defined. `K` here is the tokenizer plus the fused resolving machine that `decodeString` runs. Under the ruling's literal `K`, the `resolver` rung minus `transport`, the rule fires at `bank-4m` on both runtimes. That rung runs the separate `resolveEvents` channel. Since `7e280b3`, the shipped path no longer runs that channel, and the channel costs 0.43 `C` (Bun) and 0.57 `C` (Node) for the resolver, where the fused machine costs 0.26 `C` and 0.24 `C`. See [K definitions](#k-definitions).

The tokenizer and the fused resolver alone cost about one `C`: `K / C` is 1.05 on Bun and 1.08 on Node at `bank-4m`. A free tokenizer and resolver would be needed for parity but would not be enough on Node: 1.15 `C` would remain in the collector, the builder, and the structural decode.

### Method

- **Tree.** NEW is `7e280b3`, measured from a worktree at `30169e6`. That tree adds the `typed/resolve-fused` rung (`30169e6`) and the option-B write-up (`2d51fa7`), and its `src/` is identical to `7e280b3`'s. The raw files record `30169e6` with `dirty: true`, because the worktree's `node_modules` symlink is untracked. The worktree was removed after the runs.
- **Driver.** `bench/ab.ts --new-only true` with both trees set to the worktree, JIT `off`. Each round runs two cases, `effect-xml/typed-decode` (`T`) and `computis-effect-xml/typed-decode` (`C`), and 13 rungs of `bench/profile/layers.ts`: the differential `transport`, `tokenizer`, `resolver`, and `collector`; the typed-decode ladder `typed/tokenizer` through `typed/to-type`; `typed-document`; and `typed/resolve-fused`. Each unit runs in a child process of its own, and every other round runs in reverse order. The driver repeats a round once when its load or a unit's CPU is an outlier.
- **Rounds.** 15 kept rounds at `bank-4m` under the `ab` policy, and 8 at `bank-64m` under the `large` policy (2 samples per child). Repeated rounds: 7 (Bun `bank-4m`), 6 (Node `bank-4m`), 5 (Bun `bank-64m`), and 3 (Node `bank-64m`). The Bun and Node blocks ran at the same time as each other, beside the option-B and cumulative A/B chains. The 1-minute load ran from 11.7 to 92.8.
- **K on the shipped path.** Since `7e280b3`, `decodeString` and `fromString` run `resolveCollect`, one machine that hands each start, end, and text straight to the collector. No rung could time the resolver alone on that path. `typed/resolver` runs the separate `resolveEvents` channel, which builds every `ResolvedEvent` and chunk that the fused machine skips. `typed/collector` adds the separate `collect` on top. `30169e6` adds `typed/resolve-fused`: the whole document through the tokenizer and `resolveCollect`, under a collect path that matches no element. Its collector does only depth counting, with a counter step and a comparison per start and end. `K` is that rung.
- **What K includes.** `K` includes that depth counting, which slightly overstates the tokenizer and resolver and so favors firing. `K` excludes the collector's work on matched records: record trees, budgets, and record emission. That work belongs to the collector in both designs. The fused machine's split between resolver and collector has no rung of its own beyond this one.
- **T in two harnesses.** The option-B A/B found that on Bun the case harness (`bench/cases/effect-xml-typed.ts`) reports less CPU than the rung harness for the same code (see [Phase 3: fromString option B under load (A/B)](#phase-3-fromstring-option-b-under-load-ab)). `K` is a rung, so the tables give `T` both ways:
  - `T` (case) is the rule's `effect-xml/typed-decode`.
  - `T` (rung) is `typed-document`, the same `XmlSchema.fromString(ItemBank)` decode in the harness that `K` is cut from.
  - `C` exists only as a case, so `(T - K) / C` with `T` (rung) divides a rung difference by a case value.
  - The scaled column takes the share `(T - K) / T` inside the rung harness and multiplies it by `T / C` inside the case harness: `(1 - K / T(rung)) × T(case) / C`.
- **Case over rung.** `T` (case) over `T` (rung), from the same rounds, is 0.852 (0.815–0.913) on Bun and 0.981 (0.932–1.091) on Node at `bank-4m`, and 0.925 (0.717–1.168) and 1.130 (0.888–1.255) at `bank-64m`. The Bun offset at `bank-4m` reproduces the option-B finding. It was not investigated further.
- **Derivation.** Every quantity is computed per kept round from that round's units. It is then reduced to a median with the driver's distribution-free interval (`interval` in `bench/ab.ts`). An interval that straddles 1 is inconclusive.
- **Files.** `docs/rd/performance/phase-3-ab/step2-<runtime>-jit-off-<input>.json` (4 blocks, the raw rounds) and `step2-derived.json` (every number below, per round and reduced, with its definitions).

### T, C, and K, CPU time per operation

CPU milliseconds per operation, median (interval). `K` is `typed/resolve-fused`.

| Runtime | Input      | T (case)               | T (rung)               | C                   | K                    | T/C (case)          | T/C (rung)          |
| ------- | ---------- | ---------------------- | ---------------------- | ------------------- | -------------------- | ------------------- | ------------------- |
| bun     | `bank-4m`  | 54.89 (49.12–57.32)    | 62.10 (59.59–64.51)    | 31.36 (29.52–33.06) | 31.43 (30.73–32.09)  | 1.715 (1.667–1.759) | 1.996 (1.855–2.115) |
| bun     | `bank-64m` | 1087.4 (979.8–1290.4)  | 1168.9 (1027.6–1479.4) | 551.6 (521.8–668.0) | 694.9 (635.4–762.5)  | 1.972 (1.823–2.226) | 2.175 (1.783–2.543) |
| node    | `bank-4m`  | 93.84 (83.95–97.69)    | 92.12 (86.55–99.33)    | 41.72 (38.86–43.21) | 43.76 (42.48–45.87)  | 2.200 (2.123–2.295) | 2.282 (2.079–2.374) |
| node    | `bank-64m` | 1856.6 (1589.4–2001.7) | 1623.5 (1522.4–1896.4) | 794.3 (630.7–861.9) | 840.9 (764.4–1029.1) | 2.384 (2.150–2.605) | 2.024 (1.871–2.934) |

| Runtime | Input      | K/C                 | (T-K)/C (case)      | (T-K)/C (rung)      | (T-K)/C (scaled)    | Rule                                    |
| ------- | ---------- | ------------------- | ------------------- | ------------------- | ------------------- | --------------------------------------- |
| bun     | `bank-4m`  | 1.046 (0.952–1.068) | 0.667 (0.619–0.765) | 0.962 (0.859–1.056) | 0.840 (0.803–0.881) | Fires (case, scaled); rung inconclusive |
| bun     | `bank-64m` | 1.254 (0.951–1.357) | 0.718 (0.604–0.981) | 0.881 (0.621–1.332) | 0.836 (0.698–0.955) | Fires (case, scaled); rung inconclusive |
| node    | `bank-4m`  | 1.077 (0.977–1.134) | 1.146 (1.051–1.225) | 1.171 (1.070–1.292) | 1.142 (1.082–1.204) | Does not fire (all three)               |
| node    | `bank-64m` | 1.160 (0.924–1.304) | 1.233 (0.991–1.422) | 1.059 (0.644–1.630) | 1.133 (0.763–1.447) | Inconclusive (all three)                |

### K definitions

`(T - K) / C` with `T` from the case harness, then from the rung harness, for each candidate `K`. Fused is the shipped path and the row the verdict uses. Separate is `typed/resolver`, the whole document through the tokenizer and the separate `resolveEvents` channel. Literal is the ruling's text: the differential `resolver` rung minus `transport`, over 64 KiB chunks, through the separate channel.

| K                                  | Bun `bank-4m`                            | Bun `bank-64m`                           | Node `bank-4m`                           | Node `bank-64m`                          |
| ---------------------------------- | ---------------------------------------- | ---------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Fused (`typed/resolve-fused`)      | 0.667 (0.619–0.765); 0.962 (0.859–1.056) | 0.718 (0.604–0.981); 0.881 (0.621–1.332) | 1.146 (1.051–1.225); 1.171 (1.070–1.292) | 1.233 (0.991–1.422); 1.059 (0.644–1.630) |
| Separate (`typed/resolver`)        | 0.504 (0.420–0.582); 0.795 (0.709–0.879) | 0.707 (0.339–0.937); 0.682 (0.380–1.314) | 0.774 (0.751–0.896); 0.822 (0.704–0.969) | 0.823 (0.582–1.223); 0.717 (0.234–1.106) |
| Literal (`resolver` - `transport`) | 0.446 (0.401–0.518); 0.714 (0.643–0.823) | 0.719 (0.472–0.923); 0.944 (0.489–1.192) | 0.737 (0.681–0.811); 0.806 (0.546–0.906) | 0.953 (0.708–1.106); 0.608 (0.408–1.241) |

With the separate or literal `K`, the rule fires at `bank-4m` on both runtimes in both harnesses, fires at Bun `bank-64m` in the case harness, and is inconclusive at Node `bank-64m`. With the fused `K` it does not fire. The separate and fused resolver layers differ by about 0.16 `C` (Bun) and 0.33 `C` (Node) at `bank-4m`. That difference is the separate channel's `ResolvedEvent` and chunk allocation, which the shipped path no longer pays.

### Decode layers, JIT off

Each layer is its rung minus the rung before it on the typed-decode ladder, per round. The ladder's resolver and collector rows are the separate channels. Their fused replacement shows in two places: in the decodeString row, which is negative because `decodeString` runs the fused channel and the rung before it does not, and in the fused-resolver row beside the ladder.

`bank-4m`:

| Layer                                                               | Bun ms                 | Bun /C                 | Node ms                | Node /C                |
| ------------------------------------------------------------------- | ---------------------- | ---------------------- | ---------------------- | ---------------------- |
| tokenizer (`typed/tokenizer`)                                       | 23.79 (22.45–24.41)    | 0.763 (0.729–0.785)    | 33.27 (32.65–37.62)    | 0.821 (0.799–0.902)    |
| resolver, separate (`typed/resolver`)                               | 13.59 (12.67–14.31)    | 0.426 (0.388–0.462)    | 22.51 (21.30–25.32)    | 0.569 (0.523–0.602)    |
| collector, separate (`typed/collector`)                             | 8.410 (6.575–10.25)    | 0.288 (0.218–0.327)    | 10.86 (9.699–12.28)    | 0.268 (0.245–0.328)    |
| builder (`typed/builder`)                                           | 10.48 (6.796–12.89)    | 0.322 (0.209–0.420)    | 8.651 (6.765–10.37)    | 0.218 (0.171–0.277)    |
| structural decode (`typed/structural`)                              | 14.46 (11.91–18.88)    | 0.489 (0.365–0.571)    | 22.33 (21.62–25.02)    | 0.549 (0.515–0.596)    |
| decodeString: glue less the fusion saving                           | -8.718 (-11.55–-5.599) | -0.275 (-0.386–-0.190) | -10.68 (-14.40–-5.876) | -0.266 (-0.345–-0.149) |
| fromString wrapper (`typed-document`)                               | 0.131 (-3.797–3.189)   | 0.004 (-0.128–0.108)   | 1.007 (0.029–4.069)    | 0.025 (0.001–0.094)    |
| beside: resolver, fused (`typed/resolve-fused` - `typed/tokenizer`) | 8.122 (7.153–9.310)    | 0.265 (0.220–0.305)    | 9.485 (6.930–12.79)    | 0.236 (0.162–0.293)    |

`bank-64m`, over `C`:

| Layer                                     | Bun /C                | Node /C                |
| ----------------------------------------- | --------------------- | ---------------------- |
| tokenizer                                 | 0.724 (0.542–0.827)   | 0.981 (0.846–1.176)    |
| resolver, separate                        | 0.679 (0.336–0.939)   | 0.557 (0.297–0.681)    |
| collector, separate                       | 0.203 (-0.391–1.141)  | 0.454 (0.276–0.854)    |
| builder                                   | 0.054 (-0.485–0.925)  | 0.271 (-0.028–0.511)   |
| structural decode                         | 0.595 (-0.499–1.524)  | 0.364 (-0.057–0.579)   |
| decodeString: glue less the fusion saving | -0.196 (-0.653–0.329) | -0.229 (-0.601–-0.132) |
| fromString wrapper                        | -0.029 (-0.489–0.578) | -0.057 (-0.249–0.133)  |
| beside: resolver, fused                   | 0.497 (0.180–0.792)   | 0.141 (0.022–0.263)    |

The wrapper row is within the noise at both sizes, so after option B `fromString` costs what `decodeString` costs in the rung harness. At `bank-4m` the tokenizer is the largest layer on both runtimes (0.76 `C` and 0.82 `C`), followed by the structural decode (0.49 `C` and 0.55 `C`). The builder and the fused resolver each cost 0.2 to 0.3 `C`.

### Caveats and what would settle it

- **Node `bank-64m` is inconclusive.** The case-harness interval is 0.991–1.422, from 8 rounds of 2 samples per child. More rounds at `bank-64m` on Node would settle it. They cannot change the verdict, because Node `bank-4m` already fails `T - K <= C`.
- **Bun's rung-harness cells straddle 1.** The Bun case-over-rung offset (0.85 at `bank-4m`) decides whether Bun fires. Finding out why the case harness reads less CPU than the rung harness for the same decode would settle the Bun cells. The Bun cells cannot change the verdict either.
- **The verdict rests on the fused `K`.** If the Mind reads the ruling's literal `K` (`resolver` minus `transport`) as binding, the rule fires at `bank-4m` on both runtimes and is inconclusive at Node `bank-64m`. The literal `K` times a channel the shipped path no longer runs. The ruling's `K` definition should name the fused rung.
- **Load.** The ratios pair values from the same round. The absolute times describe a loaded machine, at a 1-minute load of 11.7 to 92.8, and are not publishable throughput.
- **Earlier runs.** Two earlier passes were stopped and discarded. The first was stopped mid-block to add `typed-document` after the harness offset was reported. The second was stopped after its `bank-4m` blocks to add `typed/resolve-fused`. Those `bank-4m` blocks agree with the final ones: their medians of `T`, `C`, and the separate `K` lie inside the final intervals, and their case-over-rung offsets were 0.84 (Bun) and 1.00 (Node).

## Phase 3: stop and final status

Phase 3 stopped on 2026-11-08 by owner ruling. The stop rule: stop when no lever other than the tokenizer is projected to save at least 0.1 `C` on Node `bank-4m`, where `C` is the CPU per operation of `@computis/effect-xml`. Step 2, the custom tokenizer, was not built. Its rule does not fire under the amended `K` (see [Phase 3: step-2 rule re-evaluated on the optimized code](#phase-3-step-2-rule-re-evaluated-on-the-optimized-code)), and the owner chose not to build it as a cost decision.

### Why the stop rule fired

Three consecutive spikes found no lever outside the tokenizer worth 0.1 `C`. None was implemented.

| Spike                                                 | Commit               | Lever                                                              | Projected saving at `bank-4m`                                                                          |
| ----------------------------------------------------- | -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [tokenizer encode](perf3b-spikes/tokenizer-encode.md) | `b3e9a3e`, `47b7cd0` | how events reach upstream's encoder, or a direct text writer       | none; the one gain, at Node `bank-16k`, needs an upstream export                                       |
| [effect overhead](perf3b-spikes/effect-overhead.md)   | `e431665`            | the Effect runtime around and inside the structural codec          | about 0.04 `C` of decode and 0.09 `C` of encode, all inside Schema's interpreter; no end-to-end change |
| [schema nodes](perf3b-spikes/schema-nodes.md)         | `f41b43b`            | one Schema node per boolean or number leaf of the structural codec | 0.02–0.05 `C` of decode and 0.09–0.13 `C` of encode                                                    |

The largest of these is the schema-nodes encode saving at Node `bank-4m`: 0.131 `C` (0.079–0.162) on the structural rung. End to end it did not resolve: typed encode `T / C` was 2.513 (2.426–2.776) with the prototype against 2.543 (2.452–2.625) without it. These intervals are ranks 3 to 10 of 12, recomputed from the spike's raw rounds (final audit `4705e240`, residual R3); the spike's helper had returned ranks 4 to 9.

The three spike rows and the figures in the paragraph above rest on raw rounds kept only in the gitignored `work/spikes/` (`perf3b-tokenizer-encode/`, `perf3b-sp-effect-overhead/`, `perf3b-schema-nodes/`). The committed record is each spike's file; no JSON under `docs/rd/performance/` carries them.

### Final ratios, CPU time per operation

Each value is the range of the per-cell medians at `bank-16k` and `bank-4m`, Bun and Node, JIT `off` (shipped), from [Phase 3: what shipped, measured (HEAD A/B)](#phase-3-what-shipped-measured-head-ab). HEAD is `7474d56`, whose `src/` tree is the shipped one. Below 1, HEAD uses less CPU.

| Comparison                     | Source                               | Typed decode | Stream    | Positioned stream | Typed encode |
| ------------------------------ | ------------------------------------ | ------------ | --------- | ----------------- | ------------ |
| HEAD / phase-3 start `bd60a0e` | `bd8624c`, `head-base-*.json`        | 0.29–0.48    | 0.41–0.54 | 0.59–0.69         | 0.13–0.22    |
| HEAD / step 1 `ee496cc`        | `bd8624c`, `head-*.json` (JIT `off`) | 0.55–0.68    | 0.74–0.80 | 0.86–0.88         | 0.50–0.62    |

The BASE blocks timed no encode, so the HEAD / `bd60a0e` encode cell is `659480f` / `bd60a0e` from [Cumulative phase 3: NEW against the baseline](#cumulative-phase-3-new-against-the-baseline) (`f000c1d`). No encode `src/` change landed after `659480f`, and the HEAD A/B's [encode control](#encode-control) measures 0.92–1.07, so that cell describes the shipped encode.

Against computis, `T / C` is effect-xml's typed CPU over computis's in the same round, from the HEAD side of `head-*.json` (`bd8624c`), at `bank-16k` and `bank-4m`, Bun and Node. computis runs with its default, the Schema JIT on.

| effect-xml mode          | Typed decode `T / C` | Typed encode `T / C` |
| ------------------------ | -------------------- | -------------------- |
| JIT `off` (shipped)      | 1.66–2.44            | 1.84–2.66            |
| JIT `on` (like for like) | 1.54–2.17            | 1.52–2.71            |

All four cells come from one session on the shipped `src/`. In the same rounds, STEP1's JIT `off` typed decode `T / C` was 2.83–3.64.

### Streaming guardrail

At HEAD, one cell crossed the 5% line of the phase-3 guardrail ([`phase-3.md`](../goals/performance/phase-3.md), "Non-goals"). On Node at `bank-4m`, JIT `off`, the positioned stream's peak heap was 1.111 (1.018–1.225) of BASE's and its peak RSS 1.065 (1.014–1.099), while it allocated 0.455 of BASE's bytes. The values are under `summary.peakHeapUsedBytes`, `summary.peakRssBytes`, and `summary.allocationBytesPerOp` in `head-base-node-jit-off-bank-4m.json`; the other memory cells are in [HEAD / BASE and the streaming no-regression verdict](#head--base-and-the-streaming-no-regression-verdict). Streaming CPU did not regress: every stream and positioned-stream CPU interval against BASE lies below 0.78.

The spike [stream-heap.md](perf3b-spikes/stream-heap.md) found the cause, and `48d4bcf` and `9beee49` fix it. HEAD held nothing alive longer: the live heap during the positioned stream is 1.000 (1.000–1.003) of BASE's. The peak counted garbage. Each record's position tree sits in a module-level `WeakMap` (`recordTrees` in `src/resolve.ts`), whose entry keeps the tree through the young collection after its record dies; V8 then pretenures the tree nodes, and every positioned record's tree waits in the old generation for a mark-compact, 9 to 11 MiB per run at `bank-4m`. BASE has the same mechanism. The fix deletes a record's entry once the record has decoded, on positioned runs only.

Re-measured on Node at `bank-4m`, JIT `off`, 12 interleaved rounds per block, with `9beee49` as FIXED:

| Metric, FIXED / side | Positioned, / BASE  | Positioned, / HEAD  | Plain, / HEAD       |
| -------------------- | ------------------- | ------------------- | ------------------- |
| Peak heap used       | 0.409 (0.363–0.442) | 0.358 (0.341–0.376) | 1.000 (0.992–1.006) |
| Peak RSS             | 0.607 (0.583–0.649) | 0.580 (0.576–0.590) | 1.003 (0.998–1.009) |
| CPU per operation    | 0.547 (0.532–0.552) | 0.861 (0.805–0.873) | 0.999 (0.987–1.013) |

No Node `bank-4m` stream cell now crosses the guardrail; the plain stream's peak heap against BASE is 1.005 (0.979–1.042). Bun, `bank-16k`, and `bank-64m` were not re-measured. The results files are gitignored under `work/spikes/perf3-stream-heap/`; the spike lists them.

### Where the remaining decode gap lives

At Node `bank-4m`, JIT `off`, typed decode `T / C` is 2.200 (2.123–2.295). Its layers, in units of `C`:

| Layer                      | Cost (`C`) | Source                                                                                                                                     |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| upstream tokenizer         | 0.82       | `a310ba3`, [Decode layers, JIT off](#decode-layers-jit-off)                                                                                |
| resolve and collect, fused | 0.57–0.60  | the resolver spike's fused prototype, [resolver.md](perf3b-spikes/resolver.md); no rung times the shipped fused machine with the collector |
| structural decode          | 0.55       | `a310ba3`, [Decode layers, JIT off](#decode-layers-jit-off)                                                                                |
| builder                    | 0.22       | `a310ba3`, [Decode layers, JIT off](#decode-layers-jit-off)                                                                                |

On Bun the tokenizer is 0.76 `C`. The tokenizer is the largest layer on both runtimes, and the step-2 rule is what would have built a replacement. The fused resolve-and-collect row rests on raw rounds kept only in the gitignored `work/spikes/perf3b-resolver/`; the other rows read committed files under `docs/rd/performance/phase-3-ab/` (`step2-*.json`).

### Load

Every ratio above pairs values from the same round on a loaded machine. The absolute times behind them are not throughput figures, and this section gives no MB/s. An idle-machine run for absolute throughput is a separate, later task.

## How to run

Every file under `bench/` runs unmodified under `bun <file>` and `node <file>`. The matrix driver measures each case-input pair in its own process on the driver's runtime and writes one results file.

```sh
bun run bench                       # the full matrix on Bun (bun bench/run.ts)
bun run bench:node                  # the full matrix on Node (node bench/run.ts)
bun bench/run.ts --smoke            # corpus-items, corpus-all, and bank-16k under the smoke sampling policy
bun bench/run.ts --filter saxes     # only cases whose id contains "saxes"
bun bench/run.ts --input bank-4m --input bank-64m
bun bench/run.ts --tokenizer upstream
bun bench/run.ts --jit on            # every case process with the Schema JIT enabled
bun bench/run.ts --out work/bench/my-run.json
```

The flags combine. `--input` repeats and takes a registered input id: `corpus-all`, `corpus-items`, `bank-16k`, `bank-256k`, `bank-4m`, or `bank-64m`. `--tokenizer` takes a registered tokenizer name. The harness registers only `upstream`, the `effect/encoding/Xml` tokenizer the library uses by default. Without `--out`, the results file lands under `work/bench/`. The driver exits 0 when every pair produced a result, 1 when any pair failed, and 2 when an argument is malformed.

On 2026-11-09, all fourteen non-PCI fixtures of `spikes/fixtures/qti/` were replaced with files authored here, so both the `corpus-all` and `corpus-items` inputs changed. The replaced files include the four `corpus-items` fixtures, which earlier came from 1EdTech. Every `corpus-all` and `corpus-items` figure in this document and in `docs/rd/performance/**` was measured on the earlier files and does not describe the current corpus. The `bank-*` inputs are unchanged.

`--jit` sets the Schema JIT mode of every case process and records it as `environment.jit` in the results file:

- `off`, the default, runs Schema parsing interpreted, as the library ships.
- `on` preloads `effect/schema/SchemaJITCompiler/enable` into each case process before the library loads, the way a consumer enables the JIT process-wide. The library build does not change.
- `noeval` preloads the same module, then replaces `globalThis.Function` with a proxy that refuses every call, as a content security policy without `unsafe-eval` does. The JIT's support probe fails and every parser falls back to the interpreter. Each case process checks that the proxy is still installed after the check run and prints how many calls it refused to standard error. One refusal means the JIT was reached and turned away.

The driver passes the preload as `--preload` on Bun and `--import` on Node. A case process started with a `--jit` value that disagrees with its preload exits 2, so run JIT modes through `bench/run.ts`. The layer ladder and the CPU-profile driver always run with the JIT off.

`--filter` matches a substring of the case id. A filter of `effect-xml` also selects the `computis-effect-xml/*` cases, and so does `effect-xml/`.

The layer ladder times a bank decode one layer at a time in one process:

```sh
bun bench/profile/layers.ts [--input <id>]... [--tokenizer <name>] [--smoke] [--out <file>]
```

It measures `bank-256k` and `bank-4m` by default and writes `work/bench/layers-<runtime>-<time>.json`. The phase-2 layers files also measure `bank-64m`.

The CPU-profile driver runs each effect-xml case in a case process under `--cpu-prof` and buckets the profile by library layer:

```sh
bun bench/profile/cpu.ts [--input <id>] [--tokenizer <name>] [--out <file>]
```

It profiles `bank-4m` by default, writes `work/bench/cpu-<runtime>-<time>.json`, and keeps each raw profile under `work/bench/profiles/<runtime>-<time>/`. The `phase-2-cpu-64m-<runtime>.json` files come from `--input bank-64m`.

The report prints the environment, capability, class, scaling, and failure tables of one or more results files:

```sh
bun bench/report.ts docs/rd/performance/phase-2-bun.json docs/rd/performance/phase-2-node.json
```

Run the same commands with `node` in place of `bun` for the Node side.

## Environment and method

Both phase-2 matrix runs used one machine, the one phase 1 used. The Bun run recorded commit `75d46bd`, and the Node run recorded `76aa910`. The layer and CPU files record the same commits as the matrix file of their runtime. The two final files record `45e6aed` on the same machine, with the same package versions and sampling method as the table and lists below.

| Field                | bun 1.4.2                                | node 26.13.0                             |
| -------------------- | ---------------------------------------- | ---------------------------------------- |
| OS                   | Darwin 27.2.0                            | Darwin 27.2.0                            |
| Architecture         | arm64                                    | arm64                                    |
| CPU                  | Apple M4 Pro                             | Apple M4 Pro                             |
| Cores                | 14                                       | 14                                       |
| Memory (GiB)         | 48.0                                     | 48.0                                     |
| Commit               | 75d46bd58b42c692d90ecf1173fe884e4a36f5eb | 76aa9109e2ff19f8b6b9fbf9eb47ede2223ec148 |
| @computis/effect-xml | 0.4.0                                    | 0.4.0                                    |
| @rgrove/parse-xml    | 5.1.0                                    | 5.1.0                                    |
| effect               | 4.1.2                                    | 4.1.2                                    |
| fast-xml-parser      | 5.12.0                                   | 5.12.0                                   |
| libxml2-wasm         | 0.7.2                                    | 0.7.2                                    |
| sax                  | 1.6.1                                    | 1.6.1                                    |
| saxes                | 6.0.0                                    | 6.0.0                                    |
| txml                 | 6.0.3                                    | 6.0.3                                    |

### Method: bun 1.4.2

- Warmup: 5 iterations and at least 1000 ms
- Samples: 30 to 200, over 3000 to 60000 ms
- Stream chunk: 65536 bytes
- Quantiles: nearest-rank; isolation: process-per-case
- Sampler floor: median 0.000 ms, p95 0.000 ms, p99 0.000 ms
- Tokenizers: upstream

### Method: node 26.13.0

- Warmup: 5 iterations and at least 1000 ms
- Samples: 30 to 200, over 3000 to 60000 ms
- Stream chunk: 65536 bytes
- Quantiles: nearest-rank; isolation: process-per-case
- Sampler floor: median 0.000 ms, p95 0.000 ms, p99 0.000 ms
- Tokenizers: upstream

The matrix measures each case-input pair in a separate process, so peak RSS belongs to one case. Each process prepares the case once, checks its output count against the input's reference outside the timed loop, warms up, and then samples a synchronous `run`. Quantiles use the nearest-rank method over the raw samples. The sampler floor is the median of an empty timed call, under 0.001 ms on both runtimes.

The layer ladder uses the same sampling policy in one process (`isolation: single-process`) and reports wall time only. Its floor median is 0.000041 ms on both runtimes. A CPU profile spans the whole case process: input preparation, the `check` run, warmup, and every sample. Compare its buckets across cases and runtimes, not with a case's sampled wall time.

The eight phase-2 matrix, layer, and CPU files and the two final files record `environment.dirty: false`; the final worktree linked each `node_modules` entry inside a real directory, which git ignores. The A/B files record `environment.dirty: true` only because each worktree they ran in held an untracked `node_modules` symlink; no tracked file differed from the recorded commit.

The [Status](#status) section records the load average of each run.

## Libraries and what they do

The harness records each library's capabilities by probe, not from documentation. The notes column says how each entry is configured and where a default was changed.

| Library               | Rejects malformed | Resolves namespaces | Decodes entities | Expands DOCTYPE entities | Reports positions | Streams | Typed | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ----------------- | ------------------- | ---------------- | ------------------------ | ----------------- | ------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| @aidenzepp/effect-xml | yes               | yes                 | yes              | no                       | yes               | yes     | yes   | probed through XmlSchema.ElementFromString with prefixes read from the document's xmlns declarations; reportsPositions: XmlSchema.decodeSchemaString with positions: true puts the start tag's line and column on a SchemaFailure; streams: XmlSchema.decodeSchemaString decodes records from text read chunk by chunk; typed: XmlSchema.fromString decodes a whole document through an element codec; expandsDoctypeEntities: a DOCTYPE internal subset does not decode to its entity's text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| fast-xml-parser       | no                | no                  | yes              | yes                      | no                | no      | no    | tree and encode-tree use preserveOrder: true and ignoreAttributes: false (non-default): child order and attributes are data in QTI, and effect-xml keeps both.; typed-decode uses ignoreAttributes: false, attributeNamePrefix: '' and isArray for qti-assessment-item-ref, qti-branch-rule, and qti-weight (non-default), then decodes with an Effect Schema.; reportsPositions: XMLParser.parse output carries no source positions.; streams: XMLParser.parse takes the whole document as one string or Uint8Array.; typed: the library has no schema layer; the typed-decode case pairs it with Effect Schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| saxes                 | yes               | yes                 | yes              | no                       | yes               | yes     | no    | resolvesNamespaces with `xmlns: true` (non-default), which `saxes/stream` uses because its record path is namespace-qualified, as effect-xml's is; `saxes/events` keeps the default `xmlns: false`, which reports names as written, like the upstream tokenizer.; expandsDoctypeEntities: saxes does not read the internal DTD subset, so `&e;` fails as an undefined entity.; reportsPositions: `SaxesParser.line`, `column`, and `position`, tracked unless the `position` option is `false`.; streams: `SaxesParser.write(chunk)` accepts input chunk by chunk; `close()` ends the document.; typed: no schema or typed-decode API; events carry names and string attribute values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| sax                   | yes               | no                  | yes              | no                       | yes               | yes     | no    | strict mode (`sax.parser(true)`) is non-default: non-strict mode accepts malformed input, and every other entry is strict; reportsPositions: `SAXParser.line`, `SAXParser.column`, and `SAXParser.position`; streams: `SAXParser.write` accepts input chunk by chunk; typed: no schema or typed decode API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| txml                  | yes               | no                  | no               | no                       | no                | yes     | no    | Default options throughout: `decodeEntities` is off, so entity references stay as written in text and attributes.; reportsPositions: no node carries a source position; `parse` throws an `Error` whose message text names the line and column of an unexpected close tag, and `setPos` reports only the offset where parsing stopped.; streams: `transformStream` (Node `Transform`) and `transformWebStream` accept chunked text; no case here uses them.; typed: txml has no schema API; `parse` returns untyped `TNode` trees.; Prefixed names stay in `tagName` (`p:a`) and `xmlns` declarations stay plain attributes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| @rgrove/parse-xml     | yes               | no                  | yes              | no                       | yes               | no      | no    | Default options: `parseXml(text)` with no `ParserOptions`.; Positions: `includeOffsets: true` sets `start` and `end` character offsets on each node (off in the case); `XmlError` carries `line`, `column`, and `pos`.; Not streaming: `parseXml` takes the whole document as one string.; Not typed: the output is an untyped `XmlDocument` tree.; Namespaces: prefixed names stay as written (`p:a`) and `xmlns:*` stays an attribute; no URI is resolved.; Doctype entities: an internal-subset `<!ENTITY>` is not expanded; a reference to it fails as undefined.; No serializer: the library cannot write XML, so it enters no encode class.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| libxml2-wasm          | yes               | yes                 | yes              | yes                      | yes               | no      | no    | reportsPositions: a failed parse throws XmlParseError, whose details carry the line and col of each libxml2 diagnostic, and XmlNode.line gives a parsed node's line.; streams: false; the public API parses a whole string or buffer (XmlDocument.fromString, XmlDocument.fromBuffer) and exposes no push parser.; typed: false; the output is a libxml2 DOM, with no schema-typed decode.; expandsDoctypeEntities: with the default parse options (XML_PARSE_NOENT unset) the tree keeps an XmlEntityReference node, and XmlNode.content resolves it to the declared text.; tree: each run disposes the previous run's documents before parsing, inside the timed region, because the README requires dispose() to free a document's WebAssembly memory.; encode-tree: XmlDocument.toString({ format: false }), a non-default option; toString formats its output when called without options.; Memory: documents live on the WebAssembly heap, outside the JavaScript heap, so heapUsedBytes understates the library's memory; peak RSS is the comparable figure.                                                                                                                                                                                                                                                                                                                                                  |
| @computis/effect-xml  | yes               | yes                 | yes              | no                       | no                | no      | yes   | typed: codec(schema) compiles an Effect Schema annotated with root() and element() into decode (XML string to value) and encode (value to XML string).; streams: false; decode takes the whole document as one string and has no chunked input.; reportsPositions: false; decoded values carry no source positions, and only XmlParseError and XmlDecodeError carry a position (line, column, offset).; resolvesNamespaces: probed as root("a", { namespace: "urn:x" }) accepting <p:a xmlns:p="urn:x"/> and namespace "urn:y" rejecting it; the decoded value does not carry the namespace.; decodesEntities: probed on <r><a>&amp;</a></r>, because the root must be a Struct rather than a text leaf.; expandsDoctypeEntities: false; the tokenizer rejects every DOCTYPE declaration with XmlParseError.; jit: left at its default (true), which enables the Effect Schema JIT for the bank Schema process-wide.; The bank Schema names fields by element name (qti-weight, qti-branch-rule) and lists qti-weight first: the decoder takes struct field order as document order.; Attributes must be string leaves in the encoded Schema: value is Schema.FiniteFromString, and fixed and required decode the literals true and false.; encode writes the XML declaration (encoder.declaration default) and no indentation.; prepare ignores the benchmark tokenizer: the library parses with its own tokenizer. |

Read the class results with these capabilities beside them:

- `fast-xml-parser` does not reject malformed XML, and it expands DOCTYPE entities. A speed comparison with it compares a parser that skips the well-formedness check.
- `libxml2-wasm` keeps its documents on the WebAssembly heap, outside the JavaScript heap. Its `heapUsedBytes` understates its memory. Compare peak RSS instead.
- `@computis/effect-xml` parses with its own tokenizer and ignores the benchmark's `--tokenizer`. Its decoder reads struct fields in document order, so its bank Schema lists `qti-weight` first.

## Results per class

Each class lists, per input, the Bun table and then the Node table. Rows run from fastest to slowest median, and the ratio is the row's median over the fastest median in that table. Throughput is the input's UTF-8 bytes over the median.

The `effect-xml/*` rows come from the final files, `phase-2-final-{bun,node}.json` at `45e6aed`. Every other row, `computis-effect-xml/*` included, comes from the phase-2 files, `phase-2-{bun,node}.json`. The report takes one file per runtime, so the tables render a copy of each phase-2 file whose `effect-xml/*` results are replaced, in place, by the final file's:

```sh
bun bench/report.ts <phase-2-bun.json with the final effect-xml/* results> <phase-2-node.json with the final effect-xml/* results>
```

### Class: events

Beyond a flat event sequence, all three entries reject malformed input and decode entities, and none resolves namespaces: effect-xml's entry is the upstream tokenizer before the resolver, and `saxes/events` keeps the default `xmlns: false`.

#### events: corpus-all

##### bun 1.4.2

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 0.120       | 0.134    | 0.155    | 275.95 | 1.00x | 1200.310      | 37.550          | 209.1          | 45.5            | 2496.33           | 28       | 17.394        |
| saxes                 | saxes/events      | 200     | 0.208       | 0.233    | 0.247    | 159.46 | 1.73x | 1134.490      | 21.015          | 205.3          | 44.6            | 1016.67           | 12       | 6.668         |
| sax                   | sax/events        | 200     | 0.491       | 0.567    | 0.668    | 67.48  | 4.09x | 1250.934      | 23.450          | 228.8          | 44.9            | 1513.12           | 18       | 10.523        |

##### node 26.13.0

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| saxes                 | saxes/events      | 200     | 0.150       | 0.160    | 0.197    | 220.50 | 1.00x | 1073.786      | 16.349          | 201.3          | 61.6            | 1756.56           | 54       | 6.700         |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 0.176       | 0.193    | 0.216    | 188.07 | 1.17x | 1125.479      | 20.113          | 221.9          | 83.8            | 1841.26           | 57       | 11.997        |
| sax                   | sax/events        | 200     | 0.533       | 0.624    | 0.745    | 62.20  | 3.55x | 1137.326      | 14.529          | 200.3          | 62.9            | 1393.22           | 46       | 6.747         |

#### events: corpus-items

##### bun 1.4.2

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 0.026       | 0.033    | 0.039    | 253.15 | 1.00x | 1166.237      | 53.747          | 208.7          | 45.2            | 2541.51           | 28       | 16.674        |
| saxes                 | saxes/events      | 200     | 0.038       | 0.040    | 0.047    | 175.13 | 1.45x | 1077.879      | 32.106          | 199.7          | 44.5            | 1233.82           | 14       | 7.253         |
| sax                   | sax/events        | 200     | 0.090       | 0.098    | 0.107    | 73.00  | 3.47x | 1143.236      | 27.670          | 231.8          | 44.6            | 1541.07           | 17       | 10.280        |

##### node 26.13.0

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| saxes                 | saxes/events      | 200     | 0.029       | 0.031    | 0.035    | 225.67 | 1.00x | 1027.179      | 28.422          | 200.1          | 61.3            | 1841.50           | 55       | 6.658         |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 0.035       | 0.039    | 0.057    | 186.94 | 1.21x | 1084.324      | 29.132          | 218.1          | 79.5            | 2042.66           | 61       | 12.258        |
| sax                   | sax/events        | 200     | 0.098       | 0.103    | 0.114    | 66.99  | 3.37x | 1038.443      | 19.449          | 200.9          | 62.1            | 1443.99           | 43       | 5.765         |

#### events: bank-16k

##### bun 1.4.2

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 0.059       | 0.072    | 0.098    | 282.31 | 1.00x | 1183.235      | 40.691          | 208.1          | 47.1            | 2246.65           | 25       | 14.636        |
| saxes                 | saxes/events      | 200     | 0.107       | 0.110    | 0.116    | 154.99 | 1.82x | 1101.866      | 24.352          | 197.3          | 44.2            | 1207.74           | 14       | 6.979         |
| sax                   | sax/events        | 200     | 0.243       | 0.284    | 0.318    | 68.18  | 4.14x | 1182.976      | 24.300          | 226.4          | 44.2            | 1485.31           | 17       | 9.795         |

##### node 26.13.0

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| saxes                 | saxes/events      | 200     | 0.078       | 0.086    | 0.121    | 212.38 | 1.00x | 1037.119      | 20.541          | 201.0          | 61.2            | 2128.49           | 64       | 7.446         |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 0.081       | 0.086    | 0.096    | 204.61 | 1.04x | 1061.093      | 28.540          | 210.5          | 73.3            | 1644.92           | 50       | 11.467        |
| sax                   | sax/events        | 200     | 0.257       | 0.297    | 0.353    | 64.23  | 3.31x | 1081.160      | 13.281          | 200.0          | 61.3            | 1363.76           | 42       | 5.386         |

#### events: bank-256k

##### bun 1.4.2

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 0.831       | 0.973    | 1.767    | 315.61 | 1.00x | 1268.388      | 44.387          | 253.3          | 91.5            | 2287.66           | 29       | 21.402        |
| saxes                 | saxes/events      | 200     | 1.700       | 1.858    | 2.244    | 154.38 | 2.04x | 1383.867      | 21.839          | 193.7          | 44.7            | 1231.59           | 18       | 7.760         |
| sax                   | sax/events        | 200     | 4.031       | 4.571    | 4.737    | 65.09  | 4.85x | 1995.909      | 29.256          | 244.5          | 44.9            | 1422.48           | 28       | 17.098        |

##### node 26.13.0

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 1.252       | 1.558    | 1.642    | 209.63 | 1.00x | 1298.118      | 21.980          | 203.6          | 67.5            | 1645.37           | 63       | 17.822        |
| saxes                 | saxes/events      | 200     | 1.367       | 1.537    | 1.607    | 191.88 | 1.09x | 1291.775      | 12.589          | 201.9          | 61.6            | 1890.40           | 72       | 8.667         |
| sax                   | sax/events        | 200     | 4.166       | 4.416    | 4.481    | 62.98  | 3.33x | 1858.451      | 16.925          | 201.3          | 61.6            | 1322.81           | 72       | 9.262         |

#### events: bank-4m

##### bun 1.4.2

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/events | 200     | 14.306      | 16.731   | 17.831   | 293.19 | 1.00x | 4643.064      | 151.146         | 593.6          | 289.4           | 2192.55           | 64       | 208.531       |
| saxes                 | saxes/events      | 114     | 26.263      | 28.372   | 29.350   | 159.71 | 1.84x | 4033.135      | 45.521          | 220.1          | 52.6            | 1243.97           | 46       | 19.396        |
| sax                   | sax/events        | 47      | 63.390      | 67.591   | 69.376   | 66.17  | 4.43x | 4035.871      | 69.525          | 245.9          | 53.0            | 1598.84           | 59       | 39.601        |

##### node 26.13.0

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| saxes                 | saxes/events      | 134     | 22.431      | 23.259   | 23.573   | 186.99 | 1.00x | 4030.783      | 29.048          | 207.5          | 70.1            | 1867.21           | 225      | 28.192        |
| @aidenzepp/effect-xml | effect-xml/events | 131     | 22.483      | 26.624   | 27.867   | 186.56 | 1.00x | 5546.567      | 70.474          | 456.8          | 289.5           | 1533.02           | 211      | 356.252       |
| sax                   | sax/events        | 43      | 70.807      | 73.249   | 73.682   | 59.24  | 3.16x | 4111.589      | 24.732          | 208.1          | 69.5            | 1271.44           | 155      | 19.617        |

#### events: bank-64m

##### bun 1.4.2

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/events | 30      | 234.968     | 256.909  | 271.305  | 285.61 | 1.00x | 10808.975     | 456.794         | 2878.0         | 1434.9          | 2062.69           | 22       | 771.642       |
| saxes                 | saxes/events      | 30      | 424.485     | 453.844  | 487.096  | 158.10 | 1.81x | 14839.151     | 156.892         | 452.0          | 108.2           | 1223.92           | 81       | 34.097        |
| sax                   | sax/events        | 30      | 993.623     | 1014.362 | 1067.472 | 67.54  | 4.23x | 34801.936     | 301.145         | 503.4          | 109.5           | 1647.43           | 254      | 212.849       |

##### node 26.13.0

| Library               | Case              | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| saxes                 | saxes/events      | 30      | 372.673     | 377.398  | 381.671  | 180.07 | 1.00x | 13011.249     | 78.648          | 351.3          | 193.1           | 1774.31           | 692      | 100.841       |
| @aidenzepp/effect-xml | effect-xml/events | 30      | 381.804     | 452.291  | 461.149  | 175.77 | 1.02x | 18835.783     | 617.682         | 2285.9         | 1769.1          | 1464.11           | 582      | 1640.414      |
| sax                   | sax/events        | 30      | 1176.762    | 1204.426 | 1225.151 | 57.03  | 3.16x | 41152.371     | 226.529         | 373.0          | 191.7           | 1229.33           | 1516     | 226.844       |

### Class: tree

Beyond an element tree, effect-xml and `libxml2-wasm` resolve namespaces, every entry except `fast-xml-parser` rejects malformed input, every entry except `txml` decodes entities, and `fast-xml-parser` and `libxml2-wasm` expand DOCTYPE entities.

#### tree: corpus-all

##### bun 1.4.2

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 200     | 0.223       | 0.252    | 0.257    | 148.34 | 1.00x | 1065.744      | 21.207          | 197.9          | 45.9            | 656.24            | 8        | 5.242         |
| libxml2-wasm          | libxml2-wasm/tree    | 200     | 0.278       | 0.286    | 0.300    | 119.11 | 1.25x | 1174.512      | 18.880          | 153.7          | 44.2            | 32.39             | 1        | 2.831         |
| @rgrove/parse-xml     | parse-xml/tree       | 200     | 0.307       | 0.326    | 0.359    | 107.94 | 1.37x | 1160.297      | 23.929          | 212.9          | 47.5            | 826.61            | 10       | 6.457         |
| @aidenzepp/effect-xml | effect-xml/tree      | 200     | 0.372       | 0.474    | 1.327    | 89.15  | 1.66x | 1578.253      | 51.736          | 243.8          | 58.9            | 3231.81           | 37       | 30.550        |
| fast-xml-parser       | fast-xml-parser/tree | 200     | 0.507       | 0.640    | 0.771    | 65.37  | 2.27x | 1550.945      | 39.415          | 282.2          | 50.2            | 1899.96           | 23       | 13.770        |

##### node 26.13.0

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 200     | 0.154       | 0.171    | 0.250    | 215.01 | 1.00x | 1036.193      | 18.814          | 201.3          | 61.2            | 1263.04           | 39       | 7.061         |
| @rgrove/parse-xml     | parse-xml/tree       | 200     | 0.301       | 0.324    | 0.453    | 110.00 | 1.95x | 1094.927      | 16.385          | 200.7          | 61.5            | 1244.72           | 39       | 7.240         |
| libxml2-wasm          | libxml2-wasm/tree    | 200     | 0.344       | 0.427    | 0.509    | 96.27  | 2.23x | 1143.423      | 13.597          | 199.8          | 68.7            | 62.25             | 1        | 2.604         |
| @aidenzepp/effect-xml | effect-xml/tree      | 200     | 0.528       | 0.741    | 1.107    | 62.83  | 3.42x | 1390.460      | 33.347          | 269.9          | 126.4           | 2511.09           | 87       | 41.551        |
| fast-xml-parser       | fast-xml-parser/tree | 200     | 0.564       | 0.641    | 0.864    | 58.78  | 3.66x | 1181.154      | 20.516          | 202.9          | 62.2            | 2131.29           | 71       | 12.334        |

#### tree: corpus-items

##### bun 1.4.2

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 200     | 0.032       | 0.036    | 0.041    | 206.22 | 1.00x | 1017.336      | 31.293          | 194.9          | 44.7            | 1046.80           | 12       | 6.331         |
| libxml2-wasm          | libxml2-wasm/tree    | 200     | 0.055       | 0.059    | 0.065    | 119.85 | 1.72x | 1122.637      | 25.910          | 166.0          | 44.1            | 33.84             | 1        | 1.668         |
| @rgrove/parse-xml     | parse-xml/tree       | 200     | 0.057       | 0.060    | 0.068    | 116.41 | 1.77x | 1102.851      | 28.658          | 209.8          | 45.0            | 861.79            | 10       | 6.096         |
| fast-xml-parser       | fast-xml-parser/tree | 200     | 0.077       | 0.094    | 0.136    | 85.85  | 2.40x | 1390.270      | 41.931          | 251.6          | 46.4            | 2343.74           | 26       | 19.914        |
| @aidenzepp/effect-xml | effect-xml/tree      | 200     | 0.082       | 0.095    | 0.101    | 80.27  | 2.57x | 1507.727      | 54.178          | 234.1          | 49.5            | 3311.46           | 36       | 27.175        |

##### node 26.13.0

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 200     | 0.030       | 0.031    | 0.033    | 218.49 | 1.00x | 1002.902      | 25.806          | 201.1          | 65.5            | 1304.14           | 39       | 5.788         |
| @rgrove/parse-xml     | parse-xml/tree       | 200     | 0.057       | 0.060    | 0.064    | 114.55 | 1.91x | 1038.197      | 17.294          | 201.8          | 61.2            | 1240.35           | 37       | 4.769         |
| libxml2-wasm          | libxml2-wasm/tree    | 200     | 0.067       | 0.083    | 0.107    | 97.99  | 2.23x | 1094.828      | 21.112          | 206.1          | 68.1            | 83.78             | 2        | 3.347         |
| fast-xml-parser       | fast-xml-parser/tree | 200     | 0.107       | 0.120    | 0.151    | 61.30  | 3.56x | 1076.038      | 19.965          | 206.6          | 61.7            | 2184.76           | 66       | 8.435         |
| @aidenzepp/effect-xml | effect-xml/tree      | 200     | 0.116       | 0.132    | 0.253    | 56.84  | 3.84x | 1297.542      | 30.270          | 273.0          | 125.5           | 2583.54           | 81       | 38.031        |

#### tree: bank-16k

##### bun 1.4.2

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 200     | 0.101       | 0.111    | 0.116    | 163.01 | 1.00x | 1040.460      | 23.852          | 195.3          | 45.3            | 937.77            | 11       | 6.388         |
| @aidenzepp/effect-xml | effect-xml/tree      | 200     | 0.109       | 0.152    | 0.167    | 151.39 | 1.08x | 1410.172      | 57.756          | 234.8          | 58.3            | 4010.75           | 44       | 29.421        |
| libxml2-wasm          | libxml2-wasm/tree    | 200     | 0.120       | 0.126    | 0.128    | 137.68 | 1.18x | 1127.110      | 19.261          | 133.2          | 7.6             | 0.00              | 0        | 0.000         |
| @rgrove/parse-xml     | parse-xml/tree       | 200     | 0.166       | 0.175    | 0.185    | 99.38  | 1.64x | 1097.950      | 23.157          | 210.5          | 46.2            | 926.83            | 11       | 6.219         |
| fast-xml-parser       | fast-xml-parser/tree | 200     | 0.184       | 0.247    | 0.305    | 90.05  | 1.81x | 1325.685      | 39.677          | 242.4          | 48.4            | 2810.68           | 32       | 16.798        |

##### node 26.13.0

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 200     | 0.095       | 0.107    | 0.118    | 174.02 | 1.00x | 1026.408      | 15.322          | 201.7          | 61.0            | 1180.19           | 36       | 5.054         |
| libxml2-wasm          | libxml2-wasm/tree    | 200     | 0.138       | 0.145    | 0.149    | 119.92 | 1.45x | 1075.404      | 10.773          | 163.4          | 44.3            | 15.78             | 0        | 0.000         |
| @rgrove/parse-xml     | parse-xml/tree       | 200     | 0.176       | 0.211    | 0.241    | 93.82  | 1.85x | 1055.731      | 14.953          | 200.9          | 61.2            | 1278.11           | 39       | 6.328         |
| @aidenzepp/effect-xml | effect-xml/tree      | 200     | 0.180       | 0.193    | 0.500    | 91.65  | 1.90x | 1150.062      | 24.927          | 226.6          | 84.9            | 3119.25           | 97       | 21.723        |
| fast-xml-parser       | fast-xml-parser/tree | 200     | 0.285       | 0.336    | 0.484    | 58.10  | 3.00x | 1099.721      | 18.694          | 202.3          | 66.1            | 2391.06           | 76       | 10.519        |

#### tree: bank-256k

##### bun 1.4.2

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/tree      | 200     | 1.543       | 2.777    | 3.164    | 170.02 | 1.00x | 1690.144      | 88.121          | 353.2          | 170.8           | 3761.11           | 52       | 68.469        |
| txml                  | txml/tree            | 200     | 1.625       | 1.827    | 4.079    | 161.49 | 1.05x | 1371.102      | 25.215          | 222.1          | 71.6            | 897.56            | 13       | 12.401        |
| libxml2-wasm          | libxml2-wasm/tree    | 200     | 1.896       | 1.976    | 2.064    | 138.40 | 1.23x | 1397.733      | 9.632           | 120.3          | 44.1            | 0.00              | 0        | 0.000         |
| @rgrove/parse-xml     | parse-xml/tree       | 200     | 2.648       | 3.170    | 3.576    | 99.09  | 1.72x | 1605.539      | 26.988          | 256.7          | 90.5            | 897.39            | 15       | 15.007        |
| fast-xml-parser       | fast-xml-parser/tree | 200     | 4.124       | 6.180    | 6.617    | 63.63  | 2.67x | 2240.331      | 62.175          | 302.5          | 124.6           | 2279.10           | 46       | 46.900        |

##### node 26.13.0

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 200     | 1.508       | 1.815    | 2.049    | 174.03 | 1.00x | 1346.671      | 16.413          | 201.3          | 60.2            | 1171.14           | 49       | 17.071        |
| libxml2-wasm          | libxml2-wasm/tree    | 200     | 2.071       | 2.201    | 2.342    | 126.73 | 1.37x | 1400.816      | 3.979           | 164.7          | 37.0            | 1.54              | 0        | 0.000         |
| @aidenzepp/effect-xml | effect-xml/tree      | 200     | 2.595       | 3.232    | 3.459    | 101.09 | 1.72x | 1806.470      | 25.118          | 212.4          | 71.0            | 3034.19           | 152      | 77.975        |
| @rgrove/parse-xml     | parse-xml/tree       | 200     | 2.606       | 3.136    | 3.236    | 100.69 | 1.73x | 1613.220      | 13.812          | 202.6          | 65.6            | 1302.64           | 66       | 33.599        |
| fast-xml-parser       | fast-xml-parser/tree | 200     | 4.532       | 5.118    | 5.231    | 57.89  | 3.01x | 2061.219      | 29.724          | 206.1          | 66.2            | 2332.44           | 139      | 54.106        |

#### tree: bank-4m

##### bun 1.4.2

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 108     | 26.852      | 33.253   | 34.685   | 156.21 | 1.00x | 4439.955      | 83.907          | 500.0          | 258.7           | 895.33            | 26       | 91.643        |
| libxml2-wasm          | libxml2-wasm/tree    | 103     | 28.935      | 30.311   | 31.010   | 144.96 | 1.08x | 4031.149      | 15.813          | 165.8          | 52.0            | 0.00              | 0        | 0.000         |
| @aidenzepp/effect-xml | effect-xml/tree      | 94      | 30.761      | 39.569   | 41.688   | 136.36 | 1.15x | 5956.195      | 194.317         | 866.0          | 465.5           | 3293.00           | 58       | 433.810       |
| @rgrove/parse-xml     | parse-xml/tree       | 70      | 42.868      | 46.361   | 46.766   | 97.85  | 1.60x | 4511.147      | 70.980          | 620.7          | 289.7           | 897.52            | 22       | 101.864       |
| fast-xml-parser       | fast-xml-parser/tree | 48      | 65.788      | 70.855   | 72.852   | 63.76  | 2.45x | 5006.131      | 143.072         | 554.9          | 263.1           | 2050.00           | 62       | 207.315       |

##### node 26.13.0

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 107     | 27.923      | 32.052   | 33.018   | 150.21 | 1.00x | 5374.598      | 69.999          | 490.4          | 318.9           | 1033.73           | 148      | 311.009       |
| libxml2-wasm          | libxml2-wasm/tree    | 83      | 34.573      | 53.702   | 64.138   | 121.32 | 1.24x | 3914.270      | 12.502          | 199.2          | 54.5            | 0.15              | 0        | 0.000         |
| @rgrove/parse-xml     | parse-xml/tree       | 64      | 47.058      | 50.905   | 55.191   | 89.13  | 1.69x | 6199.047      | 96.492          | 637.4          | 458.8           | 1168.19           | 234      | 530.078       |
| @aidenzepp/effect-xml | effect-xml/tree      | 60      | 48.741      | 59.951   | 69.887   | 86.06  | 1.75x | 5760.292      | 104.097         | 581.1          | 387.4           | 2585.30           | 285      | 445.665       |
| fast-xml-parser       | fast-xml-parser/tree | 40      | 75.358      | 78.749   | 80.072   | 55.66  | 2.70x | 4849.826      | 79.363          | 471.5          | 313.9           | 2211.61           | 281      | 235.953       |

#### tree: bank-64m

##### bun 1.4.2

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 30      | 435.106     | 482.963  | 491.067  | 154.24 | 1.00x | 17253.105     | 393.835         | 4222.3         | 2261.3          | 848.84            | 11       | 362.163       |
| libxml2-wasm          | libxml2-wasm/tree    | 30      | 474.126     | 478.651  | 483.472  | 141.54 | 1.09x | 16503.915     | 52.766          | 841.7          | 739.3           | 0.00              | 0        | 0.000         |
| @aidenzepp/effect-xml | effect-xml/tree      | 30      | 610.112     | 769.615  | 786.752  | 109.99 | 1.40x | 33202.723     | 1002.689        | 6486.3         | 2878.0          | 2368.13           | 28       | 2765.798      |
| @rgrove/parse-xml     | parse-xml/tree       | 30      | 714.138     | 739.108  | 748.616  | 93.97  | 1.64x | 28674.394     | 539.851         | 4863.0         | 2430.6          | 830.41            | 17       | 773.105       |
| fast-xml-parser       | fast-xml-parser/tree | 30      | 1000.882    | 1085.640 | 1102.292 | 67.05  | 2.30x | 42257.553     | 682.739         | 3269.5         | 1732.6          | 2019.88           | 97       | 1730.177      |

##### node 26.13.0

| Library               | Case                 | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/tree            | 30      | 449.142     | 488.752  | 534.823  | 149.42 | 1.00x | 22010.188     | 429.513         | 2700.1         | 2294.5          | 1000.96           | 499      | 1592.829      |
| libxml2-wasm          | libxml2-wasm/tree    | 30      | 525.171     | 535.827  | 544.870  | 127.79 | 1.17x | 18418.611     | 59.188          | 762.4          | 114.8           | 0.02              | 0        | 0.000         |
| @rgrove/parse-xml     | parse-xml/tree       | 30      | 794.369     | 840.948  | 846.802  | 84.48  | 1.77x | 45457.653     | 705.374         | 2901.6         | 2319.7          | 1092.79           | 1399     | 4365.006      |
| @aidenzepp/effect-xml | effect-xml/tree      | 30      | 930.873     | 1037.015 | 1053.543 | 72.09  | 2.07x | 50076.376     | 1116.222        | 2865.2         | 2538.1          | 2236.63           | 1866     | 4701.754      |
| fast-xml-parser       | fast-xml-parser/tree | 30      | 1239.930    | 1311.145 | 1313.529 | 54.12  | 2.76x | 52022.260     | 1124.542        | 2718.6         | 2155.4          | 2125.21           | 2842     | 4099.472      |

### Class: typed-decode

Beyond a typed value, effect-xml rejects malformed input and decodes through its own codec, `fast-xml-parser/typed-decode` decodes the parser's untyped output with an Effect Schema and does not reject malformed input, and `@computis/effect-xml` parses with its own tokenizer and needs struct fields in document order.

#### typed-decode: corpus-items

##### bun 1.4.2

| Library               | Case                    | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s  | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------------- | ------- | ----------- | -------- | -------- | ----- | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/typed-decode | 200     | 0.262       | 0.303    | 0.413    | 25.11 | 1.00x | 1622.381      | 43.697          | 237.5          | 50.0            | 2711.54           | 30       | 21.141        |

##### node 26.13.0

| Library               | Case                    | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s  | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------------- | ------- | ----------- | -------- | -------- | ----- | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/typed-decode | 200     | 0.342       | 0.414    | 0.793    | 19.26 | 1.00x | 1296.600      | 27.378          | 231.5          | 87.8            | 2532.51           | 81       | 17.600        |

#### typed-decode: bank-16k

##### bun 1.4.2

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/typed-decode | 200     | 0.073       | 0.086    | 0.095    | 226.69 | 1.00x | 1224.310      | 39.671          | 220.7          | 48.6            | 2820.62           | 31       | 15.677        |
| fast-xml-parser       | fast-xml-parser/typed-decode     | 200     | 0.278       | 0.299    | 0.436    | 59.43  | 3.81x | 1178.567      | 37.045          | 211.1          | 48.4            | 2855.87           | 33       | 16.381        |
| @aidenzepp/effect-xml | effect-xml/typed-decode          | 200     | 0.351       | 0.449    | 1.017    | 47.10  | 4.81x | 1401.436      | 60.959          | 231.8          | 57.8            | 4115.20           | 47       | 29.887        |

##### node 26.13.0

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/typed-decode | 200     | 0.082       | 0.088    | 0.091    | 202.42 | 1.00x | 1065.442      | 19.441          | 204.8          | 62.0            | 2082.18           | 63       | 7.571         |
| fast-xml-parser       | fast-xml-parser/typed-decode     | 200     | 0.411       | 0.502    | 0.642    | 40.21  | 5.03x | 1154.131      | 18.785          | 203.5          | 66.4            | 2501.83           | 81       | 13.041        |
| @aidenzepp/effect-xml | effect-xml/typed-decode          | 200     | 0.454       | 0.588    | 0.637    | 36.45  | 5.55x | 1222.886      | 18.949          | 214.6          | 73.6            | 3725.93           | 122      | 18.435        |

#### typed-decode: bank-256k

##### bun 1.4.2

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/typed-decode | 200     | 1.196       | 1.679    | 2.072    | 219.36 | 1.00x | 1457.766      | 45.777          | 256.3          | 90.2            | 2650.89           | 36       | 25.547        |
| fast-xml-parser       | fast-xml-parser/typed-decode     | 200     | 5.973       | 7.598    | 8.100    | 43.93  | 4.99x | 2586.143      | 82.812          | 322.7          | 138.5           | 2410.59           | 58       | 51.629        |
| @aidenzepp/effect-xml | effect-xml/typed-decode          | 200     | 6.959       | 8.374    | 9.148    | 37.70  | 5.82x | 2862.198      | 114.141         | 383.5          | 189.3           | 3357.34           | 83       | 104.947       |

##### node 26.13.0

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/typed-decode | 200     | 1.272       | 2.573    | 2.849    | 206.33 | 1.00x | 1698.692      | 32.610          | 335.8          | 187.4           | 1900.66           | 87       | 103.504       |
| fast-xml-parser       | fast-xml-parser/typed-decode     | 200     | 7.296       | 8.213    | 8.508    | 35.96  | 5.74x | 2653.495      | 30.592          | 204.5          | 66.0            | 2232.86           | 171      | 60.274        |
| @aidenzepp/effect-xml | effect-xml/typed-decode          | 200     | 8.401       | 9.521    | 12.150   | 31.23  | 6.61x | 3323.584      | 65.017          | 348.0          | 195.2           | 3202.73           | 273      | 169.393       |

#### typed-decode: bank-4m

##### bun 1.4.2

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/typed-decode | 143     | 21.142      | 24.050   | 26.325   | 198.39 | 1.00x | 5068.142      | 128.649         | 460.4          | 229.4           | 2428.22           | 82       | 226.331       |
| fast-xml-parser       | fast-xml-parser/typed-decode     | 32      | 96.140      | 107.255  | 109.323  | 43.63  | 4.55x | 5009.696      | 118.200         | 560.3          | 274.5           | 2092.17           | 58       | 197.145       |
| @aidenzepp/effect-xml | effect-xml/typed-decode          | 30      | 121.547     | 130.620  | 132.127  | 34.51  | 5.75x | 6027.326      | 166.688         | 694.9          | 352.4           | 3065.69           | 82       | 312.548       |

##### node 26.13.0

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/typed-decode | 127     | 23.679      | 26.244   | 28.812   | 177.14 | 1.00x | 5943.874      | 68.408          | 412.1          | 248.0           | 1804.60           | 271      | 493.679       |
| fast-xml-parser       | fast-xml-parser/typed-decode     | 30      | 110.549     | 117.190  | 120.367  | 37.94  | 4.67x | 5505.098      | 74.714          | 450.7          | 300.4           | 2262.23           | 329      | 325.160       |
| @aidenzepp/effect-xml | effect-xml/typed-decode          | 30      | 124.966     | 136.530  | 139.430  | 33.56  | 5.28x | 6265.003      | 98.930          | 542.2          | 359.3           | 3391.37           | 503      | 411.864       |

#### typed-decode: bank-64m

##### bun 1.4.2

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/typed-decode | 30      | 346.878     | 388.375  | 402.738  | 193.47 | 1.00x | 16227.362     | 339.622         | 1789.4         | 908.9           | 2200.87           | 55       | 856.455       |
| fast-xml-parser       | fast-xml-parser/typed-decode     | 30      | 1526.857    | 1631.877 | 1660.503 | 43.95  | 4.40x | 67530.952     | 824.500         | 3234.8         | 1582.6          | 2004.62           | 173      | 3036.697      |
| @aidenzepp/effect-xml | effect-xml/typed-decode          | 24      | 2170.459    | 2230.633 | 2237.197 | 30.92  | 6.26x | 82822.732     | 1513.924        | 6805.5         | 2709.7          | 2572.15           | 121      | 4902.868      |

##### node 26.13.0

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/typed-decode | 30      | 394.639     | 440.494  | 448.000  | 170.05 | 1.00x | 20734.118     | 313.865         | 1707.9         | 1343.3          | 1675.11           | 818      | 1977.536      |
| fast-xml-parser       | fast-xml-parser/typed-decode     | 28      | 1835.002    | 1917.717 | 1944.867 | 36.57  | 4.65x | 76810.540     | 1367.742        | 2444.0         | 1823.1          | 2157.09           | 4234     | 6578.047      |
| @aidenzepp/effect-xml | effect-xml/typed-decode          | 23      | 2176.189    | 2272.679 | 2297.214 | 30.84  | 5.51x | 77910.467     | 1579.020        | 2849.8         | 2357.3          | 3143.74           | 5679     | 7143.944      |

### Class: encode-tree

Each entry writes its own library's tree: effect-xml writes a namespace-resolved tree, `fast-xml-parser` a `preserveOrder` tree, `libxml2-wasm` its DOM with `format: false`, and `txml` its `TNode` tree.

#### encode-tree: corpus-all

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 0.018       | 0.021    | 0.024    | 1867.49 | 1.00x  | 1005.492      | 66.714          | 198.6          | 56.6            | 5710.79           | 62       | 26.952        |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 0.059       | 0.066    | 0.082    | 561.03  | 3.33x  | 1031.030      | 27.306          | 213.4          | 56.4            | 674.93            | 8        | 6.837         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 200     | 0.234       | 0.263    | 0.280    | 141.53  | 13.19x | 1089.078      | 28.426          | 199.6          | 47.0            | 1918.31           | 22       | 11.156        |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 200     | 0.360       | 0.468    | 1.232    | 92.08   | 20.28x | 1357.134      | 51.372          | 227.5          | 56.7            | 3852.27           | 44       | 28.254        |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 0.032       | 0.034    | 0.043    | 1042.65 | 1.00x  | 1003.012      | 29.475          | 203.2          | 61.5            | 4727.00           | 142      | 21.519        |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 0.071       | 0.078    | 0.134    | 467.70  | 2.23x  | 1044.239      | 17.024          | 203.0          | 65.9            | 688.92            | 21       | 3.686         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 200     | 0.304       | 0.323    | 0.485    | 108.99  | 9.57x  | 1083.417      | 13.475          | 207.0          | 71.8            | 1804.79           | 57       | 9.865         |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 200     | 0.445       | 0.556    | 1.013    | 74.44   | 14.01x | 1351.737      | 42.779          | 336.1          | 193.1           | 3200.60           | 107      | 54.082        |

#### encode-tree: corpus-items

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 0.004       | 0.005    | 0.005    | 1836.50 | 1.00x  | 927.135       | 140.555         | 190.3          | 46.7            | 5590.41           | 61       | 24.374        |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 0.012       | 0.015    | 0.017    | 544.69  | 3.37x  | 1001.796      | 52.279          | 219.7          | 58.7            | 771.80            | 9        | 8.226         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 200     | 0.042       | 0.051    | 0.064    | 158.28  | 11.60x | 1051.671      | 38.462          | 195.8          | 45.3            | 2257.22           | 25       | 11.713        |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 200     | 0.071       | 0.092    | 0.192    | 93.03   | 19.74x | 1260.005      | 60.697          | 216.6          | 48.3            | 3952.29           | 43       | 26.151        |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 0.006       | 0.008    | 0.022    | 1053.12 | 1.00x  | 947.235       | 74.682          | 203.8          | 65.6            | 4987.99           | 149      | 14.881        |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 0.014       | 0.015    | 0.018    | 463.26  | 2.27x  | 996.813       | 38.506          | 200.9          | 65.7            | 853.28            | 25       | 3.965         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 200     | 0.065       | 0.069    | 0.074    | 101.33  | 10.39x | 1032.931      | 13.911          | 202.8          | 66.6            | 1768.23           | 53       | 7.800         |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 200     | 0.093       | 0.100    | 0.140    | 70.90   | 14.85x | 1258.233      | 41.985          | 335.2          | 191.8           | 3181.10           | 99       | 47.980        |

#### encode-tree: bank-16k

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 0.010       | 0.011    | 0.014    | 1646.98 | 1.00x  | 978.719       | 83.431          | 194.3          | 52.8            | 6338.99           | 69       | 26.968        |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 0.028       | 0.029    | 0.033    | 590.68  | 2.79x  | 1020.904      | 34.282          | 193.3          | 46.1            | 586.19            | 7        | 5.179         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 200     | 0.110       | 0.113    | 0.130    | 150.01  | 10.98x | 1052.259      | 28.524          | 199.9          | 46.0            | 2224.74           | 25       | 12.086        |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 200     | 0.152       | 0.185    | 0.218    | 109.08  | 15.10x | 1231.530      | 67.311          | 223.7          | 57.4            | 4890.10           | 54       | 34.080        |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 0.017       | 0.025    | 0.030    | 965.78 | 1.00x  | 988.036       | 35.305          | 202.1          | 61.1            | 5659.06           | 170      | 18.855        |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 0.039       | 0.045    | 0.060    | 424.08 | 2.28x  | 1018.670      | 24.876          | 201.5          | 64.8            | 487.74            | 14       | 2.218         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 200     | 0.182       | 0.192    | 0.258    | 91.02  | 10.61x | 1043.840      | 17.649          | 202.6          | 63.0            | 1825.32           | 56       | 7.533         |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 200     | 0.185       | 0.224    | 0.795    | 89.58  | 10.78x | 1260.004      | 39.969          | 339.7          | 193.7           | 3758.00           | 119      | 62.969        |

#### encode-tree: bank-256k

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 0.145       | 0.152    | 0.165    | 1804.92 | 1.00x  | 1076.302      | 64.406          | 320.5          | 173.1           | 6457.54           | 71       | 67.110        |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 0.451       | 0.499    | 0.540    | 581.26  | 3.11x  | 1091.374      | 20.161          | 210.4          | 48.3            | 592.29            | 7        | 3.539         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 200     | 1.799       | 2.310    | 2.846    | 145.83  | 12.38x | 1400.968      | 48.756          | 235.9          | 75.1            | 2212.67           | 33       | 22.302        |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 200     | 2.496       | 4.527    | 5.118    | 105.14  | 17.17x | 1862.156      | 247.888         | 362.5          | 170.9           | 4179.96           | 67       | 132.408       |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 0.237       | 0.321    | 0.953    | 1105.00 | 1.00x  | 1073.989      | 16.545          | 206.9          | 67.3            | 5887.95           | 195      | 115.975       |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 0.538       | 0.572    | 0.688    | 487.34  | 2.27x  | 1105.508      | 17.192          | 203.2          | 66.2            | 497.82            | 16       | 3.284         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 200     | 3.023       | 3.416    | 3.508    | 86.79   | 12.73x | 1624.800      | 18.754          | 226.0          | 89.7            | 1788.31           | 83       | 23.274        |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 200     | 3.373       | 4.145    | 4.617    | 77.79   | 14.20x | 1974.734      | 44.545          | 349.1          | 204.5           | 3424.90           | 181      | 138.592       |

#### encode-tree: bank-4m

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 200     | 2.476       | 5.587    | 6.872    | 1694.11 | 1.00x  | 2415.026      | 137.190         | 1623.5         | 771.9           | 3709.67           | 14       | 644.973       |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 6.454       | 6.945    | 7.138    | 649.93  | 2.61x  | 2287.367      | 33.030          | 402.9          | 144.8           | 620.06            | 9        | 6.887         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 69      | 42.524      | 48.650   | 54.160   | 98.64   | 17.17x | 4265.737      | 497.421         | 612.1          | 294.8           | 1434.04           | 39       | 221.710       |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 50      | 63.490      | 70.257   | 71.224   | 66.07   | 25.64x | 6608.337      | 3203.489        | 840.7          | 392.0           | 2527.43           | 52       | 1434.744      |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 200     | 8.725       | 9.396    | 9.684    | 480.75 | 1.00x | 2756.902      | 25.425          | 261.3          | 90.2            | 499.18            | 52       | 20.782        |
| txml                  | txml/encode-tree            | 197     | 13.407      | 23.129   | 26.294   | 312.85 | 1.54x | 7034.299      | 169.870         | 762.4          | 592.2           | 1630.71           | 349      | 2636.184      |
| fast-xml-parser       | fast-xml-parser/encode-tree | 55      | 54.746      | 57.782   | 62.106   | 76.62  | 6.27x | 4086.037      | 59.423          | 473.5          | 320.0           | 1565.61           | 206      | 434.753       |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 50      | 60.461      | 68.127   | 72.967   | 69.38  | 6.93x | 4983.086      | 86.666          | 565.5          | 386.0           | 3072.83           | 397      | 965.174       |

#### encode-tree: bank-64m

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s    | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------- | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| txml                  | txml/encode-tree            | 52      | 48.151      | 72.686   | 239.257  | 1393.73 | 1.00x  | 5923.589      | 501.658         | 7602.0         | 3296.1          | 2198.27           | 4        | 1531.200      |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 30      | 110.953     | 114.570  | 115.170  | 604.84  | 2.30x  | 4222.421      | 136.712         | 2538.7         | 2007.4          | 349.77            | 1        | 7.631         |
| fast-xml-parser       | fast-xml-parser/encode-tree | 30      | 759.062     | 814.326  | 883.370  | 88.41   | 15.76x | 30206.828     | 5159.400        | 3980.3         | 2276.4          | 1216.97           | 30       | 2438.636      |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 30      | 1054.134    | 1294.081 | 1423.146 | 63.66   | 21.89x | 60830.189     | 28261.907       | 7447.5         | 3537.3          | 2109.85           | 40       | 13945.634     |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| libxml2-wasm          | libxml2-wasm/encode-tree    | 30      | 149.997     | 157.318  | 162.415  | 447.40 | 1.00x | 5522.607      | 152.356         | 2570.2         | 1893.2          | 463.86            | 155      | 412.865       |
| txml                  | txml/encode-tree            | 30      | 334.678     | 521.697  | 526.910  | 200.52 | 2.23x | 17298.523     | 314.051         | 3064.4         | 2477.8          | 1089.83           | 734      | 9614.168      |
| fast-xml-parser       | fast-xml-parser/encode-tree | 30      | 934.886     | 986.824  | 1017.725 | 71.78  | 6.23x | 33259.305     | 546.226         | 2614.7         | 2376.7          | 1456.12           | 1552     | 5450.259      |
| @aidenzepp/effect-xml | effect-xml/encode-tree      | 30      | 1026.091    | 1147.237 | 1186.483 | 65.40  | 6.84x | 46728.834     | 797.616         | 2976.3         | 2407.4          | 2848.24           | 3177     | 10520.038     |

### Class: encode-typed

Both entries encode a typed value through an Effect Schema, and `@computis/effect-xml` also writes the XML declaration.

#### encode-typed: corpus-items

##### bun 1.4.2

| Library               | Case                    | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s  | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------------- | ------- | ----------- | -------- | -------- | ----- | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/encode-typed | 200     | 0.311       | 0.339    | 0.409    | 21.13 | 1.00x | 1599.722      | 50.349          | 238.2          | 50.5            | 2715.95           | 30       | 21.641        |

##### node 26.13.0

| Library               | Case                    | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s  | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | ----------------------- | ------- | ----------- | -------- | -------- | ----- | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @aidenzepp/effect-xml | effect-xml/encode-typed | 200     | 0.401       | 0.516    | 0.852    | 16.42 | 1.00x | 1302.166      | 32.795          | 262.5          | 120.6           | 2496.78           | 82       | 26.690        |

#### encode-typed: bank-16k

##### bun 1.4.2

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/encode-typed | 200     | 0.036       | 0.042    | 0.046    | 464.79 | 1.00x  | 1099.011      | 50.855          | 216.3          | 48.1            | 3604.61           | 39       | 19.517        |
| @aidenzepp/effect-xml | effect-xml/encode-typed          | 200     | 0.480       | 0.591    | 1.330    | 34.48  | 13.48x | 1378.445      | 57.790          | 235.3          | 64.1            | 3888.18           | 45       | 31.060        |

##### node 26.13.0

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/encode-typed | 200     | 0.049       | 0.053    | 0.060    | 334.40 | 1.00x  | 1059.617      | 28.354          | 214.4          | 75.4            | 3590.54           | 108      | 13.697        |
| @aidenzepp/effect-xml | effect-xml/encode-typed          | 200     | 0.562       | 0.846    | 0.944    | 29.42  | 11.37x | 1279.083      | 33.648          | 264.0          | 122.3           | 3397.24           | 115      | 42.894        |

#### encode-typed: bank-256k

##### bun 1.4.2

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/encode-typed | 200     | 0.532       | 0.597    | 1.064    | 493.45 | 1.00x  | 1191.862      | 41.255          | 248.4          | 88.5            | 3411.91           | 41       | 23.579        |
| @aidenzepp/effect-xml | effect-xml/encode-typed          | 200     | 8.730       | 11.222   | 11.527   | 30.06  | 16.42x | 3306.755      | 254.118         | 399.3          | 192.2           | 3427.00           | 95       | 169.226       |

##### node 26.13.0

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/encode-typed | 200     | 0.747       | 1.033    | 1.273    | 351.24 | 1.00x  | 1203.856      | 27.947          | 271.4          | 127.5           | 3908.17           | 106      | 26.658        |
| @aidenzepp/effect-xml | effect-xml/encode-typed          | 200     | 9.837       | 10.718   | 11.329   | 26.67  | 13.17x | 3486.193      | 57.489          | 361.0          | 202.2           | 3289.27           | 316      | 205.433       |

#### encode-typed: bank-4m

##### bun 1.4.2

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/encode-typed | 200     | 9.151       | 10.629   | 11.152   | 458.37 | 1.00x  | 3141.667      | 88.696          | 593.6          | 278.4           | 3103.34           | 64       | 113.902       |
| @aidenzepp/effect-xml | effect-xml/encode-typed          | 30      | 152.068     | 168.109  | 171.000  | 27.58  | 16.62x | 7157.642      | 1162.009        | 1003.3         | 536.5           | 3030.16           | 72       | 653.427       |

##### node 26.13.0

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/encode-typed | 200     | 14.117      | 15.536   | 20.336   | 297.12 | 1.00x  | 4432.605      | 160.992         | 479.7          | 293.4           | 3462.23           | 281      | 345.392       |
| @aidenzepp/effect-xml | effect-xml/encode-typed          | 30      | 166.265     | 177.198  | 178.864  | 25.23  | 11.78x | 7427.803      | 117.201         | 643.7          | 455.8           | 3096.37           | 599      | 671.373       |

#### encode-typed: bank-64m

##### bun 1.4.2

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/encode-typed | 30      | 191.977     | 199.883  | 200.981  | 349.57 | 1.00x  | 7531.591      | 398.022         | 3469.7         | 1518.8          | 2404.27           | 20       | 285.236       |
| @aidenzepp/effect-xml | effect-xml/encode-typed          | 19      | 2665.069    | 2722.324 | 2722.324 | 25.18  | 13.88x | 81859.025     | 14078.444       | 8551.8         | 4046.8          | 2669.26           | 79       | 9056.702      |

##### node 26.13.0

| Library               | Case                             | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio  | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) |
| --------------------- | -------------------------------- | ------- | ----------- | -------- | -------- | ------ | ------ | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- |
| @computis/effect-xml  | computis-effect-xml/encode-typed | 30      | 263.576     | 335.817  | 342.918  | 254.61 | 1.00x  | 12041.412     | 716.368         | 2540.1         | 2105.5          | 3090.55           | 698      | 1742.830      |
| @aidenzepp/effect-xml | effect-xml/encode-typed          | 17      | 2824.566    | 2947.515 | 2947.515 | 23.76  | 10.72x | 77529.490     | 1403.900        | 3088.8         | 2073.6          | 2898.96           | 5633     | 12338.051     |

### Class: stream

Both libraries extract `qti-assessment-item-ref` records by a namespace-qualified path from 64 KiB chunks and report time to first record, and effect-xml also decodes each record through its Schema and runs with `positions` off and on.

#### stream: bank-16k

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) | First record median (ms) | First record p95 (ms) | First record p99 (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- | ------------------------ | --------------------- | --------------------- |
| saxes                 | saxes/stream                | 200     | 0.128       | 0.141    | 0.161    | 128.96 | 1.00x | 1106.939      | 34.018          | 204.9          | 44.4            | 1921.56           | 22       | 10.243        | 0.005                    | 0.009                 | 0.017                 |
| @aidenzepp/effect-xml | effect-xml/stream           | 200     | 0.436       | 0.550    | 1.242    | 37.98  | 3.40x | 1584.205      | 54.665          | 232.8          | 51.9            | 3358.14           | 39       | 26.805        | 0.131                    | 0.187                 | 0.239                 |
| @aidenzepp/effect-xml | effect-xml/stream/positions | 200     | 0.607       | 0.696    | 1.667    | 27.24  | 4.73x | 1669.076      | 48.085          | 236.8          | 52.0            | 3014.25           | 36       | 30.419        | 0.091                    | 0.120                 | 0.165                 |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) | First record median (ms) | First record p95 (ms) | First record p99 (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- | ------------------------ | --------------------- | --------------------- |
| saxes                 | saxes/stream                | 200     | 0.116       | 0.134    | 0.160    | 142.78 | 1.00x | 1059.470      | 17.892          | 201.5          | 65.9            | 2774.35           | 85       | 9.874         | 0.004                    | 0.006                 | 0.017                 |
| @aidenzepp/effect-xml | effect-xml/stream           | 200     | 0.494       | 0.691    | 0.745    | 33.47  | 4.27x | 1264.356      | 24.099          | 227.8          | 86.6            | 3391.90           | 112      | 22.147        | 0.183                    | 0.203                 | 0.380                 |
| @aidenzepp/effect-xml | effect-xml/stream/positions | 200     | 0.697       | 1.125    | 1.207    | 23.74  | 6.01x | 1381.851      | 34.724          | 259.6          | 114.4           | 3182.09           | 112      | 46.847        | 0.095                    | 0.109                 | 0.124                 |

#### stream: bank-256k

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) | First record median (ms) | First record p95 (ms) | First record p99 (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- | ------------------------ | --------------------- | --------------------- |
| saxes                 | saxes/stream                | 200     | 2.079       | 2.319    | 4.050    | 126.22 | 1.00x | 1472.859      | 33.450          | 204.9          | 44.9            | 1869.82           | 29       | 12.193        | 0.007                    | 0.018                 | 0.026                 |
| @aidenzepp/effect-xml | effect-xml/stream           | 200     | 7.072       | 8.407    | 8.955    | 37.10  | 3.40x | 2860.115      | 92.022          | 305.5          | 121.6           | 3246.64           | 86       | 69.538        | 0.571                    | 0.711                 | 1.540                 |
| @aidenzepp/effect-xml | effect-xml/stream/positions | 200     | 9.862       | 11.045   | 11.388   | 26.61  | 4.74x | 3419.435      | 96.437          | 245.9          | 71.2            | 3100.39           | 101      | 84.666        | 0.214                    | 0.275                 | 0.314                 |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) | First record median (ms) | First record p95 (ms) | First record p99 (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- | ------------------------ | --------------------- | --------------------- |
| saxes                 | saxes/stream                | 200     | 1.970       | 2.146    | 2.251    | 133.19 | 1.00x | 1417.622      | 18.385          | 203.2          | 66.0            | 2588.67           | 108      | 12.208        | 0.007                    | 0.017                 | 0.026                 |
| @aidenzepp/effect-xml | effect-xml/stream           | 200     | 7.632       | 8.110    | 8.287    | 34.38  | 3.87x | 2707.307      | 32.227          | 215.1          | 72.0            | 3586.41           | 275      | 56.127        | 0.770                    | 1.026                 | 1.151                 |
| @aidenzepp/effect-xml | effect-xml/stream/positions | 200     | 11.291      | 12.007   | 12.481   | 23.24  | 5.73x | 3627.837      | 66.334          | 311.7          | 154.9           | 3269.02           | 328      | 130.440       | 0.223                    | 0.273                 | 0.532                 |

#### stream: bank-4m

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) | First record median (ms) | First record p95 (ms) | First record p99 (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- | ------------------------ | --------------------- | --------------------- |
| saxes                 | saxes/stream                | 88      | 34.198      | 36.692   | 38.615   | 122.65 | 1.00x | 3999.666      | 77.565          | 230.2          | 52.9            | 1927.34           | 71       | 31.611        | 0.041                    | 0.070                 | 0.094                 |
| @aidenzepp/effect-xml | effect-xml/stream           | 30      | 100.204     | 104.375  | 104.421  | 41.86  | 2.93x | 4353.159      | 132.732         | 426.7          | 204.2           | 3623.83           | 136      | 112.490       | 0.701                    | 0.908                 | 1.855                 |
| @aidenzepp/effect-xml | effect-xml/stream/positions | 30      | 146.759     | 153.103  | 153.163  | 28.58  | 4.29x | 5683.861      | 136.046         | 290.5          | 90.3            | 3355.53           | 169      | 140.159       | 0.369                    | 0.449                 | 0.454                 |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) | First record median (ms) | First record p95 (ms) | First record p99 (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- | ------------------------ | --------------------- | --------------------- |
| saxes                 | saxes/stream                | 92      | 32.654      | 33.510   | 34.910   | 128.45 | 1.00x | 4027.882      | 36.872          | 211.5          | 70.4            | 2497.78           | 300      | 36.293        | 0.036                    | 0.050                 | 0.201                 |
| @aidenzepp/effect-xml | effect-xml/stream           | 30      | 115.381     | 118.379  | 119.990  | 36.35  | 3.53x | 4695.961      | 53.340          | 224.1          | 74.0            | 3748.44           | 515      | 87.669        | 0.842                    | 0.996                 | 1.087                 |
| @aidenzepp/effect-xml | effect-xml/stream/positions | 30      | 175.432     | 181.361  | 183.946  | 23.91  | 5.37x | 6885.498      | 96.814          | 379.3          | 207.1           | 3324.51           | 648      | 257.673       | 0.269                    | 0.357                 | 0.854                 |

#### stream: bank-64m

##### bun 1.4.2

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) | First record median (ms) | First record p95 (ms) | First record p99 (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- | ------------------------ | --------------------- | --------------------- |
| saxes                 | saxes/stream                | 30      | 550.723     | 571.617  | 572.447  | 121.86 | 1.00x | 19177.607     | 224.394         | 463.1          | 108.7           | 1872.34           | 160      | 66.504        | 0.060                    | 0.104                 | 0.108                 |
| @aidenzepp/effect-xml | effect-xml/stream           | 30      | 1524.350    | 1590.079 | 1594.455 | 44.02  | 2.77x | 54607.799     | 1041.212        | 750.4          | 340.3           | 3735.07           | 1148     | 964.935       | 0.731                    | 1.834                 | 2.019                 |
| @aidenzepp/effect-xml | effect-xml/stream/positions | 21      | 2398.315    | 2502.796 | 2507.137 | 27.98  | 4.35x | 62203.283     | 1039.071        | 653.9          | 240.8           | 3236.58           | 1176     | 1671.901      | 0.410                    | 0.480                 | 0.527                 |

##### node 26.13.0

| Library               | Case                        | Samples | Median (ms) | p95 (ms) | p99 (ms) | MB/s   | Ratio | CPU user (ms) | CPU system (ms) | Peak RSS (MiB) | Heap used (MiB) | Allocation (MB/s) | GC count | GC pause (ms) | First record median (ms) | First record p95 (ms) | First record p99 (ms) |
| --------------------- | --------------------------- | ------- | ----------- | -------- | -------- | ------ | ----- | ------------- | --------------- | -------------- | --------------- | ----------------- | -------- | ------------- | ------------------------ | --------------------- | --------------------- |
| saxes                 | saxes/stream                | 30      | 527.447     | 535.478  | 539.535  | 127.23 | 1.00x | 18430.663     | 118.333         | 372.7          | 193.8           | 2434.60           | 1344     | 185.029       | 0.038                    | 0.069                 | 0.083                 |
| @aidenzepp/effect-xml | effect-xml/stream           | 28      | 1856.848    | 1877.507 | 1887.694 | 36.14  | 3.52x | 61894.990     | 645.653         | 532.8          | 203.8           | 3690.87           | 6835     | 1236.349      | 0.846                    | 0.989                 | 1.035                 |
| @aidenzepp/effect-xml | effect-xml/stream/positions | 17      | 2783.372    | 2836.596 | 2836.596 | 24.11  | 5.28x | 65182.781     | 704.439         | 896.5          | 495.6           | 3334.37           | 6176     | 3352.342      | 0.281                    | 0.347                 | 0.347                 |

## Scaling curve

Each cell is the median and the throughput of one case on one bank size, from the same report: `effect-xml/*` rows from the final files, every other row from the phase-2 files.

### bun 1.4.2

| Case                             | bank-16k               | bank-256k              | bank-4m                | bank-64m                |
| -------------------------------- | ---------------------- | ---------------------- | ---------------------- | ----------------------- |
| computis-effect-xml/encode-typed | 0.036 ms, 464.79 MB/s  | 0.532 ms, 493.45 MB/s  | 9.151 ms, 458.37 MB/s  | 191.977 ms, 349.57 MB/s |
| computis-effect-xml/typed-decode | 0.073 ms, 226.69 MB/s  | 1.196 ms, 219.36 MB/s  | 21.142 ms, 198.39 MB/s | 346.878 ms, 193.47 MB/s |
| effect-xml/encode-tree           | 0.152 ms, 109.08 MB/s  | 2.496 ms, 105.14 MB/s  | 63.490 ms, 66.07 MB/s  | 1054.134 ms, 63.66 MB/s |
| effect-xml/encode-typed          | 0.480 ms, 34.48 MB/s   | 8.730 ms, 30.06 MB/s   | 152.068 ms, 27.58 MB/s | 2665.069 ms, 25.18 MB/s |
| effect-xml/events                | 0.059 ms, 282.31 MB/s  | 0.831 ms, 315.61 MB/s  | 14.306 ms, 293.19 MB/s | 234.968 ms, 285.61 MB/s |
| effect-xml/stream                | 0.436 ms, 37.98 MB/s   | 7.072 ms, 37.10 MB/s   | 100.204 ms, 41.86 MB/s | 1524.350 ms, 44.02 MB/s |
| effect-xml/stream/positions      | 0.607 ms, 27.24 MB/s   | 9.862 ms, 26.61 MB/s   | 146.759 ms, 28.58 MB/s | 2398.315 ms, 27.98 MB/s |
| effect-xml/tree                  | 0.109 ms, 151.39 MB/s  | 1.543 ms, 170.02 MB/s  | 30.761 ms, 136.36 MB/s | 610.112 ms, 109.99 MB/s |
| effect-xml/typed-decode          | 0.351 ms, 47.10 MB/s   | 6.959 ms, 37.70 MB/s   | 121.547 ms, 34.51 MB/s | 2170.459 ms, 30.92 MB/s |
| fast-xml-parser/encode-tree      | 0.110 ms, 150.01 MB/s  | 1.799 ms, 145.83 MB/s  | 42.524 ms, 98.64 MB/s  | 759.062 ms, 88.41 MB/s  |
| fast-xml-parser/tree             | 0.184 ms, 90.05 MB/s   | 4.124 ms, 63.63 MB/s   | 65.788 ms, 63.76 MB/s  | 1000.882 ms, 67.05 MB/s |
| fast-xml-parser/typed-decode     | 0.278 ms, 59.43 MB/s   | 5.973 ms, 43.93 MB/s   | 96.140 ms, 43.63 MB/s  | 1526.857 ms, 43.95 MB/s |
| libxml2-wasm/encode-tree         | 0.028 ms, 590.68 MB/s  | 0.451 ms, 581.26 MB/s  | 6.454 ms, 649.93 MB/s  | 110.953 ms, 604.84 MB/s |
| libxml2-wasm/tree                | 0.120 ms, 137.68 MB/s  | 1.896 ms, 138.40 MB/s  | 28.935 ms, 144.96 MB/s | 474.126 ms, 141.54 MB/s |
| parse-xml/tree                   | 0.166 ms, 99.38 MB/s   | 2.648 ms, 99.09 MB/s   | 42.868 ms, 97.85 MB/s  | 714.138 ms, 93.97 MB/s  |
| sax/events                       | 0.243 ms, 68.18 MB/s   | 4.031 ms, 65.09 MB/s   | 63.390 ms, 66.17 MB/s  | 993.623 ms, 67.54 MB/s  |
| saxes/events                     | 0.107 ms, 154.99 MB/s  | 1.700 ms, 154.38 MB/s  | 26.263 ms, 159.71 MB/s | 424.485 ms, 158.10 MB/s |
| saxes/stream                     | 0.128 ms, 128.96 MB/s  | 2.079 ms, 126.22 MB/s  | 34.198 ms, 122.65 MB/s | 550.723 ms, 121.86 MB/s |
| txml/encode-tree                 | 0.010 ms, 1646.98 MB/s | 0.145 ms, 1804.92 MB/s | 2.476 ms, 1694.11 MB/s | 48.151 ms, 1393.73 MB/s |
| txml/tree                        | 0.101 ms, 163.01 MB/s  | 1.625 ms, 161.49 MB/s  | 26.852 ms, 156.21 MB/s | 435.106 ms, 154.24 MB/s |

### node 26.13.0

| Case                             | bank-16k              | bank-256k              | bank-4m                | bank-64m                |
| -------------------------------- | --------------------- | ---------------------- | ---------------------- | ----------------------- |
| computis-effect-xml/encode-typed | 0.049 ms, 334.40 MB/s | 0.747 ms, 351.24 MB/s  | 14.117 ms, 297.12 MB/s | 263.576 ms, 254.61 MB/s |
| computis-effect-xml/typed-decode | 0.082 ms, 202.42 MB/s | 1.272 ms, 206.33 MB/s  | 23.679 ms, 177.14 MB/s | 394.639 ms, 170.05 MB/s |
| effect-xml/encode-tree           | 0.185 ms, 89.58 MB/s  | 3.373 ms, 77.79 MB/s   | 60.461 ms, 69.38 MB/s  | 1026.091 ms, 65.40 MB/s |
| effect-xml/encode-typed          | 0.562 ms, 29.42 MB/s  | 9.837 ms, 26.67 MB/s   | 166.265 ms, 25.23 MB/s | 2824.566 ms, 23.76 MB/s |
| effect-xml/events                | 0.081 ms, 204.61 MB/s | 1.252 ms, 209.63 MB/s  | 22.483 ms, 186.56 MB/s | 381.804 ms, 175.77 MB/s |
| effect-xml/stream                | 0.494 ms, 33.47 MB/s  | 7.632 ms, 34.38 MB/s   | 115.381 ms, 36.35 MB/s | 1856.848 ms, 36.14 MB/s |
| effect-xml/stream/positions      | 0.697 ms, 23.74 MB/s  | 11.291 ms, 23.24 MB/s  | 175.432 ms, 23.91 MB/s | 2783.372 ms, 24.11 MB/s |
| effect-xml/tree                  | 0.180 ms, 91.65 MB/s  | 2.595 ms, 101.09 MB/s  | 48.741 ms, 86.06 MB/s  | 930.873 ms, 72.09 MB/s  |
| effect-xml/typed-decode          | 0.454 ms, 36.45 MB/s  | 8.401 ms, 31.23 MB/s   | 124.966 ms, 33.56 MB/s | 2176.189 ms, 30.84 MB/s |
| fast-xml-parser/encode-tree      | 0.182 ms, 91.02 MB/s  | 3.023 ms, 86.79 MB/s   | 54.746 ms, 76.62 MB/s  | 934.886 ms, 71.78 MB/s  |
| fast-xml-parser/tree             | 0.285 ms, 58.10 MB/s  | 4.532 ms, 57.89 MB/s   | 75.358 ms, 55.66 MB/s  | 1239.930 ms, 54.12 MB/s |
| fast-xml-parser/typed-decode     | 0.411 ms, 40.21 MB/s  | 7.296 ms, 35.96 MB/s   | 110.549 ms, 37.94 MB/s | 1835.002 ms, 36.57 MB/s |
| libxml2-wasm/encode-tree         | 0.039 ms, 424.08 MB/s | 0.538 ms, 487.34 MB/s  | 8.725 ms, 480.75 MB/s  | 149.997 ms, 447.40 MB/s |
| libxml2-wasm/tree                | 0.138 ms, 119.92 MB/s | 2.071 ms, 126.73 MB/s  | 34.573 ms, 121.32 MB/s | 525.171 ms, 127.79 MB/s |
| parse-xml/tree                   | 0.176 ms, 93.82 MB/s  | 2.606 ms, 100.69 MB/s  | 47.058 ms, 89.13 MB/s  | 794.369 ms, 84.48 MB/s  |
| sax/events                       | 0.257 ms, 64.23 MB/s  | 4.166 ms, 62.98 MB/s   | 70.807 ms, 59.24 MB/s  | 1176.762 ms, 57.03 MB/s |
| saxes/events                     | 0.078 ms, 212.38 MB/s | 1.367 ms, 191.88 MB/s  | 22.431 ms, 186.99 MB/s | 372.673 ms, 180.07 MB/s |
| saxes/stream                     | 0.116 ms, 142.78 MB/s | 1.970 ms, 133.19 MB/s  | 32.654 ms, 128.45 MB/s | 527.447 ms, 127.23 MB/s |
| txml/encode-tree                 | 0.017 ms, 965.78 MB/s | 0.237 ms, 1105.00 MB/s | 13.407 ms, 312.85 MB/s | 334.678 ms, 200.52 MB/s |
| txml/tree                        | 0.095 ms, 174.02 MB/s | 1.508 ms, 174.03 MB/s  | 27.923 ms, 150.21 MB/s | 449.142 ms, 149.42 MB/s |

## Per-layer profile

### Layer ladder

Each differential rung adds one layer to the rung above it: `transport` (chunks only), `tokenizer`, `resolver`, `collector`, `schema` (record decode), and `positions`. A rung's delta is its median minus the median of the rung above. The `tree-document`, `typed-document`, and `error-document` rungs time a whole-document decode, and the `chunk-4k` and `chunk-1m` rungs re-chunk the tokenizer rung. The tables come from the `ladders` field of each phase-2 layers file:

```sh
bun -e 'for (const f of process.argv.slice(1)) { const j = JSON.parse(require("fs").readFileSync(f, "utf8")); for (const l of j.ladders) for (const r of l.rungs) console.log([f, l.input, r.id, r.wallMs.median, r.deltaMedianMs ?? "-"].join(" | ")) }' docs/rd/performance/phase-2-layers-bun.json docs/rd/performance/phase-2-layers-node.json
```

#### Bun 1.4.2

| Rung             | bank-256k median (ms) | bank-256k delta (ms) | bank-4m median (ms) | bank-4m delta (ms) | bank-64m median (ms) | bank-64m delta (ms) |
| ---------------- | --------------------- | -------------------- | ------------------- | ------------------ | -------------------- | ------------------- |
| `transport`      | 0.001                 | 0.001                | 0.001               | 0.001              | 0.001                | 0.001               |
| `tokenizer`      | 0.827                 | 0.827                | 15.836              | 15.835             | 250.667              | 250.667             |
| `resolver`       | 1.524                 | 0.697                | 29.664              | 13.828             | 460.414              | 209.747             |
| `collector`      | 1.803                 | 0.279                | 34.346              | 4.681              | 535.509              | 75.095              |
| `schema`         | 5.822                 | 4.019                | 89.065              | 54.72              | 1308.174             | 772.665             |
| `positions`      | 10.693                | 4.871                | 157.925             | 68.86              | 2223.219             | 915.045             |
| `tree-document`  | 1.93                  | -                    | 32.293              | -                  | 638.691              | -                   |
| `typed-document` | 6.587                 | -                    | 104.78              | -                  | 1961.01              | -                   |
| `error-document` | 6.869                 | -                    | 108.682             | -                  | 1946.096             | -                   |
| `chunk-4k`       | 0.996                 | -                    | 16.849              | -                  | 287.679              | -                   |
| `chunk-1m`       | 0.923                 | -                    | 15.235              | -                  | 261.555              | -                   |

#### Node 26.13.0

| Rung             | bank-256k median (ms) | bank-256k delta (ms) | bank-4m median (ms) | bank-4m delta (ms) | bank-64m median (ms) | bank-64m delta (ms) |
| ---------------- | --------------------- | -------------------- | ------------------- | ------------------ | -------------------- | ------------------- |
| `transport`      | 0.001                 | 0.001                | 0.001               | 0.001              | 0.001                | 0.001               |
| `tokenizer`      | 1.336                 | 1.335                | 21.426              | 21.425             | 444.389              | 444.389             |
| `resolver`       | 2.433                 | 1.097                | 47.346              | 25.92              | 777.962              | 333.572             |
| `collector`      | 2.656                 | 0.223                | 51.433              | 4.087              | 881.586              | 103.624             |
| `schema`         | 6.765                 | 4.109                | 103.72              | 52.287             | 1671.389             | 789.803             |
| `positions`      | 9.926                 | 3.161                | 154.71              | 50.99              | 2523.968             | 852.579             |
| `tree-document`  | 2.661                 | -                    | 50.076              | -                  | 921.581              | -                   |
| `typed-document` | 7.271                 | -                    | 118.685             | -                  | 2073.021             | -                   |
| `error-document` | 7.862                 | -                    | 130.116             | -                  | 2302.903             | -                   |
| `chunk-4k`       | 1.325                 | -                    | 22.076              | -                  | 463.695              | -                   |
| `chunk-1m`       | 1.285                 | -                    | 22.871              | -                  | 454.389              | -                   |

No phase-2 delta is negative. The Bun `bank-256k` ladder now agrees with the matrix: its `schema` rung takes 5.822 ms, and the matrix measures `effect-xml/stream` on `bank-256k` at 5.552 ms. The phase-1 Bun `bank-256k` ladder was noise-dominated. At every size on both runtimes, `schema` is the largest delta with `positions` off, and the `positions` delta is 0.77 to 1.26 times the `schema` delta.

### CPU buckets

Each cell is the bucket's share of the profile's total self time. The tables come from the `profiles` field of each phase-2 CPU file:

```sh
bun -e 'for (const f of process.argv.slice(1)) { const j = JSON.parse(require("fs").readFileSync(f, "utf8")); for (const p of j.profiles) console.log([f, p.caseId, p.input, p.totalMs.toFixed(0), ...Object.entries(p.buckets).map(([k, v]) => k + " " + ((100 * v) / p.totalMs).toFixed(1) + "%")].join(" | ")) }' docs/rd/performance/phase-2-cpu-bun.json docs/rd/performance/phase-2-cpu-64m-bun.json docs/rd/performance/phase-2-cpu-node.json docs/rd/performance/phase-2-cpu-64m-node.json
```

The `tokenizer` bucket holds `effect/dist/encoding/Xml` and `src/tokenizer.ts`. The `resolver-collector` bucket holds `src/resolve.ts`, which contains both stages. The `positions` bucket holds `src/positions.ts` and `src/record-path.ts`. The `schema` bucket holds the other top-level `src/` modules and `effect/dist/Schema`. The `effect-runtime` bucket holds the rest of `effect/dist/`. Since `24044c8`, a profiled case process skips heap statistics, so the `harness` bucket no longer carries Bun's heap walk.

#### Bun 1.4.2

| Case                          | Input      | Total (ms) | tokenizer | resolver-collector | schema | positions | effect-runtime | harness | other |
| ----------------------------- | ---------- | ---------- | --------- | ------------------ | ------ | --------- | -------------- | ------- | ----- |
| `effect-xml/events`           | `bank-4m`  | 4101       | 92.7%     | 0.0%               | 0.2%   | 0.0%      | 4.2%           | 0.1%    | 2.8%  |
| `effect-xml/tree`             | `bank-4m`  | 4216       | 46.3%     | 41.2%              | 5.9%   | 0.0%      | 0.7%           | 0.2%    | 5.7%  |
| `effect-xml/typed-decode`     | `bank-4m`  | 4360       | 15.4%     | 16.1%              | 39.1%  | 0.0%      | 18.3%          | 0.1%    | 11.0% |
| `effect-xml/stream`           | `bank-4m`  | 4281       | 17.3%     | 10.7%              | 34.8%  | 0.0%      | 23.5%          | 0.1%    | 13.6% |
| `effect-xml/stream/positions` | `bank-4m`  | 5738       | 21.5%     | 9.8%               | 22.9%  | 7.2%      | 29.3%          | 0.0%    | 9.4%  |
| `effect-xml/events`           | `bank-64m` | 9073       | 94.5%     | 0.0%               | 0.0%   | 0.0%      | 2.7%           | 0.4%    | 2.4%  |
| `effect-xml/tree`             | `bank-64m` | 23542      | 49.3%     | 40.5%              | 6.8%   | 0.0%      | 0.4%           | 0.2%    | 2.8%  |
| `effect-xml/typed-decode`     | `bank-64m` | 64562      | 14.8%     | 16.6%              | 40.0%  | 0.0%      | 18.6%          | 0.1%    | 10.0% |
| `effect-xml/stream`           | `bank-64m` | 46454      | 20.8%     | 11.6%              | 32.7%  | 0.0%      | 24.1%          | 0.1%    | 10.7% |
| `effect-xml/stream/positions` | `bank-64m` | 63280      | 24.2%     | 10.0%              | 22.8%  | 6.7%      | 28.1%          | 0.1%    | 8.1%  |

#### Node 26.13.0

| Case                          | Input      | Total (ms) | tokenizer | resolver-collector | schema | positions | effect-runtime | harness | other |
| ----------------------------- | ---------- | ---------- | --------- | ------------------ | ------ | --------- | -------------- | ------- | ----- |
| `effect-xml/events`           | `bank-4m`  | 4280       | 75.5%     | 0.0%               | 0.2%   | 0.0%      | 1.1%           | 1.0%    | 22.2% |
| `effect-xml/tree`             | `bank-4m`  | 4396       | 36.0%     | 35.5%              | 0.9%   | 0.0%      | 5.2%           | 0.2%    | 22.3% |
| `effect-xml/typed-decode`     | `bank-4m`  | 4761       | 16.5%     | 18.0%              | 24.6%  | 0.0%      | 22.1%          | 0.1%    | 18.8% |
| `effect-xml/stream`           | `bank-4m`  | 4679       | 16.6%     | 17.5%              | 21.1%  | 0.0%      | 30.5%          | 0.1%    | 14.1% |
| `effect-xml/stream/positions` | `bank-4m`  | 6304       | 19.7%     | 15.3%              | 15.5%  | 5.4%      | 31.0%          | 0.1%    | 13.1% |
| `effect-xml/events`           | `bank-64m` | 14449      | 76.9%     | 0.0%               | 0.1%   | 0.0%      | 0.4%           | 1.2%    | 21.5% |
| `effect-xml/tree`             | `bank-64m` | 34606      | 36.5%     | 37.1%              | 0.7%   | 0.0%      | 3.8%           | 0.1%    | 21.7% |
| `effect-xml/typed-decode`     | `bank-64m` | 63774      | 18.0%     | 16.8%              | 24.4%  | 0.0%      | 22.0%          | 0.0%    | 18.8% |
| `effect-xml/stream`           | `bank-64m` | 61589      | 17.2%     | 17.2%              | 22.2%  | 0.0%      | 31.9%          | 0.0%    | 11.4% |
| `effect-xml/stream/positions` | `bank-64m` | 63961      | 19.5%     | 14.8%              | 15.5%  | 5.2%      | 30.3%          | 0.1%    | 14.6% |

## Tokenizer decision rule

The goal quotes the owner's rule (`85f587a7` item 1):

> If profiling shows the upstream effect/encoding/Xml tokenizer is the bottleneck, build an in-house tokenizer with its own internal approach behind the same interface. No further owner ruling is needed.

The goal's operational default (`docs/goals/performance/GOAL.md`, open question 1):

> Evaluate after the phase-2 library-layer optimizations land. The rule fires when, on both runtimes, the upstream tokenizer is the largest single layer of the differential profile for the `stream` and `typed-decode` classes at the two largest synthetic sizes, and effect-xml is slower than the fastest competitor in the `events` class at those sizes.

The two largest synthetic sizes are `bank-4m` and `bank-64m`. The ladder's differential rungs time the record path that `stream` and `typed-decode` share; the CPU buckets read each class on its own. Phase 2 reads these values:

| Value                                         | Bun, `bank-4m`              | Bun, `bank-64m`                | Node, `bank-4m`                      | Node, `bank-64m`                     |
| --------------------------------------------- | --------------------------- | ------------------------------ | ------------------------------------ | ------------------------------------ |
| Largest differential layer, `positions` off   | `schema` (54.72 ms)         | `schema` (772.665 ms)          | `schema` (52.287 ms)                 | `schema` (789.803 ms)                |
| Tokenizer delta over the `schema` rung median | 17.8% (15.835 of 89.065 ms) | 19.2% (250.667 of 1308.174 ms) | 20.7% (21.425 of 103.72 ms)          | 26.6% (444.389 of 1671.389 ms)       |
| `tokenizer` bucket, `effect-xml/typed-decode` | 15.4%                       | 14.8%                          | 16.5%                                | 18.0%                                |
| Largest bucket, `effect-xml/typed-decode`     | `schema` (39.1%)            | `schema` (40.0%)               | `schema` (24.6%)                     | `schema` (24.4%)                     |
| `tokenizer` bucket, `effect-xml/stream`       | 17.3%                       | 20.8%                          | 16.6%                                | 17.2%                                |
| Largest bucket, `effect-xml/stream`           | `schema` (34.8%)            | `schema` (32.7%)               | `effect-runtime` (30.5%)             | `effect-runtime` (31.9%)             |
| effect-xml `events` rank                      | 1 of 3                      | 1 of 3                         | 2 of 3 (1.01x behind `saxes/events`) | 2 of 3 (1.03x behind `saxes/events`) |

Verdict: the rule does not fire. The tokenizer condition decides it: on both runtimes and at both sizes, `schema` is the largest differential layer, and the tokenizer's delta is 17.8% to 26.6% of the `schema` rung median. The `events` condition holds on Node only.

## Upstream

`npm view effect version` printed `4.1.2` on 2026-11-06 at 10:52 UTC, the version this repository pins. Effect-TS/effect#10406, "Add opt-in source positions to XML start-element events", is merged (2026-11-05 at 21:30 UTC). `effect@4.1.2` was published on 2026-11-02, so no release carries #10406 yet. Evaluating the release is a phase-3 decision.

## Caveats

- **Mixed sources.** The class and scaling tables put final `effect-xml/*` rows (`45e6aed`) beside competitor rows from the phase-2 run (`75d46bd`, `76aa910`), measured three to four and a half hours earlier at a similar load. A ratio between the two sources compares two runs of one machine, not one run.
- **The wire revert in the tables.** Against the phase-2 files, the final files measure these cases slower on every input: `effect-xml/typed-decode` by 6.7% to 21.1% on Bun and 9.9% to 22.8% on Node, `effect-xml/stream` by 18.6% to 34.2% and 12.0% to 18.5%, and `effect-xml/encode-typed` by 7.1% to 13.6% and 4.3% to 16.0%. For `effect-xml/typed-decode` and `effect-xml/stream`, the final recheck puts the shipped code within 1.1% of the parent of `7c88ef5`, so the change is the revert of `perf2-opt-wire-check`; the recheck did not cover `effect-xml/encode-typed`. `effect-xml/events` and `effect-xml/tree` stay within 7.7% of the phase-2 files on both runtimes.
- **Profiles describe the phase-2 commits.** The [per-layer profile](#per-layer-profile) and the [tokenizer decision rule](#tokenizer-decision-rule) come from `75d46bd` and `76aa910`, which still hold the wire fast path. They were not re-measured on the shipped code.
- **Load.** The phase-2 matrix runs ran at a 1-minute load average of 3.00 to 5.32 with no other work of this project, and the final matrix runs at 3.62 to 5.30, so the shared-machine caveat of phase 1 no longer applies to them. The witness reports give no separate load for the ladder and CPU steps. The phase-1 numbers in [Phase 2 fixes](#phase-2-fixes) still carry it. The single-run A/B files and the rechecks ran beside other workspaces (see [Phase 2 optimizations](#phase-2-optimizations)).
- **Bun GC metrics.** On Bun, `gcCount`, `gcPauseMs`, and `allocationBytesPerSecond` carry the source label `node:v8 GCProfiler on Bun (fidelity unverified)`. Whether Bun's `GCProfiler` reports real collector events is unverified (GOAL open question 3). Node's label is `node:v8 GCProfiler`.
- **Node GC share.** A Node GC share from a profile varies within one process (see [Probes without a library change](#probes-without-a-library-change)). Check its 5 s bins before you read it as a library cost.
- **Peak RSS on Bun.** `peakRssBytes` reads `process.resourceUsage().maxRSS` and converts it from kilobytes on both runtimes. That Bun reports kilobytes is assumed, not verified.
- **Heap used.** `heapUsedBytes` is the peak absolute `process.memoryUsage().heapUsed` reading over the case, not a delta. It includes the input text and the harness.
- **WebAssembly heap.** `libxml2-wasm` documents live outside the JavaScript heap, so its heap column understates its memory. Compare peak RSS.
- **Sample counts on `bank-64m`.** The 60,000 ms sampling cap stops some slow cases before the 30-sample minimum. In the tables, on Bun: `effect-xml/typed-decode` 24, `effect-xml/encode-typed` 19, and `effect-xml/stream/positions` 21. On Node: `effect-xml/typed-decode` 23, `effect-xml/encode-typed` 17, `effect-xml/stream` 28, `effect-xml/stream/positions` 17, and `fast-xml-parser/typed-decode` 28. Every other row has at least 30 samples. Treat p95 and p99 on these rows as unstable.
- **Failures.** Neither the phase-2 nor the final matrix files have a failure, and every final result's observed count equals its expected count. No result carries other notes.
- **Bun `effect-xml/stream/positions` on `bank-4m`.** The phase-2 file measured 290.608 ms (14.43 MB/s), below the same case's throughput on `bank-256k` and `bank-64m` and slower than every Bun A/B file at or after `b1210ce` on the same input (150.114 ms to 167.765 ms). The final file measures 146.759 ms (28.58 MB/s), in line with `bank-256k` (26.61 MB/s) and `bank-64m` (27.98 MB/s). No slice examined the phase-2 row, so its cause is not determined.
- **Positions ratio.** The README states the measured cost of stream positions since `4c14d1d` (`perf2-8`). From the final files, the ratio of `effect-xml/stream/positions` to `effect-xml/stream` medians is 1.39x, 1.39x, 1.46x, and 1.57x on Bun and 1.41x, 1.48x, 1.52x, and 1.50x on Node, from `bank-16k` to `bank-64m`. The phase-2 files gave 1.86x, 2.84x, 3.50x, and 1.78x on Bun and 1.44x, 1.41x, 1.51x, and 1.59x on Node.
- **The Bun `bank-64m` drop.** Phase 1 measured `effect-xml/typed-decode` at 6.74 MB/s and `effect-xml/stream` at 11.16 MB/s on Bun `bank-64m`, from 4 and 9 samples. The `perf2-4` inventory (`docs/goals/performance/phase-2.inventory.md`) found that the drop does not reproduce and found no library cause. The phase-2 files measure 37.45 MB/s and 52.22 MB/s on the same rows, and the final files 30.92 MB/s and 44.02 MB/s. The cause of the phase-1 figures is not determined.
- **Case filter.** `--filter effect-xml` also selects `computis-effect-xml/*` cases, because the filter is a substring match.
