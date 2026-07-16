# trueseat-ears

The Gemini-powered audio ingestion service. This is the load-bearing Gemini API call and the Google Cloud (Cloud Run) deployment that anchor XPrize compliance, and it does real work: every voice memo and spoken interview turn passes through it.

## Endpoints

- `GET /healthz` - liveness check
- `POST /ingest` - `{ "audioBase64": "...", "mimeType": "audio/m4a" }` returns `{ transcript, summary, claims, stories, signals }`

Requests must carry `x-ears-secret` matching `EARS_SHARED_SECRET` when that env var is set (set it in production).

## Deploy (from repo root)

```bash
gcloud run deploy trueseat-ears \
  --source services/ears \
  --project trueseat \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GEMINI_MODEL=gemini-2.5-flash,EARS_SHARED_SECRET=<generate one>
```

Store `GEMINI_API_KEY` as a Cloud Run secret or env var (never in the repo). The key lives in Wade OS at `00_system/Private/Secrets/gcp_trueseat.env`.
