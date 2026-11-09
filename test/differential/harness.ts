/**
 * The phase-3 differential harness: structural summaries of every caller-visible outcome, and
 * the runners that produce them, so a suite compares the `src` fast path with the `src` standard
 * path by `toStrictEqual` over plain data.
 *
 * A differential input carries one root per side in {@link Sides}: the `src` root, which takes
 * the structural fast path when it has a plan, and its {@link standardOf} copy, which runs the
 * compiled element codec that path falls back to. A suite runs the same surface over each root
 * and requires equal summaries, so the fast path matches the standard path on every compared
 * outcome.
 *
 * A summary reads public fields only, so sides compare as plain data rather than error instances.
 * Values compare by deep equality plus their own-key order at every depth
 * (`keys`), because `toStrictEqual` ignores key order and consumers snapshot `JSON.stringify`.
 * This module imports no test runner, so cases modules and child processes reuse it.
 */
import type * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import type * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import type * as Xml from "effect/encoding/Xml";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Stream from "effect/Stream";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import { structuralPlan } from "../../src/structural-slot.ts";

/**
 * One implementation under comparison: the functions a summary needs from that side's own entry
 * point.
 *
 * `Tokenizer` is that side's reference. Both sides use the same key, so a suite reads a side's
 * default with `yield* side.Tokenizer` and provides one only through {@link withTokenizer}, once
 * per side with that side's own value.
 */
export interface Side {
  readonly name: "src" | "standard";
  readonly decodeErrorOf: (issue: SchemaIssue.Issue) => Option.Option<SrcXml.DecodeError>;
  readonly encodeErrorOf: (issue: SchemaIssue.Issue) => Option.Option<SrcXml.EncodeError>;
  readonly Tokenizer: typeof SrcXml.Tokenizer;
}

/**
 * The `src` implementation, built from `src/index.ts`.
 */
export const src: Side = {
  Tokenizer: SrcXml.Tokenizer,
  decodeErrorOf: SrcXml.decodeErrorOf,
  encodeErrorOf: SrcXml.encodeErrorOf,
  name: "src",
};

/**
 * The `src` implementation's standard path, built from `src/index.ts` like {@link src}.
 *
 * Its functions are `src`'s own; the path a run takes is chosen by the root, so a suite pairs this
 * side with a root built by {@link standardOf}.
 */
export const standard: Side = {
  Tokenizer: SrcXml.Tokenizer,
  decodeErrorOf: SrcXml.decodeErrorOf,
  encodeErrorOf: SrcXml.encodeErrorOf,
  name: "standard",
};

/**
 * Force a `src` root onto the standard path: the root annotated with an empty `parseOptions`.
 *
 * `structuralPlan` treats a root carrying a `parseOptions` annotation, on the node or on its last
 * check, as opaque, so every surface built from the result runs the compiled element codec the
 * structural fast path falls back to. Effect has no runtime reader of the annotation, so `{}`
 * changes no parse behavior, and the result decodes and encodes as the standard path does.
 *
 * @param root - A `src` element codec, plain, checked, or a `suspend` reference.
 * @returns The root annotated, of the root's own `Rebuild` type.
 * @throws {Error} When the result still has a structural plan, so a suite cannot compare the fast
 *   path with itself.
 * @see {@link structuralPlan}
 */
export const standardOf = <S extends Schema.Top>(root: S): S["Rebuild"] => {
  const annotated = root.annotate({ parseOptions: {} });
  const plan = structuralPlan(annotated);

  if (plan !== undefined) {
    throw new Error(
      `standardOf(${plan.name}) is still structural; annotate the root itself, not a schema built around it`,
    );
  }

  return annotated;
};

/**
 * A pair of per-side values: the `src` one, run on the fast path, and its standard-path copy,
 * built by {@link standardOf}, never mixed.
 */
export interface Sides<Src, Standard = Src> {
  readonly src: Src;
  readonly standard: Standard;
}

/**
 * The options a differential input runs under: the parser limits, the record budgets, positions
 * for channels, and the encode declaration choice.
 */
export type InputOptions = SrcXml.DecodeStreamOptions & SrcXml.EncodeOptions;

