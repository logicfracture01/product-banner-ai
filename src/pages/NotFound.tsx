import { motion } from "framer-motion";
import { Link } from "react-router";
import { Logo } from "@/components/Logo";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="flex min-h-screen flex-col bg-background text-foreground"
    >
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <Logo size={40} withWordmark={false} />
        <h1 className="mt-6 font-display text-6xl font-bold tracking-tight">Page not found</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          This page doesn’t exist yet.
        </p>
        <Link
          to="/"
          className="mt-8 flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-brand-foreground shadow-e2 transition-transform hover:-translate-y-0.5"
        >
          Back to home
        </Link>
      </div>
    </motion.div>
  );
}
