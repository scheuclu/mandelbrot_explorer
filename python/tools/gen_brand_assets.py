"""Generate the web app's favicon, app icons and social preview image.

Every asset here is rendered from the real escape-time computation with the
same Ultra Fractal palette the WebGL app uses, so the icons and the social
card show the actual thing rather than a hand-drawn approximation of it.

    cd python && uv run python tools/gen_brand_assets.py

Outputs go to web/app/, where the Next.js metadata file conventions
(favicon.ico, icon.png, apple-icon.png, opengraph-image.png, twitter-image.png)
pick them up with no changes to layout.tsx.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "web" / "app"

# Keep in sync with SITE_NAME in web/lib/site.ts. Baked into the social card
# as pixels, so a rename there means re-running this script.
SITE_NAME = "mandelbrot.lol"

# Escape radius. Large enough that the smooth-iteration term below is accurate.
BAILOUT = 1e4
LOG2 = math.log(2.0)


# --------------------------------------------------------------------------
# Escape-time
# --------------------------------------------------------------------------


def smooth_counts(
    cx: float, cy: float, span_y: float, w: int, h: int, max_iter: int
) -> np.ndarray:
    """Smooth (fractional) escape counts; NaN for points that never escaped.

    Escaped points are dropped from the working set each iteration, which keeps
    |z| bounded (no overflow) and makes deep zooms affordable.
    """
    span_x = span_y * w / h
    xs = np.linspace(cx - span_x / 2, cx + span_x / 2, w, dtype=np.float64)
    # Screen y grows downwards, the imaginary axis upwards.
    ys = np.linspace(cy + span_y / 2, cy - span_y / 2, h, dtype=np.float64)
    c = (xs[None, :] + 1j * ys[:, None]).ravel()

    out = np.full(c.size, np.nan)
    idx = np.arange(c.size)
    z = np.zeros_like(c)

    for i in range(max_iter):
        z = z * z + c
        mag = np.abs(z)
        escaped = mag > BAILOUT
        if escaped.any():
            # nu = n + 1 - log2(log|z|): continuous across the bailout circle.
            out[idx[escaped]] = i + 1 - np.log(np.log(mag[escaped])) / LOG2
            keep = ~escaped
            z, c, idx = z[keep], c[keep], idx[keep]
            if idx.size == 0:
                break

    return out.reshape(h, w)


# --------------------------------------------------------------------------
# Palettes (ported from web/lib/shader.ts so the assets match the app)
# --------------------------------------------------------------------------


def _ramp(t: np.ndarray, stops: list[tuple[float, tuple[float, float, float]]]) -> np.ndarray:
    """Piecewise-linear RGB ramp over t in [0, 1]."""
    pos = np.array([p for p, _ in stops])
    cols = np.array([c for _, c in stops])
    out = np.empty(t.shape + (3,))
    for ch in range(3):
        out[..., ch] = np.interp(t, pos, cols[:, ch])
    return out


ULTRA_STOPS = [
    (0.0000, (0.0000, 0.0275, 0.3922)),
    (0.1600, (0.1255, 0.4196, 0.7961)),
    (0.4200, (0.9294, 1.0000, 1.0000)),
    (0.6425, (1.0000, 0.6667, 0.0000)),
    (0.8575, (0.0000, 0.0078, 0.0000)),
    (1.0000, (0.0000, 0.0275, 0.3922)),
]


def shade_ultra(counts: np.ndarray, cycle: float, offset: float = 0.0) -> np.ndarray:
    """The app's default palette: cyclic, so it gets a sawtooth ramp."""
    saw = np.mod(counts / cycle + offset, 1.0)
    rgb = _ramp(np.nan_to_num(saw), ULTRA_STOPS)
    rgb[np.isnan(counts)] = 0.0  # interior is black
    return rgb


# A deliberately low-frequency ramp for the icons: at 16px the app's cycling
# palette turns into noise, so the exterior gets one clean glow instead.
# The stretch of the Ultra gradient that runs deep blue -> white -> gold, i.e.
# everything before it turns back to black. The icon uses that span once
# instead of cycling: at 16px a repeating palette is just noise.
ICON_RAMP_END = 0.6425


def shade_icon(counts: np.ndarray, max_iter: int) -> np.ndarray:
    # Escape counts are roughly exponentially distributed: a linear ramp puts
    # nearly every exterior pixel in the first colour band. Log spreads them.
    t = np.log1p(np.nan_to_num(counts)) / math.log1p(max_iter)
    # Gamma sinks the far field to near-black navy. Contrast against the black
    # silhouette comes from the white band right at the boundary, so the dark
    # corners cost nothing at 16px and the large icon stops looking washed out.
    t = np.clip(t, 0.0, 1.0) ** 1.5
    rgb = _ramp(t * ICON_RAMP_END, ULTRA_STOPS)
    rgb[np.isnan(counts)] = 0.0
    return rgb


