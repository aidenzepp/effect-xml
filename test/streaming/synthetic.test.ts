import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ensureSynthetic, syntheticParts, targetBytes } from "./synthetic.ts";

const fixtureText = readFileSync(
  new URL("../../spikes/fixtures/qti/test-features.xml", import.meta.url),
  "utf-8",
);

describe("syntheticParts", () => {
  it("splits the fixture without losing or adding text", () => {
    const { header, parts, footer } = syntheticParts();
    expect(header + parts + footer).toBe(fixtureText);
  });

  it("keeps exactly six item refs in the repeatable parts", () => {
    const { parts } = syntheticParts();
    expect(parts.split("<qti-assessment-item-ref").length - 1).toBe(6);
  });

  it("starts the header at the XML declaration and the footer at outcome processing", () => {
    const { header, footer } = syntheticParts();
    expect(header.startsWith("<?xml")).toBe(true);
    expect(footer.startsWith("<qti-outcome-processing>")).toBe(true);
  });
});

describe("ensureSynthetic", () => {
  it.live(
    "writes once and reuses the file",
    () =>
      Effect.gen(function* run() {
        const first = yield* ensureSynthetic();
        expect(first.bytes).toBeGreaterThanOrEqual(targetBytes);
        expect(first.bytes).toBeLessThan(targetBytes * 1.1);
        expect(first.repetitions * first.refsPerRepetition).toBeGreaterThan(100_000);
        expect(first.refsPerRepetition).toBe(6);

        const { mtimeMs } = statSync(first.path);

        const second = yield* ensureSynthetic();
        expect(second.path).toBe(first.path);
        expect(second.bytes).toBe(first.bytes);
        expect(second.repetitions).toBe(first.repetitions);
        expect(statSync(second.path).mtimeMs).toBe(mtimeMs);
      }),
    120_000,
  );
});
