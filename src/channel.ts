import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as Pull from "effect/Pull";
import * as Xml from "effect/encoding/Xml";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";

import type { DecodeStreamOptions, LimitOptions } from "./codec.ts";
import type { ResolvedElement } from "./element.ts";
import { attemptDecode } from "./fast-decode.ts";
import { parserError, toDecodeError, withPosition } from "./issue.ts";
import type { XmlDecodeError } from "./issue.ts";
import { planOf } from "./plan.ts";
import type { AnyElement, Plan } from "./plan.ts";
import { decodeStringWithPositions, nativePositions, positionAt } from "./positions.ts";
import type { PositionedEvent } from "./positions.ts";
import { checkRecordPath } from "./record-path.ts";
import {
  defaultMaxElementNodes,
  defaultMaxElementSize,
  forgetRecordPositions,
  recordPositions,
  resolveCollect,
} from "./resolve.ts";
import { structuralPlan } from "./structural-slot.ts";
import { Tokenizer } from "./tokenizer.ts";

/**
 * The event channel a run parses its input with, as a tokenizer or the positioned text parser
 * produces it.
 */
type Parser<In, IE, Done> = Channel.Channel<
  Arr.NonEmptyReadonlyArray<Xml.Event | PositionedEvent>,
  Xml.XmlError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<In>,
  IE,
  Done
>;

/**
 * The settings one channel factory fixes for every run it builds.
 */
interface RunSettings<Def extends AnyElement> {
  readonly def: Def;
  readonly plan: Plan;
  readonly path: readonly string[];
  readonly span: string;
}

/**
 * Read the plan of a record codec and reject a record path that cannot match, before any channel
 * exists.
 *
 * @param def - The element codec of one record.
 * @param path - The root-anchored record path.
 * @param caller - The public name of the factory, used in the missing-marker message.
 * @returns The record codec's plan.
 * @throws {Error} When `def` carries no element marker, or when `path` cannot match a record.
 */
const checkFactory = (def: AnyElement, path: readonly string[], caller: string): Plan => {
  const plan = planOf(def);

  if (plan === undefined) {
    throw new Error(
      `${caller} received a codec without an element marker; build the record codec with Element() or suspend()`,
    );
  }

  const rejected = checkRecordPath(path, plan.name);

  if (Option.isSome(rejected)) {
    throw new Error(rejected.value);
  }

  return plan;
};

/**
 * Read one per-record budget at channel construction, as `Xml.elements` reads its own.
 *
 * @param name - The budget's option name.
 * @param value - The caller's value, absent for the default.
 * @throws {Error} When the budget is present and not a positive number.
 */
const checkBudget = (name: string, value: number | undefined): void => {
  if (value !== undefined && !(value > 0)) {
    throw new Error(
      `${name} must be a positive number or Infinity, got ${value}; pass a positive budget or omit ${name} for the default`,
    );
  }
};

/**
 * Position a `SchemaFailure` of a positioned record at its element's start tag.
 *
 * A record collected from positioned events carries a position tree; `positionAt` finds the
 * failing element's start tag in it, and a failure on an attribute or text child reports the
 * enclosing element's start tag. A record collected from plain events has no tree, and every other
 * reason already carries the position it can have, so the error then passes unchanged.
 *
 * @param element - The record whose decode failed.
 * @param error - The decode error.
 * @returns The error with `position` set when its element is in the record's tree, otherwise
 *   `error` unchanged.
 */
const attachRecordPosition = (element: ResolvedElement, error: XmlDecodeError): XmlDecodeError => {
  const { reason } = error;

  if (reason._tag !== "SchemaFailure") {
    return error;
  }

  const located = Option.flatMap(recordPositions(element), (tree) =>
    positionAt(tree, reason.elementPath),
  );

  return Option.match(located, {
    onNone: () => error,
    onSome: (position) => withPosition(error, position),
  });
};

/**
 * Run one fatal UTF-8 decoder step, turning the decoder's `TypeError` on malformed bytes into a
 * typed parser failure.
 *
 * The failure is an `Xml.XmlError` of kind `Syntax` with no line or column, because the decoder
 * names no position, so the decode error it maps to carries neither a `position` nor a `record`.
 *
 * @param run - The decoder call: one chunk's bytes with `stream: true`, or the final flush.
 * @returns The decoded text, or the `Syntax` parser failure.
 */
const utf8 = <A>(run: () => A): Effect.Effect<A, Xml.XmlError> =>
  Effect.try({
    catch: () =>
      new Xml.XmlError({
        column: undefined,
        kind: "Syntax",
        line: undefined,
        message: "invalid UTF-8",
      }),
    try: run,
  });

// Native: Channel.decodeText accepts fatal TextDecoder options but decodes inside Effect.sync, so a malformed sequence is a defect instead of a typed failure.
/**
 * Decode UTF-8 byte chunks to text chunks through one fatal `TextDecoder` per run.
 *
 * Each chunk decodes with `stream: true` and the decoder's final flush is appended when it yields
 * text, so a multi-byte sequence split across chunks decodes whole and one left open at the end
 * fails. Malformed UTF-8 fails the run with the `Syntax` parser failure of `utf8`; it is never
 * replaced with U+FFFD.
 *
 * @returns A channel from byte chunks to text chunks.
 */
const decodeUtf8 = <IE, Done>(): Channel.Channel<
  Arr.NonEmptyReadonlyArray<string>,
  Xml.XmlError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<Uint8Array>,
  IE,
  Done
> =>
  Channel.fromTransform(
    (upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<Uint8Array>, IE, Done>, _scope) =>
      Effect.sync(() => {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let done: Pull.Pull<never, never, Done> | undefined;

        const step = Pull.matchEffect(upstream, {
          onDone: (value) => {
            done = Cause.done(value);

            return utf8(() => decoder.decode()).pipe(
              Effect.map((last) => (last.length > 0 ? Option.some(Arr.of(last)) : Option.none())),
            );
          },
          onFailure: Effect.failCause,
          onSuccess: (chunk) =>
            utf8(() =>
              pipe(
                chunk,
                Arr.map((bytes) => decoder.decode(bytes, { stream: true })),
              ),
            ).pipe(Effect.map(Option.some)),
        });

        const pull: Pull.Pull<
          Arr.NonEmptyReadonlyArray<string>,
          Xml.XmlError | IE,
          Done
        > = Effect.suspend(
          () =>
            done ??
            step.pipe(Effect.flatMap(Option.match({ onNone: () => pull, onSome: Effect.succeed }))),
        );

        return pull;
      }),
  );

/**
 * Report whether a declared encoding names UTF-8 or US-ASCII, the two encodings the byte tokenizer
 * accepts, compared case-insensitively.
 *
 * @param encoding - The `encoding` of an XML declaration.
 * @returns Whether a byte decode accepts the encoding.
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/encoding/Xml.ts `isUtf8`
 */
const isUtf8Encoding = (encoding: string): boolean => {
  const lower = encoding.toLowerCase();

  return lower === "utf-8" || lower === "us-ascii";
};

// Native: Xml.decodeString ignores the declared encoding, so positioned byte input lacks the byte tokenizer's encoding rule.
/**
 * Reject a byte document whose leading XML declaration names an encoding other than UTF-8 or
 * US-ASCII, as the byte tokenizer does.
 *
 * Positioned byte input is decoded as UTF-8 and parsed as text, and the text parser ignores the
 * declared encoding, so this check keeps the byte-mode rule. A declaration can only open a
 * document, so only the first event of the first chunk is checked. The failure is an
 * `Xml.XmlError` of kind `Unsupported` at the declaration's position.
 *
 * @param first - The first positioned event of the document.
 * @returns An effect that succeeds when the encoding is acceptable, or fails with the parser error.
 */
