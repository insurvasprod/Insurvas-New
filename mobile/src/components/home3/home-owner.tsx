import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { MoneyFigure } from "@/components/book/parts";
import { SmallAvatar } from "@/components/home/parts";
import { monthRange, shiftMonth, teamDraft } from "@/components/money/logic";
import type { TeamPayoutsAnswer } from "@/components/money/types";
import { Between, Card, Chip, F, Failed, Loading, Screen, SectionHead, Strip, Tile, type HeaderAction } from "@/components/ui";
import { compactCount } from "@/lib/format";
import { useNav } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { complaintsChip, complaintsDue, dayKey, dollars, initials, licencesExpiring, monthLong, monthShort, premiumMonth } from "./logic";
import { approvePayouts, chargebackPolicies, premiumLeaders, type OwnerProducer } from "./owner-logic";
import { setupRows, type PhoneSetupAnswer } from "./setup-logic";
import { ChartKey, Half, HomePaused, LeaderRow, MoneyTile, MonthChart, openWeb, TileGrid } from "./parts";
import type { AgencyAnswer, ApplicationsAnswer, ComplaintsAnswer, NeedsYouAnswer } from "./types";

/**
 * Board B2 · Home for the agency owner, in the web agency dashboard's order: what needs you, the month's money with
 * last month as the gold dashed line, then who is making the agency money.
 *
 *   needs you      GET /api/app/agency/payouts (Team payouts: the month it lands on, last month until everyone in
 *                  it is paid, the people it pays and the total, as Money's Waiting on you), /api/app/compliance/
 *                  complaints (deadlines), /api/app/needs-you/item (carrier decisions), the dashboard's licence alerts
 *   the month      GET /api/app/applications: submitted premium by day (monthly × 12, as the web's premium card),
 *                  issued this month and placement
 *   producers      GET /api/app/agency/dashboard: each producer's issued annual premium this month (the ranking),
 *                  chargebacks in dollars and in policies
 *
 * The four Needs you tiles always draw: zero is a figure; a read that fails, or that the plan does not include,
 * shows "–". Issued and Chargebacks always draw too (board B2): a read that fails or has not answered shows "—"
 * with what went wrong under it (board M3), never a missing tile. Left out, no data: the payouts' due day (Team payouts has no pay date; the run is dated when it is
 * paid), so the tile shows the total alone.
 */
