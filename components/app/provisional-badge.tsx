/**
 * LA-4.9 (Notion sprint) · a contact built from a carrier's file that nobody has confirmed yet. It
 * is shown wherever the contact appears until it is confirmed — never silently passed off as a
 * verified client.
 */
export function ProvisionalBadge({ className = "" }: { className?: string }) {
  return (
    <span title="Built from a carrier's file and not yet confirmed by the agent" className={`inline-flex items-center rounded-full border border-[var(--warning)] bg-[var(--warning-surface)] px-2 py-0.5 text-xs font-medium text-[var(--warning-ink)] ${className}`}>
      Provisional
    </span>
  );
}
