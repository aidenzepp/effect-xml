/**
 * The record channels' fast path: each record first tries the builder and the structural codec,
 * and a record that path declines or a leaf rejects on it decodes again the standard way, whose
 * outcome is the record's. Every value and error is compared with the same surface over
 * `standardOf` of the record codec, and the run span counts the records that fell back and the
 * fallbacks that succeeded.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";

import { XmlSchema as SrcXml } from "../src/index.ts";
import type { XmlElement } from "../src/plan.ts";
import { structuralPlan } from "../src/structural-slot.ts";
import { channelDecode, standardOf } from "./differential/harness.ts";
import type { ChannelOutcome } from "./differential/harness.ts";

/**
 * A `src` record codec whose schemas need no services.
 */
type Def = Schema.Codec<unknown, XmlElement<string>>;

/**
 * The root-anchored path of every record below.
 */
const path = ["bank", "item"];

/**
 * The defect a dying leaf raises.
 */
const boom = new Error("the leaf decode died");

/**
 * Run one record leaf's decode by its raw text: `"fail"` fails with a Schema issue, `"die"` dies
 * with {@link boom}, and any other text decodes to itself.
 *
 * @param raw - The leaf's raw text.
 * @param options - The parse options the leaf receives.
 * @returns The leaf's decode.
 */
const leafOutcome = (
  raw: string,
  options: SchemaAST.ParseOptions,
): Effect.Effect<string, SchemaIssue.Issue> => {
  if (raw === "fail") {
    return Effect.fail(new SchemaIssue.InvalidValue({ message: "the leaf rejects" }, raw, options));
  }

  return raw === "die" ? Effect.die(boom) : Effect.succeed(raw);
};

/**
 * Build a record text leaf that counts its decode runs.
 *
 * The text `"flaky"` fails its first run when `flaky` is set and succeeds on every later run; with
 * `flaky` unset it always succeeds, the standard path's reference for that record. Each call builds
 * a fresh schema and counter, so a row reads only its own runs.
 *
 * @param flaky - Whether the `"flaky"` text fails its first run.
 * @returns The leaf and its run counts.
 */
const makeLeaf = (flaky: boolean) => {
  const runs = { count: 0, flaky: 0 };

  const Leaf = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transformEffect((raw: string, options) =>
        Effect.suspend(() => {
          runs.count += 1;

          if (raw !== "flaky") {
            return leafOutcome(raw, options);
          }

          runs.flaky += 1;

          return flaky && runs.flaky === 1 ? leafOutcome("fail", options) : Effect.succeed(raw);
        }),
      ),
      encode: SchemaGetter.passthrough(),
    }),
  );

  return { Leaf, runs };
};

/**
 * Build the `src` record codec: an `item` element with an `id` attribute and a counting text
 * leaf.
 *
 * @param flaky - Whether the `"flaky"` text fails its first run.
 * @returns The record codec and the leaf's run counts.
 */
const srcItem = (flaky: boolean) => {
  const { Leaf, runs } = makeLeaf(flaky);

  return {
    Item: SrcXml.Element("item", { attributes: { id: Schema.String }, content: SrcXml.text(Leaf) }),
    runs,
  };
};

/**
 * The model the `decodeTo`-wrapped record codec decodes to.
 */
const Model = Schema.Struct({ body: Schema.String, key: Schema.String });

/**
 * Wrap a record codec with `Schema.decodeTo`, which makes it opaque to the fast path.
 *
 * @param item - A record codec of {@link srcItem}'s shape.
 * @returns The wrapped record codec.
 */
const toModel = <E>(item: Schema.Codec<{ readonly id: string; readonly $text: string }, E>) =>
  item.pipe(
    Schema.decodeTo(Model, {
      decode: SchemaGetter.transform((value: { readonly id: string; readonly $text: string }) => ({
        body: value.$text,
        key: value.id,
      })),
      encode: SchemaGetter.transform((model: typeof Model.Type) => ({
        $text: model.body,
        id: model.key,
      })),
    }),
  );

/**
 * Write a bank document with one record per text.
 *
 * @param texts - The text of each record, in document order.
 * @returns The document text.
 */
const bankOf = (texts: readonly string[]): string =>
  `<bank>${texts.map((text, index) => `<item id="${index + 1}">${text}</item>`).join("")}</bank>`;

/**
 * One record channel surface: a run of its factory over a document, on the fast path for a
 * structural record codec and on the standard path for one built by `standardOf`.
 */
interface Surface {
  readonly span: string;
  readonly run: (def: Def, text: string) => Effect.Effect<ChannelOutcome>;
}

/**
 * Encode a document as one UTF-8 byte chunk.
 *
 * @param text - The document text.
 * @returns The byte stream.
 */
const bytesOf = (text: string) => Stream.make(new TextEncoder().encode(text));

/**
 * The text and the byte channel factories.
 */
const surfaces: readonly Surface[] = [
  {
    run: (def, text) => channelDecode(SrcXml.decodeSchemaString(def, path), Stream.make(text)),
    span: "xml.decodeSchemaString",
  },
  {
    run: (def, text) => channelDecode(SrcXml.decodeSchema(def, path), bytesOf(text)),
    span: "xml.decodeSchema",
  },
];