/**
 * One text input a differential suite compares, exported by its `<suite>.cases.ts` module.
 *
 * `roots` holds the `src` record or root definition and its {@link standardOf} copy. `path` is the
 * record path of a channel run and `pieces` the offsets the text is split at before it is
 * streamed.
 */
export interface DocumentInput<Src = unknown, Standard = Src> {
  readonly id: string;
  readonly text: string;
  readonly roots: Sides<Src, Standard>;
  readonly options?: InputOptions;
  readonly parseOptions?: SchemaAST.ParseOptions;
  readonly path?: readonly string[];
  readonly pieces?: readonly number[];
}

/**
 * One value input a differential suite encodes, exported by its `<suite>.cases.ts` module: a
 * generated value, a hand-built sample, or a corruption.
 *
 * The value is plain data, so the same value serves both sides. `intended` names the encode
 * reason a corruption is built to provoke. Its absence does not mean the value must encode, so a
 * suite's own input type marks a corruption with a `corruption` field, as `GeneratedEncodeInput`
 * in `generated.cases.ts` does.
 */
export interface EncodeInput<Value = unknown, Src = unknown, Standard = Src> {
  readonly id: string;
  readonly value: Value;
  readonly roots: Sides<Src, Standard>;
  readonly options?: InputOptions;
  readonly parseOptions?: SchemaAST.ParseOptions;
  readonly intended?: SrcXml.EncodeErrorReason["_tag"];
}

/**
 * A decoded value with its own-key order, the definition of "same value" every comparison uses.
 */
export interface ValueSummary {
  readonly value: unknown;
  readonly keys: string;
}

/**
 * A defect's name and message, standing in for a run that neither succeeded nor failed.
 */
export interface DefectSummary {
  readonly defect: string;
}

/**
 * The outer `Schema.SchemaError` a plain Schema caller sees: its message and issue tree.
 */
export interface SchemaSummary {
  readonly message: string;
  readonly tree: string;
}

/**
 * The strict summary of a `Schema.SchemaError` a reason carries: its issue tree, each Standard
 * Schema leaf's path and message, and the leaf count.
 */
export interface CauseSummary {
  readonly tree: string;
  readonly leaves: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
  readonly count: number;
}

/**
 * The summary of an upstream `Xml.XmlError` a reason carries, with an absent position field as
 * `"none"`.
 */
export interface XmlCauseSummary {
  readonly kind: Xml.XmlError["kind"];
  readonly message: string;
  readonly line: number | "none";
  readonly column: number | "none";
}

/**
 * One element-path step as plain data.
 */
interface StepSummary {
  readonly index: number;
  readonly local: string;
}

/**
 * The summary of an `XmlDecodeError` reason: its `_tag` and every public field of its class.
 */
export type DecodeReasonSummary =
  | {
      readonly _tag: "SchemaFailure";
      readonly elementPath: readonly StepSummary[];
      readonly cause: CauseSummary;
    }
  | {
      readonly _tag: "UndeclaredPrefix";
      readonly prefix: string;
      readonly where: string;
      readonly elementPath: readonly StepSummary[];
    }
  | {
      readonly _tag: "Limit";
      readonly limit: string;
      readonly max: number;
      readonly element: string;
      readonly measured: number | "none";
    }
  | {
      readonly _tag: "WellFormedness";
      readonly elementPath: readonly StepSummary[] | "none";
      readonly cause: XmlCauseSummary;
    }
  | { readonly _tag: "Unsupported"; readonly cause: XmlCauseSummary };

/**
 * The summary of an `XmlDecodeError`: every public field, with absent optional keys as `"none"`.
 */
export interface DecodeErrorSummary {
  readonly _tag: string;
  readonly message: string;
  readonly path: string;
  readonly position: { readonly line: number; readonly column: number } | "none";
  readonly record: number | "none";
  readonly reason: DecodeReasonSummary;
}

/**
 * The summary of an `XmlEncodeError` reason: its `_tag` and every public field of its class.
 */
export type EncodeReasonSummary =
  | { readonly _tag: "EncodeSchemaFailure"; readonly cause: CauseSummary }
  | { readonly _tag: "UnmappedNamespace"; readonly namespace: string; readonly what: string }
  | { readonly _tag: "InvalidEvent"; readonly cause: XmlCauseSummary };

