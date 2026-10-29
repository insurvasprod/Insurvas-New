"use client";

import { createPortal } from "react-dom";

import { useSettingsRailSlots } from "@/components/ui/settings-rail-context";
import { ViewTabs, type ViewTab } from "@/components/ui/view-tabs";
import type { ReactNode } from "react";

/** A settings page's primary views, placed in the shared left rail when that frame is present. */
export function SettingsRailTabs<K extends string>(props: {
  label: string;
  tabs: ReadonlyArray<ViewTab<K>>;
  value: K;
  onChange?: (key: K) => void;
  actions?: ReactNode;
  idPrefix?: string;
  controls?: string;
}) {
  const rail = useSettingsRailSlots();
  if (!rail?.tabs) return <ViewTabs {...props} />;
  const { actions, ...tabs } = props;

  return (
    <>
      {createPortal(
        <ViewTabs {...tabs} vertical />,
        rail.tabs,
      )}
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </>
  );
}
