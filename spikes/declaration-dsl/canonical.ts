// Canonical comparator, copied in shape from SPIKE-03's description in docs/rd/spike-plan.md
// (not imported: spikes stay independent). `Element -> string` with sorted attributes,
// whitespace-only children dropped outside an inline-element set, and text whitespace collapsed.
import type { Xml } from "effect/encoding";

export const defaultInline: ReadonlySet<string> = new Set([
  "p",
  "span",
  "strong",
  "em",
  "br",
  "a",
  "sub",
  "sup",
  "qti-prompt",
  "qti-simple-choice",
  "qti-hottext",
  "qti-text-entry-interaction",
  "qti-inline-choice-interaction",
  "qti-value",
]);

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const render = (element: Xml.Element, inline: ReadonlySet<string>, keepSpace: boolean): string => {
  const attributes = Object.keys(element.attributes)
    .sort()
    .map((key) => ` ${key}="${escape(element.attributes[key] ?? "").replace(/"/g, "&quot;")}"`)
    .join("");
  const inInline = keepSpace || inline.has(element.name);
  const merged: Array<Xml.Element | string> = [];
  for (const child of element.children) {
    const last = merged.at(-1);
    if (typeof child === "string" && typeof last === "string") {
      merged[merged.length - 1] = last + child;
    } else {
      merged.push(child);
    }
  }
  const body = merged
    .map((child) =>
      typeof child === "string"
        ? child.trim() === "" && !inInline
          ? ""
          : escape(child.replace(/\s+/g, " "))
        : render(child, inline, inInline),
    )
    .join("");
  return `<${element.name}${attributes}>${body}</${element.name}>`;
};

export const canonical = (
  element: Xml.Element,
  inline: ReadonlySet<string> = defaultInline,
): string => render(element, inline, false);
