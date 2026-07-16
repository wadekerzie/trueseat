import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { saveSession } from "@/lib/store";
import { firstQuestion } from "@/lib/interviewer";
import type { InterviewSession } from "@/lib/types";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { question, phase } = firstQuestion();
  const now = new Date().toISOString();
  const session: InterviewSession = {
    id: randomUUID(),
    candidateName: typeof body.name === "string" ? body.name.slice(0, 120) : undefined,
    phase,
    currentQuestion: question,
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
  await saveSession(session);
  return NextResponse.json({ sessionId: session.id, question, phase });
}
