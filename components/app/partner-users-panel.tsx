"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ChevronRight,
  Search,
  Settings2,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { notify } from "@/lib/notify";

import { PartnerFormStudio } from "@/components/app/partner-form-studio";
import { PartnerMarketAccessPanel } from "@/components/app/partner-market-access-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { PartnerRole } from "@/lib/partnerAuth/roles";

type Member = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: PartnerRole;
  status: "active" | "revoked";
  accepted_at: string | null;
  partner_admin_user_id: string | null;
};

type Selected = Member & { parentName: string | null };
type TeamScope = "admins" | "users" | "unassigned";
type ConfigTab = "overview" | "lead" | "markets";

function roleLabel(role: PartnerRole) {
  return role === "partner_admin" ? "Partner admin" : "Partner user";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function MemberAvatar({ member }: { member: Member }) {
  return (
    <span className="portal-team-member-avatar" aria-hidden="true">
      {initials(member.name)}
    </span>
  );
}

function statusLabel(member: Member) {
  if (!member.accepted_at) return "Invitation pending";
  return member.status === "active" ? "Active" : "Deactivated";
}

function MemberTable({
  members,
  selectedUserId,
  readOnly,
  offboarded,
  admins,
  busy,
  parentName,
  onConfigure,
  onAssign,
  onViewUsers,
  userCountForAdmin,
  childUsers,
  expandedAdminId,
}: {
  members: Member[];
  selectedUserId: string | null;
  readOnly: boolean;
  offboarded: boolean;
  admins: Member[];
  busy: string | null;
  parentName: (member: Member) => string | null;
  onConfigure: (member: Member) => void;
  onAssign: (member: Member, adminId: string) => void;
  onViewUsers?: (admin: Member) => void;
  userCountForAdmin: (admin: Member) => number;
  childUsers: Member[];
  expandedAdminId: string | null;
}) {
  if (!members.length)
    return (
      <div className="portal-team-empty" role="status">
        <Users aria-hidden="true" />
        <p>No team members match this view.</p>
        <span>Try another role filter or search term.</span>
      </div>
    );

  return (
    <div className="portal-team-table-wrap">
      <table className="portal-team-table">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Email</th>
            <th scope="col">Role</th>
            <th scope="col">Status</th>
            <th scope="col">Reports to</th>
            <th scope="col" className="portal-team-table-action-heading">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const parent = parentName(member);
            const selected = member.user_id === selectedUserId;
            const isUnassigned = member.role === "partner_user" && !parent;
            const isExpanded =
              member.role === "partner_admin" &&
              expandedAdminId === member.user_id;
            const usersForAdmin = isExpanded
              ? childUsers.filter(
                  (child) => child.partner_admin_user_id === member.user_id,
                )
              : [];
            return (
              <Fragment key={member.id}>
                <tr className={selected ? "is-selected" : undefined}>
                  <td>
                    <div className="portal-team-member-name">
                      <MemberAvatar member={member} />
                      <span>
                        <strong>{member.name}</strong>
                        <small>{parent ?? "Publisher workspace"}</small>
                      </span>
                    </div>
                  </td>
                  <td className="portal-team-email">{member.email}</td>
                  <td>
                    <span className="portal-team-role">
                      {member.role === "partner_admin" ? (
                        <ShieldCheck aria-hidden="true" />
                      ) : (
                        <UserRound aria-hidden="true" />
                      )}
                      {roleLabel(member.role)}
                    </span>
                  </td>
                  <td>
                    <Badge
                      variant={member.status === "active" ? "secondary" : "outline"}
                      className={member.status === "active" ? "portal-team-status-active" : undefined}
                    >
                      {statusLabel(member)}
                    </Badge>
                  </td>
                  <td className="portal-team-parent">{parent ?? "Unassigned"}</td>
                  <td className="portal-team-row-actions">
                    {member.role === "partner_admin" && onViewUsers ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="portal-team-view-users"
                        aria-expanded={isExpanded}
                        onClick={() => onViewUsers(member)}
                      >
                        {isExpanded ? "Hide users" : `View users (${userCountForAdmin(member)})`}
                        <ChevronRight data-icon="inline-end" aria-hidden="true" />
                      </Button>
                    ) : null}
                    {isUnassigned ? (
                      <select
                        aria-label={`Assign ${member.name}`}
                        className="portal-team-assign"
                        defaultValue=""
                        disabled={readOnly || offboarded || busy === member.user_id}
                        onChange={(event) => {
                          if (event.target.value) onAssign(member, event.target.value);
                        }}
                      >
                        <option value="" disabled>
                          Assign…
                        </option>
                        {admins.map((admin) => (
                          <option key={admin.user_id} value={admin.user_id}>
                            {admin.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {member.role === "partner_admin" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        className="portal-team-configure-button"
                        onClick={() => onConfigure(member)}
                      >
                        <Settings2 data-icon="inline-start" aria-hidden="true" />
                        Configure admin
                      </Button>
                    ) : (
                      <Badge variant="outline" className="portal-team-inherited-badge">
                        Inherited from {parent ?? "partner admin"}
                      </Badge>
                    )}
                  </td>
                </tr>
                {isExpanded ? (
                  <tr className="portal-team-expanded-row">
                    <td colSpan={6}>
                      <div className="portal-team-expanded-users">
                        <div className="portal-team-expanded-users-heading">
                          <div>
                            <strong>Users reporting to {member.name}</strong>
                            <span>
                              {usersForAdmin.length} {usersForAdmin.length === 1 ? "partner user" : "partner users"}
                            </span>
                          </div>
                          <span className="portal-team-inherited-hint">Inherits this admin&apos;s defaults</span>
                        </div>
                        {usersForAdmin.length ? (
                          <div className="portal-team-expanded-users-list">
                            {usersForAdmin.map((user) => (
                              <div
                                key={user.id}
                                className={`portal-team-expanded-user ${user.user_id === selectedUserId ? "is-selected" : ""}`}
                              >
                                <div className="portal-team-member-name">
                                  <MemberAvatar member={user} />
                                  <span>
                                    <strong>{user.name}</strong>
                                    <small>{user.email}</small>
                                  </span>
                                </div>
                                <Badge
                                  variant={user.status === "active" ? "secondary" : "outline"}
                                  className={user.status === "active" ? "portal-team-status-active" : undefined}
                                >
                                  {statusLabel(user)}
                                </Badge>
                                <Badge variant="outline" className="portal-team-inherited-badge">
                                  Inherited from {member.name}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="portal-team-expanded-users-empty">No users have been invited by this admin yet.</p>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function PartnerUsersPanel({
  partnerId,
  readOnly,
  offboarded = false,
}: {
  partnerId: string;
  readOnly: boolean;
  offboarded?: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<TeamScope>("admins");
  const [adminFilter, setAdminFilter] = useState<string>("");
  const [expandedAdminId, setExpandedAdminId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const workspaceRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/app/partners/${partnerId}/users`, {
        cache: "no-store",
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not load the team");
        return;
      }
      setMembers(body.users ?? []);
    } catch (reason) {
      notify.fail(reason instanceof Error ? reason.message : "Could not load the team");
    } finally {
      setLoading(false);
    }
  }, [partnerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const admins = useMemo(
    () => members.filter((member) => member.role === "partner_admin"),
    [members],
  );
  const users = useMemo(
    () => members.filter((member) => member.role === "partner_user"),
    [members],
  );
  const unassigned = useMemo(
    () => users.filter((member) => !member.partner_admin_user_id),
    [users],
  );
  const parentByUserId = useMemo(
    () => new Map(admins.map((admin) => [admin.user_id, admin.name])),
    [admins],
  );
  const counts = useMemo(
    () => ({
      admins: admins.length,
      users: users.length,
      active: members.filter((member) => member.status === "active").length,
      pending: members.filter((member) => !member.accepted_at).length,
      unassigned: unassigned.length,
    }),
    [admins.length, members, unassigned.length, users.length],
  );
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const source = scope === "admins" ? admins : scope === "unassigned" ? unassigned : users;
    return source.filter((member) => {
      const matchesQuery =
        !text || `${member.name} ${member.email}`.toLowerCase().includes(text);
      const matchesAdmin =
        scope !== "users" ||
        !adminFilter ||
        member.partner_admin_user_id === adminFilter;
      return matchesQuery && matchesAdmin;
    });
  }, [adminFilter, admins, query, scope, unassigned, users]);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      workspaceRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);

  async function assign(member: Member, adminId: string) {
    setBusy(member.user_id);
    try {
      const response = await fetch(
        `/api/app/partners/${partnerId}/users/${member.user_id}/admin-assignment`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ partner_admin_user_id: adminId }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not assign the partner admin");
        return;
      }
      notify.arrive("Partner user assigned");
      await load();
    } catch (reason) {
      notify.fail(reason instanceof Error ? reason.message : "Could not assign the partner admin");
    } finally {
      setBusy(null);
    }
  }

  function configure(member: Member) {
    setSelected({
      ...member,
      parentName: member.partner_admin_user_id
        ? parentByUserId.get(member.partner_admin_user_id) ?? null
        : null,
    });
  }

  return (
    <div className="portal-partner-team">
      <Card className="portal-team-overview-card">
        <CardContent className="p-0">
          <div className="portal-team-heading">
            <div>
              <h3>
                <Users aria-hidden="true" />
                Team
              </h3>
              <p>Manage publisher admins, users, and inherited access in one clear view.</p>
            </div>
            <Badge variant="outline">{members.length} people</Badge>
          </div>

          {offboarded ? (
            <div className="portal-team-history-note" role="status">
              Offboarded team members remain visible as history. Changes are disabled.
            </div>
          ) : null}

          <div className="portal-team-metrics" aria-label="Team summary">
            <div><span>Admins</span><strong>{counts.admins}</strong></div>
            <div><span>Users</span><strong>{counts.users}</strong></div>
            <div><span>Active</span><strong>{counts.active}</strong></div>
            <div><span>Pending</span><strong>{counts.pending}</strong></div>
          </div>

          <div className="portal-team-controls">
            <div className="portal-team-scope-switcher" role="tablist" aria-label="Team member view">
              {(
                [
                  ["admins", `Admins · ${counts.admins}`],
                  ["users", `Users · ${counts.users}`],
                  ["unassigned", `Unassigned · ${counts.unassigned}`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={scope === value}
                  onClick={() => {
                    setScope(value);
                    if (value !== "admins") setExpandedAdminId(null);
                    if (value !== "users") setAdminFilter("");
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="portal-team-search-wrap">
              <Search aria-hidden="true" />
              <Input
                aria-label="Search team members"
                placeholder="Search team members"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>

          {scope === "users" ? (
            <div className="portal-team-filter-row">
              <label htmlFor={`team-admin-filter-${partnerId}`}>Reporting line</label>
              <select
                id={`team-admin-filter-${partnerId}`}
                value={adminFilter}
                onChange={(event) => setAdminFilter(event.target.value)}
              >
                <option value="">All partner admins</option>
                {admins.map((admin) => (
                  <option key={admin.user_id} value={admin.user_id}>
                    {admin.name}
                  </option>
                ))}
              </select>
              {adminFilter ? (
                <button type="button" onClick={() => setAdminFilter("")}>
                  Clear filter
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="portal-team-table-heading">
            <div>
              <strong>{scope === "admins" ? "Partner admins" : scope === "users" ? "Partner users" : "Unassigned users"}</strong>
              <span>
                {scope === "admins"
                  ? "Configure an admin once, then let users inherit their defaults."
                  : scope === "users"
                    ? "Each user can inherit an admin or receive a direct override."
                    : "Assign a reporting line before relying on inherited defaults."}
              </span>
            </div>
            {scope === "admins" && admins.length ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setScope("users");
                  setAdminFilter("");
                  setExpandedAdminId(null);
                }}
              >
                View all users <ChevronRight data-icon="inline-end" aria-hidden="true" />
              </Button>
            ) : null}
          </div>

          {loading ? (
            <div className="portal-team-loading" role="status">Loading team workspace…</div>
          ) : (
            <MemberTable
              members={filtered}
              selectedUserId={selected?.user_id ?? null}
              readOnly={readOnly}
              offboarded={offboarded}
              admins={admins}
              busy={busy}
              parentName={(member) =>
                member.partner_admin_user_id
                  ? parentByUserId.get(member.partner_admin_user_id) ?? null
                  : null
              }
              onConfigure={configure}
              onAssign={(member, adminId) => void assign(member, adminId)}
              onViewUsers={
                scope === "admins"
                  ? (admin) => {
                      setExpandedAdminId((current) =>
                        current === admin.user_id ? null : admin.user_id,
                      );
                    }
                  : undefined
              }
              userCountForAdmin={(admin) =>
                users.filter((member) => member.partner_admin_user_id === admin.user_id).length
              }
              childUsers={users}
              expandedAdminId={scope === "admins" ? expandedAdminId : null}
            />
          )}
        </CardContent>
      </Card>

      {selected ? (
        <section
          ref={workspaceRef}
          className="portal-team-member-workspace motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
          aria-label={`${selected.name} configuration`}
        >
          <PartnerUserWorkspace
            partnerId={partnerId}
            member={selected}
            readOnly={readOnly || offboarded}
            onClose={() => setSelected(null)}
          />
        </section>
      ) : null}
    </div>
  );
}

function PartnerUserWorkspace({
  partnerId,
  member,
  readOnly,
  onClose,
}: {
  partnerId: string;
  member: Selected;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ConfigTab>("overview");
  const target = {
    userId: member.user_id,
    name: member.name,
    role: member.role,
  };
  const inheritance = member.role === "partner_admin"
    ? "Using publisher defaults"
    : member.parentName
      ? `Using ${member.parentName} defaults`
      : "Unassigned — direct user override";

  return (
    <div className="portal-team-config">
      <div className="portal-team-config-header">
        <button type="button" className="portal-team-back" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          Back to team
        </button>
        <div className="portal-team-config-identity">
          <MemberAvatar member={member} />
          <div>
            <h3>{member.name}</h3>
            <p>{member.email} <span>·</span> {roleLabel(member.role)} <span>·</span> {statusLabel(member)}</p>
          </div>
        </div>
        <Button type="button" size="icon" variant="ghost" aria-label="Close configuration" onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="portal-team-inheritance" role="status">
        <ShieldCheck aria-hidden="true" />
        <strong>{inheritance}</strong>
        <span>
          {member.role === "partner_admin"
            ? "Changes here become the default for this admin and users who inherit from them."
            : member.parentName
              ? "Direct changes create a user override and do not change the admin."
              : "Assign an admin from the Users view to use inherited defaults."}
        </span>
      </div>

      <nav className="portal-team-config-tabs" role="tablist" aria-label="Member configuration">
        {(
          [
            ["overview", "Overview"],
            ["lead", "Lead form"],
            ["markets", "Markets"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="portal-team-config-body">
        {tab === "overview" ? (
          <div className="portal-team-config-overview">
            <div className="portal-team-config-summary-grid">
              <div><span>Role</span><strong>{roleLabel(member.role)}</strong></div>
              <div><span>Status</span><strong>{member.status === "active" ? "Active" : "Deactivated"}</strong></div>
              <div><span>Reports to</span><strong>{member.parentName ?? "No admin assigned"}</strong></div>
              <div><span>Access source</span><strong>{inheritance}</strong></div>
            </div>
            <div className="portal-team-next-step">
              <div className="portal-team-next-step-icon"><Settings2 aria-hidden="true" /></div>
              <div>
                <strong>Choose what to configure next</strong>
                <p>Keep member identity here, then use one focused workspace for lead intake or market access.</p>
              </div>
              <div className="portal-team-next-step-actions">
                <Button type="button" variant="outline" onClick={() => setTab("lead")}>Open lead form</Button>
                <Button type="button" variant="outline" onClick={() => setTab("markets")}>Open markets</Button>
              </div>
            </div>
          </div>
        ) : tab === "lead" ? (
          <div className="portal-team-form-workspace">
            <PartnerFormStudio partnerId={partnerId} target={target} readOnly={readOnly} compact />
          </div>
        ) : (
          <div className="portal-team-form-workspace">
            <PartnerMarketAccessPanel partnerId={partnerId} target={target} readOnly={readOnly} compact />
          </div>
        )}
      </div>
    </div>
  );
}
