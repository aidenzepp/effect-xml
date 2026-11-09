import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { parseChangesetFile } from "@changesets/parse";
import { Effect } from "effect";

/**
 * @typedef {{ path: string; status: string }} Change One line of `git diff --name-status`: the
 *   status letter and the path it applies to.
 */

/**
 * @typedef {{
 *   changes: Change[];
 *   basePackageJson: string | null;
 *   headPackageJson: string;
 *   changesets: Record<string, string>;
 *   pendingAtBase?: string[];
 *   version: string;
 * }} Inputs
 *   Everything the verdict depends on. `changesets` maps each added changeset path to its text.
 *   `pendingAtBase` lists added changeset paths whose path or content already existed at the
 *   merge base, such as a renamed pending changeset; they do not count.
 */

/**
 * @typedef {{ name: string; type: string }} Release One package line of a changeset.
 */

/**
 * @typedef {{ ok: true; releases: Release[] } | { ok: false; reason: string }} ParsedChangeset
 */

/**
 * @typedef {{ ok: true } | { ok: false; message: string }} Verdict
 */

/**
 * Top-level package.json fields that change what a consumer installs or imports.
 * A change to any of them needs a release; a version-only change does not.
 */
export const releaseFields = [
  "exports",
  "files",
  "dependencies",
  "peerDependencies",
  "peerDependenciesMeta",
  "optionalDependencies",
  "type",
  "sideEffects",
  "main",
  "module",
  "types",
  "bin",
  "engines",
  "publishConfig",
];

/**
 * The bump types a changeset may declare. Changesets also parses `none`, which releases
 * nothing and has no place in a single-package repository.
 */
export const releaseTypes = ["patch", "minor", "major"];

/**
 * Reports whether a path is a changeset file: a Markdown file directly in `.changeset/`
 * other than the README that `changeset init` writes.
 *
 * @param {string} path A repository-relative path.
 * @returns {boolean} Whether the path holds a changeset.
 */
export const isChangesetPath = (path) =>
  path.startsWith(".changeset/") &&
  path.endsWith(".md") &&
  !path.slice(".changeset/".length).includes("/") &&
  path !== ".changeset/README.md";

/**
 * Reports whether a path is published source. Tests beside the implementation in `src/`
 * never reach `dist/`, so they do not need a release.
 *
 * @param {string} path A repository-relative path.
 * @returns {boolean} Whether a change to the path reaches the published package.
 */
export const isReleaseSource = (path) => path.startsWith("src/") && !path.includes(".test.");

/**
 * Lists the release fields that differ between two package.json texts.
 *
 * @param {string | null} baseText Package.json at the merge base, or null when it did not exist.
 * @param {string} headText Package.json at HEAD.
 * @returns {string[]} The differing release field names, in `releaseFields` order.
 */
export const changedReleaseFields = (baseText, headText) => {
  /**
   * @type {Record<string, unknown>}
   */
  const base = baseText === null ? {} : JSON.parse(baseText);
  /**
   * @type {Record<string, unknown>}
   */
  const head = JSON.parse(headText);

  return releaseFields.filter((field) => isDeepStrictEqual(base[field], head[field]) !== true);
};

/**
 * Parses a changeset with the parser `changeset version` uses, so a file that passes here
 * also passes at release time.
 *
 * @param {string} text The changeset file text.
 * @returns {ParsedChangeset} The declared releases, empty for an empty changeset, or the
 *   parser's first error line.
 */
export const readChangeset = (text) =>
  Effect.runSync(
    Effect.try({
      catch: (error) => (error instanceof Error ? error.message : String(error)),
      try: () => parseChangesetFile(text),
    }).pipe(
      Effect.match({
        onFailure: (message) => ({ ok: false, reason: message.split("\n")[0] ?? message }),
        onSuccess: (parsed) => ({ ok: true, releases: parsed.releases }),
      }),
    ),
  );

/**
 * Lists what is wrong with one added changeset.
 *
 * @param {string} path The changeset path.
 * @param {string} text The changeset file text.
 * @param {string} name The package name the changeset must release.
 * @param {string} version The package version at HEAD.
 * @returns {string[]} One message per problem, each naming the file and the fix.
 */
const changesetProblems = (path, text, name, version) => {
  const parsed = readChangeset(text);

  if (!parsed.ok) {
    return [
      `${path}: ${parsed.reason}. Start the file with frontmatter: ---, "${name}": patch, ---, then a summary.`,
    ];
  }

  return parsed.releases.flatMap((release) => {
    if (release.name !== name) {
      return [`${path}: names "${release.name}", which is not this package. Use "${name}".`];
    }

    if (!releaseTypes.includes(release.type)) {
      return [
        `${path}: declares "${release.type}"; use patch, minor, or major. For no release: bunx changeset add --empty`,
      ];
    }

    if (release.type === "major" && version.startsWith("0.")) {
      return [
        `${path}: declares a major bump at ${version}; pre-1.0: a breaking change is a minor bump. Change "major" to "minor".`,
      ];
    }

    return [];
  });
};

/**
 * Builds the repair text shown when release-relevant changes have no changeset.
 *
 * @param {string[]} reasons The changed paths and package.json fields that need a release.
 * @param {string} name The package name the changeset releases.
 * @returns {string} A message naming what is missing and the exact fix.
 */
const missingChangesetMessage = (reasons, name) =>
  [
    `release-relevant changes without a changeset: ${reasons.join(", ")}`,
    "Add one: write .changeset/<short-name>.md with",
    "  ---",
    `  "${name}": patch`,
    "  ---",
    "  <one-line summary for the changelog>",
    `or run: bunx changeset add --patch ${name} -m "<one-line summary>"`,
    "Pre-1.0: breaking = minor, feat/fix = patch.",
    "If this change needs no release: bunx changeset add --empty",
  ].join("\n");

