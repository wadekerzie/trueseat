// Witness micro-reference persistence (Supabase `witnesses` table).
// Server-side only: token is the auth; rows are minted by scripts/create-witness-link.mjs
// at the candidate's request per prompts/micro_reference_interview.md.

import type { Turn } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface WitnessSession {
  id: string;
  token: string;
  dossierId: string;
  candidateName: string;
  relationship: string;
  questions: string[];
  turns: Turn[];
  status: "pending" | "in_progress" | "completed" | "attached";
}

type Row = {
  id: string;
  token: string;
  dossier_id: string;
  candidate_name: string;
  relationship: string;
  questions: string[];
  turns: Turn[];
  status: WitnessSession["status"];
};

function headers() {
  return {
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
  };
}

export async function getWitnessByToken(token: string): Promise<WitnessSession | null> {
  if (!/^[a-f0-9]{48}$/.test(token) || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/witnesses?token=eq.${token}&select=*&limit=1`,
    { headers: headers(), cache: "no-store" }
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Row[];
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    token: r.token,
    dossierId: r.dossier_id,
    candidateName: r.candidate_name,
    relationship: r.relationship,
    questions: r.questions ?? [],
    turns: r.turns ?? [],
    status: r.status,
  };
}

export async function saveWitness(w: WitnessSession): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/witnesses?id=eq.${w.id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify({
      turns: w.turns,
      status: w.status,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`witness save failed: ${res.status} ${await res.text()}`);
}
