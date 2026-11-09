/**
 * The differential fingerprint: run every surface the corpus, generated, fuzz, and wrapped suites
 * run, for every input their cases modules export, on the `src` fast path and on the `src` standard
 * path (`standardOf`) through the harness, and print one JSON line that summarizes every outcome,
 * so two processes that differ only in their Schema JIT mode can be compared by their output.
 *
 * Run it with `node test/differential/fingerprint.ts`, once as the library ships and once with
 * `--import effect/schema/SchemaJITCompiler/enable` preloaded, as an application that opts into
 * Effect's global JIT does. That import compiles the library's internal structural codecs and every
 * user leaf they reach, and the standard path in the same process runs the same compiled registry
 * entries, so a miscompile both sides share is invisible to one process; equal fingerprints across
 * the two processes rule it out. The surface lists below repeat each suite's surfaces by hand; a
 * drift between them narrows what the comparison covers but cannot fake a divergence, and the
 * printed surface names keep it reviewable.
 *
 * Within one process, the surfaces that never take the fast path (the `ElementFromString` decodes
 * and the direct `Schema` decodes and encodes) run the standard path on both sides, as they do in
 * their suites (accepted loss L1, `docs/goals/performance/phase-3.slices.md`). Each suite's surface
 * list below names them. Across the two processes every surface still compares its output under the
 * two JIT modes.
 *
 * The module also exports the pieces the bank fingerprint (`test/bench/bank-fingerprint.ts`) and
 * the two parity tests reuse. It imports no test runner, so Node runs it with type stripping.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Hash } from "node:crypto";
import { fileURLToPath } from "node:url";

import * as Arr from "effect/Array";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";
import {
  byteChunks,
  channelInputs,
  itemInputs,
  recordPath,
  textChunks,
  treeInputs,
} from "./corpus.cases.ts";
import type { ItemInput } from "./corpus.cases.ts";
import { fuzzInputs } from "./fuzz.cases.ts";
import type { FuzzInput } from "./fuzz.cases.ts";
import { documentInputs, encodeInputs } from "./generated.cases.ts";
import type { GeneratedDocumentInput, GeneratedEncodeInput } from "./generated.cases.ts";
import {
  channelDecode,
  directOutcome,
  documentDecode,
  documentEncode,
  src,
  standard,
  standardOf,
  withTokenizer,
} from "./harness.ts";
import type { ChannelOutcome, DecodeOutcome, DirectOutcome, Side } from "./harness.ts";
import { wrappedInputs } from "./wrapped.cases.ts";
import type { WrappedInput } from "./wrapped.cases.ts";

/**
 * The fingerprint of one suite: the SHA-256 of the canonical JSON of its ordered
 * `[id, src summary, standard summary]` cases, the case count, and the surfaces it ran.
 */
export const SuiteFingerprintSchema = Schema.Struct({
  cases: Schema.Number,
  hash: Schema.String,
  surfaces: Schema.Array(Schema.String),
});

/**
 * The line a fingerprint process prints: each suite's fingerprint, and the `globalThis.Function`
 * constructions made while the surfaces ran.
 *
 * `compiled` counts the constructions whose parameter list is `("ast", "R", "resolve", source)`,
 * the Schema JIT compiler's own (`node_modules/effect/src/schema/SchemaJITCompiler.ts:40`), so it
 * is zero when no JIT is enabled. `probes` counts every other construction, among them the
 * compiler's support probe `Function("return true")`, which re-runs whenever `globalThis.Function`
 * changes identity and so runs once because the counter replaced it.
 */
export const FingerprintSchema = Schema.Struct({
  compiled: Schema.Number,
  probes: Schema.Number,
  suites: Schema.Record(Schema.String, SuiteFingerprintSchema),
});

/**
 * The decoded line of a fingerprint process.
 */
export type Fingerprint = typeof FingerprintSchema.Type;

/**
 * The fingerprint of one suite, as {@link SuiteFingerprintSchema} decodes it.
 */
export type SuiteFingerprint = typeof SuiteFingerprintSchema.Type;

/**
 * Decode a fingerprint process's printed line.
 */
export const decodeFingerprint = Schema.decodeUnknownEffect(
  Schema.fromJsonString(FingerprintSchema),
);

