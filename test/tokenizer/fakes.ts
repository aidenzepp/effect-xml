import * as Arr from "effect/Array";
import * as Channel from "effect/Channel";
import { pipe } from "effect/Function";
import type { Xml } from "effect/encoding";

import { decodeStringWithPositions } from "../../src/positions.ts";
import type { PositionedEvent } from "../../src/positions.ts";
import { Tokenizer, defaultTokenizer } from "../../src/tokenizer.ts";
import type { PositionedStartElement, TokenizerDecodeOptions } from "../../src/tokenizer.ts";

/**
 * One channel factory call a {@link spyTokenizer} recorded: the factory's name and the options it
 * received (`undefined` for the encoders, which take none).
 */
export interface TokenizerCall {
  readonly factory: "decode" | "decodeString" | "encode" | "encodeString";
  readonly options: TokenizerDecodeOptions | undefined;
}

/**
 * A tokenizer that records its channel factory calls, with the live list of those calls in call
 * order.
 */
export interface TokenizerSpy {
  readonly tokenizer: Tokenizer;
  readonly calls: readonly TokenizerCall[];
}

/**
 * Construct a tokenizer that delegates every channel to {@link defaultTokenizer} and records each
 * factory call, so a test can prove a code path reads the provided `Tokenizer`.
 *
 * @returns The spying tokenizer and the live list of calls it records, in call order.
 */
export const spyTokenizer = (): TokenizerSpy => {
  const calls: TokenizerCall[] = [];

  const tokenizer: Tokenizer = {
    decode: <IE = never, Done = unknown>(options?: TokenizerDecodeOptions) => {
      calls.push({ factory: "decode", options });

      return defaultTokenizer.decode<IE, Done>(options);
    },
    decodeString: <IE = never, Done = unknown>(options?: TokenizerDecodeOptions) => {
      calls.push({ factory: "decodeString", options });

      return defaultTokenizer.decodeString<IE, Done>(options);
    },
    encode: <IE = never, Done = unknown>() => {
      calls.push({ factory: "encode", options: undefined });

      return defaultTokenizer.encode<IE, Done>();
    },
    encodeString: <IE = never, Done = unknown>() => {
      calls.push({ factory: "encodeString", options: undefined });

      return defaultTokenizer.encodeString<IE, Done>();
    },
    positions: defaultTokenizer.positions,
  };

  const spy: TokenizerSpy = { calls, tokenizer };

  return spy;
};

/**
 * Construct a `positions: "native"` tokenizer whose positioned decodes stamp each start tag with
 * the position `decodeStringWithPositions` scans, its line raised by `lineOffset`.
 *
 * The scan runs under {@link defaultTokenizer} because `decodeStringWithPositions` reads the
 * `Tokenizer` service; providing this tokenizer there would recurse into itself. Decodes without
 * `positions: true`, and both encoders, delegate to {@link defaultTokenizer}.
 *
 * @param lineOffset - The amount added to every stamped line.
 * @returns The native-position tokenizer.
 */
const nativeTokenizer = (lineOffset: number): Tokenizer => {
  const stamp = ({ event, position }: PositionedEvent): Xml.Event => {
    if (event._tag !== "StartElement") {
      return event;
    }

    const stamped: PositionedStartElement = {
      ...event,
      column: position.column,
      line: position.line + lineOffset,
    };

    return stamped;
  };

  const positioned = <IE, Done>(options: TokenizerDecodeOptions | undefined) =>
    decodeStringWithPositions<IE, Done>(options).pipe(
      Channel.provideService(Tokenizer, defaultTokenizer),
      Channel.map((chunk) => pipe(chunk, Arr.map(stamp))),
    );

  return {
    decode: <IE = never, Done = unknown>(options?: TokenizerDecodeOptions) =>
      options?.positions === true
        ? Channel.decodeText<IE, Done>("utf-8", { fatal: true }).pipe(
            Channel.pipeTo(positioned<IE, Done>(options)),
          )
        : defaultTokenizer.decode<IE, Done>(options),
    decodeString: <IE = never, Done = unknown>(options?: TokenizerDecodeOptions) =>
      options?.positions === true
        ? positioned<IE, Done>(options)
        : defaultTokenizer.decodeString<IE, Done>(options),
    encode: defaultTokenizer.encode,
    encodeString: defaultTokenizer.encodeString,
    positions: "native",
  };
};

/**
 * A `positions: "native"` tokenizer whose stamped start-tag positions equal the scanned ones.
 */
export const honestNativeTokenizer: Tokenizer = nativeTokenizer(0);

/**
 * A `positions: "native"` tokenizer whose stamped start-tag lines sit 1000 below the scanned ones,
 * so a test can tell a native position from a scanned one.
 */
export const shiftedNativeTokenizer: Tokenizer = nativeTokenizer(1000);
