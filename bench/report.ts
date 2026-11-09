/**
 * The report renderer: turn benchmark results files into the Markdown tables of
 * `docs/rd/performance.md`, so the document is generated rather than hand-copied.
 *
 * Run directly (`bun bench/report.ts <results.json>...` or `node bench/report.ts ...`), it reads
 * the named results files and prints the rendered document.
 */
import { readFileSync } from "node:fs";
import * as Arr from "effect/Array";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import type {
  BenchClass,
  CaseResult,
  LibraryProfile,
  Measured,
  Quantiles,
  RunFile,
} from "./types.ts";

/**
 * The comparison classes in the order the report renders them.
 */
const classes: readonly BenchClass[] = [
  "events",
  "tree",
  "typed-decode",
  "encode-tree",
  "encode-typed",
  "stream",
];

/**
 * The bytes in one mebibyte, the unit of the memory columns.
 */
const mebibyte = 1024 * 1024;

/**
 * The input ids of the synthetic bank sizes, the columns of the scaling table; the `-bad-last`
 * error-path inputs are not sizes and stay out of it.
 */
const bankSize = /^bank-\d+[km]$/u;

/**
 * Results ordered by their wall-time median, fastest first.
 */
const byMedian = Order.mapInput(Order.Number, (result: CaseResult) => result.metrics.wallMs.median);

/**
 * Results ordered by the size of their input, smallest first.
 */
const byBytes = Order.mapInput(Order.Number, (result: CaseResult) => result.bytes);

/**
 * Numbered footnotes for unavailable metrics: one number per distinct reason, in first-use order.
 */
type Footnotes = Map<string, number>;

/**
 * Render one table cell's text so it cannot break the row.
 *
 * @param text - The cell text.
 * @returns The text with pipes escaped and line breaks flattened.
 */
const escape = (text: string) => text.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");

/**
 * Render a Markdown table.
 *
 * @param header - The header cells.
 * @param rows - The data rows, each as long as `header`.
 * @returns The table's lines joined by line breaks.
 */
const table = (header: readonly string[], rows: readonly (readonly string[])[]) =>
  [header, header.map(() => "---"), ...rows]
    .map((cells) => `| ${cells.map(escape).join(" | ")} |`)
    .join("\n");

/**
 * Name the runtime a results file measured on.
 *
 * @param file - The results file.
 * @returns The runtime and its version, such as `bun 1.4.2`.
 */
const runtimeLabel = (file: RunFile) =>
  `${file.environment.runtime} ${file.environment.runtimeVersion}`;

/**
 * Format milliseconds for a latency column.
 *
 * @param ms - The milliseconds.
 * @returns The value with three decimals.
 */
const milliseconds = (ms: number) => ms.toFixed(3);

/**
 * Render a measured value, or `n/a` with the footnote that carries why it is unavailable.
 *
 * @param footnotes - The document's footnotes, extended with a new reason.
 * @param value - The measured value.
 * @param scale - The divisor that converts the value to the column's unit.
 * @param digits - The decimals to show.
 * @returns The cell text.
 */
const measuredCell = (footnotes: Footnotes, value: Measured, scale: number, digits: number) => {
  if (Predicate.hasProperty(value, "unavailable")) {
    const number = footnotes.get(value.unavailable) ?? footnotes.size + 1;

    footnotes.set(value.unavailable, number);

    return `n/a[^${number}]`;
  }

  return (value.value / scale).toFixed(digits);
};

/**
 * Read the Schema JIT mode a results file recorded.
 *
 * `bench/run.ts` writes it as `environment.jit` (`MatrixRunFile` in `bench/types.ts`); results
 * files written before the driver took `--jit` carry no such field.
 *
 * @param file - The results file.
 * @returns The recorded mode, or `undefined` when the file carries none.
 */
const jitLabel = (file: RunFile) =>
  Predicate.hasProperty(file.environment, "jit") && Predicate.isString(file.environment.jit)
    ? file.environment.jit
    : undefined;