/**
 * The parameter list the Schema JIT compiler constructs every generated function with, before its
 * source (`node_modules/effect/src/schema/SchemaJITCompiler.ts:40`).
 */
const compilerParameters: readonly string[] = ["ast", "R", "resolve"];

/**
 * Tell whether a `Function` construction's arguments are the Schema JIT compiler's.
 *
 * @param args - The arguments `Function` was called or constructed with.
 * @returns `true` for `("ast", "R", "resolve", source)`.
 */
const isCompiled = (args: readonly unknown[]): boolean =>
  args.length === compilerParameters.length + 1 &&
  compilerParameters.every((name, index) => args[index] === name);

/**
 * The constructions counted while a counted effect ran.
 */
export interface Constructions {
  compiled: number;
  probes: number;
}

// Native: effect/Effect and effect/schema/SchemaJITCompiler expose no count or hook of the functions the JIT generates; the compiler constructs them through `globalThis.Function`, so a counting proxy is the only observation point.
/**
 * Run an effect with `globalThis.Function` replaced by a proxy that counts constructions, and
 * restore the original afterwards, even on failure or interruption.
 *
 * The proxy keeps `prototype` and every static member, so `instanceof Function` behaves as before.
 *
 * @param effect - The effect whose constructions are counted.
 * @returns The effect's value with the counts.
 */
export const countConstructions = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<{ readonly value: A; readonly constructions: Constructions }, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const original = globalThis.Function;
      const constructions: Constructions = { compiled: 0, probes: 0 };

      const count = (args: readonly unknown[]): void => {
        if (isCompiled(args)) {
          constructions.compiled += 1;
        } else {
          constructions.probes += 1;
        }
      };

      globalThis.Function = new Proxy(original, {
        apply: (target, _self, args: string[]) => {
          count(args);

          return target(...args);
        },
        construct: (target, args: string[]) => {
          count(args);

          return new target(...args);
        },
      });

      return { constructions, original };
    }),
    ({ constructions }) => effect.pipe(Effect.map((value) => ({ constructions, value }))),
    ({ original }) =>
      Effect.sync(() => {
        globalThis.Function = original;
      }),
  );

// Native: JSON.stringify keeps insertion order and drops `undefined`, `-0`, and non-finite numbers; the fingerprint needs one total, order-independent spelling per value.
/**
 * Write a value as canonical JSON: object keys sorted, and every value JSON cannot spell
 * (`undefined`, `-0`, a non-finite number, a `bigint`, a symbol, a function) as a tagged object.
 *
 * Key order is not lost: every value summary carries its own key order (`keys`), so sorting keys
 * here only removes the dependence on how a summary object itself was built. An object whose
 * prototype is not `Object.prototype` or `null` carries its constructor name.
 *
 * @param value - The value to write.
 * @returns The canonical JSON text.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- any harness summary, walked as plain data.
export const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (Predicate.isNumber(value)) {
    if (Object.is(value, -0)) {
      return `{"$number":"-0"}`;
    }

    return Number.isFinite(value) ? JSON.stringify(value) : `{"$number":"${String(value)}"}`;
  }

  if (Predicate.isString(value) || Predicate.isBoolean(value) || Predicate.isNull(value)) {
    return JSON.stringify(value);
  }

  if (Predicate.isUndefined(value)) {
    return `{"$undefined":true}`;
  }

  if (Predicate.isBigInt(value)) {
    return `{"$bigint":"${value.toString()}"}`;
  }

  if (Predicate.isSymbol(value)) {
    return `{"$symbol":${JSON.stringify(value.description ?? "")}}`;
  }

  if (Predicate.isFunction(value)) {
    return `{"$function":${JSON.stringify(value.name)}}`;
  }

  if (Predicate.isObject(value)) {
    const prototype: unknown = Object.getPrototypeOf(value);

    const named =
      prototype === Object.prototype || Predicate.isNull(prototype)
        ? []
        : [`"$class":${JSON.stringify(value.constructor.name)}`];

    const fields = Arr.sort(Object.keys(value), Order.String).map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    );

    return `{${[...named, ...fields].join(",")}}`;
  }

  return `{"$unknown":true}`;
};

// Native: effect/crypto/Digest hashes one Uint8Array; a suite's canonical JSON reaches tens of megabytes at the bank sizes, which the incremental `node:crypto` Hash avoids buffering.
/**
 * A suite's running fingerprint: its cases are appended in order and hashed as one canonical JSON
 * array.
 */
