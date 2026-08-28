import { encodePngStream, supportsStreamingPng } from "./png";
import type { MandelbrotRenderer, RenderParams } from "./renderer";

export const EXPORT_SIZES = [
  { id: "1080p", label: "1080p", width: 1920, height: 1080 },
  { id: "1440p", label: "1440p", width: 2560, height: 1440 },
  { id: "4k", label: "4K", width: 3840, height: 2160 },
  { id: "8k", label: "8K", width: 7680, height: 4320 },
  { id: "16k", label: "16K", width: 15360, height: 8640 },
  { id: "32k", label: "32K", width: 30720, height: 17280 },
] as const;

export type ExportSizeId = (typeof EXPORT_SIZES)[number]["id"];
export type ExportSize = (typeof EXPORT_SIZES)[number];

/** Anti-aliasing floor for exports: a saved image is always supersampled. */
export const EXPORT_MIN_AA = 2;

/**
 * Shader samples (pixels x AA^2) per draw call.
 *
 * Nothing forces the frame to be cut this finely — a 16K frame fits inside the
 * 16384 renderbuffer limit most GPUs report — but a single multi-second draw is
 * the surest way to trip a GPU watchdog (~2 s on Windows, a few seconds on
 * macOS) and lose the context half way through an export that has already run
 * for minutes. Counting samples rather than pixels is what keeps that true when
 * the anti-aliasing is turned up: 64 M samples is 16 Mpx at the AA=2 floor,
 * about half of the 33 Mpx the 8K export has always issued in one go, and it
 * shrinks the tiles automatically at AA=3 instead of tripling the draw time.
 */
const MAX_TILE_SAMPLES = 64 << 20;

/**
 * Ceiling on the RGBA buffer a horizontally tiled frame is assembled in. Only
 * bites when the GPU's renderbuffer limit is small enough to force narrow
 * tiles, where the band would otherwise grow to half a gigabyte.
 */
const BAND_STAGING_BUDGET = 160 << 20;

/**
 * Largest export routed through a `<canvas>` when the streaming encoder is not
 * available. Chrome caps total canvas area at 268 Mpx and Safari lower, so this
 * stays inside the sizes that shipped before streaming encoding existed (8K is
 * 33.2 Mpx).
 */
const CANVAS_FALLBACK_MAX_PIXELS = 40_000_000;

/**
 * Measured PNG output on real 1920x1080 renders, in bytes per pixel: 0.20 for a
 * smooth overview of the whole set, 1.35 for a dense deep-zoom region. Used
 * only to warn about file size before a huge export starts.
 */
const PNG_BYTES_PER_PIXEL: readonly [number, number] = [0.2, 1.35];

export interface ExportPlan {
  width: number;
  height: number;
  /** Tile width; equals `width` unless the GPU cannot render that wide. */
  tileWidth: number;
  tilesAcross: number;
  /** Rows rendered, assembled and encoded at a time. */
  bandHeight: number;
  bandCount: number;
  tileCount: number;
  /** Peak RGBA scratch this plan needs, in bytes. */
  stagingBytes: number;
}

/**
 * Work out how to cut a frame into GPU-sized pieces.
 *
 * The width limit comes from the GPU (`MAX_RENDERBUFFER_SIZE`, typically
 * 16384) and the height from `MAX_TILE_SAMPLES`; at the AA floor everything at
 * 8K and below still ends up as one or two draws.
 */
