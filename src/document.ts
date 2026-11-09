import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { decodeString, decodeTree, encodeString, encodeTree } from "./codec.ts";
import type { EncodeOptions, LimitOptions } from "./codec.ts";
import { ResolvedElementSchema } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import { isDecodeError, isEncodeError } from "./issue.ts";
import type { XmlDecodeError, XmlEncodeError } from "./issue.ts";
import { passthroughTo } from "./passthrough.ts";
import type { AnyElement, PrefixMap } from "./plan.ts";

/**
 * The encoded side of every document codec: a string, described to a reader of a schema issue as
 * text that decodes as XML.
 */
const XmlText = Schema.String.annotate({ expected: "a string that will be decoded as XML" });

/**
 * Build the annotations of the schema issue that carries a library decode or encode error out of
 * a codec.
 *
 * The `message` annotation is the error's own message, so a formatted `Schema.SchemaError` reads
 * the same as the error, and the `xml` annotation is the error itself, which {@link decodeErrorOf}
 * or {@link encodeErrorOf} reads back.
 *
 * @param error - The library error of the failed decode or encode.
 * @returns The annotations of the `InvalidValue` issue that carries `error`.
 */
const carrying = (error: XmlDecodeError | XmlEncodeError): Schema.Annotations.Issue => ({
  message: error.message,
  xml: error,
});

/**
 * The type side of a {@link fromString} codec: a declaration of `Def`'s value that accepts its
 * input unchanged and takes every derivation from its one type parameter, `Def`'s type side.
 */
type PassedValue<Def extends AnyElement> = Schema.declareConstructor<
  Def["Type"],
  Def["Type"],
  readonly [Schema.toType<Def>]
>;

/**
 * Build the type side of a {@link fromString} codec over `type`, the type side of its root.
 *
 * The declaration's parser returns its input without parsing `type`: Effect runs a declaration's
 * `run` and never parses its type parameters itself, so the value `decodeString` already decoded
 * with the root, and the value `encodeString` will check, is not walked a second time. The
 * equivalence, formatter, iso, and arbitrary derivations read `type`, so the codec derives the
 * same values as its root does.
 *
 * @param type - The type side of the root element codec.
 * @returns The declaration that passes a value through and derives from `type`.
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/SchemaAST.ts `Declaration` and `getParser`
 */
const passedValue = <Def extends AnyElement>(type: Schema.toType<Def>): PassedValue<Def> =>
  Schema.declareConstructor<Def["Type"], Def["Type"]>()(
    [type],
    () => (input) => Effect.succeed(input),
    {
      toCodec: ([parameter]) => passthroughTo(parameter),
      toCodecArbitrary: ({ typeParameters: [parameter] }) => passthroughTo(parameter),
      toCodecIso: ([parameter]) => passthroughTo(parameter),
      toEquivalence: ([equivalence]) => equivalence,
      toFormatter: ([format]) => format,
    },
  );

/**
 * The schema {@link fromString} returns: a codec from XML text to the value of the root element
 * codec `Def`, with the decoding and encoding services of `Def`.
 */
// oxlint-disable-next-line eslint/no-redeclare -- the interface and the function share one name in TypeScript's separate type and value spaces, as `Schema.fromJsonString` does.
export interface fromString<Def extends AnyElement> extends Schema.decodeTo<
  PassedValue<Def>,
  Schema.String,
  Def["DecodingServices"],
  Def["EncodingServices"]
> {
  readonly Rebuild: fromString<Def>;
}

// Native: Schema.fromJsonString parses JSON, not XML, and Schema.toEncoderXml only writes a value through its own element layout; neither decodes XML text through resolved names into an element codec's value.
/**
 * Build a codec from one XML document's text to the value of its root element codec `def`.
 *
 * The codec is not a type guard. Its type side checks no shape, so `Schema.is`, `Schema.asserts`,
 * and `Schema.toType` of the codec accept any value, including one `def` rejects. To check an
 * untrusted typed value, use `Schema.is(Schema.toType(def))` or
 * `Schema.asserts(Schema.toType(def))` on the element codec, not on this codec. Decoding and
 * encoding still validate: `def` runs once per decode and once per encode, a decode yields the
 * value `decodeString(def)` yields, and an encode writes the text `encodeString(def)` writes,
 * failing on a value `def` rejects.
 *
 * The codec composes like any other schema: decode it with `Schema.decodeUnknownEffect`, encode
 * it with `Schema.encodeEffect`, or use it as a field of a `Schema.Struct`. Decoding resolves the
 * document's namespaces, decodes the root with `def`, and runs in one `xml.decodeString` span;
 * encoding writes the value with the prefixes of `def`'s namespaces map. The parse options of the
 * run reach `def`, so under `errors: "all"` every issue `def` finds is kept.
 *
 * Every failure is a `Schema.SchemaError`. When the text or value was rejected by the XML layer
 * or by `def`, {@link decodeErrorOf} reads the XML decode error, with its path, message, and
 * position, from the error's `issue`; a non-string input fails before any XML is read.
 *
 * `options` holds the parser limits and budgets of the document's one record, the root, and
 * whether the encoded text leads with the XML declaration (by default it does).
 *
 * @example
 *   const Item = fromString(ChoiceInteraction);
 *
 *   const value = Schema.decodeUnknownSync(Item)(xml);
 *   const text = Schema.encodeSync(Item)(value);
 *
 * @param def - The element codec of the document root.
 * @param options - The parser limits, the root's budgets, and the declaration choice.
 * @returns The codec from XML text to the value of `def`.
 */
