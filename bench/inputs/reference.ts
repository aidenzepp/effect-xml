/**
 * The reference counts every case's output is checked against, read from the upstream tokenizer
 * and from resolved trees rather than from any case under measurement.
 */
import type * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

import type { ResolvedElement } from "../../src/element.ts";

/**
 * Count the elements of XML text as the upstream tokenizer sees them.
 *
 * @param text - The XML text to tokenize.
 * @returns The number of `StartElement` events `Xml.decodeString()` yields, failing with the
 *   tokenizer's error on malformed text.
 */
export const countElements = (text: string): Effect.Effect<number, Xml.XmlError> =>
  Stream.make(text).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.filter((event) => event._tag === "StartElement"),
    Stream.runCount,
  );

/**
 * Count the elements of a resolved tree.
 *
 * @param element - The root of the tree.
 * @returns The root plus every element descendant; string children are not counted.
 */
export const countTreeElements = (element: ResolvedElement): number => {
  let count = 1;

  for (const child of element.children) {
    if (!Predicate.isString(child)) {
      count += countTreeElements(child);
    }
  }

  return count;
};
