# Slices: xml-schema-codec, milestone 2 (positions)

- plan: docs/goals/xml-schema-codec/phase-2.md (ADMITTED at `ce0a251`; units M2-U01..M2-U08)
- slice file: docs/goals/xml-schema-codec/phase-2.slices.md
- size target: 5–10 minutes
- cut against: commit `d186f87` (phase-2.md unchanged since `ce0a251`), `effect@4.1.2`; every line number below was read on that checkout
- slice count: 12 + tidy (13)
- longest chain: 7 (`m2-1, m2-6, m2-7, m2-8, m2-9, m2-10, m2-tidy`; `m2-1, m2-6, m2-7, m2-8, m2-9, m2-11, m2-tidy` is the same length)
- cross-phase preconditions: `deps` names only slices in this cut. Where a slice edits a file that milestone 1 creates, its brief opens with a `Precondition:` line naming the M1 **unit** that last writes that file (`phase-1.md`); the factory maps those units to accepted M1 slices before dispatching. `src/positions.ts`, `src/positions.test.ts`, and `test/fixtures/edge-cases.xml` are new in M2 and have no M1 precondition.
- corrected on: handle `6418eee3` per aggregate slice audit `f2edd498` (findings F5): slices m2-8 and m2-tidy (and the R-check rule) are edited in place with ids, deps, waves, and the chain unchanged; no slice is accepted or in progress and no factory ledger exists.

## Standing rules (every brief below is bound by these; a brief names the ones it leans on)

- R-effect: Effect error channels only. `try`/`catch` is a lint error (`workspace/no-built-in-try-catch`, `vite.config.ts:78`). Return failures with `yield*`/`Effect.fail`; inside a generator keep `if`/`??`/ternary for plain value checks (`.agents/skills/effect-design/SKILL.md` local rulings). A pure function returns `Option.Option<…>` for an absent result, never `null` or `undefined` (AGENTS.md "Schema intent": nullability is an actual optional value).
- R-guide: follow `node_modules/effect/AGENTS.md`: `Effect.gen` inline, `Effect.fnUntraced` for library helpers, `Effect.fn("name")` only where a span is wanted. Use `Predicate` helpers, never hand-written guards.
- R-native: before custom glue, name in the unit's doc comment the Effect API checked and the requirement it misses (`.agents/skills/effect-design/SKILL.md` "Native capability review"). For this milestone the justification is the same for `locate` and the channel and is quoted in m2-1 and m2-3. Import only public symbols or `effect/encoding/Xml`; never `applyToSelfOrLastLinkEncoding`, `replaceEncoding`, `Objects.recur`, `Arrays.recur`, `getIndexSignatureKeys`, `defaultFormatter`, `resolveAnnotations`.
- R-doc: multiline JSDoc (`/**` on its own line) on every module-scope function, type, interface, class, and `const`, with `@param`/`@returns` on functions (`.agents/skills/document-code/SKILL.md`; `vite.config.ts:24` enforces the multiline form). Deferrals and measured facts the plan asks for live in doc comments, written as present-tense invariants, never as history.
- R-files: kebab-case file names and directories (`unicorn/filename-case`, `workspace/kebab-case-paths`). Inside `src/`, relative imports with the `.ts` extension (`tsconfig.json:10` sets `allowImportingTsExtensions`). No file under `src/` or `test/` imports from `spikes/`; the corpus is read by path with `new URL("../spikes/fixtures/qti/", import.meta.url)` from `src/` (`..` depth per file) and `node:fs` `readdirSync`/`readFileSync`; the edge-case fixture is read from `test/fixtures/edge-cases.xml`. `src/positions.ts` imports nothing from `./issue.ts` (the dependency runs the other way).
- R-test: tests are `*.test.ts` beside the module (or under `test/`), import `{ describe, expect, it } from "@effect/vitest"`, and use `it.effect` for effectful cases; a pure case may use plain `it` (`test/upstream-xml.test.ts:1-25` is the model). Vitest's include is `src/**/*.test.ts`, `test/**/*.test.ts` (`vite.config.ts:91`). Assert on structured values (`_tag`, `position`, `path`, `elementPath`) or on a regex of a message's shape, never on full message text.
- R-check: the slice check is one `bun x vp test <file>` (exits 1 when the file is missing, so it cannot pass on nothing) or `bun x vp check <files>`. A multi-filter `bun x vp test a.test.ts b.test.ts` exits 0 when **either** file matches, so a slice whose check names several files confirms each appears in the `Test Files` summary and reports the count. `bun run check`, `bun run build`, `bun run test` are gate-seat commands; never run them as a slice check.
- R-errors: caller-facing messages follow `.agents/skills/error-messages/SKILL.md`: keep what, path, expectation, repair; neutral tone; never "invalid input". The message rule with a position is `<what> at <xpath> (line L, column C): <expectation>; <repair>`; without one, the M1 form `<what> at <xpath>: <expectation>; <repair>` is unchanged.
- R-commit: one conventional commit per slice when the runner commits per slice: `feat(positions):`, `feat(issue):`, `feat(resolve):`, `feat(codec):` for library behavior, `test:` for test-only slices, `refactor:` for the tidy slice (`.agents/skills/conventional-commits/SKILL.md`).
- R-scope (ends every brief): change only the files in `write_scope`. If the work needs any other path, change nothing and report `blocked-scope` with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

