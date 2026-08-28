/**
 * Does the two-pass colour-cycling path sample the same points as the
 * single-pass path?
 *
 *   node web/scripts/check-sample-parity.mjs
 *
 * If these two disagree, toggling the colour animation shimmers along the
 * fractal boundary, because the cached counts were taken at slightly different
 * points than the direct render would have used. GLSL highp is float32, so
 * every operation below is rounded with Math.fround in the order the shader
 * writes it — an algebraically equivalent rearrangement is NOT good enough,
 * which is the whole point of this check.
 */
const f = Math.fround;

/** buildFragmentShader: (gl_FragCoord.xy - 0.5 + (vec2(sx,sy) + 0.5)/AA) / uResolution */
function singlePass(px, sx, aa, w) {
  const base = f(f(px + 0.5) - 0.5);
  const off = f(f(sx + 0.5) / f(aa));
  return f(f(base + off) / f(w));
}

/** buildCountShader as it ships: recover the index, reuse the same expression. */
function countPass(px, sx, aa, w) {
  const q = px * aa + sx; // ivec2(gl_FragCoord.xy)
  const pixel = Math.trunc(q / aa);
  const sample = q - pixel * aa;
  if (pixel !== px || sample !== sx) {
    throw new Error(`index recovery failed for q=${q}, AA=${aa}`);
  }
  const off = f(f(sample + 0.5) / f(aa));
  return f(f(f(pixel) + off) / f(w));
}

/** The tempting shortcut. Kept so the regression it causes stays visible. */
function countPassNaive(px, sx, aa, w) {
  return f(f(f(px * aa + sx) + 0.5) / f(w * aa));
}

const AA_VALUES = [1, 2, 3];
const WIDTHS = [640, 1280, 1920, 2560, 3840, 4096];

function compare(candidate) {
  let checked = 0;
  let mismatches = 0;
  let maxDelta = 0;
  const distinct = new Set();

  for (const aa of AA_VALUES) {
    for (const w of WIDTHS) {
      for (let px = 0; px < w; px++) {
        for (let sx = 0; sx < aa; sx++) {
          const expected = singlePass(px, sx, aa, w);
          const actual = candidate(px, sx, aa, w);
          checked++;
          distinct.add(expected);
          maxDelta = Math.max(maxDelta, Math.abs(expected - actual));
          if (expected !== actual) mismatches++;
        }
      }
    }
  }
  return { checked, mismatches, maxDelta, distinct: distinct.size };
}

const shipped = compare(countPass);
const naive = compare(countPassNaive);

// Reporting the distinct count matters: if the reference collapsed to a
// handful of values, any two implementations would agree and this would be a
// no-op dressed up as a validation.
console.log(`sample positions checked : ${shipped.checked}`);
console.log(`distinct uv values       : ${shipped.distinct}`);
console.log(
  `shipped form             : ${shipped.mismatches} mismatches, max delta ${shipped.maxDelta}`,
);
console.log(
  `naive gl_FragCoord/(res*AA): ${naive.mismatches} mismatches ` +
    `(${((100 * naive.mismatches) / naive.checked).toFixed(1)}%), max delta ${naive.maxDelta}`,
);

if (shipped.mismatches !== 0) {
  console.error("\nFAIL: the count pass no longer matches the single-pass path.");
  process.exit(1);
}
console.log("\nPASS: bit-identical.");
