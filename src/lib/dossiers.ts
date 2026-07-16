// Dossier persistence (Supabase `dossiers` table from 0001_init.sql).
// Server-side only: uses the secret key, same pattern as store.ts.

import type { DossierData } from "@/components/DossierView";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export interface DossierRow {
  id: string;
  session_id: string | null;
  content: DossierData;
  candidate_reviewed: boolean;
  created_at: string;
  updated_at: string;
}

export async function getDossier(id: string): Promise<DossierRow | null> {
  if (!/^[a-z0-9-]+$/.test(id) || !SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/dossiers?id=eq.${id}&select=*&limit=1`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      // A dossier changes rarely; cache briefly but allow fresh drafts to appear.
      next: { revalidate: 30 },
    }
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as DossierRow[];
  return rows.length ? rows[0] : null;
}
