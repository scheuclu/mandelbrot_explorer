import { DEFAULT_PALETTE } from "./palettes";

export type PrecisionMode = "auto" | "single" | "double";

export interface Settings {
  palette: string;
  /** Derive the iteration cap from the zoom level. */
  autoIter: boolean;
  maxIter: number;
  /** Iterations per full sweep of the gradient. */
  colorCycle: number;
  /** Rotates the gradient, in sweeps. */
  colorOffset: number;
  /** Supersampling grid per axis once the view settles. */
  quality: number;
  /** Fraction of full resolution rendered while panning or zooming. */
  liveScale: number;
  precision: PrecisionMode;
}

export const DEFAULT_SETTINGS: Settings = {
  palette: DEFAULT_PALETTE,
  autoIter: true,
  maxIter: 500,
  colorCycle: 96,
  colorOffset: 0,
  quality: 2,
  liveScale: 0.5,
  precision: "auto",
};

export const QUALITY_OPTIONS = [
  { value: 1, label: "Off (1x)" },
  { value: 2, label: "Good (4x)" },
  { value: 3, label: "Best (9x)" },
];

export const LIVE_SCALE_OPTIONS = [
  { value: 0.3, label: "Fastest" },
  { value: 0.5, label: "Balanced" },
  { value: 1, label: "Full" },
];

export const PRECISION_OPTIONS: { value: PrecisionMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "single", label: "Single (fast)" },
  { value: "double", label: "Double (deep)" },
];
