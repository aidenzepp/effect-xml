// Q4: can an element codec survive .annotate / Schema.check / Schema.brand / Schema.decodeTo(Class)?
// Two type-level carriers are compared against today's ElementCodec (src/plan.ts:213):
//   R "Rebuild override": ElementCodec plus `readonly Rebuild: ElementCodecR<Name, T>`.
//   E "name in Encoded":  Schema.Codec<T, XmlElement<Name>, RD, RE>, where XmlElement<Name> is a
//     ResolvedElement with a phantom name key. Every Schema combinator keeps From["Encoded"].
// Runtime: markerOf (src/plan.ts:120) reads only the top AST node's annotations. `markerDeep` below
// also walks the AST encoding chain (SchemaAST Link.to), which is where decodeTo(Class) puts it.
import { Effect, Exit, Result, Schema, SchemaAST, SchemaGetter } from "effect";
import * as Xml from "effect/encoding/Xml";
import * as Stream from "effect/Stream";

import {
  decodeString,
  decodeTree,
  elements,
  type ElementCodec,
  many,
  namespaces,
  type ResolvedElement,
  type XmlDecodeError,
} from "../../src/index.ts";
import { toDecodeError } from "../../src/issue.ts";
import { type Marker, markerOf } from "../../src/plan.ts";
import { toEvents } from "../../src/resolve.ts";
import {
  ChoiceInteraction,
  Prompt,
  QTI,
  SimpleChoice,
  line,
  readmeBadXml,
  readmeXml,
} from "./shared.ts";

// ---- carrier R ------------------------------------------------------------------------------

interface ElementCodecR<Name extends string, T> extends Schema.Codec<T, ResolvedElement> {
  readonly "~xml.name": Name;
  readonly Rebuild: ElementCodecR<Name, T>;
}
const asR = <N extends string, T>(c: ElementCodec<N, T>) => c as unknown as ElementCodecR<N, T>;
const takesR = <Def extends ElementCodecR<string, unknown>>(def: Def): Def => def;

const PromptR = asR(Prompt);
takesR(PromptR.annotate({ title: "prompt" }));
takesR(PromptR.pipe(Schema.check(Schema.makeFilter((p) => p.text.length > 0 || "non-empty"))));
// @ts-expect-error R fails for brand: Schema.brand returns `brand<S["Rebuild"], B>`, a new interface
// (Schema.ts:5319) that does not carry "~xml.name".
takesR(PromptR.pipe(Schema.brand("Prompt")));

class PromptModel extends Schema.Class<PromptModel>("PromptModel")({ label: Schema.String }) {
  get shout() {
    return this.label.toUpperCase();
  }
}
const toModel = {
  decode: SchemaGetter.transform((p: { readonly text: string }) => ({ label: p.text })),
  encode: SchemaGetter.transform((m: { readonly label: string }) => ({ text: m.label })),
};
// @ts-expect-error R fails for decodeTo: the result is `decodeTo<To, From>` (Schema.ts:5600).
takesR(PromptR.pipe(Schema.decodeTo(PromptModel, toModel)));

// ---- carrier E ------------------------------------------------------------------------------

declare const ElementNameId: unique symbol;
/**
 * A resolved element whose name is known at the type level. Phantom only; no runtime key.
 */
interface XmlElement<Name extends string> extends ResolvedElement {
  readonly [ElementNameId]: Name;
}
type ElementSchema<Name extends string, T, RD = never, RE = never> = Schema.Codec<
  T,
  XmlElement<Name>,
  RD,
  RE
>;
const asE = <N extends string, T>(c: ElementCodec<N, T>) => c as unknown as ElementSchema<N, T>;
const takesE = <N extends string, T, RD, RE>(def: Schema.Codec<T, XmlElement<N>, RD, RE>) => def;

const PromptE = asE(Prompt);
const annotatedE = takesE(PromptE.annotate({ title: "prompt" }));
const checkedE = takesE(
  PromptE.pipe(Schema.check(Schema.makeFilter((p) => p.text.length > 0 || "non-empty"))),
);
const brandedE = takesE(PromptE.pipe(Schema.brand("Prompt")));
const modelE = takesE(PromptE.pipe(Schema.decodeTo(PromptModel, toModel)));
// The name survives: N is inferred as "qti-prompt" for every combinator.
const nameOf = <N extends string>(_: Schema.Codec<unknown, XmlElement<N>, unknown, unknown>): N =>
  "" as N;
const n1: "qti-prompt" = nameOf(brandedE);
const n2: "qti-prompt" = nameOf(modelE);
void n1;
void n2;
// Negative cases stay negative:
// @ts-expect-error a non-element schema is rejected
takesE(Schema.String);
// @ts-expect-error a codec over a plain ResolvedElement (no name) is rejected
takesE({} as Schema.Codec<string, ResolvedElement>);
// Services now thread through instead of being erased (hater A item 10):
const threadCheck = (
  needsService: ElementSchema<"qti-prompt", string, "SomeService">,
): Schema.Codec<string, XmlElement<"qti-prompt">, "SomeService"> => takesE(needsService);
void threadCheck;

// ---- runtime marker -------------------------------------------------------------------------

const markerDeep = (ast: SchemaAST.AST): Marker | undefined => {
  const top = markerOf(Schema.make(ast));
  if (top !== undefined) return top;
  for (const link of ast.encoding ?? []) {
    const found = markerDeep(link.to);
    if (found !== undefined) return found;
  }
  return undefined;
};

