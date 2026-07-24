# X26 — TrueSeat Interview v2 Retrain Spec

Source: Aaron Jones (candidate #1) recorded feedback, 2026-07-24. Full capture:
`Wade OS/captures/processed/cap_20260724_trueseat_aaron_first_user_feedback.md`
and friction log in `Wade OS/opportunity_intelligence/aaron_candidate1_run.md`.

This spec covers the FOUR parts of X26. Part 1 is DONE. Parts 2 and 3 are
ready to build (any tier — mechanical once the decisions here are followed).
Part 4 is BLOCKED on Wade's product decision.

All interviewer prompt text lives in `src/lib/interviewer.ts`. The dossier shape
is `schema/dossier.schema.json`; the public renderer is
`src/components/DossierView.tsx`; extraction happens in `src/lib/generateDossier.ts`
(server) and `scripts/generate-dossier.mjs` (script — keep the two in sync).

---

## Part 1 — Soften the numbers interrogation ✅ DONE 2026-07-24 (Opus)

Committed in `interviewer.ts`. Three edits, all prompt text:
1. Evidence phase `technique` (quantification discipline): added a ceiling —
   ask for the full number-shape ONCE, then accept a percentage, a
   confidentiality limit, a 10+-year-old figure, a scope-vs-public-aggregate
   mismatch, or career progression itself as a complete answer.
2. Adjudication phase `technique`: read-back now accepts the first answer
   (confirm / revise / "percentage only or confidential") and never pushes a
   second time for a harder number.
3. New global GUARDRAIL lines: confidentiality is a real answer everywhere;
   proof lives on a spectrum (percentage, title progression, witness, public
   filing all valid) — don't insist on one form.

Rationale from Aaron: "I had 35% year over year, 75%... what's that number?
Yeah, I can't tell you that." NDA/disclosure limits are legitimate; percentages
beat absolutes when that's the honest answer; tenure progression is evidence;
15-year-old figures can't be exact; $10B-scope vs $13B-public is aggregation,
not a lie.

Typecheck passes. NOT yet run against a live synthetic interview — do that
before shipping (see Verification at bottom).

---

## Part 2 — Add holistic / culture-fit dimensions  (READY TO BUILD)

Aaron's gap: the interview covered arc, evidence, operating profile (leadership
vs IC), constraints (relocation, travel), adjudication, witnesses — but missed
"the human": life outside work, what energizes vs drains, work RHYTHM as a
culture-fit signal (his: 50+ hrs but not 8-to-5; evenings, dark mornings), and
explicit solo vs side-by-side vs team preference. His point: these are the
things that surface in months 1-3 of a job and that no interview captures, yet
they decide culture fit.

### What already exists (don't rebuild)
- `operating_profile` phase already has an "energy" dimension (seed Q: "Which
  part of your last role filled the tank, and which part drained it?") and an
  "autonomy" dimension. So energizers and some solo/team signal are PARTIALLY
  covered. The miss is (a) life-outside-work / whole-person context, and
  (b) work-rhythm-as-culture-fit stated explicitly, and (c) making solo-vs-team
  a first-class question rather than an inference.

### Build (in `interviewer.ts`)
Do NOT add a whole new phase — it bloats turn count (TARGET_TURNS=24, MAX=36).
Instead extend the existing `operating_profile` phase:

1. Add two seed questions to the `operating_profile` `seedQuestions` array:
   - "Outside the work itself — what does your ideal working rhythm actually
     look like? Some people are 8-to-5 at a desk, some work in bursts with gaps.
     When and how do you do your best work?"
   - "When you picture the environment where you do your best work: mostly solo
     with deep focus, side by side with one or two people, or in the middle of a
     team most of the day?"
2. Add "rhythm" and "collaboration_style" to the dimension list in the phase
   `technique` string (currently nine: pace, ramp, communication cadence,
   conflict, feedback, decisions, energy, autonomy, pressure → becomes eleven).
   Keep the "one rich story can cover two or three, credit them, don't re-ask"
   instruction so this doesn't inflate turns.
3. Bump `operating_profile` `turnBudget` from 8 to 9 (one extra; the two seeds
   often merge into existing energy/autonomy answers so +1 is enough). Leave
   TARGET_TURNS at 24 — the pacing signal absorbs it.

Optional, only if Wade wants whole-person context in the dossier: add ONE arc-
phase-adjacent question about life outside work. Recommendation: SKIP for v2.
Aaron asked for work-relevant culture signal, not biography; a "what do you do
outside work" question risks protected-characteristic drift (family, religion,
etc.) that the GUARDRAILS explicitly forbid inferring on. The rhythm and
collaboration questions deliver the culture-fit value without that risk.

