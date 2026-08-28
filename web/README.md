# mandelbrot.lol — web

Real-time Mandelbrot explorer. Next.js shell, all rendering in a WebGL2 fragment
shader on the client.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build
npm run lint
```

## Controls

| Input | Action |
|---|---|
| Drag | Pan |
| Scroll / pinch | Zoom at the cursor |
| Double-click | Zoom in (shift: zoom out) |
| Arrow keys | Pan |
| `+` / `-` | Zoom |
| `0` | Reset |

## How it renders

One full-screen triangle; the fragment shader does the escape-time iteration per
pixel. There is no per-pixel work in JavaScript and nothing is computed on a
server.

**Precision.** Three kernels, selected automatically by zoom depth:

| Kernel | Used when | Ceiling |
|---|---|---|
| `single` | span > 2e-4 | ~1e4x |
| `double` | manual only | ~1e12x |
| `perturb` | span ≤ 2e-4 | no precision ceiling |

`single` is plain float32. `double` runs the whole iteration in "double-single"
arithmetic (each value an unevaluated sum of two floats, ~48 mantissa bits).

`perturb` is the interesting one. Rather than iterating each pixel's own
coordinate, it iterates the pixel's *deviation* from one shared high-precision
reference orbit:

```
delta_{n+1} = 2*Z_n*delta_n + delta_n^2 + delta_c
```

A deviation only needs relative precision, so it never runs out of exponent the
way an absolute coordinate does — that is what removes the zoom ceiling. The
reference orbit `Z_n` is computed on the CPU in BigInt fixed-point
(`lib/bigfloat.ts`, 320-bit) and uploaded as an RGBA32F texture holding
`(Zr_hi, Zr_lo, Zi_hi, Zi_lo)` per iteration.

Two details matter:

- **The delta must be df64, not float32.** With float32 deltas, escape counts
  diverge from ground truth on 3–6% of pixels past a few thousand iterations.
  Measured, not assumed.
- **Rebasing** (Zhuoran's method): when the reference passes nearer zero than the
  deviation, fold `z` back into the delta and restart the reference index. This
  is what prevents the classic perturbation "glitches" without needing a second
  reference orbit.

The view center is also arbitrary-precision. Past ~1e15x a float64 can no longer
distinguish neighbouring pixels, so no amount of shader precision would help.

Orbits are reused across small pans (`orbitIsUsable`) so dragging stays smooth;
recomputing every frame would stall.

**Validation.** The perturbation algorithm was checked against BigInt
fixed-point ground truth: 0 mismatches in 120 samples at both 1e-10 and 1e-13
span, where a float32 delta gives 4–7. On the GPU it matches the independently
validated `double` kernel on 98.45% of pixels, the remainder being near-boundary
pixels where two accurate algorithms legitimately differ in the last iteration.
The `double` kernel itself matched a float64 CPU reference on 99.4% of pixels,
median difference 0.

**Colour cycling.** Animating the gradient would otherwise re-run the whole
escape-time kernel every frame, which is hopeless at deep zoom. Instead the two
halves are split: a *count* pass writes the smooth escape count of every
supersample into an R32F texture, and a *colourise* pass reads that texture and
applies the palette. Only the second one reruns while cycling, so the animation
holds full resolution and supersampling at any zoom depth. The count buffer is
allocated on demand, capped at 32M samples (~128MB), and released when cycling
stops; without `EXT_color_buffer_float`, or above the cap, the renderer falls
back to the single-pass path.

The two paths have to agree, or toggling the animation would visibly shimmer.
They do, bit-for-bit: the count shader recovers the pixel and sample index from
`gl_FragCoord` with integer maths and then evaluates the *same* uv expression as
the single-pass shader. This is not cosmetic. The obvious shortcut —
`gl_FragCoord.xy / (uResolution * AA)`, which is algebraically identical —
rounds differently in float32 and disagrees on 8.1% of samples by one ULP. A
float32 CPU reference over 86,016 sample positions (53,787 distinct uv values,
spanning AA 1–3 and six canvas widths) reports 0 mismatches for the form that
shipped and 6,967 for the shortcut. Rerun it with
`node web/scripts/check-sample-parity.mjs`.

**Performance.** The view lives in a ref, not React state, so panning never
triggers a React render. A dirty flag gates the rAF loop. While the pointer is
moving the canvas renders at a fraction of full resolution with anti-aliasing
off; ~180ms after the view settles it repaints at full resolution with
supersampling. Programs are compiled and cached per `(precision, AA)` pair, with
the AA factor baked in as a constant so the sample loop unrolls.

## Layout

```
app/                    Next.js App Router shell
components/
  MandelbrotExplorer    render loop, input handling, URL sync
  ControlPanel          settings UI
  StatusBar             coordinate / zoom / precision readout
lib/
  shader.ts             GLSL generation (single / df64 / perturbation kernels)
  renderer.ts           WebGL2 wrapper, orbit texture, offscreen export
  bigfloat.ts           BigInt fixed-point reals for the view center
  reference.ts          high-precision reference orbit + reuse policy
  view.ts               viewport math, URL hash encoding
  palettes.ts           palette metadata
  presets.ts            interesting locations
  settings.ts           settings model and defaults
  download.ts           PNG export
```
