# SPIKE-05 result: declaration surface

Throwaway R&D spike. Nothing here is library code; it answers `docs/rd/branches/declaration-dsl.md` against `docs/rd/criteria.md` on the QTI fixtures from SPIKE-00 (`302a9f1`).

## Question

What does a consumer write to say "this element has these attributes, these children in this content mode, and this text", such that one definition yields decode and encode, every attribute is Schema-validated, and the decoded type is inferred? Compared: annotations on ordinary Schema fields (A) versus a parallel object-form DSL (B), with the fluent facade (C) and convention-only mapping (D) scored by argument.

## Approaches compared

Both surfaces lower to the same `Plan` and the same compiler (`element-codec.ts`). The compiler produces a `Schema.Codec<T, Xml.Element>` from exactly one `Schema.decodeTo` per element: `ElementSchema` (a `Schema.declare` over the upstream `Xml.Element`) into a target `Schema.Struct` whose attribute and text fields are `Schema.toCodecStringTree(consumerSchema)` and whose child fields are the child element codecs (`Schema.Array`, `Schema.optionalKey`, or bare). The decode getter maps `Element` to the struct's `Encoded` (attribute strings, text, child `Element`s); the encode getter maps back. `data-*` is a `Schema.StructWithRest` rest record keyed by `Schema.TemplateLiteral(["data-", Schema.String])`. Mixed content is `Schema.Array(Schema.Union([TextItem, ...members]))` where each member is the element codec piped through a tagging `decodeTo`, so items carry `_tag: <wire name>`.

- **A, `xml-annotations.ts` + `benchmark-a.ts`.** The consumer writes `Schema.Struct` / `Schema.StructWithRest` and marks fields: `Identifier.pipe(attribute())`, `Schema.Int.pipe(attribute("max-choices"))`, `Schema.String.pipe(text())`, `children: mixed([P, ChoiceInteraction])`, rest record `dataAttributes(Schema.String)`. Child elements are fields whose schema is (an `Array` of, or an `optionalKey` of) another element codec. `element(name, struct)` walks `struct.ast.propertySignatures` and `indexSignatures`, reading the marker from `ast.annotations` and from every check's annotations.
- **B, `xml-dsl.ts` + `benchmark-b.ts`.** `element("qti-choice-interaction", { attributes: { "response-identifier": Identifier, "max-choices": Schema.Int, "data-*": Schema.String }, content: elements({ prompt: optional(Prompt), choices: many(SimpleChoice) }) })`. Content mode is one of `text(S)`, `elements({...})`, `mixed([...])`, or absent (`empty`). The decoded type is computed at the type level from the spec object; attribute keys are the wire names.
- **C.** Not implemented. B's object form inferred fully without helper annotations except for recursion (see C7); a fluent facade would add builder typing on top with no inference gain, and recursion would still need `suspend` plus an explicit interface. Scored as B minus the builder cost.
- **D.** Not implemented; counter-examples below show the convention cannot cover the benchmark subset without per-field overrides, which is approach A.

Shared helper for recursion in both surfaces: `suspend("div", () => Div)`. The wire name must be given up front because `mixed` and `elements` need member names when the codec is built, and forcing the thunk at that point hits the TDZ for a self-reference.

Benchmark files hold the subset from `declaration-dsl.md` plus a delimited extension block (`// --- extension beyond the benchmark subset` to `// --- end extension ---`) with `img`, `qti-hotspot-choice`, `qti-hotspot-interaction`, `qti-response-processing`, and a recursive `div`. The extension exists because `bpig-hotspot.xml` holds a hotspot interaction, not a choice interaction, and because C7 asks about recursion. Counts are reported with and without it.

## Scores