Shared vocabulary: a **Clark name** is `{uri}local`, or `local` for no namespace; its **local part** is the text after `}`, or the whole name. An **as-written local part** is the text after the first `:` of a name as it appears in the document, or the whole name. `Position { readonly line: number; readonly column: number }` is one-based, lines end at LF, CR, or CRLF, columns count UTF-16 code units, exactly as upstream `XmlError` counts (`node_modules/effect/src/encoding/Xml.ts:44-45`, `:1037-1045`). `ElementStep { readonly local: string; readonly index: number }` and `ElementPath = ReadonlyArray<ElementStep>`: `index` is the zero-based position among the parent's **element** children (text, comments, PIs do not count; the root is index 0). A path is written `[{root,0},{b,1}]` below as shorthand for `[{ local: "root", index: 0 }, { local: "b", index: 1 }]`.

## Cut 1: slice

- answer: sliced
- longest chain: m2-1, m2-6, m2-7, m2-8, m2-9, m2-10, m2-tidy

### m2-1: U01 position types and `locate` over plain tags

- write_scope: `src/positions.ts`, `src/positions.test.ts`
- deps: none
- red_first: yes
- status: pending

Create `src/positions.ts` (new; nothing in `src/` references it yet). Export the types `Position`, `ElementStep`, `ElementPath` (shared vocabulary above) and `locate(text: string, path: ElementPath): Option.Option<Position>` (`Option.some`/`Option.none`, `node_modules/effect/src/Option.ts:297`, `:266`). Port the scanner from `spikes/error-positions/locate-c.ts` by shape, never by import: `advance` (`:86-98`, line and `lineStart` counting over LF, CR, CRLF), `tagEnd` (`:102-115`, the index past the `>` that closes a tag, honouring `"`/`'` quoted attribute values that may contain `>`), `isNameEnd` (`:64-70`), and the scan loop (`:146-190`) with only its end-tag branch (`:167-170`, pops a frame) and start-tag branch (`:171-187`) for now; the `<?`, `<!--`, `<![CDATA[`, and `<!` branches are m2-2 (leave a `// m2-2` comment where they go). Three changes from the spike: (1) descent is positional, not same-name counted: each frame holds one counter of element children started under it, and a start tag at depth `d` matches step `d` when the parent frame is matched, `step.index === counterBeforeIncrement`, and the tag's as-written local part equals `step.local`; (2) the function is pure and total: an empty path, a path that runs past the document, an unterminated tag (`tagEnd` returns `-1`), or a local-name mismatch on the matched index returns `Option.none()` (no `Effect`, no `LocateError`); (3) a self-closing `/>` pushes no frame (as the spike). The returned position is the `<` of the matched start tag: `{ line, column: lt - lineStart + 1 }`.

Doc comment on `locate` (R-native, R-doc), present tense: `Xml.decodeString` events carry no position (`Xml.ts:133-166`), `XmlError` carries one only on parser failure (`:51-56`), and `SchemaIssue` has no position slot (`node_modules/effect/src/SchemaIssue.ts:156-163`); nothing public attributes an event to its input except the one-output-chunk-per-input-chunk contract (`Xml.ts:281-282`), and nothing locates after the fact except a scan of the retained text, which is what this is. State that it is the one second tokenizer the goal allows (criterion 10) and is licensed only together with the locate-versus-channel agreement test in this module's test file (decision D7; the test is m2-5); that the path is positional and zero-based on purpose (the printed XPath is one-based and same-named, and a name-matching scanner would need namespace resolution); and the deferral: attribute positions inside a start tag and `Text` positions are not reported (D7, T2 "not verified"), a failure on an attribute or text child reports the enclosing element's start tag.

Test in `src/positions.test.ts` (plain `it`; no fixtures yet) over the literal `'<root>\n  <a/><b/><c attr="a > b"/><d>\n    <e/></d>\n</root>'`: `[{root,0}]` is `Option.some({ line: 1, column: 1 })`; `[{root,0},{a,0}]` `2:3`; `[{root,0},{b,1}]` `2:7`; `[{root,0},{c,2}]` `2:11`; `[{root,0},{d,3}]` `2:28` (`<c attr="a > b"/>` is 17 characters, columns 11-27; the quoted `>` must not end the tag, or `c` pushes a frame and `d` is misfiled under it); `[{root,0},{d,3},{e,0}]` `3:5`; over `'<r xmlns:p="u"><p:q/></r>'`, `[{r,0},{q,0}]` is `1:16` (the as-written local part of `p:q`); `Option.none()` for `[{root,0},{x,2}]` (local mismatch on `c`), `[{root,0},{e,0}]` (index 0 is `a`), `[{root,0},{a,4}]` (past the children), `[]`, and `'<root><a'` (unterminated); every `Some` case returns the same line and column on `text.replaceAll("\n", "\r\n")` (CRLF counts as one line end, so columns do not shift). red_first: the module is new; stub `locate` as `() => Option.none()` first so the `Some` assertions fail on value, not on a missing import.

Rules: R-effect (pure, `Option`), R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(positions):`). Check: `bun x vp test src/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-2: U01 markup skip rules and the edge-case fixture

- write_scope: `src/positions.ts`, `src/positions.test.ts`, `test/fixtures/edge-cases.xml`
- deps: m2-1
- red_first: yes
- status: pending

Create `test/fixtures/edge-cases.xml` with the text of `spikes/error-positions/edge-cases.xml` (16 lines) reproduced verbatim (plan lock 9: the hand-checked positions below depend on it byte for byte; copy the file, do not retype it). In `src/positions.ts`, replace the `// m2-2` comment in the scan loop with the four skip branches of `locate-c.ts:152-166`, kept verbatim in effect: `<?` skips to past `?>`; `<!--` to past `-->`; `<![CDATA[` to past `]]>`; any other `<!` to past the `>` that closes a DOCTYPE, skipping an internal subset in `[...]` and quoted literals (`doctypeEnd`, `:119-137`); an unterminated construct returns `Option.none()`. None of these pushes a frame or counts as an element child.

