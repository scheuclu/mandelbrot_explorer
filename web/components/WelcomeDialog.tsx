"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Bump the version suffix to show the dialog again to everyone after a
 * meaningful content change.
 */
export const WELCOME_SEEN_KEY = "mandelbrot:welcome-seen:v1";

// --- "already dismissed" store ---------------------------------------------
//
// localStorage is read through useSyncExternalStore rather than an effect so
// there is exactly one source of truth and no setState-in-effect: the server
// snapshot says "seen", which renders nothing, and the client swaps in the real
// answer right after hydration. Returning visitors therefore never see a flash,
// and the markup never disagrees between server and client.

const listeners = new Set<() => void>();
/** Cached because useSyncExternalStore must see a stable value between notifications. */
let seenCache: boolean | null = null;

function readSeen(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_SEEN_KEY) === "1";
  } catch {
    // Storage can be unavailable (private mode, blocked cookies, sandboxed
    // iframe). Treat that as "seen": a dismissal could not be remembered
    // either, so showing the dialog would mean showing it on every load. The
    // "?" button still opens it on demand.
    return true;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  if (seenCache === null) seenCache = readSeen();
  return seenCache;
}

/** No storage exists during the server render; "seen" renders no dialog. */
function getServerSnapshot(): boolean {
  return true;
}

function markWelcomeSeen(): void {
  seenCache = true;
  try {
    window.localStorage.setItem(WELCOME_SEEN_KEY, "1");
  } catch {
    // Non-fatal — the dialog still stays closed for this session.
  }
  for (const listener of listeners) listener();
}

/**
 * Open state for the welcome dialog: automatic on a visitor's first load, and
 * on demand from the "?" button afterwards. Every close marks it as seen.
 */
export function useWelcomeDialog(): {
  open: boolean;
  show: () => void;
  close: () => void;
} {
  const seen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [reopened, setReopened] = useState(false);

  const show = useCallback(() => setReopened(true), []);
  const close = useCallback(() => {
    markWelcomeSeen();
    setReopened(false);
  }, []);

  return { open: !seen || reopened, show, close };
}

const FOCUSABLE =
  'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface WelcomeDialogProps {
  open: boolean;
  /** Called for every dismissal path: the button, Escape, X, and the backdrop. */
  onClose: () => void;
}

export function WelcomeDialog({ open, onClose }: WelcomeDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const restoreTo = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and pull focus back in if it left the panel — a
      // backdrop click parks it on <body>.
      const outside = !active || !panel.contains(active);

      if (event.shiftKey && (outside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center p-4">
      <div
        aria-hidden="true"
        onMouseDown={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-xl border border-white/10 bg-black/85 p-6 shadow-2xl backdrop-blur-xs"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-white/5 text-sm text-white/60 transition hover:border-white/25 hover:bg-white/10 hover:text-white/90"
        >
          ×
        </button>

        <h2 id={titleId} className="pr-8 text-lg font-semibold text-white/90">
          Mandelbrot Explorer
        </h2>

        <p
          id={descriptionId}
          className="mt-2 text-sm leading-relaxed text-white/70"
        >
          Real-time fractal deep zoom, computed on your GPU. Nothing is sent to
          a server.
        </p>

        <ul className="mt-5 list-disc space-y-2 pl-4 text-sm leading-relaxed text-white/70 marker:text-white/25">
          <li>
            <span className="text-white/90">Drag</span> to pan,{" "}
            <span className="text-white/90">scroll</span> to zoom,{" "}
            <span className="text-white/90">double-click</span> to dive in.
          </li>
          <li>
            <span className="text-white/90">Palettes and presets</span> —
            recolour, or jump to a known spot.
          </li>
          <li>
            <span className="text-white/90">Copy link</span> — the URL carries
            the exact view.
          </li>
          <li>
            <span className="text-white/90">No zoom limit</span> — precision
            escalates automatically as you descend.
          </li>
        </ul>

        <p className="mt-5 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-sm leading-relaxed text-white/75">
          <span className="font-medium text-amber-300/90">
            Save PNG for the best image.
          </span>{" "}
          The canvas renders cheap while you move; the download is full
          resolution with anti-aliasing, up to 8K.
        </p>

        <div className="mt-6 flex items-center justify-between gap-4 border-t border-white/10 pt-4">
          <p className="text-[11px] leading-relaxed text-white/40">
            Reopen this any time with the{" "}
            <span className="text-white/60">?</span> button.
          </p>
          <button
            ref={confirmRef}
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md bg-amber-400 px-4 py-2 text-xs font-semibold text-black transition hover:bg-amber-300 motion-safe:animate-bouncy"
          >
            Let&rsquo;s go
          </button>
        </div>
      </div>
    </div>
  );
}