export function HomeOwner() {
  const p = usePalette();
  const { me, api } = useSession();
  const { go } = useNav();
  const [today] = useState(() => dayKey(Date.now()));
  const current = today.slice(0, 7);
  const apps = useLoad(() => api<ApplicationsAnswer>("/api/app/applications"), []);
  const agency = useLoad(() => api<{ producers: OwnerProducer[] } & Omit<AgencyAnswer, "producers">>("/api/app/agency/dashboard").catch(() => null), []);
  const payouts = useLoad(async () => {
    const teamFor = async (ym: string) => {
      const { from, to } = monthRange(ym);
      const a = await api<TeamPayoutsAnswer>(`/api/app/agency/payouts?from=${from}&to=${to}`);
      return teamDraft(a.preview, a.rules);
    };
    try {
      const last = await teamFor(shiftMonth(current, -1));
      return approvePayouts(last.length ? last : await teamFor(current));
    } catch {
      return null;
    }
  }, [current]);
  const complaints = useLoad(() => api<ComplaintsAnswer>("/api/app/compliance/complaints").catch(() => null), []);
  const needs = useLoad(() => api<NeedsYouAnswer>("/api/app/needs-you/item").catch(() => null), []);
  // Board B9: Get set up opens from the owner's Home while setup is unfinished (the same count as its screen).
  const setup = useLoad(() => api<PhoneSetupAnswer>("/api/app/setup?phone=1").catch(() => null), []);
  const setupLeft = setup.data && !setup.data.checklist.complete ? setupRows(setup.data.checklist.steps, null, setup.data.phone) : null;

  const refresh = () => { apps.refresh(); agency.reload(); payouts.reload(); complaints.reload(); needs.reload(); setup.reload(); };
  const producers = agency.data?.producers ?? null;
  const sub = `${monthLong(current)} so far${producers ? ` · ${producers.length} ${producers.length === 1 ? "producer" : "producers"}` : ""}`;
  const actions: HeaderAction[] = [
    { icon: "search", label: "Search", onPress: () => router.push("/search") },
    { key: "me", node: <SmallAvatar initials={initials(me?.user.name ?? me?.user.email)} label={`${me?.user.name ?? "You"}, open the menu`} onPress={() => router.push("/menu")} /> },
  ];
  const num = (n: number | null | undefined) => (n === null || n === undefined ? "–" : compactCount(n));

  const approve = payouts.data;
  const due = complaints.data ? complaintsDue(complaints.data.complaints) : null;
  const dueChip = due ? complaintsChip(due) : null;
  const licences = agency.data ? licencesExpiring(agency.data.alerts) : null;

  const money = apps.data ? premiumMonth(apps.data.applications, today) : null;
  const clawed = producers ? chargebackPolicies(producers) : null;
  const board = producers ? premiumLeaders(producers) : [];

  let body;
  if (!apps.data && apps.loading) body = <Loading rows={5} />;
  else if (!apps.data && !producers) body = <Failed what="the agency" message={apps.error ?? "Try again."} onRetry={refresh} />;
  else body = (
    <>
      {setupLeft && setupLeft.next.length ? (
        <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <Card onPress={() => router.push("/setup" as never)} style={{ gap: 10 }}>
            <Between>
              <Text style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>Get set up</Text>
              <Text style={{ fontFamily: F.r, fontSize: 13.5, color: p.muted }}>{setupLeft.label}</Text>
            </Between>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: p.track, overflow: "hidden" }}>
              <View style={{ width: `${setupLeft.share}%`, height: 6, borderRadius: 3, backgroundColor: p.green }} />
            </View>
          </Card>
        </View>
      ) : null}
      <Strip>
        <Tile testID="owner-approve" width={150} icon="wallet" label="Approve payouts" value={num(approve?.count)} detail={approve?.count ? dollars(approve.cents) : undefined} onPress={() => router.push("/money" as never)} />
        <Tile testID="owner-complaints" width={150} icon="alert" label="Complaints due" value={num(due?.count)} detail={dueChip ? <Chip tone="warn">{dueChip}</Chip> : undefined} onPress={() => openWeb("/app/complaints", "Complaints")} />
        <Tile testID="owner-decisions" width={150} icon="files" label="Carrier decisions" value={num(needs.data?.total)} detail={needs.data?.phone.total ? `Pick a client · ${needs.data.phone.total}` : undefined} onPress={() => router.push("/book/sync" as never)} />
        <Tile testID="owner-licences" width={150} icon="badge" label="Licences expiring" value={num(licences?.count)} detail={licences?.soonest ?? undefined} onPress={() => router.push("/compliance/licences" as never)} />
      </Strip>

      {money ? (
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <Card onPress={() => router.push("/money" as never)}>
            <Between>
              <Text style={{ fontFamily: F.m, fontSize: 14, color: p.muted }}>Submitted premium</Text>
              {money.change !== null && money.change !== 0 ? (
                <Chip tone={money.change > 0 ? "gold" : "neutral"}>{`${money.change > 0 ? "↑" : "↓"} ${Math.abs(money.change)}% vs ${monthShort(money.previous)}`}</Chip>
              ) : null}
            </Between>
            <View style={{ marginTop: 4, marginBottom: 8 }}><MoneyFigure testID="owner-submitted" cents={Math.round(money.totalCents / 100) * 100} size={38} dropZero /></View>
            <MonthChart series={money.series} before={money.before} />
            <ChartKey now={`${monthLong(money.month)} ($ thousands)`} before={monthLong(money.previous)} />
          </Card>
        </View>
      ) : null}

      <View style={{ marginTop: 10 }}>
        <TileGrid>
          <Half><MoneyTile testID="owner-issued" label="Issued" cents={money ? money.issued.cents : null}
            detail={money ? (money.placement ? `${money.placement.pct}% placement` : `${money.issued.count} ${money.issued.count === 1 ? "policy" : "policies"}`) : apps.loading ? undefined : "Couldn’t load"}
            onPress={() => router.push("/book" as never)} /></Half>
          <Half><MoneyTile testID="owner-chargebacks" label="Chargebacks" cents={clawed ? clawed.cents : null}
            detail={clawed ? (clawed.policies ? <Chip tone="warn">{`${clawed.policies} ${clawed.policies === 1 ? "policy" : "policies"}`}</Chip> : "Nothing clawed back") : agency.loading ? undefined : "Couldn’t load"}
            onPress={() => router.push("/money" as never)} /></Half>
        </TileGrid>
      </View>

      {board.length ? (
        <>
          <SectionHead link={`All ${producers?.length ?? board.length}`} onLink={() => go("/teamtab")}>Producers</SectionHead>
          <View style={{ marginHorizontal: 16, paddingVertical: 4, backgroundColor: p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 16 }}>
            {board.map((r, i) => (
              <LeaderRow key={r.userId} first={i === 0} rank={r.rank} initials={initials(r.name)} name={r.name} value={dollars(r.cents)} share={r.share} onPress={() => router.push(`/team/${r.userId}` as never)} />
            ))}
          </View>
        </>
      ) : null}
    </>
  );

  return (
    <Screen title={me?.tenant.name ?? "Your agency"} sub={sub} actions={actions} onRefresh={refresh} refreshing={apps.refreshing}>
      <HomePaused />
      {body}
    </Screen>
  );
}
