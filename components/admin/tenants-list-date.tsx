"use client";

import { useEffect, useRef } from "react";

import { recordDate, recordDateTime } from "@/lib/tenants/recordFormat";

/**
 * A day in the tenants list: the board's "12 Mar 2026", read in UTC so the server and the browser
 * print the same day. Hover gives the full UTC time and the reader's own local time; the local part
 * is attached after mount, so it can never cause a hydration mismatch.
 */
export function TenantsListDate({ iso }: { iso: string | null }) {
  const ref = useRef<HTMLTimeElement>(null);

  useEffect(() => {
    if (!iso || !ref.current) return;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return;
    ref.current.title = `${recordDateTime(iso)} · ${date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} your time`;
  }, [iso]);

  if (!iso) return <span aria-label="None">—</span>;

  return (
    <time ref={ref} dateTime={iso} title={recordDateTime(iso)} className="tabular-nums">
      {recordDate(iso)}
    </time>
  );
}
