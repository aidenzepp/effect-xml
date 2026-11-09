import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

// Throwaway plumbing for the round-trip spike: text -> events -> Element -> events -> text.
// Everything here would be library-side glue if kept; see RESULT.md C9 for the justification
// of each piece (there is no upstream `Element -> Event` function, Xml.ts exports :334-:546).

export const decodeEvents = Effect.fnUntraced(function* (text: string) {
  return yield* Stream.make(text).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.runCollect,
  );
});

export const rootName = (events: ReadonlyArray<Xml.Event>): string => {
  const start = events.find((event) => event._tag === "StartElement");
  return start !== undefined && start._tag === "StartElement" ? start.name : "*";
};

export const collectRoot = Effect.fnUntraced(function* (events: ReadonlyArray<Xml.Event>) {
  const roots = yield* Stream.fromIterable(events).pipe(
    Stream.pipeThroughChannel(Xml.elements([rootName(events)])),
    Stream.runCollect,
  );
  return roots[0]!;
});

// Element tree back to the event stream the encoder consumes. Depth-first, document order.
export const elementEvents = (element: Xml.Element): Array<Xml.Event> => {
  const out: Array<Xml.Event> = [
    { _tag: "StartElement", name: element.name, attributes: element.attributes },
  ];
  for (const child of element.children) {
    if (typeof child === "string") out.push({ _tag: "Text", text: child });
    else out.push(...elementEvents(child));
  }
  out.push({ _tag: "EndElement", name: element.name });
  return out;
};

export const encodeEvents = Effect.fnUntraced(function* (events: ReadonlyArray<Xml.Event>) {
  return yield* Stream.fromIterable(events).pipe(
    Stream.pipeThroughChannel(Xml.encodeString()),
    Stream.mkString,
  );
});

export interface RoundTrip {
  readonly input: string;
  readonly first: Xml.Element;
  readonly encoded: string;
  readonly second: Xml.Element;
  // Events-level pass: decodeString -> encodeString, keeping declaration/comments/PIs.
  readonly eventsEncoded: string;
}

// decodeString -> elements([root]) -> events -> encodeString -> decodeString -> elements([root])
export const roundTrip = Effect.fnUntraced(function* (input: string) {
  const events = yield* decodeEvents(input);
  const first = yield* collectRoot(events);
  const encoded = yield* encodeEvents(elementEvents(first));
  const second = yield* collectRoot(yield* decodeEvents(encoded));
  const eventsEncoded = yield* encodeEvents(events);
  return { input, first, encoded, second, eventsEncoded } satisfies RoundTrip;
});

// Lexical facts the upstream codec is known to change (branch round-trip.md, "What upstream
// already decides"). Each counter is measured on the input and on the tree-path output so the
// RESULT.md loss table is evidence, not a restatement of the docs.
export interface LossSummary {
  readonly fixture: string;
  readonly byteEqualTree: boolean;
  readonly byteEqualEvents: boolean;
  readonly declaration: "dropped" | "kept" | "absent";
  readonly comments: number;
  readonly selfClosing: number;
  readonly charRefs: number;
  readonly namedRefsLost: number;
  readonly singleQuoted: number;
  readonly cdata: number;
  readonly multiLineTags: number;
  readonly attributeOrderKept: boolean;
}

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

const startElements = (events: ReadonlyArray<Xml.Event>): Array<Xml.StartElement> =>
  events.flatMap((event) => (event._tag === "StartElement" ? [event] : []));

export const summarize = Effect.fnUntraced(function* (fixture: string, trip: RoundTrip) {
  const before = startElements(yield* decodeEvents(trip.input));
  const after = startElements(yield* decodeEvents(trip.encoded));
  const attributeOrderKept =
    before.length === after.length &&
    before.every(
      (start, index) =>
        Object.keys(start.attributes).join("\u0000") ===
        Object.keys(after[index]!.attributes).join("\u0000"),
    );
  const stripped = trip.input.replace(/<!--[\s\S]*?-->/g, "");
  return {
    fixture,
    byteEqualTree: trip.encoded === trip.input,
    byteEqualEvents: trip.eventsEncoded === trip.input,
    declaration: trip.input.startsWith("<?xml")
      ? trip.encoded.startsWith("<?xml")
        ? "kept"
        : "dropped"
      : "absent",
    comments: count(trip.input, /<!--/g),
    selfClosing: count(stripped, /\/>/g) - count(trip.encoded, /\/>/g),
    charRefs: count(stripped, /&#[0-9a-fA-Fx]+;/g),
    namedRefsLost: count(stripped, /&apos;|&quot;/g),
    singleQuoted: count(stripped, /=\s*'/g),
    cdata: count(stripped, /<!\[CDATA\[/g),
    multiLineTags: count(stripped, /<[^!?>][^>]*\n[^>]*>/g),
    attributeOrderKept,
  } satisfies LossSummary;
});
