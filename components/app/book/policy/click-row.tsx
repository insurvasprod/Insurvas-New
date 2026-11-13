"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A row that opens something (board 10): one click anywhere on it, the table's hover tint, and a "›" at its end.
 * A link or button inside the row keeps its own click. No "Open" button per row.
 *
 * `chevron={false}` (owner 2026-11-11, one-line tables) leaves the "›" cell out: the row still opens, and the table
 * carries its own link in a cell (its first column, or a short "Open ›"). Leaving it out keeps the old look.
 */
export function ClickRow({ href, label, children, className, chevron = true }: { href: string; label: string; children: ReactNode; className?: string; chevron?: boolean }) {
  const router = useRouter();
  return (
    <tr
      className={cn("group cursor-pointer", className)}
      onClick={(event) => { if ((event.target as HTMLElement).closest("a, button")) return; router.push(href); }}
    >
      {children}
      {chevron && (
        <td className="w-8 text-right">
          <Link href={href} aria-label={label} className="text-muted-foreground group-hover:text-foreground">›</Link>
        </td>
      )}
    </tr>
  );
}