Tests (plain `it`), reading `test/fixtures/edge-cases.xml` with `readFileSync(new URL("../test/fixtures/edge-cases.xml", import.meta.url), "utf8")` and `bg010-missing-word.xml` with `new URL("../spikes/fixtures/qti/bg010-missing-word.xml", import.meta.url)` (R-files): on the fixture, `[{root,0}]` is `Some({ line: 7, column: 1 })`; `[{root,0},{a,0}]` `9:3`; `[{root,0},{b,4}]` `12:5` (the fourth `b`, element index 4 after `a`, `<b/>`, `<b></b>`, and the multi-line `<b k="v"/>`); `[{root,0},{c,5}]` `14:3`; `[{root,0},{d,6},{e,0}]` `15:16`; `None` for `[{root,0},{fake-tag,0}]` (inside the comment on line 6), `[{root,0},{not-an-element,0}]` (inside the CDATA on line 9), `[{root,0},{x,6}]` (local mismatch on `d`), `[{root,0},{b,7}]` (past the children); the same `Some` cases hold on the CRLF variant of the fixture text; on `bg010-missing-word.xml`, `[{qti-assessment-item,0},{qti-item-body,2},{div,1},{blockquote,0},{p,0},{qti-text-entry-interaction,1}]` is `26:43` (under the root: `qti-response-declaration` 0, `qti-outcome-declaration` 1, `qti-item-body` 2; under the body: `p` 0, `div` 1; `blockquote` and `p` are only children; under that `p`: `br` 0, the interaction 1; verified with `awk 'NR==26 { print index($0,"<qti-text-entry") }'`, which prints `43`). red_first: before the change the `<?xml …?>` declaration on line 1 and the comment on line 6 are scanned as start tags named `?xml` and `!--`, so they take element indices 0 and 1 under the document and `[{root,0}]` returns `None`.

Rules: R-doc (extend the `locate` comment with the markup it skips), R-files, R-test, R-check, R-commit (`feat(positions):`). Check: `bun x vp test src/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-3: U02 `decodeStringWithPositions` channel and event fidelity

- write_scope: `src/positions.ts`, `src/positions.test.ts`
- deps: m2-2
- red_first: yes
- status: pending

Append to `src/positions.ts`: `PositionedEvent { readonly event: Xml.Event; readonly position: Position }` and `decodeStringWithPositions<IE = never, Done = unknown>(options?: Xml.DecodeOptions): Channel.Channel<Arr.NonEmptyReadonlyArray<PositionedEvent>, Xml.XmlError | IE, Done, Arr.NonEmptyReadonlyArray<string>, IE, Done>`, ported by shape from `spikes/error-positions/positions-b.ts:43-134`: `Channel.fromTransform` (`node_modules/effect/src/Channel.ts:294`) whose pull re-chunks upstream strings into pieces that each start at `<` (`refill`, `:84-96`; the text after the last `<` is carried into the next chunk and flushed at `onDone`, `:115-122`, which ends the pull with `Cause.done(leftover)`, `Cause.ts:1530`); `advance` (`:68-82`) counts line and column over each fed piece with the shared-vocabulary rules; `feed` (`:98-104`) records the fed piece's start as `fedLine`/`fedColumn`; `pieces` (`:106-124`) is the `Pull.matchEffect` loop (`Pull.ts:438`); the body runs `Channel.toTransform(Xml.decodeString<IE, Done>(options))(pieces, scope)` (`Channel.ts:451`) and maps every output chunk to `PositionedEvent`s carrying the most recently fed piece's start (`:126-132`). The only shape change: the spike's `Positioned extends Position` becomes `{ event, position }`. Neither symbol is exported from `src/index.ts` (plan lock 4; M3 wires the channel behind `positions: true` on `decode`).

Doc comment (R-native, R-doc): the same justification as `locate` (quote it or refer to it by symbol); the exactness claim and its limit: a piece holds exactly one `<`, so under the one-output-chunk-per-input-chunk contract (`Xml.ts:281-282`) a `StartElement` or `EndElement` is completed by the piece whose `<` opens it and its position is exact, while `Text`, `Comment`, `Doctype`, and `ProcessingInstruction` are completed by a later piece and carry that piece's position (deferred per D7; positions are counted over the raw input, never over `Text` events, which normalize line endings); the carry buffers an unbounded run with no `<` and upstream's `maxTokenSize` bounds it; the throughput note as a present-tense fact (plan lock 8): the channel costs 2.5x to 3.6x plain `Xml.decodeString` on the corpus, about three quarters of it the per-piece pull round trip through the channel rather than the counting, which is why it is opt-in and never the default on the decode path (`spikes/error-positions/RESULT.md` keeps the measurement; no timing test exists).

Tests in `src/positions.test.ts` (`it.effect`): define once, for the later slices in this file, `fixtures`: every `*.xml` under `new URL("../spikes/fixtures/qti/", import.meta.url)` enumerated with `readdirSync` and sorted, plus `{ name: "edge-cases.xml", text }` from `test/fixtures/edge-cases.xml`, as `spikes/error-positions/positions.test.ts:9-21` does; assert `fixtures.length > 0` once (count measured, never written). Define `runB(chunks)` and `runPlain(chunks)` after `:30-46` (`Stream.fromIterable`, `Stream.rechunk(1)`, `Stream.pipeThroughChannel`, `Stream.runCollect`; `Stream.ts:999`, `:12467`, `:16246`, `:19384`) and `startTagsOf(events: ReadonlyArray<PositionedEvent>): Array<{ local: string; path: ElementPath; position: Position }>`, the lock-2 counterpart of `elementsOf` (`:50-69`): a stack of frames each holding its `ElementPath` and one element counter; on `StartElement` the step is `{ local: <as-written local part of event.name>, index: parent.counter++ }`; on `EndElement` the stack pops. Cases: event fidelity, for every fixture the channel's events mapped to `.event` `toEqual` `runPlain([text])` (spike test 3, `:105-113`); on the literal `'<a>\n<b/></a>'` the positioned events are `StartElement a` at `1:1`, `StartElement b` and `EndElement b` both at `2:1` (one self-closing piece completes both), `EndElement a` at `2:5`. red_first: stub the channel to tag every event with `{ line: 1, column: 1 }` so the literal case fails on `2:1`.

Rules: R-effect, R-guide, R-native, R-doc, R-files, R-test, R-check, R-commit (`feat(positions):`). Check: `bun x vp test src/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-4: U02 chunking independence and the 33 hand-checked positions

