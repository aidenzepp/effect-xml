/**
 * Checks the differential harness itself: for one small element, every surface's summary agrees
 * across the `src` fast path and its {@link standardOf} standard path, and the summaries of one
 * side keep distinct outcomes distinct, so a suite built on them compares something. It also pins
 * the shape of `src`'s failed `fromString` decode and encode, and that `standardOf` forces a `src`
 * root onto the standard path without changing any outcome.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import { encodeString } from "../../src/codec.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import {
  channelDecode,
  decodeErrorSummary,
  documentDecode,
  documentEncode,
  keyOrderOf,
  src,
  standard,
  standardOf,
  stringEncode,
  valueSummary,
} from "./harness.ts";
import type { ChannelOutcome, DecodeOutcome, EncodeOutcome } from "./harness.ts";

/**
 * An identifier that must be non-empty in the text, so both decode and encode reject `""`.
 */
const Identifier = Schema.String.check(Schema.isNonEmpty()).pipe(Schema.decodeTo(Schema.String));

/**
 * The `src` side's element: a checked `id` attribute over open mixed content.
 */
const SrcItem = SrcXml.Element("item", {
  attributes: { id: Identifier },
  content: SrcXml.mixed([], { open: true }),
});

/**
 * The `src` side's channel record: an empty element with a checked `id`.
 */
const SrcRecord = SrcXml.Element("rec", { attributes: { id: Identifier } });

/**
 * The `src` roots `standardOf` must force onto the standard path: {@link SrcItem} plain, checked,
 * and behind a `suspend` reference, and {@link SrcRecord}. Each is structural before it is forced.
 */
const forcedRoots: readonly (readonly [label: string, root: Schema.Top])[] = [
  ["a plain element", SrcItem],
  ["a checked element", SrcItem.check(Schema.makeFilter((item) => item.id !== "x"))],
  ["a suspend reference", SrcXml.suspend("item", () => SrcItem)],
  ["a channel record", SrcRecord],
];

/**
 * The decode texts with the reason each one reaches, `value` for a success, and the path of the
 * decode error a failure stores, `none` for a success.
 */
const decodeCases: readonly (readonly [
  text: string,
  nodes: number | undefined,
  tag: string,
  path: string,
])[] = [
  ['<item id="a">t<zz q="1"/></item>', undefined, "value", "none"],
  ['<item id="">t</item>', undefined, "SchemaFailure", "/item/@id"],
  ['<item id="a">', undefined, "WellFormedness", "/"],
  ['<item id="a"><p:zz/></item>', undefined, "UndeclaredPrefix", "/item/p:zz"],
  ['<item id="a"><zz/><zz/></item>', 1, "Limit", "/item"],
];

/**
 * The encode values with the reason each one reaches, `text` for a success.
 */
const encodeCases: readonly (readonly [value: unknown, tag: string])[] = [
  [
    {
      $children: [
        { _tag: "$text", text: "t" },
        { _tag: "*", element: { attributes: {}, children: [], name: "zz" } },
      ],
      id: "a",
    },
    "text",
  ],
  [{ $children: [], id: "" }, "EncodeSchemaFailure"],
  [
    {
      $children: [
        { _tag: "*", element: { attributes: { "{urn:v}y": "1" }, children: [], name: "zz" } },
      ],
      id: "a",
    },
    "UnmappedNamespace",
  ],
];

/**
 * Name the surface a document outcome reached: `value`, `text`, a reason `_tag`, or `defect`.
 *
 * @param outcome - The outcome.
 * @returns The surface's name.
 */
const surfaceOf = (outcome: DecodeOutcome | EncodeOutcome): string => {
  if ("value" in outcome) {
    return "value";
  }

  if ("text" in outcome) {
    return "text";
  }

  if ("defect" in outcome) {
    return "defect";
  }

  return outcome.xml === "none" ? "schema" : outcome.xml.reason._tag;
};

