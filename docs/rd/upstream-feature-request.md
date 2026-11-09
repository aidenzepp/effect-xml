# Upstream feature request: positions on `Xml` events (preview, not filed)

Unit FR-01. Drafted with the `feature-request-authoring` skill through its step 11 (preview). Nothing was filed, commented or reacted on GitHub; the owner approves the exact text first. The body below is the file that would be filed.

Evidence behind the draft, for this repository only (none of it is named in the body): `spikes/error-positions/RESULT.md` (B equals C on 416 of 416 start tags; B costs 2.48x to 3.56x; about three quarters of that is per-piece pull round trips), `docs/rd/effect-substrate.md` (positions only on `XmlError`), `docs/rd/decisions.md` T2 and D7, and the owner's authorization in `work/owner-answers-2026-11-04.md` item 2.

Pinned to `Effect-TS/effect@506eef1` (tag `effect@4.1.2`, full SHA `506eef143bcc1750ce58920aac1e45da7265d103`). `packages/effect/src/encoding/Xml.ts` at that commit is byte-identical to `node_modules/effect/src/encoding/Xml.ts` here, so the `Xml.ts` line numbers in the body hold for both.

## 1. Preview

| #   | Title                                                         | Path                                                                   | Kind            |
| --- | ------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- |
| 1   | Xml: `positions` decode option that puts `line` and `column`… | this file, section 2 (scratch copy: `work/fr-01/draft.md`, gitignored) | Feature request |

- **Target:** `Effect-TS/effect`, public. Issues enabled, blank issues enabled, Discussions disabled. The repo's Feature Request form lives in `Effect-TS/.github` (`.github/ISSUE_TEMPLATE/2-feature-request.yml`): three fields, problem, proposed feature, alternatives. `gh` cannot submit a YAML form, so the body carries one `###` heading per field in form order; the form was not used. The form would apply the `enhancement` label; `gh issue create` will not, and adding `--label enhancement` needs owner approval.
- **AI policy:** `Effect-TS/.github` `CONTRIBUTING.md` has "AI-assisted triage and review" (they triage with agents; a maintainer approves every merge and close). Nothing forbids AI-drafted issues. `Effect-TS/effect` `.agents/AGENTS.md` says nothing about issues.
- **Full title:** Xml: `positions` decode option that puts `line` and `column` on `StartElement` events
- **Kind:** Feature request.
- **Labels:** none. **Assignee:** none.
- **Account:** `gh auth status` shows two logged-in GitHub accounts. The owner picks which one files; neither was switched.
- **Disclosure sentence:** "Written by AI and reviewed by the filer before filing." The agents wrote the whole text; the owner only reviews it before filing. Provider `Anthropic` and Model `Fable 5.1` come from the drafting agent's own session identity.
- **Prototype result:** done, in a scratch copy under `work/fr-01/proto/` (gitignored, never pushed). The acceptance check passes; the 21 upstream `Xml.test.ts` cases stay green; the same check fails on the unpatched copy (`work/fr-01/baseline/`) with the type errors the body quotes. `positions: true` measured 1.5x the default on a synthetic 400 KB input (median of 10 alternating rounds, three runs: 1.48x, 1.38x, 1.47x); the default path measured 0.81x to 1.29x of the unpatched copy over three runs. A wider synthetic document (BOM, declaration, DOCTYPE, comment, PI, lone CR, CDATA, reference, `>` in an attribute value) positioned correctly under every one- and two-way split.
- **Duplicate search:** no prior issue. `gh issue list --state all` for "xml position", "xml line column", "Xml encoding", "in:title xml", "StartElement", "XmlError", "encoding/Xml", "Xml.decode", "parser position events" and "line column events" returned nothing about XML. Pull requests mentioning Xml: #9420 (added the module), #9531 (UTF-16 BOM as Unsupported), #9427 (CSV). The `packages/effect` changelog entries for Xml are #9420 and #9531. #9420's description and review comments give no reason for leaving events without positions.
- **Lint:** two findings, both the form's own field labels (see section 4).
- **Review loop:** independent check agreed on all four points; three hater passes; the third still raised blocking points, listed in section 5 for the owner.

