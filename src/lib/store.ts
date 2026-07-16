// Session persistence. Dev: JSON files under .data/ (gitignored).
// Production: swap for Supabase (supabase/migrations/0001_init.sql is the
// matching schema); the interface is the contract.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InterviewSession } from "./types";

const DATA_DIR = path.join(process.cwd(), ".data", "sessions");

export async function getSession(id: string): Promise<InterviewSession | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  try {
    const raw = await readFile(path.join(DATA_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as InterviewSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: InterviewSession): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  session.updatedAt = new Date().toISOString();
  await writeFile(
    path.join(DATA_DIR, `${session.id}.json`),
    JSON.stringify(session, null, 2)
  );
}
