export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="#3f51b5" />
      <path
        d="M10 12a6 6 0 0 1 12 0v1.5a6 6 0 0 1-6 6h-2.5L10 22v-4.2A6 6 0 0 1 10 13.5Z"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="13.5" cy="12.8" r="1.3" fill="#fff" />
      <circle cx="18.5" cy="12.8" r="1.3" fill="#fff" />
    </svg>
  );
}
