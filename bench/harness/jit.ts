/**
 * The Schema JIT mode of a benchmark process: off, on, or on with dynamic function construction
 * refused. A mode other than `off` is installed by a preload module before the case process loads
 * the library, the way a consumer enables the JIT process-wide; the library build never changes.
 */
import { fileURLToPath } from "node:url";

import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

/**
 * How a benchmark process runs Effect's Schema JIT.
 *
 * `off` leaves Schema parsing interpreted, as the library ships. `on` imports
 * `effect/schema/SchemaJITCompiler/enable` before the library loads. `noeval` does the same but
 * makes `globalThis.Function` refuse every call, as a content security policy without
 * `unsafe-eval` does, so the JIT's support probe fails and every parser falls back to the
 * interpreter.
 */
export type JitMode = "off" | "on" | "noeval";

/**
 * Every JIT mode, in the order the usage line lists them.
 */
export const jitModes: readonly JitMode[] = ["off", "on", "noeval"];

/**
 * Check that a command-line value names a JIT mode.
 *
 * @param value - The value after `--jit`.
 * @returns `true` when `value` is `off`, `on`, or `noeval`.
 */
export const isJitMode = (value: string): value is JitMode =>
  jitModes.some((mode) => mode === value);

/**
 * The record a JIT preload leaves on `globalThis` so the case process can confirm which mode was
 * installed before the library loaded.
 *
 * Under `noeval`, `refusing` is the `Function` replacement the preload installed and `refusals`
 * counts the calls it refused. The JIT probes `globalThis.Function` once before its first
 * compilation, so one refusal shows the JIT was reached and turned away.
 */
export type JitState =
  | { readonly mode: "on" }
  | { readonly mode: "noeval"; readonly refusing: FunctionConstructor; refusals: number };

declare global {
  /**
   * The JIT state a preload under `bench/harness/jit/` installed; absent under `--jit off`. A
   * global lets the preload and the case process share it without importing each other.
   */
  var computisEffectXmlBenchJit: JitState | undefined;
}

/**
 * Read the JIT state a preload left on `globalThis`.
 *
 * @returns The state, or `None` when no JIT preload ran in this process.
 */
export const readJitState = (): Option.Option<JitState> =>
  Option.fromNullishOr(globalThis.computisEffectXmlBenchJit);

/**
 * The runtime options that preload a JIT mode into a child process on the current runtime.
 *
 * Bun takes `--preload <path>` and Node takes `--import <file URL>`; both evaluate the module
 * before the child's entry point imports anything, so the JIT is enabled before the first schema
 * is constructed.
 *
 * @param mode - The JIT mode the child runs in.
 * @returns The options to place before the child's script path; none for `off`.
 */
export const preloadArgs = (mode: JitMode): readonly string[] => {
  if (mode === "off") {
    return [];
  }

  const preload = new URL(`jit/${mode}.ts`, import.meta.url);

  return Predicate.isString(process.versions.bun)
    ? ["--preload", fileURLToPath(preload)]
    : ["--import", preload.href];
};
