"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toNumber } from "@/lib/bigfloat";
import {
  EXPORT_MIN_AA,
  EXPORT_SIZES,
  type ExportProgress,
  type ExportSizeId,
  describeExport,
  exportBlocker,
  exportPng,
} from "@/lib/download";
import { paletteIndex } from "@/lib/palettes";
import { PRESETS } from "@/lib/presets";
import {
  type ReferenceOrbit,
  computeReferenceOrbit,
  orbitIsUsable,
} from "@/lib/reference";
import { MandelbrotRenderer, type RenderParams } from "@/lib/renderer";
import type { KernelMode } from "@/lib/shader";
import {
  DEFAULT_SETTINGS,
  type Settings,
  wrapColorOffset,
} from "@/lib/settings";
import {
  DEEP_SPAN_THRESHOLD,
  HOME_VIEW,
  MIN_SPAN,
  type SharedState,
  type View,
  autoIterations,
  centerAsNumbers,
  clampView,
  decodeHash,
  encodeHash,
  panByPixels,
  zoomAt,
} from "@/lib/view";
import { ControlPanel } from "./ControlPanel";
import { StatusBar } from "./StatusBar";
import { WelcomeDialog, useWelcomeDialog } from "./WelcomeDialog";

const INTERIOR_COLOR: [number, number, number] = [0, 0, 0];
/** How long the view must hold still before the full-quality pass runs. */
const SETTLE_MS = 180;
const MAX_DPR = 2;

export interface Readout {
  view: View;
  maxIter: number;
  kernel: KernelMode;
  orbitLength: number;
  fps: number;
  atPrecisionFloor: boolean;
}

