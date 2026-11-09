import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";

import { ResolvedElementSchema, isResolvedElement, parseClark, spell } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import { DATA_PREFIX, XML, collidingMembers } from "./plan.ts";
import type { ChildPlan, ContentPlan, MixedMember, Plan } from "./plan.ts";
import { passthroughTo } from "./passthrough.ts";
import { compiledLinks } from "./structural-slot.ts";

/**
 * The fields of an element's target Struct, keyed by attribute and content slot keys.
 */
type TargetFields = Record<string, Schema.Top>;

/**
 * The encoded side of an element's target Struct: what decoding a resolved element produces and
 * what encoding a typed value starts from.
 */
type TargetEncoded = Schema.Struct<TargetFields>["Encoded"];

/**
 * Fail a getter with an `InvalidValue` issue located at `path` inside the element.
 *
 * @param path - The pointer path, such as `["@id"]` for an attribute or `[]` for the element.
 * @param message - The caller-facing message.
 * @returns A failed effect carrying the located issue.
 */
const invalid = (path: readonly PropertyKey[], message: string) =>
  Effect.fail(new SchemaIssue.Pointer(path, new SchemaIssue.InvalidValue({ message })));

/**
 * Whether a text child is blank: `text.trim()` removes all of it. Blank text is the only text an
 * `empty` element admits and the text `elements` content drops.
 *
 * XML whitespace (space, tab, line feed, carriage return) is checked inline, and any other ASCII
 * character settles the answer as non-blank without allocating. Any other character defers to
 * `trim`, whose set also covers U+000B, U+000C, U+00A0, U+FEFF, U+2028, U+2029, and the `Zs`
 * spaces, so the result equals `text.trim() === ""` for every string.
 *
 * The loop reads UTF-16 code units. A surrogate unit is at least `0xD800`, so it defers to `trim`
 * exactly where its code point would; reading code points instead would change no result, and its
 * per-character `codePointAt` call is the largest cost of this check on Bun.
 *
 * @param text - The text child.
 * @returns `true` when `text.trim()` is empty.
 * @see https://tc39.es/ecma262/#sec-string.prototype.trim
 * @see `docs/rd/perf3b-spikes/builder.md` for the measured cost of `codePointAt` here.
 */
export const isBlank = (text: string): boolean => {
  const { length } = text;

  for (let index = 0; index < length; index += 1) {
    // oxlint-disable-next-line unicorn/prefer-code-point -- a code unit decides the same as its code point (see above); `charCodeAt` alone cut the builder to 0.88 of its CPU on Bun bank-4m (docs/rd/perf3b-spikes/builder.md).
    const code = text.charCodeAt(index);

    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      continue;
    }

    if (code < 0x80 && code !== 0x0b && code !== 0x0c) {
      return false;
    }

    return text.trim() === "";
  }

  return true;
};

/**
 * The name of the generic member of open content: the slot key of open `elements` content, which
 * holds the child elements no slot names, and the `_tag` of an undeclared element in open `mixed`
 * content. `*` is not an XML `NameStartChar`, so it collides with no authored slot key or member
 * name.
 */
export const GENERIC = "*" as const;

/**
 * The prefix of the `Pointer` key that locates an undeclared attribute, followed by its Clark
 * name; the issue translator in `issue.ts` reads it back as an attribute segment.
 */
export const UNDECLARED_ATTRIBUTE = "@";

/**
 * The key of the decoded member value inside a `mixed` member's `{ _tag, value }` item; the issue
 * translator in `issue.ts` steps through it without printing an XML step.
 */
export const ITEM_VALUE = "value";

/**
 * The `text` variant of `ContentPlan`.
 */
type TextContent = Extract<ContentPlan, { readonly mode: "text" }>;

/**
 * The `elements` variant of `ContentPlan`.
 */
type ElementsContent = Extract<ContentPlan, { readonly mode: "elements" }>;

/**
 * The `mixed` variant of `ContentPlan`.
 */
type MixedContent = Extract<ContentPlan, { readonly mode: "mixed" }>;

/**
 * The children of a resolved element.
 */
type Children = ResolvedElement["children"];

/**
 * The value of one target field as decoding hands it to the target Struct: an attribute or text
 * string, the element of a `one` or `optional` slot, or the elements of a `many` slot.
 */
type FieldValue = string | ResolvedElement | Children;

/**
 * Decode `empty` content: only whitespace-only text children are admitted.
 *
 * @param plan - The element plan, for the message.
 * @param children - The element's children.
 * @returns An effect that succeeds with no content fields.
 */
const decodeEmpty = Effect.fnUntracedEager(function* fromEmpty(plan: Plan, children: Children) {
  const content = children.find((child) => !Predicate.isString(child) || !isBlank(child));

  if (content !== undefined) {
    const found = Predicate.isString(content)
      ? `text "${content.trim()}"`
      : `<${spell(content.name, plan.prefixes, "element")}>`;

    return yield* invalid(
      [],
      `<${plan.wire}> must be empty but contains ${found}. Remove the content or declare text, element, or mixed content for <${plan.wire}>.`,
    );
  }

  return {};
});

/**
 * Decode `text` content: join the string children, whitespace-only runs included, into the text
 * slot; the slot's `Schema.toCodecStringTree` field then decodes the joined string.
 *
 * @param plan - The element plan, for the message.
 * @param content - The text content plan.
 * @param children - The element's children.
 * @returns An effect that succeeds with the text slot field.
 */
const decodeText = Effect.fnUntracedEager(function* fromText(
  plan: Plan,
  content: TextContent,
  children: Children,
) {
  const element = children.find(isResolvedElement);

  if (element !== undefined) {
    return yield* invalid(
      [],
      `<${plan.wire}> holds text only but contains <${spell(element.name, plan.prefixes, "element")}>. Remove the element or declare element or mixed content for <${plan.wire}>.`,
    );
  }

  return { [content.key]: children.filter(Predicate.isString).join("") };
});

/**
 * Decode `elements` content: drop whitespace-only text and group child elements by Clark name
 * into their slots, an array for a `many` slot and the element itself otherwise. An absent
 * `optional` slot is omitted; an absent `one` slot is left to the target Struct, whose own
 * `MissingKey` issue reports it. Open content collects every child element no slot names into
 * `GENERIC` in document order; closed content fails at the first such child.
 *
 * Grouping appends to each slot's array in place and fails a `one` or `optional` slot at its
 * second child, so decoding stays linear in the number of children.
 *
 * @param plan - The element plan, for the messages.
 * @param content - The elements content plan.
 * @param slots - The slots of `content` by Clark name, built once per plan by {@link slotsOf}.
 * @param children - The element's children.
 * @returns An effect that succeeds with the slot fields.
 */
const decodeElements = Effect.fnUntracedEager(function* fromElements(
  plan: Plan,
  content: ElementsContent,
  slots: ReadonlyMap<string, ChildPlan>,
  children: Children,
) {
  const groups = new Map<string, ResolvedElement[]>();
  const undeclared: ResolvedElement[] = [];

  for (const child of children) {
    if (Predicate.isString(child)) {
      if (!isBlank(child)) {
        return yield* invalid(
          [],
          `<${plan.wire}> holds child elements only but contains text "${child.trim()}". Remove the text or declare mixed content for <${plan.wire}>.`,
        );
      }

      continue;
    }

    const slot = slots.get(child.name);

    if (slot === undefined && content.open) {
      undeclared.push(child);

      continue;
    }

    if (slot === undefined) {
      const found = spell(
        child.name,
        plan.prefixes,
        "element",
        content.children.map((s) => s.name),
      );

      const { local } = parseClark(child.name);

      // A slot sharing the child's local part differs only by namespace, so `spell` writes it out.
      const expected =
        content.children
          .map((s) =>
            parseClark(s.name).local === local
              ? spell(s.name, plan.prefixes, "element", [child.name])
              : s.wire,
          )
          .join(", ") || "(none)";

      return yield* invalid(
        [],
        `<${found}> is not a declared child of <${plan.wire}>; declared children: ${expected}. Remove the element or declare it as a child of <${plan.wire}>.`,
      );
    }

    const group = groups.get(slot.key);

    if (group === undefined) {
      groups.set(slot.key, [child]);
    } else if (slot.cardinality === "many") {
      group.push(child);
    } else {
      return yield* invalid(
        [slot.key],
        `<${plan.wire}> admits at most one <${slot.wire}> but contains more than one. Remove the extra <${slot.wire}> elements or declare the slot as many.`,
      );
    }
  }

  const out: Record<string, FieldValue> = {};

  for (const slot of content.children) {
    const group = groups.get(slot.key) ?? [];
    const [first] = group;

    if (slot.cardinality === "many") {
      out[slot.key] = group;
    } else if (first !== undefined) {
      out[slot.key] = first;
    }
  }

  if (content.open) {
    out[GENERIC] = undeclared;
  }

  return out;
});

/**
 * Encode the text slot to the element's children: one string child, or none for empty text.
 *
 * @param plan - The element plan, for the message.
 * @param content - The text content plan.
 * @param value - The encoded side of the target Struct.
 * @returns An effect that succeeds with the children.
 */
const encodeText = Effect.fnUntraced(function* toText(
  plan: Plan,
  content: TextContent,
  value: TargetEncoded,
) {
  const raw = value[content.key];

  if (!Predicate.isString(raw)) {
    return yield* invalid(
      [content.key],
      `The text of <${plan.wire}> did not encode to a string. Give the text slot a schema whose encoded side is a string.`,
    );
  }

  const children: Children = raw === "" ? [] : [raw];

  return children;
});

/**
 * Encode the slots to the element's children, slot by slot in declaration order: every element of
 * a `many` slot, the element of a present `one` or `optional` slot, nothing for an absent one.
 * Open content then writes the elements of `GENERIC` in their stored order, after every
 * declared slot.
 *
 * A slot holds any number of elements, so each element is appended one call at a time: a call
 * spread such as `push(...items)` passes every element as an argument, and V8 bounds the argument
 * count by its stack (Node 26 overflows between 120,000 and 150,000).
 *
 * @param plan - The element plan, for the message.
 * @param content - The elements content plan.
 * @param value - The encoded side of the target Struct.
 * @returns An effect that succeeds with the children.
 */
const encodeElements = Effect.fnUntraced(function* toElements(
  plan: Plan,
  content: ElementsContent,
  value: TargetEncoded,
) {
  const children: ResolvedElement[] = [];

  for (const slot of content.children) {
    const raw = value[slot.key];

    const items: readonly unknown[] = Array.isArray(raw)
      ? raw
      : [raw].filter(Predicate.isNotUndefined);

    if (!items.every(isResolvedElement)) {
      return yield* invalid(
        [slot.key],
        `Child <${slot.wire}> of <${plan.wire}> did not encode to an element. Give the slot an element codec built by compile.`,
      );
    }

    for (const item of items) {
      children.push(item);
    }
  }

  const undeclared = content.open ? value[GENERIC] : [];

  if (!Array.isArray(undeclared) || !undeclared.every(isResolvedElement)) {
    return yield* invalid(
      [GENERIC],
      `The undeclared children of <${plan.wire}> did not encode to elements. Hold resolved elements in the "${GENERIC}" slot.`,
    );
  }

  for (const element of undeclared) {
    children.push(element);
  }

  return children;
});

/**
 * Whether a value is a child of a resolved element: a text run or an element.
 */
const isChild = Predicate.or(Predicate.isString, isResolvedElement);

