import Link from "next/link";

import { DocsMenuStreamed, DocsSearchStreamed } from "@/components/app/docs/docs-streamed";
import { DocsFrame } from "@/components/app/docs/docs-shell";
import { SettingsDirectory } from "@/components/app/docs/settings-directory";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { loadDocsState } from "@/lib/docs/state";

/** Docs › Settings (owner 2026-11-17): every Settings page, by group, each opening its own page of every setting. */
export default function SettingsDocsIndex() {
  // Frame first: the directory is fixed text; only the menu's ticks and the search's own steps wait on the read.
  const state = loadDocsState();
  return (
    <div className="flex min-h-0 w-full flex-grow flex-col gap-4">
      <PageHeader
        title="Settings"
        breadcrumbs={[{ label: "Docs", href: "/app/docs" }, { label: "Settings" }]}
        description="Every Settings page and every setting on it: what it does, its default and who may change it."
        className="relative"
        lead={<div className="w-full lg:absolute lg:bottom-0 lg:left-1/2 lg:w-[560px] lg:-translate-x-1/2"><DocsSearchStreamed state={state} /></div>}
        actions={<Link href="/app/settings" className={buttonVariants({ variant: "highlight" })}>Open Settings ›</Link>}
      />
      <DocsFrame menu={<DocsMenuStreamed state={state} activeSettings="" />}>
        <SettingsDirectory />
      </DocsFrame>
    </div>
  );
}
