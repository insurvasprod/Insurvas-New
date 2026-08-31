"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { Announcement } from "@/lib/system/constants";

const TONE: Record<Announcement["type"], string> = {
  info: "border-[var(--color-blue)]/30 bg-[var(--color-blue)]/10",
  warning: "border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10",
  critical: "border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10",
};

export function AnnouncementStrip({ initialAnnouncements }: { initialAnnouncements: Announcement[] }) {
  const [announcements, setAnnouncements] = useState(initialAnnouncements);

  async function dismiss(id: string) {
    const response = await fetch(`/api/app/announcements/${id}/dismiss`, { method: "POST" });
    if (response.ok) {
      setAnnouncements((items) => items.filter((item) => item.id !== id));
      return;
    }

    const body = await response.json().catch(() => null);
    toast.error(body?.error ?? "We could not dismiss this announcement. Please try again.");
  }

  if (announcements.length === 0) return null;
  return (
    <div className="mb-6 space-y-3" aria-label="Announcements">
      {announcements.map((announcement) => (
        <div key={announcement.id} role="alert" className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${TONE[announcement.type]}`}>
          <p className="min-w-0 flex-1">{announcement.message}</p>
          {announcement.is_dismissible && (
            <Button variant="ghost" size="icon-xs" aria-label="Dismiss announcement" onClick={() => void dismiss(announcement.id)}>
              <X />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