/**
 * Render the environment table, one column per results file.
 *
 * The Schema JIT row appears only when at least one file recorded its mode; a file without one
 * shows a dash in that row.
 *
 * @param files - The results files.
 * @returns The section's Markdown.
 */
const environmentSection = (files: readonly RunFile[]) => {
  const packages = Arr.sort(
    Arr.dedupe(files.flatMap((file) => Object.keys(file.environment.packages))),
    Order.String,
  );

  const field = (name: string, read: (file: RunFile) => string) => [name, ...files.map(read)];

  const rows = [
    field("OS", (file) => file.environment.os),
    field("Architecture", (file) => file.environment.arch),
    field("CPU", (file) => file.environment.cpuModel),
    field("Cores", (file) => String(file.environment.cores)),
    field("Memory (GiB)", (file) => (file.environment.totalMemoryBytes / 1024 ** 3).toFixed(1)),
    field(
      "Commit",
      (file) => `${file.environment.commit}${file.environment.dirty ? " (dirty)" : ""}`,
    ),
    ...(files.some((file) => jitLabel(file) !== undefined)
      ? [field("Schema JIT", (file) => jitLabel(file) ?? "-")]
      : []),
    ...packages.map((name) => field(name, (file) => file.environment.packages[name] ?? "absent")),
  ];

  return `## Environment\n\n${table(["Field", ...files.map(runtimeLabel)], rows)}`;
};

/**
 * Render the sampling method of one results file as a list.
 *
 * @param file - The results file.
 * @returns The section's Markdown.
 */
const methodSection = (file: RunFile) => {
  const { method } = file;
  const floor = method.floorMs;
  const tokenizers = Arr.dedupe(file.results.map((result) => result.tokenizer));

  return [
    `### Method: ${runtimeLabel(file)}`,
    "",
    `- Warmup: ${method.warmupIterations} iterations and at least ${method.warmupMs} ms`,
    `- Samples: ${method.minSamples} to ${method.maxSamples}, over ${method.minMs} to ${method.maxMs} ms`,
    `- Stream chunk: ${method.chunkBytes} bytes`,
    `- Quantiles: ${method.quantile}; isolation: ${method.isolation}`,
    `- Sampler floor: median ${milliseconds(floor.median)} ms, p95 ${milliseconds(floor.p95)} ms, p99 ${milliseconds(floor.p99)} ms`,
    `- Tokenizers: ${tokenizers.length === 0 ? "none" : tokenizers.join(", ")}`,
  ].join("\n");
};

/**
 * Render a probe result for the capability table.
 *
 * @param value - The probe result.
 * @returns `yes` or `no`.
 */
const flag = (value: boolean) => (value ? "yes" : "no");

/**
 * Render the time-to-first-record quantiles of a stream result.
 *
 * @param quantiles - The quantiles, absent outside the stream class.
 * @returns The median, p95, and p99 cells, or dashes when absent.
 */
const firstRecord = (quantiles: Quantiles | undefined) =>
  quantiles === undefined
    ? ["-", "-", "-"]
    : [quantiles.median, quantiles.p95, quantiles.p99].map(milliseconds);

/**
 * Render the capability table, one row per library and one column per probe.
 *
 * @param libraries - The capability profiles.
 * @returns The section's Markdown.
 */
const capabilitySection = (libraries: readonly LibraryProfile[]) => {
  const rows = libraries.map((profile) => [
    profile.library,
    flag(profile.rejectsMalformed),
    flag(profile.resolvesNamespaces),
    flag(profile.decodesEntities),
    flag(profile.expandsDoctypeEntities),
    flag(profile.reportsPositions),
    flag(profile.streams),
    flag(profile.typed),
    profile.notes.join("; "),
  ]);

  const header = [
    "Library",
    "Rejects malformed",
    "Resolves namespaces",
    "Decodes entities",
    "Expands DOCTYPE entities",
    "Reports positions",
    "Streams",
    "Typed",
    "Notes",
  ];

  return `## Capabilities\n\n${table(header, rows)}`;
};

/**
 * Render the results of one class on one input from one results file, ordered by median.
 *
 * @param footnotes - The document's footnotes.
 * @param benchClass - The class the results belong to; `stream` adds time-to-first-record columns.
 * @param results - The results to render.
 * @returns The table's Markdown.
 */
