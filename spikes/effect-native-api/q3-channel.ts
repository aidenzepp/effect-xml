// Q3 runs: Channel streaming (channel.ts) vs today's Stream-to-Stream `decode`.
import { Array as Arr, Channel, Effect, Exit, Option, Stream } from "effect";

import { clark, decode, type XmlDecodeError } from "../../src/index.ts";
import { AssessmentItem, QTI } from "../../test/qti/vocabulary.ts";
import { decodeSchema, decodeSchemaString } from "./channel.ts";
import { bg007, line } from "./shared.ts";

const body = bg007.replace(/^<\?xml[^>]*\?>\s*/u, "");
const bank = `<bank>${Array.from({ length: 50 }, () => body).join("\n")}</bank>`;
const badBank = bank
  .replace(/time-dependent="false"/u, 'time-dependent="false"')
  .replace(
    new RegExp(
      `(${body.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[\\s\\S]*?){3}time-dependent="false"`,
      "u",
    ),
    (m) => m.replace(/time-dependent="false"$/u, 'time-dependent="nope"'),
  );
const path = ["bank", clark(Option.some(QTI), "qti-assessment-item")];
const chunksOf = (text: string, size: number) =>
  Array.from({ length: Math.ceil(text.length / size) }, (_, i) =>
    text.slice(i * size, (i + 1) * size),
  );
const textStream = (text: string) => Stream.fromIterable(chunksOf(text, 4096));
const byteStream = (text: string) =>
  Stream.fromIterable(chunksOf(text, 4096).map((c) => new TextEncoder().encode(c)));

const count = <E>(stream: Stream.Stream<unknown, E>) => Effect.runSyncExit(Stream.runCount(stream));

// before
line("today decode(text)", count(decode(AssessmentItem, path)(textStream(bank))));
line("today decode(bytes)", count(decode(AssessmentItem, path)(byteStream(bank))));

// after
line(
  "channel text",
  count(
    textStream(bank).pipe(Stream.pipeThroughChannel(decodeSchemaString(AssessmentItem, path)())),
  ),
);
line(
  "channel bytes",
  count(byteStream(bank).pipe(Stream.pipeThroughChannel(decodeSchema(AssessmentItem, path)()))),
);
line(
  "channel text positions",
  count(
    textStream(bank).pipe(
      Stream.pipeThroughChannel(decodeSchemaString(AssessmentItem, path)({ positions: true })),
    ),
  ),
);

// The input kind is checked by the compiler, not sniffed from the first chunk at run time.
// @ts-expect-error a text stream does not fit the bytes channel
void textStream(bank).pipe(Stream.pipeThroughChannel(decodeSchema(AssessmentItem, path)()));
// @ts-expect-error today's Stream-to-Stream decode is not a Channel (hater B W5)
void textStream(bank).pipe(Stream.pipeThroughChannel(decode(AssessmentItem, path)));

// Channel composition, no Stream in between: bytes -> Channel.decodeText -> positioned text decoder,
// then Channel.map on the record channel. This is the "bytes with positions" path today's `decode`
// builds by hand with decodeUtf8 (Channel.decodeText is not fatal: bad UTF-8 becomes U+FFFD).
const bytesWithPositions = Channel.pipeTo(
  Channel.decodeText<never, unknown>(),
  decodeSchemaString(AssessmentItem, path)({ positions: true }),
).pipe(Channel.map((chunk) => Arr.map(chunk, (item) => item.title.trim())));
line(
  "Channel.pipeTo(decodeText, decodeSchemaString) + Channel.map, first title",
  Effect.runSync(
    byteStream(bank).pipe(Stream.pipeThroughChannel(bytesWithPositions), Stream.runHead),
  ),
);

// Failure: the third record has a bad attribute; records before it are emitted, error keeps record + XPath.
const firstError = <A>(stream: Stream.Stream<A, XmlDecodeError>) => {
  const exit = Effect.runSyncExit(Stream.runCollect(stream));
  const e = Exit.findErrorOption(exit);
  return e._tag === "Some"
    ? { path: e.value.path, record: e.value.record, position: e.value.position }
    : exit._tag;
};
line(
  "today decode(text) failure",
  firstError(decode(AssessmentItem, path, { positions: true })(textStream(badBank))),
);
line(
  "channel text positions failure",
  firstError(
    textStream(badBank).pipe(
      Stream.pipeThroughChannel(decodeSchemaString(AssessmentItem, path)({ positions: true })),
    ),
  ),
);
line(
  "channel bytes failure",
  firstError(
    byteStream(badBank).pipe(Stream.pipeThroughChannel(decodeSchema(AssessmentItem, path)())),
  ),
);
line(
  "records before failure (today)",
  Effect.runSync(
    decode(
      AssessmentItem,
      path,
    )(textStream(badBank)).pipe(
      Stream.catch(() => Stream.empty),
      Stream.runCount,
    ),
  ),
);
line(
  "records before failure (channel)",
  Effect.runSync(
    textStream(badBank).pipe(
      Stream.pipeThroughChannel(decodeSchemaString(AssessmentItem, path)()),
      Stream.catch(() => Stream.empty),
      Stream.runCount,
    ),
  ),
);
line(
  "malformed bytes",
  firstError(
    byteStream("<bank><qti-assessment-item").pipe(
      Stream.pipeThroughChannel(decodeSchema(AssessmentItem, path)()),
    ),
  ),
);
