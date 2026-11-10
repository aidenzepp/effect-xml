/**
 * The differential layer ladder: the per-layer profile of a bank decode, timed by adding one layer
 * to the pipeline at a time, from bare chunk transport through the tokenizer, resolver, collector,
 * Schema decode, and source positions, plus the whole-document, error-path, and chunk-size rungs,
 * and the typed ladders: a whole-document typed decode and encode split at each structural-path
 * layer.
 *
 * Wall time only: every rung runs in the one ladder process, so a rung's heap, RSS, and GC figures
 * would carry the residue of the rungs before it; the ladder reports no memory metrics.
 *
 * Run directly as `bun bench/profile/layers.ts` (or `node`) with `--input <id>` (repeatable;
 * default `bank-256k` and `bank-4m`), `--tokenizer <name>` (default `upstream`), `--smoke`, and
 * `--out <file>` (default `work/bench/layers-<runtime>-<time>.json`).
 */
import { parseArgs } from "node:util";

import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Record from "effect/Record";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { Xml } from "effect/encoding";

import { build as buildPlain } from "../../src/builder.ts";
import type { Plain } from "../../src/builder.ts";
import { decodeString, encodeString } from "../../src/codec.ts";
import { isResolvedElement } from "../../src/element.ts";
import type { ResolvedElement } from "../../src/element.ts";
import { XmlSchema } from "../../src/index.ts";
import type { Plan } from "../../src/plan.ts";
import { collect, resolveCollect, resolveEvents } from "../../src/resolve.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import { checkedStructuralOf } from "../../src/structural.ts";
import type { Tokenizer } from "../../src/tokenizer.ts";
import { toEventsFrom, writerOf } from "../../src/writer.ts";
import { ItemRef } from "../../test/streaming/vocabulary.ts";
import { environment } from "../harness/environment.ts";
import { fileTimestamp, isEntryPoint, writeJsonFile } from "../harness/script.ts";
import { defaultPolicy, floor, quantiles, sample, smokePolicy } from "../harness/sample.ts";
import type { SamplePolicy } from "../harness/sample.ts";
import { chunk, chunkBytes } from "../inputs/chunk.ts";
import { countTreeElements } from "../inputs/reference.ts";
import { loadInput } from "../inputs/synthetic.ts";
import { tokenizers } from "../tokenizers.ts";
import { CaseError } from "../types.ts";
import type {
  BenchDocument,
  BenchInput,
  Environment,
  Method,
  PreparedCase,
  Quantiles,
} from "../types.ts";
import { ItemBank, bankPath, bankPrefixes } from "../vocabulary.ts";

/**
 * One rung of the ladder: a pipeline over one bank input and the count it claims.
 *
 * A `differential` rung adds exactly one layer to the differential rung before it, so its median
 * minus that rung's median is the added layer's cost; the document and chunk-size rungs stand
 * beside the ladder and have no delta.
 */
export interface Rung {
  readonly id: string;
  readonly differential: boolean;
  /**
   * Prepare the rung on a bank input.
   *
   * @param input - A bank input with exactly one document.
   * @param tokenizer - The tokenizer every effect-xml stage reads.
   * @returns The prepared case, or a `CaseError` when the input is not one document.
   */
  readonly prepare: (
    input: BenchInput,
    tokenizer: Tokenizer,
  ) => Effect.Effect<PreparedCase, CaseError>;
}

/**
 * The parser limits a whole-document decode of a large bank needs: its root spans the whole
 * document, past the default 16 MiB `maxElementSize`.
 */
const unlimited = { maxElementNodes: Infinity, maxElementSize: Infinity };

/**
 * Read a streaming rung's output as the count it is.
 *
 * @param output - The number `Stream.runCount` returned.
 * @returns The count, or `-1` when the output is not a number.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `check` hands the rung's own opaque output back, so the value arrives untyped.
const countOf = (output: unknown): number => (Predicate.isNumber(output) ? output : -1);

/**
 * Construct a rung over the one document of a bank input.
 *
 * @param id - The rung id, named by a preparation failure as `layers/<id>`.
 * @param differential - Whether the rung adds one layer to the differential rung before it.
 * @param build - Prepare the case from the input's document, given the input and tokenizer.
 * @returns The rung.
 */
