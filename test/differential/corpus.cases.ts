/**
 * The inputs of the QTI corpus differential suite: every `.xml` file under
 * `spikes/fixtures/qti/` and `test/fixtures/`, read when the module loads so a new fixture joins
 * automatically, as `DocumentInput` values that pair each `src` root, built from the QTI
 * vocabulary and `src`'s `ElementFromString`, with its {@link standardOf} copy.
 *
 * The suite and the phase-3 acceptance runs import these exact inputs. The module imports no test
 * runner and uses only erasable TypeScript syntax, so Node runs it with type stripping.
 */
import { readdirSync, readFileSync } from "node:fs";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import type * as SchemaAST from "effect/SchemaAST";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import * as SrcQti from "../qti/vocabulary.ts";
import { standardOf } from "./harness.ts";
import type { DocumentInput } from "./harness.ts";

/**
 * One corpus file: its path relative to the repository root and its text.
 */
export interface CorpusFile {
  readonly name: string;
  readonly text: string;
}

/**
 * The raw-tree codec `src`'s `ElementFromString` builds.
 */
type TreeCodec = ReturnType<typeof SrcXml.ElementFromString>;

/**
 * The roots of a raw-tree input: `src`'s `ElementFromString` over the text's own prefixes, and
 * its standard-path copy.
 */
export type TreeInput = DocumentInput<TreeCodec>;

/**
 * The definitions one side needs for a typed input: the `qti-assessment-item` root and the raw-tree
 * codec the direct surface decodes the text with first. The standard side holds the
 * {@link standardOf} copy of each.
 */
export interface ItemRoots<Item, Tree> {
  readonly item: Item;
  readonly tree: Tree;
}

/**
 * A typed input: the QTI root and raw-tree codec of each side, under one parse-option variant.
 */
export type ItemInput = DocumentInput<ItemRoots<typeof SrcQti.AssessmentItem, TreeCodec>>;

/**
 * A channel input: the record definition of each side, its record path, positions, the split
 * points of the source, and one parse-option variant.
 */
export type ChannelInput = DocumentInput<typeof SrcQti.ResponseDeclaration>;

/**
 * One parse-option variant: its label, which every input id carries, and the Schema parse options.
 *
 * `errors: "all"` has its own path, message, and position rule, and `onExcessProperty: "error"`
 * reaches the structural decode unchanged, so a key-set difference between the sides shows there.
 */
export interface ParseVariant {
  readonly label: string;
  readonly parseOptions?: SchemaAST.ParseOptions;
}

/**
 * The parse-option variants the typed, direct, and channel surfaces each run under.
 */
export const parseVariants: readonly ParseVariant[] = [
  { label: "default" },
  { label: "errors-all", parseOptions: { errors: "all" } },
  { label: "excess-error", parseOptions: { onExcessProperty: "error" } },
];

/**
 * The size, in UTF-16 code units, of each piece a split source is streamed in.
 */
export const pieceSize = 64;

/**
 * The record path of the channel surfaces, anchored at the document root: the response
 * declarations directly under `qti-assessment-item`, which most corpus items hold.
 */
export const recordPath: readonly string[] = [
  `{${SrcQti.QTI}}qti-assessment-item`,
  `{${SrcQti.QTI}}qti-response-declaration`,
];

/**
 * The corpus directories, relative to the repository root.
 */
const directories: readonly string[] = ["spikes/fixtures/qti/", "test/fixtures/"];

/**
 * The corpus files, enumerated at load time so no count is written into the suite.
 */
export const corpus: readonly CorpusFile[] = directories.flatMap((directory) => {
  const url = new URL(`../../${directory}`, import.meta.url);

  const names = readdirSync(url).filter((name) => name.endsWith(".xml"));

  return Arr.sort(names, Order.String).map((name) => ({
    name: `${directory}${name}`,
    text: readFileSync(new URL(name, url), "utf-8"),
  }));
});

// Native: effect/encoding/Xml and XmlSchema expose no prefix map of a document's declarations, which ElementFromString needs to spell a raw tree's names on encode.
/**
 * Build the prefix map a raw tree encodes with from the `xmlns` declarations its text holds.
 *
 * A later declaration of the same prefix replaces an earlier one; `""` is the default namespace.
 *
 * @param text - The document text.
 * @returns The map from prefix to namespace URI.
 */
export const prefixesOf = (text: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Array.from(
      text.matchAll(/xmlns(?::(?<prefix>[\w.-]+))?="(?<uri>[^"]*)"/gu),
      (match) => [match.groups?.prefix ?? "", match.groups?.uri ?? ""] as const,
    ),
  );

