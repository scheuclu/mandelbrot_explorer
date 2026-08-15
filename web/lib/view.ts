import {
  type BigFloat,
  addNumber,
  fromNumber,
  fromString,
  toDecimalString,
  toNumber,
} from "./bigfloat";

/**
 * Viewport math and URL-hash serialization.
 *
 * The center is arbitrary-precision: past ~1e15x zoom a float64 can no longer
 * distinguish neighbouring pixels, so no amount of shader precision would help.
 * The span stays a plain number — it is small, and a double's exponent range
 * goes far deeper than any zoom we support.
 */

export interface View {
  centerX: BigFloat;
  centerY: BigFloat;
  spanY: number;
}

/** Vertical span of the fully zoomed-out view; also the zoom=1 reference. */
export const HOME_SPAN = 2.6;

export const HOME_VIEW: View = {
  centerX: fromNumber(-0.6),
  centerY: fromNumber(0),
  spanY: HOME_SPAN,
};

export const MAX_SPAN = 8;

/**
 * Practical floor. Perturbation itself has no precision ceiling, so what limits
 * us now is iteration count and patience rather than arithmetic.
 */
export const MIN_SPAN = 1e-60;

/** Below this span plain floats visibly block up, so a deep kernel is needed. */
export const DEEP_SPAN_THRESHOLD = 2e-4;

export function clampView(view: View): View {
  return {
    centerX: view.centerX,
    centerY: view.centerY,
    spanY: Math.min(MAX_SPAN, Math.max(MIN_SPAN, view.spanY)),
  };
}

export function zoomFactor(view: View): number {
  return HOME_SPAN / view.spanY;
}

/** Iteration budget that keeps detail visible as the zoom deepens. */
export function autoIterations(spanY: number): number {
  const zoom = Math.max(1, HOME_SPAN / spanY);
  return Math.min(24000, Math.round(120 + 90 * Math.log2(zoom)));
}

/**
 * Zoom by `factor` while keeping the complex point under (px, py) fixed.
 * (px, py) are CSS pixels from the top-left of a `width` x `height` canvas.
 */
export function zoomAt(
  view: View,
  factor: number,
  px: number,
  py: number,
  width: number,
  height: number,
): View {
  const spanX = view.spanY * (width / height);
  const fx = px / width - 0.5;
  const fy = 0.5 - py / height; // canvas y grows downward, imaginary axis upward

  const nextSpanY = Math.min(MAX_SPAN, Math.max(MIN_SPAN, view.spanY * factor));
  const nextSpanX = nextSpanY * (width / height);

  // center' = (center + fx*span) - fx*span'   — all offsets are tiny doubles,
  // so only the accumulated center needs high precision.
  return {
    centerX: addNumber(view.centerX, fx * spanX - fx * nextSpanX),
    centerY: addNumber(view.centerY, fy * view.spanY - fy * nextSpanY),
    spanY: nextSpanY,
  };
}

/** Pan by a pixel delta (as reported by pointer events). */
export function panByPixels(
  view: View,
  dxPixels: number,
  dyPixels: number,
  width: number,
  height: number,
): View {
  const spanX = view.spanY * (width / height);
  return {
    centerX: addNumber(view.centerX, -(dxPixels / width) * spanX),
    centerY: addNumber(view.centerY, (dyPixels / height) * view.spanY),
    spanY: view.spanY,
  };
}

/** Enough decimals to distinguish neighbouring pixels at the current zoom. */
export function coordDigits(spanY: number): number {
  return Math.min(80, Math.max(4, Math.ceil(-Math.log10(spanY)) + 4));
}

export function formatCoord(value: BigFloat, spanY: number): string {
  return toDecimalString(value, coordDigits(spanY));
}

export function formatZoom(view: View): string {
  const z = zoomFactor(view);
  if (z < 1000) return `${z.toFixed(1)}x`;
  return `${z.toExponential(2).replace("e+", "e")}x`;
}

// --- URL hash -------------------------------------------------------------

export interface SharedState extends View {
  palette?: string;
  maxIter?: number;
  colorCycle?: number;
  colorOffset?: number;
}

export function encodeHash(state: SharedState): string {
  const params = new URLSearchParams();
  const digits = coordDigits(state.spanY) + 4;
  params.set("x", toDecimalString(state.centerX, digits));
  params.set("y", toDecimalString(state.centerY, digits));
  // Drop the "+" from positive exponents: a literal + in a query string decodes
  // back as a space, which would silently break hand-edited or relayed links.
  params.set("s", state.spanY.toExponential(12).replace("e+", "e"));
  if (state.palette) params.set("p", state.palette);
  if (state.maxIter) params.set("i", String(state.maxIter));
  if (state.colorCycle) params.set("c", String(Math.round(state.colorCycle)));
  if (state.colorOffset) params.set("o", state.colorOffset.toFixed(3));
  return params.toString();
}

export function decodeHash(hash: string): SharedState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;

  const params = new URLSearchParams(raw);
  const num = (key: string): number | undefined => {
    const value = params.get(key);
    if (value === null) return undefined;
    // A relayed link may arrive with "+" already turned into a space.
    const parsed = Number(value.replace(/\s/g, "+"));
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const rawX = params.get("x");
  const rawY = params.get("y");
  const spanY = num("s");
  if (rawX === null || rawY === null || spanY === undefined) return null;

  return {
    centerX: fromString(rawX),
    centerY: fromString(rawY),
    spanY: Math.min(MAX_SPAN, Math.max(MIN_SPAN, spanY)),
    palette: params.get("p") ?? undefined,
    maxIter: num("i"),
    colorCycle: num("c"),
    colorOffset: num("o"),
  };
}

/** Coarse doubles for the shallow kernels, which do not need more. */
export function centerAsNumbers(view: View): [number, number] {
  return [toNumber(view.centerX), toNumber(view.centerY)];
}
