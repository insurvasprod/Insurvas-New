import { useSyncExternalStore } from "react";

import { readSecret, writeSecret } from "./secure";

/**
 * Board J3, settled decision 7: an owner gets the owner tabs (Team, Money) by default, and an owner who
 * also sells can switch to the producer tabs (Calls, Leads) in Settings. The choice belongs to this
 * phone; the tab bar re-draws the moment it changes.
 */
const KEY = "insurvas.producerTabs";
let value = false;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function load() {
  if (loaded) return;
  loaded = true;
  void readSecret(KEY).then((v) => {
    if (v === "1" && !value) { value = true; emit(); }
  }, () => undefined);
}

export function setProducerTabs(on: boolean): void {
  value = on;
  emit();
  void writeSecret(KEY, on ? "1" : null).catch(() => undefined);
}

export function useProducerTabs(): boolean {
  load();
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => value,
    () => value,
  );
}
