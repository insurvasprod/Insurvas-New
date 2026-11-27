import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { ApiError, formRequest, rawRequest } from "@/lib/api";
import { answerState } from "@/lib/answer-state";
import { checkDeviceOwner } from "@/lib/device-check";
import { BarStateContext, type BarState } from "@/lib/outbox-state";
import { readSecret, writeSecret } from "@/lib/secure";

import type { PartnerMe } from "./types";

/**
 * A partner's session on the phone (Release 3, 2026-11-25). Partners live on their own plane, so this is
 * its own session, apart from the agency one in lib/session.tsx: its own Keychain / Keystore entries, its
 * own sign-in (/api/partner/auth/mobile/login), its own refresh (/api/partner/auth/mobile/refresh) and
 * only the partner routes (/api/partner/**). The server keeps the planes apart in any case — a partner
 * token is signed with the partner key, so no agency route can read it, and the partner routes read a
 * header token only when it was issued to the app — this file just never mixes the two.
 *
 *   signed out → Partner sign in (email and password; partners have no code step).
 *   locked     → a refresh token is on the phone; Face ID / fingerprint (or the phone's passcode) opens it,
 *                as for agents. Also after five minutes in the background. Never skipped: a phone with no
 *                screen lock goes to the partner sign-in (lib/device-check.ts).
 *   signed in  → requests carry the twelve-hour token; when it runs out the refresh token gets a new one,
 *                until the 30 days from sign-in are up. A refused refresh signs the phone out.
 */
export const PARTNER_KEYS = { access: "insurvas.partner.access", expiresAt: "insurvas.partner.expiresAt", refresh: "insurvas.partner.refresh" } as const;

type Status = "starting" | "signedOut" | "locked" | "signedIn";
type Tokens = { access: string; expiresAt: number; refresh: string };
type Init = { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown };

export type PartnerSessionValue = {
  status: Status;
  me: PartnerMe | null;
  signIn(email: string, password: string): Promise<void>;
  /** Development builds only: adopt minted test tokens (partner/dev-sign-in). */
  adoptTokens(t: { access: string; refresh: string; expiresAt: number }): Promise<void>;
  unlock(): Promise<boolean>;
  signOut(): Promise<void>;
  /** Every partner screen's request: the token, a refresh on 401, the server's own error otherwise. */
  api<T>(path: string, init?: Init): Promise<T>;
  upload<T>(path: string, form: FormData): Promise<T>;
  reloadMe(): Promise<void>;
  /** The last request got no answer at all (board L4: the bar's "Offline" mark). Cleared by the next answer. */
  offline: boolean;
  /**
   * Board M6 on the partner's side: the platform is read-only (maintenance), in the server's words, or the agency
   * paused this partner (partnerStatus "paused": reading still works, sending does not). The bar shows "Read only".
   */
  readOnly: { code: string; message: string } | null;
};

/** The partner's own words for a paused partner account (the server refuses new leads; reads still answer). */
export const PARTNER_PAUSED_WORDS = "The agency has paused your partner account. You can still read your leads and payouts, but not send new ones.";

const PartnerSessionContext = createContext<PartnerSessionValue | null>(null);
const LOCK_AFTER_MS = 5 * 60_000;

/**
 * Whether the partner session has left "starting" this launch: the root layout keeps its launch cover up until
 * then when it opens the partner app, so the agency Welcome never flashes first.
 */
let ready = false;
const readyListeners = new Set<() => void>();
function markPartnerReady() {
  if (ready) return;
  ready = true;
  readyListeners.forEach((l) => l());
}
export function partnerSessionReady(): boolean {
  return ready;
}
export function subscribePartnerReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => { readyListeners.delete(listener); };
}

/** Whether this phone holds a partner sign-in (the root layout opens /partner on start when it does). */
export async function hasSavedPartnerSession(): Promise<boolean> {
  return Boolean(await readSecret(PARTNER_KEYS.refresh));
}

