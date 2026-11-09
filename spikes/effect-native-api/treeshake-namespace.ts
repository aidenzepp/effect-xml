// Q2 tree-shaking probe (namespace): uses XmlSchema.element + XmlSchema.text only.
import { Schema } from "effect";

import { XmlSchema } from "./treeshake-ns-entry.ts";

console.log(XmlSchema.element("a", { content: XmlSchema.text(Schema.String) }).ast._tag);
