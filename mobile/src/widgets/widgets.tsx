// The widget library reads these components as plain functions; the React Compiler must leave this file alone.
"use no memo";

import { FlexWidget, SvgWidget, TextWidget } from "react-native-android-widget";

import { ISOTYPE_ON_DARK } from "@/components/isotype";
import type { WidgetSnapshot } from "@/components/native/widget-snapshot";

import { compactDollars, shortMonth, theirTimeLine, updatedLabel } from "./data";

/**
 * Board L1 · the two Android home-screen widgets, drawn from the snapshot only. Loaded only where the widget module
 * exists (see available.ts): this file imports react-native-android-widget.
 *
 *   Today          next callback with both clocks, the person's goal, Start calling and today's callbacks
 *   Agency month   submitted premium this month against last (owners and admins only)
 *
 * The board draws both on the wallpaper in one fixed dark look whatever the phone's theme (L1: a translucent dark
 * card, 28 corners on Android, mint title, white figures), so these colours are the board's, not the app palette.
 */
type Hex = `#${string}`;
const R = "Inter_400Regular", M = "Inter_600SemiBold", B = "Inter_700Bold";

/** Board L1's widget colours (rgba(14,26,23,.92) card, .08 white edge, #c9d6d1 words at .7 / .75). */
export const WIDGET_LOOK = {
  card: "rgba(14, 26, 23, 0.92)",
  edge: "rgba(255, 255, 255, 0.08)",
  title: "#4fe3bb" as Hex,
  white: "#ffffff" as Hex,
  soft70: "rgba(201, 214, 209, 0.7)",
  soft75: "rgba(201, 214, 209, 0.75)",
  gold: "#f2b33d" as Hex,
  onGold: "#2a1c00" as Hex,
  quiet: "rgba(255, 255, 255, 0.1)",
  rise: "#f5c562" as Hex,
  radius: 28,
  pad: 14,
} as const;
const L = WIDGET_LOOK;

const PHONE_OUT = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8V2h-6M16 8l6-6"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;

function Head({ title, right, small }: { title: string; right?: string; small?: boolean }) {
  return (
    <FlexWidget style={{ flexDirection: "row", alignItems: "center", width: "match_parent" }}>
      <SvgWidget svg={ISOTYPE_ON_DARK} style={{ width: small ? 14 : 16, height: small ? 14 : 16, marginRight: 6 }} />
      <TextWidget text={title} style={{ fontFamily: M, fontSize: small ? 12.5 : 13, color: L.title }} />
      <FlexWidget style={{ flex: 1 }} />
      {right ? <TextWidget text={right} style={{ fontFamily: R, fontSize: 12, color: L.soft70 }} /> : null}
    </FlexWidget>
  );
}

function Card({ children, open }: { children: React.ReactNode; open?: string }) {
  return (
    <FlexWidget
      clickAction={open ? "OPEN_URI" : "OPEN_APP"} clickActionData={open ? { uri: open } : undefined}
      style={{ height: "match_parent", width: "match_parent", flexDirection: "column", backgroundColor: L.card, borderRadius: L.radius, borderWidth: 1, borderColor: L.edge, padding: L.pad }}>
      {children}
    </FlexWidget>
  );
}

function SignedOut({ title }: { title: string }) {
  return (
    <Card>
      <Head title={title} />
      <FlexWidget style={{ flex: 1 }} />
      <TextWidget text="Sign in to Insurvas" style={{ fontFamily: M, fontSize: 16, color: L.white }} />
      <TextWidget text="Your day shows here once you do." style={{ fontFamily: R, fontSize: 12.5, color: L.soft70, marginTop: 2 }} />
    </Card>
  );
}

