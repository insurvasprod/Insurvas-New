"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { isSheetRoute } from "@/lib/navigation/sheetRoutes";

/**
 * The address of the page on screen, for the shell's chrome (the trail, the sidebar's highlight, the page's entrance).
 *
 * It is `usePathname()`, except while a "New…" or "Invite…" panel is open over a page (lib/navigation/sheetRoutes.ts,
 * components/app/route-sheet.tsx): the address is then the form's, but the page underneath has not changed, so this
 * keeps answering with that page — the trail does not jump to "Producers › Invite producer" and the page is not
 * redrawn behind the panel. Opened by a refresh or a shared link, the form is the page, and this is its address.
 */
let lastPage: string | null = null;

export function usePagePathname(): string {
  const pathname = usePathname() ?? "";
  const sheet = isSheetRoute(pathname);
  useEffect(() => {
    if (!sheet) lastPage = pathname;
  }, [pathname, sheet]);
  return sheet && lastPage ? lastPage : pathname;
}
