# Slices: xml-schema-codec, milestone 4 (promise and package)

- plan: docs/goals/xml-schema-codec/phase-4.md (ADMITTED at `235a844`; units M4-U01..M4-U10)
- slice file: docs/goals/xml-schema-codec/phase-4.slices.md
- size target: 5–10 minutes
- cut against: commit `235a844`, `effect@4.1.2`; every line number below was read on that checkout. `src/` holds only the comment-only `src/index.ts` and `test/` only `test/upstream-xml.test.ts`, so briefs name the files milestones 1 to 3 create (by their specs' write scopes) and the spike sources those files are ported from.
- slice count: 14 + tidy (15); `m4-14` is optional (owner may skip, D10)
- longest chain: 7 (`m4-1, m4-2, m4-3, m4-4, m4-7, m4-8, m4-tidy`)
- cross-phase preconditions: `deps` names only slices in this cut. Where a slice edits a file an earlier milestone creates, or reads a symbol an earlier milestone lands, its brief opens with a `Precondition:` line naming the M1, M2, or M3 **unit** ids (`phase-1.md`, `phase-2.md` at `ce0a251`, `phase-3.md` at `71eb95b`); the factory maps those units to accepted slices of the earlier phases before dispatching, and dispatches an M4 slice on a shared file only after every earlier-phase slice that writes it (tidy slices included) is accepted. The M3 unit ids below are those of `phase-3.md` at `71eb95b` (its revision per audit `3b7b59ba` renumbered no unit), and the briefs read the landed tree, never the M3 document, for names and values.
- corrected on: handle `237df403` per `docs/rd/strategic-review.md` (`79c370f`) C1, C3. Slices m4-5, m4-6, and m4-12 are edited in place with ids and deps unchanged: no slice is accepted or in progress and no factory ledger exists. Once a run has started, a later correction appends a `## Cut 2` section instead.
- corrected on: handle `6418eee3` per aggregate slice audit `f2edd498` (findings F1, F3, F5, F6, F7): slices m4-5, m4-7, m4-8, m4-9, m4-11, m4-tidy, the header, and the Notes are edited in place with ids, deps, waves, and the chain unchanged; no slice is accepted or in progress and no factory ledger exists.

## Standing rules (every brief below is bound by these; a brief names the ones it leans on)

- R-effect: Effect error channels only. `try`/`catch` is a lint error (`workspace/no-built-in-try-catch`, `vite.config.ts:78`). Return failures with `yield*`/`Effect.fail`; inside a generator keep `if`/`??`/ternary for plain value checks (`.agents/skills/effect-design/SKILL.md` "Local rulings"). A pure function returns `Option.Option<…>` for an absent result, never `null` or `undefined` (AGENTS.md "Schema intent": nullability is an actual optional value).
- R-guide: follow `node_modules/effect/AGENTS.md`: `Effect.gen` inline, `Effect.fnUntraced` for library helpers, `Effect.fn("name")` only where a span is wanted. Use `Predicate` helpers, never hand-written guards.
- R-native: before custom glue, name in the unit's doc comment the Effect API checked and the requirement it misses (`.agents/skills/effect-design/SKILL.md` "Native capability review"). For this milestone the one justification is on the generic `mixed` member (m4-2) and is quoted there. Import only public symbols or `effect/encoding/Xml`; never `applyToSelfOrLastLinkEncoding`, `replaceEncoding`, `Objects.recur`, `Arrays.recur`, `getIndexSignatureKeys`, `defaultFormatter`, `resolveAnnotations`, and never `SchemaAST.makeFilter` (`@internal`, `node_modules/effect/src/SchemaAST.ts:4226-4231`; the public alias is `Schema.makeFilter`, `node_modules/effect/src/Schema.ts:6761-6765`).
- R-m1: an M4 edit to a file milestones 1 to 3 created appends to it or edits the named seam; it never renames or re-shapes an export those milestones landed. Closed-mode behaviour (`open` absent or `false`) is untouched, and the earlier tests in the same file must still pass.
- R-doc: multiline JSDoc (`/**` on its own line) on every module-scope function, type, interface, class, and `const`, with `@param`/`@returns` on functions (`.agents/skills/document-code/SKILL.md`; `vite.config.ts:24` enforces the multiline form). Deferrals and measured facts live in doc comments, written as present-tense invariants, never as history.
- R-files: kebab-case file names and directories (`unicorn/filename-case`, `workspace/kebab-case-paths`). Inside `src/`, relative imports with the `.ts` extension (`tsconfig.json` sets `allowImportingTsExtensions`). No file under `src/` or `test/` imports from `spikes/`; the corpus is read by path with `new URL("../../spikes/fixtures/qti/<file>.xml", import.meta.url)` from `test/qti/` (`..` depth per file) and `node:fs` `readFileSync`.
- R-test: tests are `*.test.ts` beside the module (or under `test/`), import `{ describe, expect, it } from "@effect/vitest"`, and use `it.effect` for effectful cases; a pure case may use plain `it` (`test/upstream-xml.test.ts:1-25` is the model). Type-level assertions use `expectTypeOf` from `vitest`. Vitest's include is `src/**/*.test.ts`, `test/**/*.test.ts` (`vite.config.ts:91`). Assert on structured values (`_tag`, `path`, `position`, element names, counts read from the value) or on a regex of a message's shape, never on full message text; never hard-code a count the test can measure.
- R-check: the slice check is one `bun x vp test <file>` (exits 1 when the file is missing, so it cannot pass on nothing), `bun x vp check <files>` (fmt and lint path-scoped, the type check program-wide), `bun x vp fmt --check <file>`, or the named `grep`/`awk`. A multi-filter `bun x vp test a.test.ts b.test.ts` exits 0 when **either** file matches, so a slice whose check names several files confirms each appears in the `Test Files` summary and reports the count. `bun run check`, `bun run build`, `bun run test` are gate-seat commands; never run them as a slice check.
- R-errors: caller-facing messages follow `.agents/skills/error-messages/SKILL.md`: what, path, expectation, repair; neutral tone; never "invalid input". The message rule is `<what> at <xpath>[ of record <k>][ (line L, column C)]: <expectation>; <repair>`, as milestones 1 to 3 landed it.
- R-readme: `README.md` follows the `readme-authoring` skill (with its `references/examples.md` and `references/exemplars.md`), which requires the `technical-writing` and `emil-unslop-writing` skills. Its ownership test decides every sentence: the README states what a reader relies on from outside; code and tests own how.
- R-commit: one conventional commit per slice when the runner commits per slice: `feat(plan):`, `feat(compile):`, `feat(dsl):`, `feat(issue):` for library behaviour; `test:` or `test(qti):` for test-only slices; `docs:` for `README.md` and `docs/onboarding.md`; `chore(package):` for the rename; `refactor:` for the tidy slice (`.agents/skills/conventional-commits/SKILL.md`).
- R-scope (ends every brief): change only the files in `write_scope`. If the work needs any other path, change nothing and report `blocked-scope` with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

Shared vocabulary: a **Clark name** is `{uri}local`, or `local` for no namespace. `QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"`. A **`ResolvedElement`** is `{ readonly name: string; readonly attributes: Readonly<Record<string, string>>; readonly children: ReadonlyArray<ResolvedElement | string> }` with Clark names throughout (`src/element.ts`, M1-U01), and `ResolvedElementSchema` is its `Schema.declare`. The **generic member** is the `open` catch-all: in `mixed` it decodes to the item `{ _tag: "*", element: ResolvedElement }`; in `elements` it is the slot `"*"` holding `ReadonlyArray<ResolvedElement>` in document order. `*` is not an XML `NameStartChar`, so it collides with no authored member name or slot key (plan lock 2).

## Cut 1: slice

- answer: sliced
- longest chain: m4-1, m4-2, m4-3, m4-4, m4-7, m4-8, m4-tidy

### m4-1: U01 `open` on `elements` and `mixed`, recorded in the `Plan`

- write_scope: `src/plan.ts`, `src/plan.test.ts`
- deps: none
- red_first: yes
- status: pending

Precondition: M1 unit `M1-U02` is accepted (the only M1 writer of `src/plan.ts`; `phase-1.md:277-288` and its slices m1-3 to m1-6 describe what it lands: the `Plan` IR with `ContentPlan`, the spec interfaces `Elements<F>` and `Mixed<M>` and the constructors `text`, `elements`, `mixed`, `many`, `optional` ported from `spikes/declaration-dsl/xml-dsl.ts:58-64` and `:107-114`, and `lower(name, spec, map)`). Adapt the names below to what landed; the capabilities are the lock.

In `src/plan.ts`: (a) `Elements` and `Mixed` gain a second type parameter `Open extends boolean = false` and the field `readonly open: Open`; (b) `elements` and `mixed` accept an optional second argument, `elements<const F extends ChildFields, const O extends boolean = false>(fields: F, options?: { readonly open?: O }): Elements<F, O>` and `mixed<const M extends …, const O extends boolean = false>(members: M, options?: { readonly open?: O }): Mixed<M, O>`, so `elements(fields)` is `Elements<F, false>` and `elements(fields, { open: true })` is `Elements<F, true>` with no overloads; `open` defaults to `false` at run time too; (c) the `ContentPlan` for mode `elements` and for mode `mixed` carries `readonly open: boolean`, and `lower` copies `spec.content.open` into it. `empty` and `text` are unchanged and gain no option (plan lock 1, Mind ruling on audit `12e83528` F6: "`open` is a property of the child-bearing content modes; `empty` and `text` have no child slot"). The doc comment on the options argument states that an open element with no declared children is `elements({}, { open: true })` or `mixed([], { open: true })`, and that `open` applies to children only: an unknown attribute stays an issue naming the declared set, and `data-*` is the pattern group for extra attributes.

Tests in `src/plan.test.ts` (plain `it`): `lower("x", { content: elements({}, { open: true }) }, {})` yields a `ContentPlan` with `mode` `elements` and `open` `true`; `lower("x", { content: mixed([], { open: true }) }, {})` yields `mode` `mixed` and `open` `true`; the same specs without the option yield `open` `false`; `elements({}, { open: false })` yields `open` `false`; the existing M1 cases (the benchmark `qti-choice-interaction` and `qti-item-body` lowerings) pass unchanged. red_first: first make the constructors accept the options argument and ignore it, so the `open: true` assertions fail on value (the `ContentPlan` has no `open`, or it is `false`), not on a type error.

Rules: R-m1, R-doc, R-files, R-test, R-check, R-commit (`feat(plan):`). Check: `bun x vp test src/plan.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-2: U02 open `mixed`: the guarded generic member and the lock-3 measurement

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: m4-1
- red_first: yes
- status: pending

Precondition: M1 unit `M1-U03` is accepted (the only M1 writer of `src/compile.ts`; `phase-1.md:290-301`, slices m1-7 to m1-10: `compile(plan)` builds, per element, a `Schema.decodeTo` from the encoded Struct `{ name: Schema.Literal(plan.name), attributes: Schema.Record(Schema.String, Schema.String), children: Schema.Array(Schema.Union([Schema.String, ResolvedElementSchema])) }` into the target Struct; the `mixed` branch is `children: Schema.Array(Schema.Union([TextItem, ...members.map(memberItem)]))` ported from `spikes/declaration-dsl/element-codec.ts:102-107` and `:109-120`, where each `memberItem` tags the decoded value `{ _tag: <wire>, value }` and the Clark `name` sentinel on the member's encoded Struct selects the union candidate).

In `src/compile.ts`, the `mixed` branch: when `content.open` (m4-1), append one more union candidate **after every named member**, the generic member: its encoded side is `Schema.Struct({ name: Schema.String.check(guard), attributes: Schema.Record(Schema.String, Schema.String), children: Schema.Array(Schema.Union([Schema.String, ResolvedElementSchema])) })` and it decodes through `Schema.decodeTo` to `Schema.Struct({ _tag: Schema.Literal("*"), element: ResolvedElementSchema })`, the decode getter wrapping the whole input element as `element` and the encode getter returning `item.element` unchanged (the shape of `memberItem`, `element-codec.ts:109-120`). `guard` is `Schema.makeFilter((name) => declared.has(name) ? "<failure>" : undefined, { expected: <text naming the declared set> })` (`Schema.makeFilter`, `node_modules/effect/src/Schema.ts:6761-6765`; `FilterOutput` is `undefined | boolean | FilterIssue | ReadonlyArray<FilterIssue>`, `:6814`; `expected` is `Annotations.Filter`, `:19137`; `Schema.String.check` is the `check` method at `:212`), where `declared` is the set of the members' Clark names. When `open` is `false`, nothing changes.

Why the guard, in the doc comment (R-native, present tense; quote or paraphrase, and cite the three lines): `Schema.Union` candidate selection (`node_modules/effect/src/SchemaAST.ts:3515-3647`) treats a member without a literal sentinel as a runtime-type fallback that is selected for every object input (`:3602`), an unknown sentinel value selects only the fallbacks (`:3613`), and candidates are tried in declaration order with the first success winning (`:3647`, then `parseUnion` at `:3928`). Without the guard a declared member that fails (a bad `max-choices`) would fall through to the generic member and the failure would vanish; with it an unknown name reaches the generic member alone (one candidate, no `AnyOf`), and a declared name that fails produces an `AnyOf` holding the declared member's issue plus the guard's, which `translate` collapses (m4-6). The requirement Effect does not meet natively is a union member that accepts any element without masking a declared member's failure. A `*` item whose `element.name` equals a declared member's name is refused on encode by the same guard; that is an authoring error, not a library case.

Tests in `src/compile.test.ts` on hand-built `ResolvedElement` values (no XML parsing), with a `mixed` plan over member `P` (`{QTI}p`, wire `p`, carrying an `Int` attribute `n`) built as the M1 tests build theirs: open body decodes children `[<p>, <video>]` (`video` a `ResolvedElement` named `{QTI}video` with two `source` children and one `track` child) to items `[{ _tag: "p", … }, { _tag: "*", element }]` where `element` deep-equals the input `video`, and encodes back to the same children; the closed body (no option) still rejects `<video>` with the M1 failure; **the lock-3 measurement**: open body with `<p n="x">` fails through `Schema.decodeUnknownEffect`, yields no `*` item, and the `SchemaIssue` tree contains the declared member's leaf issue (walk `error.issue`: an `AnyOf` whose issues include `P`'s `InvalidValue`/`Encoding` leaf for `@n`); if instead the generic member captured `<p n="x">` as a `*` item, **stop**: do not add a selector, report the measured issue tree in the slice report (the plan names this a stop condition; the fallback, a `Plan`-driven member selector, is a Mind decision); an unknown name in the open body produces no `AnyOf` at all (decode `[<video>]` and assert success; and on a failing unknown-shaped input, if one can be built, a single-candidate issue); whitespace-only text is still kept under open `mixed`. red_first: before the change the open body rejects `<video>`, so the first assertion fails on the failure value.

Rules: R-effect, R-guide, R-native, R-m1, R-doc, R-files, R-test, R-check, R-commit (`feat(compile):`). Run the `consequences` lens before landing (the generic member changes what a union can accept; the guard is the mitigation). Check: `bun x vp test src/compile.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-3: U02 open `elements`: the `"*"` slot, decode and encode order

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: m4-2
- red_first: yes
- status: pending

Precondition: as m4-2 (`M1-U03` accepted; the `elements` branch is ported from `spikes/declaration-dsl/element-codec.ts:190-224`, where `byName` maps declared Clark names to slots at `:190`, the unknown-child branch at `:199-205` fails with the expected set, and the encode walk emits slots in declaration order, `:270-280`).

In `src/compile.ts`, the `elements` branch: when `content.open` (m4-1), the target Struct gains the field `"*": Schema.Array(ResolvedElementSchema)`; on decode, a child element whose Clark name is not a declared slot is pushed to `out["*"]` in document order instead of failing (replace the failure at the `slot === undefined` seam with the push when `open`, keep the failure when closed); non-blank text still fails and whitespace-only text is still dropped (plan lock 5 and `phase-1.md` lock 8). On encode, the declared slots are written first in slot order, as M1 does, then the `"*"` slot's elements after every declared slot in their stored order (plan lock 2: "after every declared slot"); a closed plan has no `"*"` field and its encode is unchanged.

Tests in `src/compile.test.ts`, hand-built elements, an `elements` plan with one slot `a` (member `A`, `{QTI}a`): open decodes children `[<a/>, <z/>, <y/>]` to `{ a, "*": [z, y] }` (names compared by Clark string) and encodes `{ a, "*": [z, y] }` to children `[a, z, y]` and `{ a, "*": [y, z] }` to `[a, y, z]`; open decodes `["\n  ", <a/>, " "]` with whitespace dropped and `"*"` `[]`; open fails `["stray", <a/>]` on the text; closed still fails `[<a/>, <z/>]` naming the expected set; the m4-2 and M1 cases in the file pass unchanged. red_first: before the change the open plan rejects `<z/>`, so the first decode assertion fails on the failure value.

Rules: R-effect, R-m1, R-doc, R-files, R-test, R-check, R-commit (`feat(compile):`). Check: `bun x vp test src/compile.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-4: U03 `open` inference

- write_scope: `src/dsl.ts`, `src/dsl.test.ts`
- deps: m4-3
- red_first: yes
- status: pending

Precondition: M1 unit `M1-U04` is accepted (the only M1 writer of `src/dsl.ts`; `phase-1.md:303-314`, slices m1-11 and m1-12: `namespaces`, `element`, `suspend`, and the type-level mapping `ChildType`, `ChildrenType`, `ContentType` ported from `spikes/declaration-dsl/xml-dsl.ts:72-100` and `MixedItem` from `spikes/declaration-dsl/element-codec.ts:94-100`, over the spec types `src/plan.ts` exports).

In `src/dsl.ts`, thread the flag m4-1 put on the spec types: `MixedItem<M, O>` adds the member `{ readonly _tag: "*"; readonly element: ResolvedElement }` when `O extends true`; `ContentType<C>` matches `Mixed<infer M, infer O>` and `Elements<infer F, infer O>`, and for `elements` adds `{ readonly "*": ReadonlyArray<ResolvedElement> }` to `ChildrenType<F>` when `O extends true`. Closed specs (`O` is `false`) infer exactly as before. `ResolvedElement` is the type `src/element.ts` exports. No runtime change.

Tests in `src/dsl.test.ts`, in the M1 `describe("inference")` with `expectTypeOf` (from `vitest`): an open `mixed` body's `children[number]["_tag"]` is exactly the member names plus `"*"` and a `switch` over it with a `never` default compiles when it handles `"*"`; a closed `mixed` body has no `"*"` in its `_tag` union; an open `elements` body has key `"*"` typed `ReadonlyArray<ResolvedElement>`; on a closed `elements` body, `value["*"]` is a type error under `// @ts-expect-error`; recursion through `suspend` where the recursive member is open compiles; the M1 inference cases hold unchanged. red_first: these assertions fail only under the type check, so the red run is `bun x vp check src/dsl.ts src/dsl.test.ts` before the mapping changes (the `"*"` assertions report missing keys); run it once red, once green, and `bun x vp test src/dsl.test.ts` for the runtime cases.

Rules: R-m1, R-doc, R-files, R-test, R-check, R-commit (`feat(dsl):`). Check: `bun x vp check src/dsl.ts src/dsl.test.ts` (the type check is program-wide by design; m4-3 is accepted before this slice so `src/compile.ts` is settled) and `bun x vp test src/dsl.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-5: U04 an empty `AnyOf` at a closed `mixed` index becomes one issue

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: none
- red_first: yes
- status: pending

Precondition: M1 units `M1-U05` and `M1-U09`, M2 unit `M2-U04`, and M3 unit `M3-U01` are accepted (`M3-U01` is the last writer of `src/issue.ts`, `phase-3.md:272-283`; `M1-U09` landed `translate` with its `AnyOf` branch, `phase-1.md:368-379`, slice m1-23 as corrected per strategic review C1: an `AnyOf` at a `mixed` index is resolved by name match, and when no member matches it becomes one issue naming the child's Clark name and the member set; `M2-U04` added `position` and `elementPath`, `phase-2.md:238-249`; `M3-U01` added the `Limit` reason and `record`). Touch none of those fields.

Check first: build, in the test, a closed `mixed` body (`compile(lower(...))`, as the M1-U09 tests do) with members `p` and `qti-choice-interaction`, decode an element whose third child is an unknown `<video>`, and look at the `XmlDecodeError`. This is expected to be delivered: M1-U09 (m1-23, corrected per strategic review C1) owns the no-match case. If the error already is one whose `path` ends in `video[1]` (or `video`, under `phase-1.md` lock 6 when no sibling shares the name) and whose message names `video` and the member set, add the test as a regression (once with and once without a `suspend` member in the union), report "already delivered by M1-U09", and stop. Only if M1 did not land it:

In `src/issue.ts`, the `AnyOf` branch of `translate`: an `AnyOf` whose `issues` array is empty at a `mixed` index (closed `mixed`, unknown child: no candidate is selected and `node_modules/effect/src/SchemaAST.ts:3903-3905` fails with `new SchemaIssue.AnyOf(ast, state.issues ?? [], input, options)`, so `issues` is `[]`) becomes one issue whose path segment is the child's `local[k]` (same-name one-based index, `phase-1.md` lock 6; an unknown element counts among same-named siblings like any other) and whose expectation names the child's Clark name and the declared member set (plan lock 4). `elementPath` (M2-U04) ends at the child's step. No other branch changes.

Tests in `src/issue.test.ts`, with `compile(lower(...))` definitions (name the body `qti-item-body` so the m4-8 regex applies): the closed-body case above yields exactly one `XmlDecodeError`, `reason._tag` `Schema`, `path` matching `/\/qti-item-body\/video(\[1\])?$/` (lock 6 prints `local[k]` only when a same-named sibling exists, so a sole `video` prints `video`), message matching `/video/` and naming the member set (regex on the member names, never full text), and `elementPath` whose last step has `local` `video`; two unknown `<video>` children yield `video[2]` for the second when the bad one is the second (construct the case with the failing child second; if `translate` reports only the first unknown child, assert on that and say so in a comment); the M1, M2, and M3 cases in the file pass unchanged. red_first: `yes` only on the fallback path (the `path`/`video` assertions fail on value; record what M1 prints); when the check-first finds the case delivered, the new tests pass on first run and the report says so.

Rules: R-effect, R-errors, R-m1, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-6: U04 collapse the open union's `AnyOf` to the declared member's issue

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: m4-5, m4-2
- red_first: yes
- status: pending

Precondition: as m4-5 (`M1-U05`, `M1-U09`, `M2-U04`, `M3-U01` accepted).

Check first: M1-U09 (m1-23, corrected per strategic review C1) resolves an `AnyOf` at a `mixed` index by name match, keeping the branch whose member `Plan` name (`content.members[i].name`, the Clark name) equals the input child's Clark name and dropping every other branch; with the guard in the union (m4-2) the guard's issue (the filter with the `expected` annotation naming the declared set) is one more non-matching branch. Write the tests below first; if they pass, the slice is test-only and the report says "already delivered by M1-U09". Only if the guard's issue is not dropped (its filter issue on the `name` key may be attributed to the input element rather than to the generic member): in `src/issue.ts`, the `AnyOf` branch of `translate`, attribute a branch rooted in the generic member's encoded Struct to that member so the name-match rule drops it; the path and expectation stay the declared member's (plan lock 4). Under `open` an unknown child is not an issue, so no new path form is added. Nothing else in the branch changes.

Tests in `src/issue.test.ts`, with `compile(lower(...))` definitions built with `mixed([...], { open: true })` (m4-1, m4-2) inside an `elements` root `qti-assessment-item`: `max-choices="x"` on `qti-choice-interaction` inside an **open** `qti-item-body` yields one `XmlDecodeError` whose `path` is `/qti-assessment-item/qti-item-body/qti-choice-interaction/@max-choices` and whose message names a finite number (`/finite/i`), equal in `path` and `reason._tag` to the closed-body case the M1 tests already hold (compare the two errors' `path` strings); a bad `n` on the second of two `<p>` inside an open body prints `p[2]`; the same two cases with a `suspend` member also in the open union (two fallbacks, `suspend` then guard, `phase-4.md` lock 3) give the same results; an unknown `<video>` inside an open body produces no error (decode succeeds); the m4-5, M1, M2, and M3 cases in the file pass unchanged. red_first: `yes` only on the fallback path (the `path` assertion fails on value, or the message assertion fails on the guard's `expected` text; record which); when the check-first finds the rule holds, the new tests pass on first run and the report says so.

Rules: R-effect, R-errors, R-m1, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Run the `correctness` lens here (the plan names `AnyOf` collapse with two issues as its medium risk). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-7: U05 open `mixed` witness on `bg011-media.xml`

- write_scope: `test/qti/open.test.ts`
- deps: m4-4
- red_first: no
- status: pending

Precondition: M1 units `M1-U12` (`src/index.ts` exports `element`, `namespaces`, `text`, `elements`, `mixed`, `many`, `optional`, `decodeString`, `encodeString`, `canonicalize`, `inlineNames`, `XmlDecodeError`; `phase-1.md:407-418`) and `M1-U15` (`test/qti/vocabulary.ts`, the 29-element closed vocabulary importing only `../../src/index.ts`, with `AssessmentItem` as its root; `phase-1.md:446-457`, slices m1-33 to m1-35) are accepted.

Check first: `grep -E "^export " test/qti/vocabulary.ts` lists what the vocabulary exports (m1-33 and m1-34 export every definition and the root). This slice needs the M1 `qti-item-body` member declarations (`p`, `div`, `blockquote`, `img`, `qti-extended-text-interaction`, and the rest of the body's member list) and the root's attribute spec and child declarations. If a needed member is not exported, change nothing, report `blocked-scope` naming `test/qti/vocabulary.ts` and the members, and stop; editing `vocabulary.ts` is out of scope (its closed subset is the C8 measurement).

Create `test/qti/open.test.ts` importing from `./vocabulary.ts` and `../../src/index.ts`, plus `resolveEvents` and `collect` from `../../src/resolve.ts` for the canonical check below (a cross-module test under `test/` may import `src/resolve.ts` directly, as `test/qti/vocabulary.test.ts` does in m1-33; `canonicalize` takes a `ResolvedElement` and the resolver is not exported, M1-U12; `vocabulary.ts` may not import it). Define locally, under the same `namespaces({ "": QTI, xsi: XSI })` binding the vocabulary uses: `OpenItemBody = element("qti-item-body", { attributes: <the M1 body's attributes>, content: mixed([<the M1 body's members>], { open: true }) })` and `OpenAssessmentItem`, a root `qti-assessment-item` with the M1 root's attributes and children but `body: optional(OpenItemBody)` (the conformance fixture m4-8 adds has no body) and `responseProcessing: optional(OpenResponseProcessing)` where `OpenResponseProcessing` is left for m4-8 (declare it in this slice as `element("qti-response-processing", { attributes: { template: Schema.optionalKey(Schema.String) }, content: elements({}, { open: true }) })` so the root is complete; m4-8 only adds its cases). Fixtures are read by path (R-files).

Cases (`it.effect`) on `spikes/fixtures/qti/bg011-media.xml` (its `qti-item-body` at line 13 holds, among `div`, three `p`, and `qti-extended-text-interaction`, a `video` element at lines 18-22 with two `source` children and one `track` child, none in the M1 vocabulary): `decodeString(OpenAssessmentItem)` succeeds; the body's `children` hold exactly one item with `_tag` `"*"`, its `element.name` is `{http://www.imsglobal.org/xsd/imsqtiasi_v3p0}video`, and among its `element.children` the element children named `…}source` number two and `…}track` one (count from the value with a filter, compare by Clark string); a renderer function in the test `switch`es over the body item `_tag` union with a `never` default, handling `"*"` (the exhaustiveness claim; it is checked by the gate's type check); `encodeString(OpenAssessmentItem)` of the value, decoded again, deep-equals the value; the re-encoded tree is canonically equal to the input tree (the C2 form, as m1-33): obtain the input tree with `Stream.make(text)` + `Xml.decodeString()` + `resolveEvents()` + `collect(["*"])` + `Stream.runCollect`, the output tree as `Schema.encodeEffect(OpenAssessmentItem)(value)`, and assert `canonicalize(input, { inline: inlineNames(OpenAssessmentItem) })` equals `canonicalize(output, { inline: inlineNames(OpenAssessmentItem) })` (`inlineNames` takes the definition, `phase-1.md` M1-U10). red_first is `no`: the slice changes no library code; it is the first consumer-shaped use of `open` on a real document, and a first-run failure here is a finding for rework (report the measured error with `path`, `reason._tag`, and `message`), not a reason to edit `src/`.

Rules: R-files, R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/open.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-8: U05 open `elements` witness on `conformance-adaptive-absent.xml` and the closed contrast

- write_scope: `test/qti/open.test.ts`
- deps: m4-7, m4-6
- red_first: no
- status: pending

Precondition: as m4-7 (`M1-U12`, `M1-U15` accepted).

Add to `test/qti/open.test.ts` (`it.effect`), on `spikes/fixtures/qti/conformance-adaptive-absent.xml` (root at line 2 with `identifier`, `title`, `time-dependent` only; one `qti-outcome-declaration` holding `qti-default-value` and `qti-value`, both in the M1 vocabulary; `qti-response-processing` at lines 8-15 holding `qti-set-outcome-value`, under it `qti-sum`, `qti-variable`, `qti-base-value`, none in the M1 vocabulary; no `qti-item-body`): `decodeString(OpenAssessmentItem)` (m4-7) succeeds; `responseProcessing` is present and its `"*"` slot is non-empty, holding exactly one element named `{http://www.imsglobal.org/xsd/imsqtiasi_v3p0}qti-set-outcome-value` whose descendants include `…}qti-sum` (walk the value; count, never hard-code beyond the one top-level name); `encodeString` then `decodeString` deep-equals; the re-encoded tree is canonically equal to the input tree, obtained and compared as in m4-7 (`resolveEvents`/`collect` from `../../src/resolve.ts`, `Schema.encodeEffect(OpenAssessmentItem)`, `canonicalize` with `inlineNames(OpenAssessmentItem)`). The contrast: the closed `AssessmentItem` from `./vocabulary.ts` fails `bg011-media.xml` with exactly one `XmlDecodeError` whose `reason._tag` is `Schema`, whose `path` ends at the body's `video[1]` (or `video`, if lock 6 prints no index for a sole same-named child; assert with a regex `/\/qti-item-body\/video(\[1\])?$/`), and whose message names `video` and the body's member set (m4-5's translation; this is the proof that `open` did the work). red_first is `no`, as m4-7: no library change; a first-run failure is a finding for rework.

Rules: R-files, R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/open.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-9: U06 upstream pins, command-derived from the shipped `src/`

- write_scope: `test/upstream-xml.test.ts`
- deps: none
- red_first: no
- status: pending

Precondition: M1 unit `M1-U13`, M2 unit `M2-U08`, and M3 unit `M3-U05` are accepted (the three writers of `test/upstream-xml.test.ts`, in that order; `phase-1.md:420-431`, `phase-2.md:290-301`, `phase-3.md:324-335`; each added `it.effect` pins against literal strings with a one-line comment naming the relying module or unit), and every M1 to M3 writer of `src/` is accepted, the last being `M2-U02` (`src/positions.ts`), `M3-U06`, `M3-U07`, `M3-U08` (`src/resolve.ts`, `src/positions.ts`, `src/codec.ts`), and `M3-U09` (`src/index.ts`), so the derivation below reads the finished tree.

Run the two derivations from the repository root and paste their complete output in the commit body:

```text
grep -rhoE "Xml\.[A-Za-z]+" src --include="*.ts" --exclude="*.test.ts" | sort | uniq -c | sort -rn
grep -rnE "Xml\.ts:[0-9]+" src --include="*.ts" --exclude="*.test.ts"
```

The first prints every `Xml.<symbol>` a non-test `src/` module uses; the second prints every `Xml.ts:<line>` citation in a `src/` doc comment, each of which is a reliance on a contract that is not a symbol (one output chunk per input chunk, positionless `Limit`, the encoding check). For each distinct symbol and each cited contract, confirm the file holds a pin whose one-line comment names the relying **module** (`resolve`, `collect`, `positions`, `codec`, `canonical`, `issue`); where an existing comment names only a unit (`M2-U08` and `M3-U05` name units), rewrite the comment to name the module too, changing no assertion. Add an `it.effect` pin, against literal strings and byte arrays with no fixtures, only for a symbol or contract no existing pin covers. Do not pin `Xml.elements` (the core does not route through it; R4 is a re-read at each `effect` bump). Paste `grep -c "it.effect" test/upstream-xml.test.ts` before and after, and the list of added pins (possibly empty): the count after equals the count before plus the number of added pins. red_first is `no`: pins record behaviour upstream already has.

Rules: R-test, R-check, R-commit (`test:`; the body carries both derivations and the two counts). Check: `bun x vp test test/upstream-xml.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-10: U07 README example witness

- write_scope: `test/readme.test.ts`
- deps: none
- red_first: no
- status: pending

Precondition: M1 unit `M1-U12` is accepted (`src/index.ts` exports the names below) and M2 unit `M2-U06` is accepted (`decodeString` on string input attaches `(line L, column C)` to a failure, `phase-2.md:264-275`; the README quotes the printed error, so it must carry its final shape).

Create `test/readme.test.ts`. Imports, all above the region: `{ describe, expect, it } from "@effect/vitest"`, `Effect` and `Schema` from `effect`, and only named imports from `../src/index.ts` (consumer-shaped; nothing from other `src/` files). Between the exact marker lines `// readme:start` and `// readme:end`, as top-level statements with no `import`, no `it(`, and no `expect(`: `const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"`; `const { element } = namespaces({ "": QTI })`; `SimpleChoice = element("qti-simple-choice", { attributes: { identifier: Schema.String }, content: text(Schema.String) })`; `Prompt = element("qti-prompt", { content: text(Schema.String) })`; `ChoiceInteraction = element("qti-choice-interaction", { attributes: { "response-identifier": Schema.String, "max-choices": Schema.Int }, content: elements({ prompt: optional(Prompt), choices: many(SimpleChoice) }) })`; a literal `xml` string of one `<qti-choice-interaction xmlns="…" response-identifier="RESPONSE" max-choices="1">` holding a `qti-prompt` and two `qti-simple-choice` children (`identifier` `A` and `B`); then three statements that run and print: `const value = Effect.runSync(decodeString(ChoiceInteraction)(xml))` followed by `console.log(value)`; `const text = Effect.runSync(encodeString(ChoiceInteraction)(value))`; `const failure = Effect.runSync(Effect.flip(decodeString(ChoiceInteraction)(xml.replace('max-choices="1"', 'max-choices="x"'))))` followed by `console.log(failure.message)`. Keep the region under 40 lines; it is what a README reader pastes under two import lines. Assertions sit outside the markers, in one `it` (or `it.effect`): `value["max-choices"]` is the number `1` and `value.choices` has two entries in order `A`, `B`; `decodeString(ChoiceInteraction)(text)` deep-equals `value`; `failure.path` is `/qti-choice-interaction/@max-choices` and `failure.message` matches `/finite/i`. Paste in the commit body: the output of both region checks, and the printed value and the printed one-line error exactly as `bun x vp test test/readme.test.ts` shows them (m4-11 quotes them).

```text
awk '/readme:start/{f=1;next} /readme:end/{f=0} f' test/readme.test.ts | wc -l
awk '/readme:start/{f=1;next} /readme:end/{f=0} f' test/readme.test.ts | grep -cE '^import |\b(it|expect)\('
```

The first prints a number between 1 and 40; the second prints `0`. red_first is `no`: the slice pins behaviour milestones 1 and 2 landed; the runner records the first run and the printed lines.

Rules: R-files, R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/readme.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-11: U08 README: front page, Install, Start, Development

- write_scope: `README.md`
- deps: m4-10
- red_first: no
- status: pending

Precondition: M2 unit `M2-U06`, M3 units `M3-U03` (`defaultMaxElementNodes` in `src/resolve.ts`), `M3-U08` (`positions: true` on the stream path), and `M3-U09` (`decode`, `Limit`, `defaultMaxElementNodes` exported from `src/index.ts`) are accepted. The checks below read the tree, never a planning document.

Follow R-readme in the skill's order: read `references/examples.md` then `references/exemplars.md`, fetch two exemplar READMEs live and name them in the slice report, then draft. Reader: a developer or agent landing cold who will define an XML vocabulary and decode documents with it. The README owns install, the first call, the contract surface, and the guarantees; the code and tests own how. Replace the whole of `README.md` (18 lines today: a stub whose sentences "The public API is not designed yet" and "the published name is still open" are both false) with the full skeleton and these sections written in full; m4-12 fills the four sections it names, which this slice leaves as headings with a one-line `<!-- m4-12 -->` placeholder each:

- `# effect-xml` as the only h1; one sentence that says what it is in plain words; one boundary paragraph: well-formed XML only, UTF-8 input, Effect Schema values in both directions, no DTD or XSD validation, comments and processing instructions are not in the model, status in one clause (unpublished; it publishes later as `@aidenzepp/effect-xml`; `effect/encoding/Xml` is experimental upstream).
- Links out, in their text: `docs/onboarding.md`, `AGENTS.md`, `docs/goals/xml-schema-codec/GOAL.md`.
- `## Install`: from a checkout only, `bun install --frozen-lockfile` with Bun `1.4.2` (`packageManager` in `package.json:43`), and the peer requirement `effect@^4.1.2` (`package.json:37-38`); no registry install line exists yet and none is written.
- `## Start`: one `ts` block whose first lines are `import { Effect, Schema } from "effect"` and one named-import line `from "effect-xml"` listing exactly the names the region uses, followed by the `test/readme.test.ts` region **byte for byte** (plan lock 8); then a `console` block holding the printed value and the one-line error copied from the m4-10 commit body.
- `## Round trip`, `## Positions`, `## Limits`, and the contract-surface section (heading `## Contract` or a short noun of your choosing; at most 8 `## ` headings in the file): placeholders for m4-12.
- `## Development`: the three gates (`bun run check`, `bun run build`, `bun run test`), the pre-push hook `.vite-hooks/pre-push` (`bun install` installs it), the canary rule (an `effect` minor bump is a run of `test/upstream-xml.test.ts`), and where agents start (`AGENTS.md`).
- No License section (`ls LICENSE` finds nothing and `package.json` has no `license` field); no badges, emoji, diagrams, module maps, or status tables.

Run the ownership test on every sentence and `technical-writing` and `emil-unslop-writing` over the draft. These checks pass at the end of this slice, run as written from the repository root:

````text
test -f test/readme.test.ts && [ "$(awk '/^```ts/{f=1;next} /^```/{if(f)exit} f' README.md | grep -v '^import ' | wc -l)" -gt 0 ] && diff <(awk '/^```ts/{f=1;next} /^```/{if(f)exit} f' README.md | grep -v '^import ') <(awk '/readme:start/{f=1;next} /readme:end/{f=0} f' test/readme.test.ts) && echo same
awk '/^```ts/{f=1;next} /^```/{if(f)exit} f' README.md | grep '^import ' | grep -vE 'from "(effect-xml|effect)";?$' | wc -l | tr -d ' '
grep -cE "\b(Plan|Channel|resolver)\b|[Ii]nternally|[Uu]nder the hood" README.md
bun x vp fmt --check README.md
````

The first prints `same` (the Start block minus its `import` lines equals the test region; the guards make it fail, not pass, when the test file or the block is missing); the second prints `0` (every import line in the Start block names `effect-xml` or `effect`, with or without the trailing semicolon `vp fmt` appends inside fenced `ts` blocks); the third prints `0` (word boundaries, so `explanatory` and `planned` do not count); the fourth exits 0. If `vp fmt` rewrites the Start block so that the first check no longer prints `same`, do not hand-edit the block to differ from the region: report `blocked-scope` naming `test/readme.test.ts` (the region must be reformatted there and re-quoted). red_first is `no`: documentation.

Rules: R-readme, R-check, R-commit (`docs:`). Check: the four commands above.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-12: U08 README: contract surface, round trip, positions, limits, and the close checks

- write_scope: `README.md`
- deps: m4-11
- red_first: no
- status: pending

Precondition: as m4-11 (`M2-U06`, `M3-U03`, `M3-U08`, `M3-U09` accepted).

Replace the four `<!-- m4-12 -->` placeholders m4-11 left, under R-readme (the ownership test on every sentence; `technical-writing` and `emil-unslop-writing` over the result):

- The contract surface: a table with one line each for `element`, `namespaces`, `suspend`, `text`, `elements`, `mixed`, `many`, `optional`, `decodeString`, `encodeString`, `decode` (per-record stream), `canonicalize`, `inlineNames`, `XmlDecodeError`/`XmlEncodeError`, each read from `src/index.ts` (`grep -n "export" src/index.ts`; a name that is not exported is not listed, and the slice report says which). Below it, as a bulleted list, the facts a reader relies on: decoded keys are wire names (`"max-choices"`); `data-*` is a pattern group; an unknown attribute is refused naming the declared set; `open` on `elements` and `mixed` keeps unknown children as `ResolvedElement` values; whitespace-only text is kept in `mixed` and `text` and dropped in `elements`; every failure names an XPath-like path with one-based sibling indices and the expectation.
- `## Round trip`: the promise is canonical equivalence by the exported `canonicalize`; then the exclusion list as bullets, the union of the three rulings (copy the union, not one source): attribute order, prefix spelling, quote style, entity forms, self-closing form, CDATA boundaries, comments, processing instructions, the XML declaration, whitespace outside `mixed` and `text` content, attribute-value whitespace normalisation, child order across different element names in `elements` mode since encode writes the declared slot order (`GOAL.md:83`; D1, strategic review C3), where `xmlns` declarations sit (`spikes/namespaces/RESULT.md:81`), whitespace outside the root, the intra-tag whitespace of multi-line start tags, and the DOCTYPE (`spikes/round-trip/RESULT.md:11`, `:76`); then one sentence that byte identity is not offered and why (upstream `Xml.encodeString` never writes a self-closing tag, `node_modules/effect/src/encoding/Xml.ts:471-472`).
- `## Positions`: the two-row table from `docs/rd/decisions.md:42-45` in the README's own words: string input reports line and column on failure, on by default; streamed input reports them under `positions: true`, off by default.
- `## Limits`: `maxTokenSize` 10 MiB and `maxDepth` 1024 inherited from upstream and `maxElementSize` 16 MiB per record (`grep -n "^const defaultMax" node_modules/effect/src/encoding/Xml.ts` prints lines 548-550), `maxElementNodes` at the value `grep -n "maxElementNodes" src/resolve.ts` shows on the tree (never a value from a document), `Infinity` disables each, and a `Limit` failure names the record's root element.

These checks pass at the end of this slice, run as written from the repository root, together with m4-11's four:

````text
awk '/^```/{f=!f;next} !f && !/^\|/ && !/^- /' README.md | wc -w | tr -d ' '
for t in "attribute order" "prefix" "slot order" "quote" "entity" "self-closing" "CDATA" "comment" "processing instruction" "declaration" "whitespace" "DOCTYPE" "@aidenzepp/effect-xml" "positions: true" "maxElementNodes" "canonicalize"; do printf '%-24s %s\n' "$t" "$(grep -ci -- "$t" README.md)"; done
grep -c "## " README.md
awk '/^```ts/{f=1;next} /^```/{if(f)exit} f' README.md | grep '^import ' | grep -vE 'from "(effect-xml|effect)";?$' | wc -l | tr -d ' '
grep -cE "\b(Plan|Channel|resolver)\b|[Ii]nternally|[Uu]nder the hood" README.md
````

The first prints a number between 200 and 600 (paragraph prose; code blocks, table rows, and list items excluded; on this checkout it prints `141`); the second prints no `0` (on this checkout every one of its sixteen rows is `0`); the third prints at most `8`; the fourth prints `0`; the fifth prints `0`. Report the word count, the two exemplars m4-11 fetched, and the ownership-test cuts made. red_first is `no`: documentation.

Rules: R-readme, R-check, R-commit (`docs:`). Run the `consequences` lens before landing (the README is the public promise). Check: the five commands above and `bun x vp fmt --check README.md`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-13: U09 onboarding describes the shipped tree

- write_scope: `docs/onboarding.md`
- deps: m4-12
- red_first: no
- status: pending

Precondition: M1 unit `M1-U12`, M2 unit `M2-U06`, M3 units `M3-U08` (the stream path is complete, so the module list is final) and `M3-U09` are accepted. On this checkout `grep -nE "not yet implemented|currently empty|being written concurrently" docs/onboarding.md` prints lines 3, 58, and 118.

In `docs/onboarding.md`: line 3, replace the last sentence ("The public API is designed but not yet implemented.") with the shipped status: implemented through milestone 4 and unpublished; the consumer-facing promise (install, the first call, the round-trip exclusions, positions, limits) is the root `README.md` (m4-12). Source map (table at lines 56-67): replace the `src/index.ts … (currently empty)` row (line 58) with one row per non-test module from `ls src/*.ts | grep -v '\.test\.ts$'` (paste the output in the commit body), one line each, in file order, each row's path cell spelled `` `src/<file>` `` as the current row is: `index.ts` (the single published entry point), and for `plan.ts`, `compile.ts`, `issue.ts`, `resolve.ts`, `canonical.ts`, `positions.ts` the role from the D11 table (`docs/goals/xml-schema-codec/GOAL.md:100-105`, one phrase each), for `element.ts` (Clark names and the resolved element model), `dsl.ts` (`element`, `suspend`, `namespaces`, and the inferred types), `codec.ts` (the public operations `decodeString`, `encodeString`, `decode`, and their spans) the roles `phase-1.md` M1-U01, M1-U04, M1-U11 give them (`phase-1.md:264-275`, `:303-314`, `:394-405`); keep the `test/` row and add rows for `test/qti/` (benchmark vocabulary and acceptance suites, never exported), `test/round-trip.test.ts`, `test/readme.test.ts`, and `test/upstream-xml.test.ts`; keep the `spikes/` row. Directories under `test/` the plan does not name (`test/streaming/`, `test/fixtures/`) stay covered by the generic `test/` row; add no row for them and name them as a follow-up in the slice report. "Open decisions" (lines 108-114): the package-name entry (line 112) already says settled; leave it. "Design corpus" (line 118): drop "being written concurrently with this page" (`GOAL.md` is committed). Do not restate the decisions list (lines 78-91 are the ruling summary and stay).

Checks, run as written: `grep -cE "not yet implemented|currently empty|being written concurrently" docs/onboarding.md` prints `0`; the loop below prints at least `1` beside every non-test module (it counts source-map rows whose path cell is `` `src/<file>` ``; on this checkout it prints `index.ts 1`; paste the loop and its output in the commit body); `bun x vp fmt --check docs/onboarding.md` exits 0. red_first is `no`: documentation.

```text
for f in $(ls src/*.ts | grep -v '\.test\.ts$'); do printf '%-16s %s\n' "$(basename "$f")" "$(grep -c "^| \`src/$(basename "$f")\`" docs/onboarding.md)"; done
```

Rules: R-check, R-commit (`docs:`). Check: `bun x vp fmt --check docs/onboarding.md` and the `grep -cE` above.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-14: U10 optional package rename to `@aidenzepp/effect-xml` (owner may skip)

- write_scope: `package.json`, `bun.lock`
- deps: none
- red_first: no
- status: pending

Optional slice (D10): the factory dispatches it only when the Mind files it on the owner's word; it changes no source and nothing depends on it. On this checkout `package.json:2-4` read `"name": "effect-xml"`, `"version": "0.0.0"`, `"private": true`, and `bun.lock:5-6` carry the workspace root `"": { "name": "effect-xml"`.

Set `"name": "@aidenzepp/effect-xml"` in `package.json` and run `bun install` so `bun.lock`'s root entry carries the new name. Keep `"private": true`, `"version": "0.0.0"`, `files`, `exports`, `scripts`, `devDependencies`, `peerDependencies`, `overrides`, and `packageManager` byte-identical; add no `publish`, `prepublishOnly`, `release`, `publishConfig`, or `repository` field. Checks, run as written after the commit: `grep -n '"name"\|"version"\|"private"' package.json` prints the new name, `0.0.0`, and `true`; `git diff --stat HEAD~1 -- package.json bun.lock` lists only those two files and `git diff HEAD~1 -- package.json` touches only the `name` line; `bun install --frozen-lockfile && grep -c '"private": true' package.json` prints `1`; `grep -c "publish" package.json` prints `0`. red_first is `no`: a mechanical edit.

Rules: R-check, R-commit (`chore(package):`). Check: `bun install --frozen-lockfile && grep -c '"private": true' package.json`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m4-tidy: Tidy the milestone 4 change

- write_scope: `src/plan.ts`, `src/plan.test.ts`, `src/compile.ts`, `src/compile.test.ts`, `src/dsl.ts`, `src/dsl.test.ts`, `src/issue.ts`, `src/issue.test.ts`, `test/qti/open.test.ts`, `test/upstream-xml.test.ts`, `test/readme.test.ts`, `README.md`, `docs/onboarding.md`, new files under `src/` and `test/`
- deps: m4-1, m4-2, m4-3, m4-4, m4-5, m4-6, m4-7, m4-8, m4-9, m4-10, m4-11, m4-12, m4-13
- red_first: no
- status: pending

Apply the cleanliness lens to the files this phase changed, with no behaviour change: remove any `<!-- m4-12 -->` or `// m4-N` placeholder left by the chained slices; make sure the generic member's R-native justification appears once in `src/compile.ts` and reads as a present-tense invariant; keep the `open` branches beside their closed counterparts rather than in a parallel copy of the mode logic; extract a helper into a new kebab-case file under `src/` only when a function has grown past easy reading, and `src/index.ts` must then re-export nothing new (it is not in scope; a needed export is a follow-up); dedupe test helpers `test/qti/open.test.ts` grew that `test/qti/vocabulary.test.ts` already has, only by importing them if they are exported. You may restructure tests without changing what they assert; add none. The README's Start block must still equal the `test/readme.test.ts` region (m4-11's first check prints `same` after any edit to either). The existing tests covering the scope must pass unchanged. Run `bun x vp fmt --check <changed files>` and the narrow test of each file you touch; do not run `bun run check`/`build`/`test`. A behaviour change found while tidying is reported as a follow-up and not made. If nothing needs changing, report "no changes".

Rules: R-doc, R-native, R-m1, R-files, R-check, R-commit (`refactor:`). Check: `bun x vp test src/plan.test.ts src/compile.test.ts src/dsl.test.ts src/issue.test.ts test/qti/open.test.ts test/upstream-xml.test.ts test/readme.test.ts` (seven files; confirm `Test Files 7 passed` and report the count, R-check) and `bun x vp fmt --check README.md docs/onboarding.md`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Notes

- Nothing is already delivered: on `235a844`, `src/` holds only the comment-only `src/index.ts`, `test/` only `test/upstream-xml.test.ts` (one `it.effect`), `README.md` is the 18-line stub, and `bun x vp test test/readme.test.ts` exits 1 with `No test files found`. Every unit M4-U01..U10 is covered once: U01 m4-1; U02 m4-2..3; U03 m4-4; U04 m4-5..6; U05 m4-7..8; U06 m4-9; U07 m4-10; U08 m4-11..12; U09 m4-13; U10 m4-14.
- Cross-phase order: the factory maps each `Precondition:` unit to its accepted slices in `phase-1.slices.md` (`ce3c8f4`), `phase-2.slices.md` (`1c00721`), and `phase-3.slices.md` (`2ca1606`), and dispatches an M4 slice on a shared file only after every earlier-phase slice that writes it (tidy slices included) is accepted. `phase-3.md` is at `71eb95b` (revised per audit `3b7b59ba` without renumbering a unit), so `M3-U01`, `M3-U03`, `M3-U05`, `M3-U06`, `M3-U07`, `M3-U08`, `M3-U09` map as cited; they write `src/issue.ts`, `src/resolve.ts`, `test/upstream-xml.test.ts`, `src/codec.ts`, `src/positions.ts`, `src/index.ts`. The README and onboarding briefs read `defaultMaxElementNodes` and the export list from the tree, so a revised M3 value or name needs no change here.
- Two sequencing tightenings the files allow, not plan changes: m4-9 names `M3-U09` (the last M3 writer of `src/`) in its precondition in addition to the plan's `M3-U07`/`M3-U08`, so the derivation reads the finished tree; m4-10 names `M2-U06` in its precondition (the plan names `M1-U12` only) because the README quotes the printed error and `M2-U06` adds `(line L, column C)` to it; quoting it earlier would leave the README's `console` block stale. m4-13 depends on m4-12 because its line-3 sentence points at the shipped README.
- Plan reading recorded for m4-13: the plan's "point the README sentence at the shipped README" is read as the line-3 status sentence naming the root `README.md` as the consumer-facing promise; the `README.md (seed, …)` mention on line 118 is `docs/rd/README.md` and is left alone. The plan's row list omits `test/streaming/` and `test/fixtures/` (milestones 2 and 3 create them); the generic `test/` row covers them and the slice reports them as a follow-up rather than widening the plan.
- Dependencies follow the plan's unit graph in direction, with one shortening the files allow: m4-5 (the closed-`mixed` empty `AnyOf`) needs nothing from M4 and starts at once; m4-6 (the open-union collapse) follows it on the same file and needs m4-2. The longest chain is 7, through `src/plan.ts` → `src/compile.ts` (two slices) → `src/dsl.ts` → `test/qti/open.test.ts` (two slices) → tidy. m4-4 depends on m4-3 rather than m4-1 because its check runs the program-wide type check, which must not read a `src/compile.ts` another seat still holds.
- Shared files are chained, never raced: `src/compile.ts` carries U02 in m4-2 → m4-3; `src/issue.ts` carries U04 in m4-5 → m4-6; `test/qti/open.test.ts` carries U05 in m4-7 → m4-8; `README.md` carries U08 in m4-11 → m4-12. No two slices without a `deps` path between them share a file.
- m4-14 is owner-gated (D10). The tidy slice does not depend on it: it changes no source, its two files are outside the tidy scope, and a slice the owner skips would otherwise hold the tidy slice forever. If the owner skips it, its status line becomes `accepted -` with the note "skipped by owner (D10)".
- The plan's verify gate, package posture checks, and milestone close checks (`phase-4.md` "Checkpoints And Gates") stay with the verify seat; no slice runs `bun run check`/`build`/`test`. Review lenses the plan names run at review, not as slice checks: `consequences` on m4-2 and m4-12, `correctness` on m4-2 and m4-6, `cleanliness` after m4-6 and before m4-7, `poker-face` at M4 close.
- Commands in the briefs were run on `235a844` as written: the README word count prints `141`, every exclusion-loop row prints `0` (re-run on `79c370f` with the sixteenth term `slot order`, C3: every row still `0`), the `same` check prints nothing and exits 1, the import-origin check prints `0`, the red-flag grep prints `0`, `grep -c "## " README.md` prints `0`, the onboarding grep prints lines 3, 58, 118, `bun x vp fmt --check README.md` exits 0, `bun x vp check src/index.ts` exits 0, and the two M4-U06 derivations print nothing (no `src/` module uses `Xml.*` yet). Line numbers in spike files and `node_modules/effect` (pinned `4.1.2`) hold until either moves.
- Corrected on handle `237df403` per `docs/rd/strategic-review.md`: m4-5 and m4-6 are check-first against M1-U09's name-match rule (C1 pulled the general `AnyOf` rule into `phase-1.md`; both are expected to land as test-only regressions), m4-12 carries the `elements`-mode slot-order exclusion and the sixteenth loop term (C3) and cites `GOAL.md:83` (the exclusion line was 83 at `235a844` too; `85` was a miscount). Ids and deps are unchanged; no slice was accepted or in progress.
- Corrected on handle `6418eee3` per aggregate slice audit `f2edd498`: m4-7 and m4-8 (F1: the canonical check obtains the input tree through `../../src/resolve.ts` as m1-33 does; `phase-4.md` M4-U05 says the same), m4-5 (F3: a sole `video` prints no index; the m4-8 regex), m4-tidy and R-check (F5: the multi-filter caveat), the header, m4-5, m4-9 and this note (F6: `phase-3.md` citations re-pinned to `71eb95b`, lines 272-283 and 324-335; `phase-3.slices.md` exists at `2ca1606`), m4-11 (F7: `package.json` lines 37-38 and 43). Ids, deps, and the chain are unchanged; no slice was accepted or in progress.
