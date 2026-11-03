// One fetch helper for the after-submit screens (submit, after, timeline, copy-assist, household).
// Never throws: a failed call returns the server's one-line error so the screen can keep what was
// typed and say why.

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; status?: number };

export async function request<T>(url: string, init: { method?: string; body?: unknown; form?: FormData } = {}): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body !== undefined || init.form ? "POST" : "GET"),
      cache: "no-store",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: typeof data?.error === "string" ? data.error : `The server said ${res.status}`, code: typeof data?.code === "string" ? data.code : undefined, status: res.status };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "No connection — nothing was lost on screen. Try again." };
  }
}

export const attemptUrl = (attemptId: string, path = "") => `/api/app/applications/attempts/${attemptId}${path}`;
export const caseUrl = (caseId: string, path = "") => `/api/app/applications/cases/${caseId}${path}`;
