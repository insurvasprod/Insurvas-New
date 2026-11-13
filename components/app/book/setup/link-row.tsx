"use client";

import type { MouseEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A table row that opens a page (board 10, clickability): one click anywhere on it, a hover tint; no Open button
 * and no ›-only column. The row's own buttons and links (its next step, a name that opens its own record) keep
 * their click. The first cell's link is the keyboard way in, so the row itself takes no tab stop.
 */
export function LinkRow({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  const open = (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
    if (event.metaKey || event.ctrlKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  return (
    <tr className={cn("group cursor-pointer hover:bg-[var(--primary-soft)]", className)} onClick={open}>
      {children}
    </tr>
  );
}
