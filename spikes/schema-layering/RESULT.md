# SPIKE-06 schema layering mechanism

Throwaway R&D spike. Spec: `docs/rd/spike-plan.md` section SPIKE-06; branch `docs/rd/branches/schema-layering.md`; criteria `docs/rd/criteria.md`. Fixture: `spikes/fixtures/qti/bg010-missing-word.xml`, element `qti-response-declaration` (three attributes, one `qti-correct-response` child holding repeated `qti-value` text children, one `qti-mapping` child holding repeated `qti-map-entry` children with numeric and boolean attributes).

## Question

Given a definition, by what mechanism do decode and encode run on top of Effect Schema: one `Element -> value` transformation per definition (A), or a Config-style rewrite of the definition's AST against an XML cursor (B)? And does B's walk need anything a closed IR (C) would not already carry?

## Approaches compared

Both approaches decode the same target shape (`identifier` branded string, `baseType` string, `cardinality` literal union, `correctResponse.values: Array<string>`, optional `mapping` with `defaultValue: Finite`, `entries: Array<{ mapKey, mappedValue: Finite, caseSensitive?: Boolean }>`) from the upstream `Xml.Element` tree obtained with `Xml.elements(["qti-assessment-item", "qti-response-declaration"])`.

**A** (`approach-a.ts`). `ElementSchema` is a recursive `Schema.Struct` over `Xml.Element`. The definition is `ElementSchema.pipe(Schema.decodeTo(Schema.toCodecStringTree(ResponseDeclaration), { decode, encode }))`. The getter pair reshapes `Element <-> StringTree` by hand (`elementToTree`, `treeToElement`); typed leaves (`Finite`, `Boolean`, `Literals`) are decoded by the StringTree codec, not by the getter. Decode is `SchemaParser.decodeEffect(codec)(element)`, encode is `SchemaParser.encodeEffect(codec)(value)` and yields an `Element`.

**B** (`approach-b.ts`). The consumer writes one `Schema.Struct` with key annotations (`attribute("base-type")`, `child("qti-mapping")`, `children("qti-value")`, `text()`) and an element-name annotation. `xmlCodec(schema)` runs `Schema.toCodecStringTree(schema)`, rewrites that AST with `toXmlCursorAST` so each `Objects`, `Arrays`, scalar `Union` and leaf gets a `SchemaAST.decodeTo(SchemaAST.unknown, node, Transformation(transformEffect(readCursor), passthrough()))` link reading from an XML cursor (`Element | Elements | Scalar`, each carrying its XML path), then parses with `SchemaParser.decodeUnknownEffect(Schema.make(rewritten))`. Encode is a mirror walk over the type-side AST and the `StringTree` produced by `SchemaParser.encodeEffect(toCodecStringTree(schema))`, emitting `Xml.Event`s. A third walk, `xmlIssue`, re-points `SchemaIssue.Pointer` segments from struct keys to XML names using the same annotations.

B departs from `Config.ts:1089-1153` in one way: Config's `applyToSelfOrLastLinkEncoding`, `replaceEncoding`, `Objects.recur` and `getIndexSignatureKeys` are `@internal` (present at runtime, absent from `dist/SchemaAST.d.ts`), so the spike rebuilds composite nodes through the public constructors (`new SchemaAST.Objects(...)`, `Arrays`, `Union`, `Suspend`, `PropertySignature`) and appends the cursor link with the public `SchemaAST.decodeTo`. Composite nodes that already carry an encoding chain (a `Schema.Class`, a `Struct.pipe(decodeTo(...))`) are reported as unsupported instead of descended into.

## Per-criterion scores