export interface SuiteLedger {
  /**
   * Append one case.
   *
   * @param id - The case id.
   * @param left - The `src` side's summary.
   * @param right - The standard side's summary.
   */
  readonly add: <Summary>(id: string, left: Summary, right: Summary) => void;
  /**
   * Close the ledger.
   *
   * @returns The suite's fingerprint.
   */
  readonly done: () => SuiteFingerprint;
}

/**
 * Start a suite's ledger.
 *
 * @param surfaces - The names of the surfaces the suite runs.
 * @returns The ledger.
 */
export const ledger = (surfaces: readonly string[]): SuiteLedger => {
  const hash: Hash = createHash("sha256").update("[");
  let cases = 0;

  return {
    add: (id, left, right) => {
      hash.update(`${cases === 0 ? "" : ","}${canonicalJson([id, left, right])}`);
      cases += 1;
    },
    done: () => ({ cases, hash: hash.update("]").digest("hex"), surfaces }),
  };
};

/**
 * Print a fingerprint as one JSON line.
 *
 * @param fingerprint - The fingerprint.
 * @returns An effect that writes the line to standard output.
 */
export const printFingerprint = (fingerprint: Fingerprint): Effect.Effect<void> =>
  Console.log(JSON.stringify(fingerprint));

/**
 * A finished fingerprint process: its exit status, its output, and its wall time.
 */
export interface FingerprintRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * The application's global JIT import, which `bench/harness/jit/on.ts` imports too, named here so
 * `test/differential/` imports nothing from `bench/`.
 */
export const jitImport = "effect/schema/SchemaJITCompiler/enable";

/**
 * The repository root, every fingerprint process's working directory, so `--import` resolves the
 * JIT module from the repository's `node_modules`.
 */
const repository = fileURLToPath(new URL("../../", import.meta.url));

// Native: effect/process ChildProcess needs a ChildProcessSpawner layer, which only a platform package provides, and no platform package is a dependency.
/**
 * Run a fingerprint script in a `node` child process, interpreted or with the global JIT import
 * preloaded.
 *
 * @param script - The script's URL.
 * @param jit - Whether to preload {@link jitImport}.
 * @returns The finished run.
 */
export const runFingerprint = (script: URL, jit: boolean): Effect.Effect<FingerprintRun> =>
  Effect.sync(() => {
    const started = performance.now();

    const child = spawnSync(
      "node",
      [...(jit ? ["--import", jitImport] : []), fileURLToPath(script)],
      { cwd: repository, encoding: "utf-8", maxBuffer: 16 * 1024 * 1024 },
    );

    return {
      durationMs: performance.now() - started,
      status: child.status,
      stderr: child.stderr,
      stdout: child.stdout,
    };
  });

/**
 * The tokenizer both sides' provided-tokenizer encode runs with: a spread copy of `src`'s default,
 * as the generated suite's P1t provides it to each side.
 */
// oxlint-disable-next-line typescript/no-misused-spread -- `defaultTokenizer` is a plain object literal (`src/tokenizer.ts:114`); a spread copy is the provided value P1t needs.
const providedTokenizer: SrcXml.Tokenizer = { ...defaultTokenizer };

/**
 * The surfaces of the corpus suite (`corpus.test.ts`). The typed surfaces and both channels take
 * the fast path on the `src` side; `tree decode`, `tree encode`, and `direct` never do, so they run
 * the standard path on both sides.
 */
const corpusSurfaces: readonly string[] = [
  "tree decode",
  "tree encode",
  "typed decode",
  "typed encode",
  "direct",
  "decodeSchemaString",
  "decodeSchema",
];

/**
 * Run the corpus suite's direct surface on one side: the raw-tree decode, then
 * `Schema.decodeUnknownExit` of the root over that tree. Neither step takes the fast path, so both
 * sides run the standard path.
 *
 * @param side - The side whose codecs run.
 * @param roots - That side's raw-tree codec and root.
 * @param roots.item - The root.
 * @param roots.tree - The raw-tree codec.
 * @param input - The typed input.
 * @returns The direct outcome, or the raw-tree failure.
 */
