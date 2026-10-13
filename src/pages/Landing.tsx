import { motion } from "framer-motion";
import { Link } from "react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { ArrowRight, Check } from "lucide-react";
import { BeforeAfterComparison } from "@/components/BeforeAfterComparison";

const BEFORE_IMAGE = "/before-messy.jpg";
const AFTER_IMAGE = "/after-clean.jpg";


const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay, duration: 0.7, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const stagger = (i: number, delay = 0) => ({
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { delay: delay + i * 0.08, duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
  },
});

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <Proof />
      <How />
      <Modes />
      <BeforeAfter />
      <Final />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 items-center justify-between px-5 sm:px-6 lg:max-w-6xl lg:px-8">
        <Link to="/" className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          <span className="inline-flex items-center gap-2.5">
            <svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true">
              <rect width="64" height="64" rx="15" fill="#15181B" />
              <rect x="0.75" y="0.75" width="62.5" height="62.5" rx="14.25" stroke="#ffffff" strokeOpacity="0.10" strokeWidth="1.25" fill="none" />
              <path d="M17 15 L33 15 L46 47 L30 47 Z" fill="url(#nav-beam)" />
              <rect x="20" y="38" width="27" height="11" rx="3.2" fill="url(#nav-card)" />
              <rect x="14" y="52" width="36" height="2.4" rx="1.2" fill="#ffffff" fillOpacity="0.4" />
              <defs>
                <linearGradient id="nav-beam" x1="14" y1="12" x2="42" y2="48">
                  <stop offset="0" stopColor="#FFE0B0" />
                  <stop offset="0.6" stopColor="#F4B23E" />
                  <stop offset="1" stopColor="#F0A02C" stopOpacity="0.12" />
                </linearGradient>
                <linearGradient id="nav-card" x1="20" y1="38" x2="46" y2="50">
                  <stop offset="0" stopColor="#F2D9C4" />
                  <stop offset="1" stopColor="#D9B29A" />
                </linearGradient>
              </defs>
            </svg>
            <span className="font-display text-[1.05em] font-semibold tracking-[-0.03em]">Relight</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a className="transition-colors hover:text-foreground" href="#proof">Why it works</a>
          <a className="transition-colors hover:text-foreground" href="#how">How it works</a>
          <a className="transition-colors hover:text-foreground" href="#modes">Studio</a>
        </nav>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            to="/studio"
            className="flex h-9 items-center gap-2 rounded-lg bg-foreground px-5 text-sm font-medium text-background shadow-e2 transition-transform hover:-translate-y-0.5"
          >
            Open the studio
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-20 pb-24 sm:pt-24 sm:pb-28 lg:pt-28 lg:pb-32">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 right-0 h-[50vh] w-[60vw] rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute -bottom-20 left-0 h-72 w-72 rounded-full bg-brand/8 blur-3xl" />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-8">
        <div className="space-y-6">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/60 px-3.5 py-1.5 text-xs font-medium text-muted-foreground shadow-e1 backdrop-blur-sm"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand/70" />
              <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
            </span>
            Free. Private. On-device.
          </motion.div>

          <motion.h1
            variants={stagger(0)}
            initial="hidden"
            animate="visible"
            className="font-display text-5xl tracking-tight sm:text-6xl lg:text-7xl font-semibold"
          >
            Your product, out of the mess.
          </motion.h1>

          <motion.p
            variants={stagger(1)}
            initial="hidden"
            animate="visible"
            className="max-w-lg text-[17px] leading-7 text-muted-foreground sm:text-[18px]"
          >
            Drop a cluttered phone photo of a product into the studio. Relight lifts it
            onto a clean surface and paints a believable cast shadow in seconds — entirely
            in your browser, nothing uploaded.
          </motion.p>

          <motion.div
            variants={stagger(2)}
            initial="hidden"
            animate="visible"
            className="flex flex-wrap items-center gap-4 pt-2"
          >
            <Link
              to="/studio"
              className="flex h-11 items-center gap-2 rounded-lg bg-brand px-6 text-sm font-medium text-brand-foreground shadow-e2 transition-transform hover:-translate-y-0.5"
            >
              Open the studio
              <ArrowRight className="size-4" />
            </Link>
            <a
              href="#proof"
              className="flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-6 text-sm font-medium text-foreground shadow-e1 transition-colors hover:bg-secondary"
            >
              See why
            </a>
          </motion.div>

          <motion.p
            variants={stagger(3)}
            initial="hidden"
            animate="visible"
            className="text-xs text-muted-foreground"
          >
            No sign-up. No accounts. Works offline after the first load.
          </motion.p>
        </div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          transition={{ delay: 0.25 }}
          className="shrink-0"
        >
          <BeforeAfterComparison
            before={BEFORE_IMAGE}
            after={AFTER_IMAGE}
            size={220}
          />
          <p className="mt-5 text-center text-xs text-muted-foreground">
            Messy photo in, clean banner out — drag the divider to compare.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

