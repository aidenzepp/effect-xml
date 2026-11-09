import { Schema } from "effect";
import * as Xml from "effect/encoding/Xml";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import type * as Types from "effect/Types";

import { ITEM_VALUE, UNDECLARED_ATTRIBUTE, itemOrder } from "./compile.ts";
import { isResolvedElement, parseClark, spell } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import { DATA_PREFIX, XML, collidingMembers, planOf } from "./plan.ts";
import type { ChildPlan, MixedMember, Plan } from "./plan.ts";
import type { ElementPath, ElementStep, Position } from "./positions.ts";

/**
 * A schema for the upstream `Xml.XmlError`, which is a `Data.TaggedError` and so has no
 * record schema; the guard `Xml.isXmlError` admits it by identity.
 */
const XmlErrorCause = Schema.declare(Xml.isXmlError, { identifier: "XmlError" });

/**
 * A schema for `Schema.SchemaError`, which is a `Data.TaggedError` and so has no record
 * schema; the guard `Schema.isSchemaError` admits it by identity.
 */
const SchemaErrorCause = Schema.declare(Schema.isSchemaError, { identifier: "SchemaError" });

/**
 * The schema of one {@link ElementStep}: an element's local name and its zero-based index among
 * the parent's element children.
 */
const ElementStepSchema = Schema.Struct({ index: Schema.Int, local: Schema.String });

/**
 * The decode reason for a value that the declared schema rejected, carrying the
 * `Schema.SchemaError` unchanged as `cause`.
 *
 * `elementPath` is the structured locator of the enclosing element, from the root to the element
 * the failure is under. Each step holds the local part of the element's Clark name and its
 * zero-based position among the parent's element children, so `locate` can find the element in
 * the source text. An attribute or text failure ends the path at its enclosing element, and a
 * missing required child ends it at the parent. The printed `path` differs by design: it is
 * one-based and counts same-named siblings only.
 */
export class SchemaFailure extends Schema.TaggedError<SchemaFailure>()("SchemaFailure", {
  cause: SchemaErrorCause,
  elementPath: Schema.Array(ElementStepSchema),
}) {}

/**
 * The decode reason for an element or attribute whose prefix has no `xmlns` binding in
 * scope. `prefix` is the unbound prefix and `where` names the construct that used it.
 *
 * `elementPath` locates the element that carries the unbound prefix, on its own name or on one of
 * its attribute names, from the root to that element. Each step holds the element's as-written
 * local part, since no Clark name exists for an unbound prefix, and its zero-based position among
 * the parent's element children, so `locate` can find the element in the source text.
 */
export class UndeclaredPrefix extends Schema.TaggedError<UndeclaredPrefix>()("UndeclaredPrefix", {
  elementPath: Schema.Array(ElementStepSchema),
  prefix: Schema.String,
  where: Schema.String,
}) {}

/**
 * The decode reason for input that exceeded a size or nesting limit.
 *
 * `limit` names the limit and `max` is its configured value. A streaming budget
 * (`maxElementSize`, `maxElementNodes`) bounds one record, so it also sets `element`, the Clark
 * name of the record root, and `measured`, the count at the moment it exceeded `max`. A tokenizer
 * limit (`maxDepth`, `maxTokenSize`) bounds the whole document and the parser reports only its
 * maximum, so it has neither `element` nor `measured`; it is positioned at the parser's line and
 * column instead.
 */
export class Limit extends Schema.TaggedError<Limit>()("Limit", {
  element: Schema.optionalKey(Schema.String),
  limit: Schema.Literals(["maxElementSize", "maxElementNodes", "maxDepth", "maxTokenSize"]),
  max: Schema.Number,
  measured: Schema.optionalKey(Schema.Number),
}) {}

/**
 * The decode reason for input that is not well-formed XML, carrying the upstream
 * `Xml.XmlError` unchanged as `cause`.
 *
 * `elementPath` is an optional key, present only on a failure the resolver synthesizes for a
 * namespace rule of Namespaces in XML 1.0: its `cause` has no line or column, so the path locates
 * the declaring element the same way as on {@link SchemaFailure}. An upstream parser failure has no
 * `elementPath` and carries its own line and column on `cause`. A parser failure of kind
 * `Unsupported` has reason {@link Unsupported}, and one that exceeds `maxDepth` or `maxTokenSize`
 * has reason {@link Limit}; every other parser failure has this reason.
 */
export class WellFormedness extends Schema.TaggedError<WellFormedness>()("WellFormedness", {
  cause: XmlErrorCause,
  elementPath: Schema.optionalKey(Schema.Array(ElementStepSchema)),
}) {}

/**
 * The decode reason for input the parser declines rather than malformed markup, carrying the
 * upstream `Xml.XmlError` of kind `Unsupported` unchanged as `cause`.
 *
 * A byte document whose XML declaration names an encoding other than UTF-8 or US-ASCII fails with
 * this reason; decoding its bytes to text first, or supplying UTF-8 bytes, avoids it. The `cause`
 * carries the parser's line and column when it reports them.
 */
export class Unsupported extends Schema.TaggedError<Unsupported>()("Unsupported", {
  cause: XmlErrorCause,
}) {}

/**
 * The encode reason for a value that the declared schema rejected, carrying the
 * `Schema.SchemaError` unchanged as `cause`.
 */
export class EncodeSchemaFailure extends Schema.TaggedError<EncodeSchemaFailure>()(
  "EncodeSchemaFailure",
  {
    cause: SchemaErrorCause,
  },
) {}

/**
 * The encode reason for a namespace URI that has no prefix mapping. `namespace` is the
 * unmapped URI and `what` names the element or attribute that needs it.
 */
export class UnmappedNamespace extends Schema.TaggedError<UnmappedNamespace>()(
  "UnmappedNamespace",
  {
    namespace: Schema.String,
    what: Schema.String,
  },
) {}

/**
 * The encode reason for an event sequence that does not form a well-formed document,
 * carrying the upstream `Xml.XmlError` unchanged as `cause`.
 */
export class InvalidEvent extends Schema.TaggedError<InvalidEvent>()("InvalidEvent", {
  cause: XmlErrorCause,
}) {}

/**
 * The schema of a one-based source {@link Position}.
 */
const PositionSchema = Schema.Struct({ column: Schema.Int, line: Schema.Int });

/**
 * The failure of decoding XML into a value, with the cause classified by `reason` so
 * callers select it with `Effect.catchReason("XmlDecodeError", "<reason tag>", ...)`.
 *
 * `path` is the XPath-like location of the problem and `message` follows
 * `<what> at <xpath>: <expectation>; <repair>`, or
 * `<what> at <xpath> (line L, column C): <expectation>; <repair>` when `position` is set.
 * `position` is an optional key: it is absent, never `undefined`, when the source location is
 * unknown. `record` is likewise an optional key: the ordinal of the collected record a
 * `SchemaFailure` or `Limit` failure is inside, absent for parser and resolver failures. With a
 * record the message reads `<what> at <xpath> of record <k>: ...`.
 *
 * The outer class and every reason are `Schema.TaggedError`. The two causes
 * (`Schema.SchemaError`, `Xml.XmlError`) are `Data.TaggedError` values with no record
 * schema, so the reasons that carry them hold the cause in a `Schema.declare` field
 * guarded by `Schema.isSchemaError` and `Xml.isXmlError`. This keeps every reason a
 * schema-describable class that `Effect.catchReason` reads by `_tag`, and avoids a
 * second error style in the union.
 */