/**
 * Encode the mixed items to the element's children: the items slot already holds the strings and
 * elements in document order, so each is checked and passed through.
 *
 * @param plan - The element plan, for the message.
 * @param content - The mixed content plan.
 * @param value - The encoded side of the target Struct.
 * @returns An effect that succeeds with the children.
 */
const encodeMixed = Effect.fnUntraced(function* toMixed(
  plan: Plan,
  content: MixedContent,
  value: TargetEncoded,
) {
  const raw = value[content.key];

  if (!Array.isArray(raw) || !raw.every(isChild)) {
    return yield* invalid(
      [content.key],
      `The mixed content of <${plan.wire}> did not encode to text and elements. Give every member an element codec built by compile.`,
    );
  }

  const children: Children = raw;

  return children;
});

/**
 * Index the slots of `elements` content by Clark name, the lookup `decodeElements` groups each
 * child by. Plans are immutable, so the index is built once per plan and shared by every element
 * the plan decodes. The builder reads the same index, so both group children by one rule.
 *
 * @param content - The element's content plan.
 * @returns The slots by Clark name, empty for any other content mode.
 */
export const slotsOf = (content: ContentPlan): ReadonlyMap<string, ChildPlan> =>
  new Map(content.mode === "elements" ? content.children.map((slot) => [slot.name, slot]) : []);

/**
 * Decode an element's children into the content fields of its target Struct by content mode.
 *
 * @param plan - The element plan.
 * @param slots - The plan's `elements` slots by Clark name, from {@link slotsOf}.
 * @param children - The element's children.
 * @returns An effect that succeeds with the content fields.
 */
const decodeContent = (plan: Plan, slots: ReadonlyMap<string, ChildPlan>, children: Children) => {
  const { content } = plan;

  if (content.mode === "empty") {
    return decodeEmpty(plan, children);
  }

  if (content.mode === "text") {
    return decodeText(plan, content, children);
  }

  return content.mode === "elements"
    ? decodeElements(plan, content, slots, children)
    : Effect.succeed({ [content.key]: children });
};

/**
 * Encode the content fields of an element's target Struct back to its children by content mode.
 *
 * @param plan - The element plan.
 * @param value - The encoded side of the target Struct.
 * @returns An effect that succeeds with the children.
 */
const encodeContent = (plan: Plan, value: TargetEncoded) => {
  const { content } = plan;

  if (content.mode === "empty") {
    return Effect.succeed<Children>([]);
  }

  if (content.mode === "text") {
    return encodeText(plan, content, value);
  }

  return content.mode === "elements"
    ? encodeElements(plan, content, value)
    : encodeMixed(plan, content, value);
};

/**
 * Whether `name` is a `data-*` attribute the plan admits: the plan declares `data` and the name
 * carries `DATA_PREFIX`.
 *
 * @param plan - The element plan.
 * @param name - The attribute name or struct key.
 * @returns `true` when `name` is an admitted `data-*` attribute.
 */
export const isData = (plan: Plan, name: string): boolean =>
  plan.data !== undefined && name.startsWith(DATA_PREFIX);

/**
 * Index an element's declared attributes by Clark name, the lookup `decodeElement` maps each
 * attribute to its struct key by. Plans are immutable, so the index is built once per plan; the
 * builder reads the same index, so both admit and key attributes by one rule.
 *
 * @param plan - The element plan.
 * @returns The struct key of each declared attribute, by Clark name.
 */
export const attributeKeysOf = (plan: Plan): ReadonlyMap<string, string> =>
  new Map(plan.attributes.map((a) => [a.name, a.key]));

