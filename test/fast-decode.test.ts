/* oxlint-disable sort-keys -- slot order is decode order; QTI reads the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

import { decodeTree } from "../src/codec.ts";
import { namespaces } from "../src/dsl.ts";
import type { ResolvedElement } from "../src/element.ts";
import { attemptDecode } from "../src/fast-decode.ts";
import { elements, many, mixed, optional, text } from "../src/plan.ts";
import type { XmlElement } from "../src/plan.ts";
import { corpus } from "./differential/corpus.cases.ts";
import { AssessmentItem } from "./qti/vocabulary.ts";

/**
 * An element codec whose schemas need no services, the shape most rows run.
 */
type Def = Schema.Codec<unknown, XmlElement<string>>;

/**
 * Narrow a vocabulary element to the codec the rows run.
 *
 * @param def - A vocabulary element whose schemas require no services.
 * @returns The same codec, typed with an `unknown` Type and no services.
 */
const asDef = (def: Schema.Top): Def =>
  // SAFETY: every vocabulary schema narrowed here needs no services, and the Encoded side of an
  // element codec is a resolved element.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- services and the Type exist only at the type level.
  def as Def;

/**
 * The README's namespace.
 */
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The README's builders.
 */
const readme = namespaces({ "": QTI });

/**
 * The README's choice.
 */
const SimpleChoice = readme.Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: text(Schema.String),
});

/**
 * The README's prompt.
 */
const Prompt = readme.Element("qti-prompt", { content: text(Schema.String) });

/**
 * The README's `ChoiceInteraction` example.
 */
const ChoiceInteraction = asDef(
  readme.Element("qti-choice-interaction", {
    attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
    content: elements({
      prompt: optional(Prompt),
      choices: many(SimpleChoice),
    }),
  }),
);

/**
 * Build the README's document with the given `max-choices` text and first choice text.
 *
 * @param maxChoices - The `max-choices` attribute text.
 * @param first - The text of the first choice.
 * @returns The document text.
 */