/**
 * Decides whether a branch carries the changeset its changes require.
 *
 * @param {Inputs} inputs The branch diff, package.json at both ends, and added changeset texts.
 * @returns {Verdict} `ok` when the branch passes; otherwise the message to print.
 */
export const evaluate = ({
  changes,
  basePackageJson,
  headPackageJson,
  changesets,
  pendingAtBase = [],
  version,
}) => {
  /**
   * @type {{ name?: string }}
   */
  const head = JSON.parse(headPackageJson);
  const name = head.name ?? "<package>";

  const added = changes
    .filter((change) => change.status === "A" && isChangesetPath(change.path))
    .map((change) => change.path)
    .filter((path) => !pendingAtBase.includes(path));

  const problems = added.flatMap((path) =>
    changesetProblems(path, changesets[path] ?? "", name, version),
  );

  if (problems.length > 0) {
    return { message: problems.join("\n"), ok: false };
  }

  if (added.length > 0) {
    return { ok: true };
  }

  const reasons = changes
    .filter((change) => isReleaseSource(change.path))
    .map((change) => change.path);

  if (changes.some((change) => change.path === "package.json")) {
    const fields = changedReleaseFields(basePackageJson, headPackageJson);

    if (fields.length > 0) {
      reasons.push(`package.json (${fields.join(", ")})`);
    }
  }

  if (reasons.length === 0) {
    return { ok: true };
  }

  return { message: missingChangesetMessage(reasons, name), ok: false };
};

/**
 * Parses `git diff --name-status -z --no-renames` output.
 *
 * @param {string} output NUL-separated status letters and paths.
 * @returns {Change[]} One change per path.
 */
export const parseNameStatus = (output) => {
  const fields = output.split("\0").filter((field) => field.length > 0);
  /**
   * @type {Change[]}
   */
  const changes = [];

  for (let index = 0; index + 1 < fields.length; index += 2) {
    changes.push({ path: fields[index + 1] ?? "", status: (fields[index] ?? "").charAt(0) });
  }

  return changes;
};

/**
 * Runs git and returns its result without throwing.
 *
 * @param {string[]} args Arguments after `git`.
 * @returns {{ ok: boolean; stdout: string }} Whether git exited 0, and its stdout.
 */
const git = (args) => {
  const result = spawnSync("git", args, { encoding: "utf-8" });

  return { ok: result.status === 0, stdout: result.stdout ?? "" };
};

/**
 * Lists the blob ids of the changesets pending at a commit, so a renamed changeset can be
 * recognized by its content.
 *
 * @param {string} rev The commit to read.
 * @returns {Set<string>} The blob id of each changeset file at `rev`.
 */
const changesetBlobs = (rev) => {
  const entries = git(["ls-tree", "-z", rev, ".changeset/"]).stdout.split("\0");

  return new Set(
    entries
      .map((entry) => /^\S+ blob (?<blob>\S+)\t(?<path>.+)$/u.exec(entry)?.groups)
      .filter((groups) => groups !== undefined && isChangesetPath(groups.path ?? ""))
      .map((groups) => groups?.blob ?? ""),
  );
};

/**
 * Reads the `--base <ref>` argument.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {string} The base ref, `origin/main` by default.
 */
const baseRef = (argv) => {
  const index = argv.indexOf("--base");

  return index === -1 ? "origin/main" : (argv[index + 1] ?? "origin/main");
};

/**
 * Collects the inputs from git and prints the verdict.
 *
 * @param {string[]} argv Arguments after the script path.
 * @returns {number} The process exit code.
 */
const main = (argv) => {
  const base = baseRef(argv);

  if (!git(["rev-parse", "--verify", "--quiet", `${base}^{commit}`]).ok) {
    console.error(`cannot find ${base}; run git fetch origin`);

    return 1;
  }

  const mergeBase = git(["merge-base", base, "HEAD"]);

  if (!mergeBase.ok) {
    console.error(`${base} and HEAD share no history; run git fetch origin`);

    return 1;
  }

  const baseRev = mergeBase.stdout.trim();

  const changes = parseNameStatus(
    git(["diff", "--name-status", "-z", "--no-renames", baseRev, "HEAD"]).stdout,
  );

  const basePackage = git(["show", `${baseRev}:package.json`]);
  const headPackageJson = git(["show", "HEAD:package.json"]).stdout;
  const baseBlobs = changesetBlobs(baseRev);
  /**
   * @type {Record<string, string>}
   */
  const changesets = {};
  /**
   * @type {string[]}
   */
  const pendingAtBase = [];

  for (const change of changes) {
    if (change.status === "A" && isChangesetPath(change.path)) {
      changesets[change.path] = git(["show", `HEAD:${change.path}`]).stdout;

      const blob = git(["rev-parse", `HEAD:${change.path}`]).stdout.trim();

      if (git(["cat-file", "-e", `${baseRev}:${change.path}`]).ok || baseBlobs.has(blob)) {
        pendingAtBase.push(change.path);
      }
    }
  }

  /**
   * @type {{ version?: string }}
   */
  const head = JSON.parse(headPackageJson);

  const verdict = evaluate({
    basePackageJson: basePackage.ok ? basePackage.stdout : null,
    changes,
    changesets,
    headPackageJson,
    pendingAtBase,
    version: head.version ?? "0.0.0",
  });

  if (!verdict.ok) {
    console.error(verdict.message);

    return 1;
  }

  console.log(`changeset check passed against ${base}`);

  return 0;
};

if (import.meta.main === true) {
  process.exitCode = main(process.argv.slice(2));
}