export const fromString = <Def extends AnyElement>(
  def: Def,
  options?: LimitOptions & EncodeOptions,
): fromString<Def> => {
  // One decoder and one encoder per codec: the decoder memoizes the root's structural plan and
  // its fast-path attempt, so building it per document would redo that work on every decode.
  const decode = decodeString(def, options);
  const encode = encodeString(def, options);

  return XmlText.pipe(
    Schema.decodeTo(
      passedValue<Def>(Schema.toType(def)),
      SchemaTransformation.transformEffect<
        Def["Type"],
        string,
        Def["DecodingServices"],
        Def["EncodingServices"]
      >({
        decode: (text, parseOptions) =>
          decode(text, parseOptions).pipe(
            Effect.mapError(
              (failure) => new SchemaIssue.InvalidValue(carrying(failure), text, parseOptions),
            ),
          ),
        encode: (value, parseOptions) =>
          encode(value, parseOptions).pipe(
            Effect.mapError(
              (failure) => new SchemaIssue.InvalidValue(carrying(failure), value, parseOptions),
            ),
          ),
      }),
    ),
  );
};

// Native: Xml.elements collects elements with names as written and no namespace scope, and Xml.decodeString yields events, not a tree; neither yields a tree of resolved Clark names.
/**
 * Build a codec from one XML document's text to its root as a resolved element, with no element
 * codec applied.
 *
 * Decoding resolves the document's namespaces to Clark names and fails as {@link fromString}
 * does short of a value check: malformed text, an unbound prefix, or a document over a limit.
 * Encoding writes the tree with `prefixes`, the prefix of each namespace the text spells (`""`
 * for the default namespace). {@link decodeErrorOf} reads the XML decode error from a failure's
 * `issue`.
 *
 * @param prefixes - The prefix of each namespace the encoded text spells.
 * @param options - The parser limits, the root's budgets, and the declaration choice.
 * @returns The codec from XML text to the resolved root element.
 */
export const ElementFromString = (prefixes: PrefixMap, options?: LimitOptions & EncodeOptions) =>
  XmlText.pipe(
    Schema.decodeTo(
      ResolvedElementSchema,
      SchemaTransformation.transformEffect<ResolvedElement, string>({
        decode: (text, parseOptions) =>
          decodeTree(options)(text).pipe(
            Effect.mapError(
              (failure) => new SchemaIssue.InvalidValue(carrying(failure), text, parseOptions),
            ),
          ),
        encode: (element, parseOptions) =>
          encodeTree(
            prefixes,
            options,
          )(element).pipe(
            Effect.mapError(
              (failure) => new SchemaIssue.InvalidValue(carrying(failure), element, parseOptions),
            ),
          ),
      }),
    ),
  );

/**
 * Find the first library error `isError` accepts among those the document codecs stored in a
 * schema issue tree.
 *
 * The walk enters every nested issue, so an error stored by a codec that is a struct field, an
 * array element, or behind `Schema.fromJsonString` is found.
 *
 * @param issue - The root of the issue tree to search.
 * @param isError - The guard of the error kind to return.
 * @returns The first stored error `isError` accepts, or `None` when the tree holds none.
 */
const carriedErrorOf = <E>(
  issue: SchemaIssue.Issue,
  isError: (stored: unknown) => stored is E,
): Option.Option<E> => {
  if (issue._tag === "InvalidValue") {
    const xml = issue.annotations?.xml;

    return isError(xml) ? Option.some(xml) : Option.none();
  }

  if (issue._tag === "Filter" || issue._tag === "Encoding" || issue._tag === "Pointer") {
    return carriedErrorOf(issue.issue, isError);
  }

  if (issue._tag === "Composite" || issue._tag === "AnyOf") {
    return Arr.findFirst(issue.issues, (nested) => carriedErrorOf(nested, isError));
  }

  return Option.none();
};

/**
 * Read the XML decode error a failed {@link fromString} or {@link ElementFromString} decode
 * stored in a schema issue.
 *
 * The search walks the whole issue tree, so the error is found when the codec is a field of a
 * struct, an element of an array, or behind `Schema.fromJsonString`; the first stored error wins.
 * An encode failure's issue holds no decode error; {@link encodeErrorOf} reads that one.
 *
 * @example
 *   const located = Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(xml).pipe(
 *     Effect.map(() => Option.none()),
 *     Effect.catchTag("SchemaError", (error) => Effect.succeed(decodeErrorOf(error.issue))),
 *   );
 *
 * @param issue - The issue of a `Schema.SchemaError`.
 * @returns The stored XML decode error, or `None` when the failure never reached XML decoding,
 *   for example a non-string input.
 */
export const decodeErrorOf = (issue: SchemaIssue.Issue): Option.Option<XmlDecodeError> =>
  carriedErrorOf(issue, isDecodeError);

/**
 * Read the XML encode error a failed {@link fromString} or {@link ElementFromString} encode
 * stored in a schema issue.
 *
 * The search walks the whole issue tree as {@link decodeErrorOf} does; the first stored error
 * wins. A decode failure's issue holds no encode error, so this returns `None` for it.
 *
 * @example
 *   const located = Schema.encodeEffect(fromString(ChoiceInteraction))(value).pipe(
 *     Effect.map(() => Option.none()),
 *     Effect.catchTag("SchemaError", (error) => Effect.succeed(encodeErrorOf(error.issue))),
 *   );
 *
 * @param issue - The issue of a `Schema.SchemaError`.
 * @returns The stored XML encode error, or `None` when the failure never reached XML encoding,
 *   for example a value the root schema rejects before it is written.
 */
export const encodeErrorOf = (issue: SchemaIssue.Issue): Option.Option<XmlEncodeError> =>
  carriedErrorOf(issue, isEncodeError);
