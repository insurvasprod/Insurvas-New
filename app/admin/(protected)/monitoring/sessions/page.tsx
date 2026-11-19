import { redirect } from "next/navigation";

import { MonitoringPage } from "@/components/admin/monitoring/monitoring-page";
import { SessTable, type StaffSessionRow } from "@/components/admin/monitoring/sess-table";
import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { ADMIN_ROLE_LABELS, isAdminRole } from "@/lib/adminAuth/roles";
import { isTotpEnrolled } from "@/lib/adminAuth/session";
import { initials } from "@/lib/adminDashboard/security";
import { deviceLabel, loginEventTime } from "@/lib/loginEvents/present";
import { fetchStaffLastSignIns, type StaffSignIn } from "@/lib/loginEvents/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

type StaffRow = { id: string; name: string; email: string; role: string; last_login_at: string | null; totp_secret: string | null };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** "Today 09:58", "Yesterday", "Nov 12" (UTC), "Never". */
function lastSignInText(iso: string | null, now: number): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const day = iso.slice(0, 10);
  const today = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  if (day === today) return `Today ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  if (day === yesterday) return "Yesterday";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}${date.getUTCFullYear() === new Date(now).getUTCFullYear() ? "" : ` ${date.getUTCFullYear()}`}`;
}

async function readStaff(): Promise<{ staff: StaffRow[]; signIns: Map<string, StaffSignIn> | null } | null> {
  try {
    // totp_secret is read only to say whether two-step sign-in is set up; it never leaves the server.
    const { data, error } = await getSupabaseServiceClient()
      .from("admin_users")
      .select("id, name, email, role, last_login_at, totp_secret")
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const staff = (data ?? []) as StaffRow[];
    let signIns: Map<string, StaffSignIn> | null = null;
    try {
      signIns = await fetchStaffLastSignIns(staff.map((row) => row.id));
    } catch (signInError) {
      console.error("[admin-sessions] sign-ins:", signInError instanceof Error ? signInError.message : signInError);
    }
    return { staff, signIns };
  } catch (error) {
    console.error("[admin-sessions]", error instanceof Error ? error.message : error);
    return null;
  }
}

/** The request's clock, read once. */
function readNow(): number {
  return Date.now();
}

/**
 * Monitoring › Staff sessions (admin round 1, docs/design/admin-r1/monitoring.html screen 4): who on the Insurvas
 * team can sign in, when and from where they last did, two-step status, and "Sign out everywhere". Super admin
 * only, as the sessions route is. An exact count of live sessions per person is not stored (a session is a signed
 * cookie checked against admin_users.session_version), so the page shows the last sign-in instead.
 */
export default async function StaffSessionsPage() {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (admin.role !== "super_admin") redirect("/admin/monitoring");

  const now = readNow();
  const data = await readStaff();
  const lastAt = (row: StaffRow) => data?.signIns?.get(row.id)?.ts ?? row.last_login_at ?? "";
  const rows: StaffSessionRow[] = [...(data?.staff ?? [])]
    .sort((a, b) => lastAt(b).localeCompare(lastAt(a)))
    .map((row) => {
      const signIn = data?.signIns?.get(row.id) ?? null;
      const at = signIn?.ts ?? row.last_login_at;
      return {
        id: row.id,
        name: row.name?.trim() || row.email,
        email: row.email,
        initials: initials(row.name?.trim() || row.email),
        roleLabel: isAdminRole(row.role) ? ADMIN_ROLE_LABELS[row.role] : row.role,
        lastSignIn: lastSignInText(at, now),
        lastSignInTitle: at ? loginEventTime(at) : null,
        ip: signIn?.ip ?? null,
        device: deviceLabel(signIn?.userAgent),
        twoStep: isTotpEnrolled(row.totp_secret),
      };
    });


  return (
    <MonitoringPage
      step="sessions"
      info="Who on the Insurvas team can sign in, when and from where they last did, and Sign out everywhere for a lost laptop or a copied cookie."
    >
      <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
        <SessTable rows={rows} currentAdminId={admin.id} failed={data === null} />
      </div>
    </MonitoringPage>
  );
}
