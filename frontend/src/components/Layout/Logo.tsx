import clsx from "clsx";

interface LogoProps {
  compact?: boolean;
  className?: string;
}

export function Logo({ compact = false, className }: LogoProps) {
  return (
    <div className={clsx("flex items-center gap-3 min-w-0", className)}>
      <div
        className={clsx(
          "logo-icon relative flex-shrink-0 rounded-xl bg-primary-500 shadow-md shadow-primary-500/25 flex items-center justify-center",
          compact ? "w-9 h-9" : "w-10 h-10",
        )}
      >
        <svg
          viewBox="0 0 24 24"
          className={clsx("text-white", compact ? "w-5 h-5" : "w-5 h-5")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          <path d="M8 7h8M8 11h6" />
        </svg>
        <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20" />
      </div>
      {!compact && (
        <span className="logo-wordmark text-base font-bold tracking-tight truncate" title="Research Atlas">
          Research Atlas
        </span>
      )}
    </div>
  );
}
