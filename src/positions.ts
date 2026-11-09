import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Pull from "effect/Pull";
import type { Xml } from "effect/encoding";

import { splitQName } from "./element.ts";
import { Tokenizer } from "./tokenizer.ts";
import type { PositionedStartElement } from "./tokenizer.ts";

/**
 * A one-based position in input text: lines end at LF, CR, or CRLF and columns count UTF-16 code
 * units, exactly as upstream `XmlError` counts.
 */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/**
 * One step of an {@link ElementPath}: an element's as-written local part and its zero-based index
 * among its parent's element children. Text, comments, and processing instructions do not count.
 */
export interface ElementStep {
  readonly local: string;
  readonly index: number;
}

/**
 * A root-to-element path whose first step names the document root at index 0.
 */
export type ElementPath = readonly ElementStep[];

/**
 * The code of `<`, which opens every tag and markup construct.
 */
const LT = 60;

/**
 * The code of a line feed, a line end on its own.
 */
const LF = 10;

/**
 * The code of a carriage return, a line end alone or before a line feed.
 */
const CR = 13;

/**
 * The code of `"`, which delimits an attribute value or literal.
 */
const QUOTE_DOUBLE = 34;

/**
 * The code of `'`, which delimits an attribute value or literal.
 */
const QUOTE_SINGLE = 39;

/**
 * The code of `>`, which closes a tag.
 */
const GREATER_THAN = 62;

/**
 * The code of `/`, which ends a name and marks a self-closing tag.
 */
const SLASH = 47;

/**
 * The code of a space, which ends a name.
 */
const SPACE = 32;

/**
 * The code of `[`, which opens a DOCTYPE internal subset.
 */
const BRACKET_OPEN = 91;

/**
 * The code of `]`, which closes a DOCTYPE internal subset.
 */
const BRACKET_CLOSE = 93;

/**
 * The code of a tab, which ends a name.
 */
const TAB = 9;

/**
 * The code of `!`, which after `<` opens a comment, CDATA section, or DOCTYPE.
 */
const BANG = 33;

/**
 * The code of `?`, which after `<` opens a processing instruction.
 */
const QUESTION = 63;

/**
 * The most pieces `decodeStringWithPositions` feeds the tokenizer before it releases the events it
 * has gathered, so the first events of one long input string leave after at most this many pieces.
 */
const BATCH_PIECES = 64;

/**
 * Read the code point starting at an index as a number, or -1 past the end. Every comparison is
 * against an ASCII code, so a supplementary character never matches.
 *
 * @param text - The document text.
 * @param index - The UTF-16 index to read.
 * @returns The code point starting at the index, or -1 when the index is out of range.
 */
const codeAt = (text: string, index: number): number => text.codePointAt(index) ?? -1;

/**
 * Report whether a character code ends an element name inside a start tag.
 *
 * @param code - The UTF-16 code unit under test.
 * @returns `true` for whitespace, `/`, and `>`.
 */
const isNameEnd = (code: number): boolean =>
  code === SPACE ||
  code === TAB ||
  code === LF ||
  code === CR ||
  code === SLASH ||
  code === GREATER_THAN;

/**
 * Find the index just past the `>` that closes a tag, honouring quoted attribute values that may
 * contain `>`.
 *
 * @param text - The document text.
 * @param from - The index to start scanning at, past the tag's opening `<` or `</`.
 * @returns The index past the closing `>`, or -1 when the tag is unterminated.
 */
const tagEnd = (text: string, from: number): number => {
  let quote = 0;

  for (let j = from; j < text.length; j += 1) {
    const code = codeAt(text, j);

    if (quote !== 0) {
      if (code === quote) {
        quote = 0;
      }
    } else if (code === QUOTE_DOUBLE || code === QUOTE_SINGLE) {
      quote = code;
    } else if (code === GREATER_THAN) {
      return j + 1;
    }
  }

  return -1;
};

