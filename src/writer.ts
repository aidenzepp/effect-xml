import type { Xml } from "effect/encoding";
import * as Predicate from "effect/Predicate";

import { GENERIC, ITEM_VALUE, isData } from "./compile.ts";
import { isResolvedElement } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import { XmlEncodeError } from "./issue.ts";
import type { Plan, PrefixMap } from "./plan.ts";
import { declarationFor, spell, spellAttributes } from "./resolve.ts";
import { structuralPlan } from "./structural-slot.ts";

/**
 * A plain encoded object: the Encoded side of an element's structural codec, read by key.
 */
interface Plain {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the keys vary per plan and each value is checked where it is read, refusing a mismatch.
  readonly [key: string]: unknown;
}

/**
 * The opening of one element in one scope: the spelled name, which is also the close tag, the
 * `xmlns` attributes it declares, and the bindings its children inherit.
 */
interface Head {
  readonly name: string;
  readonly declared: Readonly<Record<string, string>>;
  readonly own: PrefixMap;
}

/**
 * The child plans of one element plan, read once per plan: each `elements` slot key with its
 * structural plan in declaration order, and each `mixed` member by wire name with its structural
 * plan. A plan of `undefined` marks an opaque slot or member, whose value is a resolved element.
 */
interface ChildPlans {
  readonly slots: readonly { readonly key: string; readonly plan: Plan | undefined }[];
  readonly members: ReadonlyMap<string, Plan | undefined>;
}

/**
 * One attribute an element's start tag carries: the key it is read from or written to, and its
 * value or spelled name.
 */
interface Pair {
  readonly key: string;
  readonly value: string;
}

/**
 * One structural position of a node, an `elements` slot or a `mixed` member: its structural plan
 * and the node of that plan under this node, built on first use. A plan of `undefined` marks an
 * opaque position, whose value is a resolved element and which never gets a node.
 */
interface Child {
  readonly plan: Plan | undefined;
  node: Node | undefined;
}

/**
 * One element plan written in one set of in-scope bindings: its head, its `xmlns` declarations as
 * pairs, the plain key and spelled name of each declared attribute when the direct attribute path
 * applies, and its slots and members, each holding its child node once built.
 */
interface Node {
  readonly plan: Plan;
  readonly head: Head;
  readonly declarations: readonly Pair[];
  readonly direct: readonly Pair[] | undefined;
  readonly slots: readonly (Child & { readonly key: string })[];
  readonly open: boolean;
  readonly members: ReadonlyMap<string, Child>;
}

/**
 * A writer from an element's plain encoded object to upstream events, precomputed for one root
 * plan and one prefix map. Build it with {@link writerOf}; write with {@link toEventsFrom}.
 */
export interface Writer {
  readonly root: Node;
  readonly prefixes: PrefixMap;
}

/**
 * The child plans read so far, one entry per plan. Plans are immutable, so an entry is shared by
 * every node and writer built from the same plan.
 */
const childPlansByPlan = new WeakMap<Plan, ChildPlans>();

/**
 * Merge prefix records with `Object.fromEntries`, later entries winning, so that a prefix named
 * `__proto__` is an own key, as `toEvents` builds its scopes.
 *
 * @param entries - The bindings to merge.
 * @returns A fresh record.
 */
const merge = (...entries: readonly PrefixMap[]): Record<string, string> =>
  Object.fromEntries(entries.flatMap((entry) => Object.entries(entry)));

/**
 * Compute an element's head with the rules of `toEvents`: declare `declarations` (the whole map,
 * on the root only) and whatever `declarationFor` says the element's own name needs.
 *
 * @param scope - The bindings in effect for the parent.
 * @param declarations - The map bindings to declare on this element; empty below the root.
 * @param map - The writer's prefix map.
 * @param clarkName - The element's Clark name.
 * @returns The element's head.
 */
