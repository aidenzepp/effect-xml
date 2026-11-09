import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Xml from "effect/encoding/Xml";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as Stream from "effect/Stream";

import {
  InvalidEvent,
  XmlEncodeError,
  formatMessage,
  parserError,
  toDecodeError,
  toEncodeError,
  withPosition,
} from "./issue.ts";
import type { XmlDecodeError } from "./issue.ts";
import { parseClark } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import { attemptDecode } from "./fast-decode.ts";
import { attemptEncode } from "./fast-encode.ts";
import { planOf } from "./plan.ts";
import { locate, nativePositions, positionAt } from "./positions.ts";
import type { ElementPath, Position, PositionedEvent } from "./positions.ts";
import type { AnyElement, PrefixMap } from "./plan.ts";
import { recordPositions, resolveCollect, toEvents } from "./resolve.ts";
import { structuralPlan } from "./structural-slot.ts";
import { Tokenizer } from "./tokenizer.ts";

/**
 * Attach the source position of a decode failure's element to the error.
 *
 * A `SchemaFailure` or `UndeclaredPrefix` reason, and a `WellFormedness` reason the resolver
 * synthesized for a namespace rule, carry the `elementPath` of the failing element; `lookup` finds
 * that element's start tag and `withPosition` re-renders the message with the position. A
 * failure on an attribute or text child reports the enclosing element's start tag. A record-budget
 * `Limit` reason names the record root, which in a one-document decode is the document root, so it
 * is looked up at that root's start tag. When `lookup` finds no start tag, the error stays
 * unpositioned. A parser failure (an upstream `WellFormedness` reason with no `elementPath`, an
 * `Unsupported` reason, or a tokenizer `Limit` with no `element`) is returned unchanged: upstream
 * rejected the text, so `parserError` already positioned it at the parser's own line and column,
 * and `lookup` never runs for it. `lookup` runs only on this failure path, so a successful decode
 * never pays for it.
 *
 * @param lookup - Finds the start-tag position of the element a positional path names.
 * @param error - The decode error.
 * @returns The error with `position` set when its element is found, otherwise `error` unchanged.
 */
const attachPosition = (
  lookup: (path: ElementPath) => Option.Option<Position>,
  error: XmlDecodeError,
): XmlDecodeError => {
  const { reason } = error;

  if (reason._tag === "Unsupported") {
    return error;
  }

  const elementPath =
    reason._tag === "Limit"
      ? Option.fromUndefinedOr(reason.element).pipe(
          Option.map((name) => [{ index: 0, local: parseClark(name).local }]),
        )
      : Option.fromUndefinedOr(reason.elementPath);

  const located = elementPath.pipe(Option.flatMap(lookup));

  return Option.match(located, {
    onNone: () => error,
    onSome: (position) => withPosition(error, position),
  });
};

/**
 * Build the start-tag lookup for a failure inside a decoded root: the root's position tree when
 * `collect` built one from native positions, otherwise a `locate` scan of the text.
 *
 * A tree lookup that finds no start tag leaves the failure unpositioned rather than scanning, so a
 * root read from native positions is never scanned.
 *
 * @param xml - The document text the root was read from.
 * @param root - The decoded root element.
 * @returns A function from a positional path to the start-tag position of its element.
 */
const rootLookup =
  (xml: string, root: ResolvedElement) =>
  (path: ElementPath): Option.Option<Position> =>
    Option.match(recordPositions(root), {
      onNone: () => locate(xml, path),
      onSome: (tree) => positionAt(tree, path),
    });

/**
 * The limits a decode enforces: the per-record budgets it checks while it collects a record, and
 * the two parser limits it forwards to the tokenizer.
 *
 * `maxElementSize` counts the UTF-16 code units of the as-written input one record spans: its
 * as-written element names, every as-written attribute key and value (`xmlns` declarations
 * included), and every text run, exactly as `Xml.elements` counts them; Clark expansion is never
 * counted. `maxElementNodes` counts element starts plus text runs in one record, a text run counted
 * when it opens a new text child. When absent, `maxElementSize` defaults to 16 MiB of UTF-16 code
 * units and `maxElementNodes` to one million per record; `Infinity` disables either, and a value
 * that is not a positive number is a defect. A record over a budget
 * fails with `DecodeError` reason `Limit`.
 *
 * `maxTokenSize` and `maxDepth` pass to the tokenizer as its decode options of the same name: the
 * longest token in UTF-16 code units and the deepest element nesting. Each takes the tokenizer's
 * default when absent, and an input over either fails with `DecodeError` reason `Limit` whose
 * `limit` names the option and whose `max` is its value, positioned at the parser's line and
 * column. They are declared here rather than inherited from `Xml.DecodeOptions`, so a field added
 * upstream does not appear in this signature without being forwarded.
 */
