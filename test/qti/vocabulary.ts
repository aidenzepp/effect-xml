/**
 * A QTI 3.0 vocabulary declared as a consumer would: only the public `@aidenzepp/effect-xml` entry
 * point and `effect/Schema`.
 *
 * The definitions above the extension marker are the leaf part of the benchmark subset of
 * `docs/rd/branches/declaration-dsl.md`. Below the marker are the elements the four M1 acceptance
 * fixtures add, followed by the benchmark elements whose member lists reach them (`p`,
 * `qti-prompt`, `qti-choice-interaction`, `qti-item-body`, `qti-assessment-item`): a definition is
 * a `const`, so it follows every definition it names. Every definition is exported so other tests
 * under `test/qti/` reuse the body members and the root without editing this file. Child slots of
 * `elements` content are written in QTI authoring order, because encode emits children in
 * declared slot order.
 */
import * as Schema from "effect/Schema";

import { XmlSchema } from "../../src/index.ts";

/**
 * The QTI 3.0 namespace, the default element namespace of the vocabulary.
 */
export const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The XML Schema instance namespace, bound to `xsi` for `xsi:schemaLocation`.
 */
export const XSI = "http://www.w3.org/2001/XMLSchema-instance";

/**
 * The declaration builders bound to the QTI default namespace and the `xsi` prefix.
 */
export const qti = XmlSchema.namespaces({ "": QTI, xsi: XSI });

/**
 * A QTI identifier: the string that names an item, a declaration, or a choice.
 */
export const Identifier = Schema.String.pipe(Schema.brand("Identifier"));

/**
 * The cardinality of a response or outcome variable.
 */
export const Cardinality = Schema.Literals(["single", "multiple", "ordered", "record"]);

/**
 * One value of a variable, carried as text.
 */
export const Value = qti.Element("qti-value", { content: XmlSchema.text(Schema.String) });

/**
 * The correct value or values of a response variable.
 */
export const CorrectResponse = qti.Element("qti-correct-response", {
  content: XmlSchema.elements({ values: XmlSchema.many(Value) }),
});

/**
 * One key-to-score pair of a response mapping.
 */
export const MapEntry = qti.Element("qti-map-entry", {
  attributes: {
    "case-sensitive": Schema.optionalKey(Schema.Boolean),
    "map-key": Schema.String,
    "mapped-value": Schema.Number,
  },
});

/**
 * The mapping from response values to scores, with its default and bounds.
 */
export const Mapping = qti.Element("qti-mapping", {
  attributes: {
    "default-value": Schema.optionalKey(Schema.Number),
    "lower-bound": Schema.optionalKey(Schema.Number),
    "upper-bound": Schema.optionalKey(Schema.Number),
  },
  content: XmlSchema.elements({ entries: XmlSchema.many(MapEntry) }),
});

/**
 * The declaration of a response variable: its identity, cardinality, base type, correct
 * response, and mapping.
 */
export const ResponseDeclaration = qti.Element("qti-response-declaration", {
  attributes: {
    "base-type": Schema.optionalKey(Schema.String),
    cardinality: Cardinality,
    identifier: Identifier,
  },
  content: XmlSchema.elements({
    correctResponse: XmlSchema.optionalKey(CorrectResponse),
    mapping: XmlSchema.optionalKey(Mapping),
  }),
});

/**
 * The default value or values of an outcome variable.
 */
export const DefaultValue = qti.Element("qti-default-value", {
  content: XmlSchema.elements({ values: XmlSchema.many(Value) }),
});

/**
 * The declaration of an outcome variable: its identity, cardinality, base type, and default.
 */
export const OutcomeDeclaration = qti.Element("qti-outcome-declaration", {
  attributes: {
    "base-type": Schema.optionalKey(Schema.String),
    cardinality: Cardinality,
    identifier: Identifier,
  },
  content: XmlSchema.elements({ defaultValue: XmlSchema.optionalKey(DefaultValue) }),
});

/**
 * One choice of a choice interaction, identified for response matching.
 */
export const SimpleChoice = qti.Element("qti-simple-choice", {
  attributes: {
    "data-*": Schema.String,
    fixed: Schema.optionalKey(Schema.Boolean),
    identifier: Identifier,
  },
  content: XmlSchema.mixed([]),
});

/**
 * The response processing of an item, named by a standard template.
 */
export const ResponseProcessing = qti.Element("qti-response-processing", {
  attributes: { template: Schema.optionalKey(Schema.String) },
});

