import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as Stream from "effect/Stream";

import type { EncodeOptions } from "./codec.ts";
import { GENERIC, ITEM_VALUE } from "./compile.ts";
import { isResolvedElement } from "./element.ts";
import type { AnyElement, ContentPlan, Plan } from "./plan.ts";
import { checkedStructuralOf } from "./structural.ts";
import type { Structural } from "./structural.ts";
import { structuralPlan } from "./structural-slot.ts";
import { Tokenizer } from "./tokenizer.ts";
import { toEventsFrom, writerOf } from "./writer.ts";
import type { Writer } from "./writer.ts";

/**
 * The `mixed` variant of `ContentPlan`.
 */
type MixedContent = Extract<ContentPlan, { readonly mode: "mixed" }>;

/**
 * The structural positions of one plan the open-item check visits: each `elements` slot key with
 * its structural plan, each `mixed` member wire name with its structural plan, and, for open
 * `mixed` content, the Clark names of its declared members. Each wire name names exactly one
 * member: `structuralPlan` reads an element whose `mixed` members share a wire tag or a Clark name
 * as opaque, so no such element reaches these positions; its compiled codec encodes each item
 * through the one member of its collision group that accepts the value exactly. Opaque slots and
 * members are absent: their own schema runs the compiled encode, guard included.
 */
interface Positions {
  readonly slots: readonly { readonly key: string; readonly plan: Plan }[];
  readonly members: ReadonlyMap<string, Plan>;
  readonly declared: ReadonlySet<string> | undefined;
}

/**
 * The positions of each plan, read once. Plans are immutable, so an entry is shared by every
 * attempt built from a plan that reaches it.
 */
const positionsByPlan = new WeakMap<Plan, Positions>();

/**
 * Whether each root plan reaches open `mixed` content through structural positions, read once.
 */
const reachesOpenMixed = new WeakMap<Plan, boolean>();

/**
 * Whether a content plan is open `mixed` content.
 *
 * @param content - The content plan.
 * @returns `true` for `mixed` content with `open` set.
 */
const openMixed = (content: ContentPlan): content is MixedContent =>
  content.mode === "mixed" && content.open;

/**
 * Read a plan's structural positions, resolving each slot and member through `structuralPlan`
 * once.
 *
 * Every plan read here is `structuralPlan` output or a position of one, and `structuralPlan` reads
 * an element whose `mixed` members share a wire tag or a Clark name as opaque, so the members key
 * by wire tag without a collision.
 *
 * @param plan - The element plan.
 * @returns The plan's positions.
 */
const positionsOf = (plan: Plan): Positions => {
  const known = positionsByPlan.get(plan);

  if (known !== undefined) {
    return known;
  }

  const { content } = plan;
  const slots: { readonly key: string; readonly plan: Plan }[] = [];
  const members = new Map<string, Plan>();

  if (content.mode === "elements") {
    for (const slot of content.children) {
      const child = structuralPlan(slot.schema);

      if (child !== undefined) {
        slots.push({ key: slot.key, plan: child });
      }
    }
  }

  if (content.mode === "mixed") {
    for (const member of content.members) {
      const child = structuralPlan(member.schema);

      if (child !== undefined) {
        members.set(member.wire, child);
      }
    }
  }

  const declared = openMixed(content)
    ? new Set(content.members.map((member) => member.name))
    : undefined;

  const read: Positions = { declared, members, slots };

  positionsByPlan.set(plan, read);

  return read;
};

/**
 * Whether open `mixed` content appears anywhere among the structural descendants of a root plan,
 * the root included, so a value of a vocabulary without it skips the open-item walk.
 *
 * @param root - The root plan.
 * @returns `true` when some structurally reachable plan has open `mixed` content.
 */
const hasOpenMixed = (root: Plan): boolean => {
  const known = reachesOpenMixed.get(root);

  if (known !== undefined) {
    return known;
  }

  const seen = new Set<Plan>();
  const pending = [root];
  let found = false;

  while (!found && pending.length > 0) {
    const plan = pending.pop();

    if (plan !== undefined && !seen.has(plan)) {
      seen.add(plan);

      const positions = positionsOf(plan);

      found = positions.declared !== undefined;
      pending.push(...positions.slots.map((slot) => slot.plan), ...positions.members.values());
    }
  }

  reachesOpenMixed.set(root, found);

  return found;
};

// Native: the structural codec's `{ _tag: "*", element }` item checks the element with `ResolvedElementSchema`, which reads its top level only; `compile`'s `openItem` adds the rule below on its Encoded side.
/**
 * Whether the element of an open `mixed` `*` item passes the Encoded-side rule of `compile`'s
 * `openItem`: a name that is no declared member's Clark name, every attribute value a string, and
 * every child a string or a resolved element.
 *
 * Today's encode rejects an item that breaks the rule with a Schema failure. The structural codec
 * checks the element's top-level shape only, and the writer reads every attribute and child, so
 * such an element would reach the writer, which can throw on a non-element child, or the
 * tokenizer, which may write a non-string attribute value. An element that is not a resolved
 * element at all passes here, because the structural encode rejects it.
 *
 * @param element - The item's `element` value.
 * @param declared - The Clark names of the content's declared members.
 * @returns `false` when today's `openItem` rejects the element.
 * @see `openItem` and `wireElement` in `compile.ts`, the rule this check mirrors.
 */