const rung = (
  id: string,
  differential: boolean,
  build: (document: BenchDocument, input: BenchInput, tokenizer: Tokenizer) => PreparedCase,
): Rung => ({
  differential,
  id,
  prepare: (input, tokenizer) => {
    const [document] = input.documents;

    return input.documents.length === 1 && document !== undefined
      ? Effect.sync(() => build(document, input, tokenizer))
      : Effect.fail(
          new CaseError({
            caseId: `layers/${id}`,
            reason: `Input ${input.id} has ${input.documents.length} documents; a ladder rung reads exactly one bank document.`,
          }),
        );
  },
});

/**
 * Tokenize chunks into upstream events.
 *
 * @param chunks - The document's text chunks.
 * @param tokenizer - The tokenizer that decodes them.
 * @returns The stream of tokenizer events.
 */
const tokenEvents = (
  chunks: readonly string[],
  tokenizer: Tokenizer,
): Stream.Stream<Xml.Event, Xml.XmlError> =>
  Stream.fromIterable(chunks).pipe(Stream.pipeThroughChannel(tokenizer.decodeString()));

/**
 * Construct the tokenizer rung, or one of its re-chunked variants.
 *
 * @param id - The rung id.
 * @param differential - Whether the rung sits on the ladder.
 * @param size - The chunk size in UTF-16 code units, or `None` for the input's own 64 KiB chunks.
 * @returns The rung counting tokenizer `StartElement` events.
 */
const tokenizerRung = (id: string, differential: boolean, size: Option.Option<number>): Rung =>
  rung(id, differential, (document, input, tokenizer) => {
    const chunks = Option.match(size, {
      onNone: () => document.chunks,
      onSome: (n) => chunk(document.text, n),
    });

    return {
      check: countOf,
      expected: input.reference.elements,
      run: () =>
        tokenEvents(chunks, tokenizer).pipe(
          Stream.filter((event) => event._tag === "StartElement"),
          Stream.runCount,
          Effect.runSync,
        ),
    };
  });

/**
 * Construct a record-stream rung over `XmlSchema.decodeSchemaString`.
 *
 * @param id - The rung id.
 * @param positions - Whether the channel stamps source positions.
 * @returns The rung counting decoded `ItemRef` records.
 */
const schemaRung = (id: string, positions: boolean): Rung =>
  rung(id, true, (document, input, tokenizer) => {
    const channel = XmlSchema.decodeSchemaString(ItemRef, bankPath);

    return {
      check: countOf,
      expected: input.reference.records,
      run: () =>
        Stream.fromIterable(document.chunks).pipe(
          Stream.pipeThroughChannel(channel({ positions })),
          Stream.runCount,
          Effect.provideService(XmlSchema.Tokenizer, tokenizer),
          Effect.runSync,
        ),
    };
  });

/**
 * The attribute the bad-last variant of a bank drops from its last record.
 */
const hrefAttribute = ' href="';

// Native: `effect/String` has no last-occurrence removal; the bad-last text is the bank's text with its last `href` attribute cut out, as `bench/inputs/synthetic.ts` writes `bank-<size>-bad-last`.
/**
 * Derive a bank's bad-last text: the same document with the last record's `href` removed.
 *
 * Deriving it from the input keeps every bank size, `bank-16k` included, on the error rung; for
 * `bank-256k` and `bank-4m` the result equals the registered `-bad-last` input's text.
 *
 * @param text - A bank document's text.
 * @returns The text without its last `href` attribute; unchanged when it has none.
 */
const withoutLastHref = (text: string): string => {
  const start = text.lastIndexOf(hrefAttribute);
  const end = start === -1 ? -1 : text.indexOf('"', start + hrefAttribute.length);

  return end < 0 ? text : text.slice(0, start) + text.slice(end + 1);
};