export class XmlDecodeError extends Schema.TaggedError<XmlDecodeError>()("XmlDecodeError", {
  message: Schema.String,
  path: Schema.String,
  position: Schema.optionalKey(PositionSchema),
  reason: Schema.Union([SchemaFailure, UndeclaredPrefix, WellFormedness, Unsupported, Limit]),
  record: Schema.optionalKey(Schema.Int),
}) {}

/**
 * The failure of encoding a value to XML, with the cause classified by `reason` so
 * callers select it with `Effect.catchReason("XmlEncodeError", "<reason tag>", ...)`.
 *
 * `path` is the XPath-like location of the problem and `message` follows
 * `<what> at <xpath>: <expectation>; <repair>`. The reasons are built the same way as
 * those of `XmlDecodeError`.
 */
export class XmlEncodeError extends Schema.TaggedError<XmlEncodeError>()("XmlEncodeError", {
  message: Schema.String,
  path: Schema.String,
  reason: Schema.Union([EncodeSchemaFailure, UnmappedNamespace, InvalidEvent]),
}) {}

/**
 * The reason of an `XmlDecodeError`: the union of the decode reason classes, each named
 * for its `_tag`, as `Effect.catchReason("XmlDecodeError", tag, handler)` hands one to its handler.
 */
export type DecodeErrorReason = XmlDecodeError["reason"];

/**
 * The reason of an `XmlEncodeError`: the union of the encode reason classes, each named
 * for its `_tag`, as `Effect.catchReason("XmlEncodeError", tag, handler)` hands one to its handler.
 */
export type EncodeErrorReason = XmlEncodeError["reason"];

/**
 * Test whether a value is an `XmlDecodeError`.
 *
 * The guard checks the value against the class schema, so a plain object that only copies the
 * `_tag` is not an `XmlDecodeError`, and neither is an `XmlEncodeError`.
 *
 * @param input - The value to test.
 * @returns `true` when `input` is an `XmlDecodeError`.
 */
export const isDecodeError = Schema.is(XmlDecodeError);

/**
 * Test whether a value is an `XmlEncodeError`.
 *
 * The guard checks the value against the class schema, so a plain object that only copies the
 * `_tag` is not an `XmlEncodeError`, and neither is an `XmlDecodeError`.
 *
 * @param input - The value to test.
 * @returns `true` when `input` is an `XmlEncodeError`.
 */
export const isEncodeError = Schema.is(XmlEncodeError);

/**
 * One step of an XPath-like location. A string is a resolver-level segment (as written,
 * for example an element with an undeclared prefix) and prints verbatim. The other forms
 * carry Clark names: an element with an optional one-based position among same-named
 * siblings, a text item at a one-based position in `mixed` content, or an attribute.
 *
 * An attribute segment built against a definition also carries `spelled`, the name in the
 * definition's own prefixes (`xsi:schemaLocation`), which is what it prints; without it the name
 * prints with no prefix map, so a namespace other than `xml` prints as `{uri}local`. `name` stays
 * the Clark name, the key an input element's attributes are read by.
 */
export type PathSegment =
  | string
  | { readonly kind: "element"; readonly name: string; readonly index?: number }
  | { readonly kind: "text"; readonly index: number }
  | { readonly kind: "attribute"; readonly name: string; readonly spelled?: string };

// Native: `Xml` and `SchemaIssue` lack an XPath printer; issue paths are property keys.
/**
 * Print one segment of an XPath-like location.
 *
 * @param segment - The segment to print.
 * @returns The segment text without a leading slash.
 */
const printSegment = (segment: PathSegment): string => {
  if (Predicate.isString(segment)) {
    return segment;
  }

  if (segment.kind === "text") {
    return `text()[${segment.index}]`;
  }

  if (segment.kind === "element") {
    const { local } = parseClark(segment.name);

    return segment.index === undefined ? local : `${local}[${segment.index}]`;
  }

  return `@${segment.spelled ?? spell(segment.name, {}, "attribute")}`;
};

// Native: `SchemaIssue.makeFormatterDefault` and `Pointer` lack XML names, `[n]` sibling indexes, and `@attribute` steps.
/**
 * Print segments as an XPath-like location.
 *
 * @param segments - The path from the document root, outermost first.
 * @returns `/a/b[2]/@c` style text, or `/` for no segments.
 */
export const xpath = (segments: readonly PathSegment[]): string =>
  segments.length === 0 ? "/" : segments.map((segment) => `/${printSegment(segment)}`).join("");

// Native: `SchemaIssue.defaultFormatter` and `makeFormatterStandardSchemaV1` lack a source position, record ordinal, and repair clause.
/**
 * Format a caller-facing error message as `<what> at <path>: <expectation>; <repair>`.
 *
 * A message carries one next action. When the expectation already states it, omit `repair` and
 * the message ends with the expectation.
 *
 * When `position` is given the message reads `<what> at <path> (line L, column C): ...`, with
 * the position once, between the path and the colon. When `record` is given the path is
 * followed by `of record <k>`, before the position: `<what> at <path> of record <k> (line L,
 * column C): ...`.
 *
 * @param parts - `what` names the failing thing, `path` is an `xpath` result,
 *   `expectation` states the violated constraint, `repair` gives a concrete next action,
 *   `position` is the source location, when known, and `record` is the ordinal of
 *   the collected record the failure is inside, when there is one.
 * @returns The message text.
 */
export const formatMessage = (parts: {
  readonly what: string;
  readonly path: string;
  readonly expectation: string;
  readonly repair?: string;
  readonly position?: Position;
  readonly record?: number;
}): string => {
  const inRecord =
    parts.record === undefined ? parts.path : `${parts.path} of record ${parts.record}`;

  const where =
    parts.position === undefined
      ? inRecord
      : `${inRecord} (line ${parts.position.line}, column ${parts.position.column})`;

  const located = `${parts.what} at ${where}: ${parts.expectation}`;

  return parts.repair === undefined ? located : `${located}; ${parts.repair}`;
};

/**
 * Where a translation walk stands in the input while it reads `Pointer` keys.
 *
 * `element` reads keys against a plan and the input element it decodes; `many` waits for the
 * array index that picks one of a `many` slot's same-named children; `mixed` waits for the index
 * into `mixed` content and keeps the member list for name matching; `item` stands on one element
 * child of `mixed` content before the walk has chosen the member it decodes with; `opaque` is past
 * any plan (an attribute value, an unknown key), so later keys print verbatim and the rest is the
 * leaf.
 */
type Cursor =
  | { readonly kind: "element"; readonly plan: Plan; readonly element: ResolvedElement }
  | {
      readonly kind: "many";
      readonly parent: ResolvedElement;
      readonly slot: ChildPlan;
      readonly matches: readonly ResolvedElement[];
    }
  | {
      readonly kind: "mixed";
      readonly wire: string;
      readonly prefixes: Plan["prefixes"];
      readonly members: readonly MixedMember[];
      readonly open: boolean;
      readonly element: ResolvedElement;
    }
  | {
      readonly kind: "item";
      readonly wire: string;
      readonly prefixes: Plan["prefixes"];
      readonly members: readonly MixedMember[];
      readonly open: boolean;
      readonly element: ResolvedElement;
    }
  | { readonly kind: "opaque" };

/**
 * The outcome of reading one `Pointer` key: the next cursor, the segment the key prints as (none
 * when the key names a position that has no XML step of its own), and a replacement leaf when the
 * key ends the walk.
 */
interface Step {
  readonly cursor: Cursor;
  readonly segment?: PathSegment;
  readonly elementStep?: ElementStep;
  readonly leaf?: SchemaIssue.Issue;
}

