# SPIKE-01 result: mixed content representation

## Question

How should a decoded value hold element content whose order matters, including text interleaved with elements, so that one definition both decodes and encodes it in document order? `docs/rd/branches/mixed-content.md` names three shapes: an ordered array with a discriminated union (A), named fields plus a text channel with position markers (B), and named fields plus a separate document-order index (C, a note only).

## Approaches compared

Both approaches are one `Schema` codec per element over the upstream `Xml.Element` tree (`Xml.elements([root])`, names matched as written, no namespace handling). The Encoded side of every definition is `{ name: Literal, attributes: Record<string, string>, children: Array<string | Element> }`; `Schema.decodeTo` with a `SchemaGetter.transform` pair reshapes it into the Type side, and the target struct's own fields decode the children. The same value is used for decode (`Schema.decodeUnknownEffect`) and encode (`Schema.encodeEffect`).

| Approach | File            | Decoded shape of `<p>`                                                                                                                                                  | Encode rule                                                                                      |
| -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A        | `approach-a.ts` | `{ _tag: "p", attributes, content: ReadonlyArray<Inline> }` with `Inline = Text \| Strong \| Br \| TextEntryInteraction \| Hottext`, each a tagged struct               | Walk `content`.                                                                                  |
| B        | `approach-b.ts` | `{ attributes, text: [{ at, text }], strong: [...], br: [...], "qti-text-entry-interaction": [...], "qti-hottext": [...] }`; `at` = count of preceding element children | Text runs by `at`; element children in field declaration order (the only rule the shape allows). |
| C        | `approach-b.ts` | B's struct plus `order: ReadonlyArray<[field, index]>`                                                                                                                  | Walk `order`.                                                                                    |

B and C share one definition helper (`element(name, childFields, mode)`), so the two differ only in the encode rule and in whether the renderer may read `order`. Definitions: `p`, `strong`, `br`, `qti-text-entry-interaction`, `qti-simple-choice` as the plan names, plus `qti-hottext` because `hottext.xml` needs it inside `<p>`.

Run command and count: `bun test spikes/mixed-content` executed **17 tests, 54 expect() calls, 0 failures**.

Type check. The plan's literal command fails under TypeScript 7.0.2 with `TS5112: tsconfig.json is present but will not be loaded if files are specified on commandline` (the repository root `tsconfig.json`), so the spike carries an equivalent per-spike `tsconfig.json` (strict, nodenext, `types: ["bun"]`). Both forms pass:

```sh
$ bun x tsc -p spikes/mixed-content
$ echo $?
0
$ bun x tsc --noEmit --strict --skipLibCheck --module nodenext --moduleResolution nodenext --types bun --ignoreConfig --allowImportingTsExtensions spikes/mixed-content/*.ts
$ echo $?
0
```

`bun x vp fmt --check spikes/mixed-content`: `All matched files use the correct format.`

## Per-criterion scores

Weights from `docs/rd/criteria.md`. C2, C4, C5, C6, C9, C10 are `n/a` for this spike. C8 is scored as a proxy only (see note).

