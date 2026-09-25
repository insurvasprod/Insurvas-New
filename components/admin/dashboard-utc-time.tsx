"use client";

import { useEffect, useRef } from "react";

/**
 * A UTC timestamp printed by the server, with the reader's own local time on hover.
 *
 * The text is the server's UTC string, so the first client render matches it exactly. The hover
 * title is the only thing that depends on the browser's zone, and it is attached after mount, so
 * it cannot cause a hydration mismatch either.
 */
export function DashboardUtcTime({ iso, text, className }: { iso: string; text: string; className?: string }) {
  const ref = useRef<HTMLTimeElement>(null);

  useEffect(() => {
    const date = new Date(iso);
    if (ref.current && !Number.isNaN(date.getTime())) {
      ref.current.title = `${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" })} your time`;
    }
  }, [iso]);

  return (
    <time ref={ref} dateTime={iso} className={className}>
      {text}
    </time>
  );
}