/**
 * The full outcome of a translation walk: the path, the leaf issue, and the input element that
 * holds the last segment, which the error builders read an attribute value from.
 */
interface Walk {
  readonly segments: readonly PathSegment[];
  readonly elementPath: ElementPath;
  readonly leaf: SchemaIssue.Issue;
  readonly element: ResolvedElement | undefined;
}

/**
 * The cursor past which every key prints verbatim.
 */
const opaque: Cursor = { kind: "opaque" };

/**
 * The step locating an input child among its parent's element children.
 *
 * @param parent - The input element holding the child.
 * @param child - The child, or `undefined` when the input does not hold it.
 * @returns The step, or `undefined` when there is no input child to locate.
 */
const stepOf = (
  parent: ResolvedElement,
  child: ResolvedElement | undefined,
): ElementStep | undefined => {
  const index = child === undefined ? -1 : parent.children.filter(isResolvedElement).indexOf(child);

  return child === undefined || index < 0
    ? undefined
    : { index, local: parseClark(child.name).local };
};

/**
 * Enter a child element: read its plan through `planOf`, which forces a `suspend` codec, and pair
 * it with the input child. Without an input child (an encode failure) the cursor stands on a bare
 * element of the child's name, so the child's attribute and slot keys still translate.
 *
 * @param schema - The child codec.
 * @param element - The input child, or `undefined` when the input does not hold it.
 * @returns An `element` cursor, or `opaque` when the codec has no plan.
 */
const enter = (schema: Schema.Top, element: ResolvedElement | undefined): Cursor => {
  const plan = planOf(schema);

  return plan === undefined
    ? opaque
    : {
        element: element ?? { attributes: {}, children: [], name: plan.name },
        kind: "element",
        plan,
      };
};

/**
 * Read the Clark name a wire struct's `name` issue expected: the wire struct checks an element's
 * name with `Schema.Literal(<clark>)`, so a mismatch is an `InvalidType` over that literal.
 *
 * @param issue - The issue under a `name` key.
 * @returns The expected Clark name, or `undefined` when the issue is not a name mismatch.
 */
const expectedName = (issue: SchemaIssue.Issue | undefined): string | undefined => {
  const ast = issue?._tag === "InvalidType" ? issue.ast : undefined;

  return ast?._tag === "Literal" && Predicate.isString(ast.literal) ? ast.literal : undefined;
};

/**
 * The leaf for an input element whose name is not the one its plan declares. Both names are
 * spelled against each other, so a mismatch in namespace alone writes both namespaces out.
 *
 * @param plan - The plan of the codec that expected the element.
 * @param element - The input element.
 * @returns The leaf issue, whose message states its next action.
 */
const misnamed = (plan: Plan, element: ResolvedElement): SchemaIssue.Issue => {
  const expected = spell(plan.name, plan.prefixes, "element", [element.name]);
  const found = spell(element.name, plan.prefixes, "element", [plan.name]);

  return new SchemaIssue.InvalidValue({
    message: `expected <${expected}> but found <${found}>. Rename the element to <${expected}>, or decode it with a definition of <${found}>.`,
  });
};

/**
 * Replace a `MissingKey` leaf with one whose message names the missing XML construct.
 *
 * @param message - The expectation naming the missing attribute or child.
 * @returns The leaf issue.
 */
const missing = (message: string): SchemaIssue.Issue =>
  new SchemaIssue.MissingKey({ messageMissingKey: message });

/**
 * Build the segment of an attribute of the element a plan decodes, spelled in the plan's prefixes
 * so the path names the attribute as the definition does.
 *
 * @param plan - The plan of the element holding the attribute.
 * @param name - The attribute's Clark name.
 * @returns The attribute segment.
 */
const attributeSegment = (plan: Plan, name: string): PathSegment => ({
  kind: "attribute",
  name,
  spelled: spell(name, plan.prefixes, "attribute"),
});

/**
 * Read one `Pointer` key against an `element` cursor.
 *
 * A `name` key whose issue is the wire struct's mismatch on the plan's own Clark name ends the walk
 * at the element with a leaf naming the expected element (`misnamed`); an attribute keyed `name`
 * fails with a different issue and still prints `@name`. A key equal to an attribute's struct key,
 * a `data-*` key the plan admits, or `@<clark>` (an undeclared attribute) is an attribute segment.
 * A key equal to an `elements` slot key is an element segment for the slot's child, indexed only
 * when the parent holds more than one child of that Clark name; a `many` slot waits for its array
 * index instead. A `MissingKey` under an attribute or slot key prints no segment and names the
 * missing construct. The `"$text"` slot has no step of its own, and the `"$children"` slot waits
 * for its index.
 *
 * @param cursor - The element cursor.
 * @param key - The `Pointer` key.
 * @param next - The issue under the key when it is the last key of its `Pointer`.
 * @returns The step.
 */
const stepElement = (
  cursor: Extract<Cursor, { readonly kind: "element" }>,
  key: PropertyKey,
  next: SchemaIssue.Issue | undefined,
): Step => {
  const { element, plan } = cursor;
  const isMissing = next?._tag === "MissingKey";

  if (!Predicate.isString(key)) {
    return { cursor: opaque, segment: String(key) };
  }

  if (key === "name" && expectedName(next) === plan.name) {
    return { cursor, leaf: misnamed(plan, element) };
  }

  const attribute = plan.attributes.find((a) => a.key === key);

  if (attribute !== undefined) {
    return isMissing
      ? { cursor, leaf: missing(`<${plan.wire}> requires the attribute ${attribute.key}`) }
      : { cursor: opaque, segment: attributeSegment(plan, attribute.name) };
  }

  if (key.startsWith(UNDECLARED_ATTRIBUTE)) {
    return {
      cursor: opaque,
      segment: attributeSegment(plan, key.slice(UNDECLARED_ATTRIBUTE.length)),
    };
  }

  if (plan.data !== undefined && key.startsWith(DATA_PREFIX)) {
    return { cursor: opaque, segment: attributeSegment(plan, key) };
  }

  const { content } = plan;

  if (content.mode === "text" && key === content.key) {
    return { cursor: opaque };
  }

  if (content.mode === "mixed" && key === content.key) {
    return {
      cursor: {
        element,
        kind: "mixed",
        members: content.members,
        open: content.open,
        prefixes: plan.prefixes,
        wire: plan.wire,
      },
    };
  }

  const slot =
    content.mode === "elements" ? content.children.find((c) => c.key === key) : undefined;

  if (slot === undefined) {
    return { cursor: opaque, segment: key };
  }

  if (isMissing) {
    return { cursor, leaf: missing(`<${plan.wire}> requires a <${slot.wire}> child`) };
  }

  const matches = element.children.filter(isResolvedElement).filter((c) => c.name === slot.name);

  if (slot.cardinality === "many") {
    return { cursor: { kind: "many", matches, parent: element, slot } };
  }

  return {
    cursor: enter(slot.schema, matches[0]),
    elementStep: stepOf(element, matches[0]),
    segment: { index: matches.length > 1 ? 1 : undefined, kind: "element", name: slot.name },
  };
};

/**
 * Find the `mixed` member that decodes an element child: the one whose Clark name equals the
 * child's, the same match the union's name index makes.
 *
 * @param members - The members of the `mixed` content.
 * @param child - The element child.
 * @returns The member, or `undefined` when the child is not a declared member.
 */
const memberOf = (
  members: readonly MixedMember[],
  child: ResolvedElement,
): MixedMember | undefined => members.find((entry) => entry.name === child.name);

