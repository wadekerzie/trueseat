-- TrueSeat initial schema. Apply once the "trueseat" Supabase project exists
-- (project creation is $10/mo on the org: Wade's call, made outside this file).

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  candidate_name text,
  phase text not null default 'arc',
  current_question text not null default '',
  turns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dossiers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  session_id uuid references public.interview_sessions (id),
  content jsonb not null,            -- validates against schema/dossier.schema.json
  candidate_reviewed boolean not null default false,
  sealed_sections text[] not null default array['constraints','operating_profile'],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  kind text not null,                -- e.g. session_started, answer_recorded, dossier_generated, purchase
  session_id uuid,
  user_id uuid,
  data jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);

alter table public.interview_sessions enable row level security;
alter table public.dossiers enable row level security;
alter table public.events enable row level security;

-- Candidates see only their own rows; the app's server routes use the
-- service-role key and bypass RLS deliberately.
create policy "own sessions" on public.interview_sessions
  for all using (auth.uid() = user_id);
create policy "own dossiers" on public.dossiers
  for all using (auth.uid() = user_id);