const checkByteEncoding = (first: PositionedEvent): Effect.Effect<void, Xml.XmlError> => {
  const { event, position } = first;

  if (event._tag !== "Declaration" || event.encoding === undefined) {
    return Effect.void;
  }

  return isUtf8Encoding(event.encoding)
    ? Effect.void
    : Effect.fail(
        new Xml.XmlError({
          column: position.column,
          kind: "Unsupported",
          line: position.line,
          message: `encoding ${event.encoding} is not supported for byte input, decode the bytes to text first`,
        }),
      );
};

/**
 * Parse UTF-8 byte chunks with start-tag positions: decode them through a fatal UTF-8 decoder,
 * parse the text with positions, and check the declared encoding on the first event.
 *
 * @param options - The tokenizer limits.
 * @returns A channel from byte chunks to positioned event chunks, failing with `Xml.XmlError`.
 */
const decodeBytesWithPositions = <IE, Done>(
  options: Xml.DecodeOptions,
): Channel.Channel<
  Arr.NonEmptyReadonlyArray<PositionedEvent>,
  Xml.XmlError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<Uint8Array>,
  IE,
  Done
> =>
  decodeUtf8<IE, Done>().pipe(
    Channel.pipeTo(decodeStringWithPositions<Xml.XmlError | IE, Done>(options)),
    Channel.mapEffect((chunk, index) =>
      index === 0
        ? Effect.as(checkByteEncoding(Arr.headNonEmpty(chunk)), chunk)
        : Effect.succeed(chunk),
    ),
  );

/**
 * Build the channel of one decode run: parse, resolve namespaces, collect the records at the path,
 * and decode each record with the codec, inside one span.
 *
 * Resolving and collecting run as one fused machine, {@link resolveCollect}, the same one document
 * decode runs, so stream and document decode share budgets, position trees, and failure order.
 *
 * The parser is read when the channel runs, so the provided {@link Tokenizer} decides it. Each
 * element of an input chunk reaches the parser on its own pull, because a tokenizer emits one
 * output chunk per input chunk: a record then leaves once the input that completes it is parsed,
 * not once the whole input chunk is. Records decode one at a time with a one-based ordinal counted
 * per run, so records decoded before a failure are emitted before it.
 *
 * Each record first runs {@link attemptDecode}; when it gives `None` the record decodes with
 * today's decode, whose value or error is the record's. The attempt is built once per channel and
 * reads the root's structural plan on the first record, so building the channel never forces a
 * recursive codec's `suspend` thunk; an opaque record codec makes no attempt. The span carries
 * the path, the budgets, and `xml.positions`, and on exit `xml.records` (records emitted),
 * `xml.records.fallback` (records whose attempt ran and fell back), and
 * `xml.records.fallback.accepted` (those whose fallback succeeded); an opaque codec's records
 * count in neither fallback attribute.
 *
 * @param settings - The codec, its plan, the record path, and the span name.
 * @param options - The per-record budgets.
 * @param positions - Whether the parser emits positioned events.
 * @param parseOptions - The schema parse options of each record's decode.
 * @param parser - The effect that reads the parser channel for this run.
 * @returns The decoding channel.
 */
const records = <Def extends AnyElement, In, IE, Done>(
  settings: RunSettings<Def>,
  options: LimitOptions | undefined,
  positions: boolean,
  parseOptions: SchemaAST.ParseOptions | undefined,
  parser: Effect.Effect<Parser<In, IE, Done>>,
): Channel.Channel<
  Arr.NonEmptyReadonlyArray<Def["Type"]>,
  XmlDecodeError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<In>,
  IE,
  Done,
  Def["DecodingServices"]