// --- extension beyond the benchmark subset

/**
 * The MathML namespace, the default element namespace of the MathML builders.
 */
export const MATHML = "http://www.w3.org/1998/Math/MathML";

/**
 * The declaration builders bound to the MathML default namespace, for the formulas QTI embeds as
 * `<math xmlns="http://www.w3.org/1998/Math/MathML">`.
 */
export const mathml = XmlSchema.namespaces({ "": MATHML });

/**
 * A MathML identifier, such as a variable or function name.
 */
export const Mi = mathml.Element("mi", { content: XmlSchema.text(Schema.String) });

/**
 * A MathML number.
 */
export const Mn = mathml.Element("mn", { content: XmlSchema.text(Schema.String) });

/**
 * A MathML operator, with the presentation class QTI authors put on it.
 */
export const Mo = mathml.Element("mo", {
  attributes: { class: Schema.optionalKey(Schema.String) },
  content: XmlSchema.text(Schema.String),
});

/**
 * The decoded value of a MathML `mrow`: text runs mixed with tokens, fenced groups, and nested
 * rows.
 *
 * `mrow` nests itself directly and through `mfenced`, so its value type is named here and the
 * codec is annotated with it; the inferred type would otherwise refer to itself.
 */
export interface MrowValue {
  readonly $children: readonly (
    | { readonly _tag: "$text"; readonly text: string }
    | { readonly _tag: "mi"; readonly value: (typeof Mi)["Type"] }
    | { readonly _tag: "mn"; readonly value: (typeof Mn)["Type"] }
    | { readonly _tag: "mo"; readonly value: (typeof Mo)["Type"] }
    | { readonly _tag: "mfenced"; readonly value: (typeof Mfenced)["Type"] }
    | { readonly _tag: "mrow"; readonly value: MrowValue }
  )[];
}

/**
 * A group of MathML expressions wrapped in fences, parentheses by default.
 */
export const Mfenced = mathml.Element("mfenced", {
  // oxlint-disable-next-line no-use-before-define -- mrow and mfenced nest each other; suspend defers the read.
  content: XmlSchema.mixed([mathml.suspend("mrow", () => Mrow)]),
});

/**
 * A horizontal row of MathML expressions.
 */
export const Mrow: XmlSchema.Element<"mrow", MrowValue> = mathml.Element("mrow", {
  content: XmlSchema.mixed([Mi, Mn, Mo, Mfenced, mathml.suspend("mrow", () => Mrow)]),
});

/**
 * The root of an embedded MathML formula.
 */
export const MathElement = mathml.Element("math", { content: XmlSchema.mixed([Mrow]) });

/**
 * A line break inside a run of text.
 */
export const Br = qti.Element("br");

/**
 * An interaction that asks the candidate to type a short answer inline with the text.
 */
export const TextEntryInteraction = qti.Element("qti-text-entry-interaction", {
  attributes: { "response-identifier": Identifier },
});

/**
 * A paragraph of item body text, with inline line breaks, text entries, and formulas.
 */
export const P = qti.Element("p", {
  attributes: { "data-*": Schema.String },
  content: XmlSchema.mixed([Br, TextEntryInteraction, MathElement]),
});

/**
 * The prompt of an interaction: text runs mixed with paragraphs.
 */
export const Prompt = qti.Element("qti-prompt", { content: XmlSchema.mixed([P]) });

/**
 * An interaction that asks the candidate to select among simple choices.
 */
export const ChoiceInteraction = qti.Element("qti-choice-interaction", {
  attributes: {
    "max-choices": Schema.Int,
    "min-choices": Schema.optionalKey(Schema.Int),
    "response-identifier": Identifier,
  },
  // oxlint-disable-next-line sort-keys -- slot order is encode order; QTI puts the prompt first.
  content: XmlSchema.elements({
    prompt: XmlSchema.optionalKey(Prompt),
    choices: XmlSchema.many(SimpleChoice),
  }),
});

/**
 * An image, sized in pixels.
 */
export const Img = qti.Element("img", {
  attributes: {
    alt: Schema.String,
    height: Schema.optionalKey(Schema.Int),
    src: Schema.String,
    width: Schema.optionalKey(Schema.Int),
  },
});

/**
 * One selectable area of a hotspot image, located by a shape and its coordinates.
 */
export const HotspotChoice = qti.Element("qti-hotspot-choice", {
  attributes: {
    coords: Schema.String,
    identifier: Identifier,
    // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- QTI names this attribute `shape`.
    shape: Schema.String,
  },
});

