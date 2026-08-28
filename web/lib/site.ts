/**
 * One source of truth for the site's identity.
 *
 * `app/layout.tsx` (metadata), `app/robots.ts`, `app/sitemap.ts`,
 * `app/manifest.ts` and the JSON-LD payload in `app/page.tsx` all read from
 * here. Duplicating the origin across those five places is how a canonical URL
 * and a sitemap quietly end up disagreeing.
 */

/**
 * Deployed production origin. Only a fallback: on Vercel the build injects
 * VERCEL_PROJECT_PRODUCTION_URL, which is what actually resolves in
 * production. Kept in sync with the custom domain so local builds and any
 * non-Vercel host emit the same canonical URL.
 */
const FALLBACK_SITE_URL = "https://mandelbrot.lol";

function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  // Vercel injects this at build time and it points at the production
  // deployment rather than the per-commit preview URL — which is what a
  // canonical link and a sitemap want.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const raw = explicit || (vercel ? `https://${vercel}` : FALLBACK_SITE_URL);
  return raw.replace(/\/+$/, "");
}

export const SITE_URL = resolveSiteUrl();

export const SITE_NAME = "mandelbrot.lol";

/**
 * What the site was called before the domain became the brand. Kept as the
 * schema.org alternateName so the entity stays findable under both.
 */
export const SITE_ALT_NAME = "Mandelbrot Explorer";

export const SITE_TITLE =
  "mandelbrot.lol — Interactive Fractal Deep Zoom in Your Browser";

export const SITE_TAGLINE =
  "Interactive deep-zoom fractal viewer, rendered live on your GPU.";

export const SITE_DESCRIPTION =
  "Explore the Mandelbrot set in real time. Every frame is computed on your GPU with WebGL2 — drag to pan, scroll to zoom far past the usual precision limits, switch palettes and export 8K PNGs. No plugins, no signup, nothing sent to a server.";

export const SITE_KEYWORDS = [
  "Mandelbrot set",
  "Mandelbrot explorer",
  "fractal explorer",
  "fractal zoom",
  "deep zoom",
  "interactive fractal",
  "WebGL fractal",
  "GPU fractal renderer",
  "escape time algorithm",
  "perturbation theory",
  "arbitrary precision",
  "complex plane",
  "fractal generator",
  "fractal art",
  "math visualization",
];

export const AUTHOR = {
  name: "Lukas Scheucher",
  url: "https://www.linkedin.com/in/scheuclu/",
} as const;

export const REPO_URL = "https://github.com/scheuclu/mandelbrot_explorer";
