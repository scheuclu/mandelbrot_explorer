/**
 * Custom Vercel Web Analytics events.
 *
 * Every event the app can send is declared in `EventCatalogue` below and sent
 * through one helper on `analytics`, so a call site is a one-liner and
 * TypeScript — not a string literal — decides what a name and its properties
 * may be.
 *
 * ## Quota
 *
 * Page views and custom events come out of one metered pool: 50,000 a month on
 * Hobby (after which collection pauses for a week), billed at $0.03 per 1,000
 * on Pro. Custom events are a Pro-and-above feature; on Hobby `track()` is
 * accepted by the SDK and dropped. Names, property keys and property values are
 * each capped at 255 characters, values must be a string, number, boolean or
 * null, and the number of properties per event is a *plan* limit — see
 * `MAX_PROPERTIES`. There is no documented per-visitor rate limit and the SDK
 * does no throttling of its own, so pacing is entirely this module's job.
 *
 * ## Volume
 *
 * This is a real-time renderer: a `requestAnimationFrame` loop, sliders that
 * fire `onChange` on every input tick, continuous pan/zoom gestures, and a
 * colour animation that repaints 60 times a second. Custom events are metered,
 * so a naive `track()` on any of those paths would burn a month of quota in an
 * afternoon. Nothing is reported from the render loop except the one error
 * path that kills it, and every helper below states which of the three
 * throttling strategies it uses:
 *
 * - **once** — at most one event per key per page load (`once()`).
 * - **settled** — fired `SETTLE_MS` after the last call, so a drag, an
 *   auto-repeating key, or arrowing through a `<select>` reports the value the
 *   user landed on rather than every value they passed through (`settled()`).
 *   This is the same 180ms window the renderer uses to decide a view has
 *   stopped moving, so the report and the sharp repaint happen together.
 * - **direct** — a discrete, human-paced action (a completed export, a button
 *   click). One event per action, no smoothing needed.
 *
 * ## Privacy
 *
 * No PII and no free text. Every property is either a number, a boolean, or a
 * value from a closed set declared here. In particular the view coordinates are
 * never sent: they are not personal data but they are unbounded cardinality, so
 * only a bucketed zoom magnitude goes out. Palette and preset ids arrive from
 * the URL hash, which anyone can hand-edit, and are re-checked against the
 * known lists before being reported.
 */
import { track } from "@vercel/analytics";

import type { ExportBlockReason, ExportSizeId } from "./download";
import { paletteById } from "./palettes";
import { PRESETS } from "./presets";
import { SETTLE_MS, type PrecisionMode } from "./settings";
import type { KernelMode } from "./shader";

// --- buckets ---------------------------------------------------------------

/**
 * Zoom magnitudes, coarse enough to stay a closed set. Three decades apart
 * because that is roughly one "that's a different kind of picture" step, and
 * zero-padded so the dashboard sorts them in numeric order.
 *
 * The bucket is the largest one the current zoom has reached, so `1e06` means
 * "at least a million times in", not "exactly".
 */
export const ZOOM_BUCKETS = [
  "1e00",
  "1e03",
  "1e06",
  "1e09",
  "1e12",
  "1e15",
  "1e18",
  "1e21",
  "1e24",
] as const;

export type ZoomBucket = (typeof ZOOM_BUCKETS)[number];

/** Bucket a zoom factor (`HOME_SPAN / spanY`) into one of `ZOOM_BUCKETS`. */
export function zoomBucket(zoom: number): ZoomBucket {
  if (!Number.isFinite(zoom) || zoom < 1) return ZOOM_BUCKETS[0];
  const decades = Math.floor(Math.log10(zoom));
  const index = Math.floor(decades / 3);
  return ZOOM_BUCKETS[Math.min(ZOOM_BUCKETS.length - 1, Math.max(0, index))];
}

/** Why an export that had already started did not produce a file. */
export type ExportFailureReason =
  | "context_lost"
  | "out_of_memory"
  | "gpu_limit"
  | "unsupported"
  | "encoding"
  | "other";

/** Why the GPU could not be used at all. */
export type WebglErrorReason = "no_webgl2" | "shader" | "render" | "other";

/**
 * Map a thrown error onto one of the reasons above.
 *
 * Matching on our own message text is not lovely, but the alternative is
 * threading an error taxonomy through the export pipeline for the sake of
 * analytics. Every branch is a message this repo raises; anything else — a
 * browser-generated `RangeError`, say — lands in a catch-all rather than being
 * forwarded as free text, so no unbounded string can ever reach an event.
 */
function classify<T extends string>(
  error: unknown,
  table: readonly (readonly [RegExp, T])[],
  fallback: T,
): T {
  const message = error instanceof Error ? error.message : String(error);
  for (const [pattern, reason] of table) {
    if (pattern.test(message)) return reason;
  }
  return fallback;
}