- write_scope: `src/positions.test.ts`
- deps: m2-3
- red_first: no
- status: pending

Add to `src/positions.test.ts`, using `fixtures`, `runB`, and `startTagsOf` from m2-3: `splitEvery(text, size)` after `spikes/error-positions/positions.test.ts:71-75`; chunking independence, for every fixture `startTagsOf(runB(splitEvery(text, 7)))` `toEqual` `startTagsOf(runB([text]))` (spike test 2, `:97-103`); the hand-checked table, carried over verbatim from `handChecked` at `:118-200` (33 entries: fixture name, one-based document-order ordinal of the start tag, as-written name, line, column; two per corpus file and three for `edge-cases.xml`, whose entries are root `7:1`, the sixth start tag `b` `12:5`, and the ninth `e` `15:16`), asserted as `:202-217` does: at least two entries per fixture, and for each entry `startTagsOf(runB([text]))[ordinal - 1]` has that name (compare the as-written `event.name`, which is what `handChecked` lists; `startTagsOf` may expose it alongside `local`) and that position. red_first is `no`: these pin behavior m2-3 already has on real documents and pass once written; the runner records the first run.

Rules: R-files, R-test, R-check, R-commit (`test(positions):`). Check: `bun x vp test src/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-5: U03 locate-versus-channel agreement test

- write_scope: `src/positions.test.ts`
- deps: m2-4
- red_first: no
- status: pending

Add to `src/positions.test.ts`, placed before the m2-4 cases as the first channel case (the spike's test 1, `spikes/error-positions/positions.test.ts:77-95`): for every fixture, `startTagsOf(runB([text]))`, assert it is non-empty, and for each start tag assert `locate(text, path)` equals `Option.some(position)` (compare the whole `Option` with `toEqual`, so a `None` fails the assertion rather than skipping; `Option.some` values are structurally comparable); collect one row per fixture and print the table `| fixture | start tags | agree |` with a single `console.log`, as `:90-94` does, so the verify seat's log shows the measured totals; assert the row count equals `fixtures.length`. A leading comment (plain `//`, two to four lines) names: decision R6, the C9 licence (D7: a second tokenizer is acceptable only while this test agrees on every start tag of every corpus file and the edge-case shapes), and that the case re-runs on every `effect` bump (`test/upstream-xml.test.ts` is the canary for upstream shape; this test is the proof for `locate`). No timing assertion (plan lock 8); end tags are not compared (`locate` returns start tags only). red_first is `no`: the slice changes no library code; the spike agreed on 416 of 416 start tags under a stricter name-matched convention, so the case passes once written and the runner records the printed table.