const corpusDirect = (
  side: Side,
  roots: { readonly item: Schema.Decoder<unknown>; readonly tree: Schema.Codec<unknown, string> },
  input: ItemInput,
): Effect.Effect<DecodeOutcome | DirectOutcome> =>
  documentDecode(side, roots.tree, input.text).pipe(
    Effect.map((tree): DecodeOutcome | DirectOutcome =>
      "value" in tree
        ? directOutcome(Schema.decodeUnknownExit(roots.item)(tree.value, input.parseOptions))
        : tree,
    ),
  );

/**
 * Fingerprint the corpus suite's surfaces over every corpus input.
 */
const corpusFingerprint = Effect.gen(function* corpusFingerprint() {
  const suite = ledger(corpusSurfaces);

  for (const input of treeInputs) {
    const left = yield* documentDecode(src, input.roots.src, input.text);
    const right = yield* documentDecode(standard, input.roots.standard, input.text);

    suite.add(`${input.id} decode`, left, right);

    if ("value" in left && "value" in right) {
      suite.add(
        `${input.id} encode`,
        yield* documentEncode(src, input.roots.src, left.value),
        yield* documentEncode(standard, input.roots.standard, right.value),
      );
    }
  }

  for (const input of itemInputs) {
    const srcCodec = SrcXml.fromString(input.roots.src.item);
    const standardCodec = SrcXml.fromString(input.roots.standard.item);
    const left = yield* documentDecode(src, srcCodec, input.text, input.parseOptions);
    const right = yield* documentDecode(standard, standardCodec, input.text, input.parseOptions);

    suite.add(`${input.id} typed decode`, left, right);

    if ("value" in left && "value" in right) {
      suite.add(
        `${input.id} typed encode`,
        yield* documentEncode(src, srcCodec, left.value, input.parseOptions),
        yield* documentEncode(standard, standardCodec, right.value, input.parseOptions),
      );
    }

    suite.add(
      `${input.id} direct`,
      yield* corpusDirect(src, input.roots.src, input),
      yield* corpusDirect(standard, input.roots.standard, input),
    );
  }

  for (const input of channelInputs) {
    const path = input.path ?? recordPath;
    const { options, parseOptions } = input;

    suite.add(
      `${input.id} decodeSchemaString`,
      yield* channelDecode(
        SrcXml.decodeSchemaString(input.roots.src, path),
        Stream.fromIterable(textChunks(input)),
        options,
        parseOptions,
      ),
      yield* channelDecode(
        SrcXml.decodeSchemaString(input.roots.standard, path),
        Stream.fromIterable(textChunks(input)),
        options,
        parseOptions,
      ),
    );

    suite.add(
      `${input.id} decodeSchema`,
      yield* channelDecode(
        SrcXml.decodeSchema(input.roots.src, path),
        Stream.fromIterable(byteChunks(input)),
        options,
        parseOptions,
      ),
      yield* channelDecode(
        SrcXml.decodeSchema(input.roots.standard, path),
        Stream.fromIterable(byteChunks(input)),
        options,
        parseOptions,
      ),
    );
  }

  return suite.done();
});

/**
 * The surfaces of the generated suite (`generated.test.ts`): P1, P1t, P3 and P5 per value, P2 and
 * P4 per encoded text. P1, P1t, P2, and P4 take the fast path on the `src` side; the two P3
 * surfaces never do, so they run the standard path on both sides.
 */
const generatedSurfaces: readonly string[] = [
  "P1 fromString encode",
  "P1t fromString encode with a provided tokenizer",
  "P3 direct encode",
  "P3 direct decode of the encoded element",
  "P2 fromString decode",
  "P4 decodeSchemaString positions off",
  "P4 decodeSchemaString positions on",
];

/**
 * One side's builders for a generated root.
 */
interface GeneratedSide {
  readonly side: Side;
  readonly root: Schema.Codec<unknown, unknown>;
  readonly document: Schema.Codec<unknown, string>;
  readonly tokenizer: SrcXml.Tokenizer;
  readonly channel: (
    path: readonly string[],
    text: string,
    positions: boolean,
  ) => Effect.Effect<ChannelOutcome>;
}

/**
 * Build both sides' builders for a generated input's roots.
 *
 * @param input - A value or text input of the generated suite.
 * @returns The `src` and standard builders.
 */