export function MandelbrotExplorer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<MandelbrotRenderer | null>(null);

  // The view lives in a ref so pointer handling never triggers a React render.
  const viewRef = useRef<View>(HOME_VIEW);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const dirtyRef = useRef(true);
  const interactingRef = useRef(false);
  const settleTimerRef = useRef<number | null>(null);
  const frameTimesRef = useRef<number[]>([]);
  const orbitRef = useRef<ReferenceOrbit | null>(null);
  // Mirrored into a ref so the keyboard handler can ignore shortcuts while the
  // dialog is up without re-registering its listeners on every toggle.
  const infoOpenRef = useRef(false);
  // Read by the render loop, which must not fight the export for the GPU.
  const exportingRef = useRef(false);
  /**
   * Gradient rotation accumulated by the animation, kept out of React state:
   * folding it in at 60fps would rerender the tree every frame. It is added to
   * settings.colorOffset at render time and merged back in when cycling stops.
   */
  const animPhaseRef = useRef(0);

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [error, setError] = useState<string | null>(null);
  const [exportSize, setExportSize] = useState<ExportSizeId>("4k");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  // Only known once the GL context exists; until then no size is ruled out.
  const [maxRenderSize, setMaxRenderSize] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const welcome = useWelcomeDialog();
  const [readout, setReadout] = useState<Readout>({
    view: HOME_VIEW,
    maxIter: autoIterations(HOME_VIEW.spanY),
    kernel: "single",
    orbitLength: 0,
    fps: 0,
    atPrecisionFloor: false,
  });

  const invalidate = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  /** The offset actually on screen: the stored one plus any animated rotation. */
  const liveColorOffset = useCallback(
    () => wrapColorOffset(settingsRef.current.colorOffset + animPhaseRef.current),
    [],
  );

  /**
   * Start cycling, or stop it and fold the rotation back into colorOffset so
   * the still frame matches the last animated one and the URL stays truthful.
   */
  const toggleAnimate = useCallback(() => {
    const config = settingsRef.current;
    const next: Settings = config.animate
      ? { ...config, animate: false, colorOffset: liveColorOffset() }
      : { ...config, animate: true };
    if (config.animate) animPhaseRef.current = 0;
    settingsRef.current = next;
    setSettings(next);
    dirtyRef.current = true;
  }, [liveColorOffset]);

  /** Mark the view as actively changing; schedule the sharp pass afterwards. */
  const beginInteraction = useCallback(() => {
    interactingRef.current = true;
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = window.setTimeout(() => {
      interactingRef.current = false;
      dirtyRef.current = true;
    }, SETTLE_MS);
    dirtyRef.current = true;
  }, []);

  /** Adopt a view (and any styling) that arrived through the URL. */
  const applyShared = useCallback((shared: SharedState) => {
    const previous = settingsRef.current;
    const next: Settings = {
      ...previous,
      palette: shared.palette ?? previous.palette,
      autoIter: shared.maxIter ? false : previous.autoIter,
      maxIter: shared.maxIter ?? previous.maxIter,
      colorCycle: shared.colorCycle ?? previous.colorCycle,
      colorOffset: shared.colorOffset ?? previous.colorOffset,
    };

    viewRef.current = clampView(shared);
    // Write the ref as well as React state: the render loop reads the ref, and
    // the first frame would otherwise be an expensive render of the defaults.
    settingsRef.current = next;
    setSettings(next);
    dirtyRef.current = true;
  }, []);

  const resolveParams = useCallback(
    (view: View, config: Settings): RenderParams => {
      const maxIter = config.autoIter
        ? autoIterations(view.spanY)
        : config.maxIter;

      let kernel: KernelMode;
      if (config.precision === "auto") {
        // Perturbation everywhere deep: it has no precision ceiling, and the
        // reference orbit is reused across small pans so it stays interactive.
        kernel = view.spanY < DEEP_SPAN_THRESHOLD ? "perturb" : "single";
      } else {
        kernel = config.precision;
      }

      const [cx, cy] = centerAsNumbers(view);
      const params: RenderParams = {
        centerX: cx,
        centerY: cy,
        spanY: view.spanY,
        maxIter,
        palette: paletteIndex(config.palette),
        colorCycle: config.colorCycle,
        colorOffset: config.colorOffset,
        aa: 1,
        kernel,
        interior: INTERIOR_COLOR,
      };

      if (kernel === "perturb") {
        let orbit = orbitRef.current;
        if (!orbitIsUsable(orbit, view.centerX, view.centerY, view.spanY, maxIter)) {
          orbit = computeReferenceOrbit(
            view.centerX,
            view.centerY,
            maxIter,
            view.spanY,
          );
          orbitRef.current = orbit;
        }
        params.orbit = orbit;
        // Where this view sits relative to the (possibly older) orbit center.
        params.deltaC = [
          toNumber(view.centerX - orbit.centerX),
          toNumber(view.centerY - orbit.centerY),
        ];
      }

      return params;
    },
    [],
  );

  // --- render loop --------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: MandelbrotRenderer | null = null;
    let raf = 0;
    let lastReadout = 0;
    let lastFrameAt = 0;
    let started = false;
    let failed = false;

    /**
     * Runs on the first frame rather than in the effect body: the canvas has
     * been laid out by then, and it keeps GL setup and hash restoration out of
     * React's render phase.
     */
    const start = () => {
      started = true;

      const shared = decodeHash(window.location.hash);
      if (shared) applyShared(shared);

      try {
        renderer = new MandelbrotRenderer(canvas);
        rendererRef.current = renderer;
        setMaxRenderSize(renderer.maxRenderSize);
      } catch (err) {
        failed = true;
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    const renderFrame = (now: number) => {
      raf = requestAnimationFrame(renderFrame);
      if (!started) start();
      if (failed || !renderer) return;
      // A big export owns the GPU for minutes; do not compete with it, and do
      // not advance the gradient while nothing is being painted — dt is clamped
      // below, so the animation resumes rather than jumping when it finishes.
      if (exportingRef.current) return;

      const config = settingsRef.current;
      // Clamped: a backgrounded tab hands back a huge delta on return, which
      // would jump the gradient rather than resume it.
      const dt = lastFrameAt > 0 ? Math.min((now - lastFrameAt) / 1000, 0.1) : 0;
      lastFrameAt = now;

      if (config.animate) {
        const direction = config.animateReverse ? -1 : 1;
        animPhaseRef.current = wrapColorOffset(
          animPhaseRef.current + direction * config.animateSpeed * dt,
        );
        dirtyRef.current = true;
      }

      if (!dirtyRef.current) return;
      dirtyRef.current = false;

      const view = viewRef.current;
      const live = interactingRef.current;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const scale = live ? config.liveScale : 1;
      const width = Math.max(1, Math.round(rect.width * dpr * scale));
      const height = Math.max(1, Math.round(rect.height * dpr * scale));

      const params = resolveParams(view, config);
      params.aa = live ? 1 : config.quality;
      params.colorOffset = wrapColorOffset(
        config.colorOffset + animPhaseRef.current,
      );

      try {
        // While the view is moving the geometry changes every frame, so the
        // count cache would be rebuilt every frame and buy nothing. It only
        // pays off once the view is still and just the colour is moving.
        const cycling = config.animate && !live;
        const cached =
          cycling &&
          (renderer.recolor(width, height, params) ||
            renderer.renderCached(width, height, params));
        if (!cached) renderer.render(width, height, params);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        cancelAnimationFrame(raf);
        return;
      }

      const times = frameTimesRef.current;
      // A long gap means the view was idle, not slow — start a fresh window.
      if (times.length > 0 && now - times[times.length - 1] > 500) {
        times.length = 0;
      }
      times.push(now);
      if (times.length > 20) times.shift();

      if (now - lastReadout > 120) {
        lastReadout = now;
        const span = times.length > 1 ? now - times[0] : 0;
        setReadout({
          view,
          maxIter: params.maxIter,
          kernel: params.kernel,
          orbitLength: params.orbit?.length ?? 0,
          fps: span > 0 ? ((times.length - 1) / span) * 1000 : 0,
          atPrecisionFloor: view.spanY <= MIN_SPAN * 1.001,
        });
      }
    };

    raf = requestAnimationFrame(renderFrame);

    const observer = new ResizeObserver(() => {
      dirtyRef.current = true;
    });
    observer.observe(canvas);

    const onContextLost = (event: Event) => {
      event.preventDefault();
      failed = true;
      renderer?.invalidate();
      setError("The GPU context was lost. Reload the page to continue.");
    };
    canvas.addEventListener("webglcontextlost", onContextLost);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, [applyShared, resolveParams]);

  // Mirror settings into the ref the render loop reads, and repaint.
  useEffect(() => {
    settingsRef.current = settings;
    dirtyRef.current = true;
  }, [settings]);

  useEffect(() => {
    infoOpenRef.current = welcome.open;
  }, [welcome.open]);

  // The count buffer is the largest allocation the renderer makes; do not sit
  // on it once nothing is cycling.
  useEffect(() => {
    if (!settings.animate) rendererRef.current?.disposeCountCache();
  }, [settings.animate]);

  // --- URL hash -----------------------------------------------------------

  // Keep the address bar in sync once the view settles, so a reload or a
  // copied link lands in the same place.
  useEffect(() => {
    const id = window.setInterval(() => {
      // Rewriting the hash 2.5x a second with a moving offset is churn, and
      // the offset is folded back into settings when cycling stops anyway.
      if (interactingRef.current || settingsRef.current.animate) return;
      const hash = encodeHash({
        ...viewRef.current,
        palette: settingsRef.current.palette,
        maxIter: settingsRef.current.autoIter
          ? undefined
          : settingsRef.current.maxIter,
        colorCycle: settingsRef.current.colorCycle,
        colorOffset: settingsRef.current.colorOffset,
      });
      if (window.location.hash.slice(1) !== hash) {
        window.history.replaceState(null, "", `#${hash}`);
      }
    }, 400);

    // replaceState above does not fire hashchange, so this only reacts to the
    // user pasting a link or using the back button.
    const onHashChange = () => {
      const shared = decodeHash(window.location.hash);
      if (shared) applyShared(shared);
    };
    window.addEventListener("hashchange", onHashChange);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, [applyShared]);

  // --- pointer, wheel and keyboard input ----------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; midX: number; midY: number } | null = null;

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      return { width: rect.width, height: rect.height, rect };
    };

    const onPointerDown = (event: PointerEvent) => {
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pinch = null;
      beginInteraction();
    };

    const onPointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      const next = { x: event.clientX, y: event.clientY };
      pointers.set(event.pointerId, next);

      const { width, height } = size();

      if (pointers.size === 1) {
        viewRef.current = panByPixels(
          viewRef.current,
          next.x - previous.x,
          next.y - previous.y,
          width,
          height,
        );
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        if (pinch && dist > 0) {
          const rect = canvas.getBoundingClientRect();
          viewRef.current = panByPixels(
            viewRef.current,
            midX - pinch.midX,
            midY - pinch.midY,
            width,
            height,
          );
          viewRef.current = zoomAt(
            viewRef.current,
            pinch.dist / dist,
            midX - rect.left,
            midY - rect.top,
            width,
            height,
          );
        }
        pinch = { dist, midX, midY };
      }

      beginInteraction();
    };

    const endPointer = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      beginInteraction();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const { width, height, rect } = size();
      // deltaMode 1 reports lines rather than pixels.
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      const factor = Math.min(2, Math.max(0.5, Math.exp(delta * 0.0015)));
      viewRef.current = zoomAt(
        viewRef.current,
        factor,
        event.clientX - rect.left,
        event.clientY - rect.top,
        width,
        height,
      );
      beginInteraction();
    };

    const onDoubleClick = (event: MouseEvent) => {
      const { width, height, rect } = size();
      viewRef.current = zoomAt(
        viewRef.current,
        event.shiftKey ? 2 : 0.5,
        event.clientX - rect.left,
        event.clientY - rect.top,
        width,
        height,
      );
      beginInteraction();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // The welcome dialog owns the keyboard while it is open.
      if (infoOpenRef.current) return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.tagName === "TEXTAREA")
      ) {
        return;
      }

      if (event.key === " ") {
        // A focused button already treats Space as activation; toggling here
        // too would fire twice.
        if (target?.tagName !== "BUTTON") {
          event.preventDefault();
          toggleAnimate();
        }
        return;
      }

      const { width, height } = size();
      const step = 0.15;
      let handled = true;

      switch (event.key) {
        case "ArrowLeft":
          viewRef.current = panByPixels(viewRef.current, width * step, 0, width, height);
          break;
        case "ArrowRight":
          viewRef.current = panByPixels(viewRef.current, -width * step, 0, width, height);
          break;
        case "ArrowUp":
          viewRef.current = panByPixels(viewRef.current, 0, height * step, width, height);
          break;
        case "ArrowDown":
          viewRef.current = panByPixels(viewRef.current, 0, -height * step, width, height);
          break;
        case "+":
        case "=":
          viewRef.current = zoomAt(viewRef.current, 0.66, width / 2, height / 2, width, height);
          break;
        case "-":
        case "_":
          viewRef.current = zoomAt(viewRef.current, 1.5, width / 2, height / 2, width, height);
          break;
        case "0":
          viewRef.current = HOME_VIEW;
          break;
        default:
          handled = false;
      }

      if (handled) {
        event.preventDefault();
        beginInteraction();
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endPointer);
      canvas.removeEventListener("pointercancel", endPointer);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [beginInteraction, toggleAnimate]);

  // --- actions ------------------------------------------------------------

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      viewRef.current = clampView(preset.view);
      if (preset.palette) {
        const next = { ...settingsRef.current, palette: preset.palette };
        settingsRef.current = next;
        setSettings(next);
      }
      dirtyRef.current = true;
    },
    [],
  );

  const reset = useCallback(() => {
    viewRef.current = HOME_VIEW;
    dirtyRef.current = true;
  }, []);

  const copyLink = useCallback(async () => {
    const hash = encodeHash({
      ...viewRef.current,
      palette: settingsRef.current.palette,
      maxIter: settingsRef.current.autoIter
        ? undefined
        : settingsRef.current.maxIter,
      colorCycle: settingsRef.current.colorCycle,
      colorOffset: liveColorOffset(),
    });
    const url = `${window.location.origin}${window.location.pathname}#${hash}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not write to the clipboard.");
    }
  }, [liveColorOffset]);

  const exportAa = Math.max(EXPORT_MIN_AA, settings.quality);
  const exportOptions = useMemo(
    () =>
      EXPORT_SIZES.map((size) => {
        // Nothing is ruled out until the GL context has reported its limits.
        const blocked =
          maxRenderSize === null ? null : exportBlocker(size, maxRenderSize);
        return {
          id: size.id,
          label: `${size.label} (${size.width}x${size.height})`,
          disabled: blocked !== null,
          note:
            blocked ??
            (maxRenderSize === null
              ? null
              : describeExport(size, maxRenderSize, exportAa)),
        };
      }),
    [exportAa, maxRenderSize],
  );

  const savePng = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || exporting) return;

    const target = EXPORT_SIZES.find((s) => s.id === exportSize);
    if (!target) return;

    exportingRef.current = true;
    setExporting(true);
    setExportProgress({ fraction: 0, note: "Starting" });
    setError(null);
    // Let the button repaint before the GPU stalls on a big render.
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    try {
      const params = resolveParams(viewRef.current, settingsRef.current);
      params.aa = Math.max(EXPORT_MIN_AA, settingsRef.current.quality);
      // Freeze the gradient where the animation currently has it, so the file
      // matches what is on screen.
      params.colorOffset = liveColorOffset();
      // One reference orbit for the whole frame, so tiles stay consistent and
      // it is uploaded to the GPU once rather than once per tile.
      await exportPng({
        renderer,
        params,
        size: target,
        filename: `mandelbrot-${target.id}-${settingsRef.current.palette}.png`,
        onProgress: setExportProgress,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      exportingRef.current = false;
      setExporting(false);
      setExportProgress(null);
      dirtyRef.current = true;
    }
  }, [exportSize, exporting, liveColorOffset, resolveParams]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        aria-label="Interactive Mandelbrot set fractal. Drag to pan, scroll or pinch to zoom, arrow keys to move."
      />

      {error && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 z-30 bg-red-950/90 px-4 py-2 text-center text-sm text-red-100 backdrop-blur"
        >
          {error}
        </div>
      )}

      <ControlPanel
        settings={settings}
        onChange={setSettings}
        onPreset={applyPreset}
        onReset={reset}
        onCopyLink={copyLink}
        copied={copied}
        onSavePng={savePng}
        exporting={exporting}
        exportProgress={exportProgress}
        exportOptions={exportOptions}
        exportSize={exportSize}
        onExportSizeChange={setExportSize}
        onInvalidate={invalidate}
        onShowInfo={welcome.show}
        onToggleAnimate={toggleAnimate}
      />

      <StatusBar readout={readout} />

      <WelcomeDialog open={welcome.open} onClose={welcome.close} />
    </div>
  );
}
