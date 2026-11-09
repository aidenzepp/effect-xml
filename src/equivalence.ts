import * as Equivalence from "effect/Equivalence";

import { canonicalize, normalizedNames } from "./canonical.ts";
import type { ResolvedElement } from "./element.ts";
import type { AnyElement } from "./plan.ts";

/**
 * Construct the equivalence that decides whether two element trees mean the same document under a
 * definition.
 *
 * Inside an element the definition declares with `elements` content or with no content,
 * whitespace-only text and the order of differently named children do not count; same-named
 * siblings keep their order. Every other element compares strictly, in document order with its
 * whitespace, because order is content in `mixed` and `text` elements and in elements the
 * definition does not declare. Everywhere, names compare as Clark names (prefix spelling does not
 * count), attribute order and the XML declaration do not count, and runs of whitespace in text and
 * attribute values count as one space.
 *
 * Encoding writes `elements` children in declaration order, so this equivalence is the round-trip
 * check: a document and the encoding of its decoded value are equivalent.
 *
 * @example
 *   const same = equivalence(ChoiceInteraction);
 *
 *   same(before, after); // true when only child order or indentation differs
 *
 * @param def - The root element definition; the elements it reaches decide which compare loosely.
 * @returns An equivalence on element trees, built once per definition.
 */
export const equivalence = (def: AnyElement): Equivalence.Equivalence<ResolvedElement> => {
  const normalize = normalizedNames(def);

  return Equivalence.mapInput(Equivalence.strictEqual<string>(), (element: ResolvedElement) =>
    canonicalize(element, { normalize }),
  );
};
