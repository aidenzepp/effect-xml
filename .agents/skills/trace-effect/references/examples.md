# Effect observability examples

Read before implementing or reviewing application observability. These examples
follow this repository's Effect design, code documentation, and error-message
skills. They were written against Effect 4.0.1; verify API details against the pinned version.

The goal is comprehensive useful tracing and logging: enough detail to locate
errors, isolate expensive work, explain recovery decisions, and assess which parts
of the codebase behave reliably or need improvement. The pairs below teach that
coverage at distinct boundaries; they are not a checklist for generating a test
for each span or log. Review instrumentation as part of normal code review.

Each code block is a complete alternative TypeScript module, not a sequence of
modules to combine. Exported names intentionally match within each pair. The
summary and catalog scenarios demonstrate operation boundaries; they do not add
features, database libraries, or providers to this library.

## Nested expensive operations

The caller supplies lazy, already-decoded database and external-request effects.
For this example, neither the supplied effects nor their adapters already create
spans. Both alternatives preserve the effects' environment and typed failures.
In production, inspect existing adapter instrumentation before wrapping it.

### POSITIVE — Trace the work inside the application operation

Decisive evidence: executing `loadSummary` creates `summary.get` and two child spans, `summary.readCount` and `summary.fetchStatus`. Each wrapper covers execution of the supplied effect, so the database and external-request durations can be inspected separately.

```ts
import * as Effect from "effect/Effect";

/**
 * Reads the stored count and remote status used by a summary response.
 *
 * @param query - The lazy database read, with its result already decoded.
 * @param request - The lazy external request, with its result already decoded.
 * @returns The count and status, preserving either operation's typed failures.
 */
export const loadSummary = Effect.fn("summary.get")(function* loadSummary<E, R>(
  query: Effect.Effect<number, E, R>,
  request: Effect.Effect<string, E, R>,
) {
  const count = yield* query.pipe(Effect.withSpan("summary.readCount"));
  const status = yield* request.pipe(Effect.withSpan("summary.fetchStatus"));

  return { count, status };
});
```

### NEGATIVE — Trace only the outer function

Decisive evidence: executing the same supplied effects creates only `summary.get`. The database and external-request work still runs and failures still propagate, but neither internal operation has its own timing span.

```ts
import * as Effect from "effect/Effect";

/**
 * Reads the stored count and remote status used by a summary response.
 *
 * @param query - The lazy database read, with its result already decoded.
 * @param request - The lazy external request, with its result already decoded.
 * @returns The count and status, preserving either operation's typed failures.
 */
export const loadSummary = Effect.fn("summary.get")(function* loadSummary<E, R>(
  query: Effect.Effect<number, E, R>,
  request: Effect.Effect<string, E, R>,
) {
  const count = yield* query;
  const status = yield* request;

  return { count, status };
});
```

## Logging and preserved causes

The catalog scenario is a read-only operation with a retryable source timeout.
Its adapter supplies a `CatalogTimeout` whose fixed message, bounded reason, and
validated timeout duration are safe to log; it contains no bodies or credentials.
Callers receive `CatalogUnavailable` as the public failure.
This module defines the translation boundary, not a new feature.
For real provider errors, inspect and sanitize their diagnostics before recording
them. Only this boundary logs the failure; callers must avoid logging it again.

### POSITIVE — Log the structured cause before translating the public failure

Decisive evidence: the error log receives the original sanitized `CatalogTimeout` instance, retaining its tag, timeout reason, and timeout duration with the operation annotation. The returned typed error carries only the curated read-retry message.

