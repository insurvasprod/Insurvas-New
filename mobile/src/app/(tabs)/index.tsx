import { HomeAssistant } from "@/components/home3/home-assistant";
import { HomeBookkeeper } from "@/components/home3/home-bookkeeper";
import { HomeLedger } from "@/components/home3/home-ledger";
import { HomeManager } from "@/components/home3/home-manager";
import { HomeOwner } from "@/components/home3/home-owner";
import { HomeProducer } from "@/components/home3/home-producer";
import { HomeSetter } from "@/components/home3/home-setter";
import { RetentionHome } from "@/components/retention/retention-home";
import { planSells } from "@/lib/roles";
import { useSession } from "@/lib/session";

/**
 * Home by role (board section B). Each role's home is its own screen in components/home3 (and retention's in
 * components/retention), built from that role's board drawing:
 *
 *   B1 producer · B2 agency owner · B3 setter · B5 assistant · B6 bookkeeper · B7 retention · B8 manager
 *
 * A manager's base role is producer, so the member role is read first. A solo owner (an individual plan, nobody
 * else calling, owner 2026-11-26) has no team to watch: a plan that sells gets the producer's home, a book-only
 * plan (Ledger) its book-and-commissions home. Matches the tabs (lib/roles.ts soloOwnerTabs).
 */
export default function Home() {
  const { me } = useSession();
  const role = me?.role ?? "producer";
  const owns = role === "owner" || me?.memberRole === "admin";
  if (role === "retention") return <RetentionHome />;
  if (me?.memberRole === "manager") return <HomeManager />;
  if (owns && me?.solo) return planSells(me.plan?.features) ? <HomeProducer /> : <HomeLedger />;
  if (owns) return <HomeOwner />;
  if (role === "bookkeeper") return <HomeBookkeeper />;
  if (role === "setter") return <HomeSetter />;
  if (role === "assistant") return <HomeAssistant />;
  return <HomeProducer />;
}