Rules: R-files, R-test, R-check, R-commit (`test(positions):`). Check: `bun x vp test src/positions.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-6: U04 `position` on `XmlDecodeError`, the message rule, and `withPosition`

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: m2-1
- red_first: yes
- status: pending

Precondition: M1 units `M1-U05` and `M1-U09` are accepted (`M1-U09` is the last M1 writer of `src/issue.ts`; `phase-1.md` lines 316-327 and 368-379 describe what they land: `XmlDecodeError { reason; path; message }` with reasons `Schema`, `UndeclaredPrefix`, `WellFormedness`; `formatMessage({ what, path, expectation, repair })`; `xpath(segments)`; `translate`; `toDecodeError`). Adapt the field and function names below to what landed; the capabilities are the lock.

In `src/issue.ts`: (a) `XmlDecodeError` gains `position`, an **optional key** typed by `Position` imported as a type from `./positions.ts` (plan lock 3: never `null`, never an `undefined`-valued key; AGENTS.md "Schema intent"). If the class is `Schema.TaggedError`, declare a `PositionSchema = Schema.Struct({ line: Schema.Int, column: Schema.Int })` beside it and use `Schema.optionalKey(PositionSchema)` (`node_modules/effect/src/Schema.ts:2406`, `:8010`, `:3597`); if it is `Data.TaggedError`, `readonly position?: Position`. `XmlEncodeError` gains nothing. (c) `formatMessage` accepts an optional `position` and renders `<what> at <xpath> (line L, column C): <expectation>; <repair>` when it is given, the M1 form otherwise (R-errors). (d) `withPosition(error: XmlDecodeError, position: Position): XmlDecodeError` returns an error with the same `reason` and `path`, `position` set, and `message` re-rendered through `formatMessage`; for reason `WellFormedness` the re-rendered expectation is the upstream `XmlError.message` with its trailing ` at line L, column C` removed (`/ at line \d+, column \d+$/`; upstream appends exactly that suffix, `Xml.ts:1044`; plan lock 5: the position appears once, in the parenthetical). Keep the pieces `formatMessage` needs (`what`, `expectation`, `repair`) recoverable from the error or its reason so `withPosition` re-renders rather than string-edits the M1 message; if M1 landed them only inside `message`, store them on the reason or in a module-private carrier in this slice and say so in the doc comment.

Tests in `src/issue.test.ts`: `formatMessage` with `position` `{ line: 23, column: 3 }` renders exactly one ` (line 23, column 3)` between the path and the colon, and without it renders the M1 form (assert with regexes `/ at \S+ \(line 23, column 3\): /` and `/ at \S+: /`); `withPosition` on an M1-shaped `Schema` error keeps `reason` and `path`, sets `position`, and its message matches `/ at \S+ \(line \d+, column \d+\): /`; `withPosition` on a `WellFormedness` error built from an `XmlError` whose `message` ends `at line 1, column 8` renders ` (line 1, column 8)` and the string `line 1` occurs exactly once in the message; an error built without `position` has no own `position` key (`Object.hasOwn(error, "position")` is `false` when the class is `Data.TaggedError`; for `Schema.TaggedError`, `"position" in error` is `false` or the encoded form omits the key, whichever the class exposes); `Effect.catchReason("XmlDecodeError", "Schema", …)` (`Effect.ts:5144`) still selects an error with `position` set. red_first: stub `withPosition` as the identity and leave `formatMessage` ignoring `position`, so the parenthetical assertions fail first.

Rules: R-effect, R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). Run the `consequences` lens before landing (plan: fields added to the public error are read by handlers written against M1; the addition is an optional key, so M1-shaped handlers keep working). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-7: U04 `elementPath` on the `Schema` reason from `translate`

- write_scope: `src/issue.ts`, `src/issue.test.ts`
- deps: m2-6
- red_first: yes
- status: pending

Precondition: as m2-6 (`M1-U05`, `M1-U09` accepted). `translate` already walks the input element's children to compute the one-based same-name index for printing (plan lock 6, `phase-1.md:373`).

In `src/issue.ts`: (b, first half) the `Schema` reason gains `elementPath: ElementPath` (type import from `./positions.ts`; a required field: it is the structured locator the codec hands to `locate`, plan lock 6). `WellFormedness` gains nothing (its position is on the cause). (e) `translate` records, for each element segment it emits, the zero-based index of that child among the parent's **element** children alongside the one-based same-name index it already computes; `toDecodeError` fills `elementPath` from those segments, each step's `local` being the local part of the element's Clark name (never the plan marker's `wire`, whose prefix may differ from the text's); an attribute or `text()` leaf contributes no step (the path ends at the enclosing element); a missing required child ends at the parent; a root-level issue is `[{ local: <root local>, index: 0 }]`. The only constructor of the `Schema` reason is `toDecodeError` in this file (`phase-1.md:373`); `UndeclaredPrefix` is m2-8.

Tests in `src/issue.test.ts`, with `compile(lower(...))` definitions as the M1-U09 tests build them: the `max-choices="x"` case yields `elementPath` `[{qti-assessment-item,0},{qti-item-body,i},{qti-choice-interaction,j}]` with `i` and `j` the positional indices of those children in the hand-built element (compute them from the element you construct, do not hard-code a guess); a namespaced element (`{u}p`) yields a step with `local` `p`; a bad attribute on the second of two `<p>` preceded by one other element child yields a last step `{ p, 2 }` while the printed `path` still says `p[2]` (positional and same-name indices differ by design); a sole `<p>` yields `{ p, k }` with `k` its position among the parent's element children and prints `p` unindexed; a missing required child yields the parent's step last; a root-level issue yields a one-step path with index `0`. red_first: before the change the reason has no `elementPath`, so stub it as `[]` and see the `[{…},{…},{…}]` assertion fail on value.

Rules: R-effect, R-doc, R-files, R-test, R-check, R-commit (`feat(issue):`). `consequences` lens as in m2-6 (a required field on a reason is additive for handlers that read M1 fields). Check: `bun x vp test src/issue.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-8: U04+U05 `elementPath` on `UndeclaredPrefix` and its resolver call site

- write_scope: `src/issue.ts`, `src/issue.test.ts`, `src/resolve.ts`, `src/resolve.test.ts`
- deps: m2-7
- red_first: yes
- status: pending

Precondition: `M1-U05`, `M1-U09` (`src/issue.ts`) and `M1-U08` (last M1 writer of `src/resolve.ts`; `M1-U06` landed `resolveEvents()` with its scope stack and the `UndeclaredPrefix` failure at the as-written path, `phase-1.md:329-340`) are accepted.

This slice adds a required field and updates its one call site together (a required field travels with its constructors the way a rename travels with its call sites; cutting them apart would leave `src/resolve.ts` failing the program-wide type check between the two). In `src/issue.ts`: (b, second half) the `UndeclaredPrefix` reason gains `elementPath: ElementPath`. In `src/resolve.ts`, `resolveEvents()`: each scope-stack frame keeps a count of element children started under it; on `StartElement` the resolver computes the step `{ local: <as-written local part of the element name>, index: <parent count before increment> }` and pushes it with the frame; when the element fails with `UndeclaredPrefix` (an undeclared prefix on the element name or on one of its attribute names), the reason receives the full `elementPath` from the root to this element alongside the as-written printed `path`; the counter and step are dropped on `EndElement` with the frame. No other resolver behavior changes.

