import { writeFileSync } from "node:fs";
import { createGenerator } from "ts-json-schema-generator";

const schema = createGenerator({ path: "src/spec.ts", type: "Spec", skipTypeCheck: true }).createSchema("Spec");

Object.assign(schema.definitions, {
  Expression: { type: "string", description: "An expression in the vega-agent process grammar." },
  Color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
  Count: { type: "integer", minimum: 1 },
  Name: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
  FieldName: { type: "string", minLength: 1, description: "A field of the records, with dots reaching into nested objects." },
  Size: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
});

writeFileSync("../grammar/view.schema.json", `${JSON.stringify(schema, null, 2)}\n`);
