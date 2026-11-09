# Slices: xml-schema-codec, milestone 1 (tree-mode codec on real QTI items)

- plan: docs/goals/xml-schema-codec/phase-1.md (ADMITTED at `261cfdf`; units M1-U01..M1-U17)
- slice file: docs/goals/xml-schema-codec/phase-1.slices.md
- size target: 5–10 minutes
- cut against: commit `261cfdf`, `effect@4.1.2` (every line number below was read on that checkout)
- slice count: 38 + tidy (39)
- longest chain: 18 (`m1-1, m1-2, m1-3, m1-7, m1-8, m1-9, m1-10, m1-11, m1-26, m1-27, m1-28, m1-29, m1-33, m1-34, m1-35, m1-37, m1-38, m1-tidy`; the resolver path `m1-1, m1-2, m1-15, m1-16, m1-17, m1-18, m1-19, m1-20, m1-21, m1-27, …` reaches `m1-27` at the same depth)
- corrected on: handle `237df403` per `docs/rd/strategic-review.md` (`79c370f`) C1, C2, C7. Slices m1-10, m1-15, m1-22, m1-23, m1-33, m1-34 are edited in place with ids, deps, and the chain unchanged: no slice is accepted or in progress and no factory ledger exists, so there is no accepted slice to protect, and a rework section with replacement ids would only re-wire their dependents. Once a run has started, a later correction appends a `## Cut 2` section instead.
- corrected on: handle `6418eee3` per aggregate slice audit `f2edd498` (findings F2, F4, F5, F8, F9): slices m1-4, m1-5, m1-11, m1-33, m1-34, m1-36, m1-37, m1-38, m1-tidy (and the R-check rule) are edited in place with ids, deps, waves, and the chain unchanged; no slice is accepted or in progress and no factory ledger exists.

## Standing rules (every brief below is bound by these; a brief names the ones it leans on)

- R-effect: Effect error channels only. `try`/`catch` is a lint error (`workspace/no-built-in-try-catch`, `vite.config.ts:78`). Return failures with `yield*`/`Effect.fail`; inside a generator keep `if`/`??`/ternary for plain value checks (`.agents/skills/effect-design/SKILL.md` local rulings).
- R-guide: follow `node_modules/effect/AGENTS.md`: `Effect.gen` inline, `Effect.fnUntraced` for library helpers, `Effect.fn("name")` only where a span is wanted (lines 13-18, 51-56). Use `Predicate` helpers, never hand-written `isString`-style guards.
- R-native: before custom glue, name in the unit's doc comment the Effect API checked and the requirement it misses (`.agents/skills/effect-design/SKILL.md` "Native capability review"). Import only public symbols or `effect/encoding/Xml`; never `applyToSelfOrLastLinkEncoding`, `replaceEncoding`, `Objects.recur`, `Arrays.recur`, `getIndexSignatureKeys`, `defaultFormatter`, `resolveAnnotations` (read `ast.annotations` directly).
- R-doc: multiline JSDoc (`/**` on its own line) on every module-scope function, type, class, and `const`, with `@param`/`@returns` on functions (`.agents/skills/document-code/SKILL.md`; `vite.config.ts:24` enforces the multiline form). One blank line between top-level units and before `return` (`vite.config.ts:55-71`).
- R-files: kebab-case file names and directories (`unicorn/filename-case`, `workspace/kebab-case-paths`). Inside `src/`, relative imports with the `.ts` extension (`import { clark } from "./element.ts"`; `tsconfig.json` sets `allowImportingTsExtensions`). No file under `src/` or `test/` imports from `spikes/`; fixtures are read by path with `new URL("../spikes/fixtures/qti/<file>.xml", import.meta.url)` (`..` depth per file) and `node:fs`.
- R-test: tests are `*.test.ts` beside the module (or under `test/`), import `{ describe, expect, it } from "@effect/vitest"`, and use `it.effect` for effectful cases (`test/upstream-xml.test.ts:1-25` is the model). Type-level assertions use `expectTypeOf` from `vitest`.
- R-check: the slice check is one `bun x vp test <file>` (exits 1 when the file is missing, so it cannot pass on nothing) or `bun x vp check <files>`. A multi-filter `bun x vp test a.test.ts b.test.ts` exits 0 when **either** file matches, so a slice whose check names several files confirms each appears in the `Test Files` summary and reports the count. `bun run check`, `bun run build`, `bun run test` are gate-seat commands; never run them as a slice check.
- R-errors: caller-facing messages follow `.agents/skills/error-messages/SKILL.md`: name the offending value or constraint and a concrete next action; neutral tone; never "invalid input".
- R-commit: one conventional commit per slice when the runner commits per slice: `feat(<module>):` for library behavior, `test:` for test-only slices, `refactor:` for the tidy slice (`.agents/skills/conventional-commits/SKILL.md`).
- R-scope (ends every brief): change only the files in `write_scope`. If the work needs any other path, change nothing and report `blocked-scope` with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

Shared constants used in briefs: `QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"`, `XSI = "http://www.w3.org/2001/XMLSchema-instance"`, `MATHML = "http://www.w3.org/1998/Math/MathML"`, `XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace"`. A "Clark name" is `{uri}local`, or `local` for no namespace.

## Cut 1: slice

- answer: sliced
- longest chain: m1-1, m1-2, m1-3, m1-7, m1-8, m1-9, m1-10, m1-11, m1-26, m1-27, m1-28, m1-29, m1-33, m1-34, m1-35, m1-37, m1-38, m1-tidy

### m1-1: U01 Clark names (`XML_NAMESPACE`, `clark`, `parseClark`)

- write_scope: `src/element.ts`, `src/element.test.ts`
- deps: none
- red_first: yes
- status: pending

Create `src/element.ts` (the directory holds only `src/index.ts`, a comment-only placeholder; do not touch it). Export `XML_NAMESPACE` (`spikes/namespaces/resolver.ts:9`), `clark(namespace, local)` and `parseClark(key)` after `resolver.ts:24-25` and `:226-232`, with one change: "no namespace" is the absent case, not `null`. Model it as `Option.Option<string>` from `effect/Option` or as an optional parameter `namespace?: string` (pick one, document it on `clark`, and keep `parseClark` returning the same shape); `null` is not allowed. `clark(ns, local)` returns `{ns}local`, `clark(absent, local)` returns `local`; `parseClark` splits on the first `}` only when the key starts with `{`.

Test in `src/element.test.ts` (plain `it`, no effects): `parseClark(clark(ns, local))` round-trips for a namespaced name and a no-namespace name, and for a local name containing `}` under a namespace (`clark(QTI, "a}b")` parses back to local `a}b` because the split is on the first `}` after the leading `{`). red_first: the module does not exist, so stub `export const clark = …` returning `""` first and see the round-trip assertions fail on value, not on a missing import.

Rules: R-doc, R-files, R-test, R-check, R-commit (`feat(element):`). Check: `bun x vp test src/element.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-2: U01 `ResolvedElement`, `isResolvedElement`, `ResolvedElementSchema`

- write_scope: `src/element.ts`, `src/element.test.ts`
- deps: m1-1
- red_first: yes
- status: pending

Append to `src/element.ts`: `interface ResolvedElement { readonly name: string; readonly attributes: Readonly<Record<string, string>>; readonly children: ReadonlyArray<ResolvedElement | string> }` where `name` and every attribute key are Clark names (plan locks 1 and 3: the element carries no prefix scope; `resolver.ts:16-21` is the spike shape with a `Name` object, which this module replaces by the Clark string). `isResolvedElement(u: unknown): u is ResolvedElement` after `spikes/declaration-dsl/element-codec.ts:27-33` using `Predicate.hasProperty`/`isString`/`isObject` and `Array.isArray`. `ResolvedElementSchema = Schema.declare(isResolvedElement, { identifier: "ResolvedElement" })` (`Schema.declare`, `node_modules/effect/src/Schema.ts:590`; the spike form is `element-codec.ts:38`). Doc comment on the schema: it is the child slot of the per-element encoded Struct that `compile` builds (R-native: `Xml.Element` at `Xml.ts:228-232` has the same shape but unresolved names, which is the requirement it misses).

Tests: the guard accepts a nested element (`children: [{ name, attributes: {}, children: ["x"] }]`), rejects a string, an array, and `{ name: "a", attributes: {} }` (no `children`); `Schema.decodeUnknownSync(ResolvedElementSchema)` accepts the nested element and rejects `"text"`. Also assert the module's runtime imports are from `effect` only (read `src/element.ts` with `node:fs` and check every `from "` target starts with `effect`). red_first: stub the guard as `() => false` so the accept case fails first.

Rules: R-guide (Predicate), R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(element):`). Check: `bun x vp test src/element.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-3: U02 `Plan` IR types and the `effect-xml` marker readers

- write_scope: `src/plan.ts`, `src/plan.test.ts`
- deps: m1-2
- red_first: yes
- status: pending

Create `src/plan.ts`. Port the IR types from `spikes/declaration-dsl/element-codec.ts:40-70` with these changes (plan locks 1 and 4): `Plan { name: string (Clark); wire: string (the element name as authored, "p" or "m:math"); prefixes: PrefixMap; attributes: ReadonlyArray<AttributePlan>; data: Schema.Top | undefined; content: ContentPlan }`; `AttributePlan { key; name (Clark); schema }`; `ChildPlan { key; name (Clark); wire; schema; cardinality: "one" | "optional" | "many" }`; `ContentPlan` = `{ mode: "empty" } | { mode: "text"; key: "text"; schema } | { mode: "elements"; children } | { mode: "mixed"; key: "children"; members: ReadonlyArray<{ name: string; wire: string; schema: Schema.Top }> }` (the mixed plan holds member entries, not a prebuilt union: `compile` builds the union in m1-10). `PrefixMap = Readonly<Record<string, string>>` (`resolver.ts:180`). Export the annotation key `XML = "effect-xml"` (`element-codec.ts:18`) and the marker type `Marker { name: string; wire: string; plan: () => Plan }`. Export `markerOf(schema: Schema.Top): Marker | undefined` reading `schema.ast.annotations?.[XML]` directly (after `element-codec.ts:75-80`, checking the three fields with `Predicate`), `elementName(schema)` returning `markerOf(schema)?.name`, and `planOf(schema): Plan | undefined` returning `markerOf(schema)?.plan()`. Never call `resolveAnnotations` (R-native).

