# @aidenzepp/effect-xml

## 0.2.0

### Minor Changes

- b342487: Rename the XmlSchema.DecodeError and XmlSchema.EncodeError exports to XmlDecodeError and XmlEncodeError so each export name equals its tag (breaking)
- fcaa846: Rename XmlSchema.decodeErrorOf and encodeErrorOf to findDecodeErrorOption and findEncodeErrorOption, and add Result-returning findDecodeError and findEncodeError (breaking)
- 5952be1: Rename XmlSchema.Array to XmlSchema.many, because it returns a child-slot marker, not a schema (breaking)

### Patch Changes

- fdda9f5: Add XmlSchema.unwrapDecodeError, which moves the XML decode error out of a failed fromString decode into the error channel in one step

## 0.1.0

### Minor Changes

- Initial release. effect-xml decodes well-formed XML 1.0 in UTF-8 into Effect `Schema` values and encodes them back, from one declaration per element.
  - `XmlSchema.Element` and `XmlSchema.namespaces` declare element codecs with attributes and `text`, `elements`, or `mixed` content; `suspend` covers recursive vocabularies.
  - `XmlSchema.fromString` decodes a whole document to its root value and encodes it back to an equivalent document, checked by `XmlSchema.equivalence`.
  - `XmlSchema.decodeSchemaString` and `decodeSchema` stream one value per record at a path from text or UTF-8 byte chunks.
  - Every failure is a `DecodeError` or `EncodeError` that names an XPath-like path and says what was expected and how to repair it.
  - Parsing defaults to Effect's `effect/encoding/Xml` through the replaceable `XmlSchema.Tokenizer` service.
