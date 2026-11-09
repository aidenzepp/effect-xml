// SPIKE-02 approach A: resolve names to { namespace, local } while walking the
// upstream event stream, consume xmlns declarations, and re-emit with a declared
// prefix map. Throwaway code; nothing here is imported outside this directory.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

export interface Name {
  readonly namespace: string | null;
  readonly local: string;
}

export interface ResolvedElement {
  readonly name: Name;
  // Keyed by Clark notation, `{uri}local` or `local`, the same expansion as `name`.
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: ReadonlyArray<ResolvedElement | string>;
}

// Clark notation is the string form of an expanded name, used as the attribute key.
export const clark = (name: Name): string =>
  name.namespace === null ? name.local : `{${name.namespace}}${name.local}`;

export class UndeclaredPrefix extends Schema.TaggedError<UndeclaredPrefix>()("UndeclaredPrefix", {
  prefix: Schema.String,
  path: Schema.String,
  message: Schema.String,
}) {}

export class UnmappedNamespace extends Schema.TaggedError<UnmappedNamespace>()(
  "UnmappedNamespace",
  {
    namespace: Schema.String,
    message: Schema.String,
  },
) {}

type Scope = ReadonlyMap<string, string>;

interface Frame {
  readonly qualified: string;
  readonly scope: Scope;
  readonly name: Name;
  readonly attributes: Record<string, string>;
  readonly children: Array<ResolvedElement | string>;
}

interface State {
  readonly stack: Array<Frame>;
  root: ResolvedElement | undefined;
}

const splitQName = (qualified: string): { prefix: string | null; local: string } => {
  const colon = qualified.indexOf(":");
  return colon === -1
    ? { prefix: null, local: qualified }
    : { prefix: qualified.slice(0, colon), local: qualified.slice(colon + 1) };
};

const pathOf = (stack: ReadonlyArray<Frame>, qualified: string): string =>
  `/${[...stack.map((frame) => frame.qualified), qualified].join("/")}`;

const undeclared = (prefix: string, path: string, where: string) =>
  new UndeclaredPrefix({
    prefix,
    path,
    message: `undeclared namespace prefix "${prefix}" on ${where} at ${path}; declare xmlns:${prefix} on this element or an ancestor`,
  });

// Namespaces in XML 1.0 §3: xmlns and xmlns:* bind prefixes for the element they
// appear on; §6.2: an unprefixed attribute is in no namespace.
const extendScope = (parent: Scope, attributes: Readonly<Record<string, string>>): Scope => {
  const scope = new Map(parent);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "xmlns") {
      scope.set("", value);
    } else if (key.startsWith("xmlns:")) {
      scope.set(key.slice(6), value);
    }
  }
  return scope;
};

const startElement = Effect.fnUntraced(function* (
  state: State,
  event: Xml.StartElement,
): Effect.fn.Return<State, UndeclaredPrefix> {
  const parentScope = state.stack.at(-1)?.scope ?? new Map<string, string>();
  const scope = extendScope(parentScope, event.attributes);
  const path = pathOf(state.stack, event.name);
  const element = splitQName(event.name);
  const namespace = element.prefix === null ? (scope.get("") ?? null) : scope.get(element.prefix);
  if (namespace === undefined) {
    return yield* undeclared(element.prefix as string, path, `element <${event.name}>`);
  }
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.attributes)) {
    if (key === "xmlns" || key.startsWith("xmlns:")) {
      continue;
    }
    const attribute = splitQName(key);
    const attributeNamespace =
      attribute.prefix === null
        ? null
        : attribute.prefix === "xml"
          ? XML_NAMESPACE
          : scope.get(attribute.prefix);
    if (attributeNamespace === undefined) {
      return yield* undeclared(
        attribute.prefix as string,
        path,
        `attribute ${key} of <${event.name}>`,
      );
    }
    attributes[clark({ namespace: attributeNamespace, local: attribute.local })] = value;
  }
  state.stack.push({
    qualified: event.name,
    scope,
    name: { namespace: namespace === "" ? null : namespace, local: element.local },
    attributes,
    children: [],
  });
  return state;
});

const step = (state: State, event: Xml.Event): Effect.Effect<State, UndeclaredPrefix> => {
  switch (event._tag) {
    case "StartElement":
      return startElement(state, event);
    case "EndElement": {
      const frame = state.stack.pop() as Frame;
      const element: ResolvedElement = {
        name: frame.name,
        attributes: frame.attributes,
        children: frame.children,
      };
      const parent = state.stack.at(-1);
      if (parent === undefined) {
        state.root = element;
      } else {
        parent.children.push(element);
      }
      return Effect.succeed(state);
    }
    case "Text": {
      // Merge text split by a dropped comment or PI, as upstream `Element` does.
      const children = state.stack.at(-1)?.children;
      const last = children?.at(-1);
      if (children !== undefined && typeof last === "string") {
        children[children.length - 1] = last + event.text;
      } else {
        children?.push(event.text);
      }
      return Effect.succeed(state);
    }
    default:
      return Effect.succeed(state);
  }
};

