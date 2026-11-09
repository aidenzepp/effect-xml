/**
 * Bucket a Chrome `.cpuprofile`'s self time by the library layer each sampled frame belongs to:
 * the cross-check of the differential layer profile. Bun and Node both write this format under
 * `--cpu-prof`.
 *
 * Run directly as `bun bench/profile/cpu-buckets.ts <file.cpuprofile>` (or `node`) to print the
 * buckets of one profile as JSON.
 */
import { readFileSync } from "node:fs";

import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import { isEntryPoint } from "../harness/script.ts";

/**
 * The layers a CPU sample's self time is attributed to. `resolver-collector` is one bucket
 * because `src/resolve.ts` holds both stages; the layer ladder separates them.
 *
 * The structural path's own modules each have a bucket: `builder` (`src/builder.ts`, decode),
 * `structural` (`src/structural.ts` and `src/structural-slot.ts`, the one structural codec both
 * directions share), `fast-decode` and `fast-encode` (the glue of each direction), and `writer`
 * (`src/writer.ts`, encode). `tokenizer` covers the tokenizer's decode and encode alike, so in an
 * encode-only profile it is the tokenizer encode. `schema` keeps every other `src/` module and
 * Effect's Schema modules, where the structural codec's interpreted parse runs. Code the Schema JIT
 * compiles has no script URL and lands in `other`.
 */
export type Layer =
  | "tokenizer"
  | "resolver-collector"
  | "builder"
  | "structural"
  | "fast-decode"
  | "fast-encode"
  | "writer"
  | "schema"
  | "positions"
  | "effect-runtime"
  | "harness"
  | "other";

/**
 * The structural path's modules and the bucket each one owns.
 */
const structuralModules: ReadonlyMap<string, Layer> = new Map([
  ["/src/builder.ts", "builder"],
  ["/src/structural.ts", "structural"],
  ["/src/structural-slot.ts", "structural"],
  ["/src/fast-decode.ts", "fast-decode"],
  ["/src/fast-encode.ts", "fast-encode"],
  ["/src/writer.ts", "writer"],
]);

/**
 * The parts of a Chrome `.cpuprofile` the bucketing reads: sample `i` spent `timeDeltas[i]`
 * microseconds with node `samples[i]` on top of the stack. Other profile fields are ignored.
 *
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Profiler/#type-Profile
 */
export const CpuProfileSchema = Schema.Struct({
  nodes: Schema.Array(
    Schema.Struct({
      callFrame: Schema.Struct({
        functionName: Schema.String,
        lineNumber: Schema.Number,
        url: Schema.String,
      }),
      children: Schema.optionalKey(Schema.Array(Schema.Number)),
      id: Schema.Number,
    }),
  ),
  samples: Schema.Array(Schema.Number),
  timeDeltas: Schema.Array(Schema.Number),
});

/**
 * A decoded {@link CpuProfileSchema}.
 */
export type CpuProfile = typeof CpuProfileSchema.Type;

/**
 * The failure of the command-line entry: the profile file could not be named, read, or decoded.
 */
export class CpuBucketsError extends Data.TaggedError("CpuBucketsError")<{
  readonly path: string;
  readonly reason: string;
}> {}

/**
 * Matches an effect-xml source module at the top of a `src/` directory.
 */
const sourceModule = /\/src\/[^/]+\.ts$/u;

/**
 * Attribute a script URL to its layer; the first matching rule wins, so the tokenizer, resolver,
 * position, and structural-path modules claim their files before the general `src/` rule does.
 *
 * @param url - The frame's script URL, as `callFrame.url` records it.
 * @returns The layer that owns frames from `url`.
 */
