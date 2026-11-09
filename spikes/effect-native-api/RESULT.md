# Effect-native API shapes (spike)

Throwaway R&D for task `9c741330`. Source: `work/owner-directive-effect-native-api.md` Method step 4, open questions Q1-Q5 in `work/effect-native/comparison.md` section 3, and `work/effect-native/hater-a.md` and `hater-b.md`. Nothing here changes `src/`. Every file imports `../../src` directly.

- Baseline: repo HEAD `6fec427`, `effect` 4.1.2, Bun 1.4.2.
- Inputs: the README example (the `readme:start` region of `test/readme.test.ts`, copied into `shared.ts` because that file imports vitest), and `spikes/fixtures/qti/bg007-true-false.xml` with `AssessmentItem` from `test/qti/vocabulary.ts`.
- Type check: `bun x tsc -p spikes/effect-native-api/tsconfig.json` passes with no errors. The walls that are expected are pinned with `@ts-expect-error`, which fails the check if the error goes away.
- Run: `bun run spikes/effect-native-api/<file>.ts`. All of these exit 0: `q1-text-codec.ts`, `q2-namespace.ts`, `q3-channel.ts`, `q4-rebuild.ts`, `q5-equivalence.ts`, `treeshake-flat.ts`, `treeshake-namespace.ts`.

| File                                                                     | Role                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `shared.ts`                                                              | README definitions, the bg007 text, and a tracer that records span names |
| `text-codec.ts` / `q1-text-codec.ts`                                     | Q1 library / runs                                                        |
| `q4-rebuild.ts`                                                          | Q4 type-level carriers and the runtime marker walk                       |
| `xml-schema.ts`, `index-variant.ts`, `q2-namespace.ts`, `treeshake-*.ts` | Q2                                                                       |
| `channel.ts` / `q3-channel.ts`                                           | Q3 library / runs                                                        |
| `q5-equivalence-lib.ts` / `q5-equivalence.ts`                            | Q5 library / runs                                                        |

## Q1. A Schema-first text codec, `Codec<T, string>`

Two carriers were built on the `Schema.fromJsonString` pattern (`Schema.ts:9875`, `String.pipe(decodeTo(schema, transformation))`):

- **B, whole pipeline** (`XmlString(def)`): one `SchemaTransformation.transformEffect<T, string>` calls today's `decodeString(def)` and `encodeString(def)`. It stores the `XmlDecodeError` or `XmlEncodeError` on the issue as `new SchemaIssue.InvalidValue({ message: error.message, xml: error })`. `Annotations.Issue` has an open index signature (`Schema.ts:19115`, `:19537`), so the stored error is typed data, not a cast.
- **A, layered** (`XmlStringLayered(def)`): a string-to-`ResolvedElement` codec (wrapping `decodeTree`), then `Schema.decodeTo(def)`.

Before and after, for the consumer:

```ts
// today
const value = Effect.runSync(decodeString(ChoiceInteraction)(xml));
const text = Effect.runSync(encodeString(ChoiceInteraction)(value));
// after (B)
const Document = XmlString(ChoiceInteraction);
const value = Schema.decodeUnknownSync(Document)(xml); // or decodeUnknownEffect / Exit
const text = Schema.encodeSync(Document)(value);
const Row = Schema.Struct({ id: Schema.String, item: XmlString(AssessmentItem) }); // composes
```

What survives (runtime output from `q1-text-codec.ts`):