Tests: in `src/issue.test.ts`, `UndeclaredPrefix` constructs with `elementPath` and `Effect.catchReason("XmlDecodeError", "UndeclaredPrefix", …)` still selects it (update the M1-U05 construction sites in this file to pass the field). In `src/resolve.test.ts` (`it.effect`, events via `Stream.make(xml)` through `Xml.decodeString()` and `resolveEvents()`): `<root><a/><b><foo:bar/></b></root>` fails with reason `_tag` `UndeclaredPrefix`, `path` `/root/b/foo:bar`, and `elementPath` `[{root,0},{b,1},{bar,0}]`; `<root><x foo:k="1"/></root>` fails with `elementPath` `[{root,0},{x,0}]`; the existing M1-U06/U07/U08 cases in the file are unchanged and green. red_first: before the change the reason has no `elementPath`; stub the resolver to pass `[]` and see the `[{root,0},{b,1},{bar,0}]` assertion fail on value.

Rules: R-effect, R-doc, R-files, R-test, R-check, R-commit (one commit, `feat(resolve):`, body naming the `issue` field it adds). Check: `bun x vp test src/issue.test.ts` and `bun x vp test src/resolve.test.ts` (two invocations: a two-filter run exits 0 when either file matches, so it cannot catch a missing file; report both counts).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-9: U06 `locate` wired into `decodeString` and the two type exports

- write_scope: `src/codec.ts`, `src/codec.test.ts`, `src/index.ts`
- deps: m2-2, m2-8
- red_first: yes
- status: pending

Precondition: `M1-U11` (`src/codec.ts`: `decodeString(Def)` built as `Stream.make(xml)` through `Xml.decodeString()`, `resolveEvents()`, `collect(["*"])`, then `Schema.decodeUnknownEffect` with `SchemaError` mapped by `toDecodeError` and `XmlError` mapped to reason `WellFormedness`, under the span `xml.decodeString`; `phase-1.md:394-405`) and `M1-U12` (`src/index.ts` named re-exports; `:407-418`) are accepted.

In `src/codec.ts`, `decodeString(Def)`: add one failure-path step after the error is built, a module-private `attachPosition(xml: string, error: XmlDecodeError): XmlDecodeError`: for reason `Schema` or `UndeclaredPrefix`, `locate(xml, reason.elementPath)` (`./positions.ts`) and `withPosition` (`./issue.ts`, m2-6) on `Some`, the error unchanged on `None` (`Option.match`, `Option.ts:418`); for reason `WellFormedness` leave the error unchanged in this slice (`// m2-10`). The success path is untouched (plan lock 4: no scan on success, never a default cost on the decode path); the `xml.decodeString` span still wraps the whole call including this step; no new span, no log (`.agents/skills/trace-effect/SKILL.md`). In `src/index.ts`, add `export type { ElementPath, Position } from "./positions.ts";` and nothing else: `locate`, `ElementStep`, `PositionedEvent`, and `decodeStringWithPositions` stay unexported (plan locks 4 and 6; a consumer reads a step as `ElementPath[number]`).

Tests in `src/codec.test.ts` (`it.effect`), with the in-test definition from M1-U11 (its `qti-item-body` already declares `qti-choice-interaction` with `max-choices: Schema.Int`; if it does not, extend it in this slice, which the plan allows) on `bg007-true-false.xml` read by path: replacing `max-choices="1"` with `max-choices="x"` (line 23, column 3 is `<qti-choice-interaction`) fails with `position` `{ line: 23, column: 3 }` and a message matching `/ at \/qti-assessment-item\/qti-item-body\/qti-choice-interaction\/@max-choices \(line 23, column 3\): /`; inserting `<foo:bar/>` immediately after `<qti-item-body>` on line 21 (which starts at column 2 and is 15 characters) fails with reason `UndeclaredPrefix` and `position` `{ line: 21, column: 17 }`; the unmodified file decodes to the same value as before this slice (`toEqual` against a decode made before the change, or the M1 assertions unchanged); the M1-U11 span test still sees exactly one `xml.decodeString` span per call on success and on failure. The export has no test of its own: `dist/index.d.ts` naming `Position` is the verify seat's build check (plan criterion 12). red_first: stub `attachPosition` as the identity so the `position` assertions fail on `undefined`.

Rules: R-effect, R-guide, R-doc, R-files (the `.ts`-extension re-export resolves in `dist/index.d.ts`), R-test, R-check, R-commit (`feat(codec):`; the `src/index.ts` line is the same story). Check: `bun x vp test src/codec.test.ts` (and `bun x vp check src/index.ts` for the export line, as advice).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-10: U06 `WellFormedness` positions copied from the upstream `XmlError`

- write_scope: `src/codec.ts`, `src/codec.test.ts`
- deps: m2-9
- red_first: yes
- status: pending

Precondition: as m2-9 (`M1-U11`, `M1-U12` accepted).

In `src/codec.ts`, replace the `// m2-10` branch of `attachPosition`: for reason `WellFormedness`, when the cause `XmlError` has both `line` and `column` as numbers (`Xml.ts:51-56`: both are `number | undefined`; use `Predicate.isNumber`), `withPosition(error, { line, column })`; otherwise the error is unchanged. `locate` is never run on a document upstream rejected (plan lock 5). `withPosition` (m2-6) strips upstream's ` at line L, column C` suffix from the expectation, so the position appears once; review the rendered message under `.agents/skills/error-messages/SKILL.md` here (what, path, expectation, repair, neutral tone).

