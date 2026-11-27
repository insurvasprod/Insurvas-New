import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { Icon } from "@/components/icon";
import { LoadState } from "@/components/states/states";
import { Button, F, Field, Group, Header, Row, Screen, SearchBox } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { chatPeople, type ChatsAnswer } from "@/lib/chats";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board H2's pencil and button: a new message. Pick one person for a direct message, or several for a group
 * (with a name if you like), from the chat directory the route itself answers with (the agency's people, then
 * partners' people). The route's create_channel makes it (or reopens the direct message you already have with
 * that person) and the conversation opens. The server checks everyone belongs to the agency and that a chat
 * never mixes two partners; everyone in it sees every message.
 */
export default function NewMessage() {
  const p = usePalette();
  const { api } = useSession();
  const chats = useLoad(() => api<ChatsAnswer>("/api/app/partner-chat"), []);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const people = chats.data ? chatPeople(chats.data) : [];
  const q = query.trim().toLowerCase();
  const shown = q ? people.filter((x) => x.name.toLowerCase().includes(q) || x.meta.toLowerCase().includes(q)) : people;
  const team = shown.filter((x) => !x.partnerId);
  const partners = shown.filter((x) => x.partnerId);
  const toggle = (id: string) => setPicked((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const back = () => (router.canGoBack() ? router.back() : router.replace("/inbox?part=messages" as never));

  async function start() {
    if (!picked.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const group = picked.length > 1;
      const answer = await api<{ channel: { id: string } }>("/api/app/partner-chat", { method: "POST", body: { action: "create_channel", channel_type: group ? "group" : "direct", user_ids: picked, ...(group && name.trim() ? { name: name.trim() } : {}) } });
      router.replace({ pathname: "/chat/[threadId]", params: { threadId: answer.channel.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That chat could not be started. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const row = (x: (typeof people)[number], i: number) => {
    const on = picked.includes(x.id);
    return (
      <Row key={x.id} testID={`person-${x.id}`} first={i === 0} icon={x.partnerId ? "handshake" : "user"} title={x.name} meta={x.meta} selected={on} chevron={false}
        chip={on ? <Icon name="checkC" size={20} color={p.greenInk} /> : undefined} onPress={() => toggle(x.id)} />
    );
  };

  return (
    <Screen header={<Header title="New message" back="Inbox" onBack={back} large={false} below={<SearchBox testID="people-search" value={query} onChangeText={setQuery} placeholder="Search people" />} />}
      footer={picked.length ? (
        <>
          {error ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{error}</Text> : null}
          <Button write testID="start-chat" label={picked.length > 1 ? `Start a group of ${picked.length + 1}` : "Start the chat"} icon="send" busy={busy} onPress={() => void start()} />
        </>
      ) : undefined}>
      <LoadState loading={chats.loading} hasData={Boolean(chats.data)} error={chats.error} errorCode={chats.errorCode} onRetry={chats.reload} what="the people you can message" />
      {picked.length > 1 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Field testID="group-name" label="Group name" value={name} onChangeText={setName} placeholder="Optional" maxLength={160} />
        </View>
      ) : null}
      {team.length ? <Group title="Your agency">{team.map(row)}</Group> : null}
      {partners.length ? <Group title="Partners">{partners.map(row)}</Group> : null}
      {chats.data && !shown.length ? <Text style={{ padding: 16, fontFamily: F.r, fontSize: 15, color: p.muted }}>{q ? "Nobody matches that name." : "There is nobody else to message yet."}</Text> : null}
    </Screen>
  );
}
