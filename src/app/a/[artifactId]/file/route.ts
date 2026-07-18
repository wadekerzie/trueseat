// Streams an uploaded evidence file from the private bucket. Content-type
// comes from our extension allowlist (recorded at upload), never from the
// client, and everything non-previewable is served as an attachment.

import { findUpload, readUploadFile } from "@/lib/evidence";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  const { artifactId } = await params;
  const upload = await findUpload(artifactId);
  if (!upload) return new Response("not found", { status: 404 });

  const bytes = await readUploadFile(upload.storage_path);
  if (!bytes) return new Response("file missing", { status: 404 });

  const inline =
    upload.mime === "application/pdf" || upload.mime.startsWith("image/");
  return new Response(new Blob([bytes as BlobPart]), {
    headers: {
      "Content-Type": upload.mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${upload.file_name}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
