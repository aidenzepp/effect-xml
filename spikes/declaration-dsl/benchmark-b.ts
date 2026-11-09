// Benchmark subset (docs/rd/branches/declaration-dsl.md) in approach B: the object-form DSL.
import * as Schema from "effect/Schema";
import {
  element,
  type ElementCodec,
  elements,
  many,
  mixed,
  type MixedItem,
  optional,
  suspend,
  text,
} from "./xml-dsl.js";

export const Identifier = Schema.String.pipe(Schema.brand("Identifier"));
const Cardinality = Schema.Literals(["single", "multiple", "ordered", "record"]);

export const Value = element("qti-value", { content: text(Schema.String) });
export const CorrectResponse = element("qti-correct-response", {
  content: elements({ values: many(Value) }),
});
export const ResponseDeclaration = element("qti-response-declaration", {
  attributes: {
    identifier: Identifier,
    cardinality: Cardinality,
    "base-type": Schema.optionalKey(Schema.String),
  },
  content: elements({ correctResponse: optional(CorrectResponse) }),
});
export const DefaultValue = element("qti-default-value", {
  content: elements({ values: many(Value) }),
});
export const OutcomeDeclaration = element("qti-outcome-declaration", {
  attributes: {
    identifier: Identifier,
    cardinality: Cardinality,
    "base-type": Schema.optionalKey(Schema.String),
  },
  content: elements({ defaultValue: optional(DefaultValue) }),
});
export const P = element("p", {
  attributes: { "data-*": Schema.String },
  content: text(Schema.String),
});
export const Prompt = element("qti-prompt", { content: text(Schema.String) });
export const SimpleChoice = element("qti-simple-choice", {
  attributes: {
    identifier: Identifier,
    fixed: Schema.optionalKey(Schema.Boolean),
    "data-*": Schema.String,
  },
  content: text(Schema.String),
});
export const ChoiceInteraction = element("qti-choice-interaction", {
  attributes: {
    "response-identifier": Identifier,
    "max-choices": Schema.Int,
    "min-choices": Schema.optionalKey(Schema.Int),
    "data-*": Schema.String,
  },
  content: elements({ prompt: optional(Prompt), choices: many(SimpleChoice) }),
});
// --- extension beyond the benchmark subset: decodes bpig-hotspot.xml and exercises recursion ---
export const Img = element("img", {
  attributes: {
    src: Schema.String,
    width: Schema.optionalKey(Schema.Int),
    height: Schema.optionalKey(Schema.Int),
    alt: Schema.optionalKey(Schema.String),
  },
});
export const HotspotChoice = element("qti-hotspot-choice", {
  attributes: {
    identifier: Identifier,
    shape: Schema.Literals(["circle", "rect", "poly", "default"]),
    coords: Schema.String,
  },
});
export const HotspotInteraction = element("qti-hotspot-interaction", {
  attributes: { "response-identifier": Identifier, "max-choices": Schema.Int },
  content: elements({ prompt: optional(Prompt), image: Img, choices: many(HotspotChoice) }),
});
export const ResponseProcessing = element("qti-response-processing", {
  attributes: { template: Schema.optionalKey(Schema.String) },
});
export interface Div {
  readonly children: ReadonlyArray<MixedItem<readonly [typeof P, ElementCodec<"div", Div>]>>;
  readonly [key: `data-${string}`]: string;
}
export const Div: ElementCodec<"div", Div> = element("div", {
  attributes: { "data-*": Schema.String },
  content: mixed([P, suspend("div", () => Div)]),
});
// --- end extension ---
export const ItemBody = element("qti-item-body", {
  attributes: { "data-*": Schema.String },
  content: mixed([P, ChoiceInteraction, HotspotInteraction, Div]),
});
export const AssessmentItem = element("qti-assessment-item", {
  attributes: {
    identifier: Identifier,
    title: Schema.String,
    "time-dependent": Schema.Boolean,
    "xml:lang": Schema.optionalKey(Schema.String),
    xmlns: Schema.String,
    "xmlns:xsi": Schema.optionalKey(Schema.String),
    "xsi:schemaLocation": Schema.optionalKey(Schema.String),
  },
  content: elements({
    responseDeclarations: many(ResponseDeclaration),
    outcomeDeclarations: many(OutcomeDeclaration),
    body: ItemBody,
    responseProcessing: optional(ResponseProcessing),
  }),
});
