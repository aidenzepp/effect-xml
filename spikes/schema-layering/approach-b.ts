import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaParser from "effect/SchemaParser";
import * as SchemaTransformation from "effect/SchemaTransformation";
import type { Xml } from "effect/encoding";

// Approach B: Config-style AST rewrite. The consumer writes one annotated
// `Schema.Struct`; decode rewrites the StringTree codec's AST so every node
// reads from an XML cursor, and encode is a mirror walk over the same AST that
// emits `Xml.Event`s. Follows `node_modules/effect/src/Config.ts:1000-1260`,
// but `applyToSelfOrLastLinkEncoding`, `replaceEncoding` and `Objects.recur`
// are `@internal` (absent from `dist/SchemaAST.d.ts`), so the rewrite rebuilds
// composite nodes through the public constructors instead.

// ---------------------------------------------------------------------------
// Annotations the consumer attaches.
// ---------------------------------------------------------------------------

export type XmlKey =
  | { readonly kind: "attribute"; readonly name: string }
  | { readonly kind: "child"; readonly name: string }
  | { readonly kind: "children"; readonly name: string }
  | { readonly kind: "text" };

const KEY = "xmlKey";
const ELEMENT = "xmlElement";

export const attribute = (name: string) => ({
  [KEY]: { kind: "attribute", name } satisfies XmlKey,
});
export const child = (name: string) => ({ [KEY]: { kind: "child", name } satisfies XmlKey });
export const children = (name: string) => ({ [KEY]: { kind: "children", name } satisfies XmlKey });
export const text = () => ({ [KEY]: { kind: "text" } satisfies XmlKey });
export const element = (name: string) => ({ [ELEMENT]: name });

const keyOf = (ast: SchemaAST.AST, fallback: string): XmlKey => {
  const key = ast.context?.annotations?.[KEY];
  return Predicate.isObject(key) && "kind" in key
    ? (key as XmlKey)
    : { kind: "child", name: fallback };
};

const elementNameOf = (ast: SchemaAST.AST): string | undefined => {
  const name = ast.annotations?.[ELEMENT];
  return typeof name === "string" ? name : undefined;
};

// ---------------------------------------------------------------------------
// Decode: cursor + AST rewrite.
// ---------------------------------------------------------------------------

export type XmlPath = ReadonlyArray<PropertyKey>;

export type Cursor =
  | { readonly _tag: "Element"; readonly element: Xml.Element; readonly path: XmlPath }
  | {
      readonly _tag: "Elements";
      readonly elements: ReadonlyArray<Xml.Element>;
      readonly path: XmlPath;
    }
  | { readonly _tag: "Scalar"; readonly value: string; readonly path: XmlPath };

const childElements = (element: Xml.Element, name: string): ReadonlyArray<Xml.Element> =>
  element.children.filter(
    (child): child is Xml.Element => typeof child !== "string" && child.name === name,
  );

const textOf = (element: Xml.Element): string =>
  element.children.filter((child): child is string => typeof child === "string").join("");

// `Config.ts:1045-1056` (decodeFromCursor), with an XML cursor instead of ConfigCursor.
const fromCursor = <A extends SchemaAST.AST>(
  ast: A,
  decode: (cursor: Cursor) => Effect.Effect<unknown, SchemaIssue.Issue>,
): A =>
  SchemaAST.decodeTo(
    SchemaAST.unknown,
    ast,
    new SchemaTransformation.Transformation(
      SchemaGetter.transformEffect((input: unknown) => decode(input as Cursor)),
      SchemaGetter.passthrough(),
    ),
  );

const isScalar = (ast: SchemaAST.AST): boolean => {
  switch (ast._tag) {
    case "Union":
      return ast.types.every(isScalar);
    case "Objects":
    case "Arrays":
    case "Suspend":
      return false;
    default:
      return true;
  }
};

