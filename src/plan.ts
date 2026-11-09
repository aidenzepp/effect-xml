import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import type * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";

import { NAME_RULE, XML_NAMESPACE, clark, isQName, splitQName } from "./element.ts";
import type { ResolvedElement } from "./element.ts";

// Native: `Schema.annotate` lacks a typed accessor for a library-owned annotation key.
/**
 * The annotation key under which an element schema carries its `Marker`. The value lives
 * on `ast.annotations` untyped, so every reader validates it.
 */
export const XML = "effect-xml";

/**
 * The prefix that marks an attribute as a `data-*` attribute. When a plan declares `data`, such an
 * attribute is admitted and carried under its own attribute name as the struct key; `compile` and
 * the issue translator in `issue.ts` both key on it.
 */
export const DATA_PREFIX = "data-";

/**
 * A map from namespace prefix to namespace URI, as declared on an authored element.
 */
export type PrefixMap = Readonly<Record<string, string>>;

/**
 * One attribute slot of an element: the struct key, the Clark name on the wire, and the consumer
 * schema for its string value.
 */
export interface AttributePlan {
  readonly key: string;
  readonly name: string;
  readonly schema: Schema.Top;
}

/**
 * One child-element slot of an `elements` content plan.
 */
export interface ChildPlan {
  readonly key: string;
  readonly name: string;
  readonly wire: string;
  readonly schema: Schema.Top;
  readonly cardinality: "one" | "optional" | "many";
}

/**
 * One member of a `mixed` content plan; the union over members is built at compile time.
 */
export interface MixedMember {
  readonly name: string;
  readonly wire: string;
  readonly schema: Schema.Top;
}

/**
 * How an element's children are modelled: none, one text slot, named element slots, or an ordered
 * mix of text and member elements.
 */
export type ContentPlan =
  | { readonly mode: "empty" }
  | { readonly mode: "text"; readonly key: "$text"; readonly schema: Schema.Top }
  | {
      readonly mode: "elements";
      readonly children: readonly ChildPlan[];
      readonly open: boolean;
    }
  | {
      readonly mode: "mixed";
      readonly key: "$children";
      readonly members: readonly MixedMember[];
      readonly open: boolean;
    };

/**
 * The intermediate representation of one element codec, built from a declaration and consumed by
 * `compile`.
 *
 * `name` is the Clark name and `wire` is the element name as authored, such as `p` or `m:math`.
 */
export interface Plan {
  readonly name: string;
  readonly wire: string;
  readonly prefixes: PrefixMap;
  readonly attributes: readonly AttributePlan[];
  readonly data: Schema.Top | undefined;
  readonly content: ContentPlan;
}

/**
 * Collect the members of a `mixed` content that collide with another member of the same content:
 * those that share a wire tag or a Clark name with it. Together they form the content's collision
 * groups.
 *
 * `lower` accepts colliding members, and the item value shape `{ _tag: <wire>, value }` cannot
 * name one of them, so encode must tell them apart by the value's shape. The compiled union
 * (`mixedField` in `compile.ts`) chooses among a group's members by an exact match under `oneOf`,
 * and the structural codec, which selects a member by its Clark name or wire tag alone, leaves an
 * element with a group to the compiled codec. Both read the groups here, so the two rules cannot
 * disagree on which members collide.
 *
 * @param members - The members of one `mixed` content, in author order.
 * @returns The colliding members; empty when every member has its own wire tag and Clark name.
 */
export const collidingMembers = (members: readonly MixedMember[]): ReadonlySet<MixedMember> => {
  const count = (key: (member: MixedMember) => string) => {
    const counts = new Map<string, number>();

    for (const member of members) {
      counts.set(key(member), (counts.get(key(member)) ?? 0) + 1);
    }

    return (member: MixedMember) => (counts.get(key(member)) ?? 0) > 1;
  };

  const sharesName = count((member) => member.name);
  const sharesWire = count((member) => member.wire);

  return new Set(members.filter((member) => sharesName(member) || sharesWire(member)));
};

/**
 * Whether an element's `mixed` content has a collision group: two members under one wire tag or
 * one Clark name (see {@link collidingMembers}).
 *
 * @param plan - The element plan.
 * @returns `true` when two `mixed` members share a wire tag or a Clark name.
 */
