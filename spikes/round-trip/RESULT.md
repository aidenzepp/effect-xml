# SPIKE-03 result: round-trip promise and canonical comparator

Throwaway spike. Spec: `docs/rd/spike-plan.md` section SPIKE-03; branch `docs/rd/branches/round-trip.md`; criteria `docs/rd/criteria.md`. Effect 4.1.2 facts cited from `node_modules/effect/src/encoding/Xml.ts`.

## Question

After `decode` then `encode` through `effect/encoding/Xml`, what can be promised: the same bytes, or an equivalent document? Concretely: (1) does a canonical equivalence hold across the whole QTI corpus, and (2) which lexical facts does the upstream codec lose, as evidence that byte identity is off the table without a second parser.

## Approaches compared

- **A. Canonical equivalence via a comparator.** `canonical.ts` (61 lines, 45 non-blank) defines `canonicalize: Element -> string`: element names as written, attributes sorted by key, whitespace-only string children dropped except inside a configurable inline-element set (`defaultInline`: `p`, `span`, `strong`, `em`, `b`, `i`, `li`, `td`, `th`, `qti-prompt`, `qti-simple-choice`, `qti-hottext`, `qti-feedback-inline`, `qti-value`), text runs normalized with `\s+ -> " "`, markup characters escaped. Equivalence is string equality of the canonical forms. The promise this comparator defines: same element tree, same names as written, same attribute sets and values, same character data up to whitespace runs. Not preserved and not compared: attribute order, quote style, entity form, CDATA versus escaped text, self-closing form, the XML declaration, comments, processing instructions, whitespace-only text outside the inline set, whitespace outside the root.
- **B. Byte identity.** Not built; measured only as a loss inventory. For every fixture the test records whether `decodeString -> elements([root]) -> events -> encodeString` (the tree path) and `decodeString -> encodeString` (the events path, which keeps declaration, comments and PIs) reproduce the input byte-for-byte, and counts the lexical facts in the input that the upstream codec is documented to change.

Pipeline under test (`pipeline.ts`): `Xml.decodeString()` -> `Xml.elements([root])` where `root` is the name of the first `StartElement` -> hand-written `elementEvents` (there is no upstream `Element -> Event` function; exports are `decodeString :334`, `decode :368`, `elements :438`, `encodeString :511`, `encode :538`) -> `Xml.encodeString()` -> `Xml.decodeString()` -> `Xml.elements([root])`. Every step runs through `Stream.pipeThroughChannel`; failures stay on the `XmlError` channel and would fail the test through `Effect.runPromise`.

Corpus: all 15 files in `spikes/fixtures/qti/` (read-only) plus `spikes/round-trip/cdata.xml`, a spike-owned fixture added because the corpus has no CDATA section (`fixtures/qti/SOURCES.md`); it also carries `&apos;`, `&quot;`, a decimal and a hex character reference, a single-quoted attribute and `<br/>`.

## Scores

| Criterion                         | A. canonical equivalence                                                                                                                                                                                                                                                                                       | B. byte identity                                                                                                                                                        | Evidence                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C5 round-trip honesty             | **5**: promise written above, comparator green on all 16 fixtures, exclusions listed                                                                                                                                                                                                                           | **0**: the comparator for B is byte equality and it is red on every fixture on both paths                                                                               | `A. canonical equivalence holds across the corpus` (16 tests) and `B. byte identity, measured as a loss inventory` in `round-trip.test.ts`; table below |
| C9 code outside Effect primitives | **5**: 45 lines (`canonical.ts`) + about 30 library-side lines in `pipeline.ts` (`decodeEvents`, `rootName`, `collectRoot`, `elementEvents`, `encodeEvents`, `roundTrip`); the rest of `pipeline.ts` (`summarize`, 99 non-blank total) is measurement and would not move to `src/`. Each piece justified below | n/a: not implemented. The branch file predicts 1 (a parallel tokenizer and writer); the loss table is the evidence for why a writer alone could not reach byte identity | `grep -cvE '^\s*(//.*)?$' spikes/round-trip/canonical.ts spikes/round-trip/pipeline.ts` -> `45`, `99`                                                   |
| C1, C2, C3, C4, C6, C7, C8, C10   | n/a                                                                                                                                                                                                                                                                                                            | n/a                                                                                                                                                                     | not touched by this spike                                                                                                                               |

Weighted: A = 5x8 + 5x8 = 80 of the 16 points in play; B = 0 of 8 in play.

C9 justification per custom piece (effect-design rule, API checked -> requirement it misses):