/**
 * The scan state inside a DOCTYPE: the open quote's code (0 outside a quoted literal), the depth
 * of `[...]` nesting, and the terminator of the internal subset comment or processing instruction
 * the scan is inside, if any.
 */
interface DoctypeScan {
  quote: number;
  depth: number;
  skip: string | undefined;
}

/**
 * Start the scan state of a DOCTYPE at its opening `<!`.
 *
 * @returns A state outside any quote, subset, comment, or processing instruction.
 */
const doctypeStart = (): DoctypeScan => ({ depth: 0, quote: 0, skip: undefined });

/**
 * Scan DOCTYPE text for the `>` that closes it, skipping an internal subset in `[...]` and quoted
 * literals, and leave the scan state as it stands at the end of the text so a later scan can
 * continue it.
 *
 * Inside the internal subset, a comment (`<!--` to `-->`) or processing instruction (`<?` to `?>`)
 * is skipped whole, as the `Scanner` in `effect/encoding/Xml` skips it: a bracket or quote inside
 * one is text, not subset structure, so it cannot move the scan past the real `]>`.
 *
 * @param scan - The state carried from the text before, updated in place.
 * @param text - The text to scan.
 * @param from - The index to start scanning at.
 * @returns The index past the closing `>`, or -1 when the text ends first.
 */
const scanDoctype = (scan: DoctypeScan, text: string, from: number): number => {
  for (let j = from; j < text.length; j += 1) {
    if (scan.skip === undefined) {
      const code = codeAt(text, j);

      if (scan.quote !== 0) {
        if (code === scan.quote) {
          scan.quote = 0;
        }
      } else if (scan.depth > 0 && text.startsWith("<!--", j)) {
        scan.skip = "-->";
        j += 3;
      } else if (scan.depth > 0 && text.startsWith("<?", j)) {
        scan.skip = "?>";
        j += 1;
      } else if (code === QUOTE_DOUBLE || code === QUOTE_SINGLE) {
        scan.quote = code;
      } else if (code === BRACKET_OPEN) {
        scan.depth += 1;
      } else if (code === BRACKET_CLOSE) {
        scan.depth -= 1;
      } else if (code === GREATER_THAN && scan.depth === 0) {
        return j + 1;
      }
    } else {
      const end = text.indexOf(scan.skip, j);

      if (end === -1) {
        return -1;
      }

      j = end + scan.skip.length - 1;
      scan.skip = undefined;
    }
  }

  return -1;
};

/**
 * Find the index just past the `>` that closes a DOCTYPE, skipping an internal subset in `[...]`,
 * the comments and processing instructions inside it, and quoted literals.
 *
 * @param text - The document text.
 * @param from - The index to start scanning at, past the opening `<!`.
 * @returns The index past the closing `>`, or -1 when the DOCTYPE is unterminated.
 */
const doctypeEnd = (text: string, from: number): number => scanDoctype(doctypeStart(), text, from);

/**
 * Find the index just past the terminator of a construct that closes on a fixed string.
 *
 * @param text - The document text.
 * @param from - The index to start searching at, past the construct's opener.
 * @param terminator - The closing string.
 * @returns The index past the terminator, or -1 when it is absent.
 */
const pastTerminator = (text: string, from: number, terminator: string): number => {
  const at = text.indexOf(terminator, from);

  return at === -1 ? -1 : at + terminator.length;
};

/**
 * Find the index just past a processing instruction, comment, CDATA section, or DOCTYPE that
 * opens at an index.
 *
 * @param text - The document text.
 * @param lt - The index of a `<`.
 * @returns The index past the construct (-1 when it is unterminated), or `Option.none()` when the
 *   `<` opens a tag rather than one of these.
 */
