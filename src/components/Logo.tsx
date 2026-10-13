import { cn } from "@/lib/utils";

/**
 * Relight mark: a single amber key light striking a matte card.
 * Deliberately minimal — legible at favicon scale and in the nav.
 */
export function LogoMark({
  size = 28,
  className,
  animated = false,
}: {
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0 overflow-visible", className)}
    >
      <defs>
        <linearGradient id="rl-beam" x1="14" y1="12" x2="42" y2="48">
          <stop offset="0" stopColor="#FFE0B0" />
          <stop offset="0.6" stopColor="#F4B23E" />
          <stop offset="1" stopColor="#F0A02C" stopOpacity="0.12" />
        </linearGradient>
        <linearGradient id="rl-card" x1="20" y1="38" x2="46" y2="50">
          <stop offset="0" stopColor="#F2D9C4" />
          <stop offset="1" stopColor="#D9B29A" />
        </linearGradient>
      </defs>

      {/* soft ink tile */}
      <rect width="64" height="64" rx="15" fill="#15181B" />
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="14.25"
        stroke="#ffffff"
        strokeOpacity="0.10"
        strokeWidth="1.25"
        fill="none"
      />

      <g className={animated ? "rl-mark-anim" : undefined}>
        {/* amber key light */}
        <path
          d="M17 15 L33 15 L46 47 L30 47 Z"
          fill="url(#rl-beam)"
          className={animated ? "rl-beam" : undefined}
        />
        {/* matte card catching the light */}
        <rect
          x="20"
          y="38"
          width="27"
          height="11"
          rx="3.2"
          fill="url(#rl-card)"
          className={animated ? "rl-slab" : undefined}
        />
        {/* contact shadow line */}
        <rect x="14" y="52" width="36" height="2.4" rx="1.2" fill="#ffffff" fillOpacity="0.4" />
      </g>
    </svg>
  );
}

export function Logo({
  size = 28,
  withWordmark = true,
  animated = false,
  className,
}: {
  size?: number;
  withWordmark?: boolean;
  animated?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <LogoMark size={size} animated={animated} />
      {withWordmark && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[1.05em] font-semibold tracking-[-0.03em] text-foreground">
            Relight
          </span>
          <span className="mt-[3px] hidden text-[0.6em] font-medium tracking-[0.14em] text-muted-foreground uppercase sm:block">
            Product Photo Studio
          </span>
        </span>
      )}
    </span>
  );
}