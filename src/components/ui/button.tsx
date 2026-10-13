import { clsx } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-50",
        {
          "bg-primary text-primary-foreground shadow-e2 hover:-translate-y-0.5 hover:bg-primary/90":
            variant === "default",
          "border border-border bg-card text-foreground shadow-e1 hover:border-primary/60 hover:bg-secondary":
            variant === "outline",
          "bg-transparent text-foreground hover:bg-muted/60":
            variant === "ghost",
          "bg-transparent text-foreground underline-offset-4 hover:underline":
            variant === "link",
        },
        {
          "h-9 px-4 text-sm": size === "default",
          "h-8 px-3 text-xs": size === "sm",
          "h-10 px-6 text-sm": size === "lg",
          "h-9 w-9 p-0": size === "icon",
        },
        className,
      )}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
