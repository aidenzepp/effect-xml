// Q2: the full public surface as one namespace module, consumed as
//   import { XmlSchema } from "@aidenzepp/effect-xml"
// (index-variant.ts does `export * as XmlSchema from "./xml-schema.ts"`). Each line names today's
// export it replaces. Names follow effect/encoding siblings: the Schema-typed channels are
// decodeSchema / decodeSchemaString (Ndjson.ts:439,467; Csv.ts:828,874); a whole document is a
// Schema codec (Schema.fromJsonString pattern), so no Effect-returning decodeString remains.

// -- declaring (unchanged names; they do not collide inside a namespace) --
export { element, namespaces, text, elements, mixed } from "../../src/index.ts";
// `suspend` keeps its leading name argument: mixed content tags members by wire name before the
// thunk may be forced, so it cannot take Schema.suspend's (thunk) arity. Kept, documented.
export { suspend } from "../../src/index.ts";
// many -> Array, optional -> optionalKey: the Schema words for the same cardinalities (Q6 would let
// Schema.Array / Schema.optionalKey themselves be accepted; this is only the rename).
export { many as Array, optional as optionalKey } from "../../src/index.ts";

// -- documents: Codec<T, string> (Q1). Replaces decodeString / encodeString / decodeTree. --
export { XmlString as fromString, ElementFromString } from "./text-codec.ts";

// -- streams: Channels (Q3). Replaces decode(def, path, options)(stream). --
export { decodeSchema, decodeSchemaString } from "./channel.ts";

// -- round trip (Q5). Replaces canonicalize + normalizedNames. --
export { equivalence } from "./q5-equivalence-lib.ts";

// -- errors: drop the Xml prefix inside the namespace. Reason classes keep their tags; renaming
//    SchemaReason/EncodeSchemaReason to match tag "Schema" is a separate decision (hater A item 7). --
export {
  XmlDecodeError as DecodeError,
  XmlEncodeError as EncodeError,
  SchemaReason,
  EncodeSchemaReason,
  Limit,
  WellFormedness,
  UndeclaredPrefix,
  UnmappedNamespace,
  InvalidEvent,
  DefinitionError,
  clark,
} from "../../src/index.ts";

// -- types --
export type {
  ElementCodec,
  ResolvedElement as Element,
  MixedItem,
  Namespaces,
  LimitOptions,
  ElementPath,
  ElementStep,
  Position,
  PrefixMap,
} from "../../src/index.ts";
// defaultMaxElementSize / defaultMaxElementNodes: dropped from the namespace (upstream keeps its
// defaults private, encoding/Xml.ts:557-559). The content-spec types (Text, Optional, Many, ...)
// stay reachable as XmlSchema.* only if a consumer needs to name them; omitted here.