const materializeObject =
  (ast: SchemaAST.Objects) =>
  (cursor: Cursor): Effect.Effect<Record<string, Cursor> | undefined> => {
    if (cursor._tag !== "Element") return Effect.succeed(undefined);
    const { element, path } = cursor;
    const out: Record<string, Cursor> = {};
    for (const property of ast.propertySignatures) {
      if (typeof property.name !== "string") continue;
      const key = keyOf(property.type, property.name);
      switch (key.kind) {
        case "attribute": {
          const value = element.attributes[key.name];
          if (value !== undefined) {
            out[property.name] = { _tag: "Scalar", value, path: [...path, `@${key.name}`] };
          }
          break;
        }
        case "child": {
          const found = childElements(element, key.name)[0];
          if (found !== undefined) {
            out[property.name] = { _tag: "Element", element: found, path: [...path, key.name] };
          }
          break;
        }
        case "children":
          out[property.name] = {
            _tag: "Elements",
            elements: childElements(element, key.name),
            path: [...path, key.name],
          };
          break;
        case "text":
          out[property.name] = { _tag: "Scalar", value: textOf(element), path };
          break;
      }
    }
    return Effect.succeed(out);
  };

const materializeArray = (cursor: Cursor): Effect.Effect<ReadonlyArray<Cursor> | undefined> =>
  Effect.succeed(
    cursor._tag === "Elements"
      ? cursor.elements.map((element, index) => ({
          _tag: "Element",
          element,
          path: [...cursor.path, index],
        }))
      : undefined,
  );

const readScalar = (cursor: Cursor): Effect.Effect<string | undefined> =>
  Effect.succeed(
    cursor._tag === "Scalar"
      ? cursor.value
      : cursor._tag === "Element"
        ? textOf(cursor.element)
        : undefined,
  );

export interface Rewrite {
  readonly ast: SchemaAST.AST;
  /**
   * `_tag` values the walk met but does not know how to read from XML.
   */
  readonly unsupported: ReadonlyArray<string>;
  /**
   * Every `_tag` the walk visited, for the RESULT.md table.
   */
  readonly visited: ReadonlyArray<string>;
}

// `Config.ts:1089-1153` (toConfigCursorAST) over the public constructors.
export const toXmlCursorAST = (root: SchemaAST.AST): Rewrite => {
  const cache = new Map<SchemaAST.AST, SchemaAST.AST>();
  const unsupported = new Set<string>();
  const visited = new Set<string>();
  const recur = (ast: SchemaAST.AST): SchemaAST.AST => {
    const cached = cache.get(ast);
    if (cached !== undefined) return cached;
    visited.add(ast._tag);
    const out = rewrite(ast);
    cache.set(ast, out);
    return out;
  };
  const rewrite = (ast: SchemaAST.AST): SchemaAST.AST => {
    if (ast.encoding !== undefined && !isScalar(ast)) {
      // Config descends into the last link here (`applyToSelfOrLastLinkEncoding`, @internal).
      unsupported.add(`${ast._tag} with encoding`);
      return ast;
    }
    switch (ast._tag) {
      case "Objects": {
        if (ast.indexSignatures.length > 0) unsupported.add("Objects.indexSignatures");
        const rebuilt = new SchemaAST.Objects(
          ast.propertySignatures.map(
            (property) => new SchemaAST.PropertySignature(property.name, recur(property.type)),
          ),
          ast.indexSignatures,
          ast.annotations,
          ast.checks,
          ast.encoding,
          ast.context,
          ast.encodingChecks,
        );
        return fromCursor(rebuilt, materializeObject(ast));
      }
      case "Arrays": {
        const rebuilt = new SchemaAST.Arrays(
          ast.isMutable,
          ast.elements.map(recur),
          ast.rest.map(recur),
          ast.annotations,
          ast.checks,
          ast.encoding,
          ast.context,
          ast.encodingChecks,
        );
        return fromCursor(rebuilt, materializeArray);
      }
      case "Union":
        if (isScalar(ast)) return fromCursor(ast, readScalar);
        return new SchemaAST.Union(
          ast.types.map(recur),
          ast.options,
          ast.annotations,
          ast.checks,
          ast.encoding,
          ast.context,
          ast.encodingChecks,
        );
      case "Suspend":
        return new SchemaAST.Suspend(
          () => recur(ast.thunk()),
          ast.annotations,
          ast.checks,
          ast.encoding,
          ast.context,
        );
      case "Declaration":
      case "Any":
      case "Unknown":
      case "ObjectKeyword":
        unsupported.add(ast._tag);
        return ast;
      default:
        return fromCursor(ast, readScalar);
    }
  };
  const ast = recur(root);
  return { ast, unsupported: [...unsupported], visited: [...visited] };
};

