/** Small, pure formatting shared by every screen. Money never shows cents (owner rule); none of R1 shows money. */

export function firstName(name: string | null | undefined): string {
  return displayName((name ?? "").trim().split(/\s+/)[0] || "") || "there";
}

/**
 * A person's name as the screen shows it. Carrier files often send names in capitals ("JOSHUA
 * ANDERSON"); those read as shouting next to everything else, so an all-capitals name is shown in
 * title case (Mc/Mac and O' kept: "DWIGHT MCALLISTER" → "Dwight McAllister"). Mixed-case names, and
 * anything with a digit (a policy number standing in for a name), are left exactly as stored.
 */
export function displayName<T extends string | null | undefined>(name: T): T {
  if (!name || /[a-z\d]/.test(name) || !/[A-Z]{2}/.test(name)) return name;
  const word = (w: string) => {
    const lower = w.toLowerCase();
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    if (/^mc[a-z]{2,}/.test(lower)) return "Mc" + cap(lower.slice(2));
    if (/^o'[a-z]/.test(lower)) return "O'" + cap(lower.slice(2));
    return cap(lower);
  };
  return name.split(/(\s+|-)/).map((part) => (/^(\s+|-)$/.test(part) ? part : word(part))).join("") as T;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** A count that fits a tile: 12,800 → "12.8k", 1,400,000 → "1.4M". */
export function compactCount(n: number): string {
  if (n < 10_000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** Callbacks that still need someone: booked, due now, or missed (past due, never completed). */
export function callbackOpen(status: string): boolean {
  return status === "scheduled" || status === "due" || status === "missed";
}

export function waitLabel(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s waiting`;
  const m = Math.floor(seconds / 60);
  return m < 60 ? `${m} min waiting` : `${Math.floor(m / 60)} h ${m % 60} min waiting`;
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A lead's display name from its template values, whatever the field keys are called. */
export function leadName(values: Record<string, unknown>): string {
  const v = (k: string) => (typeof values[k] === "string" ? (values[k] as string).trim() : "");
  const full = v("full_name") || v("name") || [v("first_name"), v("last_name")].filter(Boolean).join(" ");
  return displayName(full) || v("email") || "Unnamed lead";
}

export function leadFact(values: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const x = values[k];
    if (typeof x === "string" && x.trim()) return x.trim();
    if (typeof x === "number") return String(x);
  }
  return null;
}

/** A stored code as words: "term_life" → "Term life". */
export function codeLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const words = code.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : null;
}

/** "(404) 555-0142" for US numbers; anything else as given. */
export function phoneLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : raw;
}