const admitsOpenElement = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the item's element before any validation; anything that is not a resolved element is left to the structural encode.
  element: unknown,
  declared: ReadonlySet<string>,
): boolean =>
  !isResolvedElement(element) ||
  (!declared.has(element.name) &&
    Object.values(element.attributes).every(Predicate.isString) &&
    element.children.every((child) => Predicate.isString(child) || isResolvedElement(child)));

/**
 * Whether a value admits every open `mixed` `*` item at the structural positions of its plan,
 * walking structural `elements` slots and `mixed` members only.
 *
 * The walk reads the value before any validation, so it is total: a value of the wrong shape at
 * any position passes, and the structural encode rejects it.
 *
 * @param plan - The plan of the value's element.
 * @param value - The element's Type-side value.
 * @returns `false` when some open `mixed` `*` item breaks `openItem`'s Encoded-side rule.
 */
const admitsOpenItems = (
  plan: Plan,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the caller's value before validation, read by key and checked as it is read.
  value: unknown,
): boolean => {
  if (!Predicate.isReadonlyObject(value)) {
    return true;
  }

  const positions = positionsOf(plan);

  for (const { key, plan: child } of positions.slots) {
    const raw = value[key];

    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (!admitsOpenItems(child, item)) {
        return false;
      }
    }
  }

  const items = plan.content.mode === "mixed" ? value[plan.content.key] : undefined;

  if (!Array.isArray(items)) {
    return true;
  }

  for (const item of items) {
    const tag = Predicate.isReadonlyObject(item) ? item._tag : undefined;
    const member = Predicate.isString(tag) ? positions.members.get(tag) : undefined;

    if (
      Predicate.isReadonlyObject(item) &&
      ((tag === GENERIC &&
        positions.declared !== undefined &&
        !admitsOpenElement(item.element, positions.declared)) ||
        (member !== undefined && !admitsOpenItems(member, item[ITEM_VALUE])))
    ) {
      return false;
    }
  }

  return true;
};

/**
 * The plan, checked structural codec, and writer of a structural root, built on the first attempt.
 */
interface Prepared {
  readonly plan: Plan;
  readonly codec: Structural;
  readonly openItems: boolean;
  readonly writer: Writer;
}

/**
 * Build a fast encoder from a value of the root element codec `def` to one XML document's text,
 * giving `None` wherever it declines so the caller runs today's `encodeString` for the text or
 * its exact error.
 *
 * The attempt runs four steps. A root `structuralPlan` reads as opaque, such as a `decodeTo`
 * wrapper, gives `None` and runs no user code. A value holding an open `mixed` `*` item that
 * today's `openItem` rejects gives `None` before any leaf runs. The value then encodes with the
 * root's structural codec, carrying the root's top-node checks, inside the caller's effect, with
 * the caller's parse options and services: a Schema failure gives `None`, while a defect or an
 * interruption propagates unchanged. Last, `toEventsFrom` writes the plain object to events with
 * `def`'s prefix map, declared on the root as `encodeString` declares it, and the current
 * {@link Tokenizer}'s `encodeString` writes them, read from the context with no identity check: a
 * writer refusal or an `XmlError` gives `None`. Leaf encodes have run by then, so they run again
 * when the caller falls back. The tokenizer's channel is built once per attempt that reaches it.
 *
 * @param def - The element codec of the document root.
 * @param options - Whether the text leads with the XML declaration.
 * @returns A function from a value, and optional parse options, to an effect yielding the text,
 *   or `None` when the caller must run today's encode.
 * @see {@link structuralOf}
 * @see {@link toEventsFrom}
 */
export const attemptEncode = <Def extends AnyElement>(def: Def, options?: EncodeOptions) => {
  let prepared: Prepared | null | undefined;

  /**
   * Read the root's plan and writer, building them on the first attempt so a recursive
   * definition's thunks are not forced when the encoder is built.
   *
   * @returns The prepared root, or `null` when the root is opaque.
   */
  const prepare = (): Prepared | null => {
    if (prepared === undefined) {
      const plan = structuralPlan(def);

      prepared =
        plan === undefined
          ? null
          : {
              codec: checkedStructuralOf(def, plan),
              openItems: hasOpenMixed(plan),
              plan,
              writer: writerOf(plan, plan.prefixes),
            };
    }

    return prepared;
  };

  const declaration = options?.declaration ?? true;

  return Effect.fnUntraced(function* attempt(
    value: Def["Type"],
    parseOptions?: SchemaAST.ParseOptions,
  ): Effect.fn.Return<Option.Option<string>, never, Def["EncodingServices"]> {
    const root = prepare();

    if (root === null || (root.openItems && !admitsOpenItems(root.plan, value))) {
      return Option.none();
    }

    // SAFETY: the structural codec runs exactly the leaf schemas of `def`, so its encoding
    // services are those of `def`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the structural codec erases its services to `unknown` at the type level only.
    const encoded = Schema.encodeEffect(root.codec)(value, parseOptions) as Effect.Effect<
      unknown,
      Schema.SchemaError,
      Def["EncodingServices"]
    >;

    const plain = yield* Effect.option(encoded);

    if (Option.isNone(plain)) {
      return Option.none();
    }

    const events = toEventsFrom(root.writer, plain.value, { declaration });

    if (events === undefined) {
      return Option.none();
    }

    const tokenizer = yield* Tokenizer;

    return yield* Stream.fromIterable(events).pipe(
      Stream.pipeThroughChannel(tokenizer.encodeString()),
      Stream.mkString,
      Effect.option,
    );
  });
};
