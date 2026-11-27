import { MoneyTab } from "@/components/money/money-tab";
import { PayIssuesScreen } from "@/components/money/pay-issues";
import { useSession } from "@/lib/session";

/**
 * The Money tab. Named apart from the /money stack screen.
 *
 *   owner, admin                     Money (board G3): what waits on them, the month, the deposits
 *   bookkeeper                       Pay issues (board G8 draws it as the bookkeeper's Money tab; their approvals
 *                                    are on their Home, board B6, and Money itself opens from Menu › To do)
 *   a plan without the accounting    Pay issues (Ledger: the book and what the carriers pay; no P&L, bills or deposits)
 *
 * Pay issues needs its own feature (discrepancy_report): without it the tab stays Money.
 */
export default function MoneyTabScreen() {
  const { me } = useSession();
  const features = me?.plan?.features;
  const issues = !features || features.includes("discrepancy_report");
  const noAccounting = Boolean(features && !features.includes("profit_and_loss"));
  if (issues && (me?.role === "bookkeeper" || noAccounting)) return <PayIssuesScreen asTab />;
  return <MoneyTab asTab />;
}