| Criterion                          | Weight | A         | B         | C         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------ | --------- | --------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1 One definition, both directions | 15     | 5         | 5         | 5         | Each element is one `Schema` value; tests `A: <fixture> renders ... and round-trips`, `C: ...`, and `qti-simple-choice (bg007) ...` decode and encode through the same constant. B's encode runs through the same value too, but is order-lossy on bg010 (see C3).                                                                                                                                                                                                                                                                                                                                  |
| C3 Mixed-content ergonomics        | 12     | 4         | 0         | 3         | Renderer lines between the `render-X:start/end` markers in `mixed-content.test.ts`, counted with `grep -cvE '^\s*(//.*)?$'` after `vp fmt`: A **16** (8 before the formatter split each `case` onto two lines), B **17**, C **19**. A narrows exhaustively on `_tag` (`default: return node satisfies never`). B cannot render the blockquote `<p>` of bg010 in order at all (test `B: bg010-missing-word.xml loses document order`). C needs no filtering but must index into per-field arrays and, for recursion, re-enter with a cast.                                                           |
| C7 Type inference quality          | 10     | 3         | 4         | 4         | `tsc` passes (above). A: the recursive knot (`strong`, `qti-hottext` hold `Inline`) is TS7022 without annotation; it needs the five node interfaces in `approach-a.ts` (24 non-blank lines) and an annotated `Schema.suspend((): Schema.Codec<Inline, string \| Xml.Element> => Inline)`. Everything else infers; `expectTypeOf` in test `types: ...`. B/C: consumer types infer fully with no interface, but only because no recursion was attempted (the hierarchy is finite by construction), and the shared helper crosses `Struct.View` of a generic field map with two `as unknown as` casts. |
| C8 Consumer definition verbosity   | 10     | 5 (proxy) | 5 (proxy) | 5 (proxy) | The benchmark subset (`declaration-dsl.md`) is not defined here. Proxy: non-blank lines of the six element definitions. A: 43 (19 of definitions plus 24 of recursion interfaces), command `awk 'f{print}/^export const Text/{f=1;print}' approach-a.ts \| grep -cvE '^\s*(//.*)?$'`. B/C: 20, command `awk 'f{print}/^export const make/{f=1;print}' approach-b.ts \| grep -cvE ...`. Both under 60.                                                                                                                                                                                               |
| **Weighted total** (max 235)       |        | **203**   | **165**   | **201**   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Library-side line counts, for the SPIKE-05/06 readers (not scored here): A helpers (`AnyElement`, `ElementNamed`, `mixed`, `empty`) **46** lines; B/C helpers (`bucket`, `interleaveB`, `interleaveC`, `element`) **106** lines. Commands: `awk '/^export const Text/{exit}{print}' approach-a.ts | grep -cvE '^\s*(//.*)?$'` and `awk '/^export const make/{exit}{print}' approach-b.ts | grep -cvE '^\s*(//.*)?$'`.

## Deciding evidence

1. **B loses order on the fixture the branch file predicted.** The blockquote `<p>` in `bg010-missing-word.xml` has children `text, br, text, qti-text-entry-interaction, text, br, text, br, text`. B's per-name arrays hold `br × 3` and `qti-text-entry-interaction × 1`; the text runs carry `at ∈ {0, 1, 2, 3, 4}`. Nothing says whether the interaction is element 1, 2, or 3, so the renderer and the encoder both emit it in field declaration order. The test `B: bg010-missing-word.xml loses document order` asserts the mismatch; the branch file's counter-example (`<p>a<br/>b<strong>y</strong>c<br/>z</p>`) renders as `a*y*b<br/>c<br/>z` under B (test `branch counter-example: ...`). B is correct on `text-entry-cloze.xml` (two interactions, one name), `hottext.xml` (two hottexts, one name), `bg011-media.xml` (text only), and the first `<p>` of bg010, so single-name mixed content hides the defect.
2. **C restores order only by holding it twice.** `order` is a second copy of what `content` is in A, kept beside the fields it indexes. The renderer still has to look up `p.strong[i]` by field name, and recursion into `strong` or `qti-hottext` needed `as unknown as PB` because each nested struct is a different type. A value a consumer builds by hand has no `order`; the branch file's failure mode (plain spread desynchronises it) is not exercised here but follows from the shape.
3. **A's cost is the recursion annotation.** Effect 4.1.2's `Schema.suspend` needs `(): Schema.Codec<Inline, string | Xml.Element> => Inline`, and that `Inline` type cannot be `typeof Inline.Type` (circular alias), so it is written as interfaces. This is the documented pattern (`node_modules/effect/src/Schema.ts:5160-5175`). B avoided it by not recursing; a B definition of `<strong>` inside `<strong>` would pay the same price.
4. **Union discrimination works on the encoded side without a `_tag`.** Each definition's Encoded struct has `name: Schema.Literal(name)`, so `Schema.Union` indexes members by that sentinel (`SchemaAST.ts:3540-3600`) on decode, and on encode by the Type side's `_tag`. An unknown `<em>` produces `Expected string | { readonly "name": "strong", ... } | ... at ["content"][1]` under A and the explicit `unexpected child element <em>` under B/C (test `an unknown inline element is a Schema issue, not an exception`).
5. **Round trip.** Every compared subtree encodes back to an `Element` equal to the input under the local comparator (`normalize` drops whitespace-only strings only inside the `elementsMode` set; every compared subtree is `mixed`, so the comparison was exact in practice). Encoding goes through `Schema.encodeEffect` on the same definition; no event or string encoding was involved.