export interface XmlCodec<S extends Schema.Top> {
  readonly rewrite: Rewrite;
  readonly decode: (
    element: Xml.Element,
  ) => Effect.Effect<S["Type"], SchemaIssue.Issue, S["DecodingServices"]>;
  readonly encode: (
    value: S["Type"],
  ) => Effect.Effect<ReadonlyArray<Xml.Event>, SchemaIssue.Issue, S["EncodingServices"]>;
  /**
   * Re-points a Schema issue path from struct keys to XML names.
   */
  readonly xmlIssue: (issue: SchemaIssue.Issue) => SchemaIssue.Issue;
}

// ---------------------------------------------------------------------------
// Encode: mirror walk over the type-side AST and the StringTree it produced.
// ---------------------------------------------------------------------------

type Tree = Schema.StringTree;

const isRecord = (tree: Tree): tree is { readonly [key: string]: Tree } =>
  Predicate.isObject(tree) && !Array.isArray(tree);

const walk = (
  ast: SchemaAST.AST,
  tree: Tree,
  name: string | undefined,
  out: Array<Xml.Event>,
): void => {
  switch (ast._tag) {
    case "Suspend":
      walk(ast.thunk(), tree, name, out);
      return;
    case "Objects": {
      const tag = elementNameOf(ast) ?? name ?? "element";
      if (!isRecord(tree)) return;
      const attributes: Record<string, string> = {};
      const later: Array<() => void> = [];
      for (const property of ast.propertySignatures) {
        if (typeof property.name !== "string") continue;
        const value = tree[property.name];
        if (value === undefined) continue;
        const key = keyOf(property.type, property.name);
        switch (key.kind) {
          case "attribute":
            if (typeof value === "string") attributes[key.name] = value;
            break;
          case "child":
            later.push(() => walk(property.type, value, key.name, out));
            break;
          case "children":
            later.push(() => {
              const items = property.type._tag === "Arrays" ? property.type.rest[0] : undefined;
              if (items === undefined || !Array.isArray(value)) return;
              for (const item of value) walk(items, item, key.name, out);
            });
            break;
          case "text":
            later.push(() => {
              if (typeof value === "string") out.push({ _tag: "Text", text: value });
            });
            break;
        }
      }
      out.push({ _tag: "StartElement", name: tag, attributes });
      for (const emit of later) emit();
      out.push({ _tag: "EndElement", name: tag });
      return;
    }
    default: {
      const tag = name ?? "value";
      out.push({ _tag: "StartElement", name: tag, attributes: {} });
      if (typeof tree === "string") out.push({ _tag: "Text", text: tree });
      out.push({ _tag: "EndElement", name: tag });
    }
  }
};

// ---------------------------------------------------------------------------
// Issue path translation: struct keys -> XML names, guided by the same AST.
// ---------------------------------------------------------------------------

