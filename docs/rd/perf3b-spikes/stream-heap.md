# Spike perf3-sp-stream-heap: why the positioned stream peaked higher on Node bank-4m

Unit `perf3-sp-stream-heap`. The HEAD A/B ([Streaming guardrail](../performance.md#streaming-guardrail)) measured the positioned record stream on Node at `bank-4m`, JIT `off`, at a peak heap of 1.111 (1.018–1.225) and a peak RSS of 1.065 (1.014–1.099) of BASE `bd60a0e`, over the guardrail's 5% line, while it allocated 0.455 of BASE's bytes. This spike asked what HEAD holds alive longer. The prototypes and raw rounds live in `work/spikes/perf3-stream-heap/` (gitignored); this file is the durable record.

## Result

- **Nothing is held alive longer.** The live heap while the positioned stream runs, read after a forced full collection every 200 records, is 1.000 (1.000–1.003) of BASE's: 35.5 MiB on both trees. After the run, a full collection leaves 36.3 MiB at HEAD and 36.2 MiB at BASE.
- **The peak is garbage, not retention.** The bench's peak heap is the largest `heapUsed` read at the end of each timed run, so it counts garbage that has not been collected yet. On the positioned stream that garbage is dominated by one source: each record's position tree.
- **The cause is the position-tree `WeakMap`.** `collect` keeps each record's position tree in `recordTrees`, a module-level `WeakMap` in `src/resolve.ts`. The entry keeps the tree alive through the young-generation collection after its record dies, so V8 pretenures the tree nodes' allocation site (`branch` in the collector). From then on every positioned record's tree is allocated in the old generation and stays there, as garbage, until a mark-compact: 9 to 11 MiB per run at `bank-4m`. The plain stream builds no trees, which is why only the positioned stream crossed the line. BASE has the same mechanism; HEAD did not add it.
- **Fixed.** `48d4bcf` and `9beee49` delete a record's entry once the record has decoded, on positioned runs. Against BASE, at `9beee49`, the positioned stream's Node peak heap at `bank-4m`, JIT `off`, is now 0.409 (0.363–0.442) and its peak RSS 0.607 (0.583–0.649), over 12 interleaved rounds. Against unfixed HEAD its CPU is 0.861 (0.805–0.873), and the plain stream's CPU 0.999 (0.987–1.013).

Decision: fixed. The guardrail cell is closed for Node `bank-4m`; [Streaming guardrail](../performance.md#streaming-guardrail) records the new numbers.

## What the peak measures

`bench/harness/metrics.ts` raises `peakHeapUsedBytes` with `heapProbe`, one `process.memoryUsage().heapUsed` read at the end of every timed run. `heapUsed` includes objects no collection has reclaimed yet. Over the runs of one process, it is a sawtooth: old-generation garbage builds up run by run until V8 starts a mark-compact, then drops to the live set. The peak is the top of that sawtooth, so it moves with how much garbage reaches the old generation per run and with where V8 sets its next mark-compact limit, not only with what the program keeps.

The same tree swings widely between processes. Thirty positioned runs per process, three processes per tree, one after another, on Node 26.13.0:

| Tree | Peak `heapUsed` at run end, three processes | Full-GC heap after the runs |
| ---- | ------------------------------------------- | --------------------------- |
| BASE | 115.0, 100.0, 140.7 MiB                     | 32.6 MiB each               |
| HEAD | 114.0, 206.9, 118.6 MiB                     | 32.7, 37.4, 32.7 MiB        |

## Measurements

### Retention, HEAD against BASE

`probe.ts` loads `src/` from a detached worktree of each commit and streams the HEAD bench's `bank-4m` chunks through `decodeSchemaString(ItemRef, bankPath)({ positions: true })`, as the `effect-xml/stream/positions` case does, under `node --expose-gc`, JIT `off`. Each round runs every tree and variant once in a child process of its own, in alternating order, for 12 rounds. Values are medians of per-round values with the distribution-free 95% order-statistic interval (coverage 0.961), as in [Phase 3 under load (A/B)](../performance.md#phase-3-under-load-ab).

| Variant                                              | HEAD (MiB)          | BASE (MiB)          | HEAD / BASE         |
| ---------------------------------------------------- | ------------------- | ------------------- | ------------------- |
| live heap, forced full GC every 200 records, maximum | 35.5 (35.5–35.5)    | 35.5 (35.4–35.5)    | 1.000 (1.000–1.003) |
| full-GC heap after the run                           | 36.3 (36.3–36.3)    | 36.2 (36.2–36.2)    | 1.003 (1.003–1.003) |
| peak `heapUsed` at run end, 6 warm-up then 12 runs   | 195.4 (152.4–195.7) | 183.0 (140.7–185.5) | 1.054 (0.884–1.090) |
| the same with `--no-allocation-site-pretenuring`     | 62.6 (62.3–63.2)    | 54.4 (53.3–55.1)    | 1.150 (1.116–1.186) |

The rounds ran from 18:48 to 19:01 UTC on 2026-11-08, beside other seats' work and, in the last rounds, this spike's first A/B block, at a 1-minute load median of 208 (206–218). Heap figures do not track CPU time, but V8 sets collection limits partly from mutator speed, so load can move the peaks. The peak ratio here, 1.054, is lower than the A/B's 1.111 and its interval includes 1; the A/B's peak sampled 10 or more runs after a policy warm-up, this probe 12 after 6.

Turning off allocation-site pretenuring takes both peaks from 140–200 MiB down to 53–63 MiB, about two thirds less, without changing the live heap. The 1.150 left in that row is where the young generation happens to be at the end of a run: HEAD alternates between about 47 and 63 MiB from run to run as its scavenges fall on one side of the run's end or the other, while BASE climbs about 1 MiB a run. Neither is retention.

### Where the garbage comes from

Collection traces, `--trace-gc-nvp`, 20 positioned runs in one process per tree:

| Stream     | Tree | Scavenges | Mark-compacts | Bytes moved to the old generation |
| ---------- | ---- | --------- | ------------- | --------------------------------- |
| positioned | BASE | 364       | 8             | 189.8 MiB                         |
| positioned | HEAD | 174       | 7             | 187.8 MiB                         |
| plain      | BASE | 275       | 7             | 212.4 MiB                         |
| plain      | HEAD | 86        | 3             | 16.1 MiB                          |

HEAD's positioned stream runs half the scavenges of BASE's but sends the same 9.4 MiB per run to the old generation. HEAD's plain stream sends almost nothing. So whatever reaches the old generation on HEAD is positioned-only.

The sampling heap profiler names it. With `HeapProfiler.startSampling` set to drop samples a young-generation collection reclaimed and keep those a mark-compact reclaimed, the profile holds the allocations that never died young. Positioned stream, 4 runs after 3 warm-up runs:

| Tree and setting                           | Never died young, per run | Main site                                             |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------- |
| BASE                                       | 11.8 MiB                  | 11.0 MiB in the collector's `push` (inlined callees)  |
| HEAD                                       | 15.1 MiB                  | 10.8 MiB in the resolver's `start` (inlined callees)  |
| HEAD, inlining off                         | 17.2 MiB                  | 9.3 MiB in `branch`, 2.0 MiB in `parseClark` under it |
| HEAD, `--no-allocation-site-pretenuring`   | 2.6 MiB                   | 0.6 MiB in `start`                                    |
| HEAD without the `recordTrees.set` (probe) | 4.7 MiB                   | 0.7 MiB in `decodeStringWithPositions`                |
| `48d4bcf`                                  | 4.8 and 4.3 MiB           | none above 0.7 MiB                                    |

`branch` builds the position-tree node `{ children: [], local: parseClark(name).local, position }` for every element of a record. `--trace-pretenuring-statistics` shows V8 tenuring allocation sites whose objects it found alive at a scavenge, for example `(created, found, ratio) (126, 124, 0.984127) undecided => tenure`. Two control edits in throwaway copies of HEAD, building the per-tag `Site` and the scope `Frame` from classes instead of literals, left the 10 MiB in place. Removing the `recordTrees.set` call removed it, and the end-of-run peak of a 30-run process fell to 69.6 MiB.

So the chain is: the `WeakMap` entry keeps a dead record's tree through a scavenge, V8 sees the tree nodes survive and pretenures their site, and from then on every tree goes straight to the old generation and waits there for a mark-compact. BASE built the same trees into the same map, so BASE pays it too. Why HEAD's peak sits above BASE's on the bench is where V8 places its mark-compact limit for each tree's garbage rate, which this spike did not pin down; after the fix the question does not arise.

## Fix

`forgetRecordPositions(element)` in `src/resolve.ts` deletes a record's entry from `recordTrees`. On a positioned run, `records()` in `src/channel.ts` calls it once a record has decoded, inside the `Effect.map` that already counts emitted records, so it adds no effect to the pipeline. A record's tree is read only by `attachRecordPosition`, when that record's decode fails, which is before this point, so values, errors, and positions are unchanged. Document decode (`readRoot` in `src/codec.ts`) has one record and keeps its map entry as before. No public API changes; `forgetRecordPositions` is not exported from `src/index.ts`.

Two commits:

- `48d4bcf` (`perf(channel): drop each record's position tree once it has decoded`) adds the function, the call, and the test.
- `9beee49` (`perf(channel): forget position trees only on positioned runs`) skips the call on plain runs. Against unfixed HEAD, `48d4bcf` cost the plain stream 1.014 (1.002–1.031) of its CPU, a `WeakMap` lookup per record for a tree a plain run never builds. With the guard the plain stream measures 0.999 (0.987–1.013).

`src/resolve.test.ts` adds "drops a record's tree once it is forgotten", which failed before the function existed. The heap effect itself is not unit-testable; the re-measure below is its check. `bun run check`, `bun run build`, `bun run test` (1,200 passed, 2 skipped), and `bun x vp test test/differential test/bench` (246 passed) are green at both commits.

## Re-measure

`bench/ab.ts` from the `9beee49` tree, Node 26.13.0, JIT `off`, `bank-4m`, `ab` policy, 12 rounds, units `effect-xml/stream` and `effect-xml/stream/positions`, in two blocks: FIXED (`9beee49`) against HEAD (`0f34035`, whose `src/` is the HEAD A/B's shipped tree), 19:10 to 19:15 UTC, then FIXED against BASE (`bd60a0e`), 19:15 to 19:24 UTC. The driver repeated 5 and 3 outlier rounds. The 1-minute load median was 77 (31–208) and 116 (43–154). Below 1, FIXED uses less.

| Metric, positioned stream | FIXED / HEAD        | FIXED / BASE        |
| ------------------------- | ------------------- | ------------------- |
| Peak heap used            | 0.358 (0.341–0.376) | 0.409 (0.363–0.442) |
| Peak RSS                  | 0.580 (0.576–0.590) | 0.607 (0.583–0.649) |
| CPU per operation         | 0.861 (0.805–0.873) | 0.547 (0.532–0.552) |
| Wall median               | 0.964 (0.924–0.976) | 0.588 (0.510–0.657) |
| Allocation per operation  | 1.000 (1.000–1.000) | 0.456 (0.456–0.456) |
| GC count per operation    | 0.964 (0.960–0.967) | 0.453 (0.448–0.453) |
| Time to first record      | 0.983 (0.972–1.033) | 0.927 (0.813–1.033) |

| Metric, plain stream | FIXED / HEAD        | FIXED / BASE        |
| -------------------- | ------------------- | ------------------- |
| Peak heap used       | 1.000 (0.992–1.006) | 1.005 (0.979–1.042) |
| Peak RSS             | 1.003 (0.998–1.009) | 0.992 (0.980–1.013) |
| CPU per operation    | 0.999 (0.987–1.013) | 0.458 (0.443–0.472) |

The positioned stream's median peak heap is 74.1 MiB at FIXED against 206.7 MiB at HEAD and 176.5 MiB at BASE, level with the plain stream's 73.7–74.8 MiB. The positioned stream also gets cheaper: with no tree garbage in the old generation, V8 runs fewer and cheaper mark-compacts, and CPU falls to 0.861 of HEAD's at the same allocation. The plain stream builds no trees and is unchanged on every metric; its peak heap against BASE, 1.005 (0.979–1.042), is the HEAD A/B's 1.025 (1.008–1.033) within noise.

`48d4bcf` alone, in the same two blocks' shape (18:58 to 19:08 UTC, load medians 178 and 45): positioned peak heap 0.421 (0.362–0.449) of BASE's and 0.364 (0.349–0.405) of HEAD's, positioned CPU 0.823 (0.800–0.848) of HEAD's, and plain CPU 1.014 (1.002–1.031) of HEAD's, the cost `9beee49` removes.

## Decision

Fixed in `48d4bcf` and `9beee49`. The positioned stream's peak heap and RSS on Node at `bank-4m` are now well under BASE's and HEAD's, its CPU falls, and the plain stream's CPU and memory are unchanged. The plain stream's Node peak heap, 1.025 in the HEAD A/B, was below the guardrail's 5% line and still is.

Not measured here: Bun (its heap and RSS cells were below 1 in the HEAD A/B), `bank-16k`, and `bank-64m`. The fix runs on every positioned record channel run, so it should help them too, but this spike gives no number for them.

## Files

Gitignored, under `work/spikes/perf3-stream-heap/`: `probe/probe.ts` (retention and end-of-run probe), `probe/promoted.ts` (sampling heap profile of allocations that never died young), `probe/gcsum.mjs` (trace summary), `probe/rounds.sh` and `rounds.jsonl` (the 12 retention rounds), `gc-*.log` (traces), and the A/B results files `fixed2-head-node-jit-off-bank-4m.json` and `fixed2-base-node-jit-off-bank-4m.json` (`9beee49`) and `fixed-base-node-jit-off-bank-4m.json` and `fixed-head-node-jit-off-bank-4m.json` (`48d4bcf`). Their peak heap and RSS cells read `summary.peakHeapUsedBytes` and `summary.peakRssBytes`, as the HEAD A/B does.
