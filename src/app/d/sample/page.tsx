import wade from "../../../../samples/wade_dossier.json";
import DossierView, { type DossierData } from "@/components/DossierView";

// Customer Zero: the founder's real dossier, rendered by the same component
// as real dossiers (/d/[id]) so the sample never drifts from the product.

export const metadata = {
  title: "Wade Kerzie — TrueSeat dossier",
  description:
    "The founder's real capability dossier. Every claim carries a verification tier; every evidence link is live.",
};

export default function SampleDossier() {
  return (
    <DossierView
      dossier={wade as unknown as DossierData}
      banner={{
        text: "The founder's real dossier · every evidence link is live",
        tone: "sample",
      }}
      footerNote="customer zero: the founder's own dossier"
    />
  );
}
