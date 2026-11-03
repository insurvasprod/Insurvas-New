"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * The shell's always-on alerts (an overdue complaint, a payment problem), handed down once by the
 * layout and drawn by `PageHeader` on the title's line (owner 2026-11-02). A page without a header
 * still gets them: once mounted, if no header has taken them, they sit above the page.
 */
type Alerts = { alerts: ReactNode; claim: () => () => void };
const AlertsContext = createContext<Alerts | null>(null);

export function PageAlertsProvider({ alerts, children }: { alerts: ReactNode; children: ReactNode }) {
  const [headers, setHeaders] = useState(0);
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the fallback waits for the first client render
  useEffect(() => setMounted(true), []);
  const claim = useCallback(() => {
    setHeaders((n) => n + 1);
    return () => setHeaders((n) => n - 1);
  }, []);
  const value = useMemo(() => ({ alerts, claim }), [alerts, claim]);
  return (
    <AlertsContext.Provider value={value}>
      {/* The alerts raise bell notices and draw nothing (page-alert.tsx), so their slot takes no room. */}
      {mounted && headers === 0 && alerts ? <div className="contents">{alerts}</div> : null}
      {children}
    </AlertsContext.Provider>
  );
}

/** Where `PageHeader` draws the shell's alerts: beside the title. Nothing outside the agent shell. */
export function PageAlertSlot() {
  const context = useContext(AlertsContext);
  const claim = context?.claim;
  useEffect(() => (claim ? claim() : undefined), [claim]);
  if (!context?.alerts) return null;
  return <div className="contents">{context.alerts}</div>;
}