**Not filed.** Approval question for the owner: file this in `Effect-TS/effect` (public), from which account, and with or without `--label enhancement`? Answer yes or no for draft 1.

## 2. Issue body, exactly as it would be filed

<!-- prettier-ignore -->
````markdown
### What is the problem this feature would solve?
`Xml.decodeString` and `Xml.decode` emit events without a line or column, so a consumer that rejects a decoded value cannot report where in the input that value was. Only an `XmlError` carries a position, and a document the decoder accepts never raises one.

Ran against `effect` 4.1.2 (`506eef1`) on Bun 1.4.2.

Decoding a *synthetic* document and reading the events:

```ts
import { Effect, Stream } from "effect"
import { Xml } from "effect/encoding"

const xml = `<order id="7">
  <item sku="a1"><price>12.50</price></item>
  <item sku="b2"><price>twelve</price></item>
</order>`

const events = await Effect.runPromise(
  Stream.make(xml).pipe(Stream.pipeThroughChannel(Xml.decodeString()), Stream.runCollect)
)
const starts = events.filter((e) => e._tag === "StartElement")
console.log("StartElement keys:", Object.keys(starts[0]))
const priceText = events[events.findLastIndex((e) => e._tag === "StartElement" && e.name === "price") + 1]
console.log("price text:", JSON.stringify(priceText), "-> Number:", Number((priceText as Xml.Text).text))
```

```text
StartElement keys: [ "_tag", "name", "attributes" ]
price text: {"_tag":"Text","text":"twelve"} -> Number: NaN
```

**Control.** A syntax error in the same shape of document is positioned: decoding `<order>\n  <item sku="a1">\n</order>` fails with `XmlError` `Syntax`, `line` 3, `column` 1, the `<` of `</order>`, message `end tag </order> does not match <item> at line 3, column 1`.

This is the documented contract. `line` and `column` belong to `XmlError`, and `decode` and `decodeString` set them on errors:
https://github.com/Effect-TS/effect/blob/506eef143bcc1750ce58920aac1e45da7265d103/packages/effect/src/encoding/Xml.ts#L43-L45

`StartElement` has `_tag`, `name` and `attributes`:
https://github.com/Effect-TS/effect/blob/506eef143bcc1750ce58920aac1e45da7265d103/packages/effect/src/encoding/Xml.ts#L133-L137

The parser already tracks the line and column of the document offset it has counted to, and uses them to position errors:
https://github.com/Effect-TS/effect/blob/506eef143bcc1750ce58920aac1e45da7265d103/packages/effect/src/encoding/Xml.ts#L1037-L1045

**Use case** (*synthetic*). A consumer reads each `<item>` into a typed record: `sku` from the start tag's attributes, `price` from the `Text` event under `<price>` through `Schema.NumberFromString`. When `"twelve"` is rejected, the consumer can name the element path (`order/item[2]/price`) but not `line 3, column 18`, where the `<price>` start tag is, because nothing in the events says where it was. The path names the value in the decoded model; a line and column name it in the file its author edits, which is what a validation report or an editor jump points at, and the parser is the only component that holds an event's document offset at the moment it emits the event. For a document streamed through `Xml.decode` from a file or a response body, the text is no longer available to search, so the position is lost for good.

### What is the feature you are proposing to solve the problem?
Request: a `positions` option on `DecodeOptions`. When it is `true`, `decode` and `decodeString` set `line` and `column` on every `StartElement` event, at the `<` of the start tag, the offset at which the parser already positions the tag's own `Limit` errors. The start tag is the anchor because every element has one, and because a text node is one token that can hold references and CDATA sections, so a single position on `Text` would not name its characters. Both fields are one-based and follow the rules `XmlError` already documents: columns count UTF-16 code units, lines end at LF, CR or CRLF, and a leading byte order mark is not counted.

