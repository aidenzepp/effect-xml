/**
 * The environment record of a run: the runtime label, the measured package versions, the commit,
 * and the machine's core and memory counts.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { environment, measuredPackages } from "../../bench/harness/environment.ts";

/**
 * The `version` field of a package manifest; the rest of the manifest is ignored.
 */
const PackageManifest = Schema.Struct({ version: Schema.String });

/**
 * The version of `effect` installed in this checkout, read independently of the module under test.
 */
const installedEffectVersion = Schema.decodeUnknownSync(Schema.fromJsonString(PackageManifest))(
  readFileSync(new URL("../../node_modules/effect/package.json", import.meta.url), "utf-8"),
).version;

describe("environment", () => {
  it.effect("labels the runtime node under Vitest", () =>
    Effect.gen(function* labelsRuntime() {
      const record = yield* environment;

      expect(record.runtime).toBe("node");
    }),
  );

  it.effect("records the installed effect version", () =>
    Effect.gen(function* recordsEffectVersion() {
      const record = yield* environment;

      expect(record.packages.effect).toBe(installedEffectVersion);
    }),
  );

  it.effect("keys every measured package", () =>
    Effect.gen(function* keysMeasuredPackages() {
      const record = yield* environment;

      expect(measuredPackages.length).toBeGreaterThan(0);
      expect(Object.keys(record.packages)).toEqual(expect.arrayContaining([...measuredPackages]));
    }),
  );

  it.effect("records a full commit hash or unknown", () =>
    Effect.gen(function* recordsCommit() {
      const record = yield* environment;

      expect(record.commit).toMatch(/^[0-9a-f]{40}$|^unknown$/u);
    }),
  );

  it.effect("records positive core and memory counts", () =>
    Effect.gen(function* recordsMachineCounts() {
      const record = yield* environment;

      expect(record.cores).toBeGreaterThan(0);
      expect(record.totalMemoryBytes).toBeGreaterThan(0);
    }),
  );
});