const headOf = (
  scope: PrefixMap,
  declarations: PrefixMap,
  map: PrefixMap,
  clarkName: string,
): Head => {
  const rooted: PrefixMap = { ...scope, ...declarations };
  const needed = declarationFor(rooted, map, clarkName);
  const added = needed === undefined ? {} : { [needed.prefix]: needed.uri };
  const own = merge(rooted, added);

  const declared = Object.fromEntries(
    Object.entries(merge(declarations, added)).map(([prefix, uri]) => [
      prefix === "" ? "xmlns" : `xmlns:${prefix}`,
      uri,
    ]),
  );

  return { declared, name: spell(own, clarkName, false) ?? clarkName, own };
};

/**
 * Read a plan's child plans, resolving each slot and member through `structuralPlan` once.
 *
 * @param plan - The element plan.
 * @returns The plan's child plans.
 */
const childPlansOf = (plan: Plan): ChildPlans => {
  const known = childPlansByPlan.get(plan);

  if (known !== undefined) {
    return known;
  }

  const { content } = plan;

  const slots =
    content.mode === "elements"
      ? content.children.map((slot) => ({ key: slot.key, plan: structuralPlan(slot.schema) }))
      : [];

  const members = new Map<string, Plan | undefined>();

  if (content.mode === "mixed") {
    for (const member of content.members) {
      // `writerOf` takes any plan, and a `planOf` plan can list members that share a wire tag; keep the first.
      if (!members.has(member.wire)) {
        members.set(member.wire, structuralPlan(member.schema));
      }
    }
  }

  const read: ChildPlans = { members, slots };

  childPlansByPlan.set(plan, read);

  return read;
};

/**
 * Spell every declared attribute of a plan once, through `spellAttributes`, for the direct
 * attribute path. Any subset of a set that spells without a conflict spells the same way, so a
 * present subset reuses these spellings.
 *
 * The direct path assigns each spelled name into the start tag's record. Assigning to a key
 * named `__proto__` on an ordinary object runs the prototype setter instead of adding an own key,
 * so a plan with an attribute spelled `__proto__` takes the per-element path instead, and its
 * records come from `spellAttributes` as for a plan with `data`.
 *
 * @param plan - The element plan.
 * @param own - The bindings in effect for the element.
 * @returns Each declared attribute's plain key and spelled name in plan order, or `undefined`
 *   when the plan declares `data`, some declared attribute fails to spell, or some attribute
 *   spells as `__proto__`, so each element spells its own.
 */
const directOf = (plan: Plan, own: PrefixMap): readonly Pair[] | undefined => {
  if (plan.data !== undefined) {
    return undefined;
  }

  const probe = Object.fromEntries(plan.attributes.map((a) => [a.name, a.name]));
  const spelled = spellAttributes([], own, { attributes: probe, children: [], name: plan.name });

  if (spelled instanceof XmlEncodeError) {
    return undefined;
  }

  const spellings = new Map(Object.entries(spelled).map(([name, key]) => [key, name]));

  const pairs = plan.attributes.map((a) => ({
    key: a.key,
    value: spellings.get(a.name) ?? a.name,
  }));

  return pairs.some((pair) => pair.value === "__proto__") ? undefined : pairs;
};

/**
 * Build the node of a plan in one scope.
 *
 * @param plan - The element plan.
 * @param scope - The bindings in effect for the parent.
 * @param declarations - The map bindings to declare on this element; empty below the root.
 * @param map - The writer's prefix map.
 * @returns The node.
 */
const nodeOf = (plan: Plan, scope: PrefixMap, declarations: PrefixMap, map: PrefixMap): Node => {
  const head = headOf(scope, declarations, map, plan.name);
  const childPlans = childPlansOf(plan);
  const members = new Map<string, Child>();

  for (const [wire, member] of childPlans.members) {
    members.set(wire, { node: undefined, plan: member });
  }

  return {
    declarations: Object.entries(head.declared).map(([key, value]) => ({ key, value })),
    direct: directOf(plan, head.own),
    head,
    members,
    open: plan.content.mode === "elements" && plan.content.open,
    plan,
    slots: childPlans.slots.map((slot) => ({ key: slot.key, node: undefined, plan: slot.plan })),
  };
};

