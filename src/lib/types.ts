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

// X18 Phase 2: the provenance form a candidate fills when uploading a
// document. All four fields answered specifically is what earns tier 2 —
// origin and authorship stated concretely enough that someone could check.
export interface EvidenceProvenance {
  what: string; // what the document is (e.g. "Q4 2024 comp letter", "AWS cert")
  author: string; // who created it
  date: string; // when it was created
  origin: string; // where it originally lived / who could confirm it's real
}

// A candidate-uploaded document backing one flagged claim. Stored in the
// private "evidence" Supabase Storage bucket; served via /a/[artifactId].
export interface EvidenceUpload {
  artifact_id: string;
  session_id: string;
  claim_id: string;
  file_name: string;
  mime: string;
  size: number;
  storage_path: string;
  provenance: EvidenceProvenance;
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
