import { Text, View } from "react-native";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";

import { money } from "@/components/book/format";
import { Toast } from "@/components/leads/sheets";
import { Button, Empty, F, Failed, Group, Header, Loading, Row, Screen, SectionHead, Tile } from "@/components/ui";
import { API_URL } from "@/lib/api";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { filterCounts, homeFigures, monthRange, monthTitle, newestFirst, nextPayout, pageAllowed, sendLabel, shortDay } from "./logic";
import { Cell, HeaderAvatar, LeadRow, Rise, TileRow } from "./parts";
import { usePartnerSession } from "./session";
import type { PartnerLink, PayoutsAnswer, PipelineAnswer } from "./types";

/**
 * Board K1 · Partner home, and K1b for an affiliate. What they sent this month, what it became, and what
 * they're owed, following the partner type: a call centre or marketing partner sees Sent / Accepted / Sold
 * and the Send button; an affiliate sees clicks and referrals, and their links with Copy instead of a form.
 *
 * Every figure is the partner portal's own read, scoped on the server to this partner (and, for a partner
 * user, to their own submissions): the month's pipeline with each row's live line
 * (/api/partner/leads/pipeline?live=1: "Transferred 2:09 pm · Jordan took it"), last month's total for the
 * rise, the statements with the next pay day (/api/partner/payouts?phone=1, partner admins only — what the
 * organisation is paid is not for every seat, so a partner user's fourth tile is Working instead) and an
 * affiliate's links. Four tiles always: a figure the page can't stand behind shows "—", never a gap.
 *
 * K1b's link rows: the title is the link's campaign (the agency names it "Final expense · Facebook"), else its
 * slug; the links read has no product, channel or short host yet, so the URL shown is the public /affiliate one.
 * Earned is every published statement not yet paid (admins only: the payouts read refuses a partner user).
 */