const EXPORT_FAILURES: readonly (readonly [RegExp, ExportFailureReason])[] = [
  [/context was lost/i, "context_lost"],
  [/memory|allocation failed/i, "out_of_memory"],
  [
    /caps offscreen renders|framebuffer is incomplete|no usable offscreen render size/i,
    "gpu_limit",
  ],
  [/compression streams/i, "unsupported"],
  [/png|encod|deflate|scanline|rows/i, "encoding"],
];

const WEBGL_ERRORS: readonly (readonly [RegExp, WebglErrorReason])[] = [
  [/webgl2 is not available/i, "no_webgl2"],
  [/shader compile failed|program link failed|allocate shader|allocate program/i, "shader"],
];

// --- event catalogue -------------------------------------------------------

/**
 * Vercel accepts `string`, `number`, `boolean` and `null` as property values.
 * Objects and arrays are rejected outright, so the catalogue below is written
 * flat and every value is checked against this at compile time.
 */
type EventProperties = Record<string, string | number | boolean | null>;

/**
 * Identity, but the constraint makes declaring an event with a nested object or
 * an array a compile error at the point it is written rather than a silently
 * stripped property at runtime.
 */
type Catalogue<T extends Record<string, EventProperties>> = T;

type EventCatalogue = Catalogue<{
  /**
   * Once per page load, as soon as the GL context exists. Answers the question
   * the 16K/32K export path was built on and nobody can currently answer:
   * how much of the real audience can actually run it.
   */
  session_capabilities: {
    /** Largest size this device is allowed to export — the headline answer. */
    max_export: ExportSizeId | "none";
    /** `MAX_RENDERBUFFER_SIZE`; decides how finely an export must be tiled. */
    max_render_size: number;
    /** `CompressionStream`; without it nothing above 8K can be encoded. */
    compression_streams: boolean;
    /** `EXT_color_buffer_float`; without it colour cycling has no count cache. */
    color_buffer_float: boolean;
    /** Chromium-only, absent elsewhere. */
    device_memory_gb: number | null;
  };

  /** A PNG finished encoding and was handed to the browser. The headline action. */
  export_png: {
    size: ExportSizeId;
    zoom: ZoomBucket;
    palette: string;
    kernel: KernelMode;
    /** Supersampling grid per axis. */
    aa: number;
  };

  /** An export started and then threw. */
  export_failed: { reason: ExportFailureReason; size: ExportSizeId };

  /** A size this device is refused, reported once per size per page load. */
  export_blocked: { reason: ExportBlockReason; size: ExportSizeId };

  /** A decade milestone reached for the first time this page load. */
  zoom_depth: { depth: ZoomBucket };

  preset_jump: { preset: string };
  palette_change: { palette: string };
  copy_link: { zoom: ZoomBucket; status: "ok" | "failed" };
  color_animation_toggle: { state: "on" | "off" };
  precision_change: { mode: PrecisionMode };
  welcome_dialog: { action: "shown" | "dismissed" };

  webgl_error: { reason: WebglErrorReason };
  /** The GPU took the context away. Much more likely mid-export. */
  context_lost: { exporting: boolean };
}>;

type EventName = keyof EventCatalogue;

// --- transport -------------------------------------------------------------

/**
 * Properties Vercel keeps per custom event. **This is a plan limit**: 2 on Pro,
 * 8 on Pro with the Web Analytics Plus add-on and on Enterprise. What the
 * server does with the surplus is not documented anywhere, so the trimming
 * happens here instead, where it is at least predictable: every event above
 * declares its properties most-important-first and the tail is what goes.
 *
 * Only `session_capabilities` and `export_png` declare more than two, so on a
 * bare Pro plan set this to 2 and those two events keep the pair that carries
 * most of their signal.
 */
const MAX_PROPERTIES = 8;

const isBrowser = () => typeof window !== "undefined";

/**
 * The one place `track()` is called.
 *
 * `track()` throws outside the browser in a development build and warns in a
 * production one, and this page is statically prerendered, so the browser check
 * is not optional. Nothing in this module touches `window` at module scope for
 * the same reason. When analytics is switched off, or the script is blocked,
 * `window.va` is simply absent and `track()` is already a no-op — the try/catch
 * is only here so that a future validation error cannot take the renderer down
 * with it.
 */
function emit<K extends EventName>(name: K, properties: EventCatalogue[K]): void {
  if (!isBrowser()) return;
  try {
    const entries = Object.entries(properties as EventProperties);
    track(name, Object.fromEntries(entries.slice(0, MAX_PROPERTIES)));
  } catch {
    // Analytics is never worth an exception on a user's canvas.
  }
}

