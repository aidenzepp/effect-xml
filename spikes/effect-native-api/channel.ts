// Library half of the Q3 spike (the runs are in q3-channel.ts): streaming decode as Channels, split
// by input kind at the type level, the shape of Ndjson.decodeSchema / Csv.decodeSchema
// (node_modules/effect/src/encoding/Ndjson.ts:439). Built only from existing channels:
// Xml.decode / Xml.decodeString / decodeStringWithPositions -> resolveEvents -> collect, then one
// per-record schema decode. No Stream.peel and no mixed-chunk defect: the input kind is the type.
import type * as Arr from "effect/Array";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Xml from "effect/encoding/Xml";

import type { ElementCodec, LimitOptions, ResolvedElement } from "../../src/index.ts";
import { WellFormedness, type XmlDecodeError } from "../../src/index.ts";
import { decodeError, toDecodeError, wellFormednessParts, withPosition } from "../../src/issue.ts";
import { type Plan, planOf } from "../../src/plan.ts";
import { decodeStringWithPositions, positionAt } from "../../src/positions.ts";
import { collect, recordPositions, resolveEvents } from "../../src/resolve.ts";

export interface ChannelOptions extends LimitOptions {
  readonly maxDepth?: number | undefined;
  readonly maxTokenSize?: number | undefined;
}

/**
 * Same mapping as the private `wellFormedness` + `withUpstreamPosition` in src/codec.ts.
 */
const fromXmlError = (cause: Xml.XmlError): XmlDecodeError => {
  const error = decodeError({
    parts: wellFormednessParts(cause),
    path: "/",
    reason: new WellFormedness({ cause }),
  });
  return Predicate.isNumber(cause.line) && Predicate.isNumber(cause.column)
    ? withPosition(error, { column: cause.column, line: cause.line })
    : error;
};

/**
 * Same as the private `attachStreamPosition` in src/codec.ts.
 */
const positioned = (element: ResolvedElement, error: XmlDecodeError): XmlDecodeError => {
  const { reason } = error;
  if (reason._tag !== "Schema") return error;
  return Option.match(
    Option.flatMap(recordPositions(element), (tree) => positionAt(tree, reason.elementPath)),
    { onNone: () => error, onSome: (position) => withPosition(error, position) },
  );
};

/**
 * Events -> resolved records -> typed records, one decode per record, ordinal counted per run.
 */
const records = <Def extends ElementCodec<string, unknown>, In, IE, Done>(
  def: Def,
  path: readonly string[],
  options: ChannelOptions | undefined,
  parser: Channel.Channel<
    | Arr.NonEmptyReadonlyArray<Xml.Event>
    | Arr.NonEmptyReadonlyArray<import("../../src/positions.ts").PositionedEvent>,
    Xml.XmlError | IE,
    Done,
    Arr.NonEmptyReadonlyArray<In>,
    IE,
    Done
  >,
): Channel.Channel<
  Arr.NonEmptyReadonlyArray<Def["Type"]>,
  XmlDecodeError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<In>,
  IE,
  Done
> => {
  // Construction checks are eager, as upstream Xml.elements does (hater A item 15).
  if (path.length === 0) throw new Error("decodeSchema: the record path must not be empty");
  const plan: Plan | undefined = planOf(def);
  if (plan === undefined) throw new Error("decodeSchema: the codec has no element marker");
  return Channel.suspend(() => {
    let ordinal = 0;
    return parser.pipe(
      Channel.mapError((e): XmlDecodeError | IE =>
        Xml.isXmlError(e) ? fromXmlError(e) : (e as IE),
      ),
      Channel.pipeTo(resolveEvents<XmlDecodeError | IE, Done>()),
      Channel.pipeTo(
        collect<XmlDecodeError | IE, Done>(path, {
          maxElementNodes: options?.maxElementNodes,
          maxElementSize: options?.maxElementSize,
        }),
      ),
      // Per record, not per chunk: records decoded before a failure are emitted before it, as
      // today's Stream decode does. Upstream ChannelSchema.decode (ChannelSchema.ts:116) decodes a
      // whole chunk with NonEmptyArray(schema), so a failure there drops the chunk's earlier records.
      Channel.flattenArray,
      Channel.mapEffect((element: ResolvedElement) => {
        ordinal += 1;
        const record = ordinal;
        return Schema.decodeUnknownEffect(def)(element).pipe(
          Effect.mapError((failure) =>
            positioned(element, toDecodeError(plan, element, failure, record)),
          ),
          Effect.map((value): Arr.NonEmptyReadonlyArray<Def["Type"]> => [value]),
        );
      }),
    );
  });
};

/**
 * Bytes in. Keeps Xml.decode's byte-encoding rule; no positions (see RESULT.md).
 */
export const decodeSchema =
  <Def extends ElementCodec<string, unknown>>(def: Def, path: readonly string[]) =>
  <IE = never, Done = unknown>(options?: ChannelOptions) =>
    records(
      def,
      path,
      options,
      Xml.decode<IE, Done>({ maxDepth: options?.maxDepth, maxTokenSize: options?.maxTokenSize }),
    );

/**
 * Text in. `positions: true` swaps in decodeStringWithPositions, still a plain channel.
 */
export const decodeSchemaString =
  <Def extends ElementCodec<string, unknown>>(def: Def, path: readonly string[]) =>
  <IE = never, Done = unknown>(
    options?: ChannelOptions & { readonly positions?: boolean | undefined },
  ) => {
    const parserOptions = { maxDepth: options?.maxDepth, maxTokenSize: options?.maxTokenSize };
    return records(
      def,
      path,
      options,
      options?.positions === true
        ? decodeStringWithPositions<IE, Done>(parserOptions)
        : Xml.decodeString<IE, Done>(parserOptions),
    );
  };