/**
 * Read or build the node of a structural position under a parent node.
 *
 * @param parent - The parent node.
 * @param child - One of the parent's slots or members.
 * @param map - The writer's prefix map.
 * @returns The position's node, or `undefined` for an opaque position.
 */
const childOf = (parent: Node, child: Child, map: PrefixMap): Node | undefined => {
  if (child.plan === undefined || child.node !== undefined) {
    return child.node;
  }

  child.node = nodeOf(child.plan, parent.head.own, {}, map);

  return child.node;
};

/**
 * Write a resolved element depth-first with the rules of `toEvents`, as an opaque slot, an opaque
 * member, or open content holds it.
 *
 * @param out - The events written so far.
 * @param scope - The bindings in effect for the parent.
 * @param element - The element to write.
 * @param map - The writer's prefix map.
 * @returns `false` when an attribute cannot be spelled, `true` when the subtree was written.
 */
const writeResolved = (
  out: Xml.Event[],
  scope: PrefixMap,
  element: ResolvedElement,
  map: PrefixMap,
): boolean => {
  const head = headOf(scope, {}, map, element.name);
  const spelled = spellAttributes([], head.own, element);

  if (spelled instanceof XmlEncodeError) {
    return false;
  }

  out.push({ _tag: "StartElement", attributes: { ...head.declared, ...spelled }, name: head.name });

  for (const child of element.children) {
    if (Predicate.isString(child)) {
      out.push({ _tag: "Text", text: child });
    } else if (!writeResolved(out, head.own, child, map)) {
      return false;
    }
  }

  out.push({ _tag: "EndElement", name: head.name });

  return true;
};

/**
 * Collect and spell a plain object's attributes per element, in the order `compile`'s encode
 * gives them: declared attributes in plan order, then `data-*` keys in the object's order. A node
 * without a direct attribute path writes its attributes here.
 *
 * @param node - The element's node.
 * @param plain - The element's plain encoded object.
 * @returns The start tag's attributes, `xmlns` declarations first, or `undefined` for a value
 *   that is not a string or an attribute that cannot be spelled.
 */
const spelledAttributesOf = (node: Node, plain: Plain): Record<string, string> | undefined => {
  const { plan } = node;
  const attributes: Record<string, string> = {};

  for (const a of plan.attributes) {
    const raw = plain[a.key];

    if (raw !== undefined) {
      if (!Predicate.isString(raw)) {
        return undefined;
      }

      attributes[a.name] = raw;
    }
  }

  for (const [key, raw] of Object.entries(plain)) {
    if (isData(plan, key)) {
      if (!Predicate.isString(raw)) {
        return undefined;
      }

      attributes[key] = raw;
    }
  }

  const spelled = spellAttributes([], node.head.own, {
    attributes,
    children: [],
    name: plan.name,
  });

  return spelled instanceof XmlEncodeError ? undefined : { ...node.head.declared, ...spelled };
};

/**
 * Build a start tag's attributes: each `xmlns` declaration, then each present declared attribute
 * under its precomputed spelling, assigned into one fresh record.
 *
 * The key order equals `{ ...declared, ...spelled }`: `spellAttributes` rejects a name spelled as
 * a namespace declaration, so no attribute overwrites a declaration, and no XML name is an
 * integer-like key that objects order first.
 *
 * @param node - The element's node.
 * @param plain - The element's plain encoded object.
 * @returns The start tag's attributes, or `undefined` for a value that is not a string.
 */
const attributesOf = (node: Node, plain: Plain): Record<string, string> | undefined => {
  const { direct } = node;

  if (direct === undefined) {
    return spelledAttributesOf(node, plain);
  }

  const attributes: Record<string, string> = {};

  for (const declaration of node.declarations) {
    attributes[declaration.key] = declaration.value;
  }

  for (const pair of direct) {
    const raw = plain[pair.key];

    if (raw !== undefined) {
      if (!Predicate.isString(raw)) {
        return undefined;
      }

      attributes[pair.value] = raw;
    }
  }

  return attributes;
};

