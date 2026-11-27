import { useEffect, useState } from "react";
import { ActivityIndicator, Alert as Ask, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { SwipeRow } from "@/components/inbox/swipe-row";
import { CouldntLoad, Nothing, Skeleton, useBarMarks } from "@/components/states/states";
import { F, FloatingButton, Group, IOS, Row, Screen, Header, SearchBox, Segments, type HeaderAction } from "@/components/ui";
import { readSnoozes, snoozeUntil, SNOOZE_OPTIONS, writeSnoozes, type SnoozeMap, type SnoozeOption } from "@/lib/alert-snooze";
import { chatTime } from "@/lib/answer-state";
import { chatRows, filterChatRows, hitRows, type ChatRow, type ChatSearchAnswer, type ChatsAnswer } from "@/lib/chats";
import { useCounts } from "@/lib/counts";
import { appHrefFor } from "@/lib/links";
import { currentTabs } from "@/lib/nav";
import { useSession } from "@/lib/session";
import type { Alert } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board H1 · Inbox, alerts, and H2 · Inbox, messages. The bell, full screen: anything a page wanted to
 * say lands here, never on the page (owner rule).
 *
 * Alerts (GET /api/app/notifications?recent=1): this person's unread bell rows and the ones read in the last
 * week, grouped by day, newest first. Unread carry the gold dot; read ones stay listed without it. Tapping one
 * marks it read and opens exactly what it names. Swipe left: Snooze (it leaves the list until its time is up,
 * kept on this phone as the web keeps it per browser) and Read.
 *
 * Messages (GET /api/app/partner-chat): the conversations this person is in, groups first, unread counts in
 * gold. The Alerts / Messages switch always shows; the server decides who may open partner chat (owners and
 * producers on a plan with it), and anyone else sees no conversations. Search filters the conversations and
 * searches the messages; the pencil and the button start a new message.
 */
type ReadAlert = Alert & { read_at: string };
type InboxAnswer = { alerts: Alert[]; read?: ReadAlert[] };
type Listed = Alert & { unread: boolean };

function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

/** "9:12 am" today, "Mon" earlier in the week (board H1's meta lines). */
function when(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (dayLabel(iso, now) === "Today") return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

const CHAT_ICON = { partner: "handshake", group: "users", direct: "user" } as const;

export default function Inbox() {
  const p = usePalette();
  const { api, me } = useSession();
  const counts = useCounts();
  const marks = useBarMarks();
  const params = useLocalSearchParams<{ part?: string }>();
  const list = useLoad(() => api<InboxAnswer>("/api/app/notifications?recent=1"), [], { every: 15_000 });
  // Partner chat is the server's to open (owners and producers, by plan too); other roles are not asked.
  const chatRole = me?.role === "owner" || me?.role === "producer";
  const chats = useLoad(() => (chatRole ? api<ChatsAnswer>("/api/app/partner-chat").catch(() => null) : Promise.resolve(null)), [chatRole], { every: chatRole ? 15_000 : undefined });
  // A link can open either part (/inbox?part=messages); a tap on the switch wins until the link changes.
  const linked: "alerts" | "messages" = params.part === "messages" ? "messages" : "alerts";
  const [chosen, setChosen] = useState<{ part: "alerts" | "messages"; link: string | undefined } | null>(null);
  const part = chosen && chosen.link === params.part ? chosen.part : linked;
  const setPart = (next: "alerts" | "messages") => setChosen({ part: next, link: params.part });
  const [clearing, setClearing] = useState(false);
  const [readNow, setReadNow] = useState<Record<string, string>>({});
  const [snoozed, setSnoozed] = useState<SnoozeMap>({});
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ q: string; answer: ChatSearchAnswer } | null>(null);
  // Snoozes end on their own: the list looks at the clock again every half minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const userId = me?.user.id ?? "";

  useEffect(() => {
    let live = true;
    if (userId) void readSnoozes(userId).then((m) => { if (live) setSnoozed(m); });
    return () => { live = false; };
  }, [userId]);

  // Messages search: two letters or more also asks the server for messages holding the words.
  useEffect(() => {
    const q = query.trim();
    if (!chatRole || q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      void api<ChatSearchAnswer>(`/api/app/partner-chat?search=${encodeURIComponent(q)}`).then((a) => { if (live) setHits({ q, answer: a }); }, () => { if (live) setHits(null); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [api, chatRole, query]);

  function markRead(ids: string[]) {
    if (!ids.length) return;
    const at = new Date().toISOString();
    setReadNow((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, at])) }));
    void api("/api/app/notifications", { method: "POST", body: { ids } }).then(counts.refresh, () => undefined);
  }

  function open(a: Listed) {
    if (a.unread) markRead([a.id]);
    // The role opens the screens that depend on who you are (the Commission ledger), as the Menu does.
    const href = appHrefFor(a.link, currentTabs(), me?.memberRole ?? me?.role ?? null);
    if (href) router.push(href as never);
    else if (a.link) router.push({ pathname: "/computer", params: { path: a.link, title: a.title } });
  }

  function snooze(a: Listed) {
    const pick = (option: SnoozeOption) => {
      const next = { ...snoozed, [a.id]: snoozeUntil(option, new Date()).toISOString() };
      setSnoozed(next);
      if (userId) void writeSnoozes(userId, next);
    };
    Ask.alert("Snooze until", undefined, [...SNOOZE_OPTIONS.map((o) => ({ text: o.label, onPress: () => pick(o.key) })), { text: "Cancel", style: "cancel" as const }]);
  }

  async function readAll() {
    setClearing(true);
    try {
      await api("/api/app/notifications", { method: "POST", body: {} });
      const at = new Date().toISOString();
      setReadNow((m) => ({ ...m, ...Object.fromEntries((list.data?.alerts ?? []).map((x) => [x.id, at])) }));
      counts.refresh();
    } finally {
      setClearing(false);
    }
  }

  // Unread (the feed, oldest first) and read, newest first; a snoozed alert is away until its time is up.
  const awake = (a: Alert) => !(snoozed[a.id] && Date.parse(snoozed[a.id]) > now);
  const seen = new Set<string>();
  const alerts: Listed[] = [
    ...(list.data?.alerts ?? []).map((a) => ({ ...a, unread: !readNow[a.id] })),
    ...(list.data?.read ?? []).map((a) => ({ ...a, unread: false })),
  ].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true))).filter(awake).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const unreadCount = alerts.filter((a) => a.unread).length;
  const days: { label: string; items: Listed[] }[] = [];
  for (const a of alerts) {
    const label = dayLabel(a.created_at);
    const last = days[days.length - 1];
    if (last?.label === label) last.items.push(a);
    else days.push({ label, items: [a] });
  }

  const rows: ChatRow[] = chats.data ? chatRows(chats.data) : [];
  const shownRows = filterChatRows(rows, query);
  const found = chats.data && hits && hits.q === query.trim() && hits.q.length >= 2 ? hitRows(chats.data, hits.answer.hits) : [];
  const unreadChats = rows.reduce((n, r) => n + r.unread, 0);
  const showing = part;

  const readAllAction: HeaderAction = IOS
    ? { key: "read-all", node: (
      <Pressable testID="inbox-read-all" accessibilityRole="button" accessibilityLabel="Read all" disabled={!unreadCount || clearing} onPress={readAll} hitSlop={8} style={{ opacity: unreadCount ? 1 : 0.4 }}>
        {clearing ? <ActivityIndicator color={p.greenInk} /> : <Text style={{ fontFamily: F.r, fontSize: 17, color: p.greenInk }}>Read all</Text>}
      </Pressable>
    ) }
    : { icon: "listCheck", label: "Read all", onPress: () => { if (unreadCount && !clearing) void readAll(); } };
  const newChat = () => router.push("/chat/new" as never);
  const toggleSearch = () => { setSearching((s) => !s); setQuery(""); };
  const actions: HeaderAction[] = showing === "alerts"
    ? [...marks, readAllAction, { icon: "settings", label: "Alert settings", onPress: () => router.push("/notifications" as never) }]
    : [...marks, { icon: "search", label: "Search chats", onPress: toggleSearch }, ...(chatRole ? [{ icon: "pencil" as const, label: "New message", onPress: newChat }] : [])];

  const segments = (
    <>
      {IOS ? null : <View style={{ height: 10 }} />}
      <View style={IOS ? { paddingHorizontal: 16, paddingBottom: 10 } : null}>
        <Segments value={showing} onChange={(k) => { setPart(k as "alerts" | "messages"); setSearching(false); setQuery(""); }}
          items={[{ key: "alerts", label: "Alerts", count: unreadCount }, { key: "messages", label: "Messages", count: unreadChats }]} />
      </View>
    </>
  );

  const dot = <View testID="unread-dot" style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.gold, marginLeft: -4 }} />;
  const badge = (n: number) => (
    <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: p.gold, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontFamily: F.b, fontSize: 11, lineHeight: 18, color: p.onGold }}>{n > 99 ? "99+" : String(n)}</Text>
    </View>
  );
  const openChat = (id: string) => router.push({ pathname: "/chat/[threadId]", params: { threadId: id } });

  const refresh = () => { if (showing === "alerts") list.refresh(); else chats.refresh(); };
  return (
    <View style={{ flex: 1 }}>
    <Screen onRefresh={refresh} refreshing={showing === "alerts" ? list.refreshing : chats.refreshing}
      header={<Header title="Inbox" actions={actions} belowFull={segments} />}>
      {!IOS ? <View style={{ height: 6 }} /> : null}
      {showing === "messages" && searching ? (
        <View style={{ paddingHorizontal: 16, paddingTop: IOS ? 0 : 6 }}><SearchBox testID="chat-search" value={query} onChangeText={setQuery} placeholder="Search chats" autoFocus /></View>
      ) : null}
      {showing === "messages" ? (
        chatRole && chats.loading && !chats.data ? <Skeleton rows={5} /> : shownRows.length || found.length ? (
          <>
            {shownRows.length ? (
              <Group>
                {shownRows.map((c, i) => (
                  <Row key={c.id} testID={`chat-${c.id}`} first={i === 0} icon={CHAT_ICON[c.kind]} title={c.name} meta={c.preview}
                    chip={c.unread ? badge(c.unread) : undefined} right={c.at ? chatTime(c.at) : undefined} onPress={() => openChat(c.id)} />
                ))}
              </Group>
            ) : null}
            {found.length ? (
              <Group title="Messages">
                {found.map((h, i) => <Row key={h.id} testID={`hit-${h.id}`} first={i === 0} icon="msg" title={h.name} meta={h.text} right={chatTime(h.at)} onPress={() => openChat(h.channelId)} />)}
              </Group>
            ) : null}
          </>
        ) : query.trim() ? <Nothing icon="search" title="Nothing matches" body="Try a name, or a word from the message." />
          : <Nothing icon="msgs" title="No conversations yet" body="Chats you’re in with partners and your team show here." />
      ) : list.loading && !list.data ? <Skeleton rows={5} /> : list.error && !list.data ? <CouldntLoad what="your alerts" message={list.error} onRetry={list.reload} /> : alerts.length ? (
        days.map((day) => (
          <Group key={day.label} title={day.label}>
            {day.items.map((a, i) => (
              <SwipeRow key={a.id} testID={`swipe-${a.id}`}
                actions={[{ key: "snooze", label: "Snooze", tone: "info", onPress: () => snooze(a) }, ...(a.unread ? [{ key: "read", label: "Read", tone: "green" as const, onPress: () => markRead([a.id]) }] : [])]}>
                <Row testID={`alert-${a.id}`} first={i === 0} lead={a.unread ? dot : undefined} title={a.title} meta={[a.body, when(a.created_at)].filter(Boolean).join(" · ")} chevron onPress={() => open(a)} />
              </SwipeRow>
            ))}
          </Group>
        ))
      ) : <Nothing icon="inbox" title="You’re all caught up" body="Alerts land here and on your lock screen." />}
    </Screen>
    {showing === "messages" && chatRole ? <FloatingButton testID="inbox-new-message" label="New message" icon="pencil" onPress={newChat} /> : null}
    </View>
  );
}