const generatedSides = (input: GeneratedEncodeInput | GeneratedDocumentInput) => {
  const left: GeneratedSide = {
    channel: (path, text, positions) =>
      channelDecode(SrcXml.decodeSchemaString(input.roots.src, path), Stream.make(text), {
        positions,
      }),
    document: SrcXml.fromString(input.roots.src),
    root: input.roots.src,
    side: src,
    tokenizer: providedTokenizer,
  };

  const right: GeneratedSide = {
    channel: (path, text, positions) =>
      channelDecode(SrcXml.decodeSchemaString(input.roots.standard, path), Stream.make(text), {
        positions,
      }),
    document: SrcXml.fromString(input.roots.standard),
    root: input.roots.standard,
    side: standard,
    tokenizer: providedTokenizer,
  };

  return { left, right };
};

/**
 * Observe the generated suite's encode surfaces of one value on one side. P1 and P1t encode through
 * `fromString`, which takes the fast path on the `src` side; P3's direct encode and its round-trip
 * decode go through `Schema` and run the standard path on both sides.
 *
 * @param built - The side's builders.
 * @param input - The value input.
 * @returns P1, P1t, and both P3 outcomes.
 */
const generatedEncode = Effect.fnUntraced(function* generatedEncode(
  built: GeneratedSide,
  input: GeneratedEncodeInput,
) {
  const directExit = Schema.encodeUnknownExit(built.root)(input.value, input.parseOptions);

  return {
    direct: directOutcome(directExit),
    encode: yield* documentEncode(built.side, built.document, input.value, input.parseOptions),
    encodeTokenizer: yield* withTokenizer(
      built.side,
      documentEncode(built.side, built.document, input.value, input.parseOptions),
      built.tokenizer,
    ),
    roundTrip: Exit.isSuccess(directExit)
      ? directOutcome(Schema.decodeUnknownExit(built.root)(directExit.value, input.parseOptions))
      : "not encoded",
  };
});

/**
 * Observe the generated suite's decode surfaces of one encoded text on one side.
 *
 * @param built - The side's builders.
 * @param input - The text input.
 * @returns P2 and both P4 outcomes.
 */
const generatedDocument = Effect.fnUntraced(function* generatedDocument(
  built: GeneratedSide,
  input: GeneratedDocumentInput,
) {
  return {
    channel: yield* built.channel(input.path, input.text, false),
    channelPositions: yield* built.channel(input.path, input.text, true),
    decode: yield* documentDecode(built.side, built.document, input.text),
  };
});

/**
 * Fingerprint the generated suite's surfaces over every value and text input.
 */
const generatedFingerprint = Effect.gen(function* generatedFingerprint() {
  const suite = ledger(generatedSurfaces);

  for (const input of encodeInputs) {
    const { left, right } = generatedSides(input);

    suite.add(
      `encode ${input.id}`,
      yield* generatedEncode(left, input),
      yield* generatedEncode(right, input),
    );
  }

  for (const input of documentInputs) {
    const { left, right } = generatedSides(input);

    suite.add(
      `document ${input.id}`,
      yield* generatedDocument(left, input),
      yield* generatedDocument(right, input),
    );
  }

  return suite.done();
});

/**
 * The surfaces of the fuzz suite (`fuzz.test.ts`). The `fromString` decode and both
 * `decodeSchemaString` runs take the fast path on the `src` side; the `ElementFromString` decode
 * and the direct decode of the raw tree never do, so they run the standard path on both sides.
 */
const fuzzSurfaces: readonly string[] = [
  "ElementFromString decode",
  "fromString decode",
  "direct decode of the raw tree",
  "decodeSchemaString positions off",
  "decodeSchemaString positions on",
];

/**
 * One side's codecs for a fuzzed input, as the fuzz suite builds them: the standard side's over the
 * `standardOf` copies of the roots and of the raw-tree codec.
 */
interface FuzzSide {
  readonly side: Side;
  readonly tree: Schema.Codec<unknown, string>;
  readonly typed: Schema.Codec<unknown, string>;
  readonly root: Schema.Codec<unknown, unknown>;
  readonly channel: (positions: boolean) => Effect.Effect<ChannelOutcome>;
}

/**
 * Build both sides' codecs for a fuzzed input.
 *
 * @param input - The fuzzed input.
 * @returns The `src` and standard codecs.
 */
