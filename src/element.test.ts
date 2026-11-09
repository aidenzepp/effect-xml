import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  clark,
  isNCName,
  isQName,
  isResolvedElement,
  NAME_RULE,
  parseClark,
  ResolvedElementSchema,
  spell,
  XML_NAMESPACE,
} from "./element.ts";

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const XSI = "http://www.w3.org/2001/XMLSchema-instance";

describe("Clark names", () => {
  it("formats a namespaced name as {uri}local", () => {
    expect(clark(Option.some(QTI), "item")).toBe(`{${QTI}}item`);
  });

  it("formats a name in no namespace as its local part", () => {
    expect(clark(Option.none(), "item")).toBe("item");
  });

  it("round-trips a namespaced name", () => {
    expect(parseClark(clark(Option.some(QTI), "item"))).toEqual({
      local: "item",
      namespace: Option.some(QTI),
    });
  });

  it("round-trips a name in no namespace", () => {
    expect(parseClark(clark(Option.none(), "item"))).toEqual({
      local: "item",
      namespace: Option.none(),
    });
  });

  it("splits on the first } so a local part may contain }", () => {
    expect(parseClark(clark(Option.some(QTI), "a}b"))).toEqual({
      local: "a}b",
      namespace: Option.some(QTI),
    });
  });
});

describe("XML names", () => {
  it("accepts NCNames with letters beyond ASCII and name punctuation", () => {
    expect(["item", "_x", "größe", "a-b.c_d·e", "v2"].every(isNCName)).toBe(true);
  });

  it("rejects names a struct key or a stray character would make", () => {
    expect(["$text", "$children", "*", "", "1x", "a b", "a:b", "item>"].some(isNCName)).toBe(false);
  });

  it("accepts a qualified name with or without a prefix", () => {
    expect(["lang", "xml:lang", "xsi:schemaLocation", "m:math", "größe"].every(isQName)).toBe(true);
  });

  it("rejects a qualified name with an empty, extra, or malformed part", () => {
    expect([":a", "a:", "a:b:c", "1p:a", "p:$text", "$text", "a b"].some(isQName)).toBe(false);
  });
});

/**
 * Names the XML 1.0 (Fifth Edition) §2.3 productions admit as a qualified name: combining marks,
 * a decomposed accent, the U+203F connector, a U+2070-218F number form, the `xml` prefix, and CJK.
 */
const legalQNames = [
  "हिन्दी",
  "cafe\u0301",
  "a\u203Fb",
  "\u216B",
  "xml:lang",
  "_x",
  "a-b.c",
  "中文",
];

/**
 * Strings the §2.3 productions refuse as a qualified name: a superscript digit, the struct keys,
 * a leading digit or hyphen, a space, a second colon, and the empty string.
 */
const illegalQNames = ["a\u00B2", "$text", "*", "1x", "-a", "a b", "a:b:c", ""];

describe("XML 1.0 section 2.3 names", () => {
  for (const name of legalQNames) {
    it(`accepts ${JSON.stringify(name)} as a qualified name`, () => {
      expect(isQName(name)).toBe(true);
    });
  }

  for (const name of illegalQNames) {
    it(`rejects ${JSON.stringify(name)} as a qualified name`, () => {
      expect(isQName(name)).toBe(false);
    });
  }

  it("states the name rule in terms of the specification productions", () => {
    expect(NAME_RULE).toMatch(/^an XML name is local or prefix:local/u);
    expect(NAME_RULE).toMatch(/XML 1\.0/u);
  });
});

describe("spell", () => {
  it("writes an element in the default namespace as its bare local part", () => {
    expect(spell("{urn:q}p", { "": "urn:q" }, "element")).toBe("p");
  });

  it("writes a name under its authored prefix", () => {
    expect(spell("{urn:q}p", { q: "urn:q" }, "element")).toBe("q:p");
  });

  it("writes an attribute under its prefix, never the default namespace", () => {
    expect(spell(`{${XSI}}schemaLocation`, { "": QTI, xsi: XSI }, "attribute")).toBe(
      "xsi:schemaLocation",
    );
  });

  it("writes a name in the xml namespace with the reserved xml prefix", () => {
    expect(spell(`{${XML_NAMESPACE}}lang`, {}, "attribute")).toBe("xml:lang");
  });

  it("marks an element in no namespace when a default namespace is declared", () => {
    expect(spell("item", { "": "urn:qti" }, "element")).toBe("item (no namespace)");
  });

  it("writes an attribute in no namespace as its local part under a default namespace", () => {
    expect(spell("item", { "": "urn:qti" }, "attribute")).toBe("item");
  });

  it("writes a namespace with no declared prefix explicitly", () => {
    expect(spell("{urn:x}p", {}, "element")).toBe("{urn:x}p");
  });

  it("spells the namespace when a contrasting name differs only in namespace", () => {
    expect(spell("item", {}, "element", [`{${QTI}}item`])).toBe("item (no namespace)");
    expect(spell(`{${QTI}}item`, { "": QTI }, "element", ["item"])).toBe(`{${QTI}}item`);
  });
});

describe("ResolvedElement", () => {
  const nested = {
    attributes: {},
    children: [{ attributes: {}, children: ["x"], name: "b" }],
    name: "a",
  };

  it("guards a nested element", () => {
    expect(isResolvedElement(nested)).toBe(true);
  });

  it("rejects a string, an array, and an element without children", () => {
    expect(isResolvedElement("text")).toBe(false);
    expect(isResolvedElement([])).toBe(false);
    expect(isResolvedElement({ attributes: {}, name: "a" })).toBe(false);
  });

  it("decodes a nested element and rejects text", () => {
    expect(Schema.decodeUnknownSync(ResolvedElementSchema)(nested)).toEqual(nested);
    expect(() => Schema.decodeUnknownSync(ResolvedElementSchema)("text")).toThrow();
  });

  it("imports only from effect at runtime", () => {
    const source = readFileSync(new URL("element.ts", import.meta.url), "utf-8");

    const targets = [...source.matchAll(/from "(?<target>[^"]+)"/gu)].map((m) =>
      String(m.groups?.target),
    );

    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((target) => target.startsWith("effect"))).toBe(true);
  });
});
