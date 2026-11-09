// Library half of Q5 (the runs are in q5-equivalence.ts).
import { Equivalence } from "effect";

import {
  canonicalize,
  type ElementCodec,
  normalizedNames,
  type ResolvedElement,
} from "../../src/index.ts";

/**
 * The whole proposed export: the comparator stays canonicalize; the API becomes an Equivalence.
 */
export const equivalence = (
  def: ElementCodec<string, unknown>,
): Equivalence.Equivalence<ResolvedElement> => {
  const normalize = normalizedNames(def);
  return Equivalence.mapInput(Equivalence.strictEqual<string>(), (element: ResolvedElement) =>
    canonicalize(element, { normalize }),
  );
};
