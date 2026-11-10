/**
 * The error paths of the QTI vocabulary on `bg007-true-false.xml`: each variant breaks one
 * attribute and the decode fails with one `XmlSchema.XmlDecodeError` whose path, reason, and
 * message name the problem (criteria C2 and T3).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";

import { XmlSchema } from "../../src/index.ts";
import { AssessmentItem } from "./vocabulary.ts";

/**
 * The unmodified fixture text.
 */
const fixture = readFileSync(
  new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url),
  "utf-8",
);

/**
 * Replace the one occurrence of `from` in the fixture, failing the test when it is absent so a
 * fixture edit cannot silently turn a variant into the unmodified file.
 *
 * @param from - The exact text to replace.
 * @param to - The replacement text.
 * @returns The variant XML text.
 */
const variant = (from: string, to: string): string => {
  expect(fixture).toContain(from);

  return fixture.replace(from, to);
};

/**
 * Decode XML text with the vocabulary root and return the XML decode error its `Schema.SchemaError`
 * carries.
 *
 * @param xml - The XML text expected to fail decoding.
 * @returns An effect yielding the `XmlSchema.XmlDecodeError`, dying when the decode succeeds or the
 *   failure carries no XML decode error.
 */
const failureOf = (xml: string): Effect.Effect<XmlSchema.XmlDecodeError> =>
  Schema.decodeUnknownEffect(XmlSchema.fromString(AssessmentItem))(xml).pipe(
    Effect.flip,
    Effect.flatMap((failure) => Effect.fromOption(XmlSchema.findDecodeErrorOption(failure.issue))),
    Effect.orDie,
  );

/**
 * The counts of an issue tree: its leaves and its `AnyOf` nodes with more than one branch.
 */
interface IssueCount {
  readonly leaves: number;
  readonly branches: number;
}

/**
 * Add two counts.
 *
 * @param a - The first count.
 * @param b - The second count.
 * @returns The component-wise sum.
 */
const add = (a: IssueCount, b: IssueCount): IssueCount => ({
  branches: a.branches + b.branches,
  leaves: a.leaves + b.leaves,
});

/**
 * Measure a schema issue tree by walking `issues` (`Composite`, `AnyOf`) and `issue` (`Pointer`,
 * `Encoding`, `Filter`); a node with no children, including an `AnyOf` with no branches, is a leaf.
 *
 * @param issue - The root issue.
 * @returns The leaf count and the count of `AnyOf` nodes with more than one branch.
 */
const countOf = (issue: SchemaIssue.Issue): IssueCount => {
  if ("issues" in issue && issue.issues.length > 0) {
    let total: IssueCount = {
      branches: issue._tag === "AnyOf" && issue.issues.length > 1 ? 1 : 0,
      leaves: 0,
    };

    for (const child of issue.issues) {
      total = add(total, countOf(child));
    }

    return total;
  }

  if ("issue" in issue) {
    return countOf(issue.issue);
  }

  return { branches: 0, leaves: 1 };
};

describe("QTI vocabulary error paths on bg007-true-false.xml", () => {
  it.effect("decodes the unmodified file with a branded identifier and a numeric max-choices", () =>
    Effect.gen(function* unmodified() {
      const value = yield* Schema.decodeUnknownEffect(XmlSchema.fromString(AssessmentItem))(
        fixture,
      );

      const choice = value.body.$children.find((child) => child._tag === "qti-choice-interaction");

      expect(value.identifier).toBe("example-true-false-water");
      expect(choice?._tag === "qti-choice-interaction" && choice.value["max-choices"]).toBe(1);
    }),
  );

  describe("a non-numeric max-choices", () => {
    const xml = variant('max-choices="1"', 'max-choices="x"');

    it.effect(
      "fails with a SchemaFailure reason at the attribute path and a finite-number message",
      () =>
        Effect.gen(function* attributePath() {
          const error = yield* failureOf(xml);

          expect(error.reason._tag).toBe("SchemaFailure");
          expect(error.path).toBe(
            "/qti-assessment-item/qti-item-body/qti-choice-interaction/@max-choices",
          );
          expect(error.message).toMatch(/finite/iu);
        }),
    );

    it.effect("is one issue: one leaf and no multi-branch AnyOf", () =>
      Effect.gen(function* oneIssue() {
        const error = yield* failureOf(xml);

        const counts =
          error.reason._tag === "SchemaFailure"
            ? countOf(error.reason.cause.issue)
            : `reason ${error.reason._tag}`;

        expect(counts).toStrictEqual({ branches: 0, leaves: 1 });
      }),
    );

    it.effect("has a one-line message", () =>
      Effect.gen(function* oneLine() {
        const error = yield* failureOf(xml);

        expect(error.message).not.toMatch(/[\r\n]/u);
      }),
    );
  });

  it.effect("rejects an undeclared root attribute with the declared set in the message", () =>
    Effect.gen(function* undeclared() {
      const error = yield* failureOf(
        variant(
          'identifier="example-true-false-water"',
          'identifier="example-true-false-water" foo="1"',
        ),
      );

      expect(error.path).toBe("/qti-assessment-item/@foo");
      expect(error.message).toContain("identifier");
      expect(error.message).toContain("title");
    }),
  );

  it.effect("rejects a non-boolean time-dependent naming the boolean literals", () =>
    Effect.gen(function* notBoolean() {
      const error = yield* failureOf(variant('time-dependent="false"', 'time-dependent="maybe"'));

      expect(error.path).toBe("/qti-assessment-item/@time-dependent");
      expect(error.message).toMatch(/"true" \| "false"/u);
    }),
  );
  describe("line and column on the three breakages", () => {
    it.effect("positions a bad attribute value at its element's start tag", () =>
      Effect.gen(function* badAttribute() {
        const error = yield* failureOf(variant('max-choices="1"', 'max-choices="x"'));

        expect(error.position).toStrictEqual({ column: 5, line: 23 });
        expect(error.message).toMatch(
          / at \/qti-assessment-item\/qti-item-body\/qti-choice-interaction\/@max-choices \(line 23, column 5\): /u,
        );
        expect(error.message).toMatch(/finite/iu);
        expect(error.message).not.toMatch(/[\r\n]/u);
      }),
    );

    it.effect("positions a missing required child at the parent's start tag", () =>
      Effect.gen(function* missingChild() {
        const start = fixture.indexOf("<qti-item-body>");
        const closing = "</qti-item-body>";
        const end = fixture.indexOf(closing) + closing.length;

        expect(start).toBeGreaterThan(0);
        expect(end).toBeGreaterThan(start);

        const error = yield* failureOf(fixture.slice(0, start) + fixture.slice(end));

        expect(error.path).toBe("/qti-assessment-item");
        expect(error.message).toContain("qti-item-body");
        expect(error.position).toStrictEqual({ column: 1, line: 2 });
        expect(error.message).not.toMatch(/[\r\n]/u);
      }),
    );

    it.effect("positions an unknown element at its own start tag", () =>
      Effect.gen(function* unknownElement() {
        const error = yield* failureOf(variant("<p>At sea level", "<p><em>x</em>At sea level"));

        expect(error.path).toMatch(/p\/em$/u);
        expect(error.message).toMatch(/declared members: br, qti-text-entry-interaction, math/u);
        expect(error.position).toStrictEqual({ column: 8, line: 22 });
        expect(error.message).not.toMatch(/[\r\n]/u);
      }),
    );
  });
});
