# Branch: how this layers on Effect Schema

**Question.** Given a definition (whatever surface wins in `declaration-dsl.md`), by what mechanism do decode and encode run? What does `Schema.toEncoderXml` already give and where does it stop?

## What `Schema.toEncoderXml` gives and where it stops

Source: `node_modules/effect/src/internal/schema/toEncoderXml.ts` (whole file) and `Schema.ts:18706-18736`.

- It runs `toCodecStringTree(codec)` to turn the value into a `StringTree` (`Tree<string | undefined>`: leaf, record, or array; `Schema.ts:18391`, `18876-18887`), then prints that tree with `rootName` (identifier or title fallback, else `root`), arrays as `<item>` children, keys sorted by default, pretty-printed by default, invalid tag names sanitized and recorded in a `data-name` attribute.
- It stops here: no attributes at all (the only attribute it ever writes is its own `data-name`), no namespaces, no ordered or mixed content, no text-plus-children, no element name per field beyond the key, and no decoder. Its `escapeText` escapes `>` too. It is a debugging serializer for arbitrary Schemas and is the right escape hatch to keep pointing at for "dump this value as XML".
- Reusable from it: `toCodecStringTree` as the leaf-stringification layer (every primitive, `Declaration` with a `toCodecStringTree`/`toCodecJson` link, enum, literal becomes a string codec). That is exactly the attribute and text-content story: an attribute schema `Schema.Int` must round-trip through its string form, and `toCodecStringTree` already derives that codec.

## Approaches

### A. Schema transformation from the `Element` tree

- **Thesis.** The library defines `Element` as a Schema (`Xml.Element` is a plain recursive record: name, attributes record, children array) and each definition is `Schema.decodeTo(Target)(ElementSchema, transformation)` whose getter maps `Element -> Target` and back. Decode is `decodeEffect(definition)(element)`.
- **Load-bearing assumptions.** The transformation can be assembled compositionally from child definitions so the DSL does not hand-write getters. `SchemaIssue.Pointer` paths through a transformation remain meaningful (they point into the decoded structure, not into the element).
- **Failure modes.** Error paths speak in the output type's keys (`["responseDeclarations"][0]`), not in XML terms (`qti-response-declaration[1]/@identifier`). Each definition is one opaque transformation step, so Schema's own union, optional, and default machinery runs _after_ the element is already converted and cannot help choose among children.
- **Validation.** SPIKE-06 side A.

### B. Custom AST walker in the Config style

- **Thesis.** Follow `Config.schema` (`Config.ts:1140-1260`): take the definition's Schema AST, derive the StringTree codec, then rewrite the AST with `SchemaAST.decodeTo(SchemaAST.unknown, ast, Transformation(SchemaGetter.transformEffect(decodeFromCursor), passthrough))` at each `Objects`/`Arrays`/leaf, where the cursor is an XML cursor (current element plus the resolver's namespace scope) instead of a `ConfigCursor`. Objects read attributes and child elements by the annotation or DSL metadata; arrays read repeated children; leaves read attribute strings or text. Encode is the mirror: an AST walker that emits events.
- **Load-bearing assumptions.** The rewrite primitives Config uses are public (`SchemaAST.decodeTo`, `SchemaAST.applyToSelfOrLastLinkEncoding`, `SchemaGetter.transformEffect`, `SchemaTransformation.Transformation`) and stable enough to pin; Config is stable at 4.0.0, so they have one stable consumer upstream already. Union members can be tried against the cursor by shape (child name present) before Schema's own union logic runs. **Correction (SPIKE-06):** the public-primitives assumption is false for `applyToSelfOrLastLinkEncoding`, `replaceEncoding`, `Objects.recur`/`Arrays.recur`, and `getIndexSignatureKeys`, all `@internal` and absent from `dist/SchemaAST.d.ts`; a rebuild through public constructors reaches `Struct`/`Array`/`Union`/`Suspend`/leaves but not composites with encoding chains (`Schema.Class`, transformed structs) or index signatures (`data-*`).
- **Failure modes.** Walking the AST couples the library to every `SchemaAST` node kind (23 tags, `SchemaAST.ts:786-4193`) and to how links and annotations survive `optional`, `Class`, filters; this is the same hazard `declaration-dsl.md` A names. Encode has no Config precedent and must be written from scratch against the AST.
- **Validation.** SPIKE-06 side B: implement decode for Struct/Array/String/Int/optional from an `Element` cursor via AST rewrite, run the benchmark subset, record which AST tags were needed.

### C. Compile the definition to a closed intermediate representation

- **Thesis.** The DSL produces a small closed IR (`ElementSpec { name, attributes, contentMode, children }`) alongside the Schema; decode and encode interpret the IR and call Schema only for leaves (attribute and text codecs via `toCodecStringTree`) and for the final `make`. The Schema AST is never walked generically.
- **Load-bearing assumptions.** Consumers do not need to apply arbitrary Schema combinators to an element node; they apply them to leaves and to the decoded type. The DSL is the only producer of IR, so the IR is complete by construction.
- **Failure modes.** A plain `Schema.Struct` with annotations cannot be used as an element (no IR), so `declaration-dsl.md` A is unreachable from this layering. `Schema.optional` on a whole element must be a DSL operation.
- **Validation.** SPIKE-06 side B records, per feature, whether the AST walk needed anything the IR would not already know; that is the evidence for or against C without a third implementation.

## Pressure test

- Errors: issue paths are struct-keyed in every mechanism (SPIKE-06 "Issue paths": `Pointer` segments are the target struct's property keys in A and B alike). Approach B yields translatable paths because its per-key metadata can re-point each segment; A has no per-key metadata to translate with; C translates through its IR. XML paths therefore come from a `Plan`-driven translation pass at the decode entry point (`decisions.md` T2), not from the layering mechanism itself. `error-reporting.md` depends on that pass, not on this choice.
- Encode symmetry: only B and C naturally produce an event stream (and so can stream encode); A produces an `Element` that then needs a tree-to-events walk, which is trivial.
- Leaves: all three reuse `toCodecStringTree`, so "attribute typing including `data-*`" is independent of this choice.

## Provisional call

B for decode, with C's IR as the DSL's internal carrier if SPIKE-06 shows the generic walk needing more than `Objects`, `Arrays`, `Union`, `Suspend`, `Literal`, `String`, `Number`, `Boolean`, `Declaration`. Ledger D6. Evidence that reverses: the AST rewrite primitives are marked internal or change between 4.1.x patch versions (check `@stability` on each symbol in the spike), which would force C.

**Ruling:** reversed to C (`decisions.md` T1, D6). The primitives are `@internal`, and SPIKE-05's compiler over the same closed IR passes both gates including `data-*`; there is no AST rewrite in the library, as core or escape hatch.
