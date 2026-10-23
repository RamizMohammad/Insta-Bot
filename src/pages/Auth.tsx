import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { LogoMark } from "@/components/Logo";
import { Button, Field, Icon, inputClass } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";

function strength(password: string) {
  let score = 0;
  if (password.length >= 10) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score;
}

export default function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { login, register } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";
  const score = strength(password);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(email, password, workspace);
      else await login(email, password);
      navigate((location.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "validation_error") {
        const details = (err.details as { loc: string[]; msg: string }[] | undefined) ?? [];
        const first = details[0];
        setError(
          first
            ? `${first.loc[first.loc.length - 1] === "email" ? "Email" : "Password"}: ${first.msg.replace(/^Value error, /, "")}`
            : "Please check your email and password.",
        );
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-space-md">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="mb-space-lg flex flex-col items-center gap-space-sm text-center">
          <LogoMark className="h-12 w-12" />
          <h1 className="font-headline-sm text-headline-sm text-on-surface">
            {isRegister ? "Create your InstaFlow account" : "Sign in to InstaFlow"}
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            {isRegister ? "Automate Instagram comment replies, safely." : "Welcome back. Your automations are waiting."}
          </p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-space-md rounded-2xl bg-surface-container-lowest p-space-lg shadow-sm">
          <Field label="Email">
            <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" hint={isRegister ? "10+ characters" : undefined}>
            <input
              className={inputClass}
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              minLength={isRegister ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {isRegister && (
            <>
              <div className="-mt-space-xs flex gap-1" aria-label="Password strength">
                {[0, 1, 2, 3].map((i) => (
                  <motion.span
                    key={i}
                    className="h-1 flex-1 rounded-full"
                    animate={{ backgroundColor: i < score ? (score >= 3 ? "#2e7d32" : "#e65100") : "#efedf2" }}
                  />
                ))}
              </div>
              <Field label="Workspace name" hint="Optional">
                <input className={inputClass} placeholder="e.g. Studio Creatives Co." value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
              </Field>
            </>
          )}
          {error && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="flex items-start gap-space-xs rounded-lg bg-error-container px-space-sm py-2 font-body-sm text-body-sm text-on-error-container">
              <Icon name="error" className="text-[18px]" />
              {error}
            </motion.div>
          )}
          <Button type="submit" size="lg" loading={busy} className="w-full">
            {isRegister ? "Create account" : "Sign in"}
          </Button>
        </form>
        <p className="mt-space-md text-center font-body-md text-body-md text-on-surface-variant">
          {isRegister ? "Already have an account?" : "New to InstaFlow?"}{" "}
          <Link to={isRegister ? "/login" : "/register"} className="font-semibold text-primary hover:underline">
            {isRegister ? "Sign in" : "Create account"}
          </Link>
        </p>
      </motion.div>
    </div>
  );
}
