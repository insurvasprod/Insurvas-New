import React from "react";
import { useCurrentFrame } from "remotion";
import { Backdrop, Kicker, c, appear } from "./shared";

export const SuperAdminIntro: React.FC = () => {
  const frame = useCurrentFrame();
  return <Backdrop><div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center" }}><div style={{ ...appear(frame, 5), display: "flex", alignItems: "center", gap: 13 }}><div style={{ width: 58, height: 58, borderRadius: 16, background: c.blue, display: "grid", placeItems: "center", color: c.white, fontSize: 30, fontWeight: 900 }}>✓</div><div style={{ fontSize: 40, fontWeight: 800 }}>Insurvas Admin</div></div><div style={{ ...appear(frame, 22, 22), marginTop: 28 }}><Kicker>Super Admin control-plane walkthrough</Kicker></div><div style={{ ...appear(frame, 36, 25), marginTop: 19, fontSize: 53, lineHeight: 1.04, fontWeight: 800, letterSpacing: -1.5 }}>Operate the platform.<br />Protect every tenant.</div><div style={{ ...appear(frame, 58), marginTop: 23, color: "#b9dcf2", fontSize: 20 }}>Every service, setting, lifecycle action, and audit trail in one view.</div><div style={{ position: "absolute", bottom: 31, color: "#8ab8d6", fontSize: 11, letterSpacing: 1.5, opacity: frame > 65 ? 1 : 0 }}>COMPLETE DUTY OVERVIEW · SUPER ADMIN</div></div></Backdrop>;
};
