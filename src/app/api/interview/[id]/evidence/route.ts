// X18 Phase 1: the post-interview evidence screen's API.
// GET  -> the flagged claims for a finished session (generated on first call)
//         plus any prior submission, so the client can resume.
// POST -> save the candidate's pasted links. An empty items array is a valid
//         "no links" submission; it marks the evidence step finished.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { getOrCreateClaims, loadEvidence, saveEvidence } from "@/lib/evidence";
import type { EvidenceItem } from "@/lib/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (session.phase !== "done") {
    return NextResponse.json({ error: "interview not finished" }, { status: 409 });
  }
  const [claims, items] = await Promise.all([
    getOrCreateClaims(session),
    loadEvidence(session.id),
  ]);
  return NextResponse.json({ claims, items, submitted: items !== null });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (session.phase !== "done") {
    return NextResponse.json({ error: "interview not finished" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "provide items: []" }, { status: 400 });
  }

  const claims = await getOrCreateClaims(session);
  const validIds = new Set(claims.map((c) => c.id));
  const items: EvidenceItem[] = [];
  for (const raw of body.items.slice(0, 16)) {
    if (!raw || typeof raw.claim_id !== "string" || typeof raw.url !== "string") continue;
    if (!validIds.has(raw.claim_id)) continue;
    let url: URL;
    try {
      url = new URL(raw.url.trim());
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    items.push({
      claim_id: raw.claim_id,
      url: url.toString().slice(0, 500),
      ...(typeof raw.note === "string" && raw.note.trim()
        ? { note: raw.note.trim().slice(0, 300) }
        : {}),
    });
  }

  await saveEvidence(session.id, items);
  return NextResponse.json({ ok: true, saved: items.length });
}
