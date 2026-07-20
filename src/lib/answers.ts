// X22: direct-to-storage audio answers. Long answers used to die at Vercel's
// ~4.5MB request-body cap (~12.5 min at 32kbps); the browser now uploads the
// recording straight to a private Supabase Storage bucket via a signed URL and
// the answer route reads it back server-side. No length ceiling.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const useSupabase = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const ANSWERS_BUCKET = "answers";
// Generous ceiling: ~3.6 hours at 32kbps. A sanity bound, not a product
// limit. Must not exceed the Supabase project's global upload cap (50MB) or
// bucket creation is rejected with a 413.
export const MAX_ANSWER_BYTES = 50 * 1024 * 1024;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured || !useSupabase) return;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      id: ANSWERS_BUCKET,
      name: ANSWERS_BUCKET,
      public: false,
      file_size_limit: MAX_ANSWER_BYTES,
    }),
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    // Supabase reports an existing bucket as 400 "already exists", not 409.
    if (!text.includes("already exists")) {
      throw new Error(`answers bucket create failed: ${res.status} ${text}`);
    }
  }
  bucketEnsured = true;
}

const EXT_BY_MIME: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
};

export function answerExtension(mimeType: string): string | null {
  return EXT_BY_MIME[mimeType.split(";")[0]] ?? null;
}

// Mint a signed upload URL the browser can PUT the recording to directly.
export async function createAnswerUpload(
  sessionId: string,
  mimeType: string
): Promise<{ path: string; uploadUrl: string } | null> {
  if (!useSupabase) return null;
  await ensureBucket();
  const ext = answerExtension(mimeType);
  if (!ext) return null;
  const objectPath = `${sessionId}/${crypto.randomUUID()}.${ext}`;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/upload/sign/${ANSWERS_BUCKET}/${objectPath}`,
    { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: "{}" }
  );
  if (!res.ok) {
    throw new Error(`signed upload failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { url?: string };
  if (!data.url) throw new Error("signed upload response missing url");
  return { path: objectPath, uploadUrl: `${SUPABASE_URL}/storage/v1${data.url}` };
}

// Server-side read of an uploaded answer, returned as base64 for the ears
// service. Path is validated against the session to stop cross-session reads.
export async function readAnswerAudioBase64(
  sessionId: string,
  objectPath: string
): Promise<string | null> {
  if (!useSupabase) return null;
  if (!objectPath.startsWith(`${sessionId}/`) || objectPath.includes("..")) {
    return null;
  }
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${ANSWERS_BUCKET}/${objectPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { headers: headers() }
  );
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ANSWER_BYTES) return null;
  return Buffer.from(bytes).toString("base64");
}
