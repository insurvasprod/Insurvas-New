import { View } from "react-native";
import { router } from "expo-router";

import { Empty, Failed, Group, Header, Loading, Row, Screen, Tile, type HeaderAction } from "@/components/ui";
import { displayName } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { dayMonth, initials, monthYear, partnerTypeLabel, payoutLabel, per100, periodOf, rateLabel, wholeMoney } from "./logic";
import { TileGrid, openTeam } from "./parts";
import type { PartnerDetail, PartnersAnswer, QualityAnswer } from "./types";

/**
 * Board I8 · a partner from the agency's side: this month's numbers, what the agency owes them and when, their deal,
 * their people, and the chat.
 *
 *   GET /api/app/partners          the record and the people (owner, bookkeeper)
 *   GET /api/app/partners/[id]     owed and the soonest due day from the partner ledger, the deal in force, the chat
 *                                  channel (owner, bookkeeper)
 *   GET /api/app/partner-quality   this month's leads sent, sold (submitted applications, what the deal pays for) and
 *                                  disqualified — the cost-free report (owner, producer, bookkeeper)
 *
 * Opened from Partner quality by anyone who reads that report; who may not read partner records (a producer) sees
 * the quality figures only. The message button opens this partner's own chat thread. The board's return window is
 * not drawn: partner deals have none (returns are a lead-vendor rule). Contract and pricing changes are the computer's.
 */
export function PartnerScreen({ id }: { id: string }) {
  const { api } = useSession();
  const month = periodOf("month");
  const load = useLoad(async () => {
    const [partners, detail, quality] = await Promise.all([
      api<PartnersAnswer>("/api/app/partners").catch(() => null),
      api<PartnerDetail>(`/api/app/partners/${id}`).catch(() => null),
      api<QualityAnswer>(`/api/app/partner-quality?from=${month.from}&to=${month.to}`).catch(() => null),
    ]);
    if (!partners && !quality) throw new Error("This partner could not be read.");
    return { partners, detail, quality };
  }, [id, month.from]);

  const partner = load.data?.partners?.partners.find((x) => x.id === id) ?? null;
  const q = load.data?.quality?.rows.find((r) => r.partner_id === id) ?? null;
  const name = partner?.name ?? q?.partner_name ?? undefined;
  const type = partner?.partner_type ?? q?.partner_type ?? null;
  const threadId = load.data?.detail?.threadId ?? null;
  const actions: HeaderAction[] = name ? [{ icon: "msg", label: `Chat with ${name}`, onPress: () => openTeam(threadId ? `/chat/${threadId}` : "/inbox") }] : [];
  const header = (
    <Header title={name} back="Partners" onBack={() => router.back()} large
      sub={name ? [type ? partnerTypeLabel(type) : null, partner ? `since ${monthYear(partner.created_at)}` : null].filter(Boolean).join(" · ") || undefined : undefined}
      actions={actions} />
  );

  let body;
  if (!load.data) {
    body = load.loading ? <Loading rows={5} /> : <Failed what="this partner" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!partner && !q) {
    body = <Empty icon="handshake" title="Partner not found" body="This partner isn’t in your workspace, or sent nothing this month." />;
  } else {
    const detail = load.data.detail;
    const sent = q?.sent ?? partner?.lead_volume_this_month ?? 0;
    const rate = q ? per100(q.submitted, q.sent) : null;
    const term = detail?.term ?? partner?.active_term ?? null;
    const people = (load.data.partners?.directoryUsers ?? []).filter((u) => u.partner_id === id && u.status === "active");
    body = (
      <View>
        <TileGrid>
          <Tile label="Sent" value={sent.toLocaleString()} detail="This month" />
          <Tile label="Sold" value={q ? String(q.submitted) : "—"} detail={rate !== null ? `${rate.toFixed(1)} per 100` : undefined} />
          {detail && typeof detail.owedCents === "number" ? <Tile label="Owed" value={wholeMoney(detail.owedCents)} detail={detail.dueOn ? `Due ${dayMonth(detail.dueOn)}` : detail.owedCents ? "Not yet due" : "Nothing open"} /> : null}
          <Tile label="Disqualified" value={q ? String(q.disqualified) : "—"} detail={q && q.sent ? `${Math.round((100 * q.disqualified) / q.sent)}% of sent` : undefined} />
        </TileGrid>
        {partner ? (
          <Group title="Deal">
            {term ? (
              <>
                <Row first title={payoutLabel(term.payout_model)} right={rateLabel(term)} chevron={false} />
                <Row title="In force since" right={dayMonth(term.effective_from)} chevron={false} />
              </>
            ) : <Row first title="No deal recorded yet" chevron={false} />}
          </Group>
        ) : null}
        {people.length ? (
          <Group title={`People at ${partner?.name ?? name}`}>
            {people.map((u, i) => {
              const who = displayName(u.name ?? u.email ?? "Someone");
              return <Row key={u.user_id} first={i === 0} avatar={initials(who)} title={who} meta={u.role === "partner_admin" ? "Partner admin" : "Partner user"} chevron={false} />;
            })}
          </Group>
        ) : null}
      </View>
    );
  }
  return <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>;
}
