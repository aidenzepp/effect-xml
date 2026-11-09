import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";

import { GENERIC, ITEM_VALUE } from "./compile.ts";
import { ResolvedElementSchema } from "./element.ts";
import { DATA_PREFIX } from "./plan.ts";
import type { ChildPlan, ContentPlan, MixedMember, Plan } from "./plan.ts";
import { carriedChecks, structuralPlan } from "./structural-slot.ts";

/**
 * A structural codec: its Type is the Type of the element codec `compile` builds from the same
 * plan, and its Encoded side is the plain object the builder emits for that element, with every
 * attribute and text value still the raw string.
 */
export type Structural = Schema.Codec<unknown, unknown, unknown, unknown>;

/**
 * The `mixed` variant of `ContentPlan`.
 */
type MixedContent = Extract<ContentPlan, { readonly mode: "mixed" }>;

/**
 * The structural codec of each plan, built on first use.
 *
 * A module `WeakMap` keyed by the immutable `Plan` keeps the codec off every public AST: no
 * annotation is written, so `compile()` output and its derivations stay as they are, and a plan
 * that is no longer reachable releases its codec.
 */
const structurals = new WeakMap<Plan, Structural>();

/**
 * The checked structural codec of each user schema whose top node carries checks, built on first
 * use.
 *
 * Keyed by the user's AST, because two schemas over one plan can carry different checks; the
 * checked node is written onto no public AST.
 */
const checkedStructurals = new WeakMap<SchemaAST.AST, Structural>();

/**
 * The item for a text run of `mixed` content, as the builder emits it and as the element codec
 * decodes it: `{ _tag: "$text", text }`.
 */
const TextItem = Schema.Struct({ _tag: Schema.Literal("$text"), text: Schema.String });

/**
 * The generic item of open `mixed` content: `{ _tag: "*", element }`, holding the undeclared
 * element whole.
 */
const OpenItem = Schema.Struct({ _tag: Schema.Literal(GENERIC), element: ResolvedElementSchema });

/**
 * Read the structural codec of a child plan; {@link structuralOf} passes itself, so the helpers
 * below recurse without referring to it before it is declared.
 */
type Resolve = (plan: Plan) => Structural;

/**
 * Read the structural codec of a schema `structuralPlan` reads as `plan`, carrying the checks on
 * the schema's top node, building and caching the checked codec on first use.
 *
 * The checks are the user's own `Filter` objects, so the checked codec runs them on the structural
 * Type value exactly as the element codec runs them on its decoded value, and runs them on the
 * Type value before encoding. While a recursive plan's codec is still being built, `resolve` gives
 * its suspended self-reference, and Effect refuses checks on a `Suspend` node, so the checked
 * codec is then itself a `Schema.suspend` that reads the cached checked codec once it is built.
 *
 * @param schema - The root, slot, or member schema.
 * @param plan - The plan `structuralPlan` reads from `schema`.
 * @param resolve - Reads the structural codec of a plan.
 * @returns The plan's structural codec, with the schema's checks when it carries any.
 * @see {@link carriedChecks}
 */
const checkedCodec = (schema: Schema.Top, plan: Plan, resolve: Resolve): Structural => {
  const checks = carriedChecks(schema);

  if (checks === undefined) {
    return resolve(plan);
  }

  const cached = checkedStructurals.get(schema.ast);

  if (cached !== undefined) {
    return cached;
  }

  const codec = resolve(plan);

  if (codec.ast._tag === "Suspend") {
    return Schema.suspend((): Structural => checkedCodec(schema, plan, resolve));
  }

  const checked = codec.check(...checks);

  checkedStructurals.set(schema.ast, checked);

  return checked;
};

/**
 * Choose the codec of one `elements` slot or `mixed` member.
 *
 * A child `structuralPlan` reads as `compile` output, modulo annotations and top-node checks, gets
 * its own structural codec carrying those checks, so its Encoded side is the child's plain object.
 * Any other child is opaque: its own schema runs on the raw `ResolvedElement`, so a user's
 * transformation decides the value.
 *
 * @param schema - The slot or member schema.
 * @param resolve - Reads the structural codec of a child plan.
 * @returns The child's structural codec, or `schema` itself when it is opaque.
 * @see {@link structuralPlan}
 */
const childCodec = (schema: Schema.Top, resolve: Resolve): Schema.Top => {
  const plan = structuralPlan(schema);

  return plan === undefined ? schema : checkedCodec(schema, plan, resolve);
};

/**
 * Build the field of one `elements` slot from its cardinality, as `compile` does: `Schema.Array`
 * for `many`, `Schema.optionalKey` for `optional`, and the child codec itself for `one`.
 *
 * @param slot - The child slot.
 * @param resolve - Reads the structural codec of a child plan.
 * @returns The slot's field schema.
 */