| Criterion | A   | B   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------- | --- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1        | 5   | 5   | `round trip through one definition` (4 tests): the same `AssessmentItem` value is used for `Schema.decodeUnknownEffect` and `Schema.encodeEffect`; the encoded `Element` is canonically equal to the input on both fixtures and decodes again to a deep-equal value. No second declaration, no hand-written mapper.                                                                                                                                                         |
| C2        | 5   | 5   | `identifier` is `Schema.String.pipe(Schema.brand("Identifier"))`, `max-choices` is `Schema.Int`, `time-dependent` is `Schema.Boolean` (stringified through `toCodecStringTree`), `data-*` is a template-literal-keyed rest record. `rejects max-choices="x"` passes for both with the issue pasted below; `accepts and types a data-* attribute` passes for both.                                                                                                           |
| C3        | n/a | n/a |                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C4        | n/a | n/a |                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C5        | n/a | n/a |                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C6        | n/a | n/a |                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| C7        | 3   | 3   | `type inference (C7)` tests plus the `tsc` run below: attributes typed (brand kept, `Int` is `number`, `Boolean` is `boolean`, optional keys are `T \| undefined`), children typed, mixed `_tag` union is exactly the member names and the `render` switch is exhaustive, `Encoded` is `Xml.Element`, `not.toBeUnknown()`. Recursion (`div` in `div`) needs an explicit `interface Div` and a typed `const Div: ElementCodec<"div", Div>` in both surfaces: score 3, not 5. |
| C8        | 3   | 3   | `grep -cvE '^\s*(//.*)?$'` after `vp fmt`: `benchmark-a.ts` 132 total, 39 in the extension block, **93 for the subset**; `benchmark-b.ts` 110 total, 30 extension, **80 for the subset**. Both land in the 61 to 120 band. B is 14% shorter on the subset and 17% shorter overall.                                                                                                                                                                                          |
| C9        | 3   | 3   | Library-side lines (same command): `element-codec.ts` 313 shared; `xml-annotations.ts` 119 (A total **432**); `xml-dsl.ts` 186 (B total **499**, almost all of it type-level mapping). Both under 500; neither contains a tokenizer or writer. Each custom piece is justified below.                                                                                                                                                                                        |
| C10       | n/a | n/a |                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Weighted on the scored criteria (C1 15, C2 10, C7 10, C8 10, C9 8 = 53): A 185/265, B 185/265. The criteria do not separate them; the deciding evidence does.

### C9 justification (effect-design rule: API checked, requirement missed)