Tests: hand-annotate a schema, `Schema.String.annotate({ [XML]: { name: "{u}a", wire: "p:a", plan: () => plan } })` with a hand-built `Plan`, and assert `markerOf` returns the three fields, `elementName` returns `"{u}a"`, `planOf` returns the same `Plan` object; an unannotated schema yields `undefined` from all three; a marker missing `wire` yields `undefined`. red_first: stub `markerOf` to return `undefined`.

Rules: R-guide (Predicate), R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(plan):`). Check: `bun x vp test src/plan.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-4: U02 `qname(map)` expansion

- write_scope: `src/plan.ts`, `src/plan.test.ts`
- deps: m1-3
- red_first: yes
- status: pending

Append to `src/plan.ts`: `qname(map: PrefixMap): (key: string, kind: "element" | "attribute") => string` returning a Clark string, after `resolver.ts:182-188` and `:56-61` (`splitQName`), importing `clark`/`XML_NAMESPACE` from `./element.ts` (m1-1). Rules (plan lock 1): an unprefixed element takes `map[""]` when present, else no namespace; an unprefixed attribute is always in no namespace; prefix `xml` always resolves to `XML_NAMESPACE` with or without a map entry; any other prefix resolves through `map`; a prefix absent from the map is a definition-time programming error: return the Clark name only on success and expose the failure as a message naming the prefix and the key, in the result form `{ ok: true, name } | { ok: false, message }` (the plan says "SchemaIssue-free defect message": `qname` builds the string, `lower` (m1-5) carries it in its `Either`, and `element()`/`suspend()` (m1-11) throw it eagerly at construction, `docs/rd/strategic-review.md` ruling (d)). Document the result form; `qname` itself never throws.

Tests: `qname({})("xml:lang", "attribute")` is `{http://www.w3.org/XML/1998/namespace}lang`; `qname({ "": QTI, m: MATHML })("m:math", "element")` is `{MATHML}math`; `qname({ "": QTI })("qti-item-body", "element")` is `{QTI}qti-item-body`; `qname({ "": QTI })("max-choices", "attribute")` is `max-choices` (no namespace under a default binding); `qname({})("foo", "element")` is `foo`; `qname({})("x:a", "element")` is the failure form naming `x`. red_first: stub returns the key unchanged.

Rules: R-effect, R-doc, R-files, R-test, R-check, R-commit (`feat(plan):`). Check: `bun x vp test src/plan.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-5: U02 spec constructors and `lower` for attributes, `empty`, `text`, `elements`

- write_scope: `src/plan.ts`, `src/plan.test.ts`
- deps: m1-4
- red_first: yes
- status: pending

Append to `src/plan.ts` the spec types and constructors from `spikes/declaration-dsl/xml-dsl.ts:38-70` and `:107-122` (`Empty`, `Text`, `Many`, `Optional`, `ChildSpec`, `ChildFields`, `Elements`, `Mixed`, `Content`, `Spec`, and `text`, `elements`, `mixed`, `many`, `optional`; `Attributes` from `:24`). Members and children are typed as element codecs: define `ElementCodec<Name, T> extends Schema.Codec<T, ResolvedElement>` with the phantom `"~xml.name": Name` after `element-codec.ts:23-25` (the encoded side is `ResolvedElement` from `./element.ts`, not `Xml.Element`). Then `lower(name: string, spec: Spec, map: PrefixMap): Plan` after `xml-dsl.ts:132-185`: `name` becomes `qname(map)(name, "element")`, `wire` is `name` as given, `prefixes` is `map`; each attribute key other than `"data-*"` becomes `{ key, name: qname(map)(key, "attribute"), schema }`; `"data-*"` fills `data`; `empty`/`text`/`elements` as in the spike, where an `elements` child's `name` and `wire` are read from the child codec's marker (`markerOf(child.schema)`, m1-3) and a child without a marker is the definition-time error of `xml-dsl.ts:124-130` naming the parent and slot (`<name> child "key": expected an element codec`). A `qname` failure (m1-4) is raised the same way. `mixed` lowering is m1-6; until then `lower` on a `mixed` spec may return a `mixed` plan with `members: []` and a `// m1-6` note.

Decide the definition-time failure mechanism once here and document it on `lower`: the plan says a "SchemaIssue-free defect message … (definition-time programming error, not a decode failure)". `lower` is a pure function called while building a definition, so it returns `Either.Either<Plan, DefinitionError>` (`effect/Either`) with `DefinitionError` a plain `Data.TaggedError("DefinitionError")<{ message }>` (`node_modules/effect/src/Data.ts:919`) and never throws itself. Its consumers (`compile` in m1-7, `element`/`suspend` in m1-11) unwrap it with `Either.match` and, on `Left`, `throw` the `DefinitionError` eagerly at construction: `docs/rd/strategic-review.md` ruling (d) settles that a synchronous constructor misused by the consumer is a defect whose only mechanism is `throw`, that the lint forbids the `try` statement only (`tools/lint/no-built-in-try-catch.mjs` visits `TryStatement`; upstream throws the same way in `Xml.ts:449-451` and `:552-558`), and that the failure is eager at definition time, never deferred to the first decode. Record the choice in the doc comment; it is the one place the library turns a consumer programming error into a defect.

Tests (plan done_when for U02, part 1): `lower("qti-choice-interaction", { attributes: { "response-identifier": Schema.String, "max-choices": Schema.Int, "min-choices": Schema.optionalKey(Schema.Int), "data-*": Schema.String }, content: elements({ prompt: optional(Prompt), choices: many(Choice) }) }, { "": QTI })`, with `Prompt` and `Choice` hand-annotated schemas carrying `{ name: "{QTI}qti-prompt", wire: "qti-prompt", plan }` and `{ name: "{QTI}qti-simple-choice", wire: "qti-simple-choice", plan }`, yields `name` `{QTI}qti-choice-interaction`, `wire` `"qti-choice-interaction"`, attribute names `response-identifier`, `max-choices`, `min-choices` (no namespace), `data` the `Schema.String`, children `[{ key: "prompt", cardinality: "optional", wire: "qti-prompt" }, { key: "choices", cardinality: "many", wire: "qti-simple-choice" }]`; `lower("br", {}, {})` is `empty`; `lower("qti-value", { content: text(Schema.String) }, {})` is `text` with key `"text"`; an `elements` child without a marker yields the `DefinitionError` naming `<qti-choice-interaction> child "prompt"`. red_first: `lower` stub returns an `empty` plan with `wire: ""`.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(plan):`). Check: `bun x vp test src/plan.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-6: U02 `lower` for `mixed` members (name and wire from the marker)

- write_scope: `src/plan.ts`, `src/plan.test.ts`
- deps: m1-5
- red_first: yes
- status: pending

In `src/plan.ts` `lower`, the `mixed` case: for each member codec in `spec.content.members`, read `markerOf(member)` (m1-3) and push `{ name: marker.name, wire: marker.wire, schema: member }`; a member without a marker is the `DefinitionError` naming the parent and `"mixed member <index>"`. This is plan lock 4 made explicit: the marker `{ name, wire, plan }` that `compile` puts on every element codec (m1-7) is the only carrier of the authored spelling past lowering, and `lower` copies `wire` from it so `compile` (m1-10) can tag decoded mixed items with the authored name (`"m:math"`) while the Clark `name` selects the union member.

Tests (plan done_when for U02, part 2): `lower("qti-item-body", { content: mixed([P, Math]) }, { "": QTI, m: MATHML })` with `P` hand-annotated `{ name: "{QTI}p", wire: "p", plan }` and `Math` `{ name: "{MATHML}math", wire: "m:math", plan }` yields `content.members` `[{ name: "{QTI}p", wire: "p" }, { name: "{MATHML}math", wire: "m:math" }]` with `schema` the same objects; an unannotated `Schema.String` member yields the `DefinitionError` naming `<qti-item-body>` and the member index. red_first: the m1-5 stub returns `members: []`, so the member assertions fail first.

