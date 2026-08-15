/**
 * GLSL ES 3.00 sources for the Mandelbrot renderer.
 *
 * Two escape-time kernels are generated from the same template:
 *
 *   - single: plain `float` (32-bit) arithmetic. Fast, but the mantissa runs
 *     out around a viewport span of ~1e-4 and the image turns blocky.
 *   - deep:   "double-single" (df64) arithmetic — each number is an unevaluated
 *     sum of two floats, giving ~48 bits of mantissa. Roughly 10x slower but
 *     usable down to a span of ~1e-12.
 *
 * The anti-aliasing factor is baked in as a compile-time constant so the sample
 * loop unrolls; programs are cached per (deep, aa) pair by the renderer.
 */

/** Full-screen triangle generated from gl_VertexID — no vertex buffers needed. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

const PALETTE_GLSL = `
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

// Polynomial fits of the matplotlib colormaps (sRGB space).
vec3 pal_inferno(float t) {
  const vec3 c0 = vec3(0.00021894, 0.00165100, -0.01948090);
  const vec3 c1 = vec3(0.10651342, 0.56395644, 3.93271239);
  const vec3 c2 = vec3(11.6024931, -3.97285397, -15.9423941);
  const vec3 c3 = vec3(-41.7039961, 17.4363989, 44.3541452);
  const vec3 c4 = vec3(77.1629357, -33.4023589, -81.8073093);
  const vec3 c5 = vec3(-71.3194282, 32.6260643, 73.2095199);
  const vec3 c6 = vec3(25.1311262, -12.2426690, -23.0703250);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}

vec3 pal_viridis(float t) {
  const vec3 c0 = vec3(0.27772733, 0.00540734, 0.33409981);
  const vec3 c1 = vec3(0.10509304, 1.40461353, 1.38459016);
  const vec3 c2 = vec3(-0.33086183, 0.21484756, 0.09509516);
  const vec3 c3 = vec3(-4.63423050, -5.79910097, -19.3324410);
  const vec3 c4 = vec3(6.22826994, 14.1799334, 56.6905526);
  const vec3 c5 = vec3(4.77638500, -13.7451454, -65.3530326);
  const vec3 c6 = vec3(-5.43545586, 4.64585261, 26.3124352);
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
}

// Ported from main.py: frac + 0.2*sin(frac * 2k*PI) per channel.
vec3 pal_original(float f) {
  return vec3(
    f + 0.2 * sin(f * 2.0 * PI),
    f + 0.2 * sin(f * 4.0 * PI),
    f + 0.2 * sin(f * 6.0 * PI)
  );
}

// Ported from main.py: three sine waves 120 degrees apart.
vec3 pal_cyclic(float f) {
  float a = f * 6.0 * PI;
  return 0.5 + 0.5 * vec3(sin(a), sin(a + TAU / 3.0), sin(a + 2.0 * TAU / 3.0));
}

// The classic Ultra Fractal gradient: deep blue -> white -> gold -> black.
vec3 pal_ultra(float t) {
  const vec3 k0 = vec3(0.0000, 0.0275, 0.3922);
  const vec3 k1 = vec3(0.1255, 0.4196, 0.7961);
  const vec3 k2 = vec3(0.9294, 1.0000, 1.0000);
  const vec3 k3 = vec3(1.0000, 0.6667, 0.0000);
  const vec3 k4 = vec3(0.0000, 0.0078, 0.0000);
  if (t < 0.1600) return mix(k0, k1, t / 0.1600);
  if (t < 0.4200) return mix(k1, k2, (t - 0.1600) / 0.2600);
  if (t < 0.6425) return mix(k2, k3, (t - 0.4200) / 0.2225);
  if (t < 0.8575) return mix(k3, k4, (t - 0.6425) / 0.2150);
  return mix(k4, k0, (t - 0.8575) / 0.1425);
}

vec3 shade(float sn) {
  float u = sn / uColorCycle + uColorOffset;
  // Ping-pong for open-ended gradients, sawtooth for the seamless ones.
  float tri = abs(fract(u * 0.5) * 2.0 - 1.0);
  float saw = fract(u);
  vec3 c;
  if (uPalette == 0) c = pal_inferno(tri);
  else if (uPalette == 1) c = pal_original(tri);
  else if (uPalette == 2) c = pal_original(sqrt(tri));
  else if (uPalette == 3) c = pal_cyclic(saw);
  else if (uPalette == 4) c = pal_viridis(tri);
  else if (uPalette == 5) c = pal_ultra(saw);
  else c = vec3(tri);
  return clamp(c, 0.0, 1.0);
}
`;

/**
 * Double-single arithmetic (Dekker / Knuth error-free transformations).
 * A value is a vec2 (hi, lo) whose true value is hi + lo, with |lo| <= ulp(hi)/2.
 */
