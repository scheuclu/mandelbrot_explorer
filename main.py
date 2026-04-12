import argparse
import os

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


def create_frame(center, w, h, nw, nh, palette_fn):
    Z = np.zeros(shape=(nh, nw), dtype=complex)
    x = np.linspace(center[0] - w / 2, center[0] + w / 2, nw)
    y = np.linspace(center[1] - h / 2, center[1] + h / 2, nh)
    Y, X = np.meshgrid(x, y)
    C = X * complex(0, 1) + Y

    Z_final = np.zeros(shape=(nh, nw), dtype=int)
    for _ in range(255):
        Z = Z**2 + C
        Z_final += np.isnan(Z).astype("int")

    colors = palette_fn(Z_final)
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
    N = 5
    w = 1.92 * 2.0 * 1e-12
    h = 1.08 * 2.0 * 1e-12
    nw = 192 * 40
    nh = 108 * 40

    os.makedirs("output", exist_ok=True)

    for i in range(N):
        img = create_frame(center=center, w=w, h=h, nw=nw, nh=nh, palette_fn=palette_fn)
        img.save(f"output/image_{i:04d}_{args.palette}.png")
        print(f"frame {i}")
        w *= 0.98
        h *= 0.98


if __name__ == "__main__":
    main()
