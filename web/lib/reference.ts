import { type BigFloat, fromNumber, mul, toNumber } from "./bigfloat";

/**
 * The high-precision reference orbit that perturbation rendering is built on.
 *
 * One orbit Z_n is iterated at full precision on the CPU; every pixel is then
 * expressed as a small deviation from it, which the GPU can carry in cheap
 * arithmetic. This is what removes the zoom ceiling: precision lives here, not
 * in the shader.
 *
 * Each entry is packed as (Zr_hi, Zr_lo, Zi_hi, Zi_lo) — the real and imaginary
 * parts split into float32 pairs, giving the shader ~48 mantissa bits.
 */
export interface ReferenceOrbit {
  /** RGBA32F texture data, 4 floats per iteration. */
  data: Float32Array;
  /** Number of valid entries (may be shorter than requested if it escaped). */
  length: number;
  centerX: BigFloat;
  centerY: BigFloat;
  /** Span the orbit was computed for; used to decide when to recompute. */
  spanY: number;
  maxIter: number;
}

const BAILOUT2 = fromNumber(65536);

export function computeReferenceOrbit(
  centerX: BigFloat,
  centerY: BigFloat,
  maxIter: number,
  spanY: number,
): ReferenceOrbit {
  const count = maxIter + 2;
  const data = new Float32Array(count * 4);

  let zr: BigFloat = 0n;
  let zi: BigFloat = 0n;
  let length = 0;

  for (let i = 0; i < count; i++) {
    const vr = toNumber(zr);
    const vi = toNumber(zi);

    const rHi = Math.fround(vr);
    const iHi = Math.fround(vi);
    data[i * 4 + 0] = rHi;
    data[i * 4 + 1] = Math.fround(vr - rHi);
    data[i * 4 + 2] = iHi;
    data[i * 4 + 3] = Math.fround(vi - iHi);
    length = i + 1;

    const zr2 = mul(zr, zr);
    const zi2 = mul(zi, zi);
    // The reference may escape; the shader rebases when it runs off the end.
    if (zr2 + zi2 > BAILOUT2) break;

    const nextZi = mul(zr + zr, zi) + centerY;
    zr = zr2 - zi2 + centerX;
    zi = nextZi;
  }

  return { data, length, centerX, centerY, spanY, maxIter };
}

/** Largest texture row width used when uploading an orbit. */
export const ORBIT_TEXTURE_WIDTH = 1024;

export function orbitTextureSize(length: number): [number, number] {
  const width = Math.min(ORBIT_TEXTURE_WIDTH, Math.max(1, length));
  const height = Math.ceil(length / width);
  return [width, height];
}

/**
 * Whether a cached orbit can still be used for this view. Reusing across small
 * pans is what keeps dragging smooth — recomputing every frame would stall.
 */
export function orbitIsUsable(
  orbit: ReferenceOrbit | null,
  centerX: BigFloat,
  centerY: BigFloat,
  spanY: number,
  maxIter: number,
): orbit is ReferenceOrbit {
  if (!orbit) return false;
  if (orbit.maxIter < maxIter) return false;
  // A much wider view pushes deltas outside the range the orbit linearises well.
  if (spanY > orbit.spanY * 4) return false;

  const dx = toNumber(centerX - orbit.centerX);
  const dy = toNumber(centerY - orbit.centerY);
  const reach = spanY * 0.5;
  return Math.abs(dx) <= reach && Math.abs(dy) <= reach;
}
