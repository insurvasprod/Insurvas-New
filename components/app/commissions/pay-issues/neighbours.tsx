import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { IntentLink } from "@/components/ui/nav-pending";

type Side = { name: string; href: string } | null;

/**
 * A pay-issue record's ‹ › (round 7): each names its neighbour ("‹ Harold Pruitt"); at an end, a disabled "None
 * before" / "None after". Server-safe: plain links, for the frame's `actions` before the record's own buttons.
 */
export function PayIssueNeighbours({ previous, next, noun }: { previous: Side; next: Side; noun: string }) {
  return (
    <>
      {previous
        ? <IntentLink transitionTypes={["nav-back"]} href={previous.href} className={buttonVariants({ variant: "outline" })} title={`Previous ${noun}: ${previous.name}`}><ChevronLeft aria-hidden="true" /><span className="max-w-[220px] truncate">{previous.name}</span></IntentLink>
        : <Button type="button" variant="outline" disabled title={`No ${noun} before this one`}><ChevronLeft aria-hidden="true" />None before</Button>}
      {next
        ? <IntentLink transitionTypes={["nav-forward"]} href={next.href} className={buttonVariants({ variant: "outline" })} title={`Next ${noun}: ${next.name}`}><span className="max-w-[220px] truncate">{next.name}</span><ChevronRight aria-hidden="true" /></IntentLink>
        : <Button type="button" variant="outline" disabled title={`No ${noun} after this one`}>None after<ChevronRight aria-hidden="true" /></Button>}
    </>
  );
}
