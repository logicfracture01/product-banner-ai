import { Logo } from "@/components/Logo";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEMO_PLACE, getDemoBefore, renderDemoAfter } from "@/lib/pipeline/demo";
import { DEFAULT_SHADOW } from "@/lib/pipeline/shadow";
import { cn } from "@/lib/utils";
import { motion, useScroll, useSpring } from "framer-motion";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Cpu,
  Crop,
  Github,
  Layers,
  Lock,
  Scan,
  Sparkles,
  SunMedium,
  Upload,
  Wand2,
  ZoomIn,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";

/** Shared reveal motion: one language for every entrance on the page. */
const reveal = {
  initial: { opacity: 0, y: 16, filter: "blur(4px)" },
  whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
};

const stagger = (i: number) => ({
  ...reveal,
  transition: { ...reveal.transition, delay: 0.06 * i },
});

/**
 * Yield to the browser so queued paint/input work runs first. Prefers
 * `requestIdleCallback` (real idle time) and falls back to a macrotask.
 */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => resolve(), { timeout: 250 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export default function Landing() {
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [demoState, setDemoState] = useState<"working" | "ready" | "error">("working");

  useEffect(() => {
    let alive = true;
    let revoke: (() => void) | null = null;
    (async () => {
      try {
        // Keep the first paint completely free: the demo builds an 860×645
        // scene, segments it and composites a 1080×1350 banner. None of that
        // should compete with the hero painting.
        await afterPaint();
        const b = getDemoBefore();
        if (!alive) return;
        setBefore(b);
        await afterPaint();
        const render = await renderDemoAfter(DEMO_PLACE, {
          backdrop: "studio",
          shadow: DEFAULT_SHADOW,
        });
        if (!alive) {
          render.revoke();
          return;
        }
        revoke = render.revoke;
        setAfter(render.url);
        setDemoState("ready");
      } catch (err) {
        console.error("demo pipeline failed", err);
        if (alive) setDemoState("error");
      }
    })();
    return () => {
      alive = false;
      revoke?.();
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav />
      <main>
        <Hero before={before} after={after} demoState={demoState} />
        <MarketStrip />
        <HowItWorks />
        <PipelineDive />
        <Outputs />
        <Audience />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------- Nav

function Nav() {
  const bar = useSpring(useScroll().scrollYProgress, {
    stiffness: 140,
    damping: 28,
    restDelta: 0.001,
  });

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          to="/"
          className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Logo size={30} animated />
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <a className="transition-colors hover:text-foreground" href="#how">
            How it works
          </a>
          <a className="transition-colors hover:text-foreground" href="#pipeline">
            Pipeline
          </a>
          <a className="transition-colors hover:text-foreground" href="#outputs">
            Outputs
          </a>
          <a className="transition-colors hover:text-foreground" href="#faq">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2.5">
          <ThemeToggle />
          <Button size="sm" asChild className="shadow-e1">
            <Link to="/studio">
              Open studio
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
      {/* scroll progress — a thin, quiet indicator instead of a jumping bar */}
      <motion.div
        aria-hidden
        style={{ scaleX: bar }}
        className="h-px origin-left bg-gradient-to-r from-primary via-brand to-primary"
      />
    </header>
  );
}

// ---------------------------------------------------------------- Hero

function Hero({
  before,
  after,
  demoState,
}: {
  before: string | null;
  after: string | null;
  demoState: "working" | "ready" | "error";
}) {
  return (
    <section className="relative overflow-hidden">
      {/* ambient key light */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-wash absolute -top-40 left-1/2 h-[460px] w-[820px] -translate-x-1/2 rounded-full bg-primary/12 blur-3xl" />
        <div className="animate-wash absolute top-52 right-[-140px] h-80 w-80 rounded-full bg-brand/12 blur-3xl [animation-delay:-4s]" />
      </div>

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-14 px-4 pt-14 pb-20 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:pt-20 lg:pb-24">
        <div>
          <motion.div {...reveal}>
            <Badge
              variant="outline"
              className="gap-2 rounded-full border-border/80 bg-card/70 px-3 py-1 text-[11px] font-medium tracking-wide text-muted-foreground backdrop-blur"
            >
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              Live pipeline · runs entirely in your browser
            </Badge>
          </motion.div>

          <motion.h1
            {...stagger(1)}
            className="mt-6 font-display text-[2.6rem] leading-[1.03] font-bold tracking-tight sm:text-6xl lg:text-[4.1rem]"
          >
            Messy phone photo in.
            <br />
            <span className="text-gradient">Studio banner out.</span>
          </motion.h1>

          <motion.p
            {...stagger(2)}
            className="mt-6 max-w-xl text-[17px] leading-8 text-muted-foreground"
          >
            Relight lifts your product out of any cluttered snapshot, drops it on a
            studio surface, and paints a{" "}
            <span className="font-medium text-foreground">physically-plausible cast
            shadow</span>{" "}
            with our own rendering math — in about two seconds, with your photo never
            leaving the device.
          </motion.p>

          <motion.div {...stagger(3)} className="mt-9 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              asChild
              className="h-12 px-6 text-[15px] shadow-e2 transition-transform duration-200 hover:-translate-y-0.5"
            >
              <Link to="/studio">
                Clean your first photo
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="h-12 px-6 text-[15px]">
              <Link to="/studio">
                <Sparkles className="size-4 text-brand" />
                Try the live sample
              </Link>
            </Button>
          </motion.div>

          <motion.ul
            {...stagger(4)}
            className="mt-9 grid max-w-lg gap-2.5 text-sm text-muted-foreground sm:grid-cols-2"
          >
            {[
              { icon: Lock, label: "Photos never leave your device" },
              { icon: Cpu, label: "No wrapped AI API calls" },
              { icon: ZoomIn, label: "2×/3× detail-preserving upscale" },
              { icon: Clock, label: "Free during launch" },
            ].map((f) => (
              <li key={f.label} className="flex items-center gap-2.5">
                <f.icon className="size-4 shrink-0 text-primary" />
                {f.label}
              </li>
            ))}
          </motion.ul>
        </div>

        <motion.div {...stagger(2)} className="relative">
          <div
            aria-hidden
            className="absolute -inset-4 rounded-[2.25rem] bg-gradient-to-br from-primary/15 via-transparent to-brand/15 blur-md"
          />
          <div className="edge-top relative overflow-hidden rounded-2xl border border-border/70 bg-card p-3 shadow-e3">
            <div className="mb-2.5 flex items-center justify-between px-1.5 pt-1.5">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-brand/80" />
                <span className="size-2.5 rounded-full bg-border" />
                <span className="size-2.5 rounded-full bg-border" />
                <span className="ml-2 text-xs font-medium text-muted-foreground">
                  relight · studio
                </span>
              </div>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider",
                  demoState === "ready" && "bg-primary/10 text-primary",
                  demoState === "working" && "bg-muted text-muted-foreground",
                  demoState === "error" && "bg-destructive/10 text-destructive",
                )}
              >
                {demoState === "ready" && "RENDERED"}
                {demoState === "working" && "RENDERING…"}
                {demoState === "error" && "UNAVAILABLE"}
              </span>
            </div>
            <div className="relative">
              <BeforeAfterSlider before={before} after={after} className="shadow-inner" />
              {demoState === "working" && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl bg-card/75 backdrop-blur-[2px]">
                  <span className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <span className="text-sm text-muted-foreground">
                    Cutting, lighting, shadowing…
                  </span>
                </div>
              )}
              {demoState === "error" && (
                <div className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-muted/70 px-6 text-center text-sm text-muted-foreground">
                  Demo preview unavailable on this device — the studio still works.
                </div>
              )}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 px-1.5 pb-1">
              <p className="text-xs text-muted-foreground">
                Drag the handle — that “after” was rendered by the real pipeline.
              </p>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                <Scan className="size-3" />
                4:5 · 1080×1350
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Market strip

/** Quiet marquee of the marketplaces and formats the exports target. */
function MarketStrip() {
  const items = [
    "Vinted · 4:5 feed",
    "Depop · 4:5 feed",
    "eBay · 1:1",
    "Etsy · 1:1",
    "Shop banner · 16:9",
    "Instagram · 4:5",
    "Amazon · 1:1",
    "Etsy shop · 16:9",
  ];
  // Two identical tracks each translating -100% of their own width: the seam
  // lands exactly on the copy boundary, so the loop has no visible jump.
  const track = (key: string) => (
    <div className="animate-marquee flex shrink-0 items-center" aria-hidden={key === "b"}>
      {items.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-2.5 px-5 whitespace-nowrap text-[13px] font-medium text-muted-foreground"
        >
          <Check className="size-3.5 text-primary" />
          {t}
        </span>
      ))}
    </div>
  );
  return (
    <section className="border-y border-border/60 bg-card/40">
      <div className="relative flex overflow-hidden py-4">
        <div className="flex min-w-0 shrink-0">{track("a")}{track("b")}</div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-background to-transparent"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- How it works

function HowItWorks() {
  const steps = [
    {
      icon: Upload,
      title: "Drop a messy photo",
      body: "A laptop on a sunlit deck, a sneaker on the floor — if a human can find the product, Relight can too.",
    },
    {
      icon: Crop,
      title: "We cut it out",
      body: "An AI matte finds the silhouette, then edge-guided segmentation feathers it so it sits on the new surface without halos.",
    },
    {
      icon: Layers,
      title: "Pick a surface",
      body: "Five studio backdrops plus a generative mode that composes a unique scene from your product's own palette.",
    },
    {
      icon: SunMedium,
      title: "We paint the light",
      body: "A custom shadow engine places a contact ring and a directional cast that grounds the product like real light.",
    },
  ];
  return (
    <Section id="how" eyebrow="How it works" title="Four steps. Two seconds.">
      <div className="relative mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* connector rail — desktop only, sits behind the cards */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-[3.25rem] hidden h-px bg-gradient-to-r from-transparent via-border to-transparent lg:block"
        />
        {steps.map((s, i) => (
          <motion.div key={s.title} {...stagger(i)} className="relative">
            <Card className="h-full">
              <div className="flex items-center gap-3">
                <div className="relative flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </div>
                <span className="font-display text-sm font-semibold text-muted-foreground/45">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-5 font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{s.body}</p>
            </Card>
          </motion.div>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Pipeline

function PipelineDive() {
  const items = [
    {
      tag: "matte",
      icon: Crop,
      title: "Two-tier cutout",
      body: "BiRefNet-lite (MIT) runs in a Web Worker for the mask, with a Sobel edge map and adaptive flood fill as the fallback and the fine-tuner. Nothing is sent anywhere.",
    },
    {
      tag: "upscaler",
      icon: ZoomIn,
      title: "Detail-preserving upscale",
      body: "Catmull-Rom bicubic resampling with halo-suppressed unsharp and BT.601 chroma cleanup — soft phone crops regain crisp edges before they are ever cut out.",
    },
    {
      tag: "shadow",
      icon: SunMedium,
      title: "Physically-motivated shadows",
      body: "Contact shadows come from silhouette ambient occlusion; cast shadows are the silhouette heaved along the light vector with height jitter and progressive blur.",
    },
    {
      tag: "compositor",
      icon: Layers,
      title: "Studio compositing",
      body: "Gradient backdrops with top-light falloff, grounding bands, generative scenes seeded from your product's palette, and ratio-aware framing for every marketplace.",
    },
  ];
  return (
    <section id="pipeline" className="border-y border-border/60 bg-card/40">
      <div className="mx-auto grid w-full max-w-6xl items-start gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:py-28">
        <motion.div {...reveal} className="lg:sticky lg:top-28">
          <Eyebrow>Under the hood</Eyebrow>
          <h2 className="mt-4 font-display text-3xl leading-[1.1] font-bold tracking-tight sm:text-[2.6rem]">
            Not a wrapped API.
            <br />
            Engine math, on-device.
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-muted-foreground">
            Most tools in this space call a cloud model and hope for the best. Relight's
            matting, shadow rendering, upscaling and compositing are written from
            scratch in TypeScript and run entirely in your browser.
          </p>
          <div className="mt-7 flex items-center gap-2.5 rounded-xl border border-border/70 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
            <Clock className="size-4 shrink-0 text-primary" />
            Full cutout + shadow render: ~2s on a laptop.
          </div>
        </motion.div>

        <div className="flex flex-col gap-3">
          {items.map((it, i) => (
            <motion.div key={it.title} {...stagger(i)}>
              <Card>
                <div className="flex gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <it.icon className="size-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2.5">
                      <h3 className="font-display text-[17px] font-semibold">{it.title}</h3>
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground">
                        {it.tag}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{it.body}</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Outputs

function Outputs() {
  const ratios = [
    { label: "4:5", px: "1080 × 1350", use: "Vinted · Depop · Instagram feeds" },
    { label: "1:1", px: "1200 × 1200", use: "eBay · Etsy · Amazon listings" },
    { label: "16:9", px: "1280 × 720", use: "Shop banners · storefront headers" },
  ];
  return (
    <Section
      id="outputs"
      eyebrow="Output"
      title="Sized for where it sells"
      lede="Every export is a full-resolution PNG rendered at listing dimensions — no upscaling guesswork, no cropped product."
    >
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {ratios.map((r, i) => (
          <motion.div key={r.label} {...stagger(i)}>
            <Card className="h-full">
              <div className="flex items-baseline justify-between">
                <span className="font-display text-4xl font-bold tracking-tight">
                  {r.label}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{r.px}</span>
              </div>
              <div
                aria-hidden
                className="mt-5 rounded-lg border border-border/70 bg-muted/40"
                style={{
                  aspectRatio: r.label === "16:9" ? "16 / 9" : r.label === "1:1" ? "1 / 1" : "4 / 5",
                  maxHeight: 132,
                }}
              />
              <p className="mt-4 text-sm text-muted-foreground">{r.use}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      <motion.div {...reveal} className="mt-4">
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-brand/12 text-brand">
              <Wand2 className="size-5" />
            </div>
            <div>
              <h3 className="font-display text-[17px] font-semibold">
                Five output styles, one click
              </h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Pure white, white + shadow, premium desk, studio grey, moody — download
                them all and pick later.
              </p>
            </div>
          </div>
          <Button variant="outline" asChild>
            <Link to="/studio">
              Open the studio
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </Card>
      </motion.div>
    </Section>
  );
}

// ---------------------------------------------------------------- Audience

function Audience() {
  return (
    <section id="sellers" className="border-t border-border/60 bg-card/40">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-14 px-4 py-24 sm:px-6 lg:grid-cols-2 lg:py-28">
        <motion.div {...reveal} className="order-1 lg:order-2">
          <Eyebrow>Built for resellers</Eyebrow>
          <h2 className="mt-4 font-display text-3xl leading-[1.1] font-bold tracking-tight sm:text-[2.6rem]">
            Your thrift find deserves a studio
          </h2>
          <p className="mt-5 text-[15px] leading-7 text-muted-foreground">
            Reseller listings live or die on the first photo. Enterprise tools pitch
            studios and seats — Relight is built for the seller shooting on a kitchen
            table at 11pm.
          </p>
          <ul className="mt-7 space-y-3.5">
            {[
              "Shadow depth is what reads as “real” — our contact + cast shadow is the whole trick",
              "Every export is sized for the platform: 4:5 for feeds, 1:1 for squares, 16:9 for shops",
              "Nothing to install, nothing to learn — if you can upload a photo, you're done",
            ].map((line) => (
              <li key={line} className="flex gap-3 text-sm leading-6">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Check className="size-3 text-primary" strokeWidth={3} />
                </span>
                <span className="text-foreground/90">{line}</span>
              </li>
            ))}
          </ul>
          <Link
            to="/studio"
            className="mt-8 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            See it on your own photo
            <ChevronRight className="size-4" />
          </Link>
        </motion.div>

        <motion.div {...stagger(1)} className="order-2 lg:order-1">
          <div className="edge-top relative overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-e3">
            <div className="rounded-xl bg-gradient-to-b from-[#f7f1e6] to-[#e6d7c3] p-6">
              <div className="relative flex aspect-[4/5] items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-white/75 shadow-e1">
                    <Sparkles className="size-7 text-brand" />
                  </div>
                  <p className="mt-5 max-w-xs text-sm leading-6 text-[#6b5a44]">
                    One laptop. One surface. One believable shadow.
                    <br />
                    That's the whole listing photo.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between px-1">
              <div className="flex items-center gap-2">
                {["#f7f1e6", "#e8f2ee", "#f7edeb", "#eaf0f6", "#33373b"].map((c) => (
                  <span
                    key={c}
                    className="size-3.5 rounded-full ring-1 ring-black/10"
                    style={{ background: c }}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">5 styles · 3 ratios</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- FAQ

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  const items = [
    {
      q: "Does my photo get uploaded anywhere?",
      a: "No. Decoding, matting, upscaling, shadow rendering and export all happen in your browser. There is no upload endpoint in the app.",
    },
    {
      q: "What happens on the first visit?",
      a: "The AI matting model (~60 MB, MIT-licensed BiRefNet-lite) downloads once and is cached by the browser. If it fails or is slow, the built-in segmentation engine takes over automatically and everything still works.",
    },
    {
      q: "Why did my product get clipped?",
      a: "If the product touches the frame edge, the matte has no background to key against. The studio flags this, and the cutout sensitivity slider lets you push the tolerance up.",
    },
    {
      q: "What do I get out of it?",
      a: "Full-resolution PNGs at 4:5, 1:1 or 16:9 — one per output style, or all five at once from the export button.",
    },
  ];
  return (
    <Section id="faq" eyebrow="FAQ" title="The practical details">
      <div className="mt-10 divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/70 bg-card">
        {items.map((it, i) => {
          const isOpen = open === i;
          return (
            <div key={it.q}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-muted/40"
              >
                <span className="font-display text-[15px] font-semibold">{it.q}</span>
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-300",
                    isOpen && "rotate-90 text-primary",
                  )}
                />
              </button>
              <motion.div
                initial={false}
                animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <p className="px-6 pb-5 text-sm leading-6 text-muted-foreground">{it.a}</p>
              </motion.div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- Final CTA

function FinalCta() {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <motion.div {...reveal}>
        <div className="grain relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-ink px-6 py-16 text-center text-white sm:px-12 lg:py-20">
          <div
            aria-hidden
            className="animate-wash absolute -top-28 left-1/2 h-72 w-[620px] -translate-x-1/2 rounded-full bg-brand/25 blur-3xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-32 right-[-80px] h-72 w-72 rounded-full bg-primary/20 blur-3xl"
          />
          <h2 className="relative font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Your next listing is one upload away
          </h2>
          <p className="relative mx-auto mt-4 max-w-md text-[15px] leading-7 text-white/70">
            Free during launch. No card, no install, no upload — just a messier photo
            than the one you'll walk away with.
          </p>
          <div className="relative mt-9 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              asChild
              className="h-12 bg-white px-6 text-[15px] text-ink hover:bg-white/90"
            >
              <Link to="/studio">
                Start free
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="outline"
              asChild
              className="h-12 border-white/25 bg-transparent px-6 text-[15px] text-white hover:bg-white/10 hover:text-white"
            >
              <Link to="/studio">See the sample</Link>
            </Button>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------- Footer

function Footer() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:px-6">
        <div className="flex items-center gap-3">
          <Logo size={22} />
          <span className="text-xs">© {new Date().getFullYear()} Relight — hackathon build</span>
        </div>
        <div className="flex items-center gap-5">
          <a className="transition-colors hover:text-foreground" href="#how">
            How it works
          </a>
          <a className="transition-colors hover:text-foreground" href="#pipeline">
            Pipeline
          </a>
          <span className="inline-flex items-center gap-1.5">
            <Github className="size-3.5" />
            v1.0
          </span>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------- primitives

/** Shared section shell: consistent vertical rhythm, width and heading block. */
function Section({
  id,
  eyebrow,
  title,
  lede,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 lg:py-28">
      <motion.div {...reveal} className="max-w-2xl">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-4 font-display text-3xl leading-[1.1] font-bold tracking-tight sm:text-[2.6rem]">
          {title}
        </h2>
        {lede && <p className="mt-5 text-[15px] leading-7 text-muted-foreground">{lede}</p>}
      </motion.div>
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
      <span className="h-px w-5 bg-primary/50" />
      {children}
    </span>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "card-lift edge-top rounded-2xl border border-border/70 bg-card p-6 shadow-e1",
        className,
      )}
    >
      {children}
    </div>
  );
}