/**
 * The benchmark cases and capability profile for @aidenzepp/effect-xml event and tree decoding.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { isResolvedElement } from "../../src/element.ts";
import type { ResolvedElement } from "../../src/element.ts";
import { XmlSchema } from "../../src/index.ts";
import type { PrefixMap } from "../../src/plan.ts";
import type { Tokenizer } from "../../src/tokenizer.ts";
import { countElements, countTreeElements } from "../inputs/reference.ts";
import { CaseError } from "../types.ts";
import type {
  BenchCase,
  BenchDocument,
  BenchInput,
  LibraryProfile,
  PreparedCase,
} from "../types.ts";
import { acceptsValid } from "./accepts.ts";

/**
 * The library name every case and the profile of this module carry.
 */
const library = "@aidenzepp/effect-xml";

/**
 * The limits of a whole-document decode or encode: no element size or node budget, so a large
 * input is measured rather than rejected by the 16 MiB default.
 */
const unlimited = { maxElementNodes: Infinity, maxElementSize: Infinity };

// Native: `XmlSchema.ElementFromString` takes the prefix map as an argument, and neither it nor `effect/encoding/Xml` exposes the document's `xmlns` declarations; the regex is the one of `prefixesOf` in `test/round-trip.test.ts`.
/**
 * Build the prefix map a document's `xmlns` declarations spell, for the tree codec.
 *
 * A later declaration of the same prefix replaces an earlier one.
 *
 * @param text - The XML text to scan.
 * @returns The map from prefix (`""` for the default namespace) to namespace URI.
 */
const prefixesOf = (text: string): PrefixMap =>
  Object.fromEntries(
    Array.from(
      text.matchAll(/xmlns(?::(?<prefix>[\w.-]+))?="(?<uri>[^"]*)"/gu),
      (match) => [match.groups?.prefix ?? "", match.groups?.uri ?? ""] as const,
    ),
  );

/**
 * Count the start tags of one document, read chunk by chunk through a tokenizer's text decoder.
 *
 * @param document - The document whose chunks are decoded.
 * @param tokenizer - The tokenizer whose `decodeString` channel reads the chunks.
 * @returns The number of `StartElement` events, throwing the tokenizer's failure on malformed
 * text.
 */
const countStartElements = (document: BenchDocument, tokenizer: Tokenizer): number =>
  Stream.fromIterable(document.chunks).pipe(
    Stream.pipeThroughChannel(tokenizer.decodeString()),
    Stream.runFold(
      () => 0,
      (n, event) => (event._tag === "StartElement" ? n + 1 : n),
    ),
    Effect.runSync,
  );

/**
 * Decode one document into its resolved root through the tree codec and a tokenizer.
 *
 * @param text - The document's XML text.
 * @param tokenizer - The tokenizer the codec decodes through.
 * @returns The resolved root, failing with the schema error on rejected text.
 */
const decodeTree = (text: string, tokenizer: Tokenizer) =>
  Schema.decodeUnknownEffect(XmlSchema.ElementFromString(prefixesOf(text), unlimited))(text).pipe(
    Effect.provideService(XmlSchema.Tokenizer, tokenizer),
  );

