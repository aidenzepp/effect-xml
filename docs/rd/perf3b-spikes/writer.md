# Spike perf3b-sp-writer: why the encode writer costs more than computis's whole encode

Unit `perf3b-sp-writer`. This is an R&D spike. The prototype lives in `work/spikes/perf3b-sp-writer/` (gitignored); this file is the durable record. No file under `src/`, `bench/`, or `test/` changed.

## Result

The writer's cost is allocation, not name or namespace work. For each element, `attributesOf` builds three throwaway objects and two `Object.entries` arrays, and `writeNode` then spreads the attributes into a fourth object. A prototype that writes each attribute straight into the event's attribute record emits the same events and costs 0.22 to 0.24 of the current writer's CPU on `bank-4m`. It allocates 5.9 times less, and the shipped typed encode drops to 0.66 (Bun) and 0.75 (Node) of its current CPU. **Build it.**

| `bank-4m`, JIT off, CPU per op               | Bun                 | Node                |
| -------------------------------------------- | ------------------- | ------------------- |
| Writer alone, prototype / main               | 0.237 (0.216–0.298) | 0.224 (0.193–0.253) |
| Writer plus `Xml.encodeString`, proto / main | 0.388 (0.332–0.501) | 0.450 (0.433–0.488) |
| Shipped `fromString` encode, proto / main    | 0.662 (0.579–0.714) | 0.751 (0.683–0.797) |
| Typed encode `T / C`, main → prototype       | 3.99 → 2.61         | 3.31 → 2.48         |

Medians over rounds, with 95%-or-better distribution-free intervals. The `T / C` row comes from the end-to-end run below, where `C` was measured in the same rounds.

## Where the time goes

`bank-4m` writes 62,653 elements (125,306 events). The elements carry 104,421 attributes, 10,442 elements carry none, and there are no text events.

For every element, the current `writer.ts` does this:

1. `attributesOf` builds an `attributes` record from `plan.attributes`.
2. It runs `Object.entries(plain)` over every key of the plain object to find `data-*` keys. It does this even when the plan declares no `data`, so `isData` returns `false` for every key. That is one array plus one pair array per key, with 3 to 7 keys per bank element.
3. It respells the attributes through `Object.entries(attributes)` and a `Map.get` per key into a second record, `spelled`.
4. `writeNode` copies the record again with `{ ...head.declared, ...attributes }`.
5. `writeElements` allocates `[raw].filter(...)` for every singleton slot (`qti-branch-rule.match`, `qti-match.correct`, `qti-match.variable`), and every structural child goes through a `Map.get` on `parent.nodes`.
6. Each element also allocates a fresh `StartElement` and `EndElement`.

The name and `xmlns` work is cached per (plan, scope) already. It does not show in any profile.

Evidence:

- **Phase-3 CPU profiles** (`docs/rd/performance/phase-3-ab/profile-cpu-*-jit-off-bank-4m.json`, `effect-xml/encode-typed`). On Bun, the native `entries` called from the writer has 988 ms of self time. That is more than the writer's own 683 ms bucket, and `cloneObject` (the spread) adds 125 ms. On Node, `attributesOf` (681 ms) is the second-largest self-time function after `(garbage collector)` (5,115 ms of 12,266 ms). `writeNode` (411 ms) and `writeElements` (182 ms) follow.
- **This spike's Node profile** of the writer alone (`node --cpu-prof`, `bank-4m`). The garbage collector takes 47% of samples, `attributesOf` 17%, `writeNode` 6%, and `writeElements` 2%.
- **Allocation** (Node, `v8.GCProfiler`, per op). Main's writer allocates 58.8 MB per `bank-4m` op, about 940 bytes per element. GC costs 10.9 ms of its 26.3 ms CPU.

## What the prototype changes

`work/spikes/perf3b-sp-writer/writer-proto.ts` has the same `writerOf` and `toEventsFrom` signatures and the same refusal rules.

