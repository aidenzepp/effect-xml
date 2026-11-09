import * as Equal from "effect/Equal";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

/**
 * The namespace URI that the XML specification binds to the reserved `xml` prefix.
 */
export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

/**
 * Format an expanded name as a Clark name, `{uri}local`, or `local` when it has no namespace.
 *
 * "No namespace" is the absent `Option`, never `null`; the empty string is a distinct value.
 *
 * @param namespace - The namespace URI, or `Option.none()` for a name in no namespace.
 * @param local - The local part of the name.
 * @returns The Clark name.
 */
export const clark = (namespace: Option.Option<string>, local: string): string =>
  Option.match(namespace, {
    onNone: () => local,
    onSome: (uri) => `{${uri}}${local}`,
  });

/**
 * A parsed Clark name: the namespace URI, absent for no namespace, and the local part.
 */
export interface ClarkName {
  readonly namespace: Option.Option<string>;
  readonly local: string;
}

/**
 * Split a Clark name into its namespace and local part.
 *
 * The key is namespaced only when it starts with `{`; the split is on the first `}`, so a local
 * part may itself contain `}`.
 *
 * @param key - A Clark name produced by {@link clark}.
 * @returns The namespace, absent when the key has no leading `{`, and the local part.
 */
export const parseClark = (key: string): ClarkName => {
  if (!key.startsWith("{")) {
    return { local: key, namespace: Option.none() };
  }

  const close = key.indexOf("}");

  return { local: key.slice(close + 1), namespace: Option.some(key.slice(1, close)) };
};

/**
 * An as-written XML name split at its first colon: the prefix, absent when unprefixed, and the
 * local part.
 */
export interface QualifiedName {
  readonly prefix: Option.Option<string>;
  readonly local: string;
}

/**
 * Split an as-written name at its first colon.
 *
 * Both the authored-key expander in `plan.ts` and the event resolver in `resolve.ts` read names
 * this way, so the split lives here once. `Xml.StartElement` carries the name as one string and
 * `effect/encoding/Xml` exports no splitter, which is the requirement it misses.
 *
 * @param qualified - The name as written.
 * @returns The prefix, absent when the name has no colon, and the local part.
 */
export const splitQName = (qualified: string): QualifiedName => {
  const colon = qualified.indexOf(":");

  return colon === -1
    ? { local: qualified, prefix: Option.none() }
    : { local: qualified.slice(colon + 1), prefix: Option.some(qualified.slice(0, colon)) };
};

/**
 * The expectation every name-validity message states, in the terms of {@link isQName}.
 *
 * The definition builders and the recursive-reference builder both report a name that fails
 * {@link isQName}, so they share this sentence and the two messages cannot drift apart.
 */
export const NAME_RULE =
  'an XML name is local or prefix:local, each part an XML 1.0 NCName that starts with a letter or "_" and continues with letters, digits, combining marks, ".", "_", "-", or "·"';

/**
 * The `NameStartChar` ranges of XML 1.0 (Fifth Edition) section 2.3, without `:`, as the body of a
 * `u`-flag character class.
 *
 * @see https://www.w3.org/TR/xml/#NT-NameStartChar
 */
const nameStartChars =
  "A-Z_a-z\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2FF}\\u{370}-\\u{37D}\\u{37F}-\\u{1FFF}\\u{200C}-\\u{200D}\\u{2070}-\\u{218F}\\u{2C00}-\\u{2FEF}\\u{3001}-\\u{D7FF}\\u{F900}-\\u{FDCF}\\u{FDF0}-\\u{FFFD}\\u{10000}-\\u{EFFFF}";

/**
 * The `NameChar` ranges of XML 1.0 (Fifth Edition) section 2.3, without `:`: every name-start
 * character plus `-`, `.`, ASCII digits, `·`, the combining diacritics, and the `‿` and `⁀` ties.
 *
 * @see https://www.w3.org/TR/xml/#NT-NameChar
 */
const nameChars = `${nameStartChars}\\-.0-9\\u{B7}\\u{300}-\\u{36F}\\u{203F}-\\u{2040}`;

/**
 * An XML `NCName`: one `NameStartChar`, then any number of `NameChar`, and never `:`.
 *
 * The classes are the section 2.3 productions code point for code point, not Unicode letter and
 * digit categories: those categories omit combining marks such as the Devanagari vowel signs and
 * U+0301, omit U+203F, refuse the U+2070-218F number forms as a first character, and admit digits
 * such as `²` that the productions refuse. `$` and `*` are outside both classes, so the struct keys
 * `$text`, `$children`, and `"*"` can never equal an authored XML name.
 */
const ncName = new RegExp(`^[${nameStartChars}][${nameChars}]*$`, "u");