export const hasAmbiguousMembers = (plan: Plan): boolean =>
  plan.content.mode === "mixed" && collidingMembers(plan.content.members).size > 0;

/**
 * The value stored under `XML`: an element's Clark name, authored wire name, and a thunk
 * that yields its `Plan` without forcing recursive references early.
 */
export interface Marker {
  readonly name: string;
  readonly wire: string;
  readonly plan: () => Plan;
}

/**
 * Whether a value is a function, the only property of a plan thunk that can be checked before it
 * is called.
 *
 * @param u - The candidate value.
 * @returns `true` when `u` is a function.
 */
const isPlanThunk = (u: unknown): u is () => Plan => Predicate.isFunction(u);

/**
 * Read the `Marker` stored on one AST node's own annotations.
 *
 * @param ast - The AST node.
 * @returns The marker, or `undefined` when `name`, `wire`, or `plan` is missing or mistyped.
 */
export const markerAt = (ast: SchemaAST.AST): Marker | undefined => {
  const marker = ast.annotations?.[XML];

  return Predicate.hasProperty(marker, "name") &&
    Predicate.isString(marker.name) &&
    Predicate.hasProperty(marker, "wire") &&
    Predicate.isString(marker.wire) &&
    Predicate.hasProperty(marker, "plan") &&
    isPlanThunk(marker.plan)
    ? { name: marker.name, plan: marker.plan, wire: marker.wire }
    : undefined;
};

/**
 * Find the first `Marker` on an AST node or, depth first, on the nodes its encoding links
 * point to.
 *
 * @param ast - The AST node to start from.
 * @returns The nearest marker, or `undefined` when no node in the chain carries one.
 */
const markerIn = (ast: SchemaAST.AST): Marker | undefined => {
  const own = markerAt(ast);

  if (own !== undefined) {
    return own;
  }

  for (const link of ast.encoding ?? []) {
    const found = markerIn(link.to);

    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
};

// Native: SchemaAST.toEncoded lacks a stop at the intermediate node that carries the marker.
/**
 * Read the `Marker` of an element schema, looking through the Schema combinators that wrap
 * it.
 *
 * `annotate`, `Schema.check`, and `Schema.brand` keep the marker on the top AST node, but
 * `Schema.decodeTo` returns the target schema's node and moves the element codec to an
 * `ast.encoding` link's `to`. The top node's marker wins; otherwise the encoding chain is walked
 * depth first, so `Element(...).pipe(Schema.decodeTo(Model, transformation))` reads as the element
 * it decodes from.
 *
 * @param schema - Any schema; unannotated schemas and malformed markers yield `undefined`.
 * @returns The marker, or `undefined` when no node of the schema or its encoding chain carries a
 *   valid one.
 */
export const markerOf = (schema: Schema.Top): Marker | undefined => markerIn(schema.ast);

/**
 * Read the Clark name of an element schema without forcing its plan.
 *
 * @param schema - Any schema.
 * @returns The Clark name, or `undefined` when the schema carries no valid marker.
 */
export const elementName = (schema: Schema.Top): string | undefined => markerOf(schema)?.name;

/**
 * Build the `Plan` of an element schema.
 *
 * @param schema - Any schema.
 * @returns The plan, or `undefined` when the schema carries no valid marker.
 */
export const planOf = (schema: Schema.Top): Plan | undefined => markerOf(schema)?.plan();

/**
 * The outcome of expanding an authored name: the Clark name, or a message describing a
 * definition-time mistake. `qname` returns this instead of throwing so callers choose how to
 * surface the failure.
 */
export type QNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string };

// Native: `effect/encoding/Xml` and `Schema.Struct` lack expansion of a prefix against a declared map.
/**
 * Build the expander that turns an authored key into a Clark name under a prefix map.
 *
 * An unprefixed element takes the default namespace `map[""]` when it is present and non-empty;
 * an empty default, like `xmlns=""`, leaves it in no namespace. An unprefixed attribute is always
 * in no namespace; `xml` always resolves to `XML_NAMESPACE`. Any other prefix must be an own key of
 * `map` bound to a non-empty URI, as Namespaces in XML 1.0 forbids binding a prefix to the empty
 * namespace; otherwise the result is the failure form naming the prefix and the key.
 *
 * @param map - The prefix map declared on the element.
 * @returns A function from an authored key and its kind to a `QNameResult`; it never throws.
 */