const slotField = (slot: ChildPlan, resolve: Resolve): Schema.Top => {
  const codec = childCodec(slot.schema, resolve);

  if (slot.cardinality === "many") {
    return Schema.Array(codec);
  }

  return slot.cardinality === "optional" ? Schema.optionalKey(codec) : codec;
};

/**
 * Build the item of one `mixed` member: `{ _tag: <wire>, value }`, with the member's codec under
 * `value`.
 *
 * @param entry - The mixed member.
 * @param resolve - Reads the structural codec of a child plan.
 * @returns The member's item schema.
 */
const memberItem = (entry: MixedMember, resolve: Resolve): Schema.Top =>
  Schema.Struct({
    [ITEM_VALUE]: childCodec(entry.schema, resolve),
    _tag: Schema.Literal(entry.wire),
  });

/**
 * Build the field of `mixed` content: an array over the union of the text item, one item per
 * member, and the generic item when the content is open. Every item carries a distinct `_tag`
 * literal, so the union selects its candidate by tag on both sides.
 *
 * @param content - The mixed content plan.
 * @param resolve - Reads the structural codec of a child plan.
 * @returns The items field schema.
 */
const mixedField = (content: MixedContent, resolve: Resolve): Schema.Top =>
  Schema.Array(
    Schema.Union([
      TextItem,
      ...content.members.map((entry) => memberItem(entry, resolve)),
      ...(content.open ? [OpenItem] : []),
    ]),
  );

/**
 * Build the structural codec of one plan, with the same keys as the target Struct `compile`
 * builds: attributes and `text` through `Schema.toCodecStringTree`, the `elements` slots and the
 * open slot `"*"`, the `mixed` items under `"$children"`, and the `data-*` record as the rest of a
 * `Schema.StructWithRest`.
 *
 * @param plan - The element plan.
 * @param resolve - Reads the structural codec of a child plan.
 * @returns The plan's structural codec.
 */
const build = (plan: Plan, resolve: Resolve): Structural => {
  const fields: Record<string, Schema.Top> = {};

  for (const a of plan.attributes) {
    fields[a.key] = Schema.toCodecStringTree(a.schema);
  }

  const { content } = plan;

  if (content.mode === "text") {
    fields[content.key] = Schema.toCodecStringTree(content.schema);
  }

  if (content.mode === "elements") {
    for (const slot of content.children) {
      fields[slot.key] = slotField(slot, resolve);
    }

    if (content.open) {
      fields[GENERIC] = Schema.Array(ResolvedElementSchema);
    }
  }

  if (content.mode === "mixed") {
    fields[content.key] = mixedField(content, resolve);
  }

  const struct = Schema.Struct(fields);

  return plan.data === undefined
    ? struct
    : Schema.StructWithRest(struct, [
        Schema.Record(
          Schema.TemplateLiteral([DATA_PREFIX, Schema.String]),
          Schema.toCodecStringTree(plan.data),
        ),
      ]);
};

// Native: `Schema.toType`, `Schema.toEncoded`, and `Schema.toCodecStringTree` lack a codec from the builder's plain object to an element codec's Type; each keeps the element's own transformation.
/**
 * Read the structural codec of an element plan, building and caching it on first use.
 *
 * The codec decodes the plain object the builder emits to exactly the value the element codec
 * decodes from the matching resolved element, and encodes that value back to the plain object. A
 * child slot or member recurses into its own structural codec, carrying its top-node checks, only
 * when `structuralPlan` reads it as `compile` output; a transformed child stays opaque. Recursion
 * goes through `Schema.suspend`: the cache holds a suspended self-reference while the fields are
 * built, so a recursive child resolves to this codec once it is cached. The codec sets no
 * `onExcessProperty` and adds no `encodingChecks`, because the builder emits only the keys the
 * Struct declares and the caller's parse options pass through unchanged.
 *
 * @param plan - The element plan.
 * @returns The plan's structural codec, the same instance on every call.
 * @see {@link structuralPlan}
 */
export const structuralOf = (plan: Plan): Structural => {
  const cached = structurals.get(plan);

  if (cached !== undefined) {
    return cached;
  }

  structurals.set(
    plan,
    Schema.suspend((): Structural => structuralOf(plan)),
  );

  const codec = build(plan, structuralOf);

  structurals.set(plan, codec);

  return codec;
};

/**
 * Read the structural codec of a root, slot, or member schema, carrying the checks on its top node.
 *
 * A schema with no check gets the plan's shared {@link structuralOf} codec; a checked one gets a
 * codec that adds the user's own `Filter` objects, cached per user AST and written onto no public
 * AST.
 *
 * @param schema - A schema `structuralPlan` reads as `plan`.
 * @param plan - The schema's plan.
 * @returns The schema's structural codec, the same instance on every call.
 * @see {@link carriedChecks}
 */
export const checkedStructuralOf = (schema: Schema.Top, plan: Plan): Structural =>
  checkedCodec(schema, plan, structuralOf);
