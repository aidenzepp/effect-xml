# effect-xml

Decode XML into Effect Schema values and encode them back, from one definition per element.

effect-xml reads and writes well-formed XML 1.0 in UTF-8. You declare each element's attributes and content with Effect `Schema`. The same declaration decodes a document into a typed value and encodes that value back, and every attribute and text value goes through the schema you gave it. By default, Effect's own `effect/encoding/Xml` does the parsing, and effect-xml resolves namespaces and maps elements to values on top of it. It does not validate against a DTD or an XSD, and comments and processing instructions are not part of a decoded value. effect-xml is pre-1.0, and `effect/encoding/Xml` is marked experimental upstream.

- [`docs/onboarding.md`](docs/onboarding.md) maps the source.
- [`docs/rd/performance.md`](docs/rd/performance.md) holds the benchmarks against other XML libraries.

## Install

```bash
bun add @aidenzepp/effect-xml@0.1.0 effect@4.1.2
```

`effect` is a peer dependency, at `^4.1.2`. To build from a checkout, use Bun 1.4.2:

```bash
bun install --frozen-lockfile
bun run build
```

## Start

Declare a QTI choice interaction, decode a document, and encode the value back:

```ts
import { Effect, Option, Schema } from "effect";
import { XmlSchema } from "@aidenzepp/effect-xml";

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const { Element } = XmlSchema.namespaces({ "": QTI });

const SimpleChoice = Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: XmlSchema.text(Schema.String),
});

const Prompt = Element("qti-prompt", { content: XmlSchema.text(Schema.String) });

const ChoiceInteraction = Element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: XmlSchema.elements({
    prompt: XmlSchema.optionalKey(Prompt),
    choices: XmlSchema.Array(SimpleChoice),
  }),
});

const xml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

const Document = XmlSchema.fromString(ChoiceInteraction);

const value = Schema.decodeUnknownSync(Document)(xml);

console.log(value);

const encoded = Schema.encodeSync(Document)(value);
```

`Document` is an ordinary Schema codec, so a failed decode fails with `Schema.SchemaError`. `XmlSchema.decodeErrorOf` reads the positioned `XmlSchema.DecodeError` back out of its `issue`, and `Effect.catchReason` selects it by reason. Decode a copy whose `max-choices` is not a number:

```ts
const failure = Effect.runSync(
  Schema.decodeUnknownEffect(Document)(xml.replace('max-choices="1"', 'max-choices="x"')).pipe(
    Effect.as(undefined),
    Effect.catchTag("SchemaError", (schemaError) =>
      Effect.fail(Option.getOrElse(XmlSchema.decodeErrorOf(schemaError.issue), () => schemaError)),
    ),
    Effect.catchReason("XmlDecodeError", "SchemaFailure", (_reason, error) =>
      Effect.succeed(error),
    ),
  ),
);

console.log(failure?.message);
```

It prints the decoded value, then the failure:

```console
{
  'max-choices': 1,
  'response-identifier': 'RESPONSE',
  prompt: { '$text': 'Pick one' },
  choices: [
    { identifier: 'A', '$text': 'First' },
    { identifier: 'B', '$text': 'Second' }
  ]
}
attribute max-choices="x" at /qti-choice-interaction/@max-choices (line 1, column 1): Expected a string representing a finite number; change or remove max-choices so it meets this expectation
```

Both blocks are regions of `test/readme.test.ts`, so the test suite runs them.

## Contract

`XmlSchema` is the package's only export.

| Member                               | Does                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `Element`                            | Declares an element codec from its name, attributes and content                                  |
| `namespaces`                         | Binds a prefix map (`""` is the default namespace) and returns `Element` and `suspend` for it    |
| `suspend`                            | Refers to an element declared later, for recursive vocabularies                                  |
| `text`, `elements`, `mixed`          | Content: one text value; child elements in named slots; text and elements in document order      |
| `Array`, `optionalKey`               | An `elements` slot for zero or more, or at most one, of a child element                          |
| `fromString`                         | A codec from a document's text to the value of its root element                                  |
| `ElementFromString`                  | A codec from a document's text to its resolved root element, with no element codec applied       |
| `decodeSchemaString`, `decodeSchema` | Channels from text or UTF-8 byte chunks to one value per record at a path                        |
| `clark`                              | Builds a `{uri}local` name for a record path step                                                |
| `equivalence`                        | The round-trip equivalence on resolved elements under a root definition                          |
| `decodeErrorOf`, `encodeErrorOf`     | Read the library error out of a failed decode's or encode's Schema issue                         |
| `DecodeError`, `EncodeError`         | The failure of each direction: `path`, `message`, `reason`, and on decode an optional `position` |
| `Tokenizer`                          | The service that parses and writes XML text, defaulting to `effect/encoding/Xml`                 |

