// Session persistence. Production: Supabase (interview_sessions table from
// supabase/migrations/0001_init.sql) via the REST API with the secret key.
// Dev fallback (no Supabase env): JSON files under .data/ (gitignored).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InterviewSession } from "./types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
// New-format sb_secret_ key; env var name kept from the original schema notes.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

const DATA_DIR = path.join(process.cwd(), ".data", "sessions");

function rest(pathname: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
}

type Row = {
  id: string;
  candidate_name: string | null;
  phase: InterviewSession["phase"];
  current_question: string;
  turns: InterviewSession["turns"];
  created_at: string;
  updated_at: string;
};

function toSession(row: Row): InterviewSession {
  return {
    id: row.id,
    candidateName: row.candidate_name ?? undefined,
    phase: row.phase,
    currentQuestion: row.current_question,
    turns: row.turns ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getSession(id: string): Promise<InterviewSession | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return null;

  if (useSupabase) {
    const res = await rest(
      `/interview_sessions?id=eq.${id}&select=*&limit=1`
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Row[];
    return rows.length ? toSession(rows[0]) : null;
  }

  try {
    const raw = await readFile(path.join(DATA_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as InterviewSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: InterviewSession): Promise<void> {
  session.updatedAt = new Date().toISOString();

  if (useSupabase) {
    const res = await rest(`/interview_sessions`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        id: session.id,
        candidate_name: session.candidateName ?? null,
        phase: session.phase,
        current_question: session.currentQuestion,
        turns: session.turns,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      }),
    });
    if (!res.ok) {
      throw new Error(`session save failed: ${res.status} ${await res.text()}`);
    }
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    path.join(DATA_DIR, `${session.id}.json`),
    JSON.stringify(session, null, 2)
  );
}
