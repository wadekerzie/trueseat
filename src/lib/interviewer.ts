// The interview brain. With ANTHROPIC_API_KEY set, Claude (claude-opus-4-8)
// crafts each follow-up from the conversation so far, per the six-phase design
// in prompts/interview_architecture.md. Without a key (early dev), a scripted
// interviewer walks the seed questions so the voice loop stays testable.

import Anthropic from "@anthropic-ai/sdk";
import type { InterviewSession, Phase } from "./types";

interface PhaseSpec {
  phase: Phase;
  objective: string;
  seedQuestions: string[];
}

export const PHASES: PhaseSpec[] = [
  {
    phase: "arc",
    objective:
      "Get the career story in the candidate's own framing: shape, turning points, direction. Establish voice and trust.",
    seedQuestions: [
      "Let's start easy. Walk me through the shape of your career the way you'd tell it to a friend over dinner, not the way you'd tell a recruiter.",
      "If you had to name the one turning point that most explains where you are today, what was it?",
    ],
  },
  {
    phase: "evidence",
    objective:
      "Mine each major role for context, outcomes, and artifacts. Every claim needs a story and, ideally, something that exists: a document, a deal record, a repo, a press mention, a person.",
    seedQuestions: [
      "Take the role you're proudest of. What was actually going on at the company when you arrived, and what changed because you were there?",
      "What's the single accomplishment you'd defend in any room? Give me the real number and how you know it.",
      "What exists that shows this? A doc, a deal record, a public mention, a person who'd vouch. Anything we can point at.",
    ],
  },
  {
    phase: "operating_profile",
    objective:
      "One story per dimension: pace, ramp style, communication cadence, conflict, feedback, decisions, energy, autonomy, pressure. Infer from stories; cross-check self-report at the end. Plain behavioral language only.",
    seedQuestions: [
      "Tell me about the last deadline that really mattered. What did the final 48 hours actually look like?",
      "First 30 days of your last job: how did you actually learn it? Docs, questions, or just doing?",
      "Last time you disagreed with your boss about something that mattered: what did you do?",
      "What's the hardest feedback you've ever gotten, and what changed after?",
      "Which part of your last role filled the tank, and which part drained it?",
      "Best manager you ever had and the worst: what specifically made each of them so?",
      "Now the cross-check: how would you describe your own working style in one or two sentences?",
    ],
  },
  {
    phase: "constraints",
    objective:
      "The sealed layer. Frame it explicitly: this is never shown to anyone without the candidate's release; it exists to make matching honest. Compensation floor, geography reality, timing, dealbreakers, search status.",
    seedQuestions: [
      "This next part is sealed: it never appears anywhere without your explicit say-so, and it's what makes matching honest instead of a negotiation game. What does a role need to pay for you to say yes without resentment?",
      "What's the real geography answer: where do you work from, how much travel is genuinely fine, and what would wear you down?",
      "Any true dealbreakers: things where no offer could compensate?",
    ],
  },
  {
    phase: "adjudication",
    objective:
      "Read back every headline number and uncertain claim verbatim. Confirm or correct. Only confirmed figures become adjudicated.",
    seedQuestions: [
      "Before we finish the numbers: of everything you told me today, which figures would you stand behind in any room, exactly as stated? I'll read them back one at a time.",
    ],
  },
  {
    phase: "witnesses",
    objective:
      "Collect 2-3 former colleagues who could confirm how this person operates, for optional 5-minute reference interviews.",
    seedQuestions: [
      "Last one. Who worked with you closely enough to confirm how you operate: a former manager, a peer, someone who reported to you? We'd ask them for five minutes, with your permission.",
    ],
  },
];

