/**
 * The sax adapter: the `sax/events` case counts every start tag, and the exported profile matches
 * the probes run against the strict parser.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import sax from "sax";

import { cases, libraries } from "../../bench/cases/sax.ts";
import { chunk } from "../../bench/inputs/chunk.ts";
import { countElements } from "../../bench/inputs/reference.ts";
import type { BenchInput } from "../../bench/types.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";

/**
 * One item-bank record in the synthetic bank's template.
 *
 * @param i - The record index.
 * @returns The record's XML text.
 */
const record = (
  i: number,
) => `  <qti-assessment-item-ref identifier="item-${i}" href="items/item-${i}.xml" category="section-${i % 8}" required="true" fixed="false">
    <qti-weight identifier="W${i % 4}" value="${(i % 10) / 2 + 0.5}"/>
    <qti-branch-rule target="item-${i + 1}">
      <qti-match>
        <qti-variable identifier="SCORE-${i}"/>
        <qti-correct identifier="RESPONSE-${i}"/>
      </qti-match>
    </qti-branch-rule>
  </qti-assessment-item-ref>
`;

/**
 * An item bank of two records.
 */
const twoRecordBank = `<?xml version="1.0" encoding="UTF-8"?>
<qti-item-bank xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
${record(0)}${record(1)}</qti-item-bank>
`;

/**
 * Build a one-document input whose element count is read from the upstream tokenizer.
 *
 * @param id - The input id.
 * @param text - The document text.
 * @param records - The number of item-bank records the document holds.
 * @returns The input, failing with the tokenizer's error on malformed text.
 */
const inputOf = Effect.fnUntraced(function* inputOf(id: string, text: string, records: number) {
  const elements = yield* countElements(text);

  const input: BenchInput = {
    bytes: new TextEncoder().encode(text).length,
    documents: [{ chunks: chunk(text, 256), name: id, text }],
    family: "synthetic",
    id,
    reference: { elements, records },
  };

  return input;
});

/**
 * What a strict sax parser reported for one document.
 */
interface Probe {
  readonly tags: readonly (sax.Tag | sax.QualifiedTag)[];
  readonly text: string;
}

/**
 * Parse one document with the strict parser the case uses, recording its tags and text.
 *
 * @param chunks - The document's text, written to the parser one chunk at a time.
 * @returns The tags and joined text, failing when sax throws on malformed input.
 */
const probe = (...chunks: readonly string[]): Effect.Effect<Probe, unknown> =>
  Effect.try(() => {
    const parser = sax.parser(true);
    const tags: (sax.Tag | sax.QualifiedTag)[] = [];
    const texts: string[] = [];

    parser.onopentag = (tag) => {
      tags.push(tag);
    };

    // oxlint-disable-next-line unicorn/prefer-add-event-listener -- a sax parser is not an EventTarget; handler properties are its only event API.
    parser.ontext = (text) => {
      texts.push(text);
    };

    for (const text of chunks) {
      parser.write(text);
    }

    parser.close();

    return { tags, text: texts.join("") };
  });

describe("sax/events", () => {
  it.effect("counts every start tag of a two-record bank and of bg007", () =>
    Effect.gen(function* countsStartTags() {
      const bg007 = readFileSync(
        new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url),
        "utf-8",
      );

      const inputs = [
        yield* inputOf("bank-two", twoRecordBank, 2),
        yield* inputOf("bg007", bg007, 0),
      ];

      expect(cases.map((benchCase) => benchCase.id)).toStrictEqual(["sax/events"]);

      for (const benchCase of cases) {
        for (const input of inputs) {
          const prepared = yield* benchCase.prepare(input, defaultTokenizer);

          expect(prepared.check(prepared.run(() => {}))).toBe(prepared.expected);
          expect(prepared.expected).toBe(input.reference.elements);
        }
      }
    }),
  );

  it("accepts every input but the bad-last ones", () => {
    const [events] = cases;

    expect(events?.accepts({ family: "synthetic", id: "bank-4m" })).toBe(true);
    expect(events?.accepts({ family: "corpus", id: "corpus-all" })).toBe(true);
    expect(events?.accepts({ family: "synthetic", id: "bank-4m-bad-last" })).toBe(false);
  });
});

describe("sax profile", () => {
  it.effect("matches the probes run against the strict parser", () =>
    Effect.gen(function* matchesProbes() {
      const malformed = yield* Effect.exit(probe("<a><b></a>"));
      const namespaced = yield* probe(`<p:a xmlns:p="urn:x"/>`);
      const entity = yield* probe("<a>&amp;</a>");
      const doctype = yield* Effect.exit(probe(`<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>`));
      const chunked = yield* probe("<a><", "b/></a>");
      const parser = sax.parser(true);

      expect(libraries.map((profile) => profile.library)).toStrictEqual(["sax"]);
      expect(libraries[0]).toMatchObject({
        decodesEntities: entity.text === "&",
        expandsDoctypeEntities: Exit.isSuccess(doctype) && doctype.value.text === "x",
        rejectsMalformed: Exit.isFailure(malformed),
        reportsPositions: [parser.line, parser.column, parser.position].every(Predicate.isNumber),
        resolvesNamespaces: namespaced.tags.some(
          (tag) => Predicate.hasProperty(tag, "uri") && tag.uri === "urn:x",
        ),
        streams: chunked.tags.length === 2,
        typed: false,
      });
    }),
  );
});
