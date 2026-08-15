import type { View } from "./view";
import { HOME_VIEW } from "./view";

export interface Preset {
  id: string;
  label: string;
  view: View;
  /** Palette that flatters this region; falls back to the current one. */
  palette?: string;
}

export const PRESETS: Preset[] = [
  {
    id: "home",
    label: "Full set",
    view: HOME_VIEW,
  },
  {
    id: "python-default",
    label: "Python default",
    view: {
      centerX: -0.7450450892059,
      centerY: 0.1126120218022,
      spanY: 0.0216,
    },
    palette: "inferno",
  },
  {
    id: "seahorse",
    label: "Seahorse valley",
    view: { centerX: -0.743643887037151, centerY: 0.13182590420533, spanY: 5e-5 },
    palette: "ultra",
  },
  {
    id: "elephant",
    label: "Elephant valley",
    view: { centerX: 0.2925755, centerY: 0.0149977, spanY: 4e-4 },
    palette: "inferno",
  },
  {
    id: "triple-spiral",
    label: "Triple spiral",
    view: { centerX: -0.088, centerY: 0.654, spanY: 0.014 },
    palette: "viridis",
  },
  {
    id: "mini-brot",
    label: "Mini Mandelbrot",
    view: { centerX: -1.7687852, centerY: 0.0017396, spanY: 3.2e-5 },
    palette: "ultra",
  },
  {
    id: "deep-spiral",
    label: "Deep spiral (1e9x)",
    view: {
      centerX: -0.74365410092731,
      centerY: 0.13183681463565058,
      spanY: 2.54e-9,
    },
    palette: "ultra",
  },
  {
    id: "deep-dive",
    label: "Deep dive (2.6e11x)",
    view: {
      centerX: 0.2924753753377754,
      centerY: 0.015073372040153767,
      spanY: 1e-11,
    },
    palette: "inferno",
  },
];
