import clsx from "clsx";
import { motion } from "motion/react";
import { useState } from "react";

import { ConfirmDialog, useToast } from "@/components/overlays";
import { Avatar, Button, Card, Field, Icon, Segmented, inputClass } from "@/components/ui";
import { useMembers, useWorkspaceMutations } from "@/hooks/queries";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { WorkspaceRole } from "@/lib/types";

type Tab = "general" | "members" | "account";
const ROLES: WorkspaceRole[] = ["admin", "member", "viewer"];
const ROLE_HELP: Record<WorkspaceRole, string> = {
  owner: "Full control, including members and billing",
  admin: "Manage members and Instagram connections",
  member: "Create and run campaigns, templates and leads",
  viewer: "Read-only access",
};

function General() {
  const { workspace } = useSession();
  const { rename } = useWorkspaceMutations();
  const toast = useToast();
  const [name, setName] = useState(workspace?.name ?? "");
  const canEdit = workspace?.role === "owner" || workspace?.role === "admin";
  return (
    <Card className="flex flex-col gap-space-md p-space-lg">
      <h2 className="font-title-lg text-title-lg text-on-surface">Workspace</h2>
      <Field label="Workspace name">
        <input className={inputClass} value={name} disabled={!canEdit} onChange={(e) => setName(e.target.value)} maxLength={120} />
      </Field>
      <div className="grid grid-cols-1 gap-space-sm font-body-sm text-body-sm md:grid-cols-3">
        <div className="rounded-lg bg-surface-container-low p-space-sm">
          <div className="text-outline">Workspace ID</div>
          <div className="truncate font-mono text-on-surface">{workspace?.id}</div>
        </div>
        <div className="rounded-lg bg-surface-container-low p-space-sm">
          <div className="text-outline">Your role</div>
          <div className="capitalize text-on-surface">{workspace?.role}</div>
        </div>
        <div className="rounded-lg bg-surface-container-low p-space-sm">
          <div className="text-outline">Created</div>
          <div className="text-on-surface">{formatDate(workspace?.created_at)}</div>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          icon="save"
          disabled={!canEdit || !name.trim() || name === workspace?.name}
          loading={rename.isPending}
          onClick={() => rename.mutate(name.trim(), { onSuccess: () => toast("Workspace renamed"), onError: (e) => toast(e.message, "error") })}
        >
          Save
        </Button>
      </div>
    </Card>
  );
}

