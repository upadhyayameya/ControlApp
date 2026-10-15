import { formatNumber } from "@/lib/format";
import type { BenchmarkBand, BenchmarkRange } from "@/lib/types";

const CX = 160;
const CY = 150;
const R = 118;
const W = 20;

function polar(angle: number, r: number) {
  return { x: CX + r * Math.cos(angle), y: CY - r * Math.sin(angle) };
}

/** Arc between two values on a 0…max semicircle (left = 0, right = max). */
function arc(from: number, to: number, max: number, gapDeg = 1) {
  const gap = (gapDeg * Math.PI) / 180;
  const a1 = Math.PI * (1 - from / max) - (from > 0 ? gap : 0);
  const a2 = Math.PI * (1 - to / max) + (to < max ? gap : 0);
  const p1 = polar(a1, R);
  const p2 = polar(a2, R);
  return `M ${p1.x} ${p1.y} A ${R} ${R} 0 0 1 ${p2.x} ${p2.y}`;
}

export const bandLabel: Record<BenchmarkBand, string> = { good: "Good", typical: "Typical", poor: "Poor" };

/**
 * Semicircular benchmark gauge. Bands are labelled in text (colour is never
 * the only cue) and the component exposes a text alternative via aria-label.
 */
export function Gauge({
  value,
  benchmark,
  band,
  unit,
}: {
  value: number;
  benchmark: BenchmarkRange;
  band: BenchmarkBand;
  unit: string;
}) {
  const max = Math.max(benchmark.poorMin * 1.4, value * 1.08);
  const clamped = Math.min(value, max);
  const needle = polar(Math.PI * (1 - clamped / max), R - W / 2 - 14);
  const segments: { key: BenchmarkBand; from: number; to: number; color: string }[] = [
    { key: "good", from: 0, to: benchmark.goodMax, color: "var(--good)" },
    { key: "typical", from: benchmark.goodMax, to: benchmark.poorMin, color: "var(--typical)" },
    { key: "poor", from: benchmark.poorMin, to: max, color: "var(--poor)" },
  ];
  const label = `${formatNumber(value)} ${unit}: ${bandLabel[band]}. Good is at or below ${formatNumber(
    benchmark.goodMax,
  )}, poor is above ${formatNumber(benchmark.poorMin)}.`;

  return (
    <figure className="w-full">
      <svg viewBox="0 0 320 190" role="img" aria-label={label} className="mx-auto w-full max-w-sm">
        {segments.map((s) => (
          <path
            key={s.key}
            d={arc(s.from, s.to, max)}
            stroke={s.color}
            strokeWidth={W}
            fill="none"
            opacity={s.key === band ? 1 : 0.35}
          />
        ))}
        {/* Threshold ticks */}
        {[benchmark.goodMax, benchmark.poorMin].map((t) => {
          const a = Math.PI * (1 - t / max);
          const p = polar(a, R + W / 2 + 12);
          return (
            <text key={t} x={p.x} y={p.y} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {formatNumber(t)}
            </text>
          );
        })}
        {/* Needle */}
        <line x1={CX} y1={CY} x2={needle.x} y2={needle.y} stroke="var(--fg)" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={CX} cy={CY} r={6} fill="var(--fg)" stroke="var(--bg-elevated)" strokeWidth={2} />
        <text x={CX} y={CY + 30} textAnchor="middle" fontSize="12" fill="var(--muted)">
          {unit}
        </text>
      </svg>
      <figcaption className="mt-2 flex justify-center gap-4 text-xs text-muted">
        {segments.map((s) => (
          <span key={s.key} className={`inline-flex items-center gap-1.5 ${s.key === band ? "font-medium text-fg" : ""}`}>
            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {bandLabel[s.key]}
            {s.key === band && " (you)"}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