const resultTable = (
  footnotes: Footnotes,
  benchClass: BenchClass,
  results: readonly CaseResult[],
) => {
  const sorted = Arr.sort(results, byMedian);
  const fastest = sorted[0]?.metrics.wallMs.median ?? 0;
  const stream = benchClass === "stream";

  const rows = sorted.map(({ library, caseId, metrics }) => [
    library,
    caseId,
    String(metrics.samples),
    milliseconds(metrics.wallMs.median),
    milliseconds(metrics.wallMs.p95),
    milliseconds(metrics.wallMs.p99),
    measuredCell(footnotes, metrics.throughputMBps, 1, 2),
    fastest > 0 ? `${(metrics.wallMs.median / fastest).toFixed(2)}x` : "-",
    measuredCell(footnotes, metrics.cpuUserMs, 1, 3),
    measuredCell(footnotes, metrics.cpuSystemMs, 1, 3),
    measuredCell(footnotes, metrics.peakRssBytes, mebibyte, 1),
    measuredCell(footnotes, metrics.heapUsedBytes, mebibyte, 1),
    measuredCell(footnotes, metrics.allocationBytesPerSecond, 1e6, 2),
    measuredCell(footnotes, metrics.gcCount, 1, 0),
    measuredCell(footnotes, metrics.gcPauseMs, 1, 3),
    ...(stream ? firstRecord(metrics.timeToFirstRecordMs) : []),
  ]);

  const header = [
    "Library",
    "Case",
    "Samples",
    "Median (ms)",
    "p95 (ms)",
    "p99 (ms)",
    "MB/s",
    "Ratio",
    "CPU user (ms)",
    "CPU system (ms)",
    "Peak RSS (MiB)",
    "Heap used (MiB)",
    "Allocation (MB/s)",
    "GC count",
    "GC pause (ms)",
    ...(stream
      ? ["First record median (ms)", "First record p95 (ms)", "First record p99 (ms)"]
      : []),
  ];

  return table(header, rows);
};

/**
 * Render every class's results: per class, per input, one table per results file.
 *
 * @param footnotes - The document's footnotes.
 * @param files - The results files.
 * @returns One section per class that has results.
 */
const resultSections = (footnotes: Footnotes, files: readonly RunFile[]) =>
  classes.flatMap((benchClass) => {
    const ofClass = (file: RunFile) => file.results.filter((result) => result.class === benchClass);
    const inputs = Arr.dedupe(files.flatMap((file) => ofClass(file).map((result) => result.input)));

    if (inputs.length === 0) {
      return [];
    }

    const blocks = inputs.flatMap((input) => [
      `### ${benchClass}: ${input}`,
      ...files.flatMap((file) => {
        const results = ofClass(file).filter((result) => result.input === input);

        return results.length === 0
          ? []
          : [`#### ${runtimeLabel(file)}`, resultTable(footnotes, benchClass, results)];
      }),
    ]);

    return [[`## Class: ${benchClass}`, ...blocks].join("\n\n")];
  });

/**
 * Render the scaling curve of one results file: one row per case with a result on a bank size,
 * one column per bank size in byte order.
 *
 * @param file - The results file.
 * @returns The table's Markdown, or nothing when the file has no bank results.
 */
const scalingTable = (file: RunFile) => {
  const banked = Arr.sort(
    file.results.filter((result) => bankSize.test(result.input)),
    byBytes,
  );

  const sizes = Arr.dedupe(banked.map((result) => result.input));
  const caseIds = Arr.sort(Arr.dedupe(banked.map((result) => result.caseId)), Order.String);

  const cell = (caseId: string, input: string) => {
    const found = banked.find((result) => result.caseId === caseId && result.input === input);

    if (found === undefined) {
      return "-";
    }

    const { throughputMBps, wallMs } = found.metrics;

    const rate = Predicate.hasProperty(throughputMBps, "unavailable")
      ? "n/a"
      : throughputMBps.value.toFixed(2);

    return `${milliseconds(wallMs.median)} ms, ${rate} MB/s`;
  };

  return sizes.length === 0
    ? []
    : [
        `### ${runtimeLabel(file)}`,
        table(
          ["Case", ...sizes],
          caseIds.map((caseId) => [caseId, ...sizes.map((input) => cell(caseId, input))]),
        ),
      ];
};

