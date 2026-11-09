import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { expectTypeOf } from "vitest";

import { decodeString } from "../src/codec.ts";
import { fromString } from "../src/document.ts";
import { Element } from "../src/dsl.ts";

/**
 * A service the probe attribute reads while decoding.
 */
class Upper extends Context.Service<Upper, { readonly f: (s: string) => string }>()("Upper") {}

/**
 * A string attribute schema whose decoding requires {@link Upper}.
 */
const Svc = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect((s) =>
      Effect.gen(function* upper() {
        const u = yield* Upper;

        return u.f(s);
      }),
    ),
    encode: SchemaGetter.passthrough(),
  }),
);

const P = Element("p", { attributes: { a: Svc } });

const xml = '<p a="hi"/>';

describe("services: an element threads its schemas' services to the entry points", () => {
  it("requires the service in the decodeString effect", () => {
    const decoded = decodeString(P)(xml);

    expectTypeOf<Effect.Services<typeof decoded>>().toEqualTypeOf<Upper>();
    // @ts-expect-error -- running the decode without Upper is the mistake under test.
    expect(() => Effect.runSync(decoded)).toThrow(/Upper/u);
  });

  it.effect("decodes with the service provided", () =>
    Effect.gen(function* provided() {
      const value = yield* decodeString(P)(xml).pipe(
        Effect.provideService(Upper, { f: (s) => s.toUpperCase() }),
      );

      expect(value).toStrictEqual({ a: "HI" });
    }),
  );

  it.effect("requires the service in the fromString decode", () =>
    Effect.gen(function* document() {
      const decoded = Schema.decodeUnknownEffect(fromString(P))(xml);

      expectTypeOf<Effect.Services<typeof decoded>>().toEqualTypeOf<Upper>();

      const value = yield* decoded.pipe(
        Effect.provideService(Upper, { f: (s) => s.toUpperCase() }),
      );

      expect(value).toStrictEqual({ a: "HI" });
    }),
  );
});
