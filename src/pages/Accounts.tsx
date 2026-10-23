import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { fadeUp, staggerContainer } from "@/components/motion";
import { ConfirmDialog, useToast } from "@/components/overlays";
import { ConnectionStatusChip } from "@/components/status";
import { Avatar, Button, Card, EmptyState, Icon, Skeleton } from "@/components/ui";
import { useConnections, useDisconnect, useMedia, useStartConnect, useSyncMedia } from "@/hooks/queries";
import { api } from "@/lib/api";
import { daysUntil, formatDate, timeAgo } from "@/lib/format";
import type { Connection } from "@/lib/types";

function MediaGrid({ connection }: { connection: Connection }) {
  const media = useMedia(connection.id);
  const navigate = useNavigate();
  if (media.isLoading) return <Skeleton className="h-40" />;
  if (!media.data?.length) {
    return <EmptyState icon="photo_library" title="No media synced yet" body="Sync to pull your recent posts and Reels from Instagram." />;
  }
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-2 gap-space-md sm:grid-cols-3 lg:grid-cols-5">
      {media.data.map((m) => {
        const reel = (m.media_type ?? "").toUpperCase().includes("REEL") || m.media_type === "VIDEO";
        return (
          <motion.div key={m.id} variants={fadeUp} whileHover={{ y: -3 }} className="group relative flex flex-col overflow-hidden rounded-xl bg-surface-container-low">
            <div className="relative flex aspect-square items-center justify-center bg-surface-container-high text-secondary">
              <Icon name={reel ? "movie" : "image"} className="text-[36px]" />
              <span className="absolute left-2 top-2 rounded-full bg-inverse-surface/80 px-2 py-0.5 font-label-sm text-label-sm text-inverse-on-surface">{reel ? "Reel" : "Post"}</span>
              <div className="absolute inset-0 flex items-center justify-center bg-inverse-surface/50 opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="sm" icon="add" onClick={() => navigate(`/campaigns/new?media=${m.id}&connection=${connection.id}`)}>
                  Create campaign
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-0.5 p-space-sm">
              <span className="truncate font-label-md text-label-md text-on-surface">{m.caption || "Untitled"}</span>
              <span className="font-label-sm text-label-sm text-outline">{formatDate(m.published_at)}</span>
            </div>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

export default function Accounts() {
  const connections = useConnections();
  const start = useStartConnect();
  const sync = useSyncMedia();
  const disconnect = useDisconnect();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Connection | null>(null);
  const [connecting, setConnecting] = useState(false);

  const list = connections.data ?? [];
  const current = list.find((c) => c.id === selected) ?? list.find((c) => c.status === "active") ?? list[0];

  // Completes the OAuth round-trip when Instagram (or the mock flow) redirects back with ?code&state.
  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    if (!state) return;
    setConnecting(true);
    api<Connection>("/instagram/callback", { query: { code, state, error }, auth: false })
      .then((c) => {
        toast(`Connected @${c.username ?? c.instagram_account_id}`);
        setSelected(c.id);
        qc.invalidateQueries({ queryKey: ["connections"] });
      })
      .catch((e) => toast(e.message, "error"))
      .finally(() => {
        setConnecting(false);
        setParams({}, { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function connect() {
    start.mutate(undefined, {
      onSuccess: (r) => {
        const url = new URL(r.authorization_url, window.location.origin);
        if (r.mode === "mock") {
          // Mock mode loops straight back; finish it here so the user stays in the app.
          window.location.assign(`/accounts?${url.searchParams.toString()}`);
        } else {
          window.location.assign(url.toString());
        }
      },
      onError: (e) => toast(e.message, "error"),
    });
  }

  return (
    <div className="flex w-full flex-col gap-space-lg">
      <div className="flex flex-col justify-between gap-space-md md:flex-row md:items-end">
        <div>
          <h1 className="font-headline-md text-headline-md tracking-tight text-on-surface">Instagram Accounts</h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Connect professional accounts through the official Instagram Login. Tokens are encrypted at rest and never shown.
          </p>
        </div>
        <Button icon="add_link" loading={start.isPending || connecting} onClick={connect}>
          Connect Instagram account
        </Button>
      </div>

      {connections.isLoading && <Skeleton className="h-40" />}
      {!connections.isLoading && list.length === 0 && (
        <Card>
          <EmptyState
            icon="switch_account"
            title="No accounts connected"
            body="Connect an Instagram professional account to run live campaigns. In simulation mode the connection is mocked, so you can try the whole flow safely."
            action={<Button icon="add_link" onClick={connect}>Connect account</Button>}
          />
        </Card>
      )}

      <motion.div variants={staggerContainer} initial="hidden" animate="show" className="grid grid-cols-1 gap-space-md md:grid-cols-2 xl:grid-cols-3">
        {list.map((c) => {
          const days = daysUntil(c.token_expires_at);
          const active = current?.id === c.id;
          return (
            <motion.div
              key={c.id}
              variants={fadeUp}
              whileHover={{ y: -2 }}
              onClick={() => setSelected(c.id)}
              className={clsx("flex cursor-pointer flex-col gap-space-sm rounded-xl bg-surface-container-lowest p-space-md shadow-sm transition-shadow", active && "ring-2 ring-primary-container")}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-sm">
                  <Avatar name={c.username ?? c.instagram_account_id} size="lg" />
                  <div className="flex flex-col">
                    <span className="font-title-sm text-title-sm text-on-surface">@{c.username ?? c.instagram_account_id}</span>
                    <span className="font-body-sm text-body-sm text-on-surface-variant">{c.auth_method === "mock" ? "Mock connection (simulation)" : "Instagram Login"}</span>
                  </div>
                </div>
                <ConnectionStatusChip status={c.status} />
              </div>
              <div className="flex flex-wrap gap-1">
                {c.granted_permissions.map((p) => (
                  <span key={p} className="rounded-full bg-surface-container px-2 py-0.5 font-label-sm text-label-sm text-on-surface-variant">
                    {p.replace("instagram_business_", "")}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-space-xs font-body-sm text-body-sm">
                <div className="rounded bg-surface-container-low px-space-sm py-1.5">
                  <div className="text-secondary">Token expires</div>
                  <div className={clsx("font-title-sm text-title-sm", days != null && days < 7 ? "text-amber-800" : "text-on-surface")}>
                    {days == null ? "Unknown" : days <= 0 ? "Expired" : `in ${days} days`}
                  </div>
                </div>
                <div className="rounded bg-surface-container-low px-space-sm py-1.5">
                  <div className="text-secondary">Last sync</div>
                  <div className="font-title-sm text-title-sm text-on-surface">{c.last_synced_at ? timeAgo(c.last_synced_at) : "Never"}</div>
                </div>
              </div>
              <div className="flex gap-space-xs">
                <Button
                  size="sm"
                  variant="tonal"
                  icon="sync"
                  disabled={c.status !== "active"}
                  loading={sync.isPending && sync.variables === c.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    sync.mutate(c.id, { onSuccess: (m) => toast(`Synced ${m.length} posts`), onError: (err) => toast(err.message, "error") });
                  }}
                >
                  Sync media
                </Button>
                {c.status !== "active" && c.status !== "revoked" && (
                  <Button size="sm" icon="link" onClick={(e) => (e.stopPropagation(), connect())}>
                    Reconnect
                  </Button>
                )}
                {c.status !== "revoked" && (
                  <Button size="sm" variant="ghost" icon="link_off" className="ml-auto text-error hover:text-error" onClick={(e) => (e.stopPropagation(), setConfirm(c))}>
                    Disconnect
                  </Button>
                )}
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      <AnimatePresence mode="wait">
        {current && (
          <Card key={current.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col gap-space-md p-space-lg">
            <div className="flex items-center justify-between">
              <h2 className="font-title-lg text-title-lg text-on-surface">Media for @{current.username ?? current.instagram_account_id}</h2>
              <span className="font-label-md text-label-md text-on-surface-variant">Hover a post to start a campaign</span>
            </div>
            <MediaGrid connection={current} />
          </Card>
        )}
      </AnimatePresence>

      <Card className="flex items-start gap-space-md bg-surface-container-low p-space-lg">
        <Icon name="info" className="text-[22px] text-primary" />
        <div className="flex flex-col gap-1 font-body-md text-body-md text-on-surface-variant">
          <span className="font-title-sm text-title-sm text-on-surface">How live connections work</span>
          <span>
            InstaFlow uses Meta's official Instagram API with Instagram Login. It needs the <code className="rounded bg-surface-container px-1">instagram_business_basic</code> and{" "}
            <code className="rounded bg-surface-container px-1">instagram_business_manage_comments</code> permissions. Long-lived tokens last 60 days and are refreshed automatically.
            Follower status is not available from Instagram, so campaigns treat it as unknown.
          </span>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(confirm)}
        title="Disconnect this account?"
        danger
        confirmLabel="Disconnect"
        loading={disconnect.isPending}
        body="The stored token is deleted and live campaigns on this account stop sending. You can reconnect at any time."
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          confirm &&
          disconnect.mutate(confirm.id, {
            onSuccess: () => (toast("Account disconnected"), setConfirm(null)),
            onError: (e) => (toast(e.message, "error"), setConfirm(null)),
          })
        }
      />
    </div>
  );
}
