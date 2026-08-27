import type { MetadataRoute } from "next";

import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/**
 * Web app manifest. Next links this automatically (file-based metadata), which
 * gives the page a proper installable identity instead of the document title.
 *
 * The icons are the routes emitted by the `app/icon.png` / `app/apple-icon.png`
 * file conventions. Those image files are owned by the favicon work, not by
 * this module — the manifest only points at the routes they serve.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — Interactive Fractal Deep Zoom`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#000000",
    theme_color: "#000000",
    lang: "en",
    dir: "ltr",
    categories: ["education", "graphics", "utilities"],
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
