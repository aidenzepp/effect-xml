/**
 * The `--jit on` preload: enable Effect's Schema JIT process-wide before the case process loads
 * the library, as a consumer would.
 */
import "effect/schema/SchemaJITCompiler/enable";

globalThis.computisEffectXmlBenchJit = { mode: "on" };
