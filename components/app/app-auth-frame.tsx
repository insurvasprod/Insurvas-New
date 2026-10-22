"use client";

import type { ReactNode } from "react";
import Link from "next/link";

import { InsurvasLogo } from "@/components/shared/insurvas-logo";
import { AuthBrand, PortalAuthSplitShell } from "@/components/portal/portal-auth-split-shell";
import { StoryPanel } from "@/components/app/tenant-auth-workspace";
import styles from "@/components/app/app-auth-frame.module.css";

/**
 * The agent app's account doors beside sign-in (2026-10-13): setting a password from an invitation,
 * checking your email after sign-up, and confirming a changed address all sit in the same split frame
 * as the sign-in and sign-up forms — the form column with the logo and the legal links, and the brand
 * panel with the night ribbon. The cards those screens draw (AuthCard, the confirm-email card) lose
 * their own box inside it (app-auth-frame.module.css), so the column is the surface.
 */
export function AppAuthFrame({ children }: { children: ReactNode }) {
  return (
    <PortalAuthSplitShell
      mode="sign-in"
      className="portal-agent portal-tenant-auth-shell"
      form={
        <div className="m-stagger portal-auth-form-inner">
          <AuthBrand href="/" label="Insurvas home">
            <InsurvasLogo size="auth" />
          </AuthBrand>
          <div className={styles.frame}>{children}</div>
          <nav className="portal-login-footer" aria-label="Legal links">
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/tos">Terms</Link>
            <a href="mailto:support@insurvas.com">Support</a>
          </nav>
        </div>
      }
      story={<StoryPanel mode="sign-in" />}
    />
  );
}
