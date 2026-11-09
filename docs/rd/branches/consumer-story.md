# Branch: the consumer story

**Question.** How does a QTI package in another repository define `qti-assessment-item`, use it, and extend it, given that this library ships the codec and no vocabulary?

**Known consumers** (read-only reference, named in SPIKE-00): `qti-pie-renderer` and other QTI 3 projects. None of them constrain this library's API.

## Approaches

### A. Vocabulary package of plain definitions

- **Thesis.** A consumer repo (say `qti-schemas`) exports constants built with this library: `export const AssessmentItem = Xml.element("qti-assessment-item", { ... })` with the namespace map declared once at the root, XHTML body elements defined in a sibling module, and `Schema.suspend` for recursive block content. Types are inferred: `type AssessmentItem = typeof AssessmentItem.Type`. Decoding is `Xml.decodeDocument(AssessmentItem)(text)`; encoding is `Xml.encodeDocument(AssessmentItem)(value)`.
- **Load-bearing assumptions.** Definitions are values with no registration step. The library exposes enough composition (`optional`, repeated children with min and max, unions by child name or `xsi:type`, open content for unknown XHTML) that a vocabulary needs no escape hatches.
- **Failure modes.** XHTML's full content model is large; a vocabulary author who must enumerate every inline element before the first item decodes will give up. An `open` content mode that admits unknown elements as generic `Element` values is required for incremental adoption.
- **Validation.** SPIKE-05's benchmark subset is this package's seed; its RESULT.md reports lines of definition per element.

### B. Generated definitions from XSD

- **Thesis.** A generator reads `imsqti_asiv3p0p1_v1p0.xsd` and emits definitions in this library's surface, so the consumer never writes `qti-assessment-item` by hand.
- **Load-bearing assumptions.** The library's surface is expressive enough to be a code-generation target (content models with sequences, choices, occurrence bounds, substitution groups).
- **Failure modes.** Generator is a second project with its own correctness burden; XSD features like substitution groups and `xs:any` map badly to a hand-shaped DSL. Out of scope for this library; it only informs the DSL to stay regular enough to be a target.
- **Validation.** Not spiked. Record as a stop condition: the DSL must not do anything a generator could not emit (no closures capturing runtime state inside definitions).

## Extension and reuse

- **Reuse across vocabularies.** XHTML body elements are shared by QTI items and other IMS formats; a consumer should be able to put them in their own module and import them into several roots. This is free if definitions are values (A).
- **Partial decoding.** A consumer that only wants response declarations should define an item with an `open` body and skip the XHTML. `elements`-mode `open` content plus `Xml.elements`-style path selection from `tree-vs-streaming.md` C cover this.
- **Custom leaf codecs.** `identifier` attributes as branded strings, `base-type` as a literal union, `data-*` as a record of validated strings: all ordinary Schemas at the leaves.
- **Package ownership.** QTI definitions belong to consumers, so this repository ships at most a `fixtures`-driven test vocabulary subset under `test/` and never exports it. The spike benchmark subset must not migrate into `src/`.

## Provisional call

A. B is a design pressure (keep the DSL generator-shaped), not a deliverable. Ledger D10 covers the package name, which stays the owner's hold and does not block the consumer story: consumers import from whatever name is chosen.