const markupEnd = (text: string, lt: number): Option.Option<number> => {
  if (text.startsWith("<?", lt)) {
    return Option.some(pastTerminator(text, lt + 2, "?>"));
  }

  if (text.startsWith("<!--", lt)) {
    return Option.some(pastTerminator(text, lt + 4, "-->"));
  }

  if (text.startsWith("<![CDATA[", lt)) {
    return Option.some(pastTerminator(text, lt + 9, "]]>"));
  }

  return text.startsWith("<!", lt) ? Option.some(doctypeEnd(text, lt + 2)) : Option.none();
};

/**
 * One open element during the scan: how many element children have started under it, and whether
 * it lies on the requested path.
 */
interface Frame {
  children: number;
  readonly matched: boolean;
}

/**
 * Find the position of the start tag of the element a positional path names, by scanning the
 * retained input text.
 *
 * `Xml.decodeString` events carry no position, `XmlError` carries one only on parser failure, and
 * `SchemaIssue` has no position slot; nothing public attributes an event to its input except the
 * one-output-chunk-per-input-chunk contract, and nothing locates after the fact except a scan of
 * the retained text, which is what this is. It is the one second tokenizer the goal allows and is
 * licensed only together with the locate-versus-channel agreement test in this module's test file.
 *
 * The path is positional and zero-based on purpose: the printed XPath is one-based and same-named,
 * and a name-matching scanner would need namespace resolution. A step matches when its index equals
 * the count of element children already started under the matched parent and its local part equals
 * the as-written local part of the tag name (the text after the first `:`).
 *
 * Processing instructions, comments, CDATA sections, and DOCTYPE declarations (including an
 * internal subset and quoted literals) are skipped whole: none opens a frame or counts as an
 * element child, and an unterminated one yields `Option.none()`.
 *
 * Attribute positions inside a start tag and `Text` positions are not reported: a failure on an
 * attribute or text child reports the enclosing element's start tag.
 *
 * @param text - The document text, retained by the caller.
 * @param path - The positional path of the element to find.
 * @returns The position of the matched start tag's `<`, or `Option.none()` for an empty path, a path
 *   past the document, an unterminated tag, or a local-name mismatch on the matched index.
 */
export const locate = (text: string, path: ElementPath): Option.Option<Position> => {
  if (path.length === 0) {
    return Option.none();
  }

  let i = 0;
  let line = 1;
  let lineStart = 0;
  const stack: Frame[] = [{ children: 0, matched: true }];

  const advance = (to: number): void => {
    for (; i < to; i += 1) {
      const code = codeAt(text, i);

      if (code === LF) {
        line += 1;
        lineStart = i + 1;
      } else if (code === CR) {
        if (codeAt(text, i + 1) === LF) {
          i += 1;
        }

        line += 1;
        lineStart = i + 1;
      }
    }
  };

  for (;;) {
    const lt = text.indexOf("<", i);

    if (lt === -1) {
      return Option.none();
    }

    advance(lt);
    let next: number;

    const skipped = markupEnd(text, lt);

    if (Option.isSome(skipped)) {
      next = skipped.value;

      if (next === -1) {
        return Option.none();
      }
    } else if (text.startsWith("</", lt)) {
      next = tagEnd(text, lt + 2);

      if (next === -1) {
        return Option.none();
      }

      stack.pop();
    } else {
      next = tagEnd(text, lt + 1);

      if (next === -1) {
        return Option.none();
      }

      let nameEnd = lt + 1;

      while (nameEnd < next && !isNameEnd(codeAt(text, nameEnd))) {
        nameEnd += 1;
      }

      const { local } = splitQName(text.slice(lt + 1, nameEnd));
      const parent = stack.at(-1);

      if (parent === undefined) {
        return Option.none();
      }

      const seen = parent.children;
      parent.children += 1;
      const depth = stack.length - 1;
      const step = path[depth];

      const matched =
        parent.matched && step !== undefined && step.index === seen && step.local === local;

      if (matched && depth === path.length - 1) {
        return Option.some({ column: lt - lineStart + 1, line });
      }

      if (codeAt(text, next - 2) !== SLASH) {
        stack.push({ children: 0, matched });
      }
    }

    advance(next);
  }
};

