/**
 * Palette metadata. The numeric `index` must match the `uPalette` branches in
 * `buildFragmentShader()` (lib/shader.ts).
 *
 * `cyclic` palettes wrap seamlessly, so the shader feeds them a sawtooth ramp.
 * Everything else gets a ping-pong (triangle) ramp so repeated sweeps never
 * show a hard seam where the gradient's two ends meet.
 */
export interface PaletteInfo {
  id: string;
  index: number;
  label: string;
  cyclic: boolean;
}

export const PALETTES: PaletteInfo[] = [
  { id: "inferno", index: 0, label: "Inferno", cyclic: false },
  { id: "original", index: 1, label: "Original", cyclic: false },
  { id: "sqrt", index: 2, label: "Sqrt", cyclic: false },
  { id: "cyclic", index: 3, label: "Cyclic", cyclic: true },
  { id: "viridis", index: 4, label: "Viridis", cyclic: false },
  { id: "ultra", index: 5, label: "Ultra Fractal", cyclic: true },
  { id: "grayscale", index: 6, label: "Grayscale", cyclic: false },
];

export const DEFAULT_PALETTE = "ultra";

export function paletteById(id: string): PaletteInfo {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function paletteIndex(id: string): number {
  return paletteById(id).index;
}
