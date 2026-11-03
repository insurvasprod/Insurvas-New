"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { control, Field, st, type PillTone, pillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/table-card";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_TYPE_LABELS,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementType,
} from "@/lib/system/constants";
import {
  announcementState,
  announcementWindow,
  fromUtcInput,
  toUtcInput,
  utcDateTime,
  type AnnouncementState,
} from "@/lib/system/adminFormat";


const STATE_PILL: Record<AnnouncementState, { tone: PillTone; label: string }> = {
  live: { tone: "success", label: "Live" },
  scheduled: { tone: "info", label: "Scheduled" },
  expired: { tone: "neutral", label: "Expired" },
};

type Draft = {
  message: string;
  type: AnnouncementType;
  audience: AnnouncementAudience;
  startsAt: string;
  endsAt: string;
  isDismissible: boolean;
};

function emptyDraft(): Draft {
  const start = new Date();
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    message: "",
    type: "info",
    audience: "all",
    startsAt: toUtcInput(start.toISOString()),
    endsAt: toUtcInput(end.toISOString()),
    isDismissible: true,
  };
}

function draftFrom(item: Announcement): Draft {
  return {
    message: item.message,
    type: item.type,
    audience: item.audience,
    startsAt: toUtcInput(item.starts_at),
    endsAt: toUtcInput(item.ends_at),
    isDismissible: item.is_dismissible,
  };
}

function payload(draft: Draft) {
  return {
    message: draft.message,
    type: draft.type,
    audience: draft.audience,
    starts_at: fromUtcInput(draft.startsAt),
    ends_at: fromUtcInput(draft.endsAt),
    is_dismissible: draft.isDismissible,
  };
}

