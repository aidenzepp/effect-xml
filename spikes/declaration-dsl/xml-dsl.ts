// Approach B: a parallel object-form DSL. The shape is a type, so attribute set and content mode
// are visible to TypeScript, and lowering to a `Plan` needs no annotation walking.
import * as Schema from "effect/Schema";
import {
  compile,
  type Element,
  type ElementCodec,
  elementName,
  type MixedItem,
  mixedSchema,
  type Plan,
  suspend,
} from "./element-codec.js";

export { suspend };
export type { Element, ElementCodec, MixedItem };

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type IsOptional<S> = S extends { readonly "~type.optionality": "optional" } ? true : false;

/**
 * Attribute schemas keyed by wire name; the key `"data-*"` declares the pattern group.
 */
export type Attributes = { readonly [name: string]: Schema.Top };

export type AttributesType<A extends Attributes> = Simplify<
  {
    readonly [
      K in keyof A as K extends "data-*" ? never : IsOptional<A[K]> extends true ? never : K
    ]: A[K]["Type"];
  } & {
    readonly [
      K in keyof A as K extends "data-*" ? never : IsOptional<A[K]> extends true ? K : never
    ]?: A[K]["Type"];
  } & ("data-*" extends keyof A ? { readonly [k: `data-${string}`]: A["data-*"]["Type"] } : unknown)
>;

export interface Empty {
  readonly mode: "empty";
}
export interface Text<S extends Schema.Top> {
  readonly mode: "text";
  readonly schema: S;
}
export interface Many<E extends ElementCodec<string, unknown>> {
  readonly cardinality: "many";
  readonly element: E;
}
export interface Optional<E extends ElementCodec<string, unknown>> {
  readonly cardinality: "optional";
  readonly element: E;
}
export type ChildSpec =
  | ElementCodec<string, unknown>
  | Many<ElementCodec<string, unknown>>
  | Optional<ElementCodec<string, unknown>>;
export type ChildFields = { readonly [key: string]: ChildSpec };
export interface Elements<F extends ChildFields> {
  readonly mode: "elements";
  readonly fields: F;
}
export interface Mixed<M extends ReadonlyArray<ElementCodec<string, unknown>>> {
  readonly mode: "mixed";
  readonly members: M;
}
export type Content =
  | Empty
  | Text<Schema.Top>
  | Elements<ChildFields>
  | Mixed<ReadonlyArray<ElementCodec<string, unknown>>>;

type ChildType<C> =
  C extends Many<infer E>
    ? ReadonlyArray<E["Type"]>
    : C extends Optional<infer E>
      ? E["Type"]
      : C extends ElementCodec<string, infer T>
        ? T
        : never;

export type ChildrenType<F extends ChildFields> = Simplify<
  {
    readonly [
      K in keyof F as F[K] extends Optional<ElementCodec<string, unknown>> ? never : K
    ]: ChildType<F[K]>;
  } & {
    readonly [
      K in keyof F as F[K] extends Optional<ElementCodec<string, unknown>> ? K : never
    ]?: ChildType<F[K]>;
  }
>;

export type ContentType<C extends Content> =
  C extends Text<infer S>
    ? { readonly text: S["Type"] }
    : C extends Elements<infer F>
      ? ChildrenType<F>
      : C extends Mixed<infer M>
        ? { readonly children: ReadonlyArray<MixedItem<M>> }
        : unknown;

export interface Spec<A extends Attributes, C extends Content> {
  readonly attributes?: A;
  readonly content?: C;
}

export const text = <S extends Schema.Top>(schema: S): Text<S> => ({ mode: "text", schema });
export const elements = <const F extends ChildFields>(fields: F): Elements<F> => ({
  mode: "elements",
  fields,
});
export const mixed = <const M extends ReadonlyArray<ElementCodec<string, unknown>>>(
  members: M,
): Mixed<M> => ({ mode: "mixed", members });
export const many = <E extends ElementCodec<string, unknown>>(element: E): Many<E> => ({
  cardinality: "many",
  element,
});
export const optional = <E extends ElementCodec<string, unknown>>(element: E): Optional<E> => ({
  cardinality: "optional",
  element,
});

const nameOf = (schema: Schema.Top, where: string): string => {
  const name = elementName(schema);
  if (name === undefined) {
    throw new Error(`${where}: expected an element codec`);
  }
  return name;
};

const lower = (name: string, spec: Spec<Attributes, Content>): Plan => {
  const attributes: Array<Plan["attributes"][number]> = [];
  let data: Schema.Top | undefined;
  for (const [key, schema] of Object.entries(spec.attributes ?? {})) {
    if (key === "data-*") {
      data = schema;
    } else {
      attributes.push({ key, name: key, schema });
    }
  }
  const content = spec.content ?? { mode: "empty" };
  switch (content.mode) {
    case "empty":
      return { name, attributes, data, content };
    case "text":
      return {
        name,
        attributes,
        data,
        content: { mode: "text", key: "text", schema: content.schema },
      };
    case "elements":
      return {
        name,
        attributes,
        data,
        content: {
          mode: "elements",
          children: Object.entries(content.fields).map(([key, child]) =>
            "cardinality" in child
              ? {
                  key,
                  name: nameOf(child.element, `<${name}> child "${key}"`),
                  schema: child.element,
                  cardinality: child.cardinality,
                }
              : {
                  key,
                  name: nameOf(child, `<${name}> child "${key}"`),
                  schema: child,
                  cardinality: "one",
                },
          ),
        },
      };
    case "mixed":
      return {
        name,
        attributes,
        data,
        content: { mode: "mixed", key: "children", schema: mixedSchema(content.members) },
      };
  }
};

/**
 * Declares an element: its wire name, typed attributes, and an explicit content mode.
 */
export const element = <
  const Name extends string,
  const A extends Attributes = {},
  const C extends Content = Empty,
>(
  name: Name,
  spec?: Spec<A, C>,
): ElementCodec<Name, Simplify<AttributesType<A> & ContentType<C>>> =>
  compile(lower(name, spec ?? {})) as unknown as ElementCodec<
    Name,
    Simplify<AttributesType<A> & ContentType<C>>
  >;
