// X18 Phase 1: post-interview evidence capture.
//
// When an interview completes, an extraction pass lists the evidenceable
// claims; the candidate backs any of them with a pasted link. Both halves
// persist as append-only rows in the existing `events` table (kind:
// "evidence_claims" / "evidence_submitted", latest row wins), so no schema
// change was needed. Server-side only: uses the secret key like store.ts.
// Dev fallback without Supabase env: JSON files under .data/evidence/.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { EvidenceClaim, EvidenceItem, InterviewSession } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

const DATA_DIR = path.join(process.cwd(), ".data", "evidence");

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

async function latestEvent<T>(kind: string, sessionId: string): Promise<T | null> {
  const res = await rest(
    `/events?kind=eq.${kind}&session_id=eq.${sessionId}&order=at.desc,id.desc&limit=1&select=data`
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as { data: T }[];
  return rows.length ? rows[0].data : null;
}

async function insertEvent(kind: string, sessionId: string, data: unknown): Promise<void> {
  const res = await rest(`/events`, {
    method: "POST",
    body: JSON.stringify({ kind, session_id: sessionId, data }),
  });
  if (!res.ok) {
    throw new Error(`event insert failed: ${res.status} ${await res.text()}`);
  }
}

async function fileRead<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, name), "utf8")) as T;
  } catch {
    return null;
  }
}

async function fileWrite(name: string, data: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

// The claims pass. Reads the finished transcript and lists the concrete,
// evidenceable claims worth backing with a link. Same extraction discipline
// as generate-dossier: only what the transcript supports, never invented.
async function extractClaims(session: InterviewSession): Promise<EvidenceClaim[]> {
  const transcript = session.turns
    .map((t) => `[${t.phase}] Q: ${t.question}\nA: ${t.answer}`)
    .join("\n\n");

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 2000,
    system: `You are TrueSeat's evidence-flagging pass. From a completed interview transcript, list the claims a link on the public internet could plausibly back.

Rules:
- Only claims the candidate actually made in the transcript. Never invent, merge, or embellish.
- Pick claims where evidence could exist: quantified outcomes, shipped products, public roles, press, publications, credentials, live sites, repositories. Skip private war stories nothing public could show.
- 3 to 8 claims, most significant first. Fewer is fine; padding is not.
- "claim" is the candidate's claim restated in one tight sentence. "hint" says what kind of link would back it (e.g. "a live product URL", "a press mention or award page", "the company's public team page").

Respond with ONLY a JSON array: [{"id": "c1", "claim": string, "hint": string}, ...]. Empty array if nothing qualifies.`,
    messages: [{ role: "user", content: `Interview transcript:\n\n${transcript}` }],
  });

  const text = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  const parsed = JSON.parse(text.slice(start, end + 1)) as EvidenceClaim[];
  return parsed
    .filter((c) => c && typeof c.claim === "string" && c.claim.trim())
    .slice(0, 8)
    .map((c, i) => ({
      id: `c${i + 1}`,
      claim: c.claim.trim().slice(0, 300),
      hint: typeof c.hint === "string" ? c.hint.trim().slice(0, 200) : "",
    }));
}

// Returns the claim list for a finished session, generating and persisting it
// on first call. Subsequent calls are reads.
export async function getOrCreateClaims(session: InterviewSession): Promise<EvidenceClaim[]> {
  const stored = useSupabase
    ? await latestEvent<{ claims: EvidenceClaim[] }>("evidence_claims", session.id)
    : await fileRead<{ claims: EvidenceClaim[] }>(`${session.id}.claims.json`);
  if (stored) return stored.claims ?? [];

  const claims = await extractClaims(session);
  if (useSupabase) await insertEvent("evidence_claims", session.id, { claims });
  else await fileWrite(`${session.id}.claims.json`, { claims });
  return claims;
}

export async function loadEvidence(sessionId: string): Promise<EvidenceItem[] | null> {
  const stored = useSupabase
    ? await latestEvent<{ items: EvidenceItem[] }>("evidence_submitted", sessionId)
    : await fileRead<{ items: EvidenceItem[] }>(`${sessionId}.items.json`);
  return stored ? stored.items ?? [] : null;
}

export async function saveEvidence(sessionId: string, items: EvidenceItem[]): Promise<void> {
  if (useSupabase) await insertEvent("evidence_submitted", sessionId, { items });
  else await fileWrite(`${sessionId}.items.json`, { items });
}
