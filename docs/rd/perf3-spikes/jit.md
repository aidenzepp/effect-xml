# Spike perf3-sp-jit: Schema JIT on custom transforms, the JIT policy, no-eval and AOT

Unit `perf3-sp-jit`, phase 3 brief Step 1 items 6, 7 and 8. This is an R&D spike. The prototype lives in `work/spikes/perf3-jit/` (gitignored); this file is the durable record.

## Result

- **Q8, custom transforms and checks.** The JIT never bails for the whole AST. It compiles each AST node on its own and links nodes through the shared registry. A transformation or a `Declaration` anywhere below a node removes that node's synchronous fast path, and the fast path of every ancestor up to the root. Those nodes still get compiled object and array loops. Subtrees without transformations keep their own fast path. Checks never cost the fast path. The catch is that `Schema.toCodecStringTree(Schema.Boolean)` and `toCodecStringTree(Schema.Finite)` are transformations too, so any realistic XML codec already loses the root fast path. A user's own transform then adds 0 to 25 percent.
- **Q6, policy.** Recommend per-AST `SchemaJITCompiler.enable(ast)` on the library's own structural codec ASTs, once per codec, on by default. It is as fast as the global import: about 1.9 times faster than the interpreter on Bun and 2.5 times on Node, for the bank shape. It installs nothing for unrelated schemas. Contrary to the brief, `@computis/effect-xml` 0.4.0 does exactly this, not the global import: `codec()` calls `SchemaJITCompiler.enable(exactDecoder(schema).ast)` and `enable(SchemaAST.flip(schema.ast))` unless `options.jit === false`.
- **Q7, no-eval.** When `new Function` throws, the JIT probes once (`Function("return true")`), marks itself unsupported, and every operation falls back to the interpreter. The output is identical and the time is the interpreter's. JIT-by-default is therefore safe on Workers and under strict CSP. `SchemaAOTCompiler` matches the JIT without eval, but only if every composite node is passed as a target. It cannot be applied to codecs the library builds at runtime from user declarations without a new public hook. Do not adopt it now.

## Method

- **Runtimes.** Bun 1.4.2 and Node v26.13.0 (TypeScript run by strip-only type stripping). `effect` 4.1.2, as pinned. Apple M4 Pro, 14 cores, 48 GB.
- **Machine load.** The machine is shared with other agent seats. `uptime` load averages were 15.9 to 33.4 (1-minute) across the matrix runs, and 57 during the baseline probe. Medians and repetitions are there to absorb that noise. Absolute numbers would be lower on an idle machine.
- **Codec.** `work/spikes/perf3-jit/codecs.ts` is a hand-written structural codec with the encoded shape of `bench/vocabulary.ts` `ItemBank`: `{ refs: [ { category?, fixed?, href, identifier, required?, rules: [ { target, match: { correct: { identifier }, variable: { identifier } } } ], weights: [ { identifier, value } ] } ] }`. Leaves are `Schema.toCodecStringTree(String | Boolean | Finite)`, as `src/compile.ts` uses them. It did not wait on the builder spike.
- **Input.** A hand-built plain object, the shape a builder would emit, with 10,442 records: the record count of `bank-4m` (the record template is copied from `bench/inputs/synthetic.ts`).
- **Variants.** `base`; `union` (weights are a `Union` of two Structs discriminated by a literal); `leaf-check` (`isPattern` and `isMinLength` on leaves); `leaf-transform` (a sync `Schema.decodeTo` with `SchemaTransformation.transform`); `leaf-transform-effect` (`SchemaGetter.transformEffect`); `struct-check` (`makeFilter` on the item Struct); `declaration` (a leaf decoded into a `Schema.declare` class). Each `strings-*` variant is the same with every leaf a plain `String`, which isolates the user's change from the built-in Boolean and Finite transforms.
- **Modes.** Each mode runs in its own process, because the global install cannot be undone:
  - `off`: the interpreter.
  - `global`: `import "effect/schema/SchemaJITCompiler/enable"` before Effect loads.
  - `ast`: `SchemaJITCompiler.enable(codec.ast)` at construction.
  - `noeval-*`: code generation blocked. On Bun, `globalThis.Function` is replaced by a stub that throws `EvalError` (the prototype is kept, so `instanceof Function` still works). On Node, the real V8 switch `--disallow-code-generation-from-strings` is used, which is what Workers runs with.
  - `aot`, `aot-noeval`: a module from `SchemaAOTCompiler.compile`, generated beforehand and installed.
