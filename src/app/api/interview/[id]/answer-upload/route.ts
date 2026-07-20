// X22: mint a signed direct-to-storage upload URL for a voice answer, so long
// recordings bypass Vercel's request-body cap entirely.

import { NextResponse } from "next/server";
import { getSession } from "@/lib/store";
import { createAnswerUpload, answerExtension } from "@/lib/answers";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }
  if (session.phase === "done") {
    return NextResponse.json({ error: "interview already complete" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType : "";
  if (!answerExtension(mimeType)) {
    return NextResponse.json({ error: "unsupported audio type" }, { status: 415 });
  }

  const upload = await createAnswerUpload(id, mimeType);
  if (!upload) {
    // Local dev without Supabase env: client falls back to inline base64.
    return NextResponse.json({ error: "storage unavailable" }, { status: 503 });
  }
  return NextResponse.json(upload);
}
