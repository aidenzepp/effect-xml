import type * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";

import { hasAmbiguousMembers, markerAt } from "./plan.ts";
import type { Plan } from "./plan.ts";

/**
 * The encoding links `compile` builds, one per element codec, each registered before the codec's
 * marker is annotated on.
 *
 * `annotate` and `Schema.brand` keep the top node's `encoding` array, so the registered link is
 * still `ast.encoding[0]` of an annotated or branded element codec. A link built anywhere else,
 * such as by `Schema.decodeTo`, is not in the set.
 *
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/SchemaAST.ts `annotate` and `copy`
 */
export const compiledLinks = new WeakSet<SchemaAST.Link>();

/**
 * Whether one AST node carries no `parseOptions` annotation, on the node or on any of its checks.
 *
 * `annotate` on a node that has checks writes onto its last check instead of the node, so a
 * `parseOptions` annotation on a checked element lands on a check's annotations.
 *
 * @param ast - The AST node.
 * @returns `true` when neither the node nor a top-level check carries a parse option.
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/SchemaAST.ts `annotate`
 */
const lacksParseOptions = (ast: SchemaAST.AST): boolean =>
  ast.annotations?.parseOptions === undefined &&
  (ast.checks ?? []).every((check) => check.annotations?.parseOptions === undefined);

/**
 * Read the plan of an AST node that is `compile` output, modulo annotations and checks.
 *
 * An element with a `mixed` collision group stays on the compiled codec. The compiled union picks
 * a group's member by an exact match under `oneOf`; the structural codec selects a member by its
 * Clark name or wire tag alone, so it would pick another member: another decoded value, or another
 * namespace and attribute set in the encoded text.
 *
 * @param ast - The AST node.
 * @returns The plan of the node's marker, or `undefined` when the node has no marker, carries a
 *   `parseOptions` annotation, has any encoding other than the one link `compile` built, or lists
 *   ambiguous `mixed` members (see {@link hasAmbiguousMembers}).
 */
const compiledPlan = (ast: SchemaAST.AST): Plan | undefined => {
  const marker = markerAt(ast);

  if (
    marker === undefined ||
    !lacksParseOptions(ast) ||
    ast.encoding?.length !== 1 ||
    !compiledLinks.has(ast.encoding[0])
  ) {
    return undefined;
  }

  const plan = marker.plan();

  return hasAmbiguousMembers(plan) ? undefined : plan;
};

/**
 * Read the node of a schema that carries its element's checks: the schema's own node, or the node
 * a `suspend` reference's thunk gives, since Effect refuses checks on a `Suspend` node.
 *
 * @param ast - The schema's AST node.
 * @returns The node whose checks the element carries.
 */
const elementNode = (ast: SchemaAST.AST): SchemaAST.AST =>
  ast._tag === "Suspend" ? ast.thunk() : ast;

/**
 * Read the plan of an element codec whose decode a structural slot may replace: a codec `compile`
 * built, or a `suspend` reference to one, wrapped in nothing but `annotate`, `Schema.brand`, or
 * checks on its top node.
 *
 * Checks on the top node, written as `Schema.check` or as the ones `Schema.fromBrand` adds, keep
 * the element structural: the structural codec carries them with the same `Filter` objects (see
 * {@link carriedChecks}). Any wrapper that adds behavior beyond a check makes the schema opaque: a
 * `Schema.decodeTo` on either side, any other transformation, and a `parseOptions` annotation. An
 * element with a `mixed` collision group is opaque too, so only that
 * element, and not a structural parent holding it in a slot, takes the compiled codec.
 * This is not `planOf`, which also sees through `Schema.decodeTo` to read the element it wraps. A
 * `Suspend` node is tested itself before its thunk is forced, because `annotate` and a
 * `Schema.decodeTo` targeting the reference write to the `Suspend` node and leave its marker on
 * top; Effect memoizes the forced thunk on the node.
 *
 * @param schema - Any schema, typically an `elements` slot or a `mixed` member.
 * @returns The element's plan, or `undefined` when the schema is opaque.
 * @see {@link compiledLinks}
 * @see https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/SchemaAST.ts `Suspend`
 */
export const structuralPlan = (schema: Schema.Top): Plan | undefined => {
  const { ast } = schema;

  if (ast._tag !== "Suspend") {
    return compiledPlan(ast);
  }

  return markerAt(ast) !== undefined && lacksParseOptions(ast) && ast.encoding === undefined
    ? compiledPlan(ast.thunk())
    : undefined;
};

/**
 * Read the checks a structural element carries on its top node, in the order Effect runs them.
 *
 * They are the user's own `Filter` and `FilterGroup` objects, read from the user's node, so the
 * structural codec runs exactly the checks the element codec runs on the same Type value. A
 * `suspend` reference carries the checks of the node its thunk gives.
 *
 * A carried filter receives the structural codec's internal node as its `ast` argument, not the
 * element codec's node. Its verdict matches today's when it reads only the value and the parse
 * options, as every Effect built-in check does. A filter that decides from the node can pass here
 * where the element codec rejects; see docs/rd/decisions.md, "Carried checks".
 *
 * @param schema - Any schema, typically a root, an `elements` slot, or a `mixed` member.
 * @returns The checks, or `undefined` when the schema is opaque or carries no check.
 * @see {@link structuralPlan}
 */
export const carriedChecks = (schema: Schema.Top): SchemaAST.Checks | undefined =>
  structuralPlan(schema) === undefined ? undefined : elementNode(schema.ast).checks;
