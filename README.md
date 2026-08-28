# Mandelbrot visualizer

Two implementations of the same fractal:

| | |
|---|---|
| [`web/`](web) | Interactive GPU explorer (Next.js + WebGL2). Real-time pan/zoom, all computation client side. |
| [`python/`](python) | Offline batch renderer (MLX/numpy) that produces zoom videos, plus the original Streamlit app. |

---

## Web explorer

```bash
cd web
npm install
npm run dev     # http://localhost:3000
```

Drag to pan, scroll or pinch to zoom, double-click to zoom in (shift-double-click
to zoom out). Arrow keys pan, `+`/`-` zoom, `0` resets.

- **Everything runs in a fragment shader** — one full-screen triangle, no
  per-pixel work in JavaScript, no server round-trips.
- **Deep zoom.** Below a viewport span of ~2e-4 plain 32-bit floats run out of
  mantissa and the image blocks up, so the renderer transparently switches to an
  emulated double-precision ("double-single") kernel with ~48 mantissa bits.
  That extends usable zoom from roughly 1e4x to about 1e12x.
- **Progressive refinement.** While you are dragging it renders at reduced
  resolution with anti-aliasing off, then repaints at full quality once the view
  settles.
- 7 palettes, adjustable color cycle and shift, auto or manual iteration limit.
- Export the current view as PNG up to 32K (30720x17280), rendered in GPU
  tiles and streamed straight to a PNG so it never touches a canvas.
- The view is encoded in the URL hash, so any location is a shareable link.

## Python renderer

```bash
cd python
uv sync
uv run python main.py --palette inferno
```

Renders a progressive zoom sequence into `python/output/` and encodes it to
`zoom_<palette>.mp4` with ffmpeg. Palettes: `inferno`, `original`, `sqrt`,
`cyclic`. The zoom stops automatically once the viewport width reaches the
float32 precision limit.

The original Streamlit explorer is still there:

```bash
uv run streamlit run webpage.py
```

---

**Click to watch the video.**
[![Mandelbrot zoom](https://img.youtube.com/vi/yVMQ_w54QVE/0.jpg)](https://www.youtube.com/watch?v=yVMQ_w54QVE)

Developed by [Lukas Scheucher](https://www.linkedin.com/in/scheuclu/).