Tests in `src/codec.test.ts` (`it.effect`): `"<a><b></a>"` fails with reason `WellFormedness` whose `position` equals the cause's `line` and `column` (read them from `reason` and compare), whose message matches `/ \(line \d+, column \d+\): /` and does not match `/ at line \d+, column \d+$/` (upstream's suffix is gone), and in which the string `line ` occurs exactly once; a malformed document whose `XmlError` carries no `line`/`column` is not constructible through `decodeString` on this version (the parser always sets them), so no such case is written; say so in a one-line comment. red_first: before the change the `WellFormedness` branch leaves the error unchanged, so the `position` assertion fails on `undefined`.

Rules: R-effect, R-guide (Predicate), R-errors, R-doc, R-files, R-test, R-check, R-commit (`feat(codec):`). Check: `bun x vp test src/codec.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-11: U07 QTI C10 at 5 (line and column on the three breakages)

- write_scope: `test/qti/errors.test.ts`
- deps: m2-9
- red_first: no
- status: pending

Precondition: `M1-U16` is accepted (`test/qti/errors.test.ts` exists, imports `./vocabulary.ts`, and builds variants of `bg007-true-false.xml` by string replacement; `phase-1.md:459-470`).

Check first: confirm with `grep -n` that lines 2, 21, 22, 23 of `spikes/fixtures/qti/bg007-true-false.xml` still begin `<qti-assessment-item` (column 1), ` <qti-item-body>` (column 2), `  <p>` followed by the item's prompt text (column 3), and `  <qti-choice-interaction max-choices="1` (column 3); the positions below were read from that text. Add three `it.effect` cases to the existing file: (a) bad attribute value, `max-choices="x"`: `position` `{ line: 23, column: 3 }`, message matching `/ at \/qti-assessment-item\/qti-item-body\/qti-choice-interaction\/@max-choices \(line 23, column 3\): /` and naming a finite number (`/finite/i`); (b) missing required child, the whole `<qti-item-body>…</qti-item-body>` block removed (lines 21 to its closing tag; cut by string indices in the test): `path` `/qti-assessment-item`, expectation naming `qti-item-body`, `position` `{ line: 2, column: 1 }`; (c) unknown element, `<em>x</em>` inserted immediately after `<p>` on line 22 (`<p>` starts at column 3 and is 3 characters, so `<em` is at column 6): `path` ending `p/em`, expectation naming the declared `mixed` members, `position` `{ line: 22, column: 6 }`; each message contains no newline (one line a renderer can show) and passes the R-errors checklist by inspection. If (c) does not print `em` because the M1 `AnyOf` translation did not surface an unmatched `mixed` member, assert nothing false: report the measured `path` and `position` in the slice report and stop; the repair belongs to `src/issue.ts` (a rework slice), not to this test. red_first is `no`: the slice changes no library code; the assertions pin behavior landed by m2-9 and the runner records the first run.

Rules: R-files, R-test, R-check, R-commit (`test(qti):`). Check: `bun x vp test test/qti/errors.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-12: U08 upstream pins for the three M2 facts

- write_scope: `test/upstream-xml.test.ts`
- deps: none
- red_first: no
- status: pending

Precondition: `M1-U13` is accepted (it extends the same `describe("effect/encoding/Xml")`, `test/upstream-xml.test.ts:8-25` on this checkout).

Add three `it.effect` cases to the existing `describe`, each against literal strings, each with a one-line comment naming the dependent module: (a) one output chunk per input chunk: `Stream.fromIterable(["<a>", "<b/>", "</a>"])` through `Stream.rechunk(1)`, `Stream.pipeThroughChannel(Xml.decodeString())`, then `Stream.chunks` (`node_modules/effect/src/Stream.ts:12432`) before `Stream.runCollect`, so chunk boundaries survive collection (`Stream.runCollect` alone flattens them; `Channel.runCollect`, `Channel.ts:11589`, is the equivalent over the bare channel), yields exactly three chunks whose `_tag`/`name` sequences are `[StartElement a]`, `[StartElement b, EndElement b]`, `[EndElement a]` (`positions`' channel rests on this; `Xml.ts:281-282`); (b) a malformed document (`"<a><b></a>"`) fails with an `XmlError` whose `line` and `column` are numbers and whose `message` matches `/ at line (\d+), column (\d+)$/` with the same two numbers (`issue`'s `withPosition` strips exactly this suffix; `codec` copies the numbers; `Xml.ts:51-56`, `:1044`); (c) positions count the raw input: `"<a>\r\n<b></a>"` fails with `line` `2` (CRLF is one line end; `Xml.ts:44-45`; `positions` counts the same way). At least three more tests in the file than before this slice. red_first is `no`: these pin behavior upstream already has.

Rules: R-test, R-check, R-commit (`test:`). Check: `bun x vp test test/upstream-xml.test.ts`.

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### m2-tidy: Tidy the milestone 2 change

- write_scope: `src/positions.ts`, `src/positions.test.ts`, `test/fixtures/edge-cases.xml`, `src/issue.ts`, `src/issue.test.ts`, `src/resolve.ts`, `src/resolve.test.ts`, `src/codec.ts`, `src/codec.test.ts`, `src/index.ts`, `test/qti/errors.test.ts`, `test/upstream-xml.test.ts`, new files under `src/` and `test/fixtures/`
- deps: m2-1, m2-2, m2-3, m2-4, m2-5, m2-6, m2-7, m2-8, m2-9, m2-10, m2-11, m2-12
- red_first: no
- status: pending

Apply the cleanliness lens to the files this phase changed, with no behavior change: remove the `// m2-N` placeholders left by the chained slices; make sure the two custom pieces in `src/positions.ts` each carry the R-native justification once and the deferral notes (attribute and `Text` positions) read as present-tense invariants; dedupe test helpers that two files grew independently (a fixture reader shared by `src/positions.test.ts` and `src/codec.test.ts` may move to a new kebab-case file under `test/fixtures/` only if both files then import it by relative path); align doc comments with R-doc; extract a helper into a new kebab-case file under `src/` only when a function has grown past easy reading, and `src/index.ts` must then re-export nothing new (`grep -nE "decodeStringWithPositions|\blocate\b|ElementStep" src/index.ts` must print nothing). You may restructure tests without changing what they assert; add none. The existing tests covering the scope must pass unchanged. Run `bun x vp fmt --check <changed files>` and the narrow test of each file you touch; do not run `bun run check`/`build`/`test`. A behavior change found while tidying is reported as a follow-up and not made. If nothing needs changing, report "no changes".

