/** Turn raw RGBA pixels into a PNG download. */
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

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const EXPORT_SIZES = [
  { id: "1080p", label: "1080p", width: 1920, height: 1080 },
  { id: "1440p", label: "1440p", width: 2560, height: 1440 },
  { id: "4k", label: "4K", width: 3840, height: 2160 },
  { id: "8k", label: "8K", width: 7680, height: 4320 },
] as const;

export type ExportSizeId = (typeof EXPORT_SIZES)[number]["id"];