| Criterion                     | A                                                                                                                                                                                 | B                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 one definition, both ways  | **0** as implemented (gate). The struct is declared once, but `elementToTree` (25 lines) and `treeToElement` (55 lines) are hand-written mappers, one per element, per direction. | **5**. The annotated struct is the only declaration; decode and encode are derived from its AST.                                                                                                                                                                                      | Tests `A: encode returns an Element canonically equal to the input`, `B: encode emits events that round-trip to an equal Element`, `B: the same definition decodes and encodes (C1)`. Line counts below. |
| C2 attribute typing incl data | **3**. `identifier` branded, `mapped-value`/`default-value` `Finite` (bad `"x"` is a Schema issue), `case-sensitive` boolean codec; all stringify on encode. `data-*` not done.   | **3**. Same three; `data-*` would be an `Objects.indexSignatures` entry, which the walk reports as unsupported (Config reads them with the internal `getIndexSignatureKeys`).                                                                                                         | Test `attribute type failure: issue paths` (`Expected a string representing a finite number`); B encoded output shows `mapped-value="0.5" case-sensitive="true"`.                                        |
| C9 code outside primitives    | **5**. 19 library-side lines (`ElementSchema`, `childElements`, `textOf`). The 98 getter lines are consumer-side and count against verbosity, not C9.                             | **3**. 353 library-side lines: annotations and helpers 32, cursor and AST rewrite 180, event encoder 60, issue translation 50, codec 31. Each piece names the Effect API checked and the gap it fills (section "Code outside primitives").                                            | `grep -cvE '^\s*(//.*)?$'` over the file sections; numbers in "Line counts".                                                                                                                             |
| C10 error quality, path only  | **2**. Default Schema message plus a path in output-type keys: `at ["mapping"]["entries"][0]["mappedValue"]`. Nothing in A knows the XML names once the getter has run.           | **3**. Default message plus an XML-shaped path from `xmlIssue`: `at ["qti-mapping"]["qti-map-entry"][0]["@mapped-value"]`, `at ["@cardinality"]`, `at ["qti-correct-response"]` for the missing child. No line/column (not available from `Xml.elements`, `effect-substrate.md` 1.4). | Tests `attribute type failure: issue paths` and `bad literal and missing child: issue paths`; output pasted below.                                                                                       |
| C3-C8                         | n/a                                                                                                                                                                               | n/a                                                                                                                                                                                                                                                                                   |                                                                                                                                                                                                          |

Context only (not scored here, C8 belongs to SPIKE-05): the consumer definition is 21 lines in A plus 98 lines of getters, and 23 lines in B.

## Deciding evidence

Command and run:

```sh
$ bun test spikes/schema-layering
bun test v1.4.2 (744846f84)

spikes/schema-layering/layering.test.ts:
B visited AST tags: Objects, String, Union, Arrays, Number, Boolean
A issue:
Expected a string representing a finite number
  at ["mapping"]["entries"][0]["mappedValue"]
B issue (raw):
Expected a string representing a finite number
  at ["mapping"]["entries"][0]["mappedValue"]
B issue (xml path):
Expected a string representing a finite number
  at ["qti-mapping"]["qti-map-entry"][0]["@mapped-value"]
cardinality=x A:
Expected "single" | "multiple" | "ordered" | "record"
  at ["cardinality"]
cardinality=x B (xml path):
Expected "single" | "multiple" | "ordered" | "record"
  at ["@cardinality"]
no qti-correct-response A:
Missing key
  at ["correctResponse"]
no qti-correct-response B (xml path):
Missing key
  at ["qti-correct-response"]
B encoded:
<qti-response-declaration identifier="RESPONSE" base-type="string" cardinality="single"><qti-correct-response><qti-value>winter</qti-value></qti-correct-response><qti-mapping default-value="0"><qti-map-entry map-key="winter" mapped-value="1" case-sensitive="true"></qti-map-entry><qti-map-entry map-key="Winter" mapped-value="0.5"></qti-map-entry></qti-mapping></qti-response-declaration>

 8 pass
 0 fail
 15 expect() calls
Ran 8 tests across 1 file. [161.00ms]
```

Tests executed: 8.

