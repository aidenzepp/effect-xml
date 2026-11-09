# Slices: xml-schema-codec, milestone 3 (per-record streaming and budgets)

- plan: docs/goals/xml-schema-codec/phase-3.md (ADMITTED at `71eb95b`: audit `3b7b59ba`, revision `71eb95b`, re-review `d9710ec1` clean; units M3-U01..M3-U11)
- slice file: docs/goals/xml-schema-codec/phase-3.slices.md
- size target: 5–10 minutes
- cut against: commit `71eb95b`, `effect@4.1.2`, Node `v26.13.0`, Bun `1.4.2`; every line number below was read on that checkout
- slice count: 24 + tidy (25)
- longest chain: 11 (`m3-1, m3-2, m3-5, m3-6, m3-11, m3-12, m3-19, m3-20, m3-21, m3-22, m3-tidy`; `m3-1, m3-2, m3-5, m3-6, m3-11, m3-12, m3-13, m3-17, m3-23, m3-24, m3-tidy` is the same length)
- cross-phase preconditions: `deps` names only slices in this cut. Where a slice edits a file that milestone 1 or 2 creates, or imports a symbol one of them lands, its brief opens with a `Precondition:` line naming the M1/M2 **unit** that last writes that file or lands that symbol (`phase-1.md`, `phase-2.md`); the factory maps those units to accepted M1/M2 slices before dispatching, and dispatches no M3 slice into a file an M1 or M2 seat still holds. Everything under `test/streaming/` is new in M3 and has no file precondition.

## Standing rules (every brief below is bound by these; a brief names the ones it leans on)

