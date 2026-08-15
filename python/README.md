# Mandelbrot visualizer — Python edition

Offline renderer that produces a progressive zoom sequence and encodes it to
video. Uses [MLX](https://github.com/ml-explore/mlx) for the iteration on Apple
Silicon GPUs, with numpy/matplotlib for the color mapping.

For the interactive real-time explorer, see [`../web`](../web).

## Setup

```bash
uv sync
```

## Render a zoom video

```bash
uv run python main.py --palette inferno
```

Writes frames to `output/` and encodes `zoom_<palette>.mp4` with ffmpeg
(requires `ffmpeg` on your PATH).

Palettes: `inferno`, `original`, `sqrt`, `cyclic`.

The zoom halts automatically once the viewport width reaches the float32
precision limit — past that point adjacent pixels are indistinguishable and the
image would degrade into blocks.

## Streamlit explorer

```bash
uv run streamlit run webpage.py
```

Button-driven pan/zoom with resolution presets from 240p to 4K. Superseded by
the WebGL explorer in [`../web`](../web), which is interactive in real time.
