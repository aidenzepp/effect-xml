/**
 * Checks on the top node of an otherwise unmodified element codec, written as `.check(...)` or as
 * `Schema.fromBrand(...)`, ride on the structural codec instead of making the root, slot, or member
 * opaque (M4). Each row compares the `src` fast path against `src`'s own standard path, the same
 * root under {@link standardOf}: a value the checks accept decodes on the structural codec to the
 * standard path's value, a value they reject falls back for the standard path's exact error, whose
 * outer issue tree ends at the passthrough declaration, and the root's encode attempt gives the
 * standard path's text or declines.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Brand from "effect/Brand";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

import { attemptEncode } from "../src/fast-encode.ts";
import { XmlSchema as SrcXml } from "../src/index.ts";
import { structuralPlan } from "../src/structural-slot.ts";
import {
  documentDecode,
  documentEncode,
  src,
  standard,
  standardOf,
} from "./differential/harness.ts";
import type { DecodeOutcome } from "./differential/harness.ts";

/**
 * The decoded value of a `range` element.
 */
interface RangeValue {
  readonly min: number;
  readonly max: number;
}

/**
 * The decoded value of a `tally` element before its brand.
 */
interface TallyValue {
  readonly count: number;
}

/**
 * The decoded value of a `count` element.
 */
interface CountValue {
  readonly n: number;
}

/**
 * The decoded value of an `em` element.
 */
interface EmValue {
  readonly $text: string;
}

/**
 * The cross-field rule the checked `range` root carries: `min` never exceeds `max`.
 */
const ordered = Schema.makeFilter<RangeValue>(
  ({ max, min }) => min <= max || "min must not exceed max; swap the bounds",
);

/**
 * The brand constructor the `tally` root takes through `Schema.fromBrand`: a count is never
 * negative.
 */
const Tally = Brand.make<TallyValue & Brand.Brand<"Tally">>(
  ({ count }) => count >= 0 || "count must not be negative",
);

/**
 * The rule the checked `count` slot carries: `n` is positive.
 */
const positive = Schema.makeFilter<CountValue>(({ n }) => n > 0 || "n must be positive");

/**
 * The rule the checked `em` member carries: its text is not empty.
 */
const filled = Schema.makeFilter<EmValue>(({ $text }) => $text.length > 0 || "em must have text");

/**
 * A root or record definition of the `src` side: an element codec with no services.
 */
type SrcRoot = Schema.Codec<unknown, SrcXml.XmlElement<string>>;

/**
 * The checked definitions the suite compares, keyed by root element name.
 */
interface Vocabulary {
  readonly range: SrcRoot;
  readonly tally: SrcRoot;
  readonly holder: SrcRoot;
  readonly para: SrcRoot;
}

/**
 * The `src` side's checked vocabulary: a `.check` root with a cross-field rule, a
 * `Schema.fromBrand` root, a root whose `count` slot is `.check`ed, and a root whose `em` member is
 * `.check`ed.
 */
const srcRoots: Vocabulary = (() => {
  const Count = SrcXml.Element("count", { attributes: { n: Schema.Int } }).check(positive);
  const Em = SrcXml.Element("em", { content: SrcXml.text(Schema.String) }).check(filled);

  return {
    holder: SrcXml.Element("holder", { content: SrcXml.elements({ count: Count }) }),
    para: SrcXml.Element("para", { content: SrcXml.mixed([Em]) }),
    range: SrcXml.Element("range", { attributes: { max: Schema.Int, min: Schema.Int } }).check(
      ordered,
    ),
    tally: SrcXml.Element("tally", { attributes: { count: Schema.Int } }).pipe(
      Schema.fromBrand("Tally", Tally),
    ),
  };
})();

/**
 * The same checked vocabulary forced onto the standard path, the comparison side of every row.
 */
const standardRoots: Vocabulary = {
  holder: standardOf(srcRoots.holder),
  para: standardOf(srcRoots.para),
  range: standardOf(srcRoots.range),
  tally: standardOf(srcRoots.tally),
};

/**
 * One decode row: the definition key and a document its checks accept or reject.
 */
interface DecodeRow {
  readonly title: string;
  readonly root: keyof Vocabulary;
  readonly text: string;
}

/**
 * The rows whose checks accept the document, so the structural codec decodes them.
 */
const accepted: readonly DecodeRow[] = [
  {
    root: "range",
    text: '<range min="1" max="3"/>',
    title: "a .check root with a cross-field rule",
  },
  { root: "tally", text: '<tally count="4"/>', title: "a Schema.fromBrand root" },
  { root: "holder", text: '<holder><count n="2"/></holder>', title: "a .check slot" },
  { root: "para", text: "<para>a<em>x</em>b</para>", title: "a .check member" },
];

/**
 * The rows whose checks reject the document, so the fast path falls back for today's error.
 */
