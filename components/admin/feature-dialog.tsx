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
import { FEATURE_KEY_RULE, type FeatureModuleRow, type FeatureRow } from "@/lib/features/constants";

export function FeatureDialog({
  mode,
  open,
  feature,
  modules,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  feature?: FeatureRow | null;
  modules: FeatureModuleRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // Seeded from props; the parent keys the edit dialog by feature id so a different row
  // remounts it with fresh state.
  const [featureKey, setFeatureKey] = useState(feature?.feature_key ?? "");
  const [label, setLabel] = useState(feature?.label ?? "");
  const [moduleKey, setModuleKey] = useState(feature?.module ?? modules[0]?.key ?? "");
  const [description, setDescription] = useState(feature?.description ?? "");
  const [loading, setLoading] = useState(false);

  const isEdit = mode === "edit";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);

    const res = isEdit
      ? await fetch(`/api/admin/features/${feature!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, description }),
        })
      : await fetch("/api/admin/features", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feature_key: featureKey, label, module: moduleKey, description }),
        });

    const body = await res.json().catch(() => null);
    setLoading(false);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not save the feature");
      return;
    }

    toast.success(isEdit ? `${label} updated` : `${label} added`);
    onSaved();
    onClose();
    if (!isEdit) {
      setFeatureKey("");
      setLabel("");
      setDescription("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit feature" : "New feature"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "The key and module are fixed — plans, menu nodes and requireFeature() guards all reference them. To retire a feature, archive it."
                : "Adding a feature takes effect immediately; no deploy is needed."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="feature-label">Label</Label>
              <Input id="feature-label" required value={label} onChange={(e) => setLabel(e.target.value)} />
              <p className="text-xs text-muted-foreground">What an admin sees in the plan picker.</p>
            </div>

            {!isEdit && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="feature-key">Feature key</Label>
                  <Input
                    id="feature-key"
                    required
                    value={featureKey}
                    onChange={(e) => setFeatureKey(e.target.value)}
                    placeholder="e.g. chargeback_radar"
                  />
                  <p className="text-xs text-muted-foreground">{FEATURE_KEY_RULE}. Permanent once created.</p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="feature-module">Module</Label>
                  <Select value={moduleKey} onValueChange={setModuleKey}>
                    <SelectTrigger id="feature-module" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modules.map((m) => (
                        <SelectItem key={m.key} value={m.key}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="feature-description">Description</Label>
              <Input
                id="feature-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : isEdit ? "Save changes" : "Add feature"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