/**
 * The members of a `mixed` collision group that one union issue names, each paired with the issue
 * or success AST that names it.
 */
interface GroupMatch {
  readonly entry: MixedMember;
  readonly ast: SchemaAST.AST;
}

/**
 * Pair the item ASTs of a union issue with the colliding members they belong to.
 *
 * A union issue holds the union's own AST, and each success or branch AST it lists is one of that
 * union's `types`, on decode and on encode alike. The position of the AST among those types names
 * its item, and {@link itemOrder} maps the item back to the member: the text item stands at
 * position 0 and the open item after every member, so the member item at position `i` is entry
 * `i - 1`. The pair names exactly the members that matched however many members share the group
 * and wherever the union places them.
 *
 * @param members - The members of the `mixed` content, in author order.
 * @param union - The union AST the issue carries.
 * @param asts - The item ASTs: a `OneOf`'s successes or an `AnyOf`'s branch ASTs.
 * @returns The matches in author order, or `undefined` when fewer than two of them are colliding
 *   members.
 */
const groupMatches = (
  members: readonly MixedMember[],
  union: SchemaAST.Union,
  asts: readonly (SchemaAST.AST | undefined)[],
): readonly GroupMatch[] | undefined => {
  const colliding = collidingMembers(members);
  const items = itemOrder(members);

  const matches = asts.flatMap((ast) => {
    const entry = ast === undefined ? undefined : items[union.types.indexOf(ast) - 1];

    return ast !== undefined && entry !== undefined && colliding.has(entry) ? [{ ast, entry }] : [];
  });

  return matches.length > 1
    ? members.flatMap((member) => matches.filter(({ entry }) => entry === member))
    : undefined;
};

/**
 * Name one member of a collision group: its wire tag, its namespace, and its position in the
 * author's member list, since members of a Clark-name group differ in neither name.
 *
 * @param members - The members of the `mixed` content, in author order.
 * @param entry - The member.
 * @returns The member's label, such as `<p> in urn:a (member 1)`.
 */
const memberLabel = (members: readonly MixedMember[], entry: MixedMember): string => {
  const namespace = Option.getOrElse(parseClark(entry.name).namespace, () => "no namespace");

  return `<${entry.wire}> in ${namespace} (member ${members.indexOf(entry) + 1})`;
};

/**
 * State why one member of a collision group rejected a value: each issue under the member's item,
 * located by its key path inside the member's value.
 *
 * @param issue - The member's branch of the union issue.
 * @returns The reasons, joined with `; `.
 */
const rejection = (issue: SchemaIssue.Issue): string =>
  SchemaIssue.makeFormatterStandardSchemaV1()(issue)
    .issues.map(({ message, path }) => {
      const keys = (path ?? []).map(String);
      const inside = keys[0] === ITEM_VALUE ? keys.slice(1) : keys;

      return inside.length === 0 ? message : `${inside.join(".")}: ${message}`;
    })
    .join("; ");

/**
 * The leaf for an item that more than one member of a collision group accepts: a typed value or an
 * input element that fits two members exactly, which the item cannot choose between.
 *
 * @param cursor - The cursor standing on the `mixed` content or its element child.
 * @param matches - The group members that accepted the item.
 * @param direction - Whether the failure came from decoding XML or encoding a value.
 * @returns The leaf issue, whose message states its next action.
 */
const ambiguous = (
  cursor: Extract<Cursor, { readonly kind: "mixed" | "item" }>,
  matches: readonly GroupMatch[],
  direction: "decode" | "encode",
): SchemaIssue.Issue => {
  const labels = matches.map(({ entry }) => memberLabel(cursor.members, entry)).join(", ");

  const repair =
    direction === "decode"
      ? `Give the element an attribute or child only one of these members declares, or declare one member for <${matches[0]?.entry.wire ?? ""}> in <${cursor.wire}>.`
      : "Give the value a key only one of these members declares, or give the members distinct names.";

  return new SchemaIssue.InvalidValue({
    message: `the item matches more than one member of the mixed content of <${cursor.wire}>: ${labels}; exactly one must match. ${repair}`,
  });
};

/**
 * Collect the tags of the leaf issues under an issue.
 *
 * @param issue - The issue.
 * @returns The `_tag` of every leaf below the issue's composite nodes.
 */
const leafTags = (issue: SchemaIssue.Issue): readonly SchemaIssue.Leaf["_tag"][] => {
  if (issue._tag === "Filter" || issue._tag === "Encoding" || issue._tag === "Pointer") {
    return leafTags(issue.issue);
  }

  if (issue._tag === "Composite" || issue._tag === "AnyOf") {
    return issue.issues.flatMap(leafTags);
  }

  return [issue._tag];
};

/**
 * State the repair for a typed item no member of its collision group accepts exactly, one action
 * per kind of rejection the members report: an excess key, a missing key, or a value of the wrong
 * type. The missing-key action refers back to the intended member only when the excess action
 * names it first.
 *
 * @param branches - The members' branches of the union issue.
 * @returns The repair sentence.
 */
const exactRepair = (branches: readonly SchemaIssue.Issue[]): string => {
  const tags = new Set(branches.flatMap(leafTags));
  const excess = tags.has("UnexpectedKey");

  const actions = [
    excess ? "remove the keys the intended member does not declare" : undefined,
    tags.has("MissingKey")
      ? `add the keys ${excess ? "that" : "the intended"} member requires`
      : undefined,
    [...tags].some((tag) => tag !== "UnexpectedKey" && tag !== "MissingKey")
      ? "give each key a value the intended member accepts"
      : undefined,
  ].filter(Predicate.isNotUndefined);

  const listed =
    actions.length < 3
      ? actions.join(" and ")
      : `${actions.slice(0, -1).join(", ")}, and ${actions.at(-1) ?? ""}`;

  const action =
    actions.length === 0 ? "give the value the exact shape of the intended member" : listed;

  return excess
    ? `Members that share a tag keep every key of the value, so ${action}.`
    : `${action.charAt(0).toUpperCase()}${action.slice(1)}.`;
};

/**
 * The leaf for a typed item no member of its collision group accepts exactly: each member's
 * rejection, such as a key the member does not declare, and the repair those rejections call for.
 *
 * @param cursor - The cursor standing on the `mixed` content.
 * @param matches - The group members that rejected the item, each with its branch AST.
 * @param branches - The branches of the union issue.
 * @returns The leaf issue, whose message states its next action.
 */
const inexact = (
  cursor: Extract<Cursor, { readonly kind: "mixed" }>,
  matches: readonly GroupMatch[],
  branches: readonly SchemaIssue.Issue[],
): SchemaIssue.Issue => {
  const rejected = matches.map(({ ast, entry }) => ({
    branch: branches.find((candidate) => "ast" in candidate && candidate.ast === ast),
    entry,
  }));

  const reasons = rejected
    .map(({ branch, entry }) => {
      const reason = branch === undefined ? "" : ` rejects it (${rejection(branch)})`;

      return `${memberLabel(cursor.members, entry)}${reason}`;
    })
    .join(", ");

  const repair = exactRepair(
    rejected.flatMap(({ branch }) => (branch === undefined ? [] : [branch])),
  );

  return new SchemaIssue.InvalidValue({
    message: `the item matches no member of the mixed content of <${cursor.wire}> exactly: ${reasons}. ${repair}`,
  });
};