/**
 * Compute the offsets that split a text into pieces of {@link pieceSize} code units.
 *
 * A cut that would separate a surrogate pair moves one unit later, so each piece is well-formed
 * UTF-16 and encodes to the same UTF-8 bytes as its slice of the whole text.
 *
 * @param text - The text to split.
 * @returns The split offsets, ascending, each strictly inside the text.
 */
export const pieceOffsets = (text: string): readonly number[] => {
  const offsets: number[] = [];

  for (let cut = pieceSize; cut < text.length; cut += pieceSize) {
    const moved = (text.codePointAt(cut - 1) ?? 0) > 0xff_ff ? cut + 1 : cut;

    if (moved < text.length && moved > (offsets.at(-1) ?? 0)) {
      offsets.push(moved);
    }
  }

  return offsets;
};

/**
 * Split an input's text at its offsets: the whole text when it has none or an empty list.
 *
 * @param input - The input.
 * @returns The non-empty text chunks in order.
 */
export const textChunks = (input: DocumentInput): readonly [string, ...string[]] => {
  const bounds = [0, ...(input.pieces ?? []), input.text.length];

  const [first, ...rest] = bounds
    .slice(1)
    .map((end, index) => input.text.slice(bounds[index], end));

  return [first ?? input.text, ...rest];
};

/**
 * Encode an input's text chunks as UTF-8 bytes, one byte chunk per text chunk.
 *
 * @param input - The input.
 * @returns The byte chunks in order.
 */
export const byteChunks = (input: DocumentInput): readonly [Uint8Array, ...Uint8Array[]] => {
  const encoder = new TextEncoder();
  const [first, ...rest] = textChunks(input);

  return [encoder.encode(first), ...rest.map((chunk) => encoder.encode(chunk))];
};

/**
 * Add a parse-option variant's options to an input, leaving the default variant without the key.
 *
 * @param input - The input under the default variant.
 * @param parseOptions - The variant's parse options, absent for the default variant.
 * @returns The input under that variant.
 */
const withParseOptions = <I extends DocumentInput>(
  input: I,
  parseOptions: SchemaAST.ParseOptions | undefined,
): I => (parseOptions === undefined ? input : { ...input, parseOptions });

/**
 * Build both sides' raw-tree codecs for a document.
 *
 * @param text - The document text, whose declarations give the prefixes.
 * @returns `src`'s `ElementFromString` codec and its standard-path copy.
 */
const treesOf = (text: string) => {
  const tree = SrcXml.ElementFromString(prefixesOf(text));

  return { src: tree, standard: standardOf(tree) };
};

/**
 * The standard-path copy of the `qti-assessment-item` root, shared by every typed input.
 */
const standardItem = standardOf(SrcQti.AssessmentItem);

/**
 * The standard-path copy of the `qti-response-declaration` record, shared by every channel input.
 */
const standardRecord = standardOf(SrcQti.ResponseDeclaration);

/**
 * The raw-tree inputs: one per corpus file, decoded and its tree encoded again.
 */
export const treeInputs: readonly TreeInput[] = corpus.map(({ name, text }) => ({
  id: name,
  roots: treesOf(text),
  text,
}));

/**
 * The typed inputs: one per corpus file and parse-option variant, every file included, because
 * the files the QTI vocabulary does not cover produce errors that are compared too.
 */
export const itemInputs: readonly ItemInput[] = corpus.flatMap(({ name, text }) =>
  parseVariants.map(({ label, parseOptions }) => {
    const trees = treesOf(text);

    const input: ItemInput = {
      id: `${name}#${label}`,
      roots: {
        src: { item: SrcQti.AssessmentItem, tree: trees.src },
        standard: { item: standardItem, tree: trees.standard },
      },
      text,
    };

    return withParseOptions(input, parseOptions);
  }),
);

/**
 * The channel inputs: per corpus file and parse-option variant, positions off and on, with the
 * source as one chunk (no split offsets) and as {@link pieceSize}-unit pieces, over
 * {@link recordPath}.
 */
export const channelInputs: readonly ChannelInput[] = corpus.flatMap(({ name, text }) =>
  parseVariants.flatMap(({ label, parseOptions }) =>
    [false, true].flatMap((positions) =>
      [false, true].map((split) => {
        const input: ChannelInput = {
          id: `${name}#${label}#positions-${positions ? "on" : "off"}#${split ? "pieces" : "whole"}`,
          options: { positions },
          path: recordPath,
          pieces: split ? pieceOffsets(text) : [],
          roots: { src: SrcQti.ResponseDeclaration, standard: standardRecord },
          text,
        };

        return withParseOptions(input, parseOptions);
      }),
    ),
  ),
);
