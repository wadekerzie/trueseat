// Mark a dossier candidate-reviewed after the candidate has approved every word.
// Founding-cohort concierge path: the candidate reviews their draft URL with us,
// then we flip the flag. Usage: node scripts/approve-dossier.mjs <dossierId> [--revoke]
//
// Env from .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).

import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env) && m[2]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const id = process.argv[2];
const revoke = process.argv.includes("--revoke");

if (!id || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error("usage: node scripts/approve-dossier.mjs <dossierId> [--revoke]");
  process.exit(1);
}

const res = await fetch(`${SUPABASE_URL}/rest/v1/dossiers?id=eq.${id}`, {
  method: "PATCH",
  headers: {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  body: JSON.stringify({
    candidate_reviewed: !revoke,
    updated_at: new Date().toISOString(),
  }),
});
if (!res.ok) {
  console.error(`update failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();
if (!rows.length) {
  console.error(`dossier ${id} not found`);
  process.exit(1);
}
console.log(
  revoke
    ? `✓ dossier ${id} set back to draft (banner returns)`
    : `✓ dossier ${id} approved — draft banner removed at https://trueseat.io/d/${id}`
);