const fuzzSides = (input: FuzzInput) => {
  const options = (positions: boolean) => ({ ...input.options, positions });

  const left: FuzzSide = {
    channel: (positions) =>
      channelDecode(
        SrcXml.decodeSchemaString(input.record.src, input.path),
        Stream.fromIterable(textChunks(input)),
        options(positions),
        input.parseOptions,
      ),
    root: input.roots.src,
    side: src,
    tree: SrcXml.ElementFromString(input.prefixes, input.options),
    typed: SrcXml.fromString(input.roots.src, input.options),
  };

  const right: FuzzSide = {
    channel: (positions) =>
      channelDecode(
        SrcXml.decodeSchemaString(input.record.standard, input.path),
        Stream.fromIterable(textChunks(input)),
        options(positions),
        input.parseOptions,
      ),
    root: input.roots.standard,
    side: standard,
    tree: standardOf(SrcXml.ElementFromString(input.prefixes, input.options)),
    typed: SrcXml.fromString(input.roots.standard, input.options),
  };

  return { left, right };
};

/**
 * Observe the fuzz suite's surfaces of one input on one side. `tree` and `direct` run the standard
 * path on both sides; `typed` and the channels take the fast path on the `src` side.
 *
 * @param built - The side's codecs.
 * @param input - The fuzzed input.
 * @returns The side's outcomes.
 */
const fuzzObserve = Effect.fnUntraced(function* fuzzObserve(built: FuzzSide, input: FuzzInput) {
  const tree = yield* documentDecode(built.side, built.tree, input.text, input.parseOptions);

  return {
    channel: yield* built.channel(false),
    channelPositions: yield* built.channel(true),
    direct:
      "value" in tree
        ? directOutcome(Schema.decodeUnknownExit(built.root)(tree.value, input.parseOptions))
        : "no tree",
    tree,
    typed: yield* documentDecode(built.side, built.typed, input.text, input.parseOptions),
  };
});

/**
 * Fingerprint the fuzz suite's surfaces over every fuzzed input.
 */
const fuzzFingerprint = Effect.gen(function* fuzzFingerprint() {
  const suite = ledger(fuzzSurfaces);

  for (const input of fuzzInputs) {
    const { left, right } = fuzzSides(input);

    suite.add(input.id, yield* fuzzObserve(left, input), yield* fuzzObserve(right, input));
  }

  return suite.done();
});

/**
 * The surfaces of the wrapped suite (`wrapped.test.ts`). The `fromString` and `decodeSchemaString`
 * surfaces take the fast path on the `src` side; the `ElementFromString` resolve and the three
 * direct surfaces never do, so they run the standard path on both sides.
 */
const wrappedSurfaces: readonly string[] = [
  "ElementFromString resolve",
  "fromString decode",
  "fromString decode errors all",
  "fromString encode of the decoded value",
  "fromString encode of the bare decoded value",
  "direct decode of the resolved tree",
  "direct encode of the direct value",
  "direct encode of the bare direct value",
  "decodeSchemaString positions off",
  "decodeSchemaString positions on",
];

/**
 * One side's codecs for a wrapped input, as the wrapped suite builds them: the standard side's over
 * the `standardOf` copies of the roots and record definitions.
 */
interface WrappedSide {
  readonly side: Side;
  readonly resolve: Schema.Codec<unknown, string>;
  readonly document: Schema.Codec<unknown, string>;
  readonly bareDocument: Schema.Codec<unknown, string>;
  readonly root: Schema.Codec<unknown, unknown>;
  readonly bareRoot: Schema.Codec<unknown, unknown>;
  readonly channel: (positions: boolean) => Effect.Effect<ChannelOutcome>;
}

/**
 * Find the bare input at the same placement and variant as a wrapped input, and build both sides'
 * codecs for the pair.
 *
 * @param input - The wrapped input.
 * @returns The `src` and standard codecs, failing when no bare input matches.
 */
