import { MandelbrotExplorer } from "@/components/MandelbrotExplorer";
import { SiteInfo } from "@/components/SiteInfo";
import {
  AUTHOR,
  SITE_ALT_NAME,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "@id": `${SITE_URL}/#webapp`,
  name: SITE_NAME,
  alternateName: SITE_ALT_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "EducationalApplication",
  applicationSubCategory: "Fractal viewer",
  operatingSystem: "Any",
  browserRequirements: "Requires a browser with WebGL2",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  creator: {
    "@type": "Person",
    name: AUTHOR.name,
    url: AUTHOR.url,
  },
  author: {
    "@type": "Person",
    name: AUTHOR.name,
    url: AUTHOR.url,
  },
  about: {
    "@type": "Thing",
    name: "Mandelbrot set",
    sameAs: "https://en.wikipedia.org/wiki/Mandelbrot_set",
  },
  featureList: [
    "Real-time GPU rendering of the Mandelbrot set with WebGL2",
    "Deep zoom without a precision ceiling via perturbation theory",
    "Seven colour palettes with adjustable cycle and shift",
    "PNG export up to 8K",
    "Shareable URLs that encode the current view",
  ],
};

export default function Home() {
  return (
    <>
      {/* Structured data. `<` is escaped because JSON.stringify does not
          sanitise strings for an inline script context. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <main className="h-dvh w-full" aria-label="Mandelbrot set viewer">
        <MandelbrotExplorer />
      </main>

      {/* Outside <main> so its <header>/<footer> are real page landmarks. */}
      <SiteInfo />
    </>
  );
}
