import { useEffect, useRef, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { ChoiceSheet } from "@/components/menu/choice-sheet";
import { Empty, Failed, Header, Loading } from "@/components/ui";
import { ApiError, formRequest } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChatThread } from "./chat-thread";
import { attachmentProblem, nameMap, readMark, threadItems } from "./logic";
import type { AgentChatAnswer } from "./types";

/**
 * Board H3 · the agent's side of a partner chat. Every read and write is the web's own route,
 * /api/app/partner-chat (owners and producers, inbound transfers): the list with `with=leads` so a
 * lead card opens the lead, a PATCH that marks the thread read, a POST that sends, and the same POST as
 * multipart for a photo taken with the camera or picked from the phone (the route takes up to three files
 * of the allowed types, 10 MB each). The header's more menu pins or archives the conversation for this
 * person only (the route's conversation_state) and opens it on the computer.
 */
type More = "pin" | "unpin" | "archive" | "computer";

export function AgentChatScreen({ threadId }: { threadId: string }) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api, refreshToken } = useSession();
  const chats = useLoad(() => api<AgentChatAnswer>("/api/app/partner-chat?with=leads"), [threadId], { every: 15_000 });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "more" | "attach">(null);

  const entry = chats.data?.channels.find((c) => c.channel.id === threadId) ?? null;
  const unread = entry?.unreadCount ?? 0;
  const pinned = Boolean((entry?.state as { pinnedAt?: string | null } | undefined)?.pinnedAt);
  // Opening the thread reads it, as the web does; again whenever new messages arrive while it is open.
  const marked = useRef(-1);
  useEffect(() => {
    if (!entry || unread === 0 || marked.current === unread) return;
    marked.current = unread;
    void api("/api/app/partner-chat", { method: "PATCH", body: { channel_id: threadId } }).catch(() => undefined);
  }, [api, entry, threadId, unread]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/inbox?part=messages" as never));
  const header = (
    <Header title={entry?.channel.name ?? "Partner chat"} large={false} back="Inbox" onBack={back}
      actions={entry ? [{ icon: "moreH", label: "More", onPress: () => setSheet("more") }] : undefined} />
  );

  const send = async () => {
    const message = draft.trim();
    if (!message) return;
    setSending(true);
    setError(null);
    try {
      await api("/api/app/partner-chat", { method: "POST", body: { channel_id: threadId, message } });
      setDraft("");
      chats.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const upload = async (asset: ImagePicker.ImagePickerAsset) => {
    const problem = attachmentProblem({ mimeType: asset.mimeType ?? "image/jpeg", fileSize: asset.fileSize });
    if (problem) { setError(problem); return; }
    setSending(true);
    setError(null);
    try {
      const token = await refreshToken();
      if (!token) throw new ApiError(401, { error: "Sign in again." });
      const form = new FormData();
      form.append("channel_id", threadId);
      if (draft.trim()) form.append("message", draft.trim());
      form.append("files", { uri: asset.uri, name: asset.fileName ?? "photo.jpg", type: asset.mimeType ?? "image/jpeg" } as unknown as Blob);
      // The app's own headers and the M8 update check (lib/api.ts formRequest).
      await formRequest("/api/app/partner-chat", form, { method: "POST", token });
      setDraft("");
      chats.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn’t send. Try again.");
    } finally {
      setSending(false);
    }
  };

  const attach = async (from: "camera" | "photos") => {
    if (from === "camera") {
      const allowed = await ImagePicker.requestCameraPermissionsAsync();
      if (!allowed.granted) {
        Alert.alert("Camera is off for Insurvas", "Taking a photo needs the camera. Turn it on in the phone’s Settings, then try again.", [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => undefined) },
        ]);
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.8, exif: false };
    const picked = from === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    const asset = picked.canceled ? null : picked.assets[0];
    if (asset) await upload(asset);
  };

  const more = async (key: More) => {
    if (key === "computer") { router.push({ pathname: "/computer", params: { path: "/app/partner-chat", title: "Partner chat", why: "Every conversation with your partners, with members, files and the leads they sent." } }); return; }
    try {
      await api("/api/app/partner-chat", { method: "POST", body: { action: "conversation_state", channel_id: threadId, ...(key === "archive" ? { archived: true } : { pinned: key === "pin" }) } });
      if (key === "archive") back();
      else chats.reload();
    } catch (e) {
      Alert.alert("Not changed", e instanceof ApiError ? e.message : "Try again.");
    }
  };

  const openCard = (workItemId: string) => {
    const leadId = chats.data?.leadIds?.[workItemId];
    if (leadId) router.push(`/lead/${leadId}` as never);
  };

  let body;
  if (chats.loading && !chats.data) body = <Loading rows={5} />;
  else if (chats.error && !chats.data) body = <Failed message={chats.error} onRetry={chats.refresh} what="this conversation" />;
  else if (!entry) body = <Empty icon="msgs" title="This conversation isn’t open to you" body="It may have been archived, or you’re no longer in it." />;
  else {
    const data = chats.data!;
    const names = nameMap(data.directory);
    const partnerName = entry.channel.channel_type === "partner" ? entry.channel.name : null;
    // Only cards whose lead the server named can open; the rest show, unlinked.
    const items = threadItems(entry.messages, data.viewerId, names, { otherSide: partnerName }).map((it) => (it.kind === "card" && it.workItemId && !data.leadIds?.[it.workItemId] ? { ...it, workItemId: null } : it));
    body = <ChatThread items={items} readMark={readMark(entry.messages, data.viewerId, entry.othersReadAt)} onOpenCard={openCard} draft={draft} onDraft={setDraft} onSend={send} sending={sending} onAttach={() => setSheet("attach")} attachLabel="Attach a photo" placeholder={`Message ${entry.channel.name}`} error={error} />;
  }
  return (
    <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      {header}{body}
      <ChoiceSheet visible={sheet === "attach"} title="Attach" selected={[]} onClose={() => setSheet(null)} onPick={(k) => { setTimeout(() => void attach(k as "camera" | "photos"), 0); }}
        options={[{ key: "camera", label: "Take a photo" }, { key: "photos", label: "Choose from photos" }]} />
      <ChoiceSheet visible={sheet === "more"} title={entry?.channel.name ?? "Conversation"} selected={[]} onClose={() => setSheet(null)} onPick={(k) => void more(k as More)}
        options={[{ key: pinned ? "unpin" : "pin", label: pinned ? "Unpin" : "Pin to the top" }, { key: "archive", label: "Archive" }, { key: "computer", label: "Open on a computer" }]} />
    </View>
  );
}