Rules: R-doc, R-native, R-files, R-check, R-commit (`refactor:`). Check: `bun x vp test src/positions.test.ts src/issue.test.ts src/resolve.test.ts src/codec.test.ts test/qti/errors.test.ts test/upstream-xml.test.ts` (six files; confirm `Test Files 6 passed` and report the count, R-check).

R-scope: change only the files in write_scope. If the work needs any other path, change nothing and report blocked-scope with the paths and the reason. Report work found outside the slice as a follow-up instead of doing it. Never destroy or overwrite work you did not make, and never rewrite accepted or shared history.

### Notes

- Nothing is already delivered: on `d186f87`, `src/` holds only the comment-only `src/index.ts` and `test/` only `test/upstream-xml.test.ts`; `bun x vp test src/positions.test.ts` prints `No test files found, exiting with code 1`. Every unit M2-U01..U08 is covered: U01 m2-1..2; U02 m2-3..4; U03 m2-5; U04 m2-6..8; U05 m2-8; U06 m2-9..10; U07 m2-11; U08 m2-12.
- M2-U04 (b) and M2-U05 are fused in m2-8 on purpose. The plan adds a required `elementPath` to `UndeclaredPrefix` in `src/issue.ts` (U04) and supplies it from `src/resolve.ts` in the next unit (U05); landed apart, the tree fails the program-wide type check between them. The field and its one constructor land in one slice, which keeps every slice integrable alone, as the plan's unit table promises. The `Schema` reason has no such split: its only constructor is `toDecodeError` in `src/issue.ts` (m2-7).
- Cross-phase order: the factory maps each `Precondition:` M1 unit to its accepted M1 slices and dispatches an M2 slice on an M1 file only after them, and after any M1 slice that rewrites that file (an M1 tidy slice included) is accepted, so that no M2 slice edits a file an M1 seat still holds. The M1 slice list on this checkout is an uncommitted working file; it is not cited by slice id here.
- Dependencies follow the plan's unit graph in direction, with one shortening the files allow: m2-11 (QTI C10) needs only the `locate` wiring (m2-9), not the `WellFormedness` copy (m2-10), and the two write disjoint files, so they run in parallel and the longest chain is 7 rather than 8.
- Shared files are chained, never raced: `src/positions.ts`/`src/positions.test.ts` carry U01, U02, U03 in one chain (m2-1 → m2-5); `src/issue.ts` carries U04 and the U05 field (m2-6 → m2-8); `src/codec.ts` carries U06 (m2-9 → m2-10). m2-12 and the positions chain share no file with anything and start at once. No two slices without a `deps` path between them share a file.
- Hand-checked positions in the briefs were re-derived on this checkout: `awk '{ i=index($0,"<"); if (NR==2||NR==21||NR==22||NR==23) print NR": col "i }' spikes/fixtures/qti/bg007-true-false.xml` prints `2: col 1`, `21: col 2`, `22: col 3`, `23: col 3`; `awk 'NR==26 { print index($0,"<qti-text-entry") }' spikes/fixtures/qti/bg010-missing-word.xml` prints `43`; `spikes/error-positions/edge-cases.xml` lines 7, 9, 12, 14, 15 read `<root attr=…`, `  <a>`, `  /><b`, `  <c>`, `  <d><!-- < --><e/></d>`; `grep -lc $'\r' spikes/fixtures/qti/*.xml spikes/error-positions/edge-cases.xml` matches nothing, so CRLF is covered by the `replaceAll` variants, not by the corpus. `ls spikes/fixtures/qti/*.xml | wc -l` prints `15`; the tests measure the count rather than write it.
- The plan's milestone-close greps and the verify gate (`bun run check && bun run build && bun run test`; the Vitest run must include `src/positions.test.ts` and quote the printed agreement table) stay with the verify seat; no slice runs them. Review lenses the plan names (`consequences` on m2-6/m2-7, `correctness` on m2-1..m2-3, `error-messages` on m2-6/m2-10, `trace-effect` on m2-9) run at review, not as slice checks.
- Corrected on handle `6418eee3` per aggregate slice audit `f2edd498` (F5): m2-8's check is split into two single-file invocations and m2-tidy's check confirms the `Test Files` count; R-check carries the two-filter caveat the phase-3 cut found. Ids, deps, and the chain are unchanged; no slice was accepted or in progress.
- Line numbers above were read at `d186f87`; spike files are frozen R&D and `node_modules/effect` is pinned at `4.1.2`, so they hold until either moves.
