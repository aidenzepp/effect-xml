// SPIKE-02 approach B: prefix-as-written. The upstream tree is the model; a
// definition matches qualified names literally. Zero code outside Effect
// primitives beyond the path lookup below.
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

export const literalTree = (xml: string, root: string): Effect.Effect<Xml.Element, Xml.XmlError> =>
  Stream.make(xml).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.pipeThroughChannel(Xml.elements([root])),
    Stream.runCollect,
    Effect.map((elements) => elements[0] as Xml.Element),
  );

// Descend by literal child names; `undefined` is the definition failing to match.
export const findLiteral = (
  element: Xml.Element,
  path: ReadonlyArray<string>,
): Xml.Element | undefined => {
  let current: Xml.Element | undefined = element;
  for (const name of path) {
    current = current?.children.find(
      (child): child is Xml.Element => typeof child !== "string" && child.name === name,
    );
  }
  return current;
};
