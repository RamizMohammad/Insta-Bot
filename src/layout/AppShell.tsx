// Fixed navigation sidebar + top app bar from the Stitch layout, with workspace switching,
// the Live/Simulation view toggle, notifications and a ⌘K command palette.
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { LogoMark } from "@/components/Logo";
import { Menu, MenuItem, Modal, useToast } from "@/components/overlays";
import { Avatar, Button, Icon, Kbd, Segmented } from "@/components/ui";
import { useAllCampaigns, useConnections, useOverview, useReadiness, useWorkspaceMutations } from "@/hooks/queries";
import { useSession } from "@/lib/session";

const NAV = [
  { to: "/", label: "Dashboard", icon: "grid_view", end: true },
  { to: "/campaigns", label: "Campaigns", icon: "campaign" },
  { to: "/accounts", label: "Instagram Accounts", icon: "switch_account" },
  { to: "/simulator", label: "Simulator", icon: "science" },
  { to: "/executions", label: "Executions", icon: "terminal" },
  { to: "/templates", label: "Message Templates", icon: "chat_bubble_outline" },
  { to: "/leads", label: "Leads", icon: "group" },
  { to: "/events", label: "Events Log", icon: "history" },
];

function NavItem({ to, label, icon, end, dot, onNavigate }: (typeof NAV)[number] & { dot?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          "relative flex items-center justify-between rounded-lg px-space-md py-space-sm transition-colors",
          isActive ? "font-medium text-on-primary" : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="nav-active"
              className="absolute inset-0 rounded-lg bg-primary-container shadow-sm"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
          <span className="relative flex items-center gap-space-sm">
            <Icon name={icon} className="text-[20px]" />
            <span className="font-label-lg text-label-lg">{label}</span>
          </span>
          {dot && <span className={clsx("relative h-2 w-2 rounded-full", isActive ? "bg-on-primary" : "bg-primary")} />}
        </>
      )}
    </NavLink>
  );
}

function SystemStatus() {
  const { data, isError } = useReadiness();
  const ok = data?.status === "ready";
  const workerAlive = data?.checks.redis.worker_alive;
  const label = isError || !data ? "Status unavailable" : ok ? (workerAlive ? "All systems operational" : "API ready · worker idle") : "Degraded: check services";
  return (
    <div className="flex items-center gap-space-xs rounded-lg bg-surface-container-low px-space-sm py-1.5" title={data ? JSON.stringify(data.checks) : undefined}>
      <span className={clsx("h-2 w-2 rounded-full", ok ? "animate-pulse bg-emerald-500" : "bg-amber-500")} />
      <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { viewMode } = useSession();
  const overview = useOverview();
  const activeCampaigns = (overview.data?.campaigns.active ?? 0) > 0;
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="flex flex-col">
        <div className="flex h-16 items-center justify-between px-space-md">
          <div className="flex items-center gap-space-sm">
            <LogoMark />
            <span className="font-title-md text-title-md tracking-tight text-primary">InstaFlow</span>
          </div>
          <span className="rounded-full bg-secondary-container px-space-xs py-0.5 font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-secondary-container">
            {viewMode === "live" ? "Live" : "Sim"}
          </span>
        </div>
        <nav className="mt-space-sm flex flex-col gap-1 px-space-sm" aria-label="Main">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} dot={item.to === "/campaigns" && activeCampaigns} onNavigate={onNavigate} />
          ))}
        </nav>
      </div>
      <div className="flex flex-col gap-space-xs p-space-sm">
        <SystemStatus />
        <NavItem to="/settings" label="Workspace Settings" icon="settings" onNavigate={onNavigate} />
      </div>
    </div>
  );
}