export function planExport(
  size: { width: number; height: number },
  maxRenderSize: number,
  aa: number = EXPORT_MIN_AA,
): ExportPlan {
  const limit = Math.max(1, Math.floor(maxRenderSize));
  const tilesAcross = Math.ceil(size.width / limit);
  // Split evenly rather than leaving a sliver on the right.
  const tileWidth = Math.ceil(size.width / tilesAcross);
  const bandHeight = Math.max(
    1,
    Math.min(
      size.height,
      limit,
      Math.floor(MAX_TILE_SAMPLES / (tileWidth * Math.max(1, aa) ** 2)),
      Math.floor(BAND_STAGING_BUDGET / (size.width * 4)),
    ),
  );
  const bandCount = Math.ceil(size.height / bandHeight);

  // renderToPixels holds the read-back twice (raw, then row-flipped), and a
  // horizontally tiled frame also needs somewhere to assemble the band.
  const stagingBytes =
    tileWidth * bandHeight * 4 * 2 +
    (tilesAcross > 1 ? size.width * bandHeight * 4 : 0);

  return {
    width: size.width,
    height: size.height,
    tileWidth,
    tilesAcross,
    bandHeight,
    bandCount,
    tileCount: bandCount * tilesAcross,
    stagingBytes,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.round(bytes / 1e3)} kB`;
}

/**
 * Rough peak memory an export needs: the tiling scratch, plus the finished PNG,
 * which the browser holds as a Blob until the download has been written out.
 *
 * A full-scale dry run of a dense 30720x17280 frame peaked at 1.3 GB against
 * the 1.0 GB this predicts, so treat it as a floor rather than a bound.
 */
export function peakExportBytes(
  size: ExportSize,
  maxRenderSize: number,
): number {
  return (
    planExport(size, maxRenderSize).stagingBytes +
    size.width * size.height * PNG_BYTES_PER_PIXEL[1]
  );
}

/**
 * Why this size cannot be exported here, or null if it can. Checked up front so
 * an impossible export is refused before it burns minutes of GPU time — half an
 * hour of rendering followed by an out-of-memory crash is the one outcome worth
 * going out of the way to avoid.
 */
export function exportBlocker(
  size: ExportSize,
  maxRenderSize: number,
): string | null {
  if (!Number.isFinite(maxRenderSize) || maxRenderSize < 256) {
    return "This GPU reports no usable offscreen render size.";
  }
  // Everything at 8K and below shipped before any of this existed and keeps
  // working unconditionally; only the two new sizes have to justify themselves.
  if (size.width * size.height <= CANVAS_FALLBACK_MAX_PIXELS) return null;

  if (!supportsStreamingPng()) {
    return `${size.label} needs the Compression Streams API, which this browser does not have — a ${size.width}x${size.height} image is far too large for a canvas.`;
  }

  // Chromium-only, rounded down to a power of two and capped at 8. Absent means
  // "no idea", which is let through rather than guessed at.
  const deviceMemoryGb = (
    globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined
  )?.deviceMemory;
  const needed = peakExportBytes(size, maxRenderSize);
  if (deviceMemoryGb !== undefined && needed * 3 > deviceMemoryGb * 1e9) {
    return `${size.label} needs upwards of ${formatBytes(needed)} of memory and this device reports only ${deviceMemoryGb} GB.`;
  }
  return null;
}

/** One-line warning shown under the size picker, or null for the small ones. */
export function describeExport(
  size: ExportSize,
  maxRenderSize: number,
  aa: number = EXPORT_MIN_AA,
): string | null {
  const plan = planExport(size, maxRenderSize, aa);
  if (plan.tileCount <= 2) return null;
  const pixels = size.width * size.height;
  const low = formatBytes(pixels * PNG_BYTES_PER_PIXEL[0]);
  const high = formatBytes(pixels * PNG_BYTES_PER_PIXEL[1]);
  return `${plan.tileCount} tiles · ${low}–${high} PNG · needs ~${formatBytes(peakExportBytes(size, maxRenderSize))} free`;
}

/**
 * Re-aim `base` at one tile of a larger frame. `x`/`y` are the tile's top-left
 * corner in top-down image pixels.
 *
 * A tile is just a narrower view of the same scene, so the shader needs no
 * notion of tiling: shift the centre onto the tile's centre and scale the span
 * by the tile's share of the frame. The algebra cancels exactly — a tile pixel
 * is handed the same complex coordinate a full-frame render would have handed
 * it — so tiles butt together seamlessly instead of merely closely.
 *
 * Under the perturbation kernel the centre never reaches the shader, so the
 * same shift is applied to `deltaC`. The reference orbit is passed through
 * untouched, which also means it is uploaded to the GPU once for the whole
 * export rather than once per tile.
 */
export function tileParams(
  base: RenderParams,
  frameWidth: number,
  frameHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
): RenderParams {
  const spanX = base.spanY * (frameWidth / frameHeight);
  const dx = ((x + width / 2) / frameWidth - 0.5) * spanX;
  // Image rows run top-down; the imaginary axis runs up.
  const dy = -((y + height / 2) / frameHeight - 0.5) * base.spanY;

  const params: RenderParams = {
    ...base,
    centerX: base.centerX + dx,
    centerY: base.centerY + dy,
    spanY: base.spanY * (height / frameHeight),
  };
  if (base.kernel === "perturb") {
    const [d0, d1] = base.deltaC ?? [0, 0];
    params.deltaC = [d0 + dx, d1 + dy];
  }
  return params;
}

/** Turn raw RGBA pixels into a PNG download, via a canvas. */
export async function downloadPng(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  filename: string,
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create a 2D context for the export.");
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("PNG encoding failed.");
  saveBlob(blob, filename);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.click();
  // Revoking straight away cancels the download of a large blob in Safari and
  // Firefox, which have not finished reading it when click() returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export interface ExportProgress {
  /** 0 to 1. */
  fraction: number;
  note: string;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The slice of MandelbrotRenderer the export path uses. */
export interface ExportRenderer {
  readonly maxRenderSize: number;
  readonly gl: Pick<WebGL2RenderingContext, "isContextLost">;
  renderToPixels(
    width: number,
    height: number,
    params: RenderParams,
  ): Uint8ClampedArray<ArrayBuffer>;
}

/**
 * Render the view at `size`, in tiles, straight into a PNG Blob.
 *
 * Past 8K a canvas is not an option — a 32K frame is 531 Mpx, twice Chrome's
 * canvas area cap, and 2.1 GB of RGBA — so the tiles are streamed through the
 * encoder in lib/png.ts instead. Nothing is returned until the last byte is
 * written, so a failure anywhere leaves no image rather than a truncated one.
 */
export async function renderPngBlob(options: {
  renderer: ExportRenderer;
  params: RenderParams;
  size: ExportSize;
  onProgress?: (progress: ExportProgress) => void;
}): Promise<Blob> {
  const { renderer, params, size, onProgress } = options;
  const maxRenderSize = renderer.maxRenderSize;

  const blocker = exportBlocker(size, maxRenderSize);
  if (blocker) throw new Error(blocker);

  const plan = planExport(size, maxRenderSize, params.aa);

  // Allocate the scratch buffer before rendering anything. A 32K export runs
  // for minutes; discovering there is no memory for it at the end is the worst
  // possible moment.
  let staging: Uint8Array | null = null;
  if (plan.tilesAcross > 1) {
    try {
      staging = new Uint8Array(plan.width * plan.bandHeight * 4);
    } catch {
      throw new Error(
        `Not enough memory for a ${size.width}x${size.height} export; it needs ${formatBytes(plan.stagingBytes)} of scratch space.`,
      );
    }
  }

  let tilesDone = 0;
  const report = () => {
    onProgress?.({
      // The encoder runs in step with the renderer, so tile count is a fair
      // proxy for the whole pipeline; the last slice is the final flush.
      fraction: (tilesDone / plan.tileCount) * 0.97,
      note: plan.tileCount > 1 ? `Tile ${tilesDone}/${plan.tileCount}` : "Rendering",
    });
  };

  const drawTile = (x: number, y: number, width: number, height: number) => {
    const pixels = renderer.renderToPixels(
      width,
      height,
      tileParams(params, size.width, size.height, x, y, width, height),
    );
    if (renderer.gl.isContextLost()) {
      throw new Error("The GPU context was lost part way through the export.");
    }
    tilesDone++;
    report();
    return pixels;
  };

  async function* bands(): AsyncGenerator<Uint8Array> {
    for (let y = 0; y < size.height; y += plan.bandHeight) {
      const rows = Math.min(plan.bandHeight, size.height - y);

      if (plan.tilesAcross === 1) {
        const pixels = drawTile(0, y, size.width, rows);
        yield new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      } else {
        const band = staging as Uint8Array;
        for (let x = 0; x < size.width; x += plan.tileWidth) {
          const width = Math.min(plan.tileWidth, size.width - x);
          const pixels = drawTile(x, y, width, rows);
          for (let row = 0; row < rows; row++) {
            band.set(
              pixels.subarray(row * width * 4, (row + 1) * width * 4),
              row * size.width * 4 + x * 4,
            );
          }
          await yieldToUi();
        }
        // Safe to reuse next time round: an async generator only resumes when
        // the encoder asks for the next band, by which point it has copied
        // this one into the deflater.
        yield band.subarray(0, rows * size.width * 4);
      }
      // Let the progress bar repaint between bands.
      await yieldToUi();
    }
  }

  return encodePngStream(size.width, size.height, bands());
}

/** Render the view at `size` and hand it to the browser as a download. */
export async function exportPng(options: {
  renderer: MandelbrotRenderer;
  params: RenderParams;
  size: ExportSize;
  filename: string;
  onProgress?: (progress: ExportProgress) => void;
}): Promise<void> {
  const { renderer, size, filename, onProgress } = options;

  const blocker = exportBlocker(size, renderer.maxRenderSize);
  if (blocker) throw new Error(blocker);

  if (!supportsStreamingPng()) {
    // exportBlocker has already rejected anything too big for a canvas.
    onProgress?.({ fraction: 0.1, note: "Rendering" });
    const pixels = renderer.renderToPixels(size.width, size.height, options.params);
    onProgress?.({ fraction: 0.9, note: "Encoding" });
    await downloadPng(pixels, size.width, size.height, filename);
    return;
  }

  const blob = await renderPngBlob(options);
  onProgress?.({ fraction: 1, note: "Saving" });
  saveBlob(blob, filename);
}
