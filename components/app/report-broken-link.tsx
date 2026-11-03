"use client";

import { Button } from "@/components/ui/button";

/**
 * "Report the broken link" (p-gate-404). An email to support that already says which address
 * failed and which page linked to it — the two facts anyone fixing it needs, and the two a person
 * reporting it would otherwise have to copy by hand. Read when pressed, because the server that
 * rendered the 404 cannot see the address bar or the referrer.
 */
export function ReportBrokenLink() {
  function report() {
    const from = document.referrer || "typed or bookmarked";
    const body = `This address has no page:\n${window.location.href}\n\nI came from:\n${from}\n`;
    window.location.href = `mailto:support@insurvas.com?subject=${encodeURIComponent("Broken link in Insurvas")}&body=${encodeURIComponent(body)}`;
  }
  return (
    <Button type="button" variant="outline" onClick={report}>
      Report the broken link
    </Button>
  );
}
