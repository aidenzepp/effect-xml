# Spike perf3-sp-encode: one structural Schema encode plus a plan-driven writer

Unit `perf3-sp-encode`, phase 3 brief Step 1 item 3. This is an R&D spike. The prototype lives in `work/spikes/perf3-encode/` (gitignored); this file is the durable record.

## Result

The prototype encodes `bank-4m` 5.6 to 10 times faster than the current encoder: 8 to 10 times on Bun, 5.6 to 9.6 times on Node. Its output is byte-identical to the current encoder's output on every input tried. Build it.

| bank-4m, median ms                                                    | Bun, JIT off | Bun, JIT per AST | Node, JIT off | Node, JIT per AST |
| --------------------------------------------------------------------- | ------------ | ---------------- | ------------- | ----------------- |
| Current `fromString` encode                                           | 152.4        | 160.1            | 164.2         | 146.6             |
| Prototype, Schema encode plus text writer                             | 19.0         | 15.7             | 29.4          | 16.6              |
| Prototype, Schema encode plus events plus upstream `Xml.encodeString` | 21.0         | 14.7             | 27.4          | 24.6              |

## What was built

1. **Structural codec.** `structural(def)` walks the Plan from `planOf(def)` and builds one `Schema.Struct` per element. Attribute and `text` slots use `Schema.toCodecStringTree(leaf)`, the same leaf codecs `compile` uses. An `elements` slot nests the child's Struct, wrapped in `Schema.Array` for `many` and `Schema.optionalKey` for `optional`. A cache keyed by element codec, seeded with a `Schema.suspend` placeholder, handles recursion. Encoding the typed value gives a plain object such as `{ "max-choices": "1", choices: [{ identifier: "A", $text: "First" }] }`.
2. **Plan-driven writer.** `compileWriter(def)` precomputes each element's spelled name, `xmlns` declarations, attribute prefixes, and close tag once per (plan, in-scope bindings). It ports the `prefixFor`, `spell`, and `declarationFor` rules from `src/resolve.ts` unchanged. The hot loop is plain JavaScript with no Schema and no Effect. It has two outputs:
   - `toText`: XML text directly, escaping as upstream's `Writer` does: text escapes `&<>\r`; attributes escape `&<"\t\n\r`; empty elements are written `<a></a>`.
   - `toEvents`: the same `Xml.Event[]` the current `toEvents` produces, for any `Tokenizer.encodeString`.
3. **Illegal characters.** Element and attribute names are static and checked when the plan is built, so only values can hold a character outside the XML 1.0 `Char` production. `toText` runs one regex over the finished output: `/[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u`, whose `u` flag also catches lone surrogates. On a hit it returns no text; the intended design then reruns the current encoder for the exact error.

Scope: empty, `text`, and closed `elements` content. Not prototyped: `mixed`, open content, `data-*`, and namespaced attributes. See "Not measured".

## Equivalence

| Input                                                        | Byte-identical to current | Equivalent (`XmlSchema.equivalence`) | Events identical (`JSON.stringify`) | Decodes back to the same value |
| ------------------------------------------------------------ | ------------------------- | ------------------------------------ | ----------------------------------- | ------------------------------ |
| bank-16k, Bun and Node, JIT off and per AST                  | yes                       | yes                                  | yes                                 | yes                            |
| bank-4m, Bun and Node, JIT off, per AST, global, and no-eval | yes                       | yes                                  | yes                                 | yes                            |
| README `ChoiceInteraction` value                             | yes                       | yes                                  | n/a                                 | n/a                            |
| README with the optional `prompt` absent                     | yes                       | yes                                  | n/a                                 | n/a                            |
| README with an empty `$text`                                 | yes                       | yes                                  | n/a                                 | n/a                            |
| README with `"&<>\t\n\r'` in an attribute and in text        | yes                       | yes                                  | n/a                                 | n/a                            |
| README with an astral character (U+1F600)                    | yes                       | yes                                  | n/a                                 | n/a                            |

There are no byte differences. Each point the task asked about matches:

- **Attribute order:** both follow `plan.attributes` order, which is the authored key order. Lint keeps it alphabetical.
- **Namespace declarations:** the root declares the prefix map first, then its attributes.
- **Whitespace:** neither encoder writes any.
- **Escaping:** the same entity set, including `&#13;`, `&#9;`, and `&#10;`.

For an illegal character, U+0000 in an attribute and a lone U+D800 in text, the current encoder fails and the prototype refuses. Matching the error message and path through a fallback was not run (see below).

## Timing

Method:

- **Machine:** Apple M4 Pro, 14 cores, 48 GB, macOS (Darwin 27.2.0).
- **Runtimes:** Bun 1.4.2 and Node v26.13.0 (type stripping). `effect` 4.1.2. Code base `main` at `a7a93d5`.
- **Load:** a shared machine with other seats running. `uptime` 1-minute load average was 3.3 to 4.3 during the bank-4m runs and rose to 12.1 after them, during the bank-16k equivalence runs, which are not timed.
- **Input:** `bank-4m` from `bench/inputs/synthetic.ts`: 4,194,472 bytes in, 4,048,281 bytes out. The typed value is decoded once with `XmlSchema.fromString(ItemBank, { maxElementNodes: Infinity, maxElementSize: Infinity })`.
- **Iterations:** for each operation, 3 warm-up runs, then 15 timed runs with `performance.now()`. Each run is a separate process per (runtime, mode).
- **README:** 2,000 warm-up calls, then 15 batches of about 1,333 calls. The figure is the median batch's µs per op.
- **JIT modes:**
  - `off`: the interpreter.
  - `ast`: `SchemaJITCompiler.enable(SchemaAST.flip(ast))` on the prototype's structural AST, on `ItemBank`, and on the `fromString` codec. Encode parses the flipped AST, so enabling only the type-side AST does nothing for encode.
  - `global`: `import "effect/schema/SchemaJITCompiler/enable"` first.
  - `noeval`: `globalThis.Function` replaced with a throwing constructor, then per-AST enable. This simulates Workers or a strict CSP.

### bank-4m split, median ms (min to p90 in the raw logs)

| Step                                                  | Bun off | Bun ast | Bun global | Bun noeval | Node off | Node ast | Node global | Node noeval |
| ----------------------------------------------------- | ------- | ------- | ---------- | ---------- | -------- | -------- | ----------- | ----------- |
| Current total                                         | 152.4   | 160.1   | 162.6      | 157.4      | 164.2    | 146.6    | 146.6       | 164.9       |
| Current Schema (`ItemBank` to `ResolvedElement`)      | 82.8    | 88.3    | 88.9       | 85.3       | 100.6    | 94.4     | 88.5        | 102.2       |
| Current writer (`toEvents` plus `Xml.encodeString`)   | 58.9    | 69.0    | 69.0       | 60.7       | 52.7     | 52.8     | 54.6        | 52.1        |
| Prototype total, text                                 | 19.0    | 15.7    | 14.1       | 19.9       | 29.4     | 16.6     | 15.3        | 29.6        |
| Prototype total, events plus upstream writer          | 21.0    | 14.7    | 13.7       | 20.2       | 27.4     | 24.6     | 22.3        | 28.4        |
| Prototype Schema (structural encode)                  | 8.2     | 4.8     | 4.5        | 8.6        | 10.8     | 5.2      | 3.6         | 11.0        |
| Prototype writer, `toText`, string concatenation      | 12.6    | 10.1    | 10.0       | 11.2       | 16.9     | 16.7     | 16.7        | 16.8        |
| Prototype writer, `toText`, `parts.push` plus `join`  |         |         |            | 10.5       |          |          |             | 10.5        |
| Prototype writer, `toEvents` only                     | 3.3     | 1.8     | 1.9        | 3.0        | 3.5      | 3.3      | 3.4         | 3.4         |
| Upstream `Xml.encodeString` of the prototype's events | 7.3     | 6.9     | 6.6        | 6.5        | 11.6     | 11.6     | 10.8        | 11.4        |

Notes on reading the table:

- The prototype totals are not the sum of their steps. A whole run includes GC and string flattening that the isolated steps move around. Read the totals as the end-to-end figure.
- In the `noeval` run on Bun, `toText` took 5.5 ms without the illegal-character regex and 11.2 ms with it. The regex alone on an already flat string takes 1.1 ms. Most of the difference is flattening the concatenated rope, which a caller pays anyway when it reads the string. `parts.push` plus `join` (computis's shape) avoids that and is 1.6 times faster on Node (10.5 against 16.8 ms). Use it.
- In the current design the writer half, about 55 ms, is not the upstream `Writer`: on the same events that takes 7 to 12 ms. The cost is the current `toEvents` walk. It redoes `parseClark`, `declarationFor`, `spell`, and four object spreads for every element, all of which are static per plan. Precomputing them is most of the writer win, even with the upstream writer and the `Tokenizer` seam kept.

### README example, median µs per op

|                                                                            | Bun off | Bun ast | Node off | Node ast |
| -------------------------------------------------------------------------- | ------- | ------- | -------- | -------- |
| Current `fromString` encode                                                | 16.95   | 16.24   | 22.59    | 21.42    |
| Prototype, Schema encode plus text writer, bare                            | 0.87    | 0.61    | 1.19     | 0.85     |
| Prototype inside `Effect.fn("xml.encodeString")` plus `runSync`            | 2.23    |         | 2.95     |          |
| Prototype behind a `fromString`-shaped codec (`transformEffect` plus span) | 2.73    |         | 3.99     |          |

On a small document the fixed Effect cost, the span plus the `transformEffect` hop, is most of the remaining time. It is still about 6 times faster than today (5.7 on Node, 6.2 on Bun).

## JIT findings for encode

- **Current design: the JIT does nothing for encode.** Per AST it made no measurable difference: Bun 152 to 160 ms, inside noise; Node 164 to 147 ms. Each element is a `transformEffect`, which is opaque to the JIT, and the writer half is plain code.
- **Structural codec: the JIT halves the Schema step.** Bun went from 8.2 to 4.8 ms and Node from 10.8 to 5.2 ms per AST. Global enabling gains little more: 4.5 and 3.6 ms. So **per-AST `enable(SchemaAST.flip(structural.ast))` captures most of the gain** without the process-wide side effect. Decode needs its own `enable` on the non-flipped AST.
- **No-eval fallback costs nothing.** With `Function` blocked, `enable` silently keeps the interpreter, and the timings match `off`: Bun 19.9 against 19.0 ms, Node 29.6 against 29.4 ms. In that environment the prototype is still 7.9 times faster on Bun and 5.6 times faster on Node than today.

## Not measured, and why

- **SchemaAOTCompiler.** The no-eval alternative is the JIT spike's unit (`perf3-sp-jit`), not this one.
- **A user custom transformation or check inside a leaf, and how the JIT treats it.** Also the JIT spike's open question. Both vocabularies use only built-in leaves: String, Finite, Boolean, Int.
- **`mixed`, open `elements` and open `mixed`, `data-*`, recursive (`suspend`) plans, namespaced attributes, and elements outside the root's prefix map.** No such construct appears in `ItemBank` or the README example. The prefix and declaration logic is ported line for line, and the recursion cache is written but not exercised. The differential suite must cover each of these before the fast path claims them.
- **Error parity.** No error was produced through the new path. The prototype only shows that it refuses the illegal-character cases the current encoder rejects. The issue paths from the structural codec (for example `["rules", 3, "match", "variable", "identifier"]`) were not translated to XML paths.
- **Memory.** RSS, heap, allocation rate, GC counts, and percentiles beyond p90 were not recorded. A spike-sized decision did not need them, and the brief's full metric list belongs to the slice that ships, measured with `bench/run.ts`.
- **bank-64m and the QTI corpus.** These were not run. bank-16k and bank-4m were the inputs the task set.
- **Streaming encode.** There is no streaming encode surface today. Only whole-document `fromString` encode was measured.

## Recommendation

Build the encode mirror this way:

1. **One structural codec per `fromString(def)`, derived from the Plan, built lazily once.**
   - Leaves use `toCodecStringTree`, the same calls `compile` makes.
   - Use it only inside `fromString`'s encode. `XmlSchema.Element` still returns today's per-element codec, so R1 and R2 and every derivation (JSON Schema and the rest) are unchanged.
   - Fall back to today's path for any slot whose schema is not exactly a compiled element codec, for example an element codec the user wrapped in `decodeTo`. `planOf` finds the marker through that wrapper, so a naive structural codec would drop the user's transformation.
2. **Writer:** `parts.push` plus `join`, with names, declarations, and attribute prefixes compiled once per (plan, scope). Run one illegal-character regex over the output.
   - **Default tokenizer:** when `Tokenizer` is `defaultTokenizer` (identity check), write text directly.
   - **Any other tokenizer:** emit `toEvents` into `tokenizer.encodeString()`. That keeps the R9 seam, and the events are identical, so a custom writer sees exactly what it sees today. This path is still 5.8 to 10.9 times faster than today on bank-4m.
3. **Errors by fallback, not by translation.** When the structural encode fails, when a leaf's encoded value is not a string, or when the output holds an illegal character, rerun the current per-element encoder on the same value and return its error. Errors then match the differential suite by construction, and only the failure path pays.
   - Caveat for the hater pass: a user leaf with an effectful or nondeterministic encode runs twice on failure. That leaf also needs the same `EncodingServices`.
4. **JIT policy for encode: per-AST, on the flipped structural AST, when the codec is built.** That is `SchemaJITCompiler.enable(SchemaAST.flip(structural.ast))`. Nothing global. The measurements show it gets 78 to 92% of the global gain on the Schema step, and it silently degrades to the interpreter where `Function` is blocked, at no cost.
5. **Keep the guard in the hot loop.** Add a `typeof value === "string"` guard per attribute and text value. Today's `encodeElement` checks this, and `toCodecStringTree` of a declared schema without a string tree may not guarantee it. A non-string value takes the fallback in step 3.

## Open questions for the Mind

- Should the fast path apply to `XmlSchema.Element` used directly, through `Schema.encodeSync(Element)` into a `ResolvedElement`? That would need the structural encode plus a tree builder. It was not measured, and it changes nothing for `fromString`.
- Is running the user's leaf encoders twice on a failed encode acceptable, or should failures translate structural issue paths instead? Translation is the only option if a leaf's encode has side effects.
- Should direct text be gated by the identity of `defaultTokenizer`, or by a new capability flag on `Tokenizer`? A flag would be a public API change and needs the owner.
