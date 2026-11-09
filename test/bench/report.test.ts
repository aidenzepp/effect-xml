/**
 * The report renderer: per-input tables ordered by median with ratios and footnoted unavailable
 * metrics, and the scaling table over the synthetic bank sizes.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";

import { render } from "../../bench/report.ts";
import type {
  CaseResult,
  LibraryProfile,
  MatrixRunFile,
  Measured,
  Quantiles,
  RunFile,
} from "../../bench/types.ts";

/**
 * The reason the GC count of one result is unavailable.
 */
const gcReason = "GCProfiler reported no collector events on this runtime";

/**
 * Build a measured value.
 *
 * @param value - The measured number.
 * @param unit - The unit of `value`.
 * @returns A measured value with a fixed source.
 */
const measured = (value: number, unit: string): Measured => ({ source: "test", unit, value });

/**
 * Build latency quantiles around a median.
 *
 * @param median - The median in milliseconds.
 * @returns Quantiles whose other ranks are offsets of `median`.
 */
const quantiles = (median: number): Quantiles => ({
  max: median + 3,
  median,
  min: median - 1,
  p95: median + 1,
  p99: median + 2,
});

/**
 * Build one `tree` result on `bank-16k`.
 *
 * @param library - The library the case measures.
 * @param median - The wall-time median in milliseconds.
 * @param gcCount - The GC count metric.
 * @returns The case result.
 */
const result = (library: string, median: number, gcCount: Measured): CaseResult => ({
  bytes: 16_384,
  caseId: `${library}/tree`,
  class: "tree",
  expected: 10,
  input: "bank-16k",
  library,
  metrics: {
    allocationBytesPerSecond: measured(2_000_000, "B/s"),
    cpuSystemMs: measured(1, "ms"),
    cpuUserMs: measured(median, "ms"),
    gcCount,
    gcPauseMs: measured(0.5, "ms"),
    heapUsedBytes: measured(4 * 1024 * 1024, "B"),
    peakRssBytes: measured(64 * 1024 * 1024, "B"),
    samples: 20,
    throughputMBps: measured(16_384 / (median / 1000) / 1e6, "MB/s"),
    timeToFirstRecordMs: undefined,
    wallMs: quantiles(median),
  },
  observed: 10,
  tokenizer: "upstream",
});

/**
 * A Bun results file with three `tree` results on `bank-16k`, out of median order, one of them
 * without a GC count.
 */
const file: RunFile = {
  environment: {
    arch: "arm64",
    commit: "abc1234",
    cores: 8,
    cpuModel: "Test CPU",
    dirty: false,
    os: "darwin",
    packages: { saxes: "6.0.0" },
    runtime: "bun",
    runtimeVersion: "1.4.2",
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
  },
  failures: [],
  method: {
    chunkBytes: 65_536,
    floorMs: quantiles(0.001),
    isolation: "process-per-case",
    maxMs: 5000,
    maxSamples: 1000,
    minMs: 1000,
    minSamples: 20,
    quantile: "nearest-rank",
    warmupIterations: 5,
    warmupMs: 500,
  },
  results: [
    result("sax", 3, measured(2, "count")),
    result("saxes", 1, { unavailable: gcReason }),
    result("txml", 2, measured(1, "count")),
  ],
};

/**
 * One capability profile.
 */
const library: LibraryProfile = {
  decodesEntities: true,
  expandsDoctypeEntities: false,
  library: "saxes",
  notes: ["reportsPositions: line and column on the parser"],
  rejectsMalformed: true,
  reportsPositions: true,
  resolvesNamespaces: true,
  streams: true,
  typed: false,
};

/**
 * Split one Markdown table row into its trimmed cells.
 *
 * @param line - A row such as `| a | b |`.
 * @returns The cells between the outer pipes.
 */
const cells = (line: string) =>
  line
    .slice(1, -1)
    .split(/(?<!\\)\|/u)
    .map((cell) => cell.trim());

/**
 * Collect every Markdown table of a document as its header cells and data rows.
 *
 * @param markdown - The rendered document.
 * @returns The tables in document order.
 */
const tables = (markdown: string) =>
  markdown
    .split(/\n\s*\n/u)
    .map((block) => block.split("\n").filter((line) => line.startsWith("|")))
    .filter((lines) => lines.length >= 2)
    .map((lines) => ({ header: cells(lines[0] ?? ""), rows: lines.slice(2).map(cells) }));

/**
 * Find the tables whose header contains a cell.
 *
 * @param markdown - The rendered document.
 * @param name - A header cell the table must contain.
 * @returns The matching tables.
 */
const tablesWith = (markdown: string, name: string) =>
  tables(markdown).filter((table) => table.header.includes(name));

/**
 * Read one column of a table.
 *
 * @param table - The table to read, if one was found.
 * @param name - The header cell naming the column.
 * @returns The column's cells in row order; none when there is no table.
 */
const column = (table: ReturnType<typeof tables>[number] | undefined, name: string) =>
  table === undefined ? [] : table.rows.map((row) => row[table.header.indexOf(name)] ?? "");

describe("render", () => {
  const markdown = render([file], [library]);

  it("renders one row per result in median order with 1.00x on the fastest", () => {
    const [table, ...others] = tablesWith(markdown, "Ratio");

    expect(others.length).toBe(0);
    expect(table?.rows.length).toBe(3);
    expect(column(table, "Case")).toStrictEqual(["saxes/tree", "txml/tree", "sax/tree"]);
    expect(column(table, "Ratio")).toStrictEqual(["1.00x", "2.00x", "3.00x"]);
  });

  it("renders an unavailable metric as n/a with a footnote carrying its reason", () => {
    const [table] = tablesWith(markdown, "Ratio");
    const [cell] = column(table, "GC count");
    const marker = /^n\/a\[\^(?<number>\d+)\]$/u.exec(cell ?? "")?.groups?.number;
    const note = markdown.split("\n").find((line) => line.startsWith(`[^${marker}]:`));

    expect(marker).toBeDefined();
    expect(note).toContain(gcReason);
  });

  it("renders a scaling row for each case on a bank input", () => {
    const [table, ...others] = tablesWith(markdown, "bank-16k");

    expect(others.length).toBe(0);
    expect(Arr.sort(column(table, "Case"), Order.String)).toStrictEqual([
      "sax/tree",
      "saxes/tree",
      "txml/tree",
    ]);
  });

  it("renders the Schema JIT row only when a file records the mode", () => {
    const jitted: MatrixRunFile = { ...file, environment: { ...file.environment, jit: "noeval" } };
    const field = (rendered: string) => column(tablesWith(rendered, "Field")[0], "Field");
    const [environment] = tablesWith(render([file, jitted], [library]), "Field");
    const row = environment?.rows.find((fieldCells) => fieldCells[0] === "Schema JIT");

    expect(field(markdown)).not.toContain("Schema JIT");
    expect(row).toStrictEqual(["Schema JIT", "-", "noeval"]);
  });

  it("renders a capability row for each library", () => {
    const [table] = tablesWith(markdown, "Library");

    expect(column(table, "Library")).toStrictEqual(["saxes"]);
  });
});
