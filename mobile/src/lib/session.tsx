import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform } from "react-native";

import { clearLegacyAnswers } from "@/components/applications/answer-queue";
import { ONGOING_ID, syncOngoingNotification } from "@/components/native/ongoing-call";

import { ApiError, rawRequest, subscribeUpdateRequired, updateRequiredNow } from "./api";
import { answerState } from "./answer-state";
import { checkDeviceOwner } from "./device-check";
import { alertsUndecided, biometricChosen, biometricReady, hasSignedInBefore, markSignedIn, planSetup, type SetupStep } from "./first-run";
import { adoptOutboxOwner, clearOutbox, enqueue, flushOutbox, loadOutboxCount, outboxCount, outboxKind, setOutboxOwner, subscribeOutbox, type OutboxItem, type Queued } from "./outbox";
import { BarStateContext, READ_ONLY_WORDS, type BarState } from "./outbox-state";
import { KEYS, readSecret, writeSecret } from "./secure";

/**
 * The phone's session (2026-11-24).
 *
 *   signed out  → Sign in (password, then the code when two-factor is on).
 *   locked      → a refresh token is on the phone; Face ID / fingerprint (or the phone's passcode) opens it.
 *                 Also after five minutes in the background (board M7). The check is never skipped: a phone
 *                 with no screen lock at all goes to the password sign-in (lib/device-check.ts).
 *   signed in   → requests carry the twelve-hour session token; when it runs out the refresh token gets
 *                 a new one for the same session. A refused refresh (session ended elsewhere, password
 *                 changed, 30 days up) signs the phone out.
 */

export type Me = {
  user: { id: string; email: string; name: string | null };
  tenant: { id: string; name: string; status: string; plan_code: string | null };
  role: string;
  memberRole: string;
  agencyTitle: string | null;
  roles: string[];
  /** The plan's feature keys (2026-11-26). Absent from an older server: then nothing is hidden. */
  plan?: { code: string | null; name: string | null; access: string; features: string[]; disabled: string[] } | null;
  /** The web sidebar keys this person sees (2026-11-26): the Menu shows a row only when its key is here. */
  menuKeys?: string[] | null;
  /** An individual plan with no other caller (2026-11-26): the owner gets the tabs of their own work. */
  solo?: boolean;
};

type Status = "starting" | "signedOut" | "locked" | "signedIn";

type SignInResult = { done: true } | { twoFactor: true };

type SessionValue = {
  status: Status;
  me: Me | null;
  signIn(email: string, password: string, remember?: boolean): Promise<SignInResult>;
  verifyCode(input: { code?: string; recoveryCode?: string; trust: boolean }): Promise<void>;
  unlock(): Promise<boolean>;
  /**
   * Sign out. `keepToSend` (the lock's Use password, a phone with no screen lock) ends the session but keeps the
   * person's unsent notes and outcomes for when they sign back in; anyone else signing in drops them.
   */
  signOut(options?: { keepToSend?: boolean }): Promise<void>;
  /** Every screen's request: the token, a refresh on 401, the server's own error otherwise. */
  api<T>(path: string, init?: { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown }): Promise<T>;
  refreshToken(): Promise<string | null>;
  /** After a call that re-issued the session (switch workspace, end other sessions). */
  adoptTokens(tokens: { access: string; refresh: string; expiresAt: number }): Promise<void>;
  reloadMe(): Promise<void>;
  biometricOn: boolean;
  setBiometricOn(on: boolean): Promise<void>;
  /** No sign-in has finished on this phone yet: Sign in opens on First open (board A0). */
  firstOpen: boolean;
  /** The first-sign-in step in front of the person (A7, A3, A4), or null. */
  setup: SetupStep | null;
  finishSetup(step: SetupStep): void;
  /** The last request got no answer at all (L4). Cleared by the next answer. */
  offline: boolean;
  /** Notes, call outcomes and application answers waiting on the phone to be sent (L4, lib/outbox.ts). */
  toSend: number;
  /** The agency is paused or read-only, in the server's own words (M6). Cleared by a write that goes through. */
  paused: { code: string; message: string } | null;
  /**
   * M6 for the bar and the write buttons: `paused`, or — before any refusal — the plan's own read-only access
   * from /me (a paused or past-due agency still reads, so the app knows before the first write is refused).
   */
  readOnly: { code: string; message: string } | null;
  /** The server refused this version of the app (M8: 426 / app_update_required), from any request. */
  updateNeeded: boolean;
};