Rules: R-effect, R-doc, R-files, R-test, R-check, R-commit (`feat(plan):`). Check: `bun x vp test src/plan.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-7: U03 `compile` skeleton: encoded Struct, attributes, `empty`, marker

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: m1-2, m1-3
- red_first: yes
- status: pending

Create `src/compile.ts` with `compile(plan: Plan): Schema.Codec<unknown, ResolvedElement, unknown, unknown>` after `spikes/declaration-dsl/element-codec.ts:296-338`, with the T3 change (decisions.md T3 ruling, "`ElementSchema` moves from `Schema.declare(isElement)` to a per-element `Schema.Struct({ name: Schema.Literal(plan.name), attributes, children })`"): the `From` side is `Schema.Struct({ name: Schema.Literal(plan.name), attributes: Schema.Record(Schema.String, Schema.String), children: Schema.Array(Schema.Union([Schema.String, ResolvedElementSchema])) })` (`Schema.Struct` `Schema.ts:3597`, `Literal` `:2743`, `Record` `:4024`, `Array` `:4677-4699`, `Union` `:4994`; `ResolvedElementSchema` from `./element.ts`). The target Struct's attribute fields are `Schema.toCodecStringTree(a.schema)` (`:18441`; spike `:297-300`). Decode and encode getters via `SchemaGetter.transformEffect` (`node_modules/effect/src/SchemaGetter.ts:930`) over `Effect.fnUntraced` generators after `element-codec.ts:138-161` (attribute handling: declared keys mapped, undeclared attribute fails with a `SchemaIssue.Pointer([`@${name}`], new SchemaIssue.InvalidValue({ message }))` naming the declared set, `:133-134`, `:156-159`) and `:233-254` (encode). Content mode `empty` admits whitespace-only text children only (`:164-174`, plan lock 8); the other modes are stubs that fail with an `InvalidValue` message `"m1-8"`/`"m1-9"`/`"m1-10"` until those slices land. Annotate the result with exactly `{ [XML]: { name: plan.name, wire: plan.wire, plan: () => plan } }` (plan lock 4; `XML` from `./plan.ts`). This marker is what `lower` reads (`markerOf`, m1-3; member copying in m1-6), so the authored `wire` flows definition → marker → `lower` → `Plan.content.members[i].wire` → the `_tag` of a decoded mixed item (m1-10).

Doc comment (R-native): `Schema.toEncoderXml` and `Xml.elements` were checked; neither maps attributes and children to a typed Struct or resolves names, which is the requirement this module meets.

Tests on hand-built `ResolvedElement` values (no XML parsing): an `empty` plan with attributes `id: Schema.String`, `n: Schema.Int` decodes `{ name, attributes: { id: "a", n: "3" }, children: ["\n  "] }` to `{ id: "a", n: 3 }` and encodes back to an element with `n: "3"` and no children; `n: "x"` fails through `Schema.decodeUnknownEffect` (`Schema.ts:1535`) with an issue whose rendered message names a finite number (match `/finite/i` on `SchemaError.message`, not exact text); an undeclared attribute fails with a message containing the declared set `id, n`; a non-blank text child under `empty` fails; `markerOf(compile(plan))` returns `{ name: plan.name, wire: plan.wire }` and `planOf(...)` returns `plan`. red_first: the module is new; stub `compile` to return `ResolvedElementSchema` cast to the codec type so the decode assertions fail on value.

Rules: R-effect, R-guide, R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(compile):`). Check: `bun x vp test src/compile.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-8: U03 `text` and `elements` content modes

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: m1-7
- red_first: yes
- status: pending

In `src/compile.ts`, replace the `text` and `elements` stubs. `text`: target field `text: Schema.toCodecStringTree(content.schema)`; decode joins string children and fails on an element child (`element-codec.ts:175-188`); encode pushes the string when non-empty (`:260-269`); whitespace-only runs are kept (plan lock 8). `elements`: target fields per child by cardinality (`Schema.Array` for `many`, `Schema.optionalKey` (`Schema.ts:2406`) for `optional`, the schema itself for `one`; spike `:308-316`); decode groups children by Clark `name` into slots (`:189-224`), drops whitespace-only text, fails on non-blank text, on an unknown child (message names the expected set by wire names), and on more than one child in a `one`/`optional` slot; encode emits slots in declaration order (`:270-280`). A missing `one` child surfaces as the Struct's own `MissingKey` issue (`SchemaIssue.ts:458`); do not add a second check.

Tests: a `text` plan decodes `["a", "b"]` children to `{ text: "ab" }` and `[" "]` to `{ text: " " }`, fails on an element child; with `Schema.Int` text, `"3"` → `3`; an `elements` plan with `optional` and `many` slots decodes a body with indentation strings, one optional child and two many children to the typed shape (whitespace dropped), round-trips to the same children order without the whitespace, fails on `"stray"` text, fails on an unknown child naming the expected wire names, fails on a second child in the optional slot. red_first: the m1-7 stubs fail every `text`/`elements` case.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(compile):`). Check: `bun x vp test src/compile.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-9: U03 `data-*` attributes

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: m1-8
- red_first: yes
- status: pending

In `src/compile.ts`: when `plan.data` is defined, the target is `Schema.StructWithRest(struct, [Schema.Record(Schema.TemplateLiteral(["data-", Schema.String]), Schema.toCodecStringTree(plan.data))])` (`Schema.ts:4251`, `:2872`; spike `element-codec.ts:323-331`); decode passes `data-*` attributes through under their own key (`:153-154`) and encode writes every `data-` key back (`:248-254`). When `plan.data` is undefined, a `data-foo` attribute is an undeclared attribute (m1-7 path).

Tests: a plan with `data: Schema.String` decodes `data-foo="1"` to `{ "data-foo": "1" }` beside the declared attributes and re-encodes it; with `data: Schema.Int`, `data-n="2"` → `2` and `"x"` fails naming a finite number; a plan without `data` rejects `data-foo` naming the declared set. red_first: before the change `data-foo` is rejected as undeclared, so the accept case fails first.

Rules: R-effect, R-doc, R-files, R-test, R-check, R-commit (`feat(compile):`). Check: `bun x vp test src/compile.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-10: U03 `mixed` content: indexed union tagged by the authored wire name (R2 recheck)

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: m1-9
- red_first: yes
- status: pending

In `src/compile.ts`, replace the `mixed` stub. Build `TextItem` (`element-codec.ts:102-107`: `Schema.String` → `{ _tag: "text", text }` via `SchemaGetter.transform`, `SchemaGetter.ts:889`) and one `memberItem` per `content.members[i]` (`:109-120`): `member.schema.pipe(Schema.decodeTo(Schema.Struct({ _tag: Schema.Literal(entry.wire), value: Schema.toType(member.schema) }), …))` (`Schema.decodeTo` `Schema.ts:5678`, `toType` `:2598`). The `_tag` literal is `entry.wire`, the authored name `lower` copied from the member's marker (m1-6; plan lock 4: "the Clark `name` selects the union member, the authored `wire` tags the decoded item"). The target field is `children: Schema.Array(Schema.Union([TextItem, ...memberItems]))`. Because every member's encoded side is the per-element Struct whose `name` is `Schema.Literal(<clark>)` (m1-7), `Schema.Union` indexes candidates by that sentinel (`node_modules/effect/src/SchemaAST.ts:3515-3546`, `getCandidateIndex`/`collectSentinels`). A `suspend` member is the exception: `toCandidate` returns `unknown` for a `Suspend` before any sentinel is read (`SchemaAST.ts:3391`), so it is a runtime-type fallback tried on every element child, in declaration order with the indexed candidates (`:3602`, `:3647`). Order the union `[TextItem, ...named member items, ...suspend member items]`: a member is a `suspend` member when `SchemaAST.isSuspend(member.schema.ast)` holds (public guard, `SchemaAST.ts:403`); keep author order within each group and say in the doc comment why the order exists (plan lock 1 and M1-U03; strategic review C1). Decode passes `element.children` through unchanged (`:225-228`), keeping whitespace-only runs (plan lock 8); encode checks every item is a string or element (`:281-288`).

