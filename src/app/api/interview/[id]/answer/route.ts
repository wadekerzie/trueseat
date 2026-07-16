import { NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/store";
import { ingestAudio } from "@/lib/ears";
import { nextQuestion } from "@/lib/interviewer";
import type { IngestResult, Turn } from "@/lib/types";

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
  if (!body || (!body.text && !(body.audioBase64 && body.mimeType))) {
    return NextResponse.json(
      { error: "provide text, or audioBase64 + mimeType" },
      { status: 400 }
    );
  }

  let answer: string;
  let ingest: IngestResult | undefined;
  let mode: Turn["mode"];
  if (body.audioBase64) {
    ingest = await ingestAudio(body.audioBase64, body.mimeType);
    answer = ingest.transcript;
    mode = "voice";
  } else {
    answer = String(body.text).slice(0, 20000);
    mode = "text";
  }

  session.turns.push({
    phase: session.phase,
    question: session.currentQuestion,
    answer,
    mode,
    ingest,
    at: new Date().toISOString(),
  });

  const next = await nextQuestion(session);
  session.phase = next.phase;
  session.currentQuestion = next.question;
  await saveSession(session);

  return NextResponse.json({
    transcript: answer,
    question: next.question,
    phase: next.phase,
    done: next.done,
  });
}
