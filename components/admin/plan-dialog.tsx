"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BUILDABLE_PLAN_TYPES,
  PLAN_CODE_RULE,
  PLAN_TYPES,
  PLAN_TYPE_DESCRIPTIONS,
  PLAN_TYPE_LABELS,
  type PlanListRow,
  type PlanType,
} from "@/lib/plans/constants";

export function PlanDialog({
  mode,
  open,
  plan,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  plan?: PlanListRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Seeded from props; the parent keys the edit dialog by plan id so a different row remounts it.
  const [code, setCode] = useState(plan?.code ?? "");
  const [name, setName] = useState(plan?.name ?? "");
  const [planType, setPlanType] = useState<PlanType>(plan?.plan_type ?? "individual");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [isPublic, setIsPublic] = useState(plan?.is_public ?? false);
  const [sortOrder, setSortOrder] = useState(String(plan?.sort_order ?? 0));
  const [loading, setLoading] = useState(false);

  const isEdit = mode === "edit";
  const codeLocked = isEdit && (plan?.ever_subscribed_count ?? 0) > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    const res = isEdit
      ? await fetch(`/api/admin/plans/${plan!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            name,
            description,
            is_public: isPublic,
            is_archived: plan!.is_archived,
            sort_order: Number(sortOrder) || 0,
          }),
        })
      : await fetch("/api/admin/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            name,
            plan_type: planType,
            description,
            is_public: isPublic,
            sort_order: Number(sortOrder) || 0,
          }),
        });

    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not save the plan");
      return;
    }

    toast.success(isEdit ? `${name} updated` : `${name} created`);
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${plan?.name}` : "New plan"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Name and visibility change in place. Feature and price changes publish a new version instead, so existing subscribers keep the deal they bought."
                : "Creating a plan takes effect immediately; no deploy is needed."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="plan-code">Code</Label>
              <Input
                id="plan-code"
                required
                disabled={codeLocked}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. advanced"
              />
              <p className="text-xs text-muted-foreground">
                {codeLocked
                  ? `Locked — ${plan?.ever_subscribed_count} subscription(s) reference this plan.`
                  : PLAN_CODE_RULE}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Name</Label>
              <Input id="plan-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            {!isEdit && (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="plan-type">Plan type</Label>
                <Select value={planType} onValueChange={(v) => setPlanType(v as PlanType)}>
                  <SelectTrigger id="plan-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_TYPES.map((t) => (
                      <SelectItem key={t} value={t} disabled={!BUILDABLE_PLAN_TYPES.includes(t)}>
                        {PLAN_TYPE_LABELS[t]}
                        {!BUILDABLE_PLAN_TYPES.includes(t) && " — not built yet"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{PLAN_TYPE_DESCRIPTIONS[planType]}</p>
              </div>
            )}

            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="plan-description">Description</Label>
              <Input
                id="plan-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-sort">Sort order</Label>
              <Input
                id="plan-sort"
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-public">Visibility</Label>
              <Select value={isPublic ? "public" : "private"} onValueChange={(v) => setIsPublic(v === "public")}>
                <SelectTrigger id="plan-public" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Public plans appear on the pricing page (SA-5.1).</p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : isEdit ? "Save changes" : "Create plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