- **Timing.** `Schema.decodeUnknownSync(codec)`: one cold call, 5 warm-up calls, then 21 timed calls; the per-process median is reported. The full matrix ran 3 times. Each table cell is the median of the 3 process medians, with their range. A JSON fingerprint of the last decoded record matched across all modes for every variant.
- **Observation.** A counting wrapper around `globalThis.Function` records every generated function and the AST it was generated for (`introspect.ts`, `sidefx.ts`). It is installed only at compile time; the generated code itself is unwrapped.
- **Reproduce.** `cd work/spikes/perf3-jit && bun aot-gen.ts && ./matrix.sh && bun table.ts`. Also `bun introspect.ts <variant> ast`, `<runtime> sidefx.ts <ast|global>`, `<runtime> adapters.ts <none|flip>`, `<runtime> options.ts <off|ast>`, `bun aot-deep.ts gen <variant>` then `aot-deep.ts run <variant>`.

## Q8: what the JIT does with a user's transform or check

### From the source (`node_modules/effect/src`, 4.1.2)

- `schema/SchemaJITCompiler.ts` `compiler` runs per AST node. `shouldCompileParser` (`internal/schema/codegen.ts`) accepts `Objects`, `Arrays`, `Union` and `TemplateLiteral`, and any node with `encoding`, `checks` or `encodingChecks`. Plain leaves stay interpreted. Children are reached through the registry `resolve`, so every compilable descendant gets its own entry, lazily, on first use.
- Each node can get two decode operations:
  - **`decode`**, the synchronous fast path. It builds no issues and returns `invalid`, after which the registry runs `decodeEffect` for diagnostics. `getFacts` emits it only when the whole subtree is supported. `addChild` marks the parent unsupported as soon as a child has `encoding` (any transformation), or is a `Declaration` or a `Suspend`. That flag propagates to every ancestor.
  - **`decodeEffect`**, the detailed decoder. It is always generated for compilable nodes: `R.decode(ast, resolve, object, ...)` with a generated Struct property loop (`emitObject`) or Array loop (`emitArray`). Each child goes through `child.parser`. A single-link synchronous `Transform` between inline-testable leaf types (`canInlineEncoding`, `emitEncoding`) is inlined into the parent loop or into the node. `TransformEffect`, middleware and `Declaration` nodes run on the interpreter, as children of compiled parents.
- Checks are compiled into both operations (`K(ast, value, ...)` in `emitChecked`). A Struct-level check makes the node "not output-free", so it loses `is`, but it keeps `decode`.
- The compiled object loop falls back to the interpreter for the whole node when `errors: "all"`, `onExcessProperty`, or `concurrency` other than 1 is set.

### Observed (`bun introspect.ts <variant> ast`, one valid decode)

| Variant                         | Fast `decode` generated for                    | Detailed or interpreted                                                                                   |
| ------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `strings-base`                  | root only: one function inlines the whole tree | none until an invalid input, which lazily adds 10 detailed functions                                      |
| `strings-leaf-check`            | root (the checks are inlined)                  | same                                                                                                      |
| `strings-struct-check`          | root                                           | same                                                                                                      |
| `strings-leaf-transform`        | `rules`, `weights`                             | root, `refs`, item Struct; the transform is inlined into the item loop                                    |
| `strings-leaf-transform-effect` | `rules`, `weights`                             | root, `refs`, item Struct, and `identifier` (`transformEffect` interpreted under the compiled parent)     |
| `strings-declaration`           | `rules`, `weights`                             | root, `refs`, item Struct, `href` (Declaration)                                                           |
| `base` (every user variant)     | `rules`, and the Boolean literal union         | root, `refs`, item Struct, `weights`, weight Struct; `fixed` (Boolean) detailed; `value` (Finite) inlined |

So the answer is "compile around it": a transform demotes only its ancestor chain from fast to detailed. A realistic codec is already demoted by its Boolean and number leaves, so a user transform changes little.

### Timings: user transforms and checks on top of the bank codec

Median ms from the matrix below. "Cost" is the change against `base` under per-AST JIT.

| Variant                 | Bun off | Bun JIT | Bun cost | Node off | Node JIT | Node cost |
| ----------------------- | ------- | ------- | -------- | -------- | -------- | --------- |
| `base`                  | 5.58    | 2.96    | n/a      | 7.91     | 3.10     | n/a       |
| `leaf-transform`        | 5.55    | 2.78    | -6%      | 8.46     | 3.04     | -2%       |
| `struct-check`          | 5.58    | 2.93    | -1%      | 8.23     | 3.08     | -1%       |
| `declaration`           | 5.95    | 3.19    | +8%      | 8.38     | 3.86     | +25%      |
| `union`                 | 5.78    | 3.20    | +8%      | 8.64     | 3.12     | +1%       |
| `leaf-transform-effect` | 5.52    | 3.30    | +11%     | 7.96     | 3.70     | +19%      |
| `leaf-check`            | 6.42    | 3.77    | +27%     | 8.46     | 3.51     | +13%      |

The ceiling is visible in the `strings-*` rows. With no transform anywhere (`strings-base`), the JIT reaches 0.50 ms on Bun and 0.71 ms on Node, 8 times faster than the interpreter. With one transform it falls to 1.1 to 1.5 ms. The bank codec's typed leaves (`base`) sit at 3 ms. Lifting that ceiling needs Effect to keep the fast path through inline-able encodings. That is an upstream question, not something this library can do.

## Q6: JIT policy

### Speed (median of 3 process medians, ms; range in brackets)

| Runtime | Variant        | off            | global         | per-AST        | per-AST / off |
| ------- | -------------- | -------------- | -------------- | -------------- | ------------- |
| Bun     | `base`         | 5.58 [5.4-5.8] | 3.08 [2.8-3.2] | 2.96 [2.8-3.4] | 1.89x         |
| Bun     | `union`        | 5.78 [5.7-6.0] | 3.56 [3.3-3.6] | 3.20 [3.2-3.2] | 1.81x         |
| Bun     | `strings-base` | 3.98 [3.9-4.4] | 0.45 [0.4-0.6] | 0.50 [0.4-0.5] | 7.96x         |
| Node    | `base`         | 7.91 [7.8-8.1] | 2.80 [2.7-3.0] | 3.10 [2.9-3.2] | 2.55x         |
| Node    | `union`        | 8.64 [8.6-8.8] | 3.18 [3.1-3.5] | 3.12 [3.0-3.2] | 2.77x         |
| Node    | `strings-base` | 5.64 [5.4-5.7] | 0.79 [0.7-0.8] | 0.71 [0.7-0.7] | 7.94x         |

Global and per-AST are equal within noise on every variant (full matrix below). They compile the same nodes: 10 functions for `base` in both.

- **Cold first decode** (`base`, compile included): Bun 13.5 ms off, 9.4 global, 10.9 per-AST. Node 14.4 off, 10.5 global, 10.2 per-AST. Compilation pays for itself within the first call at this size.
- **The `enable(ast)` call itself:** 0.13 to 0.30 ms. It generates no code; generation happens on first use.
- **Through the Effect entry point** (`API=effect`, `Effect.runSync(Schema.decodeUnknownEffect(codec)(input))`, one run each), `base` goes from 8.2 to 4.3 ms on Bun and from 10.7 to 3.4 ms on Node.
- **Parse options matter.** `onExcessProperty: "error"` makes the compiled object loop fall back to the interpreter. `base` under per-AST JIT then takes 11.7 ms on Bun and 15.9 ms on Node, against 3.35 and 3.14 with default options. `errors: "all"` gives 7.1 and 7.0 ms. If the structural codec needs exactness, use an `encodingChecks` filter as computis's `exact-decoder.js` does, not `onExcessProperty`. Callers already pass `errors: "all"` through the library; that path keeps only part of the gain.

### Side effects (`sidefx.ts`, `adapters.ts`; Bun and Node agree)

**Global import (`effect/schema/SchemaJITCompiler/enable`)**

- It installs a process-wide compiler. Every AST resolved afterwards is JIT-compiled, including schemas the application never gives the library: an unrelated `Struct` generated a function on first use.
- It flips the registry's process-wide `compilerAdaptersEnabled`.
- It calls `new Function` (a probe, then one call per compiled operation) for every schema in the process.
- It must run before first use and cannot be undone.
- If the library did it, importing the library would become side-effectful (tree-shaking, `sideEffects`). Only the application should make this choice.

**Per-AST `SchemaJITCompiler.enable(ast)`**

