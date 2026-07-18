#!/usr/bin/env node
// X19: promote a real generated dossier to /d/sample (Customer Zero).
//
// The sample is a build-time import of samples/wade_dossier.json, so promotion
// is: fetch -> validate -> compare -> stage -> (after human review) apply,
// then commit + push to deploy.
//
// Usage:
//   node scripts/promote-to-sample.mjs <dossierId>          stage + report only
//   node scripts/promote-to-sample.mjs <dossierId> --apply  swap the staged file in
//
// Stage mode writes samples/wade_dossier.candidate.json and prints a review
// report: schema validation, tier distribution, what the current sample has
// that the candidate lacks (live artifact links, credentials, testimonials),
// and the X19 honesty flags to check by hand. NOTHING changes on /d/sample
// until --apply, a commit, and a push — all human-gated.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const dossierId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!dossierId) {
  console.error("usage: node scripts/promote-to-sample.mjs <dossierId> [--apply]");
  process.exit(1);
}

const SAMPLE = "samples/wade_dossier.json";
const CANDIDATE = "samples/wade_dossier.candidate.json";
const BACKUP = "samples/wade_dossier.pre_x19.json";

if (apply) {
  if (!existsSync(CANDIDATE)) {
    console.error(`no staged candidate at ${CANDIDATE} — run stage mode first`);
    process.exit(1);
  }
  const current = readFileSync(SAMPLE, "utf8");
  if (!existsSync(BACKUP)) writeFileSync(BACKUP, current);
  writeFileSync(SAMPLE, readFileSync(CANDIDATE, "utf8"));
  console.log(`✓ ${SAMPLE} replaced (previous version preserved at ${BACKUP})`);
  console.log("Next: review `git diff samples/`, then commit and push to deploy /d/sample.");
  process.exit(0);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("source .env.local first (needs Supabase env)");
  process.exit(1);
}

const res = await fetch(
  `${SUPABASE_URL}/rest/v1/dossiers?id=eq.${dossierId}&select=content,candidate_reviewed`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
);
const rows = await res.json();
if (!rows.length) {
  console.error(`dossier ${dossierId} not found`);
  process.exit(1);
}
const next = rows[0].content;
const current = JSON.parse(readFileSync(SAMPLE, "utf8"));

// Schema validation — the sample must always be a valid dossier.
const schema = JSON.parse(readFileSync("schema/dossier.schema.json", "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const valid = ajv.validate(schema, next);
console.log(`schema: ${valid ? "VALID" : "INVALID"}`);
if (!valid) {
  console.log(JSON.stringify(ajv.errors, null, 1));
  process.exit(1);
}

const tierCounts = {};
const walk = (o) => {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    if (typeof o.tier === "number") tierCounts[o.tier] = (tierCounts[o.tier] ?? 0) + 1;
    Object.values(o).forEach(walk);
  }
};
walk(next);

const urls = (d) =>
  new Set((d.artifacts ?? []).map((a) => a.url).filter(Boolean));
const curUrls = urls(current);
const nextUrls = urls(next);
const lostUrls = [...curUrls].filter((u) => !nextUrls.has(u));

console.log(`\ncandidate_reviewed: ${rows[0].candidate_reviewed}`);
console.log(`tier distribution: ${JSON.stringify(tierCounts)}`);
console.log(`dimensions: ${(next.operating_profile?.dimensions ?? []).length}`);
console.log(`artifacts: ${(next.artifacts ?? []).length} (current sample has ${(current.artifacts ?? []).length})`);

if (lostUrls.length) {
  console.log(`\n⚠ LIVE LINKS IN CURRENT SAMPLE MISSING FROM CANDIDATE (decide keep or drop):`);
  lostUrls.forEach((u) => console.log(`  - ${u}`));
}
for (const key of ["credentials", "testimonials"]) {
  const curN = (current[key] ?? []).length;
  const nextN = (next[key] ?? []).length;
  if (curN && !nextN) {
    console.log(`⚠ current sample has ${curN} ${key}, candidate has none — carry over by hand if still true`);
  }
}
if (!next.identity?.links?.length && current.identity?.links?.length) {
  console.log(`⚠ candidate has no identity.links; current sample has ${current.identity.links.length} — carry over the public ones`);
}

console.log(`\nX19 HONESTY FLAGS — check each by hand before --apply:`);
console.log(`  1. AITW "weekly on-camera" claim: only keep if Ep1 has actually published.`);
console.log(`  2. Credential dates: interview-confirmed or omitted, never inferred.`);
console.log(`  3. Manager manual + operating profile: must come from THIS interview's stories, not Claude's earlier draft of Wade.`);
console.log(`  4. Banner stays honest: "confirmed verbatim in interview" is now true only for what this interview actually covered.`);

writeFileSync(CANDIDATE, JSON.stringify(next, null, 2) + "\n");
console.log(`\n✓ staged at ${CANDIDATE} — review/edit it, then rerun with --apply`);
