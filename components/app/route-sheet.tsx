"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { LoadingRows } from "@/components/ui/page-states";

/**
 * A "New…" or "Invite…" page opened from inside the app (owner 2026-11-12: "do not make it a separate page — a pop-up
 * or a sidebar that comes from the right"): the same form, in the one Sheet (420px, or 640px `wide`), over the page
 * it was opened from. It is the `@sheet` slot's intercepting route (app/app/(shell)/@sheet, Next's modal pattern):
 * the address is the form's own, so Back closes it and a refresh or a shared link opens the full page as before.
 *
 * Closing (X, Escape, the backdrop, a form's Cancel through `useRouteSheet`) goes back. A form that moves on after
 * saving (to the list, to the new record) closes it too: any other address matches the slot's catch-all, which draws
 * nothing.
 */
type RouteSheetApi = { close: () => void };
const RouteSheetContext = createContext<RouteSheetApi | null>(null);

/** Inside a route sheet: close it (go back). Null on the full page, so a form keeps its own Cancel link there. */
export function useRouteSheet(): RouteSheetApi | null {
  return useContext(RouteSheetContext);
}

export function RouteSheet({ title, subtitle, footer, wide = false, children }: { title: string; subtitle?: ReactNode; footer?: ReactNode; wide?: boolean; children: ReactNode }) {
  const router = useRouter();
  const api = useMemo<RouteSheetApi>(() => ({ close: () => router.back() }), [router]);
  return (
    <RouteSheetContext.Provider value={api}>
      <Sheet title={title} subtitle={subtitle} footer={footer} onClose={api.close} className={wide ? "lg:w-[640px]" : undefined}>
        {children}
      </Sheet>
    </RouteSheetContext.Provider>
  );
}

/**
 * A form's Discard or Cancel: on the full page a link back to `href` (as before); in a route sheet it closes the sheet,
 * so the page it was opened from stays where it was.
 */
export function DismissButton({ href, children, variant = "outline" }: { href: string; children: ReactNode; variant?: "outline" | "ghost" }) {
  const sheet = useRouteSheet();
  if (sheet) return <Button type="button" variant={variant} onClick={sheet.close}>{children}</Button>;
  return <Button type="button" variant={variant} asChild><Link href={href}>{children}</Link></Button>;
}

/** While the form's page is on its way (a link not yet loaded ahead): the sheet at once, its rows to come. */
export function RouteSheetLoading({ title, wide = false }: { title: string; wide?: boolean }) {
  return (
    <RouteSheet title={title} wide={wide}>
      <div role="status" aria-live="polite"><span className="sr-only">Loading</span><LoadingRows rows={6} columns={2} /></div>
    </RouteSheet>
  );
}
