/**
 * The input sets the case modules share, so every case that names "every valid input" or "the
 * bank sizes" accepts the same ids.
 */
import type { BenchInput } from "../types.ts";

/**
 * The four synthetic bank sizes, the inputs of the record-shaped cases; the `-bad-last` banks are
 * error-path inputs and stay out.
 */
export const bankIds: ReadonlySet<string> = new Set([
  "bank-16k",
  "bank-256k",
  "bank-4m",
  "bank-64m",
]);

/**
 * Decide whether a case runs on an input: every input except the error-path `-bad-last` banks.
 *
 * @param input - The candidate input.
 * @param input.id - The input id the decision is read from.
 * @returns `true` unless the id ends in `-bad-last`.
 */
export const acceptsValid = (input: Pick<BenchInput, "id">): boolean =>
  !input.id.endsWith("-bad-last");

/**
 * Decide whether a bank case runs on an input: the four bank sizes only.
 *
 * @param input - The candidate input.
 * @param input.id - The input id the decision is read from.
 * @returns `true` when the id is one of {@link bankIds}.
 */
export const acceptsBank = (input: Pick<BenchInput, "id">): boolean => bankIds.has(input.id);