const GUARDRAILS = `Rules that always apply:
- Never invent, embellish, or lead the witness. Ask, then follow the story.
- One question at a time, conversational, in plain language. No corporate-speak.
- Follow up on specifics ("you said the deal almost died in month three: what did you do that week?") before moving on.
- Operating-profile observations are behavioral and job-relevant only: no clinical labels, no personality-test taxonomy, no protected-characteristic inference.
- If the candidate seems done with a phase's objective, move on rather than padding.`;

function phaseIndex(phase: Phase): number {
  return PHASES.findIndex((p) => p.phase === phase);
}

// Scripted fallback: walk seed questions in order.
function scriptedNext(session: InterviewSession): {
  question: string;
  phase: Phase;
  done: boolean;
} {
  const idx = phaseIndex(session.phase);
  const spec = PHASES[idx];
  const askedInPhase = session.turns.filter((t) => t.phase === session.phase).length;
  if (askedInPhase < spec.seedQuestions.length) {
    return { question: spec.seedQuestions[askedInPhase], phase: spec.phase, done: false };
  }
  const next = PHASES[idx + 1];
  if (!next) return { question: "", phase: "done", done: true };
  return { question: next.seedQuestions[0], phase: next.phase, done: false };
}

async function claudeNext(session: InterviewSession): Promise<{
  question: string;
  phase: Phase;
  done: boolean;
}> {
  const anthropic = new Anthropic();
  const idx = phaseIndex(session.phase);
  const spec = PHASES[idx];
  const remainingPhases = PHASES.slice(idx + 1).map((p) => p.phase);

  const conversation = session.turns
    .map((t) => `[${t.phase}] Q: ${t.question}\nA: ${t.answer}`)
    .join("\n\n");

  const resumeContext = session.resumeText
    ? `\nThe candidate uploaded their resume (UNVERIFIED, candidate-provided — treat every claim in it as tier 0 until interviewed):\n---\n${session.resumeText.slice(0, 12000)}\n---\nUse it to ask sharper questions ("your resume says X — walk me through the reality of that") and to notice what the resume omits. Never treat resume claims as established fact.\n`
    : "";

  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1000,
    thinking: { type: "adaptive" },
    system:
      `You are TrueSeat's interviewer: warm, direct, genuinely curious, like the best colleague the candidate ever had. ` +
      `You are conducting phase "${spec.phase}" of a six-phase whole-person interview.\n` +
      `Phase objective: ${spec.objective}\n` +
      `Seed questions you may adapt: ${spec.seedQuestions.join(" | ")}\n` +
      `Remaining phases after this one: ${remainingPhases.join(", ") || "none"}.\n${resumeContext}${GUARDRAILS}\n` +
      `Respond with ONLY a JSON object: {"question": string, "advance_phase": boolean, "interview_complete": boolean}. ` +
      `Set advance_phase true when this phase's objective is met and your question opens the next phase. ` +
      `Set interview_complete true only when the witnesses phase is finished; then question should be a warm sign-off.`,
    messages: [
      {
        role: "user",
        content: `Interview so far:\n\n${conversation || "(no answers yet)"}\n\nWhat do you ask next?`,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

  if (parsed.interview_complete) {
    return { question: parsed.question, phase: "done", done: true };
  }
  const phase = parsed.advance_phase && PHASES[idx + 1] ? PHASES[idx + 1].phase : spec.phase;
  return { question: parsed.question, phase, done: false };
}

export async function nextQuestion(session: InterviewSession) {
  if (session.phase === "done") return { question: "", phase: "done" as Phase, done: true };
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await claudeNext(session);
    } catch (err) {
      console.error("claude interviewer failed, falling back to script:", err);
    }
  }
  return scriptedNext(session);
}

export function firstQuestion(hasResume = false) {
  if (hasResume) {
    return {
      question:
        "I've read your resume — so I have the official version. Now give me the real one: walk me through the shape of your career the way you'd tell it to a friend over dinner, not the way the resume tells it.",
      phase: PHASES[0].phase,
    };
  }
  return { question: PHASES[0].seedQuestions[0], phase: PHASES[0].phase };
}