/**
 * Read the union issue at one index into `mixed` content as a collision-group failure.
 *
 * @param cursor - The cursor standing on the `mixed` content or its element child.
 * @param issue - The issue under the index, or `undefined` when it is not the last key.
 * @param direction - Whether the failure came from decoding XML or encoding a value.
 * @returns The group leaf, or `undefined` when the issue is not a group failure.
 */
const groupLeaf = (
  cursor: Extract<Cursor, { readonly kind: "mixed" | "item" }>,
  issue: SchemaIssue.Issue | undefined,
  direction: "decode" | "encode",
): SchemaIssue.Issue | undefined => {
  if (issue?._tag === "OneOf") {
    const matches = groupMatches(cursor.members, issue.ast, issue.successes);

    return matches === undefined ? undefined : ambiguous(cursor, matches, direction);
  }

  if (issue?._tag === "AnyOf" && cursor.kind === "mixed") {
    const asts = issue.issues.map((branch) => ("ast" in branch ? branch.ast : undefined));
    const matches = groupMatches(cursor.members, issue.ast, asts);

    return matches === undefined ? undefined : inexact(cursor, matches, issue.issues);
  }

  return undefined;
};

/**
 * Read one index into `mixed` content against the input element.
 *
 * A string child is a text item at its one-based position among the parent's string children.
 * An element child prints its local name, indexed one-based among the parent's element children
 * of the same Clark name when there is more than one, and the walk stands on it as an `item`
 * until the union issue under the index picks its member. Without an input child (an encode
 * failure, where the input is the bare root) the index prints as is, and a union issue under it
 * that a collision group raised ends the walk with the group's leaf (`groupLeaf`).
 *
 * @param cursor - The mixed cursor.
 * @param index - The index into the `mixed` content.
 * @param next - The issue under the index when it is the last key of its `Pointer`.
 * @returns The step.
 */
const stepMixed = (
  cursor: Extract<Cursor, { readonly kind: "mixed" }>,
  index: number,
  next: SchemaIssue.Issue | undefined,
): Step => {
  const { children } = cursor.element;
  const child = children[index];

  if (child === undefined) {
    const leaf = groupLeaf(cursor, next, "encode");

    return leaf === undefined
      ? { cursor: opaque, segment: String(index) }
      : { cursor: opaque, leaf, segment: String(index) };
  }

  if (Predicate.isString(child)) {
    const position = children.slice(0, index + 1).filter(Predicate.isString).length;

    return { cursor: opaque, segment: { index: position, kind: "text" } };
  }

  const siblings = children.filter(isResolvedElement).filter((c) => c.name === child.name);

  return {
    cursor: {
      element: child,
      kind: "item",
      members: cursor.members,
      open: cursor.open,
      prefixes: cursor.prefixes,
      wire: cursor.wire,
    },
    elementStep: stepOf(cursor.element, child),
    segment: {
      index: siblings.length > 1 ? siblings.indexOf(child) + 1 : undefined,
      kind: "element",
      name: child.name,
    },
  };
};

/**
 * Read one `Pointer` key against any cursor.
 *
 * Under a `many` cursor the array index selects the same-named sibling; the segment carries the
 * one-based index only when more than one sibling shares the name, or when the input does not
 * hold the child (an encode failure, where the input is the bare root). Under a `mixed` cursor
 * the index selects a text or element child (`stepMixed`). Under an `item` cursor the
 * `value` key of the member's item wrapper prints nothing and enters the member.
 *
 * @param cursor - The current cursor.
 * @param key - The `Pointer` key.
 * @param next - The issue under the key when it is the last key of its `Pointer`.
 * @returns The step.
 */
const step = (cursor: Cursor, key: PropertyKey, next: SchemaIssue.Issue | undefined): Step => {
  if (cursor.kind === "element") {
    return stepElement(cursor, key, next);
  }

  if (cursor.kind === "mixed" && Predicate.isNumber(key)) {
    return stepMixed(cursor, key, next);
  }

  if (cursor.kind === "item" && key === ITEM_VALUE) {
    const entry = memberOf(cursor.members, cursor.element);

    return { cursor: entry === undefined ? opaque : enter(entry.schema, cursor.element) };
  }

  if (cursor.kind === "many" && Predicate.isNumber(key)) {
    const child = cursor.matches[key];
    const index = cursor.matches.length > 1 || child === undefined ? key + 1 : undefined;

    return {
      cursor: enter(cursor.slot.schema, child),
      elementStep: stepOf(cursor.parent, child),
      segment: { index, kind: "element", name: cursor.slot.name },
    };
  }

  return { cursor: opaque, segment: String(key) };
};

/**
 * The input element an `element` or `mixed` cursor stands on.
 *
 * @param cursor - The cursor.
 * @returns The element, or `undefined` for a cursor that stands on none.
 */
const elementOf = (cursor: Cursor): ResolvedElement | undefined =>
  cursor.kind === "element" || cursor.kind === "mixed" ? cursor.element : undefined;

/**
 * Read the Clark name a union branch's issue is rooted in.
 *
 * Each branch of a `mixed` union is one member's item: an `Encoding` for the item wrapper over the
 * member codec's own issue, whose `ast` carries the member's `effect-xml` marker (plan lock 4). A
 * `suspend` member is forced before it fails, so its issue carries the referenced codec's marker
 * too; a bare `name` mismatch leaf names the member by the `Schema.Literal(<clark>)` it expected.
 *
 * @param issue - One branch of the union issue.
 * @returns The member's Clark name, or `undefined` when the branch names no member.
 */
const rootName = (issue: SchemaIssue.Issue): string | undefined => {
  const marker: unknown = "ast" in issue ? issue.ast.annotations?.[XML] : undefined;

  if (Predicate.hasProperty(marker, "name") && Predicate.isString(marker.name)) {
    return marker.name;
  }

  if (issue._tag === "Encoding") {
    return rootName(issue.issue);
  }

  if (issue._tag === "Composite") {
    return issue.issues[0] === undefined ? undefined : rootName(issue.issues[0]);
  }

  if (issue._tag === "Pointer" && issue.path.length === 1 && issue.path[0] === "name") {
    return expectedName(issue.issue);
  }

  return undefined;
};

/**
 * The leaf for an element child of `mixed` content that no member declares: it names the child
 * and the member set, and states its own next action.
 *
 * The child is spelled in the parent definition's prefixes and each member in its own
 * definition's prefixes (read through `planOf`), since a member authored under a different
 * `namespaces` map is known by the names that map gives it. Each is spelled against the other, so a
 * child that differs from a member in namespace alone writes both namespaces out.
 *
 * @param cursor - The item cursor standing on the child.
 * @returns The leaf issue.
 */
const unmatched = (cursor: Extract<Cursor, { readonly kind: "item" }>): SchemaIssue.Issue => {
  const { element, members, prefixes, wire } = cursor;

  const child = spell(
    element.name,
    prefixes,
    "element",
    members.map((entry) => entry.name),
  );

  const declared = members
    .map((entry) =>
      spell(entry.name, planOf(entry.schema)?.prefixes ?? prefixes, "element", [element.name]),
    )
    .join(", ");

  return new SchemaIssue.InvalidValue({
    message: `<${child}> is not a member of the mixed content of <${wire}>; declared members: ${declared}. Remove the element or declare it as a member of <${wire}>.`,
  });
};

/**
 * Where the walk goes after the union issue at an element child of `mixed` content: on from a
 * cursor into an issue, or to a leaf.
 */
type Resolution =
  | { readonly cursor: Cursor; readonly issue: SchemaIssue.Issue }
  | { readonly leaf: SchemaIssue.Issue };