/**
 * The summary of an `XmlEncodeError`: every public field.
 */
export interface EncodeErrorSummary {
  readonly _tag: string;
  readonly message: string;
  readonly path: string;
  readonly reason: EncodeReasonSummary;
}

/**
 * The failure of a whole-document run: the outer Schema error, and the library error stored in
 * its issue summarized, or `"none"` when the failure never reached the XML layer.
 */
export interface DocumentFailure<X> {
  readonly schema: SchemaSummary;
  readonly xml: X | "none";
}

/**
 * The outcome of {@link documentDecode}.
 */
export type DecodeOutcome = ValueSummary | DocumentFailure<DecodeErrorSummary> | DefectSummary;

/**
 * The outcome of {@link documentEncode}: the encoded text compared byte for byte, a failure, or a
 * defect.
 */
export type EncodeOutcome =
  | { readonly text: string }
  | DocumentFailure<EncodeErrorSummary>
  | DefectSummary;

/**
 * The outcome of {@link directOutcome}: a value, a Schema failure, or a defect.
 */
export type DirectOutcome = ValueSummary | SchemaSummary | DefectSummary;

/**
 * The outcome of {@link channelDecode}: the records emitted before the end, then how it ended.
 */
export interface ChannelOutcome {
  readonly records: readonly ValueSummary[];
  readonly end: "done" | DecodeErrorSummary | DefectSummary;
}

/**
 * Write the own-key order of a value at every depth, so two values `toStrictEqual` accepts still
 * differ when any object lists its keys in another order.
 *
 * Arrays keep their element order, objects list `Reflect.ownKeys` in order with each key's value,
 * and every other value is `_`.
 *
 * @param value - The value to describe.
 * @returns The key order as one line of text.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the harness describes any value either side decodes; inspecting its shape is the purpose.
export const keyOrderOf = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(keyOrderOf).join(",")}]`;
  }

  if (Predicate.isObject(value)) {
    const entries = Reflect.ownKeys(value).map(
      (key) =>
        `${Predicate.isString(key) ? JSON.stringify(key) : String(key)}:${keyOrderOf(value[key])}`,
    );

    return `{${entries.join(",")}}`;
  }

  return "_";
};

/**
 * Summarize a value by itself and its own-key order.
 *
 * @param value - The decoded value.
 * @returns The value and its key order.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a decoded value of either side, compared as opaque data.
export const valueSummary = (value: unknown): ValueSummary => ({
  keys: keyOrderOf(value),
  value,
});

/**
 * Write an issue tree on one line: each node's `_tag`, the `_tag` of its AST when it has one, a
 * `Pointer`'s path, and its children.
 *
 * @param issue - The root issue.
 * @returns The tree as text.
 */
export const treeOf = (issue: SchemaIssue.Issue): string => {
  const ast = "ast" in issue ? `<${issue.ast._tag}>` : "";

  if (issue._tag === "Pointer") {
    return `Pointer[${issue.path.map(String).join(",")}](${treeOf(issue.issue)})`;
  }

  if (issue._tag === "Composite" || issue._tag === "AnyOf") {
    return `${issue._tag}${ast}(${issue.issues.map(treeOf).join(";")})`;
  }

  if (issue._tag === "Encoding" || issue._tag === "Filter") {
    return `${issue._tag}${ast}(${treeOf(issue.issue)})`;
  }

  return `${issue._tag}${ast}`;
};

/**
 * Summarize a `Schema.SchemaError` a reason carries: its tree and its Standard Schema leaves.
 *
 * @param error - The Schema error.
 * @returns The tree, each leaf's path and message, and the leaf count.
 */
export const causeOf = (error: Schema.SchemaError): CauseSummary => {
  const leaves = SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues.map(
    ({ message, path }) => ({
      message,
      path: (path ?? []).map((segment) =>
        Predicate.isPropertyKey(segment) ? segment : segment.key,
      ),
    }),
  );

  return { count: leaves.length, leaves, tree: treeOf(error.issue) };
};

/**
 * Summarize an upstream `Xml.XmlError` by its public fields.
 *
 * @param error - The XML error.
 * @returns The kind, message, line, and column, an absent position field as `"none"`.
 */
