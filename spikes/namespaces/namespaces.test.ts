import { describe, expect, expectTypeOf, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { Xml } from "effect/encoding";
import { findLiteral, literalTree } from "./literal.ts";
import {
  type Name,
  type ResolvedElement,
  UndeclaredPrefix,
  UnmappedNamespace,
  XML_NAMESPACE,
  clark,
  encode,
  qname,
  resolve,
} from "./resolver.ts";

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";
const MATHML = "http://www.w3.org/1998/Math/MathML";
const XSI = "http://www.w3.org/2001/XMLSchema-instance";
const IMSCP = "http://www.imsglobal.org/xsd/qti/qtiv3p0/imscp_v1p1";
const LOM = "http://ltsc.ieee.org/xsd/LOM";
const QTI_MD = "http://www.imsglobal.org/xsd/imsqti_metadata_v3p0";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf-8");
const mathml = read("../fixtures/qti/bpig-mathml.xml");
const manifest = read("../fixtures/qti/imsmanifest.xml");
const mathmlReprefixed = read("./fixtures/bpig-mathml-reprefixed.xml");
const manifestReprefixed = read("./fixtures/imsmanifest-reprefixed.xml");
// Same spelling as the fixture, but the inner <math> no longer re-binds the
// default namespace, so it is a QTI element named "math" (a different document).
const mathmlUnbound = mathml.replace(`<math xmlns="${MATHML}">`, "<math>");
expect(mathmlUnbound).not.toBe(mathml);

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));

const descend = (element: ResolvedElement, ...locals: Array<string>): ResolvedElement => {
  let current = element;
  for (const local of locals) {
    const next = current.children.find(
      (child): child is ResolvedElement => typeof child !== "string" && child.name.local === local,
    );
    if (next === undefined) {
      throw new Error(`no child ${local} under ${current.name.local}`);
    }
    current = next;
  }
  return current;
};

const mathPath = ["qti-item-body", "qti-choice-interaction", "qti-prompt", "div", "math"] as const;

