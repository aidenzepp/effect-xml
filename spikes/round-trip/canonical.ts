import type { Xml } from "effect/encoding";

// Canonical form of an upstream `Xml.Element` tree, used as the round-trip oracle.
// Equivalence promise (branch round-trip.md, approach A): same element tree, same
// names as written, same attribute sets, same character data after whitespace
// normalization. Not preserved: attribute order, quote style, entity form,
// self-closing form, declaration, comments, PIs, and whitespace-only text outside
// the inline-element set. Under 80 lines so other spikes can copy it verbatim.

export interface CanonicalOptions {
  // Elements whose whitespace-only children are kept (as a single space) because
  // whitespace between inline runs is significant there, e.g. `<p>a <b>b</b> c</p>`.
  readonly inline: ReadonlySet<string>;
}

export const defaultInline: ReadonlySet<string> = new Set([
  "p",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "li",
  "td",
  "th",
  "qti-prompt",
  "qti-simple-choice",
  "qti-hottext",
  "qti-feedback-inline",
  "qti-value",
]);

const escape = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const normalizeText = (text: string): string => text.replace(/\s+/g, " ");

const canonicalAttributes = (attributes: Readonly<Record<string, string>>): string =>
  Object.keys(attributes)
    .sort()
    .map((key) => ` ${key}="${escape(attributes[key]!)}"`)
    .join("");

const canonicalChildren = (element: Xml.Element, options: CanonicalOptions): string => {
  const keepWhitespace = options.inline.has(element.name);
  let out = "";
  for (const child of element.children) {
    if (typeof child !== "string") {
      out += canonicalize(child, options);
    } else if (child.trim() !== "" || keepWhitespace) {
      out += escape(normalizeText(child));
    }
  }
  return out;
};

export const canonicalize = (
  element: Xml.Element,
  options: CanonicalOptions = { inline: defaultInline },
): string =>
  `<${element.name}${canonicalAttributes(element.attributes)}>${canonicalChildren(element, options)}</${element.name}>`;