function Members() {
  const { workspace, user } = useSession();
  const members = useMembers();
  const { addMember, updateMember, removeMember } = useWorkspaceMutations();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [removing, setRemoving] = useState<string | null>(null);
  const canManage = workspace?.role === "owner" || workspace?.role === "admin";
  return (
    <div className="flex flex-col gap-space-lg">
      {canManage && (
        <Card className="flex flex-col gap-space-md p-space-lg">
          <h2 className="font-title-lg text-title-lg text-on-surface">Invite by email</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">The person needs an InstaFlow account with this email.</p>
          <div className="flex flex-col gap-space-sm md:flex-row">
            <input className={clsx(inputClass, "flex-1")} type="email" placeholder="teammate@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <select className={clsx(inputClass, "md:w-40")} value={role} onChange={(e) => setRole(e.target.value as WorkspaceRole)}>
              {ROLES.map((r) => (
                <option key={r} value={r} className="capitalize">
                  {r}
                </option>
              ))}
            </select>
            <Button
              icon="person_add"
              disabled={!email.includes("@")}
              loading={addMember.isPending}
              onClick={() =>
                addMember.mutate(
                  { email, role },
                  { onSuccess: () => (toast("Member added"), setEmail("")), onError: (e) => toast(e.message, "error") },
                )
              }
            >
              Add member
            </Button>
          </div>
        </Card>
      )}
      <Card className="overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-surface-container-low font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
              <th className="px-space-md py-3">Member</th>
              <th className="px-space-md py-3">Role</th>
              <th className="px-space-md py-3">Joined</th>
              <th className="px-space-md py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-container font-body-md text-body-md">
            {members.data?.map((m) => {
              const isOwner = m.role === "owner";
              const isMe = m.user_id === user?.id;
              return (
                <motion.tr key={m.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <td className="px-space-md py-3">
                    <div className="flex items-center gap-space-sm">
                      <Avatar name={isMe ? user?.email : m.user_id} />
                      <div className="flex flex-col">
                        <span className="text-on-surface">{isMe ? `${user?.email} (you)` : "Workspace member"}</span>
                        <span className="font-mono text-[11px] text-outline">{m.user_id}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-space-md py-3">
                    {isOwner || !canManage ? (
                      <span className="rounded-full bg-primary-fixed px-2.5 py-0.5 font-label-sm text-label-sm font-semibold capitalize text-on-primary-fixed" title={ROLE_HELP[m.role]}>
                        {m.role}
                      </span>
                    ) : (
                      <select
                        aria-label="Role"
                        className="rounded-lg bg-surface-container-low px-2 py-1 font-label-md text-label-md capitalize"
                        value={m.role}
                        onChange={(e) => updateMember.mutate({ id: m.id, role: e.target.value }, { onSuccess: () => toast("Role updated"), onError: (err) => toast(err.message, "error") })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-space-md py-3 font-body-sm text-body-sm text-on-surface-variant">{formatDate(m.created_at)}</td>
                  <td className="px-space-md py-3 text-right">
                    {canManage && !isOwner && (
                      <Button size="sm" variant="ghost" icon="person_remove" className="text-error hover:text-error" onClick={() => setRemoving(m.id)}>
                        Remove
                      </Button>
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="grid grid-cols-1 gap-space-sm p-space-lg md:grid-cols-4">
        {(Object.keys(ROLE_HELP) as WorkspaceRole[]).map((r) => (
          <div key={r} className="rounded-lg bg-surface-container-low p-space-sm">
            <div className="font-title-sm text-title-sm capitalize text-on-surface">{r}</div>
            <div className="font-body-sm text-body-sm text-on-surface-variant">{ROLE_HELP[r]}</div>
          </div>
        ))}
      </Card>
      <ConfirmDialog
        open={Boolean(removing)}
        title="Remove member?"
        danger
        confirmLabel="Remove"
        loading={removeMember.isPending}
        body="They lose access to this workspace immediately."
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && removeMember.mutate(removing, { onSuccess: () => (toast("Member removed"), setRemoving(null)), onError: (e) => toast(e.message, "error") })}
      />
    </div>
  );
}

function Account() {
  const { user, logout } = useSession();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [signOutAll, setSignOutAll] = useState(false);
  return (
    <div className="flex flex-col gap-space-lg">
      <Card className="flex flex-col gap-space-md p-space-lg">
        <h2 className="font-title-lg text-title-lg text-on-surface">Profile</h2>
        <div className="flex items-center gap-space-sm">
          <Avatar name={user?.email} size="lg" />
          <div className="flex flex-col">
            <span className="font-title-sm text-title-sm text-on-surface">{user?.email}</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">Member since {formatDate(user?.created_at)}</span>
          </div>
        </div>
      </Card>
      <Card className="flex flex-col gap-space-md p-space-lg">
        <h2 className="font-title-lg text-title-lg text-on-surface">Change password</h2>
        <p className="font-body-sm text-body-sm text-on-surface-variant">Changing your password signs out every other session.</p>
        <div className="grid grid-cols-1 gap-space-sm md:grid-cols-2">
          <Field label="Current password">
            <input className={inputClass} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" hint="10+ characters, letters and numbers">
            <input className={inputClass} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button
            icon="key"
            loading={busy}
            disabled={!current || next.length < 10}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/users/me/password", { method: "POST", body: { current_password: current, new_password: next } });
                toast("Password changed");
                setCurrent("");
                setNext("");
              } catch (e) {
                toast(e instanceof Error ? e.message : "Couldn't change password", "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Update password
          </Button>
        </div>
      </Card>
      <Card className="flex flex-col justify-between gap-space-md p-space-lg md:flex-row md:items-center">
        <div>
          <h2 className="font-title-md text-title-md text-on-surface">Sign out of all sessions</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Revokes every refresh token for your account, on all devices.</p>
        </div>
        <Button variant="outline" icon="logout" onClick={() => setSignOutAll(true)}>
          Sign out everywhere
        </Button>
      </Card>
      <ConfirmDialog
        open={signOutAll}
        title="Sign out everywhere?"
        confirmLabel="Sign out"
        body="You'll need to sign in again on every device."
        onClose={() => setSignOutAll(false)}
        onConfirm={async () => {
          try {
            await api("/auth/logout", { method: "POST", body: { all_sessions: true } });
          } finally {
            logout();
          }
        }}
      />
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <div className="flex w-full flex-col gap-space-lg">
      <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
        <div>
          <h1 className="font-headline-md text-headline-md tracking-tight text-on-surface">Workspace Settings</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">Manage your workspace, team access and account security.</p>
        </div>
        <Segmented
          id="settings-tab"
          size="md"
          value={tab}
          onChange={setTab}
          options={[
            { value: "general", label: <span className="flex items-center gap-1"><Icon name="tune" className="text-[16px]" />General</span> },
            { value: "members", label: <span className="flex items-center gap-1"><Icon name="group" className="text-[16px]" />Members</span> },
            { value: "account", label: <span className="flex items-center gap-1"><Icon name="person" className="text-[16px]" />Account</span> },
          ]}
        />
      </div>
      <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {tab === "general" && <General />}
        {tab === "members" && <Members />}
        {tab === "account" && <Account />}
      </motion.div>
    </div>
  );
}
