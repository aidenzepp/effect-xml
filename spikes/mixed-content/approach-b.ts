// Approach B: named fields plus a text channel, as `branches/mixed-content.md`
// describes it. Each element decodes to a struct with one array field per child
// name and a `text` field whose entries carry `at`, the number of element
// children that precede the run. Element entries carry no position.
//
// Approach C (the note in the branch file) is the same struct plus `order`, the
// document-order list of `[fieldName, indexWithinField]`. It is built here as
// `order` so the test can show what B loses and what C restores.
// Throwaway spike code; nothing here is library code.
import { Effect, Schema, SchemaGetter, SchemaIssue } from "effect";
import type { Xml } from "effect/encoding";

const Attributes = Schema.Record(Schema.String, Schema.String);

const AnyElement = Schema.declare(
  (u): u is Xml.Element =>
    typeof u === "object" && u !== null && "name" in u && typeof u.name === "string",
  { title: "Xml.Element" },
);

const Child = Schema.Union([Schema.String, AnyElement]);

const ElementNamed = <const Name extends string>(name: Name) =>
  Schema.Struct({
    name: Schema.Literal(name),
    attributes: Attributes,
    children: Schema.Array(Child),
  });

export const TextRun = Schema.Struct({ at: Schema.Number, text: Schema.String });
export const OrderEntry = Schema.Tuple([Schema.String, Schema.Number]);

type Buckets = Record<string, Array<Xml.Element>>;

// Group children by name; text runs keep `at` = count of preceding element children.
const bucket = (names: ReadonlyArray<string>, children: ReadonlyArray<string | Xml.Element>) =>
  Effect.gen(function* () {
    const buckets: Buckets = Object.fromEntries(names.map((n) => [n, []]));
    const text: Array<{ at: number; text: string }> = [];
    const order: Array<readonly [string, number]> = [];
    let at = 0;
    for (const child of children) {
      if (typeof child === "string") {
        order.push(["text", text.length]);
        text.push({ at, text: child });
        continue;
      }
      const slot = buckets[child.name];
      if (slot === undefined) {
        return yield* Effect.fail(
          new SchemaIssue.InvalidValue(
            { message: `unexpected child element <${child.name}>` },
            child,
          ),
        );
      }
      order.push([child.name, slot.length]);
      slot.push(child);
      at += 1;
    }
    return { ...buckets, text, order };
  });

// B's encode rule: text runs interleave by `at`; element children come out in
// declaration order of the field names because nothing else is recorded.
const interleaveB = (
  names: ReadonlyArray<string>,
  t: { readonly text: ReadonlyArray<{ at: number; text: string }> } & Record<string, unknown>,
) => {
  const elements = names.flatMap((n) => t[n] as ReadonlyArray<Xml.Element>);
  const out: Array<string | Xml.Element> = [];
  elements.forEach((e, i) => {
    out.push(...t.text.filter((r) => r.at === i).map((r) => r.text), e);
  });
  out.push(...t.text.filter((r) => r.at === elements.length).map((r) => r.text));
  return out;
};

// C's encode rule: walk `order`.
const interleaveC = (
  t: {
    readonly text: ReadonlyArray<{ at: number; text: string }>;
    readonly order: ReadonlyArray<readonly [string, number]>;
  } & Record<string, unknown>,
) =>
  t.order.map(([field, i]) =>
    field === "text" ? t.text[i]!.text : (t[field] as ReadonlyArray<Xml.Element>)[i]!,
  );

// One definition per element. `childFields` names the allowed child elements and
// their codecs; the struct gets one array field per child name, `text`, and
// (for C) `order`. `mode` picks the encode rule so B and C can be compared with
// the same decoded value shape.
const element = <const Name extends string, const Children extends Schema.Struct.Fields>(
  name: Name,
  childFields: Children,
  mode: "B" | "C",
) => {
  const names = Object.keys(childFields);
  const arrays = Object.fromEntries(
    Object.entries(childFields).map(([k, s]) => [k, Schema.Array(s)]),
  ) as { [K in keyof Children]: Schema.$Array<Children[K]> };
  const Target = Schema.Struct({
    attributes: Attributes,
    text: Schema.Array(TextRun),
    order: Schema.Array(OrderEntry),
    ...arrays,
  });
  // The spread of a generic field map leaves `Target["Encoded"]` opaque to
  // TypeScript inside this helper (Struct.View over an unresolved intersection),
  // so the two getters cross that boundary through `unknown`. Call sites with
  // concrete fields are fully typed; the test checks that with `expectTypeOf`.
  type Shape = (typeof Target)["Encoded"];
  type Loose = {
    readonly attributes: Readonly<Record<string, string>>;
    readonly text: ReadonlyArray<{ at: number; text: string }>;
    readonly order: ReadonlyArray<readonly [string, number]>;
  } & Record<string, unknown>;
  return ElementNamed(name).pipe(
    Schema.decodeTo(Target, {
      decode: SchemaGetter.transformEffect((e) =>
        Effect.map(
          bucket(names, e.children),
          (b) => ({ attributes: e.attributes, ...b }) as unknown as Shape,
        ),
      ),
      encode: SchemaGetter.transform((shape) => {
        const t = shape as unknown as Loose;
        return {
          name,
          attributes: t.attributes,
          children: mode === "B" ? interleaveB(names, t) : interleaveC(t),
        };
      }),
    }),
  );
};

export const make = (mode: "B" | "C") => {
  const Br = element("br", {}, mode);
  const TextEntryInteraction = element("qti-text-entry-interaction", {}, mode);
  const Strong = element("strong", { br: Br }, mode);
  const Hottext = element("qti-hottext", { strong: Strong, br: Br }, mode);
  const P = element(
    "p",
    {
      strong: Strong,
      br: Br,
      "qti-text-entry-interaction": TextEntryInteraction,
      "qti-hottext": Hottext,
    },
    mode,
  );
  const SimpleChoice = element("qti-simple-choice", { strong: Strong, br: Br }, mode);
  return { Br, TextEntryInteraction, Strong, Hottext, P, SimpleChoice };
};

export const B = make("B");
export const C = make("C");