Type check (the conventions-block command needed two extra flags under the pinned `typescript@7.0.2`; see open questions):

```sh
$ bun x tsc --noEmit --strict --skipLibCheck --module nodenext --moduleResolution nodenext --types bun --ignoreConfig --allowImportingTsExtensions spikes/schema-layering/*.ts
$ echo $?
0
```

Format: `bun x vp fmt --check spikes/schema-layering` reports `All matched files use the correct format.`

### Issue paths

Both approaches produce the same raw `SchemaIssue` tree, because in both the typed leaves are parsed by the StringTree codec after the XML has been turned into a plain value: `Composite(Objects) > Pointer(["mapping"]) > ... > Pointer(["mappedValue"]) > Encoding(Number) > Composite(String) > Filter > InvalidValue`. The branch note's claim that B "yields paths in the input shape" is not what the parser does: `Pointer` segments are the struct's property keys in both. B earns its XML path because the annotations that drive the cursor walk are on the AST, so a 50-line post-pass can translate every `Pointer` segment (`mappedValue` to `@mapped-value`, `entries` to `qti-map-entry`, `correctResponse` to `qti-correct-response`). A has no per-key metadata to translate with.

### AST tags B had to handle

| `_tag`                                                                                              | Handled in `toXmlCursorAST`                                                                | Exercised by the fixture | Note                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Objects`                                                                                           | yes: rebuild property types, append cursor link, `materializeObject` reads by annotation   | yes                      | `indexSignatures` passed through untouched and reported as unsupported (blocks `data-*`).                                                                             |
| `Arrays`                                                                                            | yes: rebuild `elements`/`rest`, `materializeArray` indexes an `Elements` cursor            | yes                      |                                                                                                                                                                       |
| `Union`                                                                                             | scalar unions (all members scalar) read as one leaf; other unions rebuilt member by member | yes (scalar: `Literals`) | Non-scalar unions not exercised; Config does the same split (`Config.ts:1137-1141`).                                                                                  |
| `Suspend`                                                                                           | yes: rebuilt with a recurring thunk                                                        | no                       |                                                                                                                                                                       |
| `String`, `Number`, `Boolean`                                                                       | yes: leaf, `readScalar`                                                                    | yes                      | `Number` arrives as `Number` with an encoding link to `String` (from `toCodecStringTree`); appending the cursor link at the node gives `Number <- String <- unknown`. |
| `Literal`                                                                                           | leaf (reached only through `Union`)                                                        | indirectly               |                                                                                                                                                                       |
| `Declaration`, `Any`, `Unknown`, `ObjectKeyword`                                                    | no: reported as unsupported                                                                | no                       | Config throws for `Declaration`/`Any` (`Config.ts:1149-1151`). A `Schema.Class` is a `Declaration`.                                                                   |
| any composite with `encoding`                                                                       | no: reported as unsupported                                                                | no                       | Config descends with `applyToSelfOrLastLinkEncoding` (`@internal`).                                                                                                   |
| `Null`, `Undefined`, `Void`, `Never`, `BigInt`, `Symbol`, `UniqueSymbol`, `Enum`, `TemplateLiteral` | default leaf branch, untested                                                              | no                       |                                                                                                                                                                       |

### `@stability` of every primitive used

Source lines are in `node_modules/effect/src` at `effect@4.1.2`.

| Symbol                                                                                                                                                                                          | Stability                           | Where                                                                                                      | Used by                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `Schema.Struct`, `Schema.Array`, `Schema.String`, `Schema.Boolean`, `Schema.Finite`, `Schema.Literals`, `Schema.optionalKey`, `Schema.suspend`, `Schema.Union`, `Schema.Record`, `Schema.brand` | stable                              | `Schema.ts:3597`, `:4698`, `:3114`, `:3214`, `:7505`, `:5040`, `:2406`, `:5180`, `:4994`, `:4024`, `:5319` | A, B                                  |
| `.annotate`, `.annotateKey`                                                                                                                                                                     | stable                              | `Schema.ts:684`, `:752`                                                                                    | B                                     |
| `Schema.decodeTo`                                                                                                                                                                               | stable                              | `Schema.ts:5678`                                                                                           | A                                     |
| `Schema.toCodecStringTree`                                                                                                                                                                      | stable                              | `Schema.ts:18441`                                                                                          | A, B                                  |
| `Schema.make`                                                                                                                                                                                   | stable                              | `Schema.ts:2340`                                                                                           | B                                     |
| `Schema.SchemaError` (formatting only)                                                                                                                                                          | stable                              | `Schema.ts:1219`                                                                                           | test                                  |
| `SchemaParser.decodeEffect`, `encodeEffect`, `decodeUnknownEffect`                                                                                                                              | stable                              | `SchemaParser.ts:306`, `:668`, `:270`                                                                      | A, B                                  |
| `SchemaAST.decodeTo`                                                                                                                                                                            | stable                              | `SchemaAST.ts:4591`                                                                                        | B                                     |
| `SchemaAST.unknown`                                                                                                                                                                             | stable                              | `SchemaAST.ts:1276`                                                                                        | B                                     |
| `new SchemaAST.Objects`, `Arrays`, `Union`, `Suspend`, `PropertySignature`                                                                                                                      | stable                              | `SchemaAST.ts:2858`, `:2337`, `:3732`, `:4022`, `:2673`                                                    | B                                     |
| `SchemaAST.AST` node fields `propertySignatures`, `indexSignatures`, `rest`, `elements`, `types`, `thunk`, `annotations`, `checks`, `encoding`, `context`, `encodingChecks`                     | stable (public fields)              | `SchemaAST.ts:2829-2832`, `:2307-2311`, `:3691-3693`, `:4001-4003`, `:686-694`                             | B                                     |
| `SchemaGetter.transformEffect`, `transform`, `passthrough`                                                                                                                                      | stable                              | `SchemaGetter.ts:930`, `:889`, `:684`                                                                      | A, B                                  |
| `new SchemaTransformation.Transformation`                                                                                                                                                       | stable                              | `SchemaTransformation.ts:198`                                                                              | B                                     |
| `new SchemaIssue.InvalidValue`, `Pointer`, `Composite`, `Encoding`                                                                                                                              | stable                              | `SchemaIssue.ts:768`, `:413`, `:600`, `:332`                                                               | A, B                                  |
| `Predicate.isObject`                                                                                                                                                                            | stable                              | `Predicate.ts:1251`                                                                                        | B                                     |
| `Xml.decodeString`, `Xml.elements`, `Xml.encodeString`, `Xml.Element`, `Xml.Event`                                                                                                              | **experimental** (since 4.0.6)      | `encoding/Xml.ts:334`, `:438`, `:511`, `:228`, `:206`                                                      | A, B                                  |
| `SchemaAST.applyToSelfOrLastLinkEncoding`, `replaceEncoding`, `Objects.recur`, `Arrays.recur`, `getIndexSignatureKeys`, `SchemaIssue.defaultFormatter`                                          | **@internal**, not in `dist/*.d.ts` | `SchemaAST.ts:4447`, `:4377`, `:2845`, `:2321`, `:2619`; `SchemaIssue.ts:1434`                             | not used (Config uses the first four) |

Probe output that settled the rewrite shape (transient script, run with `bun`): `toCodecStringTree(Decl).ast` keeps the type-side `Objects` with its `annotate` annotations and each key's `context.annotations` from `annotateKey`; `Int`/`Finite` become `Number` with `encoding: [Link(to: String)]`; `SchemaAST.toEncoded` of that tree also keeps both annotation sets because the `Objects` node itself has no encoding link. At runtime `typeof SchemaAST.applyToSelfOrLastLinkEncoding === "function"`, `typeof SchemaAST.replaceEncoding === "function"`, `typeof ast.recur === "function"`, `SchemaAST.memoize === undefined`.

### Evidence for or against C

Everything `materializeObject`, `materializeArray`, `readScalar`, the event walk and the issue translation consulted is: per key, its kind (attribute, child, children, text) and XML name; per struct, its element name; per array, its item type; per key, `context.isOptional` (used only by Schema itself for `MissingKey`). That is exactly `ElementSpec { name, attributes, children, text }` from the branch's C. The walk needed nothing beyond the IR. What the generic walk adds is that a plain annotated `Schema.Struct` is a valid element definition without a second producer, and that Schema's own union, optional and check machinery runs over the cursor-shaped value. What it costs is the `@internal` boundary: the exact helpers Config relies on are not public, the public-constructor rebuild covers `Struct`/`Array`/`Union`/`Suspend`/leaves but not composites with encoding chains (`Schema.Class`, transformed structs), and `data-*` through index signatures needs `getIndexSignatureKeys` or a reimplementation.

## What was not implemented

- `data-*` attributes (pattern-keyed index signature) in either approach.
- Composite nodes with an encoding chain (`Schema.Class`, `Struct.pipe(Schema.decodeTo(...))`) in B; they are reported in `rewrite.unsupported` rather than descended.
- Non-scalar unions, `Suspend`, and `Declaration` leaves in B are coded or reported but not exercised by the fixture.
- Compositional getters for A (the branch's load-bearing assumption that a DSL assembles the transformation from child definitions); the spike wrote them by hand, which is why A scores 0 on C1 as implemented.
- Positions on issues; `Xml.elements` drops line and column, so neither approach can report them.
- Namespaces, mixed content, whitespace policy (other spikes).

## Recommendation

B for decode and encode, built on the public, stable subset: `SchemaAST.decodeTo` plus node constructors, not Config's internal helpers. The provisional call (ledger D6) stands with one amendment: the "primitives Config uses are public" assumption is false for `applyToSelfOrLastLinkEncoding`, `replaceEncoding`, `recur` and `getIndexSignatureKeys`, and the public workaround does not reach composites that carry encoding links. That is a partial trigger of the reversal clause, not a full one: the walk over `Objects`/`Arrays`/`Union`/`Suspend`/leaves is stable and pinnable, and it is the walk the benchmark subset needs. Treat C's IR as the DSL's internal carrier for the cases B cannot reach (Class-based definitions, `data-*`), as the branch already proposed. A is not a mechanism on its own: without generated getters it fails the C1 gate, and the only way to generate them is an IR, which is C.

## Open questions

1. The conventions-block `tsc` command fails under `typescript@7.0.2` with `TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig'`, and relative `./x.ts` imports between spike files need `--allowImportingTsExtensions` (valid with `--noEmit`). Both flags were added; the conventions block should say which it wants (flags, or a per-spike `tsconfig.json`).
2. `Schema.decodeEffect` fails with `Schema.SchemaError`, not `SchemaIssue.Issue`; `SchemaParser.decodeEffect` yields the `Issue`. The spec's "prints the `SchemaIssue` path" assumed the latter; the spike switched A to `SchemaParser` so both approaches fail the same way. Worth settling which surface the library exposes.
3. The branch's claim that B's paths are "in the input shape" is not borne out by the parser; B gets XML paths by translation. If `error-reporting.md` depends on native input-shaped paths, that dependency needs restating as "translatable paths".
4. Composites with encoding chains in B: either accept `@internal` `replaceEncoding` behind a pinned version check, rebuild the chain through public constructors (not attempted), or route `Schema.Class` definitions through the IR. The spike did not decide.
5. B's encoder writes empty elements as `<qti-map-entry ...></qti-map-entry>` where the input was self-closing; the local comparator ignores it, and SPIKE-03 owns the canonical rule.
