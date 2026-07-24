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
  // Soft per-phase turn budget. The interviewer sees turns-used vs budget and
  // paces itself; these are guidance, not hard walls.
  turnBudget: number;
  // Extra phase-specific interviewing instructions injected into the prompt.
  technique?: string;
}

// Soft total-turn target the prompt steers toward, and the hard cap at which
// the code forces a wrap-up regardless of what the model wants (protects the
// candidate from a runaway interview; ~24 voice turns is about 45 minutes).
const TARGET_TURNS = 24;
const MAX_TURNS = 36;

export const PHASES: PhaseSpec[] = [
  {
    phase: "arc",
    objective:
      "Get the career story in the candidate's own framing: shape, turning points, direction. Establish voice and trust.",
    seedQuestions: [
      "Let's start easy. Walk me through the shape of your career the way you'd tell it to a friend over dinner, not the way you'd tell a recruiter.",
      "If you had to name the one turning point that most explains where you are today, what was it?",
    ],
    turnBudget: 3,
    technique:
      "This phase builds trust and a map, not depth. Note every role, number, and name that flies by — you will mine them in the evidence phase, not here. One warm follow-up on the most interesting turning point is plenty.",
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
    turnBudget: 6,
    technique:
      "Quantification discipline, with a ceiling: an outcome is well captured when you have the number, the baseline or denominator, the timeframe, and how the candidate knows it (\"$4.2M against what quota? Over what period? Where does that figure live?\"). Ask for that shape ONCE. Then treat each of these as a complete answer and move on: a percentage or growth rate offered instead of an absolute figure (\"35% year over year\" is a real answer, not a way-station to the dollar amount); a confidentiality or public-disclosure limit (\"I can't give segment revenue\" is legitimate inside most large companies, not evasion); a figure more than roughly ten years old, where nobody carries the exact number; and a gap between the candidate's scope and a larger public number, which usually just means the public figure aggregates more than they owned. Career progression is itself evidence: nobody is handed larger scope repeatedly without delivering, so a candidate who points at their own trajectory has answered you. When a story names another person, get their role — they are witness candidates later. For the 1-2 biggest claims, ask what exists that shows it; mention once, naturally, that after the interview there is a screen where they can attach links and documents to back what they told you, so they should keep artifacts in mind.",
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
    turnBudget: 8,
    technique:
      "Track your coverage across the nine dimensions (pace, ramp, communication cadence, conflict, feedback, decisions, energy, autonomy, pressure) — one story each; a single rich story can cover two or three dimensions, so credit them and don't re-ask. Personalize prompts with material from earlier phases (\"you mentioned the quarter the Ribbon deal almost died — what did the final 48 hours look like?\") instead of asking generic versions. Always end the phase with the self-description cross-check question.",
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
    turnBudget: 3,
    technique:
      "Open with the sealed framing exactly once — after that, just ask plainly. Do not probe beyond what matching needs, and never reference anything from this phase in later questions.",
  },
  {
    phase: "adjudication",
    objective:
      "Read back every headline number and uncertain claim verbatim. Confirm or correct. Only confirmed figures become adjudicated.",
    seedQuestions: [
      "Before we finish the numbers: of everything you told me today, which figures would you stand behind in any room, exactly as stated? I'll read them back one at a time.",
    ],
    turnBudget: 3,
    technique:
      "Before your first question in this phase, silently list every headline number and uncertain claim from the whole conversation. Then read them back in batches of two or three per turn, each VERBATIM in the candidate's own words (\"you said 4.2 million in new logo revenue in fiscal 2024 — is that the exact figure you'll stand behind in any room?\"). Ask confirm or correct, nothing else — no new topics, no hypotheticals, no revisiting earlier phases. This phase is pure read-back. Accept the answer as given the first time: if the candidate confirms, it is adjudicated; if they revise, record the revised value; if they say it's a percentage only, confidential, or a rough recollection, record it exactly that way and move to the next — do NOT push a second time for a harder number than they will give. A figure the candidate softens or revises gets recorded at the revised value and is NOT adjudicated at the original. Read-back is verification of what they said, never pressure to say more.",
  },
  {
    phase: "witnesses",
    objective:
      "Collect 2-3 former colleagues who could confirm how this person operates, for optional 5-minute reference interviews.",
    seedQuestions: [
      "Last one. Who worked with you closely enough to confirm how you operate: a former manager, a peer, someone who reported to you? We'd ask them for five minutes, with your permission.",
    ],
    turnBudget: 2,
    technique:
      "If earlier stories named people, suggest them by name and role (\"you mentioned your CRO Dana — would she be one?\"). Get name, relationship, and how they overlapped for 2-3 people; no contact details needed yet. In your sign-off, tell the candidate exactly what happens next: one short screen where they can back their claims with links or documents (two minutes, and it is what moves claims up the verification ladder), then the dossier draft comes to them, and nothing is shared until they approve every word.",
  },
];

