/**
 * Checks the fast decode and encode attempts themselves against the `src` standard path, in both
 * directions, over the inputs of the corpus, generated, fuzz, and wrapped suites (guard F7.1).
 *
 * A fast-path false reject costs only time, because the caller falls back to the standard codec,
 * but a false accept has no safety net, so the public outcomes the guardrail suites compare cannot
 * show one. Each decode case therefore holds `attemptDecode` to two rules: the standard decode
 * rejects, so the attempt gives `None` (R1); the attempt gives `Some`, so the standard decode
 * accepts with the same value and own-key order (R2). The standard decode is
 * `Schema.decodeUnknownEffect` of the `standardOf` copy (`./harness.ts`) of the input's definition,
 * over the element `src`'s `decodeTree` reads. Each encode case holds `attemptEncode` to the
 * mirrors: `encodeString` of the `standardOf` root fails, so the attempt gives `None`; the attempt
 * gives `Some(text)`, so that encode gives the byte-identical text. An opaque root, where
 * `structuralPlan` reads `undefined`, must give `None` and is counted apart; a `None` for a
 * structural root the standard path accepts is a false reject, a builder or writer gap rather than
 * a divergence, and is listed by id. Each suite also counts its structural cases, so it cannot pass
 * on opaque roots alone.
 */
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";

import { decodeTree, encodeString } from "../../src/codec.ts";
import { attemptDecode } from "../../src/fast-decode.ts";
import { attemptEncode } from "../../src/fast-encode.ts";
import type { XmlSchema as SrcXml } from "../../src/index.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import { channelInputs, itemInputs } from "./corpus.cases.ts";
import { fuzzInputs } from "./fuzz.cases.ts";
import { documentInputs, encodeInputs } from "./generated.cases.ts";
import { valueSummary } from "./harness.ts";
import type { DocumentInput, EncodeInput, InputOptions, Sides } from "./harness.ts";
import { wrappedInputs } from "./wrapped.cases.ts";

/**
 * An element codec built on `src` whose schemas need no services, the shape every input's
 * definition and its `standardOf` copy have.
 */
type SrcDef = Schema.Codec<unknown, SrcXml.XmlElement<string>>;

/**
 * One text input under check: a suite's document input, with the record definition and its
 * standard-path copy when they differ from the root's.
 */
interface AcceptanceInput extends DocumentInput<SrcDef> {
  readonly record?: Sides<SrcDef>;
}

/**
 * One value input under check, a suite's encode input over element codecs.
 */
type EncodeCase = EncodeInput<unknown, SrcDef>;

/**
 * One decode case: an element `src`'s `decodeTree` read from the text, the definition the attempt
 * decodes it with, and the `standardOf` copy the standard decode uses.
 */
interface DecodeCase {
  readonly id: string;
  readonly defs: Sides<SrcDef>;
  readonly element: SrcXml.ResolvedElement;
  readonly options?: InputOptions;
  readonly parseOptions?: SchemaAST.ParseOptions;
}

/**
 * The counts one suite accumulates, reported and asserted by its test.
 *
 * `unreached` counts the texts `src`'s `decodeTree` rejects, which never reach the fast path and
 * contribute no case. `decodeStructural` and `encodeStructural` count the cases whose `src` root
 * has a structural plan, the only ones the attempt can answer `Some` for. `violations` lists every
 * broken rule by case id.
 */
interface Tally {
  unreached: number;
  decodeCases: number;
  decodeStructural: number;
  decodeAccepts: number;
  decodeRejects: number;
  decodeOpaque: number;
  decodeDefects: number;
  readonly falseRejects: string[];
  encodeCases: number;
  encodeStructural: number;
  encodeAccepts: number;
  encodeRejects: number;
  encodeOpaque: number;
  encodeDefects: number;
  readonly encodeFalseRejects: string[];
  readonly violations: string[];
}

/**
 * One suite's inputs and the counts it must reach.
 *
 * `decodedValues` adds every value the standard decode gives as an encode case. `encodes` is either
 * the suite's value inputs or the reason it has none. `rejects` asserts decode rejects above zero,
 * for the suites built to produce Schema failures that reach the fast path; `encodeRejects` does
 * the same for encode; `exact` asserts an empty false-reject list.
 */
