import type * as Arr from "effect/Array";
import type * as Channel from "effect/Channel";
import * as Context from "effect/Context";
import { Xml } from "effect/encoding";

/**
 * Decode options for a tokenizer: the upstream `Xml.DecodeOptions` limits plus a request for
 * start-tag positions.
 */
export interface TokenizerDecodeOptions extends Xml.DecodeOptions {
  /**
   * Ask a tokenizer whose `positions` is `"native"` to emit a `PositionedStartElement` for each
   * start tag. A tokenizer whose `positions` is `"none"` ignores it.
   */
  readonly positions?: boolean | undefined;
}

/**
 * A start-tag event carrying the position of its `<` in the input.
 *
 * `line` and `column` are 1-based and counted with the same rules as the `line` and `column` of an
 * `Xml.XmlError`. A tokenizer whose `positions` is `"native"` emits this event for every start tag
 * when decoding with `positions: true`.
 */
export interface PositionedStartElement extends Xml.StartElement {
  readonly line: number;
  readonly column: number;
}

/**
 * The XML event channels the library decodes and encodes through.
 *
 * Every decode and encode in the library reaches XML text through these four channels, so providing
 * a different `Tokenizer` swaps the parser and writer without changing any schema. The signatures
 * are those of `effect/encoding/Xml`. A replacement keeps the contract the library relies on:
 *
 * - Failures are `Xml.XmlError` values, with its `kind`s and its `line`/`column` rules.
 * - A `Limit` failure's message names the exceeded limit as `<limit> of <max>`, for example `maxDepth
 *   of 64`.
 * - A tokenizer whose `positions` is `"none"` emits exactly one output chunk for each input chunk;
 *   position tracking attributes events to input through that correspondence.
 *
 * `positions` declares whether the tokenizer reports start-tag positions itself; absent means
 * `"none"`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the interface and the reference share one name in TypeScript's separate type and value spaces, as `Clock` does in `effect/Clock`.
export interface Tokenizer {
  /**
   * Create a channel that decodes UTF-8 XML bytes into events.
   *
   * @param options - Upstream decode limits, plus the `positions` request.
   * @returns A channel from byte chunks to event chunks.
   */
  readonly decode: <IE = never, Done = unknown>(
    options?: TokenizerDecodeOptions,
  ) => Channel.Channel<
    Arr.NonEmptyReadonlyArray<Xml.Event>,
    Xml.XmlError | IE,
    Done,
    Arr.NonEmptyReadonlyArray<Uint8Array>,
    IE,
    Done
  >;
  /**
   * Create a channel that decodes XML text into events.
   *
   * @param options - Upstream decode limits, plus the `positions` request.
   * @returns A channel from text chunks to event chunks.
   */
  readonly decodeString: <IE = never, Done = unknown>(
    options?: TokenizerDecodeOptions,
  ) => Channel.Channel<
    Arr.NonEmptyReadonlyArray<Xml.Event>,
    Xml.XmlError | IE,
    Done,
    Arr.NonEmptyReadonlyArray<string>,
    IE,
    Done
  >;
  /**
   * Create a channel that writes events as UTF-8 XML bytes.
   *
   * @returns A channel from event chunks to byte chunks.
   */
  readonly encode: <IE = never, Done = unknown>() => Channel.Channel<
    Arr.NonEmptyReadonlyArray<Uint8Array>,
    Xml.XmlError | IE,
    Done,
    Arr.NonEmptyReadonlyArray<Xml.Event>,
    IE,
    Done
  >;
  /**
   * Create a channel that writes events as XML text.
   *
   * @returns A channel from event chunks to text chunks.
   */
  readonly encodeString: <IE = never, Done = unknown>() => Channel.Channel<
    Arr.NonEmptyReadonlyArray<string>,
    Xml.XmlError | IE,
    Done,
    Arr.NonEmptyReadonlyArray<Xml.Event>,
    IE,
    Done
  >;
  readonly positions?: "native" | "none";
}

/**
 * The tokenizer backed by `effect/encoding/Xml`, used whenever no other is provided.
 *
 * It reports no positions of its own (`positions: "none"`) and ignores a `positions` request.
 */
export const defaultTokenizer: Tokenizer = {
  decode: Xml.decode,
  decodeString: Xml.decodeString,
  encode: Xml.encode,
  encodeString: Xml.encodeString,
  positions: "none",
};

/**
 * The tokenizer every decode and encode reads.
 *
 * It defaults to the `effect/encoding/Xml` channels, so reading it needs no `Layer` and adds
 * nothing to an effect's requirements. Provide another `Tokenizer` to swap the parser and writer.
 *
 * @example
 *   program.pipe(Effect.provideService(Tokenizer, myTokenizer));
 */
export const Tokenizer: Context.Reference<Tokenizer> = Context.Reference<Tokenizer>(
  "@aidenzepp/effect-xml/Tokenizer",
  { defaultValue: () => defaultTokenizer },
);
