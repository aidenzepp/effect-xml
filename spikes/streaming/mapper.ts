import type { Xml } from "effect/encoding";

// The tiny hand-written `Element -> value` mapper both approaches share. It is
// the only code in this spike that would move toward `src/` (C9), and it is a
// stand-in for the Schema codec the other spikes design; the point here is the
// collection path, not the mapping.

export interface ItemRef {
  readonly identifier: string;
  readonly href: string;
  readonly weights: ReadonlyArray<{ readonly identifier: string; readonly value: number }>;
}

export interface TestHeader {
  readonly identifier: string;
  readonly title: string;
}

const isElement = (child: Xml.Element | string): child is Xml.Element => typeof child !== "string";

export const itemRef = (element: Xml.Element): ItemRef => ({
  identifier: element.attributes.identifier ?? "",
  href: element.attributes.href ?? "",
  weights: element.children
    .filter(isElement)
    .flatMap((child) =>
      child.name === "qti-weight"
        ? [{ identifier: child.attributes.identifier ?? "", value: Number(child.attributes.value) }]
        : [],
    ),
});

export const testHeader = (root: Xml.Element): TestHeader => ({
  identifier: root.attributes.identifier ?? "",
  title: root.attributes.title ?? "",
});

// Tree-mode walk: every `qti-assessment-item-ref` under the root, in document order.
export const collectItemRefs = (root: Xml.Element): Array<ItemRef> => {
  const out: Array<ItemRef> = [];
  const stack: Array<Xml.Element> = [root];
  while (stack.length > 0) {
    const element = stack.pop()!;
    if (element.name === "qti-assessment-item-ref") {
      out.push(itemRef(element));
      continue;
    }
    for (let i = element.children.length - 1; i >= 0; i--) {
      const child = element.children[i]!;
      if (isElement(child)) stack.push(child);
    }
  }
  return out;
};