const GUARDRAILS = `Rules that always apply:
- Never invent, embellish, or lead the witness. Ask, then follow the story.
- One question at a time, conversational, in plain language. No corporate-speak.
- Follow up on specifics ("you said the deal almost died in month three: what did you do that week?") before moving on.
- Ask for the scene, not the summary: "walk me through that week" beats "tell me more." Mirror the candidate's own words when you dig in.
- Thin-answer rule: when an answer is a one-liner or a generality, dig exactly once with a sharper, more concrete version of the question. If it stays thin, take what's there and move on — never interrogate.
- Never re-ask something already answered; build on it instead.
- If a direct question goes unanswered twice (the candidate keeps answering something else), let it go permanently — note the gap and move forward. Chasing it a third time feels like an interrogation.
- Respect confidentiality as a real answer, everywhere. When a candidate cites an NDA, a public-disclosure limit, or simply won't state an exact figure, that is a legitimate stopping point — accept it, capture the generalized version they will stand behind (a percentage, a range, a directional claim), and move on. Never re-ask for a harder number, and never imply that declining to disclose weakens their claim.
- Proof lives on a spectrum, not a single bar. A published percentage, a title progression, a named witness, or "go read the 10-K" are all valid ways to back a claim. Do not insist on one specific form of proof (an exact dollar figure, a document) when the candidate has offered another that a reasonable evaluator would accept.
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

  // Pacing signal: the model sees where it is against the budgets and steers.
  const turnsInPhase = session.turns.filter((t) => t.phase === session.phase).length;
  const totalTurns = session.turns.length;
  const remainingBudget = PHASES.slice(idx + 1).reduce((s, p) => s + p.turnBudget, 0);
  const pacing =
    `Pacing: you have asked ${turnsInPhase} question(s) in this phase (soft budget ${spec.turnBudget}) and ${totalTurns} total (target ~${TARGET_TURNS} for the whole interview; later phases need ~${remainingBudget} more). ` +
    (turnsInPhase >= spec.turnBudget
      ? `You are at or past this phase's budget — advance with your next question unless something essential is genuinely missing. `
      : ``) +
    (totalTurns >= TARGET_TURNS
      ? `The interview is over the total target: be decisive, compress remaining phases to their essentials, and protect the candidate's time. Constraints, adjudication, and witnesses must never be skipped — shorten the middle instead. `
      : ``);

  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1000,
    thinking: { type: "adaptive" },
    system:
      `You are TrueSeat's interviewer: warm, direct, genuinely curious, like the best colleague the candidate ever had. ` +
      `You are conducting phase "${spec.phase}" of a six-phase whole-person interview.\n` +
      `Phase objective: ${spec.objective}\n` +
      (spec.technique ? `Phase technique: ${spec.technique}\n` : ``) +
      `Seed questions you may adapt: ${spec.seedQuestions.join(" | ")}\n` +
      `Remaining phases after this one: ${remainingPhases.join(", ") || "none"}.\n` +
      `${pacing}\n${resumeContext}${GUARDRAILS}\n` +
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
  // Hard cap: no session runs away past MAX_TURNS regardless of what the
  // model decides. The candidate gets a graceful close, not a wall.
  if (session.turns.length >= MAX_TURNS) {
    return {
      question:
        "That's everything — and thank you, you gave me a lot of real material to work with. One quick screen comes next where you can back what you told me with links or documents, then your dossier draft comes to you. Nothing is shared until you approve every word.",
      phase: "done" as Phase,
      done: true,
    };
  }
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
