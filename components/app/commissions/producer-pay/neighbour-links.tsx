import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

export type Neighbour = { href: string; name: string } | null;

/**
 * A record's ‹ › on the title line (round 7): each names its neighbour ("‹ Dana Whitfield"); at an end it reads
 * "None before" / "None after", disabled. Server-safe: plain links.
 */
export function NeighbourLinks({ previous, next, noun }: { previous: Neighbour; next: Neighbour; /** "producer", "item": the title tip. */ noun: string }) {
  return (
    <>
      {previous
        ? <Link href={previous.href} className={buttonVariants({ variant: "outline" })} title={`Previous ${noun}: ${previous.name}`}><ChevronLeft aria-hidden="true" />{previous.name}</Link>
        : <Button type="button" variant="outline" disabled><ChevronLeft aria-hidden="true" />None before</Button>}
      {next
        ? <Link href={next.href} className={buttonVariants({ variant: "outline" })} title={`Next ${noun}: ${next.name}`}>{next.name}<ChevronRight aria-hidden="true" /></Link>
        : <Button type="button" variant="outline" disabled>None after<ChevronRight aria-hidden="true" /></Button>}
    </>
  );
}