export const qname =
  (map: PrefixMap) =>
  (key: string, kind: "element" | "attribute"): QNameResult => {
    const { local, prefix } = splitQName(key);

    if (Option.isNone(prefix)) {
      const uri = kind === "element" && Object.hasOwn(map, "") ? map[""] : undefined;

      return {
        name: clark(uri === undefined || uri === "" ? Option.none() : Option.some(uri), local),
        ok: true,
      };
    }

    if (prefix.value === "xml") {
      return { name: clark(Option.some(XML_NAMESPACE), local), ok: true };
    }

    if (!Object.hasOwn(map, prefix.value)) {
      return {
        message: `Prefix "${prefix.value}" in "${key}" is not declared in the prefix map.`,
        ok: false,
      };
    }

    const uri = map[prefix.value];

    return uri === undefined || uri === ""
      ? {
          message: `Prefix "${prefix.value}" in "${key}" is bound to the empty namespace; bind it to a namespace URI.`,
          ok: false,
        }
      : { name: clark(Option.some(uri), local), ok: true };
  };

/**
 * The phantom key under which {@link XmlElement} carries its authored name. No runtime value
 * exists under it.
 */
declare const ElementName: unique symbol;

/**
 * A resolved element whose authored name `Name` is known at the type level.
 *
 * The name is phantom: no runtime key exists, and every `XmlSchema.ResolvedElement` a codec
 * produces is typed as the element its codec declares.
 */
export interface XmlElement<Name extends string> extends ResolvedElement {
  readonly [ElementName]: Name;
}

/**
 * The constraint every element codec satisfies: a Schema codec whose encoded side is an
 * {@link XmlElement}, with any name, decoded type, and services.
 *
 * The name lives in the encoded type because every Schema combinator keeps its source's encoded
 * type: `annotate`, `Schema.check`, `Schema.brand`, and `Schema.decodeTo` all return a codec that
 * still satisfies this constraint with the same name. The declaration modules type a specific
 * codec with the `Element` interface, which extends this shape.
 */
export type AnyElement = Schema.Codec<unknown, XmlElement<string>, unknown, unknown>;

/**
 * Attribute schemas keyed by authored name; the key `"data-*"` declares the pattern group for
 * `data-` attributes.
 */
export interface Attributes {
  readonly [name: string]: Schema.Top;
}

/**
 * The content mode of an element with no children.
 */
export interface Empty {
  readonly mode: "empty";
}

/**
 * The content mode of an element whose children are a single text slot decoded by `schema`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the declaration type takes its constructor's name across TypeScript's type and value spaces, as `Schema.optionalKey` does (`effect/Schema.ts:2358`).
export interface text<S extends Schema.Top> {
  readonly mode: "text";
  readonly schema: S;
}

/**
 * A child slot that accepts any number of the element `element`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the declaration type takes its constructor's name across TypeScript's type and value spaces, as `Schema.optionalKey` does (`effect/Schema.ts:2358`).
export interface many<E extends AnyElement> {
  readonly cardinality: "many";
  readonly element: E;
}

/**
 * A child slot that accepts at most one of the element `element`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the declaration type takes its constructor's name across TypeScript's type and value spaces, as `Schema.optionalKey` does (`effect/Schema.ts:2358`).
export interface optional<E extends AnyElement> {
  readonly cardinality: "optional";
  readonly element: E;
}

/**
 * One child slot: a bare element codec means exactly one, otherwise an `Array` or an
 * `optionalKey` slot.
 */
export type ChildSpec = AnyElement | many<AnyElement> | optional<AnyElement>;

/**
 * Child slots keyed by the struct key they decode into.
 */
export interface ChildFields {
  readonly [key: string]: ChildSpec;
}

