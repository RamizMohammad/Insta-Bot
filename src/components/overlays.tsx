// Animated overlays: side drawer, modal dialog, confirm dialog, toasts and dropdown menus.
import clsx from "clsx";
import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button, Icon } from "./ui";

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center p-space-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[rgba(26,28,30,0.32)]" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className={clsx("relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-surface-container-lowest shadow-xl", width)}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <div className="flex items-center justify-between px-space-lg pb-space-sm pt-space-lg">
              <h2 className="font-title-lg text-title-lg text-on-surface">{title}</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high"
              >
                <Icon name="close" className="text-[20px]" />
              </button>
            </div>
            <div className="overflow-y-auto px-space-lg pb-space-md">{children}</div>
            {footer && <div className="flex justify-end gap-space-sm bg-surface-container-low px-space-lg py-space-md">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="font-body-md text-body-md text-on-surface-variant">{body}</div>
    </Modal>
  );
}

export function Drawer({
  open,
  onClose,
  children,
  width = "w-full sm:w-[440px]",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEscape(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-[rgba(26,28,30,0.18)]"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.aside
            className={clsx("fixed bottom-0 right-0 top-0 z-[61] flex flex-col bg-surface-container-lowest shadow-2xl", width)}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// --- Toasts -------------------------------------------------------------------------
type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((message: string, tone: Tone = "success") => {
    const id = ++counter.current;
    setToasts((t) => [...t, { id, tone, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);
  const icons: Record<Tone, string> = { success: "check_circle", error: "error", info: "info" };
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="pointer-events-auto flex max-w-[90vw] items-center gap-space-sm rounded-lg bg-inverse-surface px-space-md py-2.5 text-inverse-on-surface shadow-lg"
              role="status"
            >
              <Icon
                name={icons[t.tone]}
                className={clsx(
                  "text-[18px]",
                  t.tone === "error" ? "text-[#ffb4ab]" : t.tone === "success" ? "text-emerald-300" : "text-inverse-primary",
                )}
              />
              <span className="font-body-md text-body-md">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// --- Dropdown menu --------------------------------------------------------------------
export function Menu({
  trigger,
  children,
  align = "left",
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  useEscape(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className={clsx(
              "absolute z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-outline-variant/60 bg-surface-container-lowest py-1 shadow-[0_8px_16px_-4px_rgba(26,28,30,0.08),0_2px_6px_-2px_rgba(26,28,30,0.04)]",
              align === "right" ? "right-0" : "left-0",
              className,
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  active,
  danger,
}: {
  icon?: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-space-sm px-space-md py-2 text-left font-body-md text-body-md transition-colors hover:bg-surface-container-low",
        danger ? "text-error" : "text-on-surface",
        active && "font-semibold text-primary",
      )}
    >
      {icon && <Icon name={icon} className="text-[18px]" />}
      <span className="flex-1">{children}</span>
      {active && <Icon name="check" className="text-[16px]" />}
    </button>
  );
}

/** Dropdown button styled like Stitch's "Label: Value ▾" selectors. */
export function SelectMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  icon,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  icon?: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <Menu
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-1.5 rounded-lg bg-surface-container-low px-space-md py-2 font-label-md text-label-md text-on-surface transition-colors hover:bg-surface-container"
        >
          {icon && <Icon name={icon} className="text-[18px] text-on-surface-variant" />}
          {label && <span className="text-on-surface-variant">{label}:</span>}
          <span className="font-semibold">{current}</span>
          <Icon name="arrow_drop_down" className="text-[18px] text-on-surface-variant" />
        </button>
      )}
    >
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={o.value}
            active={o.value === value}
            onClick={() => {
              onChange(o.value);
              close();
            }}
          >
            {o.label}
          </MenuItem>
        ))
      }
    </Menu>
  );
}