A record path is a root-anchored list of steps. Each step is `"*"` for any element, a bare `local` name for no namespace, or `{uri}local` for a namespaced one. The path `["order", "item"]` selects each `item` directly inside the root `order`. `clark` builds a `{uri}local` step from a separate URI.

Every definition keeps these:

- Attributes decode under their names as written, such as `"max-choices"`. `"data-*"` declares one schema for every `data-` attribute.
- An undeclared attribute is refused. A name that is not an XML QName, or an attribute key that equals a slot key, is refused when the element is declared.
- Text content decodes under `$text` and mixed content under `$children`. No XML name starts with `$`, so these keys never meet an attribute.
- Mixed content is an array in document order. A text run is `{ _tag: "$text", text }`, and a member element is tagged with its name.
- `open: true` on `elements` or `mixed` keeps undeclared child elements instead of refusing them.
- Every failure names an XPath-like path, such as `/root/p[2]/@id`, and says what was expected and how to repair it.
- A `fromString` codec is not a type guard, and `Schema.is` accepts any value on it. To check a typed value, use `Schema.is(Schema.toType(Def))` on the element codec.

The default tokenizer needs no layer. To replace it, provide `XmlSchema.Tokenizer` with `Effect.provideService` on one effect, or with a `Layer.succeed` layer for a whole program.

## Round trip

Decoding a document and encoding the value gives back an equivalent document, not identical bytes. `XmlSchema.equivalence` checks it:

```ts
const equivalent = XmlSchema.equivalence(ChoiceInteraction);

const Tree = XmlSchema.ElementFromString({ "": QTI });

console.log(
  equivalent(Schema.decodeUnknownSync(Tree)(xml), Schema.decodeUnknownSync(Tree)(encoded)),
);
```

It prints `true`. Encoding does not preserve attribute order, prefix spelling, where `xmlns` declarations sit, quote style, entity and character reference forms, self-closing tags, CDATA boundaries, comments, processing instructions, the XML declaration, the DOCTYPE, whitespace runs, or the order of differently named children in `elements` content.

## Positions and limits

A decode failure from `fromString` carries the line and column of the start tag it belongs to. To get them on a stream, pass `positions: true`. That costs decode time, and [`docs/rd/performance.md`](docs/rd/performance.md) has the measurements.

| Limit             | Default   | Bounds                                      |
| ----------------- | --------- | ------------------------------------------- |
| `maxTokenSize`    | 10 MiB    | One token, at the parser                    |
| `maxDepth`        | 1024      | Element nesting                             |
| `maxElementSize`  | 16 MiB    | One record as written                       |
| `maxElementNodes` | 1,000,000 | Element starts plus text runs in one record |

Every decode entry point takes all four limits as options. A whole document is one record. `Infinity` turns off `maxElementSize` or `maxElementNodes`. A failure from any limit has reason `Limit`.

effect-xml never turns on Effect's Schema JIT. An application can opt in with `import "effect/schema/SchemaJITCompiler/enable"` before effect-xml loads. The switch applies to the whole process and every Schema in it, and cannot be turned off.

## Development

Requires Bun 1.4.2. From the repository root, these gate a change:

```console
$ bun run check
$ bun run build
$ bun run test
```

`bun install` installs a pre-push hook that runs the same checks. Coding agents start at [`AGENTS.md`](AGENTS.md).

## License

MIT. `spikes/fixtures/qti/pci-shaded-grid.xml` is Apache-2.0, as recorded in [`spikes/fixtures/qti/SOURCES.md`](spikes/fixtures/qti/SOURCES.md).