- `canonicalize`: no canonical form or equivalence in `encoding/Xml` (exports listed above); `Equal.equals` from `effect/Equal` is structural equality on the raw tree and cannot drop whitespace-only children or ignore attribute order, both of which the stated promise requires.
- `elementEvents`: `Xml.encodeString` consumes `Event`s (`Xml.ts:511-518`) and `Xml.elements` produces `Element`s (`:438-460`); nothing upstream converts an `Element` back to events, so encoding a tree needs this walk. 13 lines.
- `rootName` + `collectRoot`: `elements` requires a root-anchored name path (`:389-397`), so the root name is read from the first `StartElement`; `["*"]` would also work and is the alternative noted under open questions.
- `decodeEvents` / `encodeEvents` / `roundTrip`: `Effect.fnUntraced` wrappers around `Stream.make` / `Stream.fromIterable` -> `Stream.pipeThroughChannel` -> `Stream.runCollect` / `Stream.mkString`; pure composition of Effect primitives, kept as names for the test.

## Deciding evidence

Run command and executed count: `bun test spikes/round-trip` -> `24 pass, 0 fail, 52 expect() calls, Ran 24 tests across 1 file`.

Type check (pasted; see open questions for the two extra flags):

```
$ bun x tsc --noEmit --strict --skipLibCheck --ignoreConfig --allowImportingTsExtensions --module nodenext --moduleResolution nodenext --types bun spikes/round-trip/*.ts
$ echo $?
0
```

Format: `bun x vp fmt spikes/round-trip` -> `Finished ... on 4 files`, no diff afterwards.

Canonical equivalence (A): green on 16/16 fixtures. Each test also re-runs the tree path on its own output and asserts the encoded text is a fixed point, so the equivalence is stable after one pass, matching the probe recorded in `docs/rd/effect-substrate.md` ("Equivalent-XML round trip is stable after one pass").

Byte identity (B), as printed by the loss-inventory test (`bytes=` columns are the two paths; counts are occurrences in the input outside comments; `self-closing lost` is input `/>` minus output `/>`; `multi-line tags` are start tags containing a newline, whose intra-tag whitespace the event model cannot carry):

| fixture                         | bytes= (tree) | bytes= (events) | declaration | comments | self-closing lost | char refs | &apos;/&quot; | single-quoted | CDATA | multi-line tags | attr order |
| ------------------------------- | ------------- | --------------- | ----------- | -------- | ----------------- | --------- | ------------- | ------------- | ----- | --------------- | ---------- |
| bg007-true-false.xml            | false         | false           | dropped     | 0        | 1                 | 0         | 0             | 0             | 0     | 1               | kept       |
| bg010-missing-word.xml          | false         | false           | dropped     | 0        | 8                 | 0         | 0             | 0             | 0     | 1               | kept       |
| bg011-media.xml                 | false         | false           | dropped     | 0        | 7                 | 0         | 0             | 0             | 0     | 1               | kept       |
| bpig-hotspot.xml                | false         | false           | dropped     | 0        | 7                 | 0         | 0             | 0             | 0     | 3               | kept       |
| bpig-mathml.xml                 | false         | false           | dropped     | 1        | 2                 | 0         | 0             | 0             | 0     | 2               | kept       |
| choice-feedback.xml             | false         | false           | dropped     | 0        | 5                 | 0         | 0             | 0             | 0     | 0               | kept       |
| conformance-adaptive-absent.xml | false         | false           | dropped     | 0        | 1                 | 0         | 0             | 0             | 0     | 0               | kept       |
| conformance-read-by-a-rule.xml  | false         | false           | dropped     | 0        | 2                 | 1         | 0             | 0             | 0     | 0               | kept       |
| extended-text-postcard.xml      | false         | false           | dropped     | 0        | 8                 | 0         | 0             | 0             | 0     | 0               | kept       |
| hottext.xml                     | false         | false           | dropped     | 0        | 1                 | 0         | 0             | 0             | 0     | 1               | kept       |
| imsmanifest.xml                 | false         | false           | dropped     | 0        | 10                | 0         | 0             | 0             | 0     | 1               | kept       |
| pci-shaded-grid.xml             | false         | false           | dropped     | 2        | 4                 | 0         | 0             | 0             | 0     | 3               | kept       |
| test-features.xml               | false         | false           | dropped     | 0        | 19                | 0         | 0             | 0             | 0     | 1               | kept       |
| text-and-media.xml              | false         | false           | dropped     | 0        | 7                 | 0         | 0             | 0             | 0     | 0               | kept       |
| text-entry-cloze.xml            | false         | false           | dropped     | 0        | 7                 | 0         | 0             | 0             | 0     | 1               | kept       |
| cdata.xml (spike-owned)         | false         | false           | dropped     | 1        | 1                 | 2         | 4             | 1             | 1     | 0               | kept       |

