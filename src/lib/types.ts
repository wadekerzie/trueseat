export type Phase =
  | "arc"
  | "evidence"
  | "operating_profile"
  | "constraints"
  | "adjudication"
  | "witnesses"
  | "done";

export interface IngestResult {
  transcript: string;
  summary?: string;
  claims?: { claim: string; quantified: boolean }[];
  stories?: { topic: string; gist: string }[];
  signals?: string[];
}

export interface Turn {
  phase: Phase;
  question: string;
  answer: string; // transcript or typed text
  mode: "voice" | "text";
  ingest?: IngestResult;
  at: string;
}

// A claim the evidence-flagging pass surfaced as plausibly link-backable.
export interface EvidenceClaim {
  id: string;
  claim: string;
  hint: string;
}

// A candidate's pasted link backing one flagged claim.
export interface EvidenceItem {
  claim_id: string;
  url: string;
  note?: string;
}

export interface InterviewSession {
  id: string;
  candidateName?: string;
  phase: Phase;
  currentQuestion: string;
  turns: Turn[];
  resumeText?: string; // free-tier upload, parsed; unverified candidate-provided claims
  createdAt: string;
  updatedAt: string;
}