> => {
  const { def, path, plan, span } = settings;
  const decodeRecord = Schema.decodeUnknownEffect(def);
  const attempt = attemptDecode(def);
  let structural: boolean | undefined;

  /**
   * Read whether the record codec is one the attempt handles, once per channel and on the first
   * record, so a recursive definition's thunks are not forced when the channel is built.
   *
   * @returns `false` when the record codec is opaque, such as a `decodeTo` wrapper.
   */
  const attempted = (): boolean => {
    structural ??= structuralPlan(def) !== undefined;

    return structural;
  };

  /**
   * Decode one collected record with today's decode, mapping its failure to a positioned
   * decode error.
   *
   * @param element - The collected record.
   * @param index - The record's zero-based index in the run.
   * @returns The record's value, or its decode error.
   */
  const standard = (element: ResolvedElement, index: number) =>
    decodeRecord(element, parseOptions).pipe(
      Effect.mapError((failure) =>
        attachRecordPosition(element, toDecodeError(plan, element, failure, index + 1)),
      ),
    );

  return Channel.unwrap(
    Effect.gen(function* buildRun() {
      const events = yield* parser;
      let emitted = 0;
      let fallback = 0;
      let accepted = 0;

      /**
       * Decode one collected record through the attempt, falling back to {@link standard} and
       * counting the fallback and its success.
       *
       * @param element - The collected record.
       * @param index - The record's zero-based index in the run.
       * @returns The record's value, or the fallback's decode error.
       */
      const decodeOne = (
        element: ResolvedElement,
        index: number,
      ): Effect.Effect<Def["Type"], XmlDecodeError, Def["DecodingServices"]> =>
        attempted()
          ? attempt(element, parseOptions).pipe(
              Effect.flatMap(
                Option.match({
                  onNone: () => {
                    fallback += 1;

                    return standard(element, index).pipe(
                      Effect.map((value) => {
                        accepted += 1;

                        return value;
                      }),
                    );
                  },
                  onSome: Effect.succeed,
                }),
              ),
            )
          : standard(element, index);

      return Channel.identity<Arr.NonEmptyReadonlyArray<In>, IE, Done>().pipe(
        Channel.flattenArray,
        Channel.map((input) => Arr.of(input)),
        Channel.pipeTo(events),
        Channel.mapError((failure) => (Xml.isXmlError(failure) ? parserError(failure) : failure)),
        Channel.pipeTo(
          resolveCollect<XmlDecodeError | IE, Done>(path, {
            maxElementNodes: options?.maxElementNodes,
            maxElementSize: options?.maxElementSize,
          }),
        ),
        Channel.flattenArray,
        Channel.mapEffect((element: ResolvedElement, index) =>
          decodeOne(element, index).pipe(
            Effect.map((value): Arr.NonEmptyReadonlyArray<Def["Type"]> => {
              emitted = index + 1;

              if (positions) {
                forgetRecordPositions(element);
              }

              return [value];
            }),
          ),
        ),
        Channel.onExit(() =>
          Effect.annotateCurrentSpan({
            "xml.records": emitted,
            "xml.records.fallback": fallback,
            "xml.records.fallback.accepted": accepted,
          }),
        ),
      );
    }),
  ).pipe(
    Channel.withSpan(span, {
      attributes: {
        "xml.maxElementNodes": options?.maxElementNodes ?? defaultMaxElementNodes,
        "xml.maxElementSize": options?.maxElementSize ?? defaultMaxElementSize,
        "xml.path": `/${path.join("/")}`,
        "xml.positions": positions,
      },
    }),
  );
};

