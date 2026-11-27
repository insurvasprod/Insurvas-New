import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";

import { Dialog, Sheet, SheetField, Toast } from "@/components/leads/sheets";
import { Button, Chip, Empty, F, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { initials } from "./logic";
import { usePartnerSession } from "./session";
import type { PartnerUser, UsersAnswer } from "./types";

/**
 * Board K6 · Partner team: the partner admin's people, who can send leads and see the pipeline. Roles are
 * fixed — partner admin and partner user — and an admin invites partner users only (the server's own rule,
 * lib/partnerAuth/schemas.ts partnerAdminUserInviteSchema). GET and POST /api/partner/users, partner admins
 * of a type that has Team access; the agency's seat limit is the server's to enforce.
 *
 * Each row says what that person sent this month (?phone=1, counted in the partner's timezone), or
 * "Invited · not joined"; tapping someone else opens Resend invitation (while they haven't joined,
 * POST …/resend-invite) and Remove access (PATCH …/[userId] deactivate, after a confirm).
 */
const ROLE: Record<PartnerUser["role"], string> = { partner_admin: "Partner admin", partner_user: "Partner user" };

export function PartnerTeam() {
  const p = usePalette();
  const { api, me } = usePartnerSession();
  const users = useLoad(() => api<UsersAnswer>("/api/partner/users?phone=1"), []);
  const [open, setOpen] = useState<PartnerUser | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/partner/account" as never));
  const header = <Header title="Team access" large back={IOS ? "Account" : undefined} onBack={back} actions={[{ icon: "userPlus", label: "Invite someone", onPress: () => { setError(null); setInviting(true); } }]} />;

  const invite = async () => {
    if (!name.trim() || !email.trim()) { setError("Enter their name and email."); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ invite: { delivered: boolean } }>("/api/partner/users", { method: "POST", body: { name: name.trim(), email: email.trim(), role: "partner_user" } });
      setInviting(false);
      setName("");
      setEmail("");
      setToast(r.invite.delivered ? `Invitation sent to ${email.trim()}` : "Invited — the email didn’t go out. Resend it from the portal.");
      users.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not invite them. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const resend = async (u: PartnerUser) => {
    setActing(true);
    setActError(null);
    try {
      const r = await api<{ invite: { delivered: boolean } }>(`/api/partner/users/${u.user_id}/resend-invite`, { method: "POST" });
      setOpen(null);
      setToast(r.invite.delivered ? `Invitation sent again to ${u.email}` : "The invitation was renewed but the email didn’t go out.");
    } catch (e) {
      setActError(e instanceof Error ? e.message : "Could not resend it. Try again.");
    } finally {
      setActing(false);
    }
  };

  const revoke = async (u: PartnerUser) => {
    setConfirming(false);
    setActing(true);
    setActError(null);
    try {
      await api(`/api/partner/users/${u.user_id}`, { method: "PATCH", body: { action: "deactivate" } });
      setOpen(null);
      setToast(`${u.name} can no longer sign in`);
      users.reload();
    } catch (e) {
      setActError(e instanceof Error ? e.message : "Could not remove their access. Try again.");
    } finally {
      setActing(false);
    }
  };

  let body;
  if (users.loading && !users.data) body = <Loading rows={4} />;
  else if (users.error && !users.data) body = <Failed message={users.error} onRetry={users.refresh} what="your team" />;
  else {
    const list = (users.data?.users ?? []).filter((u) => u.status === "active");
    const sent = users.data?.sentThisMonth;
    body = list.length ? (
      <Group title={`${list.length} ${list.length === 1 ? "person" : "people"}`}>
        {list.map((u, i) => {
          const you = u.user_id === me?.userId;
          const joined = Boolean(u.accepted_at);
          const count = sent?.[u.user_id];
          const meta = !joined ? "Invited · not joined" : typeof count === "number" && !you ? `${ROLE[u.role]} · sent ${count.toLocaleString()} this month` : ROLE[u.role];
          return (
            <Row key={u.id} testID={`member-${u.user_id}`} first={i === 0} avatar={initials(u.name)} title={you ? `${u.name} (you)` : u.name}
              meta={meta} chip={joined ? undefined : <Chip tone="info">Invited</Chip>} chevron={!you} onPress={you ? undefined : () => { setActError(null); setOpen(u); }} />
          );
        })}
      </Group>
    ) : <Empty icon="users" title="Just you so far" body="Invite the people who send leads for your company." />;
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} onRefresh={users.refresh} refreshing={users.refreshing}>{body}</Screen>
      <Sheet visible={inviting} title="Invite someone" onClose={() => setInviting(false)}
        footer={<Button testID="invite-send" write label="Send invitation" onPress={() => void invite()} busy={busy} />}>
        <View style={{ gap: 12 }}>
          <SheetField testID="invite-name" label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
          <SheetField testID="invite-email" label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" error={error} />
          <Text style={{ fontFamily: F.r, fontSize: 13, color: p.muted }}>They join as a partner user: they can send leads and see their own pipeline.</Text>
        </View>
      </Sheet>
      <Sheet visible={Boolean(open) && !confirming} title={open?.name ?? ""} onClose={() => setOpen(null)}>
        {open ? (
          <View style={{ gap: 4 }}>
            <Text style={{ fontFamily: F.r, fontSize: 13, color: p.muted, marginBottom: 8 }}>{`${ROLE[open.role]} · ${open.email}`}</Text>
            {!open.accepted_at ? <Row first testID="member-resend" icon="mail" title="Resend invitation" onPress={() => void resend(open)} chevron={false} /> : null}
            <Row first={Boolean(open.accepted_at)} testID="member-revoke" icon="ban" title="Remove access" onPress={() => setConfirming(true)} chevron={false} />
            {acting ? <Text style={{ fontFamily: F.r, fontSize: 13, color: p.muted }}>Working…</Text> : null}
            {actError ? <Text accessibilityRole="alert" style={{ fontFamily: F.r, fontSize: 13, color: p.bad }}>{actError}</Text> : null}
          </View>
        ) : null}
      </Sheet>
      <Dialog visible={confirming && Boolean(open)} title={`Remove ${open?.name ?? "them"}?`} onClose={() => setConfirming(false)}
        actions={[{ label: "Cancel", onPress: () => setConfirming(false) }, { label: "Remove access", kind: "destructive", testID: "member-revoke-confirm", onPress: () => { if (open) void revoke(open); } }]}>
        <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.body }}>They stop being able to sign in and send leads. Leads they sent stay in your pipeline.</Text>
      </Dialog>
      <Toast text={toast} onHide={() => setToast(null)} />
    </View>
  );
}