const translatePath = (
  ast: SchemaAST.AST,
  path: XmlPath,
): { ast: SchemaAST.AST; path: XmlPath } => {
  let current: SchemaAST.AST = ast;
  const out: Array<PropertyKey> = [];
  for (const segment of path) {
    if (current._tag === "Suspend") current = current.thunk();
    if (current._tag === "Objects" && typeof segment === "string") {
      const property = current.propertySignatures.find((p) => p.name === segment);
      if (property === undefined) {
        out.push(segment);
        continue;
      }
      const key = keyOf(property.type, segment);
      if (key.kind === "attribute") out.push(`@${key.name}`);
      else if (key.kind !== "text") out.push(key.name);
      current = property.type;
    } else if (current._tag === "Arrays" && typeof segment === "number") {
      out.push(segment);
      current = current.rest[0] ?? current;
    } else {
      out.push(segment);
    }
  }
  return { ast: current, path: out };
};

const translateIssue = (ast: SchemaAST.AST, issue: SchemaIssue.Issue): SchemaIssue.Issue => {
  switch (issue._tag) {
    case "Pointer": {
      const next = translatePath(ast, issue.path);
      return new SchemaIssue.Pointer(next.path, translateIssue(next.ast, issue.issue));
    }
    case "Composite":
      return new SchemaIssue.Composite(
        issue.ast,
        issue.issues.map((inner) => translateIssue(ast, inner)) as [
          SchemaIssue.Issue,
          ...Array<SchemaIssue.Issue>,
        ],
      );
    case "Encoding":
      return new SchemaIssue.Encoding(issue.ast, translateIssue(ast, issue.issue));
    default:
      return issue;
  }
};

// ---------------------------------------------------------------------------
// The codec.
// ---------------------------------------------------------------------------

export const xmlCodec = <S extends Schema.Top>(schema: S): XmlCodec<S> => {
  const tree = Schema.toCodecStringTree(schema);
  const rewrite = toXmlCursorAST(tree.ast);
  const parse = SchemaParser.decodeUnknownEffect(
    Schema.make<Schema.Codec<S["Type"], Cursor>>(rewrite.ast),
  );
  const toTree = SchemaParser.encodeEffect(tree);
  return {
    rewrite,
    decode: (element) => parse({ _tag: "Element", element, path: [element.name] }),
    encode: (value) =>
      Effect.map(toTree(value), (encoded) => {
        const out: Array<Xml.Event> = [];
        walk(schema.ast, encoded, undefined, out);
        return out;
      }),
    xmlIssue: (issue) => translateIssue(schema.ast, issue),
  };
};

// ---------------------------------------------------------------------------
// Consumer side: the same shape as approach A, annotated once.
// ---------------------------------------------------------------------------

export const Identifier = Schema.String.pipe(Schema.brand("Identifier"));
export const Cardinality = Schema.Literals(["single", "multiple", "ordered", "record"]);

export const MapEntry = Schema.Struct({
  mapKey: Schema.String.annotateKey(attribute("map-key")),
  mappedValue: Schema.Finite.annotateKey(attribute("mapped-value")),
  caseSensitive: Schema.optionalKey(Schema.Boolean).annotateKey(attribute("case-sensitive")),
}).annotate(element("qti-map-entry"));

export const Mapping = Schema.Struct({
  defaultValue: Schema.optionalKey(Schema.Finite).annotateKey(attribute("default-value")),
  entries: Schema.Array(MapEntry).annotateKey(children("qti-map-entry")),
}).annotate(element("qti-mapping"));

export const CorrectResponse = Schema.Struct({
  values: Schema.Array(Schema.String).annotateKey(children("qti-value")),
}).annotate(element("qti-correct-response"));

export const ResponseDeclaration = Schema.Struct({
  identifier: Identifier.annotateKey(attribute("identifier")),
  baseType: Schema.String.annotateKey(attribute("base-type")),
  cardinality: Cardinality.annotateKey(attribute("cardinality")),
  correctResponse: CorrectResponse.annotateKey(child("qti-correct-response")),
  mapping: Schema.optionalKey(Mapping).annotateKey(child("qti-mapping")),
}).annotate(element("qti-response-declaration"));

export type ResponseDeclaration = typeof ResponseDeclaration.Type;

export const codecB = xmlCodec(ResponseDeclaration);