/**
 * A decoded XML event paired with the position of the input piece that completed it.
 */
export interface PositionedEvent {
  readonly event: Xml.Event;
  readonly position: Position;
}

/**
 * Decode string chunks into XML events, each tagged with a {@link Position}, by wrapping the
 * `decodeString` channel of the provided `Tokenizer` in a channel that feeds it one piece
 * at a time.
 *
 * Upstream events carry no position (see `locate`), and the only public attribution of an event to
 * its input is the one-output-chunk-per-input-chunk contract a `positions: "none"` tokenizer keeps.
 * A native-position tokenizer reports positions itself; `nativePositions` reads them without this
 * scan. The channel re-chunks the input so each piece holds at most one `<`, at its start, counts
 * line and column over each piece it feeds with the {@link Position} rules, and tags every event of
 * an output chunk with the start of the piece fed last. A piece with no `<` is routine mid-stream:
 * the strings `"<r>a"` then `"b<x/>"` feed `"<r>"`, `"ab"`, and `"<x/>"`. A `StartElement` or
 * `EndElement` is completed by the piece whose `<` opens it, so its position is exact. `Text`,
 * `Comment`, `Doctype`, and `ProcessingInstruction` are completed by a later piece and carry that
 * piece's position; only start and end tags carry exact positions. Positions are counted over the
 * raw input, never over `Text` events, which normalize line endings.
 *
 * The tagged events of several pieces leave together in one output chunk, so stages downstream
 * pull once per batch rather than once per piece. A batch leaves once {@link BATCH_PIECES} pieces
 * have been fed, or once no piece left of the current input string opens a start or end tag: the
 * tokenizer stops at such a piece to emit its tag, so until then it cannot pull upstream, and after
 * it a held event could wait on upstream behind a comment, CDATA section, processing instruction,
 * or DOCTYPE. Events decoded before a tokenizer failure or the end of input leave before it.
 *
 * The construct after the last `<` of an input string is fed once that string completes it; the
 * text after it, or an incomplete construct, is carried into the next string and flushed at the
 * end of input, so a run with no `<` is buffered whole; upstream's `maxTokenSize` bounds it.
 *
 * The channel alone costs 2.5x to 3.6x plain `Xml.decodeString` on the small documents of the
 * corpus, about three quarters of it the per-piece pull round trip through the channel rather than
 * the counting, which is why it is opt-in and never the default on the decode path. That figure is
 * the channel by itself; the README states the measured cost of the whole positioned stream path.
 * Gathering the events of one input string into one output chunk keeps that round trip inside this
 * channel instead of repeating it in every downstream stage. The stream decode path runs the
 * channel only behind `positions: true`, where the input text is not retained for `locate`.
 *
 * @param options - The upstream decode options, passed through unchanged.
 * @returns A channel from string chunks to positioned event chunks, failing with `Xml.XmlError`.
 */
export const decodeStringWithPositions = <IE = never, Done = unknown>(
  options?: Xml.DecodeOptions,
): Channel.Channel<
  Arr.NonEmptyReadonlyArray<PositionedEvent>,
  Xml.XmlError | IE,
  Done,
  Arr.NonEmptyReadonlyArray<string>,
  IE,
  Done
