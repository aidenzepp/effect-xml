import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

// Peak-heap and wall-time measurement around one Effect. Heap is
// `process.memoryUsage().heapUsed`, sampled on a 2 ms interval (the Effect
// fiber yields to the event loop periodically, so the timer runs during the
// pipeline) plus any explicit `note()` calls the pipeline makes, for example
// once per streamed record. A forced `Bun.gc(true)` before the run gives a
// comparable baseline; the reported peak is the maximum sample minus that
// baseline.

export interface Measurement<A> {
  readonly label: string;
  readonly value: A;
  readonly wallMs: number;
  readonly baselineHeapMB: number;
  readonly peakHeapMB: number;
  readonly deltaHeapMB: number;
}

export interface Sampler {
  readonly note: () => void;
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

export const measure = <A, E, R>(
  label: string,
  run: (sampler: Sampler) => Effect.Effect<A, E, R>,
): Effect.Effect<Measurement<A>, E, R> =>
  Effect.gen(function* () {
    Bun.gc(true);
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const note = () => {
      const used = process.memoryUsage().heapUsed;
      if (used > peak) peak = used;
    };
    const timer = setInterval(note, 2);
    const [duration, value] = yield* Effect.timed(run({ note })).pipe(
      Effect.ensuring(Effect.sync(() => clearInterval(timer))),
    );
    note();
    return {
      label,
      value,
      wallMs: Math.round(Duration.toMillis(duration)),
      baselineHeapMB: mb(baseline),
      peakHeapMB: mb(peak),
      deltaHeapMB: mb(peak - baseline),
    };
  });

export const format = (m: Measurement<unknown>): string =>
  `${m.label}: wall ${m.wallMs} ms, heap baseline ${m.baselineHeapMB} MB, peak ${m.peakHeapMB} MB, delta ${m.deltaHeapMB} MB`;

// Retained heap of a value: bytes still in use after a forced GC while `hold`
// is referenced, minus the baseline taken before `build` ran.
export const retained = <A>(build: () => A): { readonly value: A; readonly retainedMB: number } => {
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  const value = build();
  Bun.gc(true);
  const after = process.memoryUsage().heapUsed;
  return { value, retainedMB: mb(after - before) };
};
