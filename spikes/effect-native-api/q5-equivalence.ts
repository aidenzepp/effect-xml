// Q5: an Equivalence<ResolvedElement> derived from a definition, vs the README round-trip region's
// canonicalize(..., { normalize: normalizedNames(Root) }) === canonicalize(...).
import { Effect } from "effect";

import {
  canonicalize,
  decodeString,
  decodeTree,
  type ElementCodec,
  encodeString,
  normalizedNames,
} from "../../src/index.ts";
import { equivalence } from "./q5-equivalence-lib.ts";
import { AssessmentItem } from "../../test/qti/vocabulary.ts";
import { ChoiceInteraction, bg007, line, readmeXml } from "./shared.ts";

const roundTrip = <T>(def: ElementCodec<string, T>, xml: string) =>
  Effect.gen(function* () {
    const value = yield* decodeString(def)(xml);
    const encoded = yield* encodeString(def)(value);
    const before = yield* decodeTree()(xml);
    const after = yield* decodeTree()(encoded);
    // before (README today):
    const normalize = normalizedNames(def);
    const today = canonicalize(before, { normalize }) === canonicalize(after, { normalize });
    // after:
    const eq = equivalence(def);
    return {
      today,
      equivalence: eq(before, after),
      differs: eq(before, { ...after, attributes: { ...after.attributes, extra: "1" } }),
    };
  });

line("README round trip", Effect.runSync(roundTrip(ChoiceInteraction, readmeXml)));
line("bg007 round trip", Effect.runSync(roundTrip(AssessmentItem, bg007)));
