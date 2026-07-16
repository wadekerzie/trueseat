// Validate the dossier schema itself and every sample against it.
// Usage: node scripts/validate-schema.mjs

import { readFileSync, readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schema = JSON.parse(readFileSync("schema/dossier.schema.json", "utf8"));
const validate = ajv.compile(schema);

let failed = false;
for (const f of readdirSync("samples").filter((f) => f.endsWith(".json"))) {
  const data = JSON.parse(readFileSync(`samples/${f}`, "utf8"));
  if (validate(data)) {
    console.log(`✓ samples/${f} valid`);
  } else {
    failed = true;
    console.error(`✗ samples/${f} INVALID:`);
    for (const e of validate.errors ?? []) {
      console.error(`  ${e.instancePath || "/"} ${e.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