/**
 * Read an error-document output: 1 when the decode failed with an XML decode error of reason
 * `SchemaFailure`.
 *
 * @param output - The `Result` the error rung's run returned.
 * @returns `1` for the expected failure, `0` for anything else.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `check` hands the rung's own opaque output back, so the value arrives untyped.
const schemaFailureOf = (output: unknown): number =>
  Result.isResult(output) &&
  Result.isFailure(output) &&
  Schema.isSchemaError(output.failure) &&
  Option.exists(
    XmlSchema.findDecodeErrorOption(output.failure.issue),
    (found) => found.reason._tag === "SchemaFailure",
  )
    ? 1
    : 0;

/**
 * Read the record count of a decoded `ItemBank` value.
 *
 * @param output - The value a typed decode returned.
 * @returns The number of `refs`, or `-1` when the output has none.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `check` hands the rung's own opaque output back, so the value arrives untyped.
const refsOf = (output: unknown): number =>
  Predicate.hasProperty(output, "refs") && Arr.isArray(output.refs) ? output.refs.length : -1;

/**
 * The events of one whole document, read as `XmlSchema.fromString` reads them: the text as one
 * chunk through the tokenizer with no parser limits set.
 *
 * @param text - The document text.
 * @param tokenizer - The tokenizer that decodes it.
 * @returns The stream of tokenizer events.
 */
const documentEvents = (
  text: string,
  tokenizer: Tokenizer,
): Stream.Stream<Xml.Event, Xml.XmlError> =>
  Stream.make(text).pipe(Stream.pipeThroughChannel(tokenizer.decodeString({})));

/**
 * Collect one document's single resolved root, the pipeline `XmlSchema.fromString` runs before any
 * codec, without its error mapping, which costs nothing on a document that decodes.
 *
 * @param text - The document text.
 * @param tokenizer - The tokenizer that decodes it.
 * @returns The collected roots; one for a well-formed document.
 */
const documentRoots = (text: string, tokenizer: Tokenizer): readonly ResolvedElement[] =>
  documentEvents(text, tokenizer).pipe(
    Stream.pipeThroughChannel(resolveEvents()),
    Stream.pipeThroughChannel(collect(["*"], unlimited)),
    Stream.runCollect,
    Effect.runSync,
  );

/**
 * A Clark name no bank element has: as the whole collect path, it keeps `resolveCollect`'s
 * collector to its depth counting, so the fused rung times the resolving machine alone.
 */
const unmatchedRoot = "{urn:effect-xml:bench:none}none";

/**
 * Read the bank root's structural plan, as the faster decode and encode read it.
 *
 * @returns The plan, or `undefined` when `ItemBank` is not structural; the rungs built on it then
 *   return no value and fail their check.
 */
const bankPlan = (): Plan | undefined => structuralPlan(ItemBank);

/**
 * Read a structural-path output as present or absent.
 *
 * @param output - What the rung's run returned.
 * @returns `1` when the run produced a value, `0` when it returned `undefined`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `check` hands the rung's own opaque output back, so the value arrives untyped.
const presentOf = (output: unknown): number => (output === undefined ? 0 : 1);

/**
 * Construct a typed-decode rung whose run counts the events a pipeline yields, checked against
 * one untimed run of the same pipeline: the count only proves the run completed, and counting a
 * chunked stream costs one addition per chunk, so the rung carries no per-event filter that the
 * next rung would not.
 *
 * @param id - The rung id.
 * @param events - The pipeline from document text to the events it counts.
 * @returns The rung.
 */
const typedCountRung = (
  id: string,
  events: (text: string, tokenizer: Tokenizer) => Stream.Stream<unknown, unknown>,
): Rung =>
  rung(id, false, (document, _input, tokenizer) => {
    const run = (): number =>
      events(document.text, tokenizer).pipe(Stream.runCount, Effect.orDie, Effect.runSync);

    return { check: countOf, expected: run(), run };
  });

/**
 * Decode a bank document to its typed value once, outside any timed loop, for the encode rungs.
 *
 * @param text - The bank document's text.
 * @param tokenizer - The tokenizer the decode reads.
 * @returns The decoded bank.
 */
const bankValue = (text: string, tokenizer: Tokenizer): typeof ItemBank.Type =>
  Schema.decodeUnknownEffect(XmlSchema.fromString(ItemBank, unlimited))(text).pipe(
    Effect.provideService(XmlSchema.Tokenizer, tokenizer),
    Effect.runSync,
  );

/**
 * Encode a bank value with the root's structural codec to its plain encoded object, the first step
 * of the faster encode.
 *
 * @param plan - The bank root's structural plan.
 * @param value - The bank value.
 * @returns The plain encoded object.
 */