Markup is parsed from at most `maxTokenSize + 1` characters and a start tag's `Limit` checks run before it is pushed, so `maxTokenSize` and `maxDepth` are enforced before a positioned event exists, as today:
https://github.com/Effect-TS/effect/blob/506eef143bcc1750ce58920aac1e45da7265d103/packages/effect/src/encoding/Xml.ts#L1156-L1159
https://github.com/Effect-TS/effect/blob/506eef143bcc1750ce58920aac1e45da7265d103/packages/effect/src/encoding/Xml.ts#L1365-L1371

The fields are declared optional on `StartElement` and are absent when the option is not set. `StartElement` events are object literals with exactly `_tag`, `name` and `attributes`; without the option the same literal is pushed, so the keys are absent rather than set to `undefined`, and existing events are unchanged. The encoders and `Xml.elements` read `name` and `attributes` by field and the module never spreads an event, so they are unchanged, and a consumer that constructs `StartElement` values for `encode` needs no new fields:
https://github.com/Effect-TS/effect/blob/506eef143bcc1750ce58920aac1e45da7265d103/packages/effect/src/encoding/Xml.ts#L1741
https://github.com/Effect-TS/effect/blob/506eef143bcc1750ce58920aac1e45da7265d103/packages/effect/src/encoding/Xml.ts#L1937

Always-present fields would change the shape of every `StartElement` the default path emits, so the fields are opt-in. The option changes which fields `StartElement` carries and nothing else: the same events are pushed at the same points, and the position is read from the `line`, `lineStart` and `counted` fields the parser already keeps for `XmlError`, so no input is retained beyond what `parse` holds today:
https://github.com/Effect-TS/effect/blob/506eef143bcc1750ce58920aac1e45da7265d103/packages/effect/src/encoding/Xml.ts#L967-L970

On the documented side the change is one bullet in the `DecodeOptions` doc block and two optional fields on `StartElement`.

```ts
export interface DecodeOptions {
  readonly maxTokenSize?: number | undefined
  readonly maxDepth?: number | undefined
  readonly positions?: boolean | undefined
}

export interface StartElement {
  readonly _tag: "StartElement"
  readonly name: string
  readonly attributes: Readonly<Record<string, string>>
  readonly line?: number | undefined
  readonly column?: number | undefined
}
```

**Not requested.** Positions on `Text`, `EndElement`, `Comment`, `ProcessingInstruction`, `Declaration` or `Doctype`; end positions or byte offsets; positions on `Element` from `Xml.elements`; any change to the encoders, to `XmlError` or to the default output of `decode` and `decodeString`.

**Feasibility.** Tested in a scratch copy at `506eef1`: the acceptance check passes, the existing `Xml.test.ts` cases stay green (21 of 21), the default path pushes the same literal as before behind one added boolean test per start tag and measured within noise of the unpatched copy (0.81x to 1.29x over three runs), and with `positions: true` a *synthetic* 400 KB document decoded in 4096-character chunks took 1.5x the default time (median of 10 alternating rounds), the scratch copy reading each position with the error path's `count`, which advances `counted` forward only and is advanced to where parsing stopped at the end of every chunk, so each character is counted once per decode and no chunk is rescanned.

**Not confirmed.**
- Whether leaving events without positions was a deliberate choice in #9420. Its description and review comments do not say.
- Whether the fields should be typed as present under `positions: true`, through an overload of `decode` and `decodeString` or a distinct positioned event type, rather than as optional fields on `StartElement`. Optional fields are the smaller change; a consumer that set the option narrows with `e.line !== undefined`.

