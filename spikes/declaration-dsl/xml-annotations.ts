// Approach A: annotations on ordinary Schema fields. The consumer writes a plain `Schema.Struct`
// (or `StructWithRest` for `data-*`), marks attribute and text fields, and `element` walks the
// struct's AST to lower it to a `Plan`.
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import {
  type ChildPlan,
  compile,
  type Element,
  type ElementCodec,
  type MixedItem,
  mixedSchema,
  type Plan,
  suspend,
  XML,
} from "./element-codec.js";

export { suspend };
export type { Element, ElementCodec, MixedItem };

/**
 * Marks a field as an attribute; `name` is the wire name when it differs from the field key.
 */
export const attribute =
  (name?: string) =>
  <S extends Schema.Top>(self: S) =>
    self.annotate({ [XML]: { role: "attribute", name } });

/**
 * Marks a field as the element's character data (text content mode).
 */
export const text =
  () =>
  <S extends Schema.Top>(self: S) =>
    self.annotate({ [XML]: { role: "text" } });

/**
 * Declares mixed content as a field; the field holds ordered, tagged text and element items.
 */
export const mixed = <const M extends ReadonlyArray<ElementCodec<string, unknown>>>(members: M) =>
  mixedSchema(members).annotate({ [XML]: { role: "mixed" } });

/**
 * The `data-*` attribute group, used as the rest record of a `Schema.StructWithRest`.
 */
export const dataAttributes = <S extends Schema.Top>(value: S) =>
  Schema.Record(Schema.TemplateLiteral(["data-", Schema.String]), value);

interface Marker {
  readonly role: string;
  readonly name?: string;
}

// `Schema.annotate` lands on the node when it has no checks and on the *last check* when it does
// (SchemaAST.ts:4399-4405), so `Schema.Int.pipe(attribute())` hides the marker inside the check.
// Read the node first, then every check, newest last.
const markerOf = (node: SchemaAST.AST): Marker | undefined => {
  const candidates = [node.annotations, ...(node.checks ?? []).map((check) => check.annotations)];
  for (const annotations of candidates) {
    const marker = annotations?.[XML];
    if (Predicate.hasProperty(marker, "role") && Predicate.isString(marker.role)) {
      return marker as Marker;
    }
  }
  return undefined;
};

const lower = (name: string, ast: SchemaAST.Objects): Plan => {
  const attributes: Array<Plan["attributes"][number]> = [];
  const children: Array<ChildPlan> = [];
  let text: { key: string; schema: Schema.Top } | undefined;
  let mixedField: { key: string; schema: Schema.Top } | undefined;
  for (const { name: fieldName, type: node } of ast.propertySignatures) {
    const key = String(fieldName);
    const marker = markerOf(node);
    if (marker?.role === "attribute") {
      attributes.push({ key, name: marker.name ?? key, schema: Schema.make<Schema.Top>(node) });
    } else if (marker?.role === "text") {
      text = { key, schema: Schema.make<Schema.Top>(node) };
    } else if (marker?.role === "mixed") {
      mixedField = { key, schema: Schema.make<Schema.Top>(node) };
    } else {
      const many = node._tag === "Arrays" && node.elements.length === 0 && node.rest.length === 1;
      const inner = many && node._tag === "Arrays" ? node.rest[0]! : node;
      const innerMarker = markerOf(inner);
      if (innerMarker?.role !== "element" || innerMarker.name === undefined) {
        throw new Error(
          `<${name}> field "${key}" has no XML role: use attribute(), text(), mixed(), or an element codec`,
        );
      }
      children.push({
        key,
        name: innerMarker.name,
        schema: Schema.make<Schema.Top>(inner),
        cardinality: many ? "many" : node.context?.isOptional ? "optional" : "one",
      });
    }
  }
  const modes = [text, mixedField, children.length > 0 ? children : undefined].filter(
    (m) => m !== undefined,
  );
  if (modes.length > 1) {
    throw new Error(
      `<${name}> mixes text(), mixed(), and child element fields; pick one content mode`,
    );
  }
  const data = ast.indexSignatures[0];
  return {
    name,
    attributes,
    data: data === undefined ? undefined : Schema.make<Schema.Top>(data.type),
    content:
      text !== undefined
        ? { mode: "text", key: text.key, schema: text.schema }
        : mixedField !== undefined
          ? { mode: "mixed", key: mixedField.key, schema: mixedField.schema }
          : children.length > 0
            ? { mode: "elements", children }
            : { mode: "empty" },
  };
};

/**
 * Derives the element codec for a wire name from an annotated struct.
 */
export const element = <
  Name extends string,
  S extends Schema.Top & { readonly ast: SchemaAST.Objects },
>(
  name: Name,
  schema: S,
): ElementCodec<Name, S["Type"]> =>
  compile(lower(name, schema.ast)) as unknown as ElementCodec<Name, S["Type"]>;
