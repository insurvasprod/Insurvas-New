import React from "react";
import { AbsoluteFill, Easing, interpolate, spring } from "remotion";

export const c = { navy: "#061c34", navy2: "#0b2d50", blue: "#0070cc", sky: "#86d8ff", white: "#fff", ink: "#122236", muted: "#62768b", line: "#dce6ef", pale: "#f4f9fd", green: "#16865b", greenSoft: "#e7f7ef", orange: "#e8892d", orangeSoft: "#fff1df", red: "#c74747", redSoft: "#fff0f0", purple: "#7656c6", purpleSoft: "#f1edff" };

export const nav = ["Dashboard", "Tenants", "Users", "Login activity", "Plans", "Add-ons", "Subscriptions", "Invoices", "Refunds & credits", "Revenue", "Coupons", "Features", "Admin users", "Configuration Center", "Audit log"];

export function appear(frame: number, start = 0, distance = 18): React.CSSProperties {
  return { opacity: interpolate(frame, [start, start + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0px ${interpolate(frame, [start, start + 16], [distance, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px` };
}

export function bounce(frame: number, start = 0): React.CSSProperties {
  return { opacity: interpolate(frame, [start, start + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), scale: spring({ frame: Math.max(0, frame - start), fps: 30, config: { damping: 15, stiffness: 125 } }) };
}

export const Backdrop: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light = false }) => (
  <AbsoluteFill style={{ background: light ? "linear-gradient(135deg,#f6fbff 0%,#e7f3ff 60%,#d5eaff 100%)" : "linear-gradient(135deg,#061c34 0%,#0b2d50 55%,#0f6095 100%)", color: light ? c.ink : c.white, fontFamily: "Arial, Helvetica, sans-serif", overflow: "hidden" }}>
    <div style={{ position: "absolute", width: 690, height: 690, borderRadius: "50%", right: -230, top: -270, background: light ? "rgba(0,112,204,.08)" : "rgba(114,205,255,.12)" }} />
    <div style={{ position: "absolute", width: 480, height: 480, borderRadius: "50%", left: -280, bottom: -290, background: light ? "rgba(0,112,204,.06)" : "rgba(0,112,204,.15)" }} />
    {children}
  </AbsoluteFill>
);

export const Progress: React.FC<{ step: number; total?: number }> = ({ step, total = 9 }) => <div style={{ position: "absolute", top: 30, left: 66, right: 66, display: "flex", gap: 7, zIndex: 20 }}>{Array.from({ length: total }).map((_, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i < step ? "#73c8ff" : "rgba(255,255,255,.23)" }} />)}</div>;

export const Kicker: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light = false }) => <div style={{ color: light ? c.blue : c.sky, fontSize: 15, fontWeight: 800, letterSpacing: 2.3, textTransform: "uppercase" }}>{children}</div>;

export const Heading: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light = false }) => <div style={{ marginTop: 10, color: light ? c.navy : c.white, fontSize: 34, lineHeight: 1.08, fontWeight: 800, letterSpacing: -.8 }}>{children}</div>;

export const AdminBrowser: React.FC<{ active: string; children: React.ReactNode; light?: boolean }> = ({ active, children, light = false }) => (
  <div style={{ width: 930, borderRadius: 19, overflow: "hidden", background: c.white, boxShadow: "0 28px 65px rgba(0,16,36,.28)", border: "1px solid rgba(255,255,255,.65)" }}>
    <div style={{ height: 37, background: "#edf2f6", display: "flex", alignItems: "center", padding: "0 15px", gap: 7 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff6b61" }} /><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f8c548" }} /><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#35c978" }} /><div style={{ marginLeft: 17, flex: 1, height: 21, borderRadius: 7, background: c.white, color: c.muted, fontSize: 11, display: "flex", alignItems: "center", paddingLeft: 11 }}>admin.insurvas.com/admin/{active.toLowerCase().replace(/ /g, "-")}</div></div>
    <div style={{ display: "flex", minHeight: 486, background: light ? "#fbfdff" : c.white }}>
      <aside style={{ width: 186, background: "linear-gradient(160deg,#005ba8,#003162 72%,#001f3f)", padding: "22px 14px", color: c.white, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 7px 24px", fontSize: 16, fontWeight: 800 }}><span style={{ width: 24, height: 24, borderRadius: 7, background: "#70c9ff", color: c.navy, display: "grid", placeItems: "center", fontWeight: 900 }}>✓</span> Insurvas Admin</div>
        {nav.map((item) => <div key={item} style={{ padding: "6px 8px", marginBottom: 2, borderRadius: 6, background: item === active ? "rgba(133,215,255,.19)" : "transparent", color: item === active ? "#9dddff" : "#b6c8d7", fontSize: 9.5, fontWeight: item === active ? 800 : 500 }}>{item}</div>)}
        <div style={{ margin: "20px 7px 0", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.14)", color: "#8fa7bb", fontSize: 9 }}>Amara Davis</div><div style={{ margin: "4px 7px", color: "#72c9ff", fontSize: 9, fontWeight: 700 }}>SUPER ADMIN</div>
      </aside>
      <main style={{ flex: 1, padding: "25px 27px", background: light ? "#fbfdff" : c.white, position: "relative" }}>{children}</main>
    </div>
  </div>
);

export const Panel: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => <div style={{ padding: 15, border: `1px solid ${c.line}`, borderRadius: 10, background: c.white, ...style }}>{children}</div>;
export const Label: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = c.muted }) => <div style={{ color, fontSize: 10, fontWeight: 800, letterSpacing: .6, textTransform: "uppercase" }}>{children}</div>;
export const Tiny: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = c.muted }) => <div style={{ color, fontSize: 11 }}>{children}</div>;
export const Badge: React.FC<{ children: React.ReactNode; tone?: "blue" | "green" | "orange" | "red" | "purple" }> = ({ children, tone = "blue" }) => { const tones = { blue: ["#e7f3ff", c.blue], green: [c.greenSoft, c.green], orange: [c.orangeSoft, c.orange], red: [c.redSoft, c.red], purple: [c.purpleSoft, c.purple] } as const; const [bg, color] = tones[tone]; return <span style={{ padding: "4px 8px", borderRadius: 99, background: bg, color, fontSize: 9, fontWeight: 800, letterSpacing: .5, textTransform: "uppercase" }}>{children}</span>; };
export const Metric: React.FC<{ label: string; value: string; change?: string; tone?: string }> = ({ label, value, change, tone = c.blue }) => <Panel><Tiny>{label}</Tiny><div style={{ marginTop: 7, fontSize: 25, fontWeight: 800, color: c.navy }}>{value}</div>{change && <div style={{ marginTop: 5, color: tone, fontSize: 10, fontWeight: 800 }}>{change}</div>}</Panel>;
export const Callout: React.FC<{ title: string; body: string; top?: number; right?: number; left?: number }> = ({ title, body, top = 175, right = 54, left }) => <div style={{ position: "absolute", top, ...(left === undefined ? { right } : { left }), width: 225, padding: "15px 17px", borderRadius: 13, background: "rgba(4,22,42,.9)", color: c.white, boxShadow: "0 15px 32px rgba(0,0,0,.18)", zIndex: 10 }}><div style={{ color: c.sky, fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1 }}>{title}</div><div style={{ marginTop: 6, fontSize: 15, lineHeight: 1.34 }}>{body}</div></div>;
export const Footer: React.FC = () => <div style={{ position: "absolute", right: 66, bottom: 26, color: "rgba(255,255,255,.58)", fontSize: 10, letterSpacing: 1.2 }}>INSURVAS · SUPER ADMIN CONTROL PLANE</div>;
export const FooterLight: React.FC = () => <div style={{ position: "absolute", right: 66, bottom: 26, color: c.muted, fontSize: 10, letterSpacing: 1.2 }}>INSURVAS · SUPER ADMIN CONTROL PLANE</div>;
