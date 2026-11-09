import * as Predicate from "effect/Predicate";

import { GENERIC, ITEM_VALUE, attributeKeysOf, isBlank, isData, slotsOf } from "./compile.ts";
import type { ResolvedElement } from "./element.ts";
import type { ChildPlan, Plan } from "./plan.ts";
import { structuralPlan } from "./structural-slot.ts";

/**
 * A plain encoded object: the Encoded side of an element's structural codec, keyed by the struct
 * keys the plan declares, with every attribute and text value the raw string.
 */
export interface Plain {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the keys vary per plan and each is one the structural codec declares.
  [key: string]: unknown;
}

/**
 * A slot or mixed member's route to its child's compiled node. A plan of `undefined` marks an
 * opaque child, whose own schema decodes the raw resolved element.
 *
 * The node is read from {@link nodesByPlan} on the first child the link builds and then kept on
 * the link, so building a child reads a field rather than the cache. Resolving lazily through the
 * shared cache keeps a `suspend` cycle finite: a plan that reaches itself links back to its own
 * node instead of compiling one per depth.
 */
interface Link {
  readonly plan: Plan | undefined;
  node: Node | undefined;
}

/**
 * One `elements` slot: its struct key, its position in slot order (where its value waits until
 * the keys are written), and whether it is `many`.
 */
interface Slot extends Link {
  readonly key: string;
  readonly index: number;
  readonly many: boolean;
}

/**
 * One `mixed` member: the `_tag` its items carry.
 */
interface Member extends Link {
  readonly wire: string;
}

/**
 * The compiled rules of one plan, read once from the sources `decodeElement` uses: the declared
 * attributes by Clark name, the `elements` slots in slot order and by Clark name, and the `mixed`
 * members by Clark name.
 */
interface Node {
  readonly plan: Plan;
  readonly attributes: ReadonlyMap<string, string>;
  readonly slotOrder: readonly Slot[];
  readonly slots: ReadonlyMap<string, Slot>;
  readonly members: ReadonlyMap<string, Member>;
}

/**
 * The compiled node of each plan, built on first use. Plans are immutable, so a node is shared by
 * every element the plan builds, and a plan that is no longer reachable releases its node. A build
 * reads this cache once for its root; child nodes are then reached through their {@link Link}.
 */
const nodesByPlan = new WeakMap<Plan, Node>();

/**
 * Compile the slots of `elements` content: one {@link Slot} per declared child in slot order,
 * indexed by Clark name through `slotsOf`, the lookup the element codec's decoder groups by.
 *
 * @param plan - The element plan.
 * @returns The slots in slot order and by Clark name; both empty for any other content mode.
 */
const slotsFor = (plan: Plan) => {
  const { content } = plan;
  const declared: readonly ChildPlan[] = content.mode === "elements" ? content.children : [];

  const byEntry = new Map(
    declared.map((entry, index): [ChildPlan, Slot] => [
      entry,
      {
        index,
        key: entry.key,
        many: entry.cardinality === "many",
        node: undefined,
        plan: structuralPlan(entry.schema),
      },
    ]),
  );

  const byName = new Map<string, Slot>();

  for (const [name, entry] of slotsOf(content)) {
    const slot = byEntry.get(entry);

    if (slot !== undefined) {
      byName.set(name, slot);
    }
  }

  return { byName, order: [...byEntry.values()] };
};

/**
 * Compile the node of a plan.
 *
 * @param plan - The element plan.
 * @returns The plan's compiled rules, with every link to a child node still empty.
 */
const compileNode = (plan: Plan): Node => {
  const { content } = plan;
  const { byName, order } = slotsFor(plan);
  const members = new Map<string, Member>();

  if (content.mode === "mixed") {
    for (const entry of content.members) {
      members.set(entry.name, {
        node: undefined,
        plan: structuralPlan(entry.schema),
        wire: entry.wire,
      });
    }
  }

  return { attributes: attributeKeysOf(plan), members, plan, slotOrder: order, slots: byName };
};

/**
 * Read the compiled node of a plan, compiling and caching it on first use.
 *
 * @param plan - The element plan.
 * @returns The plan's compiled node.
 */
const nodeOf = (plan: Plan): Node => {
  const cached = nodesByPlan.get(plan);

  if (cached !== undefined) {
    return cached;
  }

  const node = compileNode(plan);

  nodesByPlan.set(plan, node);

  return node;
};

/**
 * Build the value of one slot or member: the child's plain object when it is structural, the raw
 * resolved element when it is opaque. {@link buildNode} passes itself, so this helper recurses
 * without referring to it before it is declared.
 *
 * @param link - The slot or member.
 * @param element - The child element.
 * @param recurse - Builds the plain object of a structural child against its compiled node.
 * @returns The child's value, or `undefined` when the child's own build refuses it.
 */
