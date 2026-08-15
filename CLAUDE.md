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
```

`main.py` writes frames to `python/output/` and encodes `zoom_<palette>.mp4`.

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

- **`lib/shader.ts`** — generates the GLSL. Two escape-time kernels are built
  from one template:
  - *single*: plain `float`. Fast, breaks down below a viewport span of ~2e-4.
  - *deep*: "double-single" (df64) arithmetic — each value is an unevaluated sum
    of two floats (~48 mantissa bits). ~10x slower, usable to a span of ~1e-12.

  The anti-aliasing factor is a compile-time constant so the sample loop
  unrolls; the renderer caches one program per `(deep, aa)` pair.

- **`lib/renderer.ts`** — WebGL2 wrapper. Draws a full-screen triangle from
  `gl_VertexID` (no vertex buffers). `splitDouble()` splits a JS double into the
  (hi, lo) float pair the deep kernel expects. `renderToPixels()` renders
  offscreen to a renderbuffer for PNG export without disturbing the canvas.

- **`lib/view.ts`** — viewport math (`zoomAt`, `panByPixels`), the precision
  threshold constants, and URL-hash encoding.

- **`components/MandelbrotExplorer.tsx`** — owns the rAF render loop. The view
  lives in a **ref**, not React state, so panning never triggers a React render;
  a `dirty` flag decides whether a frame is drawn. While the pointer is moving
  it renders at a fraction of full resolution with AA off, then repaints sharp
  ~180ms after the view settles.

**Precision matters here.** When editing the view or renderer, remember that the
center coordinate must reach the shader as a split (hi, lo) pair — collapsing it
to a single float caps zoom at ~1e4x. `MIN_SPAN` in `lib/view.ts` is the df64
floor; below it the image degrades into blocks.
