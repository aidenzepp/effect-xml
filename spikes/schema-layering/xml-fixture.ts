import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

// Test-side helpers shared by both approaches: load one element from the
// fixture, drop whitespace-only text, compare elements, and print events.
// Nothing here is library code.

export const fixture = new URL("../fixtures/qti/bg010-missing-word.xml", import.meta.url);

export const fixtureText = (): string => readFileSync(fixture, "utf-8");

export const readElements = (
  text: string,
  path: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<Xml.Element>, Xml.XmlError> =>
  Stream.make(text).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.pipeThroughChannel(Xml.elements(path)),
    Stream.runCollect,
  );

export const eventsToString = (
  events: ReadonlyArray<Xml.Event>,
): Effect.Effect<string, Xml.XmlError> =>
  Stream.fromIterable(events).pipe(Stream.pipeThroughChannel(Xml.encodeString()), Stream.mkString);

const isBlank = (child: Xml.Element | string): boolean =>
  typeof child === "string" && child.trim() === "";

/**
 * Drops whitespace-only text children recursively; attribute order is ignored by `canonical`.
 */
export const stripWhitespace = (element: Xml.Element): Xml.Element => ({
  name: element.name,
  attributes: element.attributes,
  children: element.children
    .filter((child) => !isBlank(child))
    .map((child) => (typeof child === "string" ? child : stripWhitespace(child))),
});

export const canonical = (element: Xml.Element): string => {
  const attributes = Object.keys(element.attributes)
    .sort()
    .map((key) => ` ${key}=${JSON.stringify(element.attributes[key])}`)
    .join("");
  const children = stripWhitespace(element)
    .children.map((child) => (typeof child === "string" ? JSON.stringify(child) : canonical(child)))
    .join("");
  return `<${element.name}${attributes}>${children}</${element.name}>`;
};

/**
 * Returns a copy of `element` with one attribute on the first matching descendant replaced.
 */
export const withAttribute = (
  element: Xml.Element,
  target: string,
  attribute: string,
  value: string,
): Xml.Element => {
  if (element.name === target) {
    return { ...element, attributes: { ...element.attributes, [attribute]: value } };
  }
  let done = false;
  const children = element.children.map((child) => {
    if (done || typeof child === "string") return child;
    const next = withAttribute(child, target, attribute, value);
    done = next !== child;
    return next;
  });
  return done ? { ...element, children } : element;
};