const readmeXml = (maxChoices: string, first: string) =>
  `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="${maxChoices}">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">${first}</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

/**
 * The namespace of the small vocabulary.
 */
const A = "urn:effect-xml:fast-decode:a";

/**
 * The builders bound to the small vocabulary's namespace.
 */
const ab = namespaces({ "": A });

/**
 * A declared member of the mixed content.
 */
const Em = ab.Element("em", { content: text(Schema.String) });

/**
 * Closed mixed content over one declared member.
 */
const Para = asDef(ab.Element("p", { content: mixed([Em]) }));

/**
 * The model a `decodeTo`-wrapped root decodes to.
 */
interface Label {
  readonly label: string;
}

/**
 * A root wrapped by `decodeTo`: opaque to the fast path, while today's decode accepts it.
 */
const Wrapped = asDef(
  ab.Element("label", { content: text(Schema.String) }).pipe(
    Schema.decodeTo(Schema.Struct({ label: Schema.String }), {
      decode: SchemaGetter.transform((leaf: { readonly $text: string }) => ({
        label: leaf.$text,
      })),
      encode: SchemaGetter.transform((model: Label) => ({ $text: model.label })),
    }),
  ),
);

/**
 * The defect a dying leaf raises.
 */
const boom = new Error("the leaf decode died");

/**
 * Run one counting leaf's decode by its raw text: `"fail"` fails with a Schema issue, `"die"`
 * dies with {@link boom}, `"stop"` interrupts, `"errors"` decodes to the `errors` parse option
 * it receives, and any other text decodes to itself.
 *
 * @param raw - The leaf's raw text.
 * @param options - The parse options the leaf receives.
 * @returns The leaf's decode.
 */
const leafOutcome = (
  raw: string,
  options: SchemaAST.ParseOptions,
): Effect.Effect<string, SchemaIssue.Issue> => {
  switch (raw) {
    case "fail": {
      return Effect.fail(
        new SchemaIssue.InvalidValue({ message: "the leaf rejects" }, raw, options),
      );
    }

    case "die": {
      return Effect.die(boom);
    }

    case "stop": {
      return Effect.interrupt;
    }

    case "errors": {
      return Effect.succeed(String(options.errors));
    }

    default: {
      return Effect.succeed(raw);
    }
  }
};

/**
 * Build a text element with an `id` attribute whose text leaf counts its decode runs.
 *
 * Each call builds a fresh schema and counter, so a row reads only its own runs.
 *
 * @returns The element and the number of times its leaf decode has run.
 */
const countingNote = () => {
  const runs = { count: 0 };

  const Leaf = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transformEffect((raw: string, options) =>
        Effect.sync(() => {
          runs.count += 1;
        }).pipe(Effect.andThen(leafOutcome(raw, options))),
      ),
      encode: SchemaGetter.passthrough(),
    }),
  );

  return {
    Note: asDef(ab.Element("note", { attributes: { id: Schema.String }, content: text(Leaf) })),
    runs,
  };
};

/**
 * A service a leaf reads while decoding, provided by the test around the attempt.
 */
class Stamp extends Context.Service<Stamp, { readonly mark: (raw: string) => string }>()(
  "effect-xml/test/fast-decode/Stamp",
) {}

/**
 * A text element whose leaf decodes through {@link Stamp}.
 */
const Stamped = ab.Element("stamped", {
  content: text(
    Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transformEffect((raw: string) =>
          Effect.gen(function* stamp() {
            const service = yield* Stamp;

            return service.mark(raw);
          }),
        ),
        encode: SchemaGetter.passthrough(),
      }),
    ),
  ),
});

/**
 * Build a resolved element.
 *
 * @param name - The Clark name.
 * @param children - The children.
 * @param attributes - The attributes.
 * @returns The element.
 */
const node = (
  name: string,
  children: readonly (ResolvedElement | string)[] = [],
  attributes: Readonly<Record<string, string>> = {},
): ResolvedElement => ({ attributes, children, name });

/**
 * The outcome of one compared element: today's decode accepted it or rejected it.
 */
type Outcome = "accepted" | "rejected";

/**
 * Assert that the fast attempt agrees with today's decode of the same element: `Some` with an
 * equal value, by `toStrictEqual` and by `JSON.stringify` (own-key order, M6), where today
 * decodes, and `None` where today rejects.
 *
 * @param def - The root codec.
 * @param element - The element both paths decode.
 * @param parseOptions - The parse options both paths receive.
 * @returns An effect yielding today's outcome.
 */
const agrees = (def: Def, element: ResolvedElement, parseOptions?: SchemaAST.ParseOptions) =>
  Effect.gen(function* agreesBoth() {
    const today = yield* Effect.exit(Schema.decodeUnknownEffect(def)(element, parseOptions));
    const fast = yield* attemptDecode(def)(element, parseOptions);

    if (Exit.isSuccess(today)) {
      expect(fast).toStrictEqual(Option.some(today.value));
      expect(JSON.stringify(Option.getOrUndefined(fast))).toBe(JSON.stringify(today.value));

      return "accepted" satisfies Outcome;
    }

    expect(Option.isNone(fast)).toBe(true);

    return "rejected" satisfies Outcome;
  });

/**
 * The parse options the option rows compare against the default.
 */
const optionVariants: readonly SchemaAST.ParseOptions[] = [
  { errors: "all" },
  { onExcessProperty: "error" },
];

describe("attemptDecode", () => {
  it.effect("gives today's value for the README document and None where today rejects", () =>
    Effect.gen(function* readmeRows() {
      const outcomes: Outcome[] = [];

      for (const xml of [readmeXml("1", "First"), readmeXml("x", "First")]) {
        const root = yield* decodeTree()(xml);

        outcomes.push(yield* agrees(ChoiceInteraction, root));

        for (const parseOptions of optionVariants) {
          outcomes.push(yield* agrees(ChoiceInteraction, root, parseOptions));
        }
      }

      expect(outcomes).toStrictEqual([
        "accepted",
        "accepted",
        "accepted",
        "rejected",
        "rejected",
        "rejected",
      ]);
    }),
  );

  it.effect("agrees with today on every QTI corpus root, under each parse option", () =>
    Effect.gen(function* corpusRows() {
      const tally = { accepted: 0, rejected: 0, unparsed: 0 };

      for (const file of corpus) {
        const root = yield* Effect.option(decodeTree()(file.text));

        if (Option.isNone(root)) {
          tally.unparsed += 1;
        } else {
          const outcome = yield* agrees(asDef(AssessmentItem), root.value);

          tally[outcome] += 1;

          for (const parseOptions of optionVariants) {
            expect(yield* agrees(asDef(AssessmentItem), root.value, parseOptions)).toBe(outcome);
          }
        }
      }

      // The counts the seat reports: the corpus files today accepts, rejects, and cannot parse.
      console.log(`fast-decode corpus tally: ${JSON.stringify(tally)}`);

      expect(tally.accepted).toBeGreaterThan(0);
    }),
  );

  it.effect("gives today's value for an empty $text and an empty mixed text item", () =>
    Effect.gen(function* emptyRows() {
      const outcomes = [
        yield* agrees(asDef(Prompt), node(`{${QTI}}qti-prompt`)),
        yield* agrees(asDef(Prompt), node(`{${QTI}}qti-prompt`, [""])),
        yield* agrees(ChoiceInteraction, yield* decodeTree()(readmeXml("1", ""))),
        yield* agrees(Para, node(`{${A}}p`, ["", node(`{${A}}em`, ["b"]), "c"])),
        yield* agrees(Para, node(`{${A}}p`, [node(`{${A}}em`, [""]), ""])),
      ];

      expect(outcomes).toStrictEqual(["accepted", "accepted", "accepted", "accepted", "accepted"]);
    }),
  );

  it.effect("declines a decodeTo-wrapped root, which today's decode accepts", () =>
    Effect.gen(function* opaqueRow() {
      const element = node(`{${A}}label`, ["x"]);
      const today = yield* Schema.decodeUnknownEffect(Wrapped)(element);
      const fast = yield* attemptDecode(Wrapped)(element);

      expect(today).toStrictEqual({ label: "x" });
      expect(Option.isNone(fast)).toBe(true);
    }),
  );

  it.effect("declines a failing leaf after one run", () =>
    Effect.gen(function* failRow() {
      const { Note, runs } = countingNote();
      const fast = yield* attemptDecode(Note)(node(`{${A}}note`, ["fail"], { id: "n" }));

      expect(Option.isNone(fast)).toBe(true);
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("dies with the leaf's defect when a leaf decode dies, after one run", () =>
    Effect.gen(function* dieRow() {
      const { Note, runs } = countingNote();

      const exit = yield* Effect.exit(
        attemptDecode(Note)(node(`{${A}}note`, ["die"], { id: "n" })),
      );

      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.squash(exit.cause)).toBe(boom);
      }

      expect(runs.count).toBe(1);
    }),
  );

  it.effect("is interrupted when a leaf decode interrupts, after one run", () =>
    Effect.gen(function* interruptRow() {
      const { Note, runs } = countingNote();

      const exit = yield* Effect.exit(
        attemptDecode(Note)(node(`{${A}}note`, ["stop"], { id: "n" })),
      );

      expect(Exit.hasInterrupts(exit)).toBe(true);
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("gives Some for a counting leaf that succeeds, after one run", () =>
    Effect.gen(function* okRow() {
      const { Note, runs } = countingNote();
      const fast = yield* attemptDecode(Note)(node(`{${A}}note`, ["ok"], { id: "n" }));

      expect(fast).toStrictEqual(Option.some({ id: "n", $text: "ok" }));
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("passes the caller's parse options to the leaves unchanged", () =>
    Effect.gen(function* optionsRow() {
      const { Note } = countingNote();
      const element = node(`{${A}}note`, ["errors"], { id: "n" });
      const fast = yield* attemptDecode(Note)(element, { errors: "all" });

      expect(fast).toStrictEqual(Option.some({ id: "n", $text: "all" }));
      expect(yield* agrees(Note, element, { errors: "all" })).toBe("accepted");
    }),
  );

  it.effect("decodes a leaf with the services provided around the attempt", () =>
    Effect.gen(function* serviceRow() {
      const fast = yield* attemptDecode(Stamped)(node(`{${A}}stamped`, ["a"])).pipe(
        Effect.provideService(Stamp, { mark: (raw) => `${raw}!` }),
      );

      expect(fast).toStrictEqual(Option.some({ $text: "a!" }));
    }),
  );

  it.effect("declines an element the builder refuses (B2) without running a leaf", () =>
    Effect.gen(function* refusalRow() {
      const { Note, runs } = countingNote();
      const element = node(`{${A}}note`, ["ok"], { id: "n", z: "1" });
      const today = yield* Effect.exit(Schema.decodeUnknownEffect(Note)(element));
      const before = runs.count;
      const fast = yield* attemptDecode(Note)(element);

      expect(Exit.isFailure(today)).toBe(true);
      expect(Option.isNone(fast)).toBe(true);
      expect(runs.count - before).toBe(0);
    }),
  );
});
