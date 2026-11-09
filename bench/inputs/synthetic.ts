/**
 * The synthetic item-bank inputs at four sizes, and the bad-last variants for the error path.
 */
import { Buffer } from "node:buffer";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Record from "effect/Record";

import type { BenchInput } from "../types.ts";
import { chunk } from "./chunk.ts";

/**
 * The size and variant of one bank input: the UTF-8 byte target the records fill, and whether
 * the last record loses its required `href`.
 */
interface BankSpec {
  readonly target: number;
  readonly badLast: boolean;
}

/**
 * The input ids this module owns, in the shared contract's order: the four sizes ascending, then
 * the bad-last variants. The order lives here rather than in the keys of `banks`, which the
 * `sort-keys` lint keeps alphabetical.
 */
const bankIds = [
  "bank-16k",
  "bank-256k",
  "bank-4m",
  "bank-64m",
  "bank-256k-bad-last",
  "bank-4m-bad-last",
] as const;

/**
 * An input id this module owns.
 */
type BankId = (typeof bankIds)[number];

/**
 * Every bank input this module owns, keyed by input id; the bad-last ids share their base bank's
 * target so they are the same document with one attribute removed. The `satisfies` clause keeps
 * the keys exactly the ids in `bankIds`.
 */
const banks: Record.ReadonlyRecord<string, BankSpec> = {
  "bank-16k": { badLast: false, target: 16_384 },
  "bank-256k": { badLast: false, target: 262_144 },
  "bank-256k-bad-last": { badLast: true, target: 262_144 },
  "bank-4m": { badLast: false, target: 4_194_304 },
  "bank-4m-bad-last": { badLast: true, target: 4_194_304 },
  "bank-64m": { badLast: false, target: 67_108_864 },
} satisfies Record.ReadonlyRecord<BankId, BankSpec>;

/**
 * The input ids this module owns, in the shared contract's order.
 */
export const inputIds: readonly string[] = bankIds;

/**
 * The text before the first record: the XML declaration and the `qti-item-bank` start tag with
 * QTI as the default namespace.
 */
const header = `<?xml version="1.0" encoding="UTF-8"?>
<qti-item-bank xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
`;

/**
 * The text after the last record.
 */
const footer = `</qti-item-bank>
`;

/**
 * The elements each record contributes: the item ref, its weight, branch rule, match, variable,
 * and correct.
 */
const elementsPerRecord = 6;

/**
 * Render record `i` of the bank.
 *
 * @param i - The record index.
 * @param href - Whether the record carries its `href` attribute; `ItemRef` requires it, so a
 *   record without it fails a typed decode.
 * @returns The record's XML text, indented and newline-terminated.
 */
const record = (i: number, href: boolean): string => {
  const hrefAttribute = href ? ` href="items/item-${i}.xml"` : "";

  return `  <qti-assessment-item-ref identifier="item-${i}"${hrefAttribute} category="section-${i % 8}" required="true" fixed="false">
    <qti-weight identifier="W${i % 4}" value="${(i % 10) / 2 + 0.5}"/>
    <qti-branch-rule target="item-${i + 1}">
      <qti-match>
        <qti-variable identifier="SCORE-${i}"/>
        <qti-correct identifier="RESPONSE-${i}"/>
      </qti-match>
    </qti-branch-rule>
  </qti-assessment-item-ref>
`;
};

// Native: `Schema.toEncoderXml` and `XmlSchema.fromString(ItemBank)` encoding write their own whitespace and attribute layout, and lack the fixed record template the byte targets and reference counts are defined on.
/**
 * Generate one bank document in memory.
 *
 * Records are added until the whole document, footer included, reaches `spec.target` UTF-8
 * bytes, so it exceeds the target by less than the last record's length. The text depends only
 * on `spec`, so every load of an id yields the same string, and no file is written.
 *
 * @param id - The input id, which names the one document.
 * @param spec - The bank's target size and variant.
 * @returns The input with one document, its chunks, and the reference counts of its records.
 */
const generate = (id: string, spec: BankSpec): BenchInput => {
  const parts = [header];
  let bytes = Buffer.byteLength(header) + Buffer.byteLength(footer);
  let records = 0;

  while (bytes < spec.target) {
    const text = record(records, true);

    parts.push(text);
    bytes += Buffer.byteLength(text);
    records += 1;
  }

  if (spec.badLast) {
    parts[records] = record(records - 1, false);
  }

  parts.push(footer);

  const text = parts.join("");

  return {
    bytes: Buffer.byteLength(text),
    documents: [{ chunks: chunk(text), name: `${id}.xml`, text }],
    family: "synthetic",
    id,
    reference: { elements: 1 + elementsPerRecord * records, records },
  };
};

/**
 * Load one input this module owns.
 *
 * @param id - The input id to load.
 * @returns The generated input, or `None` when this module does not provide `id`.
 */
export const loadInput = (id: string): Effect.Effect<Option.Option<BenchInput>> =>
  Effect.sync(() => Option.map(Record.get(banks, id), (spec) => generate(id, spec)));