// Decode a document to a namespace-resolved tree. The upstream decoder reports
// names as written and treats xmlns as ordinary attributes; this fold is the
// resolution it does not do.
export const resolve = (
  xml: string,
): Effect.Effect<ResolvedElement, Xml.XmlError | UndeclaredPrefix> =>
  Stream.make(xml).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.runFoldEffect((): State => ({ stack: [], root: undefined }), step),
    // decodeString guarantees a single root, so a successful fold always has one.
    Effect.map((state) => state.root as ResolvedElement),
  );

// Approach C as a naming convenience over A: a schema-side prefix map turns
// `m:math` into an expanded name. The same map is the encoder's prefix table.
export type PrefixMap = Readonly<Record<string, string>>;

export const qname =
  (map: PrefixMap) =>
  (key: string): Name => {
    const { prefix, local } = splitQName(key);
    const namespace = prefix === null ? (map[""] ?? null) : (map[prefix] ?? null);
    return { namespace: namespace === "" ? null : namespace, local };
  };

const prefixFor = (map: PrefixMap, namespace: string, isAttribute: boolean) => {
  if (namespace === XML_NAMESPACE) {
    return "xml";
  }
  for (const [prefix, uri] of Object.entries(map)) {
    if (uri === namespace && (prefix !== "" || !isAttribute)) {
      return prefix;
    }
  }
  return undefined;
};

const unmapped = (namespace: string, what: string) =>
  new UnmappedNamespace({
    namespace,
    message: `no prefix declared for namespace ${namespace} (${what}); add it to the prefix map`,
  });

const spell = (
  map: PrefixMap,
  name: Name,
  isAttribute: boolean,
  what: string,
): Effect.Effect<string, UnmappedNamespace> => {
  if (name.namespace === null) {
    // An element with no namespace under a default declaration is not expressible
    // without xmlns=""; the fixtures never need it, so it is recorded, not handled.
    return Effect.succeed(name.local);
  }
  const prefix = prefixFor(map, name.namespace, isAttribute);
  if (prefix === undefined) {
    return unmapped(name.namespace, what);
  }
  return Effect.succeed(prefix === "" ? name.local : `${prefix}:${name.local}`);
};

const parseClark = (key: string): Name => {
  if (!key.startsWith("{")) {
    return { namespace: null, local: key };
  }
  const close = key.indexOf("}");
  return { namespace: key.slice(1, close), local: key.slice(close + 1) };
};

const toEvents = Effect.fnUntraced(function* (
  map: PrefixMap,
  element: ResolvedElement,
  isRoot: boolean,
): Effect.fn.Return<Array<Xml.Event>, UnmappedNamespace> {
  const name = yield* spell(map, element.name, false, `element ${element.name.local}`);
  const attributes: Record<string, string> = {};
  if (isRoot) {
    // All declarations on the root: simplest and canonical (branches/namespaces.md).
    for (const [prefix, uri] of Object.entries(map)) {
      attributes[prefix === "" ? "xmlns" : `xmlns:${prefix}`] = uri;
    }
  }
  for (const [key, value] of Object.entries(element.attributes)) {
    const attributeName = parseClark(key);
    attributes[yield* spell(map, attributeName, true, `attribute ${attributeName.local}`)] = value;
  }
  const events: Array<Xml.Event> = [{ _tag: "StartElement", name, attributes }];
  for (const child of element.children) {
    if (typeof child === "string") {
      events.push({ _tag: "Text", text: child });
    } else {
      events.push(...(yield* toEvents(map, child, false)));
    }
  }
  events.push({ _tag: "EndElement", name });
  return events;
});

// Encode a resolved tree with the prefixes the map declares. Upstream's Writer
// does the escaping and well-formedness; this only chooses spellings.
export const encode = (
  map: PrefixMap,
  element: ResolvedElement,
): Effect.Effect<string, Xml.XmlError | UnmappedNamespace> =>
  toEvents(map, element, true).pipe(
    Effect.flatMap((events) =>
      Stream.fromIterable(events).pipe(
        Stream.pipeThroughChannel(Xml.encodeString()),
        Stream.mkString,
      ),
    ),
  );