export interface LimitOptions {
  readonly maxElementSize?: number | undefined;
  readonly maxElementNodes?: number | undefined;
  readonly maxTokenSize?: number | undefined;
  readonly maxDepth?: number | undefined;
}

/**
 * The options of a streaming decode: the {@link LimitOptions} plus `positions`.
 *
 * `positions` asks the decode to track the source position of each event so a failure carries the
 * `line` and `column` of its element's start tag.
 */
export interface DecodeStreamOptions extends LimitOptions {
  readonly positions?: boolean | undefined;
}

/**
 * The options of a whole-document encode.
 *
 * `declaration` decides whether the text leads with the XML declaration; it defaults to `true`.
 */
export interface EncodeOptions {
  readonly declaration?: boolean | undefined;
}

/**
 * Read one XML document's text into its single resolved root element, the pipeline
 * `decodeString` and `decodeTree` share.
 *
 * The text runs through the current {@link Tokenizer}'s `decodeString` with the parser limits of
 * `options`, then `resolveCollect` over `["*"]` with the budgets of `options` as those of the one
 * record, the root: `resolveEvents` piped into `collect`, fused so no resolved event is allocated.
 * Reading the tokenizer adds nothing to the effect's requirements, because it is a
 * `Context.Reference` with a default. The tokenizer admits exactly one root element, so any other
 * count is a defect of that pipeline rather than a caller failure. Malformed text, and text over a
 * parser limit, fails with the parser's reason at `/`, already positioned at the parser's line and
 * column.
 *
 * A tokenizer whose `positions` is `"native"` decodes with `positions: true`, and
 * `nativePositions` carries its start-tag positions into `resolveCollect`, whose resolver
 * positions an `UndeclaredPrefix` failure and whose collector positions a `Limit` failure
 * at the root and records the root's position tree for `rootLookup`; the text is never
 * scanned. The resolver stamps a namespace-rule `WellFormedness` failure with its start tag's
 * position the same way it stamps `UndeclaredPrefix`. Any other tokenizer reads plain
 * events, and `attachPosition` positions the namespace-rule `WellFormedness`,
 * `UndeclaredPrefix`, and `Limit` failures with a `locate` scan of the text, once per
 * failure.
 *
 * @param xml - The document text.
 * @param options - The parser limits of the document and the budgets of its one record, the root.
 * @returns An effect yielding the root element.
 */
const readRoot = Effect.fnUntraced(function* readRoot(
  xml: string,
  options: LimitOptions | undefined,
): Effect.fn.Return<ResolvedElement, XmlDecodeError> {
  const tokenizer = yield* Tokenizer;
  const parserOptions = { maxDepth: options?.maxDepth, maxTokenSize: options?.maxTokenSize };
  const native = tokenizer.positions === "native";

  const events: Stream.Stream<Xml.Event | PositionedEvent, Xml.XmlError> = native
    ? Stream.make(xml).pipe(
        Stream.pipeThroughChannel(tokenizer.decodeString({ ...parserOptions, positions: true })),
        Stream.pipeThroughChannel(nativePositions()),
      )
    : Stream.make(xml).pipe(Stream.pipeThroughChannel(tokenizer.decodeString(parserOptions)));

  const roots = yield* events.pipe(
    Stream.pipeThroughChannel(
      resolveCollect(["*"], {
        maxElementNodes: options?.maxElementNodes,
        maxElementSize: options?.maxElementSize,
      }),
    ),
    Stream.runCollect,
    Effect.catchTag("XmlError", (error) => Effect.fail(parserError(error))),
    Effect.mapError((error) =>
      native ? error : attachPosition((path) => locate(xml, path), error),
    ),
  );

  const [element] = roots;

  if (element === undefined || roots.length !== 1) {
    return yield* Effect.die(
      `the document decode pipeline expected exactly one root element but collected ${roots.length}`,
    );
  }

  return element;
});

