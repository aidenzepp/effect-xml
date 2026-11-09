// Shared fixtures for the effect-native-api spike: the README example definitions (copied from the
// `readme:start` region of test/readme.test.ts, which imports vitest and cannot be imported here),
// the bg007 fixture text, and a span-recording tracer.
/* oxlint-disable sort-keys -- slot order is encode order. */
import { readFileSync } from "node:fs";

import { Effect, Schema, Tracer } from "effect";

import { elements, many, namespaces, optional, text } from "../../src/index.ts";

export const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const { element } = namespaces({ "": QTI });

export const SimpleChoice = element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: text(Schema.String),
});

export const Prompt = element("qti-prompt", { content: text(Schema.String) });

export const ChoiceInteraction = element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: elements({ prompt: optional(Prompt), choices: many(SimpleChoice) }),
});

export const readmeXml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

export const readmeBadXml = readmeXml.replace('max-choices="1"', 'max-choices="x"');

export const bg007 = readFileSync(
  new URL("../fixtures/qti/bg007-true-false.xml", import.meta.url),
  "utf8",
);

/**
 * Bg007 with a bad boolean on the root, line 9.
 */
export const bg007Bad = bg007.replace('time-dependent="false"', 'time-dependent="nope"');

/**
 * Run `effect` with a tracer that records every span name opened, and return both.
 */
export const withSpans = <A, E>(effect: Effect.Effect<A, E>) => {
  const names: string[] = [];
  const tracer = Tracer.make({
    span(options) {
      names.push(options.name);
      return new Tracer.NativeSpan(options);
    },
  });
  const exit = Effect.runSyncExit(Effect.withTracer(effect, tracer));
  return { exit, names };
};

export const line = (label: string, value: unknown) =>
  console.log(`${label}:`, typeof value === "string" ? value : JSON.stringify(value));
