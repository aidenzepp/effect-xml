/**
 * The benchmark registry: every case, library profile, and input id the harness knows, gathered
 * from the case and input modules so adding a case or input never edits this file.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as computisEffectXml from "./cases/computis-effect-xml.ts";
import * as effectXmlParse from "./cases/effect-xml-parse.ts";
import * as effectXmlStream from "./cases/effect-xml-stream.ts";
import * as effectXmlTyped from "./cases/effect-xml-typed.ts";
import * as fastXmlParser from "./cases/fast-xml-parser.ts";
import * as libxml2Wasm from "./cases/libxml2-wasm.ts";
import * as parseXml from "./cases/parse-xml.ts";
import * as sax from "./cases/sax.ts";
import * as saxes from "./cases/saxes.ts";
import * as txml from "./cases/txml.ts";
import * as corpus from "./inputs/corpus.ts";
import * as synthetic from "./inputs/synthetic.ts";
import type { BenchCase, BenchInput, LibraryProfile } from "./types.ts";

/**
 * The case modules, in the order their cases and profiles are registered.
 */
const caseModules = [
  effectXmlParse,
  effectXmlTyped,
  effectXmlStream,
  fastXmlParser,
  saxes,
  sax,
  txml,
  parseXml,
  libxml2Wasm,
  computisEffectXml,
];

/**
 * The input modules, in the order `loadInput` asks them.
 */
const inputModules = [corpus, synthetic];

/**
 * Every registered case; ids are unique across modules.
 */
export const cases: readonly BenchCase[] = caseModules.flatMap((module) => module.cases);

/**
 * Every registered library capability profile.
 */
export const libraries: readonly LibraryProfile[] = caseModules.flatMap(
  (module) => module.libraries,
);

/**
 * Every input id the input modules own.
 */
export const inputIds: readonly string[] = inputModules.flatMap((module) => module.inputIds);

/**
 * Load an input from the first input module that provides it.
 *
 * @param id - The input id to load.
 * @returns The loaded input, or `None` when no module provides `id`.
 */
export const loadInput = (id: string): Effect.Effect<Option.Option<BenchInput>> =>
  Arr.reduce(inputModules, Effect.succeed(Option.none<BenchInput>()), (found, module) =>
    found.pipe(
      Effect.flatMap((input) =>
        Option.isSome(input) ? Effect.succeed(input) : module.loadInput(id),
      ),
    ),
  );
