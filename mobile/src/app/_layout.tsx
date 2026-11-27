import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useColorScheme, View } from "react-native";
import { router, Stack, useGlobalSearchParams, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from "@expo-google-fonts/inter";
import { InterTight_500Medium, InterTight_600SemiBold, InterTight_700Bold } from "@expo-google-fonts/inter-tight";
import { GeistMono_500Medium } from "@expo-google-fonts/geist-mono";

import { BiometricOffer } from "@/components/getting-in/biometric-offer";
import { LaunchCover } from "@/components/motion/launch";
import { clearQuickActions } from "@/components/native/quick-actions";
import { hasSavedPartnerSession, partnerSessionReady, subscribePartnerReady } from "@/components/partner/session";
import { useWidgetSync } from "@/widgets/sync";
import { ScreenCover, SwitcherCover } from "@/components/states/privacy-cover";
import { UpdateNeeded } from "@/components/states/update-needed";
import { noteScreen } from "@/lib/last-screen";
import { SessionProvider, useSession } from "@/lib/session";
import { usePush } from "@/lib/push";
import { usePalette } from "@/theme/use-palette";

void SplashScreen.preventAutoHideAsync();

/** The first-sign-in steps that are their own screens (A7, A3); A4 is a dialog over Home. */
const SETUP_ROUTES = { workspace: "/pick-workspace", alerts: "/turn-on-alerts" } as const;

/** A route drawn as the board's bottom sheet: the screen below stays visible behind the dim. */
const SHEET = { presentation: "transparentModal", animation: "fade", contentStyle: { backgroundColor: "transparent" } } as const;

/**
 * Three doors, one at a time (expo-router Stack.Protected): Sign in, the lock (Face ID), and the app.
 * The guard is only what the phone shows; the server refuses every request a session can't make.
 * After the first sign-in on a phone, the setup steps (A7 → A3 → A4) come before Home, each once.
 */
/** Board M7 on iOS: every stack screen (modal and sheet screens included) carries the switcher cover. */
function screenLayout({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      {children}
      <ScreenCover />
    </View>
  );
}

/**
 * Whether the partner app is about to open (a partner sign-in saved, no agency session): the launch cover then
 * stays until the partner session has started too, so the agency Welcome never flashes first.
 */
function usePartnerGate(status: string): "checking" | "partner" | "none" {
  const [saved, setSaved] = useState<boolean | null>(null);
  useEffect(() => {
    if (status !== "signedOut") return;
    let live = true;
    void hasSavedPartnerSession().then((s) => { if (live) setSaved(s); }, () => { if (live) setSaved(false); });
    return () => { live = false; };
  }, [status]);
  if (status === "starting") return "checking";
  if (status !== "signedOut") return "none";
  if (saved === null) return "checking";
  return saved ? "partner" : "none";
}

function Navigator({ partner }: { partner: "checking" | "partner" | "none" }) {
  const { status, setup, updateNeeded } = useSession();
  const p = usePalette();
  usePush();
  // Board L1 / L3: the home-screen widgets follow the signed-in person; the icon menu empties on sign-out.
  useWidgetSync();
  useEffect(() => {
    if (status === "signedOut") clearQuickActions();
  }, [status]);
  // The native splash is handed over to the launch cover (components/motion/launch.tsx), which hides it.
  const reduced = useReducedMotion();
  // Help's "For this screen" (board J4) is about the last screen worked on.
  const pathname = usePathname();
  const { part } = useGlobalSearchParams<{ part?: string }>();
  useEffect(() => noteScreen(pathname, part), [pathname, part]);

  // Drive the setup steps: open the step's screen, and Home once the last screen step is done.
  const onStep = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "signedIn") { onStep.current = null; return; }
    const target = setup === "workspace" || setup === "alerts" ? SETUP_ROUTES[setup] : null;
    if (target && onStep.current !== target) { onStep.current = target; router.replace(target as never); }
    else if (!target && onStep.current) { onStep.current = null; router.replace("/" as never); }
  }, [status, setup]);

  // A partner signed in on this phone (and no agency session) opens the partner app.
  useEffect(() => {
    if (partner === "partner") router.replace("/partner" as never);
  }, [partner]);

  if (status === "starting") return <View style={{ flex: 1, backgroundColor: p.canvas }} />;
  const card = { contentStyle: { backgroundColor: p.canvas }, headerStyle: { backgroundColor: p.canvas }, headerTintColor: p.greenInk, headerTitleStyle: { fontFamily: "Inter_600SemiBold", color: p.ink }, headerShadowVisible: false };
  return (
    <>
      {/* Board index.html 168: pushes use the platform's own transition; reduced motion turns them into fades. */}
      <Stack screenLayout={screenLayout} screenOptions={{ headerShown: false, ...card, animation: reduced ? "fade" : "default" }}>
        <Stack.Protected guard={status === "signedIn"}>
          <Stack.Screen name="(tabs)" />
          {/* Every screen draws the kit's own Header (board-exact), so the stack never shows one. */}
          <Stack.Screen name="lead/[id]" />
          <Stack.Screen name="lead/same-person/[id]" />
          <Stack.Screen name="search" options={{ presentation: "modal" }} />
          <Stack.Screen name="settings" />
          <Stack.Screen name="devices" />
          <Stack.Screen name="two-step" />
          {/* Board C3 · C4 · C6 (one call screen, ?phase=) and C1c. */}
          <Stack.Screen name="call/[workItemId]" options={{ gestureEnabled: false }} />
          <Stack.Screen name="call/team" />
          {/* Board C13 · C13b. */}
          <Stack.Screen name="calendar" />
          <Stack.Screen name="calls-page" />
          <Stack.Screen name="leads-page" />
          <Stack.Screen name="appointment/[id]" />
          {/* Board J5 · J2: sheets over the screen they were opened from (RouteSheet draws the dim and the sheet). */}
          <Stack.Screen name="workspaces" options={SHEET} />
          <Stack.Screen name="computer" options={SHEET} />
          {/* Board A7 / A3: first sign-in steps (opened by the effect above, never from a menu). */}
          <Stack.Screen name="pick-workspace" options={{ gestureEnabled: false }} />
          <Stack.Screen name="turn-on-alerts" options={{ gestureEnabled: false }} />
          {/* Board H4 · J3b (J4 Help lives in the Menu tab's own stack). */}
          <Stack.Screen name="notifications" />
          <Stack.Screen name="profile" />
          {/* Release 2 · board E0 · E1b · E1–E4 (one screen per step, ?step=). */}
          <Stack.Screen name="application/index" />
          <Stack.Screen name="application/start" />
          <Stack.Screen name="application/[caseId]" />
          {/* Release 2 · board E5 · E6 · E6b · E7. */}
          <Stack.Screen name="cases/index" />
          <Stack.Screen name="cases/[caseId]/index" />
          <Stack.Screen name="cases/[caseId]/scan" />
          <Stack.Screen name="deal-flow" />
          <Stack.Screen name="quote" />
          {/* Release 2 · board F3 · F3b · F3c · F4 (its own stack). */}
          <Stack.Screen name="retention" />
          {/* Release 3 · board I2–I8: producer and partner records, reports, compliance (each its own stack). */}
          <Stack.Screen name="team" />
          <Stack.Screen name="reports" />
          <Stack.Screen name="compliance" />
          {/* Release 3 · board H3: a partner chat thread. */}
          <Stack.Screen name="chat/[threadId]" />
          <Stack.Screen name="chat/new" />
          {/* Release 3 · board G1–G8 Money (each screen hides its own header). */}
          <Stack.Screen name="money/index" />
          <Stack.Screen name="money/payouts" />
          <Stack.Screen name="money/pay" />
          <Stack.Screen name="money/statement/[id]" />
          <Stack.Screen name="money/bills/[id]" />
          <Stack.Screen name="money/deposits/[id]" />
          <Stack.Screen name="money/pnl" />
          <Stack.Screen name="money/expense" options={{ presentation: "modal" }} />
          <Stack.Screen name="money/balance" />
          <Stack.Screen name="money/pay-issues" />
          {/* Release 3 · board B9 Get set up · D10 Vendor. */}
          <Stack.Screen name="setup/index" />
          <Stack.Screen name="vendor/index" />
          <Stack.Screen name="vendor/[id]" />
          {/* Release 2 · board F1 · F2 · F2b · F6. */}
          <Stack.Screen name="book/index" />
          <Stack.Screen name="book/sync" />
          <Stack.Screen name="book/[carrierId]/[policyNumber]/index" />
          <Stack.Screen name="book/[carrierId]/[policyNumber]/ledger" />
        </Stack.Protected>
        <Stack.Protected guard={status === "locked"}>
          <Stack.Screen name="locked" />
        </Stack.Protected>
        <Stack.Protected guard={status === "signedOut"}>
          {/* Board A0: first open on this phone; it hands straight on to Sign in afterwards. */}
          <Stack.Screen name="welcome" />
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="two-factor" />
          <Stack.Screen name="check-email" />
        </Stack.Protected>
        {/*
          Development only (redirects to Sign in in a release build): tokens minted for a test account. Outside the
          doors so a signed-in phone can switch to another test account; inside the signed-out door the link fell back
          to Home and the new tokens were never adopted (2026-11-26 role walk).
        */}
        <Stack.Screen name="dev-sign-in" />
        {/*
          Board L5: the spoken answer card (Google App Actions / insurvas://next-callback?ask=1), outside the doors so a
          locked phone shows "Unlock Insurvas to hear it" and, once unlocked, the answer on the same card. It reads
          nothing until the session is signed in (components/native/voice-answer.tsx).
        */}
        <Stack.Screen name="ask" options={{ animation: "fade" }} />
        {/* Board A5: an invite link opens whatever the phone's state (an existing account may be signed in). */}
        <Stack.Screen name="accept-invite" />
        {/* Release 3 · board K: the partner app has its own session and doors (app/partner/_layout). */}
        <Stack.Screen name="partner" />
      </Stack>
      {status === "signedIn" ? <BiometricOffer /> : null}
      {/*
        Board M6: a paused or suspended agency no longer covers the app. The tabs stay, the bar says "Read only",
        write buttons are disabled, and each screen shows the reason where its read is refused (ui.tsx Failed).
      */}
      {/* Board M8: the server refused this version of the app (the agency's requests or the partner's). */}
      {updateNeeded ? <UpdateNeeded /> : null}
    </>
  );
}

/**
 * The launch cover over everything until the session has started (owner 2026-11-26) — and, when the partner app
 * opens instead, until the partner session has started as well.
 */
function Shell() {
  const { status } = useSession();
  const partner = usePartnerGate(status);
  const partnerReady = useSyncExternalStore(subscribePartnerReady, partnerSessionReady, partnerSessionReady);
  const ready = partner === "none" || (partner === "partner" && partnerReady);
  return (
    <>
      <Navigator partner={partner} />
      <LaunchCover ready={ready} />
    </>
  );
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const [fontsReady] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, InterTight_500Medium, InterTight_600SemiBold, InterTight_700Bold, GeistMono_500Medium });
  if (!fontsReady) return null;
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style={scheme === "light" ? "dark" : "light"} />
        <Shell />
        {/* Board M7: the app switcher's snapshot never shows client data. Over everything, the launch cover included. */}
        <SwitcherCover />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
