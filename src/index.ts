/**
 * Effect-native XML decoding and encoding.
 *
 * Every member lives on the `XmlSchema` namespace: declare element codecs with
 * `XmlSchema.Element`, then decode and encode whole documents with `XmlSchema.fromString`,
 * or stream a repeated element with `XmlSchema.decodeSchemaString`. The codecs build on
 * Effect's own `effect/encoding/Xml` event stream and `Schema`.
 */
// oxlint-disable-next-line oxc/no-barrel-file -- Effect publishes each module as a namespace; this entry point exposes the library the same way.
export * as XmlSchema from "./xml-schema.ts";
