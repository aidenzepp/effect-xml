/* oxlint-disable sort-keys -- slot order is encode order; QTI writes the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Tracer from "effect/Tracer";

import { encodeString } from "../src/codec.ts";
import { XmlSchema as SrcXml } from "../src/index.ts";
import type { XmlElement } from "../src/plan.ts";
import { structuralPlan } from "../src/structural-slot.ts";
import { defaultTokenizer } from "../src/tokenizer.ts";
import {
  documentEncode,
  src,
  standard,
  standardOf,
  withTokenizer,
} from "./differential/harness.ts";
import type { EncodeOutcome } from "./differential/harness.ts";

/**
 * The README's namespace.
 */
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * Build the README's `ChoiceInteraction` with the `src` builders and the given prompt text leaf.
 *
 * @param prompt - The text leaf of the prompt.
 * @returns The root element codec.
 */
const srcInteraction = (prompt: Schema.Codec<string, string>) => {
  const { Element } = SrcXml.namespaces({ "": QTI });

  const SimpleChoice = Element("qti-simple-choice", {
    attributes: { identifier: Schema.String },
    content: SrcXml.text(Schema.String),
  });

  return Element("qti-choice-interaction", {
    attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
    content: SrcXml.elements({
      prompt: SrcXml.optionalKey(Element("qti-prompt", { content: SrcXml.text(prompt) })),
      choices: SrcXml.many(SimpleChoice),
    }),
  });
};

/**
 * The README's `ChoiceInteraction` built with the `src` builders.
 */
const Interaction = srcInteraction(Schema.String);

/**
 * Build the README value with the given prompt text.
 *
 * @param prompt - The prompt's text.
 * @returns The value both sides encode.
 */
const readmeValue = (prompt: string) => ({
  "max-choices": 1,
  "response-identifier": "RESPONSE",
  prompt: { $text: prompt },
  choices: [
    { identifier: "A", $text: "First" },
    { identifier: "B", $text: "Second" },
  ],
});

/**
 * The README value.
 */
const value = readmeValue("Pick one");

/**
 * The README value with a prompt holding U+0000, which no XML text can hold.
 */
const nul = readmeValue("a\u0000b");

/**
 * The default namespace of the open-content vocabulary.
 */
const A = "urn:effect-xml:encode-string:a";

/**
 * A paragraph of open `mixed` content over one declared member, `em`, built with the `src`
 * builders.
 */
const Paragraph = (() => {
  const { Element } = SrcXml.namespaces({ "": A });
  const Em = Element("em", { content: SrcXml.text(Schema.String) });

  return Element("p", { content: SrcXml.mixed([Em], { open: true }) });
})();

/**
 * A paragraph value whose open `*` item is named after the declared member `em`, which today's
 * encode rejects.
 */
const declaredItem = {
  $children: [
    { _tag: "$text", text: "a " },
    { _tag: "*", element: { attributes: {}, children: ["x"], name: `{${A}}em` } },
  ],
};

/**
 * The defect a dying leaf raises.
 */
const boom = new Error("the prompt leaf died");

/**
 * Build a string leaf that counts its encode runs and encodes each run with `outcome`.
 *
 * Each call builds a fresh schema and counter, so a row reads only its own runs.
 *
 * @param outcome - The encode of one run, given the run's 1-based number and the value.
 * @returns The leaf and the number of times its encode has run.
 */
const countingLeaf = (
  outcome: (run: number, text: string) => Effect.Effect<string, SchemaIssue.Issue>,
) => {
  const runs = { count: 0 };

  const leaf = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.passthrough(),
      encode: SchemaGetter.transformEffect((text: string) =>
        Effect.suspend(() => {
          runs.count += 1;

          return outcome(runs.count, text);
        }),
      ),
    }),
  );

  return { leaf, runs };
};

/**
 * Build a string leaf of {@link countingLeaf}'s shape whose every encode run succeeds, the
 * standard-path reference for a row whose own leaf fails a run.
 *
 * @returns The leaf.
 */
const passingLeaf = () => countingLeaf((_run, text) => Effect.succeed(text)).leaf;

/**
 * The outcome of one traced encode: its summary and the attributes the `xml.encodeString` span
 * ended with.
 */
interface Traced<A> {
  readonly outcome: A;
  readonly attributes: ReadonlyMap<string, unknown>;
}

/**
 * Run `effect` under a recording tracer and return its result with the attributes of the one
 * `xml.encodeString` span it opened.
 *
 * @param effect - The encode to run; it never fails.
 * @returns The effect's result and the span's attributes.
 */
const traced = <A>(effect: Effect.Effect<A>) =>
  Effect.gen(function* recordEncode() {
    const spans: { readonly name: string; readonly attributes: Map<string, unknown> }[] = [];

    const tracer = Tracer.make({
      span: (options) => {
        const attributes = new Map<string, unknown>();
        const span = new Tracer.NativeSpan(options);
        const attribute = span.attribute.bind(span);

        spans.push({ attributes, name: options.name });

        span.attribute = (key, attributeValue) => {
          attributes.set(key, attributeValue);
          attribute(key, attributeValue);
        };

        return span;
      },
    });

    const outcome = yield* effect.pipe(Effect.withTracer(tracer));
    const encodes = spans.filter((span) => span.name === "xml.encodeString");

    expect(encodes).toHaveLength(1);

    return { attributes: encodes[0]?.attributes ?? new Map(), outcome } satisfies Traced<A>;
  });

/**
 * An element codec whose schemas need no services, the shape every row's root takes.
 */
type Root = Schema.Codec<unknown, XmlElement<string>>;

