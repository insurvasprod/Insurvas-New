"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { PlatformAction } from "@/lib/adminPlatform/titleActions";

/**
 * A button on the Platform frame's title line that opens something the page's client body holds (admin round 1,
 * 2026-11-18). The frame is drawn by the server page and the body is a client island below it, so the button raises a
 * window event (lib/adminPlatform/titleActions.ts) and the body answers it with `useTitleAction`. No round trip.
 */
export function TitleActionButton({ action, variant, title, children }: {
  action: PlatformAction;
  variant?: "default" | "outline";
  title?: string;
  children: ReactNode;
}) {
  return (
    <Button type="button" variant={variant} title={title} onClick={() => window.dispatchEvent(new Event(action))}>
      {children}
    </Button>
  );
}

/** The body's half: runs `handler` whenever the title-line button for `action` is pressed. */
export function useTitleAction(action: PlatformAction, handler: () => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    const on = () => latest.current();
    window.addEventListener(action, on);
    return () => window.removeEventListener(action, on);
  }, [action]);
}
