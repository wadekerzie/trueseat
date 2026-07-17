// Shared dossier renderer: /d/sample (the founder's real dossier) and /d/[id]
// (real, from Supabase) render the same component so the sample never drifts
// from the product. Data shape follows schema/dossier.schema.json.

interface Evidence {
  artifact_id: string;
  note?: string;
}

interface Artifact {
  id: string;
  type: "live_product" | "media" | "document" | "repo" | "press";
  title: string;
  url?: string;
  created_date?: string;
  provenance?: string;
}

interface Outcome {
  claim: string;
  tier: number;
  evidence?: Evidence[];
  adjudicated?: boolean;
}

export interface DossierData {
  identity: {
    full_name: string;
    headline: string;
    location?: string;
    links?: { label: string; url: string }[];
  };
  headline_numbers: Outcome[];
  experience?: {
    organization: string;
    title: string;
    start?: string;
    end?: string | null;
    context?: string;
    outcomes?: Outcome[];
  }[];
  capabilities: {
    capability: string;
    situation: string;
    tier: number;
    evidence?: Evidence[];
  }[];
  artifacts?: Artifact[];
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
  credentials?: { name: string; issuer?: string; date?: string }[];
  testimonials?: { quote: string; attribution: string }[];
  meta?: { candidate_reviewed?: boolean };
}

const TIER_LABELS: Record<number, { label: string; hint: string }> = {
  0: { label: "Self-reported", hint: "Stated in interview; no artifact yet" },
  1: { label: "Artifact-backed", hint: "A work product exists and is attached" },
  2: { label: "Provenance-verified", hint: "Origin and authorship independently checkable" },
  3: { label: "Witness-verified", hint: "Confirmed by a named third party" },
};

