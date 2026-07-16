// Generate a dossier from a completed interview session.
// Usage: node scripts/generate-dossier.mjs <sessionId>
//
// Env is loaded from .env.local automatically (ANTHROPIC_API_KEY required).
// With Supabase env present: reads the session from Supabase and writes the
// dossier row there (the /d/<dossierId> URL is printed). Without it, falls
// back to local .data/ JSON files.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// Minimal .env.local loader (no dependency): KEY=VALUE lines, no quotes.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env) && m[2]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: node scripts/generate-dossier.mjs <sessionId>");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required (the brain does the extraction).");
  process.exit(1);
}

async function rest(pathname, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${pathname}: ${res.status} ${await res.text()}`);
  return res;
}

const schema = JSON.parse(readFileSync("schema/dossier.schema.json", "utf8"));

let session;
if (useSupabase) {
  const rows = await (await rest(`/interview_sessions?id=eq.${sessionId}&select=*&limit=1`)).json();
  if (!rows.length) {
    console.error(`session ${sessionId} not found in Supabase`);
    process.exit(1);
  }
  const r = rows[0];
  session = {
    id: r.id,
    candidateName: r.candidate_name ?? undefined,
    phase: r.phase,
    turns: r.turns ?? [],
    resumeText: r.resume_text ?? undefined,
  };
} else {
  session = JSON.parse(readFileSync(`.data/sessions/${sessionId}.json`, "utf8"));
}

if (!session.turns.length) {
  console.error("session has no turns; nothing to extract");
  process.exit(1);
}

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
// Streaming is required by the SDK for requests that may run >10 minutes.
const response = await anthropic.messages.stream({
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
  messages: [
    {
      role: "user",
      content:
        (session.resumeText
          ? `Candidate's uploaded resume (UNVERIFIED, candidate-provided; anything appearing ONLY here and never discussed in the interview stays tier 0 and should generally be omitted from headline_numbers):\n---\n${session.resumeText}\n---\n\n`
          : "") + `Interview transcript:\n\n${transcript}`,
    },
  ],
}).finalMessage();

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
  mkdirSync(".data/dossiers", { recursive: true });
  writeFileSync(`.data/dossiers/${sessionId}.invalid.json`, JSON.stringify(dossier, null, 2));
  process.exit(1);
}

if (useSupabase) {
  const res = await rest(`/dossiers`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      session_id: session.id,
      content: dossier,
      candidate_reviewed: false,
    }),
  });
  const [row] = await res.json();
  console.log(`✓ dossier ${row.id} written to Supabase (session ${session.id})`);
  console.log(`  URL: https://trueseat.io/d/${row.id}`);
} else {
  mkdirSync(".data/dossiers", { recursive: true });
  writeFileSync(`.data/dossiers/${sessionId}.json`, JSON.stringify(dossier, null, 2));
  console.log(`✓ dossier written to .data/dossiers/${sessionId}.json`);
}
console.log("Next: candidate review pass — nothing ships unreviewed.");
