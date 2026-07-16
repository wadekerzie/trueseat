import { notFound } from "next/navigation";
import DossierView from "@/components/DossierView";
import { getDossier } from "@/lib/dossiers";

// Real dossiers, rendered from Supabase by id. The URL is the product:
// candidate-owned, unlisted, shareable.

export default async function DossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getDossier(id);
  if (!row) notFound();

  return (
    <DossierView
      dossier={row.content}
      banner={
        row.candidate_reviewed
          ? null
          : { text: "Draft · pending candidate review", tone: "draft" }
      }
      footerNote="evidence-backed capability dossier"
    />
  );
}
