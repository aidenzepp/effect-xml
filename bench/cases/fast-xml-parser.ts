/**
 * The benchmark cases and capability profile for fast-xml-parser.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Number from "effect/Number";
import * as Schema from "effect/Schema";
import { XMLBuilder, XMLParser } from "fast-xml-parser";

import { countElements } from "../inputs/reference.ts";
import { CaseError } from "../types.ts";
import type { BenchCase, BenchInput, LibraryProfile } from "../types.ts";
import { acceptsBank, acceptsValid } from "./accepts.ts";

/**
 * The npm package these cases measure.
 */
const library = "fast-xml-parser";

/**
 * The tree options: `preserveOrder` and `ignoreAttributes: false` are non-default, because child
 * order and attributes are data in QTI and effect-xml keeps both.
 */
const treeOptions = { ignoreAttributes: false, preserveOrder: true };

/**
 * The element names the typed-decode parse always reads as arrays, so a record with one rule or
 * weight decodes to the same shape as a record with many.
 */
const arrayElements: ReadonlySet<string> = new Set([
  "qti-assessment-item-ref",
  "qti-branch-rule",
  "qti-weight",
]);

/**
 * One value of a `preserveOrder` node: an element's child node list under its tag-name key, the
 * `:@` attribute object, or text under `#text` (a number or boolean when fast-xml-parser's default
 * `parseTagValue` converts it). The child list is a mutable array type only so `Arr.isArray`
 * narrows the union to it; nothing writes to it.
 */
type OrderedValue = string | number | boolean | Readonly<Record<string, string>> | OrderedNode[];

/**
 * One node of fast-xml-parser's `preserveOrder` output: one key naming the element, `#text`, the
 * XML declaration, or a processing instruction (`?`-prefixed), beside an optional `:@` attribute
 * object.
 */
interface OrderedNode {
  readonly [key: string]: OrderedValue;
}

/**
 * The schema of one `preserveOrder` node, which `check` runs on the tree output once, outside the
 * timed loop.
 */
const OrderedNodeSchema: Schema.Codec<OrderedNode> = Schema.Record(
  Schema.String,
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Record(Schema.String, Schema.String),
    Schema.mutable(
      Schema.Array(Schema.suspend((): Schema.Codec<OrderedNode> => OrderedNodeSchema)),
    ),
  ]),
);

/**
 * The trees a tree run returns: one `preserveOrder` node list per document.
 */
const OrderedDocuments = Schema.Array(Schema.Array(OrderedNodeSchema));

// Native: fast-xml-parser has no element count, and `countTreeElements` reads effect-xml's `ResolvedElement`, not the `preserveOrder` node shape.
/**
 * Count the elements of `preserveOrder` output.
 *
 * @param nodes - A node list, as `parse` returns it or as one element holds its children.
 * @returns The elements in `nodes` and their descendants; text, the XML declaration, and
 *   processing instructions are not counted.
 */
const countOrdered = (nodes: readonly OrderedNode[]): number => {
  let count = 0;

  for (const node of nodes) {
    for (const [key, value] of Object.entries(node)) {
      if (key !== ":@" && key !== "#text" && !key.startsWith("?") && Arr.isArray(value)) {
        count += 1 + countOrdered(value);
      }
    }
  }

  return count;
};

/**
 * Run one parse, keeping fast-xml-parser's untyped result opaque until a schema or guard reads it.
 *
 * @param parser - The parser to run.
 * @param text - The document text.
 * @returns The parser's output.
 */
// oxlint-disable-next-line anti-slop/no-unknown-returns -- `XMLParser.parse` returns `any`; the timed run keeps it opaque, and `check` parses it with a schema outside the timed loop.
const parseOne = (parser: XMLParser, text: string): unknown => parser.parse(text);

/**
 * Parse every document of an input once, outside the timed loop.
 *
 * @param caseId - The case the parse prepares, named in a failure.
 * @param parser - The parser to run.
 * @param input - The input whose documents are parsed.
 * @returns The parsed tree of each document, or a `CaseError` when the parser throws.
 */
const parseAll = (
  caseId: string,
  parser: XMLParser,
  input: BenchInput,
): Effect.Effect<readonly unknown[], CaseError> =>
  Effect.try({
    catch: (cause) => new CaseError({ caseId, reason: String(cause) }),
    try: () => input.documents.map((doc) => parseOne(parser, doc.text)),
  });

/**
 * A `qti-weight` as the plain parse yields it, with its `value` decoded from the attribute text.
 */
const PlainWeight = Schema.Struct({ identifier: Schema.String, value: Schema.FiniteFromString });

/**
 * A `qti-branch-rule` as the plain parse yields it; its match is not decoded, as `ItemRef`'s rule
 * keeps only the parts the record needs.
 */
const PlainBranchRule = Schema.Struct({ target: Schema.String });

/**
 * The boolean attribute codec: `Schema.toCodecStringTree` of `Schema.Boolean`, the same codec
 * effect-xml derives for a `Schema.Boolean` attribute, so both decode only `"true"` and `"false"`.
 */
const BooleanAttribute = Schema.toCodecStringTree(Schema.Boolean);