describe("A: resolve to expanded names", () => {
  test("bpig-mathml.xml: names carry namespace URIs; the inner default re-binding is MathML", async () => {
    const tree = await run(resolve(mathml));
    expect(tree.name).toEqual({ namespace: QTI, local: "qti-assessment-item" });
    const div = descend(tree, ...mathPath.slice(0, 4));
    expect(div.name).toEqual({ namespace: QTI, local: "div" });
    const math = descend(div, "math");
    expect(math.name).toEqual({ namespace: MATHML, local: "math" });
    expect(descend(math, "mrow", "msup", "mn").name).toEqual({ namespace: MATHML, local: "mn" });
    expect(descend(math, "mrow", "msup", "mn").children).toEqual(["3"]);
  });

  test("bpig-mathml.xml: xmlns is consumed; xml:lang and xsi:schemaLocation are ordinary namespaced attributes", async () => {
    const tree = await run(resolve(mathml));
    const keys = Object.keys(tree.attributes);
    expect(keys.some((key) => key.startsWith("xmlns"))).toBe(false);
    expect(tree.attributes[clark({ namespace: XML_NAMESPACE, local: "lang" })]).toBe("en");
    expect(tree.attributes[clark({ namespace: XSI, local: "schemaLocation" })]).toContain(QTI);
    expect(tree.attributes).toHaveProperty("identifier", "cube-equation-choice");
    expect(tree.attributes).toHaveProperty("time-dependent", "false");
  });

  test("imsmanifest.xml: default, imsmd and imsqti vocabularies resolve by URI", async () => {
    const tree = await run(resolve(manifest));
    expect(tree.name).toEqual({ namespace: IMSCP, local: "manifest" });
    expect(descend(tree, "metadata", "schema").name.namespace).toBe(IMSCP);
    expect(descend(tree, "metadata", "lom", "general", "title", "string").name).toEqual({
      namespace: LOM,
      local: "string",
    });
    const item = tree.children.filter(
      (child): child is ResolvedElement =>
        typeof child !== "string" && child.name.local === "resources",
    )[0] as ResolvedElement;
    const resource = item.children.filter(
      (child): child is ResolvedElement =>
        typeof child !== "string" && child.name.local === "resource",
    )[1] as ResolvedElement;
    expect(descend(resource, "metadata", "qtiMetadata", "toolName").name).toEqual({
      namespace: QTI_MD,
      local: "toolName",
    });
    expect(descend(resource, "metadata", "qtiMetadata", "toolName").children).toEqual([
      "example-tool",
    ]);
  });

  test("C4 check 2: re-prefixed copies decode to equal values", async () => {
    expect(await run(resolve(mathmlReprefixed))).toEqual(await run(resolve(mathml)));
    expect(await run(resolve(manifestReprefixed))).toEqual(await run(resolve(manifest)));
  });

  test("C4 check 3: an unprefixed attribute is in no namespace, even under a default declaration", async () => {
    const tree = await run(resolve(mathml));
    expect(Object.keys(tree.attributes)).toContain("identifier");
    expect(Object.keys(tree.attributes)).not.toContain(
      clark({ namespace: QTI, local: "identifier" }),
    );
    const interaction = descend(tree, "qti-item-body", "qti-choice-interaction");
    expect(interaction.attributes).toEqual({
      "response-identifier": "RESPONSE",
      "max-choices": "1",
    });
    const lomString = descend(
      await run(resolve(manifest)),
      "metadata",
      "lom",
      "general",
      "title",
      "string",
    );
    expect(lomString.attributes).toEqual({ language: "en" });
  });

  test("removing the inner xmlns re-binding changes the resolved tree (A sees it)", async () => {
    const bound = descend(await run(resolve(mathml)), ...mathPath);
    const unbound = descend(await run(resolve(mathmlUnbound)), ...mathPath);
    expect(bound.name).toEqual({ namespace: MATHML, local: "math" });
    expect(unbound.name).toEqual({ namespace: QTI, local: "math" });
  });

  test("encode with a declared prefix map, then decode: same resolved tree", async () => {
    const qtiMap = { "": QTI, xsi: XSI, m: MATHML };
    const tree = await run(resolve(mathml));
    const text = await run(encode(qtiMap, tree));
    expect(text).toContain('<qti-assessment-item xmlns="' + QTI + '"');
    expect(text).toContain("<m:math>");
    expect(text).toContain('xml:lang="en"');
    expect(text).toContain("xsi:schemaLocation=");
    expect(text.match(/xmlns/g)?.length).toBe(3);
    expect(await run(resolve(text))).toEqual(tree);

    const cpMap = { "": IMSCP, imsmd: LOM, imsqti: QTI_MD, xsi: XSI };
    const manifestTree = await run(resolve(manifest));
    const manifestText = await run(encode(cpMap, manifestTree));
    expect(manifestText).toContain("<imsmd:lom>");
    expect(await run(resolve(manifestText))).toEqual(manifestTree);
    // The re-prefixed copy encodes to byte-identical text: prefixes are not data.
    expect(await run(encode(cpMap, await run(resolve(manifestReprefixed))))).toBe(manifestText);
  });

  test("encode fails with a named namespace when the prefix map lacks it", async () => {
    const tree = await run(resolve(mathml));
    const error = await fail(encode({ "": QTI, xsi: XSI }, tree));
    expect(error).toBeInstanceOf(UnmappedNamespace);
    expect(error.message).toContain(MATHML);
  });

  test("C10: an undeclared prefix fails with the XML path and the repair (no position: events carry none)", async () => {
    const onElement = `<qti-assessment-item xmlns="${QTI}"><qti-item-body><foo:bar/></qti-item-body></qti-assessment-item>`;
    const error = await fail(resolve(onElement));
    expect(error).toBeInstanceOf(UndeclaredPrefix);
    expect(error).toMatchObject({
      prefix: "foo",
      path: "/qti-assessment-item/qti-item-body/foo:bar",
    });
    expect(error.message).toBe(
      'undeclared namespace prefix "foo" on element <foo:bar> at /qti-assessment-item/qti-item-body/foo:bar; declare xmlns:foo on this element or an ancestor',
    );
    const onAttribute = `<qti-assessment-item xmlns="${QTI}" xsi:schemaLocation="x"/>`;
    const attributeError = await fail(resolve(onAttribute));
    expect(attributeError).toMatchObject({
      _tag: "UndeclaredPrefix",
      prefix: "xsi",
      path: "/qti-assessment-item",
    });
    // Upstream accepts the same input: colons are name characters there.
    const upstream = await run(literalTree(onElement, "qti-assessment-item"));
    expect(findLiteral(upstream, ["qti-item-body", "foo:bar"])?.name).toBe("foo:bar");
  });

  test("C variant: a schema-side prefix map spells names as m:math and resolves them through the map", async () => {
    const q = qname({ "": QTI, m: MATHML, xsi: XSI });
    const tree = await run(resolve(mathml));
    expect(q("m:math")).toEqual(descend(tree, ...mathPath).name);
    expect(q("qti-item-body")).toEqual(descend(tree, "qti-item-body").name);
    expect(clark(q("xsi:schemaLocation"))).toBe(`{${XSI}}schemaLocation`);
    expectTypeOf(q("m:math")).toEqualTypeOf<Name>();
    expectTypeOf<Xml.Event["_tag"]>().toEqualTypeOf<
      | "Declaration"
      | "Doctype"
      | "StartElement"
      | "EndElement"
      | "Text"
      | "Comment"
      | "ProcessingInstruction"
    >();
  });
});

