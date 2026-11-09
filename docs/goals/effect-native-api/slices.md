# Slices: effect-native-api (bugs 1-9, R1-R8, the `data-*` message gap)

- plan: `docs/goals/effect-native-api/GOAL.md` (`10709ad`; owner decisions O1-O10 are settled there and are quoted, not re-asked) and `docs/rd/effect-native-api-review.md` (`379bd14`): section 3 (bugs 1-9: repro, cause, fix direction, blast radius), section 4 (R1-R8: before, after, blast radius), section 5 (keep as is), section 6 (O1-O10, each fixed to its planner default by `GOAL.md`).
- spike evidence: `spikes/effect-native-api/` (`RESULT.md`, `text-codec.ts`, `channel.ts`, `xml-schema.ts`, `q4-rebuild.ts`, `q5-equivalence-lib.ts`). Briefs port shapes from there; no file under `src/` or `test/` imports `spikes/`.
- slice file: `docs/goals/effect-native-api/slices.md`
- size target: 5-15 minutes per Hand
- corrected on: Mind ruling 2026-11-05: the tokenizer interface is `Tokenizer` (shares the name of the `Context.Reference`, Effect `Clock` convention), not `TokenizerShape`, which fails `anti-slop/no-shape-in-symbol-names`; fix slice `ena-34b` renames it in `src/tokenizer.ts`. Every brief below reads `Tokenizer` for the interface.
- cut against: commit `10709ad`, `effect@4.1.2`; every line number below was read on that checkout. A slice later in a file's chain re-reads the file first: earlier slices move lines, so briefs name the function or declaration first and give the line as a cut-time anchor.
- slice count: 41 numbered (`ena-1`..`ena-41`) + `ena-docs` + `ena-tidy` = 43
- longest chain: 8 (`ena-1, ena-7, ena-12, ena-16, ena-20, ena-25, ena-33, ena-tidy`; any of `ena-23`..`ena-31` stands in for `ena-25`)
- width per wave (a slice dispatches once its `deps` are accepted and its `write_scope` overlaps no active slice): w1 7 (`ena-1`..`ena-6`, `ena-34`); w2 7 (`ena-7`..`ena-11`, `ena-35`, `ena-38`); w3 4 (`ena-12`..`ena-15`); w4 4 (`ena-16`..`ena-19`); w5 7 (`ena-20`..`ena-22`, `ena-36`, `ena-37`, `ena-39`, `ena-40`); w6 11 (`ena-23`..`ena-32`, `ena-41`); w7 2 (`ena-33`, `ena-docs`); w8 1 (`ena-tidy`).
- corrected on: handle `bd025bba` (Mind reply `d1d5565a`) to fold in owner addition R9 (`work/owner-directive-tokenizer-seam.md`; review section 7 at `cb6e871`; `GOAL.md` at `ec5a806`) after the first commit `b0714fb`. Slices `ena-34`..`ena-41` are new; `ena-12`, `ena-14`, `ena-16`, `ena-20`, `ena-33`, `ena-docs`, `ena-tidy`, the header, the Standing rules (R-tokenizer), and the Notes are edited in place with ids unchanged; no slice was accepted or in progress. The longest chain is unchanged.
- transitional state: from `ena-20` to `ena-33`, `src/index.ts` exports both the flat names and `XmlSchema` (allowed by the cut rules). `ena-33` removes the flat names. The renames of R4 happen at the namespace boundary (`src/xml-schema.ts`); internal names (`many`, `optional`, `XmlDecodeError`, `ResolvedElement`, `decodeString`, ...) stay as they are inside `src/`.

## Standing rules (every brief below is bound by these; a brief names the ones it leans on)

