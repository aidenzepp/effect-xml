// Library half of the Q1 spike (the runs are in q1-text-codec.ts). A Schema-first text codec, Codec<T, string>, modeled on Schema.fromJsonString
// (node_modules/effect/src/Schema.ts:9875). Two carriers are measured:
//   A "layered": String -> ResolvedElement (a tree codec), then decodeTo(def). The def's own
//     SchemaIssue is what reaches the caller.
//   B "whole":  String -> T in one transformation that runs today's decodeString/encodeString and
//     stores the XmlDecodeError/XmlEncodeError inside the SchemaIssue annotations.
import { Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";
import * as Xml from "effect/encoding/Xml";
import * as Stream from "effect/Stream";

import {
  decodeString,
  decodeTree,
  encodeString,
  type ElementCodec,
  type ResolvedElement,
  XmlDecodeError,
  XmlEncodeError,
} from "../../src/index.ts";
import { ResolvedElementSchema } from "../../src/element.ts";
import { planOf } from "../../src/plan.ts";
import { toEvents } from "../../src/resolve.ts";

const XmlText = Schema.String.annotate({ expected: "a string that will be decoded as XML" });

/**
 * Carry the library error inside the issue: `annotations.xml`.
 */
export const issueOf = (input: string | unknown, error: XmlDecodeError | XmlEncodeError) =>
  new SchemaIssue.InvalidValue({ message: error.message, xml: error }, input);

// ---- B: whole-pipeline carrier --------------------------------------------------------------

export interface XmlString<Def extends ElementCodec<string, unknown>> extends Schema.decodeTo<
  Schema.toType<Def>,
  Schema.String
> {
  readonly Rebuild: XmlString<Def>;
}

export const XmlString = <Def extends ElementCodec<string, unknown>>(
  def: Def,
  options?: { readonly declaration?: boolean },
): XmlString<Def> =>
  XmlText.pipe(
    Schema.decodeTo(
      Schema.toType(def),
      SchemaTransformation.transformEffect<Def["Type"], string>({
        decode: (text) => Effect.mapError(decodeString(def)(text), (e) => issueOf(text, e)),
        encode: (value) =>
          Effect.mapError(encodeString(def, options)(value), (e) => issueOf(value, e)),
      }),
    ),
  );

// ---- A: layered carrier ---------------------------------------------------------------------

export const ElementFromString = (prefixes: Readonly<Record<string, string>>) =>
  XmlText.pipe(
    Schema.decodeTo(
      ResolvedElementSchema,
      SchemaTransformation.transformEffect<ResolvedElement, string>({
        decode: (text) => Effect.mapError(decodeTree()(text), (e) => issueOf(text, e)),
        encode: (element) =>
          toEvents(element, { declaration: true, prefixes }).pipe(
            Effect.flatMap((events) =>
              Stream.fromIterable(events).pipe(
                Stream.pipeThroughChannel(Xml.encodeString()),
                Stream.mkString,
              ),
            ),
            Effect.mapError((e) =>
              e instanceof XmlEncodeError
                ? issueOf(element, e)
                : new SchemaIssue.InvalidValue({ message: e.message }),
            ),
          ),
      }),
    ),
  );

export const XmlStringLayered = <Def extends ElementCodec<string, unknown>>(def: Def) =>
  ElementFromString(planOf(def)?.prefixes ?? {}).pipe(Schema.decodeTo(def));

// ---- helpers --------------------------------------------------------------------------------

/**
 * Find the library error stored in an issue tree, whatever wraps it.
 */
export const findXml = (issue: SchemaIssue.Issue): XmlDecodeError | XmlEncodeError | undefined => {
  if (issue._tag === "InvalidValue") {
    const xml = issue.annotations?.["xml"];
    return xml instanceof XmlDecodeError || xml instanceof XmlEncodeError ? xml : undefined;
  }
  if ("issue" in issue && issue.issue !== undefined)
    return findXml(issue.issue as SchemaIssue.Issue);
  if ("issues" in issue) {
    for (const child of issue.issues as readonly SchemaIssue.Issue[]) {
      const found = findXml(child);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};
