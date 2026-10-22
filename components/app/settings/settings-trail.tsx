"use client";

import Link from "next/link";
import { useEffect } from "react";

import { revealAnchor } from "@/lib/settings/revealAnchor";

/**
 * The frame a settings screen owned by another module wears (LA-8.1): a trail back to Settings, and
 * the setting search named brought into view. Nothing else — no second header, no copy of the
 * controls; the screen stays its module's own.
 */
export function SettingsTrail({ label }: { label: string }) {
  useEffect(() => {
    let cancel: (() => void) | undefined;
    const reveal = () => {
      cancel?.();
      const anchor = window.location.hash.slice(1);
      cancel = anchor ? revealAnchor(decodeURIComponent(anchor)) : undefined;
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => {
      cancel?.();
      window.removeEventListener("hashchange", reveal);
    };
  }, []);

  return (
    <nav aria-label="Breadcrumb" className="text-sm font-semibold text-muted-foreground">
      <Link href="/app/settings" className="hover:text-foreground">Settings</Link>
      <span aria-hidden="true" className="px-1.5">›</span>
      <span aria-current="page">{label}</span>
    </nav>
  );
}
