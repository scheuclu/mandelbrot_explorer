"use client";

import { useId, useState } from "react";

import type { ExportProgress, ExportSizeId } from "@/lib/download";
import { PALETTES } from "@/lib/palettes";
import { PRESETS } from "@/lib/presets";
import {
  ANIMATE_SPEED,
  LIVE_SCALE_OPTIONS,
  PRECISION_OPTIONS,
  QUALITY_OPTIONS,
  type Settings,
} from "@/lib/settings";

/** One entry of the export size picker, prepared by the explorer. */
export interface ExportOption {
  id: ExportSizeId;
  label: string;
  /** Set when this size cannot be produced here; `note` says why. */
  disabled: boolean;
  note: string | null;
}

interface ControlPanelProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onPreset: (id: string) => void;
  onReset: () => void;
  onCopyLink: () => void;
  copied: boolean;
  onSavePng: () => void;
  exporting: boolean;
  exportProgress: ExportProgress | null;
  exportOptions: readonly ExportOption[];
  exportSize: ExportSizeId;
  onExportSizeChange: (id: ExportSizeId) => void;
  onInvalidate: () => void;
  onShowInfo: () => void;
  /** Owned by the explorer: stopping has to fold the rotation back in. */
  onToggleAnimate: () => void;
}

const FIELD =
  "w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-white/90 outline-none transition focus:border-white/30 focus:bg-white/10";

const BUTTON =
  "rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/25 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-white/40">
        {label}
      </span>
      {children}
    </label>
  );
}

function Slider({
  value,
  min,
  max,
  step,
  onChange,
  display,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  display: string;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-white/40">
          {label}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-white/70">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-amber-400"
        aria-label={label}
      />
    </div>
  );
}

