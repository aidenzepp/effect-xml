# SPIKE-07: error positions

Throwaway spike. Nothing here is library code. Spec: `docs/rd/spike-plan.md` section SPIKE-07; branch: `docs/rd/branches/error-reporting.md`; criteria: `docs/rd/criteria.md`.

## Question

When a definition rejects a document, how does the error get a line and column? Upstream events carry no positions (`Xml.ts:133-166`), only parser failures do (`Xml.ts:51-56`), and `SchemaIssue` has no position concept. Both approaches below sit on top of A (XML path only), which is always produced. Compared: B, position tracking beside the parser, versus C, post-hoc locate from the path.

## Approaches compared

| Approach | File                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B        | `positions-b.ts` (104 lines) | `Channel.fromTransform` wrapper around `Xml.decodeString`: re-chunks the input so every piece fed to the parser starts at `<` (a trailing partial piece is carried into the next chunk), counts lines and columns over the pieces, and tags each emitted event with the start of the piece that completed it. One output chunk per input chunk (`Xml.ts:580-601`) makes `StartElement` and `EndElement` positions exact. |
| C        | `locate-c.ts` (153 lines)    | `locate(text, path): Effect<Position, LocateError>`: a tag scanner over the retained text that skips PIs, comments, CDATA, DOCTYPE (with internal subset) and quoted attribute values, counts same-named siblings per depth, and returns the `<` position of the element the path names.                                                                                                                                 |

Path convention used by C and by the agreement test: a list of element names, each optionally followed by a zero-based index among same-named siblings (`["qti-assessment-item", "qti-item-body", "div", "blockquote", "p", "qti-text-entry-interaction"]`; a name without a number means the first).

Fixtures: all 15 files in `spikes/fixtures/qti/` plus `edge-cases.xml` written here (DOCTYPE with internal subset, comment and CDATA containing `<`, a PI, `>` inside an attribute value, start tags spanning lines).

## Per-criterion scores

| Criterion | B                                                                                                                                                                                                                                                                                                                                                                       | C                                                                                                                                                                                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C9        | **5**. 104 non-blank, non-comment lines (`grep -cvE '^\s*(//.*)?$' positions-b.ts`). No parallel tokenizer: splitting at `<` and counting line ends is all the custom code; the parser stays upstream. Effect APIs checked are named in the file header (`decodeString` has no positions on events; `Channel.fromTransform`/`toTransform` are the public, stable seam). | **1**. 153 lines (same command on `locate-c.ts`). The rubric gives 1 when a parallel tokenizer exists, and C is one: it must agree with upstream on PIs, comments, CDATA, DOCTYPE and attribute quoting. It does agree on this corpus (test 1), but the rubric scores the shape, not the result.                               |
| C10       | **4** (position component only). Exact line and column for every start and end tag, independent of whether the caller retained the text, verified against C and against 33 hand-checked positions (tests 1 and 4). Attribute positions inside a tag are not recoverable; message assembly (path + expectation) was not implemented here.                                | **3** (position component only). Same exactness on the corpus (418 of 418 start tags agree), and its own failure names the XML path (`no element at /qti-assessment-item/qti-item-body/p[2]`, test 5). Unavailable when the original text is not retained, which is the streaming case. Message assembly not implemented here. |
| C1–C8     | n/a                                                                                                                                                                                                                                                                                                                                                                     | n/a                                                                                                                                                                                                                                                                                                                            |

## Deciding evidence

Run command and count: `bun test spikes/error-positions` → `7 pass, 0 fail, 552 expect() calls, Ran 7 tests across 1 file`.

Agreement table (test 1, "B and C agree on the position of every start tag in every fixture"; printed by the test):

| fixture                         | start tags | B = C | agree |
| ------------------------------- | ---------: | ----: | ----- |
| bg007-true-false.xml            |         13 |    13 | yes   |
| bg010-missing-word.xml          |         18 |    18 | yes   |
| bg011-media.xml                 |         14 |    14 | yes   |
| bpig-hotspot.xml                |         15 |    15 | yes   |
| bpig-mathml.xml                 |         22 |    22 | yes   |
| choice-feedback.xml             |         38 |    38 | yes   |
| conformance-adaptive-absent.xml |          9 |     9 | yes   |
| conformance-read-by-a-rule.xml  |          8 |     8 | yes   |
| extended-text-postcard.xml      |         31 |    31 | yes   |
| hottext.xml                     |         14 |    14 | yes   |
| imsmanifest.xml                 |         43 |    43 | yes   |
| pci-shaded-grid.xml             |         25 |    25 | yes   |
| test-features.xml               |         68 |    68 | yes   |
| text-and-media.xml              |         64 |    64 | yes   |
| text-entry-cloze.xml            |         27 |    27 | yes   |
| edge-cases.xml                  |          9 |     9 | yes   |

Hand-checked values (test 4): two start tags per corpus fixture and three in `edge-cases.xml`, 33 in all, listed in `positions.test.ts` as `handChecked`. Candidates were proposed by an awk pass over `<name` occurrences, then each chosen line was read with `sed -n` and the column counted by hand on that line (for example `bg010-missing-word.xml` line 25: eight spaces, `<p>`, the 37-character first line of the verse, so `<br` at column 49; `extended-text-postcard.xml` line 13 `<br` at column 111 after `from the ground.`). All 33 match B.

