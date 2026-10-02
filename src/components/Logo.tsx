import { cn } from "@/lib/utils";

/**
 * Relight mark: a studio key light (amber wedge) aimed at a product slab
 * (teal) sitting on a surface line, all inside a rounded ink tile.
 *
 * Geometric and low-detail on purpose — it has to stay legible at 16px in a
 * favicon and at 40px in the nav without becoming a different shape.
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
        <linearGradient id="rl-beam" x1="14" y1="12" x2="40" y2="46">
          <stop offset="0" stopColor="#FFD79A" />
          <stop offset="0.55" stopColor="#F4B23E" />
          <stop offset="1" stopColor="#F0A02C" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="rl-slab" x1="22" y1="40" x2="46" y2="52">
          <stop offset="0" stopColor="#3FE0C8" />
          <stop offset="1" stopColor="#17A99A" />
        </linearGradient>
        <linearGradient id="rl-tile" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0" stopColor="#1B262B" />
          <stop offset="1" stopColor="#0B1114" />
        </linearGradient>
      </defs>

      <rect width="64" height="64" rx="16" fill="url(#rl-tile)" />
      {/* inner hairline keeps the tile from looking flat on dark pages */}
      <rect
        x="0.75"
        y="0.75"
        width="62.5"
        height="62.5"
        rx="15.25"
        stroke="#ffffff"
        strokeOpacity="0.14"
        strokeWidth="1.5"
        fill="none"
      />

      <g className={animated ? "rl-mark-anim" : undefined}>
        {/* key-light wedge from upper-left */}
        <path
          d="M17 15 L33 15 L46 47 L30 47 Z"
          fill="url(#rl-beam)"
          className={animated ? "rl-beam" : undefined}
        />
        {/* product slab catching the light */}
        <rect
          x="21"
          y="38"
          width="27"
          height="11"
          rx="3.2"
          fill="url(#rl-slab)"
          className={animated ? "rl-slab" : undefined}
        />
        {/* surface line / contact */}
        <rect x="14" y="52" width="36" height="2.6" rx="1.3" fill="#ffffff" fillOpacity="0.5" />
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
          <span className="mt-[3px] hidden text-[0.62em] font-medium tracking-[0.14em] text-muted-foreground uppercase sm:block">
            Product Photo Studio
          </span>
        </span>
      )}
    </span>
  );
}