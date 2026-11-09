import { expect, test } from "bun:test";
import { changedReleaseFields, evaluate, parseNameStatus, readChangeset } from "./require.mjs";

const name = "@aidenzepp/effect-xml";

const packageJson = (fields = {}) =>
  JSON.stringify({ dependencies: {}, name, type: "module", version: "0.1.0", ...fields });

const patchChangeset = `---\n"${name}": patch\n---\n\nFix a decode position.\n`;

/**
 * Evaluates a branch whose package.json is unchanged unless the case overrides it.
 *
 * @param {{
 *   changes: { path: string; status: string }[];
 *   changesets?: Record<string, string>;
 *   pendingAtBase?: string[];
 *   basePackageJson?: string | null;
 *   headPackageJson?: string;
 *   version?: string;
 * }} branch
 *   The case's diff and file texts.
 * @returns {{ ok: boolean; message?: string }} The verdict.
 */
const verdict = ({
  changes,
  changesets = {},
  pendingAtBase = [],
  basePackageJson = packageJson(),
  headPackageJson = packageJson(),
  version = "0.1.0",
}) => evaluate({ basePackageJson, changes, changesets, headPackageJson, pendingAtBase, version });

/**
 * Evaluates a src change that adds one changeset with the given text.
 *
 * @param {string} text The changeset file text.
 * @returns {{ ok: boolean; message?: string }} The verdict.
 */
const withChangeset = (text) =>
  verdict({
    changes: [
      { path: "src/a.ts", status: "M" },
      { path: ".changeset/c.md", status: "A" },
    ],
    changesets: { ".changeset/c.md": text },
  });

test("fails a src change without a changeset and names the fix", () => {
  const result = verdict({ changes: [{ path: "src/a.ts", status: "M" }] });

  expect(result.ok).toBe(false);
  expect(result.message).toContain("release-relevant changes without a changeset: src/a.ts");
  expect(result.message).toContain(`"${name}": patch`);
  expect(result.message).toContain("bunx changeset add --empty");
});

test("passes a src change with a patch changeset", () => {
  const result = verdict({
    changes: [
      { path: "src/a.ts", status: "M" },
      { path: ".changeset/fix-position.md", status: "A" },
    ],
    changesets: { ".changeset/fix-position.md": patchChangeset },
  });

  expect(result).toEqual({ ok: true });
});

test("passes a src change with an empty changeset", () => {
  const result = verdict({
    changes: [
      { path: "src/a.ts", status: "M" },
      { path: ".changeset/no-release.md", status: "A" },
    ],
    changesets: { ".changeset/no-release.md": "---\n---\n" },
  });

  expect(result).toEqual({ ok: true });
});

test("passes test, docs, bench, tools, and Markdown changes without a changeset", () => {
  for (const path of [
    "test/upstream.test.ts",
    "src/compile.test.ts",
    "docs/onboarding.md",
    "bench/run.ts",
    "spikes/idea.ts",
    "tools/lint/plugin.mjs",
    ".github/workflows/ci.yml",
    "README.md",
  ]) {
    expect(verdict({ changes: [{ path, status: "M" }] })).toEqual({ ok: true });
  }
});

test("fails a package.json dependencies change without a changeset", () => {
  const result = verdict({
    changes: [{ path: "package.json", status: "M" }],
    headPackageJson: packageJson({ dependencies: { sax: "1.4.1" } }),
  });

  expect(result.ok).toBe(false);
  expect(result.message).toContain("package.json (dependencies)");
});

test("passes a version-only or devDependencies-only package.json change", () => {
  expect(
    verdict({
      changes: [{ path: "package.json", status: "M" }],
      headPackageJson: packageJson({ devDependencies: { vitest: "4.0.0" }, version: "0.2.0" }),
    }),
  ).toEqual({ ok: true });
});

test("does not count .changeset/README.md as a changeset", () => {
  const result = verdict({
    changes: [
      { path: "src/a.ts", status: "M" },
      { path: ".changeset/README.md", status: "A" },
    ],
    changesets: { ".changeset/README.md": patchChangeset },
  });

  expect(result.ok).toBe(false);
});

test("fails a major changeset while the version is 0.x", () => {
  const result = verdict({
    changes: [
      { path: "src/a.ts", status: "M" },
      { path: ".changeset/break.md", status: "A" },
    ],
    changesets: { ".changeset/break.md": `---\n"${name}": major\n---\n\nRemove decodeSync.\n` },
  });

  expect(result.ok).toBe(false);
  expect(result.message).toContain("pre-1.0: a breaking change is a minor bump");
});

test("allows a major changeset from 1.0 on", () => {
  const result = verdict({
    changes: [
      { path: "src/a.ts", status: "M" },
      { path: ".changeset/break.md", status: "A" },
    ],
    changesets: { ".changeset/break.md": `---\n'${name}': major\n---\n` },
    version: "1.0.0",
  });

  expect(result).toEqual({ ok: true });
});

test("passes a Version Packages branch that only deletes changesets", () => {
  const result = verdict({
    changes: [
      { path: ".changeset/fix-position.md", status: "D" },
      { path: "CHANGELOG.md", status: "M" },
      { path: "package.json", status: "M" },
    ],
    headPackageJson: packageJson({ version: "0.1.1" }),
  });

  expect(result).toEqual({ ok: true });
});

test("reads release types from changeset frontmatter", () => {
  expect(readChangeset(patchChangeset)).toEqual({ ok: true, releases: [{ name, type: "patch" }] });
  expect(readChangeset("---\n---\n")).toEqual({ ok: true, releases: [] });
  expect(readChangeset("no frontmatter: major\n").ok).toBe(false);
});

test("fails a changeset without frontmatter and names the file and the fix", () => {
  const result = withChangeset("Fix a decode position.\n");

  expect(result.ok).toBe(false);
  expect(result.message).toContain(".changeset/c.md: could not parse changeset");
  expect(result.message).toContain(`"${name}": patch`);
});

test("fails a changeset with unparseable frontmatter", () => {
  const result = withChangeset(`---\n"${name}": [patch\n---\n`);

  expect(result.ok).toBe(false);
  expect(result.message).toContain(".changeset/c.md: could not parse changeset");
});

test("fails a changeset that names another package", () => {
  const result = withChangeset(`---\n"effect-xml": patch\n---\n\nFix.\n`);

  expect(result.ok).toBe(false);
  expect(result.message).toContain(`.changeset/c.md: names "effect-xml"`);
  expect(result.message).toContain(`Use "${name}"`);
});

test("fails a changeset that declares no bump type Changesets releases here", () => {
  expect(withChangeset(`---\n"${name}": none\n---\n`).ok).toBe(false);
  expect(withChangeset(`---\n"${name}": huge\n---\n`).ok).toBe(false);
});

test("fails a quoted major changeset while the version is 0.x", () => {
  const result = withChangeset(`---\n"${name}": "major" # breaking\n---\n\nRemove decodeSync.\n`);

  expect(result.ok).toBe(false);
  expect(result.message).toContain("pre-1.0: a breaking change is a minor bump");
});

test("passes a quoted patch changeset", () => {
  expect(withChangeset(`---\n"${name}": "patch"\n---\n\nFix.\n`)).toEqual({ ok: true });
});

test("does not count a changeset already pending at the merge base", () => {
  const result = verdict({
    changes: [
      { path: "src/a.ts", status: "M" },
      { path: ".changeset/old.md", status: "D" },
      { path: ".changeset/renamed.md", status: "A" },
    ],
    changesets: { ".changeset/renamed.md": patchChangeset },
    pendingAtBase: [".changeset/renamed.md"],
  });

  expect(result.ok).toBe(false);
  expect(result.message).toContain("release-relevant changes without a changeset: src/a.ts");
});

test("fails a publishConfig change without a changeset", () => {
  const result = verdict({
    changes: [{ path: "package.json", status: "M" }],
    headPackageJson: packageJson({ publishConfig: { access: "public" } }),
  });

  expect(result.ok).toBe(false);
  expect(result.message).toContain("package.json (publishConfig)");
});

test("compares release fields deeply and treats a missing base as empty", () => {
  expect(
    changedReleaseFields(
      packageJson({ exports: { ".": "./dist/index.js" } }),
      packageJson({ exports: { ".": "./dist/index.js" } }),
    ),
  ).toEqual([]);
  expect(changedReleaseFields(null, packageJson())).toEqual(["dependencies", "type"]);
});

test("parses NUL-separated name-status output", () => {
  expect(parseNameStatus("M\0src/a.ts\0A\0.changeset/x.md\0")).toEqual([
    { path: "src/a.ts", status: "M" },
    { path: ".changeset/x.md", status: "A" },
  ]);
});
