import { AnimatePresence } from "motion/react";
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { LogoMark } from "./components/Logo";
import { PageTransition } from "./components/motion";
import { AppShell } from "./layout/AppShell";
import { useSession } from "./lib/session";
import AuthPage from "./pages/Auth";

// Route-level code splitting keeps the first load small.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const CampaignEditor = lazy(() => import("./pages/CampaignEditor"));
const Simulator = lazy(() => import("./pages/Simulator"));
const Executions = lazy(() => import("./pages/Executions"));
const Templates = lazy(() => import("./pages/Templates"));
const Accounts = lazy(() => import("./pages/Accounts"));
const Leads = lazy(() => import("./pages/Leads"));
const Events = lazy(() => import("./pages/Events"));
const Settings = lazy(() => import("./pages/Settings"));
const NotFound = lazy(() => import("./pages/NotFound"));

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-space-md">
        <LogoMark className="h-12 w-12 animate-pulse" />
        <span className="font-label-md text-label-md text-on-surface-variant">Loading InstaFlow…</span>
      </div>
    </div>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}

export function App() {
  const { status } = useSession();
  const location = useLocation();

  if (status === "loading") return <Splash />;
  if (status === "anonymous") {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<div className="h-[60vh]" />}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname.split("/").slice(0, 3).join("/")}>
            <Route path="/" element={<Page><Dashboard /></Page>} />
            <Route path="/campaigns" element={<Page><Campaigns /></Page>} />
            <Route path="/campaigns/new" element={<Page><CampaignEditor /></Page>} />
            <Route path="/campaigns/:id" element={<Page><CampaignEditor /></Page>} />
            <Route path="/simulator" element={<Page><Simulator /></Page>} />
            <Route path="/executions" element={<Page><Executions /></Page>} />
            <Route path="/templates" element={<Page><Templates /></Page>} />
            <Route path="/accounts" element={<Page><Accounts /></Page>} />
            <Route path="/leads" element={<Page><Leads /></Page>} />
            <Route path="/events" element={<Page><Events /></Page>} />
            <Route path="/settings" element={<Page><Settings /></Page>} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/register" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Page><NotFound /></Page>} />
          </Routes>
        </AnimatePresence>
      </Suspense>
    </AppShell>
  );
}
