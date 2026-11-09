/**
 * Compares the differential suites' outcomes with and without the application's global Schema
 * JIT import: `test/differential/fingerprint.ts` runs once as a plain `node` process and once with
 * `--import effect/schema/SchemaJITCompiler/enable` preloaded, and both fingerprints must match.
 *
 * The library enables no JIT, so its suites run interpreted. An application that imports Effect's
 * global JIT compiles the library's internal structural codecs and every user leaf they reach, and
 * the `src` standard path in the same process runs the same compiled registry entries, so a
 * miscompile both sides share is invisible to one process. The JIT run must also report compiled
 * functions, so a preload that compiled nothing cannot pass for one that did.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";

import { decodeFingerprint, runFingerprint } from "./fingerprint.ts";

/**
 * The fingerprint script both child processes run.
 */
const script = new URL("fingerprint.ts", import.meta.url);

/**
 * The test's timeout: two child runs of every differential surface, each about 6 s on Node 26.13,
 * with room for a loaded machine.
 */
const timeout = 300_000;

describe("differential: the global Schema JIT import", () => {
  it.effect(
    "compiles the codecs and leaves every suite's outcomes unchanged",
    () =>
      Effect.gen(function* compares() {
        const interpreted = yield* runFingerprint(script, false);
        const jit = yield* runFingerprint(script, true);

        expect(interpreted.status, interpreted.stderr).toBe(0);
        expect(jit.status, jit.stderr).toBe(0);

        const off = yield* decodeFingerprint(interpreted.stdout.trim());
        const on = yield* decodeFingerprint(jit.stdout.trim());

        console.log(
          `jit-parity: interpreted ${interpreted.durationMs.toFixed(0)} ms, compiled ${off.compiled}, probes ${off.probes}; global JIT ${jit.durationMs.toFixed(0)} ms, compiled ${on.compiled}, probes ${on.probes}`,
        );

        expect(off.compiled).toBe(0);
        expect(on.compiled).toBeGreaterThan(0);

        const suites = Arr.sort(Object.keys(off.suites), Order.String);

        expect(suites).toStrictEqual(["corpus", "fuzz", "generated", "wrapped"]);
        expect(Arr.sort(Object.keys(on.suites), Order.String)).toStrictEqual(suites);

        for (const suite of suites) {
          const left = off.suites[suite];
          const right = on.suites[suite];

          expect([suite, (left?.cases ?? 0) > 0]).toStrictEqual([suite, true]);
          expect([suite, right]).toStrictEqual([suite, left]);
        }
      }),
    timeout,
  );
});
