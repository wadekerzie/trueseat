// Client for the ears service (Gemini audio ingestion on Cloud Run).
// Local dev: run `node services/ears/index.mjs` and leave EARS_URL unset.

import type { IngestResult } from "./types";

const EARS_URL = process.env.EARS_URL || "http://localhost:8080";

export async function ingestAudio(
  audioBase64: string,
  mimeType: string
): Promise<IngestResult> {
  const res = await fetch(`${EARS_URL}/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.EARS_SHARED_SECRET
        ? { "x-ears-secret": process.env.EARS_SHARED_SECRET }
        : {}),
    },
    body: JSON.stringify({ audioBase64, mimeType }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ears ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as IngestResult;
}