const encodeStructural = (plan: Plan, value: typeof ItemBank.Type): Plain =>
  Effect.runSync(
    // SAFETY: the structural codec runs exactly the leaf schemas of `ItemBank`, which need no
    // services, and its Encoded side is the plain object `toEventsFrom` reads.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the structural codec erases its Encoded side and services to `unknown` at the type level only.
    Schema.encodeUnknownEffect(checkedStructuralOf(ItemBank, plan))(value) as Effect.Effect<
      Plain,
      Schema.SchemaError
    >,
  );

/**
 * Construct an encode rung over a bank value decoded once in preparation; the encoded text has no
 * XML declaration, as `effect-xml/encode-typed` writes it.
 *
 * @param id - The rung id.
 * @param encode - The encode under measurement, given the bank's plan, its value, and the
 *   tokenizer; it returns `undefined` when a step refuses.
 * @param check - Read the run's output as the count it is checked against.
 * @param expected - The count `check` must return, given the input.
 * @returns The rung.
 */
const encodeRung = (
  id: string,
  encode: (
    plan: Plan,
    value: typeof ItemBank.Type,
    tokenizer: Tokenizer,
  ) => Plain | readonly Xml.Event[] | string | undefined,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `check` hands the rung's own opaque output back, so the value arrives untyped.
  check: (output: unknown, tokenizer: Tokenizer) => number,
  expected: (input: BenchInput) => number,
): Rung =>
  rung(id, false, (document, input, tokenizer) => {
    const value = bankValue(document.text, tokenizer);
    const plan = bankPlan();

    return {
      check: (output) => check(output, tokenizer),
      expected: expected(input),
      run: () => (plan === undefined ? undefined : encode(plan, value, tokenizer)),
    };
  });

/**
 * Read an encoded bank text back as its record count, outside the timed loop.
 *
 * @param output - The text an encode rung returned.
 * @param tokenizer - The tokenizer the re-decode reads.
 * @returns The bank's record count, or `-1` when the output is not a bank text.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `check` hands the rung's own opaque output back, so the value arrives untyped.
const encodedRecordsOf = (output: unknown, tokenizer: Tokenizer): number =>
  Predicate.isString(output)
    ? Schema.decodeUnknownEffect(XmlSchema.fromString(ItemBank, unlimited))(output).pipe(
        Effect.provideService(XmlSchema.Tokenizer, tokenizer),
        Effect.match({ onFailure: () => -1, onSuccess: refsOf }),
        Effect.runSync,
      )
    : -1;

/**
 * The typed-decode ladder: a whole-document decode of a bank, as `effect-xml/typed-decode` runs
 * `XmlSchema.fromString(ItemBank)`, cut after each layer. Read in order, each rung adds one layer
 * to the one before it, and `effect-xml/typed-decode` itself adds the last, the `fromString`
 * wrapper with its second, type-side decode of the value. `typed/to-type` stands beside the
 * ladder: that type-side decode of a decoded value, alone. `typed/resolve-fused` stands beside it
 * too: the tokenizer and the fused resolving machine `decodeString` runs, `resolveCollect`, under
 * a path no element matches, so its collector only counts depth; it is the tokenizer and
 * resolver cost of the shipped path, which `typed/resolver` (the separate `resolveEvents`
 * channel, building every `ResolvedEvent`) overstates.
 *
 * These rungs are not on this script's own differential ladder; `bench/profile/layer-report.ts`
 * derives each layer from the A/B driver's per-round values.
 */
