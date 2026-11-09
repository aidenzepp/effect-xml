import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { Xml } from "effect/encoding";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { expectTypeOf } from "vitest";

import { Tokenizer, defaultTokenizer } from "./tokenizer.ts";

const custom: Tokenizer = {
  decode: Xml.decode,
  decodeString: Xml.decodeString,
  encode: Xml.encode,
  encodeString: Xml.encodeString,
  positions: "native",
};

const read = Effect.gen(function* read() {
  return yield* Tokenizer;
});

describe("Tokenizer", () => {
  it.effect("reads the default tokenizer when nothing is provided", () =>
    Effect.gen(function* readsDefault() {
      expect(yield* read).toBe(defaultTokenizer);
    }),
  );

  it("adds nothing to the requirements of the reading effect", () => {
    expectTypeOf(read).toEqualTypeOf<Effect.Effect<Tokenizer>>();
  });

  it.effect("reads the tokenizer provided with Effect.provideService", () =>
    Effect.gen(function* readsProvidedService() {
      expect(yield* read.pipe(Effect.provideService(Tokenizer, custom))).toBe(custom);
    }),
  );

  it.effect("reads the tokenizer provided with Layer.succeed", () =>
    Effect.gen(function* readsProvidedLayer() {
      expect(yield* read.pipe(Effect.provide(Layer.succeed(Tokenizer, custom)))).toBe(custom);
    }),
  );
});

describe("defaultTokenizer", () => {
  it("declares no native positions", () => {
    expect(defaultTokenizer.positions).toBe("none");
  });

  it.effect("decodes a self-closing tag into a start element", () =>
    Effect.gen(function* decodesStartElement() {
      const events = yield* Stream.make("<a/>").pipe(
        Stream.pipeThroughChannel(defaultTokenizer.decodeString()),
        Stream.runCollect,
      );

      const names = events.flatMap((event) => (event._tag === "StartElement" ? [event.name] : []));

      expect(names).toEqual(["a"]);
    }),
  );
});
