// Shared dossier renderer: /d/sample (fictional) and /d/[id] (real, from
// Supabase) render the same component so the sample never drifts from the
// product. Data shape follows schema/dossier.schema.json.

export interface DossierData {
  identity: { full_name: string; headline: string; location?: string };
  headline_numbers: { claim: string; tier: number; adjudicated?: boolean }[];
  capabilities: { capability: string; situation: string; tier: number }[];
  operating_profile: {
    dimensions?: { dimension: string; profile: string; alignment?: string }[];
    manager_manual?: Record<string, string>;
    micro_references?: {
      id: string;
      relationship: string;
      confirmations?: string[];
    }[];
  };
  trajectory?: { arc: string; growth_edges?: string[] };
  meta?: { candidate_reviewed?: boolean };
}

const TIER_LABELS: Record<number, { label: string; hint: string }> = {
  0: { label: "Self-reported", hint: "Stated in interview; no artifact yet" },
  1: { label: "Artifact-backed", hint: "A work product exists and is attached" },
  2: { label: "Provenance-verified", hint: "Origin and authorship independently checkable" },
  3: { label: "Witness-verified", hint: "Confirmed by a named third party" },
};

function Tier({ tier }: { tier: number }) {
  const t = TIER_LABELS[tier] ?? TIER_LABELS[0];
  return (
    <span
      title={t.hint}
      className={`inline-block text-[11px] tracking-wide uppercase rounded px-2 py-0.5 border ${
        tier >= 3
          ? "border-[#6B9FD4] text-[#8ab4e0]"
          : tier >= 1
          ? "border-[#3a4456] text-[#a8b0c0]"
          : "border-[#2a3242] text-[#6d7585]"
      }`}
    >
      {t.label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-xs tracking-[0.25em] uppercase text-[#7fa6d9] mb-5">{title}</h2>
      {children}
    </section>
  );
}

export default function DossierView({
  dossier: d,
  banner,
  footerNote,
}: {
  dossier: DossierData;
  banner?: { text: string; tone: "sample" | "draft" } | null;
  footerNote?: string;
}) {
  const numbers = d.headline_numbers ?? [];
  const capabilities = d.capabilities ?? [];
  const dimensions = d.operating_profile?.dimensions ?? [];
  const managerManual = d.operating_profile?.manager_manual ?? {};
  const references = d.operating_profile?.micro_references ?? [];
  const growthEdges = d.trajectory?.growth_edges ?? [];
  return (
    <main className="min-h-screen bg-[#0e1116] text-[#e8eaf0]">
      <div className="mx-auto w-full max-w-3xl px-6 py-16">
        {banner && (
          <p
            className={`text-xs tracking-[0.25em] uppercase mb-8 ${
              banner.tone === "draft" ? "text-[#E8896A]" : "text-[#E8896A]"
            }`}
          >
            {banner.text}
          </p>
        )}

        <header className="mb-12">
          <h1 className="text-4xl font-semibold mb-2">{d.identity.full_name}</h1>
          <p className="text-lg text-[#a8b0c0]">{d.identity.headline}</p>
          {d.identity.location && (
            <p className="text-sm text-[#6d7585] mt-2">{d.identity.location}</p>
          )}
        </header>

        <Section title="The numbers they stand behind">
          <ul className="space-y-4">
            {numbers.map((n, i) => (
              <li key={i} className="border-l-2 border-[#2a3242] pl-4">
                <p className="text-lg leading-snug mb-1">{n.claim}</p>
                <div className="flex gap-2 items-center">
                  <Tier tier={n.tier} />
                  {n.adjudicated && (
                    <span className="text-[11px] uppercase tracking-wide text-[#6d7585]">
                      confirmed verbatim in interview
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Situated capabilities">
          <ul className="space-y-6">
            {capabilities.map((c, i) => (
              <li key={i}>
                <p className="text-lg mb-1">{c.capability}</p>
                <p className="text-sm text-[#a8b0c0] mb-2">{c.situation}</p>
                <Tier tier={c.tier} />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="How they operate">
          <div className="space-y-6">
            {dimensions.map((dim, i) => (
              <div key={i}>
                <p className="text-sm uppercase tracking-wide text-[#6d7585] mb-1">
                  {dim.dimension.replace(/_/g, " ")}
                </p>
                <p className="leading-relaxed text-[#c8cedb]">{dim.profile}</p>
                {dim.alignment === "partially_consistent" && (
                  <p className="text-xs text-[#E8896A] mt-1">
                    Self-description and story evidence partially diverge; noted, not hidden.
                  </p>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title="The manager manual">
          <dl className="space-y-3">
            {Object.entries(managerManual).map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm uppercase tracking-wide text-[#6d7585]">
                  {k.replace(/_/g, " ")}
                </dt>
                <dd className="text-[#c8cedb] leading-relaxed">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {references.length > 0 && (
          <Section title="Witnesses">
            <ul className="space-y-4">
              {references.map((r) => (
                <li key={r.id} className="border-l-2 border-[#2a3242] pl-4">
                  <p className="text-sm text-[#a8b0c0] mb-1">{r.relationship}</p>
                  <ul className="list-disc list-inside text-[#c8cedb] text-sm space-y-1">
                    {r.confirmations?.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="Trajectory">
          <p className="leading-relaxed text-[#c8cedb] mb-3">{d.trajectory?.arc}</p>
          {growthEdges.length > 0 && (
            <p className="text-sm text-[#a8b0c0]">
              Growth edge: {growthEdges.join("; ")}
            </p>
          )}
        </Section>

        <Section title="Constraints">
          <div className="rounded-md border border-[#2a3242] bg-[#12161f] p-5">
            <p className="text-[#a8b0c0] text-sm leading-relaxed">
              🔒 Sealed. Compensation floor, geography, timing, and dealbreakers are
              captured in every dossier and released only to a matched employer with
              the candidate&apos;s explicit consent. That seal is what makes the
              matching honest.
            </p>
          </div>
        </Section>

        <footer className="pt-8 border-t border-[#1c2230] text-sm text-[#6d7585]">
          <p className="mb-2">
            Every claim above carries a verification tier: self-reported →
            artifact-backed → provenance-verified → witness-verified.
          </p>
          <p>
            TrueSeat{footerNote ? ` · ${footerNote}` : ""} ·{" "}
            <a href="/" className="underline underline-offset-4">trueseat.io</a>
          </p>
        </footer>
      </div>
    </main>
  );
}