/**
 * Write one value of a structural position: a plain object through the position's node, or a
 * resolved element for an opaque position.
 *
 * @param out - The events written so far.
 * @param parent - The parent node.
 * @param node - The position's node, or `undefined` when the position is opaque.
 * @param value - The value.
 * @param map - The writer's prefix map.
 * @returns `false` for a refusal, `true` when the value was written.
 */
const writeChild = (
  out: Xml.Event[],
  parent: Node,
  node: Node | undefined,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a slot value of the structural codec's Encoded side, checked here before it is written.
  value: unknown,
  map: PrefixMap,
): boolean => {
  if (node === undefined) {
    return isResolvedElement(value) && writeResolved(out, parent.head.own, value, map);
  }

  return (
    Predicate.isReadonlyObject(value) &&
    // oxlint-disable-next-line no-use-before-define -- a structural child recurses into writeNode, which writes the child's own slots through this function.
    writeNode(out, node, value, map)
  );
};

/**
 * Write each resolved element of a node's open content.
 *
 * @param out - The events written so far.
 * @param node - The element's node.
 * @param undeclared - The open content's value.
 * @param map - The writer's prefix map.
 * @returns `false` for a refusal, `true` when every element was written.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- open content of the structural codec's Encoded side, checked here before it is written.
const writeOpen = (out: Xml.Event[], node: Node, undeclared: unknown, map: PrefixMap): boolean => {
  if (!Array.isArray(undeclared)) {
    return false;
  }

  const elements: readonly unknown[] = undeclared;

  for (const element of elements) {
    if (!(isResolvedElement(element) && writeResolved(out, node.head.own, element, map))) {
      return false;
    }
  }

  return true;
};

/**
 * Write the children of `elements` content: each slot in declaration order, an array slot item by
 * item and any other present value as one child, then open content.
 *
 * @param out - The events written so far.
 * @param node - The element's node.
 * @param plain - The element's plain encoded object.
 * @param map - The writer's prefix map.
 * @returns `false` for a refusal, `true` when every child was written.
 */
const writeElements = (out: Xml.Event[], node: Node, plain: Plain, map: PrefixMap): boolean => {
  for (const slot of node.slots) {
    const raw = plain[slot.key];

    if (raw !== undefined) {
      const child = childOf(node, slot, map);

      if (Array.isArray(raw)) {
        const items: readonly unknown[] = raw;

        for (const item of items) {
          if (!writeChild(out, node, child, item, map)) {
            return false;
          }
        }
      } else if (!writeChild(out, node, child, raw, map)) {
        return false;
      }
    }
  }

  return !node.open || writeOpen(out, node, plain[GENERIC], map);
};

/**
 * Write one item of `mixed` content: a text run, a member, or an undeclared element.
 *
 * @param out - The events written so far.
 * @param node - The element's node.
 * @param item - The item.
 * @param map - The writer's prefix map.
 * @returns `false` for a refusal, `true` when the item was written.
 */
const writeItem = (
  out: Xml.Event[],
  node: Node,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a mixed item of the structural codec's Encoded side, checked here before it is written.
  item: unknown,
  map: PrefixMap,
): boolean => {
  if (!Predicate.isReadonlyObject(item)) {
    return false;
  }

  const tag = item._tag;

  if (tag === "$text") {
    if (!Predicate.isString(item.text)) {
      return false;
    }

    out.push({ _tag: "Text", text: item.text });

    return true;
  }

  if (tag === GENERIC) {
    return isResolvedElement(item.element) && writeResolved(out, node.head.own, item.element, map);
  }

  const member = Predicate.isString(tag) ? node.members.get(tag) : undefined;

  return (
    member !== undefined && writeChild(out, node, childOf(node, member, map), item[ITEM_VALUE], map)
  );
};

