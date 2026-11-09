/**
 * The CPU-profile driver's child arguments: the profiler flags reach the runtime, the case
 * arguments reach the case process.
 */
import { describe, expect, it } from "@effect/vitest";

import { profileArgs } from "../../bench/profile/cpu.ts";

describe("cpu", () => {
  it("puts the profiler flags before the script path and the case arguments after it", () => {
    const args = profileArgs(
      ["--expose-gc"],
      "/work/bench/profiles/node-t/effect-xml-events",
      "/repo/bench/case-process.ts",
      "effect-xml/events",
      "bank-16k",
      "upstream",
    );

    expect(args).toEqual([
      "--expose-gc",
      "--cpu-prof",
      "--cpu-prof-dir=/work/bench/profiles/node-t/effect-xml-events",
      "/repo/bench/case-process.ts",
      "--case",
      "effect-xml/events",
      "--input",
      "bank-16k",
      "--tokenizer",
      "upstream",
    ]);
  });

  it("passes no runtime flags beyond the profiler's when the driver has none", () => {
    const args = profileArgs(
      [],
      "/d",
      "/s.ts",
      "effect-xml/stream/positions",
      "bank-4m",
      "upstream",
    );

    expect(args.indexOf("/s.ts")).toBe(2);
    expect(args.slice(0, 2)).toEqual(["--cpu-prof", "--cpu-prof-dir=/d"]);
  });
});