/**
 * Build the decoder from a resolved element to the encoded side of the element's target Struct.
 *
 * Declared attributes map from their Clark name to their struct key. When the plan declares
 * `data`, a `data-*` attribute passes through under its own name; any other attribute fails at
 * `@name` with a message that lists the declared set, ending with `data-*` when the plan declares
 * `data`. The children decode by content mode.
 *
 * This decoder and the content decoders it calls run their generators eagerly, when Schema calls
 * the decoder, and hand back an `Exit`. Schema's Struct and Array parsers stay on their
 * synchronous `Exit` path only while every nested parser returns an `Exit`; a suspended effect at
 * any element sends the rest of the decode through the fiber run loop. Eager evaluation keeps the
 * same success and failure, attribute failures before content failures, because each decoder
 * reads only its arguments.
 *
 * The attribute and slot lookups are built once here, when the plan compiles, and shared by every
 * element the decoder runs on: `Plan` is immutable, so they cannot go stale. Per-element state
 * (the output record, the slot groups, the undeclared children) stays inside each call. The
 * content fields merge into the attribute record in place, so content keys win and the key order
 * matches a `{ ...attributes, ...content }` spread.
 *
 * @param plan - The element plan.
 * @returns The decode function for `SchemaGetter.transformEffect`.
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/Effect.ts `fnUntracedEager`
 */
const decodeElement = (plan: Plan) => {
  const declared = attributeKeysOf(plan);
  const slots = slotsOf(plan.content);

  return Effect.fnUntracedEager(function* fromElement(element: ResolvedElement) {
    const out: Record<string, FieldValue> = {};

    for (const [name, value] of Object.entries(element.attributes)) {
      const key = declared.get(name) ?? (isData(plan, name) ? name : undefined);

      if (key === undefined) {
        const group = plan.data === undefined ? [] : [`${DATA_PREFIX}*`];
        const spelled = [...declared.keys()].map((n) => spell(n, plan.prefixes, "attribute"));
        const names = [...spelled, ...group].join(", ") || "(none)";

        return yield* invalid(
          [`${UNDECLARED_ATTRIBUTE}${name}`],
          `Attribute "${spell(name, plan.prefixes, "attribute")}" is not declared on <${plan.wire}>; declared attributes: ${names}. Remove the attribute or declare it on the element.`,
        );
      }

      out[key] = value;
    }

    const fields = yield* decodeContent(plan, slots, element.children);

    return Object.assign(out, fields);
  });
};

/**
 * Build the encoder from the encoded side of the element's target Struct back to a resolved
 * element.
 *
 * Absent optional attributes are omitted; when the plan declares `data`, every `data-*` key is
 * written back as an attribute of the same name. The children encode by content mode, with no
 * children for `empty`.
 *
 * @param plan - The element plan.
 * @returns The encode function for `SchemaGetter.transformEffect`.
 */
const encodeElement = (plan: Plan) =>
  Effect.fnUntraced(function* toElement(value: TargetEncoded) {
    const attributes: Record<string, string> = {};

    for (const a of plan.attributes) {
      const raw = value[a.key];

      if (raw !== undefined && !Predicate.isString(raw)) {
        return yield* invalid(
          [a.key],
          `Attribute "${a.name}" on <${plan.wire}> did not encode to a string. Give the attribute a schema whose encoded side is a string.`,
        );
      }

      if (raw !== undefined) {
        attributes[a.name] = raw;
      }
    }

    for (const [key, raw] of Object.entries(value).filter(([name]) => isData(plan, name))) {
      if (!Predicate.isString(raw)) {
        return yield* invalid(
          [key],
          `Attribute "${key}" on <${plan.wire}> did not encode to a string. Give the plan's data schema an encoded side that is a string.`,
        );
      }

      attributes[key] = raw;
    }

    const children = yield* encodeContent(plan, value);
    const element: ResolvedElement = { attributes, children, name: plan.name };

    return element;
  });

/**
 * Build the encoded side of an element codec: a resolved element's `attributes` and `children`,
 * and its Clark name checked by the given schema.
 *
 * @param name - The schema for the element's Clark name: a literal for a declared element, or a
 *   guarded string for the generic member of open `mixed` content.
 * @returns The resolved-element Struct.
 */
