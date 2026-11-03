"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { LoadingRows } from "@/components/ui/page-states";
import { itemHref, type NeedsYouKind } from "@/lib/needsYou/kinds";
import type { ItemDetail } from "@/lib/needsYou/store";

import { ItemDecide, type InlineNav } from "./item-decide";

type Loaded = { state: "loading" } | { state: "ready"; detail: ItemDetail; readOnly: boolean } | { state: "gone"; message: string };

/**
 * Book of business, round 4 (owner 2026-11-02: "how can we help the agent to not go into another page and then
 * another page"): a Needs you item decided where it is listed — under its row on a file's page or the Needs you
 * list. It reads the item's Decide part (GET /api/app/needs-you/item, the item page's own read) and renders the
 * same form, flat; saving goes to the kind's own API and hands back to the list (`inline.onDone`), which opens the
 * next waiting row. The item page stays one link away, for the row as sent and a link to share.
 */
export function DecideInPlace({ kind, id, inline, onClose }: { kind: NeedsYouKind; id: string; inline: InlineNav; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const box = useRef<HTMLDivElement>(null);
  // The row that opens (Skip, or saving and the next) comes into view.
  useEffect(() => { box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, []);

  useEffect(() => {
    let live = true;
    fetch(`/api/app/needs-you/item?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { detail?: ItemDetail; readOnly?: boolean; error?: string };
        if (!live) return;
        if (response.ok && data.detail) setLoaded({ state: "ready", detail: data.detail, readOnly: Boolean(data.readOnly) });
        else setLoaded({ state: "gone", message: data.error ?? "This item couldn't be opened." });
      })
      .catch(() => live && setLoaded({ state: "gone", message: "This item couldn't be opened. Try again." }));
    return () => { live = false; };
  }, [kind, id]);

  const page = itemHref(kind, id);
  return (
    <div ref={box} className="flex min-w-0 scroll-mt-24 flex-col gap-4 p-4 motion-safe:animate-[m-stage-name_.2s_ease-out_both]">
      {loaded.state === "loading" ? <LoadingRows rows={3} columns={4} />
        : loaded.state === "gone" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{loaded.message}</span>
            <span className="flex gap-2">
              {inline.hasNext && inline.onSkip && <Button type="button" size="sm" variant="outline" onClick={inline.onSkip}>Next</Button>}
              <Button type="button" size="sm" variant="outline" onClick={onClose}>Close</Button>
            </span>
          </div>
        )
        : <ItemDecide detail={loaded.detail} nextHref={null} listHref={page} readOnly={loaded.readOnly} inline={inline} />}
      {loaded.state !== "gone" && (
        <Link href={page} className="self-start text-xs font-medium text-[var(--accent-ink)] hover:underline">Open its page · the row as sent</Link>
      )}
    </div>
  );
}
