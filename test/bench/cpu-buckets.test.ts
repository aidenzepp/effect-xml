/**
 * The CPU-profile bucketing: each URL rule's layer, and self time summed per layer.
 */
import { describe, expect, it } from "@effect/vitest";

import { bucket, layerOf } from "../../bench/profile/cpu-buckets.ts";
import type { CpuProfile } from "../../bench/profile/cpu-buckets.ts";

/**
 * Construct a profile node for a frame in `url`; the bucketing reads only the URL, so the
 * function name and line are fixed placeholders.
 *
 * @param id - The node id samples refer to.
 * @param url - The frame's script URL.
 * @returns A node of {@link CpuProfile} with no children.
 */
const node = (id: number, url: string): CpuProfile["nodes"][number] => ({
  callFrame: { functionName: "frame", lineNumber: 0, url },
  id,
});

/**
 * A profile with one frame in each of the upstream tokenizer, the resolver, the Effect runtime,
 * and every structural-path module; `src/structural.ts` and `src/structural-slot.ts` share the
 * `structural` bucket. Each delta is distinct so a misattributed sample changes a total.
 */
const profile: CpuProfile = {
  nodes: [
    node(1, "file:///repo/node_modules/effect/dist/encoding/Xml.js"),
    node(2, "file:///repo/src/resolve.ts"),
    node(3, "file:///repo/node_modules/effect/dist/Stream.js"),
    node(4, "file:///repo/src/builder.ts"),
    node(5, "file:///repo/src/structural.ts"),
    node(6, "file:///repo/src/structural-slot.ts"),
    node(7, "file:///repo/src/fast-decode.ts"),
    node(8, "file:///repo/src/fast-encode.ts"),
    node(9, "file:///repo/src/writer.ts"),
  ],
  samples: [1, 2, 3, 3, 4, 5, 6, 7, 8, 9],
  timeDeltas: [1000, 2000, 3000, 4000, 5000, 6000, 500, 8000, 9000, 10_000],
};

describe("cpu-buckets", () => {
  it("sums each sample's time delta into its node's layer", () => {
    expect(bucket(profile)).toEqual({
      builder: 5,
      "effect-runtime": 7,
      "fast-decode": 8,
      "fast-encode": 9,
      harness: 0,
      other: 0,
      positions: 0,
      "resolver-collector": 2,
      schema: 0,
      structural: 6.5,
      tokenizer: 1,
      writer: 10,
    });
  });

  it.each([
    ["file:///repo/node_modules/effect/dist/encoding/Xml.js", "tokenizer"],
    ["file:///repo/src/tokenizer.ts", "tokenizer"],
    ["file:///repo/src/resolve.ts", "resolver-collector"],
    ["file:///repo/src/positions.ts", "positions"],
    ["file:///repo/src/record-path.ts", "positions"],
    ["file:///repo/src/builder.ts", "builder"],
    ["file:///repo/src/structural.ts", "structural"],
    ["file:///repo/src/structural-slot.ts", "structural"],
    ["file:///repo/src/fast-decode.ts", "fast-decode"],
    ["file:///repo/src/fast-encode.ts", "fast-encode"],
    ["file:///repo/src/writer.ts", "writer"],
    ["file:///repo/src/codec.ts", "schema"],
    ["file:///repo/node_modules/effect/dist/Schema.js", "schema"],
    ["file:///repo/node_modules/effect/dist/SchemaParser.js", "schema"],
    ["file:///repo/node_modules/effect/dist/Stream.js", "effect-runtime"],
    ["file:///repo/bench/sample.ts", "harness"],
    ["", "other"],
    ["(garbage collector)", "other"],
    ["(program)", "other"],
    ["(idle)", "other"],
    ["node:internal/modules/esm/loader", "other"],
  ] as const)("maps %j to %s", (url, layer) => {
    expect(layerOf(url)).toBe(layer);
  });
});
