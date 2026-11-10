# Effect-native API review

Answers the owner directive of 2026-11-05 (`work/owner-directive-effect-native-api.md`): is the public API the one the Effect team would ship? This is an evaluation. Nothing here is approved; every breaking change waits for the owner.

- Baseline: repo HEAD `460b396`, `effect` 4.1.2 (`node_modules/effect/package.json`). Effect citations are `node_modules/effect/src/<file>:<line>`, written `<file>:<line>`; every one carried into this document was re-read at that line on this baseline.
- Inputs: the inventory and comparison (`work/effect-native/comparison.md`), two hater passes and their merit extractions (`work/effect-native/hater-a.md`, `merit-a.md`, `hater-b.md`, `merit-b.md`), and the spike (`spikes/effect-native-api/RESULT.md`, commit `460b396`).
- Item ids: `A<n>` is hater A item n, `W<n>` is hater B wall n, `MA-B<n>` and `MB-B<n>` are the bugs in merit A and merit B, `Q<n>` is a comparison or spike question.
- Re-checks on this baseline: `bun x tsc -p spikes/effect-native-api/tsconfig.json` exits 0, and `q1-text-codec.ts`, `q3-channel.ts`, `q4-rebuild.ts`, `q5-equivalence.ts` each exit 0 under `bun run`. Bugs 1, 2, 4, 5 and 8 below were reproduced again with a throwaway probe against `src/index.ts`.

## 1. Verdict

Not yet. Each element codec is a real `Schema.Codec`, and the error model already uses Effect's `TaggedError` + `reason` + `catchReason` pattern. But the type is lost at the first Schema combinator (`annotate`, `brand`, `decodeTo(Class)`). Text decoding exists only as the library's own functions, not as a `Codec<T, string>`. And `decode`/`decodeString`/`encodeString` reuse the names of the sibling `effect/encoding` channels with a different shape, under flat exports that collide with `Xml.*` and `Schema.*`. Separately from the API shape, nine behavior and message bugs should be fixed. One of them (bug 1) silently loses data.

## 2. Inventory and comparison

Every export of `src/index.ts`: 27 values and 22 types. Verdicts: **match** (follows the Effect idiom), **dev+r** (deviates, with a stated reason), **dev-r** (deviates, no stated reason). The full signatures and probe output are in `work/effect-native/comparison.md`.

### Values

| Export                                            | Closest Effect analogue                                                                                                   | Verdict          | Why                                                                                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `element`                                         | `Schema.TaggedStruct` `Schema.ts:6324`; `Schema.Struct` `Schema.ts:3597`                                                  | dev+r            | Name first, then a spec. The `attributes`/`content` split is something `Struct` cannot express (D5). The type brand breaks under combinators (see `ElementCodec`). |
| `namespaces`                                      | `VariantSchema.make` `schema/VariantSchema.ts:428`                                                                        | match            | Binds the configuration once and returns builders.                                                                                                                 |
| `suspend`                                         | `Schema.suspend(f)` `Schema.ts:5180`                                                                                      | dev+r            | Takes an extra leading name, which dispatch needs before the thunk is forced. The name collision is resolved by the namespace (R4).                                |
| `text`                                            | `Xml.Text` event `encoding/Xml.ts:164`                                                                                    | dev-r (name)     | A content descriptor that shadows an upstream event type in flat imports.                                                                                          |
| `elements`                                        | `Schema.Struct`/`StructWithRest` `Schema.ts:3597`, `:4251`; `Xml.elements` `encoding/Xml.ts:438`                          | dev+r            | `open` stands in for a rest slot. Its flat name collides with the upstream Channel.                                                                                |
| `mixed`                                           | `Schema.Array(Schema.Union(...))` `Schema.ts:4677`; `TaggedUnion` `Schema.ts:6578`                                        | dev+r            | Compiles to exactly that (D3). Its text-run tag collides with a member named `text` (bug 5).                                                                       |
| `many`                                            | `Schema.Array` `Schema.ts:4677`                                                                                           | dev-r            | A non-schema wrapper; no reason recorded for not using `Array`.                                                                                                    |
| `optional`                                        | `Schema.optionalKey` `Schema.ts:2406`; `Schema.optional` `Schema.ts:2471`                                                 | dev-r            | Means "key absent", which is `optionalKey`. `Schema.optional(P)` in a slot is a type error (probe C).                                                              |
| `DefinitionError`                                 | plain `Error` thrown at construction `encoding/Xml.ts:449-456`                                                            | dev+r            | A yieldable `Data.TaggedError` that is only ever thrown, so `catchTag` can never fire on it (A16).                                                                 |
| `decodeString`                                    | `Schema.fromJsonString` `Schema.ts:9875`; `Schema.decodeUnknownEffect` `Schema.ts:1535`                                   | dev-r            | Upstream, `decodeString` is a text-chunk Channel (`encoding/Xml.ts:334`). The format-codec idiom is a `Codec<T, string>`.                                          |
| `decodeTree`                                      | `Xml.decodeString` + `Xml.elements` `encoding/Xml.ts:334`, `:438`                                                         | dev+r            | Clark-name tree, with Channel-style currying (`decodeTree()(xml)`) on an `Effect` function (A17).                                                                  |
| `encodeString`                                    | `Schema.toEncoderXml` `Schema.ts:18731`; `Xml.encodeString` `encoding/Xml.ts:511`                                         | dev+r / dev-r    | The shape matches `toEncoderXml`. The name collides with the upstream Channel, and there is no streaming or byte encode (A13, W11).                                |
| `decode`                                          | `Ndjson.decodeSchema` `Ndjson.ts:439`; `Csv.decodeSchema` `Csv.ts:874`                                                    | dev-r            | A `Stream -> Stream` function over `Uint8Array \| string`, split by a runtime sniff, where upstream exposes a `Channel` per input kind.                            |
| `canonicalize`                                    | `Schema.toEquivalence` `Schema.ts:18064`; `Equivalence.mapInput` `Equivalence.ts:591`                                     | dev-r            | Prints a string to compare with `===` where Effect expresses equality as an `Equivalence`. Its option bag is required.                                             |
| `normalizedNames`                                 | none                                                                                                                      | dev+r            | Exists only to feed `canonicalize` (Q5).                                                                                                                           |
| `clark`                                           | `Option` idiom                                                                                                            | match            | `Option<string>` for "no namespace". XML jargon, domain-correct.                                                                                                   |
| `XmlDecodeError`, `XmlEncodeError`                | reason errors: `Effect.catchReason` `Effect.ts:5144`; `Sse.SseErrorReason` `Sse.ts:52`; `isXmlError` `encoding/Xml.ts:73` | match, gaps      | The idiom is followed. Missing: exported reason-union types, `is*` guards and a TypeId (A28).                                                                      |
| `SchemaReason`, `EncodeSchemaReason`              | reason class named for its tag `Sse.ts:37`                                                                                | dev-r            | Two classes share the tag `"Schema"`, and neither class name matches it (A7).                                                                                      |
| `UndeclaredPrefix`, `UnmappedNamespace`           | `Sse.EventTooLarge` `Sse.ts:37`                                                                                           | match            | Class name equals tag.                                                                                                                                             |
| `Limit`, `InvalidEvent`                           | `Xml.XmlError` kinds `encoding/Xml.ts:51-53`                                                                              | match / dev-r    | The tags mirror upstream kinds. The flat names are generic, and upstream `Limit` errors do not reach this reason (bug 4).                                          |
| `WellFormedness`                                  | `Xml.XmlError` kind `"Syntax"` `encoding/Xml.ts:52`                                                                       | dev+r            | Wraps the upstream error as `cause`. It also swallows the `Limit` and `Unsupported` kinds (bug 4).                                                                 |
| `defaultMaxElementSize`, `defaultMaxElementNodes` | private `const defaultMaxElementSize` `encoding/Xml.ts:550`                                                               | dev+r (internal) | Exported only so docs can read them. Upstream keeps defaults private (A23).                                                                                        |

