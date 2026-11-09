/**
 * The benchmark cases and capability profile for @computis/effect-xml.
 */
import { codec, element, root } from "@computis/effect-xml";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { QTI } from "../../test/streaming/vocabulary.ts";
import { CaseError } from "../types.ts";
import type { BenchCase, BenchInput, LibraryProfile, PreparedCase } from "../types.ts";
import { acceptsBank } from "./accepts.ts";

/**
 * The npm package the cases and profile of this module measure.
 */
const library = "@computis/effect-xml";

// Native: Schema.BooleanFromBit decodes the numbers 0 and 1, and Effect exports no Schema whose encoded side is the string literals "true" and "false", the leaf the library requires of an attribute.
/**
 * A boolean attribute written as `true` or `false`.
 */
const BooleanAttribute = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) => value === "true",
      encode: (value) => (value ? "true" : "false"),
    }),
  ),
);

/**
 * An empty element naming a variable by its `identifier` attribute.
 */
const Reference = Schema.Struct({ identifier: Schema.String }).pipe(
  element({ attributes: ["identifier"] }),
);

/**
 * A `qti-match` comparing a variable with a correct value.
 */
// oxlint-disable-next-line sort-keys -- struct field order is document order; QTI writes the variable before the correct value.
const Match = Schema.Struct({ "qti-variable": Reference, "qti-correct": Reference });

/**
 * A `qti-branch-rule` that jumps to `target` when its match holds.
 */
// oxlint-disable-next-line sort-keys -- struct field order is document order; the attribute leads, then the match.
const BranchRule = Schema.Struct({ target: Schema.String, "qti-match": Match }).pipe(
  element({ attributes: ["target"] }),
);

/**
 * A `qti-weight` giving an item reference a finite numeric weight.
 */
const Weight = Schema.Struct({ identifier: Schema.String, value: Schema.FiniteFromString }).pipe(
  element({ attributes: ["identifier", "value"] }),
);

/**
 * A `qti-assessment-item-ref` with the attributes and children of `ItemRef`.
 *
 * Struct keys are the element names, and the decoder takes the field order as the document
 * order (it fails with `Element out of sequence` otherwise), so `qti-weight` comes before
 * `qti-branch-rule` as the bank writes them.
 */
// oxlint-disable-next-line sort-keys -- struct field order is document order; the bank writes qti-weight before qti-branch-rule.
const ItemRef = Schema.Struct({
  category: Schema.optionalKey(Schema.String),
  fixed: Schema.optionalKey(BooleanAttribute),
  href: Schema.String,
  identifier: Schema.String,
  required: Schema.optionalKey(BooleanAttribute),
  "qti-weight": Schema.Array(Weight),
  "qti-branch-rule": Schema.Array(BranchRule),
}).pipe(element({ attributes: ["category", "fixed", "href", "identifier", "required"] }));

/**
 * The `qti-item-bank` root in the QTI namespace, holding the item-ref records.
 */
const ItemBank = Schema.Struct({ "qti-assessment-item-ref": Schema.Array(ItemRef) }).pipe(
  root("qti-item-bank", { namespace: QTI }),
);

/**
 * The shape `check` reads from decoded banks: only each bank's record list.
 */
const DecodedBanks = Schema.Array(
  Schema.Struct({ "qti-assessment-item-ref": Schema.Array(Schema.Unknown) }),
);

/**
 * Count the records of decoded banks.
 *
 * @param banks - A case's decoded banks.
 * @returns The number of `qti-assessment-item-ref` records across all banks.
 */
const countRecords = (banks: typeof DecodedBanks.Type): number =>
  banks.reduce((count, bank) => count + bank["qti-assessment-item-ref"].length, 0);

/**
 * The shape `check` reads from encoded banks: one XML text per document.
 */
const EncodedTexts = Schema.Array(Schema.String);

/**
 * Compile the bank codec once, with the library's default options (`jit: true`).
 *
 * @param caseId - The case the codec is compiled for.
 * @returns The bank's `decode` and `encode`, failing with a `CaseError` when the library has no
 *   XML plan for the Schema.
 */