/** The window in UTC, printed identically on server and client; the reader's local times join the hover after mount. */
function WindowCell({ start, end }: { start: string; end: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const utc = `${utcDateTime(start)} – ${utcDateTime(end)}`;
  useEffect(() => {
    const local = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    if (ref.current) ref.current.title = `${utc}\n${local(start)} – ${local(end)} your time`;
  }, [start, end, utc]);
  return (
    <span ref={ref} title={utc} className="whitespace-nowrap tabular-nums">
      {announcementWindow(start, end)}
    </span>
  );
}

export function SystemAnnouncements({
  initialAnnouncements,
  loadError,
  nowIso,
}: {
  initialAnnouncements: Announcement[];
  loadError: string | null;
  nowIso: string;
}) {
  const [items, setItems] = useState(initialAnnouncements);
  // The server's clock for the first render (so states match on hydration), the browser's after a change.
  const [nowMs, setNowMs] = useState(() => Date.parse(nowIso));
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const pageSize = useFittingPageSize(420, 45);
  const { current, rows: visible } = paginate(items, page, pageSize);

  function openNew() {
    setDraft(emptyDraft());
    setFormError(null);
    setEditing({ id: null });
  }

  function openEdit(item: Announcement) {
    setDraft(draftFrom(item));
    setFormError(null);
    setEditing({ id: item.id });
  }

  function replaceSorted(next: Announcement[]) {
    // The same order the server lists them in: newest start first.
    setItems([...next].sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at)));
    setNowMs(Date.now());
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    if (!draft.message.trim()) return setFormError("Enter an announcement message.");
    const body = payload(draft);
    if (!body.starts_at || !body.ends_at) return setFormError("Choose a start and end time.");
    if (Date.parse(body.ends_at) <= Date.parse(body.starts_at)) return setFormError("End must be after start.");

    setSaving(true);
    setFormError(null);
    const id = editing.id;
    const response = await fetch(id ? `/api/admin/system/announcements/${id}` : "/api/admin/system/announcements", {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const result = await response?.json().catch(() => null);
    setSaving(false);
    if (!response?.ok || !result?.announcement) {
      return setFormError(result?.error ?? "Could not reach the server. Nothing was saved.");
    }
    replaceSorted(id ? items.map((item) => (item.id === id ? result.announcement : item)) : [result.announcement, ...items]);
    if (!id) setPage(1);
    setEditing(null);
    notify.done(id ? "Announcement updated" : "Announcement created");
  }

  /** Stops a live announcement now but keeps the record — the undoable alternative to deleting. */
  async function endNow(item: Announcement) {
    setRowBusy(item.id);
    const end = new Date();
    const response = await fetch(`/api/admin/system/announcements/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(draftFrom(item)), ends_at: end.toISOString() }),
    }).catch(() => null);
    const result = await response?.json().catch(() => null);
    setRowBusy(null);
    if (!response?.ok || !result?.announcement) return notify.block(result?.error ?? "Could not end the announcement");
    replaceSorted(items.map((row) => (row.id === item.id ? result.announcement : row)));
    notify.done("Announcement ended");
  }

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setRowBusy(target.id);
    const response = await fetch(`/api/admin/system/announcements/${target.id}`, { method: "DELETE" }).catch(() => null);
    const result = await response?.json().catch(() => null);
    setRowBusy(null);
    setDeleting(null);
    if (!response?.ok) return notify.block(result?.error ?? "Could not delete the announcement");
    replaceSorted(items.filter((item) => item.id !== target.id));
    notify.done("Announcement deleted");
  }

  return (
    <>
      <TableCard
        title="Announcements"
        footer={!loadError && items.length ? <Pager page={current} pageSize={pageSize} total={items.length} noun={items.length === 1 ? "announcement" : "announcements"} suffix="newest start first" onPage={setPage} /> : undefined}
        action={
          <Button type="button" variant="outline" onClick={openNew}>
            New announcement
          </Button>
        }
      >
        <table className={cn(st.table, "min-w-[900px]")}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Message</th>
              <th scope="col" className={cn(st.th, "w-[190px]")}>Audience</th>
              <th scope="col" className={cn(st.th, "w-[220px]")}>Window</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}>State</th>
              <th scope="col" className={cn(st.th, "w-[200px]")}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loadError ? (
              <tr>
                <td colSpan={5} className={cn(st.td, "px-4 py-10 text-center")}>
                  <p className="m-0 font-semibold text-[var(--error-ink)]">Announcements could not be loaded</p>
                  <p className="m-0 mt-1 text-[var(--muted)]">{loadError}. Reload the page to try again.</p>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className={cn(st.td, "px-4 py-10 text-center")}>
                  <p className="m-0 font-semibold text-[var(--ink)]">No announcements yet</p>
                  <p className="m-0 mt-1 text-[var(--muted)]">Announcements for planned downtime and policy changes appear here.</p>
                </td>
              </tr>
            ) : (
              visible.map((item) => {
                const state = announcementState(item, nowMs);
                const pill = STATE_PILL[state];
                const busy = rowBusy === item.id;
                return (
                  <tr key={item.id}>
                    <td className={cn(st.td, "max-w-[360px]")}>
                      <span className="block break-words">{item.message}</span>
                      <span className={st.sub}>
                        {ANNOUNCEMENT_TYPE_LABELS[item.type]} · {item.is_dismissible ? "can be dismissed" : "cannot be dismissed"}
                      </span>
                    </td>
                    <td className={st.td}>{ANNOUNCEMENT_AUDIENCE_LABELS[item.audience] ?? item.audience}</td>
                    <td className={st.td}>
                      <WindowCell start={item.starts_at} end={item.ends_at} />
                    </td>
                    <td className={st.td}>
                      <StatusChip tone={pillTone(pill.tone)} dot>
                        {pill.label}
                      </StatusChip>
                    </td>
                    <td className={cn(st.td, "text-right whitespace-nowrap")}>
                      <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(item)} disabled={busy}>
                        Edit
                      </Button>
                      {state === "live" && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => void endNow(item)} disabled={busy}>
                          End now
                        </Button>
                      )}
                      <Button type="button" variant="ghost" size="sm" className="text-[var(--error-ink)] hover:bg-[var(--error-surface)] hover:text-[var(--error-ink)]" onClick={() => setDeleting(item)} disabled={busy}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </TableCard>

      {/* New / edit */}
      <Dialog open={editing !== null} onOpenChange={(next) => !saving && !next && setEditing(null)}>
        <DialogContent className="sm:max-w-[620px]">
          <form onSubmit={save} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing?.id ? "Edit announcement" : "New announcement"}</DialogTitle>
              <DialogDescription className="text-sm leading-[1.5] tracking-[-0.02em]">
                Shown in the app to the chosen audience between the start and end. Times are UTC.
              </DialogDescription>
            </DialogHeader>
            <Field label="Message" htmlFor="announcement-message" required>
              <textarea
                id="announcement-message"
                required
                rows={3}
                maxLength={1000}
                value={draft.message}
                onChange={(event) => setDraft({ ...draft, message: event.target.value })}
                className={cn(control, "h-auto py-2")}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" htmlFor="announcement-type">
                <select
                  id="announcement-type"
                  value={draft.type}
                  onChange={(event) => setDraft({ ...draft, type: event.target.value as AnnouncementType })}
                  className={control}
                >
                  {ANNOUNCEMENT_TYPES.map((type) => (
                    <option key={type} value={type}>{ANNOUNCEMENT_TYPE_LABELS[type]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Audience" htmlFor="announcement-audience">
                <select
                  id="announcement-audience"
                  value={draft.audience}
                  onChange={(event) => setDraft({ ...draft, audience: event.target.value as AnnouncementAudience })}
                  className={control}
                >
                  {ANNOUNCEMENT_AUDIENCES.map((audience) => (
                    <option key={audience} value={audience}>{ANNOUNCEMENT_AUDIENCE_LABELS[audience]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Starts (UTC)" htmlFor="announcement-start" required>
                <input
                  id="announcement-start"
                  type="datetime-local"
                  required
                  value={draft.startsAt}
                  onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
                  className={control}
                />
              </Field>
              <Field label="Ends (UTC)" htmlFor="announcement-end" required>
                <input
                  id="announcement-end"
                  type="datetime-local"
                  required
                  value={draft.endsAt}
                  onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
                  className={control}
                />
              </Field>
            </div>
            <label htmlFor="announcement-dismissible" className="flex items-center gap-2 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
              <input
                id="announcement-dismissible"
                type="checkbox"
                checked={draft.isDismissible}
                onChange={(event) => setDraft({ ...draft, isDismissible: event.target.checked })}
              />
              Users can dismiss this announcement
            </label>
            {formError && (
              <p role="alert" className="m-0 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
                {formError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit"  disabled={saving}>
                {saving ? "Saving…" : editing?.id ? "Save announcement" : "Create announcement"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleting !== null} onOpenChange={(next) => !next && rowBusy === null && setDeleting(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Delete this announcement?</DialogTitle>
            <DialogDescription className="text-sm leading-[1.5] tracking-[-0.02em]">
              It disappears for every customer straight away and cannot be restored. To stop it showing but keep the record,
              use End now instead.
            </DialogDescription>
          </DialogHeader>
          {deleting && (
            <p className="m-0 rounded-[8px] border border-[var(--border)] bg-[var(--surface-alt)] px-3 py-2 text-sm leading-[1.5] tracking-[-0.02em] break-words text-[var(--body)]">
              {deleting.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleting(null)} disabled={rowBusy !== null}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={rowBusy !== null}
            >
              {rowBusy !== null ? "Deleting…" : "Delete announcement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