Reading the table:

- 0 of 16 fixtures survive either path byte-for-byte. Every fixture has at least one self-closing tag, and `Xml.encodeString` never writes one (`Xml.ts:471-472`; probe on `conformance-adaptive-absent.xml`: `<qti-variable identifier="SCORE"/>` becomes `<qti-variable identifier="SCORE"></qti-variable>`). That alone decides B for this corpus.
- The tree path additionally drops the declaration on every fixture and the comments on 3 (`Xml.elements` keeps neither; `Xml.ts:219-222`).
- The events path keeps declaration, comments and PIs but still loses: self-closing form; the newline after the declaration and the trailing newline (text outside the root is not reported, `Xml.ts:283-284`); entity and reference forms (`cdata.xml`: `&apos;`, `&quot;`, `&#769;`, `&#xE9;` and `<![CDATA[...]]>` all come back as literal characters or `&lt;`/`&amp;`/`&gt;`; `conformance-read-by-a-rule.xml`: `&#9;` comes back as a literal tab); single-quoted attributes become double-quoted; multi-line start tags are written on one line, and the multi-line `xsi:schemaLocation` value in `bg007-true-false.xml` is already normalized at the event level to `"...imsqtiasi_v3p0         https://..."` (nine spaces: the newline and the eight-space indent each become a space, XML 1.0 3.3.3), so the writer never sees the newline.
- Attribute order is the one lexical fact that does survive: the test compares `Object.keys(attributes)` of every start tag before and after and it matched on all 16 fixtures. The comparator still sorts attributes because the promise should not depend on JS record key order.
- Character data itself is intact: the `&#9;` tab in `qti-value` and the CDATA / reference / literal text in `cdata.xml` decode to identical strings on both passes (`character data the lexical losses do not touch`, 2 tests).

## What was not implemented

- B as a codec: no lexical sidecar, no custom writer, no tokenizer. The inventory above shows that quote style, entity form, CDATA boundaries, self-closing form, intra-tag whitespace and text outside the root are absent at the `Event` level, so a custom writer could not recover them; a forked tokenizer would be needed, which is the whole parser.
- C (tiered "preserve" promise): not spiked. The events-path column is the only evidence gathered: it shows what such a tier could keep (declaration, comments, PIs) and what it still could not (everything in the previous bullet).
- Namespace-aware comparison: names are compared as written, per the spec; the namespaces spike owns resolution.
- Pretty-printing or a whitespace policy for encode: the comparator drops inter-element whitespace, so whether the library re-indents is a library option, not something this spike decided.

## Recommendation

Keep ledger D1 as written: the promise is canonical-equivalent XML defined by this comparator, with the exclusion list above printed in the package README. The comparator is green on the whole corpus and the loss table shows byte identity is unreachable on `effect/encoding/Xml` for every fixture, not just edge cases. No reversed call. Parked: C (preserve tier) remains deferred until a consumer asks; its ceiling is the events-path column.

For copying: `canonical.ts` is 61 lines (45 non-blank), self-contained, imports only `Xml` types. Copy it; do not import it.

## Open questions

1. **Inline set.** `defaultInline` is a hand-picked set for this corpus. The comparator treats whitespace-only children inside those elements as significant (normalized to one space) and drops them elsewhere. SPIKE-01 (mixed content) is the right owner for the real list; if its content-mode model (`mixed`/`text` per element) lands, the comparator should take that model instead of a name set.
2. **`elements([root])` versus `elements(["*"])`.** The spec names `[root]`; the spike derives `root` from the first `StartElement` so one pipeline serves every fixture. `["*"]` at the root position is equivalent and avoids the lookup; either is fine for the library.
3. **tsc flags.** The conventions-block command fails under TypeScript 7.0.2 with `TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig'`, and relative `./x.ts` imports (which Bun needs at runtime) fail with `TS5097` unless `--allowImportingTsExtensions` is set. The pasted command adds both flags; other spikes will hit the same two errors. A per-spike `tsconfig.json` is the alternative the conventions block allows.
4. **Text normalization strength.** `\s+ -> " "` hides any change to the _kind_ of whitespace (tab versus space) inside text; the dedicated `&#9;` test covers the one fixture where that matters. If a future consumer needs exact character data, the comparator should normalize only whitespace-only children and compare other text verbatim.
5. **`maxElementSize`.** `Xml.elements([root])` collects the whole document as one `Element`, so the default 16 MiB limit (`Xml.ts:550`) applies to the entire file on this path. Irrelevant for the corpus (largest fixture 7.8 KB); SPIKE-04 owns the limits question.
