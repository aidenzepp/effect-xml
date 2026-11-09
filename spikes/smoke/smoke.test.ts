import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

// Proves the spike harness runs: one real QTI fixture goes through Effect's own
// XML event codec and comes back as a non-empty event stream. Nothing here is library code.
const fixture = new URL("../fixtures/qti/bpig-mathml.xml", import.meta.url);

test("decodes a QTI item fixture into XML events", async () => {
  const events = await Effect.runPromise(
    Stream.make(readFileSync(fixture, "utf-8")).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.runCollect,
    ),
  );

  const tags = events.map((event) => event._tag);
  const root = events.find((event) => event._tag === "StartElement");

  expect(tags[0]).toBe("Declaration");
  expect(root).toMatchObject({ name: "qti-assessment-item" });
  expect(tags.filter((tag) => tag === "StartElement").length).toBeGreaterThan(10);
  expect(tags.at(-1)).toBe("EndElement");
});
