import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";

/** Theme switch — plain segmented control, no spinning, no shrinking, no hidden button chrome. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        "flex size-7 items-center rounded-full border border-border/70 bg-card shadow-e1 overflow-hidden",
        className,
      )}
      role="group"
      aria-label="Theme"
    >
      <button
        type="button"
        onClick={() => setTheme("light")}
        className={cn(
          "flex size-full items-center justify-center transition-colors",
          theme === "light"
            ? "bg-brand text-brand-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={theme === "light"}
        aria-label="Light theme"
      >
        <Sun className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        className={cn(
          "flex size-full items-center justify-center transition-colors",
          theme === "dark"
            ? "bg-brand text-brand-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
        aria-pressed={theme === "dark"}
        aria-label="Dark theme"
      >
        <Moon className="size-3.5" />
      </button>
    </div>
  );
}