// Native: Channel composes the run and Ndjson.decodeSchema is the channel-factory shape followed here, but Xml.elements selects records by lexical names and drops the namespace scope, so it cannot select by Clark name.
/**
 * Build a channel from XML text chunks to the decoded value of every record at `path`, in
 * document order.
 *
 * `path` is root-anchored: one step per element from the document root, each a Clark name
 * (`{uri}local`, or `local` for no namespace) or `"*"`, ending with the record element's own Clark
 * name or `"*"`. The factory checks the codec and the path when it is called and throws an `Error`
 * for a codec without an element marker or a path that cannot match a record, such as an empty
 * path, a prefixed step like `q:item`, a step like `1item` whose local part is not an XML name,
 * or a last step naming another element. The returned
 * function throws when a budget is not a positive number.
 *
 * Every run reads the provided `Tokenizer` and parses with its text decoder, given `maxTokenSize`
 * and `maxDepth`. Each element of an input chunk is parsed on its own pull, so a record is emitted
 * once the input that completes it is parsed. Records decode one at a time with the record codec
 * and `parseOptions`, and records decoded before a failure are emitted before it. Every caller
 * failure is an `XmlDecodeError`: malformed input has reason `WellFormedness` at the parser's
 * position, an unbound prefix reason `UndeclaredPrefix`, a record over a budget or an input over a
 * tokenizer limit reason `Limit`, and a value the codec rejects reason `SchemaFailure` with
 * `record` its one-based ordinal. Under `errors: "all"` the error's `path`, `message`, and
 * `position` describe the first issue, and every issue stays in the reason's `cause`.
 *
 * With `positions: true` the text is parsed with start-tag positions, so a `SchemaFailure` carries
 * the `line` and `column` of its element's start tag. A tokenizer whose `positions` is `"native"`
 * is asked for those positions and its start-tag `line` and `column` are used as reported; any
 * other tokenizer's input is scanned for them. Text input is never encoding-checked: the XML
 * declaration's encoding is ignored.
 *
 * Each record first tries a faster path. When that path declines the record, or a leaf schema
 * rejects a value on it, the record decodes again the standard way, and that result, success or
 * failure, is the record's. A record the faster path declines for its shape runs no leaf code
 * before the standard decode. When a leaf rejects a value on the faster path, the leaf
 * transformations can run on both paths, and a leaf whose result varies between runs can fail
 * the first time and succeed the second; the second result is returned. A defect or an
 * interruption is not retried. A record codec wrapped with `decodeTo` or another transformation
 * always decodes the standard way.
 *
 * Each run is one `xml.decodeSchemaString` span carrying `xml.path`, `xml.positions`,
 * `xml.maxElementNodes`, `xml.maxElementSize`, and, on exit, `xml.records` (records emitted),
 * `xml.records.fallback` (records that decoded again the standard way), and
 * `xml.records.fallback.accepted` (those whose standard decode succeeded).
 *
 * @example
 *   text.pipe(Stream.pipeThroughChannel(decodeSchemaString(Item, ["bank", "{urn:qti}item"])()));
 *
 * @param def - The element codec of one record.
 * @param path - The root-anchored record path of Clark names or `"*"`.
 * @returns A function from the decode options and the schema parse options to the channel.
 * @throws {Error} When `def` has no element marker or `path` cannot match a record.
 */
export const decodeSchemaString = <Def extends AnyElement>(def: Def, path: readonly string[]) => {
  const plan = checkFactory(def, path, "decodeSchemaString");
  const settings = { def, path, plan, span: "xml.decodeSchemaString" };

  return <IE = never, Done = unknown>(
    options?: DecodeStreamOptions,
    parseOptions?: SchemaAST.ParseOptions,
  ): Channel.Channel<
    Arr.NonEmptyReadonlyArray<Def["Type"]>,
    XmlDecodeError | IE,
    Done,
    Arr.NonEmptyReadonlyArray<string>,
    IE,
    Done,
    Def["DecodingServices"]
  > => {
    checkBudget("maxElementNodes", options?.maxElementNodes);
    checkBudget("maxElementSize", options?.maxElementSize);

    const parserOptions = { maxDepth: options?.maxDepth, maxTokenSize: options?.maxTokenSize };
    const positions = options?.positions === true;

    const parser: Effect.Effect<Parser<string, IE, Done>> = Effect.gen(function* readTextParser() {
      const tokenizer = yield* Tokenizer;

      if (!positions) {
        return tokenizer.decodeString<IE, Done>(parserOptions);
      }

      return tokenizer.positions === "native"
        ? tokenizer
            .decodeString<IE, Done>({ ...parserOptions, positions: true })
            .pipe(Channel.pipeTo(nativePositions<Xml.XmlError | IE, Done>()))
        : decodeStringWithPositions<IE, Done>(parserOptions);
    });

    return records(settings, options, positions, parseOptions, parser);
  };
};