/**
 * Encode `input` with the `src` whole-document codec of `root` under a recording tracer.
 *
 * @param root - The `src` root element codec.
 * @param input - The value to encode.
 * @returns The outcome summary and the `xml.encodeString` span's attributes.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- plain data, possibly a value the faster path declines; the codec's own encode is the parser under test.
const srcEncode = (root: Root, input: unknown) =>
  traced<EncodeOutcome>(documentEncode(src, SrcXml.fromString(root), input));

/**
 * Encode `input` with the `src` whole-document codec of `root` on the standard path.
 *
 * `root` must be structural, so the run compares the fast path with the standard path rather than
 * the standard path with itself.
 *
 * @param root - The `src` root element codec, before {@link standardOf}.
 * @param input - The value to encode.
 * @returns The outcome summary.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- plain data, possibly a value the faster path declines; the codec's own encode is the parser under test.
const standardEncode = (root: Root, input: unknown) => {
  expect(structuralPlan(root)).toBeDefined();

  return documentEncode(standard, SrcXml.fromString(standardOf(root)), input);
};

describe("encodeString fast path", () => {
  it.effect("encodes the README value on the structural codec", () =>
    Effect.gen(function* structural() {
      const { attributes, outcome } = yield* srcEncode(Interaction, value);

      expect(attributes.get("xml.codec")).toBe("structural");
      expect(attributes.has("xml.fallback")).toBe(false);
      expect(outcome).toHaveProperty("text");
      expect(outcome).toStrictEqual(yield* standardEncode(Interaction, value));
    }),
  );

  it.effect("encodes the README value on the structural codec through a spread copy", () =>
    Effect.gen(function* spreadCopy() {
      const { attributes, outcome } = yield* withTokenizer(
        src,
        srcEncode(Interaction, value),
        // oxlint-disable-next-line typescript/no-misused-spread -- `defaultTokenizer` is a plain object literal (`src/tokenizer.ts`); a spread copy is the provided value the row needs.
        { ...defaultTokenizer },
      );

      expect(attributes.get("xml.codec")).toBe("structural");
      expect(attributes.has("xml.fallback")).toBe(false);
      expect(outcome).toStrictEqual(yield* standardEncode(Interaction, value));
    }),
  );

  it.effect("falls back on U+0000 and returns the standard path's InvalidEvent error", () =>
    Effect.gen(function* nulValue() {
      const { attributes, outcome } = yield* srcEncode(Interaction, nul);

      expect(attributes.get("xml.codec")).toBe("fallback");
      expect(attributes.get("xml.fallback")).toBe("failure");
      expect(outcome).toHaveProperty("xml.reason._tag", "InvalidEvent");
      expect(outcome).toStrictEqual(yield* standardEncode(Interaction, nul));
    }),
  );

  it.effect("runs the leaf encode on both paths when the tokenizer rejects U+0000", () =>
    Effect.gen(function* nulLeaf() {
      const { leaf, runs } = countingLeaf((_run, text) => Effect.succeed(text));
      const { attributes, outcome } = yield* srcEncode(srcInteraction(leaf), nul);

      expect(attributes.get("xml.codec")).toBe("fallback");
      expect(attributes.get("xml.fallback")).toBe("failure");
      expect(runs.count).toBe(2);
      expect(outcome).toStrictEqual(yield* standardEncode(srcInteraction(passingLeaf()), nul));
    }),
  );

  it.effect("returns the fallback's text when a leaf fails once and then succeeds", () =>
    Effect.gen(function* failThenSucceed() {
      const { leaf, runs } = countingLeaf((run, text) =>
        run === 1
          ? Effect.fail(new SchemaIssue.InvalidValue({ message: "the first run rejects" }, text))
          : Effect.succeed(text),
      );

      const { attributes, outcome } = yield* srcEncode(srcInteraction(leaf), value);

      expect(attributes.get("xml.codec")).toBe("fallback");
      expect(attributes.get("xml.fallback")).toBe("success");
      expect(runs.count).toBe(2);
      expect(outcome).toHaveProperty("text");
      expect(outcome).toStrictEqual(yield* standardEncode(srcInteraction(passingLeaf()), value));
    }),
  );

  it.effect("falls back on an open-mixed * item named after a declared member", () =>
    Effect.gen(function* declaredMember() {
      const { attributes, outcome } = yield* srcEncode(Paragraph, declaredItem);
      const expected = yield* standardEncode(Paragraph, declaredItem);

      expect(attributes.get("xml.codec")).toBe("fallback");
      expect(attributes.get("xml.fallback")).toBe("failure");
      expect(outcome).toHaveProperty("xml.reason._tag", "EncodeSchemaFailure");
      expect(outcome).toStrictEqual(expected);
    }),
  );

  it.effect("encodes a decodeTo-wrapped root the standard way", () =>
    Effect.gen(function* opaque() {
      const Wrapped = Interaction.pipe(
        Schema.decodeTo(Schema.Struct({ prompt: Schema.String }), {
          decode: SchemaGetter.forbidden(() => "the model is encode-only"),
          encode: SchemaGetter.transform((model: { readonly prompt: string }) => ({
            ...readmeValue(model.prompt),
          })),
        }),
      );

      const { attributes, outcome } = yield* srcEncode(Wrapped, { prompt: "Pick one" });

      expect(attributes.get("xml.codec")).toBe("element");
      expect(attributes.has("xml.fallback")).toBe(false);
      expect(outcome).toStrictEqual(yield* standardEncode(Interaction, value));
    }),
  );

  it.effect("dies with a leaf's defect after one run, without falling back", () =>
    Effect.gen(function* dies() {
      const { leaf, runs } = countingLeaf(() => Effect.die(boom));

      const exit = yield* Effect.exit(encodeString(srcInteraction(leaf))(value));

      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(boom);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(runs.count).toBe(1);
    }),
  );
});