/**
 * Resolve the union issue at an element child of `mixed` content by name match.
 *
 * The member whose Clark name equals the child's is the one the union's name index tried; its
 * branch is the one rooted in that name (`rootName`). Every other branch is a fallback that
 * failed on the name alone (a `suspend` member, which the index never covers), so it is dropped
 * and the walk continues into the kept branch from the member's plan. When no member declares
 * the child, the union holds no branch (a closed union) or only such fallbacks, and the leaf is
 * `unmatched`.
 *
 * A `OneOf` raised by a collision group, whose members share the child's Clark name and each
 * decode it, is the group's leaf (`groupLeaf`) rather than a branch to walk into.
 *
 * Open content adds the generic member last. Its guard refuses every declared Clark name with a
 * filter on `name`, which roots its branch in no member, so beside a failing declared member it is
 * one more dropped branch. An undeclared child fails only when the generic member itself rejects
 * it; that branch, the one rooted in no member, is the leaf, and the `suspend` fallbacks beside it
 * are dropped.
 *
 * @param cursor - The item cursor standing on the child.
 * @param issue - The union issue under the child's index.
 * @returns The cursor and issue to walk on, or the leaf.
 */
const resolveItem = (
  cursor: Extract<Cursor, { readonly kind: "item" }>,
  issue: SchemaIssue.Issue,
): Resolution => {
  const group = groupLeaf(cursor, issue, "decode");

  if (group !== undefined) {
    return { leaf: group };
  }

  const entry = memberOf(cursor.members, cursor.element);

  if (entry === undefined && cursor.open) {
    const generic =
      issue._tag === "AnyOf"
        ? issue.issues.find((branch) => rootName(branch) === undefined)
        : issue;

    return { leaf: generic ?? issue };
  }

  if (entry === undefined) {
    return { leaf: unmatched(cursor) };
  }

  const kept =
    issue._tag === "AnyOf" ? issue.issues.find((branch) => rootName(branch) === entry.name) : issue;

  return kept === undefined
    ? { leaf: issue }
    : { cursor: enter(entry.schema, cursor.element), issue: kept };
};

/**
 * Walk an issue tree from `cursor`, collecting segments until the leaf.
 *
 * `Pointer` keys step the cursor; `Composite` continues into its first issue, the one that
 * stopped the parse under the default `errors: "first"`; `Encoding` continues into its issue; on
 * an element child of `mixed` content the union issue resolves by name match (`resolveItem`).
 * Past a plan (an `opaque` cursor) the remaining non-`Pointer` issue is the leaf, and every other
 * issue tag is the leaf as it stands.
 *
 * @param cursor - Where the walk stands.
 * @param issue - The issue to walk.
 * @param segments - The segments collected so far.
 * @param elementPath - The element steps collected so far, one per element segment.
 * @param holder - The input element holding the last segment.
 * @returns The walk outcome.
 */
const walk = (
  cursor: Cursor,
  issue: SchemaIssue.Issue,
  segments: readonly PathSegment[],
  elementPath: ElementPath,
  holder: ResolvedElement | undefined,
): Walk => {
  if (issue._tag === "Pointer") {
    let current = cursor;
    let owner = holder;
    const out = [...segments];
    const steps = [...elementPath];

    for (const [position, key] of issue.path.entries()) {
      const next = position === issue.path.length - 1 ? issue.issue : undefined;
      const { cursor: following, elementStep, leaf, segment } = step(current, key, next);

      if (elementStep !== undefined) {
        steps.push(elementStep);
      }

      if (segment !== undefined) {
        out.push(segment);
        owner = elementOf(current) ?? owner;
      }

      if (leaf !== undefined) {
        return { element: owner, elementPath: steps, leaf, segments: out };
      }

      current = following;
    }

    return walk(current, issue.issue, out, steps, elementOf(current) ?? owner);
  }

  if (cursor.kind === "item") {
    const resolved = resolveItem(cursor, issue);

    return "leaf" in resolved
      ? { element: holder, elementPath, leaf: resolved.leaf, segments }
      : walk(resolved.cursor, resolved.issue, segments, elementPath, cursor.element);
  }

  if (cursor.kind !== "opaque" && issue._tag === "Composite") {
    return walk(cursor, issue.issues[0], segments, elementPath, holder);
  }

  if (cursor.kind !== "opaque" && issue._tag === "Encoding") {
    return walk(cursor, issue.issue, segments, elementPath, holder);
  }

  return { element: holder, elementPath, leaf: issue, segments };
};

/**
 * The result of `translate`: the XML path, outermost first, the element steps of that path
 * (zero-based positions among element children, for `locate`), and the leaf issue under it.
 */
export interface Translation {
  readonly segments: readonly PathSegment[];
  readonly elementPath: ElementPath;
  readonly leaf: SchemaIssue.Issue;
}

/**
 * Walk an issue from the root element of `plan`, whose own segment starts the path.
 *
 * @param plan - The plan of the codec that failed.
 * @param element - The input root element.
 * @param issue - The issue from the failure.
 * @returns The walk outcome.
 */
const walkFrom = (plan: Plan, element: ResolvedElement, issue: SchemaIssue.Issue): Walk =>
  walk(
    { element, kind: "element", plan },
    issue,
    [{ kind: "element", name: element.name }],
    [{ index: 0, local: parseClark(element.name).local }],
    element,
  );

// Native: `SchemaIssue` paths and formatters lack a map from struct keys to XML names.
/**
 * Translate a struct-keyed `SchemaIssue` from decoding `element` with the codec of `plan` into an
 * XPath-like path and the leaf issue under it.
 *
 * The path starts at the root element. Attribute keys become `@name` segments, `elements` slot
 * keys become the child's Clark name (with a one-based index only among same-named siblings), and
 * a missing attribute or child keeps the parent path with a leaf that names it. A `mixed` index
 * becomes `text()[j]` for a text child or the element child's name, and the union issue under an
 * element child resolves to the branch of the member with the child's Clark name; a child no
 * member declares ends the walk with a leaf naming it and the member set.
 *
 * @param plan - The plan of the codec that failed.
 * @param element - The input element, or the bare root when there is none (encoding).
 * @param issue - The issue from the failure.
 * @returns The path segments, outermost first, and the leaf issue.
 */
export const translate = (
  plan: Plan,
  element: ResolvedElement,
  issue: SchemaIssue.Issue,
): Translation => {
  const { elementPath, leaf, segments } = walkFrom(plan, element, issue);

  return { elementPath, leaf, segments };
};

/**
 * Format a leaf issue as the expectation of a message, with the upstream default hooks.
 *
 * @param leaf - The leaf issue.
 * @returns Each message under the leaf, joined with `; `.
 */
const expectationOf = (leaf: SchemaIssue.Issue): string =>
  SchemaIssue.makeFormatterStandardSchemaV1()(leaf)
    .issues.map((entry) => entry.message)
    .join("; ");

/**
 * The `what` and `repair` parts of a `formatMessage` message: the failing thing and the
 * concrete next action, absent when the leaf's own message states it.
 */
interface Subject {
  readonly what: string;
  readonly repair?: string;
}

/**
 * Whether a leaf's message already states its next action.
 *
 * A bare `InvalidValue` with an authored `message` at the end of a walk is a message the library
 * wrote: `compile` fails its getters with such leaves, each ending in the repair, and so does
 * `unmatched`. Leaves from a declared schema arrive wrapped (`Encoding`, `Filter`) or with
 * the upstream default text, which names the expectation only.
 *
 * @param leaf - The leaf issue.
 * @returns `true` when the generic repair would add a second next action.
 */
