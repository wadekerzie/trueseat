// The TrueSeat wordmark (brand option C, chosen 2026-07-18): "True" in ink,
// "Seat" in the accent blue, with the four verification-tier dots beneath —
// self-reported, artifact-backed, provenance-verified, witness-verified.

const DOT_COLORS = ["#2a3242", "#3a4456", "#6d7585", "#6B9FD4"];

export default function Wordmark({
  className = "",
  dots = true,
}: {
  className?: string;
  dots?: boolean;
}) {
  return (
    <span className={`inline-flex flex-col items-start gap-1.5 ${className}`}>
      <span className="font-bold tracking-tight leading-none">
        True<span className="text-[#6B9FD4]">Seat</span>
      </span>
      {dots && (
        <span className="flex gap-1.5" aria-hidden>
          {DOT_COLORS.map((c) => (
            <span
              key={c}
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: c }}
            />
          ))}
        </span>
      )}
    </span>
  );
}