function Proof() {
  return (
    <section id="proof" className="border-t border-border/60 bg-card/40">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-6 lg:px-8">
        <motion.p
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          className="text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
        >
          Why it works
        </motion.p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: "Nothing leaves your device",
              body: "The whole pipeline — matting, refinement, shadow, export — runs in the browser. Your photos never hit a server.",
            },
            {
              title: "Real shadows, not fake drops",
              body: "A coverage-integral shadow engine computes an umbra and penumbra from the silhouette, then filters it. Looks like light, not a blur.",
            },
            {
              title: "One photo, many looks",
              body: "Try studio white, soft gray, premium desk, moody dark, and a generative scene tuned to your product's palette — all from the same cutout.",
            },
            {
              title: "Built for listings",
              body: "Export at Instagram, marketplace, and catalog ratios. The studio is made for resellers and small brands, not just demos.",
            },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              variants={stagger(i)}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-40px" }}
              className="rounded-xl border border-border/70 bg-card p-5 shadow-e1 transition-shadow hover:shadow-e2"
            >
              <h3 className="text-[15px] font-semibold leading-snug">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function How() {
  return (
    <section id="how" className="bg-card/40">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-6 lg:px-8">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          className="mb-10 text-center"
        >
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">How it works</p>
          <h2 className="mt-3 font-display text-3xl tracking-tight font-semibold">Four steps, all in front of you.</h2>
        </motion.div>

        <ol className="grid gap-5 lg:grid-cols-4">
          {[
            { n: "01", title: "Drop a photo", body: "Upload, drag in, or paste from your clipboard. Any phone snapshot works — clutter, angles, mess included." },
            { n: "02", title: "We find the product", body: "AI matting and a custom edge-guided engine isolate the main object, refine the edges, and keep the background out." },
            { n: "03", title: "You pick the look", body: "Choose a backdrop, a ratio, and a shadow. The studio keeps the product honest and the light believable." },
            { n: "04", title: "Export the banner", body: "Download a full-resolution PNG. One photo becomes a clean product shot ready to use." },
          ].map((step, i) => (
            <li key={step.n} className="group">
              <motion.div
                variants={stagger(i)}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: "-40px" }}
                className="flex h-full flex-col gap-3 rounded-xl border border-border/70 bg-card p-5 shadow-e1 transition-shadow hover:shadow-e2"
              >
                <span className="font-display text-sm font-semibold tracking-[0.2em] text-brand">{step.n}</span>
                <h3 className="text-base font-semibold">{step.title}</h3>
                <p className="text-sm leading-6 text-muted-foreground">{step.body}</p>
              </motion.div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Modes() {
  return (
    <section id="modes" className="border-t border-border/60">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-6 lg:px-8">
        <motion.p
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          className="text-center text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
        >
          The studio
        </motion.p>

        <div className="mt-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
          <motion.div
            variants={stagger(0)}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            className="shrink-0 lg:max-w-[420px]"
          >
            <h2 className="font-display text-3xl tracking-tight font-semibold">One studio, many outputs.</h2>
            <p className="mt-3 text-[17px] leading-7 text-muted-foreground">
              The studio keeps the controls close: backdrop, ratio, shadow angle, softness,
              and a generative scene matched to your product. Move one slider, see the change.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              {[
                "Drag, paste, or upload",
              ].map((chip) => (
                <div key={chip} className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-3.5 py-1.5 text-xs text-muted-foreground shadow-e1">
                  <Check className="size-3.5 shrink-0 text-brand" />
                  {chip}
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: 0.2 }}
            className="relative"
          >
            <div className="rounded-xl border border-border/70 bg-[#0c0e10] p-2 shadow-e3">
              <BeforeAfterComparison
                before={BEFORE_IMAGE}
                after={AFTER_IMAGE}
                size={280}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Drag the divider to compare — cleaned result on the right, original mess on the left.</p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function BeforeAfter() {
  return (
    <section className="bg-card/40">
      <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <motion.p
            variants={fadeUp}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground"
          >
            Messy in, clean out
          </motion.p>
          <motion.h2
            variants={stagger(1)}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-40px" }}
            className="mt-3 font-display text-3xl tracking-tight font-semibold"
          >
            The same product, twice.
          </motion.h2>
        </div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          transition={{ delay: 0.2 }}
          className="mt-8 w-full max-w-3xl mx-auto"
        >
          <BeforeAfterComparison
            before={BEFORE_IMAGE}
            after={AFTER_IMAGE}
            size="lg"
          />
        </motion.div>          <p className="mt-5 text-sm text-muted-foreground text-center">
          Drag the handle to compare.
        </p>

      </div>
    </section>
  );
}

function Final() {
  return (
    <section className="border-t border-border/60 bg-[#0c0e10] text-white">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-5 py-16 sm:px-6 lg:px-8">
        <motion.p
          variants={fadeUp}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          className="text-xs font-medium uppercase tracking-[0.18em] text-white/50"
        >
          Start clean
        </motion.p>
        <motion.h2
          variants={stagger(1)}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          className="font-display text-4xl tracking-tight font-semibold text-center"
        >
          Your first clean product shot is one upload away.
        </motion.h2>
        <motion.div
          variants={stagger(2)}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          className="mt-2 flex flex-wrap items-center justify-center gap-4"
        >
          <Link
            to="/studio"
            className="flex h-11 items-center gap-2 rounded-lg bg-brand px-6 text-sm font-medium text-brand-foreground shadow-e2 transition-transform hover:-translate-y-0.5"
          >
            Open the studio
            <ArrowRight className="size-4" />
          </Link>
          <a
            href="#proof"
            className="flex h-11 items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-6 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
          >
            How it works
          </a>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border/60 bg-background">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-5 py-8 text-center text-xs text-muted-foreground sm:flex-row lg:px-8">
        <span>Relight — Product Photo Studio</span>
        <span className="hidden sm:inline">·</span>
        <span>Free. Private. On-device.</span>
        <span className="sm:ml-2">Made for listings, small brands, and anyone tired of cluttered product photos.</span>
      </div>
    </footer>
  );
}
