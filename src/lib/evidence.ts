// X18 Phase 1: post-interview evidence capture.
//
// When an interview completes, an extraction pass lists the evidenceable
// claims; the candidate backs any of them with a pasted link. Both halves
// persist as append-only rows in the existing `events` table (kind:
// "evidence_claims" / "evidence_submitted", latest row wins), so no schema
// change was needed. Server-side only: uses the secret key like store.ts.
// Dev fallback without Supabase env: JSON files under .data/evidence/.

import { mkdir, readFile, writeFile, unlink, readdir } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type {
  EvidenceClaim,
  EvidenceItem,
  EvidenceUpload,
  InterviewSession,
} from "./types";

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

// ---------------------------------------------------------------------------
// X18 Phase 2: document uploads. Files live in the private "evidence" bucket
// at {sessionId}/{artifactId}/{fileName}; each upload is one append-only
// event row (kind "evidence_upload"), removal is a tombstone row (kind
// "evidence_upload_removed"). Dev fallback: .data/evidence/files/.

export const EVIDENCE_BUCKET = "evidence";
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies ~4.5MB

// Allowlist by extension; the served content-type comes from here, never from
// the client, so an uploaded file can't smuggle an executable mime.
export const UPLOAD_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/plain",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const FILES_DIR = path.join(DATA_DIR, "files");

function storageUrl(objectPath: string): string {
  return `${SUPABASE_URL}/storage/v1/object/${EVIDENCE_BUCKET}/${objectPath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function storageHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

// Idempotent: creates the private bucket on first use, tolerates "already
// exists" forever after. Cached per lambda instance.
let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured || !useSupabase) return;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: storageHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      id: EVIDENCE_BUCKET,
      name: EVIDENCE_BUCKET,
      public: false,
      file_size_limit: MAX_UPLOAD_BYTES,
    }),
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    // Supabase reports an existing bucket as 400 "already exists", not 409.
    if (!text.includes("already exists")) {
      throw new Error(`bucket create failed: ${res.status} ${text}`);
    }
  }
  bucketEnsured = true;
}

export async function storeUploadFile(
  storagePath: string,
  mime: string,
  bytes: Uint8Array
): Promise<void> {
  if (useSupabase) {
    await ensureBucket();
    const res = await fetch(storageUrl(storagePath), {
      method: "POST",
      headers: storageHeaders({ "Content-Type": mime, "x-upsert": "true" }),
      body: new Blob([bytes as BlobPart]),
    });
    if (!res.ok) {
      throw new Error(`storage upload failed: ${res.status} ${await res.text()}`);
    }
  } else {
    const dest = path.join(FILES_DIR, storagePath);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, bytes);
  }
}

export async function readUploadFile(storagePath: string): Promise<Uint8Array | null> {
  if (useSupabase) {
    const res = await fetch(storageUrl(storagePath), { headers: storageHeaders() });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }
  try {
    return new Uint8Array(await readFile(path.join(FILES_DIR, storagePath)));
  } catch {
    return null;
  }
}

async function deleteUploadFile(storagePath: string): Promise<void> {
  if (useSupabase) {
    await fetch(storageUrl(storagePath), { method: "DELETE", headers: storageHeaders() });
  } else {
    await unlink(path.join(FILES_DIR, storagePath)).catch(() => {});
  }
}

async function uploadEvents(sessionId: string): Promise<{ uploads: EvidenceUpload[]; removed: Set<string> }> {
  if (useSupabase) {
    const [upRes, rmRes] = await Promise.all([
      rest(`/events?kind=eq.evidence_upload&session_id=eq.${sessionId}&order=at.asc,id.asc&select=data`),
      rest(`/events?kind=eq.evidence_upload_removed&session_id=eq.${sessionId}&select=data`),
    ]);
    const uploads = upRes.ok
      ? ((await upRes.json()) as { data: EvidenceUpload }[]).map((r) => r.data)
      : [];
    const removed = new Set(
      rmRes.ok
        ? ((await rmRes.json()) as { data: { artifact_id: string } }[]).map(
            (r) => r.data.artifact_id
          )
        : []
    );
    return { uploads, removed };
  }
  const stored =
    (await fileRead<{ uploads: EvidenceUpload[]; removed: string[] }>(
      `${sessionId}.uploads.json`
    )) ?? { uploads: [], removed: [] };
  return { uploads: stored.uploads, removed: new Set(stored.removed) };
}

// The live (non-removed) uploads for a session, oldest first.
export async function loadUploads(sessionId: string): Promise<EvidenceUpload[]> {
  const { uploads, removed } = await uploadEvents(sessionId);
  return uploads.filter((u) => !removed.has(u.artifact_id));
}

export async function saveUpload(upload: EvidenceUpload): Promise<void> {
  if (useSupabase) {
    await insertEvent("evidence_upload", upload.session_id, upload);
  } else {
    const stored =
      (await fileRead<{ uploads: EvidenceUpload[]; removed: string[] }>(
        `${upload.session_id}.uploads.json`
      )) ?? { uploads: [], removed: [] };
    stored.uploads.push(upload);
    await fileWrite(`${upload.session_id}.uploads.json`, stored);
  }
}

// Tombstone the event row and delete the stored object.
export async function removeUpload(sessionId: string, artifactId: string): Promise<boolean> {
  const uploads = await loadUploads(sessionId);
  const target = uploads.find((u) => u.artifact_id === artifactId);
  if (!target) return false;
  if (useSupabase) {
    await insertEvent("evidence_upload_removed", sessionId, { artifact_id: artifactId });
  } else {
    const stored =
      (await fileRead<{ uploads: EvidenceUpload[]; removed: string[] }>(
        `${sessionId}.uploads.json`
      )) ?? { uploads: [], removed: [] };
    stored.removed.push(artifactId);
    await fileWrite(`${sessionId}.uploads.json`, stored);
  }
  await deleteUploadFile(target.storage_path);
  return true;
}

// Cross-session lookup for the /a/[artifactId] viewer. Artifact ids are
// unguessable UUIDs — same access posture as /d/[id] share links.
export async function findUpload(artifactId: string): Promise<EvidenceUpload | null> {
  if (useSupabase) {
    const [upRes, rmRes] = await Promise.all([
      rest(
        `/events?kind=eq.evidence_upload&data->>artifact_id=eq.${artifactId}&order=at.desc,id.desc&limit=1&select=data`
      ),
      rest(
        `/events?kind=eq.evidence_upload_removed&data->>artifact_id=eq.${artifactId}&limit=1&select=data`
      ),
    ]);
    if (!upRes.ok) return null;
    const rows = (await upRes.json()) as { data: EvidenceUpload }[];
    if (!rows.length) return null;
    const removed = rmRes.ok && ((await rmRes.json()) as unknown[]).length > 0;
    return removed ? null : rows[0].data;
  }
  try {
    const names = await readdir(DATA_DIR);
    for (const name of names) {
      if (!name.endsWith(".uploads.json")) continue;
      const stored = await fileRead<{ uploads: EvidenceUpload[]; removed: string[] }>(name);
      const hit = stored?.uploads.find((u) => u.artifact_id === artifactId);
      if (hit && !stored!.removed.includes(artifactId)) return hit;
    }
  } catch {
    // no data dir yet
  }
  return null;
}

// A provenance form counts as complete — tier-2 eligible — when every field
// is answered with something substantive, not one-character noise.
export function provenanceComplete(p: EvidenceUpload["provenance"]): boolean {
  return [p.what, p.author, p.date, p.origin].every(
    (v) => typeof v === "string" && v.trim().length >= 2
  );
}
