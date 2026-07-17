import { NextResponse } from "next/server";
import { getWitnessByToken, saveWitness } from "@/lib/witness";
import { ingestAudio } from "@/lib/ears";
import type { IngestResult, Turn } from "@/lib/types";

// Witness answers walk a fixed personalized script (minted with the token).
// No adaptive follow-ups in v1: five minutes, no surprises, per the design doc.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const w = await getWitnessByToken(token);
  if (!w) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (w.status === "completed" || w.status === "attached" || w.turns.length >= w.questions.length) {
    return NextResponse.json({ error: "reference already complete" }, { status: 409 });
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

  w.turns.push({
    phase: "witnesses",
    question: w.questions[w.turns.length],
    answer,
    mode,
    ingest,
    at: new Date().toISOString(),
  });

  const done = w.turns.length >= w.questions.length;
  w.status = done ? "completed" : "in_progress";
  await saveWitness(w);

  return NextResponse.json({
    transcript: answer,
    question: done ? "" : w.questions[w.turns.length],
    questionNumber: w.turns.length + 1,
    totalQuestions: w.questions.length,
    done,
  });
}
