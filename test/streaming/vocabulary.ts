/**
 * The assessment-test vocabulary the streaming tests decode, declared as a consumer would: only
 * the public `@aidenzepp/effect-xml` entry point, `effect/Option`, and `effect/Schema`.
 *
 * The item-ref definitions follow the fixture `spikes/fixtures/qti/test-features.xml`. The test
 * root is minimal because a `Limit` fires in the record collector before any Schema runs.
 */
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { XmlSchema } from "../../src/index.ts";

/**
 * The QTI 3.0 namespace, the default element namespace of the vocabulary.
 */
export const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The XML Schema instance namespace, bound to `xsi`.
 */
export const XSI = "http://www.w3.org/2001/XMLSchema-instance";

/**
 * The declaration builders bound to the QTI default namespace and the `xsi` prefix.
 */
const qti = XmlSchema.namespaces({ "": QTI, xsi: XSI });

/**
 * A `qti-variable` reference to a named variable; the element is empty.
 */
export const Variable = qti.Element("qti-variable", {
  attributes: { identifier: Schema.String },
});

/**
 * A `qti-correct` reference to the correct value of a named variable; the element is empty.
 */
export const Correct = qti.Element("qti-correct", {
  attributes: { identifier: Schema.String },
});

/**
 * A `qti-match` comparing a variable with a correct value.
 */
export const Match = qti.Element("qti-match", {
  content: XmlSchema.elements({ correct: Correct, variable: Variable }),
});

/**
 * A `qti-branch-rule` that jumps to `target` when its match holds.
 */
export const BranchRule = qti.Element("qti-branch-rule", {
  attributes: { target: Schema.String },
  content: XmlSchema.elements({ match: Match }),
});

/**
 * A `qti-weight` giving an item reference a numeric weight; the element is empty.
 */
export const Weight = qti.Element("qti-weight", {
  attributes: { identifier: Schema.String, value: Schema.Finite },
});

/**
 * A `qti-assessment-item-ref`, the record the streaming tests decode one at a time.
 */
export const ItemRef = qti.Element("qti-assessment-item-ref", {
  attributes: {
    category: Schema.optionalKey(Schema.String),
    fixed: Schema.optionalKey(Schema.Boolean),
    href: Schema.String,
    identifier: Schema.String,
    required: Schema.optionalKey(Schema.Boolean),
  },
  content: XmlSchema.elements({
    rules: XmlSchema.Array(BranchRule),
    weights: XmlSchema.Array(Weight),
  }),
});

/**
 * A minimal `qti-assessment-test` root with no declared children.
 */
export const AssessmentTest = qti.Element("qti-assessment-test", {
  attributes: { identifier: Schema.String, title: Schema.optionalKey(Schema.String) },
  content: XmlSchema.elements({}),
});

/**
 * The root-anchored record path of every `qti-assessment-item-ref` in a test document.
 */
export const itemRefPath = [
  XmlSchema.clark(Option.some(QTI), "qti-assessment-test"),
  XmlSchema.clark(Option.some(QTI), "qti-test-part"),
  XmlSchema.clark(Option.some(QTI), "qti-assessment-section"),
  XmlSchema.clark(Option.some(QTI), "qti-assessment-item-ref"),
] as const;

/**
 * The root-anchored record path of the test element itself, which makes the whole document one
 * record.
 */
export const testPath = [XmlSchema.clark(Option.some(QTI), "qti-assessment-test")] as const;