def to_image(rgb: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB")


# --------------------------------------------------------------------------
# Fonts
# --------------------------------------------------------------------------

# SF Pro is the closest thing on macOS to the Geist the site ships; DejaVu
# comes with matplotlib, so the script still runs on a machine without it.
_SF = Path("/System/Library/Fonts/SFNS.ttf")


def load_font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    if _SF.exists():
        font = ImageFont.truetype(str(_SF), size)
        try:
            font.set_variation_by_name("Bold" if bold else "Regular")
        except (OSError, AttributeError):
            pass
        return font

    import matplotlib

    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    return ImageFont.truetype(
        str(Path(matplotlib.get_data_path()) / "fonts" / "ttf" / name), size
    )


def fit_font(text: str, max_width: float, max_size: int, min_size: int = 44):
    """Largest bold size at which `text` still fits `max_width`."""
    for size in range(max_size, min_size - 1, -2):
        font = load_font(size, bold=True)
        if font.getlength(text) <= max_width:
            return font
    return load_font(min_size, bold=True)


def draw_tracked(
    draw: ImageDraw.ImageDraw, xy, text: str, font, fill, tracking: float = 0.0
) -> None:
    """PIL has no letter-spacing, and the eyebrow line needs it."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += draw.textlength(ch, font=font) + tracking


# --------------------------------------------------------------------------
# Assets
# --------------------------------------------------------------------------

SS = 2  # supersampling factor; the renderer has no AA of its own


def render_social(w: int = 1200, h: int = 630) -> Image.Image:
    """Seahorse valley in the default palette, with the title over a scrim."""
    max_iter = 2400
    counts = smooth_counts(
        cx=-0.743643887037151,
        cy=0.13182590420533,
        span_y=5e-5,
        w=w * SS,
        h=h * SS,
        max_iter=max_iter,
    )
    img = to_image(shade_ultra(counts, cycle=96.0)).resize((w, h), Image.LANCZOS)

    # Darken the left side so the type stays readable over the fractal. The
    # scrim holds a flat plateau under the text block and only then falls off;
    # a plain linear gradient is already too thin where the longest line ends.
    x = np.linspace(0.0, 1.0, w)
    edge = np.clip((0.90 - x) / (0.90 - 0.50), 0.0, 1.0)
    alpha = 0.92 * (edge * edge * (3 - 2 * edge))  # smoothstep
    mask = Image.fromarray(
        np.repeat((alpha * 255).astype(np.uint8)[None, :], h, axis=0), "L"
    )
    img = Image.composite(Image.new("RGB", (w, h), (2, 4, 12)), img, mask)

    draw = ImageDraw.Draw(img)
    draw_tracked(
        draw,
        (80, 175),
        "WEBGL2 · REAL TIME · NO SERVER",
        load_font(21, bold=True),
        (255, 176, 32),
        tracking=3.2,
    )
    # Sized to the scrim's fully-opaque plateau, not to the canvas.
    draw.text(
        (78, 219),
        SITE_NAME,
        font=fit_font(SITE_NAME, max_width=590, max_size=92),
        fill=(255, 255, 255),
    )
    body = load_font(28, bold=False)
    draw.text((80, 369), "Pan, zoom and explore the set in real", font=body, fill=(203, 211, 227))
    draw.text((80, 407), "time, rendered entirely on your GPU.", font=body, fill=(203, 211, 227))
    draw.text(
        (80, 469),
        "No precision ceiling — zoom past 10²⁴×.",
        font=load_font(23, bold=False),
        fill=(142, 154, 180),
    )
    return img


def render_icon(size: int) -> Image.Image:
    """The whole set, tightly cropped — the silhouette still reads at 16px."""
    max_iter = 320
    counts = smooth_counts(
        cx=-0.65, cy=0.0, span_y=2.32, w=size * SS, h=size * SS, max_iter=max_iter
    )
    return to_image(shade_icon(counts, max_iter)).resize((size, size), Image.LANCZOS)


def rounded(img: Image.Image, radius_frac: float = 0.22) -> Image.Image:
    """Rounded corners with real transparency, for the browser-tab icon."""
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, img.size[0] - 1, img.size[1] - 1),
        radius=int(img.size[0] * radius_frac),
        fill=255,
    )
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def main(preview: Path | None = None) -> None:
    APP.mkdir(parents=True, exist_ok=True)

    print("rendering social card (1200x630)…")
    social = render_social()
    social.save(APP / "opengraph-image.png", optimize=True)
    social.save(APP / "twitter-image.png", optimize=True)
    alt = (
        f"{SITE_NAME} — a deep zoom into Seahorse Valley of the Mandelbrot "
        "set, rendered in the browser on the GPU."
    )
    # No trailing newline: Next inlines the file verbatim into the
    # og:image:alt attribute, newline and all.
    (APP / "opengraph-image.alt.txt").write_text(alt)
    (APP / "twitter-image.alt.txt").write_text(alt)

    print("rendering icons…")
    base = render_icon(512)
    rounded(base).save(APP / "icon.png", optimize=True)
    # Apple applies its own mask, so apple-icon must stay a full opaque square.
    base.resize((180, 180), Image.LANCZOS).save(APP / "apple-icon.png", optimize=True)

    ico = rounded(render_icon(64), radius_frac=0.18)
    ico.save(APP / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    if preview:
        # The whole point of a favicon is how it survives being tiny.
        strip = Image.new("RGBA", (320, 96), (24, 24, 28, 255))
        x = 16
        for px in (16, 32, 48, 64):
            strip.alpha_composite(ico.resize((px, px), Image.LANCZOS), (x, 48 - px // 2))
            x += px + 24
        strip.resize((320 * 3, 96 * 3), Image.NEAREST).save(preview)
        print(f"  preview -> {preview}")

    for path in sorted(APP.glob("*")):
        if path.suffix in {".png", ".ico", ".txt"}:
            print(f"  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    import sys

    main(Path(sys.argv[1]) if len(sys.argv) > 1 else None)
