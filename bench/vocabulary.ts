/**
 * The synthetic item-bank vocabulary: a `qti-item-bank` root holding repeated
 * `qti-assessment-item-ref` records, declared from the streaming tests' `ItemRef`.
 */
import * as Option from "effect/Option";

import { XmlSchema } from "../src/index.ts";
import { ItemRef, QTI } from "../test/streaming/vocabulary.ts";

/**
 * The declaration builders bound to the QTI default namespace.
 */
const bank = XmlSchema.namespaces({ "": QTI });

/**
 * A `qti-item-bank` root whose children are the item-ref records, decoded as one document.
 */
export const ItemBank = bank.Element("qti-item-bank", {
  content: XmlSchema.elements({ refs: XmlSchema.Array(ItemRef) }),
});

/**
 * The root-anchored record path of every `qti-assessment-item-ref` in a bank, for the stream
 * class.
 */
export const bankPath = [
  XmlSchema.clark(Option.some(QTI), "qti-item-bank"),
  XmlSchema.clark(Option.some(QTI), "qti-assessment-item-ref"),
];

/**
 * The prefix map a bank encodes with: QTI as the default namespace.
 */
export const bankPrefixes = { "": QTI };
