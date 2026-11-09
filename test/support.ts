import { readFileSync } from "node:fs";

import { expect } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Tracer from "effect/Tracer";

import { namespaces } from "../src/dsl.ts";
import type { XmlDecodeError } from "../src/issue.ts";
import { elements, many } from "../src/plan.ts";

/**
 * The QTI 3.0 namespace, the default element namespace of the item-ref vocabulary.
 */
export const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The declaration builders bound to the QTI default namespace.
 */
const qti = namespaces({ "": QTI });

/**
 * The text of the QTI assessment test fixture whose item refs the item-ref vocabulary below covers.
 */
export const fixtureText = readFileSync(
  new URL("../spikes/fixtures/qti/test-features.xml", import.meta.url),
  "utf-8",
);

/**
 * The item-ref vocabulary's `qti-weight`: an empty element with an identifier and a finite value.
 */
export const Weight = qti.Element("qti-weight", {
  attributes: { identifier: Schema.String, value: Schema.Finite },
});

/**
 * The item-ref vocabulary's `qti-variable`: an empty element naming an outcome identifier.
 */
export const Variable = qti.Element("qti-variable", { attributes: { identifier: Schema.String } });

/**
 * The item-ref vocabulary's `qti-correct`: an empty element naming a response identifier.
 */
export const Correct = qti.Element("qti-correct", { attributes: { identifier: Schema.String } });

/**
 * The item-ref vocabulary's `qti-match`: one variable compared with one correct response.
 */
export const Match = qti.Element("qti-match", {
  content: elements({ correct: Correct, variable: Variable }),
});

/**
 * The item-ref vocabulary's `qti-branch-rule`: a target item and the match that selects it.
 */
export const BranchRule = qti.Element("qti-branch-rule", {
  attributes: { target: Schema.String },
  content: elements({ match: Match }),
});

/**
 * The item-ref vocabulary's `qti-assessment-item-ref`, the record the whole-document and channel
 * tests decode.
 */
export const ItemRef = qti.Element("qti-assessment-item-ref", {
  attributes: {
    category: Schema.optionalKey(Schema.String),
    fixed: Schema.optionalKey(Schema.Boolean),
    href: Schema.String,
    identifier: Schema.String,
    required: Schema.optionalKey(Schema.Boolean),
  },
  content: elements({ rules: many(BranchRule), weights: many(Weight) }),
});

/**
 * Run `effect` under a recording tracer and return its exit-independent span names.
 *
 * @param effect - The effect to run; its success and failure are both discarded.
 * @returns The span names the tracer created, in creation order.
 */
export const spanNames = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* recordSpans() {
    const names: string[] = [];

    const tracer = Tracer.make({
      span: (options) => {
        names.push(options.name);

        return new Tracer.NativeSpan(options);
      },
    });

    yield* effect.pipe(Effect.exit, Effect.withTracer(tracer));

    return names;
  });

/**
 * Run `effect` under a recording tracer and return each span's name with the exit it ended with.
 *
 * @param effect - The effect to run; its success and failure are both discarded.
 * @returns One entry per span the tracer created, in creation order; `exit` is `undefined` for a
 *   span that never ended.
 */
export const endedSpans = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* recordEnds() {
    const spans: Tracer.NativeSpan[] = [];

    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);

        spans.push(span);

        return span;
      },
    });

    yield* effect.pipe(Effect.exit, Effect.withTracer(tracer));

    return spans.map(({ name, status }) => ({
      exit: status._tag === "Ended" ? status.exit : undefined,
      name,
    }));
  });

/**
 * Assert that `effect` opens exactly one span named `name` and that the span ends in failure.
 *
 * @param name - The expected span name.
 * @param effect - The failing operation.
 * @returns An effect that succeeds once the assertions hold.
 */
export const expectFailedSpan = (name: string, effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* failedSpan() {
    const spans = yield* endedSpans(effect);

    expect(spans.map((span) => span.name)).toStrictEqual([name]);
    expect(spans[0]?.exit !== undefined && Exit.isFailure(spans[0].exit)).toBe(true);
  });

/**
 * Count the issues a `SchemaFailure` reason's cause holds, as a Standard Schema formatter lists
 * them.
 *
 * @param error - The decode failure.
 * @returns The issue count of a `SchemaFailure` reason, otherwise 0.
 */
export const issueCount = (error: XmlDecodeError): number =>
  error.reason._tag === "SchemaFailure"
    ? SchemaIssue.makeFormatterStandardSchemaV1()(error.reason.cause.issue).issues.length
    : 0;

/**
 * The service a service-typed probe codec reads while decoding an attribute.
 */
export class Upper extends Context.Service<Upper, { readonly f: (s: string) => string }>()(
  "Upper",
) {}
