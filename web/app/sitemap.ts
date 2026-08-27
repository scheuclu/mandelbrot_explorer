import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site";

/**
 * The explorer is genuinely a single URL: locations are encoded in the hash
 * (`#...`), and crawlers strip fragments, so listing presets here would only
 * emit the same `loc` over and over.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
