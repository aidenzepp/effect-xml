// Approach C: post-hoc locate.
//
// Given the original text and an element path, a tiny tag scanner finds the
// start tag and returns its line and column. It is a second tokenizer: it must
// agree with the upstream parser on what is markup (comments, CDATA, processing
// instructions, DOCTYPE with an internal subset, `>` inside attribute values)
// to count elements the same way. `positions.test.ts` checks that agreement
// against approach B on every fixture.
//
// Path convention: `["qti-assessment-item", "qti-item-body", "p", 2]` is a list
// of element names; a number after a name selects the nth (zero-based) child
// with that name under the parent, and a name with no number means the first.
//
// Effect APIs checked: nothing in `effect/encoding/Xml` exposes positions for
// events or elements, and `SchemaIssue` has no position concept
// (SchemaIssue.ts:380-420), so a scan over the retained text is the only
// post-hoc source.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class LocateError extends Schema.TaggedError<LocateError>()("LocateError", {
  message: Schema.String,
}) {}

export interface Position {
  readonly line: number;
  readonly column: number;
}

export type PathSegment = string | number;

interface Step {
  readonly name: string;
  readonly index: number;
}

interface Frame {
  readonly counts: Map<string, number>;
  readonly matched: boolean;
}

export const renderPath = (path: ReadonlyArray<PathSegment>): string =>
  path.map((segment) => (typeof segment === "number" ? `[${segment}]` : `/${segment}`)).join("");

const normalize = (path: ReadonlyArray<PathSegment>): Array<Step> | string => {
  const steps: Array<Step> = [];
  for (const segment of path) {
    if (typeof segment === "string") {
      steps.push({ name: segment, index: 0 });
    } else if (steps.length === 0) {
      return `path ${renderPath(path)} must start with an element name`;
    } else {
      const last = steps[steps.length - 1] as Step;
      steps[steps.length - 1] = { name: last.name, index: segment };
    }
  }
  if (steps.length === 0) return "path is empty";
  return steps;
};

const LF = 10;
const CR = 13;

const isNameEnd = (code: number): boolean =>
  code === 32 ||
  code === 9 ||
  code === LF ||
  code === CR ||
  code === 47 /* / */ ||
  code === 62; /* > */

export const locate = (
  text: string,
  path: ReadonlyArray<PathSegment>,
): Effect.Effect<Position, LocateError> =>
  Effect.suspend(() => {
    const steps = normalize(path);
    if (typeof steps === "string") return Effect.fail(new LocateError({ message: steps }));

    let i = 0;
    let line = 1;
    let lineStart = 0;
    const stack: Array<Frame> = [{ counts: new Map(), matched: true }];

    // Moves the cursor to `to`, counting the line ends in between.
    const advance = (to: number): void => {
      for (; i < to; i++) {
        const code = text.charCodeAt(i);
        if (code === LF) {
          line++;
          lineStart = i + 1;
        } else if (code === CR) {
          if (text.charCodeAt(i + 1) === LF) i++;
          line++;
          lineStart = i + 1;
        }
      }
    };

    // Index just past the `>` that closes a tag opened at `from`, honouring
    // quoted attribute values (which may contain `>`). -1 when unterminated.
    const tagEnd = (from: number): number => {
      let quote = 0;
      for (let j = from; j < text.length; j++) {
        const code = text.charCodeAt(j);
        if (quote !== 0) {
          if (code === quote) quote = 0;
        } else if (code === 34 || code === 39) {
          quote = code;
        } else if (code === 62) {
          return j + 1;
        }
      }
      return -1;
    };

    // Index just past the `>` that closes a DOCTYPE opened at `from`, skipping
    // an internal subset in `[...]` and quoted literals.
    const doctypeEnd = (from: number): number => {
      let quote = 0;
      let depth = 0;
      for (let j = from; j < text.length; j++) {
        const code = text.charCodeAt(j);
        if (quote !== 0) {
          if (code === quote) quote = 0;
        } else if (code === 34 || code === 39) {
          quote = code;
        } else if (code === 91) {
          depth++;
        } else if (code === 93) {
          depth--;
        } else if (code === 62 && depth === 0) {
          return j + 1;
        }
      }
      return -1;
    };

    const unterminated = (what: string): Effect.Effect<never, LocateError> =>
      Effect.fail(
        new LocateError({
          message: `unterminated ${what} at line ${line}, column ${i - lineStart + 1}`,
        }),
      );

    for (;;) {
      const lt = text.indexOf("<", i);
      if (lt === -1) break;
      advance(lt);
      const column = lt - lineStart + 1;
      let next: number;
      if (text.startsWith("<?", lt)) {
        next = text.indexOf("?>", lt + 2);
        if (next === -1) return unterminated("processing instruction");
        next += 2;
      } else if (text.startsWith("<!--", lt)) {
        next = text.indexOf("-->", lt + 4);
        if (next === -1) return unterminated("comment");
        next += 3;
      } else if (text.startsWith("<![CDATA[", lt)) {
        next = text.indexOf("]]>", lt + 9);
        if (next === -1) return unterminated("CDATA section");
        next += 3;
      } else if (text.startsWith("<!", lt)) {
        next = doctypeEnd(lt + 2);
        if (next === -1) return unterminated("DOCTYPE");
      } else if (text.startsWith("</", lt)) {
        next = tagEnd(lt + 2);
        if (next === -1) return unterminated("end tag");
        stack.pop();
      } else {
        next = tagEnd(lt + 1);
        if (next === -1) return unterminated("start tag");
        let nameEnd = lt + 1;
        while (nameEnd < next && !isNameEnd(text.charCodeAt(nameEnd))) nameEnd++;
        const name = text.slice(lt + 1, nameEnd);
        const parent = stack[stack.length - 1] as Frame;
        const seen = parent.counts.get(name) ?? 0;
        parent.counts.set(name, seen + 1);
        const depth = stack.length - 1;
        const step = steps[depth];
        const matched =
          parent.matched && step !== undefined && step.name === name && step.index === seen;
        if (matched && depth === steps.length - 1) return Effect.succeed({ line, column });
        const selfClosing = text.charCodeAt(next - 2) === 47;
        if (!selfClosing) stack.push({ counts: new Map(), matched });
      }
      advance(next);
    }
    return Effect.fail(new LocateError({ message: `no element at ${renderPath(path)}` }));
  });