const refused: readonly DecodeRow[] = [
  {
    root: "range",
    text: '<range min="5" max="3"/>',
    title: "a .check root with a cross-field rule",
  },
  { root: "tally", text: '<tally count="-1"/>', title: "a Schema.fromBrand root" },
  { root: "holder", text: '<holder><count n="0"/></holder>', title: "a .check slot" },
  { root: "para", text: "<para>a<em></em>b</para>", title: "a .check member" },
];

/**
 * One encode row: the definition key and a value its checks accept or reject.
 */
interface EncodeRow {
  readonly title: string;
  readonly root: keyof Vocabulary;
  readonly value: unknown;
}

/**
 * The root encode rows: each checked root with a value its checks accept and one they reject.
 */
const encodes: readonly EncodeRow[] = [
  { root: "range", title: "a valid .check root", value: { max: 3, min: 1 } },
  { root: "range", title: "a check-failing .check root", value: { max: 3, min: 5 } },
  { root: "tally", title: "a valid Schema.fromBrand root", value: { count: 4 } },
  { root: "tally", title: "a check-failing Schema.fromBrand root", value: { count: -1 } },
  { root: "holder", title: "a valid .check slot", value: { count: { n: 2 } } },
  { root: "holder", title: "a check-failing .check slot", value: { count: { n: 0 } } },
  {
    root: "para",
    title: "a valid .check member",
    value: { $children: [{ _tag: "em", value: { $text: "x" } }] },
  },
  {
    root: "para",
    title: "a check-failing .check member",
    value: { $children: [{ _tag: "em", value: { $text: "" } }] },
  },
];

/**
 * The outcome of one traced decode: its summary and the attributes the `xml.decodeString` span
 * ended with.
 */
interface Traced {
  readonly outcome: DecodeOutcome;
  readonly attributes: ReadonlyMap<string, unknown>;
}

/**
 * Decode `text` with the `src` whole-document codec of `root` under a recording tracer.
 *
 * @param root - The `src` root element codec.
 * @param text - The document text.
 * @returns The outcome summary and the attributes of the one `xml.decodeString` span.
 */
const srcDecode = (root: SrcRoot, text: string) =>
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

    const outcome = yield* documentDecode(src, SrcXml.fromString(root), text).pipe(
      Effect.withTracer(tracer),
    );

    const decodes = spans.filter((span) => span.name === "xml.decodeString");

    expect(decodes).toHaveLength(1);

    return { attributes: decodes[0]?.attributes ?? new Map(), outcome } satisfies Traced;
  });

/**
 * Every compared row, decode and encode alike.
 */
const rows: readonly (DecodeRow | EncodeRow)[] = [...accepted, ...refused, ...encodes];

/**
 * The number of compared rows whose `src` root is structural, so the fast side of the comparison
 * is the structural codec rather than the standard path compared with itself.
 */
const structuralRows = rows.filter(
  (row) => structuralPlan(srcRoots[row.root]) !== undefined,
).length;

describe("checked wrappers on the structural codec", () => {
  it("compares at least one row in each direction, each on a structural root", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(structuralRows).toBeGreaterThan(0);
    expect(structuralRows).toBe(rows.length);
    expect(accepted.length).toBeGreaterThan(0);
    expect(refused.length).toBeGreaterThan(0);
    expect(encodes.length).toBeGreaterThan(0);
  });

  it.effect.each(accepted)("decodes $title on the structural codec", (row) =>
    Effect.gen(function* structural() {
      const { attributes, outcome } = yield* srcDecode(srcRoots[row.root], row.text);

      const expected = yield* documentDecode(
        standard,
        SrcXml.fromString(standardRoots[row.root]),
        row.text,
      );

      expect(expected).toHaveProperty("keys");
      expect(attributes.get("xml.codec")).toBe("structural");
      expect(attributes.has("xml.fallback")).toBe(false);
      expect(outcome).toStrictEqual(expected);
    }),
  );

  it.effect.each(refused)("falls back for $title the check rejects", (row) =>
    Effect.gen(function* fallback() {
      const { attributes, outcome } = yield* srcDecode(srcRoots[row.root], row.text);

      const expected = yield* documentDecode(
        standard,
        SrcXml.fromString(standardRoots[row.root]),
        row.text,
      );

      expect(expected).toHaveProperty("xml");
      expect(expected).toHaveProperty("schema.tree", "Encoding<Declaration>(InvalidValue)");
      expect(attributes.get("xml.codec")).toBe("fallback");
      expect(attributes.get("xml.fallback")).toBe("failure");
      expect(outcome).toHaveProperty("schema.tree", "Encoding<Declaration>(InvalidValue)");
      expect(outcome).toStrictEqual(expected);
    }),
  );

  it.effect.each(encodes)("encodes $title as the standard path does", (row) =>
    Effect.gen(function* encodesRoot() {
      const expected = yield* documentEncode(
        standard,
        SrcXml.fromString(standardRoots[row.root]),
        row.value,
      );

      const fast = yield* attemptEncode(srcRoots[row.root])(row.value);

      expect(fast).toStrictEqual("text" in expected ? Option.some(expected.text) : Option.none());
    }),
  );
});
