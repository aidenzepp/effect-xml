/* oxlint-disable sort-keys -- slot order is decode order; QTI reads the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Tracer from "effect/Tracer";

import { decodeString } from "../src/codec.ts";
import { XmlSchema as SrcXml } from "../src/index.ts";
import type { XmlElement } from "../src/plan.ts";
import { structuralPlan } from "../src/structural-slot.ts";
import { documentDecode, src, standard, standardOf, valueSummary } from "./differential/harness.ts";
import type { DecodeOutcome } from "./differential/harness.ts";

/**
 * The README's namespace.
 */
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The README's document.
 */
const xml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

/**
 * The README's document with a `max-choices` value the `Schema.Int` leaf rejects.
 */
const rejected = xml.replace('max-choices="1"', 'max-choices="x"');

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
      choices: SrcXml.Array(SimpleChoice),
    }),
  });
};

/**
 * The README's `ChoiceInteraction` built with the `src` builders.
 */
const Interaction = srcInteraction(Schema.String);

/**
 * The defect a dying leaf raises.
 */
const boom = new Error("the prompt leaf died");

/**
 * Build a string leaf that counts its decode runs and decodes each run with `outcome`.
 *
 * Each call builds a fresh schema and counter, so a row reads only its own runs.
 *
 * @param outcome - The decode of one run, given the run's 1-based number and raw text.
 * @returns The leaf and the number of times its decode has run.
 */
const countingLeaf = (
  outcome: (run: number, raw: string) => Effect.Effect<string, SchemaIssue.Issue>,
) => {
  const runs = { count: 0 };

  const leaf = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transformEffect((raw: string) =>
        Effect.suspend(() => {
          runs.count += 1;

          return outcome(runs.count, raw);
        }),
      ),
      encode: SchemaGetter.passthrough(),
    }),
  );

  return { leaf, runs };
};

/**
 * Build a string leaf of {@link countingLeaf}'s shape whose every decode run succeeds, the
 * standard-path reference for a row whose own leaf fails a run.
 *
 * @returns The leaf.
 */
const passingLeaf = () => countingLeaf((_run, raw) => Effect.succeed(raw)).leaf;

/**
 * The outcome of one traced decode: its summary and the attributes the `xml.decodeString` span
 * ended with.
 */
interface Traced<A> {
  readonly outcome: A;
  readonly attributes: ReadonlyMap<string, unknown>;
}

/**
 * Run `effect` under a recording tracer and return its result with the attributes of the one
 * `xml.decodeString` span it opened.
 *
 * @param effect - The decode to run; it never fails.
 * @returns The effect's result and the span's attributes.
 */
const traced = <A>(effect: Effect.Effect<A>) =>
  Effect.gen(function* recordDecode() {
    const spans: { readonly name: string; readonly attributes: Map<string, unknown> }[] = [];

    const tracer = Tracer.make({
      span: (options) => {
        const attributes = new Map<string, unknown>();
        const span = new Tracer.NativeSpan(options);
        const attribute = span.attribute.bind(span);

        spans.push({ attributes, name: options.name });

        span.attribute = (key, value) => {
          attributes.set(key, value);
          attribute(key, value);
        };

        return span;
      },
    });

    const outcome = yield* effect.pipe(Effect.withTracer(tracer));
    const decodes = spans.filter((span) => span.name === "xml.decodeString");

    expect(decodes).toHaveLength(1);

    return { attributes: decodes[0]?.attributes ?? new Map(), outcome } satisfies Traced<A>;
  });

/**
 * An element codec whose schemas need no services, the shape every row's root takes.
 */
type Root = Schema.Codec<unknown, XmlElement<string>>;

/**
 * Decode `text` with the `src` whole-document codec of `root` under a recording tracer.
 *
 * @param root - The `src` root element codec.
 * @param text - The document text.
 * @returns The outcome summary and the `xml.decodeString` span's attributes.
 */
const srcDecode = (root: Root, text: string) =>
  traced<DecodeOutcome>(documentDecode(src, SrcXml.fromString(root), text));

/**
 * Decode `text` with the `src` whole-document codec of `root` on the standard path.
 *
 * `root` must be structural, so a row whose `src` decode stays on the fast path compares the fast
 * path with the standard path. A row whose `src` decode falls back compares the fallback, which is
 * the standard path, with the standard path; it checks that the fallback's result is returned, not
 * that the fast path agrees.
 *
 * @param root - The `src` root element codec, before {@link standardOf}.
 * @param text - The document text.
 * @returns The outcome summary.
 */
const standardDecode = (root: Root, text: string) => {
  expect(structuralPlan(root)).toBeDefined();

  return documentDecode(standard, SrcXml.fromString(standardOf(root)), text);
};

describe("decodeString fast path", () => {
  it.effect("decodes the README example on the structural codec", () =>
    Effect.gen(function* structural() {
      const { attributes, outcome } = yield* srcDecode(Interaction, xml);

      expect(attributes.get("xml.codec")).toBe("structural");
      expect(attributes.has("xml.fallback")).toBe(false);
      expect(outcome).toStrictEqual(yield* standardDecode(Interaction, xml));
    }),
  );

  it.effect("falls back when a leaf rejects and returns the standard path's error", () =>
    Effect.gen(function* rejectedLeaf() {
      const { attributes, outcome } = yield* srcDecode(Interaction, rejected);

      expect(attributes.get("xml.codec")).toBe("fallback");
      expect(attributes.get("xml.fallback")).toBe("failure");
      expect(outcome).toHaveProperty("xml");
      expect(outcome).toStrictEqual(yield* standardDecode(Interaction, rejected));
    }),
  );

  it.effect("returns the fallback's value when a leaf fails once and then succeeds", () =>
    Effect.gen(function* failThenSucceed() {
      const { leaf, runs } = countingLeaf((run, raw) =>
        run === 1
          ? Effect.fail(new SchemaIssue.InvalidValue({ message: "the first run rejects" }, raw))
          : Effect.succeed(raw),
      );

      const { attributes, outcome } = yield* srcDecode(srcInteraction(leaf), xml);

      expect(attributes.get("xml.codec")).toBe("fallback");
      expect(attributes.get("xml.fallback")).toBe("success");
      expect(runs.count).toBe(2);
      expect(outcome).toHaveProperty("keys");
      expect(outcome).toStrictEqual(yield* standardDecode(srcInteraction(passingLeaf()), xml));
    }),
  );

  it.effect("decodes a decodeTo-wrapped root the standard way", () =>
    Effect.gen(function* opaque() {
      const Wrapped = Interaction.pipe(
        Schema.decodeTo(Schema.Struct({ maxChoices: Schema.Int }), {
          decode: SchemaGetter.transform((value: { readonly "max-choices": number }) => ({
            maxChoices: value["max-choices"],
          })),
          encode: SchemaGetter.forbidden(() => "the model is decode-only"),
        }),
      );

      const { attributes, outcome } = yield* srcDecode(Wrapped, xml);

      expect(attributes.get("xml.codec")).toBe("element");
      expect(attributes.has("xml.fallback")).toBe(false);
      expect(outcome).toStrictEqual(valueSummary({ maxChoices: 1 }));
    }),
  );

  it.effect("dies with a leaf's defect after one run, without falling back", () =>
    Effect.gen(function* dies() {
      const { leaf, runs } = countingLeaf(() => Effect.die(boom));

      const exit = yield* Effect.exit(decodeString(srcInteraction(leaf))(xml));

      expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toBe(boom);
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(runs.count).toBe(1);
    }),
  );
});
