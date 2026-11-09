import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";
import type { Xml } from "effect/encoding";

// Approach A: one `Schema.decodeTo` transformation per definition, from the
// upstream `Xml.Element` tree to the StringTree encoding of the target struct.
// Leaves (Finite, Boolean, Literals) are decoded by `toCodecStringTree`; the
// getter pair only reshapes Element <-> StringTree and is written by hand.

// ---------------------------------------------------------------------------
// Library side: the Element schema and small Element helpers.
// ---------------------------------------------------------------------------

export const ElementSchema: Schema.Codec<Xml.Element, Xml.Element> = Schema.Struct({
  name: Schema.String,
  attributes: Schema.Record(Schema.String, Schema.String),
  children: Schema.Array(Schema.Union([Schema.String, Schema.suspend(() => ElementSchema)])),
});

export const childElements = (element: Xml.Element, name: string): ReadonlyArray<Xml.Element> =>
  element.children.filter(
    (child): child is Xml.Element => typeof child !== "string" && child.name === name,
  );

export const textOf = (element: Xml.Element): string =>
  element.children.filter((child): child is string => typeof child === "string").join("");

const compact = (record: Record<string, Schema.StringTree>): Record<string, Schema.StringTree> =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

// ---------------------------------------------------------------------------
// Consumer side: the target struct (same shape as approach B) and the getters.
// ---------------------------------------------------------------------------

export const Identifier = Schema.String.pipe(Schema.brand("Identifier"));
export const Cardinality = Schema.Literals(["single", "multiple", "ordered", "record"]);

export const MapEntry = Schema.Struct({
  mapKey: Schema.String,
  mappedValue: Schema.Finite,
  caseSensitive: Schema.optionalKey(Schema.Boolean),
});

export const Mapping = Schema.Struct({
  defaultValue: Schema.optionalKey(Schema.Finite),
  entries: Schema.Array(MapEntry),
});

export const CorrectResponse = Schema.Struct({ values: Schema.Array(Schema.String) });

export const ResponseDeclaration = Schema.Struct({
  identifier: Identifier,
  baseType: Schema.String,
  cardinality: Cardinality,
  correctResponse: CorrectResponse,
  mapping: Schema.optionalKey(Mapping),
});

export type ResponseDeclaration = typeof ResponseDeclaration.Type;

const elementToTree = (element: Xml.Element): Schema.StringTree => {
  const correct = childElements(element, "qti-correct-response")[0];
  const mapping = childElements(element, "qti-mapping")[0];
  return compact({
    identifier: element.attributes.identifier,
    baseType: element.attributes["base-type"],
    cardinality: element.attributes.cardinality,
    correctResponse:
      correct === undefined
        ? undefined
        : { values: childElements(correct, "qti-value").map(textOf) },
    mapping:
      mapping === undefined
        ? undefined
        : compact({
            defaultValue: mapping.attributes["default-value"],
            entries: childElements(mapping, "qti-map-entry").map((entry) =>
              compact({
                mapKey: entry.attributes["map-key"],
                mappedValue: entry.attributes["mapped-value"],
                caseSensitive: entry.attributes["case-sensitive"],
              }),
            ),
          }),
  });
};

// The encode side sees the StringTree the struct produced; its shape is known
// only to this hand-written mapper, hence the cast.
interface DeclarationTree {
  readonly identifier: string;
  readonly baseType: string;
  readonly cardinality: string;
  readonly correctResponse: { readonly values: ReadonlyArray<string> };
  readonly mapping?: {
    readonly defaultValue?: string;
    readonly entries: ReadonlyArray<{
      readonly mapKey: string;
      readonly mappedValue: string;
      readonly caseSensitive?: string;
    }>;
  };
}

const attributes = (record: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

const treeToElement = (tree: Schema.StringTree): Xml.Element => {
  const d = tree as unknown as DeclarationTree;
  const children: Array<Xml.Element> = [
    {
      name: "qti-correct-response",
      attributes: {},
      children: d.correctResponse.values.map((value) => ({
        name: "qti-value",
        attributes: {},
        children: [value],
      })),
    },
  ];
  if (d.mapping !== undefined) {
    children.push({
      name: "qti-mapping",
      attributes: attributes({ "default-value": d.mapping.defaultValue }),
      children: d.mapping.entries.map((entry) => ({
        name: "qti-map-entry",
        attributes: attributes({
          "map-key": entry.mapKey,
          "mapped-value": entry.mappedValue,
          "case-sensitive": entry.caseSensitive,
        }),
        children: [],
      })),
    });
  }
  return {
    name: "qti-response-declaration",
    attributes: {
      identifier: d.identifier,
      "base-type": d.baseType,
      cardinality: d.cardinality,
    },
    children,
  };
};

export const ResponseDeclarationFromElement = ElementSchema.pipe(
  Schema.decodeTo(Schema.toCodecStringTree(ResponseDeclaration), {
    decode: SchemaGetter.transformEffect((element: Xml.Element) =>
      element.name === "qti-response-declaration"
        ? Effect.succeed(elementToTree(element))
        : Effect.fail(
            new SchemaIssue.InvalidValue(
              { message: `expected element <qti-response-declaration>, got <${element.name}>` },
              element,
            ),
          ),
    ),
    encode: SchemaGetter.transform(treeToElement),
  }),
);

export const decodeA = SchemaParser.decodeEffect(ResponseDeclarationFromElement);
export const encodeA = SchemaParser.encodeEffect(ResponseDeclarationFromElement);
