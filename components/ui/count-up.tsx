"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A figure that counts to its value (dashboard glass layer, 2026-10-13).
 *
 * Only the number inside the text moves: "$4,210", "27.5%", "1.2k", "3 of 5" keep their prefix,
 * suffix, separators and decimals, and the count lands on exactly the string the server rendered.
 *
 * It never counts on a hard page load. The server's HTML is already on screen by the time this
 * hydrates, and resetting a painted figure to 0 to count it back up would be a flash, not an
 * animation. So it counts on a client-side navigation (where this mounts fresh), and whenever the
 * value changes under a live poll — from the old number to the new one. Reduced motion: never.
 */

let hydrated = false;
const DURATION = 700;
// The first number in the text, with its grouping commas and decimals.
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/;

function parse(text: string) {
  const match = NUMBER.exec(text);
  if (!match) return null;
  const raw = match[0];
  const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
  return {
    before: text.slice(0, match.index),
    after: text.slice(match.index + raw.length),
    value: Number(raw.replace(/,/g, "")),
    decimals,
    grouped: raw.includes(","),
  };
}

function format(n: number, decimals: number, grouped: boolean) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
}

export function CountUp({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const target = parse(text);
    const from = previous.current === null ? (hydrated ? 0 : null) : parse(previous.current)?.value ?? null;
    previous.current = text;
    hydrated = true;

    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!target || from === null || from === target.value || reduced) {
      setShown(text);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        setShown(text);
        return;
      }
      setShown(`${target.before}${format(from + (target.value - from) * eased, target.decimals, target.grouped)}${target.after}`);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);

  // The final text is what a screen reader hears; the counting frames are visual only.
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}
