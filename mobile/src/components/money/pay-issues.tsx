import { router } from "expo-router";

import { MoneyFigure } from "@/components/book/parts";
import { Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { kindsLine, money, plural } from "./logic";
import { Card, Mini, Pad } from "./parts";
import type { PayIssuesByCarrier } from "./types";

/**
 * Board G8 · Pay issues: what the carriers owe the agency, by carrier, the total to the cent (never a $0 that
 * nothing was checked for). Commissions › Pay issues' Open list, both sources (GET /api/app/discrepancies?view=carriers,
 * the page's own reader; owner and bookkeeper). Disputing each line needs the statement beside it, so a carrier
 * opens on the computer, on that carrier's issues. Drawn as the bookkeeper's Money tab (board G8) and as Money on a
 * plan without the agency's accounting; the owner reaches it from Menu.
 */
const toComputer = (path: string, title: string) => router.push({ pathname: "/computer", params: { path, title, why: "Each issue is argued with the carrier’s statement beside it, and its letter is drafted there." } });

export function PayIssuesScreen({ asTab = false }: { asTab?: boolean }) {
  const { api } = useSession();
  const answer = useLoad(() => api<PayIssuesByCarrier>("/api/app/discrepancies?view=carriers"), []);
  const d = answer.data;
  const header = (
    <Header title="Pay issues" sub="Owed to you" back={asTab ? undefined : IOS ? "Money" : undefined} onBack={asTab ? undefined : router.back} large
      actions={[{ icon: "laptop", label: "Open Pay issues on the computer", onPress: () => toComputer("/app/discrepancies", "Pay issues") }]} />
  );
  return (
    <Screen header={header} onRefresh={answer.refresh} refreshing={answer.refreshing}>
      {answer.loading && !d ? <Loading rows={5} />
        : answer.errorCode?.status === 403 && !d ? <Empty icon="landmark" title="Pay issues are worked by the owner or a bookkeeper" body={answer.error ?? undefined} />
          : answer.error && !d ? <Failed what="the pay issues" message={answer.error} onRetry={answer.reload} />
            : d && !d.available ? <Empty icon="landmark" title="Pay issues aren’t switched on yet" body="They need a database update. The web says which one." />
              : d && !d.carriers.length ? <Empty icon="check" title="No pay issues open" body="Every carrier paid what your contracts say, as far as the statements show." />
                : d ? (
                  <>
                    <Pad>
                      <Card testID="issues-total">
                        <MoneyFigure cents={d.owedCents} size={36} />
                        <Mini>{[plural(d.count, "item", "items"), kindsLine(d.kinds)].filter(Boolean).join(" · ")}</Mini>
                      </Card>
                    </Pad>
                    <Group title="By carrier">
                      {d.carriers.map((c, i) => (
                        <Row key={c.carrierKey} testID={`issues-carrier-${i}`} first={i === 0} icon="landmark" title={c.carrierName} meta={kindsLine(c.kinds) || null} right={money(c.owedToYouCents)}
                          onPress={() => toComputer(c.carrierKey.startsWith("name:") ? "/app/discrepancies" : `/app/discrepancies?carrier=${encodeURIComponent(c.carrierKey)}`, `${c.carrierName} pay issues`)} />
                      ))}
                    </Group>
                  </>
                ) : null}
    </Screen>
  );
}
