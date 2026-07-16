// Generate a dossier from a completed interview session (dev CLI).
// Usage: ANTHROPIC_API_KEY=... node scripts/generate-dossier.mjs <sessionId>
// Reads .data/sessions/<id>.json, extracts with Claude against the dossier
// schema, validates with ajv, writes .data/dossiers/<id>.json.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: node scripts/generate-dossier.mjs <sessionId>");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required (the brain does the extraction).");
  process.exit(1);
}

const schema = JSON.parse(readFileSync("schema/dossier.schema.json", "utf8"));
const session = JSON.parse(readFileSync(`.data/sessions/${sessionId}.json`, "utf8"));

const transcript = session.turns
  .map((t) => {
    const signals = t.ingest?.signals?.length
      ? `\n[ingest signals: ${t.ingest.signals.join("; ")}]`
      : "";
    return `[phase: ${t.phase}]\nInterviewer: ${t.question}\nCandidate (${t.mode}): ${t.answer}${signals}`;
  })
  .join("\n\n");

const anthropic = new Anthropic();

console.log(`Extracting dossier from ${session.turns.length} turns...`);
const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 32000,
  thinking: { type: "adaptive" },
  system: `You are the extraction pass of TrueSeat. Build a candidate dossier from the interview transcript.

Hard rules:
- ONLY what the transcript supports. Never invent, embellish, round up, or infer facts not stated.
- Claims without artifacts are tier 0. Only mark adjudicated:true if the candidate explicitly confirmed the exact figure when read back.
- Operating-profile language is behavioral and job-relevant, in plain words: no clinical labels, no personality-test taxonomy, no protected-characteristic inference. Where self-description and story evidence diverge, flag it honestly in the alignment field.
- Constraints go in the constraints object; they are sealed by design, so record them faithfully.
- The manager_manual is written TO a future manager, warm and specific, derived from the stories.
- Set meta.candidate_reviewed to false: the candidate has not reviewed this draft yet.

Return ONLY the dossier JSON, no prose. It must validate against this JSON Schema:
${JSON.stringify(schema)}`,
  messages: [{ role: "user", content: `Interview transcript:\n\n${transcript}` }],
});

const text = response.content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("");
const dossier = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(dossier)) {
  console.error("Extraction produced invalid dossier:");
  for (const e of validate.errors ?? []) console.error(` ${e.instancePath} ${e.message}`);
  writeFileSync(`.data/dossiers/${sessionId}.invalid.json`, JSON.stringify(dossier, null, 2));
  process.exit(1);
}

mkdirSync(".data/dossiers", { recursive: true });
writeFileSync(`.data/dossiers/${sessionId}.json`, JSON.stringify(dossier, null, 2));
console.log(`✓ dossier written to .data/dossiers/${sessionId}.json`);
console.log("Next: candidate review pass — nothing ships unreviewed.");
