import Link from "next/link";

import { Button } from "@/components/ui/button";
import { utcDateTime } from "@/lib/system/adminFormat";
import { getMaintenanceStatus } from "@/lib/system/service";

/**
 * p-pub-maintenance. Only a `locked` platform redirects here (app/app/(shell)/layout.tsx), but the
 * page is public and bookmarkable, so it reads the live status on every render and says what is
 * true now. A window whose end has passed already resolves to `off` in getMaintenanceStatus.
 */
export default async function MaintenancePage() {
  const status = await getMaintenanceStatus();

  if (status.level !== "locked") {
    const copy =
      status.level === "read_only"
        ? {
            title: "You can sign in, but changes are paused",
            body: "Maintenance is running in read-only mode. You can see your leads, calls and settings; saving changes comes back when it finishes.",
          }
        : status.level === "banner_only"
          ? {
              title: "The platform is open",
              body: status.scheduledStart
                ? `Maintenance is planned from ${utcDateTime(status.scheduledStart)}. Until then everything works as usual.`
                : "Maintenance is planned. Until it starts everything works as usual.",
            }
          : { title: "The platform is available again", body: "Maintenance has finished. Nothing was lost while it ran." };
    return (
      <div className="m-stagger flex min-h-screen items-center justify-center bg-[var(--canvas)] p-6 sm:p-10">
        <div className="w-full max-w-[620px]">
          <div className="rounded-xl border border-border bg-card p-6 sm:p-10">
            <h1 className="text-center text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">{copy.title}</h1>
            <p className="mt-2.5 text-center text-base leading-normal tracking-[-0.02em] text-muted-foreground">{copy.body}</p>
            {status.level !== "off" && status.message ? (
              <p className="mt-4 rounded-xl border border-border bg-[var(--surface-alt)] px-4 py-3 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
                {status.message}
              </p>
            ) : null}
            <div className="mt-6 flex justify-center">
              <Button asChild className="h-11">
                <Link href="/app/login">Continue to sign in</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="m-stagger flex min-h-screen items-center justify-center bg-[var(--canvas)] p-6 sm:p-10">
      <div className="w-full max-w-[620px]">
        <div className="rounded-xl border border-border bg-card p-6 sm:p-10">
          <h1 className="text-center text-[32px] font-semibold leading-[1.13] tracking-[-0.025em] text-foreground">
            We&rsquo;ll be back shortly
          </h1>
          <p className="mt-2.5 text-center text-base leading-normal tracking-[-0.02em] text-muted-foreground">
            Insurvas is offline for scheduled maintenance. Nothing has been lost.
          </p>

          <div className="mt-6 rounded-xl border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5">
            <div className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--warning-ink)]">
              {status.scheduledEnd ? `Expected back by ${utcDateTime(status.scheduledEnd)}` : "No end time has been published yet"}
            </div>
            <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
              {status.message ??
                "Your leads, calls and settings are safe. You can sign in again as soon as the work finishes; this page updates when you reload it."}
            </p>
          </div>

          <div className="mt-6 flex justify-center">
            <Button asChild className="h-11">
              <Link href="/maintenance">Check again</Link>
            </Button>
          </div>
          <p className="mt-4 text-center text-xs leading-normal text-muted-foreground">
            Insurvas staff can still <Link href="/admin/login" className="font-semibold text-foreground">sign in to admin</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