| Custom piece                                                             | Effect API checked                                                                            | Requirement it misses                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decodeElement` / `encodeElement` getters (`Element` to struct and back) | `Schema.toEncoderXml` (`Schema.ts:18731`), `ChannelSchema.decode`, `Schema.toCodecStringTree` | `toEncoderXml` writes every key as a child and has no decoder; `ChannelSchema.decode` is value-in; `toCodecStringTree` has no attribute/child/text distinction. Something must map `Element.attributes` and `Element.children` to struct keys. |
| Attribute and text leaves                                                | `Schema.toCodecStringTree` (used, not custom)                                                 | None. It decoded `"1"` to `1`, `"false"` to `false`, kept the brand, and rejected `"x"` with `Expected a string representing a finite number`.                                                                                                 |
| `data-*` group                                                           | `Schema.StructWithRest` + `Schema.Record(Schema.TemplateLiteral(...))` (used, not custom)     | None at runtime; the DSL only has to place the rest record.                                                                                                                                                                                    |
| Mixed-item tagging (`memberItem`, `TextItem`)                            | `Schema.Union`, `Schema.TaggedStruct`                                                         | A `Union` over element codecs has no discriminant; `Element.name` is not a struct key. The tagging `decodeTo` gives the consumer a `_tag` to narrow on.                                                                                        |
| `suspend(name, thunk)`                                                   | `Schema.suspend`                                                                              | The wire name is needed before the thunk may be forced (TDZ on self-reference).                                                                                                                                                                |
| A: `markerOf` reading node and check annotations                         | `Schema.resolveAnnotations`, `SchemaAST.annotate` (`SchemaAST.ts:4399-4405`)                  | `annotate` lands on the last check when checks exist; `resolveAnnotations` returns only the last check's annotations. A walker needs both places.                                                                                              |
| A: AST walk (`lower`)                                                    | `SchemaAST.Objects.propertySignatures` / `indexSignatures`, `Schema.make(ast)` (public)       | Nothing derives a second schema from field metadata; the walk is the point of approach A.                                                                                                                                                      |
| B: type-level `AttributesType` / `ContentType`                           | `Schema.Struct.Type`                                                                          | The DSL object is not a `Struct`, so its decoded type has to be computed from the spec shape.                                                                                                                                                  |

## Deciding evidence

1. **A's annotations disappear into checks.** First run of `benchmark-a.ts` threw `<qti-choice-interaction> field "maxChoices" has no XML role` because `Schema.Int.pipe(attribute("max-choices"))` places the marker on `Int`'s `isInt` check (`SchemaAST.annotate`, `SchemaAST.ts:4399-4405`), not on the node. `Schema.String.pipe(attribute())` keeps it on the node. This is the "annotation precedence" failure mode the branch predicted, hit on the second attribute of the benchmark. The fix (`markerOf` scans node then checks) is cheap, but it means every future combinator (`withDecodingDefault`, `decodeTo` chains, class fields) has to be audited for where `annotate` lands. B has no such surface: the role is the object key.
2. **A cannot be silently wrong, but only because the walker refuses.** `detects an unannotated field at definition time` passes: a field with no marker and no element codec throws at `element(...)`. That is the right behaviour, and it is also an admission that the Struct type carries no XML shape; TypeScript accepts `Schema.Struct({ identifier: Schema.String })` as an element body and the mistake is found at module load.
3. **B catches shape errors in the type checker.** `rejects a non-element child spec at the type level` (`@ts-expect-error`) type-checks: `elements({ value: Schema.String })` is rejected because a child must be an `ElementCodec`. In A the same mistake is a runtime throw.
4. **Inference parity.** Both reach the same C7 score, the same exhaustive `_tag` narrowing, and the same recursion cost (explicit interface). B does it with 186 lines of type-level code; A gets it free from `Schema.Struct`. That is the real price of B.
5. **Verbosity.** B is shorter (80 vs 93 subset lines) because attribute wire names are keys instead of `attribute("max-choices")` calls, and because content mode is one call instead of a per-field marker. A's keys are camelCase (`maxChoices`), B's are wire names (`"max-choices"`); which reads better in consumer code is taste, not measured here.
6. **Issue path shape is identical** because both compile to the same target struct:

```
[A] max-choices=x:
Expected a string representing a finite number
  at ["body"]["children"][3]["maxChoices"]
[B] max-choices=x:
Expected a string representing a finite number
  at ["body"]["children"][3]["max-choices"]
[A] unknown attr:
unexpected attribute "foo" on <qti-assessment-item>; declared: identifier, title, time-dependent, xml:lang, xmlns, xmlns:xsi, xsi:schemaLocation
  at ["@foo"]
