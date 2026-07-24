// X25: server-side dossier generation, ported from scripts/generate-dossier.mjs
// so the pipeline no longer depends on someone running the script by hand.
// Supabase-only (routes always run with env); the script keeps the .data/
// file fallback for local no-env work.

import Anthropic from "@anthropic-ai/sdk";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../schema/dossier.schema.json";
import type { InterviewSession } from "./types";
import type { DossierData } from "@/components/DossierView";
import type { DossierRow } from "./dossiers";
import {
  latestEvent,
  loadEvidence,
  loadUploads,
  provenanceComplete,
} from "./evidence";
import type { EvidenceClaim } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function rest(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

export async function findDossierBySession(
  sessionId: string
): Promise<{ id: string } | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await rest(
    `/dossiers?session_id=eq.${sessionId}&select=id&order=created_at.desc&limit=1`
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as { id: string }[];
  return rows.length ? rows[0] : null;
}

const SYSTEM = `You are the extraction pass of TrueSeat. Build a candidate dossier from the interview transcript.

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
${JSON.stringify(schema)}`;

async function buildEvidenceBlocks(sessionId: string): Promise<string> {
  const claimsData = await latestEvent<{ claims: EvidenceClaim[] }>(
    "evidence_claims",
    sessionId
  );
  const evClaims = claimsData?.claims ?? [];
  const claimText = (id: string) =>
    evClaims.find((c) => c.id === id)?.claim ?? id;

  let out = "";

  const items = (await loadEvidence(sessionId)) ?? [];
  if (items.length) {
    const lines = items.map(
      (it) =>
        `- Claim: ${claimText(it.claim_id)}\n  Link: ${it.url}${
          it.note ? `\n  Candidate note: ${it.note}` : ""
        }`
    );
    out += `\n\nCandidate-provided evidence links (pasted by the candidate on the post-interview evidence screen to back specific claims):\n${lines.join("\n")}\n`;
  }

  const ups = await loadUploads(sessionId);
  if (ups.length) {
    const lines = ups.map((u) => {
      const p = u.provenance ?? { what: "", author: "", date: "", origin: "" };
      return [
        `- Claim: ${claimText(u.claim_id)}`,
        `  Uploaded file: ${u.file_name} (${u.mime})`,
        `  Artifact viewer URL: https://trueseat.io/a/${u.artifact_id}`,
        `  Storage path: ${u.storage_path}`,
        `  Provenance form (candidate-attested): what="${p.what ?? ""}"; author="${p.author ?? ""}"; date="${p.date ?? ""}"; origin/confirmer="${p.origin ?? ""}"`,
        `  Provenance form complete: ${provenanceComplete(p) ? "YES (tier 2 eligible)" : "NO (tier 1 only)"}`,
      ].join("\n");
    });
    out += `\n\nCandidate-uploaded evidence documents (uploaded on the post-interview evidence screen, stored privately, viewable at the artifact viewer URL):\n${lines.join("\n")}\n`;
  }

  return out;
}

// Runs the full extraction and writes the dossier row. Throws on any failure;
// the caller owns marker events and retries. Returns the new row.
export async function generateDossierForSession(
  session: InterviewSession
): Promise<DossierRow> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase env required for server-side generation");
  }
  if (!session.turns.length) {
    throw new Error("session has no turns; nothing to extract");
  }

  const transcript = session.turns
    .map((t) => {
      const signals = t.ingest?.signals?.length
        ? `\n[ingest signals: ${t.ingest.signals.join("; ")}]`
        : "";
      return `[phase: ${t.phase}]\nInterviewer: ${t.question}\nCandidate (${t.mode}): ${t.answer}${signals}`;
    })
    .join("\n\n");

  const evidenceBlocks = await buildEvidenceBlocks(session.id);

  const anthropic = new Anthropic();
  const response = await anthropic.messages
    .stream({
      model: "claude-opus-4-8",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content:
            (session.resumeText
              ? `Candidate's uploaded resume (UNVERIFIED, candidate-provided; anything appearing ONLY here and never discussed in the interview stays tier 0 and should generally be omitted from headline_numbers):\n---\n${session.resumeText}\n---\n\n`
              : "") +
            `Interview transcript:\n\n${transcript}` +
            evidenceBlocks,
        },
      ],
    })
    .finalMessage();

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  const dossier = JSON.parse(
    text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
  ) as DossierData & { meta?: Record<string, unknown> };

  // The model has no clock; stamp real timestamps rather than letting it guess.
  const now = new Date().toISOString();
  if (dossier.meta && typeof dossier.meta === "object") {
    dossier.meta.created_at = now;
    dossier.meta.updated_at = now;
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(dossier)) {
    const details = (validate.errors ?? [])
      .map((e) => `${e.instancePath} ${e.message}`)
      .join("; ");
    throw new Error(`extraction produced invalid dossier: ${details}`);
  }

  const res = await rest(`/dossiers`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      session_id: session.id,
      content: dossier,
      candidate_reviewed: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`dossier insert failed: ${res.status} ${await res.text()}`);
  }
  const [row] = (await res.json()) as DossierRow[];
  return row;
}
