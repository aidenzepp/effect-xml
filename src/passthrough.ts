import type * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaTransformation from "effect/SchemaTransformation";

/**
 * Link a declaration to its type parameter unchanged, so a derivation of the declaration is the
 * same derivation of the parameter.
 *
 * The declarations that hold a value without reshaping it, `exactValue` in `compile.ts` and
 * `passedValue` in `document.ts`, return this link from their `toCodec`, `toCodecArbitrary`, and
 * `toCodecIso` annotations.
 *
 * @param parameter - The declaration's type parameter.
 * @returns The passthrough link to `parameter`.
 */
export const passthroughTo = (parameter: Schema.Top): SchemaAST.Link =>
  new SchemaAST.Link(parameter.ast, SchemaTransformation.passthrough());
