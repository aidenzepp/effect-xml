/**
 * The inputs of the fuzzed-document differential suite: mutants of valid seed documents, each
 * under four variants (no options, `errors: "all"`, small record budgets, and small parser
 * limits), as `DocumentInput` values that pair each `src` root and record definition with its
 * {@link standardOf} copy.
 *
 * The seeds are the QTI corpus files of `corpus.cases.ts`, the streaming fixture text
 * (`syntheticParts()` concatenated), and a fixed sample of the feature roots' encoded texts from
 * `generated.cases.ts`. `effect/Arbitrary` draws each mutation's operator, target, parameters,
 * budgets, and the offsets the channel source is split at, with the fixed {@link seed}. Valid
 * inputs never reach the fallback, the budgets, or the acceptance edges, so these mutants are what
 * show a fast path accepting what today rejects. The suite and the phase-3 acceptance runs import
 * these exact inputs. The module imports no test runner and uses only erasable TypeScript syntax,
 * so Node runs it with type stripping.
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import * as SrcQti from "../qti/vocabulary.ts";
import { syntheticParts } from "../streaming/synthetic.ts";
import * as SrcStreaming from "../streaming/vocabulary.ts";
import { corpus, prefixesOf, recordPath } from "./corpus.cases.ts";
import { FEATURE, featureIds } from "./features.ts";
import { documentInputs } from "./generated.cases.ts";
import type { SrcRoot } from "./generated.cases.ts";
import { standardOf } from "./harness.ts";
import type { DocumentInput, Sides } from "./harness.ts";

/**
 * The fixed seed of every fuzzed run: the mutant sample and the property check alike.
 */
export const seed = 20_261_107;

/**
 * The fixed number of mutants drawn, and the run count of the property check.
 */
export const runs = 160;

/**
 * The fixed local complexity scale of every fuzzed run.
 */
export const size = 32;

/**
 * Where a seed document comes from: a QTI corpus file, the streaming fixture, or a feature root's
 * encoded text.
 */
export type SeedKind = "corpus" | "feature" | "streaming";

/**
 * One valid document a mutant starts from, with the roots, record definition, and record path its
 * surfaces decode it with.
 */
export interface Seed {
  readonly id: string;
  readonly kind: SeedKind;
  readonly text: string;
  readonly roots: Sides<SrcRoot>;
  readonly record: Sides<SrcRoot>;
  readonly path: readonly string[];
}

/**
 * Every mutation operator, in a fixed order.
 *
 * `rename` covers an undeclared local name, an unbound prefix, and the same local name in another
 * namespace; `insert` covers text, a comment, a processing instruction, CDATA, and whitespace at a
 * tag boundary; `blank` replaces an element's content with empty and whitespace-only text whatever
 * its content mode; `doctype` inserts a DOCTYPE with an internal entity, with and without a
 * reference to it.
 */
export const operators = [
  "remove-attribute",
  "replace-value",
  "remove-element",
  "duplicate-element",
  "rename",
  "insert",
  "blank",
  "undeclared-attribute",
  "truncate",
  "stray-end-tag",
  "doctype",
] as const;

/**
 * One mutation operator.
 */
export type Operator = (typeof operators)[number];

/**
 * A bounded integer field of {@link Draw}.
 *
 * @param minimum - The smallest value.
 * @param maximum - The largest value.
 * @returns An integer schema `Arbitrary.schema` draws within the bounds.
 */
const between = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ maximum, minimum }));

/**
 * The largest selector a {@link Draw} carries; a selector picks a target or a parameter modulo the
 * number of candidates, or a position as its fraction of this scale.
 */
const scale = 999_999;

/**
 * Everything one mutant is built from, drawn by `effect/Arbitrary`: the seed index, the operator,
 * the selectors of its target, parameter, and position, the channel split points, and the four
 * small budgets.
 */
export const DrawSchema = Schema.Struct({
  at: between(0, scale),
  choice: between(0, scale),
  cuts: Schema.Array(between(0, scale)).check(Schema.isBetweenLength(1, 4)),
  depth: between(1, 6),
  nodes: between(1, 48),
  operator: Schema.Literals(operators),
  pick: between(0, scale),
  seed: between(0, scale),
  size: between(16, 1500),
  token: between(1, 512),
});

/**
 * One drawn mutant description.
 */
export type Draw = typeof DrawSchema.Type;

/**
 * The option variant an input runs under: none, `errors: "all"`, small `maxElementNodes` and
 * `maxElementSize`, or small `maxDepth` and `maxTokenSize`.
 */
export type Variant = "default" | "errors-all" | "parser" | "records";

