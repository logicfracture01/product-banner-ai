import * as React from "react";
import { cn } from "@/lib/utils";

interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  setValue?: (value: number) => void;
}

export function Slider({
  label,
  min = 0,
  max = 100,
  step = 1,
  value,
  setValue,
  className,
  ...props
}: SliderProps) {
  const current = typeof value === "number" ? value : max;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseFloat(e.target.value);
    if (typeof setValue === "function") {
      setValue(next);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums text-foreground">
            {current}
          </span>
        </div>
      )}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={handleChange}
        className={cn("h-1.5 w-full appearance-none rounded-full bg-muted/60 cursor-pointer accent-brand", className)}
        {...props}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
