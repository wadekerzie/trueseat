import sample from "../../../../samples/sample_dossier.json";
import DossierView, { type DossierData } from "@/components/DossierView";

// The fictional sample dossier — same renderer as real dossiers (/d/[id])
// so the sample never drifts from the product.

export default function SampleDossier() {
  return (
    <DossierView
      dossier={sample as unknown as DossierData}
      banner={{ text: "Sample dossier · fictional candidate", tone: "sample" }}
      footerNote="this is a fictional sample dossier"
    />
  );
}