/**
 * Read the element count an `events` run returned.
 *
 * @param output - The output of the case's `run`.
 * @returns The number, or `NaN` when the output is not a number, so the harness's comparison
 * fails.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the opaque output the contract's `check` receives.
const countOfNumber = (output: unknown): number =>
  Predicate.isNumber(output) ? output : Number.NaN;

/**
 * Count the elements of the resolved trees a `tree` run returned.
 *
 * @param output - The output of the case's `run`.
 * @returns The elements of every tree, or `NaN` when the output is not an array.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the opaque output the contract's `check` receives.
const countOfTrees = (output: unknown): number =>
  Arr.isArray(output)
    ? Arr.reduce(output.filter(isResolvedElement), 0, (n, tree) => n + countTreeElements(tree))
    : Number.NaN;

/**
 * Count the elements of the XML texts an `encode-tree` run returned, through the upstream
 * tokenizer.
 *
 * @param output - The output of the case's `run`.
 * @returns The elements of every text, or `NaN` when the output is not an array or a text does
 *   not tokenize.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the opaque output the contract's `check` receives.
const countOfTexts = (output: unknown): number =>
  Arr.isArray(output)
    ? Effect.runSync(
        Effect.reduce(
          output.filter(Predicate.isString),
          () => 0,
          (n, text) => countElements(text).pipe(Effect.map((count) => n + count)),
        ).pipe(Effect.orElseSucceed(() => Number.NaN)),
      )
    : Number.NaN;

/**
 * Prepare the `encode-tree` case: decode every document once, outside the timed loop, and pair
 * each tree with the encoder its prefixes spell.
 *
 * @param input - The input to measure on.
 * @param tokenizer - The tokenizer the documents decode and encode through.
 * @returns The prepared case, or a `CaseError` naming the document that did not decode.
 */
const prepareEncodeTree = (
  input: BenchInput,
  tokenizer: Tokenizer,
): Effect.Effect<PreparedCase, CaseError> =>
  Effect.gen(function* decodeEveryTree() {
    const trees = yield* Effect.all(
      input.documents.map((document) =>
        decodeTree(document.text, tokenizer).pipe(
          Effect.map((tree) => ({
            encode: Schema.encodeEffect(
              XmlSchema.ElementFromString(prefixesOf(document.text), {
                ...unlimited,
                declaration: false,
              }),
            ),
            tree,
          })),
          Effect.mapError(
            (failure) =>
              new CaseError({
                caseId: "effect-xml/encode-tree",
                reason: `${document.name} in ${input.id} does not decode as a tree, so there is no tree to encode: ${failure.message}`,
              }),
          ),
        ),
      ),
    );

    return {
      check: countOfTexts,
      expected: input.reference.elements,
      run: () =>
        trees.map(({ encode, tree }) =>
          encode(tree).pipe(Effect.provideService(XmlSchema.Tokenizer, tokenizer), Effect.runSync),
        ),
    };
  });

/**
 * The cases this module registers.
 */
export const cases: readonly BenchCase[] = [
  {
    accepts: acceptsValid,
    class: "events",
    id: "effect-xml/events",
    library,
    prepare: (input, tokenizer) =>
      Effect.succeed({
        check: countOfNumber,
        expected: input.reference.elements,
        run: () =>
          Arr.reduce(
            input.documents,
            0,
            (n, document) => n + countStartElements(document, tokenizer),
          ),
      }),
  },
  {
    accepts: acceptsValid,
    class: "tree",
    id: "effect-xml/tree",
    library,
    prepare: (input, tokenizer) =>
      Effect.succeed({
        check: countOfTrees,
        expected: input.reference.elements,
        run: (): readonly ResolvedElement[] =>
          input.documents.map((document) => Effect.runSync(decodeTree(document.text, tokenizer))),
      }),
  },
  {
    accepts: acceptsValid,
    class: "encode-tree",
    id: "effect-xml/encode-tree",
    library,
    prepare: prepareEncodeTree,
  },
];

/**
 * The capability profiles this module registers.
 */
export const libraries: readonly LibraryProfile[] = [
  {
    decodesEntities: true,
    expandsDoctypeEntities: false,
    library,
    notes: [
      "probed through XmlSchema.ElementFromString with prefixes read from the document's xmlns declarations",
      "reportsPositions: XmlSchema.decodeSchemaString with positions: true puts the start tag's line and column on a SchemaFailure",
      "streams: XmlSchema.decodeSchemaString decodes records from text read chunk by chunk",
      "typed: XmlSchema.fromString decodes a whole document through an element codec",
      "expandsDoctypeEntities: a DOCTYPE internal subset does not decode to its entity's text",
    ],
    rejectsMalformed: true,
    reportsPositions: true,
    resolvesNamespaces: true,
    streams: true,
    typed: true,
  },
];
