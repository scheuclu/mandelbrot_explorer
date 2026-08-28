import { DEFAULT_PALETTE } from "./palettes";

export type PrecisionMode = "auto" | "single" | "double" | "perturb";

export interface Settings {
  palette: string;
  /** Derive the iteration cap from the zoom level. */
  autoIter: boolean;
  maxIter: number;
  /** Iterations per full sweep of the gradient. */
  colorCycle: number;
  /** Rotates the gradient, in sweeps. */
  colorOffset: number;
  /** Rotate the gradient continuously. */
  animate: boolean;
  /** Gradient sweeps per second while animating. */
  animateSpeed: number;
  animateReverse: boolean;
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
  animate: false,
  animateSpeed: 0.2,
  animateReverse: false,
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
  { value: "double", label: "Double (to 1e12x)" },
  { value: "perturb", label: "Perturbation (unlimited)" },
];

export const ANIMATE_SPEED = { min: 0.02, max: 1, step: 0.02 };

/**
 * Fold an offset back into one period. The sawtooth ramp repeats every 1 and
 * the ping-pong ramp every 2, so 2 is a whole number of cycles for both — and
 * wrapping keeps the accumulated float from drifting over a long run.
 */
export function wrapColorOffset(offset: number): number {
  return ((offset % 2) + 2) % 2;
}
