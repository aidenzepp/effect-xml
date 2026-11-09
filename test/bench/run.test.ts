/**
 * The matrix driver's pure parts: the case-by-input matrix and the argument parser.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { inputIds } from "../../bench/registry.ts";
import { matrix, parseArgs, smokeInputIds } from "../../bench/run.ts";
import { CaseError } from "../../bench/types.ts";
import type { BenchCase } from "../../bench/types.ts";

/**
 * Build a fake case that never prepares.
 *
 * @param id - The case id.
 * @param accepts - The input filter the case reports.
 * @returns A case whose `prepare` fails with a `CaseError`.
 */
const fakeCase = (id: string, accepts: BenchCase["accepts"]): BenchCase => ({
  accepts,
  class: "tree",
  id,
  library: "fake",
  prepare: () => Effect.fail(new CaseError({ caseId: id, reason: "fake case" })),
});

/**
 * The two fake cases: one accepting every input, one accepting only the synthetic banks.
 */
const fakes: readonly BenchCase[] = [
  fakeCase("fake/tree", () => true),
  fakeCase("fake/tree/banks", (input) => input.id.startsWith("bank-")),
];

/**
 * The input ids that are not error-path inputs.
 */
const goodIds = inputIds.filter((id) => !id.endsWith("-bad-last"));

describe("matrix", () => {
  it("pairs each case with every input it accepts and never an error-path input", () => {
    const pairs = matrix(fakes, inputIds, "", []);

    expect(pairs).toStrictEqual([
      ...goodIds.map((input) => ({ caseId: "fake/tree", input })),
      ...goodIds
        .filter((id) => id.startsWith("bank-"))
        .map((input) => ({ caseId: "fake/tree/banks", input })),
    ]);
    expect(pairs.filter(({ input }) => input.endsWith("-bad-last"))).toStrictEqual([]);
  });

  it("keeps only the cases whose id contains the filter", () => {
    const pairs = matrix(fakes, inputIds, "banks", []);

    expect(new Set(pairs.map(({ caseId }) => caseId))).toStrictEqual(new Set(["fake/tree/banks"]));
    expect(pairs.length).toBe(goodIds.filter((id) => id.startsWith("bank-")).length);
  });

  it("limits the inputs to the requested ids", () => {
    const pairs = matrix(fakes, inputIds, "", ["corpus-all", "bank-4m"]);

    expect(pairs).toStrictEqual([
      { caseId: "fake/tree", input: "corpus-all" },
      { caseId: "fake/tree", input: "bank-4m" },
      { caseId: "fake/tree/banks", input: "bank-4m" },
    ]);
  });
});

describe("parseArgs", () => {
  it.effect("defaults every flag", () =>
    Effect.gen(function* defaults() {
      const args = yield* parseArgs([]);

      expect(args.smoke).toBe(false);
      expect(args.filter).toBe("");
      expect(args.inputs).toStrictEqual([]);
      expect(args.tokenizer).toBe("upstream");
      expect(args.jit).toBe("off");
      expect(Option.isNone(args.out)).toBe(true);
    }),
  );

  it.effect("maps each flag", () =>
    Effect.gen(function* flags() {
      const args = yield* parseArgs([
        "--filter",
        "effect-xml",
        "--input",
        "corpus-all",
        "--input",
        "bank-4m",
        "--tokenizer",
        "upstream",
        "--out",
        "work/bench/x.json",
      ]);

      expect(args.smoke).toBe(false);
      expect(args.filter).toBe("effect-xml");
      expect(args.inputs).toStrictEqual(["corpus-all", "bank-4m"]);
      expect(args.tokenizer).toBe("upstream");
      expect(args.out).toStrictEqual(Option.some("work/bench/x.json"));
    }),
  );

  it.effect("maps each JIT mode", () =>
    Effect.gen(function* jitModes() {
      const modes = yield* Effect.all(
        ["off", "on", "noeval"].map((mode) =>
          parseArgs(["--jit", mode]).pipe(Effect.map((args) => args.jit)),
        ),
      );

      expect(modes).toStrictEqual(["off", "on", "noeval"]);
    }),
  );

  it.effect("keeps the JIT mode in a smoke run", () =>
    Effect.gen(function* smokeJit() {
      const args = yield* parseArgs(["--smoke", "--jit", "noeval"]);

      expect(args.jit).toBe("noeval");
    }),
  );

  it.effect("limits a smoke run to the smoke inputs", () =>
    Effect.gen(function* smoke() {
      const args = yield* parseArgs(["--smoke"]);

      expect(args.smoke).toBe(true);
      expect(args.inputs).toStrictEqual(smokeInputIds);
      expect(new Set(smokeInputIds)).toStrictEqual(
        new Set(["corpus-items", "corpus-all", "bank-16k"]),
      );

      const pairs = matrix(fakes, inputIds, args.filter, args.inputs);

      expect(new Set(pairs.map(({ input }) => input))).toStrictEqual(new Set(smokeInputIds));
    }),
  );

  it.effect("intersects requested inputs with the smoke inputs", () =>
    Effect.gen(function* smokeIntersect() {
      const args = yield* parseArgs(["--smoke", "--input", "bank-4m", "--input", "bank-16k"]);

      expect(args.inputs).toStrictEqual(["bank-16k"]);
    }),
  );

  it.effect(
    "rejects an unknown flag, a missing value, an unknown input, an unknown tokenizer, and an unknown JIT mode",
    () =>
      Effect.gen(function* rejects() {
        const failures = yield* Effect.all(
          [
            ["--bogus"],
            ["--filter"],
            ["--input", "nope"],
            ["--tokenizer", "nope"],
            ["--jit", "nope"],
            ["--jit"],
          ].map((argv) => Effect.flip(parseArgs(argv))),
        );

        expect(failures.map((error) => [error._tag, error.argument])).toStrictEqual([
          ["ArgsError", "--bogus"],
          ["ArgsError", "--filter"],
          ["ArgsError", "--input"],
          ["ArgsError", "--tokenizer"],
          ["ArgsError", "--jit"],
          ["ArgsError", "--jit"],
        ]);
      }),
  );

  it.effect("names the JIT modes when rejecting an unknown one", () =>
    Effect.gen(function* rejectsJit() {
      const error = yield* Effect.flip(parseArgs(["--jit", "fast"]));

      expect(error.reason).toBe("no JIT mode is named fast; pass one of off, on, noeval");
    }),
  );
});
