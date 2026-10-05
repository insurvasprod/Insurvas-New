"use client";

import { useEffect, useState } from "react";

/** The current time, refreshed every minute — for ages and countdowns that sit on screen through a call. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
