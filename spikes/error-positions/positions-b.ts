// Approach B: position tracking beside the upstream parser.
//
// Wraps `Xml.decodeString` in a channel that re-chunks the input text so that
// every piece handed to the parser starts at a `<` (apart from any text before
// the first one), counts lines and columns over the pieces it forwards, and tags
// each emitted event with the start position of the piece that completed it.
// Because `Xml.decodeString` emits the events completed by one input chunk as
// one output chunk (Xml.ts:285-287, 580-601), and a piece holds exactly one `<`,
// a `StartElement` or `EndElement` is always completed by the piece whose `<`
// opens it, so their positions are exact. `Text`, `Comment`, `Doctype` and
// `ProcessingInstruction` are completed by a later piece and get that piece's
// position (see RESULT.md).
//
// Effect APIs checked: `Xml.decodeString` (events carry no positions, Xml.ts:133-166);
// `XmlError` (positions only on parser failures, Xml.ts:51-56); `Channel.fromTransform`
// and `Channel.toTransform` (public, stable) are what the wrapper is built from.
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import * as Pull from "effect/Pull";
import { Xml } from "effect/encoding";

export interface Position {
  /**
   * One-based line, ending at LF, CR or CRLF, as upstream `XmlError` counts them.
   */
  readonly line: number;
  /**
   * One-based column in UTF-16 code units, as upstream `XmlError` counts them.
   */
  readonly column: number;
}

export interface Positioned extends Position {
  readonly event: Xml.Event;
}

const LT = 60;
const LF = 10;
const CR = 13;

export const decodeStringWithPositions = <IE = never, Done = unknown>(
  options?: Xml.DecodeOptions,
): Channel.Channel<
  Arr.NonEmptyReadonlyArray<Positioned>,
  Xml.XmlError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<string>,
  IE,
  Done
> =>
  Channel.fromTransform(
    (upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<string>, IE, Done>, scope) => {
      // Pieces waiting to be fed to the parser, each starting at `<`.
      const queue: Array<string> = [];
      // Trailing text after the last `<` seen; held back until the next chunk or
      // the end so that a start tag split across chunks is still fed as one piece.
      let carry = "";
      // Position of the next unread character.
      let line = 1;
      let column = 1;
      // Position of the piece most recently fed to the parser.
      let fedLine = 1;
      let fedColumn = 1;
      let ended: Pull.Pull<never, never, Done> | undefined;

      const advance = (piece: string): void => {
        for (let i = 0; i < piece.length; i++) {
          const code = piece.charCodeAt(i);
          if (code === LF) {
            line++;
            column = 1;
          } else if (code === CR) {
            if (piece.charCodeAt(i + 1) === LF) i++;
            line++;
            column = 1;
          } else {
            column++;
          }
        }
      };

      const refill = (strings: Arr.NonEmptyReadonlyArray<string>): void => {
        for (const s of strings) {
          const text = carry + s;
          let start = 0;
          let i = text.indexOf("<", text.charCodeAt(0) === LT ? 1 : 0);
          while (i !== -1) {
            queue.push(text.slice(start, i));
            start = i;
            i = text.indexOf("<", i + 1);
          }
          carry = text.slice(start);
        }
      };

      const feed = (): Arr.NonEmptyReadonlyArray<string> => {
        const piece = queue.shift() as string;
        fedLine = line;
        fedColumn = column;
        advance(piece);
        return [piece];
      };

      const pieces: Pull.Pull<Arr.NonEmptyReadonlyArray<string>, IE, Done> = Effect.suspend(() => {
        if (queue.length > 0) return Effect.succeed(feed());
        if (ended !== undefined) return ended;
        return Pull.matchEffect(upstream, {
          onSuccess: (chunk) => {
            refill(chunk);
            return pieces;
          },
          onFailure: Effect.failCause,
          onDone: (leftover) => {
            if (carry !== "") {
              queue.push(carry);
              carry = "";
            }
            ended = Cause.done(leftover);
            return pieces;
          },
        });
      });

      return Effect.map(
        Channel.toTransform(Xml.decodeString<IE, Done>(options))(pieces, scope),
        (events) =>
          Effect.map(events, (chunk) =>
            Arr.map(chunk, (event): Positioned => ({ event, line: fedLine, column: fedColumn })),
          ),
      );
    },
  );
