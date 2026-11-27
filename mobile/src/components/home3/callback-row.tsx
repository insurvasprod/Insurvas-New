import { router } from "expo-router";

import { clock, clockShort, overdueLabel, timePart } from "@/components/home/when";
import { Chip, Row } from "@/components/ui";
import { firstName } from "@/lib/format";
import type { CallbackView } from "@/lib/types";

/**
 * A schedule row (board B1 / B5): overdue → "Callback · 2 h overdue" + Overdue chip; otherwise the
 * customer's time and this phone's time, with the phone's time on the right. Someone else's callback
 * says whose it is ("for Jordan").
 */
export function CallbackRow({ cb, first, viewer, forOthers }: { cb: CallbackView; first: boolean; viewer: string | undefined; forOthers: boolean }) {
  const at = new Date(cb.scheduledAtUtc);
  const late = cb.isOverdue || cb.status === "missed";
  const theirs = timePart(cb.customerTime);
  const whose = cb.assignedTo && cb.assignedTo !== viewer && cb.assigneeName ? `for ${firstName(cb.assigneeName)}` : null;
  const meta = late
    ? ["Callback", overdueLabel(cb.scheduledAtUtc), whose].filter(Boolean).join(" · ")
    : [theirs ? `${theirs} their time` : "Callback", forOthers && whose ? whose : `${clock(at)} yours`, !forOthers ? whose : null].filter(Boolean).join(" · ");
  return (
    <Row first={first} icon="calCheck" iconTone={late ? "warn" : "brand"} title={cb.customerName} meta={meta}
      chip={late ? <Chip tone="warn">Overdue</Chip> : undefined} right={late ? undefined : clockShort(at)}
      onPress={() => router.push(`/lead/${cb.leadId}`)} testID={`home-callback-${cb.id}`} />
  );
}