function WorkspaceSwitcher() {
  const { workspace, workspaces, switchWorkspace } = useSession();
  const { create } = useWorkspaceMutations();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  return (
    <>
      <Menu
        trigger={({ toggle }) => (
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-space-sm rounded-lg px-space-sm py-1.5 transition-colors hover:bg-surface-container-low"
          >
            <span className="max-w-[180px] truncate font-title-sm text-title-sm text-on-surface">{workspace?.name ?? "Workspace"}</span>
            <Icon name="expand_more" className="text-[18px] text-on-surface-variant" />
          </button>
        )}
      >
        {(close) => (
          <>
            <div className="px-space-md py-1.5 font-label-sm text-label-sm uppercase tracking-wider text-outline">Workspaces</div>
            {workspaces.map((w) => (
              <MenuItem
                key={w.id}
                icon="workspaces"
                active={w.id === workspace?.id}
                onClick={() => {
                  switchWorkspace(w.id);
                  close();
                }}
              >
                {w.name} <span className="ml-1 text-outline">· {w.role}</span>
              </MenuItem>
            ))}
            <div className="my-1 h-px bg-surface-container" />
            <MenuItem
              icon="add"
              onClick={() => {
                setCreating(true);
                close();
              }}
            >
              New workspace
            </MenuItem>
          </>
        )}
      </Menu>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New workspace"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!name.trim()}
              onClick={() =>
                create.mutate(name.trim(), {
                  onSuccess: (ws) => {
                    switchWorkspace(ws.id);
                    setCreating(false);
                    setName("");
                    toast(`Switched to ${ws.name}`);
                  },
                  onError: (e) => toast(e.message, "error"),
                })
              }
            >
              Create
            </Button>
          </>
        }
      >
        <input
          autoFocus
          className="input"
          placeholder="e.g. Studio Creatives Co."
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Modal>
    </>
  );
}