export const xmlCauseOf = (error: Xml.XmlError): XmlCauseSummary => ({
  column: error.column ?? "none",
  kind: error.kind,
  line: error.line ?? "none",
  message: error.message,
});

/**
 * Copy an element path into plain steps.
 *
 * @param elementPath - The path a reason carries.
 * @returns The steps as plain data.
 */
const stepsOf = (elementPath: SrcXml.ElementPath): readonly StepSummary[] =>
  elementPath.map(({ index, local }) => ({ index, local }));

/**
 * Summarize an `XmlDecodeError` reason by every public field of its class.
 *
 * @param reason - The reason.
 * @returns The reason's summary.
 * @throws {Error} When the reason's `_tag` has no summary, so a new reason cannot pass
 *   unsummarized.
 */
const decodeReasonOf = (reason: SrcXml.DecodeErrorReason): DecodeReasonSummary => {
  const tag: string = reason._tag;

  switch (reason._tag) {
    case "SchemaFailure": {
      return {
        _tag: reason._tag,
        cause: causeOf(reason.cause),
        elementPath: stepsOf(reason.elementPath),
      };
    }

    case "UndeclaredPrefix": {
      return {
        _tag: reason._tag,
        elementPath: stepsOf(reason.elementPath),
        prefix: reason.prefix,
        where: reason.where,
      };
    }

    case "Limit": {
      return {
        _tag: reason._tag,
        element: reason.element ?? "none",
        limit: reason.limit,
        max: reason.max,
        measured: reason.measured ?? "none",
      };
    }

    case "WellFormedness": {
      return {
        _tag: reason._tag,
        cause: xmlCauseOf(reason.cause),
        elementPath: reason.elementPath === undefined ? "none" : stepsOf(reason.elementPath),
      };
    }

    case "Unsupported": {
      return { _tag: reason._tag, cause: xmlCauseOf(reason.cause) };
    }

    default: {
      throw new Error(`decode reason ${tag} has no harness summary; add its public fields`);
    }
  }
};

/**
 * Summarize an `XmlDecodeError` by every public field, its reason included.
 *
 * @param error - The decode error of either side.
 * @returns The error's summary.
 * @throws {Error} When the reason's `_tag` has no summary.
 */
export const decodeErrorSummary = (error: SrcXml.DecodeError): DecodeErrorSummary => ({
  _tag: error._tag,
  message: error.message,
  path: error.path,
  position:
    error.position === undefined
      ? "none"
      : { column: error.position.column, line: error.position.line },
  reason: decodeReasonOf(error.reason),
  record: error.record ?? "none",
});

/**
 * Summarize an `XmlEncodeError` reason by every public field of its class.
 *
 * @param reason - The reason.
 * @returns The reason's summary.
 * @throws {Error} When the reason's `_tag` has no summary, so a new reason cannot pass
 *   unsummarized.
 */
const encodeReasonOf = (reason: SrcXml.EncodeErrorReason): EncodeReasonSummary => {
  const tag: string = reason._tag;

  switch (reason._tag) {
    case "EncodeSchemaFailure": {
      return { _tag: reason._tag, cause: causeOf(reason.cause) };
    }

    case "UnmappedNamespace": {
      return { _tag: reason._tag, namespace: reason.namespace, what: reason.what };
    }

    case "InvalidEvent": {
      return { _tag: reason._tag, cause: xmlCauseOf(reason.cause) };
    }

    default: {
      throw new Error(`encode reason ${tag} has no harness summary; add its public fields`);
    }
  }
};

/**
 * Summarize an `XmlEncodeError` by every public field, its reason included.
 *
 * @param error - The encode error of either side.
 * @returns The error's summary.
 * @throws {Error} When the reason's `_tag` has no summary.
 */
export const encodeErrorSummary = (error: SrcXml.EncodeError): EncodeErrorSummary => ({
  _tag: error._tag,
  message: error.message,
  path: error.path,
  reason: encodeReasonOf(error.reason),
});

/**
 * Describe the defect, or the interruption, of a cause that holds no failure.
 *
 * @param cause - The cause.
 * @returns The defect's name and message, or its text when it is not an `Error`.
 */
