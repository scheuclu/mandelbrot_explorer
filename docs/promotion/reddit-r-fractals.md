# r/fractals launch post

A ready-to-post submission for [r/fractals](https://www.reddit.com/r/fractals/),
plus the reasoning behind its shape.

**Before posting, read the subreddit sidebar.** The rules could not be checked
when this was written — Reddit blocks automated fetching — so everything below
assumes the community's usual conventions: image first, credit your tool, be
open about the fact that it is yours. Check in particular for self-promotion
limits, karma or account-age minimums, and required flair.

The coordinates, zoom figures and palette names here are taken from
`web/lib/presets.ts` and `web/lib/palettes.ts`. If those change, regenerate the
links rather than editing them by hand.

## Format

Post it as an **image or video submission, not a link post.** r/fractals is an
art community: a bare link reads as an advert and gets scrolled past, or
removed. Lead with the render and put the URL in the body or the first comment.

Export a 16K PNG from one of the deep presets and downscale to roughly 4000px
before uploading — Reddit re-compresses anything larger anyway. A screen
recording of a continuous zoom does better still, if there is thirty seconds of
it.

Do **not** use the `zoom_*.mp4` that `python/main.py` produces. That is the
offline Python renderer, not the web app, and pairing it with a link to the site
would be a bait-and-switch.

## Title options

1. `Seahorse Valley at 1.9×10²⁴ magnification — my own WebGL2 renderer, running live in a browser tab`
2. `Perturbation deep zoom to 1.9e24x [Ultra Fractal palette, custom GPU renderer]`
3. `I built a browser Mandelbrot explorer that zooms past the float64 wall — 1.9×10²⁴ and still sharp`

Option 1 is the safest fit for this subreddit: it describes the image first and
the technology second.

## Post body

```text
This is the minibrot at the end of Seahorse Valley, at a magnification of
1.9×10²⁴ — the frame is about 1.4e-24 units tall. Ultra Fractal palette,
9x supersampling.

I wrote the renderer myself. It runs entirely on the GPU in a browser tab
with WebGL2, no server and no plugin. The interesting part for anyone who
has hit this wall before: a float64 runs out of mantissa around 1e15x, so
past that it uses perturbation theory — one reference orbit iterated at
arbitrary precision on the CPU, and every pixel rendered as a small
deviation from it, with Zhuoran rebasing to kill the usual glitch blobs.
The view centre is a BigInt fixed-point number rather than a double, which
is the other half of why it doesn't fall apart down here.

It's free, no signup, nothing is uploaded anywhere, and the source is up
on GitHub. Every view is encoded in the URL, so if you find somewhere good
you can just paste the link — I'd genuinely like to see where people end up.

https://mandelbrot.lol

Direct link to this exact location:
https://mandelbrot.lol/#x=-0.74364346412881196294958985678364&y=0.13182754673397662196701033910390&s=1.371000000000e-24&p=ultra
```

## First comment

Post this yourself once the submission is up, so the technical detail is there
for whoever asks without cluttering the main body.

```text
Some specifics in case anyone's building something similar:

- Three escape-time kernels: plain float32, a "double-single" df64 pair
  (~48 mantissa bits, good to a span of ~1e-12), and perturbation with
  rebasing, which has no precision ceiling. It picks automatically.
- The perturbation delta has to stay df64. With float32 deltas the escape
  counts diverge from ground truth on 3-6% of pixels past a few thousand
  iterations — I checked that against a BigInt reference rather than
  eyeballing it.
- 7 palettes, adjustable cycle length and shift, and the gradient can be
  animated without recomputing the escape times.
- PNG export up to 32K (30720x17280) if you want something printable —
  it renders in GPU tiles and streams the PNG out, since a 531 megapixel
  image is about twice what a browser canvas can hold.
- Presets for Seahorse and Elephant Valley, triple spiral, a few minibrots,
  and progressively deeper dives if you want to see where each precision
  mode gives out.

Source: https://github.com/scheuclu/mandelbrot_explorer
```

## Deep links

Generated from the preset coordinates in `web/lib/presets.ts`. Handy to drop
into replies.

| Location | Link |
| --- | --- |
| Seahorse Valley | `https://mandelbrot.lol/#x=-0.7436438870371&y=0.1318259042053&s=5.000000000000e-5&p=ultra` |
| Deep spiral (1e9x) | `https://mandelbrot.lol/#x=-0.74365410092730999&y=0.13183681463565057&s=2.540000000000e-9&p=ultra` |
| Minibrot | `https://mandelbrot.lol/#x=-1.7687851999999&y=0.0017395999999&s=3.200000000000e-5&p=ultra` |
| Perturbation (1.9e24x) | `https://mandelbrot.lol/#x=-0.74364346412881196294958985678364&y=0.13182754673397662196701033910390&s=1.371000000000e-24&p=ultra` |

## Checklist

- [ ] Read the current subreddit rules; add flair if one is required.
- [ ] Choose the image deliberately. The 1.9e24x minibrot is the better
      *claim*, but a busier region — the triple spiral, or Seahorse around
      1e9x — usually makes the better thumbnail. Consider leading with the
      prettier frame and mentioning the depth in the text.
- [ ] Reply to every comment for the first few hours. On a subreddit this size
      that is the difference between forty upvotes and four hundred.
- [ ] Do not cross-post to r/math, r/webgl and r/InternetIsBeautiful on the same
      day. Space them out and rewrite the framing for each: r/InternetIsBeautiful
      wants "click this, it's fun"; r/math wants the perturbation maths.
