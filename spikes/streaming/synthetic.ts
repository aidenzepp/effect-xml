import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";

// Builds the synthetic `qti-assessment-test` for SPIKE-04 by repeating the two
// `<qti-test-part>` blocks of `test-features.xml` until the document is about
// 50 MB. Identifiers get a per-repetition prefix so the document stays
// plausible; nothing validates them. The file is gitignored and regenerated when
// missing or when its size no longer matches the target.

const fixture = new URL("../fixtures/qti/test-features.xml", import.meta.url);
export const syntheticPath = fileURLToPath(new URL("./synthetic-test.xml", import.meta.url));
export const targetBytes = 50 * 1024 * 1024;

// Item refs per repeated block pair, counted from the fixture: 3 in the
// survey part and 3 in the synthesis part.
export const itemRefsPerRepetition = 6;

const split = (text: string) => {
  const partsStart = text.indexOf("<qti-test-part");
  const partsEnd = text.indexOf("<qti-outcome-processing>");
  return {
    header: text.slice(0, partsStart),
    parts: text.slice(partsStart, partsEnd),
    footer: text.slice(partsEnd),
  };
};

export const ensureSynthetic = Effect.fnUntraced(function* () {
  if (existsSync(syntheticPath)) {
    const size = statSync(syntheticPath).size;
    if (size >= targetBytes && size < targetBytes * 1.1) {
      return { path: syntheticPath, bytes: size, repetitions: undefined as number | undefined };
    }
  }
  const text = yield* Effect.promise(() => Bun.file(fixture).text());
  const { header, parts, footer } = split(text);
  const budget = targetBytes - header.length - footer.length;
  const repetitions = Math.ceil(budget / parts.length);
  const chunks: Array<string> = [header];
  for (let i = 0; i < repetitions; i++) {
    chunks.push(parts.replaceAll('identifier="', `identifier="r${i}-`));
  }
  chunks.push(footer);
  const bytes = yield* Effect.promise(() => Bun.write(syntheticPath, chunks.join("")));
  return { path: syntheticPath, bytes, repetitions };
});
