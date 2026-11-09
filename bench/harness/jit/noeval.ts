/**
 * The `--jit noeval` preload: enable Effect's Schema JIT process-wide, then make
 * `globalThis.Function` refuse every call, so the JIT runs where dynamic function construction is
 * blocked.
 *
 * The JIT probes `globalThis.Function("return true")` before its first compilation and re-probes
 * only when `globalThis.Function` changes identity; a refused probe disables compilation and every
 * parser falls back to the interpreter
 * (`node_modules/effect/src/schema/SchemaJITCompiler.ts`). The proxy keeps `prototype` and the
 * static members, so `instanceof Function` checks behave as before.
 */
import "effect/schema/SchemaJITCompiler/enable";

/**
 * Refuse one call or construction of `Function`, as a content security policy without
 * `unsafe-eval` does, and count the refusal.
 *
 * @returns Never; it always throws an `EvalError`.
 */
const refuse = (): never => {
  if (globalThis.computisEffectXmlBenchJit?.mode === "noeval") {
    globalThis.computisEffectXmlBenchJit.refusals += 1;
  }

  throw new EvalError("dynamic function construction is disabled under --jit noeval");
};

/**
 * The `Function` replacement every call and construction of which is refused.
 */
const refusing = new Proxy(globalThis.Function, { apply: refuse, construct: refuse });

globalThis.computisEffectXmlBenchJit = { mode: "noeval", refusals: 0, refusing };

globalThis.Function = refusing;
