import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { Simplify } from "effect/Types";

import { compile } from "./compile.ts";
import { NAME_RULE, isQName } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import { DefinitionError, XML, lower, planOf, qname } from "./plan.ts";
import type {
  AnyElement,
  Attributes as AttributeSchemas,
  ChildFields,
  Content as ContentMode,
  Empty,
  Plan,
  PrefixMap,
  Spec,
  XmlElement,
  elements,
  many,
  mixed,
  optional,
  text,
} from "./plan.ts";

/**
 * An element codec: a Schema codec whose decoded side is `T` and whose encoded side is the
 * resolved element named `Name`, with decoding services `RD` and encoding services `RE`.
 *
 * The name lives in the encoded type because every Schema combinator keeps its source's encoded
 * type: `annotate`, `Schema.check`, `Schema.brand`, and `Schema.decodeTo` all return a codec that
 * is still an element codec with the same name. A constraint that accepts any element codec is
 * `Element<string, unknown, unknown, unknown>`; the defaults `never` admit no services.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the codec type shares its name with the `Element` constructor across TypeScript's type and value spaces, as `Schema.Struct` does (`effect/Schema.ts:3492`).
export interface Element<Name extends string, T, RD = never, RE = never> extends Schema.Codec<
  T,
  XmlElement<Name>,
  RD,
  RE
> {
  readonly Rebuild: Element<Name, T, RD, RE>;
}

/**
 * One item of `mixed` content: a text run tagged `"$text"`, or a member element tagged by its
 * authored name. `$` is not an XML `NameChar`, so a member named `text` keeps the tag `"text"`.
 * The run's string sits under the item's own `text` field; an item holds no attributes, so nothing
 * else can claim that key.
 *
 * When `O` is `true` the item also admits the generic member `{ _tag: "*", element }`, an
 * undeclared child element kept whole; `*` is not an XML `NameStartChar`, so it never collides
 * with an authored member name.
 */
export type MixedItem<
  M extends readonly Element<string, unknown, unknown, unknown>[],
  O extends boolean = false,
> =
  | { readonly _tag: "$text"; readonly text: string }
  | {
      [K in keyof M]: M[K] extends Element<infer N, infer T, unknown, unknown>
        ? { readonly _tag: N; readonly value: T }
        : never;
    }[number]
  | (O extends true ? { readonly _tag: "*"; readonly element: ResolvedElement } : never);

/**
 * The constraints and computed types of an element declaration, named as `Schema.Struct` names
 * its own: the attribute and content constraints, the decoded attribute and content types, and
 * the decoding and encoding services. They merge with the `Element` constructor and the
 * {@link Element} codec type, so they read as `XmlSchema.Element.AttributesType<A>` beside
 * `XmlSchema.Element(...)`.
 */
// oxlint-disable-next-line eslint/no-redeclare typescript/no-namespace -- a types-only namespace merged with the `Element` constructor and codec type across TypeScript's type and value spaces, as `Schema.Struct` does (`effect/Schema.ts:3356`).
export declare namespace Element {
  /**
   * The attribute schemas an element may declare, keyed by authored name; the key `"data-*"`
   * declares the pattern group for `data-` attributes.
   */
  export type Attributes = AttributeSchemas;

  /**
   * Any content mode an element declaration can choose: `empty`, `text`, `elements`, or `mixed`.
   */
  export type Content = ContentMode;

  /**
   * Whether a schema was wrapped by `Schema.optionalKey` or `Schema.optional`, read from its
   * optionality brand.
   */
  export type IsOptional<S> = S extends { readonly "~type.optionality": "optional" } ? true : false;

  /**
   * The decoded attributes of an element: required keys for required schemas, optional keys for
   * optional ones, and a `data-${string}` index signature when the declaration has `"data-*"`.
   *
   * `never` is the declaration without attributes (the default of `Element`'s `A`) and adds no
   * fields; a `{}` default would admit any non-nullish value.
   */
  export type AttributesType<A extends Attributes> = [A] extends [never]
    ? unknown
    : Simplify<
        {
          readonly [
            K in keyof A as K extends "data-*" ? never : IsOptional<A[K]> extends true ? never : K
          ]: A[K]["Type"];
        } & {
          readonly [
            K in keyof A as K extends "data-*" ? never : IsOptional<A[K]> extends true ? K : never
          ]?: A[K]["Type"];
        } & ("data-*" extends keyof A
            ? { readonly [k: `data-${string}`]: A["data-*"]["Type"] }
            : unknown)
      >;