const DF64_GLSL = `
vec2 dfAdd(vec2 a, vec2 b) {
  float s = a.x + b.x;
  float v = s - a.x;
  float e = (a.x - (s - v)) + (b.x - v) + a.y + b.y;
  float hi = s + e;
  return vec2(hi, e - (hi - s));
}

vec2 dfMul(vec2 a, vec2 b) {
  // Veltkamp split at 2^13+1 halves the 24-bit mantissa exactly.
  const float SPLIT = 8193.0;
  float ca = SPLIT * a.x;
  float cb = SPLIT * b.x;
  float ahi = ca - (ca - a.x);
  float bhi = cb - (cb - b.x);
  float alo = a.x - ahi;
  float blo = b.x - bhi;

  float p = a.x * b.x;
  float err = ((ahi * bhi - p) + ahi * blo + alo * bhi) + alo * blo;
  float cross = a.x * b.y + a.y * b.x;

  float s = p + cross;
  float v = s - p;
  float e = ((cross - v) + (p - (s - v))) + err + a.y * b.y;
  float hi = s + e;
  return vec2(hi, e - (hi - s));
}
`;

const ESCAPE_SINGLE = `
// Cardioid / period-2 bulb rejection. The thresholds are shrunk slightly so
// pixels near the boundary fall through to the full iteration instead of being
// misclassified by float rounding.
bool insideMainBody(vec2 c) {
  float y2 = c.y * c.y;
  float xm = c.x - 0.25;
  float q = xm * xm + y2;
  if (q * (q + xm) < 0.2497 * y2) return true;
  float xp = c.x + 1.0;
  return xp * xp + y2 < 0.06245;
}

float escape(vec2 c) {
  if (insideMainBody(c)) return -1.0;
  vec2 z = vec2(0.0);
  for (int i = 0; i < uMaxIter; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    float m2 = dot(z, z);
    if (m2 > BAILOUT2) return smoothCount(i, m2);
  }
  return -1.0;
}
`;

const ESCAPE_DEEP = `
float escape(vec2 crHi, vec2 ciHi) {
  vec2 zr = vec2(0.0);
  vec2 zi = vec2(0.0);
  for (int i = 0; i < uMaxIter; i++) {
    vec2 zr2 = dfMul(zr, zr);
    vec2 zi2 = dfMul(zi, zi);
    vec2 nzi = dfAdd(dfMul(dfAdd(zr, zr), zi), ciHi);
    vec2 nzr = dfAdd(dfAdd(zr2, -zi2), crHi);
    zr = nzr;
    zi = nzi;
    float m2 = zr.x * zr.x + zi.x * zi.x;
    if (m2 > BAILOUT2) return smoothCount(i, m2);
  }
  return -1.0;
}
`;

export interface ShaderVariant {
  /** Use emulated double precision instead of plain floats. */
  deep: boolean;
  /** Supersampling grid size per axis: 1 = off, 2 = 4 samples, 3 = 9 samples. */
  aa: number;
}

export function buildFragmentShader({ deep, aa }: ShaderVariant): string {
  const samplePos = `(gl_FragCoord.xy - 0.5 + (vec2(float(sx), float(sy)) + 0.5) / float(AA)) / uResolution`;

  // In the deep path the pixel offset stays a plain float (it is tiny relative
  // to the coordinates), but the add against the center must be done in df64.
  const sampleColor = deep
    ? `
      vec2 off = (uv - 0.5) * uSpan;
      float sn = escape(dfAdd(uCenterX, vec2(off.x, 0.0)),
                        dfAdd(uCenterY, vec2(off.y, 0.0)));`
    : `
      vec2 off = (uv - 0.5) * uSpan;
      float sn = escape(vec2(uCenterX.x + off.x, uCenterY.x + off.y));`;

  return `#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2 uResolution;
uniform vec2 uCenterX;     // (hi, lo) split of the real center
uniform vec2 uCenterY;     // (hi, lo) split of the imaginary center
uniform vec2 uSpan;        // viewport size in the complex plane
uniform int  uMaxIter;
uniform int  uPalette;
uniform float uColorCycle;
uniform float uColorOffset;
uniform vec3 uInteriorColor;

const int AA = ${aa};
const float BAILOUT2 = 65536.0;  // escape radius 256, keeps the smoothing accurate
const float LN2 = 0.69314718056;

// Continuous escape count: iteration index plus the fractional overshoot, so
// the coloring has no visible iteration bands.
float smoothCount(int i, float m2) {
  return float(i) + 1.0 - log2(0.5 * log(m2) / LN2);
}

${PALETTE_GLSL}
${deep ? DF64_GLSL : ""}
${deep ? ESCAPE_DEEP : ESCAPE_SINGLE}

void main() {
  vec3 acc = vec3(0.0);
  for (int sy = 0; sy < AA; sy++) {
    for (int sx = 0; sx < AA; sx++) {
      vec2 uv = ${samplePos};
      ${sampleColor}
      acc += sn < 0.0 ? uInteriorColor : shade(sn);
    }
  }
  fragColor = vec4(acc / float(AA * AA), 1.0);
}
`;
}