/**
 * The content mode of an element made of named child-element slots.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the declaration type takes its constructor's name across TypeScript's type and value spaces, as `Schema.optionalKey` does (`effect/Schema.ts:2358`).
export interface elements<F extends ChildFields, Open extends boolean = false> {
  readonly mode: "elements";
  readonly fields: F;
  readonly open: Open;
}

/**
 * The content mode of an element whose children are an ordered mix of text and the member
 * elements.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the declaration type takes its constructor's name across TypeScript's type and value spaces, as `Schema.optionalKey` does (`effect/Schema.ts:2358`).
export interface mixed<M extends readonly AnyElement[], Open extends boolean = false> {
  readonly mode: "mixed";
  readonly members: M;
  readonly open: Open;
}

/**
 * Any content mode an element declaration can choose.
 */
export type Content =
  | Empty
  | text<Schema.Top>
  | elements<ChildFields, boolean>
  | mixed<readonly AnyElement[], boolean>;

/**
 * An element declaration: its attributes and its content mode, both optional.
 */
export interface Spec<A extends Attributes, C extends Content> {
  readonly attributes?: A;
  readonly content?: C;
}

/**
 * Declare text content decoded by `schema`.
 *
 * @param schema - The schema for the element's text.
 * @returns A text content declaration.
 */
export const text = <S extends Schema.Top>(schema: S): text<S> => ({ mode: "text", schema });

/**
 * Read the `open` flag of an `elements` or `mixed` declaration, `false` when absent.
 *
 * @param options - The declaration's options.
 * @returns The flag, typed as the declaration's `O`.
 */
const openOf = <O extends boolean>(options: { readonly open?: O } | undefined): O =>
  // SAFETY: `open` defaults to `false`, the default of `O`; an explicit `open` is `O` itself.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the flag is type-level only.
  (options?.open ?? false) as O;

/**
 * Declare named child-element slots.
 *
 * `options.open` admits child elements no slot names; it defaults to `false`. An open element
 * with no declared children is `elements({}, { open: true })`. `open` applies to children only:
 * an unknown attribute stays an issue naming the declared set, and `data-*` is the pattern group
 * for extra attributes.
 *
 * @param fields - Child slots keyed by the struct key each decodes into.
 * @param options - Optional settings; `open` admits undeclared child elements.
 * @returns An `elements` content declaration.
 */
export const elements = <const F extends ChildFields, const O extends boolean = false>(
  fields: F,
  options?: { readonly open?: O },
): elements<F, O> => ({ fields, mode: "elements", open: openOf(options) });

/**
 * Declare mixed content over a set of member elements.
 *
 * `options.open` admits child elements no member names; it defaults to `false`. An open element
 * with no declared children is `mixed([], { open: true })`. `open` applies to children only: an
 * unknown attribute stays an issue naming the declared set, and `data-*` is the pattern group for
 * extra attributes.
 *
 * @param members - The element codecs allowed between text runs.
 * @param options - Optional settings; `open` admits undeclared child elements.
 * @returns A `mixed` content declaration.
 */
export const mixed = <const M extends readonly AnyElement[], const O extends boolean = false>(
  members: M,
  options?: { readonly open?: O },
): mixed<M, O> => ({ members, mode: "mixed", open: openOf(options) });

/**
 * Mark a child slot as accepting any number of `element`.
 *
 * @param element - The child element codec.
 * @returns An `Array` child slot.
 */
export const many = <E extends AnyElement>(element: E): many<E> => ({
  cardinality: "many",
  element,
});

/**
 * Mark a child slot as accepting at most one `element`.
 *
 * @param element - The child element codec.
 * @returns An `optionalKey` child slot.
 */
export const optional = <E extends AnyElement>(element: E): optional<E> => ({
  cardinality: "optional",
  element,
});

/**
 * A mistake in an element declaration, found while building the definition.
 *
 * It is a programming error of the caller, not a decode failure, so it is a plain `Error` with a
 * message and no `SchemaIssue`. `element` and `suspend` throw it when they are called; it is not an
 * `Effect`, so `catchTag` never sees it.
 */
export class DefinitionError extends Error {
  /**
   * Construct the error with the message that names the declaration mistake and its repair.
   *
   * @param message - What is wrong with the declaration and how to fix it.
   */
  constructor(message: string) {
    super(message);
    this.name = "DefinitionError";
  }
}

/**
 * Convert a `QNameResult` into a `Result.Result` so lowering can compose it.
 *
 * @param result - The outcome of a `qname` expansion.
 * @returns The Clark name, or a {@link DefinitionError} carrying the expansion message.
 */