- R-effect: Effect error channels only. `try`/`catch` is a lint error (`workspace/no-built-in-try-catch`). Return failures with `yield*`/`Effect.fail`; inside a generator keep `if`/`??`/ternary for plain value checks (`.agents/skills/effect-design/SKILL.md` "Local rulings"). A pure function returns `Option.Option<...>` for an absent result, never `null` or `undefined`. A synchronous constructor misused by its caller may `throw` (as `src/dsl.ts` does today); nothing else throws.
- R-guide: follow `node_modules/effect/AGENTS.md` (read it completely before writing Effect code): `Effect.gen` inline, `Effect.fnUntraced` for library helpers, `Effect.fn("name")` where a span is wanted. Use `Predicate` helpers, never hand-written guards. Public effectful operations keep or gain spans per `.agents/skills/trace-effect/SKILL.md`; the library never installs a tracer, logger, or exporter.
- R-native (adjusted for bug 9): before custom glue, name the Effect API you checked and the requirement it misses (`.agents/skills/effect-design/SKILL.md` "Native capability review"), as one `// Native: <API checked> lacks <requirement>.` line comment directly above the declaration's JSDoc block, never inside a JSDoc block (JSDoc on an exported declaration is published; that is bug 9). Import only public symbols or `effect/encoding/Xml`; never `@internal` symbols (`SchemaAST.makeFilter`, `applyToSelfOrLastLinkEncoding`, `replaceEncoding`, `Objects.recur`, `Arrays.recur`, `getIndexSignatureKeys`, `defaultFormatter`, `resolveAnnotations`).
- R-batch (replaces phase-4's R-m1): this goal is one breaking batch: renames and shape changes the review names are allowed; everything else keeps behaviour. The earlier tests in a file you touch still pass, except the assertions your brief names as changing.
- R-doc: multiline JSDoc (`/**` on its own line) on every module-scope function, type, interface, class, and `const`, with `@param`/`@returns` on functions (`.agents/skills/document-code/SKILL.md`; `vite.config.ts` enforces the multiline form). A JSDoc block on a declaration the `XmlSchema` namespace exports states behaviour, gotchas, and an example where it helps (`node_modules/effect/src/encoding/Xml.ts:285-332` is the model); it `{@link}`s only symbols the namespace exports, and names no decision id, review id, repository path, or test file. Deferrals and measured facts are present-tense invariants, never history. New modules pass the bug-9 oracle below from their first commit.
- R-files: kebab-case file names and directories (`unicorn/filename-case`, `workspace/kebab-case-paths`). Inside `src/`, relative imports with the `.ts` extension. No file under `src/` or `test/` imports `spikes/`; the QTI corpus is read by path with `new URL("../../spikes/fixtures/qti/<file>.xml", import.meta.url)` and `node:fs` `readFileSync`, as `test/qti/*.test.ts` already do.
- R-test: tests are `*.test.ts` beside the module (or under `test/` for cross-module tests), import `{ describe, expect, it } from "@effect/vitest"`, and use `it.effect` for effectful cases; a pure case may use plain `it`. Type-level assertions use `expectTypeOf` from `vitest` (and `// @ts-expect-error` for a rejected form). Assert on structured values (`_tag`, `reason._tag`, `path`, `position`, element names, counts read from the value) or on a regex of a message's shape, never on full message text; never hard-code a count the test can measure.
- R-check: the slice check is the command its brief names: `bun x vp test <file>` (exits 1 when the file is missing, so it cannot pass on nothing), `bun x vp check <files>` (fmt and lint path-scoped, the type check program-wide), or the named `grep`/`awk`. A multi-file `bun x vp test a.test.ts b.test.ts` exits 0 when either file matches, so run one file per `bun x vp test` (the briefs chain them with `&&`). Because the type check is program-wide, an error it reports in a file outside your `write_scope` is a `blocked-scope` report, never an edit. `bun run check`, `bun run build`, `bun run test` are gate-seat commands; never run them as a slice check.
- R-errors: caller-facing messages follow `.agents/skills/error-messages/SKILL.md`: what, path, expectation, repair; neutral tone; never "invalid input". The rendered rule stays `<what> at <xpath>[ of record <k>][ (line L, column C)]: <expectation>; <repair>`.
- R-readme: `README.md` follows the `readme-authoring` skill, which requires the `technical-writing` and `emil-unslop-writing` skills. Its ownership test decides every sentence: the README states what a reader relies on from outside; code and tests own how.
- R-commit: one conventional commit per slice (`.agents/skills/conventional-commits/SKILL.md`), path-limited to the slice's `write_scope`: `fix(<module>):` for a bug slice, `feat(<module>):` for an R slice, `test:` for a migration slice, `docs(<module>):` for a doc-comment-only slice, `docs:` for `README.md` and `docs/onboarding.md`, `refactor:` for the tidy slice; a slice that renames or removes a public export or reason tag marks the type with `!` (for example `feat(issue)!:`).
- R-tokenizer (R9): no module under `src/` other than `src/tokenizer.ts` calls a tokenizer channel (`decode`, `decodeString`, `encode`, `encodeString`, `elements`) of `effect/encoding/Xml`; code reads the tokenizer with `yield* Tokenizer` (`src/tokenizer.ts`, `ena-34`) and calls its fields. `Xml.XmlError`, `Xml.isXmlError`, and the event types remain the shared model. The R9 oracle below prints the remaining direct calls; on `10709ad` it prints `src/codec.ts:169`, `:338`, `:546`, `:552`, `:557` and `src/positions.ts:483`, and it prints nothing once `ena-12`, `ena-16`, `ena-33`, and `ena-35` are accepted. Slices that create `src/channel.ts` and `src/document.ts` never add a line to it.
- R-scope (ends every brief): change only the files in `write_scope`. If the work needs any other path, change nothing and report `blocked-scope` with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

The bug-9 oracle (used by `ena-6`, `ena-11`, `ena-32`, `ena-33`, `ena-tidy`; replace `<files>` with the slice's files; each line prints `<file> <native-paragraphs> <internal-links> <process-refs>`). On `10709ad` it prints `src/canonical.ts 3 1 1`, `src/codec.ts 5 23 0`, `src/compile.ts 2 0 0`, `src/dsl.ts 3 0 0`, `src/issue.ts 4 1 0`, `src/plan.ts 3 0 0`, `src/resolve.ts 0 9 2`, `src/positions.ts 0 0 1`, `src/index.ts 0 0 1`; every other non-test `src/` file prints `0 0 0`:

```text
for f in <files>; do printf '%-18s %s %s %s\n' "$f" "$(grep -cE 'Native (review|check)|Effect checked' "$f")" "$(grep -cE '\{@link (collect|readRoot|planOf|resolveEvents|attachPosition|toDecodeError|decodeUtf8|checkByteEncoding)\}' "$f")" "$(grep -cE 'decision [A-Z][0-9]|docs/|test/[a-z]' "$f")"; done
```

The R9 oracle:

```text
grep -rnE '\bXml(Runtime)?\.(decode|decodeString|encode|encodeString|elements)(<[^>]*>)?\(' src --include='*.ts' | grep -v '\.test\.ts:' | grep -v '^src/tokenizer\.ts:'
```

### Shared vocabulary

- A **Clark name** is `{uri}local`, or `local` for no namespace. `QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"`.
- A **`ResolvedElement`** (`src/element.ts:83-87`) is `{ name, attributes, children }` with Clark names; after `ena-20` the namespace exports it as `XmlSchema.Element`.
- The **README definitions** are the `readme:start` region of `test/readme.test.ts:18-52`: `SimpleChoice`, `Prompt`, `ChoiceInteraction` under `namespaces({ "": QTI })`, and the `xml` document. Briefs that say "the README definitions" mean a copy of those lines inside the test file being written.
- The **review service probe** (bug 3, used by `ena-12` and `ena-21`), quoted here so no brief depends on a machine-local file:

  ```ts
  class Upper extends Context.Service<Upper, { readonly f: (s: string) => string }>()("Upper") {}
  const Svc = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transformEffect((s) =>
        Effect.gen(function* () {
          const u = yield* Upper;
          return u.f(s);
        }),
      ),
      encode: SchemaGetter.passthrough(),
    }),
  );
  const P = element("p", { attributes: { a: Svc } });
  // decoding `<p a="hi"/>` dies with "Service not found: Upper" unless Upper is provided;
  // with Effect.provideService(Upper, { f: (s) => s.toUpperCase() }) it yields { a: "HI" }.
  ```

- The **migration map** (used by `ena-23`..`ena-31`; the names on the right exist once `ena-20` is accepted):

  | Today (flat, from `src/index.ts`)                                                                                              | After (from `XmlSchema`, the only import of `src/index.ts`)                                                                                                                                                                                                 |
  | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `import { a, b } from "<rel>/src/index.ts"`                                                                                    | `import { XmlSchema } from "<rel>/src/index.ts"`, then `XmlSchema.a` at each call site                                                                                                                                                                      |
  | `element`, `namespaces`, `suspend`, `text`, `elements`, `mixed`, `clark`                                                       | `XmlSchema.<same name>`                                                                                                                                                                                                                                     |
  | `many(E)` / `optional(E)`                                                                                                      | `XmlSchema.Array(E)` / `XmlSchema.optionalKey(E)`                                                                                                                                                                                                           |
  | `decodeString(Def, limits)(xml)`                                                                                               | `Schema.decodeUnknownEffect(XmlSchema.fromString(Def, limits))(xml)` (or `Schema.decodeUnknownSync`); the failure is a `Schema.SchemaError`, and its `XmlSchema.DecodeError` is `XmlSchema.decodeErrorOf(error.issue)` (an `Option`; `None` fails the test) |
  | `encodeString(Def, { declaration })(value)`                                                                                    | `Schema.encodeEffect(XmlSchema.fromString(Def, { declaration }))(value)`                                                                                                                                                                                    |
  | `decodeTree(limits)(xml)`                                                                                                      | `Schema.decodeUnknownEffect(XmlSchema.ElementFromString(prefixes, limits))(xml)`, `prefixes` the definition's namespaces map                                                                                                                                |
  | `canonicalize(a, { normalize: normalizedNames(Def) }) === canonicalize(b, ...)`, or the two printed forms compared with `toBe` | `XmlSchema.equivalence(Def)(a, b)` (assert `toBe(true)` / `toBe(false)`)                                                                                                                                                                                    |
  | `decode(Def, path, opts)(byteStream)` / `(textStream)`                                                                         | `byteStream.pipe(Stream.pipeThroughChannel(XmlSchema.decodeSchema(Def, path)(opts)))` / `textStream.pipe(Stream.pipeThroughChannel(XmlSchema.decodeSchemaString(Def, path)(opts)))`                                                                         |
  | types `XmlDecodeError`, `XmlEncodeError`, `ResolvedElement`, `ElementCodec`                                                    | `XmlSchema.DecodeError`, `XmlSchema.EncodeError`, `XmlSchema.Element`, `XmlSchema.ElementCodec`                                                                                                                                                             |
  | `defaultMaxElementNodes`, `defaultMaxElementSize`                                                                              | import from `<rel>/src/resolve.ts` (internal; the namespace does not export them)                                                                                                                                                                           |
  | `Effect.catchTag("XmlDecodeError", ...)` on a whole-document decode                                                            | `Effect.catchTag("SchemaError", ...)` plus `XmlSchema.decodeErrorOf`; `Effect.catchReason("XmlDecodeError", ...)` still applies to a streaming failure, whose error channel is `XmlSchema.DecodeError`                                                      |

## Cut 1: slice

- answer: sliced
- longest chain: ena-1, ena-7, ena-12, ena-16, ena-20, ena-25, ena-33, ena-tidy

### ena-1: Bug 4: route upstream `Limit` and `Unsupported` parser errors to their own reasons (O9)

- write_scope: `src/issue.ts`, `src/issue.test.ts`, `src/codec.ts`, `src/codec.test.ts`, `test/upstream-xml.test.ts`
- deps: none
- red_first: yes
- status: pending

What is wrong: `wellFormedness` (`src/codec.ts:46-51`) wraps every upstream `Xml.XmlError` as reason `WellFormedness`, although `XmlError.kind` already separates `Syntax`, `Unsupported`, `Limit`, and `InvalidEvent` (`node_modules/effect/src/encoding/Xml.ts:52`). Review repro: `decode(I, ["r", "i"], { maxDepth: 1 })(Stream.make("<r><i>x</i></r>"))` fails with reason `WellFormedness`, `cause.kind` `"Limit"`, and `Effect.catchReason("XmlDecodeError", "Limit", ...)` does not catch it; a byte stream whose declaration names `ISO-8859-1` or `UTF-16` also reads as "not well-formed". Decision O9 (`GOAL.md`): "widen `Limit` (`maxDepth`, `maxTokenSize`, optional `element`) and add an `Unsupported` reason."

In `src/issue.ts`:

- `Limit` (`:70-75`): `limit` takes `"maxElementSize" | "maxElementNodes" | "maxDepth" | "maxTokenSize"`; `element` becomes `Schema.optionalKey(Schema.String)`. Stated default (report it, do not ask): `measured` also becomes an optional key, because upstream reports only the maximum (`Xml.ts:1077`, `:1365`, `:1368`: "... exceeds maxDepth of N"), so a parser limit carries `max` and no `measured`; the record budgets of `collect` keep setting all four fields. The doc comment says which fields are present for which limit.
- A new reason class `Unsupported` (`Schema.TaggedError`, tag `"Unsupported"`, field `cause: XmlErrorCause`), added to the `XmlDecodeError` reason union (`:147`).
- `limitParts` (`:994-1000`): with no `element` the `what` is `document exceeds <limit>`; with no `measured` the expectation is `limit <max>` and the repair drops the "decode a smaller record path" clause. `partsOf` (`:1071-1099`) renders `Unsupported` with `wellFormednessParts(reason.cause)` (`:960-972`, which already words `Unsupported`).
- A new exported `parserError(cause: Xml.XmlError): XmlDecodeError`, built through `decodeError` at path `/`: kind `Limit` whose message matches `/\b(maxDepth|maxTokenSize) of (\d+|Infinity)\b/` becomes reason `Limit` `{ limit, max }`; kind `Unsupported` becomes reason `Unsupported`; every other kind, and a `Limit` message the pattern does not match, stays reason `WellFormedness`. When `cause.line` and `cause.column` are both numbers it is positioned there with `withPosition` (what `withUpstreamPosition`, `src/codec.ts:64-70`, does today).

In `src/codec.ts`: every upstream-error mapping goes through `parserError`: `readRoot`'s `catchTag` (`:173`), `utf8` (`:396-408`, which builds a `Syntax` `XmlError` "invalid UTF-8" with no line or column), and the stream `decode`'s `mapError` (`:667-671`). `attachPosition` (`:90-110`) returns an error unchanged when `parserError` already positioned it (reason `WellFormedness` without `elementPath`, `Unsupported`, or `Limit` without `element`); a `Limit` with `element` keeps the root-tag `locate` (`:97-100`). Invariant: a parser failure is positioned exactly once, from its upstream line and column. Delete `wellFormedness` and `withUpstreamPosition` once nothing calls them; correct the `checkByteEncoding` doc (`:484-486`) to say reason `Unsupported`.

Tests:

- `src/issue.test.ts`, a new `describe("parserError")`: a `Limit` `XmlError` with message `element nesting exceeds maxDepth of 1 at line 1, column 7` (line 1, column 7) gives reason `Limit` with `limit` `"maxDepth"`, `max` `1`, no `element`, no `measured`, `position` `{ line: 1, column: 7 }`, and `Effect.catchReason("XmlDecodeError", "Limit", ...)` catches it; an `Unsupported` `XmlError` gives reason `Unsupported`, caught by `catchReason("XmlDecodeError", "Unsupported", ...)`; a `Syntax` `XmlError` gives `WellFormedness`.
- `src/codec.test.ts`: "forwards maxDepth and maxTokenSize to the upstream tokenizer" (`:1088-1105`) now expects reason `Limit` whose `limit` equals the forwarded option's name; "fails a byte stream declaring ISO-8859-1 as Unsupported with and without positions" (`:1015`) now expects reason `Unsupported`; add the review repro above with `catchReason("XmlDecodeError", "Limit", ...)` succeeding. These assertions are the red.
- `test/upstream-xml.test.ts`, a canary for the message `parserError` parses: `Xml.decodeString({ maxDepth: 1 })` over `<r><i/></r>` fails with kind `"Limit"` and a message matching `/maxDepth of 1/`; `Xml.decodeString({ maxTokenSize: 4 })` over a document with a longer token fails with a message matching `/maxTokenSize of 4/`.

red_first: stub `parserError` to return reason `WellFormedness` for every kind, change the tests, and see the `Limit`/`Unsupported` assertions fail on the reason tag.

Rules: R-effect, R-guide, R-batch, R-doc, R-test, R-check, R-errors, R-commit (`fix(issue):`). Check: `bun x vp test src/issue.test.ts && bun x vp test src/codec.test.ts && bun x vp test test/upstream-xml.test.ts && bun x vp check src/issue.ts src/codec.ts src/issue.test.ts src/codec.test.ts test/upstream-xml.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-2: R1: the element codec type carries its name in the Encoded type, with `RD`/`RE` parameters

- write_scope: `src/plan.ts`, `src/plan.test.ts`, `src/dsl.ts`, `src/canonical.ts`, `src/canonical.test.ts`
- deps: none
- red_first: yes
- status: pending

What is wrong: `ElementCodec<Name, T>` (`src/plan.ts:209-215`) extends `Schema.Codec<T, ResolvedElement>` with a phantom `"~xml.name"` key. `Codec["Rebuild"]` is a plain `Codec` (`node_modules/effect/src/Schema.ts:1082-1086`), `annotate` returns `this["Rebuild"]` (`:210`), `brand` returns its own interface (`:5319`), and `decodeTo` returns `decodeTo<To, From>` (`:5600`), so all four drop the key: `many(Prompt.pipe(Schema.brand("P")))` is TS2741 today. The spike's carrier E passes all four (`spikes/effect-native-api/q4-rebuild.ts:62-104`, `RESULT.md` Q4).

Change, in `src/plan.ts` (types only, no runtime change):

```ts
declare const ElementName: unique symbol;
export interface XmlElement<Name extends string> extends ResolvedElement {
  readonly [ElementName]: Name;
}
export type ElementCodec<Name extends string, T, RD = never, RE = never> = Schema.Codec<
  T,
  XmlElement<Name>,
  RD,
  RE
>;
```

`XmlElement` is phantom: no runtime key exists. Every constraint in `src/plan.ts` that accepts an element codec takes `ElementCodec<string, unknown, unknown, unknown>`: `Many` (`:243`), `Optional` (`:251`), `ChildSpec` (`:260-263`), `Mixed` (`:285-288`), `Content` (`:301`), `mixed` (`:359-361`), `many` (`:373`), `optional` (`:384`). In `src/dsl.ts` only the inference types follow, so the program keeps type-checking: `ChildType` (`:57-64`, `C extends ElementCodec<string, infer T, unknown, unknown>`), the `Optional<...>` key filters of `ChildrenType` (`:73`, `:77`), and `MixedItem`'s constraint and match (`:89-98`, `ElementCodec<infer N, infer T, unknown, unknown>`); `element` and `suspend` keep their return types (bug 3, `ena-21`, threads services there). In `src/canonical.ts`, `normalizedNames` (`:160`) takes `ElementCodec<string, unknown, unknown, unknown>`. `src/codec.ts` keeps its constraints (`ena-12` widens them). The test helpers that fake a codec with `Object.assign(..., { "~xml.name": ... })` (`src/plan.test.ts:147-153`, `:272`, `:315`; `src/canonical.test.ts:189-192`) become one typed helper per file that casts the marked `ResolvedElementSchema` to `ElementCodec<...>` under a `// SAFETY:` comment and the `oxlint-disable-next-line typescript/no-unsafe-type-assertion` line, as `src/dsl.ts:206-209` does.

Tests in `src/plan.test.ts`, a new `describe("element codec carrier")`, type-level only and never run through `lower` (a `decodeTo`-wrapped codec still throws at definition time until `ena-8`): for an element codec `C`, `C.annotate({})`, `C.pipe(Schema.check(...))`, `C.pipe(Schema.brand("B"))`, and `C.pipe(Schema.decodeTo(Model, transform))` (with a two-field `Schema.Class` `Model`) are each assignable to `ElementCodec<string, unknown, unknown, unknown>` and to the parameter of `many`, `optional`, and an entry of `mixed` (`expectTypeOf(many).parameter(0)`); a `nameOf` helper infers the authored name after `brand` and after `decodeTo`; `Schema.String` and a `Schema.Codec<string, ResolvedElement>` are rejected (`// @ts-expect-error`); a codec typed `ElementCodec<"x", string, "Svc">` satisfies `ElementCodec<string, unknown, unknown, unknown>` but not `ElementCodec<string, unknown>`. Port the assertions from `q4-rebuild.ts:62-104`.

red_first: the red is the type check: before the change, `bun x vp check src/plan.ts src/plan.test.ts` reports TS2741 on the `brand` and `decodeTo` cases; record that line, then make the change.

Rules: R-batch, R-doc, R-files, R-test, R-check, R-commit (`feat(plan)!:`). Check: `bun x vp check src/plan.ts src/plan.test.ts src/dsl.ts src/canonical.ts src/canonical.test.ts && bun x vp test src/plan.test.ts && bun x vp test src/canonical.test.ts && bun x vp test src/dsl.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-3: Bug 7 foundation: spell a Clark name in the caller's terms

- write_scope: `src/element.ts`, `src/element.test.ts`
- deps: none
- red_first: yes
- status: pending

Bug 7's fix direction: "one name vocabulary per message, in the caller's terms: the authored prefix where the definition has one, and the namespace shown when it is the cause." `ena-10` (compile messages), `ena-15` (bug 8), and `ena-22` (issue paths) all spell names through this one helper.

Add to `src/element.ts` (after `splitQName`, `:71-77`):

```ts
export const spell = (
  name: string,
  prefixes: Readonly<Record<string, string>>,
  kind: "element" | "attribute",
  contrast: readonly string[] = [],
): string
```

Rules, in order: (1) when `contrast` holds a Clark name with the same local part and a different namespace, the namespace is the cause, so the result is explicit: `{uri}local`, or `local (no namespace)`; (2) a name in `XML_NAMESPACE` (`:8`) is `xml:local`; (3) an element whose namespace equals a non-empty `prefixes[""]` is the bare `local`; (4) a name whose namespace some non-empty key `p` maps to is `p:local` (the first such key in insertion order); (5) a name with no namespace is `local`, except an element when `prefixes[""]` is non-empty, which is `local (no namespace)` (a bare `local` would read as the default namespace); (6) otherwise `{uri}local`. Attributes never take the default namespace, so rule 3 and the rule-5 exception apply to elements only. The parameter type is the structural record so `src/element.ts` keeps importing nothing from `src/plan.ts` (which imports it).

Tests in `src/element.test.ts`, a new `describe("spell")`, one case per rule: `{urn:q}p` with `{ "": "urn:q" }` is `p`; with `{ q: "urn:q" }` is `q:p`; `{http://www.w3.org/2001/XMLSchema-instance}schemaLocation` as an attribute with `{ "": QTI, xsi: "http://www.w3.org/2001/XMLSchema-instance" }` is `xsi:schemaLocation`; `{http://www.w3.org/XML/1998/namespace}lang` is `xml:lang`; `item` as an element with `{ "": "urn:qti" }` is `item (no namespace)`, and as an attribute is `item`; `{urn:x}p` with `{}` is `{urn:x}p`; `item` with contrast `["{urn:qti}item"]` is `item (no namespace)` and `{urn:qti}item` with contrast `["item"]` is `{urn:qti}item`.

red_first: stub `spell` to return `name` unchanged; the prefix and no-namespace cases fail on value.

Rules: R-doc, R-files, R-test, R-check, R-commit (`feat(element):`). Check: `bun x vp test src/element.test.ts && bun x vp check src/element.ts src/element.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-4: The undeclared-attribute message lists a declared `data-*` group

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: none
- red_first: yes
- status: pending

What is wrong (`GOAL.md` "Extra message gap"): `decodeElement` (`src/compile.ts:399-422`) builds `names` from the declared attributes only (`:408`), so on an element declared with `{ id: Schema.String, "data-*": Schema.String }` an undeclared `foo` reads "declared attributes: id" and hides that every `data-` attribute is accepted. When `plan.data !== undefined`, append `data-*` to the list (`declared attributes: id, data-*`); an element whose only declared attribute is the group reads `declared attributes: data-*`, never `(none)`.

Tests in `src/compile.test.ts`, in `describe("compile: data-* attributes")` (`:327`): an element with `{ id, "data-*" }` decoding `foo="1"` fails with a message matching `/declared attributes: id, data-\*/`; an element with only `"data-*"` gives a message matching `/declared attributes: data-\*/` and not `/\(none\)/`; an element with no group keeps a message without `data-*`. red_first: the first two fail on the message before the change.

Rules: R-errors, R-test, R-check, R-commit (`fix(compile):`). Check: `bun x vp test src/compile.test.ts && bun x vp check src/compile.ts src/compile.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-5: Bug 2 foundation: a pure check of a record path

- write_scope: `src/record-path.ts`, `src/record-path.test.ts`
- deps: none
- red_first: yes
- status: pending

Bug 2: today a bad record path gives a silent empty stream; `decode` checks only `path.length === 0` (`src/codec.ts:626-628`) and `makeCollector` matches steps by string equality. The fix direction: "reject any step that is neither `"*"` nor a well-formed Clark name, and a last step that is neither `"*"` nor the def's own Clark name". This slice adds the pure rule; `ena-14` calls it from the channel factory and carries the bug-2 regression.

Create `src/record-path.ts` exporting `checkRecordPath(path: readonly string[], recordName: string): Option.Option<string>`, `Some(message)` when the path is rejected and `None` when it is accepted. Rules: an empty path is rejected; each step is `"*"` or a well-formed Clark name: `local`, or `{uri}local` with a non-empty `uri` closed by the first `}`, where `local` is non-empty and holds no `:`, `{`, `}`, or whitespace; the last step is `"*"` or equals `recordName`. The message follows R-errors and names the one-based step position and its value, for example: `record path step 2 "q:item" is not a Clark name; write it as {uri}local (as clark() builds it), as local for no namespace, or as "*"`, and for a last step that names another element: `record path step 2 "{urn:qti}other" does not name the record element {urn:qti}item; end the path with {urn:qti}item or "*"`. No `throw`: the factory decides that.

Tests in `src/record-path.test.ts` (plain `it`), with `recordName` `{urn:qti}item` (the review's repro): `["bank", "item"]` is `Some` naming step 2 (no namespace, so not the record element); `["bank", "q:item"]` is `Some` (not a Clark name); `["bank", "{x"]` is `Some`; `["bank", "{urn:qti}other"]` is `Some`; `["bank", "{urn:qti}item"]`, `["*", "*"]`, and `["bank", "*"]` are `None`; `[]` is `Some`. Assert the step number with a regex, never the full text.

red_first: stub `checkRecordPath` to return `Option.none()`; the rejection cases fail on value.

Rules: R-effect, R-doc, R-files, R-test, R-check, R-errors, R-commit (`feat(record-path):`). Check: `bun x vp test src/record-path.test.ts && bun x vp check src/record-path.ts src/record-path.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-6: Bug 9 in `src/resolve.ts` and `src/positions.ts`

- write_scope: `src/resolve.ts`, `src/positions.ts`
- deps: none
- red_first: yes
- status: pending

No other slice in this goal writes these two files. Bug 9: published doc comments carry internal `{@link}` targets and process references. In `src/resolve.ts` the `{@link collect}` / `{@link resolveEvents}` targets at `:594`, `:614`, `:622`, `:628`, `:646`, `:902`, `:911`, `:996`, `:1002` become backticked code spans (`` `collect` ``); at `:632` drop the parenthetical naming `test/streaming/node-budget.test.ts` and keep the measurement as a present-tense fact; delete the sentence at `:635` naming `docs/goals/xml-schema-codec/phase-4.md`. In `src/positions.ts:364` replace "this limit is deferred under decision D7, which keeps exact positions for start and end tags only" with a present-tense statement that only start and end tags carry exact positions. No behaviour change.

red_first: the regression check is the bug-9 oracle (Standing rules) with `<files>` = `src/resolve.ts src/positions.ts`: it prints `src/resolve.ts 0 9 2` and `src/positions.ts 0 0 1` before the edit; after it, both lines end `0 0 0`. Record both runs. There is no test file: doc comments have no runtime behaviour, and the existing tests must pass unchanged.

Rules: R-doc, R-check, R-commit (`docs(resolve):`). Check: the oracle above prints `0 0 0` on both lines, then `bun x vp test src/resolve.test.ts && bun x vp test src/positions.test.ts && bun x vp check src/resolve.ts src/positions.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-7: R5: reason classes named for their tags, reason-union types, guards

- write_scope: `src/issue.ts`, `src/issue.test.ts`, `src/codec.ts`, `src/codec.test.ts`, `src/index.ts`, `test/qti/errors.test.ts`, `test/qti/open.test.ts`, `test/streaming/positions.test.ts`
- deps: ena-1
- red_first: yes
- status: pending

What is wrong: two classes share the tag `"Schema"` and neither is named for it: `SchemaReason` (`src/issue.ts:44`) and `EncodeSchemaReason` (`:95`); the reason unions have no exported name; there is no guard. Effect's reason errors name each class after its tag (`Sse.EventTooLarge`, `node_modules/effect/src/encoding/Sse.ts:37`) and export the union (`Sse.SseErrorReason`, `:52`). The review's after: `Effect.catchReason("XmlDecodeError", "SchemaFailure", (reason: XmlSchema.SchemaFailure) => ...)`.

Stated default for the encode name (report it): the decode reason becomes class `SchemaFailure` with tag `"SchemaFailure"` (the review's own example); the encode reason, whose fields differ (no `elementPath`), becomes class `EncodeSchemaFailure` with tag `"EncodeSchemaFailure"`. One class per tag.

Change: rename both classes and their tags; add `export type DecodeErrorReason = XmlDecodeError["reason"]` and `export type EncodeErrorReason = XmlEncodeError["reason"]`; add `export const isDecodeError = Schema.is(XmlDecodeError)` and `export const isEncodeError = Schema.is(XmlEncodeError)` (`node_modules/effect/src/Schema.ts:1461`). The outer error classes keep their names and tags (`XmlDecodeError`, `XmlEncodeError`; the namespace renames them in `ena-20`). `src/index.ts` renames its two flat exports (`:25`, `:28`) and adds nothing (the namespace in `ena-20` exports the new names). The rename travels with every use; the inventory is command-derived. Re-run it first, because `ena-1` moved lines in `src/issue.ts` and `src/codec.ts`, and update every match:

```text
grep -rnE '"Schema"|\bSchemaReason\b|\bEncodeSchemaReason\b' src test README.md docs/onboarding.md
```

On `10709ad` its matches (file:line) were: `src/codec.ts:363` `src/issue.ts:44 83 95 147 162 1142 1173` `src/codec.test.ts:215 216 266 474 850 983` `src/issue.test.ts:11 14 44 95 105 115 317 402 720 726 729 768 860 986 1079` `src/index.ts:25 28` `test/qti/errors.test.ts:113 126` `test/qti/open.test.ts:273` `test/streaming/positions.test.ts:78`. After the slice it prints only lines where `"Schema"` is not a reason tag (none existed at the cut).

Tests in `src/issue.test.ts`: `isDecodeError` is `true` for an `XmlDecodeError` and `false` for an `XmlEncodeError`, a plain object with `_tag: "XmlDecodeError"`, and a string; `isEncodeError` likewise; `Effect.catchReason("XmlDecodeError", "SchemaFailure", ...)` catches the reason `toDecodeError` builds; `expectTypeOf<DecodeErrorReason>()` equals `SchemaFailure | UndeclaredPrefix | WellFormedness | Limit | Unsupported` and `EncodeErrorReason` equals `EncodeSchemaFailure | UnmappedNamespace | InvalidEvent`. red_first: stub both guards as `() => false`; the `true` cases fail on value. Every renamed assertion elsewhere is mechanical.

Rules: R-batch, R-doc, R-test, R-check, R-commit (`feat(issue)!:`). Check: `bun x vp test src/issue.test.ts && bun x vp test src/codec.test.ts && bun x vp test test/qti/errors.test.ts && bun x vp test test/qti/open.test.ts && bun x vp test test/streaming/positions.test.ts && bun x vp check src/issue.ts src/codec.ts src/index.ts src/issue.test.ts src/codec.test.ts test/qti/errors.test.ts test/qti/open.test.ts test/streaming/positions.test.ts`, and the inventory command prints no reason-tag match.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-8: R1 runtime: `markerOf` walks the encoding chain (fixes bug 6)

- write_scope: `src/plan.ts`, `test/combinators.test.ts`
- deps: ena-2
- red_first: yes
- status: pending

Bug 6 is fixed by this R1 change; this slice carries its regression. What is wrong: `markerOf` (`src/plan.ts:120-131`) reads only the top AST node's annotations; `decodeTo` puts the marked node at `ast.encoding[*].to` (`node_modules/effect/src/SchemaAST.ts:425`). Review repro: `many(SimpleChoiceRaw.pipe(Schema.decodeTo(Choice, toChoice)))` throws `DefinitionError ... expected an element codec ... wrap the value with element()`, a wrong repair; as a root, `decodeString` dies with "decodeString received a codec without an element marker", a defect.

Change: `markerOf` returns the top node's marker when present, otherwise the first marker found by walking `ast.encoding[*].to` recursively, the spike's 8-line `markerDeep` (`spikes/effect-native-api/q4-rebuild.ts:108-116`). `planOf`, `elementName`, `lowerChild` (`:421-438`), and `lowerMember` (`:451-465`) read through it unchanged.

Tests in a new `test/combinators.test.ts` (cross-module: it uses `element`/`elements`/`many`/`mixed` from `../src/dsl.ts` and `../src/plan.ts`, and the internal `decodeString`/`encodeString` from `../src/codec.ts`), on the README definitions plus a `Schema.Class` `Choice` with a getter and a `toChoice` transformation (shape from `q4-rebuild.ts:49-60`): (1) `element("qti-choice-interaction", { content: elements({ choices: many(SimpleChoice.pipe(Schema.decodeTo(Choice, toChoice))) }) })` constructs without throwing, decodes the README document so each choice is a `Choice` instance whose getter works, and encodes back to text that decodes to an equal value; (2) a `Schema.Class` root (`ChoiceInteraction.pipe(Schema.decodeTo(Interaction, toInteraction))`) decodes through `decodeString` to an instance, and the `max-choices="x"` copy fails with `path` `/qti-choice-interaction/@max-choices`; (3) a `mixed([Member.pipe(Schema.decodeTo(...))])` lowers without throwing; (4) `annotate`, `check`, and `brand` roots still decode. red_first: before the change (1) and (3) throw `DefinitionError` and (2) dies; record the failure line.

Rules: R-effect, R-batch, R-doc, R-files, R-test, R-check, R-commit (`fix(plan):`). Check: `bun x vp test test/combinators.test.ts && bun x vp test src/plan.test.ts && bun x vp check src/plan.ts test/combinators.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-9: R7: `equivalence(Root)` in place of `canonicalize` + `normalizedNames`

- write_scope: `src/equivalence.ts`, `src/equivalence.test.ts`
- deps: ena-2
- red_first: yes
- status: pending

Effect expresses equality under a rule as an `Equivalence` (`Schema.toEquivalence`, `node_modules/effect/src/Schema.ts:18064`; `Equivalence.mapInput`, `Equivalence.ts:591`). Decisions: O1 "`equivalence`"; O5 "`canonicalize` becomes internal". The spike's whole export is 5 lines (`spikes/effect-native-api/q5-equivalence-lib.ts:14-21`).

Create `src/equivalence.ts` exporting `equivalence(def: ElementCodec<string, unknown, unknown, unknown>): Equivalence.Equivalence<ResolvedElement>`: `normalizedNames(def)` computed once at the call, then `Equivalence.mapInput(Equivalence.strictEqual<string>(), (element) => canonicalize(element, { normalize }))`. Its doc comment (R-doc, public) states the promise in the README's terms: inside elements declared with `elements` or empty content, whitespace-only text and the order of differently named children do not count; every other element compares strictly.

Tests in `src/equivalence.test.ts`, on the README definitions, with trees from the internal `decodeTree()` (`../src/codec.ts`): the README document and its encoded copy are equivalent; a copy with an added attribute is not; two `elements`-content trees whose differently named children are in another order are equivalent; two `mixed` trees with the same reordering are not. red_first: stub `equivalence` to return `() => false`; the equivalent cases fail on value.

Rules: R-doc, R-files, R-test, R-check, R-commit (`feat(equivalence):`). Check: `bun x vp test src/equivalence.test.ts && bun x vp check src/equivalence.ts src/equivalence.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-10: Bug 7 in `src/compile.ts`: messages name elements and attributes in the caller's terms

- write_scope: `src/compile.ts`, `src/compile.test.ts`
- deps: ena-3, ena-4
- red_first: yes
- status: pending

What is wrong: messages mix authored and Clark names. Review repros: an undeclared `xsi:schemaLocation` on a `namespaces({ "": QTI, xsi: XSI })` element prints the attribute as `{http://www.w3.org/2001/XMLSchema-instance}schemaLocation`; `<p xmlns="urn:qti"><item xmlns="" id="1"/></p>` prints `<item> is not a declared child of <p>; declared children: item.`, which contradicts itself because the namespace, the real difference, is invisible.

Spell every name these messages print with `spell(name, plan.prefixes, kind, contrast)` (`src/element.ts`, `ena-3`): `decodeEmpty` (`src/compile.ts:99`, the found child), `decodeText` (`:129`), `decodeElements`' undeclared child (`:181-186`: the child spelled with `contrast` = the declared slots' Clark names, and each declared slot spelled with `contrast` = `[child.name]`, so a namespace mismatch prints both namespaces), and `decodeElement`'s undeclared attribute (`:408-412`: the attribute and every declared attribute spelled as attributes; the `data-*` entry `ena-4` added stays). `plan.wire` already is the authored element name and stays.

Tests in `src/compile.test.ts`: an element under `{ "": QTI, xsi: XSI }` with an undeclared `xsi:schemaLocation` attribute fails with a message containing `xsi:schemaLocation` and not `{http://www.w3.org/2001/XMLSchema-instance}`; a `p` with `elements({ item: Item })` (`Item` is `{urn:qti}item`) decoding a no-namespace `<item>` child fails with a message matching `/no namespace/` and `/urn:qti/`; the existing `declared children: a.` pin (`:801`) still holds. red_first: the first two fail on the message before the change.

Rules: R-errors, R-batch, R-test, R-check, R-commit (`fix(compile):`). Check: `bun x vp test src/compile.test.ts && bun x vp check src/compile.ts src/compile.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-11: Bug 9 in `src/canonical.ts`

- write_scope: `src/canonical.ts`
- deps: ena-2
- red_first: yes
- status: pending

`canonicalize` and `normalizedNames` become internal (O5), but their comments still follow R-doc. In `src/canonical.ts`: the "Effect checked:" paragraphs at `:20` and `:89` and the "Native review:" paragraph at `:148` leave the JSDoc (R-native: a one-line `// Native:` comment above the declaration where the rationale is not already in `docs/rd/effect-native-api-review.md` section 2; otherwise drop it); `{@link planOf}` at `:150` becomes a code span; `:82-83` "decision D1 with its C3 amendment leaves that order outside the round-trip promise" becomes a present-tense statement that differently named children's order is outside the promise. No behaviour change.

red_first: the regression check is the bug-9 oracle with `<files>` = `src/canonical.ts`: `3 1 1` before, `0 0 0` after; record both. No test file (doc comments only); the existing tests pass unchanged.

Rules: R-doc, R-native, R-check, R-commit (`docs(canonical):`). Check: the oracle prints `src/canonical.ts 0 0 0`, then `bun x vp test src/canonical.test.ts && bun x vp check src/canonical.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-12: R6, R8, and O8 at the whole-document entry: parser limits, `parseOptions`, named `EncodeOptions`, threaded services

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: ena-2, ena-7, ena-34
- red_first: yes
- status: pending

`decodeString`, `encodeString`, and `decodeTree` become the internal implementation of `fromString` and `ElementFromString` (`ena-16`), so their signatures carry what those need. What is wrong today: `decodeString(Root, { maxDepth: 64 } as any)` is accepted but ignored (review A21; `readRoot` calls `Xml.decodeString()` with no options, `src/codec.ts:169`); no entry takes `ParseOptions` (R6), so `errors: "all"` cannot be requested; `encodeString`'s options are an inline bag (`:317`); and the entry points return `R = never` for a codec that needs services (bug 3, O8: "thread `RD`/`RE` through the element types and the entry points, on R1's carrier").

Change in `src/codec.ts`:

- `LimitOptions` (`:123-126`) gains `maxTokenSize` and `maxDepth`, so the whole document takes the same parser limits as a stream; every field is `?: number | undefined`. `DecodeStreamOptions` (`:142-146`) becomes `LimitOptions` plus `readonly positions?: boolean | undefined`. A new `EncodeOptions` is `{ readonly declaration?: boolean | undefined }` and `encodeString(def, options?: EncodeOptions)` takes it. Oracle: `grep -nE '^\s+readonly [a-zA-Z]+\?: [^|]+;$' src/codec.ts` prints 5 lines on `10709ad` and none after.
- `readRoot` (`:164-185`) reads the tokenizer with `yield* Tokenizer` (R-tokenizer; `src/tokenizer.ts`, `ena-34`) and passes `{ maxDepth, maxTokenSize }` to `tokenizer.decodeString` where `:169` calls `Xml.decodeString()`, and the two budgets to `collect`. Reading the `Reference` adds nothing to `R`.
- `decodeString` and `encodeString` constrain `Def extends ElementCodec<string, unknown, unknown, unknown>`; the function each returns takes an optional second argument `parseOptions?: SchemaAST.ParseOptions`, passed to `Schema.decodeUnknownEffect(def)(element, parseOptions)` (`:228`) and `Schema.encodeEffect(def)(value, parseOptions)` (`:328`); their `Effect.fn.Return` types carry `Def["DecodingServices"]` and `Def["EncodingServices"]` as `R`. The stream `decode` (`:616-702`, deleted in `ena-33`) gets the same constraint and `R | Def["DecodingServices"]`, nothing more.
- R6 ruling (stated default, recorded in `decodeString`'s doc comment): under `errors: "all"` the `XmlDecodeError`'s `path`, `message`, and `position` describe the first issue (the translation walk follows a `Composite`'s first issue, `src/issue.ts:734`), and every issue stays in `reason.cause`, the `Schema.SchemaError`.

Tests in `src/codec.test.ts` (new `describe("whole-document options")`): (1) a root codec that accepts `<r><i>x</i></r>` decodes it today; with `{ maxDepth: 1 }` it fails with reason `Limit`, `limit` `"maxDepth"` (routing from `ena-1`), and `decodeTree({ maxTokenSize: 4 })` over a longer token fails with `limit` `"maxTokenSize"`; (2) a root with two `Schema.Int` attributes both `"x"`: `decodeString(Root)(xml, { errors: "all" })` fails with `SchemaIssue.makeFormatterStandardSchemaV1()(error.reason.cause.issue).issues.length` at least 2 and `path` naming the first attribute, while the default gives 1; (3) the review service probe (Shared vocabulary) with `P` cast `as ElementCodec<"p", { readonly a: string }, Upper>` under a `// SAFETY:` comment (element() threads it only after `ena-21`): `expectTypeOf(decodeString(P)('<p a="hi"/>'))` has `R` `Upper`, and with `Effect.provideService(Upper, { f: (s) => s.toUpperCase() })` it yields `{ a: "HI" }`. red_first: (1) and (2) fail on value before the change (the limit is ignored; one issue); (3) fails the type check.

Rules: R-effect, R-guide, R-batch, R-doc, R-test, R-check, R-commit (`feat(codec):`). Check: `bun x vp test src/codec.test.ts && bun x vp check src/codec.ts src/codec.test.ts`, the option oracle prints nothing, and the R9 oracle no longer prints `src/codec.ts:169`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-13: O10: `DefinitionError` is a plain `Error` subclass

- write_scope: `src/plan.ts`, `src/dsl.ts`, `src/plan.test.ts`
- deps: ena-8
- red_first: yes
- status: pending

What is wrong (review A16): `DefinitionError` (`src/plan.ts:395-397`) is a yieldable `Data.TaggedError` that is only ever thrown, so `catchTag` can never fire on it. Decision O10: "`DefinitionError` is a plain `Error` subclass." Change it to `export class DefinitionError extends Error` with `name` `"DefinitionError"`, constructed `new DefinitionError(message)`. Every construction site moves to the new form; the inventory is `grep -rn "new DefinitionError" src test --include='*.ts'`, which on `10709ad` prints `src/plan.ts:408`, `:433`, `:460`, `:546` and `src/dsl.ts:175`, `:217` (re-run it; `ena-8` may have moved lines). `lower` still returns it as a `Result` failure; `element`/`suspend` still throw it.

Tests in `src/plan.test.ts`: `new DefinitionError("m")` is an `instanceof Error` and of `DefinitionError`, has `name` `"DefinitionError"` and `message` `"m"`, and `Effect.isEffect` is `false` for it (`node_modules/effect/src/Effect.ts:242`); the existing `toBeInstanceOf(DefinitionError)` cases (`:223`, `:281`, `:323`) hold. red_first: `Effect.isEffect` and `name` fail on value before the change.

Rules: R-batch, R-doc, R-test, R-check, R-commit (`feat(plan)!:`). Check: `bun x vp test src/plan.test.ts && bun x vp test src/dsl.test.ts && bun x vp check src/plan.ts src/dsl.ts src/plan.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-14: R3: channel streaming over text, `decodeSchemaString` and unpositioned `decodeSchema` (fixes bug 2; R6 at the stream)

- write_scope: `src/channel.ts`, `src/channel.test.ts`
- deps: ena-1, ena-2, ena-5, ena-7, ena-34, ena-35
- red_first: yes
- status: pending

Bug 2 is fixed by R3's factory; this slice carries its regression. What is wrong: `decode` (`src/codec.ts:616-702`) is a `Stream -> Stream` function over `Uint8Array | string` split by a runtime `Stream.peel` sniff, where siblings expose one `Channel` per input kind (`Ndjson.decodeSchema`/`decodeSchemaString`, `node_modules/effect/src/encoding/Ndjson.ts:439`, `:467`; `Xml.decode`/`Xml.decodeString`, `encoding/Xml.ts:334`, `:368`), and construction errors surface only when the stream runs. Decision O1 names `decodeSchema` / `decodeSchemaString`. The spike built both from existing channels with parity on every measured axis (`spikes/effect-native-api/channel.ts:21-141`, `RESULT.md` Q3).

Create `src/channel.ts`:

- `decodeSchemaString(def, path)` with `Def extends ElementCodec<string, unknown, unknown, unknown>` returns `<IE = never, Done = unknown>(options?: DecodeStreamOptions, parseOptions?: SchemaAST.ParseOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<Def["Type"]>, XmlDecodeError | IE, Done, Arr.NonEmptyReadonlyArray<string>, IE, Done, Def["DecodingServices"]>`. `decodeSchema(def, path)` is the same over `Arr.NonEmptyReadonlyArray<Uint8Array>` with `options?: LimitOptions` (no positions until `ena-17`).
- At the outer call `(def, path)`, eagerly, as `Xml.elements` does (`encoding/Xml.ts:449-456`): no element marker throws `Error`; `checkRecordPath(path, planOf(def).name)` (`src/record-path.ts`, `ena-5`) returning `Some(message)` throws `new Error(message)`.
- The pipeline per run (spike `channel.ts:55-109`): the parser channel, read from the service when the channel runs (`Channel.unwrap` over `yield* Tokenizer`, `node_modules/effect/src/Channel.ts:9550`; R-tokenizer): `tokenizer.decodeString` or, with `positions: true`, `decodeStringWithPositions` from `src/positions.ts:381` (which reads the tokenizer itself after `ena-35`); `tokenizer.decode` for bytes; each given `maxDepth` and `maxTokenSize`; `Channel.mapError` sending an `Xml.XmlError` through `parserError` (`src/issue.ts`, `ena-1`), `resolveEvents`, `collect(path, budgets)`, `Channel.flattenArray`, then one `Schema.decodeUnknownEffect(def)(element, parseOptions)` per record with a one-based ordinal, failures through `toDecodeError(plan, element, failure, ordinal)` and, for reason `SchemaFailure` on a positioned record, the record-tree position (a private copy of `attachStreamPosition`, `src/codec.ts:360-375`; `ena-33` deletes the original). Records decoded before a failure are emitted before it.
- Spans (R-guide): each run is one `xml.decodeSchemaString` or `xml.decodeSchema` span (`Channel.withSpan`, `Channel.ts:10935`) with the attributes the stream decode sets today (`src/codec.ts:692-700`: `xml.path`, `xml.positions`, `xml.maxElementNodes`, `xml.maxElementSize`) and `xml.records` annotated on exit (`Channel.onExit`, `:10173`).
- R6 at the stream: `parseOptions` reach each record's decode; the R6 ruling of `ena-12` applies per record.

Tests in `src/channel.test.ts`. Port these cases of `describe("decode")` in `src/codec.test.ts` (`:794-1106`) to the channels, copying the fixtures and helpers they use (item-ref fixture text, `splitEvery`, the tracer helpers at `:480-545`): `:795` (text and bytes, through each channel), `:825`, `:837` (reason `SchemaFailure`, `record`), `:859`, `:884` (an empty path now throws at the outer call; a non-positive budget throws when the channel is built), `:932`, `:952`, `:968` (span names `xml.decodeSchemaString`/`xml.decodeSchema`), `:977`, `:1057`, `:1072` (text with positions), `:1088` (reason `Limit`, both channels without positions and text with positions), and `:1015` without positions (bytes, reason `Unsupported`). `:906` (mixed kinds) becomes a type-level case: a `Stream<string>` piped into `decodeSchema` is a `// @ts-expect-error`. Add: the bug-2 regression, on `<bank xmlns:q="urn:qti"><item xmlns="urn:qti" id="1"/><q:item id="2"/></bank>` with `namespaces({ "": "urn:qti" }).element("item", { attributes: { id: Schema.String } })`: `decodeSchemaString(Item, ["bank", "item"])`, `(Item, ["bank", "q:item"])`, `(Item, ["bank", "{x"])`, and `(Item, ["bank", "{urn:qti}other"])` each throw at the outer call with a message naming the step, and `(Item, ["bank", "{urn:qti}item"])` yields both records; `errors: "all"` as `parseOptions` gives a failing record's `reason.cause` two issues; `expectTypeOf` shows `Def["DecodingServices"]` in the channel's environment for a codec typed with a service.

red_first: write the channels without the `checkRecordPath` call first; the bad paths yield an empty run instead of throwing, so the regression fails on value; then add the call.

Rules: R-effect, R-guide, R-native (the `// Native:` line names `Channel` and `Ndjson.decodeSchema` and what `Xml.elements` lacks: Clark names and a namespace scope), R-doc, R-files, R-test, R-check, R-errors, R-commit (`feat(channel):`). Check: `bun x vp test src/channel.test.ts && bun x vp check src/channel.ts src/channel.test.ts`, and the R9 oracle prints no `src/channel.ts` line.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-15: Bug 8: the wire struct's `name` field leaves the error path

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: ena-3, ena-7
- red_first: yes
- status: pending

What is wrong: `decodeString(element("i", { content: text(Schema.String) }))("<j>x</j>")` gives `element name at /j/name (line 1, column 1): Expected "i"; ...`; `/j/name` reads as a child `<name>`, and a stream prints `/j/name of record 1`. Cause: the root issue is a `Pointer(["name"], InvalidType(Literal <clark>))` from the wire struct (`wireElement(Schema.Literal(plan.name))`, `src/compile.ts:659`), and `stepElement` (`src/issue.ts:385-450`) falls through to `{ cursor: opaque, segment: key }`.

Change: in `stepElement`, before the attribute lookup, a key `"name"` whose issue is an `InvalidType` over a `Literal` equal to `plan.name` (the same test `rootName` makes, `:595-598`) ends the walk at the element: no segment, and a leaf whose message says the element `<expected>` was expected, `expected` spelled with `spell(plan.name, plan.prefixes, "element", [element.name])` (`ena-3`) so a namespace mismatch shows both namespaces. An attribute keyed `name` still prints `@name` (the case at `src/issue.test.ts:422-433` stays green), because its issue is not that literal.

Tests in `src/issue.test.ts`, a new `describe("a root element name mismatch")`: decoding `<j>x</j>` with the codec of `i` gives `path` exactly `/j` and a message matching `/expected <i>/` and not `/\/name/`; with `record: 1` the message reads `/j of record 1`; a root `{urn:a}i` against input `{urn:b}i` gives a message matching `/urn:a/` and `/urn:b/`. red_first: the path assertion fails on value (`/j/name`) before the change.

Rules: R-errors, R-batch, R-test, R-check, R-commit (`fix(issue):`). Check: `bun x vp test src/issue.test.ts && bun x vp check src/issue.ts src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-16: R2: the schema-first document codec `fromString`, `ElementFromString`, and `decodeErrorOf`

- write_scope: `src/document.ts`, `src/document.test.ts`, `src/codec.ts`
- deps: ena-8, ena-12
- red_first: yes
- status: pending

What is wrong: text decoding exists only as the library's own Effect functions, not as a `Codec<T, string>`, so `Schema.decodeUnknownEffect(ChoiceInteraction)(xml)` fails with "Expected object" and nothing composes into a `Schema.Struct` field. `Schema.fromJsonString` is the pattern (`node_modules/effect/src/Schema.ts:9838-9884`). Decisions: O1 "`fromString`; `ElementFromString`; ... extractor `decodeErrorOf`"; O2 "drop `decodeString`, `encodeString` and `decodeTree` from the public surface; export `decodeErrorOf`". The spike's carrier B kept the message, XPath, position, and span unchanged (`spikes/effect-native-api/text-codec.ts:24-104`, `RESULT.md` Q1).

Create `src/document.ts`:

- `export interface fromString<Def extends ElementCodec<string, unknown, unknown, unknown>> extends Schema.decodeTo<Schema.toType<Def>, Schema.String, Def["DecodingServices"], Def["EncodingServices"]> { readonly "Rebuild": fromString<Def> }`, named like `Schema.fromJsonString`'s interface (`Schema.ts:9838`); if the lint rejects the lower-case interface name, name it `FromString` and report it.
- `export const fromString = (def, options?: LimitOptions & EncodeOptions): fromString<Def>`: `Schema.String` (annotated `expected: "a string that will be decoded as XML"`) `.pipe(Schema.decodeTo(Schema.toType(def), SchemaTransformation.transformEffect({ decode, encode })))` (`SchemaTransformation.ts:449-457`), where `decode(text, parseOptions)` runs the internal `decodeString(def, options)(text, parseOptions)` and `encode(value, parseOptions)` runs `encodeString(def, options)(value, parseOptions)` (both from `ena-12`), each library error stored on an `InvalidValue` issue whose annotations are `{ message: error.message, xml: error }` (the issue annotation key `xml`; the constructor takes the annotations first, `node_modules/effect/src/SchemaIssue.ts:768`; the spike's `issueOf`, `text-codec.ts:29-30`).
- `export const ElementFromString = (prefixes: PrefixMap, options?: LimitOptions & EncodeOptions)`: a `Codec<ResolvedElement, string>` whose decode is the internal `decodeTree(options)` and whose encode writes the tree with `prefixes`.
- `export const decodeErrorOf = (issue: SchemaIssue.Issue): Option.Option<XmlDecodeError>`: the first `InvalidValue` in the tree whose `xml` annotation satisfies `isDecodeError` (`ena-7`), walking each issue's `issue`/`issues` by tag, with no casts (the spike's `findXml`, `text-codec.ts:90-104`, rewritten). `None` when no XML decode error is stored, for example a non-string input.
- In `src/codec.ts`, extract the tail of `encodeString` (`:332-341`: `toEvents` with the prefixes, `Xml.encodeString`, `invalidEvent`) into an internal exported `encodeTree(prefixes, options?)` that `encodeString` and `ElementFromString` both call and that writes with `(yield* Tokenizer).encodeString()` in place of `Xml.encodeString()` (`:338`; R-tokenizer), so a writer failure becomes the same `XmlEncodeError` reason `InvalidEvent` on both paths.

Tests in `src/document.test.ts`, on the README definitions: (1) `Schema.decodeUnknownSync(fromString(ChoiceInteraction))(xml)` deep-equals the internal `decodeString(ChoiceInteraction)(xml)` value, and `Schema.encodeSync` gives the internal `encodeString` text; (2) the `max-choices="x"` copy fails with a `SchemaError` whose `decodeErrorOf(error.issue)` is `Some` with `path` `/qti-choice-interaction/@max-choices`, `position` `{ line: 1, column: 1 }`, and the same `message` the internal decode gives; (3) inside `Schema.Struct({ id: Schema.String, item: fromString(ChoiceInteraction) })`, and through `Schema.fromJsonString` of that struct, the failure is still `Some` from `decodeErrorOf`; (4) a non-string input gives `None`; (5) `fromString(ChoiceInteraction).annotate({ title: "doc" })` keeps the type `fromString<typeof ChoiceInteraction>` (`expectTypeOf`); (6) a `Schema.Class` root built as in `test/combinators.test.ts` (`ena-8`) decodes through `fromString` to an instance; (7) `Schema.decodeUnknownEffect(fromString(Root), { errors: "all" })` over a root with two bad attributes gives a `DecodeError` whose `reason.cause` holds both issues; (8) `ElementFromString({ "": QTI })` decodes the README document to the tree the internal `decodeTree()` gives, encodes it to text that decodes to an equal tree, and malformed text gives `decodeErrorOf` `Some` with reason `WellFormedness`; (9) one `xml.decodeString` span per `fromString` decode (copy the tracer helper from `src/codec.test.ts:480-500`).

red_first: stub `fromString` as a codec whose decode always fails with a plain `InvalidValue` and `decodeErrorOf` as `() => Option.none()`; (1), (2), and (8) fail on value.

Rules: R-effect, R-guide, R-native (the `// Native:` line names `Schema.fromJsonString` and `Schema.toEncoderXml` and why neither decodes XML text through resolved names), R-doc, R-files, R-test, R-check, R-commit (`feat(document):`). Check: `bun x vp test src/document.test.ts && bun x vp test src/codec.test.ts && bun x vp check src/document.ts src/document.test.ts src/codec.ts`, and the R9 oracle no longer prints `src/codec.ts:338` and prints no `src/document.ts` line.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-17: R3: `decodeSchema` over bytes with positions, through a fatal UTF-8 channel (O3)

- write_scope: `src/channel.ts`, `src/channel.test.ts`
- deps: ena-14
- red_first: yes
- status: pending

Decision O3: "bytes with positions keep today's `WellFormedness` "invalid UTF-8" failure (fatal UTF-8 channel), never silent U+FFFD." `Channel.decodeText` (`node_modules/effect/src/Channel.ts:9214`) uses a non-fatal `TextDecoder`, and a fatal one throws inside its `Effect.sync`, which is a defect (`src/codec.ts:423-428` records the same gap for streams).

In `src/channel.ts`: `decodeSchema`'s options become `DecodeStreamOptions`. With `positions: true`, bytes run through a private channel ported from `decodeUtf8` (`src/codec.ts:410-461`) and `utf8` (`:396-408`): one `TextDecoder("utf-8", { fatal: true })` per run, each chunk decoded with `{ stream: true }` under `Effect.try`, the decoder's flush appended at the end, a malformed sequence an `Xml.XmlError` of kind `Syntax` "invalid UTF-8" with no line or column, mapped through `parserError` (reason `WellFormedness`, no `position`, no `record`); then `decodeStringWithPositions`, and the byte-encoding check ported from `checkByteEncoding` (`:492-512`) on the first positioned event, whose `Unsupported` `XmlError` becomes reason `Unsupported` positioned at the declaration. No mixed-kind defect exists: the input type is bytes.

Tests in `src/channel.test.ts`: port `src/codec.test.ts` `:990` (byte positions), `:1001` (invalid UTF-8, reason `WellFormedness`, no position, no record), `:1007` (flush), `:1015` with positions (reason `Unsupported`), and `:1046` (declaration position). red_first: before the change `decodeSchema(...)({ positions: true })` does not exist in the type (or ignores positions), so the positioned-failure assertions fail on value; write them first.

Rules: R-effect, R-guide, R-native, R-doc, R-test, R-check, R-errors, R-commit (`feat(channel):`). Check: `bun x vp test src/channel.test.ts && bun x vp check src/channel.ts src/channel.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-18: Bug 5: text runs in `mixed` are tagged `"#text"` (O6)

- write_scope: `src/compile.ts`, `src/dsl.ts`, `src/compile.test.ts`, `src/dsl.test.ts`, `src/issue.test.ts`, `test/qti/vocabulary.ts`, `test/qti/mixed.test.ts`, `test/qti/open.test.ts`
- deps: ena-7, ena-10, ena-13, ena-15
- red_first: yes
- status: pending

What is wrong: `mixed([element("text", { content: text(Schema.String) })])` on `<m>run<text>el</text></m>` gives `[{ _tag: "text", text: "run" }, { _tag: "text", value: { text: "el" } }]`, so `Match.tag("text")` catches both. Decision O6: "text runs in `mixed` are tagged `"#text"`" (`#` is not an XML `NameStartChar`, so no member can take it). Change `TextItem` (`src/compile.ts:502-509`) to `Schema.Literal("#text")` and the decode getter's tag, and `MixedItem`'s text arm (`src/dsl.ts:93`) to `readonly _tag: "#text"`. The tag value travels with every use; the inventory is command-derived (re-run it first):

```text
grep -rnE '_tag: "text"|_tag === "text"|case "text"|"text" as const|Literal\("text"\)' src test README.md docs/onboarding.md
```

On `10709ad` its matches were: `src/dsl.test.ts:50 170 216 251` `src/compile.ts:502 505 506` `src/issue.test.ts:1156` `src/dsl.ts:93` `src/compile.test.ts:550 552 597 707 709` `test/qti/open.test.ts:111` `test/qti/mixed.test.ts:70 196` `test/qti/vocabulary.ts:170 320`. After the slice it prints nothing. `src/issue.ts` resolves mixed members by Clark name (`memberOf`, `:466-469`), not by tag, so it needs no change.

Tests in `src/compile.test.ts`, `describe("compile: mixed content")` (`:536`): a mixed body with a member element named `text` decodes `<m>run<text>el</text></m>` to items whose tags are `"#text"` then `"text"`, the run carrying `text: "run"` and the member `value: { text: "el" }`, and encodes back to the same children; in `src/dsl.test.ts`, `expectTypeOf` shows that body's `children[number]["_tag"]` is `"#text" | "text"`. red_first: the decode assertion fails on value (`"text"` twice) before the change.

Rules: R-batch, R-doc, R-test, R-check, R-commit (`fix(compile)!:`). Check: `bun x vp test src/compile.test.ts && bun x vp test src/dsl.test.ts && bun x vp test src/issue.test.ts && bun x vp test test/qti/mixed.test.ts && bun x vp test test/qti/open.test.ts && bun x vp check src/compile.ts src/dsl.ts src/compile.test.ts src/dsl.test.ts src/issue.test.ts test/qti/vocabulary.ts test/qti/mixed.test.ts test/qti/open.test.ts`, and the inventory command prints nothing.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-19: Bug 1: an attribute key that equals the content key or a slot key is a `DefinitionError` (O7)

- write_scope: `src/plan.ts`, `src/plan.test.ts`
- deps: ena-13
- red_first: yes
- status: pending

What is wrong (P0, silent data loss): `element("p", { attributes: { text: Schema.String }, content: text(Schema.String) })` decodes `<p text="ATTR">BODY</p>` to `{ text: "BODY" }` and accepts `<p>BODY</p>` without the required attribute, because `compile` writes `fields[a.key]` and then overwrites it with `fields[content.key]` or `fields[slot.key]` in one struct (`src/compile.ts:635-657`); `lower` checks only `data-*` shadowing (`src/plan.ts:540-550`). The same happens for an attribute named like an `elements` slot, and for `children` on `mixed`. Decision O7: "an attribute key that equals the content key or a slot key is a `DefinitionError` at definition time."

In `lower` (`src/plan.ts:527-563`), after `lowerContent`: an attribute key equal to `"text"` under `text` content, `"children"` under `mixed` content, or any slot key under `elements` content (and `"*"` under open `elements`) returns `new DefinitionError(message)` naming both declarations and the repair, for example `Element "p" declares the attribute "text" and its text content under the same key "text"; rename the attribute key or the slot`. `element()` throws it at definition time, as it does every `lower` failure.

Tests in `src/plan.test.ts`, in `describe("lower")` (`:169`): the three collisions (text content, a mixed body, an `elements` slot) each give a `Result` failure that is a `DefinitionError` whose message names both keys (regex); a non-colliding attribute beside each content mode still lowers. red_first: each collision lowers to `Success` before the change.

Rules: R-errors, R-batch, R-test, R-check, R-commit (`fix(plan):`). Check: `bun x vp test src/plan.test.ts && bun x vp check src/plan.ts src/plan.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-20: R4: the `XmlSchema` namespace module, exported beside the flat names

- write_scope: `src/xml-schema.ts`, `src/index.ts`, `test/namespace.test.ts`
- deps: ena-1, ena-7, ena-9, ena-12, ena-14, ena-16, ena-34
- red_first: yes
- status: pending

Effect publishes modules as namespaces (`node_modules/effect/src/index.ts:645`, `encoding/index.ts:24`, `:96`); flat names collide today (`decode`, `decodeString`, `encodeString`, `elements` with `Xml.*`; `optional`, `suspend`, `Text` with `Schema.*`). Decision O1: "namespace `XmlSchema`; `fromString`; `ElementFromString`; `decodeSchema` / `decodeSchemaString`; `Array`; `optionalKey`; `DecodeError` / `EncodeError` (tags unchanged); `Element`; `equivalence`; extractor `decodeErrorOf`." The spike's barrel is `spikes/effect-native-api/xml-schema.ts:1-56`.

Create `src/xml-schema.ts`, re-exports only, with these members and no others:

- values: `element`, `namespaces`, `suspend` (`./dsl.ts`); `text`, `elements`, `mixed`, `many as Array`, `optional as optionalKey`, `DefinitionError` (`./plan.ts`); `clark` (`./element.ts`); `fromString`, `ElementFromString`, `decodeErrorOf` (`./document.ts`); `decodeSchema`, `decodeSchemaString` (`./channel.ts`); `equivalence` (`./equivalence.ts`); `Tokenizer` (`./tokenizer.ts`, R9; `defaultTokenizer` stays internal, since the `Reference` carries it); `XmlDecodeError as DecodeError`, `XmlEncodeError as EncodeError`, `isDecodeError`, `isEncodeError`, `SchemaFailure`, `EncodeSchemaFailure`, `UndeclaredPrefix`, `WellFormedness`, `Limit`, `Unsupported`, `UnmappedNamespace`, `InvalidEvent` (`./issue.ts`).
- types: `MixedItem`, `Namespaces` (`./dsl.ts`); `ResolvedElement as Element` (`./element.ts`); `DecodeErrorReason`, `EncodeErrorReason` (`./issue.ts`); `LimitOptions`, `DecodeStreamOptions`, `EncodeOptions` (`./codec.ts`); `Attributes`, `ChildFields`, `ChildSpec`, `Content`, `ElementCodec`, `Elements`, `Empty`, `Many`, `Mixed`, `Optional`, `PrefixMap`, `Spec`, `Text` (`./plan.ts`); `ElementPath`, `ElementStep`, `Position` (`./positions.ts`); `Tokenizer` (interface), `TokenizerDecodeOptions`, `PositionedStartElement` (`./tokenizer.ts`); the `fromString` interface comes with its value.
- not exported: `decodeString`, `encodeString`, `decodeTree`, `decode`, `canonicalize`, `normalizedNames`, `CanonicalOptions`, `defaultMaxElementSize`, `defaultMaxElementNodes` (O2, O5, and the R4 table).

The module's JSDoc says `suspend` keeps its leading name argument because dispatch needs the name before the thunk is forced (review section 5). In `src/index.ts` add `export * as XmlSchema from "./xml-schema.ts";` and keep every flat export (`ena-33` removes them).

Tests in a new `test/namespace.test.ts`, importing `{ XmlSchema }` from `../src/index.ts`: the sorted keys of `XmlSchema` (copy `Object.keys(XmlSchema)` and sort it; `tsconfig.json` targets `ES2022`, so no `toSorted`) equal the value list above, sorted (the list is the namespace's definition, not a measured count); none of the not-exported names is a key; `expectTypeOf<XmlSchema.Element>()` equals the `ResolvedElement` type and `XmlSchema.DecodeError` is the `XmlDecodeError` class; `Xml.decodeString` from `effect/encoding/Xml` and `XmlSchema.decodeSchemaString` are used side by side in one test (spike `q2-namespace.ts`). red_first: create `src/xml-schema.ts` as an empty module and the `index.ts` line first; the key assertions fail on value.

Rules: R-doc, R-files, R-test, R-check, R-commit (`feat(index):`). Check: `bun x vp test test/namespace.test.ts && bun x vp check src/xml-schema.ts src/index.ts test/namespace.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-21: Bug 3: `element` and `suspend` thread their services (O8)

- write_scope: `src/dsl.ts`, `src/dsl.test.ts`, `test/services.test.ts`
- deps: ena-12, ena-16, ena-18
- red_first: yes
- status: pending

Bug 3 is fixed by R1's carrier (`ena-2`) plus O8 ("thread `RD`/`RE` through the element types and the entry points, on R1's carrier"); the entry points were threaded in `ena-12` (internal), `ena-14` (channels), and `ena-16` (`fromString`). What remains: `Namespaces.element` (`src/dsl.ts:135-142`, implementation `:198-212`) returns `ElementCodec<Name, T>` with `RD`/`RE` fixed to `never`, so the review service probe (Shared vocabulary) is typed `R = never` and dies at run time with "Service not found: Upper".

Change: `element`'s return type is `ElementCodec<Name, Simplify<AttributesType<A> & ContentType<C>>, Services<A, C, "DecodingServices">, Services<A, C, "EncodingServices">>`, where a new exported helper type `Services` is the union of the attribute schemas' (`data-*` included), the text schema's, the `elements` slots', and the `mixed` members' services of that kind (`never` for `empty`). `suspend` (`:157-160`, `:213-225`) is generic in `RD`/`RE`: `thunk: () => ElementCodec<Name, T, RD, RE>` returns the same. The runtime is unchanged; the existing `// SAFETY:` cast (`:206-209`) carries the new type.

Tests: `src/dsl.test.ts`, in `describe("inference")` (`:238`): `expectTypeOf<(typeof P)["DecodingServices"]>()` is `Upper` for the probe; a parent whose slot holds `P` (via `many`) has `Upper` too; a service-free element keeps `never`. A new `test/services.test.ts`: `decodeString(P)('<p a="hi"/>')` (internal, `../src/codec.ts`) has `R` `Upper`, `Effect.runSync` of it without the service is a `// @ts-expect-error`, and with `Effect.provideService(Upper, { f: (s) => s.toUpperCase() })` it yields `{ a: "HI" }`; `Schema.decodeUnknownEffect(fromString(P))` (`../src/document.ts`) has `R` `Upper` as well. red_first: the red is the type check (`bun x vp check src/dsl.ts src/dsl.test.ts test/services.test.ts` reports `never` where `Upper` is asserted); record that line.

Rules: R-batch, R-doc, R-test, R-check, R-commit (`fix(dsl):`). Check: `bun x vp check src/dsl.ts src/dsl.test.ts test/services.test.ts && bun x vp test src/dsl.test.ts && bun x vp test test/services.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-22: Bug 7 in `src/issue.ts`: paths and messages in the caller's terms

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: ena-3, ena-15, ena-18
- red_first: yes
- status: pending

What is wrong: the path printer spells a namespaced attribute as `{uri}local` (`printSegment`, `src/issue.ts:184-203`, except `xml:`), so the review's undeclared `xsi:schemaLocation` prints `/.../@{http://www.w3.org/2001/XMLSchema-instance}schemaLocation` while the element beside it prints by its authored name; and `unmatched` (`:611-618`) prints the child by its Clark name next to wire-named members.

Change: an attribute segment prints `spell(name, plan.prefixes, "attribute")` (`ena-3`), computed where the plan is known (`stepElement`, `:385-450`, for declared, undeclared, and `data-*` attributes), so the path and the message use the same spelling; lookups of the raw value (`subjectWithRepair`, `:842-885`, reads `walked.element?.attributes[last.name]`) keep the Clark name. `unmatched` spells the child with `contrast` = the members' Clark names (and each member with `[child]`), so a namespace mismatch prints both namespaces. Element segments keep printing their local name.

Tests in `src/issue.test.ts`, in `describe("translate: undeclared and name-keyed attributes")` (`:409`): an undeclared `xsi:schemaLocation` under `{ "": QTI, xsi: XSI }` gives `path` ending `/@xsi:schemaLocation` and a message without `{http://www.w3.org/2001/XMLSchema-instance}`; `xml:lang` still prints `@xml:lang`; an unknown no-namespace `<p>` in a closed mixed body whose member is `{urn:q}p` gives a message matching `/no namespace/` and `/urn:q/`. red_first: the path assertion fails on value before the change.

Rules: R-errors, R-batch, R-test, R-check, R-commit (`fix(issue):`). Check: `bun x vp test src/issue.test.ts && bun x vp check src/issue.ts src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-23: Migrate `test/qti/vocabulary.ts` to `XmlSchema`

- write_scope: `test/qti/vocabulary.ts`
- deps: ena-18, ena-20
- red_first: no
- status: pending

Apply the migration map (Shared vocabulary) to `test/qti/vocabulary.ts`: its imports (`:16-17`, `ElementCodec` and `elements, many, mixed, namespaces, optional, text`) become `import { XmlSchema } from "../../src/index.ts"`; `many(` becomes `XmlSchema.Array(`, `optional(` becomes `XmlSchema.optionalKey(`, the type `ElementCodec<...>` becomes `XmlSchema.ElementCodec<...>` (`:190`, `:335`). The exported codecs keep their names, shapes, and decoded values, so the files that import this vocabulary need no change. Call sites: `grep -nE '(^|[^a-zA-Z.])(many|optional|elements|mixed|text|namespaces)\(|ElementCodec' test/qti/vocabulary.ts`. red_first is `no`: a mechanical rewrite against existing tests.

Rules: R-batch, R-files, R-check, R-commit (`test:`). Check: `bun x vp test test/qti/vocabulary.test.ts && bun x vp test test/qti/mixed.test.ts && bun x vp check test/qti/vocabulary.ts`, and `grep -c 'from "../../src/index.ts"' test/qti/vocabulary.ts` prints `1` with that line importing only `XmlSchema`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-24: Migrate `test/streaming/vocabulary.ts` to `XmlSchema`

- write_scope: `test/streaming/vocabulary.ts`
- deps: ena-20
- red_first: no
- status: pending

Apply the migration map to `test/streaming/vocabulary.ts`: its import (`:11`, `clark, elements, many, namespaces`) becomes `XmlSchema`; `many(` becomes `XmlSchema.Array(`. The exported codecs and paths keep their names and values. Call sites: `grep -nE '(^|[^a-zA-Z.])(clark|elements|many|namespaces)\(' test/streaming/vocabulary.ts`. red_first is `no`: mechanical.

Rules: R-batch, R-files, R-check, R-commit (`test:`). Check: `bun x vp test test/streaming/decode.test.ts && bun x vp check test/streaming/vocabulary.ts` (that suite imports this file and runs whether or not `ena-29` has migrated it yet, because the flat exports stay until `ena-33`).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-25: Migrate `test/qti/errors.test.ts` to `fromString` and `decodeErrorOf`

- write_scope: `test/qti/errors.test.ts`
- deps: ena-7, ena-20
- red_first: no
- status: pending

Apply the migration map: imports (`:12-13`, `decodeString` and the type `XmlDecodeError`) become `XmlSchema`; every `decodeString(AssessmentItem)(xml)` becomes `Schema.decodeUnknownEffect(XmlSchema.fromString(AssessmentItem))(xml)`, and every assertion on the decode error's fields (`reason._tag`, `path`, `position`, `message`) reads the `XmlSchema.DecodeError` from `XmlSchema.decodeErrorOf(error.issue)` (a `None` fails the test). The assertions themselves (paths, regexes, the `SchemaFailure` tag from `ena-7`) do not change. Call sites: `grep -nE 'decodeString\(|XmlDecodeError' test/qti/errors.test.ts`. red_first is `no`: the suite already pins the behaviour.

Rules: R-batch, R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/qti/errors.test.ts && bun x vp check test/qti/errors.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-26: Migrate `test/qti/mixed.test.ts` to `fromString`

- write_scope: `test/qti/mixed.test.ts`
- deps: ena-18, ena-20
- red_first: no
- status: pending

Apply the migration map: the import (`:11`, `decodeString, encodeString`) becomes `XmlSchema`; decodes go through `XmlSchema.fromString(AssessmentItem)` with `Schema.decodeUnknownEffect`, encodes through `Schema.encodeEffect`. Assertions are unchanged (the `"#text"` tag from `ena-18` is already in place). Call sites: `grep -nE '(decodeString|encodeString)\(' test/qti/mixed.test.ts`. red_first is `no`: mechanical.

Rules: R-batch, R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/qti/mixed.test.ts && bun x vp check test/qti/mixed.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-27: Migrate `test/qti/open.test.ts` to `XmlSchema`

- write_scope: `test/qti/open.test.ts`
- deps: ena-18, ena-20
- red_first: no
- status: pending

Apply the migration map: imports (`:13-24`: the type `ResolvedElement` and `canonicalize, decodeString, decodeTree, elements, encodeString, many, mixed, normalizedNames, optional`) become `XmlSchema`; `decodeTree` becomes `XmlSchema.ElementFromString({ "": QTI }, ...)`; each `canonicalize(output, options)` / `canonicalize(input, options)` pair compared with `toBe` (`:196`, `:252`) becomes `expect(XmlSchema.equivalence(Def)(output, input)).toBe(true)`; the error assertions at `:272-276` read the `DecodeError` through `decodeErrorOf` and keep `error._tag` `"XmlDecodeError"` and `reason._tag` `"SchemaFailure"`. Call sites: `grep -nE '(canonicalize|decodeString|decodeTree|encodeString|normalizedNames|many|optional|elements|mixed)\(|ResolvedElement' test/qti/open.test.ts`. red_first is `no`: mechanical.

Rules: R-batch, R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/qti/open.test.ts && bun x vp check test/qti/open.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-28: Migrate `test/qti/vocabulary.test.ts` to `XmlSchema`

- write_scope: `test/qti/vocabulary.test.ts`
- deps: ena-20
- red_first: no
- status: pending

Apply the migration map: imports (`:13-14`: the type `ResolvedElement` and `canonicalize, decodeString, encodeString, normalizedNames`) become `XmlSchema`; the internal `collect`/`resolveEvents` import from `../../src/resolve.ts` (`:15`) stays; the canonical comparison becomes `XmlSchema.equivalence(AssessmentItem)`. Call sites: `grep -nE '(canonicalize|decodeString|encodeString|normalizedNames)\(|ResolvedElement' test/qti/vocabulary.test.ts`. red_first is `no`: mechanical.

Rules: R-batch, R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/qti/vocabulary.test.ts && bun x vp check test/qti/vocabulary.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-29: Migrate `test/streaming/decode.test.ts` to the channels

- write_scope: `test/streaming/decode.test.ts`
- deps: ena-20
- red_first: no
- status: pending

Apply the migration map: the import (`:7`, `clark, decode, defaultMaxElementNodes, defaultMaxElementSize`) becomes `XmlSchema` plus the two defaults from `../../src/resolve.ts`; each `decode(Def, path, opts)(byteSource(path))` (`:30`, `:52`, `:73`, `:108`) becomes `byteSource(path).pipe(Stream.pipeThroughChannel(XmlSchema.decodeSchema(Def, path)(opts)))`, and each over `Stream.make(text)` (`:141`, `:156`) uses `XmlSchema.decodeSchemaString`. Assertions (counts, `Limit` fields, heap bounds) are unchanged. Call sites: `grep -nE '(^|[^.a-zA-Z])decode\(|defaultMax' test/streaming/decode.test.ts`. red_first is `no`: mechanical.

Rules: R-batch, R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/streaming/decode.test.ts && bun x vp check test/streaming/decode.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-30: Migrate `test/streaming/positions.test.ts` to the byte channel with positions

- write_scope: `test/streaming/positions.test.ts`
- deps: ena-7, ena-17, ena-20
- red_first: no
- status: pending

Apply the migration map: the import (`:6`, `decode`) becomes `XmlSchema`; both runs (`:36`, `:73`) feed bytes, so they become `XmlSchema.decodeSchema(ItemRef, itemRefPath)({ positions: true })` through `Stream.pipeThroughChannel` (positioned bytes need `ena-17`). Assertions are unchanged (the `SchemaFailure` tag from `ena-7` is in place). Call sites: `grep -nE '(^|[^.a-zA-Z])decode\(' test/streaming/positions.test.ts`. red_first is `no`: mechanical.

Rules: R-batch, R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/streaming/positions.test.ts && bun x vp check test/streaming/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-31: Migrate `test/readme.test.ts` and the README code blocks; add the `SchemaError` to `DecodeError` example

- write_scope: `test/readme.test.ts`, `README.md`
- deps: ena-20
- red_first: no
- status: pending

`test/readme.test.ts` runs the README examples (`GOAL.md` done-when), and the README must show "the `SchemaError` to `DecodeError` catch pattern" via `XmlSchema.decodeErrorOf` (O2). This slice moves the code; `ena-docs` rewrites the prose around it.

In `test/readme.test.ts`: the import (`:5-16`) becomes `import { XmlSchema } from "../src/index.ts"` (plus `Effect`, `Option`, `Schema` from `effect`). Three regions, each between the exact marker lines `// readme:<name>` and `// readme:<name>-end` (rename today's `// readme:end` to `// readme:start-end`), top-level statements only, no `import`, `it(`, or `expect(`:

- `start` (under 40 lines): the README definitions written with `XmlSchema.namespaces`, `XmlSchema.text`, `XmlSchema.elements`, `XmlSchema.optionalKey`, `XmlSchema.Array`; `const Document = XmlSchema.fromString(ChoiceInteraction)`; `const value = Schema.decodeUnknownSync(Document)(xml)` with `console.log(value)`; `const encoded = Schema.encodeSync(Document)(value)`.
- `errors` (new): decode the `max-choices="x"` copy with `Schema.decodeUnknownEffect(Document)`, `Effect.catchTag("SchemaError", ...)` mapping the error through `XmlSchema.decodeErrorOf(error.issue)` to the `XmlSchema.DecodeError` (keeping the `SchemaError` when it is `None`), then `Effect.catchReason("XmlDecodeError", "SchemaFailure", ...)` selecting the reason; print the message.
- `round-trip`: `const equivalent = XmlSchema.equivalence(ChoiceInteraction)`; `const Tree = XmlSchema.ElementFromString({ "": QTI })`; print `equivalent(Schema.decodeUnknownSync(Tree)(xml), Schema.decodeUnknownSync(Tree)(encoded))`.

Assertions outside the regions keep today's facts (`value["max-choices"]` is `1`; choices `A`, `B` in order; `encoded` decodes back to `value`; the failure's `path` is `/qti-choice-interaction/@max-choices` and its message matches `/finite/i`; the round trip prints `true`). In `README.md`, the first three `ts` blocks become, in order, the `start`, `errors`, and `round-trip` regions, each with only its import lines added (`import { XmlSchema } from "@aidenzepp/effect-xml";` and the `effect` import, each on one line); the Start section's `console` output block shows what the regions print. Leave every other README sentence to `ena-docs`.

Check, run with `bash` from the repository root (on `10709ad` it prints `DIFF` three times; after the slice it prints `same` three times):

````text
block() { awk -v n="$1" '/^```ts/{c++; if(c==n){f=1;next}} f&&/^```/{exit} f' README.md | grep -v '^import ' | sed '/./,$!d'; }
region() { awk -v r="$1" '$0=="// readme:"r{f=1;next} $0=="// readme:"r"-end"{f=0} f' test/readme.test.ts; }
i=0; for r in start errors round-trip; do i=$((i+1)); diff <(block $i) <(region $r) >/dev/null && printf 'same %s\n' "$r" || printf 'DIFF %s\n' "$r"; done
````

If `vp fmt` reformats a README block so it no longer equals its region, reformat the region to match, never the other way round. red_first is `no`: documentation and test migration.

Rules: R-readme, R-test, R-check, R-commit (`docs:`). Check: the script above prints `same` three times, then `bun x vp test test/readme.test.ts && bun x vp check test/readme.test.ts && bun x vp fmt --check README.md`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-32: Bug 9 in `src/compile.ts`, `src/dsl.ts`, `src/plan.ts`, and `src/issue.ts`

- write_scope: `src/compile.ts`, `src/dsl.ts`, `src/plan.ts`, `src/issue.ts`
- deps: ena-10, ena-18, ena-19, ena-21, ena-22
- red_first: yes
- status: pending

Every other writer of these four files is accepted first. Bug 9: published doc comments carry native-review paragraphs and internal links. At the cut: "Native review:" / "Effect checked:" / "Native check:" paragraphs at `src/compile.ts:537`, `:625`; `src/dsl.ts:126`, `:146`, `:187`; `src/plan.ts:13`, `:161`, `:504`; `src/issue.ts:178`, `:208`, `:221`, `:783`; and `{@link toDecodeError}` at `src/issue.ts:1150` (re-locate each with the oracle's patterns; earlier slices moved lines). Each paragraph leaves its JSDoc block: when the rationale is not already in `docs/rd/effect-native-api-review.md` section 2, it becomes one `// Native:` line above the declaration (R-native); otherwise it is dropped. The internal link becomes a code span. A public declaration's remaining JSDoc keeps behaviour, gotchas, and an example (R-doc). No behaviour change.

red_first: the regression check is the bug-9 oracle with `<files>` = `src/compile.ts src/dsl.ts src/plan.ts src/issue.ts`: before the edit the lines read `2 0 0`, `3 0 0`, `3 0 0`, `4 1 0` (unless a chained slice changed them; record what you see); after it, every line ends `0 0 0`. No test file (doc comments only); the existing tests pass unchanged.

Rules: R-doc, R-native, R-check, R-commit (`docs(issue):`). Check: the oracle prints `0 0 0` on all four lines, then `bun x vp test src/compile.test.ts && bun x vp test src/dsl.test.ts && bun x vp test src/plan.test.ts && bun x vp test src/issue.test.ts && bun x vp check src/compile.ts src/dsl.ts src/plan.ts src/issue.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-33: R4 lands: `src/index.ts` exports only `XmlSchema`; the legacy stream `decode` goes; `src/codec.ts` doc comments (bug 9)

- write_scope: `src/index.ts`, `test/namespace.test.ts`, `src/codec.ts`, `src/codec.test.ts`
- deps: ena-12, ena-16, ena-17, ena-20, ena-36, ena-23, ena-24, ena-25, ena-26, ena-27, ena-28, ena-29, ena-30, ena-31
- red_first: yes
- status: pending

`GOAL.md` done-when: "R1-R8 are in the public surface under the O1 names, exported only through `export * as XmlSchema`; `decodeString`, `encodeString`, `decodeTree`, `canonicalize`, `normalizedNames` and the default-limit constants are not exported."

1. `src/index.ts` becomes one module JSDoc (what the package is and that every member lives on `XmlSchema`; no repository path, which today's `:6` names) and `export * as XmlSchema from "./xml-schema.ts";`. First confirm no importer still uses a flat name: every line `grep -rnE 'from "(\.\./)+src/index\.ts"' test` prints reads `import { XmlSchema } from ...` (on `10709ad` it prints flat imports, among them `test/qti/errors.test.ts:12`).
2. In `src/codec.ts`, delete the legacy stream decode, which nothing imports once the migrations land: `decode` (`:563-702` at the cut) and its private helpers `attachStreamPosition`, `mixedKinds`, `utf8`, `decodeUtf8`, `isUtf8Encoding`, `checkByteEncoding`, `sameKind`, `decodeEvents` (`:344-561`), and the imports only they used. `decodeString`, `encodeString`, `encodeTree`, `decodeTree`, `readRoot`, `attachPosition`, and the option types stay (internal, and the types are re-exported by the namespace). On `10709ad`, `grep -rnE '\bdecode\b' src test --include='*.ts' | grep -E 'codec(\.ts)?"'` prints `src/codec.test.ts:16` and `src/index.ts:12`; after steps 1 and 3 it prints nothing.
3. In `src/codec.test.ts`, delete `describe("decode")` (`:794-1106` at the cut) and the helpers only it used; `src/channel.test.ts` carries each case (`ena-14`, `ena-17`).
4. Bug 9 in what remains of `src/codec.ts`: the "Native review:" paragraphs on `decodeString`, `decodeTree`, `encodeString` (`:207`, `:258`, `:305` at the cut) leave the JSDoc (R-native), and the remaining internal `{@link}`s become code spans.

Test in `test/namespace.test.ts`: `Object.keys(await import("../src/index.ts"))` equals `["XmlSchema"]`. red_first: that assertion fails on value before step 1 (the flat names are present); the bug-9 oracle with `<files>` = `src/codec.ts src/index.ts` prints `5 23 0` and `0 0 1` before and `0 0 0` on both after.

Rules: R-batch, R-doc, R-native, R-test, R-check, R-commit (`feat(index)!:`). Check: `bun x vp test test/namespace.test.ts && bun x vp test src/codec.test.ts && bun x vp test src/channel.test.ts && bun x vp check src/index.ts src/codec.ts src/codec.test.ts test/namespace.test.ts`, and the oracle prints `0 0 0` on both lines, and the R9 oracle prints nothing (the legacy calls at `:546-557` are gone).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-34: R9: the `Tokenizer` service, a `Context.Reference` defaulting to `effect/encoding/Xml`

- write_scope: `src/tokenizer.ts`, `src/tokenizer.test.ts`
- deps: none
- red_first: yes
- status: pending

Owner addition R9 (`work/owner-directive-tokenizer-seam.md`; review section 7 at `cb6e871`; `GOAL.md` at `ec5a806`): "`XmlSchema.Tokenizer` is a `Context.Reference<Tokenizer>` keyed `"@aidenzepp/effect-xml/Tokenizer"`, defaulting to `effect/encoding/Xml` ... The default needs no Layer and adds nothing to `R`." Native-position ruling (review section 7): "`Tokenizer` (interface) declares an optional capability, `positions: "native" | "none"` (absent means `"none"`). A `"native"` tokenizer, when asked for positions, sets `line` and `column` (1-based, the `<` of the start tag, upstream `XmlError` counting rules) on each `StartElement`."

Create `src/tokenizer.ts`, the only module that calls `effect/encoding/Xml`'s channels:

- `export interface TokenizerDecodeOptions extends Xml.DecodeOptions { readonly positions?: boolean | undefined }`: `positions: true` asks a `"native"` tokenizer for start-tag positions; a `"none"` tokenizer ignores it.
- `export interface PositionedStartElement extends Xml.StartElement { readonly line: number; readonly column: number }`: what a `"native"` tokenizer emits for a start tag when asked for positions.
- `export interface Tokenizer` with `decode`, `decodeString` (each `<IE = never, Done = unknown>(options?: TokenizerDecodeOptions) => Channel.Channel<Arr.NonEmptyReadonlyArray<Xml.Event>, Xml.XmlError | IE, Done, Arr.NonEmptyReadonlyArray<Uint8Array | string>, IE, Done>`, bytes for `decode` and strings for `decodeString`), `encode`, `encodeString` (each `<IE = never, Done = unknown>() => Channel.Channel<Arr.NonEmptyReadonlyArray<Uint8Array | string>, Xml.XmlError | IE, Done, Arr.NonEmptyReadonlyArray<Xml.Event>, IE, Done>`), and `readonly positions?: "native" | "none"`: the upstream signatures (`node_modules/effect/src/encoding/Xml.ts:334`, `:368`, `:511`, `:538`). `elements` is not in the shape: the library never calls it. The doc comment states the contract a tokenizer keeps (the conformance suite, `ena-38`/`ena-39`, checks it): failures are upstream `Xml.XmlError` values with its kinds and line/column rules; a `Limit` failure's message names the limit as `<limit> of <max>` (what `parserError`, `ena-1`, reads); a `"none"` tokenizer emits one output chunk per input chunk (the contract `decodeStringWithPositions` relies on, `src/positions.ts:354-367`).
- `export const defaultTokenizer: Tokenizer` = `{ decode: Xml.decode, decodeString: Xml.decodeString, encode: Xml.encode, encodeString: Xml.encodeString, positions: "none" }`.
- `export const Tokenizer = Context.Reference<Tokenizer>("@aidenzepp/effect-xml/Tokenizer", { defaultValue: () => defaultTokenizer })` (`node_modules/effect/src/Context.ts:2071-2125`; a `Reference` is a `Service<never, Shape>`, `:497`, so reading it adds nothing to `R`; `ai-docs/src/01_effect/03_services/10_reference.ts` is the model).

Stated default (report it): "no direct `Xml.*` calls" means no call of a tokenizer channel (`decode`, `decodeString`, `encode`, `encodeString`, `elements`) outside this module; `Xml.XmlError`, `Xml.isXmlError`, and the event types stay the shared error and event model the shape is written in, so `src/issue.ts` and `src/resolve.ts` keep using them. The R9 oracle (Standing rules) measures this.

Tests in `src/tokenizer.test.ts`: `yield* Tokenizer` in an `it.effect` with nothing provided returns `defaultTokenizer`, and `expectTypeOf` shows the reading effect's `R` is `never`; under `Effect.provideService(Tokenizer, custom)` it returns `custom`; under `Layer.succeed(Tokenizer, custom)` likewise; `defaultTokenizer.positions` is `"none"`; `defaultTokenizer.decodeString()` over `<a/>` yields a `StartElement` named `a`. red_first: stub `Tokenizer`'s default as an object whose channels fail, so the default-read and decode assertions fail on value.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(tokenizer):`). Check: `bun x vp test src/tokenizer.test.ts && bun x vp check src/tokenizer.ts src/tokenizer.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-35: R9: `src/positions.ts` reaches the tokenizer through the service; the native-position adapter; test fakes

- write_scope: `src/positions.ts`, `src/positions.test.ts`, `test/tokenizer/fakes.ts`
- deps: ena-6, ena-34
- red_first: yes
- status: pending

What is wrong: `decodeStringWithPositions` (`src/positions.ts:381-492`) calls `XmlRuntime.decodeString` directly (`:483`, inside its `Channel.fromTransform`), so a provided tokenizer is never used on the positioned path.

Change in `src/positions.ts`: inside the transform's effect (`:391` onward), read the tokenizer with `yield* Tokenizer` (`src/tokenizer.ts`, `ena-34`) and call `tokenizer.decodeString(options)` where `:483` calls `XmlRuntime.decodeString`; drop the `XmlRuntime` import (`:9`). The signature does not change, so its callers (`src/codec.ts:651`, `src/channel.ts` from `ena-14`, `src/positions.test.ts`, `src/resolve.test.ts`) need no edit and inherit whatever tokenizer the run provides. Add `export const nativePositions = <IE, Done>(): Channel.Channel<Arr.NonEmptyReadonlyArray<PositionedEvent>, IE, Done, Arr.NonEmptyReadonlyArray<Xml.Event>, IE, Done>`: each event becomes a `PositionedEvent` (`:349-352`) whose position is the event's own `line`/`column` when it is a `StartElement` carrying both numbers (a `PositionedStartElement`, read with `Predicate` helpers), and otherwise the last start-tag position seen in the run (`{ line: 1, column: 1 }` before the first). This is the native-position path the review section 7 ruling prefers; `ena-36` and `ena-37` wire it in.

Create `test/tokenizer/fakes.ts` (test-only, shared by `ena-36`..`ena-41`): `spyTokenizer()` returns `{ tokenizer, calls }`, a `Tokenizer` (interface) that delegates to `defaultTokenizer` and records each channel factory called (`"decode"`, `"decodeString"`, `"encode"`, `"encodeString"`) with its options; `honestNativeTokenizer`, `positions: "native"`, whose `decodeString({ positions: true })` runs `decodeStringWithPositions` under `Channel.provideService(Tokenizer, defaultTokenizer)` (`node_modules/effect/src/Channel.ts:10621`; providing the default avoids recursing into itself) and copies each start tag's position onto the `StartElement` as `line`/`column`, and whose `decode({ positions: true })` does the same after a fatal UTF-8 decode of the bytes; `shiftedNativeTokenizer`, the same but with `line` increased by 1000, so a test can tell native positions from scanned ones.

Tests in `src/positions.test.ts`: under `Effect.provideService(Tokenizer, spy.tokenizer)`, running `decodeStringWithPositions()` over a document records a `"decodeString"` call; `nativePositions()` over events from `honestNativeTokenizer.decodeString({ positions: true })` yields the same positions as `decodeStringWithPositions()` for every `StartElement` on a multi-line document; a non-start event carries the last start position. red_first: the spy assertion fails on value before the change (no call recorded: the channel called `XmlRuntime` directly); stub `nativePositions` to emit `{ line: 1, column: 1 }` for every event so its assertions fail on value.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(positions):`). Check: `bun x vp test src/positions.test.ts && bun x vp test src/resolve.test.ts && bun x vp check src/positions.ts src/positions.test.ts test/tokenizer/fakes.ts`, and the R9 oracle prints no `src/positions.ts` line.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-36: R9: the whole-document decode prefers native positions

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: ena-16, ena-35
- red_first: yes
- status: pending

Review section 7 ruling: "When positions are requested and the tokenizer is `"native"`, the library reads them from the events and skips the locate scanner and the position-tracking channel. Otherwise it keeps today's paths." A whole-document decode always positions its failures (README Positions table), today by rescanning the text with `locate` on the failure path (`attachPosition`, `src/codec.ts:90-110`).

Change in `src/codec.ts`: when the tokenizer `readRoot` reads (`ena-12`) has `positions: "native"`, `readRoot` asks it for `decodeString({ maxDepth, maxTokenSize, positions: true })` and pipes the events through `nativePositions()` (`src/positions.ts`, `ena-35`) before `resolveEvents` and `collect`, so `collect` records the root's position tree; `attachPosition` then reads a `SchemaFailure`, `UndeclaredPrefix`, or namespace-rule `WellFormedness` position from that tree with `recordPositions` and `positionAt` (the way the channel path does, `src/channel.ts`) and never calls `locate`. A `"none"` tokenizer keeps today's path exactly. Parser failures keep their upstream position (`ena-1`).

Tests in `src/codec.test.ts`, using `test/tokenizer/fakes.ts` (`ena-35`): under `Effect.provideService(Tokenizer, shiftedNativeTokenizer)`, the README `max-choices="x"` failure through the internal `decodeString` has `position.line` at least 1000 (read from the events, not scanned); under `honestNativeTokenizer` the position equals the default tokenizer's (`{ line: 1, column: 1 }`); with nothing provided the existing position tests pass unchanged. red_first: before the change the shifted case reports the scanned line 1.

Rules: R-effect, R-batch, R-doc, R-test, R-check, R-commit (`feat(codec):`). Check: `bun x vp test src/codec.test.ts && bun x vp check src/codec.ts src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-37: R9: the channels prefer native positions

- write_scope: `src/channel.ts`, `src/channel.test.ts`
- deps: ena-17, ena-35
- red_first: yes
- status: pending

Same ruling as `ena-36`, at the stream. Change in `src/channel.ts`: with `positions: true` and a tokenizer whose `positions` is `"native"`, `decodeSchemaString` runs `tokenizer.decodeString({ maxDepth, maxTokenSize, positions: true })` and `decodeSchema` runs `tokenizer.decode({ ..., positions: true })`, each piped through `nativePositions()` (`ena-35`) into `resolveEvents`; the position-tracking channel `decodeStringWithPositions`, the fatal UTF-8 channel, and the byte-encoding check (`ena-17`) are skipped, because a byte tokenizer keeps its own encoding rules. A `"none"` tokenizer keeps the `ena-14`/`ena-17` paths exactly.

Tests in `src/channel.test.ts`, with `test/tokenizer/fakes.ts`: a positioned run of each channel over a document whose third record fails, under `shiftedNativeTokenizer`, gives a `SchemaFailure` whose `position.line` is at least 1000 and the same `record` as the default; under `honestNativeTokenizer` the position equals the default's; with nothing provided every existing case passes. red_first: before the change the shifted runs report the scanned position.

Rules: R-effect, R-guide, R-doc, R-test, R-check, R-commit (`feat(channel):`). Check: `bun x vp test src/channel.test.ts && bun x vp check src/channel.ts src/channel.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-38: R9: the tokenizer conformance suite, part 1: the upstream contract

- write_scope: `test/tokenizer/conformance.ts`, `test/tokenizer/default.test.ts`
- deps: ena-1, ena-34
- red_first: no
- status: pending

Directive: "one test suite parameterized by a `Tokenizer` (interface), run against the default in the normal ladder. It covers the upstream behaviors the library pins (`test/upstream-xml.test.ts`) plus the library's own round-trip and error-path expectations." This slice is the first half; `ena-39` adds the library half to the same file.

Create `test/tokenizer/conformance.ts` exporting `conformance(name: string, tokenizer: Tokenizer): void`, which registers one `describe(\`tokenizer conformance: ${name}\`)`(with`@effect/vitest`'s `describe`/`it`) whose cases port the tokenizer-generic cases of `test/upstream-xml.test.ts`, calling `tokenizer.decode`/`decodeString`/`encode`/`encodeString`where that file calls`Xml.*`: `:35`, `:53`, `:73`, `:87`, `:110`, `:122`, `:136`, `:168`, `:184`, `:193`, `:212`, `:230`, `:284`(with the`Limit`message matching`/\b(maxDepth|maxTokenSize) of \d+\b/`, the form `parserError`reads),`:314`, and `:146`("one output chunk per input chunk") only when`tokenizer.positions !== "native"`(the contract`decodeStringWithPositions`relies on). The`Xml.elements` cases (`:243`, `:262`, `:308`) and the `XmlError` constructor case (`:326`) are not tokenizer behaviour and stay only in `test/upstream-xml.test.ts`, which remains the upstream canary the README names; this suite copies its expectations rather than moving them. Create `test/tokenizer/default.test.ts`: `conformance("effect/encoding/Xml", defaultTokenizer)`. red_first is `no`: the default already conforms; the suite pins it.

Rules: R-test, R-check, R-files, R-commit (`test:`). Check: `bun x vp test test/tokenizer/default.test.ts && bun x vp check test/tokenizer/conformance.ts test/tokenizer/default.test.ts`, and the run reports one test per ported case (confirm the count against the list above, R-check).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-39: R9: the tokenizer conformance suite, part 2: the library's round-trip, error paths, and native positions

- write_scope: `test/tokenizer/conformance.ts`
- deps: ena-9, ena-16, ena-17, ena-35, ena-38
- red_first: no
- status: pending

Add to `conformance(name, tokenizer)` cases that run the library with `Effect.provideService(Tokenizer, tokenizer)` (internal modules imported directly: `../../src/document.ts`, `../../src/channel.ts`, `../../src/equivalence.ts`, `../../src/positions.ts`, `../../src/tokenizer.ts`): round trip: the README definitions (Shared vocabulary) decode through `fromString`, encode, and decode back to an equal value, and the input and output trees from `ElementFromString` are `equivalence`-equal; the QTI fixture `spikes/fixtures/qti/bg007-true-false.xml` with `AssessmentItem` from `test/qti/vocabulary.ts` round-trips the same way; error paths: malformed text gives `decodeErrorOf` reason `WellFormedness` with a `position`, `{ maxDepth: 1 }` gives reason `Limit` `"maxDepth"`, a byte document declaring `ISO-8859-1` through `decodeSchema` gives reason `Unsupported`, and a bad third record through `decodeSchemaString(...)({ positions: true })` gives `SchemaFailure` with `record` 3 and a `position`; native positions, only when `tokenizer.positions === "native"`: for a multi-line document, every `StartElement` that `tokenizer.decodeString({ positions: true })` emits carries `line`/`column` equal to `locate(text, path)` (`src/positions.ts:251`) for that element's `ElementPath` (computed from the event sequence: local name and zero-based index among element siblings). red_first is `no`: the default conforms; `ena-41` runs the native case.

Rules: R-test, R-check, R-files, R-commit (`test:`). Check: `bun x vp test test/tokenizer/default.test.ts && bun x vp check test/tokenizer/conformance.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-40: R9: an overriding tokenizer is the one used, and the default adds nothing to `R`

- write_scope: `test/tokenizer/override.test.ts`
- deps: ena-12, ena-14, ena-16, ena-17, ena-35
- red_first: no
- status: pending

Directive: "Add one test proving that an overriding tokenizer is the one actually used", and "Check that reading it inside the R2 Schema transformation and inside the R3 channels keeps `R = never` when nothing is provided". Create `test/tokenizer/override.test.ts` with `spyTokenizer()` from `./fakes.ts` provided by `Effect.provideService(Tokenizer, spy.tokenizer)`: decoding through `fromString` records `"decodeString"`; encoding through `fromString` and through `ElementFromString` records `"encodeString"`; `decodeSchemaString` with and without `positions` records `"decodeString"`; `decodeSchema` without `positions` records `"decode"` and with `positions` records `"decodeString"` (the bytes are decoded to text first, `ena-17`); the same run with nothing provided records nothing on the spy and still succeeds. Type-level: `Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(xml)` has `R` `never`, and both channels' environment is `never` for a service-free codec. red_first is `no`: the routing landed in `ena-12`, `ena-14`, `ena-16`, `ena-35`; this test pins it (a missed route fails it on value).

Rules: R-test, R-check, R-files, R-commit (`test:`). Check: `bun x vp test test/tokenizer/override.test.ts && bun x vp check test/tokenizer/override.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-41: R9: native tokenizers conform, and the library prefers their positions

- write_scope: `test/tokenizer/native.test.ts`
- deps: ena-36, ena-37, ena-39, ena-40
- red_first: no
- status: pending

Create `test/tokenizer/native.test.ts`: `conformance("honest native", honestNativeTokenizer)` (from `./fakes.ts`), which runs the part-2 native check against `locate`; and, under `shiftedNativeTokenizer`, one failure each through `fromString`, `decodeSchemaString(...)({ positions: true })`, and `decodeSchema(...)({ positions: true })` whose `position.line` is at least 1000, proving each path read the events' positions and skipped the scanner (the ruling, review section 7). red_first is `no`: `ena-36` and `ena-37` carry the red; this file is the end-to-end witness.

Rules: R-test, R-check, R-files, R-commit (`test:`). Check: `bun x vp test test/tokenizer/native.test.ts && bun x vp check test/tokenizer/native.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-docs: README prose and `docs/onboarding.md` describe the `XmlSchema` surface

- write_scope: `README.md`, `docs/onboarding.md`
- deps: ena-20, ena-31, ena-34
- red_first: no
- status: pending

`GOAL.md` done-when: "README and `docs/onboarding.md` describe the new surface, including the `SchemaError` to `DecodeError` catch pattern". `ena-31` already moved the README code blocks; do not change them (the `ena-31` script must still print `same` three times).

`README.md` (sections at the cut: Start `:21-87`, Contract `:88-118`, Round trip `:119-158`, Positions `:159-171`, Limits `:172-182`): the Contract table lists the `XmlSchema` members (`Array`, `optionalKey`, `fromString`, `ElementFromString`, `decodeSchema`, `decodeSchemaString`, `equivalence`, `decodeErrorOf`, `DecodeError`/`EncodeError`, `Tokenizer`, and the declaring members), with no flat name; one short paragraph says the tokenizer is `effect/encoding/Xml` by default, can be replaced with `Effect.provideService(XmlSchema.Tokenizer, impl)` or `Layer.succeed`, and that a tokenizer declaring `positions: "native"` supplies positions instead of the scan (the cost note in Positions applies to the default); one paragraph beside the `errors` block explains that a whole-document decode fails with `Schema.SchemaError` and that `XmlSchema.decodeErrorOf` recovers the positioned `XmlSchema.DecodeError` whose `reason` `Effect.catchReason("XmlDecodeError", ...)` selects; the contract bullets say `mixed` text runs are `"#text"` items, an attribute key that equals a content or slot key is refused at definition time, and a record path step is a Clark name or `"*"` checked when the channel is built; Round trip describes `XmlSchema.equivalence` and `ElementFromString` (the exclusion list stays); the Positions table names `fromString` (on by default) and `decodeSchema`/`decodeSchemaString` (`positions: true`); Limits says the whole-document decode takes all four limits, a limit failure is reason `Limit` (parser limits included), and an unsupported input encoding is reason `Unsupported`. State the default values (`maxTokenSize` 10 MiB, `maxDepth` 1024, `maxElementSize` 16 MiB, `maxElementNodes` 1,000,000); the constants are no longer exported.

`docs/onboarding.md`: the source map (`:56-67` at the cut) gets one row per non-test `src/` module, including `src/xml-schema.ts` (the namespace), `src/tokenizer.ts` (the tokenizer service and its default), `src/document.ts`, `src/channel.ts`, `src/equivalence.ts`, and `src/record-path.ts`; the `src/codec.ts` row (`:59`) describes the internal whole-document pipeline behind `fromString`, and the `src/canonical.ts` row (`:58`) the internal comparator behind `equivalence`. Lines 13-14 describe upstream `effect/encoding/Xml` and stay.

Checks, run as written from the repository root: (1) this prints `0` (`35` on `10709ad`):

```text
grep -oE '`(decodeString|encodeString|decodeTree|decode|canonicalize|normalizedNames|defaultMaxElementSize|defaultMaxElementNodes|many|optional|XmlDecodeError|XmlEncodeError|ResolvedElement)`|(^|[^.A-Za-z])(decodeString|encodeString|decodeTree|canonicalize|normalizedNames|many|optional)\(' README.md | wc -l | tr -d ' '
```

(2) `grep -c 'decodeErrorOf' README.md` prints at least `2` (code and prose); (3) the `ena-31` script prints `same` three times; (4) this prints at least `1` beside every module:

```text
for f in $(ls src/*.ts | grep -v '\.test\.ts$'); do printf '%-16s %s\n' "$(basename "$f")" "$(grep -c "^| \`src/$(basename "$f")\`" docs/onboarding.md)"; done
```

(5) `bun x vp fmt --check README.md docs/onboarding.md` exits 0. red_first is `no`: documentation.

Rules: R-readme, R-check, R-commit (`docs:`). Run the `consequences` lens before landing (the README is the public promise). Check: the five checks above.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### ena-tidy: Tidy the effect-native-api change

- write_scope: `src/canonical.ts`, `src/canonical.test.ts`, `src/channel.ts`, `src/channel.test.ts`, `src/codec.ts`, `src/codec.test.ts`, `src/compile.ts`, `src/compile.test.ts`, `src/document.ts`, `src/document.test.ts`, `src/dsl.ts`, `src/dsl.test.ts`, `src/element.ts`, `src/element.test.ts`, `src/equivalence.ts`, `src/equivalence.test.ts`, `src/index.ts`, `src/issue.ts`, `src/issue.test.ts`, `src/plan.ts`, `src/plan.test.ts`, `src/positions.ts`, `src/record-path.ts`, `src/record-path.test.ts`, `src/resolve.ts`, `src/tokenizer.ts`, `src/tokenizer.test.ts`, `src/xml-schema.ts`, `src/positions.test.ts`, `test/tokenizer/fakes.ts`, `test/tokenizer/conformance.ts`, `test/tokenizer/default.test.ts`, `test/tokenizer/override.test.ts`, `test/tokenizer/native.test.ts`, `test/combinators.test.ts`, `test/namespace.test.ts`, `test/services.test.ts`, `test/upstream-xml.test.ts`, `test/readme.test.ts`, `test/qti/errors.test.ts`, `test/qti/mixed.test.ts`, `test/qti/open.test.ts`, `test/qti/vocabulary.test.ts`, `test/qti/vocabulary.ts`, `test/streaming/decode.test.ts`, `test/streaming/positions.test.ts`, `test/streaming/vocabulary.ts`, `README.md`, `docs/onboarding.md`, new files under `src/` and `test/`
- deps: ena-1, ena-2, ena-3, ena-4, ena-5, ena-6, ena-7, ena-8, ena-9, ena-10, ena-11, ena-12, ena-13, ena-14, ena-15, ena-16, ena-17, ena-18, ena-19, ena-20, ena-21, ena-22, ena-23, ena-24, ena-25, ena-26, ena-27, ena-28, ena-29, ena-30, ena-31, ena-32, ena-33, ena-34, ena-35, ena-36, ena-37, ena-38, ena-39, ena-40, ena-41, ena-docs
- red_first: no
- status: pending

Apply the cleanliness lens to the files this goal changed, with no behaviour change: the position-attach helper copied into `src/channel.ts` (`ena-14`) is the only copy left after `ena-33`, and the UTF-8 channel (`ena-17`) reads beside it; `parserError` is the one upstream-error mapping (no leftover `wellFormedness`); `src/xml-schema.ts` re-exports each member once; test fixtures and tracer helpers duplicated between `src/codec.test.ts`, `src/channel.test.ts`, and `src/document.test.ts` may move into one test-helper file under `src/` or `test/` imported by all three, only if no assertion changes; extract a helper into a new kebab-case file only when a function has grown past easy reading, and `src/xml-schema.ts` then re-exports nothing new. You may restructure tests without changing what they assert; add none. The bug-9 oracle over every non-test `src/*.ts` prints `0 0 0` on every line (`<files>` = `$(ls src/*.ts | grep -v '\.test\.ts$')`). The R9 oracle prints nothing. The `ena-31` README script still prints `same` three times. The existing tests covering the scope pass unchanged. A behaviour change found while tidying is reported as a follow-up and not made. If nothing needs changing, report "no changes".

Rules: R-doc, R-native, R-batch, R-files, R-check, R-commit (`refactor:`). Check: one `bun x vp test <file>` per test file you touch, chained with `&&`, plus `bun x vp check` over the files you touch and the oracle above. Do not run `bun run check`/`build`/`test`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Notes

- Coverage: nothing is already delivered on `10709ad`. Bugs: 1 `ena-19`; 2 `ena-5` (rule) + `ena-14` (factory and regression, subsumed by R3); 3 `ena-2` (carrier) + `ena-12`/`ena-14`/`ena-16` (entry points) + `ena-21` (`element`/`suspend`, regression), subsumed by R1+O8; 4 `ena-1` (whole document and legacy stream) with the stream cases carried into `ena-14`/`ena-17`; 5 `ena-18`; 6 `ena-8` (subsumed by R1); 7 `ena-3` + `ena-10` + `ena-22`; 8 `ena-15`; 9 `ena-6`, `ena-11`, `ena-32`, `ena-33`. R1 `ena-2` + `ena-8`; R2 `ena-16`; R3 `ena-14` + `ena-17`; R4 `ena-20` + `ena-23`..`ena-31` + `ena-33`; R5 `ena-7` (+ O10 `ena-13`); R6 `ena-12` (document) + `ena-14` (stream) + `ena-16` (pass-through); R7 `ena-9`; R8 `ena-12` (limits, `| undefined`, `EncodeOptions`) + `ena-33` (defaults unexported). The `data-*` message gap: `ena-4`. Docs: `ena-31` + `ena-docs`. Review section 5 (keep) is honoured: no slice touches option bags into `Layer`s, the `TaggedError`+`reason` pattern, `suspend`'s name argument, `ResolvedElement`'s shape, `namespaces`, the spec bag, `mixed`'s name, Clark path steps, stored messages, closed attributes under `open`, encode layout, or spans.
- R9 coverage: (a) service `ena-34`; (b) routing `ena-12` (`readRoot`), `ena-16` (`encodeTree`), `ena-35` (`decodeStringWithPositions`), `ena-14`/`ena-17` (channels born routed), `ena-33` (legacy calls deleted), measured by the R9 oracle; (c) conformance `ena-38` (upstream contract) + `ena-39` (library round trip, error paths, native check) run by `test/tokenizer/default.test.ts`; (d) override `ena-40`, with the `R = never` type checks; (e) native-position preference `ena-36` (document) + `ena-37` (channels), witnessed with the native fakes in `ena-41`. R9 lands before R4's flip (`ena-33` depends on `ena-36`), and the namespace (`ena-20`) exports `Tokenizer`.
- Stated defaults for Mind (each brief records its own): (a) R6, `ena-12`: under `errors: "all"` one positioned `DecodeError` describes the first issue; all issues stay in `reason.cause`. (b) R5, `ena-7`: decode reason `SchemaFailure` (the review's own example); encode reason `EncodeSchemaFailure` (the review names no encode spelling; one class per tag requires one). (c) O9, `ena-1`: `Limit.measured` is optional as well as `element`, because upstream reports no measured count; `max` is parsed from upstream's message, pinned by a canary in `test/upstream-xml.test.ts`. (d) `ena-14`: channel spans are `xml.decodeSchemaString` / `xml.decodeSchema`, replacing `xml.decode`. (e) `ena-16`: `decodeErrorOf` returns `Option` (R-effect: an absent result is `Option`), so the README pattern keeps the `SchemaError` on `None`. (f) Bug 2: an invalid record path throws a plain `Error` at the factory call, as `Xml.elements` does; `DefinitionError` stays the definition-time error. (g) Bug 7 spelling rules are `ena-3`'s six rules, including `local (no namespace)` for a no-namespace element under a default namespace. (h) R9, `ena-34`: "no direct `Xml.*` calls" means no tokenizer-channel call outside `src/tokenizer.ts`; `Xml.XmlError`, `Xml.isXmlError`, and the event types stay the shared model. (i) R9: a tokenizer is asked for native positions with `positions: true` in `TokenizerDecodeOptions`; non-start events carry the last start-tag position; `defaultTokenizer` stays internal. (j) R9: the conformance suite copies the tokenizer-generic expectations of `test/upstream-xml.test.ts`, which stays the upstream canary.
- Gaps for Mind, not blocking: there is no `encodeErrorOf`; an encode failure through `Schema.encode*(fromString(...))` still stores its `EncodeError` under the issue's `xml` annotation, and O1 names only the decode extractor. The namespace does not export the phantom `XmlElement` or the inference helpers (`AttributesType`, `ContentType`, `ChildType`, `ChildrenType`, `IsOptional`, `Services`) that appear in public signatures; the gate build (`vp pack` declarations) decides whether consumers need them named.
- Bug 9 reading: the fix direction says "move the native-review rationale to `docs/`". `docs/rd/effect-native-api-review.md` section 2 already records, per export, the Effect analogue checked; so a paragraph whose rationale is there is dropped, and one that adds something becomes a `// Native:` line comment, which declaration emit does not publish. No slice writes a new docs file for it, which keeps the four bug-9 slices free of a shared file.
- Width choices: new modules (`src/tokenizer.ts`, `src/record-path.ts`, `src/channel.ts`, `src/document.ts`, `src/equivalence.ts`, `src/xml-schema.ts`, and the cross-module tests `test/combinators.test.ts`, `test/services.test.ts`, `test/namespace.test.ts`) keep R2, R3, R4, R7, and the bug-2 rule off the hot files. Same-file work is chained: `src/issue.ts` `ena-1, ena-7, ena-15, ena-22, ena-32`; `src/issue.test.ts` `ena-1, ena-7, ena-15, ena-18, ena-22`; `src/codec.ts` `ena-1, ena-7, ena-12, ena-16, ena-36, ena-33`; `src/positions.ts` `ena-6, ena-35`; `test/tokenizer/conformance.ts` `ena-38, ena-39`; `src/plan.ts` `ena-2, ena-8, ena-13, ena-19, ena-32`; `src/dsl.ts` `ena-2, ena-13, ena-18, ena-21, ena-32`; `src/compile.ts` `ena-4, ena-10, ena-18, ena-32`; `src/channel.ts` `ena-14, ena-17, ena-37`; `src/index.ts` `ena-7, ena-20, ena-33`; `README.md` `ena-31, ena-docs`. No two slices without a `deps` path between them share a file.
- Why `ena-1` touches `src/codec.ts`: making `Limit.element` optional breaks `attachPosition`'s `parseClark(reason.element)` (`src/codec.ts:99`) under the program-wide type check, so the routing and its consumer land together.
- Why `ena-2` touches `src/dsl.ts`: widening `Mixed`'s constraint makes `ContentType`'s inferred `M` fail `MixedItem`'s narrower constraint (`src/dsl.ts:89-91`, `:115-116`), so the inference types widen in the same slice; threading services into `element`'s return type stays in `ena-21`.
- Risk (program-wide type check): `ena-2`, `ena-7`, and `ena-18` change shared types; their write scopes come from the commands in their briefs and from reading the consumers, but the type checker is the oracle. A `blocked-scope` from one of them names the file to add; re-cut by `ena-2.1`-style rework.
- The gate seat owns `bun run check`, `bun run build`, `bun run test`, and the gate audit against `GOAL.md` and the review; no slice runs them. Review lenses run at review: `correctness` on `ena-1`, `ena-14`, `ena-16`, `ena-19`; `consequences` on `ena-20`, `ena-33`, `ena-docs`; `cleanliness` at `ena-tidy`; `poker-face` at goal close.
- Commands in the briefs were run on `10709ad` as written: the bug-9 oracle per file (values in Standing rules; 20 native paragraphs in total, one more than the review's 19 because its grep missed `Native check:` at `src/issue.ts:178`), the R5 and bug-5 inventories (outputs pasted in `ena-7` and `ena-18`), the `ena-12` option oracle (5 lines), the `ena-31` README script (`DIFF` three times), and the `ena-docs` README count (`35`) and source-map loop (`1` beside each of the ten modules).

## Cut 2 (Mind ruling, 2026-11-05)

### ena-34b: R9 fix: rename the tokenizer interface `TokenizerShape` to `Tokenizer`

- write_scope: `src/tokenizer.ts`, `src/tokenizer.test.ts`
- deps: `ena-34`
- red_first: no (a rename; the oracle below is the failing-first check)
- status: pending

`ena-34` (`1fe3dd9`) named the interface `TokenizerShape` and suppressed `anti-slop/no-shape-in-symbol-names` three times. Rename the interface to `Tokenizer`, so the interface and the `Context.Reference` share one name, as `node_modules/effect/src/Clock.ts:53` (`export interface Clock`) and `:192` (`export const Clock: Context.Reference<Clock>`) do. Use the declaration-merged form: `export interface Tokenizer { ... }` and `export const Tokenizer: Context.Reference<Tokenizer> = Context.Reference<Tokenizer>(...)`. Delete the three `oxlint-disable-next-line anti-slop/no-shape-in-symbol-names` lines and any other identifier containing "shape" in the two files. Behaviour, the key `"@aidenzepp/effect-xml/Tokenizer"`, the default, and every test case stay as they are; the test may type values as `Tokenizer` now.

Oracle: `grep -ci shape src/tokenizer.ts src/tokenizer.test.ts` prints `src/tokenizer.ts:3` (or more) before and `src/tokenizer.ts:0` and `src/tokenizer.test.ts:0` after.

Every later slice that names `TokenizerShape` reads `Tokenizer` (the Cut 1 briefs are corrected in place); `ena-12`, `ena-14`, `ena-35`, `ena-38`, `ena-20`, `ena-docs`, and `ena-tidy` also depend on `ena-34b`.

Rules: R-effect, R-doc, R-check, R-commit (`refactor(tokenizer):`), R-scope. Check: `grep -ci shape src/tokenizer.ts src/tokenizer.test.ts` prints 0 for both files, then `bun x vp test src/tokenizer.test.ts && bun x vp check src/tokenizer.ts src/tokenizer.test.ts`.

### ena-42: Fix: a namespace-rule `WellFormedness` failure carries its start-tag position

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: `ena-36`
- red_first: yes
- status: pending

Found by `ena-36` (`e33eabf`). Under a native-position tokenizer the library never calls `locate`, so every failure must be positioned from the events. In `src/resolve.ts`, `undeclared()` stamps the offending start tag's position on its `UndeclaredPrefix` failure, but `illegal()` (the namespace-rule `WellFormedness` failure: a reserved prefix or namespace binding misuse) does not, and that element never reaches the position tree, so the failure has no `position`. Make `illegal()` carry the same stamp `undeclared()` does, read from the start-tag event when it carries a position (the events from `nativePositions()` and from the positioned scan both do). Red first: in `src/resolve.test.ts`, feed `resolveEvents` a positioned event sequence whose start tag binds `xmlns:xml` to a wrong URI (or another case `illegal()` reports) and assert the failure's position equals that start tag's `{ line, column }`; it is absent before the fix. Keep every existing case passing; unpositioned event sequences stay unpositioned.

Rules: R-effect, R-guide, R-doc, R-test, R-check, R-errors, R-commit (`fix(resolve):`), R-scope. Check: `bun x vp test src/resolve.test.ts && bun x vp check src/resolve.ts src/resolve.test.ts`.

### ena-43: Fix: unmatched `mixed` children and members are spelled with each member definition's own prefixes

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: `ena-22`, `ena-25`
- red_first: yes
- status: pending

Found by `ena-22` (`77ce9ef`) and `ena-25` (`c358732`). `unmatched` in `src/issue.ts` spells every `mixed` member (and the found child against them) with the **parent** plan's prefixes. A member defined under its own `namespaces({...})` map whose namespace the parent's map does not bind prints as a Clark name: `test/qti/errors.test.ts` "positions an unknown element at its own start tag" now reads `declared members: br, qti-text-entry-interaction, {http://www.w3.org/1998/Math/MathML}math`, where it must read `math` (the MathML definition binds its namespace as the default). Spell each member with that member's own plan prefixes (the member's `planOf`/marker carries them), keeping the namespace-contrast rule from `ena-22`: when the found child and a member differ only by namespace, both namespaces show. The found child is spelled in the parent's prefixes, as now.

Red first: in `src/issue.test.ts`, a `mixed` parent under one namespace map holding a member defined under a different map (default namespace bound to another URI); an unknown child's message must list that member by its authored local name with no `{` in the member list. Then run `test/qti/errors.test.ts`; its 9 tests must all pass with no assertion changed.

Rules: R-effect, R-guide, R-doc, R-test, R-check, R-errors, R-commit (`fix(issue):`), R-scope. Check: `bun x vp test src/issue.test.ts && bun x vp test test/qti/errors.test.ts && bun x vp check src/issue.ts src/issue.test.ts`.

## Cut 3 (gate audit `07fc751e` findings, 2026-11-05)

### ena-44: Audit fixes: record-path step names, published doc prose, stale comment

- write_scope: `src/record-path.ts`, `src/record-path.test.ts`, `src/dsl.ts`, `src/codec.ts`, `src/plan.ts`, `src/channel.ts`, `src/document.ts`, `src/equivalence.ts`, `src/tokenizer.ts`, `src/xml-schema.ts`
- deps: `ena-tidy`
- red_first: yes (for the record-path part)
- status: pending

1. Bug 2 (audit P3-5): `checkRecordPath` (`src/record-path.ts:12`) accepts a step whose local part is not an XML Name (for example `item>` or `1item`), which still yields a silent empty stream. Reject a step unless it is `"*"` or a Clark name whose local part matches the XML `Name` production without `:` (NCName: a `NameStartChar` then `NameChar`s; use the ASCII-plus-Unicode-letter approximation `/^[\p{L}_][\p{L}\p{N}._\-·]*$/u` unless a stricter shared helper exists in `src/element.ts`), and whose `{uri}` part, when present, is non-empty. Red first: add `["bank","item>"]` and `["bank","1item"]` to the rejected cases in `src/record-path.test.ts`; they pass through before the fix.
2. Bug 9 (audit P3-1): published JSDoc prose names internals: `compile` (`src/dsl.ts:192`), `lower` and `Result.getOrThrow` (`src/dsl.ts:233`), "the default of `collect`" (`src/codec.ts:98`), `ResolvedElement` (`src/plan.ts:255`; the public name is `XmlSchema.Element`). Restate each in caller terms (behaviour, not internal function names). Grep the other write_scope files for the same pattern and fix any you find.
3. Bug 9 (audit P3-2): a stray `;` follows the closing fence of six `@example` blocks: `src/channel.ts:390`, `src/document.ts:77` and `:164`, `src/equivalence.ts:27`, `src/tokenizer.ts:131`, `src/xml-schema.ts:22`. Remove them.
4. Audit P3-3: the `readRoot` comment in `src/codec.ts` (~150-156) says a namespace-rule `WellFormedness` failure has no position under a native tokenizer; `ena-42` (`39dd658`) fixed that. Make the comment state the current invariant.

Rules: R-effect, R-doc, R-test, R-check, R-errors, R-commit (`fix(record-path):` for the code change; one commit is fine), R-scope. Check: `bun x vp test src/record-path.test.ts && bun x vp test src/channel.test.ts && bun x vp test src/codec.test.ts && bun x vp check <the write_scope files>`, and `grep -n '^ \* ```;' src/*.ts` prints nothing.

## Cut 4 (owner rulings, `work/owner-directive-api-followups.md`, 2026-11-05)

Order: `enf-1` and `enf-2` in parallel, then `enf-3`, then `enf-docs`. Standing rules above apply.

### enf-1: `encodeErrorOf`, the encode mirror of `decodeErrorOf`

- write_scope: `src/document.ts`, `src/document.test.ts`
- deps: none
- red_first: yes
- status: pending

`src/document.ts` stores both directions' library errors on `InvalidValue` issues through `carrying(error)` (`:33`), but only `decodeErrorOf` reads them back, so an encode failure through `fromString` or `ElementFromString` (`:103`, `:142`) has no public route to its `XmlEncodeError`. Add `encodeErrorOf(issue): Option.Option<XmlEncodeError>` beside `decodeErrorOf`, walking the issue tree the same way and returning the stored error only when it is an `XmlEncodeError` (and `decodeErrorOf` keeps returning only decode errors). Public JSDoc with an example in the style of `decodeErrorOf` (unfenced `@example`, see the ena-44 note). Red first, in `src/document.test.ts`: encode a value through `Schema.encodeEffect(fromString(Root))` that the library rejects (for example a value whose element codec's encode fails with reason `EncodeSchemaFailure`), and assert `encodeErrorOf(error.issue)` is `Some` with `_tag` `"XmlEncodeError"` and the expected `reason._tag` and `path`; assert `decodeErrorOf` of the same issue is `None` and `encodeErrorOf` of a decode failure's issue is `None`. Do not export it from `src/xml-schema.ts` (`enf-2` owns that file).

Rules: R-effect, R-guide, R-doc, R-test, R-check, R-commit (`feat(document):`), R-scope. Check: `bun x vp test src/document.test.ts && bun x vp check src/document.ts src/document.test.ts`.

### enf-2: Nest the `element()` helper types in a declaration-merged namespace

- write_scope: `src/dsl.ts`, `src/dsl.test.ts`, `src/xml-schema.ts`, `test/namespace.test.ts`
- deps: none
- red_first: yes (type-level)
- status: pending

`src/xml-schema.ts:25-33` exports seven flat helper types from `src/dsl.ts`: `AttributesType`, `ChildType`, `ChildrenType`, `ContentType`, `IsOptional`, `Services`, `SlotServices`. Follow `node_modules/effect/src/Schema.ts:3356` (`export declare namespace Struct { type Fields ... }`), `:3492` and `:3597`: declare `export declare namespace element { ... }` in `src/dsl.ts`, merged with the `element` function, and move the seven types into it under names that read naturally there. Use: `element.Attributes<A>` (was `AttributesType`), `element.Content<C>` (was `ContentType`), `element.Services<A, C, K>` (was `Services`), `element.Child<S>` (was `ChildType`), `element.Children<...>` (was `ChildrenType`), `element.SlotServices<...>` (was `SlotServices`), `element.IsOptional<S>` (was `IsOptional`); keep a name if the namespace already makes it read naturally and say so in the report. `element()`'s signature and every internal use reference the nested names. Remove the seven flat exports from `src/xml-schema.ts`; the namespace re-export of `element` carries the merged types, so `XmlSchema.element.Attributes<...>` resolves. Do not add `encodeErrorOf` here (`enf-3` exports it). Red first (type-level, in `src/dsl.test.ts`): `expectTypeOf<XmlSchema.element.Attributes<...>>()` and one other nested name compile only after the move; a `@ts-expect-error` on a flat `XmlSchema.AttributesType` reference. Lint: the merged `namespace`+`function` pair may trip `no-redeclare` (as `src/tokenizer.ts` and `src/document.ts` did); use the same one-line justified suppression, citing `Schema.ts:3356`.

Rules: R-doc, R-test, R-check, R-commit (`refactor(dsl)!:`), R-scope. Check: `bun x vp test src/dsl.test.ts && bun x vp test test/namespace.test.ts && bun x vp check src/dsl.ts src/dsl.test.ts src/xml-schema.ts test/namespace.test.ts`, and `grep -nE 'AttributesType|ContentType|ChildType|ChildrenType' src/xml-schema.ts` prints nothing.

### enf-3: Reserved content keys `$text` and `$children`; mixed text runs tagged `"$text"`; drop the O7 rejection for them

- write_scope: every file under `src/` and `test/` that the change needs (find them with `grep -rnE '"#text"|\btext:|\.text\b|\bchildren\b|contentKeys' src test`), excluding `README.md`, `docs/`, `test/readme.test.ts` (owned by `enf-docs`)
- deps: `enf-1`, `enf-2`
- red_first: yes
- status: pending

Today the decoded value of `text(...)` content is `{ text: ... }` and of `mixed(...)` content is `{ children: [...] }`, in the same key space as attribute keys, which is why `ena-19` (`0bbd2dd`) rejects an attribute keyed `text` or `children` (O7). `$` is not an XML NameChar, so `$text`/`$children` can never equal an attribute name. Change:

1. The decoded and encoded key of text content becomes `$text`; of mixed content, `$children` (`src/compile.ts` struct construction, `src/dsl.ts` types, any `src/issue.ts` path translation that maps these keys, `src/plan.ts` content keys).
2. The `mixed` text-run item's tag becomes `"$text"` (replacing `"#text"` from `ena-18`; `src/compile.ts` `TextItem`, `src/dsl.ts` `MixedItem`). The item's own field stays `text` (no collision is possible inside an item); say so in its doc comment.
3. In `src/plan.ts`, remove the definition-time rejection for an attribute keyed `text` or `children` (now impossible to collide); keep rejecting an attribute key equal to an `elements` slot key or `"*"` under open elements. Update the `lower` JSDoc.
4. Update every test fixture and assertion that reads `.text`, `.children`, `"#text"` on decoded values, and the type-level pins.
5. Export `encodeErrorOf` (added by `enf-1` in `src/document.ts`) from `src/xml-schema.ts` and add it to `test/namespace.test.ts`'s key list.
   Red first: in `src/compile.test.ts` (or `src/plan.test.ts` for item 3), `element("p", { attributes: { text: Schema.String }, content: text(Schema.String) })` defines without throwing and `<p text="ATTR">BODY</p>` decodes to `{ text: "ATTR", $text: "BODY" }` and encodes back; and the mixed member named `text` decodes to items tagged `"$text"` and `"text"`. These fail before the change. Then the full suite must pass file by file; a 'test count' drop is a failure.

Rules: R-effect, R-guide, R-batch, R-doc, R-test, R-check, R-errors, R-commit (`feat(compile)!:` with a BREAKING CHANGE footer), R-scope. Check: `bun x vp check` on every file you changed, and `bun x vp test <file>` for every test file you changed plus `src/compile.test.ts src/plan.test.ts src/dsl.test.ts src/issue.test.ts test/qti/mixed.test.ts test/qti/open.test.ts test/qti/vocabulary.test.ts test/combinators.test.ts` one at a time; report each count.

### enf-docs: README and onboarding for `encodeErrorOf`, nested types, and `$text`/`$children`

- write_scope: `README.md`, `test/readme.test.ts`, `docs/onboarding.md`
- deps: `enf-1`, `enf-2`, `enf-3`, `enf-4`, `enf-5`
- red_first: no
- status: pending

1. README Contract row for `DecodeError`/`EncodeError` (`:121`) is true only with `encodeErrorOf`: add a row for `encodeErrorOf` and a short encode-failure example region in `test/readme.test.ts` mirrored verbatim into a README `ts` block (`Schema.encodeEffect(Document)` failing, `Effect.catchTag("SchemaError", ...)` through `XmlSchema.encodeErrorOf`, then `Effect.catchReason("XmlEncodeError", "EncodeSchemaFailure", ...)`). Keep the existing three regions byte-identical to their README blocks (the ena-31 script).
2. Every README and onboarding mention of decoded `text`/`children` keys and the `"#text"` tag becomes `$text`/`$children`/`"$text"`; drop the attribute/content key-clash bullet (now impossible), keep the slot-key clash.
3. Apply `enf-4`'s renames everywhere: `XmlSchema.Element(...)` constructor (and the bound `Element` from `namespaces`), `XmlSchema.ResolvedElement`, helper types under `XmlSchema.Element.*` (one line in Contract), `Element<...>` replacing `ElementCodec`. Update every README `ts` block and its `test/readme.test.ts` region together.
4. onboarding Decisions: D5/O6/O7 summaries reflect the `$` keys.

Rules: R-readme, R-test, R-check, R-commit (`docs:`), R-scope. Check: `bun x vp test test/readme.test.ts && bun x vp check test/readme.test.ts && bun x vp fmt --check README.md docs/onboarding.md`, the ena-31 region script prints `same` for every region, and `grep -nE '"#text"|\.children\b' README.md docs/onboarding.md` prints nothing.

### enf-4: Effect casing: `Element()` constructor, `ResolvedElement`, interfaces named for their constructors, `Struct`-style namespace vocabulary

- write_scope: every file under `src/` and `test/` the rename needs (find them with `grep -rnE '\belement\(|ElementCodec|\bText\b|\bElements\b|\bMixed\b|\bMany\b|\bOptional\b|XmlSchema\.Element\b|element\.(Attributes|Content|Services|Child|Children|SlotServices|IsOptional)|\bAttributes\b|\bContent\b' src test`), excluding `README.md`, `docs/`, `test/readme.test.ts` (owned by `enf-docs`)
- deps: `enf-3`
- red_first: yes (type-level)
- status: pending

Owner addendum (`work/owner-directive-api-followups.md`, "Addendum") and review section 8 with its hater triage. Changes:

1. `element(name, spec)` becomes `Element(name, spec)`; the bound builder `Namespaces.element` becomes `Namespaces.Element`. `suspend` keeps its name and casing.
2. The resolved-tree type exported as `XmlSchema.Element` goes back to `XmlSchema.ResolvedElement`.
3. `ElementCodec<Name, T, RD, RE>` becomes `interface Element<Name, T, RD, RE>`, declaration-merged with the `Element` function and its namespace (`node_modules/effect/src/Schema.ts:3356`, `:3492`, `:3597`). `ElementCodec` is not exported any more.
4. The spec types take their constructors' names, as `Schema.ts:2358`/`:2406` do: `Text` becomes `text`, `Elements` becomes `elements`, `Mixed` becomes `mixed`, `Optional` becomes `optionalKey`, and `Many` becomes `Array` (declare it internally under another name, such as `$Array`, and export it `as Array`, as `Schema.ts:4654`/`:4698` does, so it does not shadow the global `Array` inside the module). `Empty` stays.
5. The `Element` namespace uses `Struct` vocabulary (`Schema.ts:3363`, `:3450`, `:3460`). The constraints move in: the top-level `Attributes` and `Content` types become `Element.Attributes` and `Element.Content`, with no top-level duplicates. The derived types take a `Type` suffix: `Element.AttributesType<A>` and `Element.ContentType<C>` (from `enf-2`'s `Element.Attributes<A>` and `Element.Content<C>`). Services split by direction: `Element.DecodingServices<A, C>` and `Element.EncodingServices<A, C>` replace `Element.Services<A, C, K>`, and `SlotServices` splits the same way. `Child`, `Children` and `IsOptional` keep their names.
6. Update `src/xml-schema.ts`, `test/namespace.test.ts` and every internal and test use. Behaviour does not change.

Red first (type-level, in `src/dsl.test.ts` or `test/namespace.test.ts`): `XmlSchema.Element("p", { content: XmlSchema.text(Schema.String) })` is assignable to `XmlSchema.Element<"p", { $text: string }>`; `XmlSchema.ResolvedElement` resolves; `XmlSchema.Element.DecodingServices<...>` resolves; and a `@ts-expect-error` on `XmlSchema.element` and on `XmlSchema.ElementCodec`. These fail before the change. Then every test file you touch must pass with its earlier count.

Rules: R-doc, R-test, R-check, R-commit (`refactor!:` with a BREAKING CHANGE footer), R-scope. Check: `bun x vp check` on every changed file, and `bun x vp test` on every changed test file, run one at a time, with each count reported; `grep -rnE '\bElementCodec\b|XmlSchema\.element\b|\.element\(' src test` prints nothing (except prose that names the old API on purpose, which you must justify).

### enf-5: Validate element and attribute names when a definition is declared

- write_scope: `src/element.ts`, `src/element.test.ts`, `src/plan.ts`, `src/plan.test.ts`, `src/record-path.ts`, `src/record-path.test.ts`
- deps: `enf-4`
- red_first: yes
- status: pending

Found by `enf-3` (`17b187e`). The `$text`/`$children` guarantee rests on "`$` is not an XML NameChar", but `qname` in `src/plan.ts` accepts any characters in authored element and attribute names, so `Element("$text", ...)` or an attribute keyed `$text` is accepted at definition time (`enf-3` keeps a reserved-key rejection for the attribute case only). Validate names at definition time instead:

1. Add one shared check in `src/element.ts` for an XML QName in the authored form (`prefix:local` or `local`, each an NCName: a `NameStartChar` then `NameChar`s, without `:`), using the same character class `ena-44` (`790fa34`) put in `src/record-path.ts`; make `src/record-path.ts` use the shared check so there is one definition.
2. `lower` in `src/plan.ts` returns a `DefinitionError` when an element name, a mixed member's name, or an attribute key (other than the `data-*` group) is not a valid QName, naming the definition and the offending name, with a repair. `"*"` stays a reserved non-name for the generic member and slot.
3. With names validated, an attribute keyed `$text` or `$children` is rejected as an invalid name, so remove `enf-3`'s separate reserved-key rejection (or keep it as the same error, whichever leaves one rule); update the `lower` JSDoc.
   Red first: `src/plan.test.ts` cases where `Element("$text", ...)`, a mixed member named `"$text"`, an attribute keyed `"a b"`, and an attribute keyed `"1x"` all define today, but must fail with `DefinitionError`; and `xml:lang`, `xsi:schemaLocation`, `data-*`, and non-ASCII letter names still define.

Rules: R-effect, R-doc, R-test, R-check, R-errors, R-commit (`fix(plan):`), R-scope. Check: `bun x vp test src/element.test.ts && bun x vp test src/plan.test.ts && bun x vp test src/record-path.test.ts && bun x vp check src/element.ts src/element.test.ts src/plan.ts src/plan.test.ts src/record-path.ts src/record-path.test.ts`.

### enf-6: `suspend` validates its name at declaration; `Element` `@throws` doc matches the rules

- write_scope: `src/dsl.ts`, `src/dsl.test.ts`
- deps: `enf-5`
- red_first: yes
- status: pending

Found by `enf-5` (`63de359`). `suspend(name, thunk)` in `src/dsl.ts` expands its name through `qname`, not `lower`, so `suspend("$text", ...)` is accepted at declaration even though `Element("$text", ...)` is now refused. Make `suspend` (and the bound `Namespaces.suspend`) throw the same `DefinitionError` for a name that is not an XML QName, using the shared `isQName` from `src/element.ts`. Update the `Element` JSDoc `@throws` (and `suspend`'s) to state the current rules: an element name, mixed member name, or attribute key that is not an XML qualified name, and an attribute key equal to an `elements` slot key; drop the stale `$text`/`$children`/`"*"` clash wording. Red first in `src/dsl.test.ts`: `suspend("$text", () => P)` and `suspend("a b", ...)` throw `DefinitionError`; `suspend("q:item", ...)` under a prefix map binding `q` still defines.

Rules: R-effect, R-doc, R-test, R-check, R-errors, R-commit (`fix(dsl):`), R-scope. Check: `bun x vp test src/dsl.test.ts && bun x vp check src/dsl.ts src/dsl.test.ts`.

### enf-7: The XML name check follows XML 1.0 §2.3 exactly (audit `36750066` P2-1, P3s)

- write_scope: `src/element.ts`, `src/element.test.ts`, `src/plan.ts`, `src/plan.test.ts`, `src/dsl.ts`, `src/dsl.test.ts`, `src/record-path.test.ts`
- deps: `enf-6`
- red_first: yes
- status: pending

`isNCName` in `src/element.ts` (`:87`, `/^[\p{L}_][\p{L}\p{N}._\-·]*$/u`) does not match the XML 1.0 (Fifth Edition) §2.3 productions. It refuses legal names: `"हिन्दी"` (combining marks), NFD `"café"` (U+0301), `"a‿b"` (U+203F), and `"Ⅻ"` (U+216B in U+2070–218F). These all declared, decoded and round-tripped at `790fa34`, so this is a regression from `enf-5`. It also accepts the illegal `"a²"` (U+00B2). Fix:

1. Implement `NameStartChar` and `NameChar` from §2.3 exactly, minus `:` for NCName:
   - `NameStartChar ::= ":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]`
   - `NameChar ::= NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]`

   Use a `u`-flag regex built from those ranges. `isQName` is `NCName (":" NCName)?`. `src/record-path.ts` already calls the shared check; add the same cases to `src/record-path.test.ts`.

2. P3: export the name-rule sentence once (from `src/element.ts`, or wherever both callers can import it without an `import/no-cycle` error), and use it in both `src/plan.ts` (`NAME_RULE`, `:464`) and `src/dsl.ts` (`:327`).
3. P3: `lowerChild` in `src/plan.ts` checks a hand-written marker's name for `elements` slots, the same way `lowerMember` does for mixed members.
4. P3: `src/plan.test.ts:24` stops aliasing `Element` as `element`; its tests read `Element(...)`.

Red first in `src/element.test.ts`: `isQName` accepts `"हिन्दी"`, NFD `"café"`, `"a‿b"`, `"Ⅻ"`, `"xml:lang"`, `"_x"`, `"a-b.c"` and `"中文"`; it rejects `"a²"`, `"$text"`, `"*"`, `"1x"`, `"-a"`, `"a b"`, `"a:b:c"` and `""`. Also add `src/plan.test.ts` cases showing that `Element("हिन्दी", ...)` and an attribute keyed with NFD `"café"` define, decode and round-trip.

Rules: R-effect, R-doc, R-test, R-check, R-errors, R-commit (`fix(element):`), R-scope. Check: `bun x vp test src/element.test.ts && bun x vp test src/plan.test.ts && bun x vp test src/dsl.test.ts && bun x vp test src/record-path.test.ts && bun x vp check <the write_scope files>`.