const ARTIFACT_TYPE_LABELS: Record<Artifact["type"], string> = {
  live_product: "Live product",
  media: "Public media",
  document: "Document",
  repo: "Repository",
  press: "Press",
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

function EvidenceChips({
  evidence,
  artifactsById,
}: {
  evidence?: Evidence[];
  artifactsById: Map<string, Artifact>;
}) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {evidence.map((e, i) => {
        const art = artifactsById.get(e.artifact_id);
        if (!art) return null;
        return (
          <a
            key={i}
            href={`#${art.id}`}
            title={e.note ?? art.title}
            className="inline-flex items-center gap-1 text-[11px] rounded-full border border-[#2a4a6b] bg-[#12161f] px-2.5 py-0.5 text-[#8ab4e0] hover:border-[#6B9FD4] hover:text-[#b9d4ef] transition-colors"
          >
            <span aria-hidden>⌁</span>
            {art.title}
          </a>
        );
      })}
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

function ArtifactCard({ art }: { art: Artifact }) {
  const isLive = art.type === "live_product";
  const domain = art.url ? new URL(art.url).hostname.replace(/^www\./, "") : null;
  const body = (
    <>
      <div className="flex items-center gap-2 mb-2">
        {isLive && (
          <span
            className="inline-block w-2 h-2 rounded-full bg-[#5dd39e]"
            title="Live on the public internet"
            aria-hidden
          />
        )}
        <span className="text-[11px] tracking-wide uppercase text-[#6d7585]">
          {ARTIFACT_TYPE_LABELS[art.type] ?? art.type}
          {art.created_date ? ` · ${art.created_date}` : ""}
        </span>
      </div>
      <p className="text-base text-[#e8eaf0] mb-1 flex items-baseline gap-2">
        {art.title}
        {domain && (
          <span className="text-xs text-[#8ab4e0]">
            {domain} <span aria-hidden>↗</span>
          </span>
        )}
      </p>
      {art.provenance && (
        <p className="text-sm text-[#a8b0c0] leading-relaxed">{art.provenance}</p>
      )}
    </>
  );
  const cardClass = `block rounded-md border p-4 scroll-mt-24 ${
    art.url
      ? "border-[#2a4a6b] bg-[#111722] hover:border-[#6B9FD4] hover:bg-[#131b29] transition-colors"
      : "border-[#2a3242] bg-[#12161f]"
  }`;
  return art.url ? (
    <a id={art.id} href={art.url} target="_blank" rel="noopener noreferrer" className={cardClass}>
      {body}
    </a>
  ) : (
    <div id={art.id} className={cardClass}>
      {body}
    </div>
  );
}

function fmtSpan(start?: string, end?: string | null) {
  const y = (s?: string | null) => (s ? s.slice(0, 4) : null);
  const a = y(start);
  const b = end === null ? "now" : y(end);
  if (!a) return null;
  return b ? `${a} – ${b}` : a;
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
  const experience = d.experience ?? [];
  const artifacts = d.artifacts ?? [];
  const artifactsById = new Map(artifacts.map((a) => [a.id, a]));
  const dimensions = d.operating_profile?.dimensions ?? [];
  const managerManual = d.operating_profile?.manager_manual ?? {};
  const references = d.operating_profile?.micro_references ?? [];
  const growthEdges = d.trajectory?.growth_edges ?? [];
  const credentials = d.credentials ?? [];
  const testimonials = d.testimonials ?? [];
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
          <p className="text-sm text-[#6d7585] mt-2">
            {d.identity.location}
            {d.identity.links?.map((l, i) => (
              <span key={i}>
                {(d.identity.location || i > 0) && " · "}
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#8ab4e0] hover:text-[#b9d4ef] underline underline-offset-4 decoration-[#2a4a6b]"
                >
                  {l.label}
                </a>
              </span>
            ))}
          </p>
        </header>

        <Section title="The numbers they stand behind">
          <ul className="space-y-4">
            {numbers.map((n, i) => (
              <li key={i} className="border-l-2 border-[#2a3242] pl-4">
                <p className="text-lg leading-snug mb-1">{n.claim}</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <Tier tier={n.tier} />
                  {n.adjudicated && (
                    <span className="text-[11px] uppercase tracking-wide text-[#6d7585]">
                      confirmed verbatim in interview
                    </span>
                  )}
                  <EvidenceChips evidence={n.evidence} artifactsById={artifactsById} />
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {artifacts.length > 0 && (
          <Section title="The receipts — click anything">
            <div className="grid gap-3 sm:grid-cols-2">
              {artifacts.map((a) => (
                <ArtifactCard key={a.id} art={a} />
              ))}
            </div>
          </Section>
        )}

        <Section title="Situated capabilities">
          <ul className="space-y-6">
            {capabilities.map((c, i) => (
              <li key={i}>
                <p className="text-lg mb-1">{c.capability}</p>
                <p className="text-sm text-[#a8b0c0] mb-2">{c.situation}</p>
                <div className="flex flex-wrap gap-2 items-center">
                  <Tier tier={c.tier} />
                  <EvidenceChips evidence={c.evidence} artifactsById={artifactsById} />
                </div>
              </li>
            ))}
          </ul>
        </Section>

        {experience.length > 0 && (
          <Section title="The seats held">
            <ul className="space-y-8">
              {experience.map((e, i) => (
                <li key={i} className="border-l-2 border-[#2a3242] pl-4">
                  <p className="text-lg leading-snug">{e.title}</p>
                  <p className="text-sm text-[#a8b0c0] mb-1">
                    {e.organization}
                    {fmtSpan(e.start, e.end) && (
                      <span className="text-[#6d7585]"> · {fmtSpan(e.start, e.end)}</span>
                    )}
                  </p>
                  {e.context && (
                    <p className="text-sm text-[#c8cedb] leading-relaxed mb-2">{e.context}</p>
                  )}
                  {(e.outcomes ?? []).length > 0 && (
                    <ul className="space-y-3">
                      {e.outcomes!.map((o, j) => (
                        <li key={j}>
                          <p className="text-sm text-[#c8cedb] mb-1">{o.claim}</p>
                          <div className="flex flex-wrap gap-2 items-center">
                            <Tier tier={o.tier} />
                            <EvidenceChips
                              evidence={o.evidence}
                              artifactsById={artifactsById}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

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

        {testimonials.length > 0 && (
          <Section title="On the record">
            <ul className="space-y-5">
              {testimonials.map((t, i) => (
                <li key={i} className="border-l-2 border-[#2a4a6b] pl-4">
                  <p className="text-[#c8cedb] leading-relaxed italic mb-1">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                  <p className="text-sm text-[#6d7585]">{t.attribution}</p>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {credentials.length > 0 && (
          <Section title="Credentials">
            <ul className="space-y-2">
              {credentials.map((c, i) => (
                <li key={i} className="text-sm text-[#c8cedb]">
                  {c.name}
                  {c.issuer && <span className="text-[#6d7585]"> — {c.issuer}</span>}
                  {c.date && <span className="text-[#6d7585]"> · {c.date}</span>}
                </li>
              ))}
            </ul>
          </Section>
        )}

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