/**
 * One record channel run on `src`: its outcome, and each span's name with the attributes it
 * ended with.
 */
interface Observed {
  readonly outcome: ChannelOutcome;
  readonly spans: readonly { readonly name: string; readonly attributes: Map<string, unknown> }[];
}

/**
 * Run a record codec over a document through one surface on `src` under a recording tracer.
 *
 * @param surface - The channel surface.
 * @param def - The `src` record codec.
 * @param text - The document text.
 * @returns The run's outcome and spans.
 */
const observe = (surface: Surface, def: Def, text: string) =>
  Effect.gen(function* observeRun() {
    const spans: { readonly name: string; readonly attributes: Map<string, unknown> }[] = [];

    const tracer = Tracer.make({
      span: (options) => {
        const attributes = new Map<string, unknown>();

        spans.push({ attributes, name: options.name });

        const span = new Tracer.NativeSpan(options);
        const attribute = span.attribute.bind(span);

        span.attribute = (key, value) => {
          attributes.set(key, value);
          attribute(key, value);
        };

        return span;
      },
    });

    const outcome = yield* surface.run(def, text).pipe(Effect.withTracer(tracer));

    return { outcome, spans } satisfies Observed;
  });

/**
 * Run a structural record codec over a document through one surface on the standard path.
 *
 * `def` must be structural, so the run compares the fast path with the standard path rather than
 * the standard path with itself.
 *
 * @param surface - The channel surface.
 * @param def - The `src` record codec, before {@link standardOf}.
 * @param text - The document text.
 * @returns The run's outcome.
 */
const standardRun = (surface: Surface, def: Def, text: string) => {
  expect(structuralPlan(def)).toBeDefined();

  return surface.run(standardOf(def), text);
};

/**
 * Read the fallback counts a run's single span ended with.
 *
 * @param observed - The run.
 * @param surface - The surface it ran through.
 * @returns `xml.records`, `xml.records.fallback`, and `xml.records.fallback.accepted`.
 */
const countsOf = (observed: Observed, surface: Surface) => {
  expect(observed.spans.map((span) => span.name)).toStrictEqual([surface.span]);

  const attributes = observed.spans[0]?.attributes;

  return {
    accepted: attributes?.get("xml.records.fallback.accepted"),
    fallback: attributes?.get("xml.records.fallback"),
    records: attributes?.get("xml.records"),
  };
};

describe.each(surfaces)("$span", (surface) => {
  it.effect("counts one fallback, none accepted, when the fourth record's leaf rejects", () =>
    Effect.gen(function* rejectedFourth() {
      const text = bankOf(["a", "b", "c", "fail"]);
      const observed = yield* observe(surface, srcItem(false).Item, text);
      const expected = yield* standardRun(surface, srcItem(false).Item, text);

      expect(observed.outcome).toStrictEqual(expected);
      expect(observed.outcome.records).toHaveLength(3);
      expect(observed.outcome.end).not.toBe("done");
      expect(countsOf(observed, surface)).toStrictEqual({ accepted: 0, fallback: 1, records: 3 });
    }),
  );

  it.effect("emits a record whose leaf fails once and counts its fallback as accepted", () =>
    Effect.gen(function* flakyRecord() {
      const text = bankOf(["a", "flaky", "b"]);
      const { Item, runs } = srcItem(true);
      const observed = yield* observe(surface, Item, text);
      const expected = yield* standardRun(surface, srcItem(false).Item, text);

      expect(observed.outcome).toStrictEqual(expected);
      expect(observed.outcome.end).toBe("done");
      expect(runs.flaky).toBe(2);
      expect(countsOf(observed, surface)).toStrictEqual({ accepted: 1, fallback: 1, records: 3 });
    }),
  );

  it.effect("counts no fallback over valid records", () =>
    Effect.gen(function* validRecords() {
      const text = bankOf(["a", "b", "c"]);
      const observed = yield* observe(surface, srcItem(false).Item, text);
      const expected = yield* standardRun(surface, srcItem(false).Item, text);

      expect(observed.outcome).toStrictEqual(expected);
      expect(countsOf(observed, surface)).toStrictEqual({ accepted: 0, fallback: 0, records: 3 });
    }),
  );

  it.effect("counts no fallback for a decodeTo-wrapped record codec, which decodes as before", () =>
    Effect.gen(function* wrappedRecords() {
      const text = bankOf(["a", "b"]);
      const observed = yield* observe(surface, toModel(srcItem(false).Item), text);
      const expected = yield* surface.run(standardOf(toModel(srcItem(false).Item)), text);

      expect(observed.outcome).toStrictEqual(expected);
      expect(observed.outcome.records).toHaveLength(2);
      expect(countsOf(observed, surface)).toStrictEqual({ accepted: 0, fallback: 0, records: 2 });
    }),
  );

  it.effect("dies with a dying leaf's defect, running the leaf once", () =>
    Effect.gen(function* dyingLeaf() {
      const { Item, runs } = srcItem(false);
      const observed = yield* observe(surface, Item, bankOf(["die"]));

      expect(observed.outcome).toStrictEqual({
        end: { defect: `${boom.name}: ${boom.message}` },
        records: [],
      });
      expect(runs.count).toBe(1);
    }),
  );
});
