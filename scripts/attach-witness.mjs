// Attach a completed witness reference to its dossier. Claude extracts the
// witness's confirmations (their own words), validates the relationship, and
// flags divergences — which go to the CANDIDATE first, per the design doc:
// the candidate chooses whether the reference appears, but cannot edit it.
// Usage: node scripts/attach-witness.mjs <witnessId>

import { readFileSync, existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env) && m[2]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const witnessId = process.argv[2];

if (!witnessId || !SUPABASE_URL || !SUPABASE_KEY || !process.env.ANTHROPIC_API_KEY) {
  console.error("usage: node scripts/attach-witness.mjs <witnessId> (needs Supabase + Anthropic env)");
  process.exit(1);
}

const h = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const wres = await fetch(`${SUPABASE_URL}/rest/v1/witnesses?id=eq.${witnessId}&select=*`, { headers: h });
const wrows = await wres.json();
if (!wrows.length) { console.error("witness not found"); process.exit(1); }
const w = wrows[0];
if (w.status !== "completed") {
  console.error(`witness status is '${w.status}' — needs 'completed'`);
  process.exit(1);
}

const dres = await fetch(`${SUPABASE_URL}/rest/v1/dossiers?id=eq.${w.dossier_id}&select=content`, { headers: h });
const [drow] = await dres.json();
const dossier = drow.content;

const transcript = w.turns
  .map((t, i) => `Q${i + 1}: ${t.question}\nWitness: ${t.answer}`)
  .join("\n\n");

const anthropic = new Anthropic();
const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4000,
  system: `You extract a witness micro-reference for a TrueSeat dossier.
Rules:
- confirmations: the witness's OWN words, quoted or tightly paraphrased. Only what they actually said. Skipped questions produce nothing.
- relationship_validated: does their answer to Q1 support the claimed relationship ("${w.relationship}")?
- divergences: anywhere the witness's account differs from the candidate's claims (listed below). Report honestly; these go to the candidate privately.
- Never invent, soften, or embellish.
Candidate's spot-checked claims: ${JSON.stringify((dossier.headline_numbers ?? []).slice(0, 2).map((n) => n.claim))}
Return ONLY JSON: {"relationship_validated": boolean, "confirmations": string[], "divergences": string[], "manager_one_liner": string|null}`,
  messages: [{ role: "user", content: `Witness interview transcript:\n\n${transcript}` }],
});

const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
const extracted = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

dossier.operating_profile = dossier.operating_profile ?? {};
dossier.operating_profile.micro_references = dossier.operating_profile.micro_references ?? [];
dossier.operating_profile.micro_references.push({
  id: w.id,
  relationship: w.relationship,
  confirmations: extracted.confirmations,
});

const pres = await fetch(`${SUPABASE_URL}/rest/v1/dossiers?id=eq.${w.dossier_id}`, {
  method: "PATCH",
  headers: h,
  body: JSON.stringify({
    content: dossier,
    candidate_reviewed: false, // new material = new review pass, always
    updated_at: new Date().toISOString(),
  }),
});
if (!pres.ok) { console.error(`dossier update failed: ${await pres.text()}`); process.exit(1); }

await fetch(`${SUPABASE_URL}/rest/v1/witnesses?id=eq.${witnessId}`, {
  method: "PATCH",
  headers: h,
  body: JSON.stringify({ status: "attached", updated_at: new Date().toISOString() }),
});

console.log(`✓ reference attached to dossier ${w.dossier_id} (dossier set back to draft for candidate review)`);
console.log(`  relationship validated: ${extracted.relationship_validated}`);
console.log(`  confirmations: ${extracted.confirmations.length}`);
if (extracted.manager_one_liner) console.log(`  manager one-liner: ${extracted.manager_one_liner}`);
if (extracted.divergences?.length) {
  console.log(`  ⚠ DIVERGENCES (share with the CANDIDATE first, never publish directly):`);
  for (const d of extracted.divergences) console.log(`    - ${d}`);
}
console.log(`  Tier-3 upgrades on specific claims remain a human review call.`);
