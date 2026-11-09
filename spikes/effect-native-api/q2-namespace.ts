// Q2 runs: the README example rewritten against the namespace module, next to Effect's own Xml.
/* oxlint-disable sort-keys -- slot order is encode order. */
import { Effect, Schema } from "effect";
import * as Xml from "effect/encoding/Xml";

import { XmlSchema } from "./index-variant.ts";
import { line } from "./shared.ts";

// readme:start (namespace shape)
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const { element } = XmlSchema.namespaces({ "": QTI });

const SimpleChoice = element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: XmlSchema.text(Schema.String),
});

const Prompt = element("qti-prompt", { content: XmlSchema.text(Schema.String) });

const ChoiceInteraction = element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: XmlSchema.elements({
    prompt: XmlSchema.optionalKey(Prompt),
    choices: XmlSchema.Array(SimpleChoice),
  }),
});

const Document = XmlSchema.fromString(ChoiceInteraction);

const xml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

const value = Schema.decodeUnknownSync(Document)(xml);

const encoded = Schema.encodeSync(Document)(value);

const failure = Effect.runSync(
  Effect.flip(
    Schema.decodeUnknownEffect(Document)(xml.replace('max-choices="1"', 'max-choices="x"')),
  ),
);

console.log(failure.message);
// readme:end

// readme:round-trip (namespace shape)
const Tree = XmlSchema.ElementFromString({ "": QTI });
const same = XmlSchema.equivalence(ChoiceInteraction)(
  Schema.decodeUnknownSync(Tree)(xml),
  Schema.decodeUnknownSync(Tree)(encoded),
);
// readme:round-trip-end

line("value.max-choices", value["max-choices"]);
line("round trip", same);
// Side by side with upstream: no name collides, because both are namespaces.
line("Xml.decodeString is still the upstream channel", typeof Xml.decodeString);
line("XmlSchema.decodeSchemaString is the typed channel", typeof XmlSchema.decodeSchemaString);
