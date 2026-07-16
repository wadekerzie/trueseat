# trueseat-ears

The Gemini-powered audio ingestion service. This is the load-bearing Gemini API call and the Google Cloud (Cloud Run) deployment that anchor XPrize compliance, and it does real work: every voice memo and spoken interview turn passes through it.

## Endpoints

- `GET /health` - liveness check (`/healthz` also answered, but Google Front End reserves that path on run.app domains, so use `/health` against the deployed URL)
- `POST /ingest` - `{ "audioBase64": "...", "mimeType": "audio/m4a" }` returns `{ transcript, summary, claims, stories, signals }`

Requests must carry `x-ears-secret` matching `EARS_SHARED_SECRET` when that env var is set (set it in production).

## Deploy (from repo root)

```bash
gcloud run deploy trueseat-ears \
  --source services/ears \
  --project trueseat \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=trueseat-gemini-key:latest \
  --set-env-vars GEMINI_MODEL=gemini-3.5-flash,EARS_SHARED_SECRET=<from gcp_trueseat.env>
```

Deployed 2026-07-16: `https://trueseat-ears-607669803991.us-central1.run.app`. `GEMINI_API_KEY` lives in GCP Secret Manager (`trueseat-gemini-key`); the source copy plus `EARS_SHARED_SECRET` live in Wade OS at `00_system/Private/Secrets/gcp_trueseat.env`. The trueseat project carries a project-level exception to the org's domain-restricted-sharing policy so `allUsers` can hold `run.invoker`; the shared-secret header is the real gate.