const statesRepair = (leaf: SchemaIssue.Issue): boolean =>
  leaf._tag === "InvalidValue" && Predicate.isString(leaf.annotations?.message);

/**
 * Name the failing thing and the generic repair for its kind from the last segment of a walk.
 *
 * @param walked - The walk outcome.
 * @param direction - Whether the failure came from decoding XML or encoding a value.
 * @returns The `what` and `repair` parts of the message.
 */
const subjectWithRepair = (walked: Walk, direction: "decode" | "encode"): Required<Subject> => {
  const last = walked.segments.at(-1);

  if (walked.leaf._tag === "MissingKey") {
    return {
      repair:
        direction === "decode"
          ? "add it to the element, or declare it optional"
          : "give the value this field, or declare it optional",
      what: `element ${last === undefined ? "/" : printSegment(last)}`,
    };
  }

  if (last !== undefined && !Predicate.isString(last) && last.kind === "attribute") {
    const label = printSegment(last).slice(1);

    if (direction === "encode") {
      return {
        repair: `give ${label} a value its schema accepts`,
        what: `the value of attribute ${label}`,
      };
    }

    const raw = walked.element?.attributes[last.name];

    return {
      repair: `change or remove ${label} so it meets this expectation`,
      what: raw === undefined ? `attribute ${label}` : `attribute ${label}="${raw}"`,
    };
  }

  const name = last === undefined ? "/" : printSegment(last);

  return direction === "decode"
    ? { repair: "change the element to match its definition", what: `element ${name}` }
    : { repair: "give the value a shape its schema accepts", what: `the value of element ${name}` };
};

/**
 * Name the failing thing and its repair from the last segment of a walk.
 *
 * @param walked - The walk outcome.
 * @param direction - Whether the failure came from decoding XML or encoding a value.
 * @returns The `what` and `repair` parts of the message.
 */
const subjectOf = (walked: Walk, direction: "decode" | "encode"): Subject => {
  const { repair, what } = subjectWithRepair(walked, direction);

  return statesRepair(walked.leaf) ? { what } : { repair, what };
};

/**
 * The `what`, `expectation`, and `repair` parts a decode error's message is rendered from.
 */
export interface MessageParts extends Subject {
  readonly expectation: string;
}

/**
 * The parts of each decode error built by `decodeError`.
 *
 * The class keeps only the rendered `message`, and holding the parts as schema fields would change
 * the public error shape, so this carrier keyed by the error instance lets `withPosition`
 * re-render through `formatMessage` instead of editing the message text. The parts of a
 * `SchemaFailure` reason come from a walk over the plan and the input element, and those of a
 * resolver-synthesized `WellFormedness` from the violated namespace rule; neither is recoverable
 * from the reason fields alone, which is why the carrier exists. Every decode error this library
 * builds goes through `decodeError`, so the carrier always holds its parts.
 */
const rendered = new WeakMap<XmlDecodeError, MessageParts>();

/**
 * The suffix upstream appends to an `Xml.XmlError` message that has a line and column.
 */
const UPSTREAM_POSITION = / at line \d+, column \d+$/u;

const UNSUPPORTED_ENCODING = /^encoding (?<encoding>\S+) is not supported/u;

/**
 * Choose the repair for an upstream parse failure by its kind: the markup is at fault only for
 * `Syntax`; an `Unsupported` input needs a different encoding or construct, not a markup fix.
 *
 * @param cause - The upstream parse failure.
 * @returns The repair clause.
 */
const wellFormednessRepair = (cause: Xml.XmlError): string => {
  if (cause.kind === "Unsupported") {
    const encoding = UNSUPPORTED_ENCODING.exec(cause.message)?.groups?.encoding;

    return encoding === undefined
      ? "remove the unsupported construct or replace it with one the parser supports"
      : `decode the ${encoding} bytes to text, or supply UTF-8 bytes`;
  }

  if (cause.kind === "Limit") {
    return "reduce the size or nesting of the input, or raise the parser limit";
  }

  if (cause.kind === "InvalidEvent") {
    return "pass a well-formed sequence of XML events";
  }

  return "fix the markup at the reported position";
};

/**
 * The message parts of an upstream parse failure.
 *
 * An `Unsupported` failure names input the parser declines rather than malformed markup, so its
 * expectation says the parser does not support the input; every other kind says the text is not
 * well-formed XML. The upstream position suffix is removed from the expectation, so the position
 * appears once, in the parenthetical `withPosition` renders from the `line` and `column` of
 * `cause`.
 *
 * @param cause - The upstream parse failure.
 * @returns The `what`, `expectation`, and `repair` parts.
 */
export const wellFormednessParts = (cause: Xml.XmlError): MessageParts => {
  const detail = cause.message.replace(UPSTREAM_POSITION, "");

  return {
    expectation:
      cause.kind === "Unsupported"
        ? `the parser does not support the input (${detail})`
        : `the text is not well-formed XML (${detail})`,
    repair: wellFormednessRepair(cause),
    what: "document",
  };
};

/**
 * The message parts of a prefix with no binding in scope.
 *
 * @param reason - The unbound prefix and the construct that used it.
 * @returns The `what`, `expectation`, and `repair` parts.
 */
export const undeclaredParts = (
  reason: Pick<UndeclaredPrefix, "prefix" | "where">,
): MessageParts => ({
  expectation: `prefix ${reason.prefix} is not declared`,
  repair: `declare xmlns:${reason.prefix} on this element or an ancestor`,
  what: reason.where,
});

/**
 * The message parts of a `Limit` failure, shared by `limitMessage` and the builders of
 * `Limit` failures.
 *
 * A record budget names its record root and the count it measured, and its repair offers a
 * smaller record path. A tokenizer limit has neither, so the subject is the document, the
 * expectation states only the maximum, and the repair only raises or disables the limit.
 *
 * @param reason - The limit, its configured maximum, and, for a record budget, the measured count
 *   and the record root.
 * @returns The `what`, `expectation`, and `repair` parts.
 */
export const limitParts = (
  reason: Pick<Limit, "element" | "limit" | "max" | "measured">,
): MessageParts => {
  const { element, limit, max, measured } = reason;
  const unit = limit === "maxElementNodes" ? "nodes" : "characters";

  return {
    expectation:
      measured === undefined ? `limit ${max}` : `counted ${measured} ${unit}, limit ${max}`,
    repair:
      measured === undefined
        ? `raise ${limit} or pass Infinity to disable it`
        : `raise ${limit}, pass Infinity to disable it, or decode a smaller record path`,
    what:
      element === undefined
        ? `document exceeds ${limit}`
        : `element <${parseClark(element).local}> exceeds ${limit}`,
  };
};

/**
 * Render the message of a {@link Limit} failure: `element <local> exceeds <limit> at <path> of
 * record <k>: counted <measured> <nodes|characters>, limit <max>; raise <limit>, pass Infinity
 * to disable it, or decode a smaller record path`.
 *
 * @param parts - The `Limit` reason fields, the `xpath` of the record root, and the record
 *   ordinal.
 * @returns The message text.
 */
export const limitMessage = (
  parts: Required<Pick<Limit, "element" | "limit" | "max" | "measured">> & {
    readonly path: string;
    readonly record: number;
  },
): string => formatMessage({ ...limitParts(parts), path: parts.path, record: parts.record });

