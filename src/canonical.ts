import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import type * as Schema from "effect/Schema";

import type { ResolvedElement } from "./element.ts";
import { planOf } from "./plan.ts";
import type { ContentPlan, AnyElement, Plan } from "./plan.ts";

// Native: `Xml.encodeString` and `Schema.toEncoderXml` lack a set of structure-only elements.
/**
 * Options for `canonicalize`.
 *
 * `normalize` holds Clark names of the elements whose children are compared as a set rather than
 * as a sequence: whitespace-only text is dropped and child elements are ordered by Clark name.
 * Every other element compares strictly, in document order with its whitespace, because an
 * element the vocabulary does not declare may be mixed content, as in `<span>x <b>1</b> y</span>`.
 * The set is required: which elements carry only structure depends on the vocabulary, so derive
 * it from the definition with `normalizedNames`.
 */
export interface CanonicalOptions {
  readonly normalize: ReadonlySet<string>;
}

/**
 * Escape the four characters that would change the meaning of printed markup.
 *
 * @param text - Text to escape.
 * @returns The text with `&`, `<`, `>`, and `"` replaced by entities.
 */
const escape = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Collapse every whitespace run to a single space.
 *
 * @param text - Text to normalise.
 * @returns The normalised text.
 */
const normalizeText = (text: string): string => text.replaceAll(/\s+/gu, " ");

/**
 * Print attributes with keys sorted, so attribute order is not significant.
 *
 * @param attributes - Attributes keyed by Clark name.
 * @returns The printed attributes, each preceded by a space.
 */
const canonicalAttributes = (attributes: Readonly<Record<string, string>>): string => {
  const entries: readonly (readonly [string, string])[] = Object.entries(attributes);

  return Arr.sort(
    entries,
    Order.mapInput(Order.String, (entry: readonly [string, string]) => entry[0]),
  )
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join("");
};

/**
 * Order elements by Clark name; `Arr.sort` is stable, so equal names keep their relative order.
 */
const byName: Order.Order<ResolvedElement> = Order.mapInput(
  Order.String,
  (element: ResolvedElement) => element.name,
);

// Native: `Schema.toEncoderXml` and `Xml.encodeString` lack Clark names and whitespace folding.
/**
 * Print a resolved element in canonical form, the round-trip comparison oracle.
 *
 * Names print as Clark names, so two trees equal in expanded names but different in prefix
 * spelling are equal. Not preserved, and so not significant: attribute order, quote style, entity
 * form, self-closing form, the XML declaration, comments, processing instructions, and runs of
 * whitespace inside attribute values and text (normalised to one space). Inside the `normalize`
 * set, also not significant: whitespace-only text and the order of child elements with different
 * names. Encoding writes `elements` slots in declaration order, so the order of differently
 * named children is outside the round-trip promise; inside the set child elements print sorted
 * by Clark name with a stable sort, so same-named siblings keep their document order. Every
 * element outside the set compares strictly, in document order with its whitespace: an
 * undeclared element kept by an open slot encodes verbatim and may be mixed content, where order
 * is content.
 *
 * @param element - The element to print.
 * @param options - The normalized set, usually `{ normalize: normalizedNames(Root) }`.
 * @returns The canonical string.
 */
export const canonicalize = (element: ResolvedElement, options: CanonicalOptions): string => {
  const normalized = options.normalize.has(element.name);

  const elementChildren = element.children.filter(
    (child): child is ResolvedElement => !Predicate.isString(child),
  );

  const ordered = normalized ? Arr.sort(elementChildren, byName) : elementChildren;
  let next = 0;
  let children = "";

  for (const child of element.children) {
    if (Predicate.isString(child)) {
      if (!normalized || child.trim() !== "") {
        children += escape(normalizeText(child));
      }
    } else {
      children += canonicalize(ordered[next] ?? child, options);
      next += 1;
    }
  }

  return `<${element.name}${canonicalAttributes(element.attributes)}>${children}</${element.name}>`;
};

/**
 * List the schemas of the child elements a content plan can contain.
 *
 * @param content - The content plan of one element.
 * @returns The `elements` children or `mixed` members; empty for `empty` and `text` content.
 */
const memberSchemas = (content: ContentPlan): readonly Schema.Top[] => {
  if (content.mode === "elements") {
    return content.children.map((child) => child.schema);
  }

  if (content.mode === "mixed") {
    return content.members.map((member) => member.schema);
  }

  return [];
};

// Native: `Schema.AST` traversal lacks the element plans the `effect-xml` marker carries.
/**
 * Derive the normalized-element set of a definition from its plans.
 *
 * An `elements` element encodes its slots in declaration order and writes no text, and an `empty`
 * element writes no children, so for both only the set of children carries meaning. `mixed` and
 * `text` elements, and every element the definition does not declare, stay out of the set and
 * compare strictly.
 *
 * The walk follows `elements` children and `mixed` members through `planOf`. A visited set keyed
 * by Clark name ends the walk on recursive definitions such as `div`. Identity is not usable as
 * the key because a marker thunk may build a fresh `Plan` on every call, and a Clark name
 * identifies one element declaration.
 *
 * The parameter is an {@link AnyElement}, so a schema without the `effect-xml` marker is a type
 * error rather than a silent empty set.
 *
 * @param def - The root element definition.
 * @returns Clark names of every reachable element whose content mode is `elements` or `empty`.
 */
export const normalizedNames = (def: AnyElement): ReadonlySet<string> => {
  const names = new Set<string>();
  const expanded = new Set<string>();
  const pending: Plan[] = [];
  const root = planOf(def);

  if (root !== undefined) {
    pending.push(root);
  }

  for (let plan = pending.pop(); plan !== undefined; plan = pending.pop()) {
    if (!expanded.has(plan.name)) {
      expanded.add(plan.name);

      const { content } = plan;
      const schemas = memberSchemas(content);

      if (content.mode === "elements" || content.mode === "empty") {
        names.add(plan.name);
      }

      for (const schema of schemas) {
        const child = planOf(schema);

        if (child !== undefined) {
          pending.push(child);
        }
      }
    }
  }

  return names;
};
