"use client";

import { useCallback, useEffect, useRef, type DragEvent } from "react";
import { reducedMotion } from "@/components/ui/motion-tokens";

/**
 * The lifted card (Wave C, plan item 12): picking a card up lifts it off the page (a shadow, 1.02 and a 1.5° tilt,
 * `.m-lift` in globals.css "5j · Drag") and it follows the pointer, instead of the browser's grey ghost.
 *
 * - `useDragLift()` is for a native HTML5 drag: call `lift(event)` from onDragStart. It swaps the browser's drag image
 *   for a transparent pixel and draws a copy of the card that follows the pointer, until the drag ends. `rect()` is
 *   where that copy is (hand it to useFlip's `place` on drop, so the card glides home from where it was let go).
 * - `holdUp` / `holdAt` / `letGo` lift an element held by pointer events (a cadence dot) in place.
 * - Reduced motion: the card still follows the pointer (that is the drag), but it does not tilt or grow.
 */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
let blank: HTMLImageElement | null = null;
function blankImage(): HTMLImageElement | null {
  if (!blank && typeof Image !== "undefined") { blank = new Image(1, 1); blank.src = BLANK; }
  return blank;
}

export function useDragLift(): { lift: (event: DragEvent<Element>, source?: HTMLElement) => void; rect: () => DOMRect | null } {
  const copy = useRef<{ node: HTMLElement; box: DOMRect; dx: number; dy: number; done: () => void } | null>(null);
  // The transparent pixel must be decoded before the first drag starts.
  useEffect(() => { blankImage(); return () => copy.current?.done(); }, []);

  const lift = useCallback((event: DragEvent<Element>, source: HTMLElement = event.currentTarget as HTMLElement) => {
    copy.current?.done();
    const image = blankImage();
    if (image) event.dataTransfer.setDragImage(image, 0, 0);
    const box = source.getBoundingClientRect();
    const node = source.cloneNode(true) as HTMLElement;
    for (const part of [node, ...node.querySelectorAll<HTMLElement>("*")]) {
      for (const name of ["id", "data-flip-key", "draggable", "data-dragging", "tabindex"]) part.removeAttribute(name);
    }
    node.classList.remove("m-drop-in", "m-drop-gap");
    node.classList.add("m-lift");
    if (reducedMotion()) node.setAttribute("data-still", "");
    node.setAttribute("aria-hidden", "true");
    node.inert = true;
    Object.assign(node.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    document.body.appendChild(node);
    const start = { x: event.clientX, y: event.clientY };
    const state = { node, box, dx: 0, dy: 0, done: () => {} };
    const follow = (moved: globalThis.DragEvent) => {
      if (!moved.clientX && !moved.clientY) return;
      state.dx = moved.clientX - start.x;
      state.dy = moved.clientY - start.y;
      node.style.translate = `${state.dx}px ${state.dy}px`;
    };
    const done = () => {
      document.removeEventListener("dragover", follow, true);
      document.removeEventListener("drop", done);
      document.removeEventListener("dragend", done, true);
      document.removeEventListener("pointerdown", done, true);
      source.removeEventListener("dragend", done);
      node.remove();
      if (copy.current === state) copy.current = null;
    };
    state.done = done;
    document.addEventListener("dragover", follow, true);
    // The page's own drop handler runs first (React listens below the document), so rect() still answers there.
    document.addEventListener("drop", done);
    document.addEventListener("dragend", done, true);
    document.addEventListener("pointerdown", done, true);
    source.addEventListener("dragend", done);
    copy.current = state;
  }, []);

  const rect = useCallback(() => {
    const state = copy.current;
    return state ? new DOMRect(state.box.left + state.dx, state.box.top + state.dy, state.box.width, state.box.height) : null;
  }, []);

  return { lift, rect };
}

/** Lift an element held by pointer events where it stands (it tilts unless motion is reduced). */
export function holdUp(element: HTMLElement): void {
  element.classList.add("m-lifted");
  if (reducedMotion()) element.setAttribute("data-still", "");
}

/** Move a held element with the pointer, by how far the pointer has gone. */
export function holdAt(element: HTMLElement, dx: number, dy: number): void {
  element.style.translate = `${dx}px ${dy}px`;
}

/** Put a held element down; returns where it was let go, for useFlip's `place`. */
export function letGo(element: HTMLElement): DOMRect {
  element.classList.remove("m-lifted");
  element.removeAttribute("data-still");
  const at = element.getBoundingClientRect();
  element.style.translate = "";
  return at;
}