const SessionContext = createContext<SessionValue | null>(null);
/** Board M7: five minutes in the background. No agency setting shortens it yet (none exists on the server). */
const LOCK_AFTER_MS = 5 * 60_000;
/** While offline with something waiting, try again this often (no network listener is installed). */
const RETRY_MS = 15_000;
const UNREACHABLE = "Couldn’t reach Insurvas. Try again.";

type Init = { method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown };

type Tokens = { access: string; expiresAt: number; refresh: string };
type LoginAnswer = { ok?: boolean; twoFactor?: boolean; pending?: string; access?: string; refresh?: string; expiresAt?: number; trusted?: string };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("starting");
  const [me, setMe] = useState<Me | null>(null);
  const [biometricOn, setBio] = useState(true);
  const [firstOpen, setFirstOpen] = useState(false);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [offline, setOffline] = useState(false);
  const [paused, setPaused] = useState<{ code: string; message: string } | null>(null);
  const updateNeeded = useSyncExternalStore(subscribeUpdateRequired, updateRequiredNow, updateRequiredNow);
  const toSend = useSyncExternalStore(subscribeOutbox, outboxCount, outboxCount);
  const tokens = useRef<Tokens | null>(null);
  /** The last refresh got no answer at all (as opposed to being refused): the request is offline, not failed. */
  const refreshUnreached = useRef(false);
  const flushing = useRef<Promise<void> | null>(null);
  const pending = useRef<string | null>(null);
  const refreshing = useRef<Promise<string | null> | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  /** "Keep me signed in" (board A1). Off: the session lives in memory only and ends when the app is closed. */
  const remembered = useRef(true);

  const save = useCallback(async (t: Tokens | null) => {
    tokens.current = t;
    const keep = t && remembered.current ? t : null;
    await Promise.all([
      writeSecret(KEYS.access, keep?.access ?? null),
      writeSecret(KEYS.expiresAt, keep ? String(keep.expiresAt) : null),
      writeSecret(KEYS.refresh, keep?.refresh ?? null),
    ]);
  }, []);

  /**
   * The session ends. `clear` (Sign out) empties what waited on the phone — client data never stays for the next
   * person. Otherwise (a refused refresh, Use password on the lock) the items stay tagged with their person and
   * workspace, are never sent under another session, and are dropped if someone else signs in (lib/outbox.ts).
   */
  const forget = useCallback(async (clear = false) => {
    await save(null);
    await setOutboxOwner(null).catch(() => undefined);
    if (clear) {
      await clearOutbox().catch(() => undefined);
      await clearLegacyAnswers().catch(() => undefined);
    }
    // Board L2: Android's "call in progress" notification belongs to the session that ended.
    await dismissOngoingCall();
    setMe(null);
    setSteps([]);
    setPaused(null);
    setStatus("signedOut");
  }, [save]);

  /** A new session token for the same session, once at a time. Null: the phone must sign in again. */
  const refreshToken = useCallback(async (): Promise<string | null> => {
    if (refreshing.current) return refreshing.current;
    const current = tokens.current;
    if (!current?.refresh) return null;
    refreshing.current = (async () => {
      try {
        const r = await rawRequest<{ access: string; expiresAt: number }>("/api/app/auth/mobile/refresh", { method: "POST", body: { refresh: current.refresh } });
        await save({ ...current, access: r.access, expiresAt: r.expiresAt });
        refreshUnreached.current = false;
        return r.access;
      } catch (e) {
        refreshUnreached.current = e instanceof ApiError && e.status === 0;
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
    // Still holding a session means the refresh could not be checked (a slow or unreachable server),
    // not that it was refused: say try again, and keep the person signed in. No answer at all is offline (L4).
    const unreachable = () => new ApiError(refreshUnreached.current ? 0 : 503, { error: UNREACHABLE });
    const token = await validAccess();
    if (!token) throw tokens.current ? unreachable() : new ApiError(401, { error: "Sign in again." });
    try {
      return await rawRequest<T>(path, { ...init, token });
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) throw e;
      const again = await refreshToken();
      if (!again) throw tokens.current ? unreachable() : e;
      return rawRequest<T>(path, { ...init, token: again });
    }
  }, [refreshToken, validAccess]);

  /** What every answer says about the app: online or not (L4), paused (M6). M8 is noted in rawRequest. */
  const noteAnswer = useCallback((init: Init, e?: unknown) => {
    if (e === undefined) {
      setOffline(false);
      // A suspended agency answers nothing, so any answer ends it; read-only ends with a write that goes through.
      if (init.method && init.method !== "GET") setPaused(null);
      else setPaused((was) => (was?.code === "tenant_suspended" ? null : was));
      return;
    }
    if (!(e instanceof ApiError)) return;
    const state = answerState({ status: e.status, code: e.code });
    setOffline(state === "offline");
    if (state === "paused" && e.code) setPaused({ code: e.code, message: e.message });
  }, []);

  /**
   * L4 · sends what waits on the phone, oldest first, one flush at a time (lib/outbox.ts). Started by any
   * answer, by coming back to the app, and every 15 seconds while offline with something waiting.
   */
  const flush = useCallback((): Promise<void> => {
    if (flushing.current) return flushing.current;
    if (!tokens.current || outboxCount() === 0) return Promise.resolve();
    const run = flushOutbox(async (item: OutboxItem) => {
      try {
        await send(item.path, { method: item.method, body: item.body });
        noteAnswer({ method: item.method });
      } catch (e) {
        noteAnswer({ method: item.method }, e);
        throw e;
      }
    }).then(() => undefined, () => undefined).finally(() => { flushing.current = null; });
    flushing.current = run;
    return run;
  }, [noteAnswer, send]);

  /**
   * Every screen's request. A note or a call outcome given with no signal — or while older ones still wait,
   * so they go in the order given — waits in the outbox instead, and the screen gets `{ queued: true }`
   * (lib/outbox.ts isQueued). Everything else (claiming, dialing, approving) needs the server and fails as before.
   */
  const api = useCallback(async <T,>(path: string, init: Init = {}): Promise<T> => {
    const kind = outboxKind(path, init.method);
    const queue = async (): Promise<T> => {
      const item = await enqueue({ kind: kind!, method: init.method as OutboxItem["method"], path, body: init.body });
      const queued: Queued = { queued: true, outboxId: item.id };
      return queued as unknown as T;
    };
    if (kind && outboxCount() > 0) {
      const queued = await queue();
      void flush();
      return queued;
    }
    try {
      const answer = await send<T>(path, init);
      noteAnswer(init);
      if (outboxCount() > 0) void flush();
      return answer;
    } catch (e) {
      noteAnswer(init, e);
      if (kind && e instanceof ApiError && e.status === 0) return queue();
      throw e;
    }
  }, [flush, noteAnswer, send]);

  /** Who is signed in, and so whose items in the outbox count and go (lib/outbox.ts): this user, this workspace. */
  const loadMe = useCallback(async (): Promise<Me> => {
    const who = await api<Me>("/api/app/me");
    await adoptOutboxOwner({ user: who.user.id, tenant: who.tenant.id }).catch(() => undefined);
    setMe(who);
    return who;
  }, [api]);
  const reloadMe = useCallback(async () => { await loadMe(); }, [loadMe]);

  /** The first good sign-in on this phone lines up A7 / A3 / A4 before the app opens. */
  const planFirstRun = useCallback(async (): Promise<SetupStep[]> => {
    const seenBefore = await hasSignedInBefore();
    if (seenBefore) return [];
    const [workspaces, undecided, ready, chosen] = await Promise.all([
      api<{ workspaces: unknown[] }>("/api/app/auth/workspaces").then((w) => w.workspaces.length, () => 0),
      alertsUndecided(), biometricReady(), biometricChosen(),
    ]);
    await markSignedIn();
    setFirstOpen(false);
    return planSetup({ seenBefore, workspaces, alertsUndecided: undecided, biometricReady: ready, biometricChosen: chosen });
  }, [api]);

  const enter = useCallback(async (t: Tokens, fresh = false) => {
    // A workspace switch re-enters with new tokens: nothing of the old workspace may go with them until /me
    // names the new owner (the old workspace's items then wait for it to be entered again).
    await setOutboxOwner(null).catch(() => undefined);
    await save(t);
    await reloadMe();
    if (fresh) setSteps(await planFirstRun());
    setStatus("signedIn");
    void flush();
  }, [flush, planFirstRun, reloadMe, save]);

  const finishSetup = useCallback((step: SetupStep) => {
    setSteps((s) => s.filter((x) => x !== step));
  }, []);

  const adoptTokens = useCallback(async (t: { access: string; refresh: string; expiresAt: number }) => {
    await enter({ access: t.access, refresh: t.refresh, expiresAt: t.expiresAt });
  }, [enter]);

  const finish = useCallback(async (answer: LoginAnswer) => {
    if (answer.trusted) await writeSecret(KEYS.trusted, answer.trusted);
    if (!answer.access || !answer.refresh || !answer.expiresAt) throw new ApiError(500, { error: "Sign-in did not finish. Try again." });
    await enter({ access: answer.access, refresh: answer.refresh, expiresAt: answer.expiresAt }, true);
  }, [enter]);

  const signIn = useCallback(async (email: string, password: string, remember = true): Promise<SignInResult> => {
    remembered.current = remember;
    const trusted = await readSecret(KEYS.trusted);
    const answer = await rawRequest<LoginAnswer>("/api/app/auth/mobile/login", { method: "POST", body: { email, password, remember }, headers: trusted ? { "x-insurvas-trusted": trusted } : {} });
    if (answer.twoFactor && answer.pending) {
      pending.current = answer.pending;
      return { twoFactor: true };
    }
    await finish(answer);
    return { done: true };
  }, [finish]);

  const verifyCode = useCallback(async (input: { code?: string; recoveryCode?: string; trust: boolean }) => {
    if (!pending.current) throw new ApiError(401, { error: "That took too long. Sign in again." });
    const body = input.recoveryCode ? { pending: pending.current, recoveryCode: input.recoveryCode, trust: input.trust } : { pending: pending.current, code: input.code, trust: input.trust };
    const answer = await rawRequest<LoginAnswer>("/api/app/auth/mobile/verify-2fa", { method: "POST", body });
    pending.current = null;
    await finish(answer);
  }, [finish]);

  const unlock = useCallback(async (): Promise<boolean> => {
    // Board M7: always the phone's own check — Face ID / fingerprint, or its passcode when biometrics are off or
    // not set up. A phone with no screen lock cannot prove who holds it: the password sign-in, never straight in.
    const check = await checkDeviceOwner();
    if (check === "noLock") { await forget(); return false; }
    if (check === "refused") return false;
    try {
      const token = await validAccess();
      if (!token) { await forget(); return false; }
      await reloadMe();
      setStatus("signedIn");
      void flush();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await forget();
      else setStatus("locked");
      throw e;
    }
  }, [flush, forget, reloadMe, validAccess]);

  const signOut = useCallback(async (options?: { keepToSend?: boolean }) => {
    const token = tokens.current?.access;
    const push = await readSecret(KEYS.pushToken);
    if (token) {
      await rawRequest("/api/app/auth/mobile/logout", { method: "POST", token }).catch(() => undefined);
    }
    if (push) await writeSecret(KEYS.pushToken, null);
    await forget(!options?.keepToSend);
  }, [forget]);

  const setBiometricOn = useCallback(async (on: boolean) => {
    setBio(on);
    await writeSecret(KEYS.biometric, on ? "1" : "0");
  }, []);

  // Start: a phone that holds a refresh token opens locked; one that doesn't, at Sign in.
  useEffect(() => {
    void loadOutboxCount().catch(() => 0);
    (async () => {
      const [access, expiresAt, refresh, bio, seen] = await Promise.all([readSecret(KEYS.access), readSecret(KEYS.expiresAt), readSecret(KEYS.refresh), readSecret(KEYS.biometric), hasSignedInBefore()]);
      setBio(bio !== "0");
      setFirstOpen(!seen);
      if (refresh) {
        tokens.current = { access: access ?? "", expiresAt: Number(expiresAt ?? 0), refresh };
        setStatus("locked");
      } else {
        setStatus("signedOut");
      }
    })();
  }, []);

  // Board M7: five minutes away from the app locks it again.
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
  // L4: coming back to the app sends what waited.
  useEffect(() => {
    if (status !== "signedIn") return;
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") void flush(); });
    return () => sub.remove();
  }, [status, flush]);
  // L4: no network listener is installed (neither @react-native-community/netinfo nor expo-network), so the app
  // learns it is back from the next request that gets an answer; while something waits, it asks every 15 s.
  useEffect(() => {
    if (status !== "signedIn" || !offline || toSend === 0) return;
    const timer = setInterval(() => void flush(), RETRY_MS);
    return () => clearInterval(timer);
  }, [status, offline, toSend, flush]);

  const readOnly = useMemo(() => paused ?? (me?.plan?.access === "read_only" ? { code: "read_only", message: READ_ONLY_WORDS } : null), [paused, me]);
  const signedIn = status === "signedIn";
  const bar = useMemo<BarState>(() => ({ offline: signedIn && offline, toSend: signedIn ? toSend : 0, readOnly: signedIn ? readOnly : null, role: me?.memberRole ?? me?.role ?? null }),
    [signedIn, offline, toSend, readOnly, me]);

  const setup = steps[0] ?? null;
  const value = useMemo<SessionValue>(() => ({ status, me, signIn, verifyCode, unlock, signOut, api, refreshToken, adoptTokens, reloadMe, biometricOn, setBiometricOn, firstOpen, setup, finishSetup, offline, toSend, paused, readOnly, updateNeeded }),
    [status, me, signIn, verifyCode, unlock, signOut, api, refreshToken, adoptTokens, reloadMe, biometricOn, setBiometricOn, firstOpen, setup, finishSetup, offline, toSend, paused, readOnly, updateNeeded]);
  return (
    <SessionContext.Provider value={value}>
      <BarStateContext.Provider value={bar}>{children}</BarStateContext.Provider>
    </SessionContext.Provider>
  );
}

/** Clears Android's ongoing-call notification, also one posted before this launch. Never throws. */
async function dismissOngoingCall(): Promise<void> {
  await syncOngoingNotification(null).catch(() => undefined);
  if (Platform.OS !== "android") return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const N = require("expo-notifications") as typeof import("expo-notifications");
    await N.dismissNotificationAsync(ONGOING_ID);
  } catch { /* nothing to clear */ }
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

/** The refresh token, for the few calls that re-issue the session (switch workspace, end other sessions). */
export async function currentRefreshToken(): Promise<string | null> {
  return readSecret(KEYS.refresh);
}