interface Suite {
  readonly name: string;
  readonly inputs: readonly AcceptanceInput[];
  readonly encodes: readonly EncodeCase[] | { readonly none: string };
  readonly decodedValues: boolean;
  readonly rejects: boolean;
  readonly encodeRejects: boolean;
  readonly exact: boolean;
}

/**
 * The per-suite timeout: the fuzz suite reads every mutant and decodes each root and record on
 * both paths, on Node.
 */
const timeout = 120_000;

/**
 * Build an empty tally.
 *
 * @returns A tally with every count at zero.
 */
const emptyTally = (): Tally => ({
  decodeAccepts: 0,
  decodeCases: 0,
  decodeDefects: 0,
  decodeOpaque: 0,
  decodeRejects: 0,
  decodeStructural: 0,
  encodeAccepts: 0,
  encodeCases: 0,
  encodeDefects: 0,
  encodeFalseRejects: [],
  encodeOpaque: 0,
  encodeRejects: 0,
  encodeStructural: 0,
  falseRejects: [],
  unreached: 0,
  violations: [],
});

/**
 * Memoize a builder per definition, so each definition's attempt reads its plan once across the
 * cases that share it.
 *
 * @param make - Builds the value for a definition.
 * @returns The memoized builder.
 */
const memoized = <K extends object, V>(make: (key: K) => V): ((key: K) => V) => {
  const cache = new WeakMap<K, V>();

  return (key) => {
    const known = cache.get(key);

    if (known !== undefined) {
      return known;
    }

    const made = make(key);

    cache.set(key, made);

    return made;
  };
};

/**
 * The fast decoder of each `src` definition.
 */
const decoderOf = memoized((def: SrcDef) => attemptDecode(def));

/**
 * The fast encoder of each `src` definition, by whether the text leads with the XML declaration.
 */
const encoders = {
  false: memoized((def: SrcDef) => attemptEncode(def, { declaration: false })),
  true: memoized((def: SrcDef) => attemptEncode(def, { declaration: true })),
};

/**
 * The standard encoder of each `standardOf` definition, by whether the text leads with the
 * XML declaration: `encodeString` of an opaque root, which runs the compiled element codec the
 * fast path falls back to.
 */
const standardEncoders = {
  false: memoized((def: SrcDef) => encodeString(def, { declaration: false })),
  true: memoized((def: SrcDef) => encodeString(def, { declaration: true })),
};

// Native: `src/resolve.ts` `collect` selects records from resolved events inside a channel, not from a collected `ResolvedElement`, and a channel run stops at its first failing record.
/**
 * Select the records a record path names in a collected tree, in document order, as a channel's
 * `collect` selects them: each step is `"*"` or the Clark name of the element at its depth, from
 * the root.
 *
 * @param element - The element at `depth`, the root at depth zero.
 * @param path - The record path.
 * @param depth - The path step `element` is matched against.
 * @returns The records under `element`.
 */
const recordsAt = (
  element: SrcXml.ResolvedElement,
  path: readonly string[],
  depth = 0,
): readonly SrcXml.ResolvedElement[] => {
  const step = path[depth];

  if (step !== "*" && step !== element.name) {
    return [];
  }

  if (depth === path.length - 1) {
    return [element];
  }

  return element.children.flatMap((child) =>
    Predicate.isString(child) ? [] : recordsAt(child, path, depth + 1),
  );
};

/**
 * Read the decode cases of a text input: its root, then each record at its path, read by `src`'s
 * `decodeTree` with the input's options.
 *
 * @param input - The text input.
 * @returns The cases, or `None` when `decodeTree` rejects the text, so it never reaches the fast
 *   path.
 */
const casesOf = Effect.fnUntraced(function* casesOf(input: AcceptanceInput) {
  const root = yield* Effect.option(decodeTree(input.options)(input.text));

  if (Option.isNone(root)) {
    return Option.none<readonly DecodeCase[]>();
  }

  const shared = { options: input.options, parseOptions: input.parseOptions };

  const cases: DecodeCase[] = [
    { ...shared, defs: input.roots, element: root.value, id: `${input.id}#root` },
  ];

  if (input.path === undefined) {
    return Option.some(cases);
  }

  for (const [index, record] of recordsAt(root.value, input.path).entries()) {
    cases.push({
      ...shared,
      defs: input.record ?? input.roots,
      element: record,
      id: `${input.id}#record-${index}`,
    });
  }

  return Option.some(cases);
});

