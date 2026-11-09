# Spike plan

Seven bounded, throwaway spikes. Each runs in its own directory under `spikes/`, shares no code with the others (copy, do not import), reads fixtures from `spikes/fixtures/qti/` (owned by SPIKE-00, read-only here), and ends with a `RESULT.md` scoring its approaches against `criteria.md` with evidence, plus a runnable test. They can run in parallel. Spike code never enters `src/` and is not imported by anything outside its directory.

Shared conventions:

- Run command: `bun test spikes/<name>` (settled by SPIKE-00 in `spikes/README.md`; commit `302a9f1`). Spikes run under `bun:test`, not Vitest, so `@effect/vitest` and `it.effect` are unavailable; use `Effect.runPromise` as `spikes/smoke/smoke.test.ts` does. Record the command and the number of tests executed in RESULT.md.
- Type checks: `bun test` does not type-check. `expectTypeOf` from `bun:test` is fine for writing assertions, but the spike must also paste a passing `bun x tsc --noEmit --strict --skipLibCheck --module nodenext --moduleResolution nodenext --types bun --ignoreConfig --allowImportingTsExtensions spikes/<name>/*.ts` (or an equivalent per-spike `tsconfig.json`) into RESULT.md, because `spikes/` is outside the repository `tsconfig.json` include. Under the pinned `typescript@7.0.2` the two extra flags are required: without `--ignoreConfig` tsc refuses file arguments while a `tsconfig.json` is present (TS5112), and without `--allowImportingTsExtensions` the `./x.ts` sibling imports Bun needs fail (TS5097). All seven spikes hit this (correction 5 in `decisions.md`). Run `bun x vp fmt spikes/<name>` before committing; lint and the library test include exclude `spikes/`.
- `RESULT.md` sections, in order: question; approaches compared; per-criterion scores table with evidence pointers; the deciding evidence; what was not implemented; recommendation; open questions.
- Gates on the repository (`bun run check`, `bun run build`, `bun run test`) are owned by the lint, test, and merge seats; a spike's sanity is its own run command.
- "Benchmark subset" means the `qti-assessment-item` subset defined in `branches/declaration-dsl.md`.
- Effect guidance: `node_modules/effect/AGENTS.md`, `.agents/skills/effect-design/SKILL.md`. Effect error channels only; no try/catch.
- Est size: S = one short sitting (about an hour of a Hand's turn), M = one full sitting. Nothing larger is allowed; split before starting if it is.

## SPIKE-01 mixed content representation

- **Questions.** `branches/mixed-content.md`: ordered array with discriminated union (A) versus named fields plus text channel (B); note on tree with order index (C).
- **Approaches compared.** A and B, each as a definition of `p`, `strong`, `br`, `qti-text-entry-interaction` and `qti-simple-choice` over the upstream `Xml.Element` tree (use `Xml.elements([root])` to obtain it; no namespace handling, match names as written).
- **write_scope.** `spikes/mixed-content/**`.
- **Must produce.** `RESULT.md`; `mixed-content.test.ts` that for both approaches decodes the `<p>` holding the inline interaction in `bg010-missing-word.xml`, the two inline interactions in one `<p>` in `text-entry-cloze.xml`, the `qti-hottext` runs in `hottext.xml`, and the `<p>` runs in `bg011-media.xml`, renders them to a string in document order, and encodes back to an `Element` equal to the input under a local deep-equality after dropping whitespace-only children in `elements` mode. Count the renderer lines for C3.
- **Criteria scored.** C1, C3, C7, C8; others `n/a`.
- **done_when.** Both approaches decode and render `bg010-missing-word.xml` and `bg011-media.xml` in order; the test passes; RESULT.md has scores with evidence and a recommendation.
- **Est size.** M.

## SPIKE-02 namespace resolution

- **Questions.** `branches/namespaces.md`: expanded names at decode (A, with the schema-side prefix map from C as the naming convenience) versus prefix-as-written (B); `xml:lang`, `xsi:schemaLocation` as ordinary attributes; where `xsi:type` would get its scope.
- **Approaches compared.** A: an event-walking resolver that maintains the in-scope map and produces a tree whose names are `{ namespace, local }` and whose attributes are keyed the same way, plus an encoder that re-emits with a declared prefix map. B: literal name matching on the upstream tree.
- **write_scope.** `spikes/namespaces/**`.
- **Must produce.** `RESULT.md`; `namespaces.test.ts` that decodes `bpig-mathml.xml` and `imsmanifest.xml` with both approaches (note: `bpig-mathml.xml` re-binds the default namespace to MathML on an inner `<math>`, which is the case that separates A from B), then decodes a re-prefixed copy (written under the spike directory) and asserts equality for A and failure for B; asserts an unprefixed attribute has no namespace; encodes A's tree and checks the result decodes to the same resolved tree.
- **Criteria scored.** C1, C4, C5, C9, C10 (for the undeclared-prefix error only); others `n/a`.
- **done_when.** The three C4 checks run and are reported for both approaches; resolver line count recorded for C9; test passes.
- **Est size.** M.

## SPIKE-03 round-trip promise and canonical comparator

- **Questions.** `branches/round-trip.md`: what the upstream codec loses (evidence for why byte identity is off the table) and whether a canonical equivalence holds across the corpus.
- **Approaches compared.** A: canonical equivalence via a comparator. B: byte identity, measured only as a loss inventory (which fixtures survive `decode -> encode` byte-for-byte, and which lexical facts changed).
- **write_scope.** `spikes/round-trip/**`.
- **Must produce.** `RESULT.md`; `canonical.ts` (under 80 lines: `Element -> string` canonical form: sorted attributes, whitespace-only children dropped outside a configurable inline-element set, text normalized); `round-trip.test.ts` that for every fixture runs `decodeString -> elements([root]) -> events -> encodeString -> decodeString -> elements([root])` and asserts canonical equality, and separately records byte equality and a diff summary per fixture (self-closing, entity form, attribute order, whitespace, declaration).
- **Criteria scored.** C5, C9; others `n/a`.
- **done_when.** Comparator published; canonical equality holds on every fixture or each failure is explained in RESULT.md; the byte-identity loss table is complete for the corpus.
- **Est size.** S.

## SPIKE-04 tree versus streaming, and limits

- **Questions.** `branches/tree-vs-streaming.md`: full tree (A) versus `Xml.elements` per-record hybrid (C); capability-gap record for event-driven Schema decode (B); whether `maxElementSize` tracks memory.
- **Approaches compared.** A: `Xml.elements([root])` then a tiny hand-written `Element -> value` mapper for the `qti-assessment-test` title and identifier and each `qti-assessment-item-ref`'s identifier, href, and weights (as run; the plan originally named `qti-assessment-item`, which the synthetic document does not contain). C: a synthetic `qti-assessment-test` (generated under the spike directory by repeating a fixture's sections; about 55 MB as generated, 55,063,873 bytes, because identifier prefixes add bytes after the repetition count is chosen), streamed with `Xml.elements([...pathToItemRef])`, same mapper per record.
- **write_scope.** `spikes/streaming/**`.
- **Must produce.** `RESULT.md`; `streaming.test.ts` that runs both on the synthetic file and records peak heap and wall time; a check whether the record `Element` from `Xml.elements` carries any ancestor `xmlns` or `xml:lang` (expected: no); a section listing the Schema APIs checked for incremental decode (`SchemaParser.decodeUnknownEffect`, `ChannelSchema.decode`, `Config.schema`'s cursor pattern) and the requirement each misses.
- **Criteria scored.** C6, C9; others `n/a`.
- **done_when.** Both measurements recorded with the command used; ancestor-scope check answered; gap record written per the effect-design rule.
- **Est size.** M.

## SPIKE-05 declaration surface

- **Questions.** `branches/declaration-dsl.md`: annotations on Schema fields (A) versus a parallel object-form DSL (B, with a note on a fluent facade C); convention-only (D) scored by counter-example.
- **Approaches compared.** A and B, each defining the benchmark subset and producing a `Schema.Codec` whose decode runs against the upstream `Element` tree via a single `Schema.decodeTo` transformation per element (the simplest layering; SPIKE-06 owns the layering question). Names matched as written; no namespace resolution.
- **write_scope.** `spikes/declaration-dsl/**`.
- **Must produce.** `RESULT.md`; `benchmark-a.ts` and `benchmark-b.ts` (the subset in each surface); `declaration-dsl.test.ts` that decodes `bpig-hotspot.xml` and `bg007-true-false.xml` with both, checks `expectTypeOf` assertions for C7, rejects `max-choices="x"` and an unknown attribute, accepts and types a `data-*` attribute, and encodes back to an `Element` canonically equal to the input (copy the comparator shape from SPIKE-03's description; do not import).
- **Criteria scored.** C1, C2, C7, C8, C9; others `n/a`.
- **done_when.** Both benchmark files compile and pass the test; line counts for C8 and C9 pasted with the command; D's counter-examples recorded.
- **Est size.** M.

## SPIKE-06 schema layering mechanism

- **Questions.** `branches/schema-layering.md`: `Element -> value` transformation per definition (A) versus Config-style AST rewrite with an XML cursor (B); evidence for whether a closed IR (C) would suffice.
- **Approaches compared.** A: `Schema.decodeTo(Target)(ElementSchema, transformation)` for a two-level struct with attributes and repeated children. B: take the same `Schema.Struct` with XML annotations (attribute versus child name) and rewrite its AST following `node_modules/effect/src/Config.ts:1140-1260` (`SchemaAST.decodeTo`, `SchemaGetter.transformEffect`, `SchemaAST.applyToSelfOrLastLinkEncoding`), with a cursor over `Xml.Element`; leaves through `Schema.toCodecStringTree`.
- **write_scope.** `spikes/schema-layering/**`.
- **Must produce.** `RESULT.md`; `layering.test.ts` that decodes `qti-response-declaration` with its `qti-correct-response`/`qti-value` children from `bg010-missing-word.xml` via both, forces an attribute type failure and prints the issue path each approach produces (`Schema.decodeEffect` fails with `Schema.SchemaError`; `SchemaParser.decodeEffect` yields the raw `SchemaIssue.Issue`; the library exposes the Effect-native `SchemaError` surface and keeps the `Issue` reachable through `SchemaParser`, `decisions.md` T2), and encodes back via B's mirror walk (events) and A's `Element`; a table of `SchemaAST` tags B had to handle and the `@stability` tag of each primitive used.
- **Criteria scored.** C1, C2, C9, C10 (path shape only); others `n/a`.
- **done_when.** Both decode the declaration; issue paths pasted; stability table complete; encode path demonstrated for both.
- **Est size.** M.

## SPIKE-07 error positions

- **Questions.** `branches/error-reporting.md`: position tracking beside the parser (B) versus post-hoc locate (C), both on top of path-only reporting (A).
- **Approaches compared.** B: a channel that re-chunks input at `<`, counts lines and columns, and tags each event with the start position of its chunk. C: a scanner that, given an element path such as `/qti-assessment-item/qti-item-body/p[2]` (XPath style, one-based same-named-sibling index: the second `p` under `qti-item-body`), finds the line and column in the original text, verified against B's answer on every fixture. The plan's original example `["qti-assessment-item", "qti-item-body", "p", 2]` was ambiguous (read zero-based it names a third `p` that `bg010-missing-word.xml` does not have); the library prints the one-based XPath form (`decisions.md` T2), and a scanner's internal convention is covered by its agreement test.
- **write_scope.** `spikes/error-positions/**`.
- **Must produce.** `RESULT.md`; `positions.test.ts` that for every fixture compares B's start-tag positions for all elements with C's located positions (must agree) and with a hand-checked value for two elements per fixture; throughput of B relative to plain `decodeString` on the largest fixture.
- **Criteria scored.** C9, C10; others `n/a`.
- **done_when.** Agreement table complete; throughput ratio recorded with command; recommendation names the default.
- **Est size.** S.

## Independence check

| Spike | Directory                 | Reads    | Writes shared code                        |
| ----- | ------------------------- | -------- | ----------------------------------------- |
| 01    | `spikes/mixed-content/`   | fixtures | no                                        |
| 02    | `spikes/namespaces/`      | fixtures | no                                        |
| 03    | `spikes/round-trip/`      | fixtures | no (publishes `canonical.ts` for copying) |
| 04    | `spikes/streaming/`       | fixtures | no                                        |
| 05    | `spikes/declaration-dsl/` | fixtures | no                                        |
| 06    | `spikes/schema-layering/` | fixtures | no                                        |
| 07    | `spikes/error-positions/` | fixtures | no                                        |

Directories are disjoint; no spike imports another. SPIKE-00's `spikes/README.md`, `spikes/fixtures/**`, and `spikes/smoke/**` are outside every write scope above.

## After the spikes

The Mind routes RESULT.md files to the Planner for a goal-forge pass: the decision ledger in `README.md` is updated with evidence, reversed calls are recorded, and one GOAL.md is written. Spike directories are archived or deleted when the decision they informed is recorded in `docs/onboarding.md`. Done: `decisions.md` rules on all seven; `docs/onboarding.md` records them; the goal is `docs/goals/xml-schema-codec/GOAL.md`.
