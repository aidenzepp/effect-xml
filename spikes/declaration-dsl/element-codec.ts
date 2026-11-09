// Shared library-side code for SPIKE-05: the part both declaration surfaces compile down to.
// An element definition is lowered to a `Plan`, and `compile` turns a plan into a
// `Schema.Codec<T, Xml.Element>` built from exactly one `Schema.decodeTo` over the upstream
// element. Attribute and text leaves go through `Schema.toCodecStringTree`, so the consumer
// declares `Schema.Int` or `Schema.Boolean` and the library handles the string form.
import * as Effect from "effect/Effect";
import type { Xml } from "effect/encoding";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";

export type Element = Xml.Element;

/**
 * Annotation key under which element codecs carry their wire name.
 */
export const XML = "effect-xml";

/**
 * An element codec: a real Schema codec from `Xml.Element`, plus a phantom wire name.
 */
export interface ElementCodec<Name extends string, T> extends Schema.Codec<T, Element> {
  readonly "~xml.name": Name;
}

export const isElement = (u: unknown): u is Element =>
  Predicate.hasProperty(u, "name") &&
  Predicate.isString(u.name) &&
  Predicate.hasProperty(u, "attributes") &&
  Predicate.isObject(u.attributes) &&
  Predicate.hasProperty(u, "children") &&
  Array.isArray(u.children);

/**
 * The upstream element tree as a Schema, so `decodeTo` can start from it.
 */
export const ElementSchema = Schema.declare(isElement, { identifier: "XmlElement" });

export interface AttributePlan {
  readonly key: string;
  readonly name: string;
  /**
   * Consumer schema; `compile` wraps it in `toCodecStringTree`.
   */
  readonly schema: Schema.Top;
}

export interface ChildPlan {
  readonly key: string;
  readonly name: string;
  readonly schema: Schema.Top;
  readonly cardinality: "one" | "optional" | "many";
}

export type ContentPlan =
  | { readonly mode: "empty" }
  | { readonly mode: "text"; readonly key: string; readonly schema: Schema.Top }
  | { readonly mode: "elements"; readonly children: ReadonlyArray<ChildPlan> }
  | { readonly mode: "mixed"; readonly key: string; readonly schema: Schema.Top };

export interface Plan {
  readonly name: string;
  readonly attributes: ReadonlyArray<AttributePlan>;
  /**
   * Value schema for `data-*` attributes, or undefined when none are allowed.
   */
  readonly data: Schema.Top | undefined;
  readonly content: ContentPlan;
}

/**
 * Reads the wire name an element codec was annotated with (also on a `suspend` node).
 */
export const elementName = (schema: Schema.Top): string | undefined => {
  const marker = schema.ast.annotations?.[XML];
  return Predicate.hasProperty(marker, "name") && Predicate.isString(marker.name)
    ? marker.name
    : undefined;
};

/**
 * Recursive reference that still exposes its wire name without forcing the thunk.
 */
export const suspend = <Name extends string, T>(
  name: Name,
  thunk: () => ElementCodec<Name, T>,
): ElementCodec<Name, T> =>
  Schema.suspend(thunk).annotate({ [XML]: { role: "element", name } }) as unknown as ElementCodec<
    Name,
    T
  >;

export type MixedItem<M extends ReadonlyArray<ElementCodec<string, unknown>>> =
  | { readonly _tag: "text"; readonly text: string }
  | {
      [K in keyof M]: M[K] extends ElementCodec<infer N, infer T>
        ? { readonly _tag: N; readonly value: T }
        : never;
    }[number];

const TextItem = Schema.String.pipe(
  Schema.decodeTo(Schema.Struct({ _tag: Schema.Literal("text"), text: Schema.String }), {
    decode: SchemaGetter.transform((text) => ({ _tag: "text" as const, text })),
    encode: SchemaGetter.transform((item) => item.text),
  }),
);

const memberItem = (member: Schema.Top): Schema.Top => {
  const name = elementName(member);
  if (name === undefined) {
    throw new Error("mixed(): every member must be an element codec");
  }
  return member.pipe(
    Schema.decodeTo(Schema.Struct({ _tag: Schema.Literal(name), value: Schema.toType(member) }), {
      decode: SchemaGetter.transform((value) => ({ _tag: name, value })),
      encode: SchemaGetter.transform((item) => item.value),
    }),
  );
};

/**
 * Ordered text and element children, each tagged by its wire name for exhaustive narrowing.
 */
export const mixedSchema = <const M extends ReadonlyArray<ElementCodec<string, unknown>>>(
  members: M,
): Schema.Codec<ReadonlyArray<MixedItem<M>>, ReadonlyArray<Element | string>> =>
  Schema.Array(Schema.Union([TextItem, ...members.map(memberItem)])) as unknown as Schema.Codec<
    ReadonlyArray<MixedItem<M>>,
    ReadonlyArray<Element | string>
  >;

const invalid = (path: ReadonlyArray<PropertyKey>, message: string) =>
  Effect.fail(new SchemaIssue.Pointer(path, new SchemaIssue.InvalidValue({ message })));

const isBlank = (text: string) => text.trim() === "";

