import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

/**
 * The board's empty state, and the true one: a policy is listed only with the reason that put it
 * there (a missed draft, a returned payment, a service call), and none is open. The populated state
 * is lapse-risk-board.tsx; the page chooses between them on whether any signal is open.
 *
 * `notice` is the one addition to the board: before the lapse-signal migration is applied nothing
 * can be recorded, and the page says so under the card rather than implying the book is clean.
 */
export function LapseRiskEmpty({ eyebrow, notice }: { eyebrow?: string; notice?: string }) {
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader eyebrow={eyebrow} title="Lapse risk" />
      <div className="flex min-h-0 flex-grow items-center justify-center">
        <div className="w-full max-w-[620px]">
          <Card className="py-8">
            <CardContent className="px-8 text-center">
              <span className="mx-auto inline-flex size-13 items-center justify-center rounded-full bg-[var(--surface-alt)] text-muted-foreground">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </span>
              <h2 className="mt-4 text-2xl font-semibold leading-[1.21] tracking-[-0.02em] text-foreground">Nothing at risk right now</h2>
              <p className="mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
                Scored policies will appear here most&nbsp;urgent&nbsp;first, each with the signal that put it there — a missed draft, a returned payment, a service call — and the premium and commission exposed.
              </p>
              <p className="mt-2.5 text-base leading-normal tracking-[-0.02em] text-muted-foreground">
                <strong className="font-semibold text-foreground">A risk score without a reason is not actionable</strong>, so no policy will ever appear here without one. No sample row is fabricated to make the page look finished.
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <Button asChild variant="outline" className="h-11 border-[var(--border-strong)] px-4">
                  <Link href="/app/policies">Review policies</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
          {notice && <p role="status" className="mt-3 text-center text-sm text-muted-foreground">{notice}</p>}
        </div>
      </div>
    </div>
  );
}