Tests: a `mixed` plan over members `P` (`{QTI}p`, wire `p`) and `Math` (`{MATHML}math`, wire `m:math`), each a `compile`d plan, decodes children `["a ", <p>, " ", <math>]` to items tagged `text`, `p`, `text`, `m:math` in order and encodes back to the same children; whitespace-only text is kept. **R2 recheck (goal stop condition):** give `P` an `Int` attribute and decode a body whose `<p>` has that attribute set to `"x"`; collect the failure with `Schema.decodeUnknownEffect` and walk `error.issue`: exactly one leaf issue (`InvalidValue`/`Encoding` leaf) must exist, not one per named member, and no `AnyOf` (`SchemaIssue.ts:919`) with more than one surviving branch. Then add a third member entry built by hand, `{ name: "{QTI}div", wire: "div", schema: Schema.suspend(() => Div).annotate({ [XML]: { name, wire, plan: () => divPlan } }) }`, where `Div` is a compiled `mixed` plan over `P` (the marker shape of plan lock 4; m1-11's `suspend` constructor is not a dep here), and repeat the failing decode: the issue tree's only named-member leaf is still `P`'s, with at most the `suspend` member's own `name` literal mismatch beside it under one `AnyOf` (strategic review C1: a `suspend` member is a fallback the sentinel index never removes; m1-23 drops that branch by name match); authoring the `suspend` entry first or last gives the same decoded value on valid input and the same leaf set on the failing input. If a second named member's issue appears in either run, stop, do not add a selector, and report the measured issue tree in the slice report (the plan names this a stop condition; the fallback is a Mind decision, not a slice edit). red_first: the m1-7 stub fails every mixed decode.

Rules: R-effect, R-guide, R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(compile):`). Check: `bun x vp test src/compile.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-11: U04 `namespaces`, `element`, `suspend` with the ported type mapping

- write_scope: `src/dsl.ts`, `src/dsl.test.ts`
- deps: m1-6, m1-10
- red_first: yes
- status: pending

Create `src/dsl.ts`. Port the type-level mapping from `spikes/declaration-dsl/xml-dsl.ts:18-36` (`Simplify`, `IsOptional`, `AttributesType`), `:72-100` (`ChildType`, `ChildrenType`, `ContentType`) and `MixedItem` from `element-codec.ts:94-100`, over the spec types exported by `./plan.ts` (m1-5). Runtime: `namespaces(map: PrefixMap)` returns `{ element, suspend }` bound to `map`; the bare exports `element` and `suspend` are `namespaces({})`'s. `element(name, spec?)` is `compile(lower(name, spec ?? {}, map))` (`xml-dsl.ts:190-201`), unwrapping the `Either` from `lower` (m1-5) with `Either.match`: on `Left`, `throw` the `DefinitionError` eagerly at construction (`docs/rd/strategic-review.md` ruling (d): a synchronous constructor misused by the consumer is a defect, `throw` is its only mechanism, and the lint `tools/lint/no-built-in-try-catch.mjs` forbids the `try` statement only; the plan calls this a definition-time programming error, not a decode failure, and it never defers to the first decode). No `Either` or result object leaves `element()` or `suspend()`. Type it `ElementCodec<Name, Simplify<AttributesType<A> & ContentType<C>>>`. `suspend(name, thunk)` after `element-codec.ts:85-92`: `Schema.suspend(thunk)` (`Schema.ts:5180`) annotated `{ [XML]: { name: qname(map)(name, "element"), wire: name, plan: () => planOf(thunk()) } }` (plan lock 4; `planOf` forces the thunk only when read). `suspend`'s doc comment states that a `suspend` member of `mixed` is dispatched as a fallback, never by the name index, and that `compile` orders it after the named members, so author order carries no cost (M1-U04, strategic review C1). The definition stays generator-shaped: no closure over runtime state.

Tests (runtime only; the type assertions are m1-12): `namespaces({ "": QTI, xsi: XSI }).element("qti-value", { content: text(Schema.String) })` decodes a hand-built `ResolvedElement` named `{QTI}qti-value` and rejects one named `qti-value` (no namespace) with a message naming the expected name; a `mixed` body holding a member authored as `"m:math"` under `namespaces({ "": QTI, m: MATHML })` decodes to an item whose `_tag` is `"m:math"` through `element` and through `suspend("m:math", () => Math)`; `markerOf(suspend(...))` has `wire` `"m:math"` and `planOf` returns the inner plan; construction-time throw: `expect(() => element("qti-choice-interaction", { content: elements({ prompt: optional(Schema.String as never) }) })).toThrow(/child "prompt"/)` (the m1-5 `DefinitionError` for a child without a marker) and `expect(() => element("x:a")).toThrow(/x/)` (the m1-4 undeclared prefix), both thrown before any decode runs. red_first: the module is new; stub `element` as a cast of `ResolvedElementSchema` so the decode assertions fail on value.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(dsl):`). Check: `bun x vp test src/dsl.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-12: U04 inference assertions (criterion 9)

- write_scope: `src/dsl.ts`, `src/dsl.test.ts`
- deps: m1-11
- red_first: no
- status: pending

Add to `src/dsl.test.ts` a `describe("inference")` of `expectTypeOf` checks (import from `vitest`) over definitions built with m1-11's `element`/`suspend`: a branded `identifier` attribute keeps its brand; `Schema.Int` is `number`; `Schema.Boolean` is `boolean`; `Schema.optionalKey(...)` attributes are optional keys; `"data-*": Schema.String` yields `` `data-${string}` `` keys; `elements({ prompt: optional(P), choices: many(C) })` yields `prompt?: …` and `choices: ReadonlyArray<…>`; `mixed([P, Math])` yields `children` whose `_tag` union is exactly `"text" | "p" | "m:math"` and narrows exhaustively in a `switch` (write the switch with a `never` default); no field is `unknown`; recursion (`div` in `div`) compiles with one named interface plus `suspend` (spike `benchmark-b.ts` shape); `elements({ value: Schema.String })` is a type error under `// @ts-expect-error` (SPIKE-05 evidence 3: a non-element child is rejected at the type level). Fix the type mapping in `src/dsl.ts` where an assertion exposes a gap; add no runtime behavior. red_first is `no` because these assertions fail only under the type check, not at run time.

Check: `bun x vp check src/dsl.ts src/dsl.test.ts` (the form is verified in the plan baseline; fmt and lint are path-scoped, the type check is program-wide by design) and `bun x vp test src/dsl.test.ts` to confirm the runtime cases still pass. Rules: R-doc, R-files, R-test, R-check, R-commit (`test:`).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-13: U05 `XmlDecodeError` and `XmlEncodeError` with reason unions

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: none
- red_first: yes
- status: pending

Create `src/issue.ts` following the reason pattern of the installed guide, `node_modules/effect/ai-docs/src/01_effect/04_errors/20_reason-errors.ts:11-27` (an outer `Schema.TaggedError` whose `reason` is `Schema.Union` of tagged reasons). `XmlDecodeError { reason; path: string; message: string }` with reasons `Schema` (carries the `Schema.SchemaError`, `Schema.ts:1219`), `UndeclaredPrefix` (`prefix: string`, `where: string`), `WellFormedness` (carries the upstream `Xml.XmlError`, `Xml.ts:51`); `XmlEncodeError` mirrors with `Schema`, `UnmappedNamespace` (`namespace: string`, `what: string`), `InvalidEvent` (`Xml.XmlError`). Plan lock 5: class and reason names are this slice's choice; the fields and the message rule are the invariant. The two causes are not schema-describable records; carry them either with `Schema.declare(Xml.isXmlError)` (`Xml.ts:73`) / `Schema.declare(Schema.isSchemaError)`-style guards inside `Schema.TaggedError`, or make those two reasons `Data.TaggedError` (`node_modules/effect/src/Data.ts:919`, as upstream `XmlError` is) while the outer class stays `Schema.TaggedError` where `Effect.catchReason` (`Effect.ts:5144`) still selects it. Record the choice and why in the class doc comment (R-doc "Preserve consequential knowledge").

Tests: each reason constructs; `Effect.catchReason("XmlDecodeError", "UndeclaredPrefix", handler)` on `Effect.fail(new XmlDecodeError({ reason: new UndeclaredPrefix(...), path: "/a/x:b", message: "…" }))` runs the handler and a `Schema` reason passes through; the same for `XmlEncodeError` with `UnmappedNamespace`. red_first: the module is new; stub the classes without the `reason` field so `catchReason` has nothing to select, then add it.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-14: U05 `xpath` printer and `formatMessage`

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: m1-13
- red_first: yes
- status: pending

Append to `src/issue.ts`: a `PathSegment` type and `xpath(segments: ReadonlyArray<PathSegment>): string` implementing plan lock 6: element segments print the local name, `local[k]` only when `k` is given (one-based position among same-named element siblings), `text()[j]` for a text item in `mixed`, attributes `@local` for no namespace, `@xml:local` for `XML_NAMESPACE`, `@{uri}local` otherwise; an empty list prints `/`. Segments carry Clark names; the printer parses them with `parseClark` from `./element.ts` (m1-1) — add that import; a resolver-level segment (as-written, undeclared prefix) is a plain string segment printed verbatim. `formatMessage({ what, path, expectation, repair })` returns `` `${what} at ${path}: ${expectation}; ${repair}` `` (plan lock 5 message rule). R-errors: `what` names the failing thing (`attribute max-choices="x"`), `expectation` the constraint (`expected a finite number`), `repair` a concrete next action.

Tests: `xpath` renders `/a/b[2]/@c`, `/a/text()[1]`, `/a/@xml:lang` (attribute segment with Clark `{http://www.w3.org/XML/1998/namespace}lang`), `/a/@{u}x`, and `/` for no segments; `formatMessage` output equals the form for a `Schema` example, an `UndeclaredPrefix` example (`element <foo:bar> at /root/foo:bar: prefix foo is not declared; declare xmlns:foo on this element or an ancestor`) and a `WellFormedness` example; each message names what, constraint, and action and contains no "invalid input". red_first: stub `xpath` to return `""`.

Rules: R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-15: U06 `resolveEvents` channel (scope stack, `xmlns*` consumed)

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m1-2, m1-13
- red_first: yes
- status: pending

Create `src/resolve.ts`. Types: `ResolvedStart { _tag: "StartElement"; name: string (Clark); attributes: Readonly<Record<string, string>> (Clark keys); scope: Readonly<Record<string, string>> }` (plan lock 3: the in-scope prefix map rides on the event, not on the collected element), `ResolvedEnd { _tag: "EndElement"; name }`, `ResolvedText { _tag: "Text"; text }`, `ResolvedEvent` their union; `Declaration`, `Doctype`, `Comment`, `ProcessingInstruction` are dropped (D8). `resolveEvents<IE, Done>(): Channel.Channel<NonEmptyReadonlyArray<ResolvedEvent>, XmlDecodeError | IE, Done, NonEmptyReadonlyArray<Xml.Event>, IE, Done>` built with `Channel.fromTransform` (`node_modules/effect/src/Channel.ts:294-306`) in the shape of upstream `makeChannel`, `node_modules/effect/src/encoding/Xml.ts:562-616`: a synchronous machine with `out`, `push`, `end`; `Pull.matchEffect` (`Pull.ts:438`) over the upstream pull; output already produced is emitted before a failure; one output chunk per input chunk. Upstream catches a thrown `XmlError` (`Xml.ts:586-593`); this module may not throw (R-effect), so the machine records the first failure in a field and `push` returns early once it is set; the pull fails with it after draining `out`. `makeChannel` is module-private upstream and is copied by shape, never imported. Resolution rules from `spikes/namespaces/resolver.ts:73-128`: `xmlns`/`xmlns:*` extend the scope for the element they appear on and are not emitted as attributes; an unprefixed element takes the default binding (`""`) if present; an unprefixed attribute is in no namespace; `xml:` always resolves to `XML_NAMESPACE`; attribute keys are `clark(...)` (`./element.ts`, m1-1). The failure path for an undeclared prefix is m1-16; here leave a `// m1-16` placeholder that treats it as no namespace. Intern Clark names per run (strategic review C7): a cache keyed by as-written name inside the current scope frame, dropped when a frame changes a binding, returns one string object per distinct expanded element or attribute name; keep the resolved start event an additive record (milestone 3 stamps the as-written `size` on it, `phase-3.md` lock 4; do not add it here).

Doc comment (R-native): `Xml.decodeString` reports names as written and treats `xmlns` as ordinary attributes (`Xml.ts:301-302`); nothing upstream maps prefixes to URIs.

Tests (`it.effect`, events via `Stream.make(xml).pipe(Stream.pipeThroughChannel(Xml.decodeString()), Stream.pipeThroughChannel(resolveEvents()), Stream.runCollect)`, `Stream.ts:784`, `:16246`, `:19384`): `<a xmlns="u" xmlns:p="v" x="1" p:y="2"><p:b/></a>` yields starts named `{u}a` with attributes `{ x: "1", "{v}y": "2" }` (no `xmlns*`) and scope `{ "": "u", p: "v" }`, then `{v}b`; `<a xml:lang="en"/>` yields attribute key `{http://www.w3.org/XML/1998/namespace}lang`; `<?xml version="1.0"?><!--c--><a/>` yields only the start and end of `a`; text events pass through unchanged; `<a xmlns:p="v"><p:b/><p:b/></a>` yields two starts whose `name` strings satisfy `Object.is` (the intern cache, one line). red_first: stub the channel to pass events through with unresolved names so the Clark assertions fail first.

Rules: R-effect, R-guide, R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-16: U06 `UndeclaredPrefix` failure with the as-written path

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m1-15, m1-14
- red_first: yes
- status: pending

In `src/resolve.ts`, replace the m1-15 placeholder: an element or attribute prefix (other than `xml`) absent from the scope fails the channel with `XmlDecodeError` reason `UndeclaredPrefix { prefix, where }` (m1-13), `path` the as-written path of names from the root to this element (`resolver.ts:63-64` `pathOf`; plan lock 6: resolver-level failures print names as written since no expansion exists yet), and `message` from `formatMessage` (m1-14) with what `element <foo:bar>` or `attribute foo:x of <bar>`, expectation `prefix foo is not declared`, repair `declare xmlns:foo on this element or an ancestor` (`resolver.ts:66-71` is the spike wording). The machine keeps the as-written name stack for the path.

Tests: `<root><foo:bar/></root>` fails with reason `_tag` `UndeclaredPrefix`, `prefix` `"foo"`, `path` `/root/foo:bar`, and a message matching the form; `<root><a foo:x="1"/></root>` fails with path `/root/a` and `where` naming the attribute; events before the failing element are still emitted (collect with `Stream.runCollect` on a channel piped through `Stream.either`-style capture, or assert on the error alone and separately that `<root><ok/><foo:bar/></root>` fails rather than succeeding). red_first: the placeholder treats the prefix as no namespace, so the failure assertion fails first.

Rules: R-effect, R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-17: U06 fixture tests (C4 at the event level)

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m1-16
- red_first: no
- status: pending

Add to `src/resolve.test.ts` (reading fixtures with `node:fs` `readFileSync(new URL("../spikes/fixtures/qti/bpig-mathml.xml", import.meta.url), "utf8")`): `bpig-mathml.xml` (root binds `xmlns`, `xmlns:xsi`, `xmlns:m`, lines 2-4; inner `<math xmlns="http://www.w3.org/1998/Math/MathML">` at line 22) resolves the inner `math` start to `{MATHML}math` and the root's `xml:lang`/`xsi:schemaLocation` to Clark keys under `XML_NAMESPACE` and `XSI`; `imsmanifest.xml` resolves its default, `imsmd`, and `imsqti` vocabularies by URI (read the three `xmlns` values from the file text in the test and assert the start names use them); `spikes/namespaces/fixtures/bpig-mathml-reprefixed.xml` and `imsmanifest-reprefixed.xml` resolve to event sequences deep-equal to their originals after dropping `scope` from each start (the prefixes differ, `xs`/`mml` at lines 3-4, the expansions do not); deleting the inner `xmlns` on `<math>` by string replacement changes the resolved `math` name to `{QTI}math`; an unprefixed attribute under a default namespace has a no-namespace key. red_first is `no`: these pin m1-15/m1-16 behavior on real documents and pass once written.

Rules: R-files (fixture paths, no `spikes/` import), R-test, R-check, R-commit (`test:`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-18: U07 `collect(path)` channel

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m1-17
- red_first: yes
- status: pending

Append to `src/resolve.ts`: `collect<IE, Done>(path: ReadonlyArray<string>): Channel.Channel<NonEmptyReadonlyArray<ResolvedElement>, XmlDecodeError | IE, Done, NonEmptyReadonlyArray<ResolvedEvent>, IE, Done>`, the same `fromTransform` machine shape as m1-15. `path` is a root-anchored list of Clark names or `"*"`, the contract of `Xml.elements` (`Xml.ts:389-397`: each element whose ancestors and own name match the path is emitted once its end tag arrives; nested matches are part of the outer tree). Frames as `resolver.ts:43-49` (`name`, `attributes`, `children`), built on a matching start, text appended as string children with adjacent text merged (`resolver.ts:149-158`), whitespace-only runs kept (the compiler decides per mode), the element emitted on its `EndElement`. Match tracking after upstream `Collector`, `Xml.ts:1723-1757` (depth counter, `matched` index) — copied by shape; `Collector` is module-private. No budgets (M3); leave the frame shape open for a node counter. Doc comment (R-native): `Xml.elements` collects unresolved names and drops ancestor scope (`Xml.ts:1742-1757`).

Tests over `bg007-true-false.xml` events through `Xml.decodeString()` → `resolveEvents()` → `collect(...)`: `collect(["*"])` yields exactly one element named `{QTI}qti-assessment-item` whose children include whitespace strings and whose nested `qti-simple-choice` text is intact; `collect(["{QTI}qti-assessment-item", "{QTI}qti-item-body"])` yields exactly one `{QTI}qti-item-body`; `collect(["{QTI}nope"])` yields no element and no error. red_first: stub the channel to emit nothing, so the count assertion fails first.

Rules: R-effect, R-guide, R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-19: U08 `toEvents` walk: root declarations, prefix reuse, `Declaration` option

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m1-18, m1-13
- red_first: yes
- status: pending

Append to `src/resolve.ts`: `toEvents(element: ResolvedElement, options: { prefixes: PrefixMap; declaration?: boolean }): Effect.Effect<ReadonlyArray<Xml.Event>, XmlEncodeError>` after `spikes/namespaces/resolver.ts:190-261` (`prefixFor`, `spell`, `toEvents`) and `spikes/round-trip/pipeline.ts:30-40` (depth-first event order). This slice: the root declares the definition's whole map as `xmlns`/`xmlns:p` attributes (`resolver.ts:241-246`); an element or attribute in a namespace bound by an in-scope prefix is spelled with it (`resolver.ts:190-200`; attributes never use the default prefix `""`); `XML_NAMESPACE` spells `xml:`; the walk keeps a scope stack (plan lock 7) seeded with the root's map. Emit `{ _tag: "Declaration", version: "1.0", encoding: "UTF-8" }` first (`Xml.ts:87-91`) unless `declaration: false` (D8). A namespace with no usable prefix is m1-20's job; here fall back to the local name with a `// m1-20` note. `UnmappedNamespace` is m1-21. Doc comment (R-native): upstream `Writer` (`Xml.ts:1869`) writes names as given and knows nothing of namespaces.

Tests: a tree `{QTI}a` with child `{MATHML}math` under `{ "": QTI, m: MATHML }` yields `StartElement` names `a` (attributes `xmlns`, `xmlns:m`) and `m:math`, text and end events in document order, and a leading `Declaration`; `declaration: false` omits it; an attribute `{XML_NAMESPACE}lang` spells `xml:lang`. red_first: stub returns `[]`.

Rules: R-effect, R-guide, R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-20: U08 per-element declarations and `xmlns=""` undeclaration

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m1-19
- red_first: yes
- status: pending

In `src/resolve.ts` `toEvents`, complete plan lock 7 for elements: for each element, reuse an in-scope prefix bound to its namespace; else, if the definition map binds a prefix for that namespace, declare `xmlns:p="uri"` on this element and use it; else declare `xmlns="uri"` on this element (default binding for this subtree); an element in no namespace while a default binding is in scope gets `xmlns=""`. Push the resulting scope for the subtree and pop after the end tag. This is forced by the corpus: `extended-text-postcard.xml` (line 29) and `text-and-media.xml` re-bind the default namespace on an inner `<math>` with no prefix (plan Repo-Aware Baseline), and decisions.md T4 lists "encode-side `xmlns=""` undeclaration and per-subtree declaration placement" as the not-verified item this closes.

Tests: `{QTI}root` → `{MATHML}math` with an empty map yields `math` with attribute `xmlns="http://www.w3.org/1998/Math/MathML"` on the inner start and `xmlns="…imsqtiasi_v3p0"` on the root; a no-namespace child `br` under the QTI default yields `br` with `xmlns=""`; a second `{MATHML}` child under the same parent re-declares (each declares on itself; the comparator does not care); with `{ m: MATHML }` in the map but no root binding of `m` in scope, the inner element declares `xmlns:m`. red_first: the m1-19 fallback spells the local name without a declaration, so the attribute assertion fails first.

Rules: R-effect, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-21: U08 `UnmappedNamespace` for attributes and `Xml.encodeString` acceptance

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m1-20, m1-14
- red_first: yes
- status: pending

In `src/resolve.ts` `toEvents`: an attribute in a namespace with no in-scope prefix and no map prefix fails with `XmlEncodeError` reason `UnmappedNamespace { namespace, what }` (m1-13), `path` the XPath of the element (use `xpath`, m1-14, with Clark element segments), `message` via `formatMessage`: what `attribute <local>`, expectation `no prefix is bound to namespace <uri>`, repair `add a prefix for it to the definition's namespaces map` (`resolver.ts:202-206` is the spike wording; R-errors). Attributes never take the default prefix.

Tests: a root with attribute `{v}y` under a map without `v` fails with reason `UnmappedNamespace`, `namespace` `"v"`, and a message in the form; every event sequence produced in the m1-19/m1-20 tests is accepted by `Stream.fromIterable(events).pipe(Stream.pipeThroughChannel(Xml.encodeString()), Stream.mkString)` (`Xml.ts:511`, `Stream.ts:999`, `:20069`) and the text re-decodes through `Xml.decodeString()` without error (plan done_when "`Xml.encodeString` accepts every emitted sequence"). red_first: before the change the attribute is spelled by local name and encodes, so the failure assertion fails first.

Rules: R-effect, R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-22: U09 `translate` over the `Plan`: attributes and `elements` slots; `toDecodeError`/`toEncodeError`

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: m1-14, m1-6, m1-9
- red_first: yes
- status: pending

Append to `src/issue.ts`, generalising `spikes/schema-layering/approach-b.ts:336-362` (`translatePath`) and `:364-383` (`translateIssue`) over the `Plan` (`./plan.ts`) instead of the AST (decisions.md T2: "In the library the metadata is the `Plan` tree instead of AST annotations: attribute keys become `@name`, `elements`-mode slot keys become the child wire name"). `translate(plan, element, issue): { segments: ReadonlyArray<PathSegment>; leaf: SchemaIssue.Issue }` walks `Pointer` (`SchemaIssue.ts:394`), `Composite` (`:581`), `Encoding` (`:313`), descending into child plans through `planOf(child.schema)` (forces `suspend`) and into the input element's children in step: a `Pointer` key equal to an `AttributePlan.key` or a `data-*` key becomes an attribute segment (Clark `name`); a key equal to an `elements` slot key becomes an element segment with the child's Clark `name` and, for `many` slots, the array index selects which same-named sibling; a `MissingKey` (`:458`) leaf keeps the parent path and the expectation names the missing child's wire name. `mixed` indices and `AnyOf` are m1-23 (leave the `mixed` branch returning the raw index and pass an `AnyOf` through unchanged; m1-23 resolves it by matching `content.members[i].name` against the input child's Clark name, so keep the member list reachable from the `mixed` branch). `toDecodeError(plan, element, error: Schema.SchemaError): XmlDecodeError` builds reason `Schema` with `path: xpath(segments)` and `message: formatMessage({ what, path, expectation: <leaf message>, repair })`; `toEncodeError` mirrors it onto `XmlEncodeError`. Same-named-sibling index rule (lock 6): `local[k]` only when the parent holds more than one child element with the same Clark name, `k` one-based among them.

Tests with definitions built by `compile(lower(...))` (`./compile.ts`, `./plan.ts`): an `elements` parent `{QTI}qti-choice-interaction` with child `qti-prompt` and `max-choices: Schema.Int`; decode `max-choices="x"` via `Schema.decodeUnknownEffect`, pass the `SchemaError` to `toDecodeError`, and assert `path` is `/qti-choice-interaction/@max-choices` and the message names a finite number; a missing required child yields the parent path and names the missing wire name; an unknown child in `elements` names the expected set; a bad attribute on the second of two `many` children prints `qti-simple-choice[2]`, on a sole child prints the name without an index; `toEncodeError` on an encode failure yields `XmlEncodeError` reason `Schema` with a path. red_first: stub `translate` to return the raw struct keys so the `@max-choices` assertion fails.

Rules: R-effect, R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-23: U09 `mixed` indices (`p[2]`, `text()[j]`) and `AnyOf` resolution by name match

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: m1-22, m1-10
- red_first: yes
- status: pending

In `src/issue.ts` `translate`, the `mixed` branch: a `Pointer` key `children` followed by an array index `i` selects `element.children[i]`; a string child becomes `text()[j]` with `j` one-based among the parent's string children; an element child becomes `local[k]` (or `local` when it is the only same-named sibling) and the walk continues into that member's plan (`planOf(member.schema)` from the plan's `content.members`); the `_tag`/`value` wrapper that `memberItem` adds (m1-10) is transparent: a `value` key is skipped, never printed. An `AnyOf` issue (`SchemaIssue.ts:919`) at a `mixed` index whose input child is an element is resolved by name match: keep the branch whose member has `Plan` name (`content.members[i].name`) equal to the child's Clark name, drop every other branch, and continue the walk into the kept one; identify a branch's member by the Clark `name` its issue is rooted in (the member's encoded Struct, plan lock 4: the `XML` marker on the member schema, or the `Schema.Literal(<clark>)` a `name` mismatch leaf names) and record the mechanism in the doc comment. The sentinel index leaves one candidate only when the union has no fallback: a `suspend` member is never indexed (`SchemaAST.ts:3391`) and adds its own `name` literal mismatch to every failure under that union (m1-10; strategic review C1), and milestone 4's guard adds one more. When no member matches, whether `issues` is empty (closed `mixed` with no fallback: `SchemaAST.ts:3904` fails with `state.issues ?? []`) or every branch is a non-matching fallback, emit one issue whose segment is the child's `local[k]` (lock 6; an unknown element counts among same-named siblings like any other) and whose expectation names the child's Clark name and the declared member set (plan M1-U09, pulled forward from `phase-4.md` lock 4; decisions.md T2 "Not verified: translation of `AnyOf` issues from mixed-content unions" is the gap this closes). Plan lock 6: `text()[j]`, `j` one-based among text children; `local[k]` only when more than one same-named element sibling exists.

Tests with `compile(lower(...))` definitions: a `mixed` body `{QTI}qti-item-body` over `p` (with `Int` attribute `n`) and `qti-choice-interaction` (with `max-choices: Schema.Int`): `max-choices="x"` inside the body yields exactly one `XmlDecodeError` whose `path` is `/qti-assessment-item/qti-item-body/qti-choice-interaction/@max-choices` (wrap the body in an `elements` root `qti-assessment-item` for the full path) and whose message names a finite number; a bad `n` on the second of two `<p>` prints `p[2]`; on a sole `<p>` prints `p`; a `text`-mode member fed an element child prints `text()[1]` when the failing item is the first text child — construct the case per lock 6; the issue tree holds one leaf (T3/R2 proof at the translation level); with `div` as `mixed([P, Blockquote, suspend("div", () => Div)])` and `blockquote` as `mixed([P, suspend("div", () => Div)])` (the `bg010-missing-word.xml` nesting; build the `suspend` members as m1-10 does, by hand with the marker), a bad `n` on `<p>` under `div > blockquote > p` yields one `XmlDecodeError` whose `path` is `/div/blockquote/p/@n` and `translate` returns one leaf (the `suspend` branch is dropped at each level; C1 recheck); an unknown `<video>` as the third child of the closed body yields one `XmlDecodeError` whose `path` ends in `video[1]` (or `video` when no sibling shares the name) and whose message names `video` and the member set, once with and once without a `suspend` member in the union (the empty `AnyOf` and the fallback-only `AnyOf`). red_first: before the change the `mixed` branch prints the raw index, so `p[2]` fails first.

Rules: R-effect, R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-24: U10 `canonicalize` over `ResolvedElement`

- write_scope: `src/canonical.ts`, `src/canonical.test.ts`
- deps: m1-2
- red_first: yes
- status: pending

Create `src/canonical.ts` from `spikes/round-trip/canonical.ts:10-61` over `ResolvedElement` (`./element.ts`): `CanonicalOptions { inline: ReadonlySet<string> }` where the set holds Clark names; `defaultInline` is the spike set (`:16-31`) with every name expanded under `QTI` (the corpus authors XHTML `p`, `span`, … in the QTI default namespace); `escape`, `normalizeText`, `canonicalAttributes` (keys sorted), `canonicalChildren` (whitespace-only children dropped outside the inline set, normalised inside), `canonicalize(element, options = { inline: defaultInline })` printing `<{clark}…>` with the Clark name, so two trees equal in expanded names but different in prefix spelling are equal (D1 "Namespace-aware comparison" not-verified item, closed here). Doc comment: the D1 exclusion list (attribute order, quote style, entity form, self-closing form, declaration, comments, PIs, whitespace-only text outside the inline set, attribute-value whitespace normalisation); the README publishes it in M4.

Tests: port the comparator semantics of `spikes/round-trip/round-trip.test.ts:87-125` onto resolved trees with Clark names (attribute order insignificant; whitespace-only children dropped outside / kept normalised inside the inline set; text whitespace runs normalised and markup escaped; different names or values unequal); add: two trees whose names are `{MATHML}math` reached through different prefixes are equal (they are the same Clark string; the test documents why). red_first: the module is new; stub `canonicalize` to return `""` so the inequality cases fail first.

Rules: R-doc, R-files, R-test, R-check, R-commit (`feat(canonical):`). Check: `bun x vp test src/canonical.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-25: U10 `inlineNames(def)` derived from the `Plan`

- write_scope: `src/canonical.ts`, `src/canonical.test.ts`
- deps: m1-24, m1-6
- red_first: yes
- status: pending

Append to `src/canonical.ts`: `inlineNames(def: Schema.Top): ReadonlySet<string>` reads `planOf(def)` (`./plan.ts`) and walks child plans (`elements` children via `planOf(child.schema)`, `mixed` members via `planOf(member.schema)`) with a visited set keyed by `Plan` identity so recursive `div` terminates; returns the Clark names of every element whose content mode is `mixed` or `text` (D1: "the comparator's inline-element set is derived from definitions (`mixed`/`text` modes)"). The `Plan` stays private; consumers pass the definition they hold.

Tests: a `qti-item-body` definition built from `lower`ed `Plan`s hand-annotated with the `XML` marker (compile is a sibling unit; a schema `.annotate({ [XML]: { name, wire, plan: () => plan } })` suffices) with `mixed` `p` and `text` `qti-value` and an `elements` wrapper returns exactly `{ "{QTI}qti-item-body", "{QTI}p", "{QTI}qti-value" }`; a recursive `div` (`Schema.suspend` annotated with a thunked plan that references itself) terminates and includes `{QTI}div` once; an unannotated schema returns the empty set. red_first: stub returns the empty set.

Rules: R-doc, R-files, R-test, R-check, R-commit (`feat(canonical):`). Check: `bun x vp test src/canonical.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-26: U11 `decodeString(Def)`

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m1-11, m1-18, m1-16, m1-22
- red_first: yes
- status: pending

Create `src/codec.ts` (a seam the spikes did not isolate; D11 allows adding a module). `decodeString<Def extends ElementCodec<string, unknown>>(def: Def) => (xml: string) => Effect.Effect<Def["Type"], XmlDecodeError>`: `Stream.make(xml)` (`Stream.ts:784`) through `Xml.decodeString()` (`Xml.ts:334`), `resolveEvents()` (m1-15), `collect(["*"])` (m1-18), `Stream.runCollect` (`:19384`); exactly one element is expected (zero or more than one is a defect of the pipeline, since `decodeString` guarantees a single root; die with a message naming the count); then `Schema.decodeUnknownEffect(def)(element)` (`Schema.ts:1535`) with `Schema.SchemaError` mapped by `toDecodeError(planOf(def), element, error)` (m1-22) and `Xml.XmlError` mapped to reason `WellFormedness` with `path` `/` (upstream names no path) and a `formatMessage` message carrying the upstream `message`. Use `Effect.fnUntraced` here; the span is m1-28. Keep every failure typed in the error channel (R-effect; `Effect.mapError` `Effect.ts:6676` or `catchTag` `:4702`).

Tests (`it.effect`): with an in-test definition covering `bg007-true-false.xml` (built with `namespaces({ "": QTI, xsi: XSI })` from `./dsl.ts`: `qti-assessment-item` with `identifier`, `title`, `time-dependent: Schema.Boolean`, `xml:lang`, `xsi:schemaLocation` optional; `qti-response-declaration`, `qti-correct-response`, `qti-value` text, `qti-outcome-declaration`, `qti-default-value`, `qti-item-body` mixed over `p` mixed and `qti-choice-interaction` with `max-choices: Schema.Int`, `qti-prompt` mixed, `qti-simple-choice` mixed, `qti-response-processing` empty; attribute `template` on it) `decodeString(AssessmentItem)(text)` succeeds and the value's `identifier` equals the fixture root's `identifier` attribute; `"<a><b></a>"` fails with reason `WellFormedness` carrying an `XmlError`; `"<a><x:b/></a>"` fails with reason `UndeclaredPrefix`; the bg007 copy with `max-choices="x"` (line 23) fails with reason `Schema` and `path` `/qti-assessment-item/qti-item-body/qti-choice-interaction/@max-choices`. red_first: the module is new; stub `decodeString` to fail with a placeholder so the success case fails first.

Rules: R-effect, R-guide, R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(codec):`). Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-27: U11 `encodeString(Def, options?)`

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m1-26, m1-21
- red_first: yes
- status: pending

Append to `src/codec.ts`: `encodeString(def, options?: { declaration?: boolean }) => (value: Def["Type"]) => Effect.Effect<string, XmlEncodeError>`: `Schema.encodeEffect(def)(value)` (`Schema.ts:1983`) to a `ResolvedElement`, `toEvents(element, { prefixes: planOf(def).prefixes, declaration: options?.declaration ?? true })` (m1-19..21; plan lock 9: the declaration is emitted by default, `{ declaration: false }` omits it), `Stream.fromIterable(events)` through `Xml.encodeString()` (`Xml.ts:511`), `Stream.mkString` (`Stream.ts:20069`); `SchemaError` via `toEncodeError(planOf(def), element?, error)` (m1-22; the input element is the value's encoding, pass what is available), `Xml.XmlError` to reason `InvalidEvent`. `Effect.fnUntraced`; the span is m1-28.

Tests: `encodeString(AssessmentItem)(yield* decodeString(AssessmentItem)(bg007))` produces text that starts with `<?xml version="1.0" encoding="UTF-8"?>`, that `Xml.decodeString` accepts, and that `decodeString(AssessmentItem)` decodes to a deep-equal value; `{ declaration: false }` output does not start with `<?xml`; an encode-side failure (a value with `max-choices: 1.5` cast past the type) yields `XmlEncodeError` reason `Schema`. red_first: stub fails with a placeholder.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(codec):`). Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-28: U11 spans `xml.decodeString` / `xml.encodeString` and the one debug log

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m1-27
- red_first: yes
- status: pending