/**
 * Build a decode error whose `message` is rendered from `fields.parts` through
 * `formatMessage`. This is the one construction path for every decode error the library
 * raises, so `withPosition` re-renders any of them with the same `what`, `expectation`, and
 * `repair`.
 *
 * @param fields - The error to build.
 * @param fields.parts - The `what`, `expectation`, and `repair` of the message.
 * @param fields.path - The `xpath` of the failure.
 * @param fields.reason - The classified cause.
 * @param fields.record - The ordinal of the collected record the failure is inside, when there is
 *   one.
 * @param fields.position - The source position of the failure, when known.
 * @returns The decode error.
 */
export const decodeError = (fields: {
  readonly parts: MessageParts;
  readonly path: string;
  readonly reason: XmlDecodeError["reason"];
  readonly record?: number | undefined;
  readonly position?: Position | undefined;
}): XmlDecodeError => {
  const { parts, path, position, reason, record } = fields;

  const props: Types.Mutable<ConstructorParameters<typeof XmlDecodeError>[0]> = {
    message: formatMessage({ ...parts, path, position, record }),
    path,
    reason,
  };

  if (position !== undefined) {
    props.position = position;
  }

  if (record !== undefined) {
    props.record = record;
  }

  const error = new XmlDecodeError(props);

  rendered.set(error, parts);

  return error;
};

/**
 * The message parts of a decode error, read from `decodeError`'s carrier. An error built by
 * other code has none recorded, so its parts are derived from its reason with the same part
 * builders; a `SchemaFailure` reason has no plan to walk there and names the value with a generic
 * repair.
 *
 * @param error - The decode error.
 * @returns The parts.
 */
const partsOf = (error: XmlDecodeError): MessageParts => {
  const known = rendered.get(error);

  if (known !== undefined) {
    return known;
  }

  const { reason } = error;

  if (reason._tag === "WellFormedness" || reason._tag === "Unsupported") {
    return wellFormednessParts(reason.cause);
  }

  if (reason._tag === "UndeclaredPrefix") {
    return undeclaredParts(reason);
  }

  if (reason._tag === "Limit") {
    return limitParts(reason);
  }

  return {
    expectation: expectationOf(reason.cause.issue),
    repair: "change the input so it matches the codec",
    what: "the value",
  };
};

/**
 * Attach a source position to a decode error. The result has the same `reason`, `path`, and
 * `record`, the `position` set, and a `message` re-rendered through `formatMessage` from the
 * same parts, so the position appears once, in the parenthetical, and the repair is unchanged.
 *
 * @param error - The decode error.
 * @param position - The source position of the failure.
 * @returns The positioned error.
 */
export const withPosition = (error: XmlDecodeError, position: Position): XmlDecodeError =>
  decodeError({
    parts: partsOf(error),
    path: error.path,
    position,
    reason: error.reason,
    record: error.record,
  });

/**
 * The limit name and maximum a tokenizer `Limit` message states, as in `element nesting exceeds
 * maxDepth of 1` or `token exceeds maxTokenSize of 4096`.
 *
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/encoding/Xml.ts `Parser.error`
 */
const PARSER_LIMIT = /\b(?<limit>maxDepth|maxTokenSize) of (?<max>\d+|Infinity)\b/u;

/**
 * Report whether a limit name read from a parser message is one the {@link Limit} reason models
 * for a tokenizer limit.
 */
const isParserLimit = Schema.is(Schema.Literals(["maxDepth", "maxTokenSize"]));

/**
 * Classify an upstream parser failure into its decode reason and message parts.
 *
 * Kind `Unsupported` becomes reason `Unsupported`. Kind `Limit` becomes reason `Limit` when its
 * message names `maxDepth` or `maxTokenSize` and the maximum, the only facts upstream reports
 * about the limit; any other `Limit` message, and every other kind, stays `WellFormedness`, so an
 * unrecognized message keeps its upstream cause rather than inventing limit fields.
 *
 * @param cause - The upstream parser failure.
 * @returns The reason and its message parts.
 */
const parserReason = (cause: Xml.XmlError) => {
  if (cause.kind === "Unsupported") {
    return { parts: wellFormednessParts(cause), reason: new Unsupported({ cause }) };
  }

  const groups = cause.kind === "Limit" ? PARSER_LIMIT.exec(cause.message)?.groups : undefined;

  if (groups !== undefined && isParserLimit(groups.limit)) {
    const reason = new Limit({ limit: groups.limit, max: Number(groups.max) });

    return { parts: limitParts(reason), reason };
  }

  return { parts: wellFormednessParts(cause), reason: new WellFormedness({ cause }) };
};

// Native: Xml.XmlError has a `kind` but names the exceeded limit and its maximum only in `message`.
/**
 * Convert an upstream `Xml.XmlError` into an `XmlDecodeError` at the document root `/`.
 *
 * A failure of kind `Unsupported` has reason {@link Unsupported}; a `Limit` failure over
 * `maxDepth` or `maxTokenSize` has reason {@link Limit} with that `limit` and its `max`, and no
 * `element` or `measured`; every other failure has reason {@link WellFormedness}. A
 * `WellFormedness` or `Unsupported` message quotes the upstream message without its position
 * suffix, and the position appears once, from the parser's own line and column. This is the one
 * mapping from a parser failure to a decode error, so a parser failure is positioned exactly once.
 *
 * @param cause - The upstream parser failure.
 * @returns The decode error, positioned at the parser's line and column when it reports both.
 */
export const parserError = (cause: Xml.XmlError): XmlDecodeError => {
  const { column, line } = cause;

  return decodeError({
    ...parserReason(cause),
    path: "/",
    position: Predicate.isNumber(line) && Predicate.isNumber(column) ? { column, line } : undefined,
  });
};

/**
 * Convert the `Schema.SchemaError` of decoding `element` into an `XmlDecodeError` with reason
 * `SchemaFailure`, the translated path, and a `<what> at <path>: <expectation>; <repair>` message.
 *
 * @param plan - The plan of the codec that failed.
 * @param element - The input element.
 * @param error - The decode failure; it stays the reason's `cause`.
 * @param record - The one-based ordinal of the collected record the failure is inside, when it
 *   came from a stream; the message then reads `of record <k>`.
 * @returns The decode error.
 */
export const toDecodeError = (
  plan: Plan,
  element: ResolvedElement,
  error: Schema.SchemaError,
  record?: number,
): XmlDecodeError => {
  const walked = walkFrom(plan, element, error.issue);

  const path = xpath(walked.segments);
  const parts = { ...subjectOf(walked, "decode"), expectation: expectationOf(walked.leaf) };

  return decodeError({
    parts,
    path,
    reason: new SchemaFailure({ cause: error, elementPath: walked.elementPath }),
    record,
  });
};

/**
 * Convert the `Schema.SchemaError` of encoding a value with the codec of `plan` into an
 * `XmlEncodeError` with reason `EncodeSchemaFailure`, the translated path, and a message in
 * the same form as `toDecodeError`.
 *
 * There is no input element when encoding fails, so the walk runs over bare elements of each
 * plan's name: a `many` child prints its one-based index from the value's array.
 *
 * @param plan - The plan of the codec that failed.
 * @param error - The encode failure; it stays the reason's `cause`.
 * @returns The encode error.
 */
export const toEncodeError = (plan: Plan, error: Schema.SchemaError): XmlEncodeError => {
  const root: ResolvedElement = { attributes: {}, children: [], name: plan.name };

  const walked = walkFrom(plan, root, error.issue);

  const path = xpath(walked.segments);

  return new XmlEncodeError({
    message: formatMessage({
      ...subjectOf(walked, "encode"),
      expectation: expectationOf(walked.leaf),
      path,
    }),
    path,
    reason: new EncodeSchemaFailure({ cause: error }),
  });
};
