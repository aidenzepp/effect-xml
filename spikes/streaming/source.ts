import * as Data from "effect/Data";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

// Byte source for both approaches: the file is read as a stream of chunks, never
// as one string, so the comparison measures the collector and not the read.
//
// Native-capability note: `effect/FileSystem` has `stream(path)`, but its
// implementation layer lives in `@effect/platform-bun`, which is not a
// dependency and may not be added here. `Bun.file().stream()` through
// `Stream.fromReadableStream` is the smallest glue that keeps chunked reads,
// the error channel, and cancellation (the lock is released on end).

export class ReadError extends Data.TaggedError("ReadError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

export const bytes = (path: string): Stream.Stream<Uint8Array, ReadError> =>
  Stream.fromReadableStream({
    evaluate: () => Bun.file(path).stream(),
    onError: (cause) => new ReadError({ path, cause }),
    releaseLockOnEnd: true,
  });

export const events = (path: string): Stream.Stream<Xml.Event, ReadError | Xml.XmlError> =>
  bytes(path).pipe(Stream.pipeThroughChannel(Xml.decode()));

// Path of the repeated record inside the synthetic `qti-assessment-test`.
export const itemRefPath = [
  "qti-assessment-test",
  "qti-test-part",
  "qti-assessment-section",
  "qti-assessment-item-ref",
] as const;

export const rootPath = ["qti-assessment-test"] as const;
