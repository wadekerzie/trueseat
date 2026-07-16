import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { saveSession } from "@/lib/store";
import { firstQuestion } from "@/lib/interviewer";
import type { InterviewSession } from "@/lib/types";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const resumeText =
    typeof body.resumeText === "string" && body.resumeText.length >= 100
      ? body.resumeText.slice(0, 15000)
      : undefined;
  const { question, phase } = firstQuestion(Boolean(resumeText));
  const now = new Date().toISOString();
  const session: InterviewSession = {
    id: randomUUID(),
    candidateName: typeof body.name === "string" ? body.name.slice(0, 120) : undefined,
    phase,
    currentQuestion: question,
    turns: [],
    resumeText,
    createdAt: now,
    updatedAt: now,
  };
  await saveSession(session);
  return NextResponse.json({ sessionId: session.id, question, phase });
}
