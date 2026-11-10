import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Xml from "effect/encoding/Xml";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { expectTypeOf } from "vitest";

import type { ResolvedElement } from "../src/element.ts";
import { XmlDecodeError, XmlEncodeError } from "../src/issue.ts";
import { XmlSchema } from "../src/index.ts";

/**
 * The value members that define the namespace, in no particular order.
 */
const members = [
  "Element",
  "namespaces",
  "suspend",
  "text",
  "elements",
  "mixed",
  "many",
  "optionalKey",
  "DefinitionError",
  "clark",
  "fromString",
  "ElementFromString",
  "findDecodeError",
  "findDecodeErrorOption",
  "findEncodeError",
  "findEncodeErrorOption",
  "decodeSchema",
  "decodeSchemaString",
  "equivalence",
  "Tokenizer",
  "XmlDecodeError",
  "XmlEncodeError",
  "isDecodeError",
  "isEncodeError",
  "SchemaFailure",
  "EncodeSchemaFailure",
  "UndeclaredPrefix",
  "WellFormedness",
  "Limit",
  "Unsupported",
  "UnmappedNamespace",
  "InvalidEvent",
];

/**
 * The flat names the namespace leaves out.
 */
const excluded = [
  "decodeString",
  "encodeString",
  "decodeTree",
  "decode",
  "canonicalize",
  "normalizedNames",
  "CanonicalOptions",
  "defaultMaxElementSize",
  "defaultMaxElementNodes",
  "optional",
  "ResolvedElement",
  "defaultTokenizer",
];

/**
 * Copy and sort a list of names by code unit.
 *
 * @param names - The names to sort.
 * @returns A sorted copy of `names`.
 */
const sorted = (names: readonly string[]): string[] => Arr.sort(names, Order.String);

describe("index", () => {
  it.effect("exports only the XmlSchema namespace", () =>
    Effect.gen(function* entryPoint() {
      const entry = yield* Effect.promise(() => import("../src/index.ts"));

      expect(Object.keys(entry)).toStrictEqual(["XmlSchema"]);
    }),
  );
});