  /**
   * The decoded value of one child slot: an array for an `Array` slot, the element for an
   * `optionalKey` slot and for a bare element codec.
   */
  export type Child<C> =
    C extends many<infer E>
      ? readonly E["Type"][]
      : C extends optional<infer E>
        ? E["Type"]
        : C extends Element<string, infer T, unknown, unknown>
          ? T
          : never;

  /**
   * The decoded child slots of an `elements` declaration; an `optionalKey` slot is an optional
   * key.
   */
  export type Children<F extends ChildFields> = Simplify<
    {
      readonly [K in keyof F as F[K] extends optional<AnyElement> ? never : K]: Child<F[K]>;
    } & {
      readonly [K in keyof F as F[K] extends optional<AnyElement> ? K : never]?: Child<F[K]>;
    }
  >;

  /**
   * The decoded content fields of an element by content mode: `$text` for `text`, the child slots
   * for `elements`, `$children` for `mixed`, and no fields for `empty`. `$` is not an XML
   * `NameChar`, so `$text` and `$children` sit beside attributes such as `text` and `children`.
   *
   * An open `elements` body adds the slot `"*"`, the undeclared child elements in document order;
   * an open `mixed` body adds the generic member to {@link MixedItem}. A closed body has neither.
   */
  export type ContentType<C extends Content> =
    C extends text<infer S>
      ? { readonly $text: S["Type"] }
      : C extends elements<infer F, infer O>
        ? O extends true
          ? Simplify<Children<F> & { readonly "*": readonly ResolvedElement[] }>
          : Children<F>
        : C extends mixed<infer M, infer O>
          ? { readonly $children: readonly MixedItem<M, O>[] }
          : unknown;

  /**
   * The decoding services one child slot's element codec requires, for a bare codec, an `Array`
   * slot, or an `optionalKey` slot.
   */
  export type SlotDecodingServices<S> =
    S extends many<infer E>
      ? E["DecodingServices"]
      : S extends optional<infer E>
        ? E["DecodingServices"]
        : S extends Schema.Top
          ? S["DecodingServices"]
          : never;

  /**
   * The encoding services one child slot's element codec requires, for a bare codec, an `Array`
   * slot, or an `optionalKey` slot.
   */
  export type SlotEncodingServices<S> =
    S extends many<infer E>
      ? E["EncodingServices"]
      : S extends optional<infer E>
        ? E["EncodingServices"]
        : S extends Schema.Top
          ? S["EncodingServices"]
          : never;

  /**
   * The decoding services an element declared with attributes `A` and content `C` requires: the
   * union over the attribute schemas (the `"data-*"` group included), the text schema, the
   * `elements` slots, and the `mixed` members. `empty` content and the declaration without
   * attributes add `never`.
   */
  export type DecodingServices<A extends Attributes, C extends Content> =
    | ([A] extends [never] ? never : A[keyof A]["DecodingServices"])
    | (C extends text<infer S>
        ? S["DecodingServices"]
        : C extends elements<infer F, boolean>
          ? SlotDecodingServices<F[keyof F]>
          : C extends mixed<infer M, boolean>
            ? M[number]["DecodingServices"]
            : never);

  /**
   * The encoding services an element declared with attributes `A` and content `C` requires: the
   * union over the attribute schemas (the `"data-*"` group included), the text schema, the
   * `elements` slots, and the `mixed` members. `empty` content and the declaration without
   * attributes add `never`.
   */
  export type EncodingServices<A extends Attributes, C extends Content> =
    | ([A] extends [never] ? never : A[keyof A]["EncodingServices"])
    | (C extends text<infer S>
        ? S["EncodingServices"]
        : C extends elements<infer F, boolean>
          ? SlotEncodingServices<F[keyof F]>
          : C extends mixed<infer M, boolean>
            ? M[number]["EncodingServices"]
            : never);
}

/**
 * The declaration builders bound to one prefix map.
 */