export const layerOf = (url: string): Layer => {
  if (url.includes("/effect/dist/encoding/Xml") || url.endsWith("/src/tokenizer.ts")) {
    return "tokenizer";
  }

  if (url.endsWith("/src/resolve.ts")) {
    return "resolver-collector";
  }

  if (url.endsWith("/src/positions.ts") || url.endsWith("/src/record-path.ts")) {
    return "positions";
  }

  const structural = sourceModule.exec(url);
  const owner = structural === null ? undefined : structuralModules.get(structural[0]);

  if (owner !== undefined) {
    return owner;
  }

  if (sourceModule.test(url) || url.includes("/effect/dist/Schema")) {
    return "schema";
  }

  if (url.includes("/effect/dist/")) {
    return "effect-runtime";
  }

  return url.includes("/bench/") ? "harness" : "other";
};

/**
 * Sum a profile's self time per layer, in milliseconds, given each node's layer. A sample whose
 * node id has no layer counts as `other`.
 *
 * @param profile - The decoded profile.
 * @param layerById - The layer of each node id.
 * @returns Self time in milliseconds for every layer, zero for a layer with no samples.
 */
const sumByLayer = (
  profile: CpuProfile,
  layerById: ReadonlyMap<number, Layer>,
): Readonly<Record<Layer, number>> => {
  const ms: Record<Layer, number> = {
    builder: 0,
    "effect-runtime": 0,
    "fast-decode": 0,
    "fast-encode": 0,
    harness: 0,
    other: 0,
    positions: 0,
    "resolver-collector": 0,
    schema: 0,
    structural: 0,
    tokenizer: 0,
    writer: 0,
  };

  for (const [i, nodeId] of profile.samples.entries()) {
    ms[layerById.get(nodeId) ?? "other"] += (profile.timeDeltas[i] ?? 0) / 1000;
  }

  return ms;
};

/**
 * Sum a profile's self time per layer, in milliseconds, by each sampled frame's own script URL. A
 * sample whose node id is absent from `nodes` counts as `other`.
 *
 * @param profile - The decoded profile.
 * @returns Self time in milliseconds for every layer, zero for a layer with no samples.
 */
export const bucket = (profile: CpuProfile): Readonly<Record<Layer, number>> =>
  sumByLayer(profile, new Map(profile.nodes.map((node) => [node.id, layerOf(node.callFrame.url)])));

/**
 * Matches a runtime pseudo-frame such as `(garbage collector)`, `(program)`, `(idle)`, or
 * `(root)`: time the runtime spends outside any caller's function.
 */
const pseudoFrame = /^\(.*\)$/u;

/**
 * Attribute every node to its caller's layer: a frame with a script URL, or a runtime
 * pseudo-frame, keeps its own layer, and a frame with neither, a runtime builtin such as
 * `Array.prototype.push` or a function the Schema JIT compiled, takes the layer of its nearest
 * ancestor that has one.
 *
 * `bucket` files builtins and JIT-compiled code under `other` because they carry no script URL;
 * this attribution charges them to the library layer that called them.
 *
 * @param profile - The decoded profile.
 * @returns The caller layer of each node id.
 */
export const callerLayers = (profile: CpuProfile): ReadonlyMap<number, Layer> => {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();

  for (const node of profile.nodes) {
    for (const child of node.children ?? []) {
      parents.set(child, node.id);
    }
  }

  const layers = new Map<number, Layer>();

  const resolve = (id: number): Layer => {
    const chain: number[] = [];
    let current: number | undefined = id;
    let found: Layer = "other";

    while (current !== undefined) {
      const known = layers.get(current);

      if (known !== undefined) {
        found = known;
        break;
      }

      const frame = byId.get(current)?.callFrame;

      if (frame !== undefined && (frame.url !== "" || pseudoFrame.test(frame.functionName))) {
        found = layerOf(frame.url);
        chain.push(current);
        break;
      }

      chain.push(current);
      current = parents.get(current);
    }

    for (const visited of chain) {
      layers.set(visited, found);
    }

    return found;
  };

  for (const node of profile.nodes) {
    resolve(node.id);
  }

  return layers;
};

/**
 * Sum a profile's self time per layer, in milliseconds, charging each frame without a script URL
 * to its caller's layer (see {@link callerLayers}).
 *
 * @param profile - The decoded profile.
 * @returns Self time in milliseconds for every layer, zero for a layer with no samples.
 */
