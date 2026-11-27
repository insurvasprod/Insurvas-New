import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import { useSession } from "./session";
import { useLoad } from "./use-load";

/**
 * The Money tab's badge (board G3: "Waiting on you"). The tab reports its exact count once it has loaded (Team
 * payouts included); until then the badge counts Accounting › To do's items that are yours.
 */
let moneyWaiting: number | null = null;
const moneyListeners = new Set<() => void>();
export function reportMoneyWaiting(n: number | null): void {
  if (moneyWaiting === n) return;
  moneyWaiting = n;
  moneyListeners.forEach((l) => l());
}
function useMoneyWaiting(): number | null {
  return useSyncExternalStore((l) => { moneyListeners.add(l); return () => { moneyListeners.delete(l); }; }, () => moneyWaiting, () => moneyWaiting);
}
const MONEY_ROLES = ["owner", "admin", "bookkeeper"];

/**
 * The tab badges (gold: new counts). Calls = transfers waiting + callbacks due; Inbox = unread bell rows.
 * Read every 20 seconds while the app is open; push is what reaches the phone when it is closed.
 */
export type NavCounts = { counts: Partial<Record<"leads.dialer" | "leads.inbound" | "sell.callbacks" | "retention.lapse-risk", number>>; presence: string | null };
type Alerts = { alerts: { id: string }[] };

const CountsContext = createContext<{ calls: number; inbox: number; money: number; nav: NavCounts | null; refresh: () => void }>({ calls: 0, inbox: 0, money: 0, nav: null, refresh: () => undefined });

export function CountsProvider({ children }: { children: ReactNode }) {
  const { api, me } = useSession();
  const nav = useLoad(() => api<NavCounts>("/api/app/nav/counts"), [], { every: 20_000 });
  const inbox = useLoad(() => api<Alerts>("/api/app/notifications"), [], { every: 20_000 });
  const moneyRole = MONEY_ROLES.includes(me?.memberRole ?? me?.role ?? "");
  const steps = useLoad(async () => (moneyRole ? api<{ items?: { yours?: boolean }[] }>("/api/app/accounting/steps?items=1").then((a) => (a.items ?? []).filter((i) => i.yours).length).catch(() => 0) : 0), [moneyRole], { every: moneyRole ? 60_000 : undefined });
  const reported = useMoneyWaiting();
  const c = nav.data?.counts ?? {};
  const value = {
    calls: (c["leads.inbound"] ?? 0) + (c["sell.callbacks"] ?? 0),
    inbox: inbox.data?.alerts.length ?? 0,
    money: moneyRole ? reported ?? steps.data ?? 0 : 0,
    nav: nav.data,
    refresh: () => { void nav.reload(); void inbox.reload(); },
  };
  return <CountsContext.Provider value={value}>{children}</CountsContext.Provider>;
}

export function useCounts() {
  return useContext(CountsContext);
}
