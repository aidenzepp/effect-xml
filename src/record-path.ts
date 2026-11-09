import * as Option from "effect/Option";

import { isNCName, parseClark } from "./element.ts";

/**
 * The record-path step that matches any element name.
 */
const wildcard = "*";

/**
 * Check whether a step is a well-formed Clark name: an optional `{uri}` with a non-empty URI closed
 * by the first `}`, then a local part that is an XML `NCName`.
 *
 * An unclosed `{` leaves the whole step, `{` included, as the local part, which no `NCName`
 * matches.
 *
 * @param step - The record-path step.
 * @returns `true` when `step` is a Clark name.
 */
const isClarkName = (step: string): boolean => {
  const { local, namespace } = parseClark(step);

  return (
    isNCName(local) && Option.match(namespace, { onNone: () => true, onSome: (uri) => uri !== "" })
  );
};

/**
 * Describe the first step of a record path that cannot match, if any.
 *
 * @param path - The record path, one step per element from the document root.
 * @param recordName - The Clark name of the record element.
 * @returns The rejection message for the first failing step, or none when every step passes.
 */
const firstRejectedStep = (path: readonly string[], recordName: string): Option.Option<string> => {
  for (const [index, step] of path.entries()) {
    const label = `record path step ${index + 1} ${JSON.stringify(step)}`;

    if (step !== wildcard && !isClarkName(step)) {
      return Option.some(
        `${label} is not a Clark name; write it as {uri}local with local an XML name such as item (as clark() builds it), as local for no namespace, or as "*"`,
      );
    }

    if (index === path.length - 1 && step !== wildcard && step !== recordName) {
      return Option.some(
        `${label} does not name the record element ${recordName}; end the path with ${recordName} or "*"`,
      );
    }
  }

  return Option.none();
};

// Native: effect/encoding/Xml exposes no name validation and Schema has no Clark-name check, so neither can reject a record path that would never match.
/**
 * Check a record path before a streaming decode uses it to select records.
 *
 * A path that cannot match any element yields no records rather than failing, so the check rejects
 * it up front: the path is non-empty, every step is `"*"` or a well-formed Clark name
 * (`{uri}local`, or `local` for no namespace, where `local` is an XML name without `:`), and the
 * last step is `"*"` or the record element's own Clark name. A prefixed name such as `q:item` is
 * not a Clark name, a local part such as `1item` or `item>` is not an XML name, and an unprefixed
 * `item` names an element in no namespace.
 *
 * @param path - The record path, one step per element from the document root.
 * @param recordName - The Clark name of the record element the definition decodes.
 * @returns A message naming the first rejected step, its one-based position, and the repair; none
 *   when the path is accepted.
 */
export const checkRecordPath = (
  path: readonly string[],
  recordName: string,
): Option.Option<string> =>
  path.length === 0
    ? Option.some(
        `record path is empty; name each step from the root, ending with ${recordName} or "*"`,
      )
    : firstRejectedStep(path, recordName);
