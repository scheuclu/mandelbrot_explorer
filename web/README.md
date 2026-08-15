# Mandelbrot Explorer — web

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

**Precision.** The center coordinate is passed to the shader as a split
`(hi, lo)` float pair rather than a single float. Below a viewport span of
`DEEP_SPAN_THRESHOLD` (2e-4) the renderer switches to a kernel that does the
whole iteration in "double-single" arithmetic — each value an unevaluated sum of
two floats, giving ~48 mantissa bits instead of 24. That costs roughly 10x the
work but extends usable zoom from about 1e4x to 1e12x. `MIN_SPAN` is the floor;
past it the image degrades into blocks and the status bar says so.

The shader output was validated against a float64 CPU reference: 99.4% of
sampled pixels matched within 1/255, with a median difference of 0.

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
  shader.ts             GLSL generation (single + df64 kernels, palettes)
  renderer.ts           WebGL2 wrapper, offscreen export
  view.ts               viewport math, URL hash encoding
  palettes.ts           palette metadata
  presets.ts            interesting locations
  settings.ts           settings model and defaults
  download.ts           PNG export
```