const wireElement = <Name extends Schema.Top>(name: Name) =>
  Schema.Struct({
    attributes: Schema.Record(Schema.String, Schema.String),
    children: Schema.Array(Schema.Union([Schema.String, ResolvedElementSchema])),
    name,
  });

/**
 * Build the target field of one `elements` slot from its cardinality: `Schema.Array` of the child
 * codec for `many`, `Schema.optionalKey` for `optional`, and the child codec itself for `one`.
 *
 * @param slot - The child slot.
 * @returns The slot's field schema.
 */
const slotField = (slot: ChildPlan): Schema.Top => {
  if (slot.cardinality === "many") {
    return Schema.Array(slot.schema);
  }

  return slot.cardinality === "optional" ? Schema.optionalKey(slot.schema) : slot.schema;
};

/**
 * The item for a text run of `mixed` content: the string child decodes to
 * `{ _tag: "$text", text }`. `$` is not an XML `NameChar`, so no member element name can take the
 * tag. The run itself stays under the item's own `text` field: an item holds no attributes, so
 * nothing else can claim that key.
 */
const TextItem = Schema.String.pipe(
  Schema.decodeTo(Schema.Struct({ _tag: Schema.Literal("$text"), text: Schema.String }), {
    decode: SchemaGetter.transform((text: string) => ({ _tag: "$text" as const, text })),
    encode: SchemaGetter.transform((item: { readonly text: string }) => item.text),
  }),
);

// Native: `Schema.Struct` strips excess keys before its checks run, and the 4.1.2 parser reads no per-node `parseOptions`, so no check or annotation can make one member's type side exact.
/**
 * Build the exact type side of one member of a collision group: a declaration over the member's
 * type side that parses a value with `onExcessProperty: "error"`, so a value with a key the member
 * does not declare fails that member instead of losing the key.
 *
 * Effect's own exactness rule applies at every depth of the member's value, and the run keeps the
 * caller's other parse options, so `errors: "all"` still collects every issue. The equivalence,
 * formatter, iso, and arbitrary derivations read `type`, so the member item derives the same
 * values as it does without the declaration.
 *
 * @param type - The type side of the member's element codec.
 * @returns The declaration that accepts only a value `type` accepts with no excess key.
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/SchemaAST.ts `ParseOptions` and `Declaration`
 */
const exactValue = (type: Schema.Top): Schema.Top =>
  Schema.declareConstructor<unknown, unknown>()(
    [type],
    ([member]) =>
      (input, _self, options) =>
        SchemaParser.decodeUnknownEffect(member)(input, { ...options, onExcessProperty: "error" }),
    {
      toCodec: ([parameter]) => passthroughTo(parameter),
      toCodecArbitrary: ({ typeParameters: [parameter] }) => passthroughTo(parameter),
      toCodecIso: ([parameter]) => passthroughTo(parameter),
      toEquivalence: ([equivalence]) => equivalence,
      toFormatter: ([format]) => format,
    },
  );

/**
 * Build the item for one `mixed` member: the member's element decodes to
 * `{ _tag: <wire>, value }`, tagged by the authored wire name the member's marker carries.
 *
 * A member of a collision group holds its value through {@link exactValue}, since the members of
 * the group share a `_tag` and only the value's exact shape tells them apart; every other member
 * holds the member's type side as it stands.
 *
 * @param entry - The mixed member.
 * @param exact - Whether the member belongs to a collision group.
 * @returns The member's item schema.
 */
const memberItem = (entry: MixedMember, exact: boolean): Schema.Top => {
  const type = Schema.toType(entry.schema);

  return entry.schema.pipe(
    Schema.decodeTo(
      Schema.Struct({
        [ITEM_VALUE]: exact ? exactValue(type) : type,
        _tag: Schema.Literal(entry.wire),
      }),
      {
        decode: SchemaGetter.transform((value) => ({ [ITEM_VALUE]: value, _tag: entry.wire })),
        encode: SchemaGetter.transform((item) => item[ITEM_VALUE]),
      },
    ),
  );
};