/**
 * Render the failures of every results file as lists.
 *
 * @param files - The results files.
 * @returns The section, or nothing when no file has failures.
 */
const failureSections = (files: readonly RunFile[]) => {
  const blocks = files.flatMap((file) =>
    file.failures.length === 0
      ? []
      : [
          `### ${runtimeLabel(file)}`,
          file.failures
            .map((failure) => `- \`${failure.caseId}\` on \`${failure.input}\`: ${failure.reason}`)
            .join("\n"),
        ],
  );

  return blocks.length === 0 ? [] : [["## Failures", ...blocks].join("\n\n")];
};

/**
 * Render results files and library profiles as the Markdown of `docs/rd/performance.md`.
 *
 * The document holds an environment table with one column per runtime and a method list per
 * file, a capability table, per class and input one table per runtime ordered by median with the
 * ratio to the fastest median, a scaling table per runtime over the bank sizes, the failures, and
 * the numbered footnotes giving the reason behind each `n/a`.
 *
 * @param files - The results files to render, one per runtime.
 * @param libraries - The capability profiles of the measured libraries.
 * @returns The Markdown document.
 */
export const render = (files: readonly RunFile[], libraries: readonly LibraryProfile[]): string => {
  const footnotes: Footnotes = new Map();
  const results = resultSections(footnotes, files);
  const scaling = files.flatMap(scalingTable);
  const notes = [...footnotes].map(([reason, number]) => `[^${number}]: ${reason}`);

  return `${[
    environmentSection(files),
    ...files.map(methodSection),
    capabilitySection(libraries),
    ...results,
    ...(scaling.length === 0 ? [] : [["## Scaling", ...scaling].join("\n\n")]),
    ...failureSections(files),
    ...(notes.length === 0 ? [] : [notes.join("\n")]),
  ].join("\n\n")}\n`;
};

/**
 * A results file that could not be read or parsed as JSON.
 */
export class ReportError extends Data.TaggedError("ReportError")<{
  readonly path: string;
  readonly message: string;
}> {}

/**
 * Check that a parsed value has the four top-level fields of a results file.
 *
 * @param input - The parsed JSON value.
 * @returns `true` when `input` carries `environment`, `method`, `results`, and `failures`.
 */
const isRunFile = (input: unknown): input is RunFile =>
  Predicate.hasProperty(input, "environment") &&
  Predicate.hasProperty(input, "method") &&
  Predicate.hasProperty(input, "results") &&
  Predicate.hasProperty(input, "failures");

/**
 * The JSON text of a results file. The file is the benchmark driver's own output, so only its
 * top-level shape is checked, not every field.
 */
const RunFileJson = Schema.fromJsonString(Schema.declare(isRunFile));

// Native: effect/FileSystem lacks an implementation without a platform layer, which is not a dependency.
/**
 * Read and parse one results file written by the benchmark driver.
 *
 * @param path - The path of the results file.
 * @returns The results file, or a `ReportError` naming the path and the cause.
 */
const readRunFile = (path: string) => {
  const failure = (cause: unknown) =>
    new ReportError({
      message: `Cannot read results file ${path}; pass a JSON file the benchmark driver wrote. Cause: ${String(cause)}`,
      path,
    });

  return Effect.try({ catch: failure, try: () => readFileSync(path, "utf-8") }).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(RunFileJson)(text).pipe(Effect.mapError(failure)),
    ),
  );
};

if (import.meta.main) {
  void Effect.runPromise(
    Effect.all(process.argv.slice(2).map(readRunFile)).pipe(
      Effect.zip(Effect.promise(() => import("./registry.ts"))),
      Effect.flatMap(([files, registry]) => Console.log(render(files, registry.libraries))),
    ),
  );
}