const childValue = (
  link: Link,
  element: ResolvedElement,
  recurse: (node: Node, element: ResolvedElement) => Plain | undefined,
): Plain | ResolvedElement | undefined => {
  if (link.plan === undefined) {
    return element;
  }

  link.node ??= nodeOf(link.plan);

  return recurse(link.node, element);
};

/**
 * Write the declared attributes under their struct keys and the admitted `data-*` ones under
 * their own names, in the element's attribute order; any other attribute refuses (B2).
 *
 * `for...in` visits own string keys in the same order as `Object.entries` without allocating an
 * array of pairs per element, the builder's largest single cost in
 * `docs/rd/perf3b-spikes/builder.md`. The `Object.hasOwn` guard skips inherited keys, which
 * `Object.entries` never visits.
 *
 * @param out - The object under construction.
 * @param node - The element's compiled node.
 * @param attributes - The element's attributes by Clark name.
 * @returns `true` when every attribute was written, `false` on a refusal.
 */
const writeAttributes = (
  out: Plain,
  node: Node,
  attributes: ResolvedElement["attributes"],
): boolean => {
  for (const name in attributes) {
    if (!Object.hasOwn(attributes, name)) {
      continue;
    }

    const key = node.attributes.get(name) ?? (isData(node.plan, name) ? name : undefined);

    if (key === undefined) {
      return false;
    }

    out[key] = attributes[name];
  }

  return true;
};

/**
 * Whether `empty` content admits the children: only blank text (receipt C7 row B3).
 *
 * @param children - The element's children.
 * @returns `true` when every child is blank text; the content then adds no field.
 */
const emptyAdmits = (children: ResolvedElement["children"]): boolean => {
  for (const child of children) {
    if (!Predicate.isString(child) || !isBlank(child)) {
      return false;
    }
  }

  return true;
};

/**
 * Write the text slot: the string children joined, blank runs included; an element child refuses
 * (receipt C7 row B4).
 *
 * @param out - The object under construction.
 * @param key - The text slot key.
 * @param children - The element's children.
 * @returns `true` when the slot was written, `false` on a refusal.
 */
const writeText = (out: Plain, key: string, children: ResolvedElement["children"]): boolean => {
  let joined = "";

  for (const child of children) {
    if (!Predicate.isString(child)) {
      return false;
    }

    joined += child;
  }

  out[key] = joined;

  return true;
};

/**
 * Write the `elements` slots: hold each child's value at its slot's index, an array for a `many`
 * slot and the value itself otherwise, then write the keys in slot order with an absent `optional`
 * or `one` slot omitted; open content then holds every unnamed child under `GENERIC` in document
 * order. Refuses non-blank text (B5), an unnamed child of closed content (B6), a second child of a
 * `one` or `optional` slot before that child is built (B7), and any child whose own build refuses.
 *
 * @param out - The object under construction.
 * @param node - The element's compiled node.
 * @param open - Whether unnamed children are admitted under `GENERIC`.
 * @param children - The element's children.
 * @param recurse - Builds the plain object of a structural child against its compiled node.
 * @returns `true` when the slots were written, `false` on a refusal.
 */
const writeElements = (
  out: Plain,
  node: Node,
  open: boolean,
  children: ResolvedElement["children"],
  recurse: (node: Node, element: ResolvedElement) => Plain | undefined,
): boolean => {
  const values: unknown[] = [];
  const undeclared: ResolvedElement[] | undefined = open ? [] : undefined;

  for (const child of children) {
    if (Predicate.isString(child)) {
      if (!isBlank(child)) {
        return false;
      }

      continue;
    }

    const slot = node.slots.get(child.name);

    if (slot === undefined) {
      if (undeclared === undefined) {
        return false;
      }

      undeclared.push(child);

      continue;
    }

    const held = values[slot.index];

    if (held !== undefined && !slot.many) {
      return false;
    }

    const value = childValue(slot, child, recurse);

    if (value === undefined) {
      return false;
    }

    if (!slot.many) {
      values[slot.index] = value;
    } else if (Array.isArray(held)) {
      held.push(value);
    } else {
      values[slot.index] = [value];
    }
  }

  for (const slot of node.slotOrder) {
    const value = values[slot.index];

    if (slot.many) {
      out[slot.key] = value ?? [];
    } else if (value !== undefined) {
      out[slot.key] = value;
    }
  }

  if (undeclared !== undefined) {
    out[GENERIC] = undeclared;
  }

  return true;
};