const defectOf = (cause: Cause.Cause<unknown>): DefectSummary => {
  const squashed = Cause.squash(cause);

  return {
    defect: Predicate.isError(squashed)
      ? `${squashed.name}: ${squashed.message}`
      : String(squashed),
  };
};

/**
 * Summarize a direct Schema run of an element codec.
 *
 * @param exit - The run's exit.
 * @returns The value with its key order, the failure's message and tree, or the defect.
 */
export const directOutcome = (exit: Exit.Exit<unknown, Schema.SchemaError>): DirectOutcome => {
  if (Exit.isSuccess(exit)) {
    return valueSummary(exit.value);
  }

  return Option.match(Cause.findErrorOption(exit.cause), {
    onNone: () => defectOf(exit.cause),
    onSome: (error) => ({ message: error.message, tree: treeOf(error.issue) }),
  });
};

/**
 * Summarize a whole-document run whose failure is the outer `Schema.SchemaError`.
 *
 * @param exit - The run's exit.
 * @param onSuccess - Summarizes the success value.
 * @param xmlOf - Reads and summarizes the library error stored in the failure's issue.
 * @returns The success summary, the failure, or the defect.
 */
const documentOutcome = <A, S, X>(
  exit: Exit.Exit<A, Schema.SchemaError>,
  onSuccess: (value: A) => S,
  xmlOf: (issue: SchemaIssue.Issue) => Option.Option<X>,
): S | DocumentFailure<X> | DefectSummary => {
  if (Exit.isSuccess(exit)) {
    return onSuccess(exit.value);
  }

  return Option.match(Cause.findErrorOption(exit.cause), {
    onNone: () => defectOf(exit.cause),
    onSome: (error): DocumentFailure<X> => ({
      schema: { message: error.message, tree: treeOf(error.issue) },
      xml: Option.match(xmlOf(error.issue), { onNone: () => "none", onSome: (xml) => xml }),
    }),
  });
};

/**
 * Decode a document's text with one side's whole-document codec and summarize the outcome.
 *
 * The run never fails: a failure becomes the outer Schema error with the stored decode error
 * summarized, and a defect becomes its description. A reason with no summary is a defect of the
 * returned effect, so the comparing test fails naming it.
 *
 * @param side - The side that built `codec`.
 * @param codec - A codec from XML text, such as that side's `fromString(root)`.
 * @param text - The document text.
 * @param parseOptions - The Schema parse options of the run.
 * @returns The outcome summary.
 */
export const documentDecode = <T, RD, RE>(
  side: Side,
  codec: Schema.Codec<T, string, RD, RE>,
  text: string,
  parseOptions?: SchemaAST.ParseOptions,
): Effect.Effect<DecodeOutcome, never, RD> =>
  Effect.exit(Schema.decodeUnknownEffect(codec)(text, parseOptions)).pipe(
    Effect.map((exit) =>
      documentOutcome(exit, valueSummary, (issue) =>
        side.decodeErrorOf(issue).pipe(Option.map(decodeErrorSummary)),
      ),
    ),
  );

/**
 * Encode a value with one side's whole-document codec and summarize the outcome.
 *
 * The value is plain data checked by the codec, so one value serves both sides. The run never
 * fails, as {@link documentDecode} describes; the encoded text compares byte for byte.
 *
 * @param side - The side that built `codec`.
 * @param codec - A codec from XML text, such as that side's `fromString(root)`.
 * @param value - The value to encode.
 * @param parseOptions - The Schema parse options of the run.
 * @returns The outcome summary.
 */
export const documentEncode = <T, RD, RE>(
  side: Side,
  codec: Schema.Codec<T, string, RD, RE>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- plain data, possibly a deliberate corruption; the codec's own encode is the parser under test.
  value: unknown,
  parseOptions?: SchemaAST.ParseOptions,
): Effect.Effect<EncodeOutcome, never, RE> =>
  Effect.exit(Schema.encodeUnknownEffect(codec)(value, parseOptions)).pipe(
    Effect.map((exit) =>
      documentOutcome(
        exit,
        (text) => ({ text }),
        (issue) => side.encodeErrorOf(issue).pipe(Option.map(encodeErrorSummary)),
      ),
    ),
  );