// Native: Channel composes the run and Ndjson.decodeSchema is the channel-factory shape followed here, but Xml.elements selects records by lexical names and drops the namespace scope, so it cannot select by Clark name.
/**
 * Build a channel from UTF-8 XML byte chunks to the decoded value of every record at `path`, in
 * document order.
 *
 * The path, the factory checks, the failures, and the record decode are those of
 * {@link decodeSchemaString}. Every run reads the provided `Tokenizer` and parses with its byte
 * decoder, given `maxTokenSize` and `maxDepth`. Each element of an input chunk is parsed on its own
 * pull, so a record is emitted once the input that completes it is parsed. A declaration naming an
 * encoding other than UTF-8 or US-ASCII fails with reason `Unsupported`.
 *
 * With `positions: true` a `SchemaFailure` carries the `line` and `column` of its element's start
 * tag. A tokenizer whose `positions` is `"native"` decodes the bytes itself, asked for those
 * positions, and its start-tag `line` and `column` are used as reported; its own rules then decide
 * the encoding and malformed bytes. Any other tokenizer's bytes are decoded as UTF-8 and scanned
 * for positions: an unsupported encoding fails at the declaration's position, and malformed UTF-8
 * fails with reason `WellFormedness` and no `position` or `record`, never replaced with U+FFFD.
 *
 * Each record first tries a faster path. When that path declines the record, or a leaf schema
 * rejects a value on it, the record decodes again the standard way, and that result, success or
 * failure, is the record's. A record the faster path declines for its shape runs no leaf code
 * before the standard decode. When a leaf rejects a value on the faster path, the leaf
 * transformations can run on both paths, and a leaf whose result varies between runs can fail
 * the first time and succeed the second; the second result is returned. A defect or an
 * interruption is not retried. A record codec wrapped with `decodeTo` or another transformation
 * always decodes the standard way.
 *
 * Each run is one `xml.decodeSchema` span with the attributes of {@link decodeSchemaString}.
 *
 * @param def - The element codec of one record.
 * @param path - The root-anchored record path of Clark names or `"*"`.
 * @returns A function from the decode options and the schema parse options to the channel.
 * @throws {Error} When `def` has no element marker or `path` cannot match a record.
 */
export const decodeSchema = <Def extends AnyElement>(def: Def, path: readonly string[]) => {
  const plan = checkFactory(def, path, "decodeSchema");
  const settings = { def, path, plan, span: "xml.decodeSchema" };

  return <IE = never, Done = unknown>(
    options?: DecodeStreamOptions,
    parseOptions?: SchemaAST.ParseOptions,
  ): Channel.Channel<
    Arr.NonEmptyReadonlyArray<Def["Type"]>,
    XmlDecodeError | IE,
    Done,
    Arr.NonEmptyReadonlyArray<Uint8Array>,
    IE,
    Done,
    Def["DecodingServices"]
  > => {
    checkBudget("maxElementNodes", options?.maxElementNodes);
    checkBudget("maxElementSize", options?.maxElementSize);

    const parserOptions = { maxDepth: options?.maxDepth, maxTokenSize: options?.maxTokenSize };

    const positions = options?.positions === true;

    const parser: Effect.Effect<Parser<Uint8Array, IE, Done>> = Effect.gen(
      function* readByteParser() {
        const tokenizer = yield* Tokenizer;

        if (!positions) {
          return tokenizer.decode<IE, Done>(parserOptions);
        }

        return tokenizer.positions === "native"
          ? tokenizer
              .decode<IE, Done>({ ...parserOptions, positions: true })
              .pipe(Channel.pipeTo(nativePositions<Xml.XmlError | IE, Done>()))
          : decodeBytesWithPositions<IE, Done>(parserOptions);
      },
    );

    return records(settings, options, positions, parseOptions, parser);
  };
};
