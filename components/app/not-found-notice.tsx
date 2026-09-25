import { Link2Off } from "lucide-react";
import Link from "next/link";

import { ReportBrokenLink } from "@/components/app/report-broken-link";
import { Button } from "@/components/ui/button";

/**
 * The 404 (p-gate-404). Only an address that is not a page at all reaches it: a menu item the plan
 * does not grant shows the plan message, and one that is granted but unbuilt shows "on the way"
 * (see app/app/(shell)/[section]/page.tsx). So it says plainly that the link was wrong, offers a
 * way back and a way to report it, and never an upgrade.
 */
export function NotFoundNotice({ homeHref = "/app/dashboard", homeLabel = "Back to your dashboard" }: { homeHref?: string; homeLabel?: string }) {
  return (
    <div className="portal-gate-card">
      <div className="portal-gate-lead">
        <span className="portal-gate-icon is-error">
          <Link2Off className="size-6" aria-hidden="true" />
        </span>
        <h2>There is no page here</h2>
        <p>This address is not one of the product&rsquo;s destinations, so there is nothing to unlock and nothing to wait for.</p>
        <p>If you followed a link from inside Insurvas, that link is wrong and we would like to know.</p>
        <div className="portal-gate-actions">
          <Button asChild>
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
          <ReportBrokenLink />
        </div>
      </div>
      <div className="portal-gate-note is-info">
        <strong>Why this is not an upgrade prompt</strong>
        <p>A menu item you are not entitled to shows a plan message. A menu item your plan grants but we have not finished shows &ldquo;on the way&rdquo;. Only an address that is not a page at all reaches this screen &mdash; so seeing it means the link was wrong, not that you are missing something.</p>
      </div>
    </div>
  );
}