> =>
  Channel.fromTransform(
    (upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<string>, IE, Done>, scope) => {
      const queue: string[] = [];
      let head = 0;
      let strings: readonly string[] = [];
      let nextString = 0;
      let carry = "";
      let line = 1;
      let column = 1;
      let fedLine = 1;
      let fedColumn = 1;
      let fedSinceRelease = 0;
      let lastTag = -1;
      let terminator: string | undefined;
      let doctype: DoctypeScan | undefined;
      let ended: Pull.Pull<never, never, Done> | undefined;

      /**
       * Move `line` and `column` past a piece with the {@link Position} rules. Columns count UTF-16
       * code units, so only CR and LF are located; the column is the code-unit distance past the
       * last line end. A CR that ends the piece ends one line.
       *
       * @param piece - The piece about to be fed to the tokenizer.
       */
      const advance = (piece: string): void => {
        let lineStart = -1;
        let cr = piece.indexOf("\r");
        let lf = piece.indexOf("\n");

        while (cr !== -1 || lf !== -1) {
          if (cr !== -1 && (lf === -1 || cr < lf)) {
            lineStart = cr + 1;

            if (lf === lineStart) {
              lineStart += 1;
              lf = piece.indexOf("\n", lineStart);
            }

            cr = piece.indexOf("\r", lineStart);
          } else {
            lineStart = lf + 1;
            lf = piece.indexOf("\n", lineStart);
          }

          line += 1;
        }

        column = lineStart === -1 ? column + piece.length : 1 + piece.length - lineStart;
      };

      /**
       * Note that a comment, CDATA section, or processing instruction opened at `from` runs past
       * the piece when its terminator is absent. No terminator holds `<`, so a later piece holds
       * it whole.
       *
       * @param piece - The piece that opens the construct.
       * @param from - The index past the construct's opener.
       * @param closing - The construct's terminator.
       */
      const open = (piece: string, from: number, closing: string): void => {
        if (pastTerminator(piece, from, closing) === -1) {
          terminator = closing;
        }
      };

      /**
       * Report whether a piece opens a start or end tag, tracking the comment, CDATA section,
       * processing instruction, or DOCTYPE that runs across pieces. Pieces are classified once,
       * in document order. The tokenizer completes a tag with the piece whose `<` opens it, which
       * is what makes start and end tag positions exact.
       *
       * @param piece - The next piece in document order.
       * @returns Whether feeding the piece makes the tokenizer emit a tag event or fail.
       */
      const opensTag = (piece: string): boolean => {
        if (terminator !== undefined) {
          if (piece.includes(terminator)) {
            terminator = undefined;
          }

          return false;
        }

        if (doctype !== undefined) {
          if (scanDoctype(doctype, piece, 0) !== -1) {
            doctype = undefined;
          }

          return false;
        }

        if (codeAt(piece, 0) !== LT) {
          return false;
        }

        const second = codeAt(piece, 1);

        if (second === QUESTION) {
          open(piece, 2, "?>");
        } else if (second !== BANG) {
          return true;
        } else if (piece.startsWith("<!--")) {
          open(piece, 4, "-->");
        } else if (piece.startsWith("<![CDATA[")) {
          open(piece, 9, "]]>");
        } else {
          const scan = doctypeStart();

          if (scanDoctype(scan, piece, 2) === -1) {
            doctype = scan;
          }
        }

        return false;
      };

      /**
       * Find where the construct a piece opens or continues ends inside it, without changing the
       * classification state. The piece is the text after the last `<` of an input string, so it
       * holds at most one `<`, at its start.
       *
       * @param piece - The next piece in document order, not yet classified.
       * @returns The index past the end of the tag, comment, CDATA section, processing
       *   instruction, or DOCTYPE the piece opens or continues, or -1 when the piece ends first or
       *   holds only text.
       */
      const pieceEnd = (piece: string): number => {
        if (terminator !== undefined) {
          return pastTerminator(piece, 0, terminator);
        }

        if (doctype !== undefined) {
          return scanDoctype({ ...doctype }, piece, 0);
        }

        if (codeAt(piece, 0) !== LT) {
          return -1;
        }

        return Option.getOrElse(markupEnd(piece, 0), () => tagEnd(piece, 1));
      };

      /**
       * Classify a piece and queue it. `lastTag` marks the last queued piece that opens a start or
       * end tag.
       *
       * @param piece - The next piece in document order.
       */
      const enqueue = (piece: string): void => {
        if (opensTag(piece)) {
          lastTag = queue.length;
        }

        queue.push(piece);
      };

      /**
       * Queue the `<`-led pieces of one input string, after the carried text, and carry the rest
       * to the next string. When the construct after the last `<` already ends in this string,
       * it is queued as its own piece and only the text after it is carried, so every event the
       * tokenizer can emit from the text received so far leaves before the channel pulls
       * upstream. That text is carried because a `Text` event's extent is not final until the
       * next `<`, and it holds no `<` or construct end, so feeding it earlier would emit nothing.
       *
       * @param chunk - One string of an upstream chunk.
       */
      const split = (chunk: string): void => {
        const text = carry + chunk;
        let start = 0;
        const first = codeAt(text, 0) === LT ? 1 : 0;
        let at = text.indexOf("<", first);

        while (at !== -1) {
          enqueue(text.slice(start, at));
          start = at;
          at = text.indexOf("<", at + 1);
        }

        const rest = text.slice(start);
        const end = pieceEnd(rest);

        if (end === -1) {
          carry = rest;
        } else {
          enqueue(rest.slice(0, end));
          carry = rest.slice(end);
        }
      };

      const feed = (piece: string): Arr.NonEmptyReadonlyArray<string> => {
        fedLine = line;
        fedColumn = column;
        fedSinceRelease += 1;
        advance(piece);

        return [piece];
      };

      // Native: `Array.prototype.shift` lacks a constant-time dequeue on V8, which copies the rest of a
      // large array, so the queue is read through `head` and cleared once drained. The queue holds the
      // pieces of one input string at a time, so a drained queue marks the end of that string.
      const pieces: Pull.Pull<Arr.NonEmptyReadonlyArray<string>, IE, Done> = Effect.suspend(() => {
        if (head >= queue.length) {
          queue.length = 0;
          head = 0;
          lastTag = -1;

          while (queue.length === 0 && nextString < strings.length) {
            split(strings[nextString] ?? "");
            nextString += 1;
          }
        }

        if (head < queue.length) {
          const next = queue[head] ?? "";

          head += 1;

          return Effect.succeed(feed(next));
        }

        if (ended !== undefined) {
          return ended;
        }

        return Pull.matchEffect(upstream, {
          onDone: (leftover) => {
            if (carry !== "") {
              queue.push(carry);
              carry = "";
            }

            ended = Cause.done(leftover);

            return pieces;
          },
          onFailure: Effect.failCause,
          onSuccess: (chunk) => {
            strings = chunk;
            nextString = 0;

            return pieces;
          },
        });
      });

      const tag = (event: Xml.Event): PositionedEvent => ({
        event,
        position: { column: fedColumn, line: fedLine },
      });

      return Effect.gen(function* decodeThroughTokenizer() {
        const tokenizer = yield* Tokenizer;

        const events = yield* Channel.toTransform(tokenizer.decodeString<IE, Done>(options))(
          pieces,
          scope,
        );

        let batch: PositionedEvent[] = [];
        let halted: Pull.Pull<never, Xml.XmlError | IE, Done> | undefined;

        /**
         * Emit the gathered events before a halt: the batch leaves first, and the next pull
         * returns `then`.
         *
         * @param then - The tokenizer's end or failure.
         * @returns The batch when it holds an event, otherwise `then`.
         */
        const release = (
          then: Pull.Pull<never, Xml.XmlError | IE, Done>,
        ): Pull.Pull<Arr.NonEmptyReadonlyArray<PositionedEvent>, Xml.XmlError | IE, Done> => {
          const out = batch;

          if (!Arr.isArrayNonEmpty(out)) {
            return then;
          }

          batch = [];
          halted = then;

          return Effect.succeed(out);
        };

        // Native: `Channel.mapAccum` and `Stream.rechunk` lack a boundary at the last queued piece
        // that opens a tag, which only the queue knows, so the tagged events of a batch are gathered
        // here and leave in one output chunk before the tokenizer could pull upstream.
        const gathered: Pull.Pull<
          Arr.NonEmptyReadonlyArray<PositionedEvent>,
          Xml.XmlError | IE,
          Done
        > = Effect.suspend(
          () =>
            halted ??
            Pull.matchEffect(events, {
              onDone: (leftover) => release(Cause.done(leftover)),
              onFailure: (cause) => release(Effect.failCause(cause)),
              onSuccess: (chunk) => {
                for (const event of chunk) {
                  batch.push(tag(event));
                }

                const out = batch;

                if (
                  !Arr.isArrayNonEmpty(out) ||
                  (head <= lastTag && fedSinceRelease < BATCH_PIECES)
                ) {
                  return gathered;
                }

                batch = [];
                fedSinceRelease = 0;

                return Effect.succeed(out);
              },
            }),
        );

        return gathered;
      });
    },
  );

