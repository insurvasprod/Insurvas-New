"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_MIN } from "@/lib/tenantAuth/securityRules";
import { cn } from "@/lib/utils";

/**
 * Four bars and a word: length first, then variety, so a long passphrase reads as strong. The only
 * rule the server enforces is PASSWORD_MIN characters ("length, not complexity rules", LA-8.2); the
 * bars beyond that are encouragement, never a gate.
 */
export function passwordStrength(password: string): { level: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { level: 0, label: `At least ${PASSWORD_MIN} characters` };
  if (password.length < PASSWORD_MIN) {
    const left = PASSWORD_MIN - password.length;
    return { level: 1, label: `${left} more character${left === 1 ? "" : "s"}` };
  }
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  if (password.length >= 16 && kinds >= 3) return { level: 4, label: "Very strong" };
  if (password.length >= 16 || kinds >= 3) return { level: 3, label: "Strong" };
  return { level: 2, label: "Good" };
}

export const passwordLongEnough = (password: string) => password.length >= PASSWORD_MIN;

/**
 * The one new-password field (redesign, 2026-10-24): sign-up and choosing a password from an invite or
 * a reset link read the same rule, show the same meter and offer the same show/hide button, so the
 * four different rule lists the audit found are one.
 */
export function NewPasswordField({
  id,
  label = "Password",
  value,
  onChange,
  name,
  autoFocus = false,
  inputClassName,
}: {
  id: string;
  label?: string;
  value: string;
  onChange: (next: string) => void;
  name?: string;
  autoFocus?: boolean;
  inputClassName?: string;
}) {
  const [show, setShow] = useState(false);
  const strength = passwordStrength(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          required
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={`${id}-strength`}
          className={cn("pr-11", inputClassName)}
        />
        <button type="button" className="portal-auth-visibility" onClick={() => setShow((current) => !current)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
          {show ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1 pt-1" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cn(
              "h-1 rounded-full transition-colors duration-200",
              bar > strength.level ? "bg-border" : strength.level === 1 ? "bg-[var(--error)]" : strength.level === 2 ? "bg-[var(--warning)]" : "bg-[var(--success)]",
            )}
          />
        ))}
      </div>
      <p id={`${id}-strength`} aria-live="polite" className={cn("text-xs leading-normal", strength.level === 1 ? "text-[var(--error-ink)]" : strength.level >= 3 ? "text-[var(--success-ink)]" : "text-muted-foreground")}>
        {strength.label}
      </p>
    </div>
  );
}
