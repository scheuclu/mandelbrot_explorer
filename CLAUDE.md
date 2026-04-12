# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Install dependencies:**
```bash
uv sync
```

**Run the interactive web app:**
```bash
uv run streamlit run webpage.py
```

**Run batch rendering** (generates 5 progressively zoomed frames as PNG files):
```bash
uv run python main.py
```

**Generate a zoom video from rendered frames** (requires ffmpeg):
```bash
ffmpeg -framerate 30 -pattern_type glob -i 'image_*.png' -c:v libx264 -pix_fmt yuv420p out.mp4
```

There are no tests or linter configuration in this project.

## Architecture

The project has two independent entry points that share the core rendering function:

- **`main.py`** — contains `create_frame(center, w, h, nw, nh, suffix)`, the core rendering function used by both entry points. Also has a `main()` that renders a batch of 5 frames at a fixed zoom sequence for video generation.

- **`webpage.py`** — Streamlit interactive app. Manages pan/zoom state via `st.session_state` (center_x, center_y, w, h) and calls `create_frame()` on every interaction. Resolution presets (240p–4K) control pixel dimensions while the complex-plane viewport (w, h) controls zoom level.

**Rendering pipeline** inside `create_frame()`:
1. Build a numpy complex grid (`np.meshgrid`) centered at `center` spanning `w × h` in the complex plane.
2. Iteratively apply Z = Z² + C (up to 255 iterations), tracking divergence via `np.isnan(Z)`.
3. Map iteration counts to RGB via sinusoidal color gradients (`iter2color()`).
4. Return a PIL `Image`.

The default center `(-0.7450450892059, 0.1126120218022)` is a visually interesting region of the set.