- Unrelated schemas are untouched: 0 functions generated for an unrelated `Struct`.
- It flips `compilerAdaptersEnabled` process-wide. Measured on a never-enabled interpreted codec, there is no effect: Bun 5.57, 5.91 and 5.47 ms without the flip against 5.31, 5.47 and 5.43 with it; Node 7.65, 7.79 and 7.47 against 7.84, 8.34 and 7.56 (noise, at most about 3%).
- The generated entries live in the shared, global, AST-keyed registry, and they cover every descendant AST, including user leaf ASTs reachable from the codec. `Schema.toCodecStringTree(userLeaf).ast === userLeaf.ast` for a `String`-typed leaf (verified). After the library decodes, the application's own standalone `Schema.decodeUnknownSync(userLeaf)` runs the JIT entry. The JIT is trusted to preserve semantics, so this is a performance and eval-call side effect, not a behavioral one.
- It calls `new Function` lazily for those ASTs. Under CSP, the one failed probe happens on the first compile attempt.
- **Idempotent in behavior, not in cost.** A second `enable` on the same AST replaces the root entry: one function is regenerated on next use; children are reused. Decoders captured earlier keep the old entry and stay correct. 1,000 repeated calls take 0.8 to 1.5 ms and still cause just one root regeneration. Memoize per AST (a `WeakSet`) to avoid even that.
- **Safe at codec construction.** No code runs until the first decode. A decoder created before `enable` still picks up the compiled entry if its first decode comes after the call: 9 functions generated on that decoder's first call.
- Encode needs the flipped AST enabled separately (`SchemaAST.flip(ast)`), as computis does. That belongs to the encode spike.

**Documented opt-in (no library call)**

- No library side effects.
- Users get the JIT only by importing the global module, with all of its side effects. They cannot target the library's internal structural AST themselves, because it is not exposed.
- Everyone else pays 1.9 to 2.8 times on the Schema step.

### Recommendation

Use per-AST `SchemaJITCompiler.enable` on the structural decode AST, and on its flipped AST for encode. Call it once per codec when the codec's decoder is first built, memoized in a `WeakSet`, and on by default.

- **Speed.** It gives the same speed as the global import.
- **Scope.** It touches no unrelated schema, and it adds no import-time side effect.
- **No-eval.** It degrades to the interpreter without errors where eval is blocked (Q7).
- **Precedent.** It matches the reference design's default.

Two items need the owner:

1. An opt-out such as computis's `jit: false` would be a public API addition. Do not add it in phase 3 without approval.
2. `SchemaJITCompiler` is marked `@stability unstable` in Effect 4.1.2. The call sits behind one internal helper so an upstream change touches one place.

## Q7: no-eval environments and AOT

### Interpreter fallback

Code generation is blocked by the Bun stub, and on Node by `--disallow-code-generation-from-strings`. For both `noeval-global` and `noeval-ast`, the counter shows exactly 1 eval attempt (the `Function("return true")` support probe) and 0 compiled functions. `compiler` caches `supported = false` until `globalThis.Function` changes identity, and returns `undefined` for every AST, so every node is interpreted. The output fingerprint equals every other mode.

| `base`, median ms | off  | noeval-global | noeval-ast |
| ----------------- | ---- | ------------- | ---------- |
| Bun               | 5.58 | 5.41          | 5.46       |
| Node              | 7.91 | 7.93          | 7.81       |

No-eval mode is the interpreter, at no extra cost. On the builder spike's real structural codec it is about 13 to 14 ms, against about 70 ms for today's Schema layer (`builder.md`), so most of phase 3's gain survives without the JIT.

### `SchemaAOTCompiler`

- **What it emits.** `SchemaAOTCompiler.compile(targets)` returns the source of an ES module. The module imports `effect/schema/SchemaCompiler/runtime` and exports `install(asts)`. It contains one static factory per compiled node, registered with `runtime.setCompiler`, and no `new Function` (verified: 0 occurrences in every generated module).
  - Generation takes 0.1 to 1 ms per codec. The modules are 10.7 to 14.1 KB here.
  - `SchemaAOTCompiler/Build.build` wraps this as a build step. It loads modules, takes their directly exported Schema values, follows `encoding` links, and writes a self-installing module.
- **How it is used.** It is a build-time step. The generated module is committed or emitted, then imported at startup. `install` must receive the runtime ASTs in the same order and with the same structure as at build time. Path-based references (`asts[0].propertySignatures[0].type...`) are resolved against them. It must be regenerated after any schema or Effect change.
- **Speed.** As requested (`operations: ["decode"]` on the root), AOT emits the fast `decode` only for the root. Children are visited for `decodeEffect` only, so nested fast paths such as `rules` are missing:

| median ms                | Bun off | Bun JIT | Bun AOT (root) | Bun AOT (root), no-eval | Node off | Node JIT | Node AOT (root) | Node AOT (root), no-eval |
| ------------------------ | ------- | ------- | -------------- | ----------------------- | -------- | -------- | --------------- | ------------------------ |
| `base`                   | 5.58    | 2.96    | 4.91           | 5.02                    | 7.91     | 3.10     | 4.23            | 4.09                     |
| `strings-base`           | 3.98    | 0.50    | 0.48           | 0.51                    | 5.64     | 0.71     | 0.68            | 0.71                     |
| `strings-leaf-transform` | 4.31    | 1.11    | 4.31           | 4.17                    | 6.35     | 1.22     | 3.07            | 2.81                     |

Passing every `Objects`, `Arrays` and `Union` node as its own `decode` target (`aot-deep.ts`, 11 targets for `base`) closes the gap in no-eval mode. Three runs each: `base` 3.23, 3.59 and 3.54 ms on Bun (stub) and 2.95, 3.40 and 3.36 ms on Node (V8 flag); `strings-leaf-transform` 0.93 to 1.08 on Bun and 0.93 to 1.29 on Node. That is JIT parity.

- **Fit for this library: not today.**
  1. Codecs are derived at runtime from user declarations, so the library cannot ship generated modules.
  2. Users cannot generate them either. `Build` compiles only directly exported Schema values and their `encoding` chains. The structural codec is an internal AST that the public `XmlSchema.Element` codec does not reach through its AST, and its identity must match at install time.
  3. Making AOT possible would need a new public hook, for example one that returns a codec's structural ASTs in a deterministic order, plus a documented user build step. That is an owner decision.

  Since no-eval mode already keeps most of the phase 3 gain through the interpreter, record AOT as a possible later opt-in for Workers and CSP users, not phase 3 work.

## Current-design baseline (context)

`work/jit-probe/probe.ts` was gone from the shared tree when this spike ran, so a copy is at `work/spikes/perf3-jit/probe.ts`. It measures full typed decode of `bank-4m` through `XmlSchema.fromString(ItemBank)`, median of 15, under 1-minute load of 24 to 57:

- Bun: 132.3 ms off, 106.6 ms with the global JIT.
- Node: 147.4 ms off, 128.4 ms with the global JIT.

The brief's 226 and 191 ms came from an earlier run under different conditions. The ratio, about 15 to 20 percent from the JIT, is the same.

## Not measured, and why

- **The builder, tokenizer and end-to-end typed decode on the new design.** These belong to the builder spike (`builder.md`). This spike isolates the Schema step on a plain object.
- **Encode, and JIT of the flipped AST.** These belong to the encode spike. The policy above carries over: enable the flipped AST.
- **Real Cloudflare Workers, Deno, and browsers under CSP.** No such runtime was available. Workers uses V8 with the same code-generation switch that the Node runs used. A browser with a CSP `report-uri` would also send one violation report for the failed probe; that was not verified.
- **Memory, RSS, GC and allocation rate of generated code.** Not instrumented. The matrix shows only time.
- **Scaling across input sizes.** Only the `bank-4m` record count was used. Cold-call numbers show that compilation amortizes within the first call at this size. It was not measured on small records, such as `bank-16k` or per-record streaming decode.
- **Error-path decode speed.** Only "an invalid input lazily compiles the detailed decoders" was observed (introspection). The error path was not timed.
- **An idle machine.** The machine was not available idle (load 15 to 57). The 3-repetition medians and ranges are given instead.

## Open questions

