/**
 * The inputs of the wrapped-element differential suite: one small element `leaf` under each Schema
 * wrapper an author can apply (`.check`, `Schema.decodeTo`, `.annotate`, `Schema.brand`, and the
 * bare element as the baseline), placed as a child slot, as a `mixed` member, and as the document
 * root.
 *
 * `planOf` sees through `.check` and `Schema.decodeTo` (`src/plan.ts`), so a fast path that treated
 * every marked slot as structural would skip the author's check or transformation. Each wrapper is
 * built once on `src`; each input pairs its root and record definition with their
 * {@link standardOf} copies, so the suite compares the fast path with the standard path on every
 * surface under every wrapper at every placement. This module imports no test runner, so the
 * acceptance run and the no-eval child processes reuse exactly these inputs.
 */
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import { standardOf } from "./harness.ts";
import type { DocumentInput, Sides } from "./harness.ts";

/**
 * The Schema wrapper applied to `leaf`: `bare` is the unwrapped element every other wrapper is
 * measured against.
 */
export type Wrapper = "annotate" | "bare" | "brand" | "check" | "decodeTo";

/**
 * Where the wrapped `leaf` sits: the `leaf` slot of `holder`'s `elements` content, a member of the
 * `mixed` content of `holder`'s `note`, or the document root.
 */
export type Placement = "member" | "root" | "slot";

/**
 * The `leaf` an input holds at its placement: `ok` passes every wrapper, `refused` carries the
 * attribute value the check refuses, and `missing` lacks the required attribute, so every wrapper
 * rejects it.
 */
export type Variant = "missing" | "ok" | "refused";

/**
 * A root or record definition built on `src`: an element codec with no services.
 */
export type SrcRoot = Schema.Codec<unknown, SrcXml.XmlElement<string>>;

/**
 * One wrapped-element input: the document text, the document root and the channel record with
 * their standard-path copies, and the record path that selects the wrapped `leaf` at its
 * placement.
 */
export interface WrappedInput extends DocumentInput<SrcRoot> {
  readonly wrapper: Wrapper;
  readonly placement: Placement;
  readonly variant: Variant;
  readonly record: Sides<SrcRoot>;
  readonly path: readonly string[];
}

/**
 * The decoded value of a bare `leaf`: its `kind` attribute and its text.
 */
interface LeafValue {
  readonly kind: string;
  readonly $text: string;
}

/**
 * The `kind` value the checked `leaf` refuses and every other wrapper accepts.
 */
const refusedKind = "refused";

/**
 * The shape `Schema.decodeTo` turns a `leaf` into, so a decoded value differs from the bare one in
 * its keys and its field names.
 */
const Model = Schema.Struct({ body: Schema.String, label: Schema.String });

/**
 * The transformation between a bare `leaf` value and {@link Model}, in both directions.
 */
const toModel = SchemaTransformation.transform<typeof Model.Encoded, LeafValue>({
  decode: ({ $text, kind }) => ({ body: $text, label: kind }),
  encode: ({ body, label }) => ({ $text: body, kind: label }),
});

/**
 * The filter the checked `leaf` applies: it refuses {@link refusedKind} and accepts any other kind.
 */
const refusal = Schema.makeFilter<LeafValue>(
  ({ kind }) => kind !== refusedKind || `kind "${refusedKind}" is refused; choose another kind`,
);

/**
 * The bare `leaf`: a `kind` attribute over `text` content.
 */
const Leaf = SrcXml.Element("leaf", {
  attributes: { kind: Schema.String },
  content: SrcXml.text(Schema.String),
});

/**
 * The `leaf` under each wrapper.
 */
const leaves: Readonly<Record<Wrapper, SrcRoot>> = {
  annotate: Leaf.annotate({ title: "leaf" }),
  bare: Leaf,
  brand: Leaf.pipe(Schema.brand("Leaf")),
  check: Leaf.check(refusal),
  decodeTo: Leaf.pipe(Schema.decodeTo(Model, toModel)),
};

/**
 * Build the `holder` around one wrapped `leaf`: the leaf fills the required `leaf` slot and is the
 * one member of the optional `note`'s `mixed` content.
 *
 * @param leaf - The wrapped `leaf`.
 * @returns The `holder` element codec.
 */
const holderOf = (leaf: SrcRoot): SrcRoot =>
  SrcXml.Element("holder", {
    content: SrcXml.elements({
      leaf,
      note: SrcXml.optionalKey(SrcXml.Element("note", { content: SrcXml.mixed([leaf]) })),
    }),
  });

/**
 * Pair a root or record definition with its standard-path copy.
 *
 * @param root - The definition built on `src`.
 * @returns The definition as the `src` side and its {@link standardOf} copy as the standard side.
 */
const sidesOf = (root: SrcRoot): Sides<SrcRoot> => ({ src: root, standard: standardOf(root) });

/**
 * Write one `leaf` start tag, text, and end tag for a variant.
 *
 * @param variant - Which `kind` the leaf carries, if any.
 * @param text - The leaf's text.
 * @returns The leaf's markup.
 */
const leafMarkup = (variant: Variant, text: string): string => {
  const attributes =
    variant === "missing" ? "" : ` kind="${variant === "ok" ? "ok" : refusedKind}"`;

  return `<leaf${attributes}>${text}</leaf>`;
};

/**
 * The document that holds a variant's `leaf` at each placement; the slot and member documents
 * span lines, so a positioned failure names a line other than the first.
 */
const documentOf: Readonly<Record<Placement, (variant: Variant) => string>> = {
  member: (variant) =>
    [
      "<holder>",
      `  ${leafMarkup("ok", "slot text")}`,
      `  <note>before ${leafMarkup(variant, "member text")} after</note>`,
      "</holder>",
    ].join("\n"),
  root: (variant) => leafMarkup(variant, "root text"),
  slot: (variant) => `<holder>\n  ${leafMarkup(variant, "slot text")}\n</holder>`,
};

/**
 * The record path that selects the variant's `leaf` at each placement.
 */
const pathOf: Readonly<Record<Placement, readonly string[]>> = {
  member: ["holder", "note", "leaf"],
  root: ["leaf"],
  slot: ["holder", "leaf"],
};

/**
 * Every wrapper in a fixed order, `bare` first.
 */
export const wrappers: readonly Wrapper[] = ["bare", "check", "decodeTo", "annotate", "brand"];

/**
 * Every placement in a fixed order.
 */
export const placements: readonly Placement[] = ["slot", "member", "root"];

/**
 * Every variant in a fixed order.
 */
export const variants: readonly Variant[] = ["ok", "refused", "missing"];

/**
 * Every wrapped-element input: each wrapper at each placement holding each variant, with ids of
 * the form `wrapper/placement/variant`. Inputs of one wrapper share its leaf and holder sides.
 */
export const wrappedInputs: readonly WrappedInput[] = wrappers.flatMap((wrapper) => {
  const record = sidesOf(leaves[wrapper]);
  const holder = sidesOf(holderOf(leaves[wrapper]));

  return placements.flatMap((placement) =>
    variants.map((variant): WrappedInput => ({
      id: `${wrapper}/${placement}/${variant}`,
      path: pathOf[placement],
      placement,
      record,
      roots: placement === "root" ? record : holder,
      text: documentOf[placement](variant),
      variant,
      wrapper,
    })),
  );
});