export function ControlPanel({
  settings,
  onChange,
  onPreset,
  onReset,
  onCopyLink,
  copied,
  onSavePng,
  exporting,
  exportProgress,
  exportOptions,
  exportSize,
  onExportSizeChange,
  onInvalidate,
  onShowInfo,
  onToggleAnimate,
}: ControlPanelProps) {
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const chosenExport = exportOptions.find((option) => option.id === exportSize);
  const exportPercent = Math.round((exportProgress?.fraction ?? 0) * 100);

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onChange({ ...settings, [key]: value });
    onInvalidate();
  };

  // inset-y-0 plus min-h-0 on the panel lets it scroll instead of running off
  // the bottom of the viewport; pb-10 keeps it clear of the status bar.
  return (
    <aside
      aria-label="Render settings"
      className="pointer-events-none absolute inset-y-0 left-0 z-20 flex flex-col p-3 pb-10"
    >
      <div className="pointer-events-auto mb-2 flex items-center gap-2 self-start">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-controls={panelId}
          className="rounded-md border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur transition hover:bg-black/80"
        >
          {open ? "Hide controls" : "Show controls"}
        </button>
        <button
          type="button"
          onClick={onShowInfo}
          aria-label="How to use this explorer"
          title="How to use this explorer"
          className="rounded-md border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-white/60 backdrop-blur transition hover:bg-black/80 hover:text-white/90"
        >
          ?
        </button>
      </div>

      {open && (
        <div
          id={panelId}
          className="pointer-events-auto min-h-0 w-64 space-y-4 overflow-y-auto rounded-xl border border-white/10 bg-black/65 p-4 shadow-2xl backdrop-blur-md"
        >
          <Row label="Location">
            <select
              className={FIELD}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) onPreset(event.target.value);
                event.target.value = "";
              }}
            >
              <option value="" disabled>
                Jump to…
              </option>
              {PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Palette">
            <select
              className={FIELD}
              value={settings.palette}
              onChange={(event) => update("palette", event.target.value)}
            >
              {PALETTES.map((palette) => (
                <option key={palette.id} value={palette.id}>
                  {palette.label}
                </option>
              ))}
            </select>
          </Row>

          <Slider
            label="Color cycle"
            value={settings.colorCycle}
            min={8}
            max={1024}
            step={1}
            display={`${settings.colorCycle} it`}
            onChange={(value) => update("colorCycle", value)}
          />

          <Slider
            label="Color shift"
            value={settings.colorOffset}
            min={0}
            max={2}
            step={0.01}
            display={settings.colorOffset.toFixed(2)}
            onChange={(value) => update("colorOffset", value)}
          />

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onToggleAnimate}
                aria-pressed={settings.animate}
                className={`${BUTTON} flex-1`}
              >
                {settings.animate ? "Pause cycling" : "Cycle colors"}
              </button>
              <button
                type="button"
                onClick={() => update("animateReverse", !settings.animateReverse)}
                aria-pressed={settings.animateReverse}
                aria-label="Reverse cycling direction"
                title="Reverse cycling direction"
                className={BUTTON}
              >
                {settings.animateReverse ? "Rev" : "Fwd"}
              </button>
            </div>

            <Slider
              label="Cycle speed"
              value={settings.animateSpeed}
              min={ANIMATE_SPEED.min}
              max={ANIMATE_SPEED.max}
              step={ANIMATE_SPEED.step}
              display={`${settings.animateSpeed.toFixed(2)}/s`}
              onChange={(value) => update("animateSpeed", value)}
            />
          </div>

          <div className="space-y-2 border-t border-white/10 pt-3">
            <label className="flex items-center justify-between text-xs text-white/70">
              <span>Auto iterations</span>
              <input
                type="checkbox"
                checked={settings.autoIter}
                onChange={(event) => update("autoIter", event.target.checked)}
                className="accent-amber-400"
              />
            </label>
            {!settings.autoIter && (
              <Slider
                label="Iterations"
                value={settings.maxIter}
                min={50}
                max={6000}
                step={50}
                display={String(settings.maxIter)}
                onChange={(value) => update("maxIter", value)}
              />
            )}
          </div>

          <Row label="Anti-aliasing">
            <select
              className={FIELD}
              value={settings.quality}
              onChange={(event) => update("quality", Number(event.target.value))}
            >
              {QUALITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="While moving">
            <select
              className={FIELD}
              value={settings.liveScale}
              onChange={(event) => update("liveScale", Number(event.target.value))}
            >
              {LIVE_SCALE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Row>

          <Row label="Precision">
            <select
              className={FIELD}
              value={settings.precision}
              onChange={(event) =>
                update("precision", event.target.value as Settings["precision"])
              }
            >
              {PRECISION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Row>

          <div className="space-y-2 border-t border-white/10 pt-3">
            <Row label="Export">
              <select
                className={FIELD}
                value={exportSize}
                onChange={(event) =>
                  onExportSizeChange(event.target.value as ExportSizeId)
                }
              >
                {exportOptions.map((option) => (
                  <option
                    key={option.id}
                    value={option.id}
                    disabled={option.disabled}
                  >
                    {option.label}
                    {option.disabled ? " — unavailable" : ""}
                  </option>
                ))}
              </select>
            </Row>
            {chosenExport?.note && !exporting && (
              <p
                className={`text-[11px] leading-snug ${
                  chosenExport.disabled ? "text-amber-300/90" : "text-white/40"
                }`}
              >
                {chosenExport.note}
              </p>
            )}
            <button
              type="button"
              onClick={onSavePng}
              disabled={exporting || chosenExport?.disabled}
              className={`${BUTTON} w-full`}
            >
              {exporting ? `Rendering… ${exportPercent}%` : "Save PNG"}
            </button>
            {exporting && (
              <div className="space-y-1">
                <div
                  role="progressbar"
                  aria-label="Export progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={exportPercent}
                  className="h-1 w-full overflow-hidden rounded-full bg-white/10"
                >
                  <div
                    className="h-full rounded-full bg-amber-400 transition-[width] duration-150"
                    style={{ width: `${exportPercent}%` }}
                  />
                </div>
                <p className="text-[11px] text-white/40">
                  {exportProgress?.note ?? "Working"}
                </p>
              </div>
            )}
          </div>

          <div className="flex gap-2 border-t border-white/10 pt-3">
            <button type="button" onClick={onReset} className={`${BUTTON} flex-1`}>
              Reset
            </button>
            <button
              type="button"
              onClick={onCopyLink}
              className={`${BUTTON} flex-1`}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>

          <p className="border-t border-white/10 pt-3 text-[11px] leading-relaxed text-white/40">
            Drag to pan, scroll or pinch to zoom, double-click to zoom in
            (shift to zoom out). Arrow keys pan, <kbd>+</kbd>/<kbd>-</kbd> zoom,
            <kbd> 0</kbd> resets, <kbd>Space</kbd> cycles colors.
          </p>
        </div>
      )}
    </aside>
  );
}
