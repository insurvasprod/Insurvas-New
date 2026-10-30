import { notFound } from "next/navigation";

import { PartnerChatPanel } from "@/components/partner/partner-chat-panel";
import { PartnerSidebar } from "@/components/partner/partner-sidebar";
import { SAMPLE_CHAT_STATES, sampleChat, type SampleChatState } from "@/lib/partnerChat/fixtures";
import { SAMPLE_ROLES, type SampleRole } from "@/lib/partnerLeads/fixtures";

export const metadata = { title: "Messages · Insurvas design system" };

/**
 * The partner Messages page on sample conversations, in the real partner frame.
 *
 * The development database has one channel, three automatic updates and no reply, so the thread
 * cannot be seen there with two sides, a run of messages under one name, a day separator, an
 * attachment in a bubble, or nothing at all. It can be seen here.
 *
 *   ?state=busy|quiet|empty   ?role=partner_admin|partner_user
 *
 * Development only. Check a change here at 1536×826 and 375 wide before calling it done.
 */
export default async function MessagesDesignPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const one = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]);
  const state = (SAMPLE_CHAT_STATES as readonly string[]).includes(one("state") ?? "") ? (one("state") as SampleChatState) : "busy";
  const role = (SAMPLE_ROLES as readonly string[]).includes(one("role") ?? "") ? (one("role") as SampleRole) : "partner_admin";

  const href = (next: Partial<{ state: string; role: string }>) => `/design/messages?state=${next.state ?? state}&role=${next.role ?? role}`;
  const pill = (active: boolean) =>
    `rounded-md px-2 py-1 text-xs no-underline ${active ? "bg-[var(--surface-alt)] font-semibold text-foreground" : "hover:bg-[var(--surface-alt)]"}`;

  return (
    <div className="portal-agent portal-partner min-h-screen">
      <PartnerSidebar role={role} partnerStatus="active" partnerName="Sample Publishing Co." />
      <main className="min-w-0 flex-1 overflow-x-clip bg-[var(--color-page-bg)] flex flex-col">
        <div className="portal-top-bar flex h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-[var(--surface)] px-6 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Messages preview</span>
          <span className="flex items-center gap-1">
            {SAMPLE_CHAT_STATES.map((item) => <a key={item} href={href({ state: item })} className={pill(item === state)}>{item}</a>)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-1">
            {SAMPLE_ROLES.map((item) => <a key={item} href={href({ role: item })} className={pill(item === role)}>{item === "partner_admin" ? "admin" : "user"}</a>)}
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:p-8 lg:pt-6">
          <PartnerChatPanel key={`${state}-${role}`} role={role} sample={sampleChat(state)} />
        </div>
      </main>
    </div>
  );
}