In `src/codec.ts`, wrap each public operation in one span: `Effect.fn("xml.decodeString")` / `Effect.fn("xml.encodeString")` (`node_modules/effect/AGENTS.md` lines 51-56; `Effect.ts:24225`), or `Effect.withSpan` (`:17815`) around the inner effect; one span per call, none per element or event (`.agents/skills/trace-effect/SKILL.md`: trace public operations, not per-event steps). After a successful decode, exactly one `Effect.logDebug` (`Effect.ts:24462`) with the root local name as an annotation; no error log (the failed span and the typed error carry the diagnostics; a duplicate log is a trace-effect violation). The library installs no tracer or logger (AGENTS.md).

Tests: install a recording tracer with `Tracer.make({ span: (options) => … })` (`node_modules/effect/src/Tracer.ts:31-44` is the interface, `:479` the constructor) via `Effect.withTracer` (`Effect.ts:16970`) and assert exactly one span named `xml.decodeString` per decode call on success and on failure (the malformed input case), and exactly one `xml.encodeString` per encode call (criterion 11); assert no span is created per element (count stays 1 for bg007). red_first: before the change the recorder sees zero spans.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(codec):`). Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-29: U12 entry point exports and the lint override removal

- write_scope: `src/index.ts`, `vite.config.ts`
- deps: m1-25, m1-28
- red_first: no
- status: pending

Replace the placeholder comment in `src/index.ts` (lines 1-6, comment only) with a module doc comment and named re-exports (no wildcard): `element`, `suspend`, `namespaces` (`./dsl.ts`); `text`, `elements`, `mixed`, `many`, `optional` and type `PrefixMap` (`./plan.ts`); `decodeString`, `encodeString` (`./codec.ts`); `canonicalize`, `inlineNames` (`./canonical.ts`); `XmlDecodeError`, `XmlEncodeError` and their reason classes (`./issue.ts`); types `ResolvedElement` (`./element.ts`) and `ElementCodec` (`./plan.ts`). `Plan`, `planOf`, `markerOf`, and `XML` stay private (closed IR). Delete the override block at `vite.config.ts:35-40` (`files: ["src/index.ts"], rules: { "unicorn/no-empty-file": "off" }`; its own comment says to delete it with the first export); keep the `tools/**/*.test.mjs` override (`:41-52`). No test file: the proof is `grep -c "no-empty-file" vite.config.ts` printing `0` and, at the verify gate's `bun run build`, `dist/index.d.ts` naming `decodeString`, `encodeString`, `element`, `XmlDecodeError`, `ResolvedElement` (criterion 12); run the grep yourself, not the build.

Rules: R-files (relative `.ts` imports so `dist/index.d.ts` resolves), R-doc, R-check, R-commit (`feat(index):`; the config edit is the same story, not a separate `build:` commit). Check: `bun x vp check src/index.ts vite.config.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-30: U13 upstream event-shape pins

