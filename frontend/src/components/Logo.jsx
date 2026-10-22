let gradientId = 0;

export default function Logo({ size = 32, withWordmark = true, className = "" }) {
  const id = "logo-grad-" + (gradientId += 1);

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={id} x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#38bdf8" />
            <stop offset="1" stopColor="#2dd4bf" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="60" height="60" rx="16" fill="#0e1420" stroke={`url(#${id})`} strokeWidth="2" />
        <rect x="21" y="16" width="7" height="33" rx="3.5" fill={`url(#${id})`} />
        <path d="M25 16 C42 16 42 34 25 34" fill="none" stroke={`url(#${id})`} strokeWidth="7" strokeLinecap="round" />
        <circle cx="42" cy="23" r="6" fill="#22c55e" opacity="0.35" />
        <circle cx="42" cy="23" r="3.2" fill="#22c55e" />
      </svg>
      {withWordmark && (
        <span className="text-lg font-bold tracking-tight text-ink">
          Park<span className="text-accent">Grid</span>
        </span>
      )}
    </span>
  );
}
