/**
 * The tokenizers a benchmark run can measure effect-xml cases through, selected by name.
 */
import { defaultTokenizer } from "../src/tokenizer.ts";
import type { Tokenizer } from "../src/tokenizer.ts";

/**
 * Every tokenizer the driver accepts, keyed by the name a `--tokenizer` argument and a results
 * file use; `upstream` is the `effect/encoding/Xml` tokenizer the library defaults to.
 */
// oxlint-disable-next-line anti-slop/no-known-value-widening -- the driver indexes the table by a `--tokenizer` name read at run time, so the table is an open dictionary by contract.
export const tokenizers: Readonly<Record<string, Tokenizer>> = { upstream: defaultTokenizer };

/**
 * The names of {@link tokenizers}, in declaration order.
 */
export const tokenizerNames: readonly string[] = Object.keys(tokenizers);
