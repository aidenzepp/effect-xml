/**
 * Document order in mixed content on `bg010-missing-word.xml`: the `<p>` inside the
 * `<blockquote>` decodes to an ordered `$children` array, a consumer renderer narrows it
 * exhaustively on `_tag` (`docs/rd/criteria.md` C3), and encode then decode keeps the order.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { XmlSchema } from "../../src/index.ts";
import type { DivValue, ExtendedTextInteraction } from "./vocabulary.ts";
import { AssessmentItem } from "./vocabulary.ts";

/**
 * The whole-document codec of the vocabulary: XML text to and from a decoded item.
 */
const Document = XmlSchema.fromString(AssessmentItem);

/**
 * Decode XML text to an item through {@link Document}.
 */
const decodeItem = Schema.decodeUnknownEffect(Document);

/**
 * Encode an item to XML text through {@link Document}.
 */
const encodeItem = Schema.encodeEffect(Document);

/**
 * The paragraph value of the vocabulary, taken from the decoded item type.
 */
type Paragraph = Extract<
  Extract<
    Extract<
      (typeof AssessmentItem)["Type"]["body"]["$children"][number],
      { _tag: "div" }
    >["value"]["$children"][number],
    { _tag: "blockquote" }
  >["value"]["$children"][number],
  { _tag: "p" }
>["value"];

/**
 * The fixture text of `bg010-missing-word.xml`.
 */
const xml = readFileSync(
  new URL("../../spikes/fixtures/qti/bg010-missing-word.xml", import.meta.url),
  "utf-8",
);

/**
 * The `<p>` inside `<div><blockquote>` of a decoded bg010 item.
 *
 * @param item - The decoded item.
 * @returns The paragraph value, or `undefined` when the path is absent.
 */
const quotedParagraph = (item: (typeof AssessmentItem)["Type"]): Paragraph | undefined => {
  const div = item.body.$children.find((child) => child._tag === "div");
  const quote = div?.value.$children.find((child) => child._tag === "blockquote");

  return quote?.value.$children.find((child) => child._tag === "p")?.value;
};

/**
 * The child tags of the quoted paragraph, in order.
 *
 * @param item - The decoded item.
 * @returns The tags, or `undefined` when the paragraph is absent.
 */
const tags = (item: (typeof AssessmentItem)["Type"]): readonly string[] | undefined =>
  quotedParagraph(item)?.$children.map((child) => child._tag);

/**
 * Render a paragraph in document order: text as written, `br` as a newline, and the text entry
 * as its response identifier in brackets. The `never` default makes the narrowing exhaustive.
 *
 * @param paragraph - The paragraph value.
 * @returns The rendered text.
 */
const render = (paragraph: Paragraph): string =>
  paragraph.$children
    .map((child) => {
      switch (child._tag) {
        case "$text": {
          return child.text;
        }

        case "br": {
          return "\n";
        }

        case "qti-text-entry-interaction": {
          return `[${child.value["response-identifier"]}]`;
        }

        case "math": {
          return "";
        }

        default: {
          const unreachable: never = child;

          return unreachable;
        }
      }
    })
    .join("");

describe("mixed content order on bg010-missing-word.xml", () => {
  it.effect("decodes the quoted paragraph to children in document order", () =>
    Effect.gen(function* tagSequence() {
      const item = yield* decodeItem(xml);
      const paragraph = quotedParagraph(item);

      expect(paragraph?.$children.map((child) => child._tag)).toStrictEqual([
        "$text",
        "br",
        "$text",
        "qti-text-entry-interaction",
        "$text",
        "br",
        "$text",
        "br",
        "$text",
      ]);
    }),
  );

  it.effect("renders the text in document order", () =>
    Effect.gen(function* rendered() {
      const item = yield* decodeItem(xml);
      const paragraph = quotedParagraph(item);

      expect(paragraph === undefined ? undefined : render(paragraph)).toBe(
        [
          "The leaves come down in red and gold,",
          "\n          the days grow short as autumn turns to [RESPONSE];",
          "\n          the river runs both dark and cold",
          "\n          beneath a sky of grey.",
        ].join("\n"),
      );
    }),
  );

  it.effect("keeps the child order through encode and a second decode", () =>
    Effect.gen(function* reorder() {
      const item = yield* decodeItem(xml);
      const again = yield* decodeItem(yield* encodeItem(item));

      expect(tags(again)).toStrictEqual(tags(item));
    }),
  );
});

/**
 * The fixture text of `extended-text-postcard.xml`.
 */
const postcard = readFileSync(
  new URL("../../spikes/fixtures/qti/extended-text-postcard.xml", import.meta.url),
  "utf-8",
);

/**
 * The first extended-text interaction below a list of `div` children, searched depth first.
 *
 * @param children - The `$children` of a `div` value.
 * @returns The interaction value, or `undefined` when none is present.
 */
const findInteraction = (
  children: DivValue["$children"],
): (typeof ExtendedTextInteraction)["Type"] | undefined => {
  for (const child of children) {
    if (child._tag === "qti-extended-text-interaction") {
      return child.value;
    }

    if (child._tag === "div") {
      const found = findInteraction(child.value.$children);

      if (found !== undefined) {
        return found;
      }
    }
  }

  return undefined;
};

/**
 * The first extended-text interaction in a decoded item body.
 *
 * @param item - The decoded item.
 * @returns The interaction value, or `undefined` when none is present.
 */
const interactionOf = (
  item: (typeof AssessmentItem)["Type"],
): (typeof ExtendedTextInteraction)["Type"] | undefined => {
  const div = item.body.$children.find((child) => child._tag === "div");

  return div === undefined ? undefined : findInteraction(div.value.$children);
};

/**
 * Whether a decoded body holds a whitespace-only text run.
 *
 * @param children - The `$children` of the item body.
 * @returns `true` when some text run is non-empty and all whitespace.
 */
const hasWhitespaceRun = (
  children: (typeof AssessmentItem)["Type"]["body"]["$children"],
): boolean => children.some((child) => child._tag === "$text" && /^\s+$/u.test(child.text));

const message = "Enter a number such as 2.74, with at most two digits after the point";

describe("whitespace rules and typed data-* on the acceptance fixtures", () => {
  it.effect("keeps whitespace-only runs in mixed content", () =>
    Effect.gen(function* mixedRuns() {
      const item = yield* decodeItem(xml);

      expect(hasWhitespaceRun(item.body.$children)).toBe(true);
    }),
  );

  it.effect("drops whitespace between elements-mode children", () =>
    Effect.gen(function* elementRuns() {
      const item = yield* decodeItem(xml);
      const values = item.responseDeclarations[0]?.correctResponse?.values;

      expect(values).toStrictEqual([{ $text: "winter" }]);
      expect(JSON.stringify(values)).not.toMatch(/\\n|\s{2}/u);
    }),
  );

  it.effect("decodes data-patternmask-message under the data-* schema", () =>
    Effect.gen(function* decoded() {
      const item = yield* decodeItem(postcard);

      expect(interactionOf(item)?.["data-patternmask-message"]).toBe(message);
    }),
  );

  it.effect("re-encodes data-patternmask-message with the same value", () =>
    Effect.gen(function* reencoded() {
      const item = yield* decodeItem(postcard);
      const again = yield* decodeItem(yield* encodeItem(item));

      expect(interactionOf(again)?.["data-patternmask-message"]).toBe(message);
    }),
  );
});
