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

// X18 Phase 1: candidate-provided evidence links from the post-interview
// evidence screen. Stored as events (kind evidence_claims / evidence_submitted,
// latest row wins); dev fallback reads the .data/evidence/ files.
async function latestEventData(kind) {
  const rows = await (
    await rest(
      `/events?kind=eq.${kind}&session_id=eq.${sessionId}&order=at.desc,id.desc&limit=1&select=data`
    )
  ).json();
  return rows.length ? rows[0].data : null;
}

let evidenceBlock = "";
try {
  const [claimsData, itemsData] = useSupabase
    ? await Promise.all([
        latestEventData("evidence_claims"),
        latestEventData("evidence_submitted"),
      ])
    : [
        existsSync(`.data/evidence/${sessionId}.claims.json`)
          ? JSON.parse(readFileSync(`.data/evidence/${sessionId}.claims.json`, "utf8"))
          : null,
        existsSync(`.data/evidence/${sessionId}.items.json`)
          ? JSON.parse(readFileSync(`.data/evidence/${sessionId}.items.json`, "utf8"))
          : null,
      ];
  const evClaims = claimsData?.claims ?? [];
  const evItems = itemsData?.items ?? [];
  if (evItems.length) {
    const lines = evItems.map((it) => {
      const claim = evClaims.find((c) => c.id === it.claim_id);
      return `- Claim: ${claim ? claim.claim : it.claim_id}\n  Link: ${it.url}${it.note ? `\n  Candidate note: ${it.note}` : ""}`;
    });
    evidenceBlock = `\n\nCandidate-provided evidence links (pasted by the candidate on the post-interview evidence screen to back specific claims):\n${lines.join("\n")}\n`;
    console.log(`Including ${evItems.length} candidate evidence link(s).`);
  }
} catch (err) {
  console.error("evidence lookup failed (continuing without):", err.message);
}

// X18 Phase 2: candidate-uploaded documents. Append-only evidence_upload
// events minus evidence_upload_removed tombstones; dev fallback reads
// .data/evidence/{id}.uploads.json. Each upload carries the four-field
// provenance form; all four answered = tier-2 eligible.
const provenanceComplete = (p) =>
  ["what", "author", "date", "origin"].every(
    (k) => typeof p?.[k] === "string" && p[k].trim().length >= 2
  );

let uploadsBlock = "";
try {
  let ups = [];
  if (useSupabase) {
    const [upRows, rmRows] = await Promise.all([
      (await rest(`/events?kind=eq.evidence_upload&session_id=eq.${sessionId}&order=at.asc,id.asc&select=data`)).json(),
      (await rest(`/events?kind=eq.evidence_upload_removed&session_id=eq.${sessionId}&select=data`)).json(),
    ]);
    const removed = new Set(rmRows.map((r) => r.data.artifact_id));
    ups = upRows.map((r) => r.data).filter((u) => !removed.has(u.artifact_id));
  } else if (existsSync(`.data/evidence/${sessionId}.uploads.json`)) {
    const stored = JSON.parse(readFileSync(`.data/evidence/${sessionId}.uploads.json`, "utf8"));
    ups = stored.uploads.filter((u) => !stored.removed.includes(u.artifact_id));
  }
  if (ups.length) {
    const claimsData = useSupabase
      ? await latestEventData("evidence_claims")
      : existsSync(`.data/evidence/${sessionId}.claims.json`)
      ? JSON.parse(readFileSync(`.data/evidence/${sessionId}.claims.json`, "utf8"))
      : null;
    const evClaims = claimsData?.claims ?? [];
    const lines = ups.map((u) => {
      const claim = evClaims.find((c) => c.id === u.claim_id);
      const p = u.provenance ?? {};
      return [
        `- Claim: ${claim ? claim.claim : u.claim_id}`,
        `  Uploaded file: ${u.file_name} (${u.mime})`,
        `  Artifact viewer URL: https://trueseat.io/a/${u.artifact_id}`,
        `  Storage path: ${u.storage_path}`,
        `  Provenance form (candidate-attested): what="${p.what ?? ""}"; author="${p.author ?? ""}"; date="${p.date ?? ""}"; origin/confirmer="${p.origin ?? ""}"`,
        `  Provenance form complete: ${provenanceComplete(p) ? "YES (tier 2 eligible)" : "NO (tier 1 only)"}`,
      ].join("\n");
    });
    uploadsBlock = `\n\nCandidate-uploaded evidence documents (uploaded on the post-interview evidence screen, stored privately, viewable at the artifact viewer URL):\n${lines.join("\n")}\n`;
    console.log(`Including ${ups.length} candidate-uploaded document(s).`);
  }
} catch (err) {
  console.error("uploads lookup failed (continuing without):", err.message);
}

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
- Every operating-profile dimension must be grounded in a specific story the candidate actually told: the profile text should carry the behavioral evidence in plain words ("under a hard deadline he ... , as in the launch story"). A dimension with no story behind it is OMITTED, never inferred from vibes, the resume, or one adjective of self-description.
- Constraints go in the constraints object; they are sealed by design, so record them faithfully.
- The manager_manual is written TO a future manager, warm and specific, derived from the stories.
- Set meta.candidate_reviewed to false: the candidate has not reviewed this draft yet.
- People the candidate offered as references in the witnesses phase become operating_profile.micro_references entries: id "w1","w2"..., status "invited", relationship stating role and overlap in the candidate's words PLUS the honest suffix " — named by the candidate, not yet interviewed", confirmations empty. Include first names only (no surnames, no contact details) — the full name stays in the transcript for the witness flow. Never invent confirmations; those are added only by the real witness interview.
- Candidate-provided evidence links, when present: create an artifacts[] entry per link (choose the closest type; provenance must say the link was candidate-provided on the evidence screen and describe what the URL is) and reference it from the matching claim's evidence[]. Tier rules: a linked claim is tier 1 by default; tier 2 ONLY if the URL itself is an independently checkable public source of origin/date/authorship (an official org page, press coverage, a public repository, a public filing) — judge from the URL, do not guess beyond it. You cannot browse: never describe link contents you haven't seen; provenance describes what the candidate says the link shows. Unlinked claims stay tier 0.
- Candidate-uploaded evidence documents, when present: create an artifacts[] entry per upload (type "document" unless another type clearly fits better; set url to the artifact viewer URL and storage_path to the given storage path) and reference it from the matching claim's evidence[]. The artifact's provenance field restates the candidate's provenance form answers, explicitly framed as candidate-attested. Tier rules: a claim backed by an uploaded document is tier 1; tier 2 when the provenance form is marked complete — origin, authorship, and date are on record with a named confirmable source, which makes it checkable. You cannot open files: never describe document contents; describe only what the candidate's form says it is. A document never earns tier 3 — that requires a witness.

Return ONLY the dossier JSON, no prose. It must validate against this JSON Schema:
${JSON.stringify(schema)}`,
  messages: [
    {
      role: "user",
      content:
        (session.resumeText
          ? `Candidate's uploaded resume (UNVERIFIED, candidate-provided; anything appearing ONLY here and never discussed in the interview stays tier 0 and should generally be omitted from headline_numbers):\n---\n${session.resumeText}\n---\n\n`
          : "") + `Interview transcript:\n\n${transcript}` + evidenceBlock + uploadsBlock,
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
