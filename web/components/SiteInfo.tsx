import { AUTHOR, REPO_URL, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/**
 * The indexable half of the page.
 *
 * A WebGL canvas is opaque to a crawler — without this the document body is
 * one `<canvas>` and a handful of form controls, which is close to zero text
 * to rank on. This overlays the real prose in the top-right corner, outside
 * `<main>` so the `<header>` and `<footer>` map to the `banner` and
 * `contentinfo` landmarks (a `<footer>` nested in `<main>` does not).
 *
 * This is a server component on purpose: the copy ships in the initial HTML,
 * so it is there whether or not the crawler executes JavaScript, and it costs
 * nothing in the client bundle.
 */

const LINK =
  "underline decoration-white/25 underline-offset-2 transition hover:text-white/80 hover:decoration-white/50";

export function SiteInfo() {
  return (
    // inset-y-0 + pb-10 lets the open panel scroll rather than run under the
    // status bar. The column itself is inert; only the panel and links take
    // pointer events, so dragging the fractal still works around them.
    <div className="pointer-events-none fixed inset-y-0 right-0 z-20 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col items-end gap-2 p-3 pb-10">
      <header className="text-right">
        <h1 className="text-sm font-semibold tracking-tight text-white/85">
          {SITE_NAME}
        </h1>
        <p className="text-[11px] leading-snug text-white/45">{SITE_TAGLINE}</p>
      </header>

      <details className="group pointer-events-auto w-full">
        {/* `flex` on the summary drops its list-item marker in every engine
            except Safari, which needs the ::-webkit-details-marker rule. */}
        <summary className="ml-auto flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-md border border-white/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-white/80 backdrop-blur transition hover:bg-black/80 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="text-white/40 transition-transform group-open:rotate-90"
          >
            ›
          </span>
          About the Mandelbrot set
        </summary>

        {/* The cap is measured off the viewport rather than a plain vh
            fraction so the panel still fits (and scrolls) on short screens. */}
        <div className="mt-2 max-h-[calc(100dvh-12rem)] space-y-4 overflow-y-auto rounded-xl border border-white/10 bg-black/70 p-4 text-[12px] leading-relaxed text-white/60 shadow-2xl backdrop-blur-md">
          <section className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
              What is the Mandelbrot set?
            </h2>
            <p>
              The Mandelbrot set is the collection of complex numbers{" "}
              <em>c</em> for which the iteration <code>z → z² + c</code>,
              started from <code>z = 0</code>, never escapes to infinity. Points
              inside the set are painted black. Every other pixel is coloured by
              how many iterations it survived before escaping — the{" "}
              <em>escape time</em> — and that single number is what draws the
              filaments, spirals, seahorse tails and miniature copies of the
              whole set that keep appearing as you descend. Its boundary is a
              fractal: there is no scale at which the detail runs out.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
              About this explorer
            </h2>
            <p>
              Every frame is computed from scratch in a WebGL2 fragment shader
              on your own GPU, at your screen&rsquo;s resolution. No tiles are
              downloaded, no server renders anything, and nothing about where
              you look leaves the browser.
            </p>
            <p>
              Ordinary 32-bit floats blur out at roughly 10,000×. Below that the
              renderer switches to a <em>perturbation</em> kernel: instead of
              iterating each pixel&rsquo;s own coordinate it iterates the
              pixel&rsquo;s deviation from a single arbitrary-precision
              reference orbit, which removes the precision ceiling entirely. You
              can zoom to 10<sup>60</sup>× and still resolve sharp structure —
              what limits you there is iteration count and patience, not
              arithmetic.
            </p>
            <p>
              Also here: seven colour palettes with adjustable cycle and shift,
              automatic or manual iteration limits, jump-to presets for famous
              regions such as Seahorse Valley and Elephant Valley, PNG export up
              to 32K, and a URL that always encodes the current view, so any
              place you find is a link you can send to someone.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
              Controls
            </h2>
            <ul className="list-disc space-y-1 pl-4 marker:text-white/25">
              <li>Drag to pan; scroll or pinch to zoom at the cursor.</li>
              <li>
                Double-click to zoom in, shift-double-click to zoom out.
              </li>
              <li>
                Arrow keys pan, <kbd>+</kbd> and <kbd>-</kbd> zoom,{" "}
                <kbd>0</kbd> returns to the whole set.
              </li>
            </ul>
          </section>
        </div>
      </details>

      <footer className="pointer-events-auto text-right text-[11px] leading-snug text-white/35">
        {/* New tab: the current view lives in the URL hash, so navigating away
            and back would be the difference between keeping and losing it. */}
        Open source on{" "}
        <a
          className={LINK}
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>{" "}
        · built by{" "}
        <a
          className={LINK}
          href={AUTHOR.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {AUTHOR.name}
        </a>
      </footer>
    </div>
  );
}