describe("B: prefix-as-written on the upstream tree", () => {
  test("decodes both fixtures with names as written", async () => {
    const item = await run(literalTree(mathml, "qti-assessment-item"));
    expect(findLiteral(item, [...mathPath])?.name).toBe("math");
    expect(item.attributes["xmlns:m"]).toBe(MATHML);
    const pkg = await run(literalTree(manifest, "manifest"));
    expect(
      findLiteral(pkg, ["metadata", "imsmd:lom", "imsmd:general", "imsmd:language"])?.children,
    ).toEqual(["en"]);
  });

  test("C4 check 2 fails: the re-prefixed copies do not match the literal definition", async () => {
    // The root is a path segment for Xml.elements, so a re-prefixed root is not even found.
    const item = await run(literalTree(mathmlReprefixed, "qti-assessment-item"));
    expect(findLiteral(item, [...mathPath])).toBeUndefined();
    expect(findLiteral(item, [...mathPath.slice(0, 4), "mml:math"])?.name).toBe("mml:math");
    const original = await run(literalTree(mathml, "qti-assessment-item"));
    expect(item).not.toEqual(original);

    expect(await run(literalTree(manifestReprefixed, "manifest"))).toBeUndefined();
    const pkg = await run(literalTree(manifestReprefixed, "cp:manifest"));
    expect(findLiteral(pkg, ["metadata", "imsmd:lom"])).toBeUndefined();
    expect(findLiteral(pkg, ["cp:metadata", "lom:lom"])?.name).toBe("lom:lom");
  });

  test("B cannot see the inner default-namespace re-binding", async () => {
    const bound = await run(literalTree(mathml, "qti-assessment-item"));
    const unbound = await run(literalTree(mathmlUnbound, "qti-assessment-item"));
    const boundMath = findLiteral(bound, [...mathPath]) as Xml.Element;
    const unboundMath = findLiteral(unbound, [...mathPath]) as Xml.Element;
    // Two documents in different vocabularies compare equal once the xmlns attribute is dropped.
    const { xmlns: _, ...boundAttributes } = boundMath.attributes;
    expect({ ...boundMath, attributes: boundAttributes }).toEqual(unboundMath);
  });

  test("C4 check 3 is vacuous: attributes have no namespace model, prefixed or not", async () => {
    const item = await run(literalTree(mathml, "qti-assessment-item"));
    expect(Object.keys(item.attributes)).toEqual([
      "xmlns",
      "xmlns:xsi",
      "xmlns:m",
      "xsi:schemaLocation",
      "identifier",
      "title",
      "adaptive",
      "time-dependent",
      "xml:lang",
    ]);
  });
});
