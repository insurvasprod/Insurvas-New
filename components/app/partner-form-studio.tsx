"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  ChevronDown,
  ChevronUp,
  Edit3,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { notify } from "@/lib/notify";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FIELD_TYPE_LABELS,
  type TemplateField,
  type TemplateFieldType,
} from "@/lib/templates/constants";
import { cn } from "@/lib/utils";
import { PartnerMarketAccessPanel } from "@/components/app/partner-market-access-panel";

type Choice = { field_key: string; is_required: boolean; sort_order: number };
type Product = {
  code?: string;
  product_code?: string;
  name?: string;
  product_name?: string;
  approved?: boolean;
};
type Preset = {
  id: string;
  name: string;
  current_revision: number;
  fields: Choice[];
  verification_fields: Choice[];
};
type Profile = {
  catalog: TemplateField[];
  templateRevision: number;
  profile: { id: string; current_revision: number } | null;
  effective: {
    fields: Choice[];
    verification_fields: Choice[];
    source: string;
  };
};

type FieldDraft = {
  label: string;
  field_key: string;
  type: TemplateFieldType;
  options: string;
  help_text: string;
  is_required: boolean;
  digit_length: string;
  format_mask: string;
  placeholder: string;
};

const emptyFieldDraft = (): FieldDraft => ({
  label: "",
  field_key: "",
  type: "text",
  options: "",
  help_text: "",
  is_required: false,
  digit_length: "",
  format_mask: "",
  placeholder: "",
});

const fieldDraftFromCatalog = (field: TemplateField): FieldDraft => ({
  label: field.label,
  field_key: field.field_key,
  type: field.type,
  options: field.options.join(", "),
  help_text: field.help_text ?? "",
  is_required: field.is_required,
  digit_length: field.validation?.digit_length
    ? String(field.validation.digit_length)
    : field.type === "ssn"
      ? "9"
      : "",
  format_mask: field.validation?.format_mask ??
    (field.type === "ssn" ? "###-##-####" : ""),
  placeholder: field.validation?.placeholder ?? "",
});

function fieldValidation(draft: FieldDraft) {
  if (draft.type !== "ssn") return {};
  const digitLength = Number(draft.digit_length || 9);
  if (!Number.isInteger(digitLength) || digitLength < 1 || digitLength > 40)
    return null;
  const formatMask = draft.format_mask.trim() || "#".repeat(digitLength);
  const maskDigitLength = [...formatMask].filter((character) => character === "#").length;
  if (maskDigitLength !== digitLength) return null;
  const pattern = [...formatMask]
    .map((character) =>
      character === "#"
        ? "\\d"
        : `(?:${character.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")})?`,
    )
    .join("");
  return {
    digit_length: digitLength,
    format_mask: formatMask,
    placeholder: draft.placeholder.trim() || undefined,
    min_length: digitLength,
    max_length: formatMask.length,
    pattern: `^${pattern}$`,
  };
}

function displayFieldType(type: TemplateFieldType) {
  return type === "ssn" ? "Document number" : TEMPLATE_FIELD_TYPE_LABELS[type];
}

const sorted = (items: Choice[]) =>
  [...items]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((item, sort_order) => ({ ...item, sort_order }));
const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(?=\d)/, "field_")
    .slice(0, 60);

