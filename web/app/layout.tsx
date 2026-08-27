import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Relative metadata URLs (the generated opengraph-image / twitter-image routes)
// need an absolute origin, or Next falls back to localhost and the social
// preview breaks everywhere it is shared.
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://mandelbrot-eosin.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Mandelbrot Explorer",
  description:
    "Explore the Mandelbrot set in real time. Rendered entirely on your GPU with WebGL.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  // The canvas handles its own zooming; browser pinch-zoom would fight it.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
