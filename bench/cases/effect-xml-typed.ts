/**
 * The benchmark cases for @aidenzepp/effect-xml typed whole-document decoding and encoding: each
 * document decodes through `XmlSchema.fromString` into the value of its root element codec, and
 * encodes back from it.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { XmlSchema } from "../../src/index.ts";
import type { XmlElement } from "../../src/plan.ts";
import type { Tokenizer } from "../../src/tokenizer.ts";
import { AssessmentItem } from "../../test/qti/vocabulary.ts";
import { CaseError } from "../types.ts";
import type { BenchCase, BenchInput, LibraryProfile, PreparedCase } from "../types.ts";
import { ItemBank } from "../vocabulary.ts";
import { bankIds } from "./accepts.ts";

/**
 * The library name every case of this module reports.
 */
const library = "@aidenzepp/effect-xml";

/**
 * The parser limits a whole-document decode of the largest bank needs: the default
 * `maxElementSize` of 16 MiB rejects `bank-64m`, whose root spans the whole document.
 */
const unlimited = { maxElementNodes: Infinity, maxElementSize: Infinity };

/**
 * A root element codec that needs no services to decode or encode, so its runs complete under
 * `Effect.runSync`.
 */
type Root = Schema.Codec<unknown, XmlElement<string>>;

/**
 * The vocabulary a case decodes one input with: its root element codec and the number of records
 * one decoded document holds.
 */
