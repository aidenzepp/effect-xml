import { expect, test } from "bun:test";
import { evaluate, isDeletion, parseUpdates } from "./private-history.mjs";

const zero = "0".repeat(40);
const mainSha = "a".repeat(40);

const privateSha = "b".repeat(40);

/**
 * Builds one pre-push stdin line.
 *
 * @param {string} ref The local and remote ref.
 * @param {string} localSha The pushed sha.
 * @returns {string} The line git writes for that update.
 */
const line = (ref, localSha) => `${ref} ${localSha} ${ref} ${zero}`;

const privateCommits = new Set([privateSha, "c".repeat(40)]);

test("parses one update per line and skips blank lines", () => {
  const updates = parseUpdates(`${line("refs/heads/main", mainSha)}\n\n`);

  expect(updates).toEqual([
    {
      localRef: "refs/heads/main",
      localSha: mainSha,
      remoteRef: "refs/heads/main",
      remoteSha: zero,
    },
  ]);
});

test("refuses a ref that reaches a private-history commit", () => {
  const result = evaluate({
    privateCommits,
    unpublished: { [privateSha]: [privateSha, "c".repeat(40)] },
    updates: parseUpdates(line("refs/heads/private-history", privateSha)),
  });

  expect(result).toEqual({
    message:
      "refusing to push private history: refs/heads/private-history contains commits from private-history; push only main-based branches.",
    ok: false,
  });
});

test("passes a main-based ref whose new commits are not private", () => {
  const result = evaluate({
    privateCommits,
    unpublished: { [mainSha]: ["d".repeat(40)] },
    updates: parseUpdates(line("refs/heads/main", mainSha)),
  });

  expect(result).toEqual({ ok: true });
});

test("passes a ref with nothing beyond origin/main", () => {
  const result = evaluate({
    privateCommits,
    unpublished: { [mainSha]: [] },
    updates: parseUpdates(line("refs/heads/main", mainSha)),
  });

  expect(result).toEqual({ ok: true });
});

test("skips deletions", () => {
  const updates = parseUpdates(`(delete) ${zero} refs/heads/private-history ${privateSha}`);

  expect(
    isDeletion(updates[0] ?? { localRef: "", localSha: "", remoteRef: "", remoteSha: "" }),
  ).toBe(true);
  expect(evaluate({ privateCommits, unpublished: {}, updates })).toEqual({ ok: true });
});

test("names every offending ref when one push carries several", () => {
  const result = evaluate({
    privateCommits,
    unpublished: { [mainSha]: [], [privateSha]: [privateSha] },
    updates: parseUpdates(
      [line("refs/heads/main", mainSha), line("refs/heads/perf3-orc-cluster", privateSha)].join(
        "\n",
      ),
    ),
  });

  expect(result).toEqual({
    message:
      "refusing to push private history: refs/heads/perf3-orc-cluster contains commits from private-history; push only main-based branches.",
    ok: false,
  });
});