function TodayBody({ s }: { s: WidgetSnapshot }) {
  const t = s.today;
  const due = t.dueToday;
  const their = t.next ? theirTimeLine(t.next) : null;
  return (
    <Card>
      <Head title="Today" right={`updated ${updatedLabel(s.updatedAt)}`} />
      <FlexWidget style={{ flexDirection: "row", alignItems: "flex-end", width: "match_parent", marginTop: 10 }}>
        <FlexWidget clickAction={t.next ? "OPEN_URI" : "OPEN_APP"} clickActionData={t.next ? { uri: t.next.link } : undefined} style={{ flex: 1, flexDirection: "column" }}>
          <TextWidget text={t.next ? "Next callback" : "Callbacks"} style={{ fontFamily: R, fontSize: 13, color: L.soft75 }} />
          <TextWidget text={t.next ? `${t.next.name} · ${t.next.yours}` : due ? `${due} to call back` : "None coming up"} maxLines={1} truncate="END" style={{ fontFamily: M, fontSize: 18, color: L.white }} />
          {their ? <TextWidget text={their} maxLines={1} truncate="END" style={{ fontFamily: R, fontSize: 12.5, color: L.soft70 }} /> : null}
        </FlexWidget>
        {t.goalPct !== null ? (
          <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: t.links.goal }} style={{ flexDirection: "column", alignItems: "flex-end" }}>
            <TextWidget text="Goal" style={{ fontFamily: R, fontSize: 13, color: L.soft75 }} />
            <TextWidget text={`${t.goalPct}%`} style={{ fontFamily: B, fontSize: 24, color: L.white }} />
          </FlexWidget>
        ) : null}
      </FlexWidget>
      <FlexWidget style={{ flex: 1 }} />
      <FlexWidget style={{ flexDirection: "row", width: "match_parent", flexGap: 8, marginTop: 12 }}>
        {t.canDial ? (
          <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: t.links.startCalling }}
            style={{ flex: 1, height: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: L.gold, borderRadius: 10 }}>
            <SvgWidget svg={PHONE_OUT(L.onGold)} style={{ width: 16, height: 16, marginRight: 6 }} />
            <TextWidget text="Start calling" style={{ fontFamily: B, fontSize: 14, color: L.onGold }} />
          </FlexWidget>
        ) : null}
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: t.links.callbacks }}
          style={{ flex: 1, height: 38, flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: L.quiet, borderRadius: 10 }}>
          <TextWidget text={due === 1 ? "1 callback" : `${due} callbacks`} style={{ fontFamily: M, fontSize: 14, color: L.white }} />
        </FlexWidget>
      </FlexWidget>
    </Card>
  );
}

function AgencyBody({ s }: { s: WidgetSnapshot }) {
  const a = s.agency;
  if (!a) {
    return (
      <Card>
        <Head title="Agency" small />
        <FlexWidget style={{ flex: 1 }} />
        <TextWidget text="The agency month shows for owners." style={{ fontFamily: R, fontSize: 12, color: L.soft75 }} />
      </Card>
    );
  }
  const up = a.changePct !== null && a.changePct >= 0;
  return (
    <Card open={a.link}>
      <Head title={`Agency · ${shortMonth(a.month)}`} small />
      <FlexWidget style={{ flex: 1 }} />
      <TextWidget text="Submitted" style={{ fontFamily: R, fontSize: 12, color: L.soft75 }} />
      <TextWidget text={compactDollars(a.submittedCents)} style={{ fontFamily: B, fontSize: 26, color: L.white }} />
      {a.changePct !== null ? (
        <TextWidget text={`${up ? "↑" : "↓"} ${Math.abs(a.changePct)}% vs ${shortMonth(a.month, 1)}`} style={{ fontFamily: R, fontSize: 12, color: up ? L.rise : L.soft75 }} />
      ) : null}
    </Card>
  );
}

export const WIDGET_NAMES = { today: "Today", agency: "AgencyMonth" } as const;

/** One fixed dark look in both launcher themes, as the board draws it. */
export function renderWidget(name: string, s: WidgetSnapshot | null) {
  const draw = () => {
    if (!s) return <SignedOut title={name === WIDGET_NAMES.agency ? "Agency" : "Today"} />;
    return name === WIDGET_NAMES.agency ? <AgencyBody s={s} /> : <TodayBody s={s} />;
  };
  return { light: draw(), dark: draw() };
}
