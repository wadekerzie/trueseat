// TrueSeat brain: Claude runs the interview orchestration, the dossier
// extraction, and (later) the bridge feature. The ears service (Gemini on
// Cloud Run) handles audio before it reaches here.

import Anthropic from "@anthropic-ai/sdk";
import dossierSchema from "../../schema/dossier.schema.json";

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY

export const MODEL = "claude-opus-4-8";

// Ask the interviewer for its next move given the transcript so far.
// Phase logic and prompts live in prompts/interview_architecture.md; the
// system prompt is assembled server-side per session.
export async function nextInterviewTurn(opts: {
  system: string;
  transcript: { role: "user" | "assistant"; content: string }[];
}) {
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    system: opts.system,
    messages: opts.transcript,
  });
  return stream.finalMessage();
}

// Extract/merge structured dossier content from a completed interview phase.
// Uses structured outputs so the response is guaranteed-valid against the
// dossier schema (no post-hoc JSON repair).
export async function extractDossierUpdate(opts: {
  phase: string;
  phaseTranscript: string;
  workingDossier: unknown;
}) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system:
      "You are the extraction pass of TrueSeat. Update the working dossier with ONLY what the transcript supports. " +
      "Never invent, embellish, or round up. Unconfirmed figures stay adjudicated:false. " +
      "Operating-profile language must be behavioral and job-relevant; no clinical labels, no protected-characteristic inference.",
    messages: [
      {
        role: "user",
        content:
          `Phase: ${opts.phase}\n\nWorking dossier:\n${JSON.stringify(opts.workingDossier)}\n\n` +
          `Phase transcript:\n${opts.phaseTranscript}\n\nReturn the full updated dossier.`,
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: dossierSchema as Record<string, unknown>,
      },
    },
  } as Parameters<typeof anthropic.messages.create>[0]);
  return response;
}