Chunking independence (test 2): feeding each fixture in 7-character chunks gives the same positions as one chunk, so the carry logic handles start tags split across chunks. Event fidelity (test 3): B forwards exactly the events plain `decodeString` produces.

Throughput (test 7, printed by the test; 300 iterations after 20 warm-up runs, Bun 1.4.2, Apple Silicon):

| input                                      | plain decodeString |        B | B / plain |
| ------------------------------------------ | -----------------: | -------: | --------: |
| test-features.xml (4888 chars), one chunk  |           0.046 ms | 0.115 ms |     2.48x |
| test-features.xml, 4096-char chunks        |           0.034 ms | 0.097 ms |     2.89x |
| synthetic 437 KB (body repeated 100 times) |           2.388 ms | 8.507 ms |     3.56x |

Rows for test-features.xml were measured on fixtures replaced on 2026-11-09; the current files differ.

Where B's cost goes (transient probe, not committed, same synthetic input, 100 iterations): plain `decodeString` fed one piece per chunk, with no counting at all, already costs 3.00x; B costs 3.90x in that run. So about three quarters of the overhead is the per-piece pull round trip through the channel (11,502 pieces versus 110 chunks), and the line counting adds under 1x. B cannot get cheaper through the public API: the one-output-chunk-per-input-chunk contract is the only way to attribute an event to its input, and the `Machine` is not exported.

The branch set 2x as the threshold above which B's pass must be optional. B is at 2.5x to 3.6x on this corpus, so even under the provisional call B would not run by default.

## Not implemented

- Assembling the caller-facing message (XML path + schema expectation + position). This spike produces the position; SPIKE-06 owns the issue path shape and the message belongs to the layering work.
- Attribute positions inside a start tag. Neither approach reports them; C could be extended to scan attributes within the located tag (cheap, not done), B cannot through the public API.
- B positions for `Text`, `Comment`, `Doctype` and `ProcessingInstruction` events are the position of the piece that completed them (the next `<`), not where they begin. Only start and end tags are exact. The test only asserts start tags.
- D (upstream positions on events) was not pursued; see open questions.
- B's carry holds back text after the last `<` until the next chunk, so one unbounded run with no `<` (a huge CDATA section) is buffered; upstream's `maxTokenSize` bounds it anyway.

## Recommendation

Default: A always, with C as the default position source. B is opt-in.

- C's agreement with B is exact on every start tag of every fixture (418 of 418) including the edge-case file, and it costs nothing until a failure happens, when it costs one linear scan of the retained text.
- B costs 2.5x to 3.6x on decode throughput, above the branch's 2x threshold, and three quarters of that cost is structural (per-piece pulls), not something a tighter implementation removes.
- B is still the only option when the text is not retained (byte streams, large inputs decoded through `Xml.decode`). Keep it behind `positions: true` for that case.

This reverses the provisional call in `branches/error-reporting.md` (ledger D7: "A always, plus B as the position source, with the extra pass made optional if over 2x"). Both reversal conditions the branch named were met: C's scanner agreement is exact on the corpus, and C is cheaper. The new call is A always, plus C when the text is retained, plus B as the opt-in source for streamed input. C's rubric score on C9 is low because it is a second tokenizer; the agreement test is what makes it acceptable, and it must stay in the library's test suite over the fixture corpus.

Type check pasted as the conventions require (TypeScript 7.0.2 refuses files on the command line while a `tsconfig.json` is present without `--ignoreConfig`, so that flag was added; it is the equivalent of the per-spike tsconfig the conventions allow):

```sh
$ bun x tsc --noEmit --strict --skipLibCheck --module nodenext --moduleResolution nodenext --types bun --ignoreConfig spikes/error-positions/*.ts
$ echo $?
0
```

`bun x vp fmt --check spikes/error-positions` → `All matched files use the correct format.`

## Open questions

1. Path semantics. The plan's example `["qti-assessment-item", "qti-item-body", "p", 2]` was read as "the third `p` under `qti-item-body`", which does not exist in `bg010-missing-word.xml` (C reports `no element at /qti-assessment-item/qti-item-body/p[2]`; test 5 asserts that). If the number was meant as a child position regardless of name, C's counter changes but nothing else does. SPIKE-06's issue path shape should settle which one the library uses.
2. D (upstream `line`/`column` on `StartElement`) would remove B's structural cost entirely because the parser already counts positions (`Xml.ts:1037-1045`). Worth a feature request now that the cost of doing it outside is measured.
3. C9 rubric: C scores 1 for being a parallel tokenizer even though it is 153 lines and verified against upstream on the corpus. If the Mind weighs the agreement test as removing that risk, C9 for C moves to 5 and the recommendation only gets stronger.
4. `edge-cases.xml` includes a DOCTYPE internal subset; upstream accepted it and skipped the subset as documented. No corpus fixture has one, so that path is only covered by the local variant.
5. The tsc conventions block should name `--ignoreConfig` for TypeScript 7.