const wrappedSides = (input: WrappedInput) =>
  Effect.fromNullishOr(
    wrappedInputs.find(
      ({ placement, variant, wrapper }) =>
        wrapper === "bare" && placement === input.placement && variant === input.variant,
    ),
  ).pipe(
    Effect.mapError(() => `no bare input for ${input.id}`),
    Effect.map((bare) => {
      const left: WrappedSide = {
        bareDocument: SrcXml.fromString(bare.roots.src),
        bareRoot: bare.roots.src,
        channel: (positions) =>
          channelDecode(
            SrcXml.decodeSchemaString(input.record.src, input.path),
            Stream.make(input.text),
            { positions },
          ),
        document: SrcXml.fromString(input.roots.src),
        resolve: SrcXml.ElementFromString({}),
        root: input.roots.src,
        side: src,
      };

      const right: WrappedSide = {
        bareDocument: SrcXml.fromString(bare.roots.standard),
        bareRoot: bare.roots.standard,
        channel: (positions) =>
          channelDecode(
            SrcXml.decodeSchemaString(input.record.standard, input.path),
            Stream.make(input.text),
            { positions },
          ),
        document: SrcXml.fromString(input.roots.standard),
        resolve: SrcXml.ElementFromString({}),
        root: input.roots.standard,
        side: standard,
      };

      return { left, right };
    }),
  );

/**
 * Observe the wrapped suite's surfaces of one input on one side.
 *
 * @param built - The side's codecs.
 * @param text - The input's text.
 * @returns The side's outcomes.
 */
const wrappedObserve = Effect.fnUntraced(function* wrappedObserve(
  built: WrappedSide,
  text: string,
) {
  const decode = yield* documentDecode(built.side, built.document, text);
  const bareDecode = yield* documentDecode(built.side, built.bareDocument, text);
  const resolvedExit = Schema.decodeUnknownExit(built.resolve)(text);

  const directExit = Exit.isSuccess(resolvedExit)
    ? Schema.decodeUnknownExit(built.root)(resolvedExit.value)
    : undefined;

  const bareDirectExit = Exit.isSuccess(resolvedExit)
    ? Schema.decodeUnknownExit(built.bareRoot)(resolvedExit.value)
    : undefined;

  return {
    channel: yield* built.channel(false),
    channelPositions: yield* built.channel(true),
    decode,
    decodeAll: yield* documentDecode(built.side, built.document, text, { errors: "all" }),
    direct: directExit === undefined ? "not resolved" : directOutcome(directExit),
    directEncode:
      directExit !== undefined && Exit.isSuccess(directExit)
        ? directOutcome(Schema.encodeUnknownExit(built.root)(directExit.value))
        : "not decoded",
    directEncodeBare:
      bareDirectExit !== undefined && Exit.isSuccess(bareDirectExit)
        ? directOutcome(Schema.encodeUnknownExit(built.root)(bareDirectExit.value))
        : "not decoded",
    encode:
      "value" in decode
        ? yield* documentEncode(built.side, built.document, decode.value)
        : "not decoded",
    encodeBare:
      "value" in bareDecode
        ? yield* documentEncode(built.side, built.document, bareDecode.value)
        : "not decoded",
    resolved: directOutcome(resolvedExit),
  };
});

/**
 * Fingerprint the wrapped suite's surfaces over every wrapped input.
 */
const wrappedFingerprint = Effect.gen(function* wrappedFingerprint() {
  const suite = ledger(wrappedSurfaces);

  for (const input of wrappedInputs) {
    const { left, right } = yield* wrappedSides(input);

    suite.add(
      input.id,
      yield* wrappedObserve(left, input.text),
      yield* wrappedObserve(right, input.text),
    );
  }

  return suite.done();
});

/**
 * Fingerprint every suite, counting `Function` constructions from the first surface to the last.
 */
const differentialFingerprint = countConstructions(
  Effect.all({
    corpus: corpusFingerprint,
    fuzz: fuzzFingerprint,
    generated: generatedFingerprint,
    wrapped: wrappedFingerprint,
  }),
).pipe(
  Effect.map(({ constructions, value }): Fingerprint => ({
    compiled: constructions.compiled,
    probes: constructions.probes,
    suites: value,
  })),
);

if (import.meta.main || process.argv[1] === import.meta.filename) {
  void Effect.runPromise(
    differentialFingerprint.pipe(
      Effect.flatMap(printFingerprint),
      Effect.matchEffect({
        onFailure: (error) =>
          Console.error(`fingerprint: ${error}`).pipe(
            Effect.andThen(
              Effect.sync(() => {
                process.exitCode = 1;
              }),
            ),
          ),
        onSuccess: () => Effect.void,
      }),
    ),
  );
}
