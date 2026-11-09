import * as Predicate from "effect/Predicate";
import * as v8 from "node:v8";
import * as vm from "node:vm";

/**
 * Whether `--expose-gc` has already been set on this Node isolate.
 */
let gcExposed = false;

/**
 * Whether a value is a function callable without arguments.
 *
 * @param value - The value to test.
 * @returns True when `value` is a function.
 */
const isThunk = (value: unknown): value is () => void => typeof value === "function";

/**
 * Whether a value is an object exposing a synchronous `gc` method, as `Bun` does.
 *
 * @param value - The value to test.
 * @returns True when `value` has a callable `gc` property.
 */
const hasGc = (value: unknown): value is { readonly gc: (sync: boolean) => void } =>
  Predicate.hasProperty(value, "gc") && typeof value.gc === "function";

/**
 * Force a full garbage collection on the current runtime.
 *
 * Vitest workers run on Node, so the helper never assumes Bun: it calls `Bun.gc(true)` when
 * `"Bun" in globalThis`, and otherwise enables `--expose-gc` once through `v8.setFlagsFromString`
 * and reaches `gc` through a fresh `vm` context.
 */
export const forceGc = (): void => {
  if (Predicate.hasProperty(globalThis, "Bun") && hasGc(globalThis.Bun)) {
    globalThis.Bun.gc(true);

    return;
  }

  if (!gcExposed) {
    v8.setFlagsFromString("--expose-gc");
    gcExposed = true;
  }

  const gc: unknown = vm.runInNewContext("gc");

  if (isThunk(gc)) {
    gc();
  }
};

/**
 * A built value paired with the heap bytes it retains after a forced GC.
 */
export interface Retained<A> {
  readonly value: A;
  readonly retainedBytes: number;
}

/**
 * Measure the heap a built value still retains after a forced GC.
 *
 * Collects, reads `heapUsed`, runs `build`, collects again, and reads `heapUsed` once more; the
 * difference is the retained bytes while `value` stays referenced. The measurement includes the
 * pipeline's fixed cost, which the slope method in the caller cancels by differencing two sizes.
 *
 * @param build - Produces the value whose retained heap is measured.
 * @returns The built value and the bytes it retains.
 */
export const retained = <A>(build: () => A): Retained<A> => {
  forceGc();

  const before = process.memoryUsage().heapUsed;
  const value = build();

  forceGc();

  const after = process.memoryUsage().heapUsed;

  return { retainedBytes: after - before, value };
};

/**
 * Read the live heap above a baseline after a forced GC.
 *
 * @param baseline - A `heapUsed` reading taken earlier.
 * @returns The bytes of heap in use now minus the baseline.
 */
export const liveHeapBytes = (baseline: number): number => {
  forceGc();

  return process.memoryUsage().heapUsed - baseline;
};
