import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";

/**
 * The QTI test fixture, read by path because `test/` never imports from `spikes/`.
 */
const fixture = new URL("../../spikes/fixtures/qti/test-features.xml", import.meta.url);

/**
 * The size in bytes the synthetic document reaches or slightly exceeds.
 */
export const targetBytes = 50 * 1024 * 1024;

/**
 * The absolute path of the gitignored synthetic document beside this module.
 */
export const syntheticPath = fileURLToPath(new URL("synthetic-test.xml", import.meta.url));

/**
 * Split the QTI fixture into the text before its test parts, the repeatable test parts, and the
 * text after them.
 *
 * The fixture is only read, never written. A failing read means a broken checkout, so it throws
 * rather than returning a typed failure, and file I/O uses `node:fs` because Vitest workers run
 * on Node.
 *
 * @returns The header, the test-part blocks, and the footer; concatenated they equal the fixture.
 */
export const syntheticParts = () => {
  const text = readFileSync(fixture, "utf-8");
  const partsStart = text.indexOf("<qti-test-part");
  const partsEnd = text.indexOf("<qti-outcome-processing>");

  return {
    footer: text.slice(partsEnd),
    header: text.slice(0, partsStart),
    parts: text.slice(partsStart, partsEnd),
  };
};

/**
 * Write the synthetic `qti-assessment-test` once and reuse it on later calls.
 *
 * The document is the fixture's header, then the repeatable test parts `repetitions` times with
 * each `identifier="` prefixed by `r<i>-`, then the footer. `repetitions` is derived from the
 * fixture and `targetBytes` on every call and `refsPerRepetition` is counted from the parts, so
 * nothing is stored beside the file. An existing file whose size is in
 * `[targetBytes, targetBytes * 1.1)` is reused untouched; otherwise the file is rewritten once.
 *
 * Native capability review: `effect/FileSystem` has no implementation here because its layers live
 * in platform packages that are not dependencies, so file I/O is `node:fs` inside `Effect.sync`.
 * A failing read of the fixture or write beside this module means a broken checkout, so it is a
 * defect, not a typed failure.
 *
 * @returns The path, the size in bytes, the repetitions, and the item refs in each repetition.
 */
export const ensureSynthetic = Effect.fnUntraced(function* build() {
  const { header, parts, footer } = syntheticParts();
  const repetitions = Math.ceil((targetBytes - header.length - footer.length) / parts.length);
  const refsPerRepetition = parts.split("<qti-assessment-item-ref").length - 1;

  const existing = yield* Effect.sync(() =>
    existsSync(syntheticPath) ? statSync(syntheticPath).size : 0,
  );

  if (existing >= targetBytes && existing < targetBytes * 1.1) {
    return { bytes: existing, path: syntheticPath, refsPerRepetition, repetitions };
  }

  const chunks = [header];

  for (let i = 0; i < repetitions; i += 1) {
    chunks.push(parts.replaceAll('identifier="', `identifier="r${i}-`));
  }

  chunks.push(footer);

  const { size } = yield* Effect.sync(() => {
    writeFileSync(syntheticPath, chunks.join(""));

    return statSync(syntheticPath);
  });

  return { bytes: size, path: syntheticPath, refsPerRepetition, repetitions };
});
