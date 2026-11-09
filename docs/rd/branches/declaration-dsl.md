# Branch: how the attribute / element / text mapping is declared

**Question.** What does a consumer write to say "this element has these attributes, these children in this content mode, and this text", such that one definition yields decode and encode and every attribute is Schema-validated?

**The verbosity benchmark.** A subset of `qti-assessment-item`: root attributes (`identifier`, `title`, `time-dependent`, `xml:lang`, `xmlns`, `xsi:schemaLocation`), one or more `qti-response-declaration` (attributes plus optional `qti-correct-response` holding ordered `qti-value`), `qti-outcome-declaration`, a `qti-item-body` of XHTML mixed content with `qti-choice-interaction` containing ordered `qti-simple-choice`, and `data-*` attributes on body elements. The same subset is defined in each approach in SPIKE-05 and line and symbol counts are compared.

## Approaches

### A. Annotations on ordinary Schema fields

- **Thesis.** A consumer writes a plain `Schema.Struct` (or `Schema.Class`) and marks fields with XML annotations: `Schema.String.pipe(Xml.attribute())`, `Schema.Array(Choice).pipe(Xml.children("qti-simple-choice"))`, `Schema.String.pipe(Xml.text())`. The library reads annotations when deriving the codec. Annotations accept arbitrary keys at node and key level (`node_modules/effect/src/Schema.ts:19072-19120`, `annotateKey` at `752`).
- **Load-bearing assumptions.** The field name is a good default element or attribute name (QTI uses kebab-case, so a naming convention or explicit `name` is needed). Mixed content can be expressed as one annotated field of the ordered-union type. Consumers already know `Schema.Struct`.
- **Failure modes.** Annotations are untyped at the type level: a missing `Xml.attribute()` on a field silently becomes a child element; there is no compile-time check that a Struct is XML-shaped. Annotation precedence through `Schema.optional`, `withDecodingDefault`, filters and transformations must be specified: the derivation walks links and may lose annotations attached to inner nodes. Namespace per field is yet another annotation.
- **Validation.** SPIKE-05 side A.

### B. A parallel XML-shape DSL

- **Thesis.** A dedicated constructor `XmlSchema.element("qti-simple-choice", { attributes: { identifier: Schema.String, "data-*": Schema.String }, content: XmlSchema.mixed([Strong, Em, Br]) })` returns a real `Schema.Codec<Choice, Element>`; the shape is a type, so content mode and attribute set are checked by TypeScript, and the derivation needs no annotation walking.
- **Load-bearing assumptions.** Consumers accept a second vocabulary beside Schema for the XML layer, the way `HttpApi` sits beside Schema. Attribute schemas are ordinary Schemas, so `data-*` typing is a pattern-keyed record entry (`Schema.Record` with a template-literal key) inside `attributes`.
- **Failure modes.** Two vocabularies; `Schema.Class` users lose their class. Every Schema combinator a consumer wants on an element (`optional`, `Array`, unions by `xsi:type`) needs a DSL mirror or must interoperate transparently. Inference of the decoded type from the DSL object must be as good as `Schema.Struct`'s or the approach loses the type-inference criterion.
- **Validation.** SPIKE-05 side B.

### C. Zod-style combinator API

- **Thesis.** The owner's phrase. `x.element("p").attrs({ ... }).mixed(x.el("strong"), x.text())` as a fluent builder over Schema. This is B with a fluent surface; its tradeoffs are B's plus builder typing cost.
- **Load-bearing assumptions.** Fluent chains infer as well as object literals in TypeScript 7. They often do not for recursive definitions, which XHTML bodies are (`div` contains `div`).
- **Failure modes.** Recursive content needs `Schema.suspend`, which breaks fluent inference; builder state that is partially applied is a mutable-looking value.
- **Validation.** Not a separate spike side; SPIKE-05 side B records whether a fluent facade over its object form costs inference, so C is scored as a surface variant of B.

### D. Codec from `Schema.Struct` with naming conventions

- **Thesis.** No DSL and no annotations: a Struct field whose schema is a string-like primitive is an attribute; a field whose schema is a Struct or Array is a child element; a field named `text` or `$text` is character data; `data-*` is a `Record` field named `data`. Names map kebab-case from camelCase.
- **Load-bearing assumptions.** Real vocabularies obey the convention. QTI does not: `qti-value` is a child element whose content is a string, which the convention would read as an attribute; `qti-prompt` is mixed content; `identifier` on `qti-response-declaration` is an attribute while `qti-correct-response` has none.
- **Failure modes.** Every exception needs an override, which is approach A. Silent misclassification is the worst outcome for a validation library.
- **Validation.** Scored by argument in SPIKE-05 RESULT.md with the counter-examples above; implement only if a hand finds the convention covers the benchmark subset without overrides.

## Shared requirements regardless of surface

- The result is a `Schema.Codec` whose decoded type is inferred and whose encoded type is the library's element model, so Effect's `decodeEffect`, `encodeEffect`, `is`, `standardSchemaV1` and error formatting work unchanged.
- `data-*` is declared once per element as a pattern-keyed attribute group with a value schema; unknown attributes are an error by default with an `open` option.
- Content mode is explicit (`empty | text | elements | mixed`), never inferred.
- Definitions are plain values that consumers export from their own packages (`consumer-story.md`).

## Provisional call

B's object form as the primary surface with the DSL producing ordinary Schema codecs. Ledger D5. Evidence that reverses: SPIKE-05 shows A (annotations only) reaches equal inference and lower consumer verbosity with no silent-misclassification path, in which case the DSL is dropped.

**Ruling:** kept, carrier amended (`decisions.md` D5, T1). The `Plan` (closed IR) is the carrier, not annotations; A is a second producer onto the same `Plan` (SPIKE-05's 119-line walker) and is not shipped in the first milestone. The single `effect-xml` annotation only marks an element codec with its wire name so `mixed`, `elements`, and `suspend` can read it. Decoded keys are wire names; optional attributes use `Schema.optionalKey`; the DSL `optional()` wraps child elements only.