/**
 * Keys already reported. "Session" means one page load: this is a single-page
 * app with no client-side navigation, so the module instance and the visit are
 * the same thing. Never written on the server — `emit` is the only consumer and
 * it bails there first.
 */
const reported = new Set<string>();

function once<K extends EventName>(
  key: string,
  name: K,
  properties: EventCatalogue[K],
): void {
  if (!isBrowser() || reported.has(key)) return;
  reported.add(key);
  emit(name, properties);
}

const pending = new Map<string, number>();

/** Report `SETTLE_MS` after the last call for this key; earlier calls are dropped. */
function settled<K extends EventName>(
  key: string,
  name: K,
  properties: EventCatalogue[K],
): void {
  if (!isBrowser()) return;
  const timer = pending.get(key);
  if (timer !== undefined) window.clearTimeout(timer);
  pending.set(
    key,
    window.setTimeout(() => {
      pending.delete(key);
      emit(name, properties);
    }, SETTLE_MS),
  );
}

// --- events ----------------------------------------------------------------

/** Collapse anything the URL hash may contain onto a known palette id. */
function safePalette(id: string): string {
  return paletteById(id).id;
}

export const analytics = {
  /** once — the device does not change mid-visit. */
  sessionCapabilities(capabilities: EventCatalogue["session_capabilities"]): void {
    once("session_capabilities", "session_capabilities", capabilities);
  },

  /**
   * direct — an export takes seconds to minutes and is deliberate, so one
   * event per file is exactly the volume we want.
   */
  exportPng(properties: EventCatalogue["export_png"]): void {
    emit("export_png", {
      ...properties,
      palette: safePalette(properties.palette),
    });
  },

  /** direct — same rate as `export_png`; they are the two halves of one funnel. */
  exportFailed(size: ExportSizeId, error: unknown): void {
    emit("export_failed", {
      reason: classify(error, EXPORT_FAILURES, "other"),
      size,
    });
  },

  /**
   * once per size — a blocked size is a property of the device, discovered at
   * startup, not something the visitor does repeatedly. The picker disables it,
   * so there is no click to count either way.
   */
  exportBlocked(size: ExportSizeId, reason: ExportBlockReason): void {
    once(`export_blocked:${size}`, "export_blocked", { reason, size });
  },

  /**
   * once per milestone — zooming is a continuous gesture that would otherwise
   * emit on every wheel tick. Only the first crossing of each decade counts,
   * and the shallow bucket is skipped because every session starts there.
   */
  zoomDepth(depth: ZoomBucket): void {
    if (depth === ZOOM_BUCKETS[0]) return;
    once(`zoom_depth:${depth}`, "zoom_depth", { depth });
  },

  /**
   * settled — the preset picker is a native `<select>`, and arrowing through it
   * with the keyboard commits a change per keypress. Report the one landed on.
   */
  presetJump(presetId: string): void {
    if (!PRESETS.some((preset) => preset.id === presetId)) return;
    settled("preset_jump", "preset_jump", { preset: presetId });
  },

  /** settled — same keyboard-in-a-`<select>` behaviour as the preset picker. */
  paletteChange(palette: string): void {
    settled("palette_change", "palette_change", {
      palette: safePalette(palette),
    });
  },

  /** direct — one click, and the clipboard write either worked or it did not. */
  copyLink(zoom: ZoomBucket, status: "ok" | "failed"): void {
    emit("copy_link", { zoom, status });
  },

  /**
   * settled — Space toggles cycling and auto-repeats while held, which would
   * otherwise be one event per repeat. Debouncing reports the state it ends on.
   */
  colorAnimationToggle(on: boolean): void {
    settled("color_animation_toggle", "color_animation_toggle", {
      state: on ? "on" : "off",
    });
  },

  /** settled — a `<select>`, for the same reason as the palette picker. */
  precisionChange(mode: PrecisionMode): void {
    settled("precision_change", "precision_change", { mode });
  },

  /**
   * once per action — the dialog auto-opens on a first visit and the "?" button
   * reopens it any number of times. One shown and one dismissed per visit is
   * what the funnel needs; the reopen count is noise.
   */
  welcomeDialog(action: "shown" | "dismissed"): void {
    once(`welcome_dialog:${action}`, "welcome_dialog", { action });
  },

  /**
   * once per reason — a GPU failure is terminal here (the render loop stops),
   * but the guard also covers React re-running an effect in strict mode.
   */
  webglError(error: unknown, reason?: WebglErrorReason): void {
    const bucket = reason ?? classify(error, WEBGL_ERRORS, "other");
    once(`webgl_error:${bucket}`, "webgl_error", { reason: bucket });
  },

  /** once — the context is not coming back without a reload. */
  contextLost(exporting: boolean): void {
    once("context_lost", "context_lost", { exporting });
  },
};