export const bucketByCaller = (profile: CpuProfile): Readonly<Record<Layer, number>> =>
  sumByLayer(profile, callerLayers(profile));

/**
 * One function's self time in a profile: every node with the same name, script, and line counts
 * as the one function.
 */
export interface SelfTime {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly layer: Layer;
  /**
   * The layer {@link callerLayers} charges the function to: its own layer when it has a script
   * URL, otherwise its nearest caller's.
   */
  readonly callerLayer: Layer;
  readonly selfMs: number;
}

/**
 * One function's running self time while a profile is read, in microseconds.
 */
type Total = Omit<SelfTime, "layer" | "selfMs"> & { micros: number };

/**
 * List the functions with the most self time in a profile.
 *
 * Node ids are per call path, so one function sampled under several callers spans several nodes;
 * the list merges them by name, script, line, and caller layer, so a builtin called from two
 * layers is listed once per layer. The runtime's own pseudo-frames, such as
 * `(garbage collector)` and `(program)`, stay in the list under `other`.
 *
 * @param profile - The decoded profile.
 * @param count - How many functions to list.
 * @returns The `count` functions with the most self time, largest first.
 */
export const topSelf = (profile: CpuProfile, count: number): readonly SelfTime[] => {
  const callers = callerLayers(profile);

  const keyById = new Map(
    profile.nodes.map((node) => {
      const { functionName, lineNumber, url } = node.callFrame;
      const callerLayer = callers.get(node.id) ?? "other";

      return [
        node.id,
        {
          callerLayer,
          functionName,
          key: [functionName, url, lineNumber, callerLayer].join("\u0000"),
          lineNumber,
          url,
        },
      ];
    }),
  );

  const totals = new Map<string, Total>();

  for (const [i, nodeId] of profile.samples.entries()) {
    const frame = keyById.get(nodeId);

    if (frame !== undefined) {
      const entry = totals.get(frame.key) ?? { ...frame, micros: 0 };

      entry.micros += profile.timeDeltas[i] ?? 0;
      totals.set(frame.key, entry);
    }
  }

  return Arr.sort(
    totals.values(),
    Order.flip(Order.mapInput(Order.Number, (entry: Total) => entry.micros)),
  )
    .slice(0, count)
    .map(({ callerLayer, functionName, lineNumber, micros, url }) => ({
      callerLayer,
      functionName,
      layer: layerOf(url),
      lineNumber,
      selfMs: micros / 1000,
      url,
    }));
};

// Native: `effect/FileSystem` lacks an implementation without a platform layer, which is not a dependency.
/**
 * Read, decode, and bucket the profile file at `path`.
 *
 * @param path - The `.cpuprofile` file, or `undefined` when no argument was given.
 * @returns The profile's buckets.
 */
const bucketFile = Effect.fnUntraced(function* bucketFile(
  path: string | undefined,
): Effect.fn.Return<Readonly<Record<Layer, number>>, CpuBucketsError> {
  if (path === undefined) {
    return yield* new CpuBucketsError({
      path: "",
      reason: "no profile given; pass the path of a .cpuprofile file as the first argument",
    });
  }

  const text = yield* Effect.try({
    catch: (cause) =>
      new CpuBucketsError({ path, reason: `cannot read the file: ${String(cause)}` }),
    try: () => readFileSync(path, "utf-8"),
  });

  const profile = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CpuProfileSchema))(
    text,
  ).pipe(
    Effect.mapError(
      (error) => new CpuBucketsError({ path, reason: `not a .cpuprofile: ${error.message}` }),
    ),
  );

  return bucket(profile);
});

if (isEntryPoint(import.meta)) {
  Effect.runSync(
    bucketFile(process.argv[2]).pipe(
      Effect.match({
        onFailure: (error) => {
          console.error(
            error.path === ""
              ? `cpu-buckets: ${error.reason}`
              : `cpu-buckets: ${error.path}: ${error.reason}`,
          );
          process.exitCode = 1;
        },
        onSuccess: (buckets) => {
          console.log(JSON.stringify(buckets, null, 2));
        },
      }),
    ),
  );
}
