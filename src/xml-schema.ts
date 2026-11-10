/**
 * The schema-first XML surface, published as one namespace beside Effect's own
 * `effect/encoding/Xml`.
 *
 * Declare element codecs with {@link Element}, {@link text}, {@link elements}, {@link mixed},
 * {@link many}, and {@link optionalKey}; decode and encode whole documents with the {@link fromString}
 * codec; decode records from a stream with {@link decodeSchemaString} and {@link decodeSchema}. Every
 * caller failure is a {@link XmlDecodeError} or an {@link XmlEncodeError}, each carrying a tagged
 * reason.
 *
 * {@link suspend} keeps its leading name argument, unlike `Schema.suspend`: mixed content and
 * child dispatch match members by wire name before the thunk is forced, so the name is known up
 * front.
 *
 * @example
 *   import { Schema } from "effect";
 *   import { XmlSchema } from "@aidenzepp/effect-xml";
 *
 *   const Item = XmlSchema.Element("item", { content: XmlSchema.text(Schema.String) });
 *   const value = Schema.decodeUnknownSync(XmlSchema.fromString(Item))("<item>First</item>");
 */
export { Element, namespaces, suspend } from "./dsl.ts";

export type { MixedItem, Namespaces } from "./dsl.ts";

export { clark } from "./element.ts";

export type { ResolvedElement } from "./element.ts";

export {
  ElementFromString,
  findDecodeError,
  findDecodeErrorOption,
  findEncodeError,
  findEncodeErrorOption,
  fromString,
} from "./document.ts";

export { decodeSchema, decodeSchemaString } from "./channel.ts";

export { equivalence } from "./equivalence.ts";

export { Tokenizer } from "./tokenizer.ts";

export type { PositionedStartElement, TokenizerDecodeOptions } from "./tokenizer.ts";

export {
  EncodeSchemaFailure,
  InvalidEvent,
  Limit,
  SchemaFailure,
  UndeclaredPrefix,
  UnmappedNamespace,
  Unsupported,
  WellFormedness,
  XmlDecodeError,
  XmlEncodeError,
  isDecodeError,
  isEncodeError,
} from "./issue.ts";

export type { DecodeErrorReason, EncodeErrorReason } from "./issue.ts";

export type { DecodeStreamOptions, EncodeOptions, LimitOptions } from "./codec.ts";

export { DefinitionError, elements, many, mixed, optional as optionalKey, text } from "./plan.ts";

export type { ChildFields, ChildSpec, Empty, PrefixMap, Spec, XmlElement } from "./plan.ts";

export type { ElementPath, ElementStep, Position } from "./positions.ts";
