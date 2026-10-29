import { InfoTip } from "@/components/ui/info-tip";

/**
 * An older name for InfoTip (2026-10-29: one info icon, opening on hover and on click). New code
 * uses InfoTip; `id` is no longer needed and is ignored.
 */
export function HoverHint({ label, children }: { id?: string; label: string; children: string }) {
  return <InfoTip label={label}>{children}</InfoTip>;
}
