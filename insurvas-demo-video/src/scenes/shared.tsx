import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const colors = { ink: "#0b1726", navy: "#061c34", blue: "#0070cc", sky: "#e8f4ff", text: "#172536", muted: "#607184", line: "#dce6ef", green: "#16865b", greenSoft: "#e6f7ef", orange: "#e8892d", white: "#ffffff" };

export function enter(frame: number, start = 0, distance = 18): React.CSSProperties {
  return { opacity: interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), translate: `0px ${interpolate(frame, [start, start + 18], [distance, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })}px` };
}

export function pop(frame: number, start = 0): React.CSSProperties {
  return { scale: spring({ frame: Math.max(0, frame - start), fps: 30, config: { damping: 16, stiffness: 130 } }), opacity: interpolate(frame, [start, start + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) };
}

export const Background: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light = false }) => (
  <AbsoluteFill style={{ background: light ? "linear-gradient(135deg, #f7fbff 0%, #eef7ff 55%, #dceeff 100%)" : "linear-gradient(135deg, #061c34 0%, #0b2d50 58%, #0f5c8f 100%)", color: light ? colors.text : colors.white, fontFamily: "Arial, Helvetica, sans-serif", overflow: "hidden" }}>
    <div style={{ position: "absolute", width: 680, height: 680, borderRadius: "50%", right: -220, top: -250, background: light ? "rgba(0,112,204,.08)" : "rgba(95,194,255,.12)" }} />
    <div style={{ position: "absolute", width: 460, height: 460, borderRadius: "50%", left: -250, bottom: -260, background: light ? "rgba(0,112,204,.06)" : "rgba(0,112,204,.16)" }} />
    {children}
  </AbsoluteFill>
);

export const Eyebrow: React.FC<{ children: React.ReactNode; light?: boolean }> = ({ children, light = false }) => <div style={{ color: light ? colors.blue : "#8cd4ff", fontSize: 16, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase" }}>{children}</div>;

export const Progress: React.FC<{ step: number }> = ({ step }) => <div style={{ position: "absolute", top: 32, left: 66, right: 66, display: "flex", alignItems: "center", gap: 8, zIndex: 10 }}>{Array.from({ length: 5 }).map((_, index) => <div key={index} style={{ height: 4, flex: 1, borderRadius: 99, background: index < step ? "#73c8ff" : "rgba(255,255,255,.22)" }} />)}</div>;

export const BrowserFrame: React.FC<{ children: React.ReactNode; label: string; light?: boolean }> = ({ children, label, light = false }) => <div style={{ width: 890, borderRadius: 20, overflow: "hidden", background: colors.white, boxShadow: "0 28px 70px rgba(0,17,38,.28)", border: "1px solid rgba(255,255,255,.55)" }}><div style={{ height: 38, background: "#edf2f6", display: "flex", alignItems: "center", padding: "0 16px", gap: 7 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff6b61" }} /><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f8c548" }} /><span style={{ width: 10, height: 10, borderRadius: "50%", background: "#35c978" }} /><div style={{ marginLeft: 18, flex: 1, height: 22, borderRadius: 7, background: "#fff", color: colors.muted, fontSize: 12, display: "flex", alignItems: "center", paddingLeft: 12 }}>app.insurvas.com/{label}</div></div><div style={{ position: "relative", minHeight: 470, background: light ? "#fbfdff" : colors.white }}>{children}</div></div>;

export const Callout: React.FC<{ title: string; body: string; top?: number; right?: number }> = ({ title, body, top = 190, right = 56 }) => <div style={{ position: "absolute", top, right, width: 230, padding: "17px 18px", borderRadius: 14, background: "rgba(4,22,42,.88)", color: colors.white, boxShadow: "0 15px 32px rgba(0,0,0,.16)", zIndex: 5 }}><div style={{ color: "#83d0ff", fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: 1.2 }}>{title}</div><div style={{ marginTop: 7, fontSize: 16, lineHeight: 1.35 }}>{body}</div></div>;

export const Check: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: colors.text }}><span style={{ width: 21, height: 21, borderRadius: "50%", display: "grid", placeItems: "center", background: colors.greenSoft, color: colors.green, fontWeight: 900 }}>✓</span>{children}</div>;

export const useScene = () => { const frame = useCurrentFrame(); const { fps } = useVideoConfig(); return { frame, fps }; };
