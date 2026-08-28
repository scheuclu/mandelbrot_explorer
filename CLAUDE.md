# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

Two independent implementations of the same fractal:

- **`python/`** — offline/batch renderer (MLX + numpy + PIL) and a Streamlit app.
- **`web/`** — Next.js app that renders the set on the GPU via WebGL2. All
  computation is client side; there is no server-side rendering of frames.

## Commands

### Python (`python/`)

```bash
cd python
uv sync                              # install dependencies
uv run python main.py                # batch render + ffmpeg zoom video
uv run python main.py --palette sqrt # inferno | original | sqrt | cyclic
uv run streamlit run webpage.py      # legacy Streamlit explorer
uv run python tools/gen_brand_assets.py   # regenerate the web favicon + social card
```

`main.py` writes frames to `python/output/` and encodes `zoom_<palette>.mp4`.

`tools/gen_brand_assets.py` renders `web/app/`'s favicon, app icons and Open
Graph image from the real escape-time computation, using a numpy port of the
shader's Ultra palette. Rerun it if that palette changes.

### Web (`web/`)

```bash
cd web
npm install
npm run dev     # http://localhost:3000
npm run build
npm run lint
```

There are no automated tests in either project.

## Architecture

### Python

`create_frame(center, w, h, nw, nh, palette_fn)` in `main.py` builds a complex
grid with MLX, iterates Z = Z² + C for a fixed 255 steps, counts divergence via
`mx.isnan`, and maps counts to RGB through one of the `PALETTES` functions.
`webpage.py` drives the same function from Streamlit session state.

### Web

The render loop lives entirely on the GPU. Nothing is recomputed in JS per pixel.

- **`lib/shader.ts`** — generates the GLSL. Three escape-time kernels are built
  from one template:
  - *single*: plain `float`. Fast, breaks down below a viewport span of ~2e-4.
  - *double*: "double-single" (df64) arithmetic — each value is an unevaluated
    sum of two floats (~48 mantissa bits). Usable to a span of ~1e-12.
  - *perturb*: perturbation against a high-precision reference orbit, with
    Zhuoran rebasing. No precision ceiling. This is what `auto` uses below the
    deep threshold.

  The anti-aliasing factor is a compile-time constant so the sample loop
  unrolls; the renderer caches one program per `(kernel, aa)` pair.

- **`lib/bigfloat.ts`** — BigInt fixed-point reals (320-bit). Only the view
  center needs this: past ~1e15x a float64 cannot distinguish neighbouring
  pixels, so shader precision alone would not help.

- **`lib/reference.ts`** — computes the reference orbit `Z_n` at full precision
  and packs it as `(Zr_hi, Zr_lo, Zi_hi, Zi_lo)` per iteration for an RGBA32F
  texture. `orbitIsUsable()` decides when a cached orbit can be reused; reusing
  across small pans is what keeps dragging smooth.

- **`lib/renderer.ts`** — WebGL2 wrapper. Draws a full-screen triangle from
  `gl_VertexID` (no vertex buffers). `splitDouble()` splits a JS double into the
  (hi, lo) float pair the deep kernels expect. Uploads the orbit texture, skipping
  the upload when the orbit is unchanged. `renderToPixels()` renders offscreen to
  a renderbuffer for PNG export without disturbing the canvas.

- **`lib/view.ts`** — viewport math (`zoomAt`, `panByPixels`), the precision
  threshold constants, and URL-hash encoding. The center is a `BigFloat`; spans
  and pixel offsets stay plain numbers.

- **`lib/download.ts` / `lib/png.ts`** — PNG export, up to 32K (531 Mpx). Two
  hard limits shape this: the GPU will not render a frame wider than
  `MAX_RENDERBUFFER_SIZE` (usually 16384), and a canvas caps *total* area at
  268 Mpx in Chrome and less in Safari. So `planExport()` cuts the frame into
  tiles, `tileParams()` re-aims the view at each one (exactly — no shader change
  and no seams), and `png.ts` writes the PNG byte stream itself through
  `CompressionStream("deflate")` rather than going near a canvas. Sizes that
  cannot work here are disabled in the picker with the reason shown.

- **`components/MandelbrotExplorer.tsx`** — owns the rAF render loop. The view
  lives in a **ref**, not React state, so panning never triggers a React render;
  a `dirty` flag decides whether a frame is drawn. While the pointer is moving
  it renders at a fraction of full resolution with AA off, then repaints sharp
  ~180ms after the view settles.

**Precision matters here.** Two rules that are easy to break by accident:

- The perturbation delta must stay **df64**, not plain float. With float32
  deltas, escape counts diverge from ground truth on 3–6% of pixels past a few
  thousand iterations. This was measured against BigInt ground truth, not
  assumed — see the validation notes in `web/README.md`.
- The view center must stay a `BigFloat` end to end. Rounding it to a double
  anywhere caps zoom at ~1e15x no matter what the shader does.

When changing any of this, the cheap way to check correctness is to compare
against a CPU reference in plain JS rather than eyeballing renders — and always
report how many *distinct* values the reference produced. A uniform region makes
any two implementations agree, which silently turns a validation into a no-op.
