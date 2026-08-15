"use client";

import type { Readout } from "./MandelbrotExplorer";
import { formatCoord, formatZoom } from "@/lib/view";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-white/40">{label} </span>
      <span className="tabular-nums text-white/80">{value}</span>
    </span>
  );
}

export function StatusBar({ readout }: { readout: Readout }) {
  const { view, maxIter, kernel, orbitLength, fps, atPrecisionFloor } = readout;

  const precisionLabel =
    kernel === "perturb"
      ? `perturbation (orbit ${orbitLength})`
      : kernel === "double"
        ? "double (48-bit)"
        : "single (24-bit)";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-x-5 gap-y-1 overflow-hidden bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8 font-mono text-[11px] leading-tight">
      <Field label="re" value={formatCoord(view.centerX, view.spanY)} />
      <Field label="im" value={formatCoord(view.centerY, view.spanY)} />
      <Field label="zoom" value={formatZoom(view)} />
      <Field label="iter" value={String(maxIter)} />
      <Field label="precision" value={precisionLabel} />
      <Field label="fps" value={fps > 0 ? fps.toFixed(0) : "–"} />
      {atPrecisionFloor && (
        <span className="whitespace-nowrap text-amber-300/90">
          precision floor reached — cannot zoom further
        </span>
      )}
    </div>
  );
}