describe("XmlSchema", () => {
  it("exports exactly the namespace's value members", () => {
    expect(sorted(Object.keys(XmlSchema))).toStrictEqual(sorted(members));
  });

  it("publishes the zero-or-more child slot as many, not Array", () => {
    const Item = XmlSchema.Element("item", { content: XmlSchema.text(Schema.String) });

    expect("Array" in XmlSchema).toBe(false);
    expect(XmlSchema.many(Item).cardinality).toBe("many");
  });

  it("leaves out every flat name the namespace replaces or keeps internal", () => {
    const keys = Object.keys(XmlSchema);

    for (const name of excluded) {
      expect(keys).not.toContain(name);
    }
  });

  it("exports each error under its tag and drops the unprefixed names", () => {
    expectTypeOf<typeof XmlSchema.XmlDecodeError>().toEqualTypeOf<typeof XmlDecodeError>();
    expect(XmlSchema.XmlDecodeError).toBe(XmlDecodeError);
    expect(XmlSchema.XmlEncodeError).toBe(XmlEncodeError);
    expect("DecodeError" in XmlSchema).toBe(false);
    expect("EncodeError" in XmlSchema).toBe(false);
  });

  it.effect("names the class of every error after its tag", () =>
    Effect.gen(function* namesClassAfterTag() {
      const Doc = XmlSchema.fromString(
        XmlSchema.Element("p", { content: XmlSchema.text(Schema.Finite) }),
      );

      const decodeFailure = yield* Schema.decodeUnknownEffect(Doc)("<p>x</p>").pipe(Effect.flip);
      const decodeError = Option.getOrThrow(XmlSchema.decodeErrorOf(decodeFailure.issue));

      const encodeFailure = yield* Schema.encodeEffect(Doc)({ $text: Number.NaN }).pipe(
        Effect.flip,
      );

      const encodeError = Option.getOrThrow(XmlSchema.encodeErrorOf(encodeFailure.issue));

      expect(decodeError._tag).toBe("XmlDecodeError");
      expect(encodeError._tag).toBe("XmlEncodeError");

      const exported = {
        XmlDecodeError: XmlSchema.XmlDecodeError,
        XmlEncodeError: XmlSchema.XmlEncodeError,
      };

      for (const error of [decodeError, encodeError]) {
        expect(exported[error._tag]).toBe(error.constructor);
        expect(error.constructor.name).toBe(error._tag);

        const caught = yield* Effect.fail(error).pipe(
          Effect.catchTag(error._tag, () => Effect.succeed("caught")),
        );

        expect(caught).toBe("caught");
      }
    }),
  );

  it.effect("names the class of a decodeSchemaString channel error after its tag", () =>
    Effect.gen(function* namesChannelClassAfterTag() {
      const Item = XmlSchema.Element("item", { content: XmlSchema.text(Schema.String) });

      const error = yield* Stream.make("<r><item>x</r>").pipe(
        Stream.pipeThroughChannel(XmlSchema.decodeSchemaString(Item, ["r", "item"])()),
        Stream.runDrain,
        Effect.flip,
      );

      const exported = {
        XmlDecodeError: XmlSchema.XmlDecodeError,
        XmlEncodeError: XmlSchema.XmlEncodeError,
      };

      expect(error._tag).toBe("XmlDecodeError");
      expect(exported[error._tag]).toBe(error.constructor);
      expect(error.constructor.name).toBe(error._tag);

      const caught = yield* Effect.fail(error).pipe(
        Effect.catchTag(error._tag, () => Effect.succeed("caught")),
      );

      expect(caught).toBe("caught");
    }),
  );

  it("names the element constructor, its codec type, and the resolved tree in Effect casing", () => {
    const P = XmlSchema.Element("p", { content: XmlSchema.text(Schema.String) });

    expectTypeOf(P).toExtend<XmlSchema.Element<"p", { readonly $text: string }>>();
    expectTypeOf<XmlSchema.ResolvedElement>().toEqualTypeOf<ResolvedElement>();
    expectTypeOf<
      XmlSchema.Element.DecodingServices<never, XmlSchema.text<typeof Schema.String>>
    >().toBeNever();
    expectTypeOf<
      XmlSchema.Element.ContentType<XmlSchema.text<typeof Schema.String>>
    >().toEqualTypeOf<{ readonly $text: string }>();

    /* oxlint-disable import/namespace -- the test reads a member the namespace must not export. */
    // @ts-expect-error the builder is `Element`, not `element`
    expect(XmlSchema.element).toBeUndefined();
    /* oxlint-enable import/namespace */

    // @ts-expect-error the codec type is `Element`, not `ElementCodec`
    expectTypeOf<XmlSchema.ElementCodec<"p", unknown>>().toBeUnknown();
  });

  it.effect("sits beside Effect's own Xml channels without a name collision", () =>
    Effect.gen(function* sideBySide() {
      const Item = XmlSchema.Element("item", {
        attributes: { id: Schema.String },
        content: XmlSchema.text(Schema.String),
      });

      const xml = `<bank><item id="a">First</item><item id="b">Second</item></bank>`;

      const events = yield* Stream.make(xml).pipe(
        Stream.pipeThroughChannel(Xml.decodeString()),
        Stream.runCollect,
      );

      const items = yield* Stream.make(xml).pipe(
        Stream.pipeThroughChannel(XmlSchema.decodeSchemaString(Item, ["bank", "item"])()),
        Stream.runCollect,
      );

      const starts = events.filter((event) => event._tag === "StartElement");

      expect(starts.map((event) => event.name)).toStrictEqual(["bank", "item", "item"]);
      expect(items.map((item) => item.id)).toStrictEqual(["a", "b"]);
    }),
  );
});
