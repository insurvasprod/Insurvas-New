import { useState } from "react";
import { router, Stack } from "expo-router";

import { dayKey, dollars, monthLong, monthRange } from "@/components/home3/logic";
import type { TrueCpaAnswer, VendorsAnswer } from "@/components/home3/types";
import { Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/**
 * The way into board D10 from Menu: every lead vendor (GET /api/app/vendors, the web's Source ›
 * Vendors list, /app/campaigns/vendors), each with this month's leads, sales and true cost per sale
 * from the True CPA report (GET /api/app/true-cpa). Adding, editing and deleting vendors stays on the
 * computer. A vendor opens its card (/vendor/<id>).
 */
export default function VendorsRoute() {
  const { api } = useSession();
  const [today] = useState(() => dayKey(Date.now()));
  const month = today.slice(0, 7);
  const range = monthRange(month, today);
  const vendors = useLoad(() => api<VendorsAnswer>("/api/app/vendors"), []);
  const report = useLoad(() => api<TrueCpaAnswer>(`/api/app/true-cpa?from=${range.from}&to=${range.to}`), [range.from, range.to]);
  const refresh = () => { vendors.refresh(); report.reload(); };

  let body;
  if (!vendors.data) body = vendors.loading ? <Loading rows={5} /> : <Failed what="the vendors" message={vendors.error ?? "Try again."} onRetry={vendors.reload} />;
  else if (!vendors.data.vendors.length) body = <Empty icon="store" title="No vendors yet" body="Vendors are added on the computer, under Lead sources." />;
  else {
    const byVendor = new Map((report.data?.vendor_rows ?? []).map((row) => [row.vendor_id, row]));
    const list = [...vendors.data.vendors].sort((a, b) => a.name.localeCompare(b.name));
    // Board M3: the month's figures failing is said, never read as "No leads" on every vendor.
    const failed = Boolean(report.error && !report.data);
    body = (
      <>
      {failed ? <Failed what="this month’s figures" message={report.error ?? "Try again."} onRetry={report.reload} /> : null}
      <Group title={monthLong(month)} footer={report.data ? "Right column: true cost per sale." : undefined}>
        {list.map((v, i) => {
          const row = byVendor.get(v.id);
          const meta = failed ? undefined : row ? `${row.leads_received.toLocaleString("en-US")} ${row.leads_received === 1 ? "lead" : "leads"} · ${row.issued_policies.toLocaleString("en-US")} sold` : `No leads in ${monthLong(month)}`;
          return (
            <Row key={v.id} first={i === 0} testID={`vendor-${v.id}`} icon="store" title={v.name} meta={meta}
              right={row?.effective_cost_per_issued_policy_cents != null ? dollars(row.effective_cost_per_issued_policy_cents) : undefined}
              onPress={() => router.push({ pathname: "/vendor/[id]", params: { id: v.id, name: v.name } })} />
          );
        })}
      </Group>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen header={<Header back={IOS ? "Menu" : undefined} onBack={router.back} large title="Vendors" sub={`Lead vendors · ${monthLong(month)}`} />} onRefresh={refresh} refreshing={vendors.refreshing}>
        {body}
      </Screen>
    </>
  );
}
