import type { Href } from "expo-router";
import { TabList, TabSlot, TabTrigger, Tabs } from "expo-router/ui";

import { totalUnread } from "@/components/partner/logic";
import { usePartnerSession } from "@/components/partner/session";
import { TabBarFrame, TabButton } from "@/components/partner/tab-bar";
import type { PartnerChatAnswer } from "@/components/partner/types";
import { useLoad } from "@/lib/use-load";

/**
 * The partner's five tabs (board K1–K5, role "partner"): Home, Send a lead, Pipeline, Messages with the
 * unread count in gold, and Account — the same five labels for every partner type, as the board draws
 * them. Every type keeps all five: each type's portal has a way to send someone, a pipeline and messages
 * (lib/partnerAuth/portalAccess.ts).
 */
export default function PartnerTabs() {
  const { api } = usePartnerSession();
  const chat = useLoad(() => api<PartnerChatAnswer>("/api/partner/chat"), [], { every: 30_000 });
  const unread = chat.data ? totalUnread(chat.data.channels) : 0;
  return (
    <Tabs>
      <TabSlot />
      <TabList asChild>
        <TabBarFrame>
          <TabTrigger name="index" href={"/partner" as Href} asChild><TabButton icon="home" label="Home" /></TabTrigger>
          <TabTrigger name="send" href="/partner/send" asChild><TabButton icon="send" label="Send a lead" /></TabTrigger>
          <TabTrigger name="pipeline" href="/partner/pipeline" asChild><TabButton icon="kanban" label="Pipeline" /></TabTrigger>
          <TabTrigger name="messages" href="/partner/messages" asChild><TabButton icon="msgs" label="Messages" badge={unread} /></TabTrigger>
          <TabTrigger name="account" href="/partner/account" asChild><TabButton icon="user" label="Account" /></TabTrigger>
        </TabBarFrame>
      </TabList>
    </Tabs>
  );
}
