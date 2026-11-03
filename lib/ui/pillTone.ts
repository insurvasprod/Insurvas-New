// The old Pill tones as the StatusChip tones they always rendered as (2026-10-09: the Pill call sites
// became StatusChips).
//
// Kept out of components/app/settings/primitives.tsx on purpose: that file is "use client", and a
// server component that calls a function from it fails at render ("Attempted to call pillTone() from
// the server"). Plain data and a plain function here work on both sides.

import type { StatusTone } from "@/components/ui/status-chip";

export type PillTone = "success" | "warning" | "error" | "info" | "neutral" | "brand";

export const PILL_TONE: Record<PillTone, StatusTone> = {
  success: "good",
  warning: "warning",
  error: "danger",
  info: "info",
  neutral: "neutral",
  brand: "action",
};

export const pillTone = (tone: PillTone): StatusTone => PILL_TONE[tone];
