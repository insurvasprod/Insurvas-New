"use client";

import type { ReactNode } from "react";

import { usePageNotice } from "@/components/ui/page-notices";

/**
 * A shell alert (an overdue complaint, a payment problem). It goes to the bell, never onto the page
 * (owner 2026-11-02: "do not show anything; if there is anything to show put it as an alert in the
 * notification"): listed under the bell's Alerts while it holds, counted on the badge, drawing
 * nothing here. `icon` and `role` are kept so no caller has to change.
 */
export function PageAlert({
  tone,
  text,
  action,
}: {
  tone: "error" | "warning";
  icon?: ReactNode;
  text: string;
  action?: ReactNode;
  role?: "alert" | "status";
}) {
  usePageNotice({ tone, title: text, detail: action });
  return null;
}