## What was not implemented

- Content modes as a declared option (`empty`, `text`, `elements`, `mixed`, `open`). A has `mixed` and `empty` helpers only; `text` and `elements` fall out of the same shape but were not written. The `elements`-mode whitespace rule exists only in the test comparator and was not exercised on a compared subtree.
- A's derived named-field view for `elements`-mode content (the D3 ledger text). Nothing here searches `content` by name.
- An `open` variant: unknown inline elements fail in all three approaches.
- Attribute typing, namespaces, positions, and the benchmark subset (SPIKE-02, -05, -07 own those).
- B with recursion, and C's "value built by a consumer has no `order`" failure path.
- `qti-simple-choice` was round-tripped from `bg007-true-false.xml` but no `qti-choice-interaction` (ordered element-only container) was defined, so the `elements` mode was not demonstrated as a definition.

## Recommendation

**A.** The ordered array with a discriminated union is the only shape of the three that holds document order in one place, round-trips every fixture, and renders with exhaustive narrowing. This confirms ledger call D3; nothing here reverses it. B as described in the branch file is disqualified by bg010 (C3 = 0): single-name mixed content hides the loss, and QTI bodies routinely mix `br` with inline interactions. C ties A on the weighted total but only by carrying a second copy of the order, which is the hidden invariant the branch file already names.

Two consequences for the DSL (SPIKE-05) and layering (SPIKE-06) spikes:

- Budget for recursion annotations. Under Effect 4.1.2 any self-referential inline model needs named interfaces plus an annotated `Schema.suspend`; the DSL should either generate the `Inline` union once per vocabulary so consumers annotate one knot, or accept C7 = 3 for recursive bodies.
- Keep children decoded by the target struct, not by the transformation. One `decodeTo` per element whose getters only reshape `{ name, attributes, children }` into `{ _tag, attributes, content }` means each child is decoded once by its own definition and the issue path (`["content"][1]`) comes for free.

## Open questions

1. **Plan versus code.** The section's `done_when` says both approaches render bg010 in order. B as the branch file specifies it cannot, and that is the finding; C (the note-only approach) was promoted to code to show what the minimal fix costs. The scores table therefore has three rows.
2. **C3's threshold and the formatter.** The repository formatter puts every `case` on two lines, so A's renderer is 16 formatted lines against a threshold of 10. It is 8 statements. The criterion should say whether it counts formatted lines or statements; this spike scored A 4 rather than 5 on that ambiguity.
3. **C8 was scored on a proxy.** The benchmark subset is SPIKE-05's; the per-definition counts here are offered for comparison only and should not be merged into the ledger as C8 evidence.
4. **`qti-hottext` was added** beyond the five definitions the section names, because `hottext.xml` cannot be decoded without it. It is the second recursive inline element in A.
5. **Whitespace policy in `mixed` content** was kept byte-for-byte (indentation inside `<p>` is part of the text runs). Whether a renderer wants that is a product question for the content-mode design, not this spike.
6. **Named access on A** (`item.responseDeclarations`) is still the open cost the branch file lists; a derived view was not built, so its verbosity is unmeasured.