export function PartnerHome() {
  const p = usePalette();
  const { api, me, readOnly } = usePartnerSession();
  const [toast, setToast] = useState<string | null>(null);
  const range = monthRange();
  const isAdmin = me?.role === "partner_admin";
  const affiliate = me?.partnerType === "affiliate";

  const data = useLoad(async () => {
    const [month, prev, runs, links] = await Promise.all([
      api<PipelineAnswer>(`/api/partner/leads/pipeline?date_from=${range.from}&limit=1000&live=1`),
      api<PipelineAnswer>(`/api/partner/leads/pipeline?date_from=${range.prevFrom}&date_to=${range.prevTo}&limit=1`).then((a) => a.total, () => null),
      // Statements may not be open yet (503) or the seat may not be an admin's: no money tile, not a failed home.
      isAdmin ? api<PayoutsAnswer>("/api/partner/payouts?phone=1").then((a) => a, () => null) : Promise.resolve(null),
      affiliate ? api<{ links: PartnerLink[] }>("/api/partner/links").then((a) => a.links, () => null) : Promise.resolve(null),
    ]);
    return { month, prev, runs, links };
  }, [me?.role, me?.partnerType, range.from]);

  // K1 "Sending to Ellery & Fields · November"; K1b "Affiliate · Ellery & Fields".
  const sub = !me ? undefined : affiliate ? ["Affiliate", me.agencyName].filter(Boolean).join(" · ") : `Sending to ${me.agencyName ?? "your agency"} · ${range.month}`;
  const header = <Header title={me?.partnerName ?? "Home"} sub={sub} actions={[{ key: "me", node: <HeaderAvatar name={me?.name} /> }]} />;

  if (!me || (data.loading && !data.data)) return <Screen header={header}><Loading rows={4} /></Screen>;
  if (data.error && !data.data) return <Screen header={header}><Failed message={data.error} onRetry={data.refresh} what="your home" /></Screen>;
  const d = data.data!;
  const f = homeFigures(d.month.rows, d.month.total, d.prev);
  const runs = d.runs?.runs ?? null;
  const owed = runs ? nextPayout(runs) : null;
  // K1b "Earned": what the agency still owes the affiliate — every published statement not yet paid.
  const unpaid = runs ? runs.filter((r) => r.status === "published") : [];
  const earnedCents = unpaid.reduce((n, r) => n + r.netCents, 0);
  const oldestUnpaid = unpaid.length ? unpaid[unpaid.length - 1] : null;
  const payDay = owed ? d.runs?.payout?.expectedOn[owed.id] ?? null : null;
  const canSend = pageAllowed("submit", me) || pageAllowed("refer", me);
  const whole = (cents: number) => money(cents).replace(/\.00$/, "");
  const working = filterCounts(d.month.stages, d.month.total).open;

  // The fourth tile: what the organisation is owed (admins), or the seat's own leads still being worked.
  const moneyTile = !isAdmin
    ? <Tile testID="tile-working" label="Working" value={working.toLocaleString()} detail="still with the agency" />
    : affiliate
      ? <Tile testID="tile-earned" label="Earned" value={runs ? whole(earnedCents) : "—"} detail={d.runs?.payout?.next?.revenueShareCents ? "Revenue share" : oldestUnpaid ? `Since the ${monthTitle(oldestUnpaid.periodStart)} statement` : runs?.length ? "All paid" : "Nothing published yet"} />
      : <Tile testID="tile-owed" label="You’re owed" value={runs ? whole(owed?.netCents ?? 0) : "—"} detail={payDay ? `Paid on ${shortDay(payDay)}` : owed ? `${monthTitle(owed.periodStart)} statement` : "Nothing published yet"} />;

  const latest = newestFirst(d.month.rows).slice(0, 4);
  const links = (d.links ?? []).filter((l) => l.isActive);
  const clicks = (d.links ?? []).reduce((n, l) => n + l.clicks, 0);
  const linkUrl = (slug: string) => `${API_URL}/affiliate/${slug}`;
  const copy = async (slug: string) => {
    await Clipboard.setStringAsync(linkUrl(slug));
    setToast("Link copied");
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} onRefresh={data.refresh} refreshing={data.refreshing}>
        {/* Board M6: paused (or the platform read-only), the reason first; everything below stays readable. */}
        {readOnly ? (
          <View testID="home-paused">
            <Empty icon="lock" title={readOnly.code === "partner_paused" ? "Your partner account is paused" : "Insurvas is read only for now"} body={readOnly.message} />
          </View>
        ) : null}
        {affiliate ? (
          <>
            <TileRow>
              <Cell><Tile testID="tile-clicks" label="Clicks" value={d.links ? clicks.toLocaleString() : "—"} /></Cell>
              <Cell><Tile testID="tile-referrals" label="Referrals" value={f.sent.toLocaleString()} detail={f.rise !== null ? <Rise by={f.rise} against={range.prevMonth} /> : undefined} /></Cell>
            </TileRow>
            <TileRow>
              <Cell><Tile testID="tile-sold" label="Sold" value={f.complete ? f.sold.toLocaleString() : "—"} /></Cell>
              <Cell>{moneyTile}</Cell>
            </TileRow>
            <SectionHead>Your links</SectionHead>
            {links.length ? (
              <Group>
                {links.map((l, i) => (
                  <Row key={l.id} testID={`link-${l.id}`} first={i === 0} icon="link" title={l.campaign ?? l.slug}
                    meta={`${linkUrl(l.slug).replace(/^https?:\/\//, "")}${l.referrals >= 0 ? ` · ${l.referrals.toLocaleString()} ${l.referrals === 1 ? "referral" : "referrals"}` : ""}`}
                    right={<Text accessibilityRole="button" accessibilityLabel={`Copy the link for ${l.campaign ?? l.slug}`} onPress={() => void copy(l.slug)} style={{ fontFamily: F.s, fontSize: 14, color: p.greenInk }}>Copy</Text>} chevron={false} />
                ))}
              </Group>
            ) : <Empty icon="link" title="No links yet" body="The agency sets up your tracked links. Ask them for one." />}
          </>
        ) : (
          <>
            <TileRow>
              <Cell><Tile testID="tile-sent" label="Sent" value={f.sent.toLocaleString()} detail={f.rise !== null ? <Rise by={f.rise} against={range.prevMonth} /> : undefined} /></Cell>
              <Cell><Tile testID="tile-accepted" label="Accepted" value={f.complete ? f.accepted.toLocaleString() : "—"} detail={f.complete ? `${f.acceptedPct}% of sent` : undefined} /></Cell>
            </TileRow>
            <TileRow>
              <Cell><Tile testID="tile-sold" label="Sold" value={f.complete ? f.sold.toLocaleString() : "—"} detail={f.complete ? `${f.per100.toLocaleString()} per 100` : undefined} /></Cell>
              <Cell>{moneyTile}</Cell>
            </TileRow>
            {canSend ? <View style={{ paddingHorizontal: 16, marginTop: 2 }}><Button testID="home-send" kind="gold" icon="send" label={sendLabel(me.partnerType)} onPress={() => router.push("/partner/send" as never)} /></View> : null}
            <SectionHead link="Pipeline" onLink={() => router.push("/partner/pipeline" as never)}>Latest</SectionHead>
            {latest.length ? (
              <Group>
                {latest.map((row, i) => <LeadRow key={row.id} row={row} where="home" first={i === 0} onPress={() => router.push(`/partner/lead/${row.id}` as never)} />)}
              </Group>
            ) : <Empty icon="send" title={`Nothing sent in ${range.month} yet`} body="Leads you send show here with what happened to them." />}
          </>
        )}
      </Screen>
      <Toast text={toast} onHide={() => setToast(null)} />
    </View>
  );
}