// Native: `Schema.Union` lacks a member that accepts any element without masking a declared member's failure.
/**
 * Build the generic item of open `mixed` content: an element no member names decodes to
 * `{ _tag: "*", element }`, holding the whole resolved element, and encodes back to that element
 * unchanged.
 *
 * A union member with no literal sentinel is a fallback candidate for every object input, and
 * the first successful candidate wins, so an unguarded generic member would capture a declared
 * element whose member fails, such as `<p n="x">` against an `Int` attribute, and hide that
 * member's issue. The guard on `name` refuses every declared Clark name: an undeclared element
 * reaches the generic member alone, and a declared element that fails reports an `AnyOf` holding
 * its member's issue beside the guard's. On encode the same guard refuses a `*` item named after a
 * declared member, an authoring error.
 *
 * @param plan - The element plan, for the guard's message.
 * @param content - The mixed content plan, whose members' Clark names the guard refuses.
 * @returns The generic item schema, the last candidate of the items union.
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/SchemaAST.ts `getCandidateIndex` and `parseUnion`
 */
const openItem = (plan: Plan, content: MixedContent): Schema.Top => {
  const declared = new Map(content.members.map((entry) => [entry.name, entry.wire]));
  const wires = [...declared.values()].join(", ") || "(none)";

  const guard = Schema.makeFilter(
    (name: string) => {
      const wire = declared.get(name);

      return wire === undefined
        ? undefined
        : `<${wire}> is a declared member of <${plan.wire}>, so the open member does not admit it. Repair the <${wire}> element so its member decodes it, or tag the item "${wire}" instead of "${GENERIC}".`;
    },
    { expected: `an element other than the declared members of <${plan.wire}>: ${wires}` },
  );

  return wireElement(Schema.String.check(guard)).pipe(
    Schema.decodeTo(
      Schema.Struct({ _tag: Schema.Literal(GENERIC), element: ResolvedElementSchema }),
      {
        decode: SchemaGetter.transform((element: ResolvedElement) => ({ _tag: GENERIC, element })),
        encode: SchemaGetter.transform(
          (item: { readonly element: ResolvedElement }) => item.element,
        ),
      },
    ),
  );
};

/**
 * List the members of `mixed` content in the order of their items in the compiled union: named
 * members first, then `suspend` members, author order kept within each.
 *
 * {@link mixedField} owns the reason for the order. Issue formatting reads a member back from its
 * union position through the same order, so the two cannot drift apart.
 *
 * @param members - The members of the `mixed` content, in author order.
 * @returns The members in union order.
 */
export const itemOrder = (members: readonly MixedMember[]): readonly MixedMember[] => [
  ...members.filter((entry) => !SchemaAST.isSuspend(entry.schema.ast)),
  ...members.filter((entry) => SchemaAST.isSuspend(entry.schema.ast)),
];

/**
 * Build the target field of `mixed` content: an array over the union of `TextItem` and one
 * item per member, ordered text first, then named members, then `suspend` members, author order
 * kept within each group. Open content appends `openItem` after every member.
 *
 * The order exists because of how `Schema.Union` selects candidates. A named member's encoded side
 * is the per-element Struct whose `name` is the literal Clark name, so the union indexes it by that
 * sentinel and tries only the member whose name matches a child element; a failing child reports
 * that member's issue alone. A `suspend` member has no sentinel before it is forced, so the union
 * treats it as a runtime-type fallback tried on every element child, in declaration order with the
 * indexed candidates. Placing `suspend` members last keeps a matching named member ahead of them,
 * whatever order the author wrote.
 *
 * Content with a collision group (see {@link collidingMembers}) builds the union with
 * `mode: "oneOf"`, and each group member's item holds its value exactly (see {@link memberItem}).
 * Members of a group share an item `_tag`, and on decode they can share a Clark name, so the union
 * tries each of them; `oneOf` keeps the one member that matches and fails when more than one does,
 * where `anyOf` would keep the first in author order. Candidates outside a group have distinct
 * sentinels and the open member refuses declared names, so none can match beside another.
 * Content with no group builds the same union as without this rule.
 *
 * @param plan - The element plan, for the open member's guard.
 * @param content - The mixed content plan.
 * @returns The items field schema.
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/SchemaAST.ts `getCandidateIndex`, `toCandidate`, and `Union`
 */
