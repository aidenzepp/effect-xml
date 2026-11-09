import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { checkRecordPath } from "./record-path.ts";

/**
 * The record element of the review's reproduction: a namespaced `item`.
 */
const recordName = "{urn:qti}item";

/**
 * Read the rejection message for a path, failing the test when the path is accepted.
 *
 * @param path - The record path to check against {@link recordName}.
 * @returns The rejection message.
 */
const rejection = (path: readonly string[]): string =>
  Option.getOrThrowWith(
    checkRecordPath(path, recordName),
    () => new Error(`expected ${JSON.stringify(path)} to be rejected`),
  );

describe("checkRecordPath", () => {
  it("rejects a last step in no namespace when the record element is namespaced", () => {
    expect(rejection(["bank", "item"])).toMatch(/^record path step 2 "item" does not name/u);
  });

  it("rejects a prefixed step that is not a Clark name", () => {
    expect(rejection(["bank", "q:item"])).toMatch(
      /^record path step 2 "q:item" is not a Clark name/u,
    );
  });

  it("rejects a step whose namespace is never closed", () => {
    expect(rejection(["bank", "{x"])).toMatch(/^record path step 2 "\{x" is not a Clark name/u);
  });

  it("rejects a step whose local part is not an XML name", () => {
    expect(rejection(["bank", "item>"])).toMatch(
      /^record path step 2 "item>" is not a Clark name/u,
    );
    expect(rejection(["bank", "1item"])).toMatch(
      /^record path step 2 "1item" is not a Clark name/u,
    );
    expect(rejection(["1bank", "{urn:qti}item"])).toMatch(
      /^record path step 1 "1bank" is not a Clark name/u,
    );
  });

  it("accepts a local part with letters beyond ASCII and name punctuation", () => {
    expect(checkRecordPath(["bänk", "*"], recordName)).toEqual(Option.none());
    expect(checkRecordPath(["_bank-2.v·x", "*"], recordName)).toEqual(Option.none());
  });

  it("accepts local parts the XML 1.0 section 2.3 productions admit", () => {
    for (const local of ["हिन्दी", "cafe\u0301", "a\u203Fb", "\u216B", "_x", "a-b.c", "中文"]) {
      expect(checkRecordPath([local, "*"], recordName)).toEqual(Option.none());
      expect(checkRecordPath(["bank", `{urn:qti}${local}`, "*"], recordName)).toEqual(
        Option.none(),
      );
    }
  });

  it("rejects local parts the XML 1.0 section 2.3 productions refuse", () => {
    for (const local of ["a\u00B2", "$text", "1x", "-a", "a b", "xml:lang"]) {
      expect(rejection([local, "*"])).toMatch(/^record path step 1 .* is not a Clark name/u);
    }
  });

  it("rejects a last step naming another element in the record's namespace", () => {
    expect(rejection(["bank", "{urn:qti}other"])).toMatch(
      /^record path step 2 "\{urn:qti\}other" does not name the record element \{urn:qti\}item/u,
    );
  });

  it("rejects a malformed inner step before the last step", () => {
    expect(rejection(["q:bank", "{urn:qti}item"])).toMatch(/^record path step 1 "q:bank"/u);
  });

  it("rejects an empty path", () => {
    expect(rejection([])).toMatch(/^record path is empty/u);
  });

  it("accepts a path ending in the record element's Clark name", () => {
    expect(checkRecordPath(["bank", "{urn:qti}item"], recordName)).toEqual(Option.none());
  });

  it("accepts wildcard steps", () => {
    expect(checkRecordPath(["*", "*"], recordName)).toEqual(Option.none());
    expect(checkRecordPath(["bank", "*"], recordName)).toEqual(Option.none());
  });
});