/**
 * Every variant in a fixed order.
 */
export const variants: readonly Variant[] = ["default", "errors-all", "records", "parser"];

/**
 * One fuzzed input: a mutant's text under one variant, the document root and record definition with
 * their {@link standardOf} copies, the record path, the drawn split offsets, and the prefix map the
 * raw-tree codec encodes with.
 *
 * `options` holds only limits; a channel run adds `positions` itself.
 */
export interface FuzzInput extends DocumentInput<SrcRoot> {
  readonly seed: string;
  readonly kind: SeedKind;
  readonly operator: Operator;
  readonly mutation: string;
  readonly variant: Variant;
  readonly record: Sides<SrcRoot>;
  readonly path: readonly string[];
  readonly pieces: readonly number[];
  readonly prefixes: Readonly<Record<string, string>>;
  readonly options?: SrcXml.LimitOptions;
}

/**
 * The feature texts taken as seeds per root: the first texts of each root in cases order.
 */
const featureSeedsPerRoot = 3;

/**
 * The streaming fixture text: `syntheticParts()` joined header, parts, footer, which equals the
 * fixture `spikes/fixtures/qti/test-features.xml`.
 *
 * @returns The streaming seed's text.
 */
const streamingText = (): string => {
  const { footer, header, parts } = syntheticParts();

  return `${header}${parts}${footer}`;
};

/**
 * Pair a `src` root with its standard-path copy.
 *
 * @param root - The `src` root or record definition.
 * @returns The root and its {@link standardOf} copy.
 */
const sidesOf = (root: SrcRoot): Sides<SrcRoot> => ({ src: root, standard: standardOf(root) });

/**
 * The `qti-assessment-item` root and its standard-path copy, shared by every corpus seed.
 */
const itemRoots = sidesOf(SrcQti.AssessmentItem);

/**
 * The `qti-response-declaration` record and its standard-path copy, shared by every corpus seed.
 */
const itemRecords = sidesOf(SrcQti.ResponseDeclaration);

/**
 * Every seed in a fixed order: the corpus files, the streaming fixture, then the feature texts.
 */
export const seeds: readonly Seed[] = [
  ...corpus.map(({ name, text }): Seed => ({
    id: name,
    kind: "corpus",
    path: recordPath,
    record: itemRecords,
    roots: itemRoots,
    text,
  })),
  {
    id: "streaming/synthetic-parts",
    kind: "streaming",
    path: [...SrcStreaming.itemRefPath],
    record: sidesOf(SrcStreaming.ItemRef),
    roots: sidesOf(SrcStreaming.AssessmentTest),
    text: streamingText(),
  },
  ...featureIds.flatMap((id) =>
    documentInputs
      .filter(({ root }) => root === id)
      .slice(0, featureSeedsPerRoot)
      .map((input): Seed => ({
        id: `feature/${input.id}`,
        kind: "feature",
        path: [SrcXml.clark(Option.some(FEATURE), id.toLowerCase())],
        record: input.roots,
        roots: input.roots,
        text: input.text,
      })),
  ),
];

/**
 * One attribute as written: its span with the leading whitespace, and its value's span inside the
 * quotes.
 */
