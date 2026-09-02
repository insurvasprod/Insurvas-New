"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cardTitle, type PartnerMessage } from "@/lib/partnerChat/cards";

type ChatResponse = { channel: { id: string; name: string; status: string }; messages: PartnerMessage[]; unreadCount: number; realtimeTopic: string };

export function PartnerChatPanel() {
  const [chat, setChat] = useState<ChatResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (markRead = true) => {
    const response = await fetch("/api/partner/chat", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Chat is temporarily unavailable"); return null; }
    setChat(body); setError(null);
    if (markRead) void fetch("/api/partner/chat", { method: "PATCH" });
    return body as ChatResponse;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    void fetch("/api/partner/chat", { cache: "no-store" }).then((response) => response.json()).then((body: ChatResponse) => {
      if (cancelled || !body?.realtimeTopic) return;
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      channel = supabase.channel(body.realtimeTopic).on("broadcast", { event: "message" }, () => { void load(); }).subscribe();
    }).catch(() => undefined);
    const kickoff = window.setTimeout(() => { void load(); }, 0);
    const fallback = window.setInterval(() => { void load(false); }, 15000);
    return () => { cancelled = true; window.clearTimeout(kickoff); window.clearInterval(fallback); if (channel) void getSupabaseBrowserClient()?.removeChannel(channel); };
  }, [load]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/partner/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: draft }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Message could not be sent"); return; }
      setDraft(""); setNotice("Message sent"); await load();
    } catch { setError("Chat is temporarily unavailable. Your message is still in the box."); }
    finally { setBusy(false); }
  }

  return <Card>
    <CardHeader><CardTitle>Partner chat</CardTitle><CardDescription>Updates from the agent appear here automatically. System updates cannot be edited.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {error && <p className="rounded-md border border-[var(--color-danger)]/40 p-3 text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
      {notice && <p className="rounded-md border border-[var(--color-success)]/40 p-3 text-sm text-[var(--color-success)]" role="status">{notice}</p>}
      <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-md border p-3" aria-live="polite">
        {!chat || chat.messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet.</p> : chat.messages.map((item) => <article className={`rounded-md p-3 ${item.messageKind === "system_card" ? "border border-[var(--color-blue)]/30 bg-[var(--color-blue)]/5" : "bg-muted/30"}`} key={item.id}><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.messageKind === "system_card" ? cardTitle(item) : "Message"}</p><p className="mt-1 text-sm">{item.message}</p><time className="mt-2 block text-xs text-muted-foreground" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></article>)}
      </div>
      <form className="space-y-2" onSubmit={send}><textarea aria-label="Message" maxLength={2000} placeholder="Write to the agent…" value={draft} onChange={(event) => setDraft(event.target.value)} className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm" /><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{draft.length}/2,000</span><Button type="submit" disabled={busy || !draft.trim()}>{busy ? "Sending…" : "Send message"}</Button></div></form>
    </CardContent>
  </Card>;
}