**Acceptance check.** A test in `packages/effect/test/encoding/Xml.test.ts` that fails at `506eef1` with `Property 'line' does not exist on type 'StartElement'` and passes after the change:

```ts
it.effect("start tags carry line and column when positions is true, however the input is chunked", () =>
  Effect.gen(function*() {
    // synthetic
    const xml = "<?xml version=\"1.0\"?>\r\n<!-- c -->\n<order id=\"7\">\r  <item sku=\"a1\"><price>12.50</price></item>\n  <item sku=\"b2\"><price>twelve</price></item>\n</order>"
    const expected = [["order", 3, 1], ["item", 4, 3], ["price", 4, 18], ["item", 5, 3], ["price", 5, 18]]
    for (const chunks of splits(xml)) {
      const events = yield* decodeString(chunks, { positions: true })
      const positions = events.flatMap((e) => e._tag === "StartElement" ? [[e.name, e.line, e.column]] : [])
      assert.deepStrictEqual(positions, expected, JSON.stringify(chunks))
    }
    const plain = yield* decodeString([xml])
    for (const event of plain) {
      assert.isFalse("line" in event)
      assert.isFalse("column" in event)
    }
    const positioned = yield* decodeString([xml], { positions: true })
    assert.deepStrictEqual(
      positioned.map((e) => e._tag === "StartElement" ? { _tag: e._tag, name: e.name, attributes: e.attributes } : e),
      plain
    )
  }))
```

`decodeString` and `splits` are the helpers that file already defines; `splits` yields the input one character per chunk and at every two-way split, so a tag split in its name and a CR split from its LF are covered.

### What alternatives have you considered?
- `XmlError.line` and `XmlError.column`: set only when decoding fails. A document the decoder accepts but that holds a value the consumer rejects decodes without an `XmlError`, so there is no position to read.
- `Xml.elements`: `Element` carries `name`, `attributes` and `children` and no position, and it drops the chunk structure, so the position cannot be recovered from the outside either.
- Counting lines outside the decoder, using the contract that each output chunk holds the events completed by one input chunk: re-chunk the input at every `<`, pull the events for each piece, and attribute them to the line count at that piece. Measured against plain `decodeString` on Bun 1.4.2: 2.48x and 2.89x the time on a 4,888-character document fed as one chunk and in 4096-character chunks, and 3.56x on a *synthetic* 437 KB document. Feeding the same pieces to plain `decodeString` with no counting at all already costs 3.00x, so about three quarters of the cost is the per-piece pull round trip through the channel, which cannot be avoided from outside the channel: one piece per `<` is the only way to attribute an event to its input.
- Locating the position after the fact: keep the decoded text, walk the element path back to the start tag with a second scanner, and read its line and column. Serves `decodeString` over a string already in memory and costs nothing until a value is rejected. It needs every chunk retained until its record is accepted, so it does not serve `Xml.decode` over a byte stream, and the second scanner has to agree with the parser on every edge of the grammar (comments, CDATA sections, references, attribute quoting) to land on the same `<`.

**Related.** #9420, which added the module with `line` and `column` on `XmlError`.

---
**AI disclosure:** Written by AI and reviewed by the filer before filing.
- **Provider:** Anthropic
- **Model:** Fable 5.1
````

## 3. Filing command (not executed)

Write section 2 verbatim to a file (the gitignored `work/fr-01/draft.md` is that file today), then:

```sh
gh issue create --repo Effect-TS/effect \
  --title 'Xml: `positions` decode option that puts `line` and `column` on `StartElement` events' \
  --body-file work/fr-01/draft.md
```

To file from the non-active account, prefix that one command with `GH_TOKEN="$(gh auth token --user <account>)"`; never `gh auth switch`. No `--label`, `--assignee`, `--milestone` or `--project` unless the owner names one.

## 4. Lint output