const decodeElement = (plan: Plan) =>
  Effect.fnUntraced(function* (element: Element) {
    if (element.name !== plan.name) {
      return yield* Effect.fail(
        new SchemaIssue.InvalidValue({
          message: `expected <${plan.name}>, found <${element.name}>`,
        }),
      );
    }
    const out: Record<string, unknown> = {};
    const declared = new Map(plan.attributes.map((a) => [a.name, a.key]));
    for (const [name, value] of Object.entries(element.attributes)) {
      const key = declared.get(name);
      if (key !== undefined) {
        out[key] = value;
      } else if (plan.data !== undefined && name.startsWith("data-")) {
        out[name] = value;
      } else {
        return yield* invalid(
          [`@${name}`],
          `unexpected attribute "${name}" on <${element.name}>; declared: ${[...declared.keys()].join(", ") || "(none)"}`,
        );
      }
    }
    const content = plan.content;
    switch (content.mode) {
      case "empty": {
        for (const child of element.children) {
          if (!Predicate.isString(child) || !isBlank(child)) {
            return yield* invalid(
              [],
              `<${element.name}> must be empty, found ${Predicate.isString(child) ? "text" : `<${child.name}>`}`,
            );
          }
        }
        break;
      }
      case "text": {
        const parts: Array<string> = [];
        for (const child of element.children) {
          if (!Predicate.isString(child)) {
            return yield* invalid(
              [child.name],
              `<${element.name}> holds text only, found <${child.name}>`,
            );
          }
          parts.push(child);
        }
        out[content.key] = parts.join("");
        break;
      }
      case "elements": {
        const byName = new Map(content.children.map((c) => [c.name, c]));
        const groups = new Map<string, Array<Element>>();
        for (const child of element.children) {
          if (Predicate.isString(child)) {
            if (!isBlank(child)) {
              return yield* invalid([], `<${element.name}> holds elements only, found text`);
            }
            continue;
          }
          const slot = byName.get(child.name);
          if (slot === undefined) {
            return yield* invalid(
              [child.name],
              `unexpected child <${child.name}> in <${element.name}>; expected one of ${[...byName.keys()].join(", ")}`,
            );
          }
          const group = groups.get(slot.key) ?? [];
          group.push(child);
          groups.set(slot.key, group);
        }
        for (const slot of content.children) {
          const items = groups.get(slot.key) ?? [];
          if (slot.cardinality === "many") {
            out[slot.key] = items;
          } else if (items.length > 1) {
            return yield* invalid(
              [slot.name],
              `expected at most one <${slot.name}> in <${element.name}>, found ${items.length}`,
            );
          } else if (items.length === 1) {
            out[slot.key] = items[0];
          }
        }
        break;
      }
      case "mixed": {
        out[content.key] = element.children;
        break;
      }
    }
    return out;
  });

const encodeElement = (plan: Plan) =>
  Effect.fnUntraced(function* (value: Record<string, unknown>) {
    const attributes: Record<string, string> = {};
    const putAttribute = (name: string, raw: unknown) =>
      Predicate.isString(raw)
        ? Effect.sync(() => {
            attributes[name] = raw;
          })
        : invalid([`@${name}`], `attribute "${name}" did not encode to a string`);
    for (const a of plan.attributes) {
      const raw = value[a.key];
      if (raw !== undefined) {
        yield* putAttribute(a.name, raw);
      }
    }
    if (plan.data !== undefined) {
      for (const [key, raw] of Object.entries(value)) {
        if (key.startsWith("data-")) {
          yield* putAttribute(key, raw);
        }
      }
    }
    const children: Array<Element | string> = [];
    const content = plan.content;
    switch (content.mode) {
      case "empty":
        break;
      case "text": {
        const raw = value[content.key];
        if (!Predicate.isString(raw)) {
          return yield* invalid([content.key], "text content did not encode to a string");
        }
        if (raw !== "") {
          children.push(raw);
        }
        break;
      }
      case "elements": {
        for (const slot of content.children) {
          const raw = value[slot.key];
          const items = slot.cardinality === "many" ? raw : raw === undefined ? [] : [raw];
          if (!Array.isArray(items) || !items.every(isElement)) {
            return yield* invalid([slot.key], `child <${slot.name}> did not encode to an element`);
          }
          children.push(...items);
        }
        break;
      }
      case "mixed": {
        const raw = value[content.key];
        if (!Array.isArray(raw) || !raw.every((c) => Predicate.isString(c) || isElement(c))) {
          return yield* invalid([content.key], "mixed content did not encode to children");
        }
        children.push(...raw);
        break;
      }
    }
    return { name: plan.name, attributes, children } satisfies Element;
  });

/**
 * One `decodeTo` per element: `Xml.Element` to the target struct and back.
 */
export const compile = (plan: Plan): Schema.Codec<unknown, Element, unknown, unknown> => {
  const fields: Record<string, Schema.Top> = {};
  for (const a of plan.attributes) {
    fields[a.key] = Schema.toCodecStringTree(a.schema);
  }
  const content = plan.content;
  switch (content.mode) {
    case "empty":
      break;
    case "text":
      fields[content.key] = Schema.toCodecStringTree(content.schema);
      break;
    case "elements":
      for (const slot of content.children) {
        fields[slot.key] =
          slot.cardinality === "many"
            ? Schema.Array(slot.schema)
            : slot.cardinality === "optional"
              ? Schema.optionalKey(slot.schema)
              : slot.schema;
      }
      break;
    case "mixed":
      fields[content.key] = content.schema;
      break;
  }
  const struct = Schema.Struct(fields);
  const target =
    plan.data === undefined
      ? struct
      : Schema.StructWithRest(struct, [
          Schema.Record(
            Schema.TemplateLiteral(["data-", Schema.String]),
            Schema.toCodecStringTree(plan.data),
          ),
        ]);
  return ElementSchema.pipe(
    Schema.decodeTo(target, {
      decode: SchemaGetter.transformEffect(decodeElement(plan)),
      encode: SchemaGetter.transformEffect(encodeElement(plan)),
    }),
  ).annotate({ [XML]: { role: "element", name: plan.name } });
};
