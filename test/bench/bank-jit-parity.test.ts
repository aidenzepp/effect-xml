/**
 * Compares the bank differential surfaces' outcomes with and without the application's global
 * Schema JIT import: `test/bench/bank-fingerprint.ts` runs once as a plain `node` process and once
 * with `--import effect/schema/SchemaJITCompiler/enable` preloaded, and both fingerprints must
 * match, as `test/differential/jit-parity.test.ts` does for the other differential suites.
 *
 * The test lives in `test/bench/` beside its script, because only that directory may import
 * `bench/`.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decodeFingerprint, runFingerprint } from "../differential/fingerprint.ts";
import { bankIds } from "./bank-fingerprint.ts";

/**
 * The fingerprint script both child processes run.
 */
const script = new URL("bank-fingerprint.ts", import.meta.url);

/**
 * The test's timeout: two child runs of every bank surface up to `bank-4m` on both sides, which
 * the bank differential suite budgets at up to 120 s per test on Node.
 */
const timeout = 600_000;

describe("bank differential: the global Schema JIT import", () => {
  it.effect(
    "compiles the codecs and leaves every bank input's outcomes unchanged",
    () =>
      Effect.gen(function* compares() {
        const interpreted = yield* runFingerprint(script, false);
        const jit = yield* runFingerprint(script, true);

        expect(interpreted.status, interpreted.stderr).toBe(0);
        expect(jit.status, jit.stderr).toBe(0);

        const off = yield* decodeFingerprint(interpreted.stdout.trim());
        const on = yield* decodeFingerprint(jit.stdout.trim());

        console.log(
          `bank-jit-parity: interpreted ${interpreted.durationMs.toFixed(0)} ms, compiled ${off.compiled}, probes ${off.probes}; global JIT ${jit.durationMs.toFixed(0)} ms, compiled ${on.compiled}, probes ${on.probes}`,
        );

        expect(off.compiled).toBe(0);
        expect(on.compiled).toBeGreaterThan(0);
        expect(Object.keys(off.suites)).toStrictEqual(bankIds);
        expect(Object.keys(on.suites)).toStrictEqual(bankIds);

        for (const id of bankIds) {
          const left = off.suites[id];
          const right = on.suites[id];

          expect([id, (left?.cases ?? 0) > 0]).toStrictEqual([id, true]);
          expect([id, right]).toStrictEqual([id, left]);
        }
      }),
    timeout,
  );
});