| Measure                                | Today `decodeString`                   | B (whole)                                                                                                                                                        | A (layered)                                                                                  |
| -------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| README and bg007 decode equal to today | yes                                    | yes (`decodeUnknownSync` and `decodeUnknownEffect`)                                                                                                              | yes                                                                                          |
| Encode                                 | yes                                    | `Schema.encodeSync` gives the same text                                                                                                                          | same text                                                                                    |
| XPath in the message                   | `/qti-choice-interaction/@max-choices` | identical message                                                                                                                                                | lost: `Expected a string representing a finite number at ["max-choices"]` (value-space path) |
| line/column                            | `(line 1, column 1)`                   | identical                                                                                                                                                        | lost for Schema failures; kept for malformed text                                            |
| Reason union                           | typed `XmlDecodeError`                 | a `SchemaError` in the error channel; the full `XmlDecodeError` (path, position, reason) is recovered by walking `error.issue` to `annotations.xml` (`findXml`)  | none for Schema failures                                                                     |
| Inside `Schema.Struct`                 | n/a                                    | `... (line 2, column 1): Expected "true" \| "false" ...` then `at ["item"]`, and the error is still recoverable; also works through `Schema.fromJsonString(Row)` | value-space path only                                                                        |
| `errors: "all"`                        | n/a                                    | ignored (first error only); `decodeString` takes no `ParseOptions`                                                                                               | honored: two issues reported                                                                 |
| Spans                                  | `xml.decodeString`                     | `xml.decodeString` (Effect.fn runs inside the schema parser on the same fiber; the tracer sees it)                                                               | `xml.decodeTree`                                                                             |
| `.annotate` keeps the type             | n/a                                    | yes: `interface XmlString<Def> extends decodeTo<toType<Def>, String> { Rebuild: XmlString<Def> }`, with no cast                                                  | n/a                                                                                          |

Rows for `bg007-true-false.xml` were measured on fixtures replaced on 2026-11-09; the current files differ.

What broke or changed:

- The error type becomes `SchemaError`. `Effect.catchTag("XmlDecodeError")` and `catchReason` no longer fire directly. The caller recovers the error through the issue annotation, which takes a helper (`findXml` is 15 lines), so the library would need to export one.
- `ParseOptions` pass through only if `decodeString` grows a `parseOptions` parameter, because `transformEffect` hands them to the decode callback as its second argument.
- In B the position for bg007 is the root start tag (line 2), not the attribute line (line 9). The same is true today (hater B W10).

**Recommendation:** adopt B as the primary document entry (`XmlSchema.fromString(Root)`), keep the rich error as an issue annotation, and add an exported guard or extractor for it. Reject A, because it gives up XPath and positions for Schema failures. **Confidence: high** for the shape, which ran end to end on both inputs. **Medium** on retiring `decodeString` completely: the change of error type is a real cost for `catchTag` users.

## Q4. Rebuild-safe element codecs

Two type-level carriers were compared, each made with a cast over today's codecs:

- **R, Rebuild override:** `interface ElementCodecR<N, T> extends Codec<T, ResolvedElement> { "~xml.name": N; Rebuild: ElementCodecR<N, T> }`.
- **E, name in Encoded:** `Schema.Codec<T, XmlElement<N>, RD, RE>`, where `XmlElement<N>` is a `ResolvedElement` with a phantom `unique symbol` key. Entry points take `<N, T, RD, RE>(def: Codec<T, XmlElement<N>, RD, RE>)`.

| Combinator               | Today               | R                                                                               | E                                                                             |
| ------------------------ | ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `.annotate`              | TS2741 (hater B W2) | passes                                                                          | passes                                                                        |
| `Schema.check`           | TS2741              | passes                                                                          | passes                                                                        |
| `Schema.brand`           | TS2741              | fails, pinned: `brand<S["Rebuild"], B>` is its own interface (`Schema.ts:5319`) | passes                                                                        |
| `Schema.decodeTo(Class)` | TS2741              | fails, pinned: the result is `decodeTo<To, From>` (`Schema.ts:5600`)            | passes, because `decodeTo` keeps `From["Encoded"]`                            |
| Name still inferred      | n/a                 | n/a                                                                             | `N = "qti-prompt"` after `brand` and after `decodeTo(Class)`                  |
| Negative cases           | n/a                 | n/a                                                                             | `Schema.String` and a plain `Codec<_, ResolvedElement>` are rejected (pinned) |
| Services                 | erased              | erased                                                                          | threaded: `RD = "SomeService"` survives into the entry point's signature      |

Runtime marker: `markerOf` (`src/plan.ts:120`) reads only the top AST node. It finds the marker after `annotate`, `check` and `brand`, which keep the same AST node and its annotations, and misses it after `decodeTo(Class)`. That is why today's `decodeString` dies on a Class-backed root. `markerDeep` (8 lines) also walks `ast.encoding[*].to` (`SchemaAST.ts:425`, `:4485`) and finds it in all four cases.

With `markerDeep`, a spike `decodeStringDeep` and `encodeStringDeep` were built on `decodeTree`, `Schema.decodeUnknownEffect(def)` and `toDecodeError`:

- A `Schema.Class` behind the README root decodes to an instance (`instanceof Interaction` is true, and the `single` getter works) and encodes back.
- A failure through the Class keeps the XPath: `/qti-choice-interaction/@max-choices`. `toDecodeError` walks the extra `Encoding` wrapper unchanged. The spike does not attach a position, because `attachPosition` is private.
- As a child slot, today's `lower` throws `DefinitionError ... expected an element codec`, with the misleading repair text hater B reported. What `compile` would do once `lower` reads `markerDeep`, `Schema.Array(classBackedElement)` over the child trees, decodes to class instances (`true:A`, `true:B`).

**Recommendation:** carry the element name in the Encoded type (carrier E), and make `markerOf` walk the encoding chain. That one runtime change covers the root, the slots and `mixed` members. Do not use the Rebuild override: it fixes only `annotate` and `check`. **Confidence: high** at the type level (tsc-proven for all four combinators) and at the root at runtime. **Medium** for child slots and `mixed` members: those depend on the `lower`/`compile` change, which was not built here because it is in `src/`.

## Q2. Namespace module

`xml-schema.ts` holds the full surface. `index-variant.ts` is the whole entry point, `export * as XmlSchema from "./xml-schema.ts"`. The README example, rewritten in `q2-namespace.ts`:

```ts
import { XmlSchema } from "@aidenzepp/effect-xml";
const { element } = XmlSchema.namespaces({ "": QTI });
const ChoiceInteraction = element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: XmlSchema.elements({
    prompt: XmlSchema.optionalKey(Prompt),
    choices: XmlSchema.Array(SimpleChoice),
  }),
});
const Document = XmlSchema.fromString(ChoiceInteraction);
const value = Schema.decodeUnknownSync(Document)(xml);
```

Renames (today -> namespace member):

| Today                                                                  | Namespace                                                                                                     | Why                                                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `decodeString`, `encodeString`                                         | `XmlSchema.fromString(Root)` with `Schema.decode*` / `Schema.encode*`                                         | Q1; frees the names that siblings use for channels                                                                                    |
| `decodeTree`                                                           | `XmlSchema.ElementFromString(prefixes)`, a `Codec<Element, string>`                                           | the same Codec shape                                                                                                                  |
| `decode(def, path, opts)(stream)`                                      | `XmlSchema.decodeSchema(def, path)(opts)` for bytes, `XmlSchema.decodeSchemaString(def, path)(opts)` for text | `Ndjson.ts:439,467`, `Csv.ts:828,874`; Q3                                                                                             |
| `many`                                                                 | `XmlSchema.Array`                                                                                             | Schema word (Q6 would accept `Schema.Array` itself)                                                                                   |
| `optional`                                                             | `XmlSchema.optionalKey`                                                                                       | `optional` means `T \| undefined` in Schema; the slot is an absent key                                                                |
| `suspend(name, thunk)`                                                 | kept                                                                                                          | the leading name tags `mixed` members before the thunk is forced, so it cannot match `Schema.suspend(thunk)`; document the difference |
| `canonicalize` + `normalizedNames`                                     | `XmlSchema.equivalence(Root)`                                                                                 | Q5                                                                                                                                    |
| `XmlDecodeError`, `XmlEncodeError`                                     | `XmlSchema.DecodeError`, `XmlSchema.EncodeError`                                                              | the prefix is redundant in a namespace; tags unchanged                                                                                |
| `ResolvedElement`                                                      | `XmlSchema.Element`                                                                                           | reads as `Xml.Element`'s sibling                                                                                                      |
| `defaultMaxElementSize`, `defaultMaxElementNodes`                      | dropped                                                                                                       | upstream keeps its defaults private                                                                                                   |
| `element`, `namespaces`, `text`, `elements`, `mixed`, `clark`, reasons | unchanged                                                                                                     | no collision inside a namespace                                                                                                       |

Measured:

- It type-checks and runs. `Xml.decodeString` (the upstream channel) and `XmlSchema.decodeSchemaString` sit side by side with no ambiguity.
- Tree-shaking: the same consumer (`element` and `text` only), flat versus `export * as` over today's exact surface, bundles to **90847 bytes both ways** (`bun build --minify --target=bun`). `vp pack` (rolldown) declaration output was **not** measured, because the task forbids the build gate.
- Not settled: the reason class names (`SchemaReason` with tag `"Schema"`, hater A item 7) are out of scope here.

