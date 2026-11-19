"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const MIN = 1;
const MAX = 5;

/**
 * A Docs screenshot at full size inside the app (owner 2026-11-17: "not as a new tab… a button to close it, or click
 * outside the image… zoom in and out with the mouse wheel"). The wheel zooms towards the pointer; once zoomed, drag
 * to move around. Esc, ✕ or a click outside the picture closes it.
 */
export function ShotLightbox({ src, alt, width, height, onClose }: { src: string; alt: string; width: number; height: number; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [onClose]);

  // The wheel needs a non-passive listener to keep the page from scrolling under the picture.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      // Zoom towards the pointer: the point under it stays under it.
      const px = event.clientX - (box.left + box.width / 2);
      const py = event.clientY - (box.top + box.height / 2);
      setZoom((current) => {
        const next = Math.min(MAX, Math.max(MIN, current * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
        setPan((p) => (next === MIN ? { x: 0, y: 0 } : { x: px - ((px - p.x) * next) / current, y: py - ((py - p.y) * next) / current }));
        return next;
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const step = (factor: number) => setZoom((current) => {
    const next = Math.min(MAX, Math.max(MIN, current * factor));
    setPan((p) => (next === MIN ? { x: 0, y: 0 } : { x: (p.x * next) / current, y: (p.y * next) / current }));
    return next;
  });

  const down = (event: ReactPointerEvent) => {
    if (zoom === MIN) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false };
    setDragging(true);
  };
  const move = (event: ReactPointerEvent) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) start.moved = true;
    setPan({ x: start.panX + dx, y: start.panY + dy });
  };
  const up = () => { drag.current = null; setDragging(false); };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Full size: ${alt}`}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[color-mix(in_srgb,var(--background)_94%,transparent)] p-6 motion-safe:animate-in motion-safe:fade-in-0"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="absolute top-4 right-4 z-[1] flex items-center gap-1.5">
        <span className="mr-1 text-xs text-[var(--muted)] tabular-nums">{Math.round(zoom * 100)}% · scroll to zoom{zoom > MIN ? ", drag to move" : ""}</span>
        <Button type="button" variant="outline" size="sm" aria-label="Zoom out" disabled={zoom === MIN} onClick={() => step(1 / 1.25)}><Minus aria-hidden="true" /></Button>
        <Button type="button" variant="outline" size="sm" aria-label="Zoom in" disabled={zoom === MAX} onClick={() => step(1.25)}><Plus aria-hidden="true" /></Button>
        {zoom > MIN ? <Button type="button" variant="outline" size="sm" onClick={() => { setZoom(MIN); setPan({ x: 0, y: 0 }); }}>Fit</Button> : null}
        <Button type="button" size="sm" onClick={onClose} autoFocus><X aria-hidden="true" />Close</Button>
      </div>
      <div
        ref={frame}
        className="relative overflow-hidden rounded-[12px] border border-[var(--border)] shadow-2xl"
        style={{ width: `min(calc(100vw - 48px), calc((100vh - 96px) * ${width / height}))`, aspectRatio: `${width} / ${height}`, cursor: zoom > MIN ? (dragging ? "grabbing" : "grab") : "zoom-in" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={() => (zoom > MIN ? (setZoom(MIN), setPan({ x: 0, y: 0 })) : step(2))}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          width={width}
          height={height}
          draggable={false}
          className="block h-full w-full select-none"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: dragging ? "none" : "transform 120ms ease-out" }}
        />
      </div>
    </div>,
    document.body,
  );
}
