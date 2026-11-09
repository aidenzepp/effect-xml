import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";

import { build } from "./builder.ts";
import type { ResolvedElement } from "./element.ts";
import type { AnyElement, Plan } from "./plan.ts";
import { checkedStructuralOf } from "./structural.ts";
import type { Structural } from "./structural.ts";
import { structuralPlan } from "./structural-slot.ts";

/**
 * The plan of a structural root and its structural codec, carrying the root's top-node checks.
 */
interface Root {
  readonly plan: Plan;
  readonly codec: Structural;
}

/**
 * Build a fast decoder from a collected root element to a value of the element codec `def`,
 * giving `None` wherever it declines so the caller runs today's decode for the value or its exact
 * error.
 *
 * The attempt runs three steps. A root `structuralPlan` reads as opaque, such as a `decodeTo`
 * wrapper, gives `None` and runs no user code. A root element `build` refuses, a shape today's
 * codec rejects, gives `None` before any leaf runs. The plain object then decodes with the root's
 * structural codec, carrying the root's top-node checks, inside the caller's effect, with the
 * caller's parse options unchanged and the caller's services and environment, so an async leaf
 * suspends as it does today: a Schema failure gives `None`, while a defect or an interruption
 * propagates unchanged. Leaf decodes have run by then, so they run again when the caller falls back
 * after a Schema failure.
 *
 * @param def - The element codec of the root.
 * @returns A function from a collected element, and optional parse options, to an effect
 *   yielding the value, or `None` when the caller must run today's decode.
 * @see {@link build}
 * @see {@link structuralOf}
 */
export const attemptDecode = <Def extends AnyElement>(def: Def) => {
  let root: Root | null | undefined;

  /**
   * Read the root's plan and checked structural codec on the first attempt, so a recursive
   * definition's thunks are not forced when the decoder is built.
   *
   * @returns The root's plan and codec, or `null` when the root is opaque.
   */
  const rootOf = (): Root | null => {
    if (root === undefined) {
      const plan = structuralPlan(def);

      root = plan === undefined ? null : { codec: checkedStructuralOf(def, plan), plan };
    }

    return root;
  };

  return Effect.fnUntraced(function* attempt(
    element: ResolvedElement,
    parseOptions?: SchemaAST.ParseOptions,
  ): Effect.fn.Return<Option.Option<Def["Type"]>, never, Def["DecodingServices"]> {
    const prepared = rootOf();
    const plain = prepared === null ? undefined : build(prepared.plan, element);

    if (prepared === null || plain === undefined) {
      return Option.none();
    }

    // SAFETY: the structural codec runs exactly the leaf schemas of `def` and decodes to its Type,
    // so its Type and decoding services are those of `def`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the structural codec erases its Type and services to `unknown` at the type level only.
    const decoded = Schema.decodeUnknownEffect(prepared.codec)(
      plain,
      parseOptions,
    ) as Effect.Effect<Def["Type"], Schema.SchemaError, Def["DecodingServices"]>;

    return yield* Effect.option(decoded);
  });
};
