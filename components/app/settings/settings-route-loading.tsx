import { LoadingRows } from "@/components/ui/page-states";

/**
 * The loading look of a Settings section that has its own route (Accounting, Retention,
 * Compliance): shaped like the Settings frame that is coming — breadcrumb, title, the menu column
 * and the content — so nothing jumps when it arrives (2026-10-29: the page used to draw without its
 * menu and header first).
 */
export function SettingsRouteLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-w-0 flex-col gap-6">
      <span className="sr-only">Loading {label}</span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="h-3.5 w-36 m-skel rounded-full" />
        <div className="h-7 w-52 m-skel rounded-md" />
        <div className="h-3.5 w-96 max-w-full m-skel rounded-full" />
      </div>
      <div aria-hidden="true" className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-[256px_minmax(0,1fr)]">
        <div className="hidden flex-col gap-2 border-r border-[var(--border)] pr-4 lg:flex">
          <div className="h-9 w-full m-skel rounded-md" />
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="h-6 m-skel rounded-md" style={{ width: `${60 + ((index * 17) % 35)}%` }} />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="h-9 w-80 max-w-full m-skel rounded-md" />
          <div className="overflow-hidden rounded-[12px] border border-[var(--border)]">
            <LoadingRows rows={7} columns={4} />
          </div>
        </div>
      </div>
    </div>
  );
}