/**
 * Write the `mixed` items in document order: each text run as `{ _tag: "$text", text }`, each
 * member element as `{ value, _tag: <wire> }`, and in open content each other element as
 * `{ _tag: "*", element }`. Refuses an element no member names in closed content (B8) and any
 * member whose own build refuses.
 *
 * @param out - The object under construction.
 * @param node - The element's compiled node.
 * @param content - The mixed content plan.
 * @param content.key - The items slot key.
 * @param content.open - Whether unnamed elements are admitted as generic items.
 * @param children - The element's children.
 * @param recurse - Builds the plain object of a structural member against its compiled node.
 * @returns `true` when the items were written, `false` on a refusal.
 */
const writeMixed = (
  out: Plain,
  node: Node,
  content: { readonly key: string; readonly open: boolean },
  children: ResolvedElement["children"],
  recurse: (node: Node, element: ResolvedElement) => Plain | undefined,
): boolean => {
  const items: unknown[] = [];

  for (const child of children) {
    if (Predicate.isString(child)) {
      items.push({ _tag: "$text", text: child });

      continue;
    }

    const member = node.members.get(child.name);

    if (member === undefined) {
      if (!content.open) {
        return false;
      }

      items.push({ _tag: GENERIC, element: child });

      continue;
    }

    const value = childValue(member, child, recurse);

    if (value === undefined) {
      return false;
    }

    items.push({ [ITEM_VALUE]: value, _tag: member.wire });
  }

  out[content.key] = items;

  return true;
};

/**
 * Build the plain object of one element against its compiled node, or refuse it.
 *
 * @param node - The compiled node of the element's plan.
 * @param element - The collected element.
 * @returns The plain object, or `undefined` when today's codec rejects the element's shape.
 */
const buildNode = (node: Node, element: ResolvedElement): Plain | undefined => {
  const { plan } = node;

  if (element.name !== plan.name) {
    return undefined;
  }

  const out: Plain = {};

  if (!writeAttributes(out, node, element.attributes)) {
    return undefined;
  }

  const { content } = plan;
  const { children } = element;

  if (content.mode === "empty") {
    return emptyAdmits(children) ? out : undefined;
  }

  if (content.mode === "text") {
    return writeText(out, content.key, children) ? out : undefined;
  }

  const written =
    content.mode === "elements"
      ? writeElements(out, node, content.open, children, buildNode)
      : writeMixed(out, node, content, children, buildNode);

  return written ? out : undefined;
};

// Native: `Schema.decodeUnknownEffect` of the element codec and `effect/encoding/Xml` lack a reshape of a resolved element to the structural codec's Encoded side that runs no Schema or Effect.
/**
 * Build the plain encoded object a collected element decodes from through
 * `structuralOf(plan)`, or refuse an element whose shape today's element codec rejects.
 *
 * The builder only reshapes: every attribute and text value stays the raw string, and no Schema,
 * Effect, or user code runs. It reads its rules from the sources the element codec's own decoder
 * uses (`attributeKeysOf`, `slotsOf`, `isData`, `isBlank`, `GENERIC`, and the plan's
 * `content.members`), so the two admit the same shapes. Its refusals are exactly the decoder's
 * shape rejections: another element name (receipt C7 row B1), an undeclared attribute (B2),
 * non-blank text or an element in `empty` content (B3), an element in `text` content (B4),
 * non-blank text in `elements` content (B5), an unnamed child of closed `elements` (B6), a second
 * child of a `one` or `optional` slot (B7), and an unnamed element of closed `mixed` (B8). A
 * refusal anywhere in the tree refuses the whole element, so no child is ever dropped. Leaf
 * values, a missing `one` slot, and opaque slots and members are left to the structural decode,
 * which rejects what the element codec rejects.
 *
 * Keys follow the element codec's decoder (M6): attributes in the element's attribute order,
 * declared ones under their struct keys and admitted `data-*` ones under their own names, then
 * the content keys in slot order; mixed items keep document order with blank and empty text runs.
 * Only keys the structural codec declares are written (F9).
 *
 * Each plan's rules are compiled once into a node whose slots and members link to their
 * children's nodes, so a build allocates only the output, the slot values of `many` slots, and
 * the generic list of open content.
 *
 * @param plan - The element plan, typically read from the codec with `structuralPlan`.
 * @param element - The collected element.
 * @returns The plain object, or `undefined` for a refusal.
 * @see {@link structuralOf} in `structural.ts`, which decodes the result.
 * @see `docs/rd/perf3b-spikes/builder.md` for the measured cost of each part of this design.
 */
export const build = (plan: Plan, element: ResolvedElement): Plain | undefined =>
  buildNode(nodeOf(plan), element);