/**
 * Check one decode case against R1 and R2, count it, and, when asked, collect the value the
 * standard decode gives as an encode case.
 *
 * @param tally - The suite's counts.
 * @param decoded - The case.
 * @param values - Receives the encode case of the decoded value, or `undefined` to collect none.
 * @returns An effect that completes once the case is counted.
 */
const checkDecode = Effect.fnUntraced(function* checkDecode(
  tally: Tally,
  decoded: DecodeCase,
  values: EncodeCase[] | undefined,
) {
  const { defs, element, id, parseOptions } = decoded;

  const standardExit = yield* Effect.exit(
    Schema.decodeUnknownEffect(defs.standard)(element, parseOptions),
  );

  const fast = yield* Effect.exit(decoderOf(defs.src)(element, parseOptions));
  const opaque = structuralPlan(defs.src) === undefined;
  const rejected = Exit.isFailure(standardExit) && Cause.hasFails(standardExit.cause);

  tally.decodeCases += 1;

  if (!opaque) {
    tally.decodeStructural += 1;
  }

  if (Exit.isFailure(fast)) {
    if (Exit.isFailure(standardExit) && !rejected) {
      tally.decodeDefects += 1;
    } else {
      tally.violations.push(`decode ${id}: the attempt died while the standard decode did not`);
    }

    return;
  }

  if (opaque) {
    tally.decodeOpaque += 1;

    if (Option.isSome(fast.value)) {
      tally.violations.push(`decode ${id}: an opaque root gave Some`);
    }
  }

  if (Exit.isSuccess(standardExit)) {
    tally.decodeAccepts += 1;

    if (Option.isNone(fast.value)) {
      if (!opaque) {
        tally.falseRejects.push(id);
      }
    } else if (
      !isDeepStrictEqual(valueSummary(fast.value.value), valueSummary(standardExit.value))
    ) {
      tally.violations.push(`decode ${id}: R2, the attempt's value differs from the standard's`);
    }

    if (values !== undefined) {
      values.push({
        id: `${id}#standard-value`,
        options: decoded.options,
        parseOptions,
        roots: defs,
        value: standardExit.value,
      });
    }
  } else if (rejected) {
    tally.decodeRejects += 1;

    if (Option.isSome(fast.value)) {
      tally.violations.push(
        `decode ${id}: R1, the standard decode rejects but the attempt gave Some`,
      );
    }
  } else {
    tally.decodeDefects += 1;
    tally.violations.push(`decode ${id}: the standard decode died while the attempt did not`);
  }
});

/**
 * Check one encode case against the encode mirrors of R1 and R2 and count it.
 *
 * @param tally - The suite's counts.
 * @param encoded - The value input.
 * @returns An effect that completes once the case is counted.
 */
const checkEncode = Effect.fnUntraced(function* checkEncode(tally: Tally, encoded: EncodeCase) {
  const { id, parseOptions, roots, value } = encoded;
  const declaration = encoded.options?.declaration ?? true;

  const standardExit = yield* Effect.exit(
    standardEncoders[`${declaration}`](roots.standard)(value, parseOptions),
  );

  const fast = yield* Effect.exit(encoders[`${declaration}`](roots.src)(value, parseOptions));
  const opaque = structuralPlan(roots.src) === undefined;
  const rejected = Exit.isFailure(standardExit) && Cause.hasFails(standardExit.cause);

  tally.encodeCases += 1;

  if (!opaque) {
    tally.encodeStructural += 1;
  }

  if (Exit.isFailure(fast)) {
    if (Exit.isFailure(standardExit) && !rejected) {
      tally.encodeDefects += 1;
    } else {
      tally.violations.push(`encode ${id}: the attempt died while the standard encode did not`);
    }

    return;
  }

  if (opaque) {
    tally.encodeOpaque += 1;

    if (Option.isSome(fast.value)) {
      tally.violations.push(`encode ${id}: an opaque root gave Some`);
    }
  }

  if (Exit.isSuccess(standardExit)) {
    tally.encodeAccepts += 1;

    if (Option.isNone(fast.value)) {
      if (!opaque) {
        tally.encodeFalseRejects.push(id);
      }
    } else if (fast.value.value !== standardExit.value) {
      tally.violations.push(`encode ${id}: the attempt's text differs from the standard's`);
    }
  } else if (rejected) {
    tally.encodeRejects += 1;

    if (Option.isSome(fast.value)) {
      tally.violations.push(`encode ${id}: the standard encode fails but the attempt gave Some`);
    }
  } else {
    tally.encodeDefects += 1;
    tally.violations.push(`encode ${id}: the standard encode died while the attempt did not`);
  }
});

