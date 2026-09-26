"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Check, CheckCircle2, Send, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PartnerChatPanel } from "@/components/partner/partner-chat-panel";
import { PartnerLeadPipeline } from "@/components/partner/partner-lead-pipeline";
import { PartnerPortalOverview } from "@/components/partner/partner-portal-overview";
import { PartnerSettingsWorkspace } from "@/components/partner/partner-settings-workspace";
import { PartnerTeamWorkspace } from "@/components/partner/partner-team-workspace";
import { PartnerTeamReviewWorkspace } from "@/components/partner/partner-team-review-workspace";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { agoLabel } from "@/lib/format/ago";
import { productLineLabel } from "@/lib/format/productLine";
import { outstandingSubmitItems } from "@/lib/partnerPortal/submitReadiness";
import {
  isPhoneTemplateField,
  type TemplateField,
  type TemplateRow,
} from "@/lib/templates/constants";
import {
  pruneHiddenTemplateValues,
  templateFormFieldVisible,
} from "@/lib/templates/visibility";
import {
  BANK_ACCOUNT_MAX_DIGITS,
  DERIVED_AGE_KEY,
  ageFromDob,
  bankFormatError,
  dobFieldKey,
} from "@/lib/templates/formats";
import { effectiveTemplateForm } from "@/lib/templates/sectionAvailability";

type ApprovedProduct = { code: string; name: string; category: string };
type PartnerMarket = {
  carrier_id: string;
  carrier_name: string;
  state: string;
};

function PartnerField({
  field,
  value,
  error,
  onChange,
  onBlur,
  id,
  labelId,
  readOnly,
}: {
  field: TemplateField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  onBlur?: () => void;
  id?: string;
  labelId?: string;
  /** A derived value (age, from the date of birth) is shown, not typed. */
  readOnly?: boolean;
}) {
  if (field.type === "boolean")
    return (
      <select id={id}
        aria-label={field.label}
        aria-invalid={Boolean(error)}
        className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        value={value === undefined ? "" : String(value)}
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? undefined
              : event.target.value === "true",
          )
        }
        onBlur={onBlur}
      >
        <option value="">Choose…</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  if (field.type === "single_select")
    return (
      <select id={id}
        aria-label={field.label}
        aria-invalid={Boolean(error)}
        className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value || undefined)}
        onBlur={onBlur}
      >
        <option value="">Choose…</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  if (field.type === "multi_select")
    return (
      <div id={id} role="group" aria-labelledby={labelId}
        aria-label={labelId ? undefined : field.label}
        className="flex flex-wrap gap-3 rounded-md border p-2"
      >
        {field.options.map((option) => (
          <label className="flex items-center gap-1 text-sm" key={option}>
            <input
              type="checkbox"
              checked={Array.isArray(value) && value.includes(option)}
              onChange={(event) =>
                onChange([
                  ...(Array.isArray(value) ? value : []).filter(
                    (item) => item !== option,
                  ),
                  ...(event.target.checked ? [option] : []),
                ])
              }
            />
            {option}
          </label>
        ))}
      </div>
    );
  if (field.type === "long_text")
    return (
      <textarea id={id}
        aria-label={field.label}
        aria-invalid={Boolean(error)}
        className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    );
  const inputType =
    field.type === "number" || field.type === "currency"
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "phone"
          ? "tel"
          : field.type === "email"
            ? "email"
            : "text";
  const updateInput = (raw: string) => {
    if (raw === "") return onChange(undefined);
    // Routing and account numbers are digits only (LA-1.4-6); the checksum is checked on blur.
    if (field.type === "bank_routing" || field.type === "bank_account")
      return onChange(raw.replace(/\D/g, "").slice(0, field.type === "bank_routing" ? 9 : BANK_ACCOUNT_MAX_DIGITS) || undefined);
    if (field.type === "ssn") {
      const digits = raw.replace(/\D/g, "").slice(0, field.validation?.digit_length ?? 9);
      const mask = field.validation?.format_mask ?? "###-##-####";
      let index = 0;
      const formatted = mask
        .split("")
        .map((character) => {
          if (character !== "#") return index > 0 && index < digits.length ? character : "";
          const digit = digits[index];
          index += 1;
          return digit ?? "";
        })
        .join("");
      return onChange(formatted);
    }
    return onChange(
      ["number", "currency"].includes(field.type) ? Number(raw) : raw,
    );
  };
  return (
    <Input id={id}
      aria-label={field.label}
      aria-invalid={Boolean(error)}
      type={inputType}
      inputMode={field.type === "ssn" || field.type === "bank_routing" || field.type === "bank_account" ? "numeric" : undefined}
      readOnly={readOnly}
      step={
        field.type === "currency"
          ? 1
          : field.type === "number"
            ? "any"
            : undefined
      }
      value={value === undefined ? "" : String(value)}
      placeholder={field.validation?.placeholder ?? undefined}
      onChange={(event) => updateInput(event.target.value)}
      onInput={
        field.type === "date"
          ? (event) => updateInput(event.currentTarget.value)
          : undefined
      }
      onBlur={onBlur}
    />
  );
}

/**
 * The form definition the settings preview hands the partner form (LA-1.4-5): the same renderer the
 * partner uses, fed the owner's draft instead of the partner API. In preview nothing is fetched or
 * saved, screening is simulated as clear, and Submit only validates.
 */
export type PartnerFormPreviewSource = {
  template: TemplateRow;
  tenant_template_id: string;
  assignment: { definition_version: number };
};