// Native: `Schema.toEncoderXml` only serializes and `Xml.elements` keeps names as written; neither decodes text into a typed value through resolved names.
/**
 * Build a decoder from one XML document's text to the value of its root element codec `def`.
 *
 * The text becomes its single resolved root through the pipeline `readRoot` runs, and the root
 * decodes with `def`. Every caller failure is an `XmlDecodeError`: malformed text has reason
 * `WellFormedness` at `/`, a namespace-rule violation has reason `WellFormedness` at the declaring
 * element, an unbound prefix has reason `UndeclaredPrefix`, and a value `def` rejects has reason
 * `SchemaFailure` at the XML path `toDecodeError` translates. Malformed text carries the
 * upstream parser's `position`; a namespace-rule, `UndeclaredPrefix`, or `SchemaFailure` reason
 * carries the `position` of its element's start tag when `attachPosition` finds it, read from
 * a native-position tokenizer's events or else scanned from `xml` (see `readRoot`).
 *
 * `options` reaches `collect` as the budgets of the one record, the root, so the whole
 * document is bounded by them: a document over a budget fails with reason `Limit` at the root's
 * path and `record` 1, positioned at the root's start tag. `Infinity` disables a budget for a
 * document the caller trusts. Its `maxDepth` and `maxTokenSize` reach the tokenizer, and a
 * document over either fails with reason `Limit` naming it, at the parser's line and column.
 *
 * The returned function takes `SchemaAST.ParseOptions` as its optional second argument and passes
 * them to the decode of `def`. Under `errors: "all"` the decode collects every issue `def` finds:
 * the error's `path`, `message`, and `position` describe the first issue, and every issue stays in
 * the reason's `cause`, the `Schema.SchemaError`. The effect requires the decoding services of
 * `def`.
 *
 * This decode first tries a faster path. When that path declines the document, or a leaf schema
 * rejects a value on it, the decode runs again the standard way and returns that result, success
 * or failure. A document the faster path declines for its shape runs no leaf code before the
 * standard decode. When a leaf rejects a value on the faster path, the leaf transformations can
 * run on both paths, and a leaf whose result varies between runs can fail the first time and
 * succeed the second; the second result is returned. A defect or an interruption is not retried.
 * A root wrapped with `decodeTo` or another transformation always decodes the standard way.
 * Only `decodeString`, `fromString`, `decodeSchema`, and `decodeSchemaString` take the faster
 * path; decoding an element codec directly with Schema, or inside your own Schema, runs the
 * standard way.
 *
 * Checks on the root and on child elements also run on the faster path. A check written with
 * `Schema.makeFilter` receives its value and parse options as usual, but its second argument, the
 * schema node, is an internal node there. Do not base a check's result on that node.
 *
 * Each call runs in one `xml.decodeString` span and, on success only, logs one debug entry
 * annotated with the root name; failures log nothing because the span and the typed error carry
 * them. The span's `xml.codec` attribute names the path the decode took: `"structural"` for the
 * faster path, `"fallback"` for an attempt followed by the standard decode, or `"element"` for a
 * root the faster path never attempts. On `"fallback"`, `xml.fallback` is `"success"` or
 * `"failure"`, the standard decode's outcome.
 *
 * @param def - The element codec of the document root.
 * @param options - The parser limits of the document and the budgets of its one record, the root.
 * @returns A function from XML text, and optional parse options, to an effect yielding the decoded
 *   value.
 */
export const decodeString = <Def extends AnyElement>(def: Def, options?: LimitOptions) => {
  const attempt = attemptDecode(def);
  let structural: boolean | undefined;

  /**
   * Read whether the root is one the faster path attempts, once per factory call and on the first
   * decode, so a recursive definition's thunks are not forced when the decoder is built.
   *
   * @returns `false` when the root is opaque, such as a `decodeTo` wrapper.
   */
  const attempted = (): boolean => {
    structural ??= structuralPlan(def) !== undefined;

    return structural;
  };

  return Effect.fn("xml.decodeString")(function* decode(
    xml: string,
    parseOptions?: SchemaAST.ParseOptions,
  ): Effect.fn.Return<Def["Type"], XmlDecodeError, Def["DecodingServices"]> {
    const element = yield* readRoot(xml, options);
    const plan = planOf(def);

    if (plan === undefined) {
      return yield* Effect.die("decodeString received a codec without an element marker");
    }

    // Effect's parser runs a synchronous schema the moment it is called and hands back the
    // finished result, so `suspend` keeps today's decode from running until the fallback needs it.
    const standard = Effect.suspend(() =>
      Schema.decodeUnknownEffect(def)(element, parseOptions),
    ).pipe(
      Effect.mapError((failure) =>
        attachPosition(rootLookup(xml, element), toDecodeError(plan, element, failure)),
      ),
    );

    const fallback = Effect.annotateCurrentSpan("xml.codec", "fallback").pipe(
      Effect.andThen(standard),
      Effect.tap(() => Effect.annotateCurrentSpan("xml.fallback", "success")),
      Effect.tapError(() => Effect.annotateCurrentSpan("xml.fallback", "failure")),
    );

    const value = yield* attempted()
      ? attempt(element, parseOptions).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => fallback,
              onSome: (fast) =>
                Effect.as(Effect.annotateCurrentSpan("xml.codec", "structural"), fast),
            }),
          ),
        )
      : Effect.andThen(Effect.annotateCurrentSpan("xml.codec", "element"), standard);

    yield* Effect.logDebug("decoded XML document").pipe(
      Effect.annotateLogs({ root: parseClark(plan.name).local }),
    );

    return value;
  });
};

