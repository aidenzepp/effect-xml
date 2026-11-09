// Q1 runs: a Schema-first text codec (text-codec.ts) against the README example and bg007.
import { Effect, Exit, Schema } from "effect";

import { decodeString, XmlDecodeError } from "../../src/index.ts";
import { AssessmentItem } from "../../test/qti/vocabulary.ts";
import {
  ChoiceInteraction,
  bg007,
  bg007Bad,
  line,
  readmeBadXml,
  readmeXml,
  withSpans,
} from "./shared.ts";
import {
  type XmlString as XmlStringType,
  XmlString,
  XmlStringLayered,
  findXml,
} from "./text-codec.ts";

const report = (label: string, exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) return line(`${label} ok`, exit.value);
  const error = Exit.findErrorOption(exit);
  if (error._tag === "None") return line(`${label} defect`, String(exit.cause));
  const e = error.value;
  if (Schema.isSchemaError(e)) {
    const xml = findXml(e.issue);
    line(`${label} SchemaError.message`, e.message);
    line(`${label}   issue._tag`, e.issue._tag);
    line(
      `${label}   recovered XmlDecodeError`,
      xml === undefined
        ? "none"
        : {
            path: xml.path,
            position: "position" in xml ? xml.position : undefined,
            reason: xml.reason._tag,
          },
    );
  } else if (e instanceof XmlDecodeError) {
    line(`${label} XmlDecodeError.message`, e.message);
    line(`${label}   fields`, { path: e.path, position: e.position, reason: e.reason._tag });
  } else line(`${label} other`, String(e));
};

// ---- runs -----------------------------------------------------------------------------------

const ReadmeB = XmlString(ChoiceInteraction);
const ReadmeA = XmlStringLayered(ChoiceInteraction);
const ItemB = XmlString(AssessmentItem);
const ItemA = XmlStringLayered(AssessmentItem);

console.log("== README example ==");
// before: today's consumer
const before = Effect.runSync(decodeString(ChoiceInteraction)(readmeXml));
// after: Schema-first consumer, sync and effect both
const afterSync = Schema.decodeUnknownSync(ReadmeB)(readmeXml);
const afterEffect = Effect.runSync(Schema.decodeUnknownEffect(ReadmeB)(readmeXml));
line("before == afterSync", JSON.stringify(before) === JSON.stringify(afterSync));
line("before == afterEffect", JSON.stringify(before) === JSON.stringify(afterEffect));
line("encodeSync(B)", Schema.encodeSync(ReadmeB)(afterSync));
line(
  "layered decodeUnknownSync(A) equal",
  JSON.stringify(Schema.decodeUnknownSync(ReadmeA)(readmeXml)) === JSON.stringify(before),
);
line("layered encodeSync(A)", Schema.encodeSync(ReadmeA)(before));

console.log("\n== README failure ==");
report("today decodeString", Effect.runSyncExit(decodeString(ChoiceInteraction)(readmeBadXml)));
report("B", Schema.decodeUnknownExit(ReadmeB)(readmeBadXml));
report("A", Schema.decodeUnknownExit(ReadmeA)(readmeBadXml));
report("B malformed", Schema.decodeUnknownExit(ReadmeB)("<qti-choice-interaction"));
report("A malformed", Schema.decodeUnknownExit(ReadmeA)("<qti-choice-interaction"));

console.log("\n== bg007 ==");
line("B bg007 ok identifier", Schema.decodeUnknownSync(ItemB)(bg007).identifier);
line("A bg007 ok identifier", Schema.decodeUnknownSync(ItemA)(bg007).identifier);
report("today bg007Bad", Effect.runSyncExit(decodeString(AssessmentItem)(bg007Bad)));
report("B bg007Bad", Schema.decodeUnknownExit(ItemB)(bg007Bad));
report("A bg007Bad", Schema.decodeUnknownExit(ItemA)(bg007Bad));

console.log("\n== composition inside a Struct (a DB row holding XML) ==");
const Row = Schema.Struct({ id: Schema.String, item: XmlString(AssessmentItem) });
const row = Schema.decodeUnknownSync(Row)({ id: "r1", item: bg007 });
line("Row decoded item.title", row.item.title);
report("Row bad", Schema.decodeUnknownExit(Row)({ id: "r1", item: bg007Bad }));
const RowJson = Schema.fromJsonString(Row);
line(
  "Row through fromJsonString",
  Schema.decodeUnknownSync(RowJson)(JSON.stringify({ id: "r2", item: bg007 })).item.identifier,
);

console.log("\n== parse options ==");
// errors: "all" reaches the inner def decode only in A (def is a Schema node); in B the
// transformation calls decodeString, which takes no ParseOptions.
const twoBad = readmeXml
  .replace('max-choices="1"', 'max-choices="x"')
  .replace('identifier="A"', "");
report("B errors:all", Schema.decodeUnknownExit(ReadmeB, { errors: "all" })(twoBad));
report("A errors:all", Schema.decodeUnknownExit(ReadmeA, { errors: "all" })(twoBad));

console.log("\n== spans ==");
line("today decodeString spans", withSpans(decodeString(ChoiceInteraction)(readmeXml)).names);
line(
  "B decodeUnknownEffect spans",
  withSpans(Schema.decodeUnknownEffect(ReadmeB)(readmeXml)).names,
);
line(
  "A decodeUnknownEffect spans",
  withSpans(Schema.decodeUnknownEffect(ReadmeA)(readmeXml)).names,
);
line("B encodeEffect spans", withSpans(Schema.encodeEffect(ReadmeB)(before)).names);

console.log("\n== Rebuild: annotate keeps the XmlString type ==");
const annotated: XmlStringType<typeof ChoiceInteraction> = ReadmeB.annotate({
  title: "interaction",
});
line("annotated decode ok", Schema.decodeUnknownSync(annotated)(readmeXml)["max-choices"]);
