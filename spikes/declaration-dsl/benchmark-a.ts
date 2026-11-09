// Benchmark subset (docs/rd/branches/declaration-dsl.md) in approach A: annotated Schema fields.
import * as Schema from "effect/Schema";
import {
  attribute,
  dataAttributes,
  element,
  type ElementCodec,
  mixed,
  type MixedItem,
  suspend,
  text,
} from "./xml-annotations.js";

export const Identifier = Schema.String.pipe(Schema.brand("Identifier"));
const Cardinality = Schema.Literals(["single", "multiple", "ordered", "record"]);
const data = dataAttributes(Schema.String);

export const Value = element("qti-value", Schema.Struct({ text: Schema.String.pipe(text()) }));
export const CorrectResponse = element(
  "qti-correct-response",
  Schema.Struct({ values: Schema.Array(Value) }),
);
export const ResponseDeclaration = element(
  "qti-response-declaration",
  Schema.Struct({
    identifier: Identifier.pipe(attribute()),
    cardinality: Cardinality.pipe(attribute()),
    baseType: Schema.optionalKey(Schema.String.pipe(attribute("base-type"))),
    correctResponse: Schema.optionalKey(CorrectResponse),
  }),
);
export const DefaultValue = element(
  "qti-default-value",
  Schema.Struct({ values: Schema.Array(Value) }),
);
export const OutcomeDeclaration = element(
  "qti-outcome-declaration",
  Schema.Struct({
    identifier: Identifier.pipe(attribute()),
    cardinality: Cardinality.pipe(attribute()),
    baseType: Schema.optionalKey(Schema.String.pipe(attribute("base-type"))),
    defaultValue: Schema.optionalKey(DefaultValue),
  }),
);
export const P = element(
  "p",
  Schema.StructWithRest(Schema.Struct({ text: Schema.String.pipe(text()) }), [data]),
);
export const Prompt = element("qti-prompt", Schema.Struct({ text: Schema.String.pipe(text()) }));
export const SimpleChoice = element(
  "qti-simple-choice",
  Schema.StructWithRest(
    Schema.Struct({
      identifier: Identifier.pipe(attribute()),
      fixed: Schema.optionalKey(Schema.Boolean.pipe(attribute())),
      text: Schema.String.pipe(text()),
    }),
    [data],
  ),
);
export const ChoiceInteraction = element(
  "qti-choice-interaction",
  Schema.StructWithRest(
    Schema.Struct({
      responseIdentifier: Identifier.pipe(attribute("response-identifier")),
      maxChoices: Schema.Int.pipe(attribute("max-choices")),
      minChoices: Schema.optionalKey(Schema.Int.pipe(attribute("min-choices"))),
      prompt: Schema.optionalKey(Prompt),
      choices: Schema.Array(SimpleChoice),
    }),
    [data],
  ),
);
// --- extension beyond the benchmark subset: decodes bpig-hotspot.xml and exercises recursion ---
export const Img = element(
  "img",
  Schema.Struct({
    src: Schema.String.pipe(attribute()),
    width: Schema.optionalKey(Schema.Int.pipe(attribute())),
    height: Schema.optionalKey(Schema.Int.pipe(attribute())),
    alt: Schema.optionalKey(Schema.String.pipe(attribute())),
  }),
);
export const HotspotChoice = element(
  "qti-hotspot-choice",
  Schema.Struct({
    identifier: Identifier.pipe(attribute()),
    shape: Schema.Literals(["circle", "rect", "poly", "default"]).pipe(attribute()),
    coords: Schema.String.pipe(attribute()),
  }),
);
export const HotspotInteraction = element(
  "qti-hotspot-interaction",
  Schema.Struct({
    responseIdentifier: Identifier.pipe(attribute("response-identifier")),
    maxChoices: Schema.Int.pipe(attribute("max-choices")),
    prompt: Schema.optionalKey(Prompt),
    image: Img,
    choices: Schema.Array(HotspotChoice),
  }),
);
export const ResponseProcessing = element(
  "qti-response-processing",
  Schema.Struct({ template: Schema.optionalKey(Schema.String.pipe(attribute())) }),
);
export interface Div {
  readonly children: ReadonlyArray<MixedItem<readonly [typeof P, ElementCodec<"div", Div>]>>;
  readonly [key: `data-${string}`]: string;
}
export const Div: ElementCodec<"div", Div> = element(
  "div",
  Schema.StructWithRest(Schema.Struct({ children: mixed([P, suspend("div", () => Div)]) }), [data]),
);
// --- end extension ---
export const ItemBody = element(
  "qti-item-body",
  Schema.StructWithRest(
    Schema.Struct({ children: mixed([P, ChoiceInteraction, HotspotInteraction, Div]) }),
    [data],
  ),
);
export const AssessmentItem = element(
  "qti-assessment-item",
  Schema.Struct({
    identifier: Identifier.pipe(attribute()),
    title: Schema.String.pipe(attribute()),
    timeDependent: Schema.Boolean.pipe(attribute("time-dependent")),
    lang: Schema.optionalKey(Schema.String.pipe(attribute("xml:lang"))),
    xmlns: Schema.String.pipe(attribute()),
    xmlnsXsi: Schema.optionalKey(Schema.String.pipe(attribute("xmlns:xsi"))),
    schemaLocation: Schema.optionalKey(Schema.String.pipe(attribute("xsi:schemaLocation"))),
    responseDeclarations: Schema.Array(ResponseDeclaration),
    outcomeDeclarations: Schema.Array(OutcomeDeclaration),
    body: ItemBody,
    responseProcessing: Schema.optionalKey(ResponseProcessing),
  }),
);
