import { NextResponse } from "next/server";
import { getWitnessByToken } from "@/lib/witness";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const w = await getWitnessByToken(token);
  if (!w) return NextResponse.json({ error: "not found" }, { status: 404 });

  const answered = w.turns.length;
  const done = w.status === "completed" || w.status === "attached" || answered >= w.questions.length;
  return NextResponse.json({
    candidateName: w.candidateName,
    relationship: w.relationship,
    question: done ? "" : w.questions[answered],
    questionNumber: answered + 1,
    totalQuestions: w.questions.length,
    done,
  });
}
