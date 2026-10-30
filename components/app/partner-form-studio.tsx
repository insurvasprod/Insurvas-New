"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Edit3,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { notify } from "@/lib/notify";
import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, cardInset } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { checkboxControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { DraftActions } from "@/components/app/settings/primitives";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FIELD_TYPE_LABELS,
  type TemplateField,
  type TemplateFieldType,
} from "@/lib/templates/constants";
import { cn } from "@/lib/utils";

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
  embedded = false,
  availableProducts,
}: {
  partnerId: string;
  target?: {
    userId: string;
    name: string;
    role: "partner_admin" | "partner_user";
  };
  readOnly?: boolean;
  compact?: boolean;
  /** Approved agency products from the publisher workspace, kept current as access changes. */
  availableProducts?: Array<{ code: string; name: string }>;
  /**
   * Drawn inside the publisher record's combined Products & forms workspace.
   * Drops this component's own card chrome and its title line, which otherwise read as a second
   * page nested in the first (owner, 2026-10-29). Unlike `compact` it hides no controls.
   */
  embedded?: boolean;
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
  const hasReceivedAvailableProducts = useRef(false);
  const hasLoadedInitialProducts = useRef(false);
  const formScope = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (
      code: string,
      { showLoading = true }: { showLoading?: boolean } = {},
    ) => {
      if (!code) {
        setLoading(false);
        return;
      }
      if (showLoading) setLoading(true);
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
      if (showLoading) setLoading(false);
    },
    [base, partnerId],
  );

  useEffect(() => {
    if (
      availableProducts !== undefined ||
      hasReceivedAvailableProducts.current ||
      hasLoadedInitialProducts.current
    ) return;
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
        // Approved for this partner AND sold by the agency (Settings › Products).
        .filter((item: Product) => item.approved !== false && (item as { is_enabled?: boolean }).is_enabled !== false)
        .map((item: Product) => ({
          code: item.code ?? item.product_code ?? "",
          name: item.name ?? item.product_name ?? item.code ?? "Product",
        }))
        .filter((item: { code: string }) => item.code);
      if (cancelled) return;
      hasLoadedInitialProducts.current = true;
      setProducts(next);
      const code = next[0]?.code ?? "";
      setProductCode(code);
      await load(code);
    })();
    return () => {
      cancelled = true;
    };
  }, [availableProducts, load, partnerId]);

  const catalog = useMemo(() => profile?.catalog ?? [], [profile?.catalog]);
  const fieldByKey = useMemo(
    () => new Map(catalog.map((field) => [field.field_key, field])),
    [catalog],
  );
  const dirty = useMemo(
    () => Boolean(profile) && (
      JSON.stringify(sorted(fields)) !== JSON.stringify(sorted(profile?.effective.fields ?? [])) ||
      JSON.stringify(sorted(verification)) !== JSON.stringify(sorted(profile?.effective.verification_fields ?? [])) ||
      sourcePreset !== null
    ),
    [fields, profile, sourcePreset, verification],
  );
  const formProducts = availableProducts ?? products;
  useEffect(() => {
    if (availableProducts === undefined) return;
    hasReceivedAvailableProducts.current = true;
    const next = availableProducts.filter((product) => product.code);
    // Retain names for a product that loses approval during an active editing session.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preserve labels while the controlled product list changes
    setProducts((current) => {
      const byCode = new Map(current.map((product) => [product.code, product]));
      let changed = false;
      for (const product of next) {
        if (byCode.get(product.code)?.name !== product.name) changed = true;
        byCode.set(product.code, product);
      }
      return changed ? [...byCode.values()] : current;
    });
    const activeIsApproved = next.some((product) => product.code === productCode);
    if (activeIsApproved) return;

    // Keep an edited form visible if approval is removed mid-session. The user can finish or
    // discard that draft, and the picker explains the access change without silently switching it.
    if (dirty && productCode) return;

    const nextCode = next[0]?.code ?? "";
    if (!nextCode) {
      if (productCode) {
        // The controlled approvals now have no selectable products; keep the editor draft intact.
        setProductCode("");
      }
      setLoading(false);
      return;
    }
    if (nextCode === productCode) return;
    setProductCode(nextCode);
    void load(nextCode);
  }, [availableProducts, dirty, load, productCode]);
  const activeProductName =
    formProducts.find((product) => product.code === productCode)?.name ??
    products.find((product) => product.code === productCode)?.name ??
    productCode;
  const productAccessRemoved =
    availableProducts !== undefined &&
    Boolean(productCode) &&
    !availableProducts.some((product) => product.code === productCode);
  const productOptions = useMemo(() => [
    ...(productAccessRemoved
      ? [{ value: productCode, label: activeProductName, description: "Approval removed · draft kept" }]
      : []),
    ...formProducts.map((product) => ({ value: product.code, label: product.name })),
  ], [activeProductName, formProducts, productAccessRemoved, productCode]);
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
  const contactOnly = async () => {
    const phone = catalog.find((field) => field.type === "phone");
    const email = catalog.find((field) => field.type === "email");
    const name =
      catalog.find((field) => field.field_key === "full_name") ??
      catalog.find((field) => field.field_key === "first_name") ??
      catalog.find((field) => field.type === "text");
    if (!phone)
      return notify.block("This product needs a phone field for screening");
    if (dirty) {
      const confirmed = await confirmAction({
        title: "Replace the current lead form?",
        description: `This replaces the ${activeProductName} lead fields with contact-only fields. The verification checklist stays as it is.`,
        confirmLabel: "Use contact-only fields",
        cancelLabel: "Keep current fields",
      });
      if (!confirmed) return;
    }
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
  const applyPreset = async (preset: Preset) => {
    if (dirty) {
      const confirmed = await confirmAction({
        title: "Replace unpublished form changes?",
        description: `${preset.name} replaces both the partner lead form and the agent verification checklist for ${activeProductName}.`,
        confirmLabel: "Apply template",
        cancelLabel: "Keep editing",
      });
      if (!confirmed) return;
    }
    setFields(sorted(preset.fields));
    setVerification(sorted(preset.verification_fields));
    setSourcePreset(preset);
    notify.done(`${preset.name} loaded — publish to apply it`);
  };

  async function publish(): Promise<boolean> {
    if (!productCode || !hasPhone(fields)) {
      notify.block("Phone is required for screening");
      return false;
    }
    setSaving(true);
    try {
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
      if (!response.ok) {
        notify.block(body?.error ?? "Could not publish form configuration");
        return false;
      }
      notify.done(
        `Published revision ${body.revision}. New partner forms use it immediately.`,
      );
      setSourcePreset(null);
      await load(productCode, { showLoading: false });
      return true;
    } catch {
      notify.block("Could not publish form configuration");
      return false;
    } finally {
      setSaving(false);
    }
  }
  function discardDraft() {
    if (!profile) return;
    setFields(sorted(profile.effective.fields));
    setVerification(sorted(profile.effective.verification_fields));
    setSourcePreset(null);
  }
  async function changeProduct(nextCode: string) {
    if (!nextCode || nextCode === productCode) return;
    if (dirty) {
      const confirmed = await confirmAction({
        title: "Discard unpublished form changes?",
        description: `Changes to ${activeProductName || "this product"} will be lost if you switch products now.`,
        confirmLabel: "Discard and switch",
        cancelLabel: "Keep editing",
        destructive: true,
      });
      if (!confirmed) return;
    }
    setSourcePreset(null);
    setProductCode(nextCode);
    void load(nextCode);
  }
  async function restoreInherited() {
    if (!target || !profile?.profile) return;
    const confirmed = await confirmAction({
      title: "Restore inherited defaults?",
      description: "This removes the custom form setup and returns this user to the partner defaults. Any unpublished edits will be discarded.",
      confirmLabel: "Restore defaults",
      cancelLabel: "Keep editing",
      destructive: true,
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const response = await fetch(
        `${base}?product_code=${encodeURIComponent(productCode)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not restore inherited defaults");
        return;
      }
      notify.done("Inherited defaults restored");
      setSourcePreset(null);
      await load(productCode);
    } catch {
      notify.block("Could not restore inherited defaults");
    } finally {
      setSaving(false);
    }
  }
  async function savePreset() {
    if (!presetName.trim() || !productCode || !hasPhone(fields))
      return notify.block("Enter a name and keep phone in the lead form");
    setSaving(true);
    try {
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
      if (!response.ok)
        return notify.block(body?.error ?? "Could not save template");
      setPresetOpen(false);
      setPresetName("");
      notify.done("Template saved");
      try {
        const refreshed = await fetch(
          `/api/app/partners/${partnerId}/form-presets?product_code=${encodeURIComponent(productCode)}`,
          { cache: "no-store" },
        );
        const refreshedBody = (await refreshed.json().catch(() => null)) as {
          presets?: Preset[];
          error?: string;
        } | null;
        if (refreshed.ok) setPresets(refreshedBody?.presets ?? []);
        else
          notify.fail(
            refreshedBody?.error ?? "Template saved, but the list could not be refreshed",
          );
      } catch {
        notify.fail("Template saved, but the list could not be refreshed");
      }
    } catch {
      notify.block("Could not save template. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }
  async function addField() {
    const key = newField.field_key || slug(newField.label);
    if (!productCode || !key || !newField.label.trim())
      return notify.block("Enter a field label");
    const validation = fieldValidation(newField);
    if (validation === null)
      return notify.block("Enter a valid document number length");
    setSaving(true);
    try {
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
      if (!response.ok) return notify.block(body?.error ?? "Could not add field");
      setFieldOpen(false);
      setNewField(emptyFieldDraft());
      setProfile((current) => current
        ? { ...current, catalog: [...current.catalog, body.field as TemplateField] }
        : current);
      setFields((current) => [
        ...current,
        {
          field_key: body.field.field_key,
          is_required: false,
          sort_order: current.length,
        },
      ]);
      notify.done("Field added to the catalog and this draft");
    } catch {
      notify.block("Could not add field. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
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
    try {
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
      if (!response.ok)
        return notify.block(body?.error ?? "Could not update form field");
      setEditFieldOpen(false);
      notify.done("Catalog field updated");
      setProfile((current) => current
        ? {
            ...current,
            catalog: current.catalog.map((field) =>
              field.field_key === editFieldKey ? body.field as TemplateField : field,
            ),
          }
        : current);
    } catch {
      notify.block("Could not update field. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteField(fieldKey: string) {
    if (!productCode) return;
    const field = fieldByKey.get(fieldKey);
    if (field?.type === "phone")
      return notify.block(
        "Phone is required for screening and cannot be deleted",
      );
    const confirmed = await confirmAction({
      title: "Delete this catalog field?",
      description: `${field?.label ?? "This field"} will be removed from the shared catalog for ${activeProductName} and from this form. Existing lead records stay unchanged.`,
      confirmLabel: "Delete field",
      cancelLabel: "Keep field",
      destructive: true,
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/app/partners/${partnerId}/form-catalog?product_code=${encodeURIComponent(productCode)}&field_key=${encodeURIComponent(fieldKey)}`,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok)
        return notify.block(body?.error ?? "Could not delete form field");
      setProfile((current) => current
        ? {
            ...current,
            catalog: current.catalog.filter((item) => item.field_key !== fieldKey),
            effective: {
              ...current.effective,
              fields: current.effective.fields.filter((item) => item.field_key !== fieldKey),
              verification_fields: current.effective.verification_fields.filter((item) => item.field_key !== fieldKey),
            },
          }
        : current);
      setFields((current) => current.filter((item) => item.field_key !== fieldKey));
      setVerification((current) => current.filter((item) => item.field_key !== fieldKey));
      setEditFieldOpen(false);
      notify.done("Field deleted from the shared catalog");
    } catch {
      notify.block("Could not delete field. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading)
    return (
      <SectionLoading rows={4} columns={3} label="Loading form setup" />
    );
  if (!formProducts.length && !productCode)
    return (
      <EmptyState
        title="No approved products to configure"
        hint="Approve at least one agency product above. Its form settings will appear here."
      />
    );
  return (
    <>
      <div ref={formScope}>
      <Card
        className={cn(
          "overflow-hidden",
          (compact || embedded) && "border-0 shadow-none",
          embedded && "bg-transparent",
        )}
      >
        <CardHeader
          className={cn(
            "gap-3 border-b bg-muted/10",
            compact && "px-0 pb-3 pt-0",
            // Only `embedded` loses the rule and the tint: the tab's own card already supplies both,
            // and `compact` (the per-user panel) is left exactly as it was.
            embedded && "border-b-0 bg-transparent px-0 pb-3 pt-0",
          )}
        >
          {!embedded && (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {target ? `Form setup · ${target.name}` : "Publisher form defaults"}
                </CardTitle>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  {target
                    ? <>Changes here override the admin&rsquo;s defaults.<InfoTip label="About overrides">Users who inherit update automatically when their admin&rsquo;s default changes.</InfoTip></>
                    : "Admins and users can override these."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={profile?.profile ? "info" : "neutral"}>
                  {profile?.profile ? "Custom configuration" : "Using tenant defaults"}
                </StatusChip>
                {dirty && <StatusChip tone="warning">Unpublished changes</StatusChip>}
                {target && profile?.profile && !readOnly && (
                  <Button type="button" size="sm" variant="outline" disabled={saving} onClick={() => void restoreInherited()}>
                    Restore inherited defaults
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {productOptions.length === 1 ? (
                <StatusChip tone="info" className="h-9 px-3">{productOptions[0].label}</StatusChip>
              ) : (
                <SelectMenu
                  label="Select product form"
                  value={productCode}
                  options={productOptions}
                  onChange={(value) => void changeProduct(value)}
                  disabled={saving}
                  searchPlaceholder="Search products"
                  className="w-64 max-w-full"
                  panelClassName="w-64 max-w-[calc(100vw-2rem)]"
                  panelAlign="start"
                />
              )}
              <Button type="button" size="sm" variant="outline" disabled={readOnly || saving} onClick={() => void contactOnly()}>
                Use contact-only fields
              </Button>
              {!compact && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={readOnly || saving}
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
                disabled={readOnly || saving}
                onClick={() => setPresetOpen(true)}
              >
                <Save className="mr-1 size-3.5" />
                Save as template
              </Button>
              )}
            </div>
            {embedded && (
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip tone={profile?.profile ? "info" : "neutral"}>
                  {profile?.profile ? "Custom configuration" : "Using tenant defaults"}
                </StatusChip>
                {productAccessRemoved && <StatusChip tone="warning">Approval removed · draft kept</StatusChip>}
                {dirty && <StatusChip tone="warning">Unpublished changes</StatusChip>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Editing {activeProductName || "this product"}. Publishing updates new partner submissions.
            </p>
            {presets.length ? (
              <SelectMenu
                label="Saved templates"
                value={sourcePreset?.id ?? ""}
                defaultValue=""
                options={[
                  { value: "", label: "Choose a template" },
                  ...presets.map((preset) => ({ value: preset.id, label: preset.name })),
                ]}
                onChange={(value) => {
                  const preset = presets.find((item) => item.id === value);
                  if (preset) void applyPreset(preset);
                }}
                disabled={readOnly || saving}
                searchPlaceholder="Search saved templates"
                className="w-auto min-w-48 max-w-full"
                panelAlign="start"
              />
            ) : (
              <span className="text-xs text-muted-foreground">No saved templates yet</span>
            )}
          </div>
        </CardHeader>
        <CardContent
          className={cn(
            "grid gap-6 p-4",
            (compact || embedded) && "gap-4 p-0",
          )}
        >
          <div className="min-w-0 space-y-5">
            <FieldList
              title="Partner lead form"
              description="Included fields appear to partners in this order."
              catalog={catalog}
              choices={fields}
              disabled={readOnly || saving}
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
              description="Internal fields agents use to verify a submitted lead."
              catalog={catalog}
              choices={verification}
              disabled={readOnly || saving}
              onChange={(key, checked) => change(key, checked, "verification")}
              onRequired={(key, checked) =>
                required(key, checked, "verification")
              }
              onMove={(key, direction) => move(key, direction, "verification")}
              onEdit={openEditField}
              onDelete={(key) => void deleteField(key)}
              locked={() => false}
              compact={compact}
              collapsible
            />
          </div>
          <Preview
            key={productCode}
            catalog={catalog}
            choices={fields}
            productName={activeProductName}
            compact={compact}
          />
        </CardContent>
      </Card>
      <SettingsSaveBar
        visible={dirty && !readOnly}
        note="Unpublished form changes · publishing updates new partner submissions"
      >
        <DraftActions
          dirty={dirty}
          saving={saving}
          onDiscard={discardDraft}
          onSave={() => void publish()}
          saveLabel="Publish changes"
        />
      </SettingsSaveBar>
      </div>
      <LeaveGuard
        dirty={dirty && !readOnly}
        scope={formScope}
        onSave={publish}
        onDiscard={discardDraft}
        what="this partner form"
      />
      <Dialog open={presetOpen} onOpenChange={(open) => { if (!saving) setPresetOpen(open); }}>
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
              autoFocus
              placeholder="Full intake"
              onChange={(event) => setPresetName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setPresetOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !presetName.trim() || !hasPhone(fields)}
              onClick={() => void savePreset()}
            >
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={fieldOpen} onOpenChange={(open) => { if (!saving) setFieldOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add shared field</DialogTitle>
            <DialogDescription>
              Add a reusable field to this product&rsquo;s catalog. It appears in this form now, and other partners can add it to theirs.
            </DialogDescription>
          </DialogHeader>
          <FieldEditorFields
            draft={newField}
            setDraft={setNewField}
            editing={false}
            disabled={saving}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setFieldOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={saving || !newField.label.trim()}
              onClick={() => void addField()}
            >
              Add field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={editFieldOpen} onOpenChange={(open) => { if (!saving) setEditFieldOpen(open); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit field</DialogTitle>
            <DialogDescription>
              Changes update the shared catalog for this product. Existing lead records keep their stored data.
            </DialogDescription>
          </DialogHeader>
          <FieldEditorFields
            draft={editField}
            setDraft={setEditField}
            editing
            disabled={saving}
          />
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setEditFieldOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={() => void updateField()}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
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
  disabled = false,
}: {
  draft: FieldDraft;
  setDraft: Dispatch<SetStateAction<FieldDraft>>;
  editing: boolean;
  disabled?: boolean;
}) {
  const update = (patch: Partial<FieldDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const isSelect =
    draft.type === "single_select" || draft.type === "multi_select";
  return (
    <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
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
        <SelectMenu
          id={`${editing ? "edit" : "new"}-field-type`}
          label="Field type"
          value={draft.type}
          options={TEMPLATE_FIELD_TYPES.map((type) => ({ value: type, label: displayFieldType(type) }))}
          onChange={(type) => update({ type })}
          disabled={disabled}
          searchPlaceholder="Search field types"
          className="w-full"
          panelAlign="start"
        />
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
          className={checkboxControl}
          checked={draft.is_required}
          onChange={(event) => update({ is_required: event.target.checked })}
        />
        Required by default
      </label>
    </fieldset>
  );
}

function FieldList({
  title,
  description,
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
  collapsible = false,
}: {
  title: string;
  description: string;
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
  collapsible?: boolean;
}) {
  const selected = new Map(choices.map((choice) => [choice.field_key, choice]));
  const selectedFields = sorted(choices)
    .map((choice) => catalog.find((field) => field.field_key === choice.field_key))
    .filter((field): field is TemplateField => Boolean(field));
  const availableFields = catalog.filter((field) => !selected.has(field.field_key));
  const [expanded, setExpanded] = useState(!collapsible);
  const rows = (items: TemplateField[]) => (
      <div className={cn("grid gap-2", !compact && "lg:grid-cols-2")}>
        {items.map((field) => {
          const choice = selected.get(field.field_key);
          const isLocked = locked(field.field_key);
          return (
            <div
              key={field.field_key}
              className={cn(cardInset, "flex min-h-12 min-w-0 items-center gap-2 px-2.5 py-1.5")}
            >
              {choice && (
                <input
                  aria-label={`Include ${field.label} in ${title}`}
                  type="checkbox"
                  className={checkboxControl}
                  checked
                  disabled={disabled || isLocked}
                  onChange={(event) => onChange(field.field_key, event.target.checked)}
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{field.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {displayFieldType(field.type)}
                  {field.type === "ssn" && field.validation?.digit_length
                    ? ` · ${field.validation.digit_length} digits`
                    : ""}
                  {isLocked ? " · required for screening" : ""}
                </p>
              </div>
              {choice ? (
                <>
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      aria-label={`Require ${field.label} in ${title}`}
                      type="checkbox"
                      className={checkboxControl}
                      checked={choice.is_required}
                      disabled={disabled || isLocked}
                      onChange={(event) =>
                        onRequired(field.field_key, event.target.checked)
                      }
                    />
                    Required
                  </label>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon-xs" variant="ghost" disabled={disabled} aria-label={`Actions for ${field.label}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(field)}>
                        <Edit3 aria-hidden="true" /> Edit field
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={disabled || choice.sort_order === 0} onSelect={() => onMove(field.field_key, -1)}>
                        <ChevronUp aria-hidden="true" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={disabled || choice.sort_order === choices.length - 1} onSelect={() => onMove(field.field_key, 1)}>
                        <ChevronDown aria-hidden="true" /> Move down
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={disabled || isLocked} onSelect={() => onDelete(field.field_key)}>
                        <Trash2 aria-hidden="true" /> Delete from catalog
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onChange(field.field_key, true)}>
                  <Plus aria-hidden="true" /> Add
                </Button>
              )}
            </div>
          );
        })}
      </div>
  );
  const heading = (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">
          {choices.length ? `${choices.length} included` : "None included"}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
    </div>
  );

  if (collapsible) {
    return (
      <section>
        <details
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
          className="group"
        >
          <summary className="mb-2 flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {heading}
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="space-y-3">
            {selectedFields.length ? rows(selectedFields) : (
              <p className="py-2 text-sm text-muted-foreground">No verification fields included yet.</p>
            )}
            {availableFields.length > 0 && (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-2 text-sm font-medium text-[var(--accent-ink)] outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Plus className="size-4" aria-hidden="true" />
                  Add fields
                  <span className="text-xs font-normal text-muted-foreground">{availableFields.length} available</span>
                  <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="pt-1">{rows(availableFields)}</div>
              </details>
            )}
          </div>
        </details>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-2">{heading}</div>
      <div className="space-y-3">
        {selectedFields.length ? rows(selectedFields) : (
          <p className="py-2 text-sm text-muted-foreground">No fields included yet.</p>
        )}
        {availableFields.length > 0 && (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-2 text-sm font-medium text-[var(--accent-ink)] outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Plus className="size-4" aria-hidden="true" />
              Add fields
              <span className="text-xs font-normal text-muted-foreground">{availableFields.length} available</span>
              <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="pt-1">{rows(availableFields)}</div>
          </details>
        )}
      </div>
    </section>
  );
}

function Preview({
  catalog,
  choices,
  productName,
  compact = false,
}: {
  catalog: TemplateField[];
  choices: Choice[];
  productName: string;
  compact?: boolean;
}) {
  const [showAll, setShowAll] = useState(true);
  const [sampleValues, setSampleValues] = useState<Record<string, string | string[]>>({});
  const fieldMap = new Map(catalog.map((field) => [field.field_key, field]));
  const orderedChoices = sorted(choices);
  const visibleChoices = showAll ? orderedChoices : orderedChoices.slice(0, 6);
  return (
    <section
      aria-label={`${productName || "Lead form"} partner preview`}
      className={cn(
        cardInset,
        "overflow-hidden border-[var(--border-strong)] bg-[var(--surface)]",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent-ink)]">
            Interactive partner preview
          </p>
          <h3 className="mt-1 text-base font-semibold text-[var(--ink)]">
            What partners will see
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {productName ? `${productName} lead form` : "Lead form"}. Try the fields here; sample entries stay in this preview and are never saved.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium tabular-nums text-[var(--ink)]">
            {choices.length} {choices.length === 1 ? "field" : "fields"}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setSampleValues({})}
            disabled={!Object.keys(sampleValues).length}
          >
            <RotateCcw aria-hidden="true" />
            Reset preview
          </Button>
        </div>
      </header>

      <div className={cn("p-4 sm:p-5", compact && "p-3 sm:p-4")}>
        {orderedChoices.length ? (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-[var(--ink)]">Lead details</h4>
              <p className="text-xs text-muted-foreground">
                <span className="text-destructive">*</span> Required to submit
              </p>
            </div>
            <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
              {visibleChoices.map((choice) => {
                const field = fieldMap.get(choice.field_key);
                if (!field) return null;
                const fullWidth = field.type === "long_text" || field.type === "multi_select";
                return (
                  <div
                    key={field.field_key}
                    className={cn("min-w-0", fullWidth && "sm:col-span-2")}
                  >
                    <Label className="text-[var(--ink)]">
                      {field.label}
                      {choice.is_required && (
                        <span className="text-destructive"> *</span>
                      )}
                    </Label>
                    <PreviewControl
                      field={field}
                      value={sampleValues[field.field_key]}
                      onChange={(value) => setSampleValues((current) => ({
                        ...current,
                        [field.field_key]: value,
                      }))}
                    />
                    {field.help_text && (
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {field.help_text}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            {orderedChoices.length > 6 && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-5"
                onClick={() => setShowAll((current) => !current)}
              >
                {showAll ? "Show fewer fields" : `Show all ${orderedChoices.length} fields`}
              </Button>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-8 text-center">
            <p className="text-sm font-medium text-[var(--ink)]">No fields in this partner form yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add fields above to see how the form will look to partners.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Interactive sample controls are local to the preview and never submit or persist values. */
function PreviewControl({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const shared = "mt-1 w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)]";

  if (field.type === "multi_select") {
    const options = (field.options ?? []).map(String);
    const selected = Array.isArray(value) ? value : [];
    return (
      <div
        aria-label={field.label}
        role="group"
        className="mt-1 flex min-h-10 flex-wrap gap-x-4 gap-y-2 rounded-md border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2"
      >
        {options.length ? options.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className={checkboxControl}
              checked={selected.includes(option)}
              onChange={(event) => onChange(
                event.target.checked
                  ? [...selected, option]
                  : selected.filter((item) => item !== option),
              )}
            />
            {option}
          </label>
        )) : (
          <span className="text-sm text-muted-foreground">No options configured</span>
        )}
      </div>
    );
  }

  if (field.type === "boolean" || field.type === "single_select") {
    const options = field.type === "boolean" ? ["Yes", "No"] : (field.options ?? []).map(String);
    return (
      <SelectMenu
        label={field.label}
        value={typeof value === "string" ? value : ""}
        defaultValue=""
        options={[
          { value: "", label: field.type === "boolean" ? "Choose…" : "Select an option" },
          ...options.map((option) => ({ value: option, label: option })),
        ]}
        onChange={onChange}
        searchPlaceholder={`Search ${field.label.toLowerCase()}`}
        className="mt-1 w-full"
        panelAlign="start"
      />
    );
  }

  if (field.type === "long_text") {
    return (
      <textarea
        aria-label={field.label}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className={cn(shared, "resize-y py-2 placeholder:text-muted-foreground")}
        placeholder={field.validation?.placeholder ?? field.label}
      />
    );
  }

  return (
    <Input
      aria-label={field.label}
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      className="mt-1 border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] placeholder:text-muted-foreground shadow-none"
      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
      placeholder={
        field.type === "phone"
          ? "(555) 123-4567"
          : field.validation?.placeholder ??
            (field.type === "ssn"
              ? "###-##-####"
              : field.type === "bank_routing"
                ? "9-digit routing number"
                : field.type === "bank_account"
                  ? "Account number"
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
  "bank_routing",
  "bank_account",
  "boolean",
  "single_select",
  "multi_select",
] as const;
