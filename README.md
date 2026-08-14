# TrueSeat

**Resumes are claims. TrueSeat is evidence.**

A whole-person hiring engine: an AI interview builds each candidate a sealed, evidence-backed capability dossier (what they can actually do, how they actually operate, what they actually need), hosts an evidence page, and emits honest ATS-clean applications from it. The symmetric employer interview and blind matching follow. Built for the Build with Gemini XPRIZE (Entrepreneurship & Job Creation), created July 2026.

## Architecture

| Piece | What | Where |
|---|---|---|
| App + marketing | Next.js 15 / TypeScript / Tailwind | Vercel, trueseat.io |
| The brain | Claude (`claude-opus-4-8`): interview orchestration, dossier extraction via structured outputs, bridge applications | `src/lib/claude.ts`, `prompts/` |
| The ears | Gemini audio ingestion service (transcript + first-pass summary) | `services/ears/`, Google Cloud Run, GCP project `trueseat` |
| Dossier schema | The ontology: verified claims, situated capabilities, artifacts w/ provenance, operating profile, sealed constraints, trajectory | `schema/dossier.schema.json` |
| Auth / DB / storage | Supabase (magic links, Postgres JSONB, Storage) | week 1 |
| Payments / email | Stripe payment links, Resend | week 0-2 |

Division of labor: Claude is the brain, Gemini is the ears, deterministic code is everything else.

## XPrize compliance (by architecture, not bolted on)

- **Newly created in-window:** this repo's first commit is July 15, 2026.
- **Load-bearing Gemini call:** every audio input flows through `services/ears` (Gemini `generateContent` with audio).
- **Google Cloud product:** the ears service deploys on Cloud Run.
- **Business viability evidence:** real Stripe receipts only. No fabricated traction, ever.

## Product principles

1. Evidence over claims: every substantive claim carries a verification tier (0 self-reported → 3 witness-verified) and points at artifacts.
2. The candidate owns the dossier and reviews every word before anything ships.
3. Constraints and operating profile are sealed by default.
4. Operating profile is behavioral, job-relevant, plain language: no clinical labels, no proprietary instrument administration, no protected-characteristic inference.

## Develop

```bash
npm install
cp .env.example .env.local   # fill from Wade OS Secrets
npm run dev
```

Ears service: see `services/ears/README.md`.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md).

You may read, run, modify and share this code for any **noncommercial** purpose,
which includes reviewing or evaluating it. Commercial use is not granted.

This repository is public so it can be reviewed as part of a Build with Gemini
XPRIZE submission, whose rules require entrants' code to be either public with
relevant licensing, or private and shared with the judging accounts. Public with
a license is the more durable of the two: a private-repo collaborator invitation
expires after seven days, and judging happens after the entry deadline.
