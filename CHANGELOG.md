# @aidenzepp/effect-xml

## 0.1.0

### Minor Changes

- Initial release. effect-xml decodes well-formed XML 1.0 in UTF-8 into Effect `Schema` values and encodes them back, from one declaration per element.
  - `XmlSchema.Element` and `XmlSchema.namespaces` declare element codecs with attributes and `text`, `elements`, or `mixed` content; `suspend` covers recursive vocabularies.
  - `XmlSchema.fromString` decodes a whole document to its root value and encodes it back to an equivalent document, checked by `XmlSchema.equivalence`.
  - `XmlSchema.decodeSchemaString` and `decodeSchema` stream one value per record at a path from text or UTF-8 byte chunks.
  - Every failure is a `DecodeError` or `EncodeError` that names an XPath-like path and says what was expected and how to repair it.
  - Parsing defaults to Effect's `effect/encoding/Xml` through the replaceable `XmlSchema.Tokenizer` service.
