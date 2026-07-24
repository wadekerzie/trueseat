// X25: auto-generation endpoint. The end screen POSTs here the moment the
// interview truly finishes, generation runs server-side, and GET is the
// status poll that hands the candidate their draft link in-page.
//
// Idempotent by construction: an existing dossier is always returned as-is,
// and a fresh "dossier_generating" marker event parks concurrent triggers.
// A marker older than STALE_MS with no dossier row means a previous attempt
// died (timeout, crash); the next POST simply runs again.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { insertEvent, latestEvent } from "@/lib/evidence";
import {
  findDossierBySession,
  generateDossierForSession,
} from "@/lib/generateDossier";
import {
  dossierUrl,
  emailCandidateDraftLink,
  emailFounderDossierReady,
} from "@/lib/notify";

export const maxDuration = 300;

const STALE_MS = 7 * 60 * 1000;

async function generationInFlight(sessionId: string): Promise<boolean> {
  const marker = await latestEvent<{ started_at: string }>(
    "dossier_generating",
    sessionId
  );
  if (!marker?.started_at) return false;
  const age = Date.now() - new Date(marker.started_at).getTime();
  return age >= 0 && age < STALE_MS;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const existing = await findDossierBySession(id);
  if (existing) {
    return NextResponse.json({ ready: true, url: dossierUrl(existing.id) });
  }
  return NextResponse.json({
    ready: false,
    generating: await generationInFlight(id),
  });
}

export async function POST(
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

  const existing = await findDossierBySession(id);
  if (existing) {
    return NextResponse.json({ ready: true, url: dossierUrl(existing.id) });
  }
  if (await generationInFlight(id)) {
    return NextResponse.json({ ready: false, generating: true }, { status: 202 });
  }

  await insertEvent("dossier_generating", id, {
    started_at: new Date().toISOString(),
  });

  try {
    const row = await generateDossierForSession(session);

    const contact = await latestEvent<{ email: string }>("candidate_contact", id);
    let candidateEmailed = false;
    if (contact?.email) {
      candidateEmailed = await emailCandidateDraftLink(
        contact.email,
        session.candidateName,
        row.id
      );
    }
    await emailFounderDossierReady(id, session.candidateName, row.id, candidateEmailed);
    await insertEvent("dossier_ready", id, {
      dossier_id: row.id,
      candidate_emailed: candidateEmailed,
    });

    return NextResponse.json({ ready: true, url: dossierUrl(row.id) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`dossier generation failed for ${id}:`, message);
    await insertEvent("dossier_generation_failed", id, {
      error: message.slice(0, 500),
    }).catch(() => {});
    return NextResponse.json({ error: "generation failed" }, { status: 500 });
  }
}
