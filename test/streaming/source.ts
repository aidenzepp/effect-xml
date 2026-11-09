import { createReadStream } from "node:fs";

import * as Data from "effect/Data";
import * as Stream from "effect/Stream";

/**
 * A failure to read the file behind a byte source, with the path and the underlying cause.
 */
export class ReadError extends Data.TaggedError("ReadError")<{
  readonly path: string;
  readonly cause: unknown;
}> {}

/**
 * Reads a file as a stream of byte chunks, never as one string, so a decode measures the decoder
 * and not the read.
 *
 * Native review: `effect/FileSystem` has `stream(path)`, but its implementation lives in platform
 * layers (`@effect/platform-node`, `@effect/platform-bun`) that are not dependencies. A Node
 * `createReadStream` through `Stream.fromAsyncIterable` is the smallest glue that keeps chunked
 * reads and the typed error channel, and it runs on both Node and Bun.
 *
 * @param path - The file to read.
 * @returns The file's bytes in chunks, failing with `ReadError`.
 */
export const byteSource = (path: string): Stream.Stream<Uint8Array, ReadError> =>
  Stream.fromAsyncIterable<Uint8Array, ReadError>(
    createReadStream(path),
    (cause) => new ReadError({ cause, path }),
  );