const expanded = (result: QNameResult): Result.Result<string, DefinitionError> =>
  result.ok ? Result.succeed(result.name) : Result.fail(new DefinitionError(result.message));

/**
 * Lower one child slot of an `elements` declaration to a `ChildPlan`.
 *
 * The child's name and wire name come from its marker, so a child that is not an element codec is
 * a definition error naming the parent and the slot. A marker can be written by hand, so its wire
 * name is checked as an XML name here too.
 *
 * @param parent - The authored name of the parent element, for the error message.
 * @param key - The struct key of the slot.
 * @param spec - The slot declaration.
 * @returns The child plan, or a {@link DefinitionError} when the child has no marker or its wire
 *   name is not an XML name.
 */
const lowerChild = (
  parent: string,
  key: string,
  spec: ChildSpec,
): Result.Result<ChildPlan, DefinitionError> => {
  const [schema, cardinality] =
    "cardinality" in spec ? ([spec.element, spec.cardinality] as const) : ([spec, "one"] as const);

  const marker = markerOf(schema);

  if (marker === undefined) {
    return Result.fail(
      new DefinitionError(
        `<${parent}> child "${key}": expected an element codec, such as one built with Element(); wrap the value with Element() or remove the slot.`,
      ),
    );
  }

  return isQName(marker.wire)
    ? Result.succeed({ cardinality, key, name: marker.name, schema, wire: marker.wire })
    : Result.fail(
        new DefinitionError(
          `Element "${parent}" declares child "${key}" as "${marker.wire}", which is not an XML name; ${NAME_RULE}; declare the child with Element() under an XML name.`,
        ),
      );
};

/**
 * Lower one member of a `mixed` declaration to a `MixedMember`.
 *
 * The marker is the only carrier of the authored spelling past lowering, so `wire` is copied from
 * it and `compile` can tag decoded items with the authored name while `name` selects the member.
 * A marker can be written by hand, so its wire name is checked as an XML name here too.
 *
 * @param parent - The authored name of the parent element, for the error message.
 * @param index - The position of the member in the declaration.
 * @param schema - The member codec.
 * @returns The member plan, or a {@link DefinitionError} when the member has no marker or its wire
 *   name is not an XML name.
 */
const lowerMember = (
  parent: string,
  index: number,
  schema: Schema.Top,
): Result.Result<MixedMember, DefinitionError> => {
  const marker = markerOf(schema);

  if (marker === undefined) {
    return Result.fail(
      new DefinitionError(
        `<${parent}> mixed member ${index}: expected an element codec, such as one built with Element(); wrap the value with Element() or remove it from mixed().`,
      ),
    );
  }

  return isQName(marker.wire)
    ? Result.succeed({ name: marker.name, schema, wire: marker.wire })
    : Result.fail(
        new DefinitionError(
          `Element "${parent}" lists mixed member ${index} "${marker.wire}", which is not an XML name; ${NAME_RULE}; declare the member with Element() under an XML name.`,
        ),
      );
};

/**
 * Lower the content declaration of an element to a `ContentPlan`.
 *
 * @param parent - The authored name of the element, for error messages.
 * @param declared - The content declaration.
 * @returns The content plan, or a {@link DefinitionError} from a child slot or mixed member.
 */
const lowerContent = (
  parent: string,
  declared: Content,
): Result.Result<ContentPlan, DefinitionError> => {
  if (declared.mode === "empty") {
    return Result.succeed({ mode: "empty" });
  }

  if (declared.mode === "text") {
    return Result.succeed({ key: "$text", mode: "text", schema: declared.schema });
  }

  if (declared.mode === "elements") {
    return Result.map(
      Result.all(
        Object.entries(declared.fields).map(([key, child]) => lowerChild(parent, key, child)),
      ),
      (children): ContentPlan => ({ children, mode: "elements", open: declared.open }),
    );
  }

  return Result.map(
    Result.all(declared.members.map((member, index) => lowerMember(parent, index, member))),
    (members): ContentPlan => ({ key: "$children", members, mode: "mixed", open: declared.open }),
  );
};

