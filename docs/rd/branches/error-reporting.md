# Branch: error reporting with line and column

**Question.** When a definition rejects a document, how does the error name the place in the input?

## Verified upstream facts

- Only `XmlError` carries `line` and `column`, and only for failures inside the parser (`Xml.ts:51-56`, computed at `1042-1044`). Events carry no positions: `StartElement` is `{ name, attributes }`, `Text` is `{ text }` (`Xml.ts:133-166`). `Element` carries none either.
- `SchemaIssue.Pointer` carries a `path: ReadonlyArray<PropertyKey>` and formatters concatenate nested pointers (`SchemaIssue.ts:380-420`). There is no position concept in Schema issues.
- The decoder emits each input chunk's completed events as one output chunk (`Xml.ts:285-287`), so chunk boundaries are the finest position granularity visible from outside.

So "line and column on a Schema failure" is not available by composition; something must supply positions.

## Approaches

### A. XML path only, no positions

- **Thesis.** Report an XPath-like path (`/qti-assessment-item/qti-item-body/p[2]/@data-foo`) built from the element cursor during decode, wrapped in `SchemaIssue.Pointer` segments so Effect's formatters print it. No line or column. **Correction (SPIKE-06, `decisions.md` T2):** no layering mechanism produces input-shaped paths natively; Schema issue paths are struct-keyed everywhere, and the XML path is produced by a translation pass driven by the same `Plan` the compiler used, run at the decode entry point with the input element in hand. Indices are one-based same-named-sibling counts, as XML tools print them.
- **Load-bearing assumptions.** Consumers can locate a path in an editor or a DOM. Paths are stable and testable.
- **Failure modes.** For a 2 MB test file, a path is slow to find by hand; users expect `line:col` from an XML tool.
- **Validation.** Baseline in SPIKE-07; always produced.

### B. In-house position tracking beside the upstream parser

- **Thesis.** Wrap `Xml.decodeString` in a channel that counts lines and columns over the input text it forwards and attributes each emitted event to the span of the input chunk that produced it. With one-event-per-chunk feeding (split input at `<` boundaries before the parser) the span is tight; with large chunks it is a range.
- **Load-bearing assumptions.** Re-chunking input at `<` is cheap and does not change parser output (tokens may split anywhere, `Xml.ts:285`). Attributing events to the chunk that completed them is exact when every chunk completes at most one event.
- **Failure modes.** Splitting at `<` inside CDATA or comments yields extra chunks but never wrong attribution; doubling the pass over the input costs throughput, measured in SPIKE-07. Attribute positions inside a start tag are not recoverable this way (only the tag's start).
- **Validation.** SPIKE-07 side A.

### C. Post-hoc locate on failure

- **Thesis.** Decode without positions; when an issue is produced, re-scan the original text with a tiny tag scanner to find the nth element matching the path and compute line and column lazily.
- **Load-bearing assumptions.** The original text is still available (not for streaming byte input), and failures are rare so a second scan is acceptable.
- **Failure modes.** The second scanner is a second tokenizer; it must agree with upstream on comments, CDATA, and PIs to count elements correctly. Unavailable for streamed input that was not retained.
- **Validation.** SPIKE-07 side B, with the agreement check run over all fixtures.

### D. Ask upstream for positions on events

- **Thesis.** The parser already tracks line and column; an upstream change adding optional `line`/`column` to `StartElement` would make B unnecessary.
- **Load-bearing assumptions.** Maintainers accept it; this library pins 4.1.2 and would wait.
- **Failure modes.** Not in this library's control; record as an open question and a possible feature request after SPIKE-07 measures B's cost.

## Message quality (independent of positions)

- Decode failures must name the element or attribute in XML terms, the schema expectation, and the repair, following `.agents/skills/error-messages/SKILL.md`. Schema's default messages name the schema; the XML layer prefixes the path and position.
- Upstream `XmlError` is kept as the cause of a library decode error, not re-thrown as the public contract (`effect-design` ruling).
- Well-formedness failures already have positions from upstream; only Schema-level failures need the mechanisms above.

## Provisional call

A always, plus B as the position source, with the extra pass made optional (`positions: true`) if SPIKE-07 shows more than a 2x throughput cost. Ledger D7. Evidence that reverses: SPIKE-07 shows C's scanner agreement is exact on the corpus and cheaper, or upstream adds positions to events.

**Ruling:** reversed (`decisions.md` T2, D7). A always; C is the default position source when the text is retained; B is opt-in (`positions: true`) for streamed input; the C-versus-B agreement test over the fixture corpus is a required member of the library suite. D is recommended and is an owner go/no-go.