// Native: `Xml.elements` keeps names as written and `Xml.decodeString` yields events; neither yields a tree of resolved Clark names.
/**
 * Build a decoder from one XML document's text to its root as a `ResolvedElement`, with no
 * codec applied.
 *
 * The text runs through the same pipeline as `decodeString` (`readRoot`), so a document
 * either decodes to the same tree `decodeString` would hand its codec or fails the same way. No
 * codec runs, so no failure has reason `SchemaFailure`: malformed text has reason `WellFormedness`
 * at `/` with the upstream parser's `position`, a namespace-rule violation has reason
 * `WellFormedness` at the declaring element, and an unbound prefix has reason `UndeclaredPrefix`,
 * each of the last two with the `position` of its element's start tag when `attachPosition`
 * finds it, read from a native-position tokenizer's events or else scanned from `xml`. A document
 * over a budget of `options` fails with reason `Limit` at the root's path and `record` 1,
 * positioned at the root's start tag, and a document over its `maxDepth` or `maxTokenSize` fails
 * with reason `Limit` naming it, at the parser's line and column. Use it with `canonicalize` to
 * check the round-trip promise against the input document.
 *
 * Each call runs in one `xml.decodeTree` span; it logs nothing, because the span and the typed
 * error carry the outcome.
 *
 * @param options - The parser limits of the document and the budgets of its one record, the root.
 * @returns A function from XML text to an effect yielding the root element.
 */
export const decodeTree = (options?: LimitOptions) =>
  Effect.fn("xml.decodeTree")(function* decode(
    xml: string,
  ): Effect.fn.Return<ResolvedElement, XmlDecodeError> {
    return yield* readRoot(xml, options);
  });

/**
 * Convert an upstream `Xml.XmlError` from writing events into an `XmlEncodeError` with
 * reason `InvalidEvent`.
 *
 * The upstream writer reports no element path, so the path is the document root `/`; its
 * `message` names the rejected event and stays readable in the caller message.
 *
 * @param error - The upstream write failure; it stays the reason's `cause`.
 * @returns The encode error.
 */
const invalidEvent = (error: Xml.XmlError): XmlEncodeError =>
  new XmlEncodeError({
    message: formatMessage({
      expectation: `the events do not form a well-formed document (${error.message})`,
      path: "/",
      repair: "change the value so every name and text it holds can be written as XML",
      what: "document",
    }),
    path: "/",
    reason: new InvalidEvent({ cause: error }),
  });

/**
 * Build a writer from a resolved element to one XML document's text, the tail every
 * whole-document encode shares.
 *
 * `toEvents` spells the element's Clark names with `prefixes`, and the current
 * {@link Tokenizer}'s `encodeString` writes the events, so every whole-document encode writes
 * through the same tokenizer its decode reads with. Reading the tokenizer adds nothing to the
 * effect's requirements, because it is a `Context.Reference` with a default. An attribute
 * namespace no prefix spells fails with reason `UnmappedNamespace`, and events the writer rejects
 * fail with reason `InvalidEvent` at `/`.
 *
 * @param prefixes - The prefix of each namespace the text spells, `""` for the default namespace.
 * @param options - Whether the text leads with the XML declaration.
 * @returns A function from a resolved element to an effect yielding the XML text.
 */
export const encodeTree = (prefixes: PrefixMap, options?: EncodeOptions) =>
  Effect.fnUntraced(function* encode(
    element: ResolvedElement,
  ): Effect.fn.Return<string, XmlEncodeError> {
    const tokenizer = yield* Tokenizer;

    const events = yield* toEvents(element, {
      declaration: options?.declaration ?? true,
      prefixes,
    });

    return yield* Stream.fromIterable(events).pipe(
      Stream.pipeThroughChannel(tokenizer.encodeString()),
      Stream.mkString,
      Effect.catchTag("XmlError", (error) => Effect.fail(invalidEvent(error))),
    );
  });

