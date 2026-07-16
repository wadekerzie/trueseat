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