const typedDecodeRungs: readonly Rung[] = [
  typedCountRung("typed/tokenizer", documentEvents),
  typedCountRung("typed/resolver", (text, tokenizer) =>
    documentEvents(text, tokenizer).pipe(Stream.pipeThroughChannel(resolveEvents())),
  ),
  rung("typed/collector", false, (document, input, tokenizer) => ({
    check: (output) =>
      Arr.isArray(output) && output.length === 1 && isResolvedElement(output[0])
        ? countTreeElements(output[0])
        : -1,
    expected: input.reference.elements,
    run: () => documentRoots(document.text, tokenizer),
  })),
  rung("typed/builder", false, (document, _input, tokenizer) => {
    const plan = bankPlan();

    return {
      check: presentOf,
      expected: 1,
      run: () => {
        const [root] = documentRoots(document.text, tokenizer);

        return plan === undefined || root === undefined ? undefined : buildPlain(plan, root);
      },
    };
  }),
  rung("typed/structural", false, (document, input, tokenizer) => {
    const plan = bankPlan();

    const codec = plan === undefined ? undefined : checkedStructuralOf(ItemBank, plan);

    return {
      check: refsOf,
      expected: input.reference.records,
      run: () => {
        const [root] = documentRoots(document.text, tokenizer);
        const plain = plan === undefined || root === undefined ? undefined : buildPlain(plan, root);

        // SAFETY: the structural codec runs exactly the leaf schemas of `ItemBank`, which need no
        // services, and decodes to its Type, as `attemptDecode` relies on.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the structural codec erases its Type and services to `unknown` at the type level only.
        const decoded = (
          codec === undefined || plain === undefined
            ? undefined
            : Schema.decodeUnknownEffect(codec)(plain)
        ) as Effect.Effect<typeof ItemBank.Type, Schema.SchemaError> | undefined;

        return decoded === undefined ? undefined : Effect.runSync(decoded);
      },
    };
  }),
  rung("typed/decode-string", false, (document, input, tokenizer) => {
    const decode = decodeString(ItemBank, unlimited);

    return {
      check: refsOf,
      expected: input.reference.records,
      run: () =>
        decode(document.text).pipe(
          Effect.provideService(XmlSchema.Tokenizer, tokenizer),
          Effect.runSync,
        ),
    };
  }),
  rung("typed/to-type", false, (document, input, tokenizer) => {
    const value = bankValue(document.text, tokenizer);
    const decode = Schema.decodeUnknownEffect(Schema.toType(ItemBank));

    return {
      check: refsOf,
      expected: input.reference.records,
      run: () => decode(value).pipe(Effect.runSync),
    };
  }),
  typedCountRung("typed/resolve-fused", (text, tokenizer) =>
    documentEvents(text, tokenizer).pipe(
      Stream.pipeThroughChannel(resolveCollect([unmatchedRoot], unlimited)),
    ),
  ),
];

/**
 * The typed-encode ladder: a whole-document encode of a decoded bank, as `effect-xml/encode-typed`
 * runs `XmlSchema.fromString(ItemBank, { declaration: false })`, cut after each layer: the
 * structural codec's encode to the plain object, the writer to events, the tokenizer's encode to
 * text, then `encodeString`'s glue. `effect-xml/encode-typed` adds the last layer, the `fromString`
 * wrapper with its type-side encode of the value; `typed/encode-to-type` stands beside the ladder:
 * that type-side encode alone.
 */
const typedEncodeRungs: readonly Rung[] = [
  encodeRung("typed/encode-structural", encodeStructural, presentOf, () => 1),
  encodeRung(
    "typed/encode-writer",
    (plan, value) =>
      toEventsFrom(writerOf(plan, plan.prefixes), encodeStructural(plan, value), {
        declaration: false,
      }),
    presentOf,
    () => 1,
  ),
  encodeRung(
    "typed/encode-tokenizer",
    (plan, value, tokenizer) => {
      const events = toEventsFrom(writerOf(plan, plan.prefixes), encodeStructural(plan, value), {
        declaration: false,
      });

      return events === undefined
        ? undefined
        : Stream.fromIterable(events).pipe(
            Stream.pipeThroughChannel(tokenizer.encodeString()),
            Stream.mkString,
            Effect.runSync,
          );
    },
    encodedRecordsOf,
    (input) => input.reference.records,
  ),
  encodeRung(
    "typed/encode-string",
    (_plan, value, tokenizer) =>
      encodeString(ItemBank, { declaration: false })(value).pipe(
        Effect.provideService(XmlSchema.Tokenizer, tokenizer),
        Effect.runSync,
      ),
    encodedRecordsOf,
    (input) => input.reference.records,
  ),
  encodeRung(
    "typed/encode-to-type",
    (_plan, value) =>
      Schema.encodeUnknownEffect(Schema.toType(ItemBank))(value).pipe(Effect.runSync),
    presentOf,
    () => 1,
  ),
];

/**
 * Every rung in ladder order: the differential rungs `transport` through `positions`, then the
 * whole-document rungs, then the tokenizer rung re-chunked at 4 KiB and 1 MiB, then the typed
 * decode and encode ladders.
 */