interface Vocabulary<Def extends Root> {
  readonly def: Def;
  /**
   * Count the records of one decoded document.
   *
   * @param value - One document's decoded value, read structurally because `check` receives the
   *   case's output as `unknown`.
   * @returns The records the document holds.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- `check` hands the case's own opaque output back, so the value arrives untyped.
  readonly records: (value: unknown) => number;
}

/**
 * The `corpus-items` vocabulary: each document is one `qti-assessment-item`, one record.
 */
const items: Vocabulary<typeof AssessmentItem> = { def: AssessmentItem, records: () => 1 };

/**
 * The bank vocabulary: one `qti-item-bank` document whose records are its item refs.
 */
const bank: Vocabulary<typeof ItemBank> = {
  def: ItemBank,
  records: (value) =>
    Predicate.hasProperty(value, "refs") && Arr.isArray(value.refs) ? value.refs.length : 0,
};

/**
 * Decide whether a typed case runs on an input.
 *
 * @param input - The id and family of a candidate input.
 * @returns `true` for `corpus-items` and the four bank sizes.
 */
const accepts = (input: Pick<BenchInput, "id" | "family">): boolean =>
  input.id === "corpus-items" || bankIds.has(input.id);

// Native: `Schema.is(Schema.toType(ItemBank))` validates every field of every record; the count needs only each document's record total, read once outside the timed loop.
/**
 * Count the records of a case's output.
 *
 * @param vocabulary - The vocabulary the output was decoded with.
 * @param output - The decoded documents a typed run returned.
 * @returns The records of every document together; `0` when the output is not a list.
 */
const countRecords = <Def extends Root>(
  vocabulary: Vocabulary<Def>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the case's own opaque output, handed back by the harness.
  output: unknown,
): number =>
  Arr.isArray(output) ? Arr.reduce(output, 0, (sum, value) => sum + vocabulary.records(value)) : 0;

/**
 * Prepare the `typed-decode` case on one input.
 *
 * @param _caseId - The case id; decoding needs no preparation that could fail.
 * @param vocabulary - The vocabulary the input's documents decode with.
 * @param input - The input to measure on.
 * @param tokenizer - The tokenizer every decode reads.
 * @returns The prepared case: `run` decodes every document to its typed value.
 */
const prepareDecode = <Def extends Root>(
  _caseId: string,
  vocabulary: Vocabulary<Def>,
  input: BenchInput,
  tokenizer: Tokenizer,
): Effect.Effect<PreparedCase, CaseError> =>
  Effect.sync(() => {
    const decode = Schema.decodeUnknownEffect(XmlSchema.fromString(vocabulary.def, unlimited));

    const prepared: PreparedCase = {
      check: (output) => countRecords(vocabulary, output),
      expected: input.reference.records,
      run: () =>
        input.documents.map((document) =>
          decode(document.text).pipe(
            Effect.provideService(XmlSchema.Tokenizer, tokenizer),
            Effect.runSync,
          ),
        ),
    };

    return prepared;
  });

/**
 * Prepare the `encode-typed` case on one input.
 *
 * Every document is decoded once here, so the timed loop measures encoding alone; `check`
 * re-decodes the encoded texts and counts their records, so an encode that loses records fails
 * the case.
 *
 * @param caseId - The case id, named by a preparation failure.
 * @param vocabulary - The vocabulary the input's documents decode and encode with.
 * @param input - The input to measure on.
 * @param tokenizer - The tokenizer every decode and encode reads.
 * @returns The prepared case, or a `CaseError` naming the document that does not decode.
 */
const prepareEncode = <Def extends Root>(
  caseId: string,
  vocabulary: Vocabulary<Def>,
  input: BenchInput,
  tokenizer: Tokenizer,
): Effect.Effect<PreparedCase, CaseError> =>
  Effect.gen(function* prepare() {
    const decode = Schema.decodeUnknownEffect(XmlSchema.fromString(vocabulary.def, unlimited));

    const encode = Schema.encodeEffect(
      XmlSchema.fromString(vocabulary.def, { ...unlimited, declaration: false }),
    );

    const values = yield* Effect.all(
      input.documents.map((document) =>
        decode(document.text).pipe(
          Effect.mapError(
            (error) =>
              new CaseError({
                caseId,
                reason: `${document.name} in ${input.id} does not decode with the case's vocabulary, so there is no value to encode: ${error.message}`,
              }),
          ),
        ),
      ),
    ).pipe(Effect.provideService(XmlSchema.Tokenizer, tokenizer));

    const recordsOf = (text: string): number =>
      decode(text).pipe(
        Effect.provideService(XmlSchema.Tokenizer, tokenizer),
        Effect.match({ onFailure: () => 0, onSuccess: vocabulary.records }),
        Effect.runSync,
      );

    const prepared: PreparedCase = {
      check: (output) =>
        Arr.isArray(output)
          ? Arr.reduce(output.filter(Predicate.isString), 0, (sum, text) => sum + recordsOf(text))
          : 0,
      expected: input.reference.records,
      run: () =>
        values.map((value) =>
          encode(value).pipe(Effect.provideService(XmlSchema.Tokenizer, tokenizer), Effect.runSync),
        ),
    };

    return prepared;
  });

/**
 * Prepare a typed case with the vocabulary of its input.
 *
 * @param caseId - The case id.
 * @param prepareWith - The class's preparation, applied to the input's vocabulary.
 * @returns The case's `prepare`: `corpus-items` decodes as `AssessmentItem`, a bank as `ItemBank`.
 */
const byVocabulary =
  (
    caseId: string,
    prepareWith: <Def extends Root>(
      caseId: string,
      vocabulary: Vocabulary<Def>,
      input: BenchInput,
      tokenizer: Tokenizer,
    ) => Effect.Effect<PreparedCase, CaseError>,
  ): BenchCase["prepare"] =>
  (input, tokenizer) =>
    input.id === "corpus-items"
      ? prepareWith(caseId, items, input, tokenizer)
      : prepareWith(caseId, bank, input, tokenizer);

/**
 * The cases this module registers: `effect-xml/typed-decode` and `effect-xml/encode-typed`.
 */
export const cases: readonly BenchCase[] = [
  {
    accepts,
    class: "typed-decode",
    id: "effect-xml/typed-decode",
    library,
    prepare: byVocabulary("effect-xml/typed-decode", prepareDecode),
  },
  {
    accepts,
    class: "encode-typed",
    id: "effect-xml/encode-typed",
    library,
    prepare: byVocabulary("effect-xml/encode-typed", prepareEncode),
  },
];

/**
 * The capability profiles this module registers; the `@aidenzepp/effect-xml` profile lives with
 * the parse cases.
 */
export const libraries: readonly LibraryProfile[] = [];