/**
 * Assert that no two summaries of one side are equal.
 *
 * @param summaries - The summaries of one side.
 */
const expectDistinct = (summaries: readonly unknown[]): void => {
  for (const [index, summary] of summaries.entries()) {
    for (const other of summaries.slice(index + 1)) {
      expect(summary).not.toStrictEqual(other);
    }
  }
};

describe("differential harness", () => {
  it.effect("summarizes fromString decodes equally across sides and keeps outcomes distinct", () =>
    Effect.gen(function* decodes() {
      const forced = standardOf(SrcItem);
      const srcOutcomes: DecodeOutcome[] = [];

      for (const [text, maxElementNodes, tag] of decodeCases) {
        const options = maxElementNodes === undefined ? undefined : { maxElementNodes };
        const left = yield* documentDecode(src, SrcXml.fromString(SrcItem, options), text);
        const right = yield* documentDecode(standard, SrcXml.fromString(forced, options), text);

        expect(surfaceOf(left)).toBe(tag);
        expect(left).toStrictEqual(right);
        srcOutcomes.push(left);
      }

      expect(srcOutcomes.length).toBeGreaterThan(0);
      expect(srcOutcomes).toHaveLength(decodeCases.length);
      expectDistinct(srcOutcomes);
    }),
  );

  it.effect("summarizes fromString encodes equally across sides and keeps outcomes distinct", () =>
    Effect.gen(function* encodes() {
      const forced = standardOf(SrcItem);
      const srcOutcomes: EncodeOutcome[] = [];

      for (const [value, tag] of encodeCases) {
        const left = yield* documentEncode(src, SrcXml.fromString(SrcItem), value);
        const right = yield* documentEncode(standard, SrcXml.fromString(forced), value);

        expect(surfaceOf(left)).toBe(tag);
        expect(left).toStrictEqual(right);
        srcOutcomes.push(left);
      }

      expect(srcOutcomes.length).toBeGreaterThan(0);
      expect(srcOutcomes).toHaveLength(encodeCases.length);
      expectDistinct(srcOutcomes);
    }),
  );

  it.effect("stores the decode error of a failed fromString decode under the declaration", () =>
    Effect.gen(function* stores() {
      const failures: string[] = [];

      for (const [text, maxElementNodes, tag, path] of decodeCases) {
        const options = maxElementNodes === undefined ? undefined : { maxElementNodes };
        const outcome = yield* documentDecode(src, SrcXml.fromString(SrcItem, options), text);

        if ("schema" in outcome) {
          expect(outcome.schema.tree).toBe("Encoding<Declaration>(InvalidValue)");
          expect(
            outcome.xml === "none" ? "none" : [outcome.xml.reason._tag, outcome.xml.path],
          ).toStrictEqual([tag, path]);
          failures.push(tag);
        }
      }

      expect(failures).toStrictEqual([
        "SchemaFailure",
        "WellFormedness",
        "UndeclaredPrefix",
        "Limit",
      ]);
    }),
  );

  it.effect("fails the fromString encode of a value the root rejects as encodeString does", () =>
    Effect.gen(function* carries() {
      const Bounded = SrcXml.Element("item", {
        attributes: { id: Schema.String.check(Schema.isMaxLength(1)) },
      });

      const value = { id: "ab" };
      const rejected = yield* documentEncode(src, SrcXml.fromString(Bounded), value);
      const encoded = yield* stringEncode(encodeString(Bounded), value);

      expect("reason" in encoded ? encoded.reason._tag : "none").toBe("EncodeSchemaFailure");
      expect(rejected).toStrictEqual({
        schema: {
          message: "reason" in encoded ? encoded.message : "none",
          tree: "Encoding<String>(InvalidValue)",
        },
        xml: encoded,
      });
    }),
  );

  it.effect("keeps the records a channel emits before a rejected record", () =>
    Effect.gen(function* channels() {
      const text = '<bank><rec id="a"/><rec id=""/></bank>';

      const left: ChannelOutcome = yield* channelDecode(
        SrcXml.decodeSchemaString(SrcRecord, ["bank", "rec"]),
        Stream.make(text),
      );

      const right: ChannelOutcome = yield* channelDecode(
        SrcXml.decodeSchemaString(standardOf(SrcRecord), ["bank", "rec"]),
        Stream.make(text),
      );

      expect(left.records).toHaveLength(1);
      expect(left.end === "done" || "defect" in left.end ? "none" : left.end.reason._tag).toBe(
        "SchemaFailure",
      );
      expect(left).toStrictEqual(right);
    }),
  );

  it.each(forcedRoots)("forces %s onto the standard path", (_, root) => {
    expect(structuralPlan(root)).toBeDefined();
    expect(structuralPlan(standardOf(root))).toBeUndefined();
  });

  it.effect("summarizes the fast and standard paths equally on a valid and a rejected input", () =>
    Effect.gen(function* paths() {
      const forced = standardOf(SrcItem);
      const surfaces: string[] = [];

      for (const text of ['<item id="a">t<zz q="1"/></item>', '<item id="">t</item>']) {
        const fast = yield* documentDecode(src, SrcXml.fromString(SrcItem), text);
        const slow = yield* documentDecode(standard, SrcXml.fromString(forced), text);

        expect(slow).toStrictEqual(fast);
        surfaces.push(surfaceOf(fast));
      }

      for (const value of [{ $children: [{ _tag: "$text", text: "t" }], id: "a" }, { id: "" }]) {
        const fast = yield* documentEncode(src, SrcXml.fromString(SrcItem), value);
        const slow = yield* documentEncode(standard, SrcXml.fromString(forced), value);

        expect(slow).toStrictEqual(fast);
        surfaces.push(surfaceOf(fast));
      }

      const ends: ChannelOutcome["end"][] = [];

      for (const text of ['<bank><rec id="a"/></bank>', '<bank><rec id="a"/><rec id=""/></bank>']) {
        const fast = yield* channelDecode(
          SrcXml.decodeSchemaString(SrcRecord, ["bank", "rec"]),
          Stream.make(text),
        );

        const slow = yield* channelDecode(
          SrcXml.decodeSchemaString(standardOf(SrcRecord), ["bank", "rec"]),
          Stream.make(text),
        );

        expect(slow).toStrictEqual(fast);
        expect(fast.records).toHaveLength(1);
        ends.push(fast.end);
      }

      expect(surfaces).toStrictEqual(["value", "SchemaFailure", "text", "EncodeSchemaFailure"]);
      expect(ends[0]).toBe("done");
      expect(ends[1]).toMatchObject({ reason: { _tag: "SchemaFailure" } });
    }),
  );

  it("tells apart values toStrictEqual accepts when a key order differs at any depth", () => {
    const left = { a: 1, b: { c: [{ d: 1, e: 2 }] } };
    // oxlint-disable-next-line eslint/sort-keys -- the case is a key order toStrictEqual ignores.
    const right = { b: { c: [{ e: 2, d: 1 }] }, a: 1 };
    // oxlint-disable-next-line eslint/sort-keys -- the case differs only in one nested key order.
    const nested = { a: 1, b: { c: [{ e: 2, d: 1 }] } };

    expect(left).toStrictEqual(right);
    expect(valueSummary(left)).not.toStrictEqual(valueSummary(right));
    expect(valueSummary(left)).not.toStrictEqual(valueSummary(nested));
    expect(keyOrderOf(left)).toBe(keyOrderOf(structuredClone(left)));
  });

  it("refuses a decode reason it has no summary for", () => {
    const error = new SrcXml.DecodeError({
      message: "m",
      path: "/item",
      reason: new SrcXml.Limit({ limit: "maxDepth", max: 1 }),
    });

    Reflect.set(error, "reason", { _tag: "Novel" });

    expect(() => decodeErrorSummary(error)).toThrow("Novel");
  });
});
