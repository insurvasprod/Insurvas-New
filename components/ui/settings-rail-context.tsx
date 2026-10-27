"use client";

import { createContext, useContext, type ReactNode } from "react";

export type SettingsRailSlots = {
  heading: HTMLElement | null;
  tabs: HTMLElement | null;
};

const SettingsRailContext = createContext<SettingsRailSlots | null>(null);

export function SettingsRailProvider({ slots, children }: { slots: SettingsRailSlots; children: ReactNode }) {
  return <SettingsRailContext.Provider value={slots}>{children}</SettingsRailContext.Provider>;
}

export function useSettingsRailSlots() {
  return useContext(SettingsRailContext);
}