const mixedField = (plan: Plan, content: MixedContent): Schema.Top => {
  const colliding = collidingMembers(content.members);

  const items = [
    TextItem,
    ...itemOrder(content.members).map((entry) => memberItem(entry, colliding.has(entry))),
  ];

  const members = content.open ? [...items, openItem(plan, content)] : items;

  return Schema.Array(
    colliding.size === 0 ? Schema.Union(members) : Schema.Union(members, { mode: "oneOf" }),
  );
};

// Native: `Schema.toEncoderXml` and `Xml.elements` lack a map from resolved attributes and children to a typed Struct.
/**
 * Compile an element `Plan` into a codec between a resolved element and the element's typed
 * value.
 *
 * The encoded side is a per-element `Schema.Struct` whose `name` is the literal Clark name, so a
 * wrong element fails before any attribute is read. Each attribute decodes through
 * `Schema.toCodecStringTree` of its schema, which turns the attribute string into the declared
 * type. A `text` slot decodes the same way under `"$text"`; an `elements` slot is the child codec
 * itself, wrapped in `Schema.Array` for `many` and `Schema.optionalKey` for `optional`, and open
 * `elements` content adds the slot `"*"`, an array of the resolved elements no slot names. `mixed`
 * content passes the children through, whitespace-only runs included, to an array under
 * `"$children"` of items tagged `"$text"` or by the member's wire name; open `mixed` content tags
 * an undeclared element `*`. When the plan declares `data`, the target is `Schema.StructWithRest`
 * with a `Schema.Record` keyed by the template literal `data-${string}` whose values decode through
 * `Schema.toCodecStringTree` of the data schema. The result carries the marker `{ name, wire, plan
 * }` under `XML`, which `lower` reads to build parent plans. Its one encoding link is registered
 * in `compiledLinks`, so `structuralPlan` can tell this codec from a user wrapper around it.
 *
 * @param plan - The plan to compile.
 * @returns The element codec annotated with its marker.
 */
export const compile = (plan: Plan): Schema.Codec<unknown, ResolvedElement, unknown, unknown> => {
  const fields: TargetFields = {};

  for (const a of plan.attributes) {
    fields[a.key] = Schema.toCodecStringTree(a.schema);
  }

  const { content } = plan;

  if (content.mode === "text") {
    fields[content.key] = Schema.toCodecStringTree(content.schema);
  }

  if (content.mode === "elements") {
    for (const slot of content.children) {
      fields[slot.key] = slotField(slot);
    }

    if (content.open) {
      fields[GENERIC] = Schema.Array(ResolvedElementSchema);
    }
  }

  if (content.mode === "mixed") {
    fields[content.key] = mixedField(plan, content);
  }

  const from = wireElement(Schema.Literal(plan.name));
  const struct = Schema.Struct(fields);

  const target =
    plan.data === undefined
      ? struct
      : Schema.StructWithRest(struct, [
          Schema.Record(
            Schema.TemplateLiteral([DATA_PREFIX, Schema.String]),
            Schema.toCodecStringTree(plan.data),
          ),
        ]);

  const codec = from.pipe(
    Schema.decodeTo(target, {
      decode: SchemaGetter.transformEffect(decodeElement(plan)),
      encode: SchemaGetter.transformEffect(encodeElement(plan)),
    }),
  );

  const link = codec.ast.encoding?.[0];

  if (link !== undefined) {
    compiledLinks.add(link);
  }

  return codec.annotate({ [XML]: { name: plan.name, plan: () => plan, wire: plan.wire } });
};