/**
 * Check whether an event is a start tag stamped with its own `line` and `column`.
 *
 * @param event - The decoded event.
 * @returns Whether `event` is a `PositionedStartElement`.
 */
const isPositionedStartElement = (event: Xml.Event): event is PositionedStartElement =>
  event._tag === "StartElement" &&
  Predicate.hasProperty(event, "line") &&
  Predicate.isNumber(event.line) &&
  Predicate.hasProperty(event, "column") &&
  Predicate.isNumber(event.column);

/**
 * Pair each event a native-position tokenizer emits with a {@link Position}, without scanning the
 * input.
 *
 * A `StartElement` that carries its own `line` and `column` is positioned there. Every other event
 * carries the position of the last such start tag before it in the run, or line 1, column 1 before
 * the first, so only start tags carry exact positions, as with `decodeStringWithPositions`.
 * Each run starts from line 1, column 1.
 *
 * @returns A channel from event chunks to positioned event chunks, one output chunk per input
 *   chunk.
 */
export const nativePositions = <IE, Done>(): Channel.Channel<
  Arr.NonEmptyReadonlyArray<PositionedEvent>,
  IE,
  Done,
  Arr.NonEmptyReadonlyArray<Xml.Event>,
  IE,
  Done
> =>
  Channel.identity<Arr.NonEmptyReadonlyArray<Xml.Event>, IE, Done>().pipe(
    Channel.mapAccum(
      (): Position => ({ column: 1, line: 1 }),
      (last, chunk) => {
        const [next, positioned] = Arr.mapAccum(chunk, last, (current, event) => {
          const position = isPositionedStartElement(event)
            ? { column: event.column, line: event.line }
            : current;

          return [position, { event, position }] as const;
        });

        return [next, [positioned]] as const;
      },
    ),
  );