export function PartnerLeadForm({
  productCode,
  productName,
  partnerStatus,
  agencyName,
  onFormVersion,
  market,
  draftId: resumeDraftId = null,
  onDraftChange,
  preview,
}: {
  productCode: string;
  productName: string;
  partnerStatus: "draft" | "active" | "paused" | "offboarded";
  /** Accepted for the caller's convenience; the form no longer names the partner. */
  partnerName?: string;
  agencyName?: string | null;
  onFormVersion?: (version: number | null) => void;
  market: PartnerMarket;
  /** LA-1.6-5: the saved draft this form resumes; null starts a new form. */
  draftId?: string | null;
  /** Told the draft's id after each save (null once it has been submitted). */
  onDraftChange?: (draftId: string | null) => void;
  /** Settings → Form templates renders this same form from the owner's unsaved draft. */
  preview?: PartnerFormPreviewSource;
}) {
  type FormTemplate = {
    template: TemplateRow;
    tenant_template_id: string;
    assignment: { definition_version: number };
  };
  type ScreeningState = {
    outcome: string;
    warning: { code: "dnc" | "internal_dq"; message: string } | null;
    phone: string | null;
    cached?: boolean;
    checked_at?: string;
  };
  type RejectionNotice = { code: string; count: number; script: string };
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const submissionId = useRef(crypto.randomUUID());
  // The draft this form writes to. It starts as the resumed draft (or none) and is set by the first
  // save of a new form, so every later save updates that one draft instead of starting another.
  const draftIdRef = useRef<string | null>(resumeDraftId);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const valuesRef = useRef<Record<string, unknown>>({});
  const dirtyRef = useRef(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState("Loading form…");
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [screening, setScreening] = useState<ScreeningState | null>(null);
  const [screeningBusy, setScreeningBusy] = useState(false);
  const screeningRequestActive = useRef(false);
  const lastScreenedPhone = useRef<string | null>(null);
  const [screeningError, setScreeningError] = useState<string | null>(null);
  const [rejectionNotice, setRejectionNotice] =
    useState<RejectionNotice | null>(null);
  const [dncAcknowledged, setDncAcknowledged] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState<
    Array<{ leadId: string; matchedOn: string[] }>
  >([]);
  const [duplicateJustification, setDuplicateJustification] = useState("");
  const [sectionIndex, setSectionIndex] = useState(0);
  const [formRefresh, setFormRefresh] = useState(0);
  // The rest of the form opens once the number has been screened (and a DNC warning acknowledged).
  // After that it stays open: changing the number re-screens it in place, as the board draws it.
  const [formOpened, setFormOpened] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);
  const consentRef = useRef<HTMLInputElement>(null);
  const [screenedAt, setScreenedAt] = useState<number | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [duplicateCheck, setDuplicateCheck] = useState<{
    signature: string;
    state: "clear" | "match" | "unavailable";
    /** The newest match: when, whether this team sent it, and (only then) how it ended. */
    latest?: { submittedAt: string; yours: boolean; outcome: string | null } | null;
  } | null>(null);
  const router = useRouter();
  // "18 seconds ago" has to keep counting while the page is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(clock);
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (!dirtyRef.current) setFormRefresh((value) => value + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  // Preview: the owner's draft is the form; answers typed so far are kept and pruned against it.
  useEffect(() => {
    if (!preview) return;
    // Syncing from a prop the settings page owns: each new draft replaces the form and re-prunes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplate(preview);
    onFormVersion?.(preview.assignment.definition_version);
    const pruned = pruneHiddenTemplateValues(effectiveTemplateForm(preview.template.form_definition, preview.template.fields), valuesRef.current);
    valuesRef.current = pruned;
    setValues(pruned);
    setStatus((current) => (current.startsWith("Loading") ? "Enter a phone number to begin screening" : current));
  }, [preview, onFormVersion]);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    void Promise.all([
      fetch(`/api/partner/forms/${encodeURIComponent(productCode)}`, {
        cache: "no-store",
      }),
      // LA-1.6-5: this form's own draft, or none for a new form (never "whichever draft is newest").
      fetch(
        `/api/partner/forms/${encodeURIComponent(productCode)}/draft?${draftIdRef.current ? `draft_id=${encodeURIComponent(draftIdRef.current)}` : "new=1"}`,
        { cache: "no-store" },
      ),
    ])
      .then(async ([formResponse, draftResponse]) => ({
        form: await formResponse.json().catch(() => null),
        draft: await draftResponse.json().catch(() => null),
        formResponse,
        draftResponse,
      }))
      .then(({ form, draft, formResponse, draftResponse }) => {
        if (cancelled) return;
        if (!formResponse.ok) {
          setStatus(form?.error ?? "This product form is unavailable");
          onFormVersion?.(null);
          return;
        }
        // The resumed draft is gone (submitted or discarded elsewhere): carry on as a new form.
        if (draftIdRef.current && !draftResponse.ok) {
          draftIdRef.current = null;
          onDraftChange?.(null);
        }
        // New forms use the current authenticated resolver. A resumed draft uses the immutable
        // profile revision returned by the draft endpoint, so an agent change cannot rewrite an
        // in-progress submission. Hidden values are still pruned against that saved snapshot.
        const draftTemplate =
          draftResponse.ok && draft?.draft && draft.template
            ? (draft.template as FormTemplate)
            : null;
        const nextTemplate = (draftTemplate ?? form.template) as FormTemplate;
        const nextValues =
          draftResponse.ok &&
          draft?.draft?.payload &&
          typeof draft.draft.payload === "object"
            ? pruneHiddenTemplateValues(
                nextTemplate.template.form_definition,
                draft.draft.payload as Record<string, unknown>,
              )
            : {};
        setTemplate(nextTemplate);
        onFormVersion?.(nextTemplate.assignment.definition_version);
        const savedAt =
          draftResponse.ok && draft?.draft?.updated_at
            ? Date.parse(String(draft.draft.updated_at))
            : NaN;
        setDraftSavedAt(Number.isFinite(savedAt) ? savedAt : null);
        setValues(nextValues);
        valuesRef.current = nextValues;
        // A reload (the tab regaining focus) can bring back answers without the number that was
        // screened. The screening result belongs to that number, so it does not survive the swap.
        const reloadedPhoneKey = nextTemplate.template.fields.find(isPhoneTemplateField)?.field_key;
        if (
          lastScreenedPhone.current !== null &&
          String((reloadedPhoneKey && nextValues[reloadedPhoneKey]) ?? "") !== lastScreenedPhone.current
        ) {
          lastScreenedPhone.current = null;
          setScreening(null);
          setScreenedAt(null);
          setDncAcknowledged(false);
          setConsentGiven(false);
        }
        setStatus(
          draftResponse.ok && draft?.draft
            ? "Draft resumed — screen the phone number to continue"
            : "Enter a phone number to begin screening",
        );
      })
      .catch(() => {
        if (!cancelled) setStatus("Could not load this form");
      });
    return () => {
      cancelled = true;
    };
  }, [productCode, formRefresh, onFormVersion, onDraftChange, preview]);

  const persistDraft = useCallback(
    (payload: Record<string, unknown>, visibleStatus = true) => {
    const saveDraftNow = async () => {
      if (!template) return;
      if (preview) {
        if (visibleStatus) setStatus("Preview: drafts are not saved");
        return;
      }
      setSaving(true);
      try {
        const response = await fetch(
          `/api/partner/forms/${encodeURIComponent(productCode)}/draft`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payload,
              carrier_id: market.carrier_id,
              carrier_state: market.state,
              draft_id: draftIdRef.current,
            }),
          },
        );
        const saved = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
        if (response.ok) {
          dirtyRef.current = false;
          if (saved?.id && saved.id !== draftIdRef.current) draftIdRef.current = saved.id;
          onDraftChange?.(draftIdRef.current);
          setDraftSavedAt(Date.now());
          if (visibleStatus) setStatus("Draft saved");
        } else if (response.status === 404 && draftIdRef.current) {
          // The draft was submitted or discarded in another tab: the next save starts a new one.
          draftIdRef.current = null;
          onDraftChange?.(null);
          if (visibleStatus) setStatus(saved?.error ?? "Draft could not be saved");
        } else if (visibleStatus) {
          setStatus("Draft could not be saved");
          notify.fail("Draft could not be saved");
        }
      } catch {
        if (visibleStatus) {
          setStatus("Draft could not be saved");
          notify.fail("Draft could not be saved");
        }
      } finally {
        setSaving(false);
      }
    };
      // Saves run one after another, so a new form's first save hands its draft id to the next
      // one instead of two overlapping saves each starting a draft.
      const run = saveQueue.current.then(saveDraftNow);
      saveQueue.current = run.catch(() => undefined);
      return run;
    },
    [template, productCode, market, preview, onDraftChange],
  );

  useEffect(() => {
    if (!template || !dirtyRef.current || preview) return;
    const timer = window.setTimeout(() => {
      void persistDraft(valuesRef.current);
    }, 750);
    return () => window.clearTimeout(timer);
  }, [values, template, productCode, persistDraft, preview]);

  useEffect(() => {
    if (!template || preview) return;
    const flush = () => {
      if (dirtyRef.current) void persistDraft(valuesRef.current, false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onPageHide = () => {
      if (!dirtyRef.current) return;
      void fetch(
        `/api/partner/forms/${encodeURIComponent(productCode)}/draft`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payload: valuesRef.current,
            carrier_id: market.carrier_id,
            carrier_state: market.state,
            draft_id: draftIdRef.current,
          }),
          keepalive: true,
        },
      );
    };
    const interval = window.setInterval(flush, 30000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [template, productCode, market, persistDraft, preview]);

  const fields = template
    ? new Map(template.template.fields.map((field) => [field.field_key, field]))
    : new Map<string, TemplateField>();
  // The sections of switched-off section groups never show (LA-1.4-3). The partner API already
  // removes them; the preview's draft form is filtered here by the same function.
  const sections = template ? effectiveTemplateForm(template.template.form_definition, template.template.fields).sections : [];
  // Age is derived from the date of birth, never typed (LA-1.4-6).
  const dobKey = template ? dobFieldKey(template.template.fields) : null;
  const derivedAge = dobKey ? ageFromDob(values[dobKey]) : null;
  const phoneField = template?.template.fields.find(isPhoneTemplateField);
  function isEmpty(value: unknown) {
    return (
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    );
  }
  function validateField(fieldKey: string, candidate = values) {
    const field = fields.get(fieldKey);
    const formField = sections
      .flatMap((section) => section.fields)
      .find((item) => item.field_key === fieldKey);
    if (!field || !formField || !templateFormFieldVisible(formField, candidate))
      return null;
    const value = candidate[fieldKey];
    if ((field.is_required || formField.is_required) && isEmpty(value))
      return `${field.label} is required`;
    if (isEmpty(value)) return null;
    if (
      ["text", "long_text", "date", "phone", "email", "ssn", "bank_routing", "bank_account"].includes(
        field.type,
      ) &&
      typeof value !== "string"
    )
      return `${field.label} must be text`;
    const bankError = typeof value === "string" ? bankFormatError(field, value) : null;
    if (bankError) return bankError;
    if (
      ["number", "currency"].includes(field.type) &&
      (typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.type === "currency" && !Number.isInteger(value)))
    )
      return `${field.label} must be a valid ${field.type === "currency" ? "integer-cent amount" : "number"}`;
    if (field.type === "email" && !/^\S+@\S+\.\S+$/.test(value as string))
      return `${field.label} must be a valid email address`;
    if (
      field.type === "phone" &&
      (value as string).replace(/\D/g, "").length < 10
    )
      return `${field.label} must include at least 10 digits`;
    if (field.type === "ssn" && !/^\d{3}-?\d{2}-?\d{4}$/.test(value as string))
      return `${field.label} must be a valid SSN`;
    if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value as string))
      return `${field.label} must be a valid date`;
    if (
      field.type === "single_select" &&
      (typeof value !== "string" || !field.options.includes(value))
    )
      return `${field.label} must use one of the listed options`;
    if (
      field.type === "multi_select" &&
      (!Array.isArray(value) ||
        value.some(
          (item) => typeof item !== "string" || !field.options.includes(item),
        ))
    )
      return `${field.label} contains an invalid option`;
    const validation = field.validation ?? {};
    const numeric = typeof value === "number" ? value : null;
    if (
      numeric !== null &&
      ((validation.min !== undefined && numeric < validation.min) ||
        (validation.max !== undefined && numeric > validation.max))
    )
      return `${field.label} is outside its allowed range`;
    if (
      typeof value === "string" &&
      ((validation.min_length !== undefined &&
        value.length < validation.min_length) ||
        (validation.max_length !== undefined &&
          value.length > validation.max_length))
    )
      return `${field.label} has an invalid length`;
    if (
      typeof value === "string" &&
      validation.pattern &&
      !new RegExp(validation.pattern).test(value)
    )
      return `${field.label} has an invalid format`;
    return null;
  }
  function validateRequired(candidate = values) {
    const next: Record<string, string> = {};
    for (const section of sections)
      for (const formField of section.fields) {
        const field = fields.get(formField.field_key);
        if (
          field &&
          templateFormFieldVisible(formField, candidate) &&
          (field.is_required || formField.is_required) &&
          isEmpty(candidate[field.field_key])
        )
          next[field.field_key] = `${field.label} is required`;
      }
    return next;
  }
  function validateAll() {
    const next: Record<string, string> = {};
    for (const section of sections)
      for (const formField of section.fields) {
        const error = validateField(formField.field_key);
        if (error) next[formField.field_key] = error;
      }
    return next;
  }
  function updateValue(fieldKey: string, value: unknown) {
    const next = pruneHiddenTemplateValues(
      template?.template.form_definition ?? { sections: [] },
      { ...valuesRef.current, [fieldKey]: value },
    );
    // A form with its own Age field has it filled from the date of birth (LA-1.4-6).
    if (fieldKey === dobKey && fields.has(DERIVED_AGE_KEY)) {
      const age = ageFromDob(value);
      if (age === null) delete next[DERIVED_AGE_KEY];
      else next[DERIVED_AGE_KEY] = age;
    }
    valuesRef.current = next;
    dirtyRef.current = true;
    setValues(next);
    setFieldErrors((current) => {
      if (!current[fieldKey]) return current;
      const errors = { ...current };
      delete errors[fieldKey];
      return errors;
    });
    setSubmitError(null);
    if (phoneField?.field_key === fieldKey) {
      submissionId.current = crypto.randomUUID();
      lastScreenedPhone.current = null;
      setRejectionNotice(null);
      setConsentGiven(false);
      if (screening) {
        setScreening(null);
        setScreenedAt(null);
        setDncAcknowledged(false);
        setScreeningError(
          "The phone number changed. Screen it again before continuing.",
        );
        setStatus("Screen the updated phone number to continue");
      }
    }
  }
  function blurField(fieldKey: string) {
    const error = validateField(fieldKey);
    setFieldErrors((current) => {
      const next = { ...current };
      if (error) next[fieldKey] = error;
      else delete next[fieldKey];
      return next;
    });
  }
  async function runScreening() {
    if (!phoneField) {
      setScreeningError("This form has no phone field configured");
      return;
    }
    const error = validateField(phoneField.field_key);
    if (error) {
      setFieldErrors((current) => ({ ...current, [phoneField.field_key]: error }));
      setScreeningError("Enter a valid phone number before screening");
      return;
    }
    const phoneValue = String(valuesRef.current[phoneField.field_key] ?? "");
    if (
      screeningRequestActive.current ||
      (lastScreenedPhone.current === phoneValue && screening)
    )
      return;
    if (preview) {
      // Nothing is screened from the settings preview: it shows what a clear number opens.
      lastScreenedPhone.current = phoneValue;
      const checked = new Date();
      setScreening({ outcome: "clear", warning: null, phone: phoneValue, checked_at: checked.toISOString() });
      setScreenedAt(checked.getTime());
      setFormOpened(true);
      setStatus("Preview: screening is simulated as clear");
      return;
    }
    screeningRequestActive.current = true;
    setScreeningBusy(true);
    setScreeningError(null);
    setSubmitError(null);
    try {
      const response = await fetch(
        `/api/partner/forms/${encodeURIComponent(productCode)}/screen`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            phone: valuesRef.current[phoneField.field_key],
            submission_id: submissionId.current,
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setScreening(null);
        setRejectionNotice(
          body?.code === "tcpa_block"
            ? {
                code: body.code,
                count: Number(body.blocked_count ?? 0),
                script: String(body.neutral_end_call_script ?? ""),
              }
            : null,
        );
        setScreeningError(body?.error ?? "Screening could not be completed");
        setStatus(
          body?.blocked
            ? "Submission is blocked until the phone number is cleared"
            : "Screening failed",
        );
        return;
      }
      setRejectionNotice(null);
      lastScreenedPhone.current = phoneValue;
      setScreening(body);
      const checkedAt = Date.parse(String(body.checked_at ?? ""));
      setScreenedAt(Number.isFinite(checkedAt) ? checkedAt : null);
      setDncAcknowledged(false);
      if (!body.warning || body.warning.code !== "dnc") setFormOpened(true);
      setStatus(
        body.warning
          ? "Review the compliance warning to continue"
          : "Screening passed — complete the form",
      );
    } catch {
      setScreening(null);
      setScreeningError(
        "Phone screening could not be completed. Check your connection and try again.",
      );
      setStatus("Screening failed");
    } finally {
      screeningRequestActive.current = false;
      setScreeningBusy(false);
    }
  }
  async function screenPhone(event: FormEvent) {
    event.preventDefault();
    await runScreening();
  }
  const requiredErrors = validateRequired(values);
  const requiredFieldCount = sections
    .flatMap((section) => section.fields)
    .filter((formField) => {
      const field = fields.get(formField.field_key);
      return (
        field &&
        templateFormFieldVisible(formField, values) &&
        (field.is_required || formField.is_required)
      );
    }).length;
  const completedRequiredFieldCount = Math.max(
    0,
    requiredFieldCount - Object.keys(requiredErrors).length,
  );
  // The fields a duplicate is matched on. Their values are the signature: the check runs again only
  // when one of them changes, and only once the number has been screened.
  const duplicateKeys = template
    ? template.template.fields
        .filter(
          (field) =>
            isPhoneTemplateField(field) ||
            field.type === "ssn" ||
            ["full_name", "name", "first_name", "last_name"].includes(
              field.field_key,
            ),
        )
        .map((field) => field.field_key)
    : [];
  const duplicateSignature =
    formOpened && screening
      ? JSON.stringify(
          Object.fromEntries(
            duplicateKeys.map((key) => [key, values[key] ?? null]),
          ),
        )
      : null;
  useEffect(() => {
    if (!duplicateSignature || preview) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(
        `/api/partner/forms/${encodeURIComponent(productCode)}/duplicates`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: JSON.parse(duplicateSignature) }),
          signal: controller.signal,
        },
      )
        .then(async (response) => ({
          ok: response.ok,
          body: (await response.json().catch(() => null)) as {
            checked?: boolean;
            matched?: boolean;
            latest?: { submittedAt: string; yours: boolean; outcome: string | null } | null;
          } | null,
        }))
        .then(({ ok, body }) =>
          setDuplicateCheck({
            signature: duplicateSignature,
            state:
              !ok || !body?.checked
                ? "unavailable"
                : body.matched
                  ? "match"
                  : "clear",
            latest: body?.latest ?? null,
          }),
        )
        .catch(() => {
          if (!controller.signal.aborted)
            setDuplicateCheck({
              signature: duplicateSignature,
              state: "unavailable",
            });
        });
    }, 900);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [duplicateSignature, productCode, preview]);
  const duplicateState = !duplicateSignature
    ? "idle"
    : duplicateCheck?.signature === duplicateSignature
      ? duplicateCheck.state
      : "checking";
  // A match found early asks for the reason before submit, not after a refused one. The server
  // still decides (10–1000 characters, stored with the lead).
  // An internal DQ (the number is already on one of the agency's leads) needs the same reason.
  const internalDqFlagged = screening?.warning?.code === "internal_dq";
  const duplicateFlagged = duplicateMatches.length > 0 || duplicateState === "match" || internalDqFlagged;
  const duplicateReasonReady = !duplicateFlagged || duplicateJustification.trim().length >= 10;
  const matchLatest = duplicateState === "match" && duplicateCheck?.signature === duplicateSignature ? duplicateCheck?.latest ?? null : null;
  const fieldsLeft = Math.max(0, requiredFieldCount - completedRequiredFieldCount);
  const progressPercent = requiredFieldCount === 0 ? null : Math.round((completedRequiredFieldCount / requiredFieldCount) * 100);
  const canSubmit = Boolean(
    partnerStatus === "active" &&
    consentGiven &&
    screening &&
    (!screening.warning ||
      screening.warning.code !== "dnc" ||
      dncAcknowledged) &&
    Object.keys(requiredErrors).length === 0 &&
    duplicateReasonReady,
  );
  // LA-1.6-7: what is still keeping Submit disabled, by name, in the order the form asks for it.
  const outstanding = outstandingSubmitItems({
    screened: Boolean(screening),
    dncPending: screening?.warning?.code === "dnc" && !dncAcknowledged,
    missingRequired: sections
      .flatMap((section) => section.fields)
      .filter((item) => requiredErrors[item.field_key])
      .map((item) => fields.get(item.field_key)?.label ?? item.field_key),
    duplicateReasonMissing: !duplicateReasonReady,
    consentGiven,
  });
  async function saveAndClose() {
    if (preview) return;
    await persistDraft(valuesRef.current);
    // persistDraft clears the dirty flag only when the server stored the draft.
    if (!dirtyRef.current) router.push("/partner");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const errors = validateAll();
    if (Object.keys(errors).length) {
      const first = sections.findIndex((section) =>
        section.fields.some((item) => errors[item.field_key]),
      );
      if (first >= 0) setSectionIndex(first);
      setFieldErrors(errors);
      setSubmitError("Complete the highlighted fields before submitting");
      setStatus("Complete the highlighted fields");
      return;
    }
    if (!screening) {
      setSubmitError("Screen the phone number before submitting");
      return;
    }
    if (!consentGiven) {
      setSubmitError("Confirm the customer's documented consent before submitting");
      consentRef.current?.focus();
      return;
    }
    setFieldErrors({});
    setSubmitError(null);
    if (preview) {
      setStatus("Preview: this form would submit. Nothing was sent.");
      notify.done("Preview: every check passed. Nothing was submitted");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/partner/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_code: productCode,
          carrier_id: market.carrier_id,
          carrier_state: market.state,
          values: valuesRef.current,
          submission_id: submissionId.current,
          screening_warning_acknowledged: dncAcknowledged,
          duplicate_override_justification: duplicateJustification,
          consent_attested: consentGiven,
          draft_id: draftIdRef.current,
        }),
      });
      const body = await response.json().catch(() => null);
      setSaving(false);
      if (!response.ok) {
        const message = body?.error ?? "Could not submit lead";
        if (body?.code === "duplicate_lead") {
          setDuplicateMatches(body.matches ?? []);
          setSubmitError(
            "This person may already be in the pipeline. Review the match and add a justification if this is a separate lead.",
          );
          setStatus("Duplicate review required");
        } else if (body?.code === "internal_dq_reason_required") {
          setSubmitError(message);
          setStatus("Duplicate review required");
        } else {
          setRejectionNotice(
            body?.code === "tcpa_block"
              ? {
                  code: body.code,
                  count: Number(body.blocked_count ?? 0),
                  script: String(body.neutral_end_call_script ?? ""),
                }
              : null,
          );
          setSubmitError(message);
          setStatus(message);
        }
        notify.fail(message);
        return;
      }
      setValues({});
      valuesRef.current = {};
      dirtyRef.current = false;
      setFieldErrors({});
      setDuplicateMatches([]);
      setDuplicateJustification("");
      setScreening(null);
      setScreenedAt(null);
      setDncAcknowledged(false);
      setConsentGiven(false);
      setFormOpened(false);
      setDraftSavedAt(null);
      // The submitted draft is deleted server-side; the next form starts a new one.
      draftIdRef.current = null;
      onDraftChange?.(null);
      submissionId.current = crypto.randomUUID();
      setSectionIndex(0);
      setStatus(body?.replayed ? "Already submitted" : "Submitted");
      notify.win(
        body?.replayed
          ? "This lead was already submitted"
          : "Lead submitted to the agent",
      );
    } catch {
      setSaving(false);
      setSubmitError(
        "Could not submit lead. Check your connection and try again.",
      );
      setStatus("Submission failed");
      notify.fail("Could not submit lead");
    }
  }
  const loading = status.startsWith("Loading");
  if (!template)
    return (
      <div
        className="portal-partner-submit-panel is-roomy portal-partner-submit-empty"
        role={loading ? undefined : "status"}
        aria-busy={loading || undefined}
      >
        <h2>{loading ? "Loading lead form…" : "Lead form not ready"}</h2>
        <p>
          {loading
            ? "Preparing the secure phone screening step."
            : "Your agent needs to configure this product form before this partner can submit a lead."}
        </p>
        {!loading && (
          <Button asChild variant="outline">
            <Link href="/partner/messages">Message your agent</Link>
          </Button>
        )}
      </div>
    );
  if (!phoneField)
    return (
      <p className="text-sm text-[var(--error-ink)]" role="alert">
        This form is missing its configured phone field.
      </p>
    );
  const dncPending = screening?.warning?.code === "dnc" && !dncAcknowledged;
  const activeSection = sections[sectionIndex] ?? sections[0];
  const visibleRequired = (section: typeof activeSection) =>
    section.fields.filter((item) => {
      const field = fields.get(item.field_key);
      return (
        field &&
        templateFormFieldVisible(item, values) &&
        (field.is_required || item.is_required)
      );
    });
  // Green only when genuinely satisfied: a section nobody has touched is not complete, even when it
  // has no required fields.
  const sectionComplete = (section: typeof activeSection) =>
    Boolean(
      section &&
      section.fields.some(
        (item) =>
          templateFormFieldVisible(item, values) &&
          !isEmpty(values[item.field_key]),
      ) &&
      visibleRequired(section).every(
        (item) => !validateField(item.field_key, values),
      ),
    );
  const steps = [
    ...sections.map((section, index) => ({
      key: section.section_key,
      label: section.label,
      left: formOpened ? visibleRequired(section).filter((item) => requiredErrors[item.field_key]).length : 0,
      current: formOpened && index === sectionIndex,
      complete: formOpened && index !== sectionIndex && sectionComplete(section),
      select: () => setSectionIndex(index),
    })),
    {
      key: "consent",
      label: "Consent",
      left: 0,
      current: false,
      complete: consentGiven,
      select: () => document.getElementById(`partner-consent-${productCode}`)?.focus(),
    },
  ];
  const phoneHint = screeningBusy
    ? "Screening this number…"
    : screening
      ? `Screened on blur. ${
          screening.warning
            ? screening.warning.code === "dnc"
              ? dncAcknowledged
                ? "DNC warning acknowledged"
                : "DNC warning — acknowledge it to continue"
              : "Internal warning noted"
            : "DNC/TCPA clear"
        }${screenedAt ? ` — checked ${agoLabel(screenedAt, now)}` : ""}.`
      : "Screened on blur. Leave this field to check the number.";
  const phoneTone: ChipTone =
    screeningBusy || !screening
      ? "neutral"
      : screening.warning
        ? "warning"
        : "success";
  const phoneLabel = screeningBusy
    ? "Screening…"
    : !screening
      ? "Not yet"
      : screening.warning
        ? screening.warning.code === "dnc"
          ? dncAcknowledged
            ? "DNC acknowledged"
            : "Needs acknowledgement"
          : "Internal warning"
        : "DNC/TCPA clear";
  const duplicateTone: ChipTone =
    duplicateMatches.length || duplicateState === "match"
      ? "warning"
      : duplicateState === "clear"
        ? "success"
        : "neutral";
  const duplicateLabel = duplicateMatches.length
    ? "Review match"
    : duplicateState === "match"
      ? "Possible match"
      : duplicateState === "clear"
        ? "No match"
        : duplicateState === "checking"
          ? "Checking…"
          : duplicateState === "unavailable"
            ? "Runs on submit"
            : "Not yet";
  const warningBlock = screening?.warning && (
    <div className="portal-partner-submit-callout is-warning">
      <p className="font-medium">Compliance warning</p>
      <p>{screening.warning.message}</p>
      {screening.warning.code === "dnc" && (
        <label className="portal-remember-me">
          <input
            type="checkbox"
            checked={dncAcknowledged}
            onChange={(event) => {
              setDncAcknowledged(event.target.checked);
              if (event.target.checked) setFormOpened(true);
            }}
          />
          I acknowledge this DNC warning and want to continue with the
          customer-initiated submission.
        </label>
      )}
    </div>
  );
  const rejectionBlock = rejectionNotice && (
    <div className="portal-partner-submit-callout is-error" role="alert">
      <p className="font-medium">Submission blocked</p>
      <p>
        Compliance code:{" "}
        <span className="font-mono">{rejectionNotice.code.toUpperCase()}</span>.
        No lead was created.
      </p>
      <p>
        Blocked submissions for this partner:{" "}
        <strong>{rejectionNotice.count}</strong>
      </p>
      {rejectionNotice.script && (
        <p>
          <span className="font-medium">Suggested neutral close:</span> “
          {rejectionNotice.script}”
        </p>
      )}
      <p className="portal-partner-submit-muted">
        Only a coded result and count are shown. Blocked phone numbers are not
        listed.
      </p>
    </div>
  );
  const renderField = (formField: (typeof activeSection.fields)[number]) => {
    const field = fields.get(formField.field_key);
    if (!field || !templateFormFieldVisible(formField, values)) return null;
    const error = fieldErrors[field.field_key];
    const fieldId = `partner-field-${productCode}-${field.field_key}`;
    const fieldLabelId = `${fieldId}-label`;
    const isGroup = field.type === "multi_select";
    const isPhone = field.field_key === phoneField.field_key;
    return (
      <div
        className={`portal-partner-submit-field${isGroup || field.type === "long_text" ? " is-wide" : ""}`}
        key={formField.field_key}
        onBlur={() => {
          blurField(field.field_key);
          if (isPhone && !isEmpty(valuesRef.current[field.field_key]))
            void runScreening();
        }}
      >
        <label id={fieldLabelId} htmlFor={isGroup ? undefined : fieldId}>
          {field.label}
          {(field.is_required || formField.is_required) && (
            <span className="portal-partner-submit-required"> *</span>
          )}
        </label>
        <PartnerField
          id={fieldId}
          labelId={fieldLabelId}
          field={field}
          value={field.field_key === DERIVED_AGE_KEY && dobKey ? derivedAge ?? undefined : values[field.field_key]}
          error={error}
          readOnly={field.field_key === DERIVED_AGE_KEY && Boolean(dobKey)}
          onChange={(value) => updateValue(field.field_key, value)}
        />
        {isPhone ? (
          <small>{phoneHint}</small>
        ) : field.field_key === dobKey && derivedAge !== null ? (
          <small>Age {derivedAge}{field.help_text ? ` · ${field.help_text}` : ""}</small>
        ) : field.field_key === DERIVED_AGE_KEY && dobKey ? (
          <small>Worked out from the date of birth.</small>
        ) : (
          field.help_text && <small>{field.help_text}</small>
        )}
        {error && (
          <p className="portal-partner-submit-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  };
  return (
    <>
      <ol
        className="portal-partner-submit-panel portal-partner-submit-stepper"
        aria-label="Form progress"
      >
        {steps.map((step, index) => (
          <Fragment key={step.key}>
            {index > 0 && (
              <li
                aria-hidden="true"
                className={`portal-partner-submit-step-line${steps[index - 1].complete ? " is-complete" : ""}`}
              />
            )}
            <li>
              <button
                type="button"
                className={
                  step.current
                    ? "is-current"
                    : step.complete
                      ? "is-complete"
                      : undefined
                }
                aria-current={step.current ? "step" : undefined}
                disabled={!formOpened}
                onClick={step.select}
              >
                <span className="portal-partner-submit-step-dot">
                  {step.complete ? (
                    <Check aria-hidden="true" strokeWidth={3} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span>
                  {step.label}
                  {step.left > 0 && <small className="block text-[12px] font-normal text-[var(--warning-ink)]">{step.left} left</small>}
                </span>
                {step.complete && <span className="sr-only"> (complete)</span>}
              </button>
            </li>
          </Fragment>
        ))}
      </ol>
      <div className="portal-partner-submit-body">
        <form
          className="portal-partner-submit-main"
          onSubmit={(event) => (formOpened ? submit(event) : screenPhone(event))}
        >
          <p className="sr-only" role="status">
            {status}
          </p>
          {!formOpened ? (
            <section className="portal-partner-submit-panel is-roomy">
              <div className="portal-partner-submit-panel-head">
                <h2>Phone screening</h2>
                <p>
                  The number is checked against DNC and TCPA lists before the
                  rest of the form opens. Screening starts when you leave a
                  valid number.
                </p>
              </div>
              <div className="portal-partner-submit-fields">
                <div className="portal-partner-submit-field">
                  <label htmlFor={`screen-phone-${productCode}`}>
                    {phoneField.label}
                    <span className="portal-partner-submit-required"> *</span>
                  </label>
                  <PartnerField
                    id={`screen-phone-${productCode}`}
                    field={phoneField}
                    value={values[phoneField.field_key]}
                    error={fieldErrors[phoneField.field_key]}
                    onChange={(value) => updateValue(phoneField.field_key, value)}
                    onBlur={() => {
                      void runScreening();
                    }}
                  />
                  <small>{phoneHint}</small>
                  {fieldErrors[phoneField.field_key] && (
                    <p className="portal-partner-submit-error" role="alert">
                      {fieldErrors[phoneField.field_key]}
                    </p>
                  )}
                </div>
              </div>
              {screeningError && (
                <p className="portal-partner-submit-error" role="alert">
                  {screeningError}
                </p>
              )}
              {rejectionBlock}
              {warningBlock}
              <div>
                <Button type="submit" variant="outline" disabled={screeningBusy}>
                  {screeningBusy ? "Screening…" : "Screen phone number"}
                </Button>
              </div>
            </section>
          ) : (
            activeSection && (
              <section
                className="portal-partner-submit-panel is-roomy"
                aria-labelledby={`partner-section-${productCode}`}
              >
                <div className="portal-partner-submit-panel-head">
                  <h2 id={`partner-section-${productCode}`}>
                    {activeSection.label}
                  </h2>
                  <p>
                    {(() => {
                      const left = visibleRequired(activeSection).filter((item) => requiredErrors[item.field_key]).length;
                      return left ? `${left} required ${left === 1 ? "field" : "fields"} left in this section. Required fields are marked *.` : "Every required field in this section is filled.";
                    })()}
                  </p>
                </div>
                <div className="portal-partner-submit-fields">
                  {activeSection.fields.map(renderField)}
                </div>
                {screeningError && (
                  <p className="portal-partner-submit-error" role="alert">
                    {screeningError}
                  </p>
                )}
                {rejectionBlock}
                {dncPending && warningBlock}
              </section>
            )
          )}
          {formOpened && duplicateFlagged && (
            <div className="portal-partner-submit-callout is-warning">
              <p className="font-medium">
                {matchLatest
                  ? `This person was submitted ${agoLabel(new Date(matchLatest.submittedAt).getTime(), now)} ${matchLatest.yours ? "by your team" : "from another source"}`
                  : "This person may already be in the pipeline"}
              </p>
              <p>
                {duplicateMatches.length > 0
                  ? `${duplicateMatches.length} existing lead${duplicateMatches.length === 1 ? "" : "s"} matched on ${duplicateMatches.flatMap((match) => match.matchedOn).join(", ")}.`
                  : duplicateState === "match"
                    ? "The phone and name match an existing lead."
                    : "This phone number is already on an existing lead."}
                {matchLatest?.yours && matchLatest.outcome ? ` Outcome: ${matchLatest.outcome}.` : ""}
                {" "}To submit anyway, say why. It is required and stored with the lead.
              </p>
              <label htmlFor={`duplicate-justification-${productCode}`}>
                Why this is a separate lead
              </label>
              <textarea
                id={`duplicate-justification-${productCode}`}
                maxLength={1000}
                value={duplicateJustification}
                onChange={(event) =>
                  setDuplicateJustification(event.target.value)
                }
              />
              <p className="portal-partner-submit-muted">
                At least 10 characters are required and the reason is stored
                with the lead.
              </p>
            </div>
          )}
          <section className="portal-partner-submit-panel is-roomy portal-partner-submit-consent">
            <label>
              <input
                ref={consentRef}
                id={`partner-consent-${productCode}`}
                type="checkbox"
                checked={consentGiven}
                onChange={(event) => setConsentGiven(event.target.checked)}
              />
              <span>
                The customer gave express written consent to be contacted by a
                licensed agent at the number above, by phone and by SMS, about
                insurance products. I hold documentation of that consent and
                understand every submission is audit logged.
              </span>
            </label>
            <p>
              Consent is never pre-ticked, and the timestamp is recorded with
              the lead.
            </p>
          </section>
          {submitError && (
            <p className="portal-partner-submit-error" role="alert">
              {submitError}
            </p>
          )}
          <div className="portal-partner-submit-actions">
            <Button
              type="button"
              variant="outline"
              disabled={!formOpened || sectionIndex === 0}
              onClick={() => setSectionIndex((index) => Math.max(0, index - 1))}
            >
              Previous
            </Button>
            <span>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => void persistDraft(valuesRef.current)}
              >
                Save draft
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={saving || !formOpened}
                onClick={() => void saveAndClose()}
              >
                Save and close
              </Button>
              <Button
                type="submit"
                disabled={saving || !canSubmit}
                aria-describedby={formOpened && !canSubmit && outstanding.length ? `partner-outstanding-${productCode}` : undefined}
              >
                {formOpened && fieldsLeft > 0
                  ? `Submit · ${fieldsLeft} ${fieldsLeft === 1 ? "field" : "fields"} left`
                  : "Submit lead"}
              </Button>
            </span>
          </div>
          {formOpened && !canSubmit && outstanding.length > 0 && (
            <p id={`partner-outstanding-${productCode}`} className="portal-partner-submit-muted">
              Still needed to submit: {outstanding.join(", ")}.
            </p>
          )}
        </form>
        <aside
          className="portal-partner-submit-panel portal-partner-submit-readiness"
          aria-label="Submission readiness"
        >
          <div className="portal-partner-submit-panel-head">
            <h2>Submission readiness</h2>
            <p>Each check turns green once it is actually done.</p>
          </div>
          <dl className="portal-partner-submit-checks">
            <div>
              <dt>Progress</dt>
              <dd>
                <ReadinessChip tone={progressPercent === 100 ? "success" : progressPercent ? "warning" : "neutral"}>
                  {progressPercent == null ? "No required fields" : `${progressPercent}%`}
                </ReadinessChip>
              </dd>
            </div>
            <div>
              <dt>Phone screened</dt>
              <dd>
                <ReadinessChip tone={phoneTone}>{phoneLabel}</ReadinessChip>
              </dd>
            </div>
            <div>
              <dt>Required fields</dt>
              <dd>
                <ReadinessChip
                  tone={
                    requiredFieldCount === 0 || completedRequiredFieldCount === 0
                      ? "neutral"
                      : completedRequiredFieldCount === requiredFieldCount
                        ? "success"
                        : "warning"
                  }
                >
                  {requiredFieldCount === 0
                    ? "None required"
                    : `${completedRequiredFieldCount} of ${requiredFieldCount}`}
                </ReadinessChip>
              </dd>
            </div>
            <div>
              <dt>Duplicate check</dt>
              <dd>
                <ReadinessChip tone={duplicateTone}>{duplicateLabel}</ReadinessChip>
              </dd>
            </div>
            <div>
              <dt>Consent captured</dt>
              <dd>
                <ReadinessChip tone={consentGiven ? "success" : "neutral"}>
                  {consentGiven ? "Yes" : "Not yet"}
                </ReadinessChip>
              </dd>
            </div>
          </dl>
          <dl className="portal-partner-submit-facts">
            <div>
              <dt>Product</dt>
              <dd>{productName}</dd>
            </div>
            <div>
              <dt>Form version</dt>
              <dd>v{template.assignment.definition_version}</dd>
            </div>
            <div>
              <dt>Agency</dt>
              <dd>{agencyName ?? "Your agent"}</dd>
            </div>
            <div>
              <dt>Draft saved</dt>
              <dd>{draftSavedAt ? agoLabel(draftSavedAt, now) : "Not yet"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </>
  );
}

type ChipTone = "success" | "warning" | "neutral";

/** One started form, as GET /api/partner/drafts lists it (LA-1.6-5). */
type PartnerDraftRow = {
  id: string;
  product_code: string;
  carrier_id: string | null;
  carrier_state: string | null;
  label: string | null;
  phone_last4: string | null;
  answered: number;
  updated_at: string;
};

function ReadinessChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className={`portal-status-chip is-${tone}`}>
      <span aria-hidden="true" />
      {children}
    </span>
  );
}

/** "Term life also available." — the other products the agent approved, in one line. */
function alsoAvailable(products: ApprovedProduct[], selected: string) {
  const others = products
    .filter((product) => product.code !== selected)
    .map((product, index) => {
      const label = productLineLabel(product.code);
      return index > 0 && /^[A-Z][a-z]/.test(label)
        ? label[0].toLowerCase() + label.slice(1)
        : label;
    });
  if (!others.length) return null;
  const list =
    others.length === 1
      ? others[0]
      : `${others.slice(0, -1).join(", ")} and ${others.at(-1)}`;
  return `${list} also available.`;
}

export type PartnerPortalSection =
  "overview" | "submit" | "pipeline" | "team" | "team-review" | "messages" | "settings";

function LegacyPartnerPortalWorkspace({
  role,
  partnerStatus,
  section,
  partnerName,
  agencyName,
}: {
  role: PartnerRole;
  partnerStatus: "draft" | "active" | "paused" | "offboarded";
  section: PartnerPortalSection;
  partnerName?: string;
  agencyName?: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  // Until the product list answers, the page cannot say "no products": it says it is loading.
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [formVersion, setFormVersion] = useState<number | null>(null);
  const [approvedProducts, setApprovedProducts] = useState<ApprovedProduct[]>(
    [],
  );
  const [selectedProduct, setSelectedProduct] = useState("");
  const [markets, setMarkets] = useState<PartnerMarket[]>([]);
  const [selectedCarrierId, setSelectedCarrierId] = useState("");
  const [selectedState, setSelectedState] = useState("");
  // LA-1.6-5: every started form, and which one the form below is working on. resumeDraftId picks
  // what the form loads (and remounts it); activeDraftId only follows its saves.
  const [drafts, setDrafts] = useState<PartnerDraftRow[]>([]);
  const [draftsLoadedAt, setDraftsLoadedAt] = useState(0);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [formNonce, setFormNonce] = useState(0);
  const loadDrafts = useCallback(() => {
    void fetch("/api/partner/drafts", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json().catch(() => null)) as { drafts?: PartnerDraftRow[] } | null) : null))
      .then((body) => {
        if (!body?.drafts) return;
        setDrafts(body.drafts);
        setDraftsLoadedAt(Date.now());
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (section === "submit") loadDrafts();
  }, [section, loadDrafts]);
  const onDraftChange = useCallback((id: string | null) => {
    setActiveDraftId(id);
    loadDrafts();
  }, [loadDrafts]);
  function startNewForm() {
    setResumeDraftId(null);
    setActiveDraftId(null);
    setFormNonce((value) => value + 1);
  }
  function resumeDraft(draft: PartnerDraftRow) {
    const market = markets.find((item) => item.carrier_id === draft.carrier_id && item.state === draft.carrier_state);
    setSelectedProduct(draft.product_code);
    setFormVersion(null);
    if (market) {
      setSelectedCarrierId(market.carrier_id);
      setSelectedState(market.state);
    }
    setResumeDraftId(draft.id);
    setActiveDraftId(draft.id);
    setFormNonce((value) => value + 1);
  }
  async function discardDraft(draft: PartnerDraftRow) {
    const response = await fetch(`/api/partner/drafts?draft_id=${encodeURIComponent(draft.id)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      notify.fail("That draft could not be discarded");
      return;
    }
    notify.win("Draft discarded");
    if (draft.id === activeDraftId) startNewForm();
    loadDrafts();
  }

  useEffect(() => {
    let cancelled = false;
    const productRequest =
      section === "submit"
        ? fetch("/api/partner/products", { cache: "no-store" })
        : Promise.resolve(null);
    const marketRequest =
      section === "submit"
        ? fetch("/api/partner/markets", { cache: "no-store" })
        : Promise.resolve(null);
    Promise.all([
      Promise.resolve(productRequest),
      Promise.resolve(marketRequest),
    ])
      .then(async ([productResponse, marketResponse]) => ({
        productResponse,
        marketResponse,
        productBody: productResponse
          ? await productResponse.json().catch(() => null)
          : null,
        marketBody: marketResponse
          ? await marketResponse.json().catch(() => null)
          : null,
      }))
      .then(({ productResponse, productBody, marketResponse, marketBody }) => {
        if (cancelled) return;
        setProductsLoaded(true);
        if (productResponse) {
          if (productResponse.ok) {
            setApprovedProducts(productBody?.products ?? []);
            setSelectedProduct(productBody?.products?.[0]?.code ?? "");
          } else
            setError(productBody?.error ?? "Could not load approved products");
        }
        if (marketResponse) {
          if (marketResponse.ok) {
            const next = marketBody?.markets ?? [];
            setMarkets(next);
            setSelectedCarrierId(next[0]?.carrier_id ?? "");
            setSelectedState(next[0]?.state ?? "");
          } else
            setError(marketBody?.error ?? "Could not load available markets");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setProductsLoaded(true);
        setError("Could not load approved products");
      });
    return () => {
      cancelled = true;
    };
  }, [section]);

  return (
    <div className="m-stagger mx-auto w-full max-w-7xl space-y-8">
      {section === "overview" && (
        <section id="overview" className="scroll-mt-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent-ink)]">
                Partner workspace
              </p>
              <h1 className="mt-1 text-2xl font-semibold leading-[1.21] tracking-[-0.02em]">
                Partner operations
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Submit leads, follow their progress, and manage the people who
                work them.
              </p>
            </div>
            <Button asChild>
              <a href="#submit">
                <Send className="mr-1.5 size-4" aria-hidden="true" />
                Submit a new lead
              </a>
            </Button>
          </div>
          {error && (
            <div
              role="status"
              className="mt-4 rounded-lg border border-[var(--color-danger)]/40 p-3 text-sm text-[var(--color-danger)]"
            >
              {error}
            </div>
          )}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <a
              href="#submit"
              className="rounded-lg border bg-card p-4 transition-colors hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Send
                className="size-5 text-[var(--color-blue)]"
                aria-hidden="true"
              />
              <p className="mt-3 font-semibold">Submit leads</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the form configured by your agent.
              </p>
            </a>
            <a
              href="#pipeline"
              className="rounded-lg border bg-card p-4 transition-colors hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CheckCircle2
                className="size-5 text-[var(--color-success)]"
                aria-hidden="true"
              />
              <p className="mt-3 font-semibold">Track pipeline</p>
              <p className="mt-1 text-sm text-muted-foreground">
                See what is new, claimed, and submitted.
              </p>
            </a>
            <a
              href="#team"
              className="rounded-lg border bg-card p-4 transition-colors hover:border-[var(--color-blue)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Users
                className="size-5 text-[var(--color-blue)]"
                aria-hidden="true"
              />
              <p className="mt-3 font-semibold">Manage team</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Invite partner users inside this account.
              </p>
            </a>
          </div>
        </section>
      )}
      {section === "submit" && (
        <section id="submit" className="portal-partner-submit-shell scroll-mt-6">
          <PageHeader
            eyebrow="Partner workspace"
            title="Submit a lead"
            description="Complete the agent-approved form for one product. Screening happens before the lead is sent."
          />
          {partnerStatus !== "active" && (
            <div
              className="portal-partner-submit-restriction"
              role="status"
            >
              <p className="font-medium">
                New submissions are disabled while this partner account is{" "}
                {partnerStatus}.
              </p>
              <p>
                Your existing lead history remains available in Pipeline.
                Contact your agent if this status needs to change.
              </p>
            </div>
          )}
          {!productsLoaded ? (
            <div
              className="portal-partner-submit-panel portal-partner-submit-loading"
              aria-busy="true"
              aria-label="Loading approved products"
            >
              <span />
              <span />
            </div>
          ) : approvedProducts.length > 0 ? (
            <>
              <div className="portal-partner-submit-panel portal-partner-submit-product-bar">
                <div className="portal-partner-submit-product-row">
                  <label className="portal-partner-submit-select">
                    <span>Product</span>
                    <select
                      value={selectedProduct}
                      onChange={(event) => {
                        setSelectedProduct(event.target.value);
                        setFormVersion(null);
                        setResumeDraftId(null);
                        setActiveDraftId(null);
                      }}
                    >
                      {approvedProducts.map((product) => (
                        <option key={product.code} value={product.code}>
                          {productLineLabel(product.code)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {formVersion !== null && (
                    <span className="portal-status-chip">Form v{formVersion}</span>
                  )}
                  {alsoAvailable(approvedProducts, selectedProduct) && (
                    <p>
                      {alsoAvailable(approvedProducts, selectedProduct)}{" "}
                      <strong>Switching products clears entered answers.</strong>
                    </p>
                  )}
                </div>
                {markets.length > 1 && (
                  <div className="portal-partner-submit-product-row">
                    <label className="portal-partner-submit-select">
                      <span>Carrier</span>
                      <select
                        value={selectedCarrierId}
                        onChange={(event) => {
                          const carrierId = event.target.value;
                          setSelectedCarrierId(carrierId);
                          setResumeDraftId(null);
                          setActiveDraftId(null);
                          setSelectedState(
                            markets.find(
                              (market) => market.carrier_id === carrierId,
                            )?.state ?? "",
                          );
                        }}
                      >
                        <option value="" disabled>
                          Select carrier
                        </option>
                        {Array.from(
                          new Map(
                            markets.map((market) => [
                              market.carrier_id,
                              market.carrier_name,
                            ]),
                          ).entries(),
                        ).map(([carrierId, carrierName]) => (
                          <option key={carrierId} value={carrierId}>
                            {carrierName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="portal-partner-submit-select is-narrow">
                      <span>Carrier state</span>
                      <select
                        value={selectedState}
                        onChange={(event) => {
                          setSelectedState(event.target.value);
                          setResumeDraftId(null);
                          setActiveDraftId(null);
                        }}
                        disabled={!selectedCarrierId}
                      >
                        <option value="" disabled>
                          Select state
                        </option>
                        {markets
                          .filter(
                            (market) => market.carrier_id === selectedCarrierId,
                          )
                          .map((market) => (
                            <option
                              key={`${market.carrier_id}:${market.state}`}
                              value={market.state}
                            >
                              {market.state}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p>
                      The carrier and state this lead is written for, from the
                      markets your agent opened to you.{" "}
                      <strong>Changing either clears entered answers.</strong>
                    </p>
                  </div>
                )}
              </div>
              {drafts.length > 0 && (
                <section
                  className="portal-partner-submit-panel is-roomy"
                  aria-labelledby="partner-drafts-heading"
                >
                  <div className="portal-partner-submit-panel-head">
                    <h2 id="partner-drafts-heading">Your drafts</h2>
                    <p>
                      Every form you have started and not submitted. Resume any
                      of them where you left off.
                    </p>
                  </div>
                  <ul className="divide-y divide-[var(--border)]">
                    {drafts.map((draft) => (
                      <li
                        key={draft.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-[var(--ink)]">
                            {draft.label ?? "Customer name not entered yet"}
                          </p>
                          <p className="portal-partner-submit-muted">
                            {productLineLabel(draft.product_code)}
                            {draft.carrier_state ? ` · ${draft.carrier_state}` : ""}
                            {draft.phone_last4 ? ` · phone ending ${draft.phone_last4}` : ""}
                            {` · ${draft.answered} ${draft.answered === 1 ? "answer" : "answers"} · saved ${agoLabel(Date.parse(draft.updated_at), draftsLoadedAt)}`}
                          </p>
                        </div>
                        <span className="flex flex-wrap gap-2">
                          {draft.id === activeDraftId ? (
                            <span className="portal-status-chip is-success">
                              <span aria-hidden="true" />
                              Open below
                            </span>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => resumeDraft(draft)}
                            >
                              Resume
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void discardDraft(draft)}
                          >
                            Discard
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div>
                    <Button type="button" variant="outline" size="sm" onClick={startNewForm}>
                      Start a new form
                    </Button>
                  </div>
                </section>
              )}
              {selectedProduct && selectedCarrierId && selectedState && (
                <PartnerLeadForm
                  key={`${selectedProduct}:${selectedCarrierId}:${selectedState}:${resumeDraftId ?? "new"}:${formNonce}`}
                  draftId={resumeDraftId}
                  onDraftChange={onDraftChange}
                  productCode={selectedProduct}
                  productName={productLineLabel(selectedProduct)}
                  partnerStatus={partnerStatus}
                  partnerName={partnerName}
                  agencyName={agencyName}
                  onFormVersion={setFormVersion}
                  market={markets.find(
                    (market) =>
                      market.carrier_id === selectedCarrierId &&
                      market.state === selectedState,
                  )!}
                />
              )}
              {!markets.length && (
                <div className="portal-partner-submit-panel is-roomy portal-partner-submit-empty" role="status">
                  <h2>No markets are open yet</h2>
                  <p>
                    Your agent has not enabled any carrier and state
                    combinations for this partner yet. Contact your agent to
                    request market access.
                  </p>
                  <Button asChild variant="outline">
                    <Link href="/partner/messages">Message your agent</Link>
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="portal-partner-submit-panel is-roomy portal-partner-submit-empty" role="status">
              <h2>No products are enabled yet</h2>
              <p>
                Your agent controls which products and forms this partner can
                submit. Ask them to approve a product, then return here to
                submit leads.
              </p>
              <Button asChild variant="outline">
                <Link href="/partner/messages">Message your agent</Link>
              </Button>
            </div>
          )}
        </section>
      )}
      {section === "pipeline" && (
        <section id="pipeline" className="scroll-mt-6">
          <PartnerLeadPipeline partnerStatus={partnerStatus} role={role} partnerName={partnerName} />
        </section>
      )}
      {section === "messages" && (
        <section id="messages" className="scroll-mt-6">
          <PartnerChatPanel role={role} />
        </section>
      )}
      {section === "settings" && (
        <section id="settings" className="scroll-mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Partner settings</CardTitle>
              <CardDescription>
                Account details and controls that are owned by the agent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Your access
                  </p>
                  <p className="mt-2 font-medium">
                    {role === "partner_admin"
                      ? "Partner admin"
                      : "Partner user"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your role controls what you can do in this portal.
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Agent-managed settings
                  </p>
                  <p className="mt-2 font-medium">
                    Products and commercial terms
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Contact your agent when these need to change.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

export function PartnerPortalWorkspace({
  role,
  partnerStatus,
  partnerId,
  partnerName,
  partnerTimezone,
  agencyName,
  section = "overview",
}: {
  role: PartnerRole;
  partnerStatus: "draft" | "active" | "paused" | "offboarded";
  partnerId?: string;
  partnerName?: string;
  partnerTimezone?: string;
  agencyName?: string | null;
  section?: PartnerPortalSection;
}) {
  useEffect(() => {
    const destinations: Record<string, string> = {
      "#overview": "/partner",
      "#submit": "/partner/submit-lead",
      "#pipeline": "/partner/pipeline",
      "#team": "/partner/team",
      "#team-review": "/partner/team-review",
      "#messages": "/partner/messages",
      "#settings": "/partner/settings",
    };
    function routeSection(event: MouseEvent) {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
        "a[href^='#']",
      );
      if (!anchor) return;
      const destination = destinations[anchor.getAttribute("href") ?? ""];
      if (!destination) return;
      event.preventDefault();
      window.location.assign(destination);
    }
    document.addEventListener("click", routeSection);
    return () => document.removeEventListener("click", routeSection);
  }, []);

  if (section === "overview")
    return <PartnerPortalOverview role={role} partnerStatus={partnerStatus} partnerName={partnerName} />;
  if (section === "team")
    return <PartnerTeamWorkspace role={role} partnerStatus={partnerStatus} partnerName={partnerName} />;
  if (section === "team-review")
    return <PartnerTeamReviewWorkspace partnerName={partnerName ?? "Partner organization"} />;
  if (section === "settings")
    return (
      <PartnerSettingsWorkspace
        role={role}
        partnerStatus={partnerStatus}
        partnerId={partnerId}
        partnerName={partnerName}
        partnerTimezone={partnerTimezone}
      />
    );
  return (
    <LegacyPartnerPortalWorkspace
      role={role}
      partnerStatus={partnerStatus}
      section={section}
      partnerName={partnerName}
      agencyName={agencyName}
    />
  );
}
