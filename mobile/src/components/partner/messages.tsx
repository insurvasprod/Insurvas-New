import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { chatTime } from "@/lib/answer-state";
import { Sheet } from "@/components/leads/sheets";
import { Empty, F, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { ChatThread } from "./chat-thread";
import { attachmentProblem, conversationRows, nameMap, readMark, threadItems } from "./logic";
import { usePartnerSession } from "./session";
import type { PartnerChatAnswer, PipelineAnswer } from "./types";

/**
 * Board K5 · Partner messages: the partner's side of partner chat — their conversation with the agency and
 * any groups they were added to — newest first, the last word and who wrote it, unread counts in gold. The
 * same threads the agents see in their Inbox, read through the partner portal's own /api/partner/chat,
 * which only ever answers the session's own partner channel and the groups this person is in.
 *
 * The pencil starts a new message: a direct conversation with someone at the agency or on the partner's
 * own team (POST /api/partner/chat create_channel — the server allows exactly those people, and returns the
 * existing conversation when there is one). Every row carries the building mark, as the board draws it.
 */
export function PartnerMessages() {
  const p = usePalette();
  const { api, me } = usePartnerSession();
  const chat = useLoad(() => api<PartnerChatAnswer>("/api/partner/chat"), [], { every: 15_000 });
  const [composing, setComposing] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const header = <Header title="Messages" actions={[{ icon: "pencil", label: "New message", onPress: () => { setProblem(null); setComposing(true); } }]} />;
  if (chat.loading && !chat.data) return <Screen header={header}><Loading rows={4} /></Screen>;
  if (chat.error && !chat.data) return <Screen header={header}><Failed message={chat.error} onRetry={chat.refresh} what="your messages" /></Screen>;
  const d = chat.data!;
  const names = nameMap(d.directory);
  const rows = conversationRows(d.channels, d.viewerId, names);
  // .badge: 18px high, 9px round, 11px bold, gold.
  const badge = (n: number) => (
    <View style={{ minWidth: 18, height: 18, borderRadius: 9, backgroundColor: p.gold, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
      <Text style={{ fontFamily: F.b, fontSize: 11, color: p.onGold }}>{n > 99 ? "99+" : String(n)}</Text>
    </View>
  );
  const people = (list: { user_id: string }[] | undefined) => (list ?? []).filter((x) => x.user_id !== d.viewerId && names.has(x.user_id)).map((x) => ({ id: x.user_id, name: names.get(x.user_id)! })).sort((a, b) => a.name.localeCompare(b.name));
  const agencyPeople = people(d.directory?.tenantUsers);
  const teamPeople = people(d.directory?.partnerUsers);
  const start = async (userId: string) => {
    setStarting(userId);
    setProblem(null);
    try {
      const r = await api<{ channel: { id: string } }>("/api/partner/chat", { method: "POST", body: { action: "create_channel", channel_type: "direct", user_ids: [userId] } });
      setComposing(false);
      chat.reload();
      router.push({ pathname: "/partner/thread/[id]", params: { id: r.channel.id } } as never);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn’t start that conversation.");
    } finally {
      setStarting(null);
    }
  };
  return (
    <Screen header={header} onRefresh={chat.refresh} refreshing={chat.refreshing}>
      {rows.length ? (
        <Group>
          {rows.map((r, i) => (
            <Row key={r.id} testID={`conversation-${r.id}`} first={i === 0} icon="building" title={r.name} meta={r.preview}
              chip={r.unread ? badge(r.unread) : undefined} right={r.at ? chatTime(r.at) : undefined} onPress={() => router.push({ pathname: "/partner/thread/[id]", params: { id: r.id } } as never)} />
          ))}
        </Group>
      ) : <Empty icon="msgs" title="No conversations yet" body="When the agency writes to you, it shows here." />}
      <Sheet visible={composing} title="New message" onClose={() => setComposing(false)} testID="new-message">
        <View style={{ gap: 4 }}>
          {agencyPeople.length ? <Group title={d.agencyName ?? "The agency"}>{agencyPeople.map((x, i) => <Row key={x.id} testID={`person-${x.id}`} first={i === 0} icon="user" title={x.name} onPress={() => void start(x.id)} chevron={false} right={starting === x.id ? "…" : undefined} />)}</Group> : null}
          {teamPeople.length ? <Group title={me?.partnerName ?? "Your team"}>{teamPeople.map((x, i) => <Row key={x.id} testID={`person-${x.id}`} first={i === 0} icon="user" title={x.name} onPress={() => void start(x.id)} chevron={false} right={starting === x.id ? "…" : undefined} />)}</Group> : null}
          {!agencyPeople.length && !teamPeople.length ? <Text style={{ fontFamily: F.r, fontSize: 14, color: p.muted }}>No one to message yet.</Text> : null}
          {problem ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{problem}</Text> : null}
        </View>
      </Sheet>
    </Screen>
  );
}

/**
 * One conversation on the partner's side, drawn as H3. Reads mark it read (PATCH), sends post to the same
 * route (POST channel_id + message), and a photo goes as the route's multipart form. A lead card opens
 * that lead's page (K3b) when it is one of this partner's own.
 */
export function PartnerThread({ id, draft: initialDraft }: { id: string; draft?: string }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api, upload } = usePartnerSession();
  const chat = useLoad(() => api<PartnerChatAnswer>("/api/partner/chat"), [id], { every: 15_000 });
  const [draft, setDraft] = useState(initialDraft ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entry = chat.data?.channels.find((c) => c.channel.id === id) ?? null;
  const unread = entry?.unreadCount ?? 0;
  const marked = useRef(-1);
  useEffect(() => {
    if (!entry || unread === 0 || marked.current === unread) return;
    marked.current = unread;
    void api("/api/partner/chat", { method: "PATCH", body: { channel_id: id } }).catch(() => undefined);
  }, [api, entry, id, unread]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/partner/messages" as never));
  const header = <Header title={entry?.channel.name ?? "Messages"} large={false} back={IOS ? "Messages" : undefined} onBack={back} />;

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    try {
      await api("/api/partner/chat", { method: "POST", body: { channel_id: id, message } });
      setDraft("");
      chat.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const attach = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    const asset = picked.canceled ? null : picked.assets[0];
    if (!asset) return;
    const problem = attachmentProblem({ mimeType: asset.mimeType, fileSize: asset.fileSize });
    if (problem) { setError(problem); return; }
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("channel_id", id);
      if (draft.trim()) form.append("message", draft.trim());
      form.append("files", { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" } as unknown as Blob);
      await upload("/api/partner/chat", form);
      setDraft("");
      chat.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t send. Try again.");
    } finally {
      setSending(false);
    }
  };

  // A card names the queue row; the partner's own pipeline names its lead.
  const openCard = async (workItemId: string) => {
    try {
      const page = await api<PipelineAnswer>("/api/partner/leads/pipeline?limit=1000");
      const row = page.rows.find((r) => r.workItemId === workItemId);
      if (row) router.push(`/partner/lead/${row.id}` as never);
    } catch { /* the card stays where it is */ }
  };

  let body;
  if (chat.loading && !chat.data) body = <Loading rows={5} />;
  else if (chat.error && !chat.data) body = <Failed message={chat.error} onRetry={chat.refresh} what="this conversation" />;
  else if (!entry) body = <Empty icon="msgs" title="This conversation isn’t open to you" />;
  else {
    const d = chat.data!;
    const items = threadItems(entry.messages, d.viewerId, nameMap(d.directory), { otherSide: null });
    body = <ChatThread items={items} readMark={readMark(entry.messages, d.viewerId, entry.othersReadAt)} onOpenCard={(w) => void openCard(w)} draft={draft} onDraft={setDraft} onSend={send} sending={sending} onAttach={attach} placeholder={`Message ${entry.channel.name}`} error={error} />;
  }
  return <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>{header}{body}</View>;
}
