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

/**
 * Perturbation kernel with Zhuoran rebasing.
 *
 * Instead of iterating each pixel's own coordinate, iterate its deviation from
 * a shared high-precision reference orbit:
 *
 *     delta_{n+1} = 2*Z_n*delta_n + delta_n^2 + delta_c
 *
 * The deviation only needs *relative* precision, so it never runs out of
 * exponent the way an absolute coordinate does — the zoom ceiling disappears.
 *
 * The delta is carried in df64 rather than plain floats. That is not optional:
 * with float32 deltas, escape counts diverge from ground truth on several
 * percent of pixels once past a few thousand iterations.
 *
 * Rebasing handles the case where the orbit passes closer to zero than the
 * deviation does — the point where the linearisation would otherwise break down
 * and produce the classic perturbation "glitches". Folding z back into delta and
 * restarting the reference index avoids them without a second reference orbit.
 */
const ESCAPE_PERTURB = `
uniform sampler2D uOrbit;
uniform ivec2 uOrbitSize;
uniform int uOrbitLength;

vec4 orbitAt(int i) {
  return texelFetch(uOrbit, ivec2(i % uOrbitSize.x, i / uOrbitSize.x), 0);
}

float escape(vec2 dcr, vec2 dci) {
  vec2 dr = vec2(0.0);
  vec2 di = vec2(0.0);
  int m = 0;
  vec4 Z = orbitAt(0);

  for (int n = 0; n < uMaxIter; n++) {
    // delta = 2*Z*delta + delta^2 + dc
    vec2 zdr = dfAdd(dfMul(Z.xy, dr), -dfMul(Z.zw, di));
    vec2 zdi = dfAdd(dfMul(Z.xy, di), dfMul(Z.zw, dr));
    vec2 sqr = dfAdd(dfMul(dr, dr), -dfMul(di, di));
    vec2 sqi = dfMul(dfAdd(dr, dr), di);

    dr = dfAdd(dfAdd(dfAdd(zdr, zdr), sqr), dcr);
    di = dfAdd(dfAdd(dfAdd(zdi, zdi), sqi), dci);
    m++;

    Z = orbitAt(m);
    vec2 tr = dfAdd(Z.xy, dr);
    vec2 ti = dfAdd(Z.zw, di);

    float zr = tr.x + tr.y;
    float zi = ti.x + ti.y;
    float mag = zr * zr + zi * zi;
    if (mag > BAILOUT2) return smoothCount(n, mag);

    float er = dr.x;
    float ei = di.x;
    // Rebase when the reference is nearer zero than the deviation, or when the
    // reference orbit has run out (it escaped earlier than this pixel).
    if (mag < er * er + ei * ei || m >= uOrbitLength - 1) {
      dr = tr;
      di = ti;
      m = 0;
      Z = orbitAt(0);
    }
  }
  return -1.0;
}
`;

export type KernelMode = "single" | "double" | "perturb";

export interface ShaderVariant {
  kernel: KernelMode;
  /** Supersampling grid size per axis: 1 = off, 2 = 4 samples, 3 = 9 samples. */
  aa: number;
}

/**
 * Position of AA sample (sx, sy) within the pixel at gl_FragCoord, in [0, 1].
 * gl_FragCoord is the pixel centre (px + 0.5), so this works out to
 * (px + (s + 0.5) / AA) / resolution.
 */
const SAMPLE_POS = `(gl_FragCoord.xy - 0.5 + (vec2(float(sx), float(sy)) + 0.5) / float(AA)) / uResolution`;

/** GLSL that turns a `vec2 uv` into `float sn`, the smooth escape count. */
function sampleExpr(kernel: KernelMode): string {
  if (kernel === "perturb") {
    // The center never reaches the shader: it is baked into the reference
    // orbit. Only the offset from that orbit's center matters, so the pixel
    // offset is computed in df64 and added to the (small) center difference.
    return `
      vec2 fx = dfMul(vec2(uv.x - 0.5, 0.0), uSpanX);
      vec2 fy = dfMul(vec2(uv.y - 0.5, 0.0), uSpanY);
      float sn = escape(dfAdd(uDeltaC0X, fx), dfAdd(uDeltaC0Y, fy));`;
  }
  if (kernel === "double") {
    return `
      vec2 off = (uv - 0.5) * uSpan;
      float sn = escape(dfAdd(uCenterX, vec2(off.x, 0.0)),
                        dfAdd(uCenterY, vec2(off.y, 0.0)));`;
  }
  return `
      vec2 off = (uv - 0.5) * uSpan;
      float sn = escape(vec2(uCenterX.x + off.x, uCenterY.x + off.y));`;
}

