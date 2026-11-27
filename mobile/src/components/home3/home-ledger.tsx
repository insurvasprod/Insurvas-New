import { useState } from "react";
import { router } from "expo-router";

import { GroupBox, SmallAvatar } from "@/components/home/parts";
import { initialsOf } from "@/components/home/when";
import type { BookChip } from "@/components/book/types";
import type { PayIssuesByCarrier } from "@/components/money/types";
import { Chip, Row, Screen, SectionHead, Strip, Tile, type HeaderAction } from "@/components/ui";
import { compactCount } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { dollars, monthLong } from "./logic";
import type { MissingAnswer, NeedsYouAnswer } from "./types";
import { HomePaused } from "./parts";

type BookCounts = { counts: Record<BookChip, number> & { all: number } };

/**
 * Home for a solo agent on the Ledger plan (owner 2026-11-26: a home per plan). Ledger is the book and the money
 * the carriers pay — no calls, no leads — so the board's B6 book-and-money home is drawn from what the plan holds,
 * in the kit's own pieces (B6 / B2 / G8):
 *
 *   tiles      In force · Behind on payment · Carrier decisions · Pay issues     GET /api/app/policy-book (counts),
 *                                                                               /api/app/needs-you/item, /api/app/discrepancies?view=carriers
 *   Carriers owe you   one row per carrier, what it owes                         the same Pay issues answer (board G8)
 *   Files              carrier files that are late                               GET /api/app/carrier-files?missing=1
 *
 * Tiles always draw (zero is a figure, "–" until the server answers); nothing is invented.
 */
export function HomeLedger() {
  const { me, api } = useSession();
  const [today] = useState(() => new Date().toISOString().slice(0, 7));
  const book = useLoad(() => api<BookCounts>("/api/app/policy-book").catch(() => null), []);
  const needs = useLoad(() => api<NeedsYouAnswer>("/api/app/needs-you/item").catch(() => null), []);
  const owed = useLoad(() => api<PayIssuesByCarrier>("/api/app/discrepancies?view=carriers").catch(() => null), []);
  const late = useLoad(() => api<MissingAnswer>("/api/app/carrier-files?missing=1").catch(() => null), []);
  const refresh = () => { book.reload(); needs.reload(); owed.reload(); late.reload(); };

  const num = (n: number | null | undefined) => (n === null || n === undefined ? "–" : compactCount(n));
  const counts = book.data?.counts;
  const carriers = (owed.data?.carriers ?? []).filter((c) => c.owedToYouCents > 0).sort((a, b) => b.owedToYouCents - a.owedToYouCents).slice(0, 5);
  const files = late.data?.available ? late.data.missing.slice(0, 4) : [];
  const actions: HeaderAction[] = [
    { icon: "search", label: "Search", onPress: () => router.push("/search") },
    { key: "me", node: <SmallAvatar initials={initialsOf(me?.user.name, me?.user.email)} label={`${me?.user.name ?? "You"}, open the menu`} onPress={() => router.push("/menu")} /> },
  ];

  return (
    <Screen title="Today" sub={`${monthLong(today)} book`} actions={actions} onRefresh={refresh} refreshing={book.refreshing}>
      <HomePaused />
      <Strip>
        <Tile testID="ledger-inforce" width={150} icon="book" label="In force" value={num(counts?.inforce)} detail={counts ? `${compactCount(counts.all)} in the book` : undefined} onPress={() => router.push("/policies" as never)} />
        <Tile testID="ledger-behind" width={150} icon="buoy" label="Behind on payment" value={num(counts?.behind)}
          detail={counts?.lapsed ? <Chip tone="warn">{`${counts.lapsed} lapsed`}</Chip> : counts ? "None lapsed" : undefined} onPress={() => router.push("/policies" as never)} />
        <Tile testID="ledger-decisions" width={150} icon="files" label="Carrier decisions" value={num(needs.data?.total)}
          detail={needs.data?.phone.total ? `Pick a client · ${needs.data.phone.total}` : needs.data ? "Nothing to pick" : undefined} onPress={() => router.push("/book/sync" as never)} />
        <Tile testID="ledger-owed" width={150} icon="receipt" label="Pay issues" value={owed.data ? dollars(owed.data.owedCents) : "–"}
          detail={owed.data ? `${owed.data.count} ${owed.data.count === 1 ? "item" : "items"}` : undefined} onPress={() => router.push("/moneytab" as never)} />
      </Strip>

      <SectionHead link="All" onLink={() => router.push("/moneytab" as never)}>Carriers owe you</SectionHead>
      <GroupBox>
        {carriers.length ? carriers.map((c, i) => (
          <Row key={c.carrierKey} first={i === 0} icon="landmark" title={c.carrierName} meta={`${c.count} ${c.count === 1 ? "item" : "items"}`} right={dollars(c.owedToYouCents)} onPress={() => router.push("/moneytab" as never)} />
        )) : <Row first icon="check" iconTone="plain" title={owed.data ? "Every carrier paid in full" : "Checking the statements"} meta={owed.data ? "As far as the statements show" : undefined} />}
      </GroupBox>

      <SectionHead>Files</SectionHead>
      <GroupBox>
        {files.length ? files.map((f, i) => (
          <Row key={f.id} first={i === 0} icon="file" iconTone="warn" title={f.carrierName} meta={`Due ${f.due}`} chip={<Chip tone="warn">{`${f.daysLate} ${f.daysLate === 1 ? "day" : "days"} late`}</Chip>} />
        )) : <Row first icon="check" iconTone="plain" title="Every carrier file is in" />}
      </GroupBox>
    </Screen>
  );
}