const compileBank = (caseId: string) =>
  Effect.fromResult(codec(ItemBank)).pipe(
    Effect.mapError((planError) => new CaseError({ caseId, reason: planError.message })),
  );

/**
 * Construct the case that decodes each bank document to a typed value.
 *
 * @param id - The case id.
 * @returns The typed-decode case for the four bank sizes.
 */
const typedDecodeCase = (id: string): BenchCase => ({
  accepts: acceptsBank,
  class: "typed-decode",
  id,
  library,
  prepare: (input: BenchInput) =>
    compileBank(id).pipe(
      Effect.map(({ decode }): PreparedCase => ({
        check: (output) =>
          Option.match(Schema.decodeUnknownOption(DecodedBanks)(output), {
            onNone: () => -1,
            onSome: countRecords,
          }),
        expected: input.reference.records,
        run: () => input.documents.map((document) => Effect.runSync(decode(document.text))),
      })),
    ),
});

/**
 * Construct the case that encodes each bank value, decoded once in `prepare`, back to text.
 *
 * @param id - The case id.
 * @returns The encode-typed case for the four bank sizes.
 */
const encodeTypedCase = (id: string): BenchCase => ({
  accepts: acceptsBank,
  class: "encode-typed",
  id,
  library,
  prepare: (input: BenchInput) =>
    compileBank(id).pipe(
      Effect.flatMap(({ decode, encode }) =>
        Effect.all(input.documents.map((document) => decode(document.text))).pipe(
          Effect.mapError(
            (decodeError) => new CaseError({ caseId: id, reason: decodeError.message }),
          ),
          Effect.map((values): PreparedCase => ({
            check: (output) =>
              Option.match(Schema.decodeUnknownOption(EncodedTexts)(output), {
                onNone: () => -1,
                onSome: (texts) =>
                  Effect.all(texts.map((text) => decode(text))).pipe(
                    Effect.match({ onFailure: () => -1, onSuccess: countRecords }),
                    Effect.runSync,
                  ),
              }),
            expected: input.reference.records,
            run: () => values.map((value) => Effect.runSync(encode(value))),
          })),
        ),
      ),
    ),
});

/**
 * The cases this module registers: typed decode and typed encode of the synthetic bank.
 */
export const cases: readonly BenchCase[] = [
  typedDecodeCase("computis-effect-xml/typed-decode"),
  encodeTypedCase("computis-effect-xml/encode-typed"),
];

/**
 * The capability profiles this module registers, as the probes in
 * `test/bench/computis-effect-xml.test.ts` measure them.
 */
export const libraries: readonly LibraryProfile[] = [
  {
    decodesEntities: true,
    expandsDoctypeEntities: false,
    library,
    notes: [
      "typed: codec(schema) compiles an Effect Schema annotated with root() and element() into decode (XML string to value) and encode (value to XML string).",
      "streams: false; decode takes the whole document as one string and has no chunked input.",
      "reportsPositions: false; decoded values carry no source positions, and only XmlParseError and XmlDecodeError carry a position (line, column, offset).",
      'resolvesNamespaces: probed as root("a", { namespace: "urn:x" }) accepting <p:a xmlns:p="urn:x"/> and namespace "urn:y" rejecting it; the decoded value does not carry the namespace.',
      "decodesEntities: probed on <r><a>&amp;</a></r>, because the root must be a Struct rather than a text leaf.",
      "expandsDoctypeEntities: false; the tokenizer rejects every DOCTYPE declaration with XmlParseError.",
      "jit: left at its default (true), which enables the Effect Schema JIT for the bank Schema process-wide.",
      "The bank Schema names fields by element name (qti-weight, qti-branch-rule) and lists qti-weight first: the decoder takes struct field order as document order.",
      "Attributes must be string leaves in the encoded Schema: value is Schema.FiniteFromString, and fixed and required decode the literals true and false.",
      "encode writes the XML declaration (encoder.declaration default) and no indentation.",
      "prepare ignores the benchmark tokenizer: the library parses with its own tokenizer.",
    ],
    rejectsMalformed: true,
    reportsPositions: false,
    resolvesNamespaces: true,
    streams: false,
    typed: true,
  },
];