/**
 * A `qti-assessment-item-ref` as the plain parse yields it, mirroring `ItemRef` in
 * `test/streaming/vocabulary.ts`: the same attribute names and decoded types, with the child
 * element arrays renamed to `rules` and `weights`.
 */
const PlainItemRef = Schema.Struct({
  category: Schema.optionalKey(Schema.String),
  fixed: Schema.optionalKey(BooleanAttribute),
  href: Schema.String,
  identifier: Schema.String,
  required: Schema.optionalKey(BooleanAttribute),
  rules: Schema.Array(PlainBranchRule),
  weights: Schema.Array(PlainWeight),
}).pipe(Schema.encodeKeys({ rules: "qti-branch-rule", weights: "qti-weight" }));

/**
 * A plain item bank: the `qti-item-bank` root holding its records as `refs`.
 */
const PlainBank = Schema.Struct({
  "qti-item-bank": Schema.Struct({ refs: Schema.Array(PlainItemRef) }).pipe(
    Schema.encodeKeys({ refs: "qti-assessment-item-ref" }),
  ),
});

/**
 * The decoded banks a typed-decode run returns, read back by `check` outside the timed loop.
 */
const DecodedBanks = Schema.Array(Schema.toType(PlainBank));

/**
 * The texts an encode-tree run returns, read back by `check` outside the timed loop.
 */
const Texts = Schema.Array(Schema.String);

/**
 * The typed-decode parse options: attributes as plain keys, and the record, rule, and weight
 * elements always as arrays.
 */
const typedOptions = {
  attributeNamePrefix: "",
  ignoreAttributes: false,
  isArray: (tagName: string): boolean => arrayElements.has(tagName),
};

/**
 * The tree case: one `preserveOrder` parser built once, run over every document.
 */
const tree: BenchCase = {
  accepts: acceptsValid,
  class: "tree",
  id: `${library}/tree`,
  library,
  prepare: (input) =>
    Effect.sync(() => {
      const parser = new XMLParser(treeOptions);

      return {
        check: (output) =>
          Number.sumAll(Schema.decodeUnknownSync(OrderedDocuments)(output).map(countOrdered)),
        expected: input.reference.elements,
        run: () => input.documents.map((doc) => parseOne(parser, doc.text)),
      };
    }),
};

/**
 * The encode-tree case: every document parsed once with the tree options, then built back to
 * text by one builder.
 */
const encodeTree: BenchCase = {
  accepts: acceptsValid,
  class: "encode-tree",
  id: `${library}/encode-tree`,
  library,
  prepare: (input) =>
    parseAll(`${library}/encode-tree`, new XMLParser(treeOptions), input).pipe(
      Effect.map((trees) => {
        // oxlint-disable-next-line typescript/no-deprecated -- fast-xml-parser re-exports fast-xml-builder's class under this name; fast-xml-parser is the pinned devDependency, fast-xml-builder only its transitive one.
        const builder = new XMLBuilder(treeOptions);

        return {
          check: (output) =>
            Number.sumAll(
              Schema.decodeUnknownSync(Texts)(output).map((text) =>
                Effect.runSync(countElements(text)),
              ),
            ),
          expected: input.reference.elements,
          run: () => trees.map((parsed): string => builder.build(parsed)),
        };
      }),
    ),
};

/**
 * The typed-decode case: a plain parse followed by an Effect Schema decode of the bank (GOAL open
 * question 4).
 */
const typedDecode: BenchCase = {
  accepts: acceptsBank,
  class: "typed-decode",
  id: `${library}/typed-decode`,
  library,
  prepare: (input) =>
    Effect.sync(() => {
      const parser = new XMLParser(typedOptions);
      const decode = Schema.decodeUnknownSync(PlainBank);

      return {
        check: (output) =>
          Number.sumAll(
            Schema.decodeUnknownSync(DecodedBanks)(output).map(
              (bank) => bank["qti-item-bank"].refs.length,
            ),
          ),
        expected: input.reference.records,
        run: () => input.documents.map((doc) => decode(parseOne(parser, doc.text))),
      };
    }),
};

/**
 * The cases this module registers.
 */
export const cases: readonly BenchCase[] = [tree, encodeTree, typedDecode];

/**
 * The capability profiles this module registers, measured by the Shared contract probes with the
 * tree options.
 */
export const libraries: readonly LibraryProfile[] = [
  {
    decodesEntities: true,
    expandsDoctypeEntities: true,
    library,
    notes: [
      "tree and encode-tree use preserveOrder: true and ignoreAttributes: false (non-default): child order and attributes are data in QTI, and effect-xml keeps both.",
      "typed-decode uses ignoreAttributes: false, attributeNamePrefix: '' and isArray for qti-assessment-item-ref, qti-branch-rule, and qti-weight (non-default), then decodes with an Effect Schema.",
      "reportsPositions: XMLParser.parse output carries no source positions.",
      "streams: XMLParser.parse takes the whole document as one string or Uint8Array.",
      "typed: the library has no schema layer; the typed-decode case pairs it with Effect Schema.",
    ],
    rejectsMalformed: false,
    reportsPositions: false,
    resolvesNamespaces: false,
    streams: false,
    typed: false,
  },
];