- R-effect: Effect error channels only. `try`/`catch` is a lint error (`workspace/no-built-in-try-catch`, `vite.config.ts:78`; the rule targets the statement, and its own message names `Effect.try` as the replacement). Return failures with `yield*`/`Effect.fail`; inside a generator keep `if`/`??`/ternary for plain value checks (`.agents/skills/effect-design/SKILL.md` local rulings). A pure function returns `Option.Option<…>` for an absent result, never `null` or `undefined` (AGENTS.md "Schema intent"). A programming error at construction (an empty record path, a non-positive budget) is a defect, never a typed failure, mirroring upstream `checkLimit` (`node_modules/effect/src/encoding/Xml.ts:552-558`).
- R-guide: follow `node_modules/effect/AGENTS.md`: `Effect.gen` inline, `Effect.fnUntraced` for library helpers, `Effect.fn("name")` only where a span is wanted (lines 13-18, 51-56). Use `Predicate` helpers (`Predicate.isString` `Predicate.ts:749`, `isNumber` `:783`, `isUint8Array` `:1571`), never hand-written guards.
- R-native: before custom glue, name in the unit's doc comment the Effect API checked and the requirement it misses (`.agents/skills/effect-design/SKILL.md` "Native capability review"). The milestone's recurring justifications, quoted once here and cited by symbol in the briefs: (J1) `Xml.elements` collects unresolved names, drops ancestor scope, and has no node budget (`Xml.ts:1723-1789`; T4, T5); (J2) `Xml.decode` (bytes, `Utf8Input`, `Xml.ts:368`, `:1640`) and `Xml.decodeString` (text, `:334`) are keyed by input kind with no mixed-chunk form; (J3) `Stream.decodeText` takes only an `encoding` (`Stream.ts:16877-16897`) and `Channel.decodeText` (`Channel.ts:9214-9238`) accepts byte chunks only and decodes inside `Effect.sync`/`Effect.map`, so a fatal `TextDecoder` there would throw into a defect; (J4) upstream events carry no position and `Xml.elements` keeps none (`phase-2.md` standing justification). Import only public symbols or `effect/encoding/Xml`.
- R-doc: multiline JSDoc (`/**` on its own line) on every module-scope function, type, interface, class, and `const`, with `@param`/`@returns` on functions (`.agents/skills/document-code/SKILL.md`; `vite.config.ts:24` enforces the multiline form). Measured facts and deferrals the plan asks for live in doc comments as present-tense invariants, never as history.
- R-files: kebab-case file names and directories (`unicorn/filename-case`, `workspace/kebab-case-paths`). Inside `src/`, relative imports with the `.ts` extension (`tsconfig.json:10`). No file under `src/` or `test/` imports from `spikes/`; the fixture is read by path: `new URL("../spikes/fixtures/qti/test-features.xml", import.meta.url)` from `src/`, `new URL("../../spikes/fixtures/qti/test-features.xml", import.meta.url)` from `test/streaming/`, with `node:fs` `readFileSync`. `test/streaming/` files import the public surface from `../../src/index.ts`, except where a brief names an internal seam (`../../src/resolve.ts` for the measurement). `src/positions.ts` imports nothing from `./issue.ts` or `./resolve.ts` (the dependency runs the other way).
- R-runtime (plan lock 10): Vitest workers run on Node (`node_modules/.bin/vp` shebang `#!/usr/bin/env node`), so `test/streaming/` helpers are runtime-neutral: file I/O through `node:fs`, never `Bun.file`/`Bun.write`; forced GC through `Bun.gc(true)` when `"Bun" in globalThis`, else `v8.setFlagsFromString("--expose-gc")` once and `vm.runInNewContext("gc")` (probed on Node v26.13.0 in the plan's baseline). Measuring tests use `it.live` (`node_modules/@effect/vitest/src/index.ts:268`) with the third-argument timeout so `Effect.timed` (`Effect.ts:9336`) reads the wall clock.
- R-test: tests are `*.test.ts` beside the module or under `test/`, import `{ describe, expect, it } from "@effect/vitest"`, and use `it.effect` for effectful cases (`test/upstream-xml.test.ts:1-25` is the model); a pure case may use plain `it`. Vitest's include is `src/**/*.test.ts`, `test/**/*.test.ts` (`vite.config.ts:91`); `test/streaming/*.ts` that are not `*.test.ts` are type-checked by the program (`tsconfig.json:13`) and never run as tests. Assert on structured values (`_tag`, `limit`, `measured`, `record`, `position`, `path`) or on a regex of a message's shape, never on full message text, except where a brief pins the lock 5 example string.
- R-check: the slice check is one `bun x vp test <file>` (exits 1 when the file is missing, so it cannot pass on nothing) or `bun x vp fmt --check <path>`. A two-filter invocation (`bun x vp test a.test.ts b.test.ts`) exits 0 when **either** file matches, so a slice whose check names two files confirms both appear in the `Test Files` summary and reports the test count. `bun run check`, `bun run build`, `bun run test` are gate-seat commands; never run them as a slice check.
- R-errors: caller-facing messages follow `.agents/skills/error-messages/SKILL.md`: what, path, constraint with the measured value, repair; neutral tone; never "invalid input". The message rule with a record ordinal is `<what> at <xpath> of record <k>: <expectation>; <repair>`, and with a position `<what> at <xpath> of record <k> (line L, column C): <expectation>; <repair>`; without `record` the M1/M2 forms are unchanged (plan lock 6).
- R-commit: one conventional commit per slice when the runner commits per slice: `feat(issue):`, `feat(resolve):`, `feat(positions):`, `feat(codec):`, `feat(index):` for library behavior, `test(streaming):` for `test/streaming/` slices, `test(upstream):` for pins, `refactor:` for the tidy slice (`.agents/skills/conventional-commits/SKILL.md`).
- R-scope (ends every brief): change only the files in `write_scope`. If the work needs any other path, change nothing and report `blocked-scope` with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

Shared vocabulary: `QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0"`, `XSI = "http://www.w3.org/2001/XMLSchema-instance"`. A **Clark name** is `{uri}local`, or `local` for no namespace; its **local part** is the text after `}`, or the whole name; `clark(namespace, local)` and `parseClark(key)` are `src/element.ts` (M1-U01). An **as-written** name or attribute is the text as it appears in the document (`p:r`, `xmlns:p`), before resolution. A **record** is one element matching the root-anchored record path (`ReadonlyArray<string>` of Clark names or `"*"`, the `Xml.elements` contract, `Xml.ts:438-460`); in tree mode the record is the root. The **budgets** (plan lock 4, binding words): "`maxElementSize` counts UTF-16 code units of the as-written input a record spans, exactly as upstream's `Collector` does (`Xml.ts:1752-1754`, `:1769`): the as-written element name, every as-written attribute key and value (`xmlns` declarations included, since upstream sees them as attributes), and every text run; same default 16 MiB (`Xml.ts:550`). Clark expansion is internal and is never counted." "`maxElementNodes` counts element starts plus text runs in one collected record; a text run is counted when a new string child is pushed, not when adjacent text is appended." Both are per record; `Infinity` disables either. **Input kind** (plan lock 1): `decode` takes "a byte stream or a text stream, never chunks of both, so the input kind is a static fact of the call site". `Position`, `ElementStep { local, index }`, `ElementPath` are `src/positions.ts` (M2-U01; zero-based element-children index, root is index 0). `PositionedEvent { event, position }` and `decodeStringWithPositions(options?)` are M2-U02 (`src/positions.ts`, unexported). The **item-ref vocabulary** every M3 test definition declares (fixture `spikes/fixtures/qti/test-features.xml` lines 26-51 on this checkout; audit `3b7b59ba` finding 1): `ItemRef` = `qti-assessment-item-ref` with attributes `identifier`, `href`, optional `category`, optional `fixed: Schema.Boolean`, optional `required: Schema.Boolean`, content `elements({ weights: many(Weight), rules: many(BranchRule) })`; `Weight` = `qti-weight` (`identifier`, `value: Schema.Finite`; empty); `BranchRule` = `qti-branch-rule` (`target`; `elements({ match: Match })`); `Match` = `qti-match` (`elements({ variable: Variable, correct: Correct })`); `Variable` = `qti-variable` and `Correct` = `qti-correct` (`identifier`; empty); all under `namespaces({ "": QTI, xsi: XSI })` with `element`, `elements`, `many`, `optional` from `src/index.ts` (M1-U04, M1-U12). On the fixture, `q2` (line 27) carries `fixed="true"`, `q3` (lines 28-30) carries `required="true"` and one `qti-weight` with `value="2.0"` whose start tag is at line 29, column 9, `q4` (lines 42-49) holds one `qti-branch-rule` targeting `q6`, and `q1`, `q5`, `q6` are empty. The fixture is ASCII (`grep` for bytes above `0x7F` prints `0`), so a 7-byte split of its UTF-8 bytes never cuts a character. The **record path** is `[clark(QTI, "qti-assessment-test"), clark(QTI, "qti-test-part"), clark(QTI, "qti-assessment-section"), clark(QTI, "qti-assessment-item-ref")]` (`spikes/streaming/source.ts:30-35` by shape, expanded).

## Cut 1: slice

- answer: sliced
- longest chain: m3-1, m3-2, m3-5, m3-6, m3-11, m3-12, m3-19, m3-20, m3-21, m3-22, m3-tidy

### m3-1: U01 `Limit` reason and the `record` ordinal on `XmlDecodeError`

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: none
- red_first: yes
- status: pending

Precondition: `M1-U05`, `M1-U09`, and `M2-U04` are accepted (`M2-U04` is the last M2 writer of `src/issue.ts`; `phase-2.md` lines 238-249 describe what it landed: `position` as an optional key, `formatMessage(..., position?)`, `withPosition(error, position)` re-rendering through `formatMessage`, `elementPath` on reasons `Schema` and `UndeclaredPrefix`). Adapt field and function names to what landed; the capabilities below are the lock.

In `src/issue.ts`: (a) the reason union of `XmlDecodeError` gains `Limit`, built in the same pattern as the landed members (`Schema.TaggedError` or `Data.TaggedError`, whichever `M1-U05` recorded), with fields `limit: "maxElementSize" | "maxElementNodes"`, `max: number`, `measured: number` (the count at the moment it exceeded), `element: string` (the record root's Clark name). (b) `XmlDecodeError` gains `record`, an **optional key** (plan lock 6: "an optional key, never `null`"): `Schema.optionalKey(Schema.Int)` (`node_modules/effect/src/Schema.ts:2406`, `:8010`) on a `Schema.TaggedError`, `readonly record?: number` on a `Data.TaggedError`; present when a failure is inside a collected record (`Schema`, `Limit`), absent for parser and resolver failures. (c) `formatMessage` accepts an optional `record` and renders the R-errors forms: `of record <k>` after the path, before `M2-U04`'s ` (line L, column C)` when both are given; without `record` the output is byte-identical to today. (d) `withPosition` keeps `record` when it re-renders (it must read every piece it re-renders from the error or its reason, as `M2-U04` arranged).

Tests in `src/issue.test.ts`: `Effect.catchReason("XmlDecodeError", "Limit", …)` (`Effect.ts:5144`) selects a constructed `Limit` error; `formatMessage` with `record` 3 and `position` `{ line: 23, column: 3 }` renders `at <xpath> of record 3 (line 23, column 3):` (regex `/ at \S+ of record 3 \(line 23, column 3\): /`), with `record` only `/ at \S+ of record 3: /`, and without `record` the existing M1/M2 regexes still match (existing cases unchanged); `withPosition` on an error built with `record` keeps `record` and its message still matches `/ of record \d+ \(line /`; an error built without `record` has no own `record` key (the same technique `M2-U04`'s tests use for `position`). red_first: add the `Limit` class but leave `formatMessage` ignoring `record` and `withPosition` dropping it, so the `of record` assertions fail on value before the change.

Rules: R-effect, R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Run the `consequences` lens before landing (plan: additive fields on the public error, as `M2-U04`'s were; M1/M2-shaped handlers keep working). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-2: U01 `limitMessage`, the lock 5 text

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: m3-1
- red_first: yes
- status: pending

In `src/issue.ts`, add `limitMessage({ element, limit, max, measured, path, record })` rendering, through `formatMessage` (m3-1), the plan lock 5 text: what `element <local> exceeds <limit>` where `<local>` is the local part of the Clark `element`; path; record; expectation `counted <measured> <nodes|characters>, limit <max>` (`nodes` for `maxElementNodes`, `characters` for `maxElementSize`); repair `raise <limit>, pass Infinity to disable it, or decode a smaller record path`. The builder is exported from `src/issue.ts` for `src/resolve.ts` (m3-5) and never from `src/index.ts`. Keep whatever pieces `withPosition` needs to re-render a `Limit` error (the fields are all on the reason, the path and record on the error), so a `Limit` that later gains a position (m3-16) renders the parenthetical once.

Tests in `src/issue.test.ts`: `limitMessage` for `element` `{QTI}qti-assessment-test`, `limit` `maxElementNodes`, `max` 1000000, `measured` 1000001, `path` `/qti-assessment-test`, `record` 1 equals exactly `element <qti-assessment-test> exceeds maxElementNodes at /qti-assessment-test of record 1: counted 1000001 nodes, limit 1000000; raise maxElementNodes, pass Infinity to disable it, or decode a smaller record path` (the one full-text pin the plan asks for); the `maxElementSize` form says `characters` and names its `max`; `withPosition` on a `Limit` error built with that message and `{ line: 1, column: 1 }` renders `at /qti-assessment-test of record 1 (line 1, column 1): counted` and the string `record 1` occurs once. The messages pass the error-messages checklist (what, constraint with the measured value, next action; no "invalid input"). red_first: stub `limitMessage` to return `""` so the equality fails on value.

Rules: R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-3: U02 `test/streaming/heap.ts` and the empty-element slope

- write_scope: `test/streaming/heap.ts`, `test/streaming/node-budget.test.ts`
- deps: none
- red_first: no
- status: pending

Precondition: `M1-U06` (`resolveEvents()`) and `M1-U07` (`collect(path)`) are accepted in `src/resolve.ts` (`phase-1.md` lines 329-353); this test imports both from `../../src/resolve.ts` (the one internal seam the plan allows under `test/streaming/`).

Create `test/streaming/heap.ts` (new; R-runtime): `forceGc(): void` (`Bun.gc(true)` when `"Bun" in globalThis`, else `v8.setFlagsFromString("--expose-gc")` once, guarded by a module-level flag, and `vm.runInNewContext("gc")()`; imports `node:v8`, `node:vm`); `retained<A>(build: () => A): { readonly value: A; readonly retainedBytes: number }` after `spikes/streaming/measure.ts:59-66` with `forceGc()` in place of `Bun.gc(true)` and bytes in place of MB (GC, read `process.memoryUsage().heapUsed`, build, GC, read again); `liveHeapBytes(baseline: number): number` (`forceGc()`, then `heapUsed - baseline`). Doc comments (R-doc) state the runtime rule and that the slope method in the test cancels the pipeline's fixed cost.

Create `test/streaming/node-budget.test.ts` with one `it.live` case (timeout `120_000`), "empty elements": for `N` in `[200_000, 400_000]`, build `"<r>" + "<a/>".repeat(N) + "</r>"` and run `Stream.make(text)` → `Stream.pipeThroughChannel(Xml.decodeString())` → `Stream.pipeThroughChannel(resolveEvents())` → `Stream.pipeThroughChannel(collect(["r"]))` → `Stream.runCollect` inside `retained(() => Effect.runSync(…))` (the shape of `spikes/streaming/streaming.test.ts:173-181`), holding the collected element in `value`; `bytesPerEmptyElement = (retained(400k).retainedBytes - retained(200k).retainedBytes) / 200_000`. Assert `bytesPerEmptyElement > 0` and `bytesPerEmptyElement * 1_000_000 <= 256 * 1024 * 1024` (the invariant that fixes the default: a budget of 1,000,000 keeps the worst case under 256 MiB retained on this runtime). Print `node-budget: <bytes> B per empty element, runtime <process.versions.bun ?? process.version>` with one `console.log` (m3-4 extends the line). The `collect` call passes no limits yet; m3-6 adds `{ maxElementSize: Infinity, maxElementNodes: Infinity }` once budgets exist. red_first is `no`: the slice changes no library code and measures M1 behavior; if the invariant fails, do not lower anything here: report the measured value and the largest round default (`10^n` or `5 × 10^n`) whose worst case fits 256 MiB; m3-6 writes that number. The report carries the printed number and the runtime string.

Rules: R-runtime, R-files, R-doc, R-test, R-check, R-commit (`test(streaming):`). Check: `bun x vp test test/streaming/node-budget.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-4: U02 text-run slope and the full `node-budget:` line

- write_scope: `test/streaming/node-budget.test.ts`
- deps: m3-3
- red_first: no
- status: pending

Add a second `it.live` case (timeout `120_000`), "text runs": the same slope over `"<r>" + "<a>x</a>".repeat(N) + "</r>"` for `N` in `[200_000, 400_000]` (two nodes per repetition: one element start and one text run), `perRepetition = (retained(400k) - retained(200k)) / 200_000`, `bytesPerTextRun = perRepetition - bytesPerEmptyElement` with `bytesPerEmptyElement` recomputed or shared through a module-level `let` the first case fills (order the cases so the empty-element case runs first, or compute both in one case; either is fine). Assert `perRepetition > 0`. Print the complete line the plan names, `node-budget: <bytes> B per empty element, <bytes> B per text run, runtime <process.versions.bun ?? process.version>`, once (replace m3-3's shorter line). red_first is `no` (measurement, as m3-3). The report carries both numbers and the runtime string; m3-6 writes them into the constant's doc comment.

Rules: R-runtime, R-test, R-check, R-commit (`test(streaming):`). Check: `bun x vp test test/streaming/node-budget.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-5: U03 the as-written `size` stamp and `maxElementSize` in `collect(path, limits)`

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m3-2
- red_first: yes
- status: pending

Precondition: `M1-U06`, `M1-U07`, `M1-U08`, and `M2-U05` are accepted (`M2-U05` is the last M2 writer of `src/resolve.ts`; it added the per-frame element-child counter and `elementPath` on `UndeclaredPrefix`, `phase-2.md` lines 251-262; leave that counter untouched).

In `src/resolve.ts`: (a) in `resolveEvents()`, on each upstream `StartElement` and before `xmlns`/`xmlns:*` are consumed (the skip at `spikes/namespaces/resolver.ts:100-103` by shape), compute `size = event.name.length + Σ(key.length + value.length)` over the as-written attributes (upstream's formula, `Xml.ts:1752-1753`) and stamp it as an additive `size: number` key on the resolved `StartElement` it emits (lock 4, quoted in Shared vocabulary: Clark expansion is never counted; `xmlns` keys count because upstream sees them as attributes). (b) `collect(path, limits?: { readonly maxElementSize?: number; readonly maxElementNodes?: number })` (`M1-U07`'s one-parameter form gains the second): export `defaultMaxElementSize = 16 * 1024 * 1024`; validate both limits as `checkLimit` does (`Xml.ts:552-558`: `limit > 0`, `Infinity` allowed) and make a bad value a **defect** when the channel is constructed (throw an `Error` from the machine factory, which `Channel.fromTransform` runs when the stream starts, or `Effect.die` if the factory is already effectful; R-effect), never a typed failure; enforce `maxElementSize` in this slice and leave a `// m3-6` comment where the node count goes (accept the key, enforce nothing for it yet). Counting: reset the per-record total when a record opens (as upstream resets `size`, `Xml.ts:1747`); add each element's `size` stamp on its start inside the record (the record root included) and each `Text` event's length; when the total exceeds the limit, fail with `XmlDecodeError` reason `Limit` `{ limit: "maxElementSize", max, measured: <the total at that moment>, element: <record root Clark name> }`, `record` = records emitted so far plus one, `path` = `/` plus the record root's local name, message from `limitMessage` (m3-2). Output before failure: records completed earlier in the same input chunk are already in the machine's `out` when it throws, so they are emitted first (the upstream machine shape, `Xml.ts:562-616`); keep one output chunk per input chunk.

Tests in `src/resolve.test.ts` (`it.effect`; events via `Stream.make(xml)` → `Xml.decodeString()` → `resolveEvents()` → `collect(…)`): `collect(["r"], { maxElementSize: 5 })` over `<r>abcdef</r>` fails with `_tag` `Limit`, `limit` `maxElementSize`, `measured` greater than 5, `max` 5, `element` `r`, `record` 1, `path` `/r`; `{ maxElementSize: Infinity }` admits `"<r>" + "x".repeat(1_000_000) + "</r>"`; through `collect(["{u}r"], { maxElementSize })`, `<r xmlns="u"/>` counts 7 (as-written `r`, `xmlns`, `u`: `6` fails, `7` admits) and `<p:r xmlns:p="u"/>` counts 11 (`10` fails, `11` admits); in the same test `Xml.elements(["r"], { maxElementSize: 6 })` over `<r xmlns="u"/>` fails and `7` admits (upstream's number for the same input, lock 4); a depth-two path over two records where the second exceeds, `collect(["d", "r"], { maxElementSize: 3 })` on `<d><r>ab</r><r>abcd</r></d>` (`r` + `ab` = 3 admits, `r` + `abcd` = 5 fails): collect emitted records with `Stream.tap` into an array, then `Effect.flip`; the array holds the first record and the failure names `record` 2; chunk semantics, `Stream.fromIterable(["<d><r>ab</r>", "<r>abcd</r></d>"])` → `Stream.rechunk(1)` → the pipeline above → `Stream.chunks` (`Stream.ts:12432`, as `M2-U08` (a)) → `Stream.tap` into an array → `Effect.flip`: one output chunk per input chunk, the record completed in the first chunk arrived before the second chunk's `Limit`; `maxElementSize: 0` and `NaN` are defects: `Effect.exit(Stream.runCollect(…))` is a failure whose cause satisfies `Cause.hasDies` (`Cause.ts:1023`) and not `Cause.hasFails` (`:915`); the `M1-U06`, `M1-U07`, `M1-U08`, and `M2-U05` cases stay green with no limits passed. red_first: before the change, `collect` ignores a second argument, so stub the parameter as accepted-and-ignored and see the `Limit` assertions fail on value (the stream succeeds), not on a type error.

Doc comment (R-native, R-doc): J1, and that the budget re-implements upstream's formula so the two numbers agree for the same input. Rules: R-effect, R-guide, R-native, R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-6: U03 `maxElementNodes`, `defaultMaxElementNodes`, and `Infinity` on the measurement

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`, `test/streaming/node-budget.test.ts`
- deps: m3-5, m3-4
- red_first: yes
- status: pending

In `src/resolve.ts`, replace the `// m3-6` comment in `collect`: a per-record node count, reset when a record opens, plus one for every element start inside the record (the root included) and plus one each time a **new** string child is pushed (not when text is appended to an existing trailing string child; upstream merges adjacent text per event, `Xml.ts:1769-1772`, and the plan counts the push); when the count exceeds `maxElementNodes`, fail as m3-5 does with `limit` `maxElementNodes` and `measured` the count at that moment. Export `defaultMaxElementNodes`: `1_000_000` if m3-4's report confirmed the invariant, else the round number m3-3 reported; its doc comment records, in present tense, the measured bytes per empty element and per text run and the runtime string from m3-4's `node-budget:` line (R5), and that `phase-4.md` reads this constant for the README. In `test/streaming/node-budget.test.ts`, pass `{ maxElementSize: Infinity, maxElementNodes: Infinity }` to each `collect` call (m3-3 and m3-4 added two) and change nothing else, so the measurement never depends on the default it fixes.

Tests in `src/resolve.test.ts` (same pipeline as m3-5): `collect(["r"], { maxElementNodes: 3 })` over `<r><a/><a/></r>` (3 nodes) yields the element and over `<r><a/><a/><a/></r>` fails with `limit` `maxElementNodes`, `measured` 4, `max` 3, `element` `r`, `record` 1, `path` `/r`; `<r>x<a/>y</r>` counts 4 (root, text, `a`, text: `3` fails, `4` admits) and `<r>xy</r>` counts 2 (`2` admits); `maxElementNodes: 0` and `NaN` are defects (as m3-5's `Cause.hasDies` check); `defaultMaxElementNodes` is a positive finite number; `bun x vp test test/streaming/node-budget.test.ts` stays green with the two options passed. red_first: m3-5 left `maxElementNodes` accepted and ignored, so the `measured 4` assertion fails on value before the change.

Rules: R-effect, R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`, body naming the measured numbers). Check: `bun x vp test src/resolve.test.ts test/streaming/node-budget.test.ts` (both files exist by now; confirm `Test Files 2 passed` and report both counts, R-check).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-7: U04 `syntheticParts()` and the `.gitignore` line

- write_scope: `test/streaming/synthetic.ts`, `test/streaming/synthetic.test.ts`, `.gitignore`
- deps: none
- red_first: yes
- status: pending

Create `test/streaming/synthetic.ts` (new; R-runtime) after `spikes/streaming/synthetic.ts:11-26` by shape: `fixture = new URL("../../spikes/fixtures/qti/test-features.xml", import.meta.url)` read with `readFileSync(fixture, "utf8")` (`node:fs`; the spike's `Bun.file` at `:35` is replaced); export `targetBytes = 50 * 1024 * 1024`; export `syntheticPath = fileURLToPath(new URL("./synthetic-test.xml", import.meta.url))` (`node:url`, as `:12`); export `syntheticParts(): { readonly header: string; readonly parts: string; readonly footer: string }`, the fixture text split at the first `<qti-test-part` and at `<qti-outcome-processing>` (`:18-26`; fixture lines 18 and 54 on this checkout); the file is read, never written. Leave a `// m3-8` comment where `ensureSynthetic` goes. In `.gitignore` (nine lines today, no `test/` entry), append the exact line `test/streaming/synthetic-test.xml`.

Tests in `test/streaming/synthetic.test.ts` (plain `it`): `header + parts + footer` equals the fixture text read by path; `parts` contains exactly six `<qti-assessment-item-ref` (count with `split("<qti-assessment-item-ref").length - 1`; the baseline `grep -c` on the fixture prints `6`); `header` starts with `<?xml` and `footer` starts with `<qti-outcome-processing>`. Run `git check-ignore -q test/streaming/synthetic-test.xml; echo $?` once and paste the exit status in the slice report (it prints `1` before the `.gitignore` edit and must print `0` after). red_first: stub `syntheticParts` to return three empty strings so the equality fails on value.

Rules: R-runtime, R-files, R-doc, R-test, R-check, R-commit (`test(streaming):`; the `.gitignore` line rides in this commit, as the plan says). Check: `bun x vp test test/streaming/synthetic.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-8: U04 `ensureSynthetic()` writes once and reuses

- write_scope: `test/streaming/synthetic.ts`, `test/streaming/synthetic.test.ts`
- deps: m3-7
- red_first: yes
- status: pending

In `test/streaming/synthetic.ts`, replace the `// m3-8` comment with `ensureSynthetic = Effect.fnUntraced(function* () { … })` after `spikes/streaming/synthetic.ts:28-46`: `repetitions = Math.ceil((targetBytes - header.length - footer.length) / parts.length)`; `refsPerRepetition` counted from `parts` (occurrences of `<qti-assessment-item-ref`), never written as a literal (the spike's `:16` constant is replaced by the count); if `existsSync(syntheticPath)` and `statSync(syntheticPath).size` is within `[targetBytes, targetBytes * 1.1)`, return `{ path: syntheticPath, bytes: size, repetitions, refsPerRepetition }` with `repetitions` re-derived from the same arithmetic (no stored state; the spike returned `undefined` at `:32`); otherwise build the chunks `header`, then for each `i` in `0..repetitions-1` the string `parts` with every `identifier="` replaced by `identifier="r<i>-` (the spike's `replaceAll` at `:41`), then `footer` (`:39-43`), `writeFileSync(syntheticPath, chunks.join(""))` once, and return `bytes` from `statSync` after the write. File I/O goes through `Effect.sync` (a failing read of the fixture or write beside the module is a broken checkout, a defect, not a typed failure; say so in the doc comment, with the R-native note from `spikes/streaming/source.ts:8-12`: `effect/FileSystem`'s implementation lives in platform packages that are not dependencies).

Tests in `test/streaming/synthetic.test.ts` (`it.live`, timeout `120_000`): the first `ensureSynthetic()` call returns `bytes >= targetBytes && bytes < targetBytes * 1.1`, `repetitions * refsPerRepetition > 100_000`, and `refsPerRepetition === 6` (derived; matches the fixture count); capture `statSync(path).mtimeMs`; a second call returns the same `path`, `bytes`, and `repetitions` and `mtimeMs` is unchanged (no rewrite). After the run, `git status --porcelain test/streaming` prints no `synthetic-test.xml` line; paste that command's output in the slice report. red_first: stub `ensureSynthetic` to return zeros so the bounds assertion fails on value.

Rules: R-effect, R-guide (`Effect.fnUntraced`), R-native, R-runtime, R-files, R-doc, R-test, R-check, R-commit (`test(streaming):`). Check: `bun x vp test test/streaming/synthetic.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-9: U05 upstream pins for the byte decoder

- write_scope: `test/upstream-xml.test.ts`
- deps: none
- red_first: no
- status: pending

Precondition: `M1-U13` and `M2-U08` are accepted (`M2-U08` is the last M2 writer; both extend the `describe("effect/encoding/Xml")` at `test/upstream-xml.test.ts:8` on this checkout).

Add three `it.effect` cases to the existing `describe`, each against literal strings and byte arrays (no fixtures), each with a one-line comment naming the depending unit, bytes made with `new TextEncoder().encode(…)`: (a) `Xml.decode()` over `Stream.fromIterable([bytes("<a>"), Uint8Array.of(0xc3), Uint8Array.of(0xa9), bytes("</a>")])` → `Stream.rechunk(1)` → `Stream.pipeThroughChannel(Xml.decode())` → `Stream.runCollect` yields the same events as the one-chunk `bytes("<a>é</a>")` run (`M3-U06`, lock 2; `Utf8Input` carries a split sequence, `Xml.ts:1683-1693`); (b) `Xml.decode()` over the bytes of `<?xml version="1.0" encoding="ISO-8859-1"?><a/>` fails with an `XmlError` whose `kind` is `Unsupported`, while `Xml.decodeString()` over the same text succeeds and its first event is a `Declaration` with `encoding` `"ISO-8859-1"` (`M3-U08`, lock 3; `Xml.ts:1475-1480`, `:285-286`); (c) `Xml.decode()` over `Uint8Array.of(0xff)` fails with `kind` `Syntax` (`M3-U08`; `:1697-1700`). red_first is `no`: these pin behavior upstream already has.

Rules: R-test, R-check, R-commit (`test(upstream):`). Check: `bun x vp test test/upstream-xml.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-10: U05 upstream pins for `elements` chunking, `Limit`, and construction throws

- write_scope: `test/upstream-xml.test.ts`
- deps: m3-9
- red_first: no
- status: pending

Add three more cases to the same `describe`, each with a one-line comment naming the depending unit: (d) one output chunk per input chunk on `elements`: `Stream.fromIterable(["<d><r>1</r><r>2</r><r>3</r>", "<r>4", "</r></d>"])` → `Stream.rechunk(1)` → `Xml.decodeString()` → `Xml.elements(["d", "r"])` → `Stream.chunks` (`Stream.ts:12432`) → `Stream.runCollect` yields chunks whose lengths are `[3, 1]`: the three records completed by the first input chunk arrive together, the second input chunk completes no record and produces no chunk, and record `4` arrives with the chunk that completes it (`M3-U03`, `M3-U06` chunk semantics; `Xml.ts:281-282`); (e) output before failure: `Stream.fromIterable(["<d><r>ab</r>", "<r>abcdef</r></d>"])` → `Stream.rechunk(1)` → `Xml.decodeString()` → `Xml.elements(["d", "r"], { maxElementSize: 4 })` → `Stream.tap` into an array → `Stream.runDrain` → `Effect.flip` fails with `kind` `Limit`, `line` and `column` `undefined`, and the array holds the one record completed before it (`M3-U03`; `Xml.ts:1783-1788`, `positionless`); (f) construction throws (plain `it`): `expect(() => Xml.elements([])).toThrow()` and `expect(() => Xml.elements(["r"], { maxElementSize: 0 })).toThrow()` (`M3-U03`, `M3-U06` defects mirror these; `Xml.ts:449-451`, `:552-558`). The file runs at least six more tests than at `M2-U08`'s close (m3-9 and this slice together). red_first is `no`.

Rules: R-test, R-check, R-commit (`test(upstream):`). Check: `bun x vp test test/upstream-xml.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-11: U06 `LimitOptions` on `decodeString` and the in-test item-ref definition

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m3-6
- red_first: yes
- status: pending

Precondition: `M1-U11` and `M2-U06` are accepted (`M2-U06` is the last M2 writer of `src/codec.ts`: `decodeString(Def)` runs `Stream.make(xml)` → `Xml.decodeString()` → `resolveEvents()` → `collect(["*"])` → `Schema.decodeUnknownEffect`, with `attachPosition(xml)` on the failure path and the `xml.decodeString` span; `phase-2.md` lines 264-275).

In `src/codec.ts`: export the types `LimitOptions { readonly maxElementSize?: number; readonly maxElementNodes?: number }` and `DecodeStreamOptions extends LimitOptions, Xml.DecodeOptions { readonly positions?: boolean }` (`Xml.DecodeOptions` is `maxTokenSize`/`maxDepth`, `Xml.ts:253-256`; `src/index.ts` is m3-19). `decodeString(Def, options?: LimitOptions)` forwards `options` to `collect(["*"], options)` (m3-5/m3-6), which is the tree-mode kill switch (`GOAL.md` Exit Strategy); nothing else in `decodeString` changes: `attachPosition`, the span, and the success path are untouched.

Tests in `src/codec.test.ts`: define once, for this and later slices in the file, the item-ref vocabulary from Shared vocabulary (a minimal in-test definition; `test/streaming/vocabulary.ts` in m3-20 is the consumer-shaped copy) and `fixtureText` read by path (R-files). Case: take the `q3` item ref (fixture lines 28-30: from `fixtureText.indexOf('<qti-assessment-item-ref identifier="q3"')` to the end of its `</qti-assessment-item-ref>`), insert ` xmlns="<QTI>"` into its start tag so the standalone text resolves to the definition's Clark name; `decodeString(ItemRef, { maxElementNodes: 2 })` on it fails with reason `Limit`, `limit` `maxElementNodes`, `measured` 3, `record` 1, `path` `/qti-assessment-item-ref` (root, whitespace text run, `qti-weight`: the third node exceeds 2; `q1` would be one node and pass); `decodeString(ItemRef, { maxElementNodes: Infinity })` on it succeeds with one weight whose `value` is `2`; the `M1-U11` and `M2-U06` cases stay green. red_first: accept `options` and do not forward it, so the `Limit` assertion fails on value (the decode succeeds).

Rules: R-effect, R-doc, R-files, R-test, R-check, R-commit (`feat(codec):`). Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-12: U06 `decode(Def, path, options?)` over a byte or text stream

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m3-11
- red_first: yes
- status: pending

In `src/codec.ts`, add `decode(Def, path, options?: DecodeStreamOptions)` with the plan lock 1 signature, quoted: "`decode(Def, path, options?)` returns `<E, R>(input: Stream<Uint8Array, E, R> | Stream<string, E, R>) => Stream<Def["Type"], XmlDecodeError | E, R>`: a byte stream or a text stream, never chunks of both, so the input kind is a static fact of the call site". Everything is built inside `Stream.suspend` (`Stream.ts:826`) so construction defects surface when the returned stream runs: an empty `path` is a defect (as `Xml.elements` throws, `Xml.ts:449-451`); bad limits are defects through `collect` (m3-5); `positions: true` is a defect naming `M3-U08` until m3-17 replaces it. The no-positions pipeline of lock 2, quoted: "Without `positions`, every chunk becomes bytes (strings through one module-level `TextEncoder`, as `Stream.encodeText` does, `Stream.ts:16923-16927`) and the pipeline is `Xml.decode(parserOptions)` → `resolveEvents()` → `collect(path, limits)`"; "Each chunk is converted at most once." So: `Stream.map(chunk => Predicate.isString(chunk) ? encoder.encode(chunk) : chunk)` → `Stream.pipeThroughChannel(Xml.decode({ maxTokenSize, maxDepth }))` (`Xml.ts:368`; lock 9) → `Stream.pipeThroughChannel(resolveEvents())` → `Stream.pipeThroughChannel(collect(path, limits))` → `Stream.zipWithIndex` (`Stream.ts:5670`) → `Stream.mapEffect` (`:2153`; no `concurrency` option, so sequential and order-preserving) running `Schema.decodeUnknownEffect(Def)` per record, with `SchemaError` mapped by `toDecodeError(planOf(Def), element, error)` plus `record: index + 1` (lock 6: the translated path is already record-relative because `translate` walks the record element), the parser's `Xml.XmlError` mapped to reason `WellFormedness` with the upstream `line`/`column` copied when both are numbers (the same mapping `M2-U06` applies in `attachPosition`; share the piece rather than duplicating it), and `Limit` and `UndeclaredPrefix` from the channels passed through unchanged. No span and no log in this slice (`// m3-13`). Doc comments (R-native, R-doc): J1 and J2 by symbol, and the lock 1 sentence on why the input is one stream kind.

Tests in `src/codec.test.ts` (`it.effect`), with `splitEvery(text, 7)` and the definitions from m3-11: `decode(ItemRef, recordPath)` over `Stream.fromIterable(splitEvery(fixtureText, 7))` (a text stream) and over `Stream.fromIterable` of the fixture's UTF-8 bytes cut every 7 bytes (a byte stream; the fixture is ASCII, Shared vocabulary) each yield 6 typed values, equal between the two runs and in document order, with `fixed` `true` on `q2`, `required` `true` on `q3`, and on `q4` one rule whose `target` is `q6`; the wildcard path `["*", "*", "*", clark(QTI, "qti-assessment-item-ref")]` yields the same 6; the text with `value="2.0"` replaced by `value="x"` (the third record, `q3`), fed in 7-character chunks with `Stream.tap` into an array before `Effect.flip`, fails with reason `Schema`, `path` `/qti-assessment-item-ref/qti-weight/@value`, `record` 3, no own `position` key, a message containing `of record 3`, and the array holds the two earlier records; the fixture text with `</oops>` appended as its last chunk fails with reason `WellFormedness`, no own `record` key, and `position` equal to the cause `XmlError`'s `line` and `column`; `decode(ItemRef, [])`, `decode(ItemRef, recordPath, { maxElementNodes: 0 })`, and `decode(ItemRef, recordPath, { positions: true })` each give, under `Effect.exit(Stream.runCollect(…))`, a failure whose cause satisfies `Cause.hasDies` and not `Cause.hasFails`. red_first: the function is new; stub `decode` to return `Stream.empty` (`Stream.ts:748`) with the full signature so the count assertion fails on `0`, not on a missing export.

Rules: R-effect, R-guide (`Predicate.isString`), R-native, R-errors (the record clause), R-doc, R-files, R-test, R-check, R-commit (`feat(codec):`). Run the `consequences` lens on the public signature before landing (plan). Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-13: U06 one `xml.decode` span per run with `xml.records` at exit

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m3-12
- red_first: yes
- status: pending

Replace the `// m3-13` comment in `decode` with plan lock 8, quoted: "One named span `xml.decode` per `decode` run through `Stream.withSpan` (`Stream.ts:18889`; `Channel.withSpan` provides it as `ParentSpan` to the whole pipeline, `Channel.ts:10935`), covering consumption. Attributes at creation: `xml.path` (the printed record path), `xml.maxElementSize`, `xml.maxElementNodes`, `xml.positions`; at exit, `xml.records` (records emitted) through `Effect.annotateCurrentSpan` (`Effect.ts:17326`) in `Stream.onExit` (`Stream.ts:17658`), so a `Limit` or `Schema` failure leaves the count on the span and the detail on the error. Per-record detail is at most `Effect.logDebug`, never a span: no span per record or per event". Count records with a per-run `let records = 0` inside the `Stream.suspend`, incremented where the `zipWithIndex` index is consumed; apply `Stream.onExit` **before** `Stream.withSpan` in the pipe so the finalizer runs inside the span and `annotateCurrentSpan` finds it. The printed path is `/` plus the path segments joined by `/` (a `*` segment prints as `*`). `xml.positions` is `false` here (m3-17 sets it from the option). The effective limits in the attributes are the resolved values (`defaultMaxElementSize`, `defaultMaxElementNodes` from `./resolve.ts` when the option is absent). No per-record log is required; none above debug level is permitted (`.agents/skills/trace-effect/SKILL.md`).

Tests in `src/codec.test.ts`: with the recording tracer the `M1-U11` span test installs (`Tracer.make`, `Tracer.ts:479`, through `Effect.withTracer`, `Effect.ts:16970`; extend it to record each span's attributes via its `attribute(key, value)` hook, `Tracer.ts:407`, if it does not already), one successful run of `decode` over the 6-record text stream produces exactly one span named `xml.decode` whose attributes include `xml.path` (a string starting with `/`), `xml.maxElementSize` (16777216 with the option absent), `xml.maxElementNodes` (equal to `defaultMaxElementNodes`), `xml.positions` `false`, and `xml.records` 6; the failing-third-record run produces one span with `xml.records` 2; neither run produces any other span (no `xml.decodeString` either: `decode` does not call it). red_first: before the change no span is recorded, so the "exactly one span" assertion fails on `0`.

Rules: R-effect, R-guide, R-doc, R-test, R-check, R-commit (`feat(codec):`); `trace-effect` is the implementation-time review. Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-14: U07 `PositionTree` and `positionAt`

- write_scope: `src/positions.ts`, `src/positions.test.ts`
- deps: none
- red_first: yes
- status: pending

Precondition: `M2-U01`, `M2-U02`, and `M2-U03` are accepted (`M2-U03` is the last M2 writer of both files; `phase-2.md` lines 199-236).

Append to `src/positions.ts`: `PositionTree { readonly position: Position; readonly local: string; readonly children: ReadonlyArray<PositionTree> }` and `positionAt(tree: PositionTree, path: ElementPath): Option.Option<Position>` (`Option.some`/`Option.none`, `Option.ts:297`, `:266`): an empty path is `None`; step 0 is the tree root and must satisfy `index === 0 && local === tree.local` (`phase-2.md` lock 2 and `M2-U04` (e): the record root is `{ local, 0 }`); each later step descends to `node.children[step.index]`, returning `None` when that child does not exist or when `step.local !== child.local`; the result is the matched node's `position`. Doc comment (R-native, R-doc): this is `locate` over a tree the collector builds from channel stamps instead of over text, so the two position sources share one path convention; the local-name check lives here, as in `locate`, because the collector has the Clark name in hand (J4). Neither symbol is exported from `src/index.ts` (`phase-2.md` lock 4; m3-19 keeps them out).

Tests in `src/positions.test.ts` (plain `it`), on a hand-built tree: root `r` at `{ line: 1, column: 1 }` with children `a` at `{ 2, 3 }` and `b` at `{ 3, 3 }`, `b` holding `c` at `{ 3, 6 }`: `[{r,0},{b,1},{c,0}]` is `Option.some({ line: 3, column: 6 })`; `[{r,0},{a,0}]` is `2:3`; `[{r,0}]` is `1:1`; `None` for `[{r,0},{b,2}]` (past the children), `[{r,0},{x,1}]` (local mismatch on `b`), `[{q,0}]` (root mismatch), and `[]`. Compare whole `Option` values with `toEqual`. red_first: stub `positionAt` as `() => Option.none()` so the `Some` assertions fail on value.

Rules: R-effect (pure, `Option`), R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(positions):`). Check: `bun x vp test src/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-15: U07 positioned events through `resolveEvents()`

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m3-6
- red_first: yes
- status: pending

Precondition: `M2-U02` (`PositionedEvent`, `decodeStringWithPositions` in `src/positions.ts`), `M2-U04` (`withPosition` in `src/issue.ts`), and `M2-U05` are accepted.

In `src/resolve.ts`, `resolveEvents()`: widen the input element type to `Xml.Event | PositionedEvent` (type import from `./positions.ts`; existing callers passing `Xml.Event` chunks still type-check); unwrap at `push` (`Predicate.hasProperty(item, "event")` distinguishes a `PositionedEvent`, which has no `_tag`); when the input carried a `position`, stamp it as an optional `position: Position` key on the resolved `StartElement` beside m3-5's `size` stamp (no stamp, no key; nothing is allocated on the plain path); when the resolver fails with `UndeclaredPrefix` on a stamped start event, apply `withPosition(error, stamp)` so the error carries that tag's position (lock 7). Nothing else changes: the `M2-U05` element-child counter and the `size` stamp stay as they are.

Tests in `src/resolve.test.ts` (`it.effect`): `Stream.make("<r><foo:bar/></r>")` → `Stream.pipeThroughChannel(decodeStringWithPositions())` → `Stream.pipeThroughChannel(resolveEvents())` → `Stream.runCollect` fails with reason `UndeclaredPrefix` and `position` `{ line: 1, column: 4 }`; the same text through plain `Xml.decodeString()` fails with no own `position` key; `Stream.make("<r>\n  <a/>\n</r>")` through the channel and the resolver yields resolved `StartElement`s for `r` with `position` `{ 1, 1 }` and `a` with `{ 2, 3 }`, while through plain `Xml.decodeString()` the resolved starts have no own `position` key; every earlier case in the file stays green. red_first: accept the widened type and drop the stamp, so the `{ 2, 3 }` assertion fails on `undefined`.

Rules: R-effect, R-guide (`Predicate`), R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-16: U07 the per-record `PositionTree` in `collect` and `recordPositions`

- write_scope: `src/resolve.ts`, `src/resolve.test.ts`
- deps: m3-15, m3-14
- red_first: yes
- status: pending

In `src/resolve.ts`, `collect`: when the record root's start event carries `position` (m3-15), build a `PositionTree` (m3-14, type import from `./positions.ts`) alongside the record through a parallel stack of mutable tree nodes: element children only, in document order, each node's `local` the local part of its Clark name (`parseClark`, `src/element.ts`), each node's `position` the start stamp; text runs add nothing. Keep the finished tree in a module-level `WeakMap<ResolvedElement, PositionTree>` so the record type stays `{ name, attributes, children }` (`phase-1.md` lock 3) and the tree lives exactly as long as the record; export `recordPositions(element: ResolvedElement): Option.Option<PositionTree>` (`Option.fromNullable` over the map lookup; R-effect's `Option` rule, see Notes), unexported from `src/index.ts`. A `Limit` raised while the record root is stamped carries the root's `position` (`withPosition` on the error m3-5/m3-6 build). No stamp, no tree, no cost: the plain path allocates nothing new.

Tests in `src/resolve.test.ts` (`it.effect`): `Stream.make("<r>\n  <a/>\n  <b><c/></b>\n</r>")` → `decodeStringWithPositions()` → `resolveEvents()` → `collect(["r"])` → `Stream.runCollect` yields one element whose `recordPositions` is `Some` of a tree with root `{ line: 1, column: 1 }`, children `a` at `{ 2, 3 }` and `b` at `{ 3, 3 }`, and `b`'s child `c` at `{ 3, 6 }` (compare `local` and `position` per node); the same text through plain `Xml.decodeString()` yields `recordPositions(element)` `None`; `collect(["r"], { maxElementNodes: 1 })` through the channel on `<r><a/></r>` fails with reason `Limit` and `position` `{ 1, 1 }`, and through plain `Xml.decodeString()` the same `Limit` has no own `position` key; every earlier case stays green. red_first: before the change `recordPositions` returns `None` for every element, so the `Some` assertion fails on value.

Rules: R-effect, R-doc, R-files, R-test, R-check, R-commit (`feat(resolve):`). Check: `bun x vp test src/resolve.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-17: U08 `positions: true` on `decode`

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m3-13, m3-16
- red_first: yes
- status: pending

In `src/codec.ts`, `decode`: remove m3-12's `positions: true` defect and add the positions branch of plan lock 2, quoted: "With `positions: true`, every chunk becomes text: string chunks pass, byte chunks go through one per-run `TextDecoder("utf-8", { fatal: true })` created inside `Stream.suspend` and applied per chunk as `decoder.decode(bytes, { stream: true })` under `Effect.try` in `Stream.mapEffect` (`Effect.ts:2503`; a typed failure, never a defect), with the decoder's final `decode()` flush appended through `Stream.concat` of a `Stream.fromEffect` filtered for non-empty output (`Stream.ts:3904`, `:358`, `:6309`); the pipeline is then `decodeStringWithPositions(parserOptions)` (`M2-U02`) → `resolveEvents()` accepting positioned events → `collect(path, limits)` recording positions." `Effect.try` is `try_` exported as `try` (`Effect.ts:2503`, `:2576`); its `catch` yields `XmlDecodeError` reason `WellFormedness` carrying `new Xml.XmlError({ kind: "Syntax", message: "invalid UTF-8", line: undefined, column: undefined })` with no `record` (lock 3), the same path `M1-U11` uses when upstream names none. The flush goes through the same `Effect.try` mapping and sits inside the `Stream.suspend` so the decoder is per run; on a text stream the decoder is never fed and its flush is empty, so one shape serves both kinds. After `collect`, the same `zipWithIndex`/`mapEffect` record step as m3-12, followed by `attachStreamPosition`: for reason `Schema`, `Option.flatMap(recordPositions(element), (tree) => positionAt(tree, reason.elementPath))` and `withPosition` on `Some`, the error unchanged on `None` (`Option.match`, `Option.ts:418`); `UndeclaredPrefix` and `Limit` already carry their stamp (m3-15, m3-16); `WellFormedness` as in m3-12. The span gains `xml.positions: true` from the option; otherwise lock 8 as m3-13. Doc comment (R-native): J3 verbatim, plus: `Channel.decodeText`'s second argument is the `TextDecoder` options, so `fatal` is reachable there, but the decode runs inside `Effect.map` where a `TypeError` is a defect, and the channel's input is `NonEmptyReadonlyArray<Uint8Array>` so a string chunk cannot pass through it; the per-run decoder under `Effect.try` is what lets the branch dispatch per chunk in one place (lock 2's words).

Tests in `src/codec.test.ts` (`it.effect`): the failing-third-record text of m3-12 fed in 7-character chunks with `{ positions: true }` fails with `record` 3, `path` `/qti-assessment-item-ref/qti-weight/@value`, and `position` equal to the line and column of that record's `<qti-weight` start tag, computed in the test from the text (`i = text.indexOf("<qti-weight", text.indexOf('identifier="q3"'))`; line = number of `\n` before `i` plus one; column = `i - text.lastIndexOf("\n", i - 1)`; on the baseline fixture that is line 29, column 9: compute it, do not hard-code it); the same stream as bytes in 7-byte chunks gives the same `position`; without `positions` the same failure has no own `position` key (m3-12's case stands); `Uint8Array.of(0xff)` as a one-chunk byte stream under `{ positions: true }` fails with reason `WellFormedness`, cause `kind` `Syntax`, no own `record` key, as a typed failure (`Effect.exit` → `Exit.isFailure`, `Exit.ts:435`, and `Cause.hasFails` true, `Cause.hasDies` false); a byte stream whose last chunk ends inside a multi-byte sequence (`[bytes("<a>"), Uint8Array.of(0xc3)]`) fails the same way, from the flush; the tracer test of m3-13 extended: one `xml.decode` span per `positions: true` run with `xml.positions` `true`. red_first: before the change `positions: true` is a defect, so every assertion above fails (a die where a typed failure or a value is expected).

Rules: R-effect (`Effect.try`, never the statement), R-guide, R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(codec):`). If `elementPath` on the landed `Schema` reason does not reach this slice in `M2-U04`'s shape, stop and report rather than re-deriving a path from the printed XPath (the same stop `M2-U06` names). Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-18: U08 byte-mode encoding parity on the positions branch

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m3-17
- red_first: yes
- status: pending

In `src/codec.ts`, `decode`: record the input kind once per run, a flag set by the first chunk's kind inside the normalisation step (constant under lock 1). On the positions branch, between `decodeStringWithPositions` and `resolveEvents()` (which drops `Declaration` events, `M1-U06`), check the first output chunk once: `Stream.mapArrayEffect` (`Stream.ts:2345`; per output chunk, never per event) with a per-run `checked` flag that returns `Effect.succeed(chunk)` for every chunk after the first; on the first chunk, when the input is bytes and `chunk[0].event` is a `Declaration` (`Xml.ts:87-92`) whose `encoding` is defined and not UTF-8 or US-ASCII (the `isUtf8` rule, `Xml.ts:734-737`, case-insensitive), fail with `XmlDecodeError` reason `WellFormedness` carrying a `new Xml.XmlError` of `kind` `Unsupported` whose message is upstream's text with the encoding name interpolated, `encoding <name> is not supported for byte input, decode the bytes to text first` (`Xml.ts:1477-1478`), and whose `line` and `column` are the declaration's channel position (lock 3). Text streams are never checked (as `decodeString`). State in the doc comment the two byte-mode behaviors lock 3 names and does not pin: a UTF-16 byte order mark fails as a parser `Syntax` error with a different message, and US-ASCII followed by a non-ASCII byte (`Xml.ts:1010`) decodes as UTF-8 text.

Tests in `src/codec.test.ts` (`it.effect`): a minimal document `<?xml version="1.0" encoding="ISO-8859-1"?><qti-assessment-item-ref xmlns="<QTI>" identifier="x" href="x"/>` with the path `[clark(QTI, "qti-assessment-item-ref")]`: as a byte stream it fails with reason `WellFormedness` and a cause of `kind` `Unsupported` under both `positions: false` (upstream's own, through `Xml.decode`) and `positions: true` (this slice); as string chunks it succeeds under both. red_first: before the change the byte stream with `positions: true` decodes successfully (the text decoder ignores the declaration), so the `Unsupported` assertion fails.

Rules: R-effect, R-guide, R-doc, R-files, R-test, R-check, R-commit (`feat(codec):`); `error-messages` review of the two `WellFormedness` messages this unit and m3-17 add. Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-19: U09 exports

- write_scope: `src/index.ts`
- deps: m3-2, m3-6, m3-12
- red_first: no
- status: pending

Precondition: `M1-U01` (`clark` in `src/element.ts`), `M1-U12`, and `M2-U06` are accepted (`M2-U06` is the last M2 writer of `src/index.ts`; it added `export type { ElementPath, Position } from "./positions.ts"`).

Add named re-exports to the existing list, relative imports with the `.ts` extension (R-files): `decode` and the types `DecodeStreamOptions`, `LimitOptions` from `./codec.ts`; `clark` from `./element.ts` (so consumers spell record paths); the `Limit` reason class from `./issue.ts`, beside the existing reason classes; `defaultMaxElementSize`, `defaultMaxElementNodes` from `./resolve.ts`. No wildcard export. `decodeStringWithPositions`, `PositionTree`, `positionAt`, `recordPositions`, `limitMessage`, and `locate` stay unexported (`phase-2.md` locks 4 and 6). No test of its own: `dist/index.d.ts` naming `decode`, `clark`, and `defaultMaxElementNodes` is the verify seat's build check (plan criterion 12). red_first is `no`.

Rules: R-files, R-check, R-commit (`feat(index):`). Check: `bun x vp fmt --check src/index.ts`; as advice, `bun x vp check src/index.ts` (fmt and lint scoped to the file; the type check is program-wide) and the two greps `grep -cE "\b(decode|clark|defaultMaxElementNodes|defaultMaxElementSize|Limit)\b" src/index.ts` (at least 5) and `grep -cE "decodeStringWithPositions|recordPositions|PositionTree|positionAt|limitMessage" src/index.ts` (prints `0`).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-20: U10 consumer vocabulary, byte source, record count, and early termination

- write_scope: `test/streaming/vocabulary.ts`, `test/streaming/source.ts`, `test/streaming/decode.test.ts`
- deps: m3-19, m3-8
- red_first: no
- status: pending

Precondition: the M1 DSL and operations reach `src/index.ts` (`M1-U04`, `M1-U12`).

Create `test/streaming/vocabulary.ts`, importing only from `../../src/index.ts` (consumer-shaped, as `test/qti/vocabulary.ts` is): the `QTI`/`XSI` constants, the item-ref vocabulary from Shared vocabulary verbatim (`ItemRef`, `Weight`, `BranchRule`, `Match`, `Variable`, `Correct`), a minimal `AssessmentTest` root (`qti-assessment-test`: attributes `identifier`, `title`; `elements({})`, enough because the `Limit` fires in the collector before any Schema runs), and `itemRefPath` and `testPath` built with `clark` (Shared vocabulary; `spikes/streaming/source.ts:30-37` by shape). Create `test/streaming/source.ts` (not a test file): `ReadError extends Data.TaggedError("ReadError")<{ readonly path: string; readonly cause: unknown }>` (`spikes/streaming/source.ts:14-17`) and `byteSource(path: string): Stream.Stream<Uint8Array, ReadError>` = `Stream.fromAsyncIterable<Uint8Array, ReadError>(createReadStream(path), (cause) => new ReadError({ path, cause }))` (`Stream.ts:1340`; `node:fs`; the element type is annotated because the `ReadStream` iterator is typed `any`); doc comment (R-native): the spike's note at `:8-12`, `effect/FileSystem`'s `stream` lives in platform layers that are not dependencies.

Create `test/streaming/decode.test.ts` (`it.live`, timeout `120_000` per case; each case calls `ensureSynthetic()` first, m3-8, and reads `{ path, repetitions, refsPerRepetition }`): (a) **count and order**: `Effect.timed(Stream.runFold(decode(ItemRef, itemRefPath)(byteSource(path)), () => ({ count: 0, last: undefined as ItemRef["Type"] | undefined }), (acc, ref) => ({ count: acc.count + 1, last: ref })))` (`Stream.ts:19473`, `Effect.ts:9336`; `spikes/streaming/streaming.test.ts:71-89` by shape); assert `count === repetitions * refsPerRepetition` (160,080 on the fixture; derived, never written) and `last.identifier` starts with `` `r${repetitions - 1}-` `` (`r26679-` followed by the last item ref's `identifier` on the fixture); print `streaming: <count> records, wall <ms> ms`; (e) **early termination**: `Stream.take(3)` (`Stream.ts:10840`) over the same stream collects 3 values; time it and record in the slice report that the wall time is under one tenth of (a)'s (recorded, not asserted). The report carries the printed count and wall time (T4 "resolver throughput on the 55 MB synthetic") and the deferral note the plan asks for: retention when a consumer keeps every record (D4, T5 "not verified") is deferred to the README (M4), because this test folds to a count. red_first is `no`: these pin behavior the `src/` slices landed; a wrong count is reported, not tuned.

Rules: R-runtime, R-files, R-native, R-doc, R-test, R-check, R-commit (`test(streaming):`). Check: `bun x vp test test/streaming/decode.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-21: U10 bounded live heap across the document (criterion 8)

- write_scope: `test/streaming/decode.test.ts`
- deps: m3-20, m3-3
- red_first: no
- status: pending

Add case (b) **live heap** (`it.live`, timeout `120_000`): `forceGc()` and take `baseline = process.memoryUsage().heapUsed`; run `decode(ItemRef, itemRefPath)(byteSource(path))` with a `Stream.tap` (`Stream.ts:2486`) that, every 20,000 records, calls `forceGc()` and pushes `liveHeapBytes(baseline)` (m3-3, `test/streaming/heap.ts`) into an array, then `Stream.runDrain` (`spikes/streaming/streaming.test.ts:217-242` by shape). Assert at least eight samples, every sample at most `16 * 1024 * 1024` above baseline, and `max(samples) - samples[0] <= 4 * 1024 * 1024` (bounded by the record, not the document; SPIKE-04 read 1.8 MB flat). If the bound is exceeded, report the samples and stop: the plan classes that as a `block_range` on `M3-U03`/`M3-U06`, not something to tune in the test. red_first is `no`.

Rules: R-runtime, R-test, R-check, R-commit (`test(streaming):`). Check: `bun x vp test test/streaming/decode.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-22: U10 whole-document `Limit` and the node boundary

- write_scope: `test/streaming/decode.test.ts`
- deps: m3-21
- red_first: no
- status: pending

Add cases (c) and (d) (`it.live`, timeout `120_000` each). (c) **whole document**: `decode(AssessmentTest, testPath)(byteSource(path))` → `Stream.runCollect` → `Effect.flip` fails with reason `Limit`, `limit` `maxElementSize`, `element` `clark(QTI, "qti-assessment-test")`, `path` `/qti-assessment-test`, `record` 1, and `max` equal to `defaultMaxElementSize` imported from `../../src/index.ts` (the plan's arithmetic: 1452 as-written characters and 64 nodes per repetition, so 16 MiB fires near repetition 11.5k, before the node budget near 15.6k). (d) **node boundary**: build in memory `<qti-assessment-item-ref xmlns="<QTI>" identifier="x" href="x">` + `<qti-weight identifier="W" value="1"/>`.repeat(1_000_000) + `</qti-assessment-item-ref>` with no whitespace between children (1,000,001 nodes; a text run between children would add nodes); `decode(ItemRef, [clark(QTI, "qti-assessment-item-ref")])(Stream.make(text))`: with `{ maxElementSize: Infinity }` it fails with reason `Limit`, `limit` `maxElementNodes`, `measured` 1_000_001, `max` equal to `defaultMaxElementNodes`; with `{ maxElementSize: Infinity, maxElementNodes: Infinity }` it yields one value with 1,000,000 weights. Both runs pass `maxElementSize: Infinity` because, in the plan's words, "the weights alone count 27,000,000 as-written characters and the default `maxElementSize` would fire near weight 621k, before the node budget; criterion 8 asks for the node boundary, not for both defaults at once". If m3-6 shipped a `defaultMaxElementNodes` below 1,000,000, assert `measured === defaultMaxElementNodes + 1` instead and say so in the report (see Notes). red_first is `no`.

Rules: R-runtime, R-test, R-check, R-commit (`test(streaming):`). Check: `bun x vp test test/streaming/decode.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-23: U11 positions at scale: count and cost

- write_scope: `test/streaming/positions.test.ts`
- deps: m3-17, m3-20
- red_first: no
- status: pending

Create `test/streaming/positions.test.ts` with one `it.live` case (timeout `180_000`): `ensureSynthetic()` (m3-8), then `Effect.timed(Stream.runCount(decode(ItemRef, itemRefPath, { positions: true })(byteSource(path))))` (`Stream.ts:19418`; `ItemRef`, `itemRefPath`, `byteSource` from m3-20's files); assert the count equals `repetitions * refsPerRepetition` (the same expectation as m3-20 (a), derived from `ensureSynthetic()`'s return); print `positions: <count> records, wall <ms> ms`. The slice report states the wall-time ratio to the `streaming:` line m3-20 printed (SPIKE-07 measured 2.5x to 3.6x; recorded for R7's README row, never asserted). red_first is `no`.

Rules: R-runtime, R-files, R-test, R-check, R-commit (`test(streaming):`). Check: `bun x vp test test/streaming/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-24: U11 an injected failure's position on a large text stream

- write_scope: `test/streaming/positions.test.ts`
- deps: m3-23, m3-7
- red_first: no
- status: pending

Add a second `it.live` case (timeout `180_000`): from `syntheticParts()` (m3-7) build `header`, then `k` prefixed repetitions of `parts` (every `identifier="` replaced by `identifier="r<i>-`, as m3-8 does; enough repetitions to pass `2 * 1024 * 1024` characters), then one more repetition whose `q3` `qti-weight` has `value="2.0"` replaced by `value="x"`, then `footer`; feed it as a text stream in 65,536-character chunks (`Stream.fromIterable(splitEvery(doc, 65_536))`); `decode(ItemRef, itemRefPath, { positions: true })` → `Stream.runDrain` → `Effect.flip`. Assert reason `Schema`, `record` equal to `k * 6 + 3` (the injected repetition's third item ref; 6 is m3-8's `refsPerRepetition`, read from `ensureSynthetic()` or counted from `parts`), `path` `/qti-assessment-item-ref/qti-weight/@value`, and `position` whose `line` is the count of `\n` in `doc` before the injected `<qti-weight` start tag (`doc.lastIndexOf("<qti-weight", doc.indexOf('value="x"'))`) plus one and whose `column` is the tag's offset from the preceding `\n`, both computed in the test. red_first is `no`.

Rules: R-runtime, R-test, R-check, R-commit (`test(streaming):`). Check: `bun x vp test test/streaming/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m3-tidy: Tidy the milestone 3 change

- write_scope: `src/issue.ts`, `src/issue.test.ts`, `src/resolve.ts`, `src/resolve.test.ts`, `src/positions.ts`, `src/positions.test.ts`, `src/codec.ts`, `src/codec.test.ts`, `src/index.ts`, `test/upstream-xml.test.ts`, `test/streaming/heap.ts`, `test/streaming/node-budget.test.ts`, `test/streaming/synthetic.ts`, `test/streaming/synthetic.test.ts`, `test/streaming/vocabulary.ts`, `test/streaming/source.ts`, `test/streaming/decode.test.ts`, `test/streaming/positions.test.ts`, `.gitignore`, new files under `src/` and `test/streaming/`
- deps: m3-1, m3-2, m3-3, m3-4, m3-5, m3-6, m3-7, m3-8, m3-9, m3-10, m3-11, m3-12, m3-13, m3-14, m3-15, m3-16, m3-17, m3-18, m3-19, m3-20, m3-21, m3-22, m3-23, m3-24
- red_first: no
- status: pending

Apply the cleanliness lens to the files this phase changed, with no behavior change: remove the `// m3-N` placeholders left by the chained slices; make sure each custom piece carries its R-native justification once (J1 on the collector budgets, J2 and J3 on `decode`, J4 on `positionAt` and the stamps) and that measured facts (`defaultMaxElementNodes`'s numbers and runtime) read as present-tense invariants; dedupe helpers two files grew independently (`splitEvery` in `src/codec.test.ts` and `test/streaming/positions.test.ts` may move to a new kebab-case file under `test/streaming/` only if both then import it by relative path and `src/codec.test.ts` does not import from `test/`; if that rule blocks the move, leave both copies); extract a helper into a new kebab-case file under `src/` only when a function has grown past easy reading, and `src/index.ts` must then re-export nothing new (`grep -cE "decodeStringWithPositions|recordPositions|PositionTree|positionAt|limitMessage" src/index.ts` must print `0`). You may restructure tests without changing what they assert; add none. The existing tests covering the scope must pass unchanged. Run `bun x vp fmt --check <changed files>` and the narrow test of each file you touch; do not run `bun run check`/`build`/`test`. A behavior change found while tidying is reported as a follow-up and not made. If nothing needs changing, report "no changes".

Rules: R-doc, R-native, R-files, R-check, R-commit (`refactor:`). Check: `bun x vp test src/issue.test.ts src/resolve.test.ts src/positions.test.ts src/codec.test.ts test/upstream-xml.test.ts test/streaming/synthetic.test.ts test/streaming/node-budget.test.ts test/streaming/decode.test.ts test/streaming/positions.test.ts` (nine files; confirm `Test Files 9 passed`, R-check).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Notes

- Nothing is already delivered: on `71eb95b`, `src/` holds only the comment-only `src/index.ts` and `test/` only `test/upstream-xml.test.ts`; `bun x vp test test/streaming/node-budget.test.ts` exits 1 (`No test files found`). Every unit M3-U01..U11 is covered: U01 m3-1..2; U02 m3-3..4; U03 m3-5..6; U04 m3-7..8; U05 m3-9..10; U06 m3-11..13; U07 m3-14..16; U08 m3-17..18; U09 m3-19; U10 m3-20..22; U11 m3-23..24.
- Cross-phase order: the factory maps each `Precondition:` M1/M2 unit to its accepted slices (`phase-1.slices.md`, `phase-2.slices.md`) and dispatches an M3 slice on an M1/M2 file only after them and after any M1/M2 slice that rewrites that file (their tidy slices included). `phase-4.slices.md` is a sibling seat's working file on this checkout; it is neither read nor cited here. The plan's merge gate also forbids dispatching an M3 Hand into a file an M1 or M2 Hand holds uncommitted.
- Shared files are chained, never raced: `src/issue.ts` carries U01 (m3-1 → m3-2); `src/resolve.ts` carries U03 and U07 (m3-5 → m3-6 → m3-15 → m3-16); `test/streaming/node-budget.test.ts` carries U02 and the U03 edit (m3-3 → m3-4 → m3-6); `src/codec.ts` carries U06 and U08 (m3-11 → m3-12 → m3-13 → m3-17 → m3-18); `test/upstream-xml.test.ts` (m3-9 → m3-10), `test/streaming/synthetic.ts` (m3-7 → m3-8), `test/streaming/decode.test.ts` (m3-20 → m3-21 → m3-22), and `test/streaming/positions.test.ts` (m3-23 → m3-24) chain inside their units. `src/positions.ts` (m3-14), `src/index.ts` (m3-19), `.gitignore` (m3-7), `test/streaming/heap.ts` (m3-3), `vocabulary.ts` and `source.ts` (m3-20) each have one writer. No two slices without a `deps` path between them share a file.
- Dependencies follow the plan's unit graph in direction, with three shortenings the files allow: m3-19 (exports) depends on m3-12 (`decode` and its types exist) rather than on the span slice m3-13; m3-23 (U11) depends on m3-17 (the positions branch) and m3-20 (`byteSource`, `vocabulary.ts`) rather than on all of U08 and U10, since m3-18 and m3-21/m3-22 touch files it does not read; m3-20 depends on m3-8 and m3-19 only. The longest chain is 11 slices against the plan's six-unit chain `U02 → U03 → U06 → U09 → U10 → U11`.
- Three plan details the slices settle rather than leave to the implementer: (1) `recordPositions` returns `Option.Option<PositionTree>` instead of the plan's `PositionTree | undefined` (R-effect's rule for a pure lookup; the seam is unexported and m3-17 is its only consumer, so the shape change reaches no public surface); (2) m3-18 checks the first `Declaration` on the channel's first output chunk with `Stream.mapArrayEffect`, which is the plan's "checked once on the first `Declaration` event before resolution" at the cheapest per-chunk hook `Stream` offers at `4.1.2` (there is no first-chunk-only combinator; `Stream.mapArray` is pure and cannot fail); (3) m3-22 (d) asserts `measured === defaultMaxElementNodes + 1` if m3-6 shipped a default below 1,000,000, because the plan's `measured` 1,000,001 presupposes the 1,000,000 default and the record still exceeds any smaller one.
- Construction defects (empty path, non-positive budget, `positions: true` before m3-17) mirror upstream `checkLimit`'s throw at channel creation (`Xml.ts:552-558`); because every stage is built inside `Stream.suspend`, they surface when the returned stream runs, which is what the `Effect.exit` + `Cause.hasDies` assertions observe. R-effect's try/catch ban is on the statement; `Effect.try` is the sanctioned form and is the only place a `TextDecoder` `TypeError` is caught (m3-17).
- `Channel.decodeText` at `4.1.2` does take `TextDecoder` options as its second argument (`Channel.ts:9214-9216`), which the plan does not state; it still accepts byte chunks only and decodes inside `Effect.map`, so lock 2's per-run decoder under `Effect.try` stands. m3-17's doc comment records both facts so the native-capability review is honest.
- The check-command forms were verified on this checkout: `bun x vp test <missing>` exits 1; `bun x vp test <present> <missing>` exits 0 (R-check's two-filter caveat); `bun x vp fmt --check src/index.ts` runs on one file; `git check-ignore -q test/streaming/synthetic-test.xml` exits 1 today.
- The plan's verify gate (`bun run check && bun run build && bun run test`; nine M3 test files with non-zero counts; the printed `node-budget:`, `streaming:`, `positions:` lines) and milestone-close greps stay with the verify seat; no slice runs them. Review lenses the plan names run at review, not as slice checks: `consequences` on m3-1 and m3-12, `correctness` on m3-5, m3-6, m3-12, m3-15..m3-18, `cleanliness` after m3-18 and m3-19 before the `test/streaming/` acceptance slices, `trace-effect` on m3-13, `error-messages` on m3-1, m3-2, m3-17, m3-18, `red-green` on the budget and failing-record slices (their `red_first: yes`), `poker-face` at M3 close.
- Line numbers above were read at `71eb95b`; spike files are frozen R&D and `node_modules/effect` is pinned at `4.1.2`, so they hold until either moves.