```console
$ node <issue-authoring skill>/scripts/lint-issue.mjs work/fr-01/draft.md --title 'Xml: `positions` decode option that puts `line` and `column` on `StartElement` events' --forbid effect-xml,QTI,qti,SPIKE,spike,Vivi,vivi,Tugboat,tugboat,positions-b,locate-c,<account names>,RESULT.md
work/fr-01/draft.md:44: address: "you" addresses or asks a person. State the fact instead.
work/fr-01/draft.md:112: address: "you" addresses or asks a person. State the fact instead.
exit 1
```

Lines 44 and 112 are the form's own field labels, "What is the feature you are proposing to solve the problem?" and "What alternatives have you considered?". The skill requires a field label heading to match the form exactly, so both stay. No other finding; the forbidden tokens are absent.

## 5. Review loop

Run as the skill's step 10 with sub-agents in fresh contexts: one independent check, then three hater passes with a merit extraction after the first two. The third pass is the cap.

**Independent check** (agent that did not draft): agreed on all four points with line evidence. Behavior intended (`Xml.ts` L43-45, L51-56, L133-137); no supported route (`DecodeOptions` L253-256, `Element` L228-232, `elements` L438-445, `positionless` L1793-1794); additive (prototype diff adds optional fields and an opt-in branch only); acceptance check fails on the unpatched copy and passes on the prototype, and the hand count of the synthetic document matched. Corrections it forced: "a well-formed document never raises one" became "a document the decoder accepts never raises one" (Limit and Unsupported errors exist for well-formed input); the single-sample 1.7x bench was replaced by a median-of-rounds bench; a mismatched output label was cut with the line it was on.

**Hater pass 1** (19 points) and merit extraction: narrowed the request from `StartElement` and `Text` to `StartElement` only (settled the open `Text` semantics and the check-versus-request gap); argued why a path is not enough in the use case; made the Feasibility line carry the measured cost; strengthened the acceptance check to assert the option adds only the two fields; cut the "parser is not exported" clause; conceded the post-hoc route's happy path; reworded Related; trimmed the first code block; added the BOM, UTF-8 and `maxTokenSize` sentences. Rejected with reasons: the synthetic markers (required), the Not requested list (required), the measured alternative costs (required), attaching the patch (forbidden).

**Hater pass 2** (7 blocking, 9 minor) and merit extraction: grounded the internal claims in source (incremental `count`, literal construction at L1371, `<` as the existing `Limit` anchor, encoders reading by field at L1741 and L1937, the documented-side cost); cut the UTF-8 sentence as existing behavior; added the static-type question to Not confirmed; measured the default path; widened the acceptance input with a declaration, a comment and a lone CR. Merit extraction judged no blocking point left.

**Hater pass 3** (3 blocking, 9 minor), no merit extraction run (cap reached). The draft stands as the loop left it; the owner decides on these before filing:

1. Blocking: no real consumer; everything is marked synthetic. The skill requires a synthetic use case and forbids naming the filer's project, so the draft cannot answer this inside the body. The maintainer's likely first reply is "buffer the string and locate after the fact".
2. Blocking: the request positions the start tag, not the rejected text or an attribute value, and the maintainer may want the full shape (`Text`, attributes, `EndElement`) decided once rather than a first slice. The body gives the start tag as the anchor and lists the rest under Not requested; the owner may prefer to widen the ask back to `Text` or to ask the maintainer the shape question first.
3. Blocking: the optional-fields typing on the shared `StartElement` type that `encode` also consumes is left under Not confirmed; the maintainer may ask that question before anything else.
4. Minor, worth an owner call: `Xml.elements` is excluded, which the hater reads as the API most consumers use; "already tracks the line and column" versus the 1.5x cost (counting is lazy today and becomes eager per start tag under the option); the Feasibility and internals sentences read as an implementation report; key-absence (`"line" in event`) over-specifies object shape; the chunk-split test matrix is a maintenance cost the body does not name.

Status for the Mind: review loop run; third pass left blocking points; nothing filed.
