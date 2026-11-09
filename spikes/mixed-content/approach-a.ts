// Approach A: ordered node array with a discriminated union.
//
// Each element definition is one Schema codec. Its Encoded side is the upstream
// `Xml.Element` shape (name, attributes, children); its Type side is a tagged
// struct whose `content` array keeps document order. The same value decodes and
// encodes. Throwaway spike code; nothing here is library code.
import { Schema, SchemaGetter } from "effect";
import type { Xml } from "effect/encoding";

const Attributes = Schema.Record(Schema.String, Schema.String);

// Shallow guard: the upstream tree is trusted structurally; each definition
// checks the name it owns.
const AnyElement = Schema.declare(
  (u): u is Xml.Element =>
    typeof u === "object" && u !== null && "name" in u && typeof u.name === "string",
  { title: "Xml.Element" },
);

const Child = Schema.Union([Schema.String, AnyElement]);

// The encoded shape of one named element. `name` is a literal, so a union of
// definitions discriminates on it instead of trying every member.
const ElementNamed = <const Name extends string>(name: Name) =>
  Schema.Struct({
    name: Schema.Literal(name),
    attributes: Attributes,
    children: Schema.Array(Child),
  });

// An element whose content is an ordered array decoded by `Content`. Children
// pass through the transformation untouched; the target struct's `content`
// field decodes them, so each child is decoded once.
// `Content` must encode to what the upstream tree holds: a string or an element.
const mixed = <
  const Name extends string,
  Content extends Schema.Codec<unknown, string | Xml.Element, unknown, unknown>,
>(
  name: Name,
  Content: Content,
) =>
  ElementNamed(name).pipe(
    Schema.decodeTo(
      Schema.TaggedStruct(name, { attributes: Attributes, content: Schema.Array(Content) }),
      {
        decode: SchemaGetter.transform((e) => ({
          _tag: name,
          attributes: e.attributes,
          content: e.children,
        })),
        encode: SchemaGetter.transform((t) => ({
          name,
          attributes: t.attributes,
          children: t.content,
        })),
      },
    ),
  );

// An element declared empty: children are dropped on decode and absent on encode.
const empty = <const Name extends string>(name: Name) =>
  ElementNamed(name).pipe(
    Schema.decodeTo(Schema.TaggedStruct(name, { attributes: Attributes }), {
      decode: SchemaGetter.transform((e) => ({ _tag: name, attributes: e.attributes })),
      encode: SchemaGetter.transform((t) => ({ name, attributes: t.attributes, children: [] })),
    }),
  );

export const Text = Schema.String.pipe(
  Schema.decodeTo(Schema.TaggedStruct("text", { text: Schema.String }), {
    decode: SchemaGetter.transform((text) => ({ _tag: "text" as const, text })),
    encode: SchemaGetter.transform((t) => t.text),
  }),
);

export const Br = empty("br");
export const TextEntryInteraction = empty("qti-text-entry-interaction");

// Recursion: `strong` and `qti-hottext` hold inline content, which includes
// them. TypeScript cannot infer the knot (TS7022), so the recursive members are
// named once as interfaces and the `suspend` is annotated with them. This is the
// one place a type is written by hand.
type AttributeMap = Readonly<Record<string, string>>;
export interface TextNode {
  readonly _tag: "text";
  readonly text: string;
}
export interface StrongNode {
  readonly _tag: "strong";
  readonly attributes: AttributeMap;
  readonly content: ReadonlyArray<Inline>;
}
export interface BrNode {
  readonly _tag: "br";
  readonly attributes: AttributeMap;
}
export interface TextEntryInteractionNode {
  readonly _tag: "qti-text-entry-interaction";
  readonly attributes: AttributeMap;
}
export interface HottextNode {
  readonly _tag: "qti-hottext";
  readonly attributes: AttributeMap;
  readonly content: ReadonlyArray<Inline>;
}
export type Inline = TextNode | StrongNode | BrNode | TextEntryInteractionNode | HottextNode;

const InlineRef = Schema.suspend((): Schema.Codec<Inline, string | Xml.Element> => Inline);

export const Strong = mixed("strong", InlineRef);
export const Hottext = mixed("qti-hottext", InlineRef);

export const Inline = Schema.Union([Text, Strong, Br, TextEntryInteraction, Hottext]);

export const P = mixed("p", Inline);
export const SimpleChoice = mixed("qti-simple-choice", Inline);

export const decodeP = Schema.decodeUnknownEffect(P);
export const encodeP = Schema.encodeEffect(P);
export const decodeChoice = Schema.decodeUnknownEffect(SimpleChoice);
export const encodeChoice = Schema.encodeEffect(SimpleChoice);
