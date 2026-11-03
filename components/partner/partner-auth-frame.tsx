"use client";

import { Children, isValidElement, type ReactNode } from "react";

import { FunnelHeading } from "@/components/app/funnel-frame";
import { AuthHeading, AuthLayout } from "@/components/portal/auth-layout";

/**
 * The partner doors' frame (2026-10-13): sign-in, accepting an invitation and setting a first
 * password. Owner, 2026-11-03: the sign-in's twin, one centred card on the brand field with no
 * showcase panel; a screen that opens with an <AuthHeading> or <FunnelHeading> has it drawn centred
 * above the card, the other ways in go under it in `footer`.
 */

/**
 * Cards drawn inside the frame lose their own box (border, panel, padding): the frame's form column
 * is the surface, as on the sign-in form.
 */
export const PARTNER_FLAT_CARD =
  "w-full gap-4 border-0 bg-transparent py-0 shadow-none [&>[data-slot=card-content]]:px-0 [&>[data-slot=card-header]]:px-0";

/** `animated` is kept for existing callers: the showcase panel is gone. */
export function PartnerAuthFrame({ children, footer }: { children: ReactNode; animated?: boolean; footer?: ReactNode }) {
  const nodes = Children.toArray(children);
  const first = nodes[0];
  const lift = isValidElement(first) && (first.type === AuthHeading || first.type === FunnelHeading);

  return (
    <AuthLayout
      plane="partner"
      heading={lift ? <div data-auth-line="" className="mb-6 flex justify-center text-center">{first}</div> : undefined}
      footer={footer}
    >
      {lift ? nodes.slice(1) : children}
    </AuthLayout>
  );
}
