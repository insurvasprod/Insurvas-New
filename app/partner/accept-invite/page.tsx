import { Suspense } from "react";
import Link from "next/link";
import { AcceptPartnerInviteForm } from "@/components/partner/accept-partner-invite-form";
import { InsurvasLogo } from "@/components/shared/insurvas-logo";

export default function AcceptPartnerInvitePage() {
  return <div className="portal-partner portal-partner-auth-page min-h-screen bg-[var(--color-page-bg)]">
    <header className="portal-auth-header"><Link href="/partner/login" className="portal-auth-brand inline-flex items-center gap-2.5" aria-label="Insurvas partner portal"><InsurvasLogo size="auth" /></Link><nav aria-label="Support links"><a href="/partner/login">Partner Portal</a><a href="mailto:support@insurvas.com">Help</a></nav></header>
    <main className="portal-auth-main m-in"><Suspense fallback={<div className="portal-auth-suspense" role="status">Loading invitation…</div>}><AcceptPartnerInviteForm /></Suspense></main>
    <footer className="portal-auth-footer"><Link href="/legal/privacy">Privacy</Link><Link href="/legal/tos">Terms</Link><a href="mailto:support@insurvas.com">Support</a></footer>
  </div>;
}
