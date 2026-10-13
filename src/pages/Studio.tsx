import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Check,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  SunMedium,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import BeforeAfterStage from "@/components/BeforeAfterStage";
import { Slider } from "@/components/ui/slider";

const RATIOS = [
  { id: "1:1", label: "Square", w: 1080, h: 1080 },
  { id: "4:5", label: "Portrait", w: 1080, h: 1350 },
  { id: "16:9", label: "Landscape", w: 1920, h: 1080 },
];

const BACKDROPS = [
  { id: "white", label: "White", color: "#f6f4f1" },
  { id: "gray", label: "Soft gray", color: "#e6e2dc" },
  { id: "desk", label: "Desk", color: "#5b4636" },
  { id: "moody", label: "Moody", color: "#23262a" },
  { id: "brand", label: "Brand amber", color: "#3a2a14" },
];

type Stage = "idle" | "loading" | "ready" | "error";

export default function Studio() {
  const [stage, setStage] = useState<Stage>("idle");
  const [dropActive, setDropActive] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [ratio, setRatio] = useState(RATIOS[1]);
  const [backdrop, setBackdrop] = useState(BACKDROPS[0]);
  const [shadowAngle, setShadowAngle] = useState(48);
  const [shadowLength, setShadowLength] = useState(40);
  const [shadowSoftness, setShadowSoftness] = useState(60);
  const [shadowStrength, setShadowStrength] = useState(45);

  const [productUrl, setProductUrl] = useState<string | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [view, setView] = useState<"compose" | "preview">("compose");
  const [exporting, setExporting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLImageElement | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);

  const loadImage = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setStage("loading");
      setFileName(file.name);

      const url = URL.createObjectURL(file);
      revokeRef.current?.();
      revokeRef.current = () => URL.revokeObjectURL(url);

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });
      previewRef.current = img;
      setBeforeUrl(url);

      // Show the upload as the 3D product texture.
      setProductUrl(url);
      setStage("ready");
    },
    [],
  );

  const handleFile = useCallback(
    (file: File) => {
      void loadImage(file);
    },
    [loadImage],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDropActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          handleFile(file);
          return;
        }
      }
      // safety — revoke if something went wrong
    },
    [handleFile],
  );

  useEffect(() => {
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const reset = useCallback(() => {
    revokeRef.current?.();
    revokeRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setStage("idle");
    setFileName(null);
    setBeforeUrl(null);
    setProductUrl(null);
    setRatio(RATIOS[1]);
    setBackdrop(BACKDROPS[0]);
    setShadowAngle(48);
    setShadowLength(40);
    setShadowSoftness(60);
    setShadowStrength(45);
    setView("compose");
  }, []);

  const exportBanner = useCallback(() => {
    if (stage !== "ready" || !previewRef.current) return;

    const canvas = document.createElement("canvas");
    canvas.width = ratio.w;
    canvas.height = ratio.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Backdrop.
    const bg = document.createElement("canvas");
    bg.width = ratio.w;
    bg.height = ratio.h;
    const bgCtx = bg.getContext("2d");
    if (bgCtx) {
      bgCtx.fillStyle = backdrop.color;
      bgCtx.fillRect(0, 0, ratio.w, ratio.h);
      // subtle soft gradient for depth
      const grad = bgCtx.createRadialGradient(
        ratio.w * 0.5, ratio.h * 0.25, 0,
        ratio.w * 0.5, ratio.h * 0.25, ratio.w * 0.7,
      );
      grad.addColorStop(0, "rgba(255,255,255,0.05)");
      grad.addColorStop(1, "rgba(0,0,0,0.08)");
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, ratio.w, ratio.h);
    }
    ctx.drawImage(bg, 0, 0);

    // Shadow (simplified soft ellipse under the product).
    if (shadowStrength > 0) {
      const cx = ratio.w * 0.5;
      const cy = ratio.h * 0.72;
      const rx = ratio.w * 0.28 * (shadowLength / 40);
      const ry = ratio.w * 0.05 * (1 + (100 - shadowSoftness) / 120);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
      const a = Math.min(0.5, shadowStrength / 100 * 0.5);
      grad.addColorStop(0, `rgba(0,0,0,${a})`);
      grad.addColorStop(0.6, `rgba(0,0,0,${a * 0.55})`);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, (shadowAngle - 90) * (Math.PI / 180) * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Product.
    const img = previewRef.current;
    const pw = ratio.w * 0.5;
    const ph = pw * (img.height / img.width);
    const px = (ratio.w - pw) / 2;
    const py = ratio.h * 0.32 - ph * 0.15;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(img, px, py, pw, ph);
    ctx.restore();

    const link = document.createElement("a");
    link.download = `relight-${ratio.id}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [stage, ratio, backdrop, shadowAngle, shadowLength, shadowSoftness, shadowStrength]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 items-center justify-between px-5 sm:px-6 lg:max-w-6xl lg:px-8">
          <Link
            to="/"
            className="flex items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Logo size={26} />
            <span className="hidden text-sm font-medium sm:inline">Studio</span>
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button
              onClick={reset}
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <RotateCcw className="size-4" />
              <span className="hidden sm:inline">New photo</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 lg:py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px] lg:gap-10">
          {/* left: preview */}
          <div className="flex flex-col gap-5">
            <AnimatePresence mode="wait">
              {stage === "idle" && (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/80 bg-muted/30 p-10 shadow-e1"
                >
                  <div className="flex size-14 items-center justify-center rounded-full bg-brand/10">
                    <Upload className="size-7 text-brand" />
                  </div>
                  <h2 className="mt-5 text-xl font-semibold">Drop a photo here</h2>
                  <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
                    Drag in a product photo, paste from your clipboard, or click to browse. Nothing is uploaded — everything runs on your device.
                  </p>
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="mt-6 flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-medium shadow-e1 transition-colors hover:bg-secondary"
                  >
                    <ImageIcon className="size-4" />
                    Choose a photo
                  </button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                      e.target.value = "";
                    }}
                  />
                  <p className="mt-4 text-xs text-muted-foreground">
                    JPG, PNG, WebP. No sign-up required.
                  </p>
                </motion.div>
              )}

              {stage === "loading" && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-4 rounded-2xl border border-border/70 bg-card p-12 shadow-e1"
                >
                  <LoaderCircle className="size-10 animate-spin text-brand" />
                  <h3 className="text-lg font-semibold">Opening your photo…</h3>
                  <p className="text-sm text-muted-foreground text-center">
Setting up the 3D preview.
                  </p>
                </motion.div>
              )}

              {stage === "ready" && (
                <motion.div
                  key="ready"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-4"
                >
                  <div
                    className={cn(
                      "relative overflow-hidden rounded-2xl border border-border/70 bg-[#0c0e10] shadow-e3",
                      view === "preview" && "ring-2 ring-brand/40",
                    )}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDropActive(true);
                    }}
                    onDragLeave={() => setDropActive(false)}
                    onDrop={handleDrop}
                  >
                    {dropActive && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-brand/20 backdrop-blur-sm">
                        <span className="rounded-lg bg-brand/30 px-4 py-2 text-sm font-medium text-brand-foreground">
                          Drop to replace
                        </span>
                      </div>
                    )}
                    <BeforeAfterStage
                      productImage={productUrl}
                      rotation={view === "preview" ? "none" : "orbit"}
                      size={view === "preview" ? 420 : 360}
                      showGround
                      className={view === "preview" ? "ring-2 ring-brand/40" : ""}
                    />
                    <div className="absolute left-3 top-3 z-10 flex gap-2">
                      <span className="rounded-md bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                        {ratio.label}
                      </span>
                      <span className="rounded-md bg-black/40 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
                        {backdrop.label}
                      </span>
                    </div>
                    <button
                      onClick={() => setView(view === "compose" ? "preview" : "compose")}
                      className="absolute right-3 top-3 z-10 rounded-full border border-border/70 bg-card/80 px-2.5 py-1 text-[11px] font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground"
                    >
                      {view === "preview" ? "Inspect" : "Compare"}
                    </button>
                  </div>

                  {/* before/after comparison */}
                  {beforeUrl && (
                    <div className="w-full">
                      <BeforeAfterSlider
                        before={beforeUrl}
                        after={productUrl || ""}
                        initialPercent={50}
                        labels
                        className="aspect-[4/5]"
                      />
                      <p className="mt-2 text-[11px] text-muted-foreground text-center">
                        Drag the divider to compare the original photo with the cleaned product.
                      </p>
                    </div>
                  )}

                  {/* quick actions */}
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      onClick={exportBanner}
                      disabled={exporting || !productUrl}
                      className="flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-brand-foreground shadow-e2 transition-transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {exporting ? (
                        <LoaderCircle className="size-4 animate-spin" />
                      ) : (
                        <Download className="size-4" />
                      )}
                      Export PNG
                    </button>

                    <button
                      onClick={() => setRatio((r) => {
                        const list = RATIOS;
                        const i = list.indexOf(r);
                        return list[(i + 1) % list.length];
                      })}
                      className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm text-muted-foreground transition-colors hover:border-primary"
                    >
                      <RotateCcw className="size-4" />
                      {ratio.label}
                    </button>

                    <a
                      href="/"
                      className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ArrowLeft className="size-4" />
                      Back
                    </a>
                  </div>
                </motion.div>
              )}

              {stage === "error" && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center gap-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-10 text-center"
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-destructive/15">
                    <X className="size-6 text-destructive" />
                  </div>
                  <h3 className="text-lg font-semibold">Couldn't open that photo.</h3>
                  <p className="text-sm text-muted-foreground">
                    Try a different file — JPG, PNG, or WebP.
                  </p>
                  <button
                    onClick={reset}
                    className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-medium transition-colors hover:text-foreground"
                  >
                    <RotateCcw className="size-4" />
                    Start over
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* right: controls */}
          <div className="flex flex-col gap-4 lg:pt-2">
            <div className="rounded-xl border border-border/70 bg-card p-5 shadow-e1 space-y-5">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-brand" />
                <h3 className="font-display text-sm font-semibold tracking-wide uppercase">Controls</h3>
              </div>

              <fieldset>
                <legend className="text-xs text-muted-foreground">Output size</legend>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {RATIOS.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setRatio(r)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-center text-sm font-medium transition-colors",
                        ratio.id === r.id
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs text-muted-foreground">Backdrop</legend>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {BACKDROPS.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setBackdrop(b)}
                      title={b.label}
                      className={cn(
                        "h-9 rounded-lg border shadow-e1 transition-transform hover:scale-105",
                        backdrop.id === b.id && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                      )}
                      style={{ background: b.color }}
                      aria-label={b.label}
                    />
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs text-muted-foreground">Shadow</legend>
                <div className="mt-3 space-y-4">
                  <Slider label="Light angle" min={0} max={180} value={shadowAngle} setValue={setShadowAngle} />
                  <Slider label="Cast length" min={5} max={100} value={shadowLength} setValue={setShadowLength} />
                  <Slider label="Softness" min={0} max={100} value={shadowSoftness} setValue={setShadowSoftness} />
                  <Slider label="Strength" min={0} max={100} value={shadowStrength} setValue={setShadowStrength} />
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-xs text-muted-foreground">Compare mode</legend>
                <p className="mt-1 text-xs text-muted-foreground">
                  In compare mode, the divider sits over the product so you can see the original and the cleaned version side by side. Drag to reposition the split.
                </p>
                <div className="mt-3 flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 7 3 12l5 5" />
                  <path d="M16 7l5 5-5 5" />
                </svg>
                  <span>Drag the divider in the preview above to compare.</span>
                </div>
              </fieldset>                <div className="flex items-center gap-2 rounded-lg bg-brand/10 px-3 py-2 text-xs text-brand-foreground">
                  <Check className="size-3.5 shrink-0" />
                  Open to everyone — no sign-up, no uploads. Compare side-by-side with the divider.
                </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-card p-5 shadow-e1 space-y-4">
              <h3 className="font-display text-sm font-semibold tracking-wide uppercase">Product info</h3>
              <dl className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">File</span>
                  <span className="text-right break-all text-foreground">{fileName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ratio</span>
                  <span className="text-right text-foreground">{ratio.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Backdrop</span>
                  <span className="text-right text-foreground">{backdrop.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stage</span>
                  <span className="text-right text-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn(
                        "inline-block size-1.5 rounded-full",
                        stage === "ready" ? "bg-green-600" : stage === "loading" ? "bg-brand animate-pulse" : "bg-muted-foreground/40",
                      )} />
                      {stage === "idle" ? "No photo" : stage === "loading" ? "Loading" : "Ready"}
                    </span>
                  </span>
                </div>
              </dl>

              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                <p className="flex items-start gap-2">
                  <SunMedium className="size-3.5 mt-0.5 shrink-0" />
                  Shadows are a stylized approximation for the preview and export. The real studio uses a coverage-integral shadow engine.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