```ts
/* oxlint-disable unicorn/throw-new-error -- Schema.TaggedError is a schema class factory. */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The sanitized timeout diagnostics allowed in internal catalog telemetry.
 */
export class CatalogTimeout extends Schema.TaggedError<CatalogTimeout>()("CatalogTimeout", {
  message: Schema.Literal("Catalog request timed out."),
  reason: Schema.Literal("Timeout"),
  timeoutMs: Schema.Int.check(Schema.isGreaterThan(0)),
}) {}

/**
 * The curated catalog-read failure returned to callers.
 */
export class CatalogUnavailable extends Schema.TaggedError<CatalogUnavailable>()(
  "CatalogUnavailable",
  {
    message: Schema.Literal(
      "The catalog could not be loaded because its source timed out. Retry the read request.",
    ),
  },
  { httpApiStatus: 503 },
) {}

/**
 * Reads the catalog while recording timeout diagnostics at the public boundary.
 *
 * @param read - The lazy read with timeout failures already sanitized by its adapter.
 * @returns The catalog text or a curated typed failure, with diagnostics logged once.
 */
export const loadCatalog = Effect.fn("catalog.get")(function* loadCatalog(
  read: Effect.Effect<string, CatalogTimeout>,
) {
  return yield* read.pipe(
    Effect.tapError((cause) =>
      Effect.logError(cause).pipe(Effect.annotateLogs({ operation: "catalog.get" })),
    ),
    Effect.mapError(
      () =>
        new CatalogUnavailable({
          message:
            "The catalog could not be loaded because its source timed out. Retry the read request.",
        }),
    ),
  );
});
```

### NEGATIVE — Keep only the cause message in the log

Decisive evidence: the log still has error level and the operation annotation, and the public typed failure is unchanged, but `cause.message` loses the original error object, timeout reason, and timeout duration. This example is negative only on preservation of diagnostic structure.

```ts
/* oxlint-disable unicorn/throw-new-error -- Schema.TaggedError is a schema class factory. */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The sanitized timeout diagnostics allowed in internal catalog telemetry.
 */
export class CatalogTimeout extends Schema.TaggedError<CatalogTimeout>()("CatalogTimeout", {
  message: Schema.Literal("Catalog request timed out."),
  reason: Schema.Literal("Timeout"),
  timeoutMs: Schema.Int.check(Schema.isGreaterThan(0)),
}) {}

/**
 * The curated catalog-read failure returned to callers.
 */
export class CatalogUnavailable extends Schema.TaggedError<CatalogUnavailable>()(
  "CatalogUnavailable",
  {
    message: Schema.Literal(
      "The catalog could not be loaded because its source timed out. Retry the read request.",
    ),
  },
  { httpApiStatus: 503 },
) {}

/**
 * Reads the catalog while recording timeout diagnostics at the public boundary.
 *
 * @param read - The lazy read with timeout failures already sanitized by its adapter.
 * @returns The catalog text or a curated typed failure, with diagnostics logged once.
 */
export const loadCatalog = Effect.fn("catalog.get")(function* loadCatalog(
  read: Effect.Effect<string, CatalogTimeout>,
) {
  return yield* read.pipe(
    Effect.tapError((cause) =>
      Effect.logError(cause.message).pipe(Effect.annotateLogs({ operation: "catalog.get" })),
    ),
    Effect.mapError(
      () =>
        new CatalogUnavailable({
          message:
            "The catalog could not be loaded because its source timed out. Retry the read request.",
        }),
    ),
  );
});
```

## Training-data review

The intended lessons are comprehensive coverage of meaningful work, child spans
that isolate inefficient operations, tracing independent of inline syntax, and
structured diagnostics that make errors explainable while public failures remain
curated. Combine timing and outcome data with contextual logs to understand both
successful behavior and weak points; adding telemetry is part of building the
operation, not a reason to generate per-span regression tests. The
examples also preserve lazy execution, native Effect composition, typed failures,
repository import aliases, schema-backed errors, and documented operation contracts.
The schema-factory lint exemption matches the existing validation error module.

Do not infer that every helper needs a span, that existing driver spans should be
duplicated, that every failure should be logged, or that public error types should
carry raw provider causes. The supplied effects avoid choosing a database library;
they are an explicit example boundary, not a proposed application service design.

The examples were formatted, linted, and type-checked in the template this repository came from.
Runtime probes verified child-parent relationships
and the difference between original-error and message-only logging.
They do not establish how a consuming application samples or exports spans.
