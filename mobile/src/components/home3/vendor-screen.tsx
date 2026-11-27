import { useState } from "react";
import { Linking } from "react-native";
import { router } from "expo-router";

import { Chip, Empty, Failed, Group, Header, IOS, Loading, Row, Screen, Tile } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { dayKey, dollars, monthLong, monthRange, perHundred, prevMonth, unitPrice, vendorCampaigns } from "./logic";
import { Delta, Half, MoneyTile, TileGrid } from "./parts";
import type { TrueCpaAnswer, VendorsAnswer } from "./types";

/**
 * Board D10 · a lead vendor's card for the owner on the go: what their leads really cost and became this month.
 * Read from GET /api/app/true-cpa?vendor_id= (the True CPA report, this month so far and all of last month for the
 * comparison) and GET /api/app/vendors (the vendor's name and who to write to). Buying more, returns and campaign
 * setup stay on the computer.
 *
 * "Costly" marks the campaign the report itself ranks costliest per sale, only among two or more ranked campaigns.
 */
export function VendorScreen({ id, name: given }: { id: string; name?: string }) {
  const { api } = useSession();
  const [today] = useState(() => dayKey(Date.now()));
  const month = today.slice(0, 7);
  const previous = prevMonth(month);
  const q = (r: { from: string; to: string }) => `/api/app/true-cpa?vendor_id=${encodeURIComponent(id)}&from=${r.from}&to=${r.to}`;
  const now = useLoad(() => api<TrueCpaAnswer>(q(monthRange(month, today))), [id]);
  const before = useLoad(() => api<TrueCpaAnswer>(q(monthRange(previous))).catch(() => null), [id]);
  const vendors = useLoad(() => api<VendorsAnswer>("/api/app/vendors").catch(() => null), []);
  const refresh = () => { now.refresh(); before.reload(); vendors.reload(); };

  const record = vendors.data?.vendors.find((v) => v.id === id) ?? null;
  const v = now.data?.vendor_rows.find((r) => r.vendor_id === id) ?? null;
  const last = before.data?.vendor_rows.find((r) => r.vendor_id === id) ?? null;
  const title = v?.vendor_name ?? record?.name ?? given ?? "Vendor";
  const email = record?.contact?.email;
  const campaigns = now.data ? vendorCampaigns(now.data.rows.filter((r) => r.vendor_id === id)) : null;
  const sub = `Vendor${v ? ` · ${v.campaigns} ${v.campaigns === 1 ? "campaign" : "campaigns"}` : ""} · ${monthLong(month)}`;

  const cost = v?.effective_cost_per_issued_policy_cents ?? null;
  const lastCost = last?.effective_cost_per_issued_policy_cents ?? null;
  const moved = cost !== null && lastCost !== null ? Math.round(cost / 100) - Math.round(lastCost / 100) : null;

  let body;
  if (!now.data) body = now.loading ? <Loading rows={5} /> : <Failed what="this vendor" message={now.error ?? "Try again."} onRetry={now.reload} />;
  else if (!v) body = <Empty icon="target" title="No campaigns this month" body={`${title} has no campaign in the True CPA report for ${monthLong(month)}.`} />;
  else body = (
    <>
      <TileGrid>
        <Half><Tile testID="vendor-leads" label="Leads bought" value={v.leads_received.toLocaleString("en-US")} detail={v.cost_per_record_cents !== null ? `${unitPrice(v.cost_per_record_cents)} each` : undefined} /></Half>
        <Half><MoneyTile testID="vendor-cost" label="True cost per sale" cents={cost}
          detail={moved ? <Delta strong={`${moved < 0 ? "↓" : "↑"} $${Math.abs(moved).toLocaleString("en-US")}`} rest={`vs ${monthLong(previous)}`} good={moved < 0} /> : cost === null ? "No sale yet" : undefined} /></Half>
        <Half><Tile testID="vendor-contact" label="Contact rate" value={v.contact_rate_percent !== null ? `${Math.round(v.contact_rate_percent)}%` : "—"} /></Half>
        <Half><Tile testID="vendor-sold" label="Sold" value={v.issued_policies.toLocaleString("en-US")} detail={perHundred(v.issued_policies, v.leads_received) ?? undefined} /></Half>
      </TileGrid>
      <Group title="Campaigns" footer={campaigns?.rows.length ? "Right column: true cost per sale." : undefined}>
        {campaigns?.rows.length ? campaigns.rows.map((c, i) => (
          <Row key={c.campaign_id} first={i === 0} testID={`vendor-campaign-${c.campaign_id}`} icon="target" title={c.campaign_name}
            meta={`${c.leads_received.toLocaleString("en-US")} ${c.leads_received === 1 ? "lead" : "leads"} · ${c.issued_policies.toLocaleString("en-US")} sold`}
            chip={c.campaign_id === campaigns.costliest ? <Chip tone="warn">Costly</Chip> : undefined}
            right={c.effective_cost_per_issued_policy_cents !== null ? dollars(c.effective_cost_per_issued_policy_cents) : "—"} />
        )) : <Row first icon="target" iconTone="plain" title={`No leads in ${monthLong(month)} yet`} />}
      </Group>
    </>
  );

  return (
    <Screen
      header={<Header back={IOS ? "Menu" : undefined} onBack={router.back} large title={title} sub={sub}
        actions={email ? [{ icon: "msg", label: `Write to ${record?.contact?.name ?? title}`, onPress: () => void Linking.openURL(`mailto:${email}`) }] : []} />}
      onRefresh={refresh} refreshing={now.refreshing}>
      {body}
    </Screen>
  );
}