export const rungs: readonly Rung[] = [
  rung("transport", true, (document) => ({
    check: countOf,
    expected: document.chunks.length,
    run: () => Stream.fromIterable(document.chunks).pipe(Stream.runCount, Effect.runSync),
  })),
  tokenizerRung("tokenizer", true, Option.none()),
  rung("resolver", true, (document, input, tokenizer) => ({
    check: countOf,
    expected: input.reference.elements,
    run: () =>
      tokenEvents(document.chunks, tokenizer).pipe(
        Stream.pipeThroughChannel(resolveEvents()),
        Stream.filter((event) => event._tag === "StartElement"),
        Stream.runCount,
        Effect.runSync,
      ),
  })),
  rung("collector", true, (document, input, tokenizer) => ({
    check: countOf,
    expected: input.reference.records,
    run: () =>
      tokenEvents(document.chunks, tokenizer).pipe(
        Stream.pipeThroughChannel(resolveEvents()),
        Stream.pipeThroughChannel(collect(bankPath)),
        Stream.runCount,
        Effect.runSync,
      ),
  })),
  schemaRung("schema", false),
  schemaRung("positions", true),
  rung("tree-document", false, (document, input, tokenizer) => {
    const decode = Schema.decodeUnknownEffect(XmlSchema.ElementFromString(bankPrefixes, unlimited));

    return {
      check: (output) => (isResolvedElement(output) ? countTreeElements(output) : -1),
      expected: input.reference.elements,
      run: () =>
        decode(document.text).pipe(
          Effect.provideService(XmlSchema.Tokenizer, tokenizer),
          Effect.runSync,
        ),
    };
  }),
  rung("typed-document", false, (document, input, tokenizer) => {
    const decode = Schema.decodeUnknownEffect(XmlSchema.fromString(ItemBank, unlimited));

    return {
      check: refsOf,
      expected: input.reference.records,
      run: () =>
        decode(document.text).pipe(
          Effect.provideService(XmlSchema.Tokenizer, tokenizer),
          Effect.runSync,
        ),
    };
  }),
  rung("error-document", false, (document, _input, tokenizer) => {
    const decode = Schema.decodeUnknownEffect(XmlSchema.fromString(ItemBank, unlimited));
    const text = withoutLastHref(document.text);

    return {
      check: schemaFailureOf,
      expected: 1,
      run: () =>
        decode(text).pipe(
          Effect.provideService(XmlSchema.Tokenizer, tokenizer),
          Effect.result,
          Effect.runSync,
        ),
    };
  }),
  tokenizerRung("chunk-4k", false, Option.some(4096)),
  tokenizerRung("chunk-1m", false, Option.some(1_048_576)),
  ...typedDecodeRungs,
  ...typedEncodeRungs,
];

/**
 * The timing of one rung; `deltaMedianMs` is present on differential rungs only and is the rung's
 * median minus the previous differential rung's (`transport`'s own median, over an empty
 * pipeline).
 */
export interface RungResult {
  readonly id: string;
  readonly wallMs: Quantiles;
  readonly deltaMedianMs?: number;
}

/**
 * The rung timings of one input.
 */
export interface Ladder {
  readonly input: string;
  readonly rungs: readonly RungResult[];
}

/**
 * One ladder results file.
 */
export interface LadderFile {
  readonly environment: Environment;
  readonly method: Method;
  readonly ladders: readonly Ladder[];
}

/**
 * The failure of the command-line entry: a bad argument, an unknown input or tokenizer, a rung
 * whose count disagrees with its expected value, or a results file that could not be written.
 */
export class LadderError extends Data.TaggedError("LadderError")<{
  readonly reason: string;
}> {}

/**
 * The inputs a run without `--input` measures.
 */
const defaultInputs: readonly string[] = ["bank-256k", "bank-4m"];

/**
 * Attach each differential rung's delta to its timings.
 *
 * @param timed - The rungs in ladder order with their wall-time quantiles.
 * @returns The rung results, differential ones carrying `deltaMedianMs`.
 */
const withDeltas = (
  timed: readonly { readonly rung: Rung; readonly wallMs: Quantiles }[],
): readonly RungResult[] => {
  let previous = 0;

  return timed.map(({ rung: { differential, id }, wallMs }) => {
    if (!differential) {
      return { id, wallMs };
    }

    const deltaMedianMs = wallMs.median - previous;
    previous = wallMs.median;

    return { deltaMedianMs, id, wallMs };
  });
};

