/**
 * Viewport math and URL-hash serialization.
 *
 * A view is a center point in the complex plane plus the vertical span the
 * canvas covers. The horizontal span follows from the canvas aspect ratio, so
 * resizing the window never distorts the set.
 */

export interface View {
  centerX: number;
  centerY: number;
  spanY: number;
}

/** Vertical span of the fully zoomed-out view; also the zoom=1 reference. */
export const HOME_SPAN = 2.6;

export const HOME_VIEW: View = { centerX: -0.6, centerY: 0, spanY: HOME_SPAN };

export const MAX_SPAN = 8;

/**
 * Zooming past this turns the image to mush: double-single arithmetic carries
 * ~48 mantissa bits, which runs out a little below 1e-12 for coordinates of
 * order 1.
 */
export const MIN_SPAN = 1e-13;

/** Below this span the plain-float kernel visibly blocks up, so switch to df64. */
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
  return Math.min(6000, Math.round(120 + 90 * Math.log2(zoom)));
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

  const anchorRe = view.centerX + fx * spanX;
  const anchorIm = view.centerY + fy * view.spanY;

  const nextSpanY = Math.min(MAX_SPAN, Math.max(MIN_SPAN, view.spanY * factor));
  const nextSpanX = nextSpanY * (width / height);

  return {
    centerX: anchorRe - fx * nextSpanX,
    centerY: anchorIm - fy * nextSpanY,
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
    centerX: view.centerX - (dxPixels / width) * spanX,
    centerY: view.centerY + (dyPixels / height) * view.spanY,
    spanY: view.spanY,
  };
}

/** Enough decimals to distinguish neighbouring pixels at the current zoom. */
export function formatCoord(value: number, spanY: number): string {
  const decimals = Math.min(20, Math.max(4, Math.ceil(-Math.log10(spanY)) + 4));
  return value.toFixed(decimals);
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
  // toPrecision(17) round-trips a double exactly.
  params.set("x", state.centerX.toPrecision(17));
  params.set("y", state.centerY.toPrecision(17));
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

  const centerX = num("x");
  const centerY = num("y");
  const spanY = num("s");
  if (centerX === undefined || centerY === undefined || spanY === undefined) {
    return null;
  }

  return {
    centerX,
    centerY,
    spanY: Math.min(MAX_SPAN, Math.max(MIN_SPAN, spanY)),
    palette: params.get("p") ?? undefined,
    maxIter: num("i"),
    colorCycle: num("c"),
    colorOffset: num("o"),
  };
}
