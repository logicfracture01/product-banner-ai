import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface BeforeAfterComparisonProps {
  before: string;
  after: string;
  size?: number | "lg";
  className?: string;
}

export function BeforeAfterComparison({
  before,
  after,
  size = 220,
  className,
}: BeforeAfterComparisonProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  const sizeClass =
    typeof size === "number" ? `max-w-[${size}px]` : "max-w-2xl";

  const move = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((clientX - rect.left) / rect.width) * 100;
      setPos(Math.max(0, Math.min(100, pct)));
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e.clientX);
    },
    [move],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      move(e.clientX);
    },
    [dragging, move],
  );

  const onPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div
      className={cn(
        "relative mx-auto",
        sizeClass,
        className,
      )}
      style={typeof size === "number" ? { width: size } : undefined}
    >
      <div
        ref={trackRef}
        className={cn(
          "relative touch-none overflow-hidden rounded-xl border border-border/70 bg-muted/40 select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={typeof size === "number" ? { width: size } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* After image — full frame */}
        <motion.img
          src={after}
          alt="After — cleaned product shot on a plain background"
          className="block h-auto w-full object-cover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          draggable={false}
        />

        {/* Before image — clipped reveal */}
        <motion.div
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <img
            src={before}
            alt="Before — messy product photo with clutter around it"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
            draggable={false}
          />
        </motion.div>

        {/* Draggable divider */}
        <div
          className="absolute inset-y-0 z-10"
          style={{ left: `calc(${pos}% - 1px)` }}
        >
          <div className="h-full w-0.5 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
          <div
            className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-lg ring-1 ring-black/10"
            aria-hidden
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              className="text-foreground"
            >
              <path
                d="M8 7 3 12l5 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M16 7l5 5-5 5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>

        {/* Labels */}
        <div className="absolute left-3 top-3 z-10 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium tracking-wide text-white backdrop-blur-sm">
          BEFORE
        </div>
        <div className="absolute right-3 top-3 z-10 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium tracking-wide text-white backdrop-blur-sm">
          AFTER
        </div>
      </div>
    </div>
  );
}
