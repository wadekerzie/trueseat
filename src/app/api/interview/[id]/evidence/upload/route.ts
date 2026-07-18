// X18 Phase 2: document uploads on the evidence screen.
// POST   -> multipart form: file + claim_id + the four provenance fields.
//           Stores the file in the private "evidence" bucket and appends an
//           evidence_upload event. Complete provenance is what earns tier 2.
// DELETE -> { artifact_id } tombstones the upload and deletes the object.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import {
  getOrCreateClaims,
  loadUploads,
  saveUpload,
  removeUpload,
  storeUploadFile,
  provenanceComplete,
  UPLOAD_TYPES,
  MAX_UPLOAD_BYTES,
} from "@/lib/evidence";
import type { EvidenceUpload } from "@/lib/types";

const MAX_UPLOADS_PER_SESSION = 16;

function field(form: FormData, name: string, max: number): string {
  const v = form.get(name);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
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

  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "provide a file" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file too large — ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB max` },
      { status: 413 }
    );
  }
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const mime = UPLOAD_TYPES[ext];
  if (!mime) {
    return NextResponse.json(
      { error: `unsupported file type .${ext} — use ${Object.keys(UPLOAD_TYPES).join(", ")}` },
      { status: 415 }
    );
  }

  const claimId = field(form, "claim_id", 20);
  const claims = await getOrCreateClaims(session);
  if (!claims.some((c) => c.id === claimId)) {
    return NextResponse.json({ error: "unknown claim_id" }, { status: 400 });
  }

  const existing = await loadUploads(session.id);
  if (existing.length >= MAX_UPLOADS_PER_SESSION) {
    return NextResponse.json({ error: "upload limit reached" }, { status: 429 });
  }

  const artifactId = crypto.randomUUID();
  const safeName =
    file.name
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || `upload.${ext}`;

  const upload: EvidenceUpload = {
    artifact_id: artifactId,
    session_id: session.id,
    claim_id: claimId,
    file_name: safeName,
    mime,
    size: file.size,
    storage_path: `${session.id}/${artifactId}/${safeName}`,
    provenance: {
      what: field(form, "what", 300),
      author: field(form, "author", 200),
      date: field(form, "date", 100),
      origin: field(form, "origin", 300),
    },
    at: new Date().toISOString(),
  };

  await storeUploadFile(upload.storage_path, mime, new Uint8Array(await file.arrayBuffer()));
  await saveUpload(upload);

  return NextResponse.json({
    ok: true,
    upload: {
      artifact_id: upload.artifact_id,
      claim_id: upload.claim_id,
      file_name: upload.file_name,
      size: upload.size,
      provenance_complete: provenanceComplete(upload.provenance),
    },
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const artifactId = body?.artifact_id;
  if (typeof artifactId !== "string" || !artifactId) {
    return NextResponse.json({ error: "provide artifact_id" }, { status: 400 });
  }
  const removed = await removeUpload(session.id, artifactId);
  if (!removed) {
    return NextResponse.json({ error: "upload not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
