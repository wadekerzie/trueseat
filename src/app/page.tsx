import Wordmark from "@/components/Wordmark";

export default function Home() {
  return (
    <main className="min-h-screen w-full bg-[#0e1116] text-[#e8eaf0] flex flex-col">
      <div className="mx-auto w-full max-w-3xl px-6 py-24 flex-1 flex flex-col justify-center">
        <Wordmark className="text-2xl mb-8" />
        <h1 className="text-4xl sm:text-5xl font-semibold leading-tight mb-6">
          Resumes are claims.
          <br />
          This is evidence.
        </h1>
        <p className="text-lg text-[#a8b0c0] leading-relaxed mb-4 max-w-2xl">
          TrueSeat interviews you the way a great colleague would after six
          months of working together, then builds a sealed, evidence-backed
          dossier of what you can actually do, how you actually operate, and
          what you actually need. You own every word of it.
        </p>
        <p className="text-lg text-[#a8b0c0] leading-relaxed mb-10 max-w-2xl">
          The right person in the right seat, proven instead of pitched.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <a
            href="/interview"
            className="rounded-md bg-[#6B9FD4] px-6 py-3 font-medium text-[#0e1116] hover:bg-[#8ab4e0] transition-colors"
          >
            Start free with your resume
          </a>
          <a
            href="/d/sample"
            className="rounded-md border border-[#2a3242] px-6 py-3 font-medium text-[#c8cedb] hover:border-[#6B9FD4] transition-colors"
          >
            See a sample dossier
          </a>
        </div>
        <div className="mt-6 max-w-2xl">
          <p className="text-sm text-[#6d7585] leading-relaxed">
            Your resume gets you what it&apos;s always gotten you. The interview is
            where you become more than it.
          </p>
          <p className="text-sm text-[#6d7585] mt-3">
            Launching August 2026. Built in public. Founding cohort:{" "}
            <a
              href="mailto:wade@kerzie.ai?subject=TrueSeat%20founding%20cohort"
              className="underline underline-offset-4 hover:text-[#8ab4e0]"
            >
              wade@kerzie.ai
            </a>
          </p>
        </div>
      </div>
      <footer className="mx-auto w-full max-w-3xl px-6 py-8 text-sm text-[#6d7585] border-t border-[#1c2230]">
        TrueSeat · a Kerzie AI build · trueseat.io
      </footer>
    </main>
  );
}
