import argparse
import os
import subprocess

import mlx.core as mx
import numpy as np
from matplotlib import colormaps
from PIL import Image

PI = 3.14159265359


def palette_inferno(val):
    frac = np.sqrt(val / val.max())
    return colormaps["inferno"](frac)


def palette_original(val):
    frac = val / val.max()
    r = frac + 0.2 * np.sin(frac * 2 * PI)
    g = frac + 0.2 * np.sin(frac * 4 * PI)
    b = frac + 0.2 * np.sin(frac * 6 * PI)
    return np.stack([r, g, b, np.ones_like(r)], axis=-1)


def palette_sqrt(val):
    frac = np.sqrt(val / val.max())
    r = frac + 0.2 * np.sin(frac * 2 * PI)
    g = frac + 0.2 * np.sin(frac * 4 * PI)
    b = frac + 0.2 * np.sin(frac * 6 * PI)
    return np.stack([r, g, b, np.ones_like(r)], axis=-1)


def palette_cyclic(val):
    frac = np.sqrt(val / val.max())
    r = 0.5 + 0.5 * np.sin(frac * 6 * PI)
    g = 0.5 + 0.5 * np.sin(frac * 6 * PI + 2 * PI / 3)
    b = 0.5 + 0.5 * np.sin(frac * 6 * PI + 4 * PI / 3)
    return np.stack([r, g, b, np.ones_like(r)], axis=-1)


PALETTES = {
    "inferno": palette_inferno,
    "original": palette_original,
    "sqrt": palette_sqrt,
    "cyclic": palette_cyclic,
}


@mx.compile
def _step(Z, C, Z_final):
    Z = Z**2 + C
    Z_final = Z_final + mx.isnan(Z.real).astype(mx.int32)
    return Z, Z_final


def create_frame(center, w, h, nw, nh, palette_fn):
    real = mx.linspace(center[0] - w / 2, center[0] + w / 2, nw)
    imag = mx.linspace(center[1] - h / 2, center[1] + h / 2, nh)
    real_grid, imag_grid = mx.meshgrid(real, imag)
    C = real_grid.astype(mx.complex64) + 1j * imag_grid.astype(mx.complex64)
    mx.eval(C)

    Z = mx.zeros((nh, nw), dtype=mx.complex64)
    Z_final = mx.zeros((nh, nw), dtype=mx.int32)
    for _ in range(255):
        Z, Z_final = _step(Z, C, Z_final)
        mx.eval(Z, Z_final)

    colors = palette_fn(np.array(Z_final))
    return Image.fromarray(np.uint8(colors * 255))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--palette",
        choices=PALETTES.keys(),
        default="inferno",
        help="Color palette (default: inferno)",
    )
    args = parser.parse_args()
    palette_fn = PALETTES[args.palette]

    center = (-0.7450450892059, 0.1126120218022)
    w = 1.92 * 2.0 * 1e-2
    h = 1.08 * 2.0 * 1e-2
    nw = 192 * 40
    nh = 108 * 40

    # Stop when adjacent pixels are indistinguishable in float32 (MLX uses complex64)
    center_scale = max(abs(center[0]), abs(center[1]))
    precision_limit = nw * float(np.spacing(np.float32(center_scale)))

    os.makedirs("output", exist_ok=True)

    i = 0
    while w > precision_limit:
        img = create_frame(center=center, w=w, h=h, nw=nw, nh=nh, palette_fn=palette_fn)
        img.save(f"output/image_{i:04d}_{args.palette}.png")
        print(f"frame {i:4d}  w={w:.3e}  limit={precision_limit:.3e}")
        w *= 0.99
        h *= 0.99
        i += 1
    print(f"Done — {i} frames rendered")

    output_file = f"zoom_{args.palette}.mp4"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-framerate", "30",
            "-pattern_type", "glob",
            "-i", f"output/image_*_{args.palette}.png",
            "-c:v", "libx265",
            "-crf", "15",
            "-preset", "slow",
            "-pix_fmt", "yuv420p",
            output_file,
        ],
        check=True,
    )
    print(f"Video saved to {output_file}")


if __name__ == "__main__":
    main()
