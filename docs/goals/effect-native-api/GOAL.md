# Goal: Effect-native public API

Status: accepted (2026-11-05) under the owner's acceptance terms (`work/owner-directive-api-followups.md` item 4). Follow-up batch enf-1..enf-7 + enf-docs built; ladder green at `a56b886` (31 files, 615 passed, 2 capability-gated skips); gate audits `07fc751e` and `36750066` pass-with-findings, every finding fixed (ena-44, enf-7; the enf-7 fix re-verified against the built package: XML 1.0 §2.3 names such as `हिन्दी`, NFD `café`, `a‿b` declare and round-trip; `a²`, `$text`, `*`, `1x` are refused). Next phase: want `86a9ce88` (performance), started.

## Objective

Make the public API of `@aidenzepp/effect-xml` read as an Effect module, and fix the nine behavior and message bugs, as recommended in `docs/rd/effect-native-api-review.md` (commit `379bd14`). Internals need not look Effect-built; the API must.

## Owner decisions (2026-11-05, settled; do not re-ask)

- Build bugs 1-9 and R1-R8 from the review.
- O1-O10 take the review's planner defaults (review section 6):
  - O1 names: namespace `XmlSchema`; `fromString`; `ElementFromString`; `decodeSchema` / `decodeSchemaString`; `Array`; `optionalKey`; `DecodeError` / `EncodeError` (tags unchanged); `Element`; `equivalence`; extractor `decodeErrorOf`.
  - O2: drop `decodeString`, `encodeString` and `decodeTree` from the public surface; export `decodeErrorOf`; the README shows the `SchemaError` to `DecodeError` catch pattern.
  - O3: bytes with positions keep today's `WellFormedness` "invalid UTF-8" failure (fatal UTF-8 channel), never silent U+FFFD.
  - O4: nothing is published, so this is one breaking batch. Order only by dependency; the R4 namespace renames land last.
  - O5: `canonicalize` becomes internal.
  - O6: text runs in `mixed` are tagged `"#text"`.
  - O7: an attribute key that equals the content key or a slot key is a `DefinitionError` at definition time.
  - O8: thread `RD`/`RE` through the element types and the entry points, on R1's carrier.
  - O9: widen `Limit` (`maxDepth`, `maxTokenSize`, optional `element`) and add an `Unsupported` reason.
  - O10: `DefinitionError` is a plain `Error` subclass.
- R9 (owner addition, `work/owner-directive-tokenizer-seam.md`): `XmlSchema.Tokenizer` as a `Context.Reference` defaulting to `effect/encoding/Xml`, plus a reusable tokenizer conformance suite. Lands with R2/R3, before R4. Native-position ruling: review section 7.
- Extra message gap: the undeclared-attribute message (`src/compile.ts`, "declared attributes: ...") omits a declared `data-*` group; list it.
- Keep as is: review section 5.

## Constraints

- `private: true`, version `0.0.0`. Do not publish, push, or create remotes.
- Full ladder (`bun run check`, `bun run build`, `bun run test`) plus a gate audit against this document and the review before the goal closes.
- Build in parallel under the standing parallelism directive (`work/owner-directive-parallelism.md`).

## Done when

- Every bug 1-9 has a regression test that failed before its fix.
- No module outside the default tokenizer calls `Xml.*` directly; the conformance suite runs against the default and an override test proves the override is used.
- R1-R9 are in the public surface under the O1 names, exported only through `export * as XmlSchema`; `decodeString`, `encodeString`, `decodeTree`, `canonicalize`, `normalizedNames` and the default-limit constants are not exported.
- README and `docs/onboarding.md` describe the new surface, including the `SchemaError` to `DecodeError` catch pattern, and `test/readme.test.ts` runs the README examples.
- The ladder is green and the gate audit passes.

## Slices

`docs/goals/effect-native-api/slices.md`

## Next phase

Want `86a9ce88` (owner): performance analysis and optimization to match or beat the best XML parsers. It starts only after this goal is accepted.

## Owner rulings on the open decisions (2026-11-05, `work/owner-directive-api-followups.md`)

1. Add `XmlSchema.encodeErrorOf` (`SchemaError` issue to `Option<EncodeError>`); the README's encode-error claim becomes true, with an example.
2. The helper types `element()` uses are nested in a namespace declaration-merged with `element` (Effect pattern: `Schema.ts:3356` `declare namespace Struct`, `:3492` interface, `:3597` function), with names that read naturally under it; no flat helper-type exports remain.
3. Reserved content keys are `$text` and `$children`; the `mixed` text-run tag is `"$text"` (replaces O6's `"#text"`). The O7 definition-time rejection for `text`/`children` is removed; a slot key equal to an attribute name stays rejected. Precedent check: Effect reserves `$`-prefixed members (`Data.ts:791-793` `$is`/`$match`) and JSON Schema uses `$ref`/`$defs`; nothing argues against `$`.
4. Acceptance: once 1-3 land with the ladder and gate audit green, this batch is accepted and want `86a9ce88` (performance) starts without a further owner reply.
5. Upstream: Effect-TS/effect#10406 (closes #10400) adds `positions: true` to `Xml.decode`/`decodeString`; unreleased (npm latest 4.1.2). When released: bump `effect` and the `@effect/vitest` pin, let the default tokenizer declare native positions, re-rule D7, and make `locate` a fallback or remove it on measured evidence. Checked during the performance phase.