/**
 * A node of the element tree a collector builds from channel position stamps: the start tag's
 * {@link Position}, the as-written local part, and the element children in document order.
 */
export interface PositionTree {
  readonly position: Position;
  readonly local: string;
  readonly children: readonly PositionTree[];
}

/**
 * Find the start-tag position of the element a positional path names in a `PositionTree`.
 *
 * This is `locate` over a tree the collector builds from channel stamps instead of over
 * text, so the two position sources share one path convention: step 0 is the tree root at index 0,
 * and each later step selects `children[index]`. The local-name check lives here, as in `locate`,
 * because the collector has the Clark name in hand and upstream events carry no position.
 *
 * @param tree - The record's tree, whose root is the element at index 0.
 * @param path - The positional path of the element to find.
 * @returns The matched node's position, or `Option.none()` for an empty path, a missing child, or
 *   a local-name mismatch on any step.
 */
export const positionAt = (tree: PositionTree, path: ElementPath): Option.Option<Position> => {
  const [root, ...rest] = path;

  if (root === undefined || root.index !== 0 || root.local !== tree.local) {
    return Option.none();
  }

  let node = tree;

  for (const step of rest) {
    const child = node.children[step.index];

    if (child === undefined || child.local !== step.local) {
      return Option.none();
    }

    node = child;
  }

  return Option.some(node.position);
};