/**
 * Write a plain object's element: the start tag, its content by mode, and the end tag.
 *
 * @param out - The events written so far.
 * @param node - The element's node.
 * @param plain - The element's plain encoded object.
 * @param map - The writer's prefix map.
 * @returns `false` for a refusal, `true` when the subtree was written.
 */
const writeNode = (out: Xml.Event[], node: Node, plain: Plain, map: PrefixMap): boolean => {
  const attributes = attributesOf(node, plain);

  if (attributes === undefined) {
    return false;
  }

  const { head } = node;
  const { content } = node.plan;

  out.push({ _tag: "StartElement", attributes, name: head.name });

  if (content.mode === "text") {
    const raw = plain[content.key];

    if (!Predicate.isString(raw)) {
      return false;
    }

    if (raw !== "") {
      out.push({ _tag: "Text", text: raw });
    }
  } else if (content.mode === "elements") {
    if (!writeElements(out, node, plain, map)) {
      return false;
    }
  } else if (content.mode === "mixed") {
    const items = plain[content.key];

    if (!Array.isArray(items)) {
      return false;
    }

    const list: readonly unknown[] = items;

    for (const item of list) {
      if (!writeItem(out, node, item, map)) {
        return false;
      }
    }
  }

  out.push({ _tag: "EndElement", name: head.name });

  return true;
};

/**
 * Precompute a writer for a root plan and the prefix map its document spells names with.
 *
 * The writer applies `toEvents`'s spelling rules (`prefixFor`, `spell`, `declarationFor`, and
 * `spellAttributes` from `resolve.ts`) and computes each element's spelled name, `xmlns`
 * declarations, attribute spellings, and close tag once per plan and in-scope bindings, on first
 * use, so recursive plans are expanded only as deep as a value goes.
 *
 * @param plan - The root element's plan.
 * @param prefixes - The prefix map, declared on the root as `toEvents` declares it.
 * @returns The writer.
 * @see {@link toEventsFrom}
 */
export const writerOf = (plan: Plan, prefixes: PrefixMap): Writer => ({
  prefixes,
  root: nodeOf(plan, {}, prefixes, prefixes),
});

/**
 * Write an element's plain encoded object to the events `toEvents` writes for the resolved
 * element `compile`'s encode gives for the same value, or refuse.
 *
 * The plain object is the Encoded side of the element's structural codec: attributes, `data-*`
 * keys, and `"$text"` as strings; a structural `elements` slot or `mixed` member as a nested plain
 * object; an opaque slot or member, and open content, as resolved elements. A refusal is
 * `undefined` and carries no error: a leaf that is not a string (the check `compile`'s encode
 * makes), an attribute namespace no prefix spells (`toEvents`'s `UnmappedNamespace`), any other
 * attribute `spellAttributes` rejects, and a value of the wrong shape. The caller re-runs today's
 * encode for the exact error. Plain JavaScript: no Schema and no Effect run here.
 *
 * @param writer - The writer from {@link writerOf}.
 * @param plain - The root's plain encoded object.
 * @param options - Whether a `Declaration` event leads (default `true`).
 * @returns The events in document order, or `undefined` for a refusal.
 */
export const toEventsFrom = (
  writer: Writer,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the structural codec's Encoded side, checked as it is read; a mismatch is a refusal, not a defect.
  plain: unknown,
  options: { readonly declaration?: boolean },
): readonly Xml.Event[] | undefined => {
  const out: Xml.Event[] =
    options.declaration === false
      ? []
      : // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- plan lock 9 fixes the declaration as encoding="UTF-8"; this is XML text, not a Node encoding name.
        [{ _tag: "Declaration", encoding: "UTF-8", version: "1.0" }];

  return Predicate.isReadonlyObject(plain) && writeNode(out, writer.root, plain, writer.prefixes)
    ? out
    : undefined;
};
