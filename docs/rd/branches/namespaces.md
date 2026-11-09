# Branch: namespace handling, `xml:lang`, `xsi:type`, `xsi:schemaLocation`

**Question.** Names arrive as written (`qti-item-body`, `m:math`, `xsi:schemaLocation`) with `xmlns` declarations as ordinary attributes (`Xml.ts:1-14`, decode gotchas at `Xml.ts:296-299`). What does a definition name, what does a decoded value carry, and how is a prefix chosen on encode?

**Fixtures.** Every QTI 3 item root declares the default namespace `http://www.imsglobal.org/xsd/imsqtiasi_v3p0`. All but `choice-feedback.xml`, `text-and-media.xml` and the two `conformance-*` items also declare `xmlns:xsi` and an `xsi:schemaLocation` pair. `xml:lang` varies: `en-US` on `bg011-media.xml`, `choice-feedback.xml`, `hottext.xml`, `text-and-media.xml`, `text-entry-cloze.xml` and the test root in `test-features.xml`; `en-GB` on `bg007-true-false.xml`, `bg010-missing-word.xml` and `bpig-hotspot.xml`; `en` on `bpig-mathml.xml`; none on the two `conformance-*` items, `extended-text-postcard.xml` or `pci-shaded-grid.xml`. `bpig-mathml.xml` adds a prefixed MathML vocabulary. `imsmanifest.xml` mixes several namespaces with prefixes.

## Approaches

### A. Resolve to expanded names at decode

- **Thesis.** The library maintains the in-scope namespace map while walking events; every element and attribute is identified by `{ namespace: string | null, local: string }`; definitions name elements by namespace URI plus local name; prefixes are a serialization detail chosen at encode from a schema-declared preferred prefix.
- **Load-bearing assumptions.** Consumers care about vocabulary identity, not spelling. A definition can supply preferred prefixes and a default namespace per subtree so encoded output is readable. `xmlns` attributes are consumed by the resolver and not exposed as data.
- **Failure modes.** QName-valued attributes (`xsi:type="qti:foo"`) need the in-scope map to interpret their _value_; the resolver must expose the map to attribute codecs. Prefix choice on encode is not round-trip stable unless the decoded value records the prefix it saw (ties into round-trip branch). Unprefixed attributes have no namespace (XML Namespaces 1.0 §6.2), which surprises people who expect them to inherit the element's default namespace; the model must encode this rule.
- **Cheapest validation.** SPIKE-02 side A on `bpig-mathml.xml` and manifest: decode, assert expanded names, encode with a declared prefix map, compare canonically.

### B. Prefix-as-written

- **Thesis.** Pass names through exactly as upstream reports them; a definition matches `m:math` literally; `xmlns*` attributes are ordinary typed attributes.
- **Load-bearing assumptions.** Producers in practice use conventional prefixes, so literal matching works on real corpora. Zero code outside Effect primitives.
- **Failure modes.** The same document with `xmlns:mml` instead of `xmlns:m` fails to decode. Default-namespace redeclaration inside a subtree changes meaning without changing spelling. It is incorrect XML, and a QTI package from another vendor breaks it. Round-trip is trivially faithful on prefixes.
- **Cheapest validation.** SPIKE-02 side B: rewrite `bpig-mathml.xml` with a different prefix and show the failure.

### C. Declared-namespace map on the schema

- **Thesis.** The definition carries a static `namespaces: { "": qtiUri, m: mathmlUri, xsi: xsiUri }` map; decode resolves names against the document's in-scope map, then matches against the schema's map, so both spelling independence and readable definitions (`m:math` as a schema key) hold.
- **Load-bearing assumptions.** Definition authors are willing to declare prefixes once per root. The schema map is also the encode prefix table, so encode is deterministic without per-value prefix memory.
- **Failure modes.** Still needs the full in-scope resolver from A at decode, so it is A plus a naming convenience, not a cheaper alternative. A document that redeclares the default namespace mid-tree is handled by the resolver, not the map, so the map alone is not a correctness mechanism.
- **Cheapest validation.** Measured as a DSL variant inside SPIKE-02 side A: same resolver, keys written as `m:math` and translated through the map.

## `xml:lang`, `xsi:type`, `xsi:schemaLocation`

These three are attributes in reserved namespaces, not element content, and they appear on every QTI root.

- **A. Ordinary namespaced attributes.** `xml:` is bound by the spec to `http://www.w3.org/XML/1998/namespace` with no declaration; `xsi:` is declared normally. A definition declares `xml:lang` as `Schema.String` (or a BCP 47 codec) like any attribute. `xsi:schemaLocation` is a space-separated pair list and gets a small codec. `xsi:type` is a QName whose value needs the in-scope map, so the attribute codec receives a resolution context.
  - Assumption: no special casing beyond the always-bound `xml` prefix.
  - Failure mode: `xsi:type` as a dispatch key (choose the child schema by `xsi:type`) is a union discriminator that lives in an attribute, so the union needs a `discriminatedByAttribute` combinator or consumers hand-roll it.
- **B. First-class built-ins.** The library ships `Xml.lang`, `Xml.xsiType(union)`, `Xml.schemaLocation` helpers and treats `xml:lang` inheritance (nearest ancestor) as a decode service.
  - Assumption: inherited language is a real consumer need (QTI renderers do need it for text direction and TTS).
  - Failure mode: inheritance means a child's decoded value depends on ancestors, which breaks local reasoning and makes encode ambiguous (emit the inherited value or omit it?). Keep inheritance out of the codec; expose the raw attribute and let consumers compute inheritance.

## Pressure test

- Attributes without a prefix are not in any namespace. `data-*` attributes are therefore always `{ namespace: null, local: "data-foo" }`; the typing story for `data-*` is a pattern-keyed record, not a namespace question.
- The upstream encoder does nothing for namespaces; the library emits `xmlns` attributes itself. Emitting all declarations on the root is simplest and canonical; reproducing per-subtree declarations is a round-trip fidelity question (see `round-trip.md`).
- Unknown prefixes in the input (prefix used, never declared) are a well-formedness-adjacent error that upstream does not report; the resolver must fail with a decode error pointing at the element.

## Provisional call

A, with C's schema-side prefix map as the authoring and encode convenience; `xml:lang`, `xsi:schemaLocation` as ordinary typed attributes; `xsi:type` dispatch as an explicit union combinator; no language inheritance in the codec. Ledger D2. Evidence that reverses: SPIKE-02 shows the resolver's cost (code outside Effect primitives) dominates and the corpus never varies prefixes, which would downgrade to B with a documented limit.