const cases: Record<string, Schema.Codec<unknown, XmlElement<"qti-prompt">>> = {
  annotate: annotatedE,
  check: checkedE,
  brand: brandedE,
  decodeToClass: modelE,
};
for (const [name, codec] of Object.entries(cases)) {
  line(
    `marker ${name}`,
    `markerOf=${markerOf(codec) === undefined ? "missing" : "found"} markerDeep=${markerDeep(codec.ast)?.wire ?? "missing"}`,
  );
}

// ---- runtime: decode/encode through an entry point that uses markerDeep ----------------------

const decodeStringDeep =
  <N extends string, T, RD, RE>(def: Schema.Codec<T, XmlElement<N>, RD, RE>) =>
  (xml: string): Effect.Effect<T, XmlDecodeError | Error, RD> =>
    Effect.gen(function* () {
      const marker = markerDeep(def.ast);
      if (marker === undefined) return yield* Effect.die("no element marker");
      const tree = yield* decodeTree()(xml);
      return yield* Schema.decodeUnknownEffect(def)(tree).pipe(
        Effect.mapError((e) => toDecodeError(marker.plan(), tree, e)),
      );
    });

const encodeStringDeep =
  <N extends string, T, RD, RE>(def: Schema.Codec<T, XmlElement<N>, RD, RE>) =>
  (value: T) =>
    Effect.gen(function* () {
      const marker = markerDeep(def.ast);
      if (marker === undefined) return yield* Effect.die("no element marker");
      const tree = yield* Schema.encodeEffect(def)(value);
      const events = yield* toEvents(tree, {
        declaration: false,
        prefixes: marker.plan().prefixes,
      });
      return yield* Stream.fromIterable(events).pipe(
        Stream.pipeThroughChannel(Xml.encodeString()),
        Stream.mkString,
      );
    });

const promptXml = `<qti-prompt xmlns="${QTI}">Pick</qti-prompt>`;
for (const [name, codec] of Object.entries(cases)) {
  const today = Effect.runSyncExit(decodeString(codec as never)(promptXml));
  const deep = Effect.runSyncExit(decodeStringDeep(codec)(promptXml));
  const value = Exit.isSuccess(deep) ? deep.value : undefined;
  const encoded =
    value === undefined ? undefined : Effect.runSyncExit(encodeStringDeep(codec)(value as never));
  line(
    `runtime ${name}`,
    `today=${today._tag} deep=${deep._tag} instance=${value instanceof PromptModel} encode=${encoded === undefined ? "-" : Exit.isSuccess(encoded) ? encoded.value : "fail"}`,
  );
}

// ---- a Schema.Class behind the README root, and a failure path through it --------------------

class Interaction extends Schema.Class<Interaction>("Interaction")({
  maxChoices: Schema.Int,
  responseIdentifier: Schema.String,
  choiceIds: Schema.Array(Schema.String),
}) {
  get single() {
    return this.maxChoices === 1;
  }
}
const InteractionE = asE(ChoiceInteraction).pipe(
  Schema.decodeTo(Interaction, {
    decode: SchemaGetter.transform((v) => ({
      maxChoices: v["max-choices"],
      responseIdentifier: v["response-identifier"],
      choiceIds: v.choices.map((c) => c.identifier),
    })),
    encode: SchemaGetter.transform((m) => ({
      "max-choices": m.maxChoices,
      "response-identifier": m.responseIdentifier,
      choices: m.choiceIds.map((identifier) => ({ identifier, text: identifier })),
    })),
  }),
);
const interaction = Effect.runSync(decodeStringDeep(InteractionE)(readmeXml));
line(
  "Class root instance / getter",
  `${interaction instanceof Interaction} single=${interaction.single} ids=${interaction.choiceIds.join(",")}`,
);
const bad = Effect.runSyncExit(decodeStringDeep(InteractionE)(readmeBadXml));
const badError = Exit.findErrorOption(bad);
line(
  "Class root failure",
  badError._tag === "Some" && "path" in badError.value
    ? { path: badError.value.path, message: badError.value.message }
    : String(bad),
);

// ---- a Class-backed element as a child slot ---------------------------------------------------

const qti = namespaces({ "": QTI });
const choiceModelE = asE(SimpleChoice).pipe(
  Schema.decodeTo(PromptModel, {
    decode: SchemaGetter.transform((c) => ({ label: c.identifier })),
    encode: SchemaGetter.transform((m) => ({ identifier: m.label, text: m.label })),
  }),
);
const slot = Result.try(() =>
  qti.element("qti-choice-interaction", {
    content: elements({ choices: many(choiceModelE as never) }),
  }),
);
line(
  "child slot with today's lower",
  Result.isSuccess(slot)
    ? "accepted"
    : String(Result.getFailure(slot).pipe((o) => (o._tag === "Some" ? o.value : o))).slice(0, 160),
);
// What compile would do for that slot if lower read markerDeep: Schema.Array(child) over the trees.
const tree = Effect.runSync(decodeTree()(readmeXml));
const childTrees = tree.children.filter(
  (c): c is ResolvedElement => typeof c !== "string" && c.name.endsWith("qti-simple-choice"),
);
const asArray = Schema.decodeUnknownSync(Schema.Array(choiceModelE))(childTrees);
line(
  "Schema.Array(Class-backed element) over child trees",
  asArray.map((m) => `${m instanceof PromptModel}:${m.shout}`),
);