```

Inside mixed content the `Schema.Union` (`anyOf`) also reports the three non-matching members (`expected <p>, found <qti-choice-interaction> at ["body"]["children"][3]`, and so on) around the real failure. See open questions.

### D counter-examples (from the benchmark subset)

The convention "string-like field is an attribute, Struct or Array field is a child, `text` is character data, camelCase to kebab-case" fails on:

1. `qti-correct-response` holds repeated `qti-value`; the natural field is `values: Schema.Array(Value)`, whose name cannot produce the wire name `qti-value`. Every repeated child needs a name override. Same for `choices` / `qti-simple-choice`, `responseDeclarations` / `qti-response-declaration`, `outcomeDeclarations` / `qti-outcome-declaration`.
2. `qti-value` and `qti-prompt` are elements whose content is a string. A `Schema.String` field is an attribute under D, so these need the magic `text` key or an override, and `qti-simple-choice` (attributes plus text) must mix both.
3. `qti-item-body` is ordered mixed content. `children: Schema.Array(Schema.Union([...]))` reads under D as a repeated child element named `children`.
4. `xml:lang`, `xmlns:xsi`, `xsi:schemaLocation` contain colons that no camelCase-to-kebab rule produces; `base-type` happens to work.
5. `qti-item-body` and `p` carry `data-*`; D's "a `Record` field named `data`" conflicts with a vocabulary that has an element or attribute literally named `data`.

Five of the subset's twelve elements need at least one override, so D is A with worse defaults. Not implemented.

## Not implemented

- Attribute order on encode follows declaration order then `data-*`; the canonical comparator sorts, so order was not tested.
- `elements` mode is order-insensitive across different child names (XSD sequences are ordered). Not scored here; it is a validation gap either surface would inherit from the compiler.
- `mixed` keeps whitespace-only text runs as `{ _tag: "text" }` items (the item body in both fixtures has them). Dropping them is a policy SPIKE-01 owns.
- B's `Type` keys are wire names; no rename option. A has camelCase keys with explicit wire names.
- C (fluent facade) was not built.
- Namespaces, positions, `xsi:type` unions: out of scope by the section.
- `Schema.Class` as an element body (A) was not tried; the walker reads `Objects` nodes only.

## Recommendation

Keep the ledger call (D5): B's object form as the primary surface, producing ordinary Schema codecs, with the annotation path kept as an internal carrier rather than a second public API. The criteria tie (185 each) is broken by evidence 1 and 3: A's correctness depends on an annotation walk that already needed a workaround on the second benchmark attribute, while B's shape errors surface in the type checker. The reversal condition in the branch ("A reaches equal inference and lower consumer verbosity with no silent-misclassification path") does not hold: A's inference is equal, its verbosity is higher (93 vs 80), and its misclassification is caught only at runtime.

Two things the Mind should carry forward regardless of surface: the shared compiler (one `decodeTo` per element over `ElementSchema`, leaves through `toCodecStringTree`) worked unchanged for both and is what SPIKE-06 compares against; and recursion needs `suspend(name, thunk)` plus an explicit interface in either surface, so a `Schema.Class`-style named recursion helper is worth a later look.

## Open questions

1. The per-spike `tsc` command from the conventions block fails on TypeScript 7.0.2 with `TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig'`. This spike ran it with `--ignoreConfig` appended (output below). The plan should add that flag or switch to a per-spike `tsconfig.json`.
2. Mixed-content dispatch through `Schema.Union` tries every member and reports every miss. A name-dispatching member selector (pick the member whose annotated name equals `Element.name`, then decode only that one) would give one issue instead of four. That is compiler work shared by both surfaces, so it was left for the layering spike.
3. Whether optional attributes should be declared with `Schema.optionalKey` (as here, in both surfaces) or with a DSL-level `optional()` wrapper; `optionalKey` works because the compiler passes the field schema straight into `Schema.Struct`, which reads `context.isOptional`.
4. B's decoded keys are the wire names. If the Mind wants camelCase keys, B needs a per-attribute `{ name, schema }` form or a rename map, which erodes some of its verbosity lead.

## Runs

```
$ bun test spikes/declaration-dsl
bun test v1.4.2 (744846f84)

 19 pass
 0 fail
 49 expect() calls
Ran 19 tests across 1 file. [146.00ms]
```

```
$ bun x tsc --noEmit --strict --skipLibCheck --module nodenext --moduleResolution nodenext --types bun --ignoreConfig spikes/declaration-dsl/*.ts
$ echo $?
0
```

```
$ bun x vp fmt --check spikes/declaration-dsl
All matched files use the correct format.
```

```
$ for f in benchmark-a benchmark-b; do echo "$f total: $(grep -cvE '^\s*(//.*)?$' spikes/declaration-dsl/$f.ts)"; echo "$f extension block: $(sed -n '/^\/\/ --- extension/,/^\/\/ --- end extension/p' spikes/declaration-dsl/$f.ts | grep -cvE '^\s*(//.*)?$')"; done
benchmark-a total: 132
benchmark-a extension block: 39
benchmark-b total: 110
benchmark-b extension block: 30
$ for f in element-codec xml-annotations xml-dsl canonical; do echo "$f: $(grep -cvE '^\s*(//.*)?$' spikes/declaration-dsl/$f.ts)"; done
element-codec: 313
xml-annotations: 119
xml-dsl: 186
canonical: 49
```

`canonical.ts` (56 lines including blanks and comments) is the comparator copy and is test-side, not library-side.
