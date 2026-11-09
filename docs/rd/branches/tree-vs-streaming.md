# Branch: tree versus streaming decode, and large-document limits

**Question.** Does a definition decode from a materialized `Xml.Element` tree, from the event stream incrementally, or from a hybrid that streams records and materializes each one?

## Upstream input

- `Xml.decode`/`decodeString` are `Channel`s producing chunks of events with bounded memory per token (`maxTokenSize`, default 10 MiB) and depth (`maxDepth`, default 1024) (`Xml.ts:253-256`).
- `Xml.elements(path, { maxElementSize })` collects each element matching a root path into an `Element` tree, default cap 16 MiB of character data per element (`Xml.ts:272-274`, `438-460`).
- `ChannelSchema` decodes schema values at channel boundaries from already-structured chunks; it does not parse events into values.
- `Config.schema` (`node_modules/effect/src/Config.ts:1140-1260`) shows a Schema being decoded from a lazy cursor by rewriting the AST with `SchemaAST.decodeTo`; the cursor is pulled on demand per object property and array index. That is the only upstream precedent for decoding a Schema from something other than a materialized value.

## Approaches

### A. Full `Element` tree, then Schema

- **Thesis.** Decode the whole document to one `Element` (either via `Xml.elements([root])` or an in-house collector that also keeps positions, see `error-reporting.md`), then run a Schema codec whose encoded side is `Element`.
- **Load-bearing assumptions.** QTI items are small (kilobytes); a QTI test and manifest are at most a few megabytes. Peak memory of tree plus value is acceptable.
- **Failure modes.** A 500 MB export fails or thrashes; `maxElementSize` becomes the de facto document size cap. Nothing is yielded until the end tag arrives.
- **Validation.** SPIKE-04 side A measures peak heap and wall time on each fixture and on a synthetic test built by repeating a fixture's sections to about 50 MB.

### B. Event-driven Schema decode via `Channel`

- **Thesis.** Compile the definition into a push-down automaton over events; values are produced as each element closes; no tree exists.
- **Load-bearing assumptions.** Schema's parser can be driven incrementally. It cannot in 4.1.2: `SchemaParser` consumes a value; the Config precedent pulls a cursor lazily but still within one decode call and it expects random access by key. Unions need lookahead or backtracking over events, which means buffering anyway.
- **Failure modes.** Reimplementing Schema's parser for a streaming input is the largest "code outside Effect primitives" option on the board and tracks upstream Schema changes. Error paths and union handling diverge from Schema's own.
- **Validation.** Not spiked as an implementation. SPIKE-04 RESULT.md records the Schema APIs checked and the requirement each misses, per the effect-design rule.

### C. Hybrid: stream records, materialize each

- **Thesis.** `Xml.elements(path)` yields each repeated record (`qti-assessment-item` inside a package, `item` in a manifest, `qti-assessment-section` in a test) as an `Element`; the Schema codec runs per record; the whole document is never held. Single-document decode is the same path with the root as the record.
- **Load-bearing assumptions.** Large documents are large because of repetition, which is true for QTI packages, feeds, and exports. Record-level memory is bounded by `maxElementSize`. **Correction (SPIKE-04):** it is bounded by the largest record's node count, not by `maxElementSize`, which counts UTF-16 code units of names and text; two records of equal counted size retained 122 MB and 1 MB, so a per-record node budget sits beside the inherited character limit (`decisions.md` T5).
- **Failure modes.** Context outside the record (namespace declarations on ancestors, `xml:lang` on the root) is lost once `Xml.elements` skips it; the resolver must capture ancestor scope from events before collection, or `Xml.elements` must be replaced by an in-house collector that keeps ancestor attributes. One giant record still hits A's limits.
- **Validation.** SPIKE-04 side B: stream a synthetic multi-item test with `Xml.elements`, decode each item, compare peak heap against A; check whether ancestor `xmlns` reaches the record.

## Large-document limits

- **A. Inherit upstream limits.** Expose `DecodeOptions` and `ElementsOptions` unchanged and document them. Zero code; the only limit the library adds is the implicit "whole document per decode" in tree mode.
- **B. Library-level budget.** Add a node-count or value-size budget enforced during Schema decode, because `maxElementSize` counts characters not memory (`Xml.ts:296-299` gotcha: many small children cost many times their size).
  - Failure mode: a second limit with its own error kind; only worth it if SPIKE-04 shows the character cap under-protects.

## Provisional call

C with A as its single-record case; B parked with a recorded capability gap; limits inherited from upstream unless SPIKE-04 shows memory diverging from `maxElementSize` by more than an order of magnitude. Ledger D4. Evidence that reverses: SPIKE-04 shows `Xml.elements` cannot hand ancestor namespace scope to the record cheaply, which would push the collector in-house and reopen A vs C.

**Ruling:** hybrid kept, mechanism amended, limits reversed (`decisions.md` T4, T5, D4). Records from `Xml.elements` carry no ancestor scope, so the collector is in-house over resolved events; `maxElementSize` is inherited and a per-record node budget (`maxElementNodes`) is added; A versus C does not reopen because the in-house collector serves both.
