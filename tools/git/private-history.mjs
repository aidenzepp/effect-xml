import { spawnSync } from "node:child_process";
import { text } from "node:stream/consumers";

/**
 * @typedef {{ localRef: string; localSha: string; remoteRef: string; remoteSha: string }} Update
 *   One line git passes to the pre-push hook on stdin.
 */

/**
 * @typedef {{ ok: true } | { ok: false; message: string }} Verdict
 */

/**
 * The local branch that holds the pre-public history. The perf3 branches grew from it, so
 * guarding its commits guards theirs too.
 */
export const privateBranch = "private-history";

/**
 * The published branch. Commits it already contains are public and safe to push again.
 */
export const publicRef = "refs/remotes/origin/main";

const zeroSha = /^0+$/u;

/**
 * Parses the pre-push hook's stdin: one `<local ref> <local sha> <remote ref> <remote sha>` per
 * line.
 *
 * @param {string} input The hook's stdin.
 * @returns {Update[]} One update per non-empty line.
 */
export const parseUpdates = (input) =>
  input
    .split(/\r?\n/u)
    .map((line) => line.trim().split(/\s+/u))
    .filter((fields) => fields.length === 4)
    .map(([localRef = "", localSha = "", remoteRef = "", remoteSha = ""]) => ({
      localRef,
      localSha,
      remoteRef,
      remoteSha,
    }));

/**
 * Reports whether an update deletes the remote ref; a deletion pushes no commits.
 *
 * @param {Update} update A pushed ref update.
 * @returns {boolean} Whether the local sha is all zeros.
 */
export const isDeletion = (update) => zeroSha.test(update.localSha);

/**
 * Decides whether a push may proceed.
 *
 * @param {{
 *   updates: Update[];
 *   privateCommits: ReadonlySet<string>;
 *   unpublished: Readonly<Record<string, string[]>>;
 * }} inputs
 *   The pushed updates, the private-history commits not on origin/main, and for each pushed sha
 *   the commits it reaches that origin/main does not.
 * @returns {Verdict} `ok` when no pushed ref carries a private-history commit.
 */
export const evaluate = ({ updates, privateCommits, unpublished }) => {
  const offending = updates
    .filter((update) => !isDeletion(update))
    .filter((update) =>
      (unpublished[update.localSha] ?? []).some((commit) => privateCommits.has(commit)),
    )
    .map((update) => update.localRef);

  if (offending.length === 0) {
    return { ok: true };
  }

  return {
    message: offending
      .map(
        (ref) =>
          `refusing to push private history: ${ref} contains commits from ${privateBranch}; push only main-based branches.`,
      )
      .join("\n"),
    ok: false,
  };
};

/**
 * Runs git and returns its result without throwing.
 *
 * @param {string[]} args Arguments after `git`.
 * @returns {{ ok: boolean; stdout: string }} Whether git exited 0, and its stdout.
 */
const git = (args) => {
  const result = spawnSync("git", args, { encoding: "utf-8", maxBuffer: 256 * 1024 * 1024 });

  return { ok: result.status === 0, stdout: result.stdout ?? "" };
};

/**
 * Splits `git rev-list` output into commit shas.
 *
 * @param {string} output One sha per line.
 * @returns {string[]} The shas.
 */
const shas = (output) => output.split("\n").filter((line) => line.length > 0);

/**
 * Reads the pushed updates from stdin, collects the commits from git, and prints the verdict.
 *
 * @param {string} input The hook's stdin.
 * @returns {number} The process exit code.
 */
const main = (input) => {
  if (!git(["rev-parse", "--verify", "--quiet", `refs/heads/${privateBranch}^{commit}`]).ok) {
    return 0;
  }

  const hasPublic = git(["rev-parse", "--verify", "--quiet", `${publicRef}^{commit}`]).ok;
  const exclude = hasPublic ? ["--not", publicRef] : [];
  const privateList = git(["rev-list", `refs/heads/${privateBranch}`, ...exclude]);

  if (!privateList.ok) {
    console.error(`cannot list ${privateBranch} commits; refusing the push`);

    return 1;
  }

  const updates = parseUpdates(input);
  /**
   * @type {Record<string, string[]>}
   */
  const unpublished = {};

  for (const update of updates.filter((candidate) => !isDeletion(candidate))) {
    const reached = git(["rev-list", update.localSha, ...exclude]);

    if (!reached.ok) {
      console.error(`cannot list commits for ${update.localRef}; refusing the push`);

      return 1;
    }

    unpublished[update.localSha] = shas(reached.stdout);
  }

  const verdict = evaluate({
    privateCommits: new Set(shas(privateList.stdout)),
    unpublished,
    updates,
  });

  if (!verdict.ok) {
    console.error(verdict.message);

    return 1;
  }

  return 0;
};

if (import.meta.main === true) {
  process.exitCode = main(await text(process.stdin));
}