// Native: `effect/encoding/Xml` and `effect/Schema` checked; neither exports an XML name check.
/**
 * Check whether a string is an XML `NCName`, a name without a colon.
 *
 * @param name - The candidate name.
 * @returns `true` when `name` matches the XML 1.0 section 2.3 `Name` production with `:` removed.
 */
export const isNCName = (name: string): boolean => ncName.test(name);

/**
 * Check whether a string is an XML qualified name as authored: `local` or `prefix:local`, where
 * the prefix and the local part are each an `NCName`.
 *
 * @param name - The candidate name as written.
 * @returns `true` when `name` is a well-formed qualified name.
 */
export const isQName = (name: string): boolean => {
  const { local, prefix } = splitQName(name);

  return isNCName(local) && Option.match(prefix, { onNone: () => true, onSome: isNCName });
};

// Native: `effect/encoding/Xml` and `effect/Schema` checked; neither spells a resolved name back under a caller's prefixes.
/**
 * Spell a Clark name in the caller's terms: the authored prefix where the prefixes map has one,
 * and the namespace written out when it is what tells two names apart.
 *
 * The first rule that applies decides the spelling:
 *
 * 1. When `contrast` holds a name with the same local part in a different namespace, the namespace is
 *    the cause, so the result is explicit: `{uri}local`, or `local (no namespace)`.
 * 2. A name in the `xml` namespace is `xml:local`.
 * 3. An element in the non-empty default namespace (`prefixes[""]`) is the bare `local`.
 * 4. A name whose namespace a non-empty prefix maps to is `prefix:local`, the first such prefix in
 *    insertion order.
 * 5. A name in no namespace is `local`, except an element under a non-empty default namespace, which
 *    is `local (no namespace)` because a bare `local` would read as the default namespace.
 * 6. Any other name is `{uri}local`.
 *
 * Attributes never take the default namespace, so rule 3 and the rule-5 exception apply to
 * elements only. The prefixes map is a plain record so this module depends on no planner type.
 *
 * @param name - The Clark name to spell.
 * @param prefixes - The authored prefix-to-namespace map; the `""` key is the default namespace.
 * @param kind - Whether the name belongs to an element or an attribute.
 * @param contrast - Clark names the message sets this name against; empty by default.
 * @returns The name as the caller wrote it, or with its namespace shown when that is the cause.
 */
export const spell = (
  name: string,
  prefixes: Readonly<Record<string, string>>,
  kind: "element" | "attribute",
  contrast: readonly string[] = [],
): string => {
  const { local, namespace } = parseClark(name);
  const element = kind === "element";
  const defaultNamespace: string | undefined = prefixes[""];
  const hasDefault = defaultNamespace !== undefined && defaultNamespace !== "";

  const explicit = Option.match(namespace, {
    onNone: () => `${local} (no namespace)`,
    onSome: (uri) => `{${uri}}${local}`,
  });

  const contrasted = contrast.some((other) => {
    const parsed = parseClark(other);

    return parsed.local === local && !Equal.equals(parsed.namespace, namespace);
  });

  if (contrasted) {
    return explicit;
  }

  return Option.match(namespace, {
    onNone: () => (element && hasDefault ? explicit : local),
    onSome: (uri) => {
      if (uri === XML_NAMESPACE) {
        return `xml:${local}`;
      }

      if (element && hasDefault && uri === defaultNamespace) {
        return local;
      }

      const prefix = Object.keys(prefixes).find((key) => key !== "" && prefixes[key] === uri);

      return prefix === undefined ? explicit : `${prefix}:${local}`;
    },
  });
};

/**
 * An element whose names are resolved: `name` and every attribute key are Clark names, and the
 * element carries no prefix scope.
 */
export interface ResolvedElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly (ResolvedElement | string)[];
}

/**
 * Check whether a value has the shape of a `ResolvedElement`.
 *
 * Checks the top level only: a string `name`, an object `attributes`, and an array `children`.
 *
 * @param u - The value to check.
 * @returns `true` when `u` is a resolved element.
 */
export const isResolvedElement = (u: unknown): u is ResolvedElement =>
  Predicate.hasProperty(u, "name") &&
  Predicate.isString(u.name) &&
  Predicate.hasProperty(u, "attributes") &&
  Predicate.isObject(u.attributes) &&
  Predicate.hasProperty(u, "children") &&
  Array.isArray(u.children);

/**
 * Schema for a `ResolvedElement`, the child slot of the per-element encoded Struct that
 * `compile` builds. `Xml.Element` has the same shape but unresolved names, which is the
 * requirement it misses.
 */
export const ResolvedElementSchema = Schema.declare(isResolvedElement, {
  identifier: "ResolvedElement",
});
