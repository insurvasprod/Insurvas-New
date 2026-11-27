import { useLocalSearchParams } from "expo-router";

import { AgentChatScreen } from "@/components/partner/agent-chat";

/** Board H3 · a partner chat thread, opened from the Inbox's Messages (signed-in door, owners and producers). */
export default function ChatThreadRoute() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  return <AgentChatScreen threadId={threadId} />;
}