// Native: `Schema.toEncoderXml` uses its own element layout and `Xml.encodeString` writes names as given; neither encodes through an element codec with resolved names and prefix choice.
/**
 * Build an encoder from a value of the root element codec `def` to one XML document's text.
 *
 * The value encodes with `def` to a resolved element, and `encodeTree` writes it with the
 * prefixes of `def`'s namespaces map through the current {@link Tokenizer}. Every failure
 * is an `XmlEncodeError`: a value `def` rejects has reason `EncodeSchemaFailure` at the XML path
 * `toEncodeError` translates, an attribute namespace no prefix spells has reason
 * `UnmappedNamespace`, and events the writer rejects have reason `InvalidEvent`.
 *
 * The returned function takes `SchemaAST.ParseOptions` as its optional second argument and passes
 * them to the encode of `def`. The effect requires the encoding services of `def`.
 *
 * This encode first tries a faster path. When that path declines the value, a leaf schema rejects
 * it, or writing the XML fails, the encode runs again the standard way and returns that result,
 * success or failure. Only a value the faster path declines before encoding, an open-content item
 * the faster path cannot write, such as one named after a declared member, one with a non-string
 * attribute value, or one with a child that is neither text nor an element, runs no leaf code
 * before the standard encode. In every other fallback the leaf encodes that ran on the faster path
 * run again, and the tokenizer's `encodeString`, default or provided, can run twice for one call;
 * a leaf whose result varies between runs can fail the first time and succeed the second, and the
 * second result is returned. A defect or an interruption is not retried. A root wrapped with
 * `decodeTo` or another transformation always encodes the standard way. Only `encodeString` and
 * `fromString` take the faster path; encoding an element codec directly with Schema, or inside
 * your own Schema, runs the standard way.
 *
 * Checks on the root and on child elements also run on the faster path. A check written with
 * `Schema.makeFilter` receives its value and parse options as usual, but its second argument, the
 * schema node, is an internal node there. Do not base a check's result on that node.
 *
 * Each call runs in one `xml.encodeString` span. Its `xml.codec` attribute names the path the
 * encode took: `"structural"` for the faster path, `"fallback"` for an attempt followed by the
 * standard encode, or `"element"` for a root the faster path never attempts. On `"fallback"`,
 * `xml.fallback` is `"success"` or `"failure"`, the standard encode's outcome.
 *
 * @param def - The element codec of the document root.
 * @param options - Whether the text leads with the XML declaration.
 * @returns A function from a value, and optional parse options, to an effect yielding the XML text.
 */
export const encodeString = <Def extends AnyElement>(def: Def, options?: EncodeOptions) => {
  const attempt = attemptEncode(def, options);
  let structural: boolean | undefined;

  /**
   * Read whether the root is one the faster path attempts, once per factory call and on the first
   * encode, so a recursive definition's thunks are not forced when the encoder is built.
   *
   * @returns `false` when the root is opaque, such as a `decodeTo` wrapper.
   */
  const attempted = (): boolean => {
    structural ??= structuralPlan(def) !== undefined;

    return structural;
  };

  return Effect.fn("xml.encodeString")(function* encode(
    value: Def["Type"],
    parseOptions?: SchemaAST.ParseOptions,
  ): Effect.fn.Return<string, XmlEncodeError, Def["EncodingServices"]> {
    const plan = planOf(def);

    if (plan === undefined) {
      return yield* Effect.die("encodeString received a codec without an element marker");
    }

    // Effect's parser runs a synchronous schema the moment it is called and hands back the
    // finished result, so `suspend` keeps today's encode from running until the fallback needs it.
    const standard = Effect.suspend(() => Schema.encodeEffect(def)(value, parseOptions)).pipe(
      Effect.mapError((failure) => toEncodeError(plan, failure)),
      Effect.flatMap(encodeTree(plan.prefixes, options)),
    );

    const fallback = Effect.annotateCurrentSpan("xml.codec", "fallback").pipe(
      Effect.andThen(standard),
      Effect.tap(() => Effect.annotateCurrentSpan("xml.fallback", "success")),
      Effect.tapError(() => Effect.annotateCurrentSpan("xml.fallback", "failure")),
    );

    return yield* attempted()
      ? attempt(value, parseOptions).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => fallback,
              onSome: (text) =>
                Effect.as(Effect.annotateCurrentSpan("xml.codec", "structural"), text),
            }),
          ),
        )
      : Effect.andThen(Effect.annotateCurrentSpan("xml.codec", "element"), standard);
  });
};
