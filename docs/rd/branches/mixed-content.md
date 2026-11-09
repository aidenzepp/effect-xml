# Branch: mixed content and ordered children

**Question.** How does a decoded value represent element content whose order matters, including text interleaved with elements (`<p>Choose <strong>one</strong> answer.</p>`), and how does the encoder reproduce that order?

**Why it matters.** This is the first problem JSON-style schemas never face. QTI item bodies are XHTML: every `<p>`, `<div>`, `<blockquote>`, and most interaction prompts are mixed content (fixtures: `bg010-missing-word.xml`, `hottext.xml`, `text-entry-cloze.xml`; in the first, `<qti-text-entry-interaction/>` sits inside a `<p>` between text runs and `<br/>`). Choice lists (`<qti-simple-choice>` repeated) are ordered element-only children. Response and outcome declarations are classic "named fields" content.

## Upstream input

`Xml.Element.children` is `ReadonlyArray<Element | string>` in document order, adjacent text merged, comments and PIs dropped, whitespace kept (`node_modules/effect/src/encoding/Xml.ts:216-232`). The event stream gives the same order one event at a time. Both are lossless for order; neither says how a typed value should hold it.

## Approaches

### A. Ordered node array with a discriminated union

- **Thesis.** Mixed content decodes to `ReadonlyArray<Text | Child1 | Child2 | ...>`, each child a tagged variant; element-only content is the same array with no `Text` member; "named fields" content is a convenience view derived from the array.
- **Shape.** `content: ReadonlyArray<{ _tag: "text"; text: string } | { _tag: "strong"; ... } | ...>`. Encoding walks the array; document order is the array order.
- **Load-bearing assumptions.** Consumers (a QTI renderer) want document order first and field access second. `Schema.Union` of tagged structs gives usable inference and narrows on `_tag`. Whitespace-only text between element-only children can be dropped or kept per a per-element content mode.
- **Failure modes.** Field-style access (`item.responseDeclarations`) becomes a search over the array; without a derived view, consumer code fills with `.filter(_ => _._tag === ...)`. Encoding an element-only struct requires an order rule anyway (declaration order of fields), so two code paths exist.
- **Cheapest validation.** SPIKE-01 side A: define `<p>` and `<qti-simple-choice>` this way, decode `bg010-missing-word.xml`, encode back, compare with the canonical comparator.

### B. Named fields plus a text channel

- **Thesis.** Every element decodes to a struct of named child fields and attributes; mixed content adds one `text` field holding the text runs with position markers (index of the preceding child) so order can be reconstructed.
- **Shape.** `{ strong: [...], br: [...], text: [{ at: 0, text: "Choose " }, { at: 1, text: " answer." }] }`.
- **Load-bearing assumptions.** Most elements are element-only, so field access is the common case and mixed content is the exception. The `at` markers are enough to reconstruct order for encoding.
- **Failure modes.** Two children of the same name interleaved with other names (`<p>a<em>x</em>b<strong>y</strong>c<em>z</em></p>`) cannot be ordered from per-name arrays alone; a global order index per child is required, which collapses this into approach C. Renderers of XHTML content find the shape hostile. Inference is good for declarations but misleading for bodies.
- **Cheapest validation.** SPIKE-01 side B: same fixtures; count the lines of consumer code needed to render `<p>` in order.

### C. Tree type with a document-order index

- **Thesis.** Decode to named fields (B's ergonomics) and keep a separate `order: ReadonlyArray<[fieldName, index] | ["text", index]>` per element so encode can reproduce document order exactly.
- **Load-bearing assumptions.** Consumers rarely touch `order`; the library maintains it on construct and on encode. The order index survives value edits made through the library's constructors.
- **Failure modes.** A value built in TypeScript by a consumer (not decoded) has no `order`; the encoder must fall back to a declared order, which is approach A's rule again. An out-of-sync `order` after a plain object spread silently reorders children on encode. This is a hidden invariant held in two places.
- **Cheapest validation.** Covered as a note in SPIKE-01 RESULT.md (not a full side); only promote if A and B both score badly.

## Pressure test

- QTI needs both styles in one document, often nested: a struct-like `qti-response-declaration` inside which `qti-correct-response` holds an ordered list of `qti-value`, and an XHTML body that is pure mixed content. The chosen representation must let a definition mark each element's **content mode**: `empty`, `text`, `elements` (ordered, element-only), `mixed`.
- Whitespace policy is part of this decision: indentation strings between element-only children are real `string` children upstream. The `elements` mode must drop whitespace-only text; `mixed` must keep it (XHTML inline whitespace is significant); `text` must keep it. Document this in criteria as part of round-trip honesty.
- Unknown children: QTI bodies can carry arbitrary XHTML. A content mode needs an `open` option (unknown elements decode to a generic `Element` variant) or definitions become unwritable.

## Provisional call

Approach A, with content modes declared per element. See `README.md` ledger entry D3. Evidence that reverses it: SPIKE-01 shows B or a derived-view-free variant scores higher on consumer verbosity and type inference without losing order fidelity.

**Ruling:** kept, wording amended (`decisions.md` D3, T3). The "derived named-field view for `elements`-mode content" is struck: `elements` mode is named fields directly (SPIKE-05 `elements({ prompt: optional(Prompt), choices: many(SimpleChoice) })`), and `mixed` is the ordered array over a union whose members are indexed by their literal element name. Whitespace-only text runs are kept in `mixed` and dropped in `elements`; no policy option in the first milestone.