export function PartnerSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("starting");
  const [me, setMe] = useState<PartnerMe | null>(null);
  const [offline, setOffline] = useState(false);
  const [paused, setPaused] = useState<{ code: string; message: string } | null>(null);
  const tokens = useRef<Tokens | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);
  const backgroundedAt = useRef<number | null>(null);

  /** L4 / M6: what an answer says about the app (M8 is noted in rawRequest for every request). */
  const noteAnswer = useCallback((write: boolean, e?: unknown) => {
    if (e === undefined) {
      setOffline(false);
      setPaused((was) => (write ? null : was));
      return;
    }
    if (!(e instanceof ApiError)) return;
    const state = answerState({ status: e.status, code: e.code });
    setOffline(state === "offline");
    if (state === "paused" && e.code) setPaused({ code: e.code, message: e.message });
  }, []);

  const save = useCallback(async (t: Tokens | null) => {
    tokens.current = t;
    await Promise.all([
      writeSecret(PARTNER_KEYS.access, t?.access ?? null),
      writeSecret(PARTNER_KEYS.expiresAt, t ? String(t.expiresAt) : null),
      writeSecret(PARTNER_KEYS.refresh, t?.refresh ?? null),
    ]);
  }, []);

  const forget = useCallback(async () => {
    await save(null);
    setMe(null);
    setPaused(null);
    setOffline(false);
    setStatus("signedOut");
  }, [save]);

  /** A new token for the same sign-in, once at a time. Null: sign in again (or the server could not be reached). */
  const refreshToken = useCallback(async (): Promise<string | null> => {
    if (refreshing.current) return refreshing.current;
    const current = tokens.current;
    if (!current?.refresh) return null;
    refreshing.current = (async () => {
      try {
        const r = await rawRequest<{ access: string; expiresAt: number }>("/api/partner/auth/mobile/refresh", { method: "POST", body: { refresh: current.refresh } });
        await save({ ...current, access: r.access, expiresAt: r.expiresAt });
        return r.access;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await forget();
        return null;
      } finally {
        refreshing.current = null;
      }
    })();
    return refreshing.current;
  }, [forget, save]);

  const validAccess = useCallback(async (): Promise<string | null> => {
    const t = tokens.current;
    if (!t) return null;
    // A minute's margin so a request never leaves with a token that dies on the way.
    if (t.expiresAt * 1000 - Date.now() > 60_000) return t.access;
    return refreshToken();
  }, [refreshToken]);

  const send = useCallback(async <T,>(path: string, init: Init = {}): Promise<T> => {
    const token = await validAccess();
    if (!token) throw tokens.current ? new ApiError(503, { error: "Couldn’t reach Insurvas. Try again." }) : new ApiError(401, { error: "Sign in again." });
    try {
      return await rawRequest<T>(path, { ...init, token });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      const again = await refreshToken();
      if (!again) throw tokens.current ? new ApiError(503, { error: "Couldn’t reach Insurvas. Try again." }) : e;
      return rawRequest<T>(path, { ...init, token: again });
    }
  }, [refreshToken, validAccess]);

  const api = useCallback(async <T,>(path: string, init: Init = {}): Promise<T> => {
    const write = Boolean(init.method && init.method !== "GET");
    try {
      const answer = await send<T>(path, init);
      noteAnswer(write);
      return answer;
    } catch (e) {
      noteAnswer(write, e);
      throw e;
    }
  }, [noteAnswer, send]);

  /** A multipart POST (a photo in a chat), with the same token and refresh as `api`. */
  const upload = useCallback(async <T,>(path: string, form: FormData): Promise<T> => {
    // The app's own headers (the user agent carries the version the server's update check reads, M8).
    const post = (token: string) => formRequest<T>(path, form, { method: "POST", token });
    const run = async () => {
      const token = await validAccess();
      if (!token) throw new ApiError(401, { error: "Sign in again." });
      try {
        return await post(token);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 401) throw e;
        const again = await refreshToken();
        if (!again) throw e;
        return post(again);
      }
    };
    try {
      const answer = await run();
      noteAnswer(true);
      return answer;
    } catch (e) {
      noteAnswer(true, e);
      throw e;
    }
  }, [noteAnswer, refreshToken, validAccess]);

  const reloadMe = useCallback(async () => {
    setMe(await api<PartnerMe>("/api/partner/me"));
  }, [api]);

  const signIn = useCallback(async (email: string, password: string) => {
    const answer = await rawRequest<{ access?: string; refresh?: string; expiresAt?: number }>("/api/partner/auth/mobile/login", { method: "POST", body: { email, password, remember: true } });
    if (!answer.access || !answer.refresh || !answer.expiresAt) throw new ApiError(500, { error: "Sign-in did not finish. Try again." });
    await save({ access: answer.access, refresh: answer.refresh, expiresAt: answer.expiresAt });
    await reloadMe();
    setStatus("signedIn");
  }, [reloadMe, save]);

  /** DEVELOPMENT ONLY (partner/dev-sign-in): tokens minted for a test partner; the server still checks them. */
  const adoptTokens = useCallback(async (t: Tokens) => {
    if (!__DEV__) throw new ApiError(403, { error: "Not in a release build." });
    await save(t);
    await reloadMe();
    setStatus("signedIn");
  }, [reloadMe, save]);

  const unlock = useCallback(async (): Promise<boolean> => {
    // Board M7: always the phone's own check; no screen lock at all means the password sign-in, never straight in.
    const check = await checkDeviceOwner();
    if (check === "noLock") { await forget(); return false; }
    if (check === "refused") return false;
    try {
      const token = await validAccess();
      if (!token) { await forget(); return false; }
      await reloadMe();
      setStatus("signedIn");
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await forget();
      else setStatus("locked");
      throw e;
    }
  }, [forget, reloadMe, validAccess]);

  /** Signing out on the portal's own route raises the person's session version: every partner session ends. */
  const signOut = useCallback(async () => {
    const token = tokens.current?.access;
    if (token) await rawRequest("/api/partner/auth/logout", { method: "POST", token }).catch(() => undefined);
    await forget();
  }, [forget]);

  useEffect(() => {
    (async () => {
      const [access, expiresAt, refresh] = await Promise.all([readSecret(PARTNER_KEYS.access), readSecret(PARTNER_KEYS.expiresAt), readSecret(PARTNER_KEYS.refresh)]);
      if (refresh) {
        tokens.current = { access: access ?? "", expiresAt: Number(expiresAt ?? 0), refresh };
        setStatus("locked");
      } else {
        setStatus("signedOut");
      }
    })();
  }, []);

  useEffect(() => {
    if (status !== "starting") markPartnerReady();
  }, [status]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") backgroundedAt.current = Date.now();
      if (state === "active" && backgroundedAt.current && Date.now() - backgroundedAt.current > LOCK_AFTER_MS && tokens.current) {
        setStatus((s) => (s === "signedIn" ? "locked" : s));
      }
      if (state === "active") backgroundedAt.current = null;
    });
    return () => sub.remove();
  }, []);

  const readOnly = useMemo(() => paused ?? (me?.partnerStatus === "paused" ? { code: "partner_paused", message: PARTNER_PAUSED_WORDS } : null), [paused, me]);
  const signedIn = status === "signedIn";
  // The partner's screens use the same kit, so the bar's Offline and Read only marks come from this session.
  const bar = useMemo<BarState>(() => ({ offline: signedIn && offline, toSend: 0, readOnly: signedIn ? readOnly : null, role: me?.role ?? null }), [signedIn, offline, readOnly, me]);
  const value = useMemo<PartnerSessionValue>(() => ({ status, me, signIn, adoptTokens, unlock, signOut, api, upload, reloadMe, offline, readOnly }), [status, me, signIn, adoptTokens, unlock, signOut, api, upload, reloadMe, offline, readOnly]);
  return (
    <PartnerSessionContext.Provider value={value}>
      <BarStateContext.Provider value={bar}>{children}</BarStateContext.Provider>
    </PartnerSessionContext.Provider>
  );
}

export function usePartnerSession(): PartnerSessionValue {
  const value = useContext(PartnerSessionContext);
  if (!value) throw new Error("usePartnerSession outside PartnerSessionProvider");
  return value;
}