### Schema + renderer
The operating_profile dimensions are already free-form (`profile` text +
`stories`), so rhythm and collaboration_style flow through with NO schema
change — they're just two more dimensions in the same array. Verify by reading
the `operating_profile` definition in `schema/dossier.schema.json`; if
`dimensions` is an open array of {profile, stories, ...} objects (it is as of
this writing), nothing to change. Renderer `DossierView.tsx` already maps over
dimensions generically. CONFIRM both before declaring done.

---

## Part 3 — Capture-vs-display split  (READY TO BUILD — decision made below)

Aaron's core objection: he answered "why did you leave" honestly, naming a
specific exec he disagreed with, plus blunt self-described weaknesses. All of it
landed verbatim in the dossier. His words: "if I was looking at that, I think
that's too intimate." Agreed principle: flesh out the human, don't DISPLAY all
of it. The capture layer and the display layer are different things.

### Decision (Wade + Claude, 2026-07-24): OPTION B — keep intimate material OUT
### of the dossier object entirely, not sealed-but-present.

Why B over "mark it sealed and redact server-side":
- Sealed-but-present means one renderer bug leaks the exact material the
  candidate called too intimate. Least-surprise fails badly here.
- X23 (blurred-reveal funnel) already introduces server-side redaction for the
  paid-unlock flow. Overloading "sealed" with a second, privacy-critical meaning
  invites collisions. Keep private data physically absent from the published
  object.

### Build
The mechanism is at the EXTRACTION layer (`generateDossier.ts` system prompt,
mirrored in `scripts/generate-dossier.mjs`), not the interview. The interview
should still ask "why did you leave" and get the honest answer — that context
improves matching and the operating profile. The extraction prompt decides what
crosses into the dossier.

Add to the extraction system prompt (both files, keep in sync) a hard rule:

  "Separation and departure reasons: capture the PROFESSIONAL, forward-looking
   substance of why a candidate left a role (e.g. 'sought broader scope than the
   incoming leadership's direction allowed') for the trajectory/arc. NEVER put
   into the dossier: named individuals the candidate was in conflict with,
   verbatim grievances about specific people, or intimate self-criticism offered
   in confidence. Those stay in the interview transcript for matching context
   only. When a departure story names a person as the reason for friction,
   render the reason in role/structural terms without the name and without the
   grievance. Raw self-described weaknesses become, at most, a neutral
   growth-edge in operating_profile.growth_edges — never a verbatim quote."

The existing `trajectory.growth_edges` field already exists in the schema and is
the right home for a de-personalized version of self-criticism (Aaron's "great
at articulating, not at putting it on paper" is a legitimate growth edge stated
neutrally; the raw self-flagellation is not).

Matching layer note: the full transcript already persists (Supabase
`interview_sessions.turns` + raw vault). The private/intimate material is
therefore STILL AVAILABLE to any future matching engine that reads the
transcript — it simply never enters the public dossier. That satisfies "flesh
out the human for matching, don't display it." No new store needed for v2.

### Test
After the prompt change, regenerate Aaron's dossier from his real session
(`fa17e4a4-9812-4d33-b200-37ad6f72a9ef`) and confirm: the Amir Hussein name and
the raw leave-grievance are GONE from the output, while a professional
departure reason and a neutral growth-edge remain. Compare against the current
live dossier `12601f13-ecc1-4545-8656-f6b4dcca4165` which still has the intimate
version.

---

## Part 4 — 30-minute "light" interview path  (BLOCKED on Wade)

This is really the X23 product decision, not an interview-engine task. Wade's
framing: a ~30-min light interview capturing resume-plus-culture feeds the
employer matching LIBRARY (free or low-cost); the full ~2-hr interview stays the
$249 published-dossier product. Can't build the light pacing until the tier
shape is set: what's in light vs full, and whether light is free.

When unblocked, the likely build is a "mode" on the session that selects a
reduced PHASES set (arc + a compressed evidence + the two new culture questions
+ constraints, skipping deep operating_profile stories, adjudication read-back,
and witnesses) with a TARGET_TURNS ~12. Do NOT build speculatively.

---

## Verification (before shipping ANY part to production)
1. `npx tsc --noEmit` — must be clean.
2. Run a live synthetic interview against the dev server (the X19/X22 work
   established this pattern) and read the transcript: confirm the interviewer
   accepts a "that's confidential / percentage only" answer without a second
   push, and that the two new culture questions land naturally.
3. For Part 3: regenerate Aaron's dossier and diff against the live one for the
   named-person and intimate-weakness removal.
4. Production deploy needs Wade's explicit yes (standing rule).

## Model routing
Part 1 was Opus (Wade-voice interviewer language = judgment). Parts 2 and 3 are
mechanical once this spec is followed → Sonnet is correct. Part 4 is Opus (product
+ money) but blocked. Capture any new recipe back into this file as you go.