/**
 * An interaction that asks the candidate to select areas of an image.
 */
export const HotspotInteraction = qti.Element("qti-hotspot-interaction", {
  attributes: {
    "max-choices": Schema.Int,
    "min-choices": Schema.optionalKey(Schema.Int),
    "response-identifier": Identifier,
  },
  /* oxlint-disable sort-keys -- slot order is encode order; QTI puts prompt, image, choices. */
  content: XmlSchema.elements({
    prompt: XmlSchema.optionalKey(Prompt),
    image: Img,
    choices: XmlSchema.many(HotspotChoice),
  }),
  /* oxlint-enable sort-keys */
});

/**
 * A quotation set off from the surrounding text.
 */
export const Blockquote = qti.Element("blockquote", {
  attributes: { class: Schema.optionalKey(Schema.String) },
  content: XmlSchema.mixed([P]),
});

/**
 * An embedded external resource, with fallback content shown in its place.
 */
export const ObjectElement = qti.Element("object", {
  attributes: { data: Schema.String, type: Schema.String },
  content: XmlSchema.mixed([Blockquote]),
});

/**
 * An interaction that asks the candidate for a free-text answer of one or more lines.
 */
export const ExtendedTextInteraction = qti.Element("qti-extended-text-interaction", {
  attributes: {
    class: Schema.optionalKey(Schema.String),
    "data-*": Schema.String,
    "expected-length": Schema.optionalKey(Schema.Int),
    format: Schema.optionalKey(Schema.String),
    "pattern-mask": Schema.optionalKey(Schema.String),
    "response-identifier": Identifier,
  },
  content: XmlSchema.elements({ prompt: XmlSchema.optionalKey(Prompt) }),
});

/**
 * The decoded value of a `div`: its class and text runs mixed with block content and nested
 * divisions.
 *
 * `div` nests itself, so its value type is named here and the codec is annotated with it; the
 * inferred type would otherwise refer to itself.
 */
export interface DivValue {
  readonly class?: string;
  readonly $children: readonly (
    | { readonly _tag: "$text"; readonly text: string }
    | { readonly _tag: "p"; readonly value: (typeof P)["Type"] }
    | { readonly _tag: "blockquote"; readonly value: (typeof Blockquote)["Type"] }
    | { readonly _tag: "object"; readonly value: (typeof ObjectElement)["Type"] }
    | {
        readonly _tag: "qti-extended-text-interaction";
        readonly value: (typeof ExtendedTextInteraction)["Type"];
      }
    | { readonly _tag: "div"; readonly value: DivValue }
  )[];
}

/**
 * A generic block that groups body content, nested to any depth.
 */
export const Div: XmlSchema.Element<"div", DivValue> = qti.Element("div", {
  attributes: { class: Schema.optionalKey(Schema.String) },
  content: XmlSchema.mixed([
    P,
    Blockquote,
    ObjectElement,
    ExtendedTextInteraction,
    qti.suspend("div", () => Div),
  ]),
});

/**
 * The content shown to the candidate: text runs mixed with block content and interactions.
 */
export const ItemBody = qti.Element("qti-item-body", {
  attributes: { "data-*": Schema.String },
  content: XmlSchema.mixed([P, Div, ChoiceInteraction, HotspotInteraction]),
});

/**
 * The root of a QTI item: its identity and its declarations, body, and response processing.
 *
 * Namespace declarations are not attributes here: the codec derives `xmlns` and `xmlns:xsi` from
 * the prefix map, so declaring them would duplicate the declarations on encode.
 */
export const AssessmentItem = qti.Element("qti-assessment-item", {
  attributes: {
    adaptive: Schema.optionalKey(Schema.Boolean),
    identifier: Identifier,
    "time-dependent": Schema.Boolean,
    title: Schema.String,
    "xml:lang": Schema.optionalKey(Schema.String),
    "xsi:schemaLocation": Schema.optionalKey(Schema.String),
  },
  /* oxlint-disable sort-keys -- slot order is encode order, which must follow QTI authoring order. */
  content: XmlSchema.elements({
    responseDeclarations: XmlSchema.many(ResponseDeclaration),
    outcomeDeclarations: XmlSchema.many(OutcomeDeclaration),
    body: ItemBody,
    responseProcessing: XmlSchema.optionalKey(ResponseProcessing),
  }),
  /* oxlint-enable sort-keys */
});
