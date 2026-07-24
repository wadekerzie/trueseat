// X25: optional candidate email capture on the end screen, so the draft link
// can be delivered even if they close the tab. Stored as an append-only
// candidate_contact event (latest wins, same pattern as evidence). If the
// dossier already exists when the email arrives, send the link immediately.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { insertEvent } from "@/lib/evidence";
import { findDossierBySession } from "@/lib/generateDossier";
import { emailCandidateDraftLink, emailConfigured } from "@/lib/notify";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
  const email =
    typeof body?.email === "string" ? body.email.trim().slice(0, 254) : "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "provide a valid email" }, { status: 400 });
  }

  await insertEvent("candidate_contact", id, { email });

  let emailed = false;
  if (emailConfigured()) {
    const existing = await findDossierBySession(id);
    if (existing) {
      emailed = await emailCandidateDraftLink(
        email,
        session.candidateName,
        existing.id
      );
    }
  }

  return NextResponse.json({ ok: true, emailed });
}
