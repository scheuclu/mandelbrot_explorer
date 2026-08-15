import { fromString } from "./bigfloat";
import type { View } from "./view";
import { HOME_VIEW } from "./view";

export interface Preset {
  id: string;
  label: string;
  view: View;
  /** Palette that flatters this region; falls back to the current one. */
  palette?: string;
}

/** Centers are decimal strings so they can carry more digits than a double. */
function at(x: string, y: string, spanY: number): View {
  return { centerX: fromString(x), centerY: fromString(y), spanY };
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
    view: at("-0.7450450892059", "0.1126120218022", 0.0216),
    palette: "inferno",
  },
  {
    id: "seahorse",
    label: "Seahorse valley",
    view: at("-0.743643887037151", "0.13182590420533", 5e-5),
    palette: "ultra",
  },
  {
    id: "elephant",
    label: "Elephant valley",
    view: at("0.2925755", "0.0149977", 4e-4),
    palette: "inferno",
  },
  {
    id: "triple-spiral",
    label: "Triple spiral",
    view: at("-0.088", "0.654", 0.014),
    palette: "viridis",
  },
  {
    id: "mini-brot",
    label: "Mini Mandelbrot",
    view: at("-1.7687852", "0.0017396", 3.2e-5),
    palette: "ultra",
  },
  {
    id: "deep-spiral",
    label: "Deep spiral (1e9x)",
    view: at("-0.74365410092731", "0.13183681463565058", 2.54e-9),
    palette: "ultra",
  },
  {
    id: "deep-dive",
    label: "Deep dive (2.6e11x)",
    view: at("0.2924753753377754", "0.015073372040153767", 1e-11),
    palette: "inferno",
  },
  {
    id: "perturb-deep",
    label: "Perturbation (1.9e24x)",
    // Needs far more digits than a double holds, and is ~12 orders of magnitude
    // past the df64 ceiling — only the perturbation kernel plus the
    // arbitrary-precision center can render this at all.
    view: at(
      "-0.7436434641288119629495898567836444",
      "0.1318275467339766219670103391039002",
      1.371e-24,
    ),
    palette: "ultra",
  },
];
