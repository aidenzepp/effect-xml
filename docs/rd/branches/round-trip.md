# Branch: round-trip fidelity

**Question.** After `decode` then `encode`, what is promised: the same bytes, or an equivalent XML document? What is tested?

## What upstream already decides

Facts from `node_modules/effect/src/encoding/Xml.ts`:

- Text: adjacent character data, references and CDATA sections become one `Text` event; line endings normalized to `\n` (`Xml.ts:150-166`). Entity form is lost (`&#233;` and `é` are indistinguishable).
- `encode` writes `&`, `<`, `>` escaped in text, double-quoted attributes, carriage returns as `&#13;`, and **never** self-closing tags (`<br></br>`) (`Xml.ts:462-472`).
- Attribute order: carried in a JS `Record` in encounter order, but integer-like keys reorder per JS semantics; attribute whitespace inside the tag is lost.
- Comments and PIs survive as events but `Xml.elements` drops them from `Element` (`Xml.ts:220-222`).
- `Declaration` and `Doctype` are events; the DOCTYPE internal subset is skipped.

So byte-identical output through the upstream writer is impossible even for a document that only uses `<br/>`. Byte identity would require a second writer.

## Approaches

### A. Equivalent XML (canonical) is the promise

- **Thesis.** The contract is: `encode(decode(doc))` is equivalent to `doc` under a stated equivalence close to Canonical XML 1.1 without comments: same element tree, same expanded names, same attribute sets, same character data after normalization; attribute order, prefix spelling, quote style, entity form, self-closing form, and whitespace outside `mixed`/`text` content are explicitly not preserved. **Added exclusions (SPIKE-02, SPIKE-03):** attribute-value whitespace normalisation (XML 1.0 3.3.3, `Xml.ts:122`, `:730`; the multi-line `xsi:schemaLocation` in `bg007-true-false.xml` comes back on one line with nine spaces between the pair, one for the newline and eight for the indentation), and attribute order, which happened to survive on all 16 fixtures but is still not promised because the comparator sorts and JS record key order is not a contract.
- **Load-bearing assumptions.** Consumers re-render or re-consume the XML; nobody diffs bytes. QTI validators and players accept canonical-equivalent documents.
- **Failure modes.** A consumer that stores edited files in git sees whole-file diffs on first save. Whitespace in `elements` mode is dropped, so pretty-printing becomes a library option, not a preserved property. "Equivalent" must be defined by a comparator the tests run, or the promise is unfalsifiable.
- **Validation.** SPIKE-03 implements the comparator (`canonicalize: Element -> string` over the upstream tree, with the namespace resolver from the namespaces spike kept out by comparing on as-written names in the spike) and runs it over every fixture through the smallest possible identity codec.

### B. Byte-identical through retained lexical facts

- **Thesis.** Decoded values carry a hidden lexical sidecar (quote style, attribute order, prefix spelling, self-closing flag, entity forms, inter-element whitespace, comments, PIs) and a custom writer replays it.
- **Load-bearing assumptions.** The event stream exposes enough lexical detail. It does not: entity forms, quote style, and attribute spacing are gone at the event level, and `Text` is already normalized. Byte identity would need a forked tokenizer.
- **Failure modes.** Parallel implementation of the writer and tokenizer, which the effect-design skill requires justifying with a verified gap, and the gap here is the whole parser. Values edited in TypeScript have no sidecar, so the writer needs a default path anyway (A). The sidecar is a second source of truth for order (see `mixed-content.md` C).
- **Validation.** Not spiked in full. SPIKE-03 records the lexical facts upstream loses with evidence, which is the proof B cannot be built on `effect/encoding/Xml` without replacing it.

### C. Tiered promise

- **Thesis.** Promise A for all documents, plus an opt-in "preserve" tier that keeps what the event stream does carry: comments, PIs, the declaration, doctype name, and inter-element whitespace, using the events instead of `Xml.elements` so nothing upstream drops is lost.
- **Load-bearing assumptions.** The expensive losses (entities, quotes, self-closing) do not matter to the consumers who want "preserve"; the cheap ones (comments, formatting) do.
- **Failure modes.** Two code paths and a content model with optional comment nodes. Deferred unless a consumer asks.

## What is tested

- A canonical comparator over the upstream `Element` tree is the oracle; it is the same comparator every spike uses for "same document".
- Fixture classes for the comparator: attribute-value whitespace (`bg007-true-false.xml` has a multi-line `xsi:schemaLocation`, normalized by the parser per XML 1.0 §3.3.3), whitespace-only elements (`pci-shaded-grid.xml` has `<p> </p>`), entity-heavy (`text-and-media.xml` carries `&lt;b&gt;` and `&amp;`, `conformance-read-by-a-rule.xml` a significant `&#9;`), self-closing-heavy (`bg010-missing-word.xml` uses `<br/>`), CDATA (none in the corpus; SPIKE-03 adds a hand-written one under its own directory and says so), prefixed (`bpig-mathml.xml`), `imsmanifest.xml`.
- The promise text in the README of the future package must list what is not preserved; criteria.md scores honesty, not strength.

## Provisional call

A, defined by a comparator the tests execute; C as a parked tier. Ledger D1. Evidence that reverses: the owner states a consumer needs diff-clean re-serialization of edited files, which would make a custom writer (not tokenizer) worth its code and promote C.

**Ruling:** kept (`decisions.md` D1). Comparator green 16/16 and a fixed point after one pass; byte identity 0/16 on both paths. Once content modes exist, the comparator's inline-element set is derived from definitions (`mixed`/`text` modes); the name-set form stays for raw-tree tests.