**Recommendation:** ship `XmlSchema` as the single namespace export, with the renames above. **Confidence: medium-high.** The shape and the bundle size are proven. The exact member names (`fromString`, `Array`, `optionalKey`) are taste and still need a ruling.

## Q3. Channel streaming

`channel.ts` builds `decodeSchema` (bytes) and `decodeSchemaString` (text) only from existing channels: `Xml.decode`, `Xml.decodeString` or `decodeStringWithPositions`, then `resolveEvents`, then `collect`, then `Channel.flattenArray` with a per-record `Channel.mapEffect` decode. Each returns `Channel<NonEmpty<T>, XmlDecodeError | IE, Done, NonEmpty<Uint8Array | string>, IE, Done>`. There is no `Stream.peel` and no mixed-chunk defect. Construction errors (an empty path, a missing marker) throw eagerly, as `Xml.elements` does.

```ts
// today
decode(AssessmentItem, path, { positions: true })(textStream);
// after
textStream.pipe(
  Stream.pipeThroughChannel(decodeSchemaString(AssessmentItem, path)({ positions: true })),
);
byteStream.pipe(Stream.pipeThroughChannel(decodeSchema(AssessmentItem, path)()));
```

Results on a 50-item bank built from bg007, in 4 KiB chunks:

| Measure                                         | Today                                              | Channel                                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Count, text and bytes                           | 50 / 50                                            | 50 / 50, and 50 with `positions: true`                                                                                                                      |
| Failure (3rd record bad)                        | `record: 3`, XPath, `position {line 57, column 1}` | identical (text with positions); bytes: `record: 3`, XPath, no position                                                                                     |
| Records emitted before the failure              | 2                                                  | 2                                                                                                                                                           |
| Malformed bytes                                 | n/a                                                | `path "/"`, `position {line 1, column 7}`                                                                                                                   |
| Input-kind split                                | runtime sniff; mixed chunks are a defect           | compile time: a text stream into `decodeSchema` is a type error (pinned)                                                                                    |
| Today's `decode` in `Stream.pipeThroughChannel` | type error (pinned)                                | n/a                                                                                                                                                         |
| Composition                                     | none                                               | `Channel.pipeTo(Channel.decodeText(), decodeSchemaString(...)({ positions: true }))` then `Channel.map` gives bytes with positions and no Stream in between |

Rows for `bg007-true-false.xml` were measured on fixtures replaced on 2026-11-09; the current files differ.

What broke:

- A first version decoded each chunk with `Effect.forEach` and emitted **0** records before the failure: the earlier records in the failing chunk were dropped. Upstream `ChannelSchema.decode` (`ChannelSchema.ts:116`) has the same chunk-atomic behavior. The spike flattens to one record per chunk to match today's semantics. The cost of that was not measured.
- Bytes with positions through `Channel.decodeText` is not fatal: malformed UTF-8 becomes U+FFFD instead of today's `WellFormedness` "invalid UTF-8". Keeping today's behavior needs a fatal-decoder channel (`decodeUtf8` would move from Stream to Channel).
- The byte channel without positions keeps `Xml.decode`'s encoding rule. Not re-tested here.

**Recommendation:** replace `decode` with the two channels, `decodeSchema` for bytes and `decodeSchemaString` for text, with `positions` on the text one. Bytes with positions is then text composition behind a fatal UTF-8 channel. **Confidence: high**: the parity numbers match today's on every measured axis.

## Q5. Equivalence

`equivalence(def) = Equivalence.mapInput(Equivalence.strictEqual<string>(), (el) => canonicalize(el, { normalize: normalizedNames(def) }))`, 5 lines. It agrees with today's README check on both inputs (`true` / `true`), and it reports `false` for an added attribute.

**Recommendation:** export `equivalence(Root)` in place of the `canonicalize` + `normalizedNames` pair, and keep `canonicalize` internal or as a debug printer. **Confidence: high** that it is equivalent, since it is the same comparator. **Low** on whether a printer still needs to be public.

## Not done

- Q6-Q8.
- Streaming encode.
- `vp pack` declaration output.
- The `lower`/`compile` change for Class-backed child slots, which is in `src/` and out of this task's write scope.
