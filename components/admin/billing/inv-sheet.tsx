"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

import { Sheet } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** The current address without `param`, read at click time so filters kept in place (setParamsInPlace) survive. */
export function hrefWithout(param: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete(param);
  return `${url.pathname}${url.search}`;
}

/** The current address with `param` set, keeping every filter on it. */
export function hrefWith(param: string, value: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(param, value);
  return `${url.pathname}${url.search}`;
}

const noop = () => () => {};

/**
 * Draws a sheet on document.body. The Billing frame's step column animates in with a transform and its cards
 * are glass, and either makes a `position: fixed` child fixed to that column instead of the window — the sheet
 * came up inside the frame, cut short. On the body it is fixed to the window, as everywhere else.
 */
export function BodyPortal({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  return mounted ? createPortal(children, document.body) : null;
}

/**
 * A Billing record as a right sheet over its list (billing-r2: "a record opens as a right sheet, not a page
 * swap"). The record is in the address (`?invoice=<id>`, `?note=<id>`) and drawn on the server, so the sheet
 * survives a refresh, can be linked to, and reuses the record's own server view; closing drops the parameter
 * and keeps every filter. `wide` is the invoice's 760px sheet; otherwise the 420px standard.
 */
export function RecordSheet({ param, title, subtitle, status, actions, footer, wide = false, children }: {
  param: string;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <BodyPortal>
    <Sheet
      title={title}
      subtitle={subtitle}
      status={status}
      actions={actions}
      footer={footer}
      className={cn(wide && "lg:w-[760px]")}
      onClose={() => router.push(hrefWithout(param), { scroll: false })}
    >
      {children}
    </Sheet>
    </BodyPortal>
  );
}
