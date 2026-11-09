# Spike perf3b-sp-schema-nodes: fewer Schema nodes per value in the structural codec

Unit `perf3b-sp-schema-nodes`. This R&D spike asks how many Schema AST nodes the structural codec (`src/structural.ts`, `structuralOf` and `checkedStructuralOf`) makes the parser visit per element and per leaf, and whether a codec with fewer nodes per value makes the structural decode (about 0.3 to 0.4 `C`) and encode (about 0.8 to 0.9 `C`) at `bank-4m` cheaper. It follows the recommendation of [effect-overhead.md](effect-overhead.md). The prototypes live in `work/spikes/perf3b-schema-nodes/` (gitignored); this file is the durable record. No file under `src/`, `bench/` or `test/` changed.

## Result

- **Only the leaves can lose nodes.** A string leaf is already one node: `Schema.toCodecStringTree` returns `Schema.String` unchanged. Structs, arrays and `Schema.optionalKey` add no wrapper nodes, and the `mixed` union already selects its member with one map lookup on `_tag`. What `toCodecStringTree` adds is on `Boolean` and `Number` leaves: a boolean is 3 nodes and a transformation, and a finite number is 2 nodes, a transformation and 2 check passes.
- **The prototype makes each such leaf one node.** It replaces the leaf's StringTree chain with one `SchemaAST.Declaration` whose `run` decodes the string and whose `encodingRun` encodes the value, carrying the leaf's own checks. A bank record goes from 23 parser nodes, 3 transformations and 2 check passes to 18 nodes, no transformation and 1 check pass.
- **The structural codec gets 7 to 18 percent cheaper; the typed case barely moves.** With JIT off, structural decode runs at 0.82 to 0.93 of today's CPU and structural encode at 0.83 to 0.87. That is 0.02 to 0.05 `C` of decode and 0.09 to 0.13 `C` of encode. End to end, typed decode is 0.95 to 0.96 at `bank-16k` and unresolved at `bank-4m`. Typed encode is 0.92 to 0.96 on Bun, 0.98 on Node at `bank-16k`, and unresolved on Node at `bank-4m`. With the JIT off, projected `T / C` at `bank-4m` falls by 0.02 to 0.03 for decode and 0.11 to 0.13 for encode.
- **The rest of the codec is not node count.** Struct and array walking, the output objects, and the `Exit` per node are about 75 percent of the codec's self time at `bank-4m`, and the number of struct and array nodes is fixed by the value's shape. Schema's interpreter does that work per node, so no node reduction inside Schema reaches it.
- **A one-step `mixed` dispatcher does not pay.** A `Declaration` that picks the item by `_tag` in place of the `Union` changes no node count. On the corpus its structural ratio to the leaf prototype is 0.90 to 1.02, with signs disagreeing between runtimes, and typed decode does not move.
- **Correctness holds and no public AST changes.** Decode values, encode outputs, fast-path accept and refuse decisions, and public decode and encode outcomes match `HEAD` on 2,094 outcomes per runtime, JIT off and on. See [Correctness](#correctness) and [What it could affect](#what-it-could-affect).

Recommendation: do not implement now. The leaf collapse is correct and measurable but worth at most 0.13 `C` of encode and 0.05 `C` of decode, and it copies Effect's StringTree rules for `Boolean` and `Number`. Close "fewer nodes" as a lever for item 5. Details are in [Recommendation](#recommendation).

## Node counts

`count.ts` walks the structural codec's AST over the actual plain object (decode) or value (encode), mirroring `internal/schema/interpreter.ts` `compile` and each node's `getParser`. A node is an AST node whose parser runs, including the encoded node of each link. Decode and encode visit the same counts.

### Per leaf and per element

| Position                             | `HEAD`                                                                                    | Prototype                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------- |
| `Schema.String` leaf                 | 1 node                                                                                    | 1 node                            |
| `Schema.Boolean` leaf                | 3 nodes (`Boolean`, `Union`, `Literal`), 1 transformation                                 | 1 node (`Declaration`)            |
| `Schema.Finite` or `Schema.Int` leaf | 2 nodes (`Number`, `String`), 1 transformation, 2 check passes                            | 1 node, 1 check pass              |
| `Schema.Number` leaf                 | 3 nodes (`Number`, `Union`, `String` or `Literal`), 1 transformation, 0 to 1 check passes | 1 node                            |
| element                              | 1 `Objects` node                                                                          | unchanged                         |
| `many` slot                          | 1 `Arrays` node                                                                           | unchanged                         |
| `optional` slot or attribute         | no node: `optionalKey` is the node's context                                              | unchanged                         |
| `mixed` item                         | `Union`, item `Objects`, `_tag` `Literal`, then the value                                 | unchanged (dispatcher: see below) |
| recursive child                      | 1 `Suspend` node per visit                                                                | unchanged                         |

### Totals

| Input                                                                                     | Measure          | `HEAD` | Prototype | Change |
| ----------------------------------------------------------------------------------------- | ---------------- | ------ | --------- | ------ |
| `bank-16k` (42 records, 253 objects, 420 leaves)                                          | nodes            | 968    | 758       | −22%   |
|                                                                                           | nodes per record | 23     | 18        |        |
|                                                                                           | transformations  | 126    | 0         |        |
|                                                                                           | check passes     | 84     | 42        |        |
| corpus (4 `qti-assessment-item` documents the fast path accepts; 173 objects, 245 leaves) | nodes            | 590    | 567       | −4%    |
|                                                                                           | transformations  | 14     | 0         |        |
|                                                                                           | check passes     | 13     | 5         |        |
|                                                                                           | `Union` nodes    | 111    | 102       |        |

A bank record holds 7 string leaves, 2 booleans (`fixed`, `required`) and 1 finite number (`value`), so the collapse removes 5 of its 23 nodes. The corpus is mostly strings and `mixed` content, so the collapse removes little there. With the `mixed` dispatcher (`proto2`), 94 of the corpus's `Union` nodes become `Declaration` nodes, one for one.

## Where the time goes

Node 26.13.0 `--cpu-prof` of the structural codec's parse alone (`prof.ts`, `prof-corpus.ts`), JIT off, one profile per variant. Self time inside the parse call's subtree is bucketed by the node kind it serves (`kinds.py`). GC is not attributed to a frame and is excluded; it was 368 ms (decode) and 643 ms (encode) beside 514 ms and 595 ms of subtree self time at `bank-4m`. Single profiles under load move by several points, so read these as shares, not as ratios.

| Share of codec self time                                    | decode `bank-4m` | encode `bank-4m` | decode corpus |
| ----------------------------------------------------------- | ---------------- | ---------------- | ------------- |
| struct property loop (`Objects` fast path, `stepProperty`)  | 27%              | 33%              | 30%           |
| struct output objects (`assignProperty`)                    | 13%              | 9%               | 16%           |
| array element loop (`onItem`, `stepArray`, `runSequential`) | 19%              | 22%              | 17%           |
| `Exit` allocation and checks                                | 14%              | 11%              | 3%            |
| leaf links, transformations and checks                      | 20%              | 16%              | 6%            |
| leaf type refinements                                       | 4%               | 5%               | 2%            |
| `Union` and `Literal` (boolean literals, `mixed` tags)      | 2%               | 3%               | 20%           |

The leaf rows are what the collapse removes. In the prototype's decode profile the leaf share falls to 14 percent, and that remainder is the `Declaration` itself: the finite-number regular expression, `Number(s)`, and the `Exit` it returns. Struct, array and `Exit` work keeps its absolute size. On the corpus the leaf rows are small, and the `Union` and `Literal` row is the `mixed` dispatch the second prototype targets.

## What the prototypes change

Both prototypes are copies of `HEAD` (`e431665`) with `src/structural.ts` changed. The public API is unchanged, and neither adds a dependency or a JIT import.

1. **`proto`: one-node leaves.** `build` calls a `leafCodec` in place of `Schema.toCodecStringTree` for attributes, text content and the `data-*` record value. `leafCodec` returns `toCodecStringTree(schema)` unless the leaf has no encoding and no constructor default and is one of:
   - a `Boolean` with no checks: `run` maps `"true"` and `"false"`, `encodingRun` maps a boolean to its string;
   - a `Number` whose StringTree link is `SchemaTransformation.numberFromString`: `run` accepts a string that matches `SchemaAST.FINITE_PATTERN` (or, for a plain `Number`, `"Infinity"`, `"-Infinity"`, `"NaN"`), or any string under `disableChecks`, and returns `Number(s)`; `encodingRun` returns `String(n)` under the same acceptance.

   The `Declaration` is built with `new SchemaAST.Declaration(...)` and `Schema.make`. It carries the leaf's `checks` and `context`. `SchemaAST.flip` swaps `run` for `encodingRun` and the checks for `encodingChecks`, so one node serves both directions and the leaf's own checks run on the Type value, as they do today.

2. **`proto2`: `proto` plus a `mixed` dispatcher.** `mixedField` wraps the item structs in a `Declaration` whose type parameters are the items. Its `run` reads `_tag` and runs that item's `SchemaParser.run` parser. `flip` hands it the flipped items, so the same `run` encodes.

## Measurements

### Method

- **Trees.** `base` is `git archive` of `HEAD` (`e431665`). `proto` and `proto2` are the same archive with the edits above. All trees import the repository's pinned `effect` 4.1.2.
- **Drivers.** `ab.ts` (bank) and `ab-corpus.ts` (corpus), one driver per runtime, run at the same time beside other seats' work. Every round runs every cell for each of its variants, each in its own child process of the same runtime. The variant order reverses every other round, and the cell order rotates. JIT on preloads `effect/schema/SchemaJITCompiler/enable` through `bench/harness/jit/on.ts`.
- **Rungs (`case.ts`, `case-corpus.ts`).**
  - `struct-decode`: `Schema.decodeUnknownEffect` of the root's structural codec over a fixed plain object, reading the returned `Exit`.
  - `struct-encode`: `Schema.encodeEffect` of the structural codec over the decoded value.
  - `typed-decode`: the `effect-xml/typed-decode` case shape, `XmlSchema.fromString(ItemBank)` through `runSync`. This is `T`.
  - `encode-typed`: `fromString` encode without the XML declaration.
  - `computis`: `@computis/effect-xml`'s own typed-decode and encode-typed cases, run in the same rounds, which give `C`.
- **Inputs.** `bank-16k` and `bank-4m`, and `corpus-items` (the four typed-decode QTI fixtures; one operation decodes or encodes all four).
- **Samples.** Each child runs 3 warm-up samples, then 7 samples through `bench/harness/metrics.ts` `measureResources`. Each per-operation value is the median of the 7. Operations per sample: 2,000 (structural) and 400 (typed) at `bank-16k`, 8 and 3 at `bank-4m`, 2,000 and 300 on the corpus.
- **Rounds and statistics.** 12 rounds per runtime, none repeated. A ratio is a variant's value over `base`'s in the same round. The tables give the median over rounds with the distribution-free sign-test interval: ranks 3 to 10 of 12, 96 percent coverage. The spike's `report.py` returned ranks 4 to 9 (about 85 percent coverage); every interval in this file was recomputed at ranks 3 to 10 from the raw rounds (final audit `4705e240`, residual R3). The medians and the conclusions did not change. CPU is user plus system time; wall time is secondary.
- **Load.** The 1-minute load average ran from 35 to 208, recorded per child.
- **Runtimes.** Bun 1.4.2 and Node 26.13.0.

### CPU ratio to base, bank (primary)

| Runtime | Input      | JIT | Rung            | CPU proto / base    | wall proto / base   |
| ------- | ---------- | --- | --------------- | ------------------- | ------------------- |
| bun     | `bank-16k` | off | `struct-decode` | 0.816 (0.795–0.875) | 0.828 (0.765–0.983) |
| bun     | `bank-16k` | off | `struct-encode` | 0.832 (0.785–0.954) | 0.927 (0.796–0.960) |
| bun     | `bank-16k` | off | `typed-decode`  | 0.963 (0.929–0.980) | 0.964 (0.846–1.070) |
| bun     | `bank-16k` | off | `encode-typed`  | 0.955 (0.911–0.997) | 0.924 (0.901–0.946) |
| bun     | `bank-4m`  | off | `struct-decode` | 0.933 (0.852–1.005) | 0.979 (0.864–1.048) |
| bun     | `bank-4m`  | off | `struct-encode` | 0.866 (0.738–0.897) | 0.841 (0.787–0.924) |
| bun     | `bank-4m`  | off | `typed-decode`  | 0.989 (0.906–1.046) | 0.988 (0.917–1.052) |
| bun     | `bank-4m`  | off | `encode-typed`  | 0.916 (0.867–0.992) | 0.953 (0.824–1.000) |
| node    | `bank-16k` | off | `struct-decode` | 0.871 (0.831–0.877) | 0.872 (0.821–0.934) |
| node    | `bank-16k` | off | `struct-encode` | 0.831 (0.810–0.857) | 0.827 (0.770–0.867) |
| node    | `bank-16k` | off | `typed-decode`  | 0.951 (0.926–0.956) | 0.962 (0.937–1.002) |
| node    | `bank-16k` | off | `encode-typed`  | 0.979 (0.948–0.999) | 0.938 (0.871–1.084) |
| node    | `bank-4m`  | off | `struct-decode` | 0.930 (0.891–0.964) | 0.919 (0.851–1.081) |
| node    | `bank-4m`  | off | `struct-encode` | 0.854 (0.819–0.892) | 0.840 (0.742–0.863) |
| node    | `bank-4m`  | off | `typed-decode`  | 0.992 (0.943–1.022) | 0.976 (0.884–1.087) |
| node    | `bank-4m`  | off | `encode-typed`  | 0.996 (0.962–1.037) | 0.921 (0.858–0.997) |
| bun     | `bank-16k` | on  | `struct-decode` | 0.947 (0.910–0.969) | 0.946 (0.905–1.085) |
| bun     | `bank-16k` | on  | `struct-encode` | 0.896 (0.880–0.955) | 0.879 (0.845–1.011) |
| bun     | `bank-16k` | on  | `typed-decode`  | 0.973 (0.941–0.998) | 0.988 (0.955–1.102) |
| bun     | `bank-16k` | on  | `encode-typed`  | 0.977 (0.964–1.020) | 1.026 (0.956–1.098) |
| bun     | `bank-4m`  | on  | `struct-decode` | 0.921 (0.813–1.004) | 0.866 (0.758–0.918) |
| bun     | `bank-4m`  | on  | `struct-encode` | 0.858 (0.796–0.893) | 0.858 (0.814–0.963) |
| bun     | `bank-4m`  | on  | `typed-decode`  | 0.995 (0.940–1.080) | 1.021 (0.975–1.073) |
| bun     | `bank-4m`  | on  | `encode-typed`  | 0.991 (0.950–1.091) | 0.934 (0.549–1.062) |
| node    | `bank-16k` | on  | `struct-decode` | 0.908 (0.855–1.002) | 0.894 (0.793–1.002) |
| node    | `bank-16k` | on  | `struct-encode` | 0.844 (0.805–0.936) | 0.810 (0.707–0.953) |
| node    | `bank-16k` | on  | `typed-decode`  | 0.963 (0.929–0.994) | 0.952 (0.837–1.006) |
| node    | `bank-16k` | on  | `encode-typed`  | 1.017 (0.945–1.093) | 0.984 (0.935–1.365) |
| node    | `bank-4m`  | on  | `struct-decode` | 0.997 (0.938–1.092) | 1.004 (0.951–1.134) |
| node    | `bank-4m`  | on  | `struct-encode` | 0.823 (0.757–0.850) | 0.817 (0.656–1.045) |
| node    | `bank-4m`  | on  | `typed-decode`  | 1.003 (0.940–1.041) | 1.026 (0.934–1.266) |
| node    | `bank-4m`  | on  | `encode-typed`  | 1.001 (0.959–1.033) | 0.996 (0.764–1.096) |

Per operation at `bank-4m`, JIT off, the codec saves 0.6 ms (Bun, interval crossing zero) and 1.1 ms (Node) of decode CPU, and 1.6 ms and 2.3 ms of encode CPU. The Bun `encode-typed` saving, 3.4 ms (0.26 to 5.2), has a median larger than its codec saving, though the two intervals overlap; any excess is unexplained and may be allocation and GC, which this harness does not split on Bun. On Node, `struct-encode` allocates 7 percent less at `bank-16k` (70.9 KB against 76.0 KB per operation); decode allocation is unchanged.

### The structural codec in units of C

Each round divides the structural rung's CPU by the same round's `computis` typed-decode (for decode) or encode-typed (for encode).

| Runtime | Input      | JIT | Rung            | base / C            | proto / C           | saved, C             |
| ------- | ---------- | --- | --------------- | ------------------- | ------------------- | -------------------- |
| bun     | `bank-16k` | off | `struct-decode` | 0.275 (0.264–0.291) | 0.224 (0.218–0.266) | 0.051 (0.036–0.056)  |
| bun     | `bank-16k` | off | `struct-encode` | 0.541 (0.520–0.557) | 0.491 (0.435–0.520) | 0.088 (0.025–0.119)  |
| bun     | `bank-4m`  | off | `struct-decode` | 0.306 (0.286–0.327) | 0.296 (0.260–0.304) | 0.021 (−0.002–0.045) |
| bun     | `bank-4m`  | off | `struct-encode` | 0.832 (0.785–0.891) | 0.710 (0.642–0.768) | 0.111 (0.083–0.230)  |
| node    | `bank-16k` | off | `struct-decode` | 0.401 (0.383–0.417) | 0.346 (0.336–0.353) | 0.052 (0.047–0.068)  |
| node    | `bank-16k` | off | `struct-encode` | 0.587 (0.571–0.630) | 0.492 (0.466–0.508) | 0.100 (0.084–0.115)  |
| node    | `bank-4m`  | off | `struct-decode` | 0.387 (0.361–0.399) | 0.355 (0.339–0.365) | 0.025 (0.013–0.038)  |
| node    | `bank-4m`  | off | `struct-encode` | 0.876 (0.787–0.915) | 0.739 (0.692–0.785) | 0.131 (0.079–0.162)  |
| bun     | `bank-4m`  | on  | `struct-decode` | 0.184 (0.176–0.203) | 0.168 (0.154–0.180) | 0.015 (−0.001–0.039) |
| bun     | `bank-4m`  | on  | `struct-encode` | 0.465 (0.442–0.514) | 0.395 (0.377–0.464) | 0.060 (0.049–0.096)  |
| node    | `bank-4m`  | on  | `struct-decode` | 0.154 (0.149–0.163) | 0.159 (0.142–0.168) | 0.000 (−0.014–0.009) |
| node    | `bank-4m`  | on  | `struct-encode` | 0.383 (0.358–0.406) | 0.315 (0.288–0.343) | 0.065 (0.056–0.097)  |

### T / C

Measured in the same rounds, CPU. The projection subtracts the codec saving above from today's `T / C`.

| Runtime | Input      | JIT | Rung           | `T / C` today       | `T / C` proto, measured | `T / C` proto, projected |
| ------- | ---------- | --- | -------------- | ------------------- | ----------------------- | ------------------------ |
| bun     | `bank-16k` | off | `typed-decode` | 2.638 (2.610–2.696) | 2.517 (2.463–2.565)     | 2.59                     |
| bun     | `bank-16k` | off | `encode-typed` | 2.622 (2.489–2.917) | 2.428 (2.383–2.680)     | 2.53                     |
| bun     | `bank-4m`  | off | `typed-decode` | 1.946 (1.895–2.053) | 1.894 (1.830–1.945)     | 1.92                     |
| bun     | `bank-4m`  | off | `encode-typed` | 2.851 (2.720–3.141) | 2.682 (2.394–2.965)     | 2.74                     |
| node    | `bank-16k` | off | `typed-decode` | 2.391 (2.336–2.523) | 2.256 (2.212–2.306)     | 2.34                     |
| node    | `bank-16k` | off | `encode-typed` | 2.455 (2.297–2.606) | 2.371 (2.295–2.539)     | 2.36                     |
| node    | `bank-4m`  | off | `typed-decode` | 2.191 (2.101–2.352) | 2.186 (1.987–2.298)     | 2.17                     |
| node    | `bank-4m`  | off | `encode-typed` | 2.543 (2.452–2.625) | 2.513 (2.426–2.776)     | 2.41                     |
| bun     | `bank-4m`  | on  | `typed-decode` | 1.794 (1.654–1.856) | 1.787 (1.730–1.839)     | 1.78                     |
| bun     | `bank-4m`  | on  | `encode-typed` | 2.459 (2.194–2.838) | 2.561 (2.233–3.106)     | 2.40                     |
| node    | `bank-4m`  | on  | `typed-decode` | 2.071 (1.988–2.118) | 2.057 (1.856–2.138)     | 2.07                     |
| node    | `bank-4m`  | on  | `encode-typed` | 2.023 (1.851–2.122) | 2.028 (1.832–2.246)     | 1.96                     |

Every measured proto interval overlaps today's at `bank-4m`. The projected change there is 0 to 0.03 `C` for decode and 0.06 to 0.13 `C` for encode, the smaller ends with the JIT on.

### JIT on

The JIT compiles an `Objects` node only when none of its children has an encoding, is a `Declaration`, or is a `Suspend` (`internal/schema/codegen.ts` `addChild`). Today's linked `Boolean` and `Number` leaves already keep their parent structs out of the JIT, and the prototype's `Declaration` leaves keep the same structs out, so the JIT compiles the same nodes in both trees. With the JIT on, the structural decode at `bank-4m` is 1.5 (Bun) to 2.4 (Node) times cheaper on both trees, and the prototype's decode ratio rises to 0.91 to 1.00. Its encode saving stays at 0.82 to 0.90, 0.06 to 0.07 `C` at `bank-4m`. Neither shape can let the JIT compile a struct that holds a boolean or number leaf, because a leaf that turns a string into a boolean or number needs an encoding or a `Declaration`.

### The mixed dispatcher (corpus)

CPU ratios over `corpus-items`, 12 rounds per runtime, load 46 to 208.

| Runtime | JIT | Rung            | proto / base        | proto2 / base       | proto2 / proto      |
| ------- | --- | --------------- | ------------------- | ------------------- | ------------------- |
| bun     | off | `struct-decode` | 0.996 (0.901–1.107) | 0.896 (0.815–0.979) | 0.901 (0.812–1.000) |
| bun     | off | `struct-encode` | 1.001 (0.955–1.073) | 0.897 (0.823–1.009) | 0.916 (0.807–1.027) |
| bun     | off | `typed-decode`  | 0.904 (0.874–1.025) | 0.971 (0.867–1.147) | 1.045 (0.934–1.156) |
| node    | off | `struct-decode` | 0.921 (0.892–0.947) | 0.934 (0.907–0.963) | 1.023 (1.007–1.035) |
| node    | off | `struct-encode` | 0.927 (0.910–0.944) | 0.932 (0.914–0.962) | 1.017 (0.968–1.039) |
| node    | off | `typed-decode`  | 1.004 (0.983–1.061) | 0.994 (0.957–1.023) | 0.978 (0.964–1.021) |
| bun     | on  | `struct-decode` | 0.936 (0.889–0.987) | 0.907 (0.883–1.008) | 0.999 (0.938–1.049) |
| node    | on  | `struct-decode` | 0.946 (0.920–0.992) | 0.927 (0.897–0.950) | 0.940 (0.927–1.095) |

The structural codec is 22 to 34 µs of a 195 to 293 µs typed decode of the four documents, about 9 to 16 percent. The dispatcher's best case, 10 percent of that, is about 1 percent of `T`. With the JIT off it may help on Bun, where the intervals reach or cross 1, and it slows the Node structural decode. The Bun `proto` typed-decode ratio of 0.904 does not repeat on Node or with the JIT on, and it would need a 26 µs saving, the whole structural codec's cost, where `struct-decode` shows 0.1 µs; read it as noise.

## Correctness

- **Equivalence probes.** `equiv.ts` runs `base` and a prototype on the same inputs and compares a view of each outcome that keeps own-key order, constructor names, `-0` and `NaN`, and error messages, paths and reasons. Per case it compares:
  - every fast-path decode attempt (`attemptDecode` on each collected root or record): refused, or accepted with its value;
  - the public `fromString` decode outcome, value or error;
  - every fast-path encode attempt (`attemptEncode`) and the public `fromString` encode outcome, over each decoded value plus ten leaf corruptions of the bank value: a string and a number in the boolean fields, a missing boolean, and `NaN`, `Infinity`, `-0`, `1e21`, `5e-324`, `"1"` and a missing value in the finite field.
- **Cases.** 1,195 per run:
  - `bank-16k` and `bank-4m`, each under four parse-option variants (default, `errors: "all"`, `disableChecks: true`, `onExcessProperty: "error"`);
  - every QTI corpus file under the same four variants;
  - the differential cases modules: `corpus.cases.ts` (`itemInputs`, `channelInputs`), `generated.cases.ts` (`documentInputs`, `encodeInputs`), `wrapped.cases.ts` and `fuzz.cases.ts`, each with its own parse options and record paths.
- **Results.** 2,094 outcomes per run, with 0 differences for `proto` and for `proto2`, on Bun 1.4.2 and Node 26.13.0, JIT off and on. The outcomes include 320 accepted and 558 refused fast decodes, 397 accepted and 152 refused fast encodes, and 236 public failures.
- **Sensitivity check.** Mutating `proto` (a boolean encoding to `"no"`, `"NaN"` accepted as finite) makes 54 cases differ, so the probes see leaf-level changes.
- **Test suite.** The repository's suite ran against each prototype tree (`vitest run --root proto`, `--testTimeout 120000`): 1,206 tests passed and 2 were skipped on both. The one failing file, `test/bench/environment.test.ts`, reads `node_modules/effect/package.json` relative to the tree, which the copy lacks. The passing files include `structural.test.ts`, `derivations.test.ts`, `jit-parity.test.ts` and the fast-path suites.

## What it could affect

Nothing public. The structural codec is reachable only through the module `WeakMap`s in `src/structural.ts`, keyed by the `Plan` and by the user's root AST, and only the fast decode and encode attempts parse with it. `compile()` output, the element codecs, and their derivations are not touched:

- The leaf `Declaration`s are new AST nodes built from the leaf's `checks` and `context`. No user AST is changed, and no annotation is written.
- JSON Schema, `toEncoderXml`, equivalence and the other derivations read `compile()` output, not the structural codec. `derivations.test.ts` passes on both prototypes.
- Errors are unchanged by construction: a fast-path failure is `None`, and the standard path reports the error.

## Risks

- **Coupling to Effect's StringTree rules.** The prototype copies `toCodecStringTree`'s acceptance for `Boolean` and `Number`: the `"true"`/`"false"` literals, `FINITE_PATTERN` (which Effect does not export), the non-finite literals, and `String(n)` on encode. If an Effect upgrade changes those rules, the fast path would accept or produce what the standard path does not, and the error would not surface as a failure but as a different value. Landing it would need a contract test that runs each collapsed leaf against `Schema.toCodecStringTree(leaf)` over a fixed set of strings and values, and a stricter shape check on the derived link for `Boolean` too.
- **Recognition is by shape.** A leaf is collapsed only when it has no encoding and no constructor default, and only for an unchecked `Boolean` or a `Number` whose link is `numberFromString`. Every other leaf keeps `toCodecStringTree`, so the risk is limited to those two shapes.
- **Parse options.** `disableChecks` is honored inside `run` and `encodingRun`, as the encoded-side checks are today; the leaf's Type checks stay on the node, where Schema applies `disableChecks` and `errors` itself. The probes cover all four option variants.
- **Measurement.** The rounds ran at load 35 to 208. The end-to-end ratios at `bank-4m` stay within 0.92 to 1.03 and their intervals mostly cross 1, so a quieter machine would only narrow intervals around a small effect.

## Recommendation

1. **Do not implement the leaf collapse now.** It is correct and it does what it says: one node per boolean or number leaf, 7 to 18 percent of the structural codec. But the codec is a minor part of `T`, so the gain is at most 0.05 `C` of decode and 0.13 `C` of encode, unresolved end to end at `bank-4m` except for Bun encode. Against that it copies Effect's StringTree rules. If a later slice wants the encode share, land it with the contract test from [Risks](#risks).
2. **Do not implement the `mixed` dispatcher.** The union already selects its member by `_tag` in one lookup; replacing it changes no node count and no end-to-end number.
3. **Close "fewer Schema nodes" as a lever for item 5.** The struct, array and `Exit` work that dominates the codec scales with the value's shape, not with how the codec is spelled. The remaining levers for the codec are outside this spike: the Schema JIT, which already halves the structural decode for apps that enable it, or a structural parser outside Schema's interpreter.

## Files

`work/spikes/perf3b-schema-nodes/` (gitignored):

- **Trees.** `base/`, `proto/` and `proto2/`, each with `BASE` holding the pinned commit.
- **Node counts.** `dump.ts`, `count.ts`, `counts.txt` and `counts-corpus.txt`.
- **Profiles.** `prof.ts`, `prof-corpus.ts`, `subtree.py`, `kinds.py` and `prof/*.cpuprofile`.
- **A/B.** `case.ts`, `ab.ts`, `case-corpus.ts`, `ab-corpus.ts`, `report.py`, the raw rounds `ab-bun.jsonl`, `ab-node.jsonl`, `abc-bun.jsonl` and `abc-node.jsonl`, and `report.txt` and `report-corpus.txt`.
- **Correctness.** `equiv.ts`, `equiv.txt`, `equiv-proto2.txt`, `suite-proto.txt` and `suite-proto2.txt`.