/**
 * Prepare, check, and time every rung on one input.
 *
 * Every rung is checked once before any is sampled, so a count mismatch fails the run before it
 * spends time sampling.
 *
 * @param id - The input id.
 * @param tokenizer - The tokenizer every rung reads.
 * @param policy - The sampling policy.
 * @returns The input's ladder.
 */
const measureInput = Effect.fnUntraced(function* measureInput(
  id: string,
  tokenizer: Tokenizer,
  policy: SamplePolicy,
): Effect.fn.Return<Ladder, LadderError> {
  const loaded = yield* loadInput(id);

  if (Option.isNone(loaded)) {
    return yield* new LadderError({
      reason: `unknown input ${id}; pass a bank input id such as bank-16k, bank-256k, bank-4m, or bank-64m`,
    });
  }

  const prepared = yield* Effect.all(
    rungs.map((each) =>
      each.prepare(loaded.value, tokenizer).pipe(
        Effect.map((ready) => ({ prepared: ready, rung: each })),
        Effect.mapError((error) => new LadderError({ reason: `${error.caseId}: ${error.reason}` })),
      ),
    ),
  );

  yield* Effect.all(
    prepared.map(({ prepared: each, rung: { id: rungId } }) =>
      Effect.try({
        catch: (cause) =>
          new LadderError({ reason: `rung ${rungId} on ${id} failed: ${String(cause)}` }),
        try: () => each.check(each.run(constVoid)),
      }).pipe(
        Effect.filterOrFail(
          (observed) => observed === each.expected,
          (observed) =>
            new LadderError({
              reason: `rung ${rungId} on ${id} counted ${observed}, expected ${each.expected}`,
            }),
        ),
      ),
    ),
  );

  const timed = yield* Effect.try({
    catch: (cause) => new LadderError({ reason: `sampling on ${id} failed: ${String(cause)}` }),
    try: () =>
      prepared.map(({ prepared: each, rung: rungOf }) => ({
        rung: rungOf,
        wallMs: quantiles(sample(each, policy).wallMs),
      })),
  });

  return { input: id, rungs: withDeltas(timed) };
});

// Native: `effect/cli` `Command.run` needs FileSystem, Path, Terminal, ChildProcessSpawner, and Stdio from a platform layer, which is not a dependency; `node:util` `parseArgs` runs on Bun and Node.
/**
 * Run the ladder from command-line arguments and write its results file.
 *
 * @param args - The arguments after the script path.
 * @returns The path of the results file written.
 */
const main = Effect.fnUntraced(function* main(
  args: readonly string[],
): Effect.fn.Return<string, LadderError> {
  const { values } = yield* Effect.try({
    catch: (cause) => new LadderError({ reason: String(cause) }),
    try: () =>
      parseArgs({
        args: [...args],
        options: {
          input: { multiple: true, type: "string" },
          out: { type: "string" },
          smoke: { type: "boolean" },
          tokenizer: { type: "string" },
        },
      }),
  });

  const tokenizerName = values.tokenizer ?? "upstream";
  const tokenizer = Record.get(tokenizers, tokenizerName);

  if (Option.isNone(tokenizer)) {
    return yield* new LadderError({
      reason: `unknown tokenizer ${tokenizerName}; pass one of ${Object.keys(tokenizers).join(", ")}`,
    });
  }

  const policy = values.smoke === true ? smokePolicy : defaultPolicy;
  const env = yield* environment;

  const ladders = yield* Effect.all(
    (values.input ?? defaultInputs).map((id) => measureInput(id, tokenizer.value, policy)),
  );

  const file: LadderFile = {
    environment: env,
    ladders,
    method: {
      ...policy,
      chunkBytes,
      floorMs: floor(policy),
      isolation: "single-process",
      quantile: "nearest-rank",
    },
  };

  const time = fileTimestamp(yield* DateTime.now);
  const out = values.out ?? `work/bench/layers-${env.runtime}-${time}.json`;

  yield* Effect.try({
    catch: (cause) => new LadderError({ reason: `cannot write ${out}: ${String(cause)}` }),
    try: () => {
      writeJsonFile(out, file);
    },
  });

  return out;
});

if (isEntryPoint(import.meta)) {
  Effect.runSync(
    main(process.argv.slice(2)).pipe(
      Effect.match({
        onFailure: (error) => {
          console.error(`layers: ${error.reason}`);
          process.exitCode = 1;
        },
        onSuccess: (out) => {
          console.log(out);
        },
      }),
    ),
  );
}