- write_scope: `test/upstream-xml.test.ts`
- deps: none
- red_first: no
- status: pending

Add `it.effect` cases to the existing `describe("effect/encoding/Xml")` in `test/upstream-xml.test.ts:8-25`, each against a literal string, each with a one-line comment naming the module that depends on the shape: whitespace-only `Text` events between elements inside the root are emitted (`resolve`/`collect` keep them for `mixed`); prefixed names arrive as written with `xmlns` and `xmlns:m` as ordinary attributes (`resolve`; `Xml.ts:301-302`); text and child events interleave in document order (`collect`); `Xml.encodeString` writes explicit end tags, never `<e/>` (`Xml.ts:471-472`; `canonical`'s exclusion list), and accepts a `Declaration` event first (`toEvents`); `Xml.decodeString` fails `&nbsp;` with an `XmlError` (D9). At least six tests in the file after the change. red_first is `no`: these pin behavior upstream already has.

Rules: R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/upstream-xml.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-31: U14 raw-tree round trip per corpus file

- write_scope: `test/round-trip.test.ts`
- deps: m1-18, m1-21, m1-24
- red_first: yes
- status: pending

Create `test/round-trip.test.ts` (the C5 proof at the resolver level). Enumerate `spikes/fixtures/qti/*.xml` with `node:fs` `readdirSync(new URL("../spikes/fixtures/qti/", import.meta.url))` filtered to `.xml` (15 files today; never write the count into the test). For each file, one `it.effect`: decode through `Xml.decodeString()` + `resolveEvents()` + `collect(["*"])` (`../src/resolve.ts`); build the prefix map from the fixture text with a regex union over `xmlns(:p)?="u"` declarations (a raw tree has no `Plan`); `toEvents(root, { prefixes })` + `Xml.encodeString()` + `Stream.mkString`; resolve the output again; assert `canonicalize(second, { inline: defaultInline })` equals `canonicalize(first, …)` (`../src/canonical.ts`). Assert the enumerated count is greater than zero and equals the number of cases registered (register the count in a module-level variable and check it in a final `it`). red_first: stub the per-file body to compare against `""` so every case fails, then fill the pipeline.

Rules: R-files (fixture paths; no `spikes/` import), R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/round-trip.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-32: U14 fixed point and the exclusion note

- write_scope: `test/round-trip.test.ts`
- deps: m1-31
- red_first: yes
- status: pending

In `test/round-trip.test.ts`, extend each per-file case: encode the second tree again and assert the text equals the first encoding (fixed point after one pass). Add a file-level comment naming the exclusions the comparator applies (D1 list, as m1-24's doc comment states) and that the typed round trip through definitions is `test/qti/vocabulary.test.ts`'s C1 test. red_first: assert the fixed point before adding the second encode call, so the case fails on a missing value.

Rules: R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/round-trip.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-33: U15 QTI vocabulary: the benchmark subset, C1 on `bg007-true-false.xml`

- write_scope: `test/qti/vocabulary.ts`, `test/qti/vocabulary.test.ts`
- deps: m1-29
- red_first: yes
- status: pending

Create `test/qti/vocabulary.ts` importing only from `../../src/index.ts` (consumer-shaped, criterion 12). Export every element definition and the root (`export const` on each; test-module exports are not a public surface) so later cross-module tests under `test/qti/` (`open.test.ts`, M4-U05) reuse the body members and root declarations without editing this file. Under `namespaces({ "": QTI, xsi: XSI })` define the `declaration-dsl.md` subset after `spikes/declaration-dsl/benchmark-b.ts` (read it as shape, do not import): `qti-assessment-item` (`identifier` branded `Schema.String.pipe(Schema.brand("Identifier"))`, `title`, `time-dependent: Schema.Boolean`, `xml:lang` optional, `xsi:schemaLocation` optional, `adaptive` optional; **no `xmlns`/`xmlns:xsi` attributes**, plan lock 2: `benchmark-b.ts:105-106` is the spike mistake to drop), `qti-response-declaration`, `qti-correct-response`, `qti-value` (text), `qti-mapping`, `qti-map-entry`, `qti-outcome-declaration`, `qti-default-value`, `qti-item-body` (mixed, `data-*`), `p` (mixed, `data-*`), `qti-prompt` (mixed), `qti-choice-interaction` (`max-choices: Schema.Int`, `min-choices` optional, `response-identifier`), `qti-simple-choice` (mixed), `qti-response-processing` (attribute `template`, content empty for now). Mark the end of the subset with the comment `// --- extension beyond the benchmark subset` so C8 stays measurable (m1-34 adds below it).

Test `test/qti/vocabulary.test.ts` (criterion 1) for `bg007-true-false.xml` (`new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url)`): `decodeString(AssessmentItem)` succeeds; `encodeString(AssessmentItem)` of the value produces text `decodeString(AssessmentItem)` accepts again to a deep-equal value; the re-encoded tree is canonically equal to the input tree (criterion 1's C1 clause; strategic review C2): in the test file, import `resolveEvents` and `collect` from `../../src/resolve.ts` and `canonicalize`, `inlineNames` from `../../src/index.ts`; obtain the input tree with `Stream.make(text)` + `Xml.decodeString()` + `resolveEvents()` + `collect(["*"])` + `Stream.runCollect` (the pipeline `test/round-trip.test.ts` uses, m1-31; a cross-module test under `test/` may import `src/resolve.ts` directly, `vocabulary.ts` may not); obtain the output tree as `Schema.encodeEffect(AssessmentItem)(value)`; assert `canonicalize(input, { inline: inlineNames(AssessmentItem) })` equals `canonicalize(output, { inline: inlineNames(AssessmentItem) })`. Deep equality after a second decode is not a substitute: encode writes `elements` children in declared slot order (`element-codec.ts:272-281`, the seam m1-8 ports), so a slot order that differs from the document's child order re-decodes to a deep-equal value and is not canonically equal to the input, which is the case this assertion exists to catch; state this in a comment. Write the test for the full round trip first (red: no vocabulary exists), then the vocabulary.

Rules: R-files, R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/vocabulary.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-34: U15 QTI vocabulary extension and C1 on the other three fixtures

- write_scope: `test/qti/vocabulary.ts`, `test/qti/vocabulary.test.ts`
- deps: m1-33
- red_first: yes
- status: pending

Below the `// --- extension beyond the benchmark subset` line in `test/qti/vocabulary.ts`, add the SPIKE-05 extension and the M1 additions the four acceptance fixtures force (the plan's command-derived inventory of 29 elements): `img` (empty; `src`, `alt`, `width`, `height` as the fixtures use), `qti-hotspot-choice`, `qti-hotspot-interaction`, recursive `div` (one named interface plus `suspend("div", () => Div)`, mixed), `qti-text-entry-interaction` (empty; `response-identifier`), `br` (empty), `blockquote` (mixed), `qti-extended-text-interaction` (attributes `response-identifier`, `pattern-mask`, `data-*`, `format`, `expected-length: Schema.Int`, `class`; content `elements({ prompt: optional(Prompt) })`; carry-in a), `object` (`data`, `type`; mixed), and under `namespaces({ "": MATHML })` the MathML set `math`, `mrow`, `mfenced` (mixed) and `mi`, `mn`, `mo` (text; `mo` has attribute `class` in `extended-text-postcard.xml:29`). Extend `qti-item-body`, `p`, `blockquote`, `div`, `qti-prompt` member lists so every fixture element is reachable; keep one definition per element (no second declaration or mapper in `test/qti/`), each exported as in m1-33. If a fixture needs an element outside the 29, stop and report it (D12 stop condition: `open` is not in M1).

Tests: the m1-33 round trip, canonical assertion against the input tree included (C2), repeated for `bpig-hotspot.xml`, `bg010-missing-word.xml`, `extended-text-postcard.xml` (table-driven over the four files); `bg010-missing-word.xml` nests `p` under `div` and `blockquote`, so it is the first fixture whose decode crosses a `suspend` member (C1). red_first: the three new cases fail before the extension exists.

Rules: R-files, R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/vocabulary.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-35: U15 bare `Schema` operations on `bg007` and the printed value

- write_scope: `test/qti/vocabulary.ts`, `test/qti/vocabulary.test.ts`
- deps: m1-34
- red_first: yes
- status: pending

In `test/qti/vocabulary.test.ts`, the "ordinary `Schema.Codec`" clause of criterion 1: `Schema.encodeEffect(AssessmentItem)(value)` on the decoded `bg007` value yields a `ResolvedElement` whose `name` is `{http://www.imsglobal.org/xsd/imsqtiasi_v3p0}qti-assessment-item`, and `Schema.decodeUnknownEffect(AssessmentItem)(element)` on that element deep-equals the value; print the decoded `bg007` value exactly once (the owner's manual flow; `console.log` is acceptable in a test). red_first: assert the Clark root name before adding the encode call.

Rules: R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/vocabulary.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-36: U16 QTI error paths (C2, T3)

- write_scope: `test/qti/errors.test.ts`
- deps: m1-35
- red_first: no
- status: pending

Create `test/qti/errors.test.ts` importing `./vocabulary.ts`, with variants of `bg007-true-false.xml` made by string replacement in the test (`max-choices="1"` at line 23; root attributes at lines 1-10): `max-choices="x"` fails with one `XmlDecodeError`, reason `Schema`, `path` exactly `/qti-assessment-item/qti-item-body/qti-choice-interaction/@max-choices`, message matching `/finite/i`; an undeclared attribute `foo="1"` on the root fails with a message containing the declared set (`identifier`, `title`, …); `time-dependent="maybe"` fails naming a boolean; the unmodified file decodes `identifier` as the branded string and `max-choices` as the number `1`; the `max-choices="x"` failure is exactly one issue (walk `reason.error.issue`: one leaf, no multi-branch `AnyOf`; T3); the error's `message` contains no newline (one line a renderer can show). red_first is `no`: the slice changes no library code; the assertions pin behaviour landed by m1-33 to m1-35, and a first-run failure is a finding for rework (report the measured `path`, `reason._tag`, and `message`), not a reason to edit `src/`.

Rules: R-files, R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/errors.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-37: U17 document order and the renderer (C3)

- write_scope: `test/qti/mixed.test.ts`
- deps: m1-35
- red_first: no
- status: pending

Create `test/qti/mixed.test.ts` importing `./vocabulary.ts`. Decode `bg010-missing-word.xml`; the `<p>` inside `<blockquote>` (fixture lines 24-29) decodes to an ordered `children` array tagged `text`, `br`, `text`, `qti-text-entry-interaction`, `text`, `br`, `text`, `br`, `text`; a renderer written in the test narrows exhaustively on `_tag` (a `switch` with a `never` default) in at most 10 statements (statements, not formatted lines; `docs/rd/criteria.md` C3) and produces the text in document order; `encodeString` of the value and a second decode yield the same child order. red_first is `no`: the slice changes no library code; the assertions pin behaviour landed by m1-8 to m1-10 and m1-34, and a first-run failure is a finding for rework (report the measured tag sequence), not a reason to edit `src/`.

Rules: R-files, R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/mixed.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-38: U17 whitespace rules and typed `data-*` (C3, criterion 2 last clause)

- write_scope: `test/qti/mixed.test.ts`
- deps: m1-37
- red_first: no
- status: pending

Extend `test/qti/mixed.test.ts`: in the decoded `bg010` value, whitespace-only runs are present among `qti-item-body`'s `mixed` children and absent from an `elements`-mode field (`qti-correct-response`'s `qti-value` children carry no indentation strings; plan lock 8); decode `extended-text-postcard.xml` and assert `data-patternmask-message` on `qti-extended-text-interaction` decodes under the `data-*` schema to the attribute's literal value in the fixture and re-encodes with the same value (encode, decode again, compare). red_first is `no`: the slice changes no library code; the assertions pin behaviour m1-8 and m1-9 established, and a first-run failure is a finding for rework (report the measured value), not a reason to edit `src/`.

Rules: R-files, R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/mixed.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m1-tidy: Tidy the milestone 1 change

- write_scope: `src/element.ts`, `src/element.test.ts`, `src/plan.ts`, `src/plan.test.ts`, `src/compile.ts`, `src/compile.test.ts`, `src/dsl.ts`, `src/dsl.test.ts`, `src/issue.ts`, `src/issue.test.ts`, `src/resolve.ts`, `src/resolve.test.ts`, `src/canonical.ts`, `src/canonical.test.ts`, `src/codec.ts`, `src/codec.test.ts`, `src/index.ts`, `vite.config.ts`, `test/upstream-xml.test.ts`, `test/round-trip.test.ts`, `test/qti/vocabulary.ts`, `test/qti/vocabulary.test.ts`, `test/qti/errors.test.ts`, `test/qti/mixed.test.ts`, new files under `src/` and `test/qti/`
- deps: m1-1, m1-2, m1-3, m1-4, m1-5, m1-6, m1-7, m1-8, m1-9, m1-10, m1-11, m1-12, m1-13, m1-14, m1-15, m1-16, m1-17, m1-18, m1-19, m1-20, m1-21, m1-22, m1-23, m1-24, m1-25, m1-26, m1-27, m1-28, m1-29, m1-30, m1-31, m1-32, m1-33, m1-34, m1-35, m1-36, m1-37, m1-38
- red_first: no
- status: pending

Apply the cleanliness lens to the files this phase changed, with no behavior change: remove the `// m1-N` placeholders and dead stubs left by the chained slices, dedupe helpers that two modules grew independently (for example a `splitQName` in both `plan.ts` and `resolve.ts` belongs in `element.ts`), align doc comments with R-doc and R-native (every custom piece names the Effect API checked and the requirement it misses), and extract a helper into a new kebab-case file under `src/` only when a function has grown past easy reading; `src/index.ts` must then re-export nothing new. You may restructure tests without changing what they assert; add none. The existing tests covering the scope must pass unchanged. Run `bun x vp fmt --check <changed files>` and the narrow test of each file you touch (`bun x vp test <file>`); do not run `bun run check`/`build`/`test`. A behavior change found while tidying is reported as a follow-up and not made.

Rules: R-doc, R-native, R-files, R-check, R-commit (`refactor:`). Check: `bun x vp test src test/round-trip.test.ts test/qti test/upstream-xml.test.ts` (one invocation listing the touched files is also acceptable). A multi-filter `bun x vp test` invocation exits 0 when **any** filter matches a file, so it cannot detect a missing file: confirm every named test file appears in the `Test Files` summary and report the count.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Notes

- Nothing is already delivered: `src/` holds only the comment-only `src/index.ts` and `test/` only `test/upstream-xml.test.ts` (one test). Every unit M1-U01..U17 is covered: U01 m1-1..2; U02 m1-3..6; U03 m1-7..10; U04 m1-11..12; U05 m1-13..14; U06 m1-15..17; U07 m1-18; U08 m1-19..21; U09 m1-22..23; U10 m1-24..25; U11 m1-26..28; U12 m1-29; U13 m1-30; U14 m1-31..32; U15 m1-33..35; U16 m1-36; U17 m1-37..38.
- Dependencies follow the plan's unit graph in direction; a slice depends on the specific upstream slice that provides what it imports rather than on the whole upstream unit, which is what keeps the chain at 18 instead of the 22 a unit-granular chain would give. Where a unit edge exists but no symbol is needed yet (U01 → U02 at m1-3), the dep is kept on the upstream unit's last slice.
- Shared files are chained, never raced: `src/resolve.ts` carries U06, U07, U08 in one chain (m1-15 → m1-21); `src/issue.ts` carries U05 and U09 (m1-13 → m1-23); `src/plan.ts`, `src/compile.ts`, `src/codec.ts`, `src/canonical.ts`, `src/dsl.ts`, `src/element.ts`, and the three `test/qti/` files chain inside their units. No two slices without a `deps` path between them share a file.
- Two plan details the slices settle rather than leave to the implementer: m1-4 returns a result object from `qname` and m1-5 makes `lower` return `Either<Plan, DefinitionError>` (nothing throws inside lowering), and m1-11 throws the `DefinitionError` eagerly at `element`/`suspend` construction, as the spike does (`xml-dsl.ts:124-130`, `element-codec.ts:109-113`) and as `docs/rd/strategic-review.md` ruling (d) confirms: the lint forbids the `try` statement, not `throw`, and a definition error never defers to the first decode. The plan calls these "definition-time programming error, not a decode failure"; the slices preserve that and ask the implementer to document the mechanism once on `lower`.
- m1-13 leaves the `Schema.TaggedError` vs `Data.TaggedError` choice for the two cause-bearing reasons to the implementer, as the plan does, and names the two viable forms (`Schema.declare(Xml.isXmlError)` exists at `Xml.ts:73`).
- m1-33 and m1-34 prove the C1 canonical clause against the input tree by importing `resolveEvents` and `collect` from `../../src/resolve.ts` in the test file (a cross-module test under `test/`, the same import `test/round-trip.test.ts` makes); `vocabulary.ts` stays `../../src/index.ts`-only and nothing is exported for it. The earlier settlement here (deep equality after a second decode) was overruled by the strategic review, ruling (d) and C2: it cannot see an `elements`-mode slot-order difference.
- Corrected on handle `237df403` per `docs/rd/strategic-review.md`: m1-10 (`compile` orders `suspend` members last; the R2 recheck gains a `suspend` member), m1-15 (Clark names interned per run, C7), m1-22 (a pointer only), m1-23 (`AnyOf` resolved by name match; the no-match case pulled forward from `phase-4.md` lock 4), m1-33 and m1-34 (C2). Ids, deps, and the chain are unchanged; no slice was accepted or in progress.
- The milestone-close greps and the verify gate (`bun run check && bun run build && bun run test`, 13 test files) stay with the verify seat as the plan says; no slice runs them.
- Corrected on handle `6418eee3` per aggregate slice audit `f2edd498`: m1-4, m1-5, m1-11 (F2: definition errors throw eagerly at `element()`/`suspend()` construction per strategic-review ruling (d); the Either/result plumbing stays), m1-11 (F8: the `suspend` doc-comment sentence M1-U04 requires), m1-33 and m1-34 (F9: every definition and the root exported for `test/qti/open.test.ts`), m1-36, m1-37, m1-38 (F4: `red_first: no`, test-only pins), m1-tidy and R-check (F5: the multi-filter caveat). Ids, deps, and the chain are unchanged; no slice was accepted or in progress.
- Line numbers above were read at `261cfdf`; spike files are frozen R&D and `node_modules/effect` is pinned at `4.1.2`, so they will hold until either moves.