1. Owner: is a `jit: false`-style opt-out wanted as public API, or is the default per-AST enable enough?
2. Owner: is AOT support for no-eval users wanted later? It needs a public hook that exposes structural ASTs.
3. Upstream: should Effect emit the synchronous fast path through inline-able leaf encodings (`toCodecStringTree(Boolean | Finite)`)? On this shape that is worth up to 6 times under the JIT (2.96 ms against 0.50 ms for `strings-base`). It is a candidate feature request after the owner's review, not filed.
4. Design: if the structural codec must reject undeclared keys, use an `encodingChecks` filter (computis's approach), not `onExcessProperty`, which disables the compiled object loop.

## Full matrix

Median of 3 process medians, in ms. Each process ran 21 timed calls after 5 warm-up calls, with 10,442 records. The range of the 3 runs is in brackets.

### Bun 1.4.2

| variant                       | off            | global         | ast            | noeval-global  | noeval-ast     | aot             | aot-noeval      | ast/off |
| ----------------------------- | -------------- | -------------- | -------------- | -------------- | -------------- | --------------- | --------------- | ------- |
| base                          | 5.58 [5.4-5.8] | 3.08 [2.8-3.2] | 2.96 [2.8-3.4] | 5.41 [5.0-5.4] | 5.46 [5.4-6.6] | 4.91 [4.8-5.0]  | 5.02 [4.9-5.1]  | 1.89x   |
| union                         | 5.78 [5.7-6.0] | 3.56 [3.3-3.6] | 3.20 [3.2-3.2] | 5.63 [5.5-5.9] | 5.88 [5.7-6.8] | 5.72 [5.5-9.1]  | 7.78 [5.5-14.0] | 1.81x   |
| leaf-check                    | 6.42 [6.1-7.2] | 3.87 [3.4-4.8] | 3.77 [3.5-5.8] | 5.89 [5.6-6.7] | 6.06 [5.7-6.3] | 5.37 [5.2-5.5]  | 5.25 [5.1-6.0]  | 1.70x   |
| leaf-transform                | 5.55 [5.4-5.6] | 2.93 [2.8-3.1] | 2.78 [2.7-3.0] | 5.39 [5.3-5.5] | 5.45 [5.4-6.7] | 5.12 [4.9-5.5]  | 4.82 [4.8-4.9]  | 2.00x   |
| leaf-transform-effect         | 5.52 [5.4-5.7] | 3.45 [3.2-3.8] | 3.30 [3.2-4.5] | 5.43 [5.0-8.1] | 5.41 [5.3-7.2] | 5.28 [5.1-7.6]  | 5.19 [5.1-8.7]  | 1.67x   |
| struct-check                  | 5.58 [5.4-7.3] | 3.11 [2.8-5.2] | 2.93 [2.8-4.6] | 5.55 [5.4-9.3] | 6.20 [5.4-7.0] | 5.09 [5.1-5.3]  | 5.24 [5.0-5.3]  | 1.90x   |
| declaration                   | 5.95 [5.8-6.3] | 3.58 [3.5-3.6] | 3.19 [3.2-3.4] | 5.94 [5.9-6.0] | 5.92 [5.8-6.4] | 5.37 [5.3-5.6]  | 5.63 [5.4-5.7]  | 1.87x   |
| strings-base                  | 3.98 [3.9-4.4] | 0.45 [0.4-0.6] | 0.50 [0.4-0.5] | 3.80 [3.6-5.5] | 3.64 [3.6-4.2] | 0.48 [0.5-0.8]  | 0.51 [0.4-0.5]  | 7.96x   |
| strings-leaf-check            | 4.40 [4.3-5.5] | 0.77 [0.7-0.9] | 0.75 [0.7-1.0] | 4.00 [4.0-5.8] | 4.54 [4.3-5.1] | 0.74 [0.7-0.9]  | 0.77 [0.8-1.2]  | 5.87x   |
| strings-leaf-transform        | 4.31 [4.3-6.5] | 0.85 [0.8-1.2] | 1.11 [1.0-1.3] | 4.19 [4.2-6.8] | 4.90 [4.1-5.0] | 4.31 [3.5-17.9] | 4.17 [4.0-25.2] | 3.88x   |
| strings-leaf-transform-effect | 4.83 [4.5-7.6] | 1.25 [1.1-1.3] | 1.18 [1.1-1.4] | 4.47 [3.9-4.8] | 4.65 [4.3-4.9] | 4.18 [4.2-5.0]  | 4.54 [3.9-5.0]  | 4.09x   |
| strings-struct-check          | 4.37 [4.3-4.5] | 0.55 [0.6-0.6] | 0.56 [0.6-0.7] | 4.13 [4.0-4.5] | 4.97 [3.8-5.0] | 0.59 [0.6-0.6]  | 0.70 [0.5-0.8]  | 7.80x   |
| strings-declaration           | 4.87 [4.5-7.9] | 1.31 [1.3-2.1] | 1.38 [1.1-1.4] | 4.95 [4.6-7.6] | 4.60 [3.7-7.8] | 5.41 [4.2-6.5]  | 4.42 [4.2-8.2]  | 3.53x   |

### Node v26.13.0

| variant                       | off             | global         | ast            | noeval-global   | noeval-ast      | aot             | aot-noeval     | ast/off |
| ----------------------------- | --------------- | -------------- | -------------- | --------------- | --------------- | --------------- | -------------- | ------- |
| base                          | 7.91 [7.8-8.1]  | 2.80 [2.7-3.0] | 3.10 [2.9-3.2] | 7.93 [7.7-8.1]  | 7.81 [7.7-8.4]  | 4.23 [4.1-4.4]  | 4.09 [4.1-4.2] | 2.55x   |
| union                         | 8.64 [8.6-8.8]  | 3.18 [3.1-3.5] | 3.12 [3.0-3.2] | 8.50 [8.1-9.8]  | 8.55 [8.4-15.2] | 4.82 [4.6-10.3] | 5.06 [4.9-6.4] | 2.77x   |
| leaf-check                    | 8.46 [8.2-10.7] | 3.54 [3.4-5.6] | 3.51 [3.4-4.3] | 8.19 [8.1-8.3]  | 8.45 [8.4-8.7]  | 4.89 [4.7-5.0]  | 4.69 [4.7-5.0] | 2.41x   |
| leaf-transform                | 8.46 [8.3-8.6]  | 2.98 [2.8-3.1] | 3.04 [2.9-3.1] | 8.21 [8.0-8.3]  | 8.13 [7.9-8.2]  | 4.16 [4.1-4.3]  | 4.25 [3.9-4.3] | 2.78x   |
| leaf-transform-effect         | 7.96 [7.9-8.6]  | 3.69 [3.4-4.0] | 3.70 [3.6-4.9] | 8.00 [7.6-11.9] | 8.09 [7.7-16.6] | 5.08 [4.9-8.8]  | 5.08 [5.0-9.7] | 2.15x   |
| struct-check                  | 8.23 [8.1-15.1] | 3.44 [3.3-4.6] | 3.08 [3.1-4.0] | 8.31 [7.6-10.5] | 8.25 [8.2-8.4]  | 4.33 [4.2-4.4]  | 4.50 [4.4-4.7] | 2.67x   |
| declaration                   | 8.38 [8.3-8.4]  | 3.70 [3.6-4.0] | 3.86 [3.7-4.0] | 8.18 [7.9-8.5]  | 8.13 [8.1-8.3]  | 4.87 [4.9-5.0]  | 5.00 [4.9-5.2] | 2.17x   |
| strings-base                  | 5.64 [5.4-5.7]  | 0.79 [0.7-0.8] | 0.71 [0.7-0.7] | 5.91 [5.6-6.0]  | 5.48 [5.5-5.6]  | 0.68 [0.6-1.1]  | 0.71 [0.7-0.8] | 7.94x   |
| strings-leaf-check            | 6.01 [5.7-18.6] | 1.11 [1.0-1.3] | 0.95 [0.9-1.5] | 6.13 [5.9-12.1] | 5.93 [5.7-8.3]  | 1.00 [1.0-1.3]  | 1.07 [0.9-1.4] | 6.33x   |
| strings-leaf-transform        | 6.35 [6.3-9.6]  | 1.10 [1.1-1.5] | 1.22 [1.2-1.3] | 6.30 [6.1-8.5]  | 6.67 [6.5-8.7]  | 3.07 [3.0-5.7]  | 2.81 [2.8-5.8] | 5.20x   |
| strings-leaf-transform-effect | 6.52 [6.3-29.3] | 1.40 [1.4-2.4] | 1.51 [1.4-2.4] | 6.50 [6.3-12.4] | 6.49 [6.3-9.2]  | 3.43 [3.4-3.6]  | 3.49 [3.4-3.5] | 4.32x   |
| strings-struct-check          | 5.92 [5.6-6.2]  | 0.77 [0.8-0.8] | 0.80 [0.7-0.9] | 6.49 [5.4-7.0]  | 6.58 [5.6-10.9] | 0.81 [0.8-0.8]  | 0.76 [0.7-0.9] | 7.40x   |
| strings-declaration           | 6.80 [6.0-9.9]  | 1.60 [1.2-2.0] | 1.52 [1.4-1.9] | 7.41 [5.8-10.2] | 6.85 [6.0-10.9] | 3.70 [3.4-6.0]  | 3.51 [3.3-3.8] | 4.47x   |
