/**
 * Streaming PNG encoder.
 *
 * The obvious way to save a render is to draw it on a `<canvas>` and call
 * `toBlob()`. That stops working well before 32K: every engine caps *total*
 * canvas area — 268 Mpx (16384^2) on Chrome, lower still on Safari — and a
 * 30720x17280 frame is 531 Mpx. It also wants the whole image as one
 * contiguous RGBA buffer, which is 2.1 GB at that size.
 *
 * So this writes the PNG byte stream directly. Rows arrive as horizontal
 * bands, are repacked to RGB, and go straight into the platform's
 * `CompressionStream("deflate")` — that format is zlib (RFC 1950), which is
 * exactly what an IDAT payload has to contain. Compressed output is folded
 * into Blob parts as it appears, so neither the raw image nor the finished
 * file ever exists as a single JS allocation.
 *
 * Every scanline uses filter type 0 (None). That is not laziness: measured on
 * three real 1920x1080 renders (flat home view, seahorse valley, triple
 * spiral), None was between 4.5% larger and 4% *smaller* than Sub / Up / Paeth
 * / adaptive-minimum-sum, while being 2-3x cheaper end to end — deflate's own
 * LZ77 already captures the horizontal runs that Sub would, and filtering
 * mostly destroys the byte-level repeats it feeds on. Those runs measured
 * 0.20-1.35 bytes per pixel of output, i.e. a 32K export lands somewhere
 * between 105 MB and 720 MB depending on how busy the region is.
 */

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IDAT_TAG = new Uint8Array([0x49, 0x44, 0x41, 0x54]); // "IDAT"

/** Compressed bytes to gather before emitting one IDAT chunk. */
const IDAT_TARGET_BYTES = 4 << 20;
/**
 * Compressed bytes to hold as live JS buffers before folding them into a Blob.
 * Blob storage can spill to disk; a plain array of Uint8Arrays cannot, and a
 * busy 32K frame produces several hundred MB of them.
 */
const BLOB_FOLD_BYTES = 32 << 20;
/** Raw bytes handed to the deflater per write. */
const WRITE_CHUNK_BYTES = 4 << 20;

/**
 * TypeScript models a bare `Uint8Array` as possibly backed by a
 * SharedArrayBuffer, which `BlobPart` will not accept. Everything here is
 * plainly backed, so say so once instead of casting at every call site.
 */
type Bytes = Uint8Array<ArrayBuffer>;

const CRC_TABLE = /* @__PURE__ */ (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** Running CRC-32; seed with 0xffffffff and XOR the result with it at the end. */
function crc32(seed: number, bytes: Uint8Array): number {
  let c = seed;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

function u32(value: number): Bytes {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function chunk(type: string, data: Uint8Array): Bytes {
  const out = new Uint8Array(data.length + 12);
  new DataView(out.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(0xffffffff, out.subarray(4, out.length - 4)) ^ 0xffffffff;
  new DataView(out.buffer).setUint32(out.length - 4, crc >>> 0);
  return out;
}

function ihdr(width: number, height: number): Bytes {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8; // bit depth
  data[9] = 2; // colour type 2 = truecolour RGB (the renders are fully opaque)
  data[10] = 0; // deflate
  data[11] = 0; // adaptive filtering
  data[12] = 0; // no interlace
  return data;
}

/** RGBA rows -> RGB scanlines, each prefixed with a zero filter byte. */
function packRows(
  rgba: Uint8Array,
  firstRow: number,
  rows: number,
  width: number,
): Bytes {
  const stride = width * 3 + 1;
  const out = new Uint8Array(rows * stride);
  let src = firstRow * width * 4;
  let dst = 0;
  for (let y = 0; y < rows; y++) {
    out[dst++] = 0;
    for (let x = 0; x < width; x++) {
      out[dst++] = rgba[src];
      out[dst++] = rgba[src + 1];
      out[dst++] = rgba[src + 2];
      src += 4;
    }
  }
  return out;
}

/** Whether this browser can encode a PNG without going through a canvas. */
export function supportsStreamingPng(): boolean {
  return typeof CompressionStream === "function";
}

/**
 * Encode top-down RGBA bands into a PNG Blob.
 *
 * Each band is a whole number of full-width rows; together they must cover
 * exactly `height` rows, and a short or long stream is an error rather than a
 * silently truncated file. Nothing is handed back until IEND has been written,
 * so a failure part way through yields no image at all.
 */
export async function encodePngStream(
  width: number,
  height: number,
  bands: AsyncIterable<Uint8Array>,
  onProgress?: (rowsEncoded: number) => void,
): Promise<Blob> {
  if (!supportsStreamingPng()) {
    throw new Error(
      "This browser has no Compression Streams API, which large PNG exports need.",
    );
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new Error(`Cannot encode a ${width}x${height} PNG.`);
  }

  // Finished sections, oldest first. Blobs come first because they are folded
  // out of `parts` in order.
  const folded: Blob[] = [];
  let parts: BlobPart[] = [SIGNATURE, chunk("IHDR", ihdr(width, height))];
  let partBytes = 0;

  // Compressed bytes not yet wrapped in an IDAT.
  let pending: Bytes[] = [];
  let pendingBytes = 0;

  const flushIdat = () => {
    if (pendingBytes === 0) return;
    let crc = crc32(0xffffffff, IDAT_TAG);
    for (const piece of pending) crc = crc32(crc, piece);
    parts.push(u32(pendingBytes), IDAT_TAG, ...pending, u32((crc ^ 0xffffffff) >>> 0));
    partBytes += pendingBytes + 12;
    pending = [];
    pendingBytes = 0;

    if (partBytes >= BLOB_FOLD_BYTES) {
      folded.push(new Blob(parts));
      parts = [];
      partBytes = 0;
    }
  };

  const stream = new CompressionStream("deflate");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();

  // Drain concurrently with writing: a CompressionStream applies backpressure,
  // so writing without reading deadlocks on anything larger than its buffer.
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending.push(value as Bytes);
      pendingBytes += value.length;
      if (pendingBytes >= IDAT_TARGET_BYTES) flushIdat();
    }
  })();

  let rowsEncoded = 0;
  try {
    const rowsPerWrite = Math.max(1, Math.floor(WRITE_CHUNK_BYTES / (width * 3 + 1)));
    for await (const band of bands) {
      if (band.length % (width * 4) !== 0) {
        throw new Error("A PNG band did not contain whole rows.");
      }
      const bandRows = band.length / (width * 4);
      if (rowsEncoded + bandRows > height) {
        throw new Error("The PNG source produced more rows than the image has.");
      }
      for (let row = 0; row < bandRows; row += rowsPerWrite) {
        const rows = Math.min(rowsPerWrite, bandRows - row);
        // A fresh buffer per write: the deflater may still hold the previous
        // one, so a reused scratch buffer could be compressed after we
        // overwrote it.
        await writer.write(packRows(band, row, rows, width));
      }
      rowsEncoded += bandRows;
      onProgress?.(rowsEncoded);
    }
    if (rowsEncoded !== height) {
      throw new Error(
        `The PNG source produced ${rowsEncoded} of ${height} rows.`,
      );
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    await drain.catch(() => {});
    throw error;
  }

  await drain;
  flushIdat();
  parts.push(chunk("IEND", new Uint8Array(0)));

  return new Blob([...folded, ...parts], { type: "image/png" });
}