export interface Namespaces {
  /**
   * Declare an element codec from its authored name and an optional spec.
   *
   * @param name - The authored element name, such as `p` or `m:math`.
   * @param spec - The attributes and content mode; omitted means no attributes and empty content.
   * @returns The compiled element codec; its decoding and encoding services are the union of the
   *   services its attribute, text, child-slot, and member schemas require.
   * @throws {DefinitionError} When the element name, a mixed member name, or an attribute key is
   *   not an XML qualified name (`local` or `prefix:local`), the name or an attribute uses an
   *   undeclared prefix, an attribute key equals an `elements` slot key, or a child slot or mixed
   *   member is not an element codec.
   */
  readonly Element: <
    const Name extends string,
    const A extends Element.Attributes = never,
    const C extends Element.Content = Empty,
  >(
    name: Name,
    spec?: Spec<A, C>,
  ) => Element<
    Name,
    Simplify<Element.AttributesType<A> & Element.ContentType<C>>,
    Element.DecodingServices<A, C>,
    Element.EncodingServices<A, C>
  >;
  /**
   * Declare a recursive reference to an element whose codec is not built yet.
   *
   * The codec wraps `Schema.suspend` and carries the expanded name, so `mixed` and `elements` can
   * dispatch on it before the thunk is forced.
   *
   * A `suspend` member of `mixed` is dispatched as a fallback, never by the union's name index:
   * a decode tries it only after every named member, so author order carries no cost.
   *
   * @param name - The authored element name of the referenced element.
   * @param thunk - Returns the referenced codec; forced only on decode or when its plan is read.
   * @returns A codec that carries the referenced element's marker and services without forcing
   *   `thunk`.
   * @throws {DefinitionError} When `name` is not an XML qualified name (`local` or
   *   `prefix:local`) or uses an undeclared prefix.
   */
  readonly suspend: <Name extends string, T, RD = never, RE = never>(
    name: Name,
    thunk: () => Element<Name, T, RD, RE>,
  ) => Element<Name, T, RD, RE>;
}

/**
 * Read the plan behind a referenced codec, which must carry a marker.
 *
 * @param name - The authored name of the reference, for the message.
 * @param schema - The referenced codec.
 * @returns The referenced plan.
 * @throws {DefinitionError} When the thunk of a `suspend` returned a schema without a marker.
 */
const referencedPlan = (name: string, schema: Schema.Top): Plan => {
  const plan = planOf(schema);

  if (plan === undefined) {
    throw new DefinitionError(
      `suspend("${name}") returned a schema that is not an element codec; return a codec built with Element() from the thunk.`,
    );
  }

  return plan;
};

// Native: `Schema.Struct` and `Schema.toEncoderXml` lack a prefix map bound once for every element built from it.
/**
 * Bind the declaration builders to a prefix map, so authored names such as `m:math` expand
 * against it.
 *
 * Every definition mistake is thrown as a {@link DefinitionError} when `Element` or `suspend` is
 * called, never deferred to the first decode: a synchronous constructor misused by its caller is a
 * defect, so the builders throw instead of returning a failure.
 *
 * @param map - The prefix map; `""` is the default element namespace.
 * @returns The `Element` and `suspend` builders bound to `map`.
 */
export const namespaces = (map: PrefixMap): Namespaces => ({
  Element: <
    const Name extends string,
    const A extends Element.Attributes = never,
    const C extends Element.Content = Empty,
  >(
    name: Name,
    spec?: Spec<A, C>,
  ) =>
    // SAFETY: `compile` returns the plan's codec with its type erased to `unknown`; the declaration
    // types `A` and `C` are the same values `lower` read, the compiled codec runs exactly their
    // schemas (so it requires exactly their services), and the phantom name exists only in types.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the mapping is type-level only.
    compile(Result.getOrThrow(lower(name, spec ?? {}, map))) as Element<
      Name,
      Simplify<Element.AttributesType<A> & Element.ContentType<C>>,
      Element.DecodingServices<A, C>,
      Element.EncodingServices<A, C>
    >,
  suspend: <Name extends string, T, RD = never, RE = never>(
    name: Name,
    thunk: () => Element<Name, T, RD, RE>,
  ) => {
    if (!isQName(name)) {
      throw new DefinitionError(
        `suspend("${name}") names "${name}", which is not an XML name; ${NAME_RULE}; rename the reference to the element's name as written in the XML.`,
      );
    }

    const expanded = qname(map)(name, "element");

    if (!expanded.ok) {
      throw new DefinitionError(expanded.message);
    }

    // SAFETY: `Schema.suspend` keeps the thunk's codec type; only the phantom name is added.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the phantom name is type-level only.
    return Schema.suspend(thunk).annotate({
      [XML]: { name: expanded.name, plan: () => referencedPlan(name, thunk()), wire: name },
    }) as Element<Name, T, RD, RE>;
  },
});

/**
 * The builders bound to the empty prefix map: unprefixed names are in no namespace and only the
 * `xml` prefix resolves.
 */
const unbound = namespaces({});

/**
 * Declare an element codec in no namespace; see {@link Namespaces.Element}.
 */
export const { Element } = unbound;

/**
 * Declare a recursive element reference in no namespace; see {@link Namespaces.suspend}.
 */
export const { suspend } = unbound;
