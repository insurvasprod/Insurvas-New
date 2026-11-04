"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * A row that opens something (board 10): one click anywhere on it, the table's hover tint, and a "›" at its end.
 * A link or button inside the row keeps its own click. No "Open" button per row.
 */
export function ClickRow({ href, label, children, className }: { href: string; label: string; children: ReactNode; className?: string }) {
  const router = useRouter();
  return (
    <tr
      className={cn("group cursor-pointer", className)}
      onClick={(event) => { if ((event.target as HTMLElement).closest("a, button")) return; router.push(href); }}
    >
      {children}
      <td className="w-8 text-right">
        <Link href={href} aria-label={label} className="text-muted-foreground group-hover:text-foreground">›</Link>
      </td>
    </tr>
  );
}
