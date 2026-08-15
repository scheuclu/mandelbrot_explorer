/**
 * Fixed-point arbitrary-precision reals, backed by BigInt.
 *
 * A value is an integer `n` representing `n / 2^BF_BITS`. This exists because
 * the view center has to be more precise than a float64 once you zoom past
 * ~1e15x — at that point neighbouring pixels round to the same double and the
 * whole image collapses, no matter how good the shader is.
 *
 * Only the center needs this. Spans and per-pixel offsets stay plain numbers:
 * they are small, and a double's exponent range reaches far past any zoom we
 * support.
 */
export type BigFloat = bigint;

/** ~96 decimal digits, enough for zoom well past the iteration-count limit. */
export const BF_BITS = 320n;

const SCRATCH = new DataView(new ArrayBuffer(8));

export const ZERO: BigFloat = 0n;

/** Exact conversion from a double (no decimal round-trip). */
export function fromNumber(x: number): BigFloat {
  if (!Number.isFinite(x) || x === 0) return 0n;

  SCRATCH.setFloat64(0, x);
  const bits = SCRATCH.getBigUint64(0);
  const negative = (bits >> 63n) & 1n;
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = bits & 0xfffffffffffffn;

  // Subnormals have no implicit leading 1.
  const m = exponent === 0 ? mantissa : mantissa | (1n << 52n);
  const e = BigInt((exponent === 0 ? -1074 : exponent - 1075)) + BF_BITS;

  const n = e >= 0n ? m << e : m >> -e;
  return negative ? -n : n;
}

export function toNumber(v: BigFloat): number {
  if (v === 0n) return 0;
  const negative = v < 0n;
  const a = negative ? -v : v;
  // Shift down to ~64 significant bits first so Number() stays in range.
  const r = Number(a >> (BF_BITS - 64n)) / 2 ** 64;
  return negative ? -r : r;
}

export const add = (a: BigFloat, b: BigFloat): BigFloat => a + b;
export const sub = (a: BigFloat, b: BigFloat): BigFloat => a - b;
export const mul = (a: BigFloat, b: BigFloat): BigFloat => (a * b) >> BF_BITS;

/** Offset by a plain number — the common case for panning and zooming. */
export const addNumber = (a: BigFloat, x: number): BigFloat => a + fromNumber(x);

/** Parses "-0.7436438870371587047521915061147" at full precision. */
export function fromString(text: string): BigFloat {
  const trimmed = text.trim();
  if (!/^-?\d*(\.\d+)?([eE][-+]?\d+)?$/.test(trimmed) || trimmed === "") {
    return 0n;
  }

  // Exponent form is rare here (presets and URLs use plain decimals), so fall
  // back to double precision for it rather than implementing decimal scaling.
  if (/[eE]/.test(trimmed)) return fromNumber(Number(trimmed));

  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  const [intPart, fracPart = ""] = body.split(".");

  let value = (intPart === "" ? 0n : BigInt(intPart)) << BF_BITS;
  if (fracPart) {
    value += (BigInt(fracPart) << BF_BITS) / 10n ** BigInt(fracPart.length);
  }
  return negative ? -value : value;
}

/** Fixed-point decimal string with exactly `digits` fractional places. */
export function toDecimalString(v: BigFloat, digits: number): string {
  const negative = v < 0n;
  const a = negative ? -v : v;

  const intPart = a >> BF_BITS;
  const frac = a - (intPart << BF_BITS);
  const scaled = (frac * 10n ** BigInt(digits)) >> BF_BITS;

  const fracText = scaled.toString().padStart(digits, "0");
  return `${negative ? "-" : ""}${intPart}${digits > 0 ? `.${fracText}` : ""}`;
}

/**
 * Difference as a double. Only meaningful when the two are close, which is the
 * case wherever this is used (reusing a reference orbit across small pans).
 */
export const diffAsNumber = (a: BigFloat, b: BigFloat): number => toNumber(a - b);
