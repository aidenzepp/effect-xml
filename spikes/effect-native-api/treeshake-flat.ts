// Q2 tree-shaking probe (flat): uses element + text only.
import { Schema } from "effect";

import { element, text } from "../../src/index.ts";

console.log(element("a", { content: text(Schema.String) }).ast._tag);