// Native: `Schema.Struct` and `Schema.decodeTo` lack XML names, content modes, and definition mistakes as values.
/**
 * Lower an element declaration to a `Plan`.
 *
 * The element name is expanded as an element name under `map` and kept as authored in `wire`. Each
 * attribute key other than `"data-*"` is expanded as an attribute name; `"data-*"` becomes the
 * plan's `data` schema. Declaring `"data-*"` together with any other `data-` key is a
 * {@link DefinitionError}, since the pattern would also match the explicit key. An `elements` child
 * and a `mixed` member read their Clark and wire names from their markers.
 *
 * The element name, every attribute key other than `"data-*"`, and every `mixed` member's wire
 * name must be an XML qualified name ({@link isQName}); any other name is a
 * {@link DefinitionError} naming the element and the name. The struct keys content decodes under,
 * `"$text"`, `"$children"`, and `"*"` for undeclared children, are not XML names, so no attribute
 * can take one of them, while an attribute keyed `text` or `children` sits beside text or mixed
 * content. Attributes and `elements` slots share one decoded struct, so an attribute key equal to a
 * slot key is a {@link DefinitionError}.
 *
 * `lower` is pure and never throws. A mistake in the declaration, a name that is not an XML name,
 * an undeclared prefix, or a child that is not an element codec, comes back as a
 * {@link DefinitionError}. Its consumers (`compile`,
 * `element`, `suspend`) unwrap the result when the definition is built and throw the error there:
 * a synchronous constructor misused by its caller is a defect, and failing at definition time
 * keeps the mistake from surfacing on the first decode. This is the one place the library turns a
 * consumer programming error into a defect.
 *
 * @param name - The authored element name, such as `p` or `m:math`.
 * @param spec - The declaration to lower.
 * @param map - The prefix map used to expand the element and attribute names.
 * @returns The plan, or a {@link DefinitionError}.
 */
export const lower = (
  name: string,
  spec: Spec<Attributes, Content>,
  map: PrefixMap,
): Result.Result<Plan, DefinitionError> =>
  Result.gen(function* lowering() {
    if (!isQName(name)) {
      return yield* Result.fail(
        new DefinitionError(
          `Element "${name}" is not an XML name; ${NAME_RULE}; rename the element to its name as written in the XML.`,
        ),
      );
    }

    const expand = qname(map);
    const clarkName = yield* expanded(expand(name, "element"));
    const attributes: AttributePlan[] = [];
    let data: Schema.Top | undefined;

    const keys = Object.keys(spec.attributes ?? {});

    const shadowed = keys.includes("data-*")
      ? keys.filter((key) => key.startsWith(DATA_PREFIX) && key !== "data-*")
      : [];

    if (shadowed.length > 0) {
      return yield* Result.fail(
        new DefinitionError(
          `Element "${name}" declares data-* and also the attribute ${shadowed.map((key) => `"${key}"`).join(", ")}. The data-* pattern already matches every attribute starting with "data-", so the explicit key would be decoded as data-* instead of its own schema. Declare it only through data-*, or drop data-* and declare each data- attribute by name.`,
        ),
      );
    }

    const invalid = keys.find((key) => key !== "data-*" && !isQName(key));

    if (invalid !== undefined) {
      return yield* Result.fail(
        new DefinitionError(
          `Element "${name}" declares the attribute "${invalid}", which is not an XML name; ${NAME_RULE}; rename the attribute to its name as written in the XML.`,
        ),
      );
    }

    for (const [key, schema] of Object.entries(spec.attributes ?? {})) {
      if (key === "data-*") {
        data = schema;
      } else {
        attributes.push({ key, name: yield* expanded(expand(key, "attribute")), schema });
      }
    }

    const content = yield* lowerContent(name, spec.content ?? { mode: "empty" });

    const clash =
      content.mode === "elements"
        ? content.children.find((child) => attributes.some((a) => a.key === child.key))
        : undefined;

    if (clash !== undefined) {
      return yield* Result.fail(
        new DefinitionError(
          `Element "${name}" declares the attribute "${clash.key}" and the child slot "${clash.key}" under the same key "${clash.key}", so one would overwrite the other in the decoded value; rename the child slot.`,
        ),
      );
    }

    return { attributes, content, data, name: clarkName, prefixes: map, wire: name };
  });