function Notifications() {
  const overview = useOverview();
  const navigate = useNavigate();
  const items = overview.data?.attention ?? [];
  return (
    <Menu
      align="right"
      className="w-80"
      trigger={({ toggle }) => (
        <button
          type="button"
          aria-label="Notifications"
          onClick={toggle}
          className="relative rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="notifications" className="text-[22px]" />
          {items.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-error" />}
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col">
          <div className="px-space-md py-2 font-title-sm text-title-sm text-on-surface">Needs attention</div>
          {items.length === 0 && (
            <div className="px-space-md pb-space-md font-body-sm text-body-sm text-on-surface-variant">You're all caught up.</div>
          )}
          {items.slice(0, 6).map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                close();
                navigate(item.kind === "connection" ? "/accounts" : `/executions?campaign=${item.campaign_id ?? ""}`);
              }}
              className="flex items-start gap-space-sm px-space-md py-2 text-left hover:bg-surface-container-low"
            >
              <Icon
                name={item.severity === "critical" ? "error" : item.severity === "warning" ? "warning" : "visibility"}
                className={clsx("mt-0.5 text-[18px]", item.severity === "critical" ? "text-error" : "text-amber-700")}
              />
              <span className="flex flex-col">
                <span className="font-title-sm text-title-sm text-on-surface">{item.title}</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">{item.detail}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Menu>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const campaigns = useAllCampaigns();
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pages = NAV.concat([{ to: "/settings", label: "Workspace Settings", icon: "settings", end: false }])
      .filter((n) => !needle || n.label.toLowerCase().includes(needle))
      .map((n) => ({ key: n.to, icon: n.icon, label: n.label, hint: "Page", to: n.to }));
    const camp = (campaigns.data?.items ?? [])
      .filter((c) => needle && c.name.toLowerCase().includes(needle))
      .slice(0, 6)
      .map((c) => ({ key: c.id, icon: "campaign", label: c.name, hint: c.status, to: `/campaigns/${c.id}` }));
    const searchLeads = needle ? [{ key: "lead", icon: "person_search", label: `Search leads for "${q.trim()}"`, hint: "Leads", to: `/leads?search=${encodeURIComponent(q.trim())}` }] : [];
    return [...camp, ...pages, ...searchLeads];
  }, [q, campaigns.data]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [q, open]);
  const go = (to: string) => {
    navigate(to);
    onClose();
    setQ("");
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[75] flex items-start justify-center p-space-md pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-[rgba(26,28,30,0.32)]" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl bg-surface-container-lowest shadow-2xl"
          >
            <div className="flex items-center gap-space-sm border-b border-surface-container px-space-md">
              <Icon name="search" className="text-[20px] text-outline" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, results.length - 1));
                  if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
                  if (e.key === "Enter" && results[index]) go(results[index].to);
                  if (e.key === "Escape") onClose();
                }}
                placeholder="Search campaigns, pages, leads..."
                className="h-14 flex-1 bg-transparent font-body-lg text-body-lg text-on-surface placeholder:text-outline focus:outline-none"
              />
              <Kbd>Esc</Kbd>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={r.key}>
                  <button
                    type="button"
                    onMouseEnter={() => setIndex(i)}
                    onClick={() => go(r.to)}
                    className={clsx("flex w-full items-center gap-space-sm px-space-md py-2.5 text-left", i === index && "bg-surface-container-low")}
                  >
                    <Icon name={r.icon} className="text-[18px] text-secondary" />
                    <span className="flex-1 font-body-md text-body-md text-on-surface">{r.label}</span>
                    <span className="font-label-sm text-label-sm capitalize text-outline">{r.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user, viewMode, setViewMode, logout } = useSession();
  const connections = useConnections();
  const navigate = useNavigate();
  const [palette, setPalette] = useState(false);
  const account = connections.data?.find((c) => c.status === "active") ?? connections.data?.[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between gap-space-sm bg-surface-container-lowest/90 px-space-md shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-md lg:left-60 lg:px-space-lg">
      <div className="flex min-w-0 items-center gap-space-sm lg:gap-space-md">
        <button type="button" aria-label="Open navigation" onClick={onMenu} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container lg:hidden">
          <Icon name="menu" className="text-[22px]" />
        </button>
        <WorkspaceSwitcher />
        <button
          type="button"
          onClick={() => navigate("/accounts")}
          className="hidden items-center gap-1.5 rounded-full bg-secondary-container px-space-sm py-1 font-label-sm text-label-sm text-on-secondary-container transition-opacity hover:opacity-90 md:flex"
          title="Instagram account"
        >
          <Icon name="alternate_email" className="text-[14px]" />
          <span className="max-w-[140px] truncate">{account?.username ?? (account ? account.instagram_account_id : "connect account")}</span>
        </button>
        <div className="hidden xl:block">
          <Segmented
            id="view-mode"
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "live", label: "Live Mode" },
              { value: "simulation", label: "Simulation" },
            ]}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPalette(true)}
        className="relative mx-space-md hidden min-w-0 max-w-md flex-1 items-center rounded-xl bg-surface-container-low py-2 pl-10 pr-4 text-left font-body-sm text-body-sm text-outline transition-all hover:bg-surface-container md:flex"
      >
        <Icon name="search" className="absolute left-3 text-[20px] text-outline" />
        <span className="truncate">Search campaigns, leads, executions...</span>
        <span className="absolute right-3">
          <Kbd>⌘K</Kbd>
        </span>
      </button>
      <div className="flex items-center gap-space-sm lg:gap-space-md">
        <button type="button" aria-label="Search" onClick={() => setPalette(true)} className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container md:hidden">
          <Icon name="search" className="text-[22px]" />
        </button>
        <Button icon="add" className="hidden sm:inline-flex" onClick={() => navigate("/campaigns/new")}>
          New Campaign
        </Button>
        <Notifications />
        <Menu
          align="right"
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className="flex items-center gap-space-xs" aria-label="Account menu">
              <Avatar name={user?.email} />
              <Icon name="arrow_drop_down" className="text-[18px] text-on-surface-variant" />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-space-md py-2">
                <div className="font-title-sm text-title-sm text-on-surface">{user?.email}</div>
                <div className="font-body-sm text-body-sm text-on-surface-variant">Signed in</div>
              </div>
              <div className="my-1 h-px bg-surface-container" />
              <MenuItem icon="settings" onClick={() => (close(), navigate("/settings"))}>
                Workspace settings
              </MenuItem>
              <MenuItem icon="logout" danger onClick={() => (close(), logout())}>
                Sign out
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileNav, setMobileNav] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileNav(false), [location.pathname]);
  return (
    <div className="min-h-screen bg-surface">
      <aside className="fixed left-0 top-0 z-50 hidden h-full w-60 select-none bg-surface-container-lowest shadow-[0_1px_8px_rgba(0,0,0,0.04)] lg:block">
        <Sidebar />
      </aside>
      <AnimatePresence>
        {mobileNav && (
          <>
            <motion.div className="fixed inset-0 z-[55] bg-[rgba(26,28,30,0.32)] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNav(false)} />
            <motion.aside
              className="fixed left-0 top-0 z-[56] h-full w-64 bg-surface-container-lowest shadow-xl lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 40 }}
            >
              <Sidebar onNavigate={() => setMobileNav(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="lg:pl-60">
        <TopBar onMenu={() => setMobileNav(true)} />
        <main className="min-h-screen w-full bg-surface pt-16">
          <div className="mx-auto w-full max-w-7xl p-margin-mobile md:p-margin">{children}</div>
        </main>
      </div>
    </div>
  );
}
