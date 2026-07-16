import InterviewClient from "./InterviewClient";

// The interview needs a durable session store and the ears service. On Vercel
// the local file store is ephemeral, so the flow stays gated until Supabase
// and Cloud Run are wired (set INTERVIEW_ENABLED=true to open it).
const enabled =
  process.env.INTERVIEW_ENABLED === "true" || !process.env.VERCEL;

export default function InterviewPage() {
  if (!enabled) {
    return (
      <main className="min-h-screen bg-[#0e1116] text-[#e8eaf0] flex flex-col">
        <div className="mx-auto w-full max-w-2xl px-6 py-16 my-auto">
          <p className="text-xs tracking-[0.25em] uppercase text-[#7fa6d9] mb-10">
            TrueSeat Interview
          </p>
          <h1 className="text-3xl font-semibold mb-4">Almost ready.</h1>
          <p className="text-[#a8b0c0] leading-relaxed">
            The interview opens with the founding cohort in August 2026. Want in
            early?{" "}
            <a
              className="underline underline-offset-4 text-[#7fa6d9]"
              href="mailto:wade@kerzie.ai?subject=TrueSeat%20founding%20cohort"
            >
              Say hello.
            </a>
          </p>
        </div>
      </main>
    );
  }
  return <InterviewClient />;
}