/**
 * Check every decode case of a suite's text inputs, then every encode case, and count them.
 *
 * @param suite - The suite.
 * @returns The suite's counts.
 */
const runSuite = Effect.fnUntraced(function* runSuite(suite: Suite) {
  const tally = emptyTally();
  const values: EncodeCase[] = "none" in suite.encodes ? [] : [...suite.encodes];

  for (const input of suite.inputs) {
    const cases = yield* casesOf(input);

    if (Option.isNone(cases)) {
      tally.unreached += 1;
      continue;
    }

    for (const decoded of cases.value) {
      yield* checkDecode(tally, decoded, suite.decodedValues ? values : undefined);
    }
  }

  for (const encoded of values) {
    yield* checkEncode(tally, encoded);
  }

  return tally;
});

/**
 * The suites under check: each guardrail suite's inputs with its own options and parse options.
 *
 * The corpus contributes its typed inputs, rooted at `qti-assessment-item`, and its channel inputs,
 * whose root case decodes the document root with the record definition and whose record cases are
 * the response declarations. The generated suite's encode cases are its value inputs, corruptions
 * included; the corpus and wrapped suites encode the values the standard decode gives.
 */
const suites: readonly Suite[] = [
  {
    decodedValues: true,
    encodeRejects: false,
    encodes: [],
    exact: true,
    inputs: [
      ...itemInputs.map((input) => ({
        ...input,
        roots: { src: input.roots.src.item, standard: input.roots.standard.item },
      })),
      ...channelInputs,
    ],
    name: "corpus",
    rejects: false,
  },
  {
    decodedValues: false,
    encodeRejects: true,
    encodes: encodeInputs,
    exact: false,
    inputs: documentInputs,
    name: "generated",
    rejects: false,
  },
  {
    decodedValues: false,
    encodeRejects: false,
    encodes: { none: "fuzz builds text inputs only, so it has no value to encode" },
    exact: false,
    inputs: fuzzInputs,
    name: "fuzz",
    rejects: true,
  },
  {
    decodedValues: true,
    encodeRejects: false,
    encodes: [],
    exact: false,
    inputs: wrappedInputs,
    name: "wrapped",
    rejects: true,
  },
];

describe("differential: fast-path acceptance in both directions", () => {
  for (const suite of suites) {
    it.effect(
      `${suite.name}: every attempt the standard path rejects gives None, every Some matches it`,
      () =>
        Effect.gen(function* holds() {
          const tally = yield* runSuite(suite);
          const noEncodes = "none" in suite.encodes ? suite.encodes.none : undefined;

          console.log(
            `acceptance ${suite.name}: ${JSON.stringify({ ...tally, noEncodes: noEncodes ?? "n/a" })}`,
          );

          expect(tally.violations).toStrictEqual([]);
          expect(tally.decodeCases).toBeGreaterThan(0);
          expect(tally.decodeStructural).toBeGreaterThan(0);
          expect(tally.decodeAccepts).toBeGreaterThan(0);

          if (suite.rejects) {
            expect(tally.decodeRejects).toBeGreaterThan(0);
          }

          if (suite.exact) {
            expect(tally.falseRejects).toStrictEqual([]);
          }

          if (noEncodes === undefined) {
            expect(tally.encodeAccepts).toBeGreaterThan(0);
            expect(tally.encodeStructural).toBeGreaterThan(0);
          } else {
            expect(tally.encodeCases).toBe(0);
          }

          if (suite.encodeRejects) {
            expect(tally.encodeRejects).toBeGreaterThan(0);
          }
        }),
      timeout,
    );
  }
});