/**
 * The outcome of {@link stringEncode}: the encoded text, the library error summarized, or a
 * defect.
 */
export type StringEncodeOutcome = { readonly text: string } | EncodeErrorSummary | DefectSummary;

/**
 * Encode a value with one side's `encodeString` and summarize the outcome.
 *
 * The run never fails: a library error becomes its summary and a defect its description.
 *
 * @param encode - One side's encoder, such as `encodeString(root, options)`.
 * @param value - The value to encode, plain data the encoder checks.
 * @param parseOptions - The Schema parse options of the run.
 * @returns The outcome summary.
 */
export const stringEncode = <A, R>(
  encode: (
    value: A,
    parseOptions?: SchemaAST.ParseOptions,
  ) => Effect.Effect<string, SrcXml.EncodeError, R>,
  value: A,
  parseOptions?: SchemaAST.ParseOptions,
): Effect.Effect<StringEncodeOutcome, never, R> =>
  Effect.exit(encode(value, parseOptions)).pipe(
    Effect.map((exit) => {
      if (Exit.isSuccess(exit)) {
        return { text: exit.value };
      }

      return Option.match(Cause.findErrorOption(exit.cause), {
        onNone: () => defectOf(exit.cause),
        onSome: encodeErrorSummary,
      });
    }),
  );

/**
 * One step of a channel run as {@link channelDecode} collects it.
 */
type ChannelStep =
  | { readonly _tag: "Record"; readonly record: ValueSummary }
  | { readonly _tag: "End"; readonly end: DecodeErrorSummary | DefectSummary };

/**
 * Run a record channel over a source and summarize every record and how the run ended.
 *
 * Records emitted before a failure are kept, so they are compared too. The run never fails: its
 * end is `"done"`, the decode error summarized, or a defect's description.
 *
 * @param channel - One side's channel factory, such as `decodeSchemaString(def, path)`.
 * @param source - The text or byte chunks.
 * @param options - The decode options passed to the factory.
 * @param parseOptions - The Schema parse options passed to the factory.
 * @returns The records and the end.
 */
export const channelDecode = <A, In, R>(
  channel: (
    options?: SrcXml.DecodeStreamOptions,
    parseOptions?: SchemaAST.ParseOptions,
  ) => Channel.Channel<
    Arr.NonEmptyReadonlyArray<A>,
    SrcXml.DecodeError,
    unknown,
    Arr.NonEmptyReadonlyArray<In>,
    never,
    unknown,
    R
  >,
  source: Stream.Stream<In>,
  options?: SrcXml.DecodeStreamOptions,
  parseOptions?: SchemaAST.ParseOptions,
): Effect.Effect<ChannelOutcome, never, R> =>
  source.pipe(
    Stream.pipeThroughChannel(channel(options, parseOptions)),
    Stream.map((value): ChannelStep => ({ _tag: "Record", record: valueSummary(value) })),
    Stream.catchCause((cause) =>
      Stream.succeed<ChannelStep>({
        _tag: "End",
        end: Option.match(Cause.findErrorOption(cause), {
          onNone: () => defectOf(cause),
          onSome: decodeErrorSummary,
        }),
      }),
    ),
    Stream.runCollect,
    Effect.map((steps) => ({
      end: steps.flatMap((step) => (step._tag === "End" ? [step.end] : [])).at(0) ?? "done",
      records: steps.flatMap((step) => (step._tag === "Record" ? [step.record] : [])),
    })),
  );

/**
 * Provide a tokenizer to one side's effect only.
 *
 * Both sides read the same `Tokenizer` key, so a suite calls this once per side with that side's
 * own value and never provides a tokenizer around both.
 *
 * @param side - The side whose effect runs.
 * @param effect - That side's effect.
 * @param tokenizer - The tokenizer it reads.
 * @returns The effect with the tokenizer provided.
 */
export const withTokenizer = <A, E, R>(
  side: Side,
  effect: Effect.Effect<A, E, R>,
  tokenizer: SrcXml.Tokenizer,
): Effect.Effect<A, E, R> => Effect.provideService(effect, side.Tokenizer, tokenizer);