interface AttributeSpan {
  readonly start: number;
  readonly end: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

/**
 * One tag as written: its span, its qualified name, whether it is an end tag or self-closing, the
 * offset its name ends at, and its attributes.
 */
interface TagSpan {
  readonly start: number;
  readonly end: number;
  readonly name: string;
  readonly nameEnd: number;
  readonly closing: boolean;
  readonly selfClosing: boolean;
  readonly attributes: readonly AttributeSpan[];
}

/**
 * One element as written: its start tag, and its end tag, the same tag when self-closing.
 */
interface ElementSpan {
  readonly open: TagSpan;
  readonly close: TagSpan;
}

/**
 * Start and end tags, `<name attr="v" ...>` or `</name>` or `<name/>`; comments, processing
 * instructions, CDATA, and DOCTYPEs do not match because a name starts with a letter or `_`.
 */
const tagPattern =
  /<(?<closing>\/?)(?<name>[A-Za-z_][\w.:-]*)(?<attributes>(?:\s+[^\s=<>/"']+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(?<selfClosing>\/?)>/gu;

/**
 * One attribute inside a tag's attribute text.
 */
const attributePattern = /\s+[^\s=]+\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/gu;

// Native: effect/encoding/Xml reports parse events without the as-written offsets of each tag and attribute, and fails on the malformed text later mutants hold, which a text-level mutation needs.
/**
 * Find every tag and attribute of a text by its as-written offsets.
 *
 * @param text - The document text.
 * @returns The tags in document order.
 */
const tagsOf = (text: string): readonly TagSpan[] =>
  Array.from(text.matchAll(tagPattern), (match): TagSpan => {
    const closing = match.groups?.closing ?? "";
    const name = match.groups?.name ?? "";
    const nameEnd = match.index + 1 + closing.length + name.length;

    const attributes = Array.from(
      (match.groups?.attributes ?? "").matchAll(attributePattern),
      (attribute): AttributeSpan => {
        const start = nameEnd + attribute.index;
        const end = start + attribute[0].length;
        const value = attribute.groups?.double ?? attribute.groups?.single ?? "";

        return { end, start, valueEnd: end - 1, valueStart: end - 1 - value.length };
      },
    );

    return {
      attributes,
      closing: closing === "/",
      end: match.index + match[0].length,
      name,
      nameEnd,
      selfClosing: match.groups?.selfClosing === "/",
      start: match.index,
    };
  });

/**
 * Pair start and end tags into elements, in the order their start tags appear.
 *
 * An end tag closes the nearest open start tag of the same name; start tags it skips stay
 * unpaired and are not elements.
 *
 * @param tags - The tags of a text in document order.
 * @returns The paired elements, self-closing tags included.
 */
const elementsOf = (tags: readonly TagSpan[]): readonly ElementSpan[] => {
  const open: TagSpan[] = [];
  const paired: ElementSpan[] = [];

  for (const tag of tags) {
    if (tag.selfClosing) {
      paired.push({ close: tag, open: tag });
    } else if (tag.closing) {
      const index = pipe(
        open,
        Arr.findLastIndex(({ name }) => name === tag.name),
      );

      if (Option.isSome(index)) {
        paired.push({ close: tag, open: open[index.value] ?? tag });
        open.length = index.value;
      }
    } else {
      open.push(tag);
    }
  }

  return Arr.sortWith(paired, ({ open: { start } }) => start, Order.Number);
};

/**
 * Pick one candidate by a selector, modulo their count.
 *
 * @param candidates - The candidates.
 * @param selector - A drawn selector.
 * @returns The picked candidate, or none when there are no candidates.
 */
const pickOf = <A>(candidates: readonly A[], selector: number): Option.Option<A> =>
  Option.fromUndefinedOr(candidates[selector % Math.max(candidates.length, 1)]);

/**
 * Replace a span of a text.
 *
 * @param text - The text.
 * @param start - The span's first offset.
 * @param end - The offset after the span.
 * @param replacement - The new text of the span.
 * @returns The text with the span replaced.
 */
const splice = (text: string, start: number, end: number, replacement: string): string =>
  `${text.slice(0, start)}${replacement}${text.slice(end)}`;

/**
 * The values `replace-value` writes into an attribute: empty, non-numeric, entity and character
 * references, an escaped `<`, and a reference to an entity no document declares.
 */
const replacementValues = ["", "x", "not-a-number", "&amp;", "&#60;", "&lt;b&gt;", "&undeclared;"];

/**
 * The markup `insert` writes at a tag boundary.
 */
const insertions = ["fuzz", "<!--fuzz-->", "<?fuzz data?>", "<![CDATA[fuzz]]>", "  \n\t"];

/**
 * A namespace no seed binds, for `rename`'s same-local-name-elsewhere mode.
 */
export const OTHER = "urn:effect-xml:fuzz:other";

/**
 * The local part of a qualified name.
 *
 * @param name - The qualified name.
 * @returns The part after the prefix, or the whole name.
 */
const localOf = (name: string): string => name.slice(name.indexOf(":") + 1);

/**
 * The offset after the XML declaration, or `0` when the text has none.
 *
 * @param text - The document text.
 * @returns Where a DOCTYPE may be inserted.
 */
const prologEnd = (text: string): number => (text.startsWith("<?xml") ? text.indexOf("?>") + 2 : 0);

/**
 * A mutant: its text and a description of what changed, carried into every input id.
 */
interface Mutant {
  readonly text: string;
  readonly mutation: string;
}

/**
 * Rename an element's start and end tags.
 *
 * @param text - The document text.
 * @param element - The element.
 * @param name - The new qualified name.
 * @param extra - Text written after the new name in the start tag, such as a declaration.
 * @returns The text with the element renamed.
 */
const renamed = (text: string, element: ElementSpan, name: string, extra: string): string => {
  const { close, open } = element;

  const withClose = close === open ? text : splice(text, close.start + 2, close.nameEnd, name);

  return splice(withClose, open.start + 1, open.nameEnd, `${name}${extra}`);
};

/**
 * Apply one drawn mutation to a seed text.
 *
 * Every operator is total: one that finds no target, such as `remove-attribute` on a text without
 * attributes, leaves the text unchanged and says so in the description.
 *
 * @param text - The seed text.
 * @param draw - The drawn mutation.
 * @returns The mutant.
 */
export const mutate = (text: string, draw: Draw): Mutant => {
  const tags = tagsOf(text);
  const starts = tags.filter(({ closing }) => !closing);
  const elements = elementsOf(tags);
  const attributes = tags.flatMap((tag) => tag.attributes);
  const boundary = pickOf(tags, draw.at).pipe(Option.map(({ start }) => start));
  const unchanged = (why: string): Mutant => ({ mutation: `${draw.operator} none (${why})`, text });

  switch (draw.operator) {
    case "remove-attribute": {
      return Option.match(pickOf(attributes, draw.pick), {
        onNone: () => unchanged("no attribute"),
        onSome: ({ end, start }) => ({
          mutation: `remove-attribute @${start}`,
          text: splice(text, start, end, ""),
        }),
      });
    }

    case "replace-value": {
      const value = replacementValues[draw.choice % replacementValues.length] ?? "";

      return Option.match(pickOf(attributes, draw.pick), {
        onNone: () => unchanged("no attribute"),
        onSome: ({ valueEnd, valueStart }) => ({
          mutation: `replace-value @${valueStart} ${JSON.stringify(value)}`,
          text: splice(text, valueStart, valueEnd, value),
        }),
      });
    }

    case "remove-element": {
      return Option.match(pickOf(elements, draw.pick), {
        onNone: () => unchanged("no element"),
        onSome: ({ close, open }) => ({
          mutation: `remove-element ${open.name}@${open.start}`,
          text: splice(text, open.start, close.end, ""),
        }),
      });
    }

    case "duplicate-element": {
      return Option.match(pickOf(elements, draw.pick), {
        onNone: () => unchanged("no element"),
        onSome: ({ close, open }) => ({
          mutation: `duplicate-element ${open.name}@${open.start}`,
          text: splice(text, close.end, close.end, text.slice(open.start, close.end)),
        }),
      });
    }

    case "rename": {
      return Option.match(pickOf(elements, draw.pick), {
        onNone: () => unchanged("no element"),
        onSome: (element) => {
          const local = localOf(element.open.name);

          const modes = [
            ["undeclared", `zz-${local}`, ""],
            ["unbound-prefix", `unbound:${local}`, ""],
            ["other-namespace", local, ` xmlns="${OTHER}"`],
          ] as const;

          const [label, name, extra] = modes[draw.choice % modes.length] ?? modes[0];

          return {
            mutation: `rename ${label} ${element.open.name}@${element.open.start}`,
            text: renamed(text, element, name, extra),
          };
        },
      });
    }

    case "insert": {
      const markup = insertions[draw.choice % insertions.length] ?? "";

      return Option.match(boundary, {
        onNone: () => unchanged("no tag"),
        onSome: (at) => ({
          mutation: `insert ${JSON.stringify(markup)} @${at}`,
          text: splice(text, at, at, markup),
        }),
      });
    }

    case "blank": {
      const content = draw.choice % 2 === 0 ? "" : " \n\t ";

      return Option.match(pickOf(elements, draw.pick), {
        onNone: () => unchanged("no element"),
        onSome: ({ close, open }) => ({
          mutation: `blank ${JSON.stringify(content)} ${open.name}@${open.start}`,
          text:
            close === open
              ? splice(text, open.end - 2, open.end, `>${content}</${open.name}>`)
              : splice(text, open.end, close.start, content),
        }),
      });
    }

    case "undeclared-attribute": {
      return Option.match(pickOf(starts, draw.pick), {
        onNone: () => unchanged("no start tag"),
        onSome: (tag) => ({
          mutation: `undeclared-attribute ${tag.name}@${tag.start}`,
          text: splice(text, tag.nameEnd, tag.nameEnd, ' data-fuzz="1" zz-undeclared="v"'),
        }),
      });
    }

    case "truncate": {
      const at = Math.floor((draw.at * text.length) / (scale + 1));

      return { mutation: `truncate @${at}`, text: text.slice(0, at) };
    }

    case "stray-end-tag": {
      return Option.match(boundary, {
        onNone: () => unchanged("no tag"),
        onSome: (at) => ({
          mutation: `stray-end-tag @${at}`,
          text: splice(text, at, at, "</stray>"),
        }),
      });
    }

    case "doctype": {
      const at = prologEnd(text);
      const doctype = '<!DOCTYPE fuzz [<!ENTITY fuzz "entity">]>';
      const withDoctype = splice(text, at, at, doctype);
      const reference = draw.choice % 2 === 0;

      const root = Option.fromUndefinedOr(
        tagsOf(withDoctype).find(({ closing, selfClosing }) => !closing && !selfClosing),
      );

      return {
        mutation: `doctype ${reference ? "referenced" : "unreferenced"}`,
        text:
          reference && Option.isSome(root)
            ? splice(withDoctype, root.value.end, root.value.end, "&fuzz;")
            : withDoctype,
      };
    }

    default: {
      return unchanged("unknown operator");
    }
  }
};

/**
 * Turn drawn cut selectors into offsets that split a text into two to five pieces.
 *
 * Offsets lie strictly inside the text, ascend, and never separate a surrogate pair, so each piece
 * is well-formed UTF-16. A text too short to split, or cuts that collapse, give fewer pieces.
 *
 * @param text - The text to split.
 * @param cuts - The drawn cut selectors, each a fraction of the text's length.
 * @returns The split offsets.
 */
export const piecesOf = (text: string, cuts: readonly number[]): readonly number[] => {
  const offsets = cuts.map((cut) => {
    const at = Math.max(1, Math.floor((cut * text.length) / (scale + 1)));

    return (text.codePointAt(at - 1) ?? 0) > 0xff_ff ? at + 1 : at;
  });

  return Arr.sort(
    Arr.dedupe(offsets).filter((at) => at > 0 && at < text.length),
    Order.Number,
  );
};

/**
 * The limits and parse options one variant adds to an input, each absent when the variant sets
 * none.
 */
interface VariantOptions {
  readonly options?: SrcXml.LimitOptions;
  readonly parseOptions?: SchemaAST.ParseOptions;
}

/**
 * The limits and parse options of each variant, read from the draw.
 *
 * @param variant - The variant.
 * @param draw - The drawn mutant description.
 * @returns The variant's limit options and parse options, each absent when the variant sets none.
 */
const variantOptions = (variant: Variant, draw: Draw): VariantOptions => {
  const byVariant: Readonly<Record<Variant, VariantOptions>> = {
    default: {},
    "errors-all": { parseOptions: { errors: "all" } },
    parser: { options: { maxDepth: draw.depth, maxTokenSize: draw.token } },
    records: { options: { maxElementNodes: draw.nodes, maxElementSize: draw.size } },
  };

  return byVariant[variant];
};

/**
 * Build every input of one drawn mutant: one per variant, with ids of the form
 * `index:seed:mutation#variant`.
 *
 * @param draw - The drawn mutant description.
 * @param index - The mutant's index, written into its ids.
 * @param from - The seed it mutates.
 * @returns The mutant's inputs, one per variant.
 */
export const inputsOf = (draw: Draw, index: number, from: Seed): readonly FuzzInput[] => {
  const { mutation, text } = mutate(from.text, draw);
  const prefixes = prefixesOf(from.text);
  const pieces = piecesOf(text, draw.cuts);

  return variants.map((variant): FuzzInput => ({
    ...variantOptions(variant, draw),
    id: `${index}:${from.id}:${mutation}#${variant}`,
    kind: from.kind,
    mutation,
    operator: draw.operator,
    path: from.path,
    pieces,
    prefixes,
    record: from.record,
    roots: from.roots,
    seed: from.id,
    text,
    variant,
  }));
};

/**
 * Read the seed a draw names: its own index modulo the seed count.
 *
 * @param draw - The drawn mutant description.
 * @returns The seed.
 * @throws {Error} When there are no seeds.
 */
export const seedOf = (draw: Draw): Seed => {
  const found = seeds[draw.seed % seeds.length];

  if (found === undefined) {
    throw new Error("the fuzz suite has no seeds");
  }

  return found;
};

/**
 * The drawn mutant descriptions, with the fixed seed, size, and count.
 *
 * Mutant `i` mutates seed `i` modulo the seed count, so every seed is mutated; the draw's own seed
 * index serves the property check, which picks seeds by it.
 */
export const draws: readonly Draw[] = Effect.runSync(
  Arbitrary.sampleEffect(Arbitrary.schema(DrawSchema), { count: runs, seed, size }),
).map((draw, index) => ({ ...draw, seed: index }));

/**
 * Every fuzzed input, in draw order and then variant order.
 */
export const fuzzInputs: readonly FuzzInput[] = draws.flatMap((draw, index) =>
  inputsOf(draw, index, seedOf(draw)),
);
