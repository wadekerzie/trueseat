import { NextResponse } from "next/server";
import { getSession, saveSession } from "@/lib/store";
import { ingestAudio } from "@/lib/ears";
import { nextQuestion } from "@/lib/interviewer";
import { readAnswerAudioBase64 } from "@/lib/answers";
import type { IngestResult, Turn } from "@/lib/types";

// X22: long answers transcribe for a while (Gemini on a 30-60 min recording).
// Default function timeout would cut them off mid-ingest.
export const maxDuration = 300;

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
  if (
    !body ||
    (!body.text &&
      !(body.audioBase64 && body.mimeType) &&
      !(body.audioPath && body.mimeType))
  ) {
    return NextResponse.json(
      { error: "provide text, audioPath + mimeType, or audioBase64 + mimeType" },
      { status: 400 }
    );
  }

  let answer: string;
  let ingest: IngestResult | undefined;
  let mode: Turn["mode"];
  if (body.audioPath) {
    // X22 path: the browser uploaded the recording straight to storage.
    const audioBase64 = await readAnswerAudioBase64(id, String(body.audioPath));
    if (!audioBase64) {
      return NextResponse.json(
        { error: "recording not found in storage" },
        { status: 404 }
      );
    }
    ingest = await ingestAudio(audioBase64, body.mimeType);
    answer = ingest.transcript;
    mode = "voice";
  } else if (body.audioBase64) {
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
