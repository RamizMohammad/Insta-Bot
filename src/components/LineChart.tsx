// Two-series area/line chart drawn in SVG to match the Stitch dashboard chart, with an animated
// draw-in and a hover crosshair tooltip.
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";

export interface Series {
  label: string;
  values: number[];
  color: string;
  dashed?: boolean;
  gradientId: string;
  gradientOpacity: number;
}

const W = 760;
const H = 260;
const PAD = { left: 40, right: 20, top: 30, bottom: 30 };

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

function smoothPath(points: [number, number][]) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[Math.max(i - 1, 0)];
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    const [x3, y3] = points[Math.min(i + 2, points.length - 1)];
    const t = 0.18;
    d += ` C ${x1 + (x2 - x0) * t} ${Math.min(H - PAD.bottom, y1 + (y2 - y0) * t)}, ${x2 - (x3 - x1) * t} ${Math.min(H - PAD.bottom, y2 - (y3 - y1) * t)}, ${x2} ${y2}`;
  }
  return d;
}

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `${Math.round(n)}`);

export function LineChart({ labels, series }: { labels: string[]; series: Series[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const n = labels.length;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => PAD.left + 10 + (i * (W - PAD.left - PAD.right - 10)) / Math.max(n - 1, 1);
  const y = (v: number) => H - PAD.bottom - (v / max) * (H - PAD.top - PAD.bottom);

  const paths = useMemo(
    () =>
      series.map((s) => {
        const pts = s.values.map((v, i) => [x(i), y(v)] as [number, number]);
        const line = smoothPath(pts);
        const area = pts.length ? `${line} L ${x(n - 1)} ${H - PAD.bottom} L ${x(0)} ${H - PAD.bottom} Z` : "";
        return { line, area };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, max, n],
  );

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(n / 7));

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left - 10) / (W - PAD.left - PAD.right - 10)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const tipX = hover == null ? 0 : Math.min(Math.max(x(hover) - 65, PAD.left), W - 140);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full select-none overflow-visible text-outline-variant"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
      role="img"
      aria-label={`Chart of ${series.map((s) => s.label).join(" and ")} per day`}
    >
      <defs>
        {series.map((s) => (
          <linearGradient key={s.gradientId} id={s.gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity={s.gradientOpacity} />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {ticks.map((t, i) => (
        <g key={i}>
          <line
            stroke="currentColor"
            strokeDasharray={i === 0 ? undefined : "3 3"}
            strokeOpacity={i === 0 ? 0.5 : 0.35}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
          />
          <text fill="#757684" fontFamily="Inter" fontSize="10" textAnchor="end" x={PAD.left - 8} y={y(t) + 4}>
            {fmt(t)}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % labelEvery === 0 || i === n - 1 ? (
          <text key={i} fill="#757684" fontFamily="Inter" fontSize="10" x={x(i) - 14} y={H - 12}>
            {l}
          </text>
        ) : null,
      )}
      {series.map((s, si) => (
        <g key={s.label}>
          <motion.path
            d={paths[si].area}
            fill={`url(#${s.gradientId})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.3 }}
          />
          <motion.path
            d={paths[si].line}
            fill="none"
            stroke={s.color}
            strokeWidth={s.dashed ? 2 : 2.5}
            strokeDasharray={s.dashed ? "4 4" : undefined}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          />
        </g>
      ))}
      <AnimatePresence>
        {hover != null && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            <line stroke="#24389c" strokeDasharray="2 2" strokeOpacity="0.4" strokeWidth="1.5" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} />
            {series.map((s) => (
              <circle key={s.label} cx={x(hover)} cy={y(s.values[hover] ?? 0)} fill={s.color} r={s.dashed ? 4 : 5} stroke="#ffffff" strokeWidth={2.5} />
            ))}
            <g transform={`translate(${tipX}, 0)`}>
              <rect fill="#1b1b1f" fillOpacity="0.95" height={22 + series.length * 14} rx="8" width="140" />
              <text fill="#ffffff" fontFamily="Inter" fontSize="11" fontWeight="600" x="12" y="17">
                {labels[hover]}
              </text>
              {series.map((s, i) => (
                <text key={s.label} fill={i === 0 ? "#cacfff" : "#c3c5dd"} fontFamily="Inter" fontSize="11" x="12" y={32 + i * 14}>
                  {s.label}: {(s.values[hover] ?? 0).toLocaleString("en-US")}
                </text>
              ))}
            </g>
          </motion.g>
        )}
      </AnimatePresence>
    </svg>
  );
}
