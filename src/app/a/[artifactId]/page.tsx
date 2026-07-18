import { notFound } from "next/navigation";
import { findUpload, provenanceComplete } from "@/lib/evidence";
import Wordmark from "@/components/Wordmark";

// X18 Phase 2: the artifact viewer. Dossier artifact cards link here for
// uploaded documents. Shows the candidate's provenance answers next to an
// inline preview (PDF/image) or a download link; the file itself streams
// from the private bucket via ./file. Artifact ids are unguessable UUIDs —
// same access posture as /d/[id] share links.

export const dynamic = "force-dynamic";

const PROVENANCE_ROWS: { key: "what" | "author" | "date" | "origin"; label: string }[] = [
  { key: "what", label: "What this is" },
  { key: "author", label: "Created by" },
  { key: "date", label: "Created" },
  { key: "origin", label: "Origin / who can confirm" },
];

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ artifactId: string }>;
}) {
  const { artifactId } = await params;
  const upload = await findUpload(artifactId);
  if (!upload) notFound();

  const fileHref = `/a/${upload.artifact_id}/file`;
  const inline =
    upload.mime === "application/pdf" || upload.mime.startsWith("image/");
  const complete = provenanceComplete(upload.provenance);

  return (
    <main className="min-h-screen bg-[#0e1116] text-[#e8eaf0] px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-baseline gap-3 mb-6">
          <a href="/" className="no-underline" aria-label="TrueSeat">
            <Wordmark className="text-lg" />
          </a>
          <p className="text-xs tracking-[0.25em] uppercase text-[#7fa6d9]">
            evidence artifact
          </p>
        </div>
        <h1 className="text-2xl font-semibold mb-2 break-words">
          {upload.provenance.what.trim() || upload.file_name}
        </h1>
        <p className="text-sm text-[#6d7585] mb-8">
          {upload.file_name} · {Math.max(1, Math.round(upload.size / 1024))} KB ·
          uploaded by the candidate {upload.at.slice(0, 10)}
        </p>

        <section className="rounded-md border border-[#2a3242] bg-[#12161f] p-5 mb-8">
          <h2 className="text-xs tracking-[0.25em] uppercase text-[#7fa6d9] mb-4">
            Provenance{" "}
            <span className="normal-case tracking-normal text-[#6d7585]">
              — candidate-attested
            </span>
          </h2>
          <dl className="grid gap-3">
            {PROVENANCE_ROWS.map(({ key, label }) => (
              <div key={key} className="grid sm:grid-cols-[180px_1fr] gap-1 sm:gap-4">
                <dt className="text-sm text-[#6d7585]">{label}</dt>
                <dd className="text-sm text-[#c8cedb] leading-relaxed">
                  {upload.provenance[key].trim() || "—"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-[#6d7585] leading-relaxed mt-4">
            {complete
              ? "Provenance is stated specifically enough to check: origin, authorship, and date are all on record."
              : "Provenance is partial; this document is attached as candidate-provided without a full origin record."}
          </p>
        </section>

        {inline ? (
          upload.mime.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileHref}
              alt={upload.provenance.what.trim() || upload.file_name}
              className="w-full rounded-md border border-[#2a3242]"
            />
          ) : (
            <object
              data={fileHref}
              type="application/pdf"
              className="w-full h-[75vh] rounded-md border border-[#2a3242]"
            >
              <p className="p-4 text-sm text-[#a8b0c0]">
                Your browser can&apos;t preview this PDF.{" "}
                <a href={fileHref} className="text-[#8ab4e0] underline underline-offset-4">
                  Download it instead.
                </a>
              </p>
            </object>
          )
        ) : (
          <a
            href={fileHref}
            className="inline-block rounded-md border border-[#2a4a6b] bg-[#111722] px-5 py-3 text-sm text-[#8ab4e0] hover:border-[#6B9FD4] transition-colors"
          >
            Download {upload.file_name}
          </a>
        )}

        <p className="text-xs text-[#6d7585] leading-relaxed mt-10">
          Uploaded documents are candidate-provided. TrueSeat records the
          provenance the candidate attests; it does not alter the file.
        </p>
      </div>
    </main>
  );
}
