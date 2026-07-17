// Mint a witness micro-reference link for a dossier (candidate-requested only —
// consent is the product). Personalizes the 6-question script from the dossier
// per prompts/micro_reference_interview.md.
// Usage: node scripts/create-witness-link.mjs <dossierId> "<relationship>"
//   e.g. node scripts/create-witness-link.mjs abc-123 "former manager at Ribbon, 2016-2019"

import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env) && m[2]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const [dossierId, relationship] = process.argv.slice(2);

if (!dossierId || !relationship || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('usage: node scripts/create-witness-link.mjs <dossierId> "<relationship>"');
  process.exit(1);
}

const h = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

const dres = await fetch(
  `${SUPABASE_URL}/rest/v1/dossiers?id=eq.${dossierId}&select=content`,
  { headers: h }
);
const drows = await dres.json();
if (!drows.length) {
  console.error(`dossier ${dossierId} not found`);
  process.exit(1);
}
const d = drows[0].content;
const name = d.identity?.full_name ?? "the candidate";
const first = name.split(" ")[0];

// Claim spot-checks: the top two headline numbers.
const claims = (d.headline_numbers ?? []).slice(0, 2).map((n) => n.claim);
// Dimensions most in need of a witness: diverging alignment first, then thinnest-first.
const dims = (d.operating_profile?.dimensions ?? [])
  .slice()
  .sort((a, b) =>
    (a.alignment === "partially_consistent" ? -1 : 0) -
    (b.alignment === "partially_consistent" ? -1 : 0)
  )
  .slice(0, 2)
  .map((x) => x.dimension.replace(/_/g, " "));

const questions = [
  `How did you and ${first} work together, and for how long?`,
  ...claims.map(
    (c) => `${first} told us: "${c}". Were you close enough to that to say what you saw?`
  ),
  ...dims.map(
    (dim) => `Tell me about a time you watched ${first} handle ${dim} — what did they actually do?`
  ),
  `If a new manager asked you for one sentence on how to get the best work out of ${first}, what would it be?`,
  `Last one: anything you'd want a future employer to know about ${first} that I didn't ask?`,
];

const res = await fetch(`${SUPABASE_URL}/rest/v1/witnesses`, {
  method: "POST",
  headers: { ...h, Prefer: "return=representation" },
  body: JSON.stringify({
    dossier_id: dossierId,
    candidate_name: name,
    relationship,
    questions,
  }),
});
if (!res.ok) {
  console.error(`create failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const [row] = await res.json();
console.log(`✓ witness link minted for ${name} (${relationship})`);
console.log(`  ${questions.length} questions personalized from the dossier`);
console.log(`  URL: https://trueseat.io/witness/${row.token}`);
console.log(`  After completion: node scripts/attach-witness.mjs ${row.id}`);
