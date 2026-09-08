"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AVATAR, type Item } from "@harbor/shared";
import { ItemAvatar } from "@/components/ItemAvatar";

/** The square you frame the photo in. The exported image is AVATAR.size, scaled from exactly this. */
const VIEWPORT = 320;
const MAX_ZOOM = 4;

/**
 * A photo for a person or a thing, cropped here in the browser.
 *
 * Cropping client-side is not only a nicety: what the vault receives is the square you framed, so
 * a full-length photograph of a child never reaches the disk at all. It also keeps the API free of
 * image libraries, which spec §3.6 rules out on purpose — the parsers are the attack surface.
 */
export function AvatarPicker({ item }: { item: Item }) {
  const router = useRouter();
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function choose(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That is not an image.");
      return;
    }
    setSource(URL.createObjectURL(file));
  }

  async function upload(blob: Blob) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", blob, "avatar.jpg");
      const res = await fetch(`/api/items/${item.id}/avatar`, { method: "POST", body, credentials: "same-origin" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { message?: string }).message ?? `Upload failed (${res.status})`);
      close();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/items/${item.id}/avatar`, { method: "DELETE", credentials: "same-origin" });
      if (!res.ok) throw new Error(`Could not remove the photo (${res.status})`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (source) URL.revokeObjectURL(source);
    setSource(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        className="group relative rounded-pill"
        aria-label={item.avatarUpdatedAt ? `Change the photo of ${item.label}` : `Add a photo of ${item.label}`}
      >
        <ItemAvatar item={item} size={88} textSize="text-[32px]" />
        <span className="absolute inset-0 flex items-end justify-center rounded-pill bg-text/55 pb-2 text-label font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
          {item.avatarUpdatedAt ? "Change" : "Add photo"}
        </span>
      </button>

      {item.avatarUpdatedAt && (
        <button type="button" onClick={remove} disabled={busy} className="text-small font-medium text-muted hover:text-danger disabled:opacity-60">
          Remove
        </button>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={AVATAR.mimeTypes.join(",")}
        onChange={(e) => choose(e.target.files?.[0])}
        className="hidden"
      />

      {error && !source && <p className="max-w-[160px] text-center text-small text-danger">{error}</p>}

      {source && <CropDialog source={source} busy={busy} error={error} onCancel={close} onUse={upload} />}
    </div>
  );
}

/**
 * Drag to move, the slider to zoom, and the circle is what you get. The preview is the crop —
 * the export replays exactly this transform at AVATAR.size, so there is no discrepancy between
 * what was framed and what is stored.
 */
function CropDialog({
  source,
  busy,
  error,
  onCancel,
  onUse,
}: {
  source: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onUse: (blob: Blob) => void;
}) {
  const img = useRef<HTMLImageElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // At zoom 1 the shorter edge exactly fills the square, so there is never a gap to crop into.
  const base = natural ? VIEWPORT / Math.min(natural.w, natural.h) : 1;
  const scale = base * zoom;
  const drawn = natural ? { w: natural.w * scale, h: natural.h * scale } : { w: VIEWPORT, h: VIEWPORT };

  const clamp = useCallback(
    (x: number, y: number, size: { w: number; h: number }) => ({
      x: Math.min(0, Math.max(VIEWPORT - size.w, x)),
      y: Math.min(0, Math.max(VIEWPORT - size.h, y)),
    }),
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function loaded(e: React.SyntheticEvent<HTMLImageElement>) {
    const el = e.currentTarget;
    const w = el.naturalWidth;
    const h = el.naturalHeight;
    const s = VIEWPORT / Math.min(w, h);
    setNatural({ w, h });
    setZoom(1);
    setOffset({ x: (VIEWPORT - w * s) / 2, y: (VIEWPORT - h * s) / 2 });
  }

  /** Zooming holds the middle of the circle still, which is where the face is. */
  function rezoom(next: number) {
    const previous = base * zoom;
    const factor = (base * next) / previous;
    if (!natural) return;
    const size = { w: natural.w * base * next, h: natural.h * base * next };
    const centred = {
      x: VIEWPORT / 2 - (VIEWPORT / 2 - offset.x) * factor,
      y: VIEWPORT / 2 - (VIEWPORT / 2 - offset.y) * factor,
    };
    setZoom(next);
    setOffset(clamp(centred.x, centred.y, size));
  }

  function down(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    setOffset(clamp(d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y), drawn));
  }

  function use() {
    const el = img.current;
    if (!el || !natural) return;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR.size;
    canvas.height = AVATAR.size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // JPEG has no alpha, and a transparent PNG would otherwise come out black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, AVATAR.size, AVATAR.size);
    const f = AVATAR.size / VIEWPORT;
    ctx.drawImage(el, offset.x * f, offset.y * f, drawn.w * f, drawn.h * f);
    canvas.toBlob((blob) => blob && onUse(blob), "image/jpeg", 0.9);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-text/40 p-6" role="dialog" aria-modal="true" aria-label="Crop the photo">
      <div className="flex w-[400px] flex-col gap-4 rounded-lg bg-ground p-6 shadow-xl">
        <div>
          <h2 className="text-section font-semibold tracking-snug">Crop the photo</h2>
          <p className="mt-0.5 text-small text-muted">Drag to move, and zoom until the circle holds what you want. Only the circle is kept.</p>
        </div>

        <div
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          style={{ width: VIEWPORT, height: VIEWPORT }}
          className="relative touch-none self-center overflow-hidden rounded-pill bg-surface"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, never fetched. */}
          <img
            ref={img}
            src={source}
            alt=""
            onLoad={loaded}
            draggable={false}
            style={{ position: "absolute", left: offset.x, top: offset.y, width: drawn.w, height: drawn.h, maxWidth: "none" }}
            className="cursor-grab select-none active:cursor-grabbing"
          />
        </div>

        <label className="flex items-center gap-3">
          <span className="label">Zoom</span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => rezoom(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
        </label>

        {error && <p className="text-small text-danger">{error}</p>}

        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className="h-9 px-2 text-row font-medium text-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={use}
            disabled={busy || !natural}
            className="h-9 rounded-md bg-accent px-4 text-row font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Saving…" : "Use photo"}
          </button>
        </div>
      </div>
    </div>
  );
}
