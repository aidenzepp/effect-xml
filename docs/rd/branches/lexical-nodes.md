# Branch: CDATA, comments, processing instructions, declaration, DOCTYPE, and entities

**Question.** Which lexical constructs survive into the typed value, which are dropped, and which fail?

## Verified upstream behavior (`node_modules/effect/src/encoding/Xml.ts`)

| Construct                                    | Decode                                                                                                      | `Xml.elements` tree     | Encode                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------- |
| CDATA section                                | Merged into the adjacent `Text` event; the CDATA boundary is gone (`150-166`)                               | Plain string child      | Written as escaped text; never as CDATA                                                         |
| Comment                                      | `Comment` event                                                                                             | Dropped (`220-222`)     | Written if given a `Comment` event; `--` inside fails                                           |
| Processing instruction                       | `ProcessingInstruction` event                                                                               | Dropped                 | Written if given; `?>` in data fails                                                            |
| XML declaration                              | `Declaration` event (`87-91`); the named encoding is ignored on decode                                      | Not part of any element | Must be the first event; non-UTF-8 encoding fails in byte mode                                  |
| DOCTYPE                                      | `Doctype` event with name, public and system ids; internal subset skipped, defaults not applied (`291-295`) | Not part of any element | Written if given                                                                                |
| Predefined entities and character references | Decoded in `Text` and attribute values                                                                      | Decoded                 | `&`, `<`, `>` escaped in text; `&`, `<`, `"`, tab, newline escaped in attributes; CR as `&#13;` |
| DOCTYPE-declared entities                    | `Unsupported` error with a DOCTYPE, `Syntax` without (`296-298`)                                            | n/a                     | n/a                                                                                             |

## Approaches for CDATA, comments, PIs

### A. Not part of the typed model

- **Thesis.** The definition language has no comment or PI node; CDATA is text. Decoding ignores comments and PIs anywhere; encoding never emits them. Declaration is emitted as `<?xml version="1.0" encoding="UTF-8"?>` by default with an option to omit.
- **Load-bearing assumptions.** QTI semantics never live in comments or PIs. This matches `Xml.elements` exactly, so the tree path needs no custom collector for this reason.
- **Failure modes.** Authoring tools that keep comments as documentation lose them on round trip (already excluded by `round-trip.md` A). An `xml-stylesheet` PI before the root is dropped.
- **Validation.** None needed beyond a fixture test proving comments in `bpig-mathml.xml` and `pci-shaded-grid.xml` do not affect decode.

### B. Optional lexical passthrough nodes

- **Thesis.** A `mixed` content mode may opt in to `Comment` and `ProcessingInstruction` variants in its ordered children array; a document wrapper may carry prolog PIs and the DOCTYPE. Requires reading events rather than `Xml.elements`.
- **Load-bearing assumptions.** A consumer exists who needs this (none named today).
- **Failure modes.** Every content-mode union grows two rarely used members, hurting inference and exhaustiveness checks for all consumers.
- **Validation.** Parked; revisit when `round-trip.md` C is promoted.

## Approaches for entities

### A. Inherit upstream exactly

- Five predefined entities and character references work; DOCTYPE entities fail with a clear upstream error. The library documents this and forwards the error with its position.
- Failure mode: some QTI 2 conformance files and XHTML-flavored items use `&nbsp;` without a DOCTYPE, which upstream rejects as `Syntax`. SPIKE-00's fifteen-file corpus (`spikes/fixtures/qti/SOURCES.md`) contains no `&nbsp;` and no CDATA section; its entity coverage is `text-and-media.xml` (`&lt;`, `&gt;`, `&amp;`) and `conformance-read-by-a-rule.xml` (`&#9;` where whitespace is significant). The repair below is therefore unmotivated by local evidence.

### B. Pre-decode entity substitution option

- **Thesis.** An opt-in `entities: { nbsp: " " }` map applied by a text transform channel before the parser, for documents that use HTML named entities without declaring them.
- **Load-bearing assumptions.** Substitution before tokenization is safe only outside CDATA and comments; a naive string replace inside a CDATA section changes content.
- **Failure modes.** The transform must be CDATA-aware, which is a partial tokenizer again. Column positions shift relative to the original text.
- **Validation.** Not spiked. Open question for the owner with a default of A; promote only when the fixture corpus shows undeclared entities in real QTI 3 output.

## Provisional call

Lexical nodes: A. Entities: A, with B recorded as the only known repair for `&nbsp;`-style inputs. Ledger D8 and D9. Evidence that reverses: the SPIKE-00 corpus or a consumer shows undeclared named entities in documents the library must accept.