1. **Direct attribute writes.** When the node is built, it records two parallel arrays: the plain keys and the spelled names of the declared attributes, both from main's `spellingsOf`. `startOf` then creates one record, copies in the root's `xmlns` declarations (an empty loop below the root), and assigns each present string attribute under its spelled name. There is no intermediate record, no `Object.entries`, and no spread. The key order equals main's `{ ...declared, ...spelled }`.
2. **Main's attribute path for the rare cases.** A plan with `data`, a plan whose attributes do not spell as a set, or a spelled name of `__proto__` (which plain assignment would turn into a prototype write) uses main's code verbatim.
3. **Shared events.** An element that can carry no attribute reuses one `StartElement` per node, and every node reuses one `EndElement`. These are optional; see Ablation.
4. **Leaner child walk.** Child nodes are stored in an array aligned with the slots, so there is no `Map.get` per child. Singleton slots are written without the `[raw].filter` array. `for` loops replace the `every` closures. Mixed members carry their lazily built node.

Unchanged: `headOf`, `spellingsOf`, opaque elements (`writeResolved`), and lazy node construction for recursive plans.

## Correctness

The prototype's output was compared with main's writer on the same plain object:

| Input                                                                                                     | Events `isDeepStrictEqual` | `JSON.stringify` equal (key order) | Text through `Xml.encodeString` byte-identical | Second write through the cached writer equal |
| --------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `bank-16k`, `bank-4m`, with and without the declaration                                                   | yes                        | yes                                | yes                                            | yes                                          |
| QTI `bg007-true-false`, `bpig-hotspot`, `bg010-missing-word`, `extended-text-postcard` (`AssessmentItem`) | yes                        | yes                                | yes                                            | yes                                          |

- Both checks ran on Bun and Node, and once more with shared events off (`WRITER_SHARE=0`).
- The QTI items cover `text` content, `mixed` content with members and text runs, the MathML namespace (an `xmlns` redeclaration below the root), and `suspend` recursion.
- Main's `src/writer.test.ts` was run against the prototype by rewriting only its imports, and all 24 tests pass. That file covers refusals, unmappable attribute namespaces, `data-*`, open content, opaque slots, and colliding mixed wires.
- `test/fast-encode.test.ts` and the other suites that reach the writer through `src/` were not run against the prototype, because that needs an edit to `src/`.

## Timing

Method:

- **Machine:** Apple M4 Pro, 14 cores, shared with other seats. The 1-minute load average was 31 to 90 during the A/B and 20 to 46 during the end-to-end run, recorded per child.
- **Runtimes:** Bun 1.4.2 and Node 26.13.0, both with the Schema JIT off (shipped). `effect` as pinned. Code base: `main` at `ac2e552` to `7bbaba7`, which a parallel seat advanced during the runs. Those commits touched only `src/compile.ts`, `src/issue.ts` (already present uncommitted when the spike started), and docs. `src/writer.ts` was unchanged throughout. An uncommitted `src/builder.ts` edit appeared mid-run; the encode path does not import the builder.
- **Process per case.** Every (runtime, input, mode, implementation) runs in its own child process. Each child decodes the bank and encodes the plain object outside the timed loop. It then sizes a batch to about 40 ms, runs 3 warm-up batches and 10 timed batches, and reports the median per-op CPU (`process.cpuUsage`, user plus system), wall time, and on Node the GC pause and allocated bytes per op (`v8.GCProfiler`, as `bench/harness/metrics.ts` computes them).
- **Interleaving.** Main and prototype run back to back within every round, in reversed order every other round. The end-to-end run rotates main, prototype, and computis. The figure is the median of per-round paired ratios, with the distribution-free interval for the median (96.1% at 12 rounds, 97.9% at 10). Outlier rounds were kept, not repeated.
- **End-to-end swap.** The `encode` mode runs the shipped `Schema.encodeEffect(XmlSchema.fromString(ItemBank, { declaration: false }))`. For the prototype, a preload (`registerHooks` on Node, `Bun.plugin` on Bun) serves `src/writer.ts` as a re-export of the prototype. The child asserts the swap took effect.
- **Files:** `work/spikes/perf3b-sp-writer/ab.jsonl` (12 rounds), `ab-e2e.jsonl` (10 rounds), and `ablate.jsonl` (8 rounds). These are gitignored and not committed.

A/B, 12 rounds, CPU ms per op (median) and paired ratios:

| Runtime | Input      | Mode                        | Main   | Proto  | CPU proto/main      | Wall proto/main     | Alloc MB/op main → proto | GC ms/op main → proto |
| ------- | ---------- | --------------------------- | ------ | ------ | ------------------- | ------------------- | ------------------------ | --------------------- |
| bun     | `bank-16k` | writer                      | 0.0659 | 0.0103 | 0.156 (0.141–0.165) | 0.148 (0.135–0.172) | n/a                      | n/a                   |
| bun     | `bank-16k` | writer + `Xml.encodeString` | 0.1232 | 0.0605 | 0.472 (0.454–0.546) | 0.438 (0.340–0.581) | n/a                      | n/a                   |
| bun     | `bank-16k` | shipped encode              | 0.1889 | 0.1148 | 0.605 (0.585–0.667) | 0.582 (0.555–0.805) | n/a                      | n/a                   |
| bun     | `bank-4m`  | writer                      | 20.71  | 4.59   | 0.237 (0.216–0.298) | 0.274 (0.187–0.302) | n/a                      | n/a                   |
| bun     | `bank-4m`  | writer + `Xml.encodeString` | 40.16  | 15.10  | 0.388 (0.332–0.501) | 0.488 (0.356–0.567) | n/a                      | n/a                   |
| bun     | `bank-4m`  | shipped encode              | 57.70  | 33.21  | 0.586 (0.425–0.909) | 0.599 (0.381–0.745) | n/a                      | n/a                   |
| node    | `bank-16k` | writer                      | 0.0517 | 0.0118 | 0.228 (0.224–0.239) | 0.239 (0.078–0.298) | 0.232 → 0.035            | 0.0035 → 0.0005       |
| node    | `bank-16k` | writer + `Xml.encodeString` | 0.1716 | 0.0881 | 0.503 (0.479–0.553) | 0.466 (0.379–0.617) | 0.371 → 0.174            | 0.064 → 0.008         |
| node    | `bank-16k` | shipped encode              | 0.2374 | 0.1449 | 0.620 (0.549–0.677) | 0.627 (0.376–0.705) | 0.464 → 0.267            | 0.026 → 0.009         |
| node    | `bank-4m`  | writer                      | 26.25  | 5.90   | 0.224 (0.193–0.253) | 0.231 (0.216–0.246) | 58.8 → 10.0              | 10.9 → 0.53           |
| node    | `bank-4m`  | writer + `Xml.encodeString` | 44.89  | 20.09  | 0.450 (0.433–0.488) | 0.500 (0.441–0.552) | 90.8 → 42.0              | 24.9 → 2.2            |
| node    | `bank-4m`  | shipped encode              | 71.07  | 51.08  | 0.719 (0.693–0.754) | 0.698 (0.635–0.793) | 109.9 → 61.0             | 31.0 → 19.8           |

End-to-end against computis, 10 rounds, CPU ms per op:

| Runtime | Input      | T main | T proto | C       | T/C main            | T/C proto           | proto/main          |
| ------- | ---------- | ------ | ------- | ------- | ------------------- | ------------------- | ------------------- |
| bun     | `bank-16k` | 0.1761 | 0.1108  | 0.04547 | 3.972 (3.553–4.131) | 2.409 (2.302–2.589) | 0.623 (0.602–0.665) |
| bun     | `bank-4m`  | 56.01  | 36.49   | 14.09   | 3.991 (3.442–4.506) | 2.608 (2.110–2.862) | 0.662 (0.579–0.714) |
| node    | `bank-16k` | 0.2059 | 0.1346  | 0.05759 | 3.552 (3.408–3.665) | 2.353 (2.265–2.444) | 0.669 (0.631–0.689) |
| node    | `bank-4m`  | 66.48  | 49.33   | 19.86   | 3.312 (3.126–3.605) | 2.479 (2.257–2.625) | 0.751 (0.683–0.797) |

By wall time, `bank-4m` `T / C` moves from 2.99 to 1.91 on Bun and from 3.07 to 2.39 on Node. On Node `bank-4m`, GC per op falls from 14.9 ms (main) to 11.8 ms (prototype); computis spends 1.9 ms. Allocation falls from 109.9 MB to 61.0 MB; computis allocates 50.3 MB.

Main's `T / C` here (3.99 Bun, 3.31 Node at `bank-4m`) is below the layer profile's 5.25 and 4.35. That profile measured `ee496cc`; main has gained since.

### Why the encode gain exceeds the writer's own gain

On Bun `bank-4m` the writer alone saves about 16 ms, but writer plus tokenizer saves 25 ms. Two effects add up:

- **Tokenizer cost.** In one process, upstream `Xml.encodeString` over precomputed events costs 14.8 ms per op on main's events and 11.9 ms on the prototype's (Bun). Node shows no difference (12.95 against 13.12 ms). The prototype's attribute records are built by uniform assignment instead of spread clones; the `for…in` loop in upstream's `Writer.write` reads them faster on JSC. This is an observation, not a diagnosed cause.
- **GC pressure.** Node writer-plus-tokenizer GC falls from 24.9 to 2.2 ms per op, because the tokenizer no longer runs beside the writer's garbage.

### Ablation: shared events

8 rounds, writer alone, `bank-4m`, CPU proto/main:

| Variant                      | Bun                 | Node                            |
| ---------------------------- | ------------------- | ------------------------------- |
| Prototype                    | 0.287 (0.193–0.311) | 0.230 (0.178–0.281); 10.0 MB/op |
| Prototype, shared events off | 0.280 (0.218–0.423) | 0.245 (0.191–0.258); 13.6 MB/op |

The intervals are the full range at 8 rounds. Sharing events is worth at most a few percent. Almost all of the gain comes from items 1 and 4.

## Projected effect on `T / C`

The gain was measured, not projected: typed encode `T / C` at `bank-4m` moves from 3.99 to 2.61 on Bun and from 3.31 to 2.48 on Node (CPU). At `bank-16k` it moves from 3.97 to 2.41 and from 3.55 to 2.35. Against the layer profile's writer row (1.91 C on Bun, 1.60 C on Node), the prototype writer costs about 0.44 C (Bun) and 0.36 C (Node). The extra gain comes from the cheaper tokenizer and GC effects above.

Typed decode is untouched.

## Constraints

- **No public API change.** `writer.ts` is internal; `src/index.ts` exports only the `XmlSchema` namespace. The signatures of `writerOf` and `toEventsFrom` are unchanged.
- **No Schema JIT import.** The writer runs no Schema.
- **M5.** Encode still goes through events and `tokenizer.encodeString`; nothing is escaped by hand. No conflict with M5. A direct-to-text writer was not prototyped or measured here.
- **Effect-native.** The hot loop stays plain JavaScript with `Predicate` guards, as main's writer does: no Effect runs in it, and refusals are values.

## Risks

- **Shared event objects.** Reusing one `StartElement` or `EndElement` across elements, and across encodes through the cached writer in `fast-encode.ts`, relies on every `Tokenizer.encodeString` treating events as read-only. The upstream writer only reads them, and `Xml.Event` fields are `readonly`, but a custom `Tokenizer` could mutate them. The ablation shows sharing is nearly free to drop. **Drop it** unless the events are frozen and the read-only contract is documented on `Tokenizer`.
- **`__proto__`.** Plain assignment of a spelled attribute named `__proto__` would set the record's prototype. The prototype routes such a node to main's path. Main's own `attributesOf` assigns into its intermediate record and has the same latent issue. It was not fixed here.
- **Attribute key order.** Equality rests on assignment order matching `{ ...declared, ...spelled }`. That holds because `spellAttributes` rejects `xmlns`-spelled names, and XML names cannot be integer-like keys. A test should pin it.
- **Coverage.** The fast attribute path is exercised by the bank and the QTI items; the rare paths are main's code. The library suites that reach the writer through `src/` (`test/fast-encode.test.ts`, the encode-string fast-path and differential tests) should run once the change lands in `src/`.
- **Load.** All numbers were taken on a loaded, shared machine. The ratios are paired per round; absolute milliseconds are not publishable figures.

## Recommendation

Port items 1, 2, and 4 into `src/writer.ts` as one change: direct attribute writes, main's attribute path kept for `data` and non-spelling plans, and the slot-aligned child arrays without the `filter` and `every` allocations. Leave out shared events (item 3) for now. Pin attribute key order and the `__proto__` route with tests, and run the full suite. Expected effect: typed encode CPU falls to about 0.66 (Bun) and 0.75 (Node) of today's, and `T / C` to about 2.5 on both runtimes.

The next encode target after this is GC outside the writer. On Node, the prototype's encode still pays 11.8 ms of GC per op against computis's 1.9 ms, with 61 MB allocated against 50 MB. The structural Schema encode and the tokenizer are the remaining allocators.