/** Uniforms, helpers and the escape kernel — everything above `main`. */
function preamble(kernel: KernelMode, aa: number, withPalette: boolean): string {
  const deep = kernel !== "single";
  return `#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2 uResolution;
uniform vec2 uCenterX;     // (hi, lo) split of the real center
uniform vec2 uCenterY;     // (hi, lo) split of the imaginary center
uniform vec2 uSpan;        // viewport size in the complex plane
uniform vec2 uSpanX;       // df64 span, perturbation path
uniform vec2 uSpanY;
uniform vec2 uDeltaC0X;    // df64 offset from the reference orbit's center
uniform vec2 uDeltaC0Y;
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

${withPalette ? PALETTE_GLSL : ""}
${deep ? DF64_GLSL : ""}
${kernel === "perturb" ? ESCAPE_PERTURB : kernel === "double" ? ESCAPE_DEEP : ESCAPE_SINGLE}
`;
}

/** Escape-time and colouring in one pass, straight to the target. */
export function buildFragmentShader({ kernel, aa }: ShaderVariant): string {
  return `${preamble(kernel, aa, true)}
void main() {
  vec3 acc = vec3(0.0);
  for (int sy = 0; sy < AA; sy++) {
    for (int sx = 0; sx < AA; sx++) {
      vec2 uv = ${SAMPLE_POS};
      ${sampleExpr(kernel)}
      acc += sn < 0.0 ? uInteriorColor : shade(sn);
    }
  }
  fragColor = vec4(acc / float(AA * AA), 1.0);
}
`;
}

/**
 * Escape counts only, one sample per fragment, written to an R32F target.
 *
 * Drawn into a buffer AA times the canvas size, so fragment q corresponds to
 * sample (q mod AA) of pixel (q div AA). `uResolution` stays the *canvas*
 * resolution, and the pixel index is recovered with integer maths so the uv
 * expression below is character-for-character the one the single-pass shader
 * evaluates.
 *
 * That matters more than it looks. The algebraically equivalent shortcut
 * `gl_FragCoord.xy / (uResolution * AA)` rounds differently in float32: it
 * disagrees with the single-pass path on ~8% of samples by one ULP. Harmless
 * on its own, but it would make toggling the animation shimmer along the
 * boundary. Reconstructing the index keeps the two paths bit-identical.
 */
export function buildCountShader(kernel: KernelMode, aa: number): string {
  return `${preamble(kernel, aa, false)}
void main() {
  // gl_FragCoord is the sample centre, so truncating gives the sample index.
  ivec2 q = ivec2(gl_FragCoord.xy);
  ivec2 pixel = q / AA;
  ivec2 sample = q - pixel * AA;
  int sx = sample.x;
  int sy = sample.y;
  vec2 uv = (vec2(pixel) + (vec2(float(sx), float(sy)) + 0.5) / float(AA)) / uResolution;
  ${sampleExpr(kernel)}
  fragColor = vec4(sn, 0.0, 0.0, 1.0);
}
`;
}

/**
 * Colour a cached count buffer. This is the only pass that reruns while the
 * gradient animates, which is what keeps cycling free of the escape-time cost.
 */
export function buildColorizeShader(aa: number): string {
  return `#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

uniform sampler2D uCounts;
uniform int  uPalette;
uniform float uColorCycle;
uniform float uColorOffset;
uniform vec3 uInteriorColor;

const int AA = ${aa};

${PALETTE_GLSL}

void main() {
  // Integer texel maths, so the AA block is picked out exactly with no
  // filtering or half-texel drift.
  ivec2 base = ivec2(gl_FragCoord.xy) * AA;
  vec3 acc = vec3(0.0);
  for (int sy = 0; sy < AA; sy++) {
    for (int sx = 0; sx < AA; sx++) {
      float sn = texelFetch(uCounts, base + ivec2(sx, sy), 0).r;
      acc += sn < 0.0 ? uInteriorColor : shade(sn);
    }
  }
  fragColor = vec4(acc / float(AA * AA), 1.0);
}
`;
}
