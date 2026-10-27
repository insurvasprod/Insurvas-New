"use client";

import { useState } from "react";

import { AuthHeading, AuthLayout, AuthStory, type AuthPlane } from "@/components/portal/auth-layout";
import { AuthAlert, AuthField, AuthInput, AuthSecondary, AuthSubmit } from "@/components/portal/auth-controls";
import { FUNNEL_STEPS } from "@/components/app/funnel-frame";
import { StoryPanel } from "@/components/app/tenant-auth-workspace";

/**
 * Every combination of the auth layout on one page (development only): the sign-up steps sit
 * behind a state machine and the staff sign-in behind 2FA, so this is where their shape is checked
 * without driving a real sign-up or sign-in. Nothing here sends a request.
 */
const VARIANTS = [
  { key: "sign-in", label: "Agent sign-in" },
  { key: "step-1", label: "Sign-up · step 1" },
  { key: "step-3", label: "Sign-up · step 3 (wide, back)" },
  { key: "done", label: "Sign-up · all done" },
  { key: "partner", label: "Partner sign-in" },
  { key: "admin", label: "Staff sign-in · step 2" },
  { key: "alerts", label: "Alerts" },
] as const;

type Variant = (typeof VARIANTS)[number]["key"];

export function AuthShowcase() {
  const [variant, setVariant] = useState<Variant>("sign-in");

  const picker = (
    <div className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap justify-center gap-1 rounded-lg border border-border bg-card p-1 shadow-[var(--shadow-overlay)]" role="toolbar" aria-label="Auth layout variant">
      {VARIANTS.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={variant === item.key}
          onClick={() => setVariant(item.key)}
          className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground aria-pressed:bg-[var(--surface-alt)] aria-pressed:text-foreground"
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  const fields = (
    <form className="flex flex-col gap-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <AuthField label="Email" htmlFor="ds-auth-email">
        <AuthInput id="ds-auth-email" type="email" placeholder="avery@agency.com" />
      </AuthField>
      <AuthField label="Password" htmlFor="ds-auth-password" aside={<span className="text-sm font-semibold text-[var(--accent-ink)]">Forgot password?</span>}>
        <AuthInput id="ds-auth-password" type="password" />
      </AuthField>
      <AuthSubmit>Sign in</AuthSubmit>
      <AuthSecondary>Email me a sign-in link</AuthSecondary>
    </form>
  );

  const screens: Record<Variant, { plane: AuthPlane; node: React.ReactNode; story: React.ReactNode; width?: "wide"; steps?: Parameters<typeof AuthLayout>[0]["steps"]; back?: { href: string; label: string } }> = {
    "sign-in": { plane: "agent", story: <StoryPanel mode="sign-in" />, node: <><AuthHeading title="Welcome back">Sign in to your agency&rsquo;s workspace.</AuthHeading>{fields}</> },
    "step-1": {
      plane: "agent",
      story: <StoryPanel mode="sign-up" step={1} />,
      steps: { current: 1, total: FUNNEL_STEPS.length, label: FUNNEL_STEPS[0], labels: FUNNEL_STEPS, ariaLabel: "Sign-up progress" },
      node: <><AuthHeading title="Create your account">Already have an account? Sign in</AuthHeading>{fields}</>,
    },
    "step-3": {
      plane: "agent",
      width: "wide",
      story: <StoryPanel mode="sign-up" step={3} noPayment />,
      back: { href: "#", label: "Back to your agency" },
      steps: { current: 3, total: FUNNEL_STEPS.length, label: FUNNEL_STEPS[2], labels: FUNNEL_STEPS, ariaLabel: "Sign-up progress" },
      node: <><AuthHeading title="Tell us about your agency" /><div className="grid gap-4 sm:grid-cols-2"><AuthField label="Business name" htmlFor="ds-auth-biz"><AuthInput id="ds-auth-biz" /></AuthField><AuthField label="Primary state" htmlFor="ds-auth-state"><AuthInput id="ds-auth-state" /></AuthField></div><AuthSubmit className="mt-6">Continue</AuthSubmit></>,
    },
    done: {
      plane: "agent",
      story: <StoryPanel mode="sign-in" />,
      steps: { current: 6, total: FUNNEL_STEPS.length, labels: FUNNEL_STEPS, ariaLabel: "Sign-up progress" },
      node: <AuthHeading title="Here is your first number.">Every line of your statement was matched to a policy.</AuthHeading>,
    },
    partner: {
      plane: "partner",
      story: <AuthStory label="Partner portal" title="Submit, track and coordinate." rowsTitle="Your organisation only" rows={[{ label: "Leads your organisation submitted", state: "yes" }, { label: "Another partner’s leads or messages", state: "no" }]} />,
      node: <><AuthHeading title="Partner sign in">Submit leads and follow every one to its outcome.</AuthHeading>{fields}</>,
    },
    admin: {
      plane: "admin",
      story: <AuthStory label="Insurvas · Super admin" title="The platform, from the inside." rowsTitle="What happens when you sign in" rows={[{ label: "Sessions last 12 hours." }]} />,
      steps: { current: 2, total: 2, label: "Your code", labels: ["Your account", "Your code"], ariaLabel: "Sign-in steps" },
      node: <AuthHeading title="Enter your 6-digit code">From your authenticator app. You are signed in as soon as the sixth digit is in.</AuthHeading>,
    },
    alerts: {
      plane: "agent",
      story: <StoryPanel mode="sign-in" />,
      node: (
        <>
          <AuthHeading title="Alerts">One message box, three tones.</AuthHeading>
          <div className="flex flex-col gap-3">
            <AuthAlert>That email and password do not match an account.</AuthAlert>
            <AuthAlert tone="info" title="We could not confirm a payment yet">If you have already paid, do not pay again.</AuthAlert>
            <AuthAlert tone="success">A new link is on its way.</AuthAlert>
          </div>
        </>
      ),
    },
  };

  const screen = screens[variant];
  return (
    <>
      <AuthLayout plane={screen.plane} width={screen.width} steps={screen.steps} back={screen.back} story={screen.story}>
        {screen.node}
      </AuthLayout>
      {picker}
    </>
  );
}
