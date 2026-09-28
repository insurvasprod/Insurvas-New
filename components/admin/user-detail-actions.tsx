"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InviteLinkPanel } from "@/components/admin/invite-link-panel";
import { SuspendUserDialog } from "@/components/admin/suspend-user-dialog";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { credentialAction } from "@/lib/adminUsers/credential";
import type { UserListRow } from "@/lib/users/list";

const DANGER = "border-[var(--error)] text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]";
const NOTE = "m-0 mt-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]";

type Transition = "activate" | "deactivate" | "unsuspend";

/**
 * The record's Actions card. Exactly the per-user actions the users list offers, from the same
 * states and through the same routes (so status changes still pass the one seat rule in
 * admin_set_user_status), with the same confirmation: Suspend asks for a reason, the rest act at
 * once. Rendered with buttons only for the roles those routes admit; everyone else gets the reason.
 */
export function UserDetailActions({
  user,
  canManage,
  managerRoleLabel,
}: {
  user: { id: string; name: string; email: string; status: string; hasPassword: boolean; acceptedMembership: boolean };
  /** Whether the viewer's role is one the status, reset and invitation routes accept. */
  canManage: boolean;
  /** The role that can, for the explanation shown to everyone else. */
  managerRoleLabel: string;
}) {
  const router = useRouter();
  const credential = credentialAction({ status: user.status, hasPassword: user.hasPassword, acceptedMembership: user.acceptedMembership });
  const [busy, setBusy] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [issued, setIssued] = useState<{ title: string; url: string; expiresAt: string } | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutReason, setSignOutReason] = useState("");
  const [signOutError, setSignOutError] = useState<string | null>(null);

  if (!canManage || user.status === "deleted") {
    return (
      <p className={cn(NOTE, "mt-3.5")}>
        {user.status === "deleted"
          ? "This account has been deleted. Nothing on this page can change it."
          : `Read-only. Changing this account needs the ${managerRoleLabel} role.`}
      </p>
    );
  }

  // What the dialogs need from a list row; they only read id, name and email.
  const row = { id: user.id, name: user.name, email: user.email } as UserListRow;

  async function post(path: string) {
    setBusy(true);
    const res = await fetch(`/api/admin/users/${user.id}/${path}`, { method: "POST" }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    return { ok: Boolean(res?.ok), body };
  }

  async function changeState(path: Transition, done: string, failed: string) {
    const { ok, body } = await post(path);
    if (!ok) {
      notify.block(body?.error ?? failed);
      return;
    }
    notify.done(`${user.email} ${done}`);
    router.refresh();
  }

  async function sendReset() {
    const { ok, body } = await post("send-reset");
    if (!ok) {
      notify.block(body?.error ?? "Could not send reset link");
      return;
    }
    notify.done(`Password reset link issued for ${user.email}`);
    setIssued({ title: "New reset link issued", url: body.reset.url, expiresAt: body.reset.expiresAt });
    router.refresh();
  }

  /** Ends every agency and partner session (raises users.session_version); the account is untouched. */
  async function signOutEverywhere() {
    setBusy(true);
    setSignOutError(null);
    const res = await fetch(`/api/admin/users/${user.id}/sign-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: signOutReason }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setSignOutError(body?.error ?? "Could not sign this user out.");
      return;
    }
    setSignOutOpen(false);
    setSignOutReason("");
    notify.done(`${user.email} signed out of every session`);
    router.refresh();
  }

  async function resendInvite() {
    const { ok, body } = await post("resend-invite");
    if (!ok) {
      notify.block(body?.error ?? "Could not resend invitation");
      return;
    }
    notify.done(`New invitation issued for ${user.email}`);
    setIssued({ title: "New invitation issued", url: body.invite.url, expiresAt: body.invite.expiresAt });
    router.refresh();
  }

  return (
    <>
      <div className="mt-3.5 flex flex-col gap-2">
        {user.status === "suspended" && (
          <Button type="button" className="w-full" disabled={busy} onClick={() => changeState("unsuspend", "unsuspended", "Could not unsuspend this user")}>
            Unsuspend
          </Button>
        )}
        {user.status === "inactive" && (
          <Button type="button" className="w-full" disabled={busy} onClick={() => changeState("activate", "reactivated", "Could not reactivate this user")}>
            Reactivate
          </Button>
        )}
        {user.status === "active" && (
          <>
            <Button type="button" variant="outline" className={cn("w-full", DANGER)} disabled={busy} onClick={() => setSuspendOpen(true)}>
              Suspend…
            </Button>
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => changeState("deactivate", "deactivated", "Could not deactivate this user")}>
              Deactivate in every agency
            </Button>
          </>
        )}
        {/* At most one applies (lib/adminUsers/credential.ts): someone who has joined their agency
            gets a reset; someone still being onboarded gets the invitation again; a suspended or
            deactivated account gets neither, because consuming a reset link reactivates it. */}
        {credential === "reset" && (
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={sendReset}>
            Send password reset link
          </Button>
        )}
        {credential === "invite" && (
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={resendInvite}>
            Resend invitation
          </Button>
        )}
        {user.status === "active" && (
          <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => setSignOutOpen(true)}>
            Sign out everywhere…
          </Button>
        )}
      </div>

      <Dialog open={signOutOpen} onOpenChange={(open) => { if (!open) { setSignOutOpen(false); setSignOutError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign {user.name} out everywhere?</DialogTitle>
            <DialogDescription>
              Every agency and partner session for {user.email} ends on its next request. They can sign straight back in
              with their password — to stop that, suspend the account instead.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sign-out-reason" className="text-[14px] leading-[1.5] font-semibold text-[var(--ink)]">Reason</label>
            <textarea
              id="sign-out-reason"
              value={signOutReason}
              onChange={(event) => setSignOutReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Lost laptop reported by the agency owner"
              className="w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-[14px] leading-[1.5] text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
            />
            <p className="m-0 text-[12px] leading-[1.5] text-[var(--muted)]">Recorded in the audit log with your name.</p>
            {signOutError && <p role="alert" className="m-0 text-[12px] leading-[1.5] text-[var(--error-ink)]">{signOutError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOutOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={signOutEverywhere} disabled={busy || signOutReason.trim().length < 3}>
              {busy ? "Signing out…" : "Sign out everywhere"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SuspendUserDialog
        user={row}
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        onSuspended={() => router.refresh()}
      />

      <Dialog open={issued !== null} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{issued?.title ?? "New link issued"}</DialogTitle>
            <DialogDescription>Any earlier link for {user.email} has been revoked and no longer works.</DialogDescription>
          </DialogHeader>
          {issued && <InviteLinkPanel url={issued.url} expiresAt={issued.expiresAt} />}
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
