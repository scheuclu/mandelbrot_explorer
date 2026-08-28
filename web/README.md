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

## Exporting

Export sizes go up to 32K (30720x17280 = 531 Mpx). At that size neither of the
obvious mechanisms works:

- **The GPU** reports `MAX_RENDERBUFFER_SIZE` of 16384 on most desktop parts, so
  a 30720-wide frame cannot be rendered in one pass. `planExport()` cuts the
  frame into tiles no wider than that limit and no more than 64 M shader samples
  per draw (16 Mpx at the AA=2 export floor, a quarter of that at AA=3) — the
  second cap has nothing to do with correctness and everything to do with GPU
  watchdogs, which kill a context that spends a few seconds inside one draw
  call. Every tile is re-aimed with `tileParams()`, which shifts the view centre
  (or, under perturbation, `deltaC`) onto the tile and scales the span by the
  tile's share of the frame. The algebra cancels exactly, so a tile pixel gets
  the same complex coordinate a full-frame render would give it; measured
  worst-case drift across every plan is 3e-12 of a pixel.
- **The canvas** caps *total area*, at 268 Mpx (16384²) in Chrome and lower in
  Safari, so a 531 Mpx image can never be drawn on one — and `putImageData`
  would want the whole 2.1 GB of RGBA at once regardless. `lib/png.ts` therefore
  writes the PNG byte stream itself, pushing bands through
  `CompressionStream("deflate")` (which emits exactly the zlib stream an IDAT
  needs) and folding the output into Blob parts as it appears.

Scanlines use filter type 0 (None) with colour type 2 (RGB). Measured on three
real renders, that is within 4.5% of the best of Sub / Up / Paeth /
adaptive-minimum-sum and 2–3x cheaper: deflate's LZ77 already finds the
horizontal runs Sub would, and filtering destroys the byte-level repeats it
feeds on. Output runs 0.20–1.35 bytes per pixel, so a 32K frame is 105–720 MB.

**Validation.** The encoder was checked against Pillow: pixel-exact at 1x1, 7x5,
1920x1080 and 1920x17280 (the last one crossing the multi-IDAT and Blob-folding
paths), with 254,873 distinct RGB values in the 1920x1080 reference — a uniform
region would have made any two implementations agree. Tiled assembly was driven
with a fake GPU at `MAX_RENDERBUFFER_SIZE` of 16384, 900, 500 and 301: identical
output bytes in all four cases, every pixel covered exactly once. A full-scale
30720x17280 dry run produced a valid 702 MB PNG — chunk CRCs, zlib stream and
all 17,280 scanlines verified independently — in 18.7 s of encoding, peaking at
1.3 GB of process memory.

Sizes that cannot work are disabled in the picker with the reason shown, before
any rendering starts: no Compression Streams API, or a `navigator.deviceMemory`
too small for the estimated peak. The download link is only created after the
last byte is encoded, so a failure at any point leaves no file rather than a
truncated one.

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
  download.ts           export sizes, tiling plan, export orchestration
  png.ts                streaming PNG encoder (no canvas, no size ceiling)
  analytics.ts          typed custom events, with the throttling they need
```

## Analytics

Page views come from `<Analytics />` in the layout. Custom events go through
`lib/analytics.ts`, which is the only file allowed to call `track()`.

Events are metered — page views and custom events share one monthly pool — and
this app is a 60fps render loop with sliders and continuous pointer input, so
every event is throttled at the helper rather than at the call site: **once** per
page load (capabilities, zoom milestones, errors), **settled** 180ms after the
last change (pickers, the cycling toggle), or **direct** for something as
deliberate as a finished export. Nothing is reported per frame, per wheel tick or
per slider tick.

Property values are numbers, booleans, or members of a closed set declared in
the module. No coordinates and no free text: the zoom goes out as one of nine
buckets and error messages are matched down to a handful of tags.

`MAX_PROPERTIES` there is a plan limit, not a protocol one — Vercel keeps 2
properties per event on Pro and 8 with Web Analytics Plus. Two events declare
more than two properties, and both list them most-important-first so trimming
the constant degrades them predictably.

`track()` does not send anything in development: the SDK loads a debug script
that logs to the console instead, so call sites can be verified locally but the
numbers only appear from a deployment.
