"use client";

// The three template panels (underwriting, quotation, field sets) read and write one route family,
// /api/app/settings/sales/templates. This is that client, once: loading, the lineage rows the boards
// list, and every write — each of which re-reads the list so what is on screen is what is stored.

import { useCallback, useEffect, useState } from "react";

import { notify } from "@/lib/notify";
import type { SalesTemplateKind } from "@/lib/salesSettings/templateSchemas";
import type { TemplateRowView, TemplatesPayload } from "@/lib/salesSettings/views";

import { notSaved, salesApi, useSalesSample } from "./shared";
import { sampleTemplates } from "./templates-sample";

export const lineageKey = (t: Pick<TemplateRowView, "tenantOwned" | "productCode" | "carrierId">) => `${t.tenantOwned ? "t" : "p"}|${t.productCode}|${t.carrierId ?? ""}`;

const newest = (list: TemplateRowView[]) => [...list].sort((a, b) => b.version - a.version)[0] ?? null;

/** The live (newest published) version of a template's lineage. */
export function liveOf(all: TemplateRowView[], t: TemplateRowView) {
  return newest(all.filter((x) => lineageKey(x) === lineageKey(t) && x.status === "published"));
}

/** The open draft of a template's lineage, if there is one. */
export function draftOf(all: TemplateRowView[], t: TemplateRowView) {
  return newest(all.filter((x) => lineageKey(x) === lineageKey(t) && x.status === "draft"));
}

/**
 * One row per thing the owner acts on: each template's live version and its open draft (both, when
 * a new version is being drafted), a retired-only template's last version, and each platform default.
 */
export function tableRows(all: TemplateRowView[]): TemplateRowView[] {
  const groups = new Map<string, TemplateRowView[]>();
  for (const t of all) groups.set(lineageKey(t), [...(groups.get(lineageKey(t)) ?? []), t]);
  const out: TemplateRowView[] = [];
  for (const list of groups.values()) {
    const live = newest(list.filter((t) => t.status === "published"));
    const draft = newest(list.filter((t) => t.status === "draft"));
    if (live) out.push(live);
    if (draft && list[0].tenantOwned) out.push(draft);
    if (!live && !draft) {
      const retired = newest(list);
      if (retired) out.push(retired);
    }
  }
  // The agency's own first, then platform defaults; by product line, then name, then version.
  return out.sort((a, b) => Number(b.tenantOwned) - Number(a.tenantOwned) || a.productCode.localeCompare(b.productCode)
    || (a.carrierName ?? "").localeCompare(b.carrierName ?? "") || a.name.localeCompare(b.name) || a.version - b.version);
}

type Created = { template: TemplateRowView };

/** What keeps pointing at a retired version, in the words of the panel that retired it. */
const RETIRED_KEEPS: Record<SalesTemplateKind, string> = {
  underwriting: "interviews already started keep it",
  quotation: "quotes already made keep it",
  application_field_set: "applications already started keep it",
};
type Saved = { template: TemplateRowView; created: boolean };

export function useSalesTemplates(kind: SalesTemplateKind) {
  const sample = useSalesSample();
  const [payload, setPayload] = useState<TemplatesPayload | null>(() => (sample ? sampleTemplates(kind) : null));
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<string | null>(null);
  const [schemaPending, setSchemaPending] = useState(false);

  const reload = useCallback(async () => {
    if (sample) return;
    setLoading(true);
    const res = await salesApi<TemplatesPayload>(`/api/app/settings/sales/templates?kind=${kind}`);
    if (res.ok) {
      setPayload(res.data);
      setError(null);
      setSchemaPending(false);
    } else {
      setSchemaPending(Boolean(res.schemaPending));
      setError(res.error);
    }
    setLoading(false);
  }, [kind, sample]);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(t);
  }, [reload, sample]);

  /** Sample mode: apply the change on screen only, and say it was not saved. */
  const local = (fn: (list: TemplateRowView[]) => TemplateRowView[]) => {
    setPayload((p) => (p ? { ...p, templates: fn(p.templates) } : p));
    notSaved();
  };

  async function write<T>(url: string, method: string, body: unknown, done: string): Promise<T | null> {
    const res = await salesApi<T>(url, { method, body });
    if (!res.ok) {
      notify.block(res.error);
      return null;
    }
    notify.done(done);
    await reload();
    return res.data;
  }

  const base = "/api/app/settings/sales/templates";
  return {
    sample,
    payload,
    loading,
    error,
    schemaPending,
    reload,
    async create(body: { product_code: string; carrier_id: string | null; name: string; definition: Record<string, unknown> }) {
      if (sample) {
        const t: TemplateRowView = { id: `sample-${Date.now()}`, tenantOwned: true, kind, productCode: body.product_code, productName: body.product_code, carrierId: body.carrier_id, carrierName: payload?.carriers.find((c) => c.id === body.carrier_id)?.name ?? null, name: body.name, version: 1, status: "draft", definition: body.definition, publishedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), editedBy: null };
        local((list) => [...list, t]);
        return t;
      }
      return (await write<Created>(base, "POST", { kind, ...body }, "Draft created"))?.template ?? null;
    },
    /** Returns the saved row and whether it is a new version; null when the save failed (the error is returned). */
    async save(id: string, body: { name?: string; definition: Record<string, unknown> }): Promise<{ saved: Saved | null; error: string | null }> {
      if (sample) {
        local((list) => list.map((t) => (t.id === id ? { ...t, ...body, name: body.name ?? t.name } : t)));
        const t = payload?.templates.find((x) => x.id === id);
        return { saved: t ? { template: { ...t, definition: body.definition, name: body.name ?? t.name }, created: false } : null, error: null };
      }
      const res = await salesApi<Saved>(`${base}/${id}`, { method: "PATCH", body });
      if (!res.ok) return { saved: null, error: res.error };
      notify.done(res.data.created ? `Saved as version ${res.data.template.version}, a draft` : "Draft saved", res.data.created ? { detail: "The live version is unchanged until you publish this one." } : undefined);
      await reload();
      return { saved: res.data, error: null };
    },
    async publish(id: string, retirePrevious: boolean) {
      if (sample) return local((list) => list.map((t) => (t.id === id ? { ...t, status: "published" } : t)));
      await write<Created>(`${base}/${id}/publish`, "POST", { retire_previous: retirePrevious }, "Published");
    },
    async retire(id: string) {
      if (sample) return local((list) => list.map((t) => (t.id === id ? { ...t, status: "retired" } : t)));
      await write<Created>(`${base}/${id}/retire`, "POST", undefined, `Retired — ${RETIRED_KEEPS[kind]}`);
    },
    async copy(id: string, body: { product_code?: string; carrier_id?: string | null; name?: string }, done = "Copied to your agency as a draft") {
      if (sample) {
        const src = payload?.templates.find((t) => t.id === id);
        if (src) local((list) => [...list, { ...src, id: `sample-${Date.now()}`, tenantOwned: true, status: "draft", version: 1, productCode: body.product_code ?? src.productCode, carrierId: body.carrier_id === undefined ? src.carrierId : body.carrier_id, carrierName: body.carrier_id === undefined ? src.carrierName : payload?.carriers.find((c) => c.id === body.carrier_id)?.name ?? null, name: body.name ?? src.name }]);
        return null;
      }
      return (await write<Created>(`${base}/${id}/copy`, "POST", body, done))?.template ?? null;
    },
  };
}
