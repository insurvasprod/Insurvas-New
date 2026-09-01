import React from "react";
import { useCurrentFrame } from "remotion";
import { Backdrop, Kicker, c, appear, bounce } from "./shared";

const duties = ["Keep tenant access healthy", "Manage users and platform roles", "Own plans, features, and entitlements", "Keep billing and revenue accurate", "Configure compliance and system services", "Preserve security, maintenance, and audit evidence"];

export const SuperAdminOutro: React.FC = () => {
  const frame = useCurrentFrame();
  return <Backdrop><div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}><div style={{ ...appear(frame, 5) }}><Kicker>The Super Admin promise</Kicker></div><div style={{ ...appear(frame, 16, 22), marginTop: 18, fontSize: 44, fontWeight: 800, textAlign: "center", lineHeight: 1.08 }}>One control plane.<br />Every duty accounted for.</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 38px", marginTop: 27 }}>{duties.map((duty, i) => <div key={duty} style={{ ...appear(frame, 32 + i * 5), display: "flex", alignItems: "center", gap: 9, color: "#e5f3fb", fontSize: 15 }}><span style={{ width: 21, height: 21, borderRadius: "50%", background: "#e7f7ef", color: c.green, display: "grid", placeItems: "center", fontWeight: 900 }}>✓</span>{duty}</div>)}</div><div style={{ ...bounce(frame, 71), marginTop: 30, padding: "12px 23px", borderRadius: 8, background: c.blue, color: c.white, fontSize: 14, fontWeight: 800 }}>Ready for the Super Admin walkthrough →</div></div><div style={{ position: "absolute", bottom: 29, width: "100%", textAlign: "center", color: "#8ab8d6", fontSize: 10, letterSpacing: 1.4 }}>INSURVAS · COMPLETE SUPER ADMIN DUTY OVERVIEW</div></Backdrop>;
};
