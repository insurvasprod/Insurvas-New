"use client";

import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_AUDIENCE_LABELS,
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_TYPE_LABELS,
  MAINTENANCE_LEVELS,
  MAINTENANCE_LEVEL_HELP,
  MAINTENANCE_LEVEL_LABELS,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementType,
  type MaintenanceLevel,
  type MaintenanceRow,
} from "@/lib/system/constants";

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

type AnnouncementDraft = {
  message: string;
  type: AnnouncementType;
  audience: AnnouncementAudience;
  startsAt: string;
  endsAt: string;
  isDismissible: boolean;
};

function emptyAnnouncement(): AnnouncementDraft {
  const start = new Date();
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { message: "", type: "info", audience: "all", startsAt: toLocalInput(start.toISOString()), endsAt: toLocalInput(end.toISOString()), isDismissible: true };
}

export function SystemSettingsPanel({
  initialMaintenance,
  initialAnnouncements,
}: {
  initialMaintenance: MaintenanceRow | null;
  initialAnnouncements: Announcement[];
}) {
  const [maintenance, setMaintenance] = useState<MaintenanceRow | null>(initialMaintenance);
  const [maintenanceLevel, setMaintenanceLevel] = useState<"off" | MaintenanceLevel>(initialMaintenance?.level ?? "off");
  const [maintenanceMessage, setMaintenanceMessage] = useState(initialMaintenance?.message ?? "");
  const [scheduledStart, setScheduledStart] = useState(toLocalInput(initialMaintenance?.scheduled_start ?? null));
  const [scheduledEnd, setScheduledEnd] = useState(toLocalInput(initialMaintenance?.scheduled_end ?? null));
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);

  const [announcements, setAnnouncements] = useState(initialAnnouncements);
  const [renderedAt] = useState(() => Date.now());
  const [draft, setDraft] = useState<AnnouncementDraft>(emptyAnnouncement);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [announcementError, setAnnouncementError] = useState<string | null>(null);
  const [announcementBusy, setAnnouncementBusy] = useState(false);

  async function saveMaintenance() {
    setMaintenanceError(null);
    if (maintenanceLevel !== "off" && !maintenanceMessage.trim()) return setMaintenanceError("Enter a maintenance message.");
    if ((scheduledStart && !scheduledEnd) || (!scheduledStart && scheduledEnd)) return setMaintenanceError("Choose both a scheduled start and end.");
    if (scheduledStart && scheduledEnd && new Date(scheduledEnd) <= new Date(scheduledStart)) return setMaintenanceError("Scheduled end must be after scheduled start.");

    setMaintenanceBusy(true);
    const response = await fetch("/api/admin/system/maintenance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: maintenanceLevel,
        message: maintenanceMessage,
        scheduled_start: maintenanceLevel === "off" ? null : toIso(scheduledStart),
        scheduled_end: maintenanceLevel === "off" ? null : toIso(scheduledEnd),
      }),
    });
    const body = await response.json().catch(() => null);
    setMaintenanceBusy(false);
    if (!response.ok) return setMaintenanceError(body?.error ?? "Could not save maintenance settings.");
    setMaintenance(body.maintenance?.level === "off" ? null : { id: 1, level: maintenanceLevel as MaintenanceLevel, message: maintenanceMessage.trim(), scheduled_start: toIso(scheduledStart), scheduled_end: toIso(scheduledEnd), updated_by: null, updated_at: new Date().toISOString() });
    toast.success(maintenanceLevel === "off" ? "Maintenance turned off" : "Maintenance settings saved");
  }

  async function saveAnnouncement() {
    setAnnouncementError(null);
    if (!draft.message.trim()) return setAnnouncementError("Enter an announcement message.");
    if (!draft.startsAt || !draft.endsAt) return setAnnouncementError("Choose a start and end time.");
    if (new Date(draft.endsAt) <= new Date(draft.startsAt)) return setAnnouncementError("End must be after start.");

    setAnnouncementBusy(true);
    const response = await fetch(editingId ? `/api/admin/system/announcements/${editingId}` : "/api/admin/system/announcements", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: draft.message, type: draft.type, audience: draft.audience, starts_at: toIso(draft.startsAt), ends_at: toIso(draft.endsAt), is_dismissible: draft.isDismissible }),
    });
    const body = await response.json().catch(() => null);
    setAnnouncementBusy(false);
    if (!response.ok) return setAnnouncementError(body?.error ?? "Could not save announcement.");
    setAnnouncements((items) => editingId ? items.map((item) => item.id === editingId ? body.announcement : item) : [body.announcement, ...items]);
    setDraft(emptyAnnouncement());
    setEditingId(null);
    toast.success(editingId ? "Announcement updated" : "Announcement created");
  }

  async function removeAnnouncement(id: string) {
    if (!window.confirm("Delete this announcement?")) return;
    const response = await fetch(`/api/admin/system/announcements/${id}`, { method: "DELETE" });
    if (!response.ok) return toast.error("Could not delete announcement");
    setAnnouncements((items) => items.filter((item) => item.id !== id));
    toast.success("Announcement deleted");
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Maintenance mode</h2>
            <p className="mt-1 text-sm text-muted-foreground">Admin sessions always bypass this control, including locked mode.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="maintenance-level">Level</Label>
            <Select value={maintenanceLevel} onValueChange={(value) => setMaintenanceLevel(value as "off" | MaintenanceLevel)}>
              <SelectTrigger id="maintenance-level" className="w-full max-w-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                {MAINTENANCE_LEVELS.map((level) => <SelectItem key={level} value={level}>{MAINTENANCE_LEVEL_LABELS[level]}</SelectItem>)}
              </SelectContent>
            </Select>
            {maintenanceLevel !== "off" && <p className="text-xs text-muted-foreground">{MAINTENANCE_LEVEL_HELP[maintenanceLevel]}</p>}
          </div>
          {maintenanceLevel !== "off" && (
            <div className="space-y-1.5">
              <Label htmlFor="maintenance-message">Message</Label>
              <textarea id="maintenance-message" maxLength={1000} rows={3} className="w-full max-w-2xl rounded-md border border-input bg-background p-2 text-sm" value={maintenanceMessage} onChange={(event) => setMaintenanceMessage(event.target.value)} />
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
            <div className="space-y-1.5"><Label htmlFor="scheduled-start">Scheduled start (optional)</Label><Input id="scheduled-start" type="datetime-local" value={scheduledStart} onChange={(event) => setScheduledStart(event.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="scheduled-end">Scheduled end (optional)</Label><Input id="scheduled-end" type="datetime-local" value={scheduledEnd} onChange={(event) => setScheduledEnd(event.target.value)} /></div>
          </div>
          <p className="text-xs text-muted-foreground">A future window shows the message as a banner, applies the selected level during the window, and clears automatically at the end.</p>
          {maintenanceError && <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">{maintenanceError}</p>}
          <Button onClick={() => void saveMaintenance()} disabled={maintenanceBusy}>{maintenanceBusy ? "Saving…" : "Save maintenance"}</Button>
          {maintenance && <p className="text-xs text-muted-foreground">Last updated {new Date(maintenance.updated_at).toLocaleString()}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-5">
          <div><h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Announcements</h2><p className="mt-1 text-sm text-muted-foreground">Show a dated message to everyone or one plan type. Dismissals are stored per user.</p></div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5 md:col-span-2"><Label htmlFor="announcement-message">Message</Label><textarea id="announcement-message" maxLength={1000} rows={3} className="w-full rounded-md border border-input bg-background p-2 text-sm" value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} /></div>
            <div className="space-y-1.5"><Label>Type</Label><Select value={draft.type} onValueChange={(value) => setDraft({ ...draft, type: value as AnnouncementType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ANNOUNCEMENT_TYPES.map((type) => <SelectItem key={type} value={type}>{ANNOUNCEMENT_TYPE_LABELS[type]}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label>Audience</Label><Select value={draft.audience} onValueChange={(value) => setDraft({ ...draft, audience: value as AnnouncementAudience })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{ANNOUNCEMENT_AUDIENCES.map((audience) => <SelectItem key={audience} value={audience}>{ANNOUNCEMENT_AUDIENCE_LABELS[audience]}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label htmlFor="announcement-start">Starts</Label><Input id="announcement-start" type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="announcement-end">Ends</Label><Input id="announcement-end" type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.isDismissible} onChange={(event) => setDraft({ ...draft, isDismissible: event.target.checked })} /> Users can dismiss this announcement</label>
          {announcementError && <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">{announcementError}</p>}
          <div className="flex flex-wrap gap-2"><Button onClick={() => void saveAnnouncement()} disabled={announcementBusy}>{announcementBusy ? "Saving…" : editingId ? "Save announcement" : "Create announcement"}</Button>{editingId && <Button variant="outline" onClick={() => { setEditingId(null); setDraft(emptyAnnouncement()); setAnnouncementError(null); }}>Cancel edit</Button>}</div>

          <div className="overflow-x-auto rounded-md border border-border">
            <Table><TableHeader><TableRow><TableHead>Message</TableHead><TableHead>Audience</TableHead><TableHead>Window</TableHead><TableHead>Status</TableHead><TableHead className="w-24" /></TableRow></TableHeader><TableBody>
              {announcements.length === 0 && <TableRow><TableCell colSpan={5} className="h-16 text-center text-sm text-muted-foreground">No announcements yet.</TableCell></TableRow>}
              {announcements.map((announcement) => {
                const active = new Date(announcement.starts_at).getTime() <= renderedAt && new Date(announcement.ends_at).getTime() > renderedAt;
                return <TableRow key={announcement.id}><TableCell className="max-w-[260px] truncate font-medium">{announcement.message}</TableCell><TableCell><Badge variant="outline">{ANNOUNCEMENT_AUDIENCE_LABELS[announcement.audience]}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(announcement.starts_at).toLocaleString()} – {new Date(announcement.ends_at).toLocaleString()}</TableCell><TableCell>{active ? <Badge>Active</Badge> : <Badge variant="outline">Scheduled/ended</Badge>}</TableCell><TableCell><div className="flex gap-1"><Button variant="ghost" size="icon-xs" aria-label="Edit announcement" onClick={() => { setEditingId(announcement.id); setDraft({ message: announcement.message, type: announcement.type, audience: announcement.audience, startsAt: toLocalInput(announcement.starts_at), endsAt: toLocalInput(announcement.ends_at), isDismissible: announcement.is_dismissible }); }}><Pencil /></Button><Button variant="ghost" size="icon-xs" aria-label="Delete announcement" onClick={() => void removeAnnouncement(announcement.id)}><Trash2 /></Button></div></TableCell></TableRow>;
              })}
            </TableBody></Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