export function PartnerFormStudio({
  partnerId,
  target,
  readOnly = false,
  compact = false,
}: {
  partnerId: string;
  target?: {
    userId: string;
    name: string;
    role: "partner_admin" | "partner_user";
  };
  readOnly?: boolean;
  compact?: boolean;
}) {
  const base = target
    ? `/api/app/partners/${partnerId}/users/${target.userId}/form-profile`
    : `/api/app/partners/${partnerId}/form-profile`;
  const [products, setProducts] = useState<
    Array<{ code: string; name: string }>
  >([]);
  const [productCode, setProductCode] = useState("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fields, setFields] = useState<Choice[]>([]);
  const [verification, setVerification] = useState<Choice[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [fieldOpen, setFieldOpen] = useState(false);
  const [newField, setNewField] = useState<FieldDraft>(emptyFieldDraft);
  const [editFieldOpen, setEditFieldOpen] = useState(false);
  const [editFieldKey, setEditFieldKey] = useState<string | null>(null);
  const [editField, setEditField] = useState<FieldDraft>(emptyFieldDraft);
  const [sourcePreset, setSourcePreset] = useState<Preset | null>(null);

  const load = useCallback(
    async (code: string) => {
      if (!code) {
        setLoading(false);
        return;
      }
      setLoading(true);
      const [profileResponse, presetResponse] = await Promise.all([
        fetch(`${base}?product_code=${encodeURIComponent(code)}`, {
          cache: "no-store",
        }),
        fetch(
          `/api/app/partners/${partnerId}/form-presets?product_code=${encodeURIComponent(code)}`,
          { cache: "no-store" },
        ),
      ]);
      const next = (await profileResponse.json().catch(() => null)) as
        Profile | { error?: string } | null;
      const presetBody = (await presetResponse.json().catch(() => null)) as {
        presets?: Preset[];
        error?: string;
      } | null;
      if (!profileResponse.ok || !next || !("catalog" in next))
        notify.fail(
          (next as { error?: string } | null)?.error ??
            "Could not load form setup",
        );
      else {
        setProfile(next);
        setFields(sorted(next.effective.fields));
        setVerification(sorted(next.effective.verification_fields));
      }
      if (presetResponse.ok) setPresets(presetBody?.presets ?? []);
      else notify.fail(presetBody?.error ?? "Could not load form templates");
      setLoading(false);
    },
    [base, partnerId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/app/partners/${partnerId}/products`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not load products");
        setLoading(false);
        return;
      }
      const next = (body.products ?? [])
        .filter((item: Product) => item.approved !== false)
        .map((item: Product) => ({
          code: item.code ?? item.product_code ?? "",
          name: item.name ?? item.product_name ?? item.code ?? "Product",
        }))
        .filter((item: { code: string }) => item.code);
      if (cancelled) return;
      setProducts(next);
      const code = next[0]?.code ?? "";
      setProductCode(code);
      await load(code);
    })();
    return () => {
      cancelled = true;
    };
  }, [load, partnerId]);

  const catalog = useMemo(() => profile?.catalog ?? [], [profile?.catalog]);
  const fieldByKey = useMemo(
    () => new Map(catalog.map((field) => [field.field_key, field])),
    [catalog],
  );
  const hasPhone = (items: Choice[]) =>
    items.some((item) => fieldByKey.get(item.field_key)?.type === "phone");
  const change = (
    key: string,
    checked: boolean,
    destination: "lead" | "verification",
  ) =>
    (destination === "lead" ? setFields : setVerification)((current) =>
      checked
        ? [
            ...current,
            {
              field_key: key,
              is_required:
                destination === "lead" && fieldByKey.get(key)?.type === "phone",
              sort_order: current.length,
            },
          ]
        : current.filter((item) => item.field_key !== key),
    );
  const required = (
    key: string,
    value: boolean,
    destination: "lead" | "verification",
  ) =>
    (destination === "lead" ? setFields : setVerification)((current) =>
      current.map((item) =>
        item.field_key === key
          ? {
              ...item,
              is_required:
                value ||
                (destination === "lead" &&
                  fieldByKey.get(key)?.type === "phone"),
            }
          : item,
      ),
    );
  const move = (
    key: string,
    direction: -1 | 1,
    destination: "lead" | "verification",
  ) =>
    (destination === "lead" ? setFields : setVerification)((current) => {
      const index = current.findIndex((item) => item.field_key === key);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length)
        return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return sorted(next);
    });
  const contactOnly = () => {
    const phone = catalog.find((field) => field.type === "phone");
    const email = catalog.find((field) => field.type === "email");
    const name =
      catalog.find((field) => field.field_key === "full_name") ??
      catalog.find((field) => field.field_key === "first_name") ??
      catalog.find((field) => field.type === "text");
    if (!phone)
      return notify.block("This product needs a phone field for screening");
    setFields(
      [name, email, phone]
        .filter((field): field is TemplateField => Boolean(field))
        .filter(
          (field, index, all) =>
            all.findIndex((item) => item.field_key === field.field_key) ===
            index,
        )
        .map((field, sort_order) => ({
          field_key: field.field_key,
          is_required: field.type === "phone" || field.is_required,
          sort_order,
        })),
    );
    setSourcePreset(null);
  };
  const applyPreset = (preset: Preset) => {
    setFields(sorted(preset.fields));
    setVerification(sorted(preset.verification_fields));
    setSourcePreset(preset);
    notify.done(`${preset.name} loaded — publish to apply it`);
  };

  async function publish() {
    if (!productCode || !hasPhone(fields))
      return notify.block("Phone is required for screening");
    setSaving(true);
    const response = await fetch(base, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        product_code: productCode,
        fields,
        verification_fields: verification,
        source_preset_id: sourcePreset?.id,
        source_preset_revision: sourcePreset?.current_revision,
      }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok)
      return notify.block(body?.error ?? "Could not publish form configuration");
    notify.done(
      `Published revision ${body.revision}. New partner forms use it immediately.`,
    );
    await load(productCode);
  }
  async function restoreInherited() {
    if (!target || !profile?.profile) return;
    setSaving(true);
    const response = await fetch(
      `${base}?product_code=${encodeURIComponent(productCode)}`,
      { method: "DELETE" },
    );
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok)
      return notify.block(
        body?.error ?? "Could not restore inherited defaults",
      );
    notify.done("Inherited defaults restored");
    await load(productCode);
  }
  async function savePreset() {
    if (!presetName.trim() || !productCode || !hasPhone(fields))
      return notify.block("Enter a name and keep phone in the lead form");
    setSaving(true);
    const response = await fetch(
      `/api/app/partners/${partnerId}/form-presets`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_code: productCode,
          name: presetName,
          fields,
          verification_fields: verification,
        }),
      },
    );
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok)
      return notify.block(body?.error ?? "Could not save preset");
    setPresetOpen(false);
    setPresetName("");
    notify.done("Reusable template saved");
    await load(productCode);
  }
  async function addField() {
    const key = newField.field_key || slug(newField.label);
    if (!productCode || !key || !newField.label.trim())
      return notify.block("Enter a field label");
    const validation = fieldValidation(newField);
    if (validation === null)
      return notify.block("Enter a valid document number length");
    setSaving(true);
    const response = await fetch(
      `/api/app/partners/${partnerId}/form-catalog`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          product_code: productCode,
          field: {
            ...newField,
            field_key: key,
            options: newField.options
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            validation,
          },
        }),
      },
    );
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) return notify.block(body?.error ?? "Could not add field");
    setFieldOpen(false);
    setNewField(emptyFieldDraft());
    await load(productCode);
    setFields((current) => [
      ...current,
      {
        field_key: body.field.field_key,
        is_required: false,
        sort_order: current.length,
      },
    ]);
    notify.done(
      "Shared field added. Publish this form to show it to this target only.",
    );
  }

  function openEditField(field: TemplateField) {
    setEditFieldKey(field.field_key);
    setEditField(fieldDraftFromCatalog(field));
    setEditFieldOpen(true);
  }

  async function updateField() {
    if (!editFieldKey || !productCode || !editField.label.trim())
      return notify.block("Enter a field label");
    const validation = fieldValidation(editField);
    if (validation === null)
      return notify.block("Enter a valid document number length");
    setSaving(true);
    const response = await fetch(
      `/api/app/partners/${partnerId}/form-catalog?product_code=${encodeURIComponent(productCode)}&field_key=${encodeURIComponent(editFieldKey)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          field: {
            label: editField.label,
            type: editField.type,
            is_required: editField.is_required,
            options: editField.options
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            help_text: editField.help_text,
            validation,
          },
        }),
      },
    );
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok)
      return notify.block(body?.error ?? "Could not update form field");
    setEditFieldOpen(false);
    notify.done("Field updated");
    await load(productCode);
  }

  async function deleteField(fieldKey: string) {
    if (!productCode) return;
    const field = fieldByKey.get(fieldKey);
    if (field?.type === "phone")
      return notify.block(
        "Phone is required for screening and cannot be deleted",
      );
    setSaving(true);
    const response = await fetch(
      `/api/app/partners/${partnerId}/form-catalog?product_code=${encodeURIComponent(productCode)}&field_key=${encodeURIComponent(fieldKey)}`,
      { method: "DELETE" },
    );
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok)
      return notify.block(body?.error ?? "Could not delete form field");
    setFields((current) => current.filter((item) => item.field_key !== fieldKey));
    setVerification((current) =>
      current.filter((item) => item.field_key !== fieldKey),
    );
    setEditFieldOpen(false);
    notify.done("Field deleted from the shared catalog");
    await load(productCode);
    setFields((current) => current.filter((item) => item.field_key !== fieldKey));
    setVerification((current) =>
      current.filter((item) => item.field_key !== fieldKey),
    );
  }

  if (loading)
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Loading form workspace…
        </CardContent>
      </Card>
    );
  return (
    <>
      <Card className={cn("overflow-hidden", compact && "border-0 shadow-none")}>
        <CardHeader
          className={cn(
            "gap-4 border-b bg-muted/10",
            compact && "px-0 pb-3 pt-0",
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {target
                  ? `Form setup · ${target.name}`
                  : "Publisher form defaults"}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {target
                  ? "Direct overrides take priority; inheriting users update automatically when an admin default changes."
                  : "These defaults apply unless an admin or user has a direct override."}
              </p>
            </div>
            <Badge variant={profile?.profile ? "default" : "secondary"}>
              {profile?.profile
                ? "Custom configuration"
                : "Using tenant defaults"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Product"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={productCode}
              onChange={(event) => {
                setProductCode(event.target.value);
                void load(event.target.value);
              }}
            >
              {products.map((product) => (
                <option key={product.code} value={product.code}>
                  {product.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={readOnly}
              onClick={contactOnly}
            >
                Contact only
            </Button>
            {!compact && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={readOnly}
                onClick={() => setFieldOpen(true)}
              >
                <Plus className="mr-1 size-3.5" />
                Add field
              </Button>
            )}
            {!compact && (
              <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={readOnly}
              onClick={() => setPresetOpen(true)}
            >
              <Save className="mr-1 size-3.5" />
              Save as template
              </Button>
            )}
          </div>
          {compact ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="shrink-0 font-medium">Preset</span>
              <select
                aria-label="Apply template"
                className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
                value={sourcePreset?.id ?? ""}
                disabled={readOnly || !presets.length}
                onChange={(event) => {
                  const preset = presets.find(
                    (item) => item.id === event.target.value,
                  );
                  if (preset) applyPreset(preset);
                }}
              >
                <option value="">
                  {presets.length ? "Choose a saved preset…" : "No saved presets"}
                </option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="flex flex-wrap gap-2">
              <span className="self-center text-xs font-medium text-muted-foreground">
                Templates
              </span>
              {presets.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={readOnly}
                  onClick={() => applyPreset(preset)}
                >
                  <Sparkles className="mr-1 size-3.5" />
                  {preset.name}
                </Button>
              ))}
              {!presets.length && (
                <span className="self-center text-xs text-muted-foreground">
                  Save the current setup to create a reusable template.
                </span>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent
          className={cn(
            "grid gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_320px]",
            compact && "gap-4 p-0",
          )}
        >
          <div className="space-y-5">
            <FieldList
              title="Partner lead form"
              catalog={catalog}
              choices={fields}
              disabled={readOnly}
              onChange={(key, checked) => change(key, checked, "lead")}
              onRequired={(key, checked) => required(key, checked, "lead")}
              onMove={(key, direction) => move(key, direction, "lead")}
              onEdit={openEditField}
              onDelete={(key) => void deleteField(key)}
              locked={(key) => fieldByKey.get(key)?.type === "phone"}
              compact={compact}
            />
            <FieldList
              title="Agent verification checklist"
              catalog={catalog}
              choices={verification}
              disabled={readOnly}
              onChange={(key, checked) => change(key, checked, "verification")}
              onRequired={(key, checked) =>
                required(key, checked, "verification")
              }
              onMove={(key, direction) => move(key, direction, "verification")}
              onEdit={openEditField}
              onDelete={(key) => void deleteField(key)}
              locked={() => false}
              compact={compact}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              {target && profile?.profile ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saving || readOnly}
                  onClick={() => void restoreInherited()}
                >
                  Restore inherited
                </Button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                disabled={saving || readOnly}
                onClick={() => void publish()}
              >
                {saving ? "Publishing…" : "Publish changes"}
              </Button>
            </div>
          </div>
          <Preview catalog={catalog} choices={fields} compact={compact} />
          <div className="xl:col-span-2">
            <PartnerMarketAccessPanel
              partnerId={partnerId}
              target={target}
              readOnly={readOnly}
              compact={compact}
            />
          </div>
        </CardContent>
      </Card>
      <Dialog open={presetOpen} onOpenChange={setPresetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save reusable template</DialogTitle>
            <DialogDescription>
              This template saves both the partner lead form and the agent
              verification checklist.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="preset-name">Template name</Label>
            <Input
              id="preset-name"
              value={presetName}
              maxLength={120}
              placeholder="Full intake"
              onChange={(event) => setPresetName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPresetOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void savePreset()}
            >
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={fieldOpen} onOpenChange={setFieldOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add shared field</DialogTitle>
            <DialogDescription>
              This adds a governed field to this product catalog. It will not
              appear for other partners until their configuration selects it.
            </DialogDescription>
          </DialogHeader>
          <FieldEditorFields
            draft={newField}
            setDraft={setNewField}
            editing={false}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFieldOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void addField()}
            >
              Add field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={editFieldOpen} onOpenChange={setEditFieldOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit field</DialogTitle>
            <DialogDescription>
              Update this governed catalog field. Existing lead data keeps its
              stable field key.
            </DialogDescription>
          </DialogHeader>
          <FieldEditorFields
            draft={editField}
            setDraft={setEditField}
            editing
          />
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="outline"
              className="text-muted-foreground"
              disabled={saving || !editFieldKey}
              onClick={() => editFieldKey && void deleteField(editFieldKey)}
            >
              <Trash2 className="size-4" />
              Delete field
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditFieldOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={saving}
                onClick={() => void updateField()}
              >
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FieldEditorFields({
  draft,
  setDraft,
  editing,
}: {
  draft: FieldDraft;
  setDraft: Dispatch<SetStateAction<FieldDraft>>;
  editing: boolean;
}) {
  const update = (patch: Partial<FieldDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const isSelect =
    draft.type === "single_select" || draft.type === "multi_select";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${editing ? "edit" : "new"}-field-label`}>Label</Label>
        <Input
          id={`${editing ? "edit" : "new"}-field-label`}
          value={draft.label}
          onChange={(event) =>
            update({
              label: event.target.value,
              field_key: editing
                ? draft.field_key
                : draft.field_key || slug(event.target.value),
            })
          }
          placeholder="Social Security number"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${editing ? "edit" : "new"}-field-key`}>Field key</Label>
        <Input
          id={`${editing ? "edit" : "new"}-field-key`}
          value={draft.field_key}
          readOnly={editing}
          onChange={(event) => update({ field_key: slug(event.target.value) })}
          placeholder="social_security_number"
        />
        {editing && (
          <p className="text-xs text-muted-foreground">
            The key is stable so existing leads keep their data.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${editing ? "edit" : "new"}-field-type`}>Type</Label>
        <select
          id={`${editing ? "edit" : "new"}-field-type`}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          value={draft.type}
          onChange={(event) =>
            update({ type: event.target.value as TemplateFieldType })
          }
        >
          {TEMPLATE_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {displayFieldType(type)}
            </option>
          ))}
        </select>
      </div>
      {draft.type === "ssn" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`${editing ? "edit" : "new"}-digit-length`}>Digit length</Label>
            <Input
              id={`${editing ? "edit" : "new"}-digit-length`}
              inputMode="numeric"
              type="number"
              min={1}
              max={40}
              value={draft.digit_length}
              onChange={(event) => update({ digit_length: event.target.value })}
              placeholder="9"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${editing ? "edit" : "new"}-format-mask`}>Format mask</Label>
            <Input
              id={`${editing ? "edit" : "new"}-format-mask`}
              value={draft.format_mask}
              onChange={(event) => update({ format_mask: event.target.value })}
              placeholder="###-##-####"
            />
            <p className="text-xs text-muted-foreground">
              The Partner Portal formats the digits while the user types.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Preview</Label>
            <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm font-medium">
              123-45-6789
            </div>
          </div>
        </>
      )}
      {isSelect && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${editing ? "edit" : "new"}-field-options`}>Options</Label>
          <Input
            id={`${editing ? "edit" : "new"}-field-options`}
            value={draft.options}
            onChange={(event) => update({ options: event.target.value })}
            placeholder="Morning, Afternoon, Evening"
          />
        </div>
      )}
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${editing ? "edit" : "new"}-field-placeholder`}>Placeholder</Label>
        <Input
          id={`${editing ? "edit" : "new"}-field-placeholder`}
          value={draft.placeholder}
          onChange={(event) => update({ placeholder: event.target.value })}
          placeholder="Shown inside the field"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={`${editing ? "edit" : "new"}-field-help`}>Help text</Label>
        <Input
          id={`${editing ? "edit" : "new"}-field-help`}
          value={draft.help_text}
          onChange={(event) => update({ help_text: event.target.value })}
          placeholder="Shown to the partner"
        />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          checked={draft.is_required}
          onChange={(event) => update({ is_required: event.target.checked })}
        />
        Required by default
      </label>
    </div>
  );
}

function FieldList({
  title,
  catalog,
  choices,
  disabled,
  onChange,
  onRequired,
  onMove,
  onEdit,
  onDelete,
  locked,
  compact = false,
}: {
  title: string;
  catalog: TemplateField[];
  choices: Choice[];
  disabled: boolean;
  onChange: (key: string, checked: boolean) => void;
  onRequired: (key: string, checked: boolean) => void;
  onMove: (key: string, direction: -1 | 1) => void;
  onEdit: (field: TemplateField) => void;
  onDelete: (key: string) => void;
  locked: (key: string) => boolean;
  compact?: boolean;
}) {
  const selected = new Map(choices.map((choice) => [choice.field_key, choice]));
  return (
    <section>
      <div className="mb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">
          Select, require, and order governed fields.
        </p>
      </div>
      <div className="divide-y overflow-hidden rounded-lg border">
        {catalog.map((field) => {
          const choice = selected.get(field.field_key);
          const isLocked = locked(field.field_key);
          return (
            <div
              key={field.field_key}
              className={cn(
                "flex flex-wrap items-center gap-3 p-3",
                compact && "gap-2 p-2.5",
              )}
            >
              <input
                aria-label={`Include ${field.label} in ${title}`}
                type="checkbox"
                checked={Boolean(choice)}
                disabled={disabled || isLocked}
                onChange={(event) =>
                  onChange(field.field_key, event.target.checked)
                }
              />
              <div className={cn("min-w-36 flex-1", compact && "min-w-0")}>
                <p className="text-sm font-medium">{field.label}</p>
                <p className="text-xs text-muted-foreground">
                  {displayFieldType(field.type)}
                  {field.type === "ssn" && field.validation?.digit_length
                    ? ` · ${field.validation.digit_length} digits`
                    : ""}
                  {isLocked ? " · required for screening" : ""}
                </p>
              </div>
              {choice && (
                <>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={choice.is_required}
                      disabled={disabled || isLocked}
                      onChange={(event) =>
                        onRequired(field.field_key, event.target.checked)
                      }
                    />
                    Required
                  </label>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={disabled}
                    aria-label={`Edit ${field.label}`}
                    onClick={() => onEdit(field)}
                  >
                    <Edit3 className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={disabled || choice.sort_order === 0}
                    aria-label={`Move ${field.label} up`}
                    onClick={() => onMove(field.field_key, -1)}
                  >
                    <ChevronUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    disabled={
                      disabled || choice.sort_order === choices.length - 1
                    }
                    aria-label={`Move ${field.label} down`}
                    onClick={() => onMove(field.field_key, 1)}
                  >
                    <ChevronDown className="size-3.5" />
                  </Button>
                  <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    disabled={disabled || isLocked}
                    aria-label={`Delete ${field.label}`}
                    onClick={() => onDelete(field.field_key)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Preview({
  catalog,
  choices,
  compact = false,
}: {
  catalog: TemplateField[];
  choices: Choice[];
  compact?: boolean;
}) {
  const fieldMap = new Map(catalog.map((field) => [field.field_key, field]));
  return (
    <aside
      className={cn(
        "h-fit rounded-lg border bg-muted/10 p-4",
        compact && "p-3",
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Partner preview
      </p>
      <h3 className="mt-1 text-sm font-semibold">Lead form</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        The Partner Portal shows these fields, in this order, with these controls.
      </p>
      <div className="mt-4 space-y-3">
        <div className="rounded-md border border-[var(--color-blue)]/20 bg-[var(--color-blue-faint)] p-3 text-xs text-[var(--color-accent-ink)]">
          Product, Carrier, and State are required before the partner can
          continue.
        </div>
        {(["Product", "Carrier", "State"] as const).map((label) => (
          <div key={label}>
            <Label>
              {label}<span className="text-destructive"> *</span>
            </Label>
            <select
              disabled
              aria-label={label}
              className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm text-muted-foreground"
              defaultValue=""
            >
              <option value="">Select {label.toLowerCase()}</option>
            </select>
          </div>
        ))}
        <div className="border-t pt-3" />
        {sorted(choices).map((choice) => {
          const field = fieldMap.get(choice.field_key);
          return field ? (
            <div key={field.field_key}>
              <Label>
                {field.label}
                {choice.is_required && (
                  <span className="text-destructive"> *</span>
                )}
              </Label>
              <PreviewControl field={field} />
            </div>
          ) : null;
        })}
      </div>
    </aside>
  );
}

/**
 * One disabled control per field type, matching what `PartnerField` renders in the portal.
 *
 * LA-1.4 criterion 6 is "the preview matches the partner's view exactly", and the preview used to
 * render **every** field as a disabled text box — so a single-select looked identical to a phone
 * number, and Ray could not tell from the preview whether he had picked the right field type. It
 * said "The Partner Portal will show exactly these fields" while showing something else.
 *
 * The durable fix is to share `PartnerField` itself. It is a clean presentational function and
 * belongs in a module both sides import; it is not extracted here only because
 * `partner-portal-workspace.tsx` was being edited by another session at the time. Until then,
 * `partnerFormStudioPreviewTypes` below lists what this preview handles and a test asserts it stays
 * equal to the full field-type set, so a new type cannot be added without this being updated.
 */
function PreviewControl({ field }: { field: TemplateField }) {
  const shared = "mt-1 w-full rounded-md border bg-background px-3 text-sm text-muted-foreground";

  if (field.type === "boolean" || field.type === "single_select" || field.type === "multi_select") {
    const options =
      field.type === "boolean" ? ["Yes", "No"] : (field.options ?? []).map(String);
    return (
      <select disabled aria-label={field.label} className={cn(shared, "h-9")} defaultValue="">
        <option value="">
          {field.type === "multi_select" ? "Select one or more" : "Select an option"}
        </option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (field.type === "long_text") {
    return <textarea disabled aria-label={field.label} rows={3} className={cn(shared, "py-2")} />;
  }

  return (
    <Input
      disabled
      className="mt-1"
      type={field.type === "date" ? "date" : "text"}
      placeholder={
        field.type === "phone"
          ? "(555) 123-4567"
          : field.validation?.placeholder ??
            (field.type === "ssn"
              ? "###-##-####"
              : field.type === "currency"
                ? "$0.00"
                : field.type === "number"
                  ? "0"
                  : field.type === "email"
                    ? "name@example.com"
                    : field.label)
      }
    />
  );
}

/** The field types `PreviewControl` renders deliberately. Asserted against TEMPLATE_FIELD_TYPES. */
export const partnerFormStudioPreviewTypes = [
  "text",
  "long_text",
  "number",
  "date",
  "currency",
  "phone",
  "email",
  "ssn",
  "boolean",
  "single_select",
  "multi_select",
] as const;