### Types

| Export                                                            | Closest Effect analogue                                                                              | Verdict      | Why                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ElementCodec<Name, T>`                                           | `Schema.Codec` with `"Rebuild"` `Schema.ts:1082-1086`; `annotate(): this["Rebuild"]` `Schema.ts:210` | dev-r        | A real `Codec`, but its phantom `"~xml.name"` does not survive `Rebuild`, so `annotate`, `check`, `brand` and `decodeTo` all lose it (probes A, B; W2, W3). |
| `Namespaces`                                                      | `VariantSchema.make` return `schema/VariantSchema.ts:428`                                            | match        | Builder record.                                                                                                                                             |
| `PrefixMap`                                                       | none                                                                                                 | match        | Plain readonly record.                                                                                                                                      |
| `Spec`, `LimitOptions`, `DecodeStreamOptions`, `CanonicalOptions` | option bags `encoding/Xml.ts:253-256`, `:272-274`                                                    | match, gap   | Option bags are right. Fields lack `\| undefined` (A22). `CanonicalOptions` is required where Effect bags are optional.                                     |
| `Attributes`, `ChildFields`                                       | `Struct.Fields`                                                                                      | match        | Field records.                                                                                                                                              |
| `Content`, `Empty`, `Mixed`                                       | none                                                                                                 | dev+r        | Closed content-mode union (D3).                                                                                                                             |
| `Text`, `Elements`                                                | `Xml.Text` `encoding/Xml.ts:164`; `Xml.elements` `:438`                                              | dev-r (name) | Flat names shadow upstream members.                                                                                                                         |
| `ChildSpec`, `Many`, `Optional`                                   | `Schema.Array` `Schema.ts:4677`; `Schema.optional` `Schema.ts:2471`                                  | dev-r        | Same names as Schema members with different types; `ChildSpec` rejects `Schema.optional`/`Schema.Array` forms (probe C).                                    |
| `MixedItem`                                                       | `_tag` unions, `Schema.TaggedUnion` `Schema.ts:6578`                                                 | dev-r        | Text runs and a member named `text` share one `_tag` (bug 5).                                                                                               |
| `ResolvedElement`                                                 | `Xml.Element` `encoding/Xml.ts:228`                                                                  | match        | The same shape, with Clark names.                                                                                                                           |
| `Position`                                                        | `Xml.XmlError` `line`/`column` `encoding/Xml.ts:54-55`                                               | match        | Same units.                                                                                                                                                 |
| `ElementStep`, `ElementPath`                                      | none                                                                                                 | dev+r        | The locator behind positions.                                                                                                                               |

Not exported, though they appear in public signatures: `AttributesType`, `ContentType`, `ChildType`, `ChildrenType`, `IsOptional` (`src/dsl.ts:28-108`).

## 3. Behavior bugs to fix regardless of the API decision

These are merged from merit A and merit B, with duplicates removed. Each one is independent of the shape decisions in section 4 unless the entry says so. All of them fail open: none raises an error a caller would notice.

| #   | Priority | Bug                                                                                | Sources                   |
| --- | -------- | ---------------------------------------------------------------------------------- | ------------------------- |
| 1   | P0       | An attribute keyed `text`, `children`, or a slot key is silently dropped           | MA-B1, A19                |
| 2   | P1       | The `decode` path is never validated, so a bad path gives a silent empty stream    | MB-B1, W4, A14, A15       |
| 3   | P1       | Service requirements are erased to `R = never`                                     | MA-B2, A10                |
| 4   | P1       | Upstream `Limit` and `Unsupported` errors are reported as `WellFormedness`         | MA-B3, A24                |
| 5   | P1       | A `mixed` member named `text` shares the text-run tag                              | MA-B4, A20, W7            |
| 6   | P2       | `decodeTo` on an element gives a misleading `DefinitionError` (and a root defect)  | MB-B2, W3                 |
| 7   | P2       | Error messages mix authored names and Clark names                                  | MB-B3, W9                 |
| 8   | P2       | The wire struct's `name` field leaks into the error path                           | MA-B5, MB-B4 (duplicates) |
| 9   | P2       | Published doc comments carry internal decision ids, repo paths and dead `{@link}`s | A29, A30                  |

### Bug 1 (P0): attribute keyed `text`, `children`, or a slot key is dropped

- Repro: `P = element("p", { attributes: { text: Schema.String }, content: text(Schema.String) })`. `decodeString(P)('<p text="ATTR">BODY</p>')` gives `{ text: "BODY" }`, so the attribute is lost. `decodeString(P)("<p>BODY</p>")` succeeds, so the required attribute is not enforced. `encodeString(P)({ text: "X" })` writes `<p text="X">X</p>`. The same happens for an attribute named like an `elements` slot, and for `children` on `mixed`.
- Cause: `compile` writes `fields[a.key]`, then overwrites it with `fields[content.key]` or `fields[slot.key]` in one struct (`src/compile.ts:636-656`). `lower` checks only `data-*` shadowing (`src/plan.ts`).
- Fix direction: `lower` returns a `DefinitionError` naming both declarations when an attribute key equals the content key (`text`, `children`) or a slot key. A separate namespace for attributes in the decoded value would be a shape change and is open decision O7.
- Blast radius: `src/plan.ts`, `src/plan.test.ts`. No README change unless O7 picks the namespace option.

### Bug 2 (P1): `decode` path is never validated

- Repro: the document is `<bank xmlns:q="urn:qti"><item xmlns="urn:qti" id="1"/><q:item id="2"/></bank>`, decoded with `namespaces({ "": "urn:qti" }).element("item", ...)`. The paths `["bank","item"]` and `["bank","q:item"]` both give `Success []`. `["bank","{urn:qti}item"]` gives both records. Merit B also measured `["bank","{x"]` and `["bank","{urn:qti}other"]` returning `[]`, and a 50-item QTI bank returning 0 records.
- Cause: `decode` checks only `path.length === 0` (`src/codec.ts`), and `makeCollector` matches steps by string equality (`src/resolve.ts`). Upstream rejects invalid steps at channel creation (`encoding/Xml.ts:449-456`).
- Fix direction: before the stream is returned, reject any step that is neither `"*"` nor a well-formed Clark name, and a last step that is neither `"*"` nor the def's own Clark name. Throw eagerly, as upstream does (this also closes A15's lazy construction defect). If R3 lands, the check moves into the channel factory.
- Blast radius: `src/codec.ts`, possibly `src/resolve.ts`; `test/streaming/decode.test.ts`; README `decode` row (line 104).

### Bug 3 (P1): service requirements are erased

- Repro: an attribute schema whose decode yields a `Context.Service` (`Upper`). `decodeString(P)('<p a="hi"/>')` is typed `Effect<..., XmlDecodeError, never>`, yet running it dies with `Service not found: Upper`. With `Effect.provideService(Upper, ...)` it gives `{ a: "HI" }`. The runtime threads the context correctly; only the types lie.
- Cause: `ElementCodec` fixes `RD`/`RE` to `never` (`src/plan.ts:213`). `compile` returns `Codec<unknown, ResolvedElement, unknown, unknown>` (`src/compile.ts:632`). The entry points return `R = never`. Siblings thread `S["DecodingServices"]` (`Ndjson.ts:439-453`, `Csv.ts:830-837`, `Sse.ts:196-212`).
- Fix direction: either carry `RD`/`RE` through `element`'s inferred type and out of the entry points (R1's carrier makes room for this: the spike showed `RD` surviving into the entry signature), or narrow `Attributes` and `text` to service-free codecs so the mistake becomes a type error. Open decision O8.
- Blast radius: `src/plan.ts`, `src/dsl.ts`, `src/codec.ts` signatures; type-level tests plus one runtime test.

### Bug 4 (P1): upstream `Limit` and `Unsupported` are reported as `WellFormedness`

- Repro: `decode(I, ["r","i"], { maxDepth: 1 })(Stream.make("<r><i>x</i></r>"))` fails with reason `WellFormedness`, `cause.kind` `"Limit"`, and the message "the text is not well-formed XML (element nesting exceeds maxDepth of 1)". `Effect.catchReason("XmlDecodeError", "Limit", ...)` does not catch it. A byte stream that declares `encoding="UTF-16"` also says "not well-formed".
- Cause: `wellFormedness` wraps every upstream `XmlError` (`src/codec.ts:46-51`), although `XmlError.kind` already separates `Syntax`, `Unsupported`, `Limit` and `InvalidEvent` (`encoding/Xml.ts:51-53`).
- Fix direction: route `kind: "Limit"` to the `Limit` reason (widen `limit` to include `maxDepth` and `maxTokenSize`, and make `element` optional), give `Unsupported` its own reason or at least its own message, and keep `WellFormedness` for `Syntax`. The exact reason shape is O9.
- Blast radius: `src/codec.ts`, `src/issue.ts` (`Limit` schema, `wellFormednessParts`); `test/upstream-xml.test.ts`, `src/codec.test.ts`, `src/issue.test.ts`; README Limits section.

### Bug 5 (P1): a `mixed` member named `text` shares the text-run tag

- Repro: `mixed([element("text", { content: text(Schema.String) })])` on `<m>run<text>el</text></m>` gives `[{ _tag: "text", text: "run" }, { _tag: "text", value: { text: "el" } }]`. `Match.tag("text")` catches both, and `Match.exhaustive` cannot separate them. Encode still round-trips, because the union tries both branches (merit B, W7).
- Cause: text runs are tagged `"text"` (`src/compile.ts:506`, `src/dsl.ts:93`). Only `"*"` is reserved as a non-name.
- Fix direction: either tag text runs with a value that cannot be an element name, such as DOM's `"#text"` (this changes the shape every `Match.tag("text")` consumer depends on), or reject a member named `text` with a `DefinitionError` (a one-line guard that loses SVG `<text>`). O6 picks between them.
- Blast radius: `src/compile.ts`, `src/dsl.ts` (`MixedItem`), `src/plan.ts` if guarded, `src/issue.ts` (mixed resolution matches by tag); `test/qti/mixed.test.ts`, `src/codec.test.ts`; README mixed example.

### Bug 6 (P2): misleading `DefinitionError` after `decodeTo`

- Repro: `many(SimpleChoiceRaw.pipe(Schema.decodeTo(Choice)))` throws `DefinitionError: <qti-choice-interaction> child "choices": expected an element codec, such as one built with element(); wrap the value with element() or remove the slot.` The value was built with `element()`, so the suggested repair is wrong. As a root, `decodeString` dies with `decodeString received a codec without an element marker`, which is a defect and not a typed failure.
- Cause: `markerOf` reads only the top AST node's annotations (`src/plan.ts:120`). `decodeTo` puts the marker on `ast.encoding[*].to` (`SchemaAST.ts:425`).
- Fix direction: R1 fixes this properly. With R1 deferred, correct the message to name the actual case ("a codec transformed with decodeTo is not an element codec in this version").
- Blast radius: `src/plan.ts` (`lowerChild`, `lowerMember` messages or `markerOf`); `src/plan.test.ts`.

### Bug 7 (P2): messages mix authored and Clark names

- Repro: an undeclared `xsi:schemaLocation` on a `namespaces({ "": QTI, xsi: XSI })` element prints the element by its authored name and the attribute as `{http://www.w3.org/2001/XMLSchema-instance}schemaLocation`, in both the path and the text. `<p xmlns="urn:qti"><item xmlns="" id="1"/></p>` prints `<item> is not a declared child of <p>; declared children: item.`, which contradicts itself because the real difference, the namespace, is invisible.
- Fix direction: one name vocabulary per message, in the caller's terms: the authored prefix where the definition has one, and the namespace shown when it is the cause.
- Blast radius: `src/compile.ts` message builders, `src/issue.ts` path printing; `test/qti/errors.test.ts`, `src/issue.test.ts`, `src/compile.test.ts` message pins.

### Bug 8 (P2): the wire `name` field appears in the error path

- Repro: `decodeString(element("i", { content: text(Schema.String) }))("<j>x</j>")` gives `element name at /j/name (line 1, column 1): Expected "i"; change the element to match its definition`. `/j/name` reads as a child element `<name>`. Streaming prints `/j/name of record 1`.
- Cause: path translation keeps the `["name"]` pointer of the wire struct (`wireElement(Schema.Literal(plan.name))`, `src/compile.ts`).
- Fix direction: the path is `/j`, and the message says that `<i>` (or `{uri}i`) was expected. No test pins `/name` today.
- Blast radius: `src/issue.ts` (`toDecodeError`), `src/issue.test.ts`.

### Bug 9 (P2): published doc comments leak process and dead links

- Repro: `dist/index.d.ts` carries "decision D1 with its C3 amendment", references to `docs/goals/xml-schema-codec/phase-4.md` and `test/streaming/node-budget.test.ts` (files the package does not ship), ten "Native review:" and "Effect checked:" paragraphs, and `{@link}` targets that are not exported (`collect`, `readRoot`, `planOf`, `resolveEvents`, `attachPosition`, `toDecodeError`, `decodeUtf8`, `checkByteEncoding`).
- Measured on the source: `grep -rn "Native review\|Effect checked" src --include='*.ts' | grep -v test` gives 19 lines. `grep -rnE '\{@link (collect|readRoot|planOf|resolveEvents|attachPosition|toDecodeError|decodeUtf8|checkByteEncoding)\}' src --include='*.ts' | grep -v test` gives 34 lines.
- Fix direction: move the native-review rationale to `docs/`. Public blocks keep behavior, gotchas and an example (`encoding/Xml.ts:285-332` is the model), and link only exported symbols.
- Blast radius: doc comments in `src/canonical.ts`, `src/codec.ts`, `src/dsl.ts`, `src/resolve.ts`, `src/compile.ts`, `src/plan.ts`; no behavior or test changes.

## 4. Recommended API changes

They are ordered by consumer value against cost. R1, R5, R6 and R7 can each ship alone. R2 needs R1 if a `Schema.Class` root is in scope. R4 renames the result of R2, R3 and R7, so it lands last, or in the same breaking release.

| Rank | Change                                                             | Value      | Cost                 | Breaking                   | Ships alone        |
| ---- | ------------------------------------------------------------------ | ---------- | -------------------- | -------------------------- | ------------------ |
| R1   | Element name in the Encoded type; `markerOf` walks `decodeTo`      | high       | medium               | type-level                 | yes                |
| R2   | Schema-first text codec `fromString(Root)`                         | high       | medium               | yes if `decodeString` goes | yes (R1 for Class) |
| R3   | Channel streaming `decodeSchema` / `decodeSchemaString`            | high       | medium               | yes                        | yes                |
| R4   | `export * as XmlSchema` with renames                               | medium     | low code, high churn | yes                        | last               |
| R5   | Reason-union types, guards, reason names equal to tags             | medium     | low                  | renames only               | yes                |
| R6   | `parseOptions` pass-through                                        | medium     | low                  | no                         | yes                |
| R7   | `equivalence(Root)` in place of `canonicalize` + `normalizedNames` | low-medium | low                  | yes                        | yes                |
| R8   | Option-bag polish                                                  | low        | low                  | mostly no                  | yes                |

### R1. Carry the element name in the Encoded type

- Evidence: `Codec["Rebuild"]` is a plain `Codec<T, E, RD, RE>` (`Schema.ts:1082-1086`), and `annotate` returns `this["Rebuild"]` (`Schema.ts:210`). `Schema.brand` returns its own interface (`Schema.ts:5319`), and `decodeTo` returns `decodeTo<To, From>`, which keeps `From["Encoded"]` (`Schema.ts:5600`, `:5678`). A9, W2, W3, MB-B2, Q4.
- Spike Q4: overriding `Rebuild` fixes only `annotate` and `check`; `brand` and `decodeTo(Class)` stay pinned failures. Putting the name in the Encoded type (`Codec<T, XmlElement<N>, RD, RE>`, with a phantom `unique symbol` key on the element) passes all four combinators, still infers `N = "qti-prompt"` after `brand` and `decodeTo(Class)`, rejects `Schema.String` and a plain `Codec<_, ResolvedElement>`, and threads `RD` into the entry point. At runtime, an 8-line `markerDeep` that also walks `ast.encoding[*].to` finds the marker in all four cases. A `Schema.Class` root then decodes to an instance, its getter works, and a failure keeps the XPath `/qti-choice-interaction/@max-choices`.
- Before:

  ```ts
  const Tagged = Prompt.pipe(Schema.brand("Prompt"));
  decodeString(Tagged); // TS2741: Property '"~xml.name"' is missing

  class Choice extends Schema.Class<Choice>("Choice")({ label: Schema.String }) {}
  elements({ choices: many(SimpleChoiceRaw.pipe(Schema.decodeTo(Choice, toChoice))) });
  // throws DefinitionError: ... expected an element codec ... wrap the value with element()
  ```

- After:

  ```ts
  // ElementCodec<N, T, RD, RE> is Schema.Codec<T, XmlElement<N>, RD, RE>
  const Tagged = Prompt.pipe(Schema.brand("Prompt")); // still an element codec, N = "qti-prompt"
  const ChoiceElement = SimpleChoiceRaw.pipe(Schema.decodeTo(Choice, toChoice));
  const Interaction = element("qti-choice-interaction", {
    content: elements({ choices: many(ChoiceElement) }),
  });
  // decoded choices are Choice instances; encode writes the same XML back
  ```

- Blast radius: `src/plan.ts` (`ElementCodec`, `markerOf`, `lowerChild`, `lowerMember`, slot types), `src/dsl.ts` (`element` and `suspend` return types), `src/codec.ts` (entry signatures), `src/canonical.ts` (`normalizedNames` parameter), `src/index.ts`. Tests that name `ElementCodec` (from `grep -rlF ElementCodec src test --include='*.ts' | grep -v '^src/[a-z-]*\.ts$'`, which drops the defining modules): `src/canonical.test.ts`, `src/dsl.test.ts`, `src/issue.test.ts`, `src/plan.test.ts`, `test/qti/vocabulary.ts`. Add type-level tests for the four combinators. The README calls only inferred types, so its call sites are unchanged.
- Confidence: high at the type level (proven with tsc for all four combinators) and for the root at runtime. Medium for child slots and `mixed` members: these depend on the `lower`/`compile` change, which the spike could not build because it is in `src/`.
- Breaking: type-level only, for code that names `ElementCodec<N, T>` or treats `ResolvedElement` as the encoded type. Closes bug 6 and gives bug 3 its carrier.

### R2. A Schema-first text codec

- Evidence: `Schema.fromJsonString` is `JsonString.pipe(decodeTo(schema, transformation))` (`Schema.ts:9875-9884`), so text parsing composes into any field. `Schema.decodeUnknownEffect` takes `ParseOptions` (`Schema.ts:1535`). Issue annotations have an open index signature (`Schema.ts:19115-19117`), so the library error can be stored as typed data. W1, A34, MB W1, Q1.
- Spike Q1: carrier B (`XmlString(def)`, one `SchemaTransformation.transformEffect` over today's `decodeString`/`encodeString`) decodes the README example and bg007 to the same values, encodes the same text, and keeps the message, XPath and `(line, column)` unchanged. Inside `Schema.Struct` and through `Schema.fromJsonString(Row)` it still recovers the error. The `xml.decodeString` span is still emitted. `.annotate` keeps the type with no cast. Carrier A (layered `String -> ResolvedElement -> def`) loses the XPath and positions for Schema failures, so it was rejected.
- Before:

  ```ts
  const value = Effect.runSync(decodeString(ChoiceInteraction)(xml));
  const text = Effect.runSync(encodeString(ChoiceInteraction)(value));
  Schema.decodeUnknownEffect(ChoiceInteraction)(xml); // SchemaError: Expected object
  ```

- After:

  ```ts
  const Document = XmlSchema.fromString(ChoiceInteraction);
  const value = Schema.decodeUnknownSync(Document)(xml); // or decodeUnknownEffect / Exit
  const text = Schema.encodeSync(Document)(value);
  const Row = Schema.Struct({ id: Schema.String, item: XmlSchema.fromString(AssessmentItem) });
  // the positioned error is still reachable from the SchemaError
  Effect.catchTag("SchemaError", (e) => Effect.fail(XmlSchema.decodeErrorOf(e.issue)));
  ```

- Error-type cost: the error channel becomes `Schema.SchemaError`. `Effect.catchTag("XmlDecodeError")` and `catchReason("XmlDecodeError", ...)` no longer fire directly. The full `XmlDecodeError` (path, position, reason) is recovered by walking the issue to its `xml` annotation, which is the spike's 15-line `findXml`, so the library must export that extractor (named `decodeErrorOf` above; the name is O1). `errors: "all"` is ignored unless the internal decode grows `parseOptions` (R6). The attribute-failure position is the root start tag, as it is today (W10).
- Fate of today's entry points: `decodeString`/`encodeString` become the internal implementation of `fromString`. The planner default is to drop them from the public surface; keeping them is O2. `decodeTree` becomes `XmlSchema.ElementFromString(prefixes)`, a `Codec<Element, string>`. Carrier A's loss of XPath does not apply to it, because a tree codec has no definition failures.
- Blast radius: `src/codec.ts` (new codec and extractor, entry points made internal), `src/index.ts`. Tests calling the entry points (from `grep -rlF '<name>(' src test --include='*.ts' | grep -v '^src/[a-z-]*\.ts$'`, which drops the defining modules): `decodeString(` in 12 files, `encodeString(` in 9 and `decodeTree(` in 5, led by `src/codec.test.ts`, `test/readme.test.ts`, `test/round-trip.test.ts` and `test/qti/*`. README Start example (lines 28-65), the export table (102-105), Round trip (126-137), Positions (165) and Limits (181).
- Confidence: high for the shape, which ran end to end on both inputs. Medium on dropping `decodeString`, because of the error-type cost.
- Breaking: yes if O2 drops `decodeString`/`encodeString`/`decodeTree`; additive otherwise.

### R3. Channel streaming in place of `decode`

- Evidence: upstream splits input kinds by type and returns Channels: `Xml.decodeString` (text) and `Xml.decode` (bytes) (`encoding/Xml.ts:334`, `:368`); `Ndjson.decodeSchema` and `decodeSchemaString` (`Ndjson.ts:439-453`, `:467`); `Csv.decodeSchemaString` and `decodeSchema` (`Csv.ts:828`, `:874`). All compose with `Stream.pipeThroughChannel` (`Stream.ts:16246`). Invalid paths throw at creation (`encoding/Xml.ts:449-456`). A12, A15, W5, MA items 12 and 15, Q3.
- Spike Q3: `decodeSchema` (bytes) and `decodeSchemaString` (text), built only from existing channels (`Xml.decode*`, `resolveEvents`, `collect`, a per-record `Channel.mapEffect`), match today on every measured axis over a 50-item bank in 4 KiB chunks: counts, `record: 3` on a bad third record, XPath, `position { line 57, column 1 }`, and two records emitted before the failure. A text stream into `decodeSchema` is a compile error, where today a mixed-kind stream is a runtime defect. Construction errors throw eagerly.
- Before:

  ```ts
  decode(AssessmentItem, path, { positions: true })(textStream);
  textStream.pipe(Stream.pipeThroughChannel(decode(AssessmentItem, path))); // type error
  ```

- After:

  ```ts
  textStream.pipe(
    Stream.pipeThroughChannel(
      XmlSchema.decodeSchemaString(AssessmentItem, path)({ positions: true }),
    ),
  );
  byteStream.pipe(Stream.pipeThroughChannel(XmlSchema.decodeSchema(AssessmentItem, path)()));
  ```

- Bytes with positions: composing `Channel.decodeText()` (`Channel.ts:9214`, a non-fatal `TextDecoder`) into the text channel turns malformed UTF-8 into U+FFFD. Today the same input fails with `WellFormedness` "invalid UTF-8". Keeping today's behavior needs a fatal UTF-8 channel (`decodeUtf8` moves from Stream to Channel). Accepting U+FFFD is O3.
- Chunking: a per-chunk `Effect.forEach` dropped the earlier records of a failing chunk, which is the same chunk-atomic behavior as upstream `ChannelSchema.decode` (`ChannelSchema.ts:116`). The spike flattens to one record per chunk to match today; the cost of that was not measured.
- Blast radius: `src/codec.ts` (`decode`, the `Stream.peel` sniff, `decodeUtf8`), `src/index.ts`. Tests calling `decode(` (from the grep above): `src/codec.test.ts`, `src/compile.test.ts`, `test/streaming/decode.test.ts`, `test/streaming/positions.test.ts`, `test/upstream-xml.test.ts`. README rows 104, 166 and 170, and the Limits text at 181. Bug 2's path check moves into the factory.
- Confidence: high, with parity on every measured axis.
- Breaking: yes.

### R4. One namespace export, with renames

- Evidence: Effect publishes modules as namespaces (`index.ts:645` `export * as Schema`; `encoding/index.ts:24`, `:96` `export * as Csv`, `export * as Xml`). Flat names collide today: `decode`, `decodeString`, `encodeString` and `elements` with `Xml.*`, and `optional`, `Optional`, `suspend` and `Text` with `Schema.*` and `Xml.*`. A1-A3, MA item 3, Q2.
- Spike Q2: `export * as XmlSchema from "./xml-schema.ts"` type-checks and runs, and `Xml.decodeString` sits beside `XmlSchema.decodeSchemaString` without ambiguity. The same consumer, flat or namespaced, bundles to 90847 bytes either way (`bun build --minify --target=bun`). `vp pack` declaration output was not measured.
- Before:

  ```ts
  import { decodeString, element, elements, many, optional, text } from "@aidenzepp/effect-xml";
  const Interaction = element("qti-choice-interaction", {
    content: elements({ prompt: optional(Prompt), choices: many(SimpleChoice) }),
  });
  ```

- After:

  ```ts
  import { XmlSchema } from "@aidenzepp/effect-xml";
  const Interaction = XmlSchema.element("qti-choice-interaction", {
    content: XmlSchema.elements({
      prompt: XmlSchema.optionalKey(Prompt),
      choices: XmlSchema.Array(SimpleChoice),
    }),
  });
  ```

- Rename table (from the spike, adjusted for R5):

  | Today                                                                                   | In `XmlSchema`                                                            | Why                                                                            |
  | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
  | `decodeString`, `encodeString`                                                          | `fromString(Root)` with `Schema.decode*`/`encode*`                        | R2; frees the names the siblings use for channels                              |
  | `decodeTree`                                                                            | `ElementFromString(prefixes)`                                             | the same Codec shape                                                           |
  | `decode(def, path, opts)(stream)`                                                       | `decodeSchema(def, path)(opts)` and `decodeSchemaString(def, path)(opts)` | R3                                                                             |
  | `many`                                                                                  | `Array`                                                                   | the Schema word                                                                |
  | `optional`                                                                              | `optionalKey`                                                             | the slot is an absent key, which is `optionalKey`                              |
  | `canonicalize` + `normalizedNames`                                                      | `equivalence(Root)`                                                       | R7                                                                             |
  | `XmlDecodeError`, `XmlEncodeError`                                                      | `DecodeError`, `EncodeError` (tags unchanged)                             | the prefix is redundant inside the namespace                                   |
  | `ResolvedElement`                                                                       | `Element`                                                                 | reads as the sibling of `Xml.Element`                                          |
  | `SchemaReason`, `EncodeSchemaReason`                                                    | per R5                                                                    | the class name equals the tag                                                  |
  | `defaultMaxElementSize`, `defaultMaxElementNodes`                                       | dropped; the README states the values                                     | upstream keeps defaults private (`encoding/Xml.ts:550`)                        |
  | `element`, `namespaces`, `suspend`, `text`, `elements`, `mixed`, `clark`, other reasons | unchanged                                                                 | no collision inside a namespace; `suspend` keeps its name argument (section 5) |

- Blast radius: `src/index.ts` and a new namespace module. Every importer of the entry point (from `grep -rlE 'src/index(\.ts)?"' src test --include='*.ts'`): `test/qti/errors.test.ts`, `mixed.test.ts`, `open.test.ts`, `vocabulary.test.ts`, `vocabulary.ts`, `test/readme.test.ts`, `test/streaming/decode.test.ts`, `positions.test.ts`, `vocabulary.ts`. Every README code block and the export table. `src/*.test.ts` import modules directly and change only where names change.
- Confidence: medium-high. The shape and the bundle size are proven. The member names are taste (O1).
- Breaking: yes.

### R5. Error surface: reason-union types, guards, and names equal to tags

- Evidence: Effect's reason errors export the reason union (`Sse.SseErrorReason` `Sse.ts:52`) and name each class after its tag (`Sse.EventTooLarge` `Sse.ts:37`). Encoding errors export an `is*` guard and a TypeId (`isXmlError` `encoding/Xml.ts:73`). `Effect.catchReason` and `catchReasons` (`Effect.ts:5144`, `:5360`) select by tag. A7, A28, MA items 7 and 28, Q8.
- Before:

  ```ts
  Effect.catchReason("XmlDecodeError", "Schema", (reason: SchemaReason) => ...);
  // the "Schema" tag maps to two classes; grepping the tag finds neither
  type Reason = XmlDecodeError["reason"]; // no exported name
  ```

- After:

  ```ts
  Effect.catchReason("XmlDecodeError", "SchemaFailure", (reason: XmlSchema.SchemaFailure) => ...);
  type Reason = XmlSchema.DecodeErrorReason;
  if (XmlSchema.isDecodeError(u)) ...
  ```

- Scope: one class per tag, with the class name equal to the tag. The decode and encode variants split only where their field sets differ (`elementPath` exists on decode only). Bug 4's `Limit` routing lands in the same file. Optionally, `DefinitionError` becomes a plain `Error` subclass, because it is only ever thrown (A16, O10).
- Blast radius: `src/issue.ts`, `src/index.ts`; `src/issue.test.ts`, `src/codec.test.ts`, `test/qti/errors.test.ts`; README error section (line 108).
- Confidence: high, as a type-level change plus guards.
- Breaking: only the reason renames. The union types and guards are additive.

### R6. Pass `parseOptions` through

- Evidence: `Schema.decodeUnknownEffect(schema, options?: ParseOptions)` (`Schema.ts:1535`), `Csv.decodeSchemaString(schema)(options, parseOptions)` (`Csv.ts:830`), `Sse.decodeSchema(schema, options, parseOptions)` (`Sse.ts:196-202`). Ndjson takes none, so the idiom is common but not universal. A11, MA item 11. The spike found that carrier B ignores `errors: "all"` because today's decode takes no `ParseOptions`; `transformEffect` already hands them to the decode callback.
- Before: `decodeString(Root, { maxElementSize })(xml)`; no way to request `errors: "all"` or `onExcessProperty`.
- After: `Schema.decodeUnknownEffect(XmlSchema.fromString(Root), { errors: "all" })(xml)` honors it, and the streaming factory takes `decodeSchemaString(Root, path)(options, { errors: "all" })`.
- Blast radius: `src/codec.ts` (thread options to the root codec decode); one test per entry point; README options table.
- Confidence: medium-high. The pass-through point exists, but how `errors: "all"` maps onto one positioned `XmlDecodeError` (first issue or all issues) needs a ruling during implementation.
- Breaking: no.

### R7. `equivalence(Root)` in place of `canonicalize` + `normalizedNames`

- Evidence: Effect expresses equality under a rule as an `Equivalence` (`Schema.toEquivalence` `Schema.ts:18064`, `Equivalence.mapInput` `Equivalence.ts:591`). A5, A35, Q5.
- Spike Q5: `Equivalence.mapInput(Equivalence.strictEqual<string>(), (el) => canonicalize(el, { normalize: normalizedNames(def) }))`, 5 lines. It agrees with today's README check on both inputs and reports `false` for an added attribute.
- Before:

  ```ts
  const normalize = normalizedNames(ChoiceInteraction);
  canonicalize(before, { normalize }) === canonicalize(after, { normalize });
  ```

- After:

  ```ts
  const equivalent = XmlSchema.equivalence(ChoiceInteraction);
  equivalent(before, after);
  ```

- Blast radius: `src/canonical.ts`, `src/index.ts`. Tests calling `canonicalize(` (from the grep above): `src/canonical.test.ts`, `src/codec.test.ts`, `test/qti/open.test.ts`, `test/qti/vocabulary.test.ts`, `test/readme.test.ts`, `test/round-trip.test.ts`. README Round trip (lines 121-137).
- Confidence: high that the two checks agree (it is the same comparator). Low on whether `canonicalize` must stay public as a printer for diffs (O5).
- Breaking: yes if `canonicalize`/`normalizedNames` leave the public surface.

### R8. Option-bag polish

- Evidence: Effect option fields are `?: T | undefined` (`encoding/Xml.ts:254-255`, `:273`). Options are named types (`Csv.ts:124`). `Xml.decodeString` takes `maxTokenSize` and `maxDepth` (`encoding/Xml.ts:253-256`, `:334`). A21, A22, A23.
- Before: `decodeString(Root, { maxDepth: 64 } as any)` is accepted, but the field is ignored (A21). `encodeString(Root, { declaration: undefined })` fails under `exactOptionalPropertyTypes`.
- After: the whole-document entry takes the same parser limits as the streaming one. Every option field is `?: T | undefined`. `encodeString` options become a named `EncodeOptions`. The default constants are unexported (with R4).
- Blast radius: `src/codec.ts` types and the whole-document limit plumbing, `src/resolve.ts` and `src/index.ts` (defaults); `src/codec.test.ts`, `src/resolve.test.ts`, `test/streaming/decode.test.ts` (defaults); README Limits table.
- Confidence: high.
- Breaking: no, except unexporting the defaults.

### Not recommended now

- Slot cardinality written with Schema's own words, so a slot accepts `Schema.Array(E)` and `Schema.optionalKey(E)` (Q6): not spiked. R4 takes only the names `XmlSchema.Array` and `XmlSchema.optionalKey`.
- Streaming and byte encode (A13, W11): defer until a consumer needs one. The goal requires streaming reads only.
- A Schema-annotation authoring form, `XmlSchema.Element(name, Schema.Struct(...))` (A34): Effect has no precedent for it, because `toEncoderXml` has no attribute concept (`Schema.ts:18700-18731`).

## 5. Keep as is

| Keep                                                                       | Why                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Option bags for limits and `positions`, not `Layer` or `Context.Reference` | No encoding module reads codec limits from context. `References.ts` holds only logging and tracing references, and `Xml.ts:253`, `:272` take bags. A Layer would wrap no service and no resource.                                 |
| `Schema.TaggedError` with `reason` and `catchReason`                       | This is the documented idiom (`ai-docs/src/01_effect/04_errors/20_reason-errors.ts`, `Effect.ts:5144`), and `node_modules/effect/AGENTS.md:45` says to use `Schema.TaggedError`. R5 polishes names and guards; the pattern stays. |
| `suspend(name, thunk)` keeps its name argument                             | Dispatch and prefix expansion need the name before the thunk is forced. `Schema.suspend(f)` (`Schema.ts:5180`) cannot supply it, so A4 is wrong (MA item 4). Document the difference; the namespace removes the import collision. |
| `ResolvedElement`'s shape                                                  | It is identical to `Xml.Element` (`encoding/Xml.ts:228`) with Clark names. R4 only renames it to `Element`. Branding Clark against as-written names has no Effect precedent (A18); owner call if wanted.                          |
| `namespaces` returning bound builders                                      | The same "bind configuration once" shape as `VariantSchema.make` (`schema/VariantSchema.ts:428`).                                                                                                                                 |
| The `attributes`/`content` spec bag on `element`                           | `Struct` cannot say which keys are attributes and which are children (D5). The annotation form has no precedent (section 4).                                                                                                      |
| `mixed` as a name, and whitespace runs kept in `mixed`                     | XSD vocabulary, and the fidelity promise (README line 116). The same as upstream `Xml.elements` (W8).                                                                                                                             |
| Clark-name path steps                                                      | After namespace resolution, an as-written prefix path cannot identify an element (MA item 14). Bug 2 adds validation; the dialect stays.                                                                                          |
| Stored `message`, the two locators, causes held with `Schema.declare`      | `Xml.XmlError` itself stores `message` (`encoding/Xml.ts:51-53`). Both locators are documented. `Schema.Defect()` would erase the cause's type (A25-A27, judged taste).                                                           |
| Attributes closed under `open: true`                                       | Documented (README line 115). An attribute rest slot is a feature want for round-trip editors, outside the goal's scope (W9).                                                                                                     |
| No pretty-print on encode                                                  | The sibling `Xml.encodeString` (`encoding/Xml.ts:511`) takes no layout options. `toEncoderXml`'s `pretty` makes no fidelity promise (W6).                                                                                         |
| Spans and debug logs on the effectful entry points                         | Required by the trace-effect directive in `AGENTS.md`. The spike showed the `xml.decodeString` span survives inside `fromString`.                                                                                                 |
| `clark(namespace: Option<string>, local)`                                  | Follows the `Option`-over-`undefined` idiom for absence.                                                                                                                                                                          |

## 6. Open decisions for the owner

| #   | Decision                                            | Options                                                                                                                                                                                                                                                  | Planner default                                                                                               |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| O1  | Exact names                                         | Namespace `XmlSchema` (or `XmlCodec`); `fromString` (or `fromXmlString`, `XmlString`); `Array`/`optionalKey` (or keep `many`/`optional`); `DecodeError`/`EncodeError`; `Element`; `equivalence`; the error extractor (`decodeErrorOf`, `getDecodeError`) | The spike's names: `XmlSchema`, `fromString`, `Array`, `optionalKey`, `DecodeError`, `Element`, `equivalence` |
| O2  | `decodeString`/`encodeString`/`decodeTree` after R2 | Drop them (one way in, through Schema); keep them as Effect entries that fail with `XmlDecodeError` for `catchTag` users                                                                                                                                 | Drop, and export the extractor                                                                                |
| O3  | Malformed UTF-8 on bytes with positions under R3    | Accept U+FFFD through `Channel.decodeText`; keep today's `WellFormedness` "invalid UTF-8" with a fatal decoder channel                                                                                                                                   | Keep today's failure (fatal channel), since silent replacement fails open                                     |
| O4  | Release grouping                                    | R1-R8 in one breaking release; R1, R5-R8 first, then R2-R4 together                                                                                                                                                                                      | Bugs and R1/R5/R6 first; R2/R3/R4/R7 as one rename release                                                    |
| O5  | `canonicalize` after R7                             | Internal only; public as a debug printer                                                                                                                                                                                                                 | Internal                                                                                                      |
| O6  | Bug 5 fix                                           | Text runs tagged `"#text"`; reject a member named `text`                                                                                                                                                                                                 | `"#text"`, which keeps SVG `<text>` usable                                                                    |
| O7  | Bug 1 fix                                           | Reject the key collision at definition time; give attributes their own namespace in the decoded value                                                                                                                                                    | Reject at definition time                                                                                     |
| O8  | Bug 3 fix                                           | Thread `RD`/`RE` through types and entry points; restrict attribute and text schemas to service-free codecs                                                                                                                                              | Thread them, on R1's carrier                                                                                  |
| O9  | Bug 4 reason shape                                  | Widen `Limit` (`maxDepth`, `maxTokenSize`, optional `element`); add an upstream-cause reason; give `Unsupported` its own reason                                                                                                                          | Widen `Limit`, and add an `Unsupported` reason                                                                |
| O10 | `DefinitionError` base                              | Keep `Data.TaggedError`; plain `Error` subclass                                                                                                                                                                                                          | Plain `Error` subclass                                                                                        |

## 7. Owner addition: R9, a pluggable tokenizer service

Source: `work/owner-directive-tokenizer-seam.md` (2026-11-05). R9 is the seam only; a custom tokenizer comes in the performance phase (want `86a9ce88`).

- `XmlSchema.Tokenizer` is a `Context.Reference<Tokenizer>` keyed `"@aidenzepp/effect-xml/Tokenizer"`, defaulting to `effect/encoding/Xml` (`Context.ts:2080-2125`). The default needs no Layer and adds nothing to `R`. Override with `Effect.provideService(XmlSchema.Tokenizer, impl)` or `Layer.succeed`.
- `Tokenizer` (interface) is the upstream interface the library uses: the `decode`, `decodeString`, `encode` and `encodeString` channels, their options and limits, the event types, and `XmlError` with its kinds and line/column rules (`elements` only if the library calls it). Outside the default, no module calls `Xml.*` directly.
- A conformance suite parameterized by a `Tokenizer` (interface) runs against the default in the ladder, covering the pinned upstream behavior (`test/upstream-xml.test.ts`) and the library's round-trip and error-path expectations. One test proves an override is the tokenizer actually used.
- Lands with R2 and R3, before R4.

### Ruling: native positions are an optional capability

Decided by the Mind on 2026-11-05 under the owner directive.

- `Tokenizer` (interface) declares an optional capability, `positions: "native" | "none"` (absent means `"none"`). A `"native"` tokenizer, when asked for positions, sets `line` and `column` (1-based, the `<` of the start tag, upstream `XmlError` counting rules) on each `StartElement`. This is the shape proposed in Effect-TS/effect#10400.
- When positions are requested and the tokenizer is `"native"`, the library reads them from the events and skips the locate scanner and the position-tracking channel. Otherwise it keeps today's paths. The default (`effect/encoding/Xml` 4.1.2) is `"none"`.
- The conformance suite checks native positions against the locate scanner's positions on the same inputs when a tokenizer declares `"native"`.
- Why: a performance-phase tokenizer already knows every offset, so native positions remove the ~10x positions-mode cost the README documents. The default path does not change.

### Ruling: the tokenizer interface is named `Tokenizer`

Decided by the Mind on 2026-11-05. The interface and the `Context.Reference` share one name, `Tokenizer`, as Effect does for `Clock`, `Console` and `Random` (`Clock.ts:53`, `:192`). The directive's working name `TokenizerShape` fails the repository lint rule `anti-slop/no-shape-in-symbol-names`, which reports every identifier containing "shape", including imports, so keeping it would need a suppression at every use.

## 8. Casing audit (owner addendum, 2026-11-05)

Rule, from `node_modules/effect/src/Schema.ts` at 4.1.2: a function that **builds a schema from parts or from non-schema configuration** is PascalCase and carries a declaration-merged namespace for its helper types (`Struct` `:3597` with `namespace Struct` `:3356`; `Record` `:4024` with `:3802`; `Union` `:4994`; `Literal` `:2743`; `TaggedStruct` `:6324`). A function that **takes a schema and returns a modified or derived one** is lowercase (`optionalKey` `:2406`, `decodeTo` `:5678`, `brand` `:5319`, `suspend` `:5180`, `fromJsonString` `:9875`, `toEquivalence` `:18064`). Ready-made schemas are PascalCase constants (`UnknownFromJsonString` `:9886`, `NumberFromString` `:10288`).

| Today                                                                                                      | Ruling                                                                                                                                                                                                     | Why (citation)                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `element(name, spec)`                                                                                      | **`Element(name, spec)`**, helper types under `Element.*` (`Element.Attributes`, `Element.Content`, `Element.Services`, `Element.Child`, `Element.Children`, `Element.SlotServices`, `Element.IsOptional`) | builds a schema from parts, like `Struct` (`:3597`, `:3356`)                                                                                                                                                      |
| type `Element` (the resolved tree)                                                                         | **`ResolvedElement`** (owner default)                                                                                                                                                                      | frees `Element` for the constructor; it is the library's resolved sibling of `Xml.Element` (`encoding/Xml.ts:228`), and "resolved" is the distinction that matters (Clark names)                                  |
| `Namespaces.element` (bound builder)                                                                       | **`Namespaces.Element`**                                                                                                                                                                                   | same constructor, bound to a prefix map                                                                                                                                                                           |
| `namespaces(map)`                                                                                          | keep                                                                                                                                                                                                       | returns builders, not a schema; lowercase like `VariantSchema.make` (`schema/VariantSchema.ts:428`)                                                                                                               |
| `suspend(name, thunk)`                                                                                     | keep                                                                                                                                                                                                       | lowercase like `Schema.suspend` (`:5180`); keeps its name argument (section 5)                                                                                                                                    |
| `text(S)`, `elements({...})`, `mixed([...])`                                                               | keep                                                                                                                                                                                                       | they return content specs consumed by `Element`, not schemas; the closest Effect analogue is the lowercase field marker `optionalKey` (`:2406`), which is meaningful only inside `Struct`                         |
| `optionalKey(E)`                                                                                           | keep                                                                                                                                                                                                       | same word and casing as `Schema.optionalKey` (`:2406`)                                                                                                                                                            |
| `Array(E)`                                                                                                 | keep (flagged)                                                                                                                                                                                             | O1 chose the Schema word; it returns a slot marker, not a schema, so it is the one place the casing follows the word rather than the rule. The hater pass below weighs it.                                        |
| `fromString(Root)`                                                                                         | keep                                                                                                                                                                                                       | takes a schema and derives one, like `fromJsonString` (`:9875`)                                                                                                                                                   |
| `ElementFromString(prefixes)`                                                                              | keep                                                                                                                                                                                                       | builds a schema from non-schema configuration, like `Literal(value)` (`:2743`); reads like `UnknownFromJsonString` (`:9886`)                                                                                      |
| `equivalence(Root)`                                                                                        | keep (flagged)                                                                                                                                                                                             | lowercase derivation; Effect names derivations `to*` (`toEquivalence` `:18064`), but this compares resolved trees under the definition's normalization, not values of `T`. The hater pass weighs `toEquivalence`. |
| `clark(ns, local)`                                                                                         | keep                                                                                                                                                                                                       | a string helper, not a schema                                                                                                                                                                                     |
| `decodeSchema`, `decodeSchemaString`, `decodeErrorOf`, `encodeErrorOf`                                     | keep                                                                                                                                                                                                       | functions, lowercase like `Ndjson.decodeSchema` (`encoding/Ndjson.ts:439`)                                                                                                                                        |
| `DecodeError`, `EncodeError`, reason classes, `DefinitionError`, `Tokenizer`, `ElementCodec`, `XmlElement` | keep                                                                                                                                                                                                       | classes, services, and types are PascalCase                                                                                                                                                                       |

A cold hater pass on this surface runs before the build; its result is recorded below.

### Hater pass on the casing surface (2026-11-05)

Raw report: `work/effect-native/hater-casing.md` (Effect-maintainer persona, 19 items, cold read of the proposed surface only). Mind triage:

Adopted (built in slice `enf-4`):

- **The interface takes its constructor's name** (hater 3, 10). Effect pairs `interface Struct` with `function Struct` (`Schema.ts:3492`/`:3597`), `interface optionalKey` with `const optionalKey` (`:2358`/`:2406`), and exports `$Array` as `Array` (`:4654`, `:4698`). So `ElementCodec` becomes `interface Element<Name, T, RD, RE>`, merged with the `Element` constructor and its namespace; the spec types become `text`, `elements`, `mixed`, `optionalKey` and `Array` (was `Text`, `Elements`, `Mixed`, `Optional`, `Many`). `Empty` stays: it has no constructor.
- **`Element.*` uses `Struct.*` vocabulary** (hater 9). Constraints live in the namespace (`Struct.Fields`, `:3363`): the top-level `Attributes` and `Content` constraint types move to `Element.Attributes` and `Element.Content`. Derived types take a `Type` suffix (`Element.AttributesType<A>`, `Element.ContentType<C>`), and services split by direction like `Struct.DecodingServices`/`EncodingServices` (`:3450`, `:3460`): `Element.DecodingServices<A, C>` and `Element.EncodingServices<A, C>` replace `Element.Services<A, C, K>`, with the slot helper split the same way. No top-level duplicates remain.

Kept, with the reason:

- `XmlSchema` (hater 1), `fromString` (hater 2), `Array`/`optionalKey` (hater 4), `decodeErrorOf` (hater 13), and class names `DecodeError`/`EncodeError` with tags `"XmlDecodeError"`/`"XmlEncodeError"` (hater 6) are the owner's O1 names.
- `ElementFromString(prefixes)` (hater 2): Effect has PascalCase functions of non-schema configuration that build a schema, not only constants (`Literal` `:2743`, `TemplateLiteral`, `OptionFromNullOr` `:16154`).
- `equivalence` (hater 5): `toEquivalence(schema)` (`:18064`) promises an `Equivalence<T>` over decoded values; this compares `ResolvedElement` trees under the definition's normalization, so borrowing the `to` name would mislead.
- `elements` vs `Xml.elements` (hater 7): different namespaces and roles (a content spec versus a record channel).
- Three element-tree types (hater 8): `XmlElement<Name>` is the encoded carrier, `ResolvedElement` the Clark-named tree, `Xml.Element` upstream's prefixed tree; the README names each role.
- `WellFormedness` (hater 11): an existing reason name outside this batch's scope.
- The positional record path in `decodeSchemaString(def, path)` (hater 12): it follows `Xml.elements(path)` (`encoding/Xml.ts:438`) and the R3 spike.
- `suspend(name, thunk)` (hater 14) and `clark` (hater 17) are section 5 keeps. `$text`/`$children` (hater 15) are the owner's ruling 3. `namespaces` (hater 16) and `DefinitionError` (hater 18, O10) stay.

### Ruling: the extractors are named `find*` and `find*Option`

Decided for 0.2.0 under issue #1. `decodeErrorOf` and `encodeErrorOf` moved to `findDecodeErrorOption` and `findEncodeErrorOption`, and `findDecodeError` and `findEncodeError` return the `Result` form that fails with the input issue. Why: `Cause` and `Exit` name this kind of extraction `findError` (`Result`) and `findErrorOption` (`Option`), and no Effect `*Of` export searches a failure at runtime. The earlier lines here that name `decodeErrorOf` record what was decided before this ruling.

## Issue #3: `XmlSchema.Array` becomes `XmlSchema.many`

Ruling (2026-11-09): rename `XmlSchema.Array` to `XmlSchema.many`. No alias.

Reason: `many` is already the helper in `src/plan.ts`, its interface, and the marker's `cardinality` value, and the caller-facing message in `src/compile.ts` already says "declare the slot as many", so no other identifier changes. Lowercase follows the casing audit's rule for non-schema content markers (`text`, `elements`, `mixed`; section 8) and clears its `Array` exception. Parser-combinator `many` is zero-or-more (`many1` is one-or-more).

Names weighed in a cold hater pass (Effect 4 developer persona): `zeroOrMore` was least surprising but implies `oneOrMore`/`optional` siblings that do not exist; `many` is moderate, with a 0+ versus 1+ ambiguity; `variadic` is most misleading (a CLI argument term, `effect/src/cli/Param.ts:2090`); `arrayKey` misreads Effect's `*Key` family. The ambiguity is answered in the JSDoc and README: zero or more, the key is always present, and it holds an empty array when none match.

### Ruling: export names of the channel errors (issue #5, 2026-11-09)

Option (b): `XmlSchema.XmlDecodeError` and `XmlSchema.XmlEncodeError` are the exports. The classes, the tags `"XmlDecodeError"` and `"XmlEncodeError"`, and every serialized `_tag` stay. This supersedes the earlier `DecodeError`/`EncodeError` export names above, which stay as history.

Why: a tag is the runtime dispatch key in the caller's merged error union and no namespace scopes it, while the export name is already scoped by `XmlSchema`. Every reason-carrying `TaggedError` in effect 4.1.2 has a module-qualified tag and repeats the module name in its export (`Xml.XmlError` at `effect/src/encoding/Xml.ts:51`, `Schema.SchemaError` at `Schema.ts:1219`, `Sse.SseError`, `Ndjson.NdjsonError`); short tags appear only on reason classes. Option (a) would give a channel-level error the `"DecodeError"`/`"EncodeError"` tags effect already uses for `HttpClientError` and `GraphQLClientError` reasons (`http/HttpClientError.ts:148`, `:262`; `graphql/GraphQLClientError.ts:329`, `:363`), so a caller that lifts a reason would match both with one `catchTag`. Option (b) changes no tag literal; option (a) changes 93.

Guards (`isDecodeError`, `isEncodeError`), reason types and `src/issue.ts` are unchanged and tracked separately.

### Ruling: `unwrapDecodeError` moves the stored decode error into the error channel

Decided for 0.2.0 under issue #4, option 1 of the three the issue lists. `XmlSchema.unwrapDecodeError` is a pipeable combinator over an effect whose error channel holds `Schema.SchemaError`: `<A, E, R>(self: Effect<A, E, R>) => Effect<A, E | XmlDecodeError, R>`, and a call on an effect with no `SchemaError` in its channel is a type error. At runtime a `SchemaError` whose issue stores an XML decode error (found as `findDecodeErrorOption` finds it) is replaced by that error; any other `SchemaError`, and every other error, passes through as the same instance. The README failure example is one step: decode, `unwrapDecodeError`, `catchReason`.

Why: a spike (throwaway branch `spike-4-decode-error-shape` at `1115d89`) type-checked all three options. Option 1 keeps Schema as the only decode path, so decision O2 stands; it composes when the codec is a struct field or sits under `Schema.fromJsonString`; it works with `catchReason`, `catchTag` and `unwrapReason`; and it keeps the non-string failure honest by returning the same `SchemaError`. Option 2, a `decodeEffect` entry point, reverses O2, is not a Schema, and collides in name with `Schema.decodeEffect`; a cold hater read it as the most third-party-wrapper-like. Option 3, a `catchDecodeReason` helper, leaves the channel at `SchemaError`, so `catchTag("XmlDecodeError")` stays a type error, and the hater found its types opaque. The hater distrusted option 1 most, for two reasons: "unwrap" suggests narrowing while the channel widens, and a generic `E` hides a runtime `SchemaError` match. The `SchemaError` constraint answers the second; the JSDoc answers the first by stating that the channel keeps `SchemaError` because a failure with no XML error, such as a non-string input, is real. The hater's own pick was option 2, with option 3 close; the owner may override before merge.
