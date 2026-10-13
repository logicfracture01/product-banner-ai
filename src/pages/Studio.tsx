// ============================================================================
// Relight Studio — the on-device product-photo studio.
//
// Rebuilt from the ground up on the same stack and design system as the rest
// of the app (React 19, TypeScript, shadcn/ui, Tailwind v4, Framer Motion) and
// wired to the REAL pipeline in `src/lib/pipeline` — no mock renders, no fake
// progress. One photo in → a studio banner with a physically-motivated shadow
// out, computed entirely in the browser.
//
// Pipeline, in order:
//   decode → downscale → (optional) detail boost → AI matting (BiRefNet)
//   → custom edge-guided segmentation (refinement + fallback)
//   → style analysis + recommendation → backdrop / generative design
//   → coverage-integral shadow engine → composited banner
// ============================================================================

import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  autoPlacement,
  BACKDROPS,
  drawBackdrop,
  drawProduct,
  exportBanner,
  getRatio,
  RATIOS,
  type BackdropId,
  type Placement,
  type RatioId,
} from "@/lib/pipeline/render/banner";
import { DEMO_FALLBACK_BOX, boxCutout, isDegenerateCutout } from "@/lib/pipeline/samples/demo";
import { loadSample as loadSamplePhoto, type SamplePhoto } from "@/lib/pipeline/samples/samplePhotos";
import {
  generateDesign,
  paintDesign,
  randomSeed,
  type GeneratedDesign,
} from "@/lib/pipeline/render/design";
import { upscaleImage } from "@/lib/pipeline/core/upscale";
import { matteToCutout } from "@/lib/pipeline/segmentation/aiMatting";
import {
  boxIoU,
  detectObjects,
  detectionToBox,
  primaryDetection,
  type DetectResult,
} from "@/lib/pipeline/analysis/objectDetection";
import {
  aiMatteAsync,
  preloadMatting,
  setMattingProgressListener,
} from "@/lib/pipeline/segmentation/aiMattingClient";
import {
  paintShadow,
  renderShadowIntensity,
  toneMapShadow,
  DEFAULT_SHADOW,
  type ShadowOptions,
} from "@/lib/pipeline/render/shadow";
import { segmentAsync } from "@/lib/pipeline/segmentation/segmentClient";
import type { Cutout } from "@/lib/pipeline/segmentation/segment";
import {
  analyzeCutout,
  getStyle,
  OUTPUT_STYLES,
  recommendStyles,
  type OutputStyleId,
  type StyleAnalysis,
} from "@/lib/pipeline/analysis/styles";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  Columns2,
  Cpu,
  Download,
  Image as ImageIcon,
  ImageUp,
  Layers,
  MoveHorizontal,
  RotateCcw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

// ---------------------------------------------------------------- constants

type Stage = "empty" | "processing" | "ready" | "error";
type AiState = "unloaded" | "loading" | "ready" | "failed";
type ViewMode = "compare" | "after" | "before";

/** Longest side of the working bitmap. Bounds every later stage's memory. */
const MAX_SIDE = 1400;

/** Shadow presets — one tap to a believable light setup. */
const SHADOW_PRESETS: Array<{ id: string; label: string; opts: Partial<ShadowOptions> }> = [
  { id: "studio", label: "Studio soft", opts: { direction: 55, length: 0.65, softness: 0.65, opacity: 0.4, contact: true } },
  { id: "sun", label: "Hard sun", opts: { direction: 30, length: 1.05, softness: 0.28, opacity: 0.5, contact: true } },
  { id: "moody", label: "Moody", opts: { direction: 115, length: 0.85, softness: 0.5, opacity: 0.55, contact: true } },
  { id: "flat", label: "Flat lay", opts: { direction: 90, length: 0.35, softness: 0.75, opacity: 0.3, contact: true } },
];

/** Small palette swatch shown on an output-style button. */
const STYLE_SWATCH: Record<OutputStyleId, string> = {
  "pure-white": "#ffffff",
  "white-shadow": "linear-gradient(180deg,#fff 55%,#ececec)",
  "premium-desk": "linear-gradient(180deg,#6b4a34,#452e20)",
  studio: "linear-gradient(180deg,#f7f6f3,#e9e6df)",
  moody: "linear-gradient(180deg,#33373b,#1e2124)",
};

// ---------------------------------------------------------------- component

export default function Studio() {
  // ---- stage / source ----
  const [stage, setStage] = useState<Stage>("empty");
  const [fileName, setFileName] = useState<string | null>(null);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(null);
  const [afterUrl, setAfterUrl] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [samplePhoto, setSamplePhoto] = useState<SamplePhoto | null>(null);

  // ---- look ----
  const [backdrop, setBackdrop] = useState<BackdropId>("studio");
  const [ratio, setRatio] = useState<RatioId>("4:5");
  const [shadow, setShadow] = useState<ShadowOptions>(DEFAULT_SHADOW);
  const [style, setStyle] = useState<OutputStyleId>("white-shadow");
  const [shadowsOn, setShadowsOn] = useState(true);
  const [design, setDesign] = useState<GeneratedDesign | null>(null);
  const [designSeed, setDesignSeed] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>("compare");

  // ---- placement ----
  const [size, setSize] = useState(100);
  const [height, setHeight] = useState(72);
  const [offsetX, setOffsetX] = useState(0);

  // ---- cutout tuning ----
  const [tolerance, setTolerance] = useState(26);
  const [upscaleFactor, setUpscaleFactor] = useState<1 | 2 | 3>(1);

  // ---- analysis / warnings ----
  const [analysis, setAnalysis] = useState<StyleAnalysis | null>(null);
  const [recommended, setRecommended] = useState<OutputStyleId[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [candidateCount, setCandidateCount] = useState(1);
  const [edgeWarning, setEdgeWarning] = useState(false);
  const [fitWarning, setFitWarning] = useState(false);
  const [detection, setDetection] = useState<{ label: string; confidence: number } | null>(null);

  // ---- AI engine status ----
  const [aiState, setAiState] = useState<AiState>("unloaded");
  const [aiProgress, setAiProgress] = useState<number | null>(null);

  // ---- export ----
  const [exportingAll, setExportingAll] = useState(false);

  // ---- refs (mutable pipeline data, never read during render) ----
  const cutoutRef = useRef<Cutout | null>(null);
  const sourceRef = useRef<{ data: ImageData; width: number; height: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startOffset: number } | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const encodeSeqRef = useRef(0);
  const isDemoRef = useRef(false);
  const sampleWRef = useRef(0);
  const sampleHRef = useRef(0);
  const preloadRef = useRef(false);
  const cutoutTickRef = useRef(0);
  const [cutoutTick, setCutoutTick] = useState(0);
  const shadowCacheRef = useRef<{ key: string; intensity: Float32Array } | null>(null);
  const baseCacheRef = useRef<{ key: string; base: Placement } | null>(null);

  /**
   * Mutable pipeline settings mirrored into a ref. `loadFile` / `loadSample`
   * back stable handlers, so without this they'd capture the first render's
   * upscale/tolerance forever.
   */
  const settingsRef = useRef({ upscaleFactor, tolerance });
  useEffect(() => {
    settingsRef.current = { upscaleFactor, tolerance };
  }, [upscaleFactor, tolerance]);

  // ---------------------------------------------------------------- AI warm-up

  /** One-time background model download (also used by the retry chip). */
  const ensureWarm = useCallback(() => {
    if (preloadRef.current) return;
    preloadRef.current = true;
    setAiState((s) => (s === "unloaded" ? "loading" : s));
    void preloadMatting().then((ok) => {
      setAiState(ok ? "ready" : "failed");
      if (!ok) preloadRef.current = false; // allow a manual retry
    });
  }, []);

  useEffect(() => {
    setMattingProgressListener((pct) => setAiProgress(pct));
    return () => setMattingProgressListener(null);
  }, []);

  // Warm on first real intent (click/keypress), never on mount: the model is
  // ~60 MB and most visitors don't process a photo.
  useEffect(() => {
    const onIntent = () => ensureWarm();
    window.addEventListener("pointerdown", onIntent, { once: true, passive: true });
    window.addEventListener("keydown", onIntent, { once: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", onIntent);
      window.removeEventListener("keydown", onIntent);
    };
  }, [ensureWarm]);

  // Release the preview blob URL when leaving the studio.
  useEffect(
    () => () => {
      encodeSeqRef.current++;
      if (previewUrlRef.current?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
    },
    [],
  );

  /** Apply one of the five output styles (drives backdrop + shadow defaults). */
  const applyStyle = useCallback((id: OutputStyleId) => {
    const def = getStyle(id);
    setStyle(id);
    setBackdrop(def.backdrop);
    setShadowsOn(def.shadows);
    if (def.shadows) setShadow({ ...def.shadow });
  }, []);

  // ---------------------------------------------------------------- segmentation

  /**
   * AI matting (BiRefNet, MIT) first; the custom edge-guided engine refines
   * and, when the model is unavailable, replaces it. A Stage-1 detector gives
   * an independent opinion that only costs anything when the two disagree.
   */
  const runSegment = useCallback(
    async (
      rgba: Uint8ClampedArray,
      w: number,
      h: number,
      tol: number,
      bitmap?: ImageBitmap,
      customOnly?: boolean,
      detectionPromise?: Promise<DetectResult[]>,
    ) => {
      setAiState(customOnly ? "failed" : "loading");
      try {
        let cutout: Cutout | null = null;
        let fromAi = false;

        if (bitmap && !customOnly) {
          try {
            const matte = await aiMatteAsync(bitmap);
            if (matte) {
              cutout = matteToCutout(new ImageData(new Uint8ClampedArray(rgba), w, h), matte);
              setAiState("ready");
              setAiProgress(100);
              fromAi = true;
            } else {
              setAiState("failed");
              setAiProgress(null);
            }
          } catch {
            setAiState("failed");
            setAiProgress(null);
          }
        } else {
          setAiState("failed");
        }

        if (!cutout) {
          cutout = await segmentAsync({ rgba, width: w, height: h, tolerance: tol });
        }

        // Stage-1 cross-check: only runs when the matte's framing disagrees
        // with the detector, so the common path pays nothing extra.
        let primary: DetectResult | null = null;
        try {
          const detections = detectionPromise ? await detectionPromise : [];
          primary = primaryDetection(detections);
          setDetection(
            primary && primary.label
              ? { label: primary.label, confidence: primary.confidence }
              : null,
          );
        } catch {
          setDetection(null);
        }
        const target = primary ? detectionToBox(primary) : null;
        if (fromAi && cutout && target) {
          const agreed = boxIoU(cutout.box, target);
          if (agreed < 0.15) {
            try {
              const alt = await segmentAsync({ rgba, width: w, height: h, tolerance: tol });
              if (boxIoU(alt.box, target) > agreed) cutout = alt;
            } catch {
              /* keep the AI cutout */
            }
          }
        }

        // Safety net for the deterministic sample: its subject box is known
        // exactly, so fall back to it instead of dropping the user on an error.
        if (
          isDemoRef.current &&
          isDegenerateCutout(cutout.box, w, h) &&
          w === sampleWRef.current &&
          h === sampleHRef.current
        ) {
          cutout = boxCutout(rgba, w, h, DEMO_FALLBACK_BOX);
        }

        const { box } = cutout;
        cutoutRef.current = cutout;
        cutoutTickRef.current += 1;
        setCandidateCount(Math.max(1, cutout.candidates.length));
        setConfidence(cutout.confidence);
        setEdgeWarning(cutout.touchedEdges.size > 0);
        const coversAll = box.w > w * 0.97 && box.h > h * 0.97;
        setFitWarning(coversAll);

        try {
          const a = analyzeCutout(cutout);
          setAnalysis(a);
          const rec = recommendStyles(a);
          setRecommended(rec);
          if (rec[0]) applyStyle(rec[0]);
        } catch {
          setAnalysis(null);
          setRecommended([]);
        }

        setSize(100);
        setHeight(72);
        setOffsetX(0);
        setDesign(null);
        setDesignSeed(null);
        setCutoutTick(cutoutTickRef.current);
        setStage(coversAll ? "error" : "ready");
      } catch (err) {
        console.error("[studio] segmentation failed", err);
        setStage("error");
      }
    },
    // applyStyle is stable; every other dependency is a state setter.
    [applyStyle],
  );

  // ---------------------------------------------------------------- ingest

  /** bitmap → normalized pixels → (optional upscale) → detection + matting. */
  const ingestBitmap = useCallback(
    async (bitmap: ImageBitmap) => {
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      let w = Math.max(1, Math.round(bitmap.width * scale));
      let h = Math.max(1, Math.round(bitmap.height * scale));
      const cv = document.createElement("canvas");
      cv.width = w;
      cv.height = h;
      const ctx = cv.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0, w, h);
      let data = ctx.getImageData(0, 0, w, h);

      const { upscaleFactor: upscale, tolerance: tol } = settingsRef.current;

      if (upscale > 1) {
        try {
          const up = upscaleImage(data.data, w, h, {
            factor: upscale === 3 ? 3 : 2,
            sharpening: 0.55,
            crispness: 0.75,
          });
          w = up.width;
          h = up.height;
          const ucv = document.createElement("canvas");
          ucv.width = w;
          ucv.height = h;
          const uctx = ucv.getContext("2d", { willReadFrequently: true })!;
          const id = uctx.createImageData(w, h);
          id.data.set(up.rgba);
          uctx.putImageData(id, 0, 0);
          data = uctx.getImageData(0, 0, w, h);
        } catch (err) {
          console.warn("[studio] upscale failed, continuing at native size", err);
        }
      }

      sourceRef.current = { data, width: w, height: h };
      setBeforeUrl(cv.toDataURL("image/jpeg", 0.85));

      // Let the "processing" UI paint before the heavy work begins.
      await new Promise((r) => setTimeout(r, 30));

      // Detection + matting must share one coordinate space, so both read the
      // final (possibly upscaled) canvas.
      let modelBmp: ImageBitmap = bitmap;
      let detectSource: HTMLCanvasElement = cv;
      if (bitmap.width !== w || bitmap.height !== h) {
        const bcv = document.createElement("canvas");
        bcv.width = w;
        bcv.height = h;
        bcv.getContext("2d")!.putImageData(data, 0, 0);
        modelBmp = await createImageBitmap(bcv);
        detectSource = bcv;
      }

      const detectionPromise = detectObjects(detectSource).catch((): DetectResult[] => []);
      await runSegment(data.data, w, h, tol, modelBmp, false, detectionPromise);
    },
    [runSegment],
  );

  /** Entry point for user uploads: validate → process → surface errors. */
  const loadFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      isDemoRef.current = false;
      setStage("processing");
      setFileName(file.name);
      try {
        const bitmap = await createImageBitmap(file);
        await ingestBitmap(bitmap);
      } catch (err) {
        console.error(err);
        setStage("error");
      }
    },
    [ingestBitmap],
  );

  /** Real sample photo first, deterministic procedural scene as offline fallback. */
  const loadSample = useCallback(
    async (preferredId?: string) => {
      setStage("processing");
      try {
        const sample = await loadSamplePhoto(preferredId);
        setFileName(sample.name);
        setSamplePhoto(sample.photo);
        if (sample.procedural) {
          // The fallback box lives in procedural-scene pixels and is only valid
          // while those pixels haven't been rescaled.
          sampleWRef.current = sample.bitmap.width;
          sampleHRef.current = sample.bitmap.height;
          isDemoRef.current = true;
        } else {
          isDemoRef.current = false;
          sampleWRef.current = 0;
          sampleHRef.current = 0;
        }
        await ingestBitmap(sample.bitmap);
      } catch (err) {
        console.error(err);
        setStage("error");
      }
    },
    [ingestBitmap],
  );

  // ---- paste an image from the clipboard ---------------------------------
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith("image/")) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        e.preventDefault();
        const ext = blob.type.split("/")[1] || "png";
        void loadFile(new File([blob], `pasted.${ext}`, { type: blob.type }));
        return;
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [loadFile]);

  // ---------------------------------------------------------------- placement

  /** Auto placement for the current cutout + ratio (memoized per cutout+ratio). */
  const basePlacement = useCallback(
    (cutout: Cutout, ratioId: RatioId) => {
      const key = `${cutoutTickRef.current}|${ratioId}`;
      const hit = baseCacheRef.current;
      if (hit && hit.key === key) return hit.base;
      const r = getRatio(ratioId);
      const base = autoPlacement(cutout, r.w, r.h);
      baseCacheRef.current = { key, base };
      return base;
    },
    [],
  );

  /** Base placement + the user's size / baseline / nudge adjustments. */
  const placeFor = useCallback(
    (cutout: Cutout, ratioId: RatioId): Placement => {
      const base = basePlacement(cutout, ratioId);
      return {
        x: base.x + offsetX * base.scale * cutout.box.w * 0.5,
        y: (height / 100) * getRatio(ratioId).h,
        scale: base.scale * (size / 100),
      };
    },
    [basePlacement, offsetX, height, size],
  );

  // ---------------------------------------------------------------- preview render

  useEffect(() => {
    if (stage !== "ready" || !cutoutRef.current) return;
    let raf = 0;
    let cancelled = false;
    const t = setTimeout(() => {
      raf = requestAnimationFrame(() => {
        if (cancelled) return;
        const cutout = cutoutRef.current;
        if (!cutout) return;
        const r = getRatio(ratio);
        const out = canvasRef.current ?? document.createElement("canvas");
        canvasRef.current = out;
        out.width = r.w;
        out.height = r.h;
        const ctx = out.getContext("2d")!;
        const place = placeFor(cutout, ratio);

        ctx.clearRect(0, 0, r.w, r.h);
        if (design) paintDesign(ctx, r.w, r.h, design);
        else drawBackdrop(ctx, r.w, r.h, backdrop);

        if (shadowsOn) {
          const geoKey = [
            cutoutTickRef.current,
            ratio,
            size,
            height,
            offsetX,
            shadow.direction,
            shadow.length,
            shadow.softness,
            design?.seed ?? "fixed",
          ].join("|");
          let intensity = shadowCacheRef.current?.intensity;
          if (!shadowCacheRef.current || shadowCacheRef.current.key !== geoKey) {
            intensity = renderShadowIntensity(cutout, place, r.w, r.h, shadow);
            shadowCacheRef.current = { key: geoKey, intensity };
          }
          paintShadow(ctx, toneMapShadow(intensity!, r.w, r.h, shadow), r.w, r.h);
        } else {
          shadowCacheRef.current = null;
        }

        drawProduct(ctx, cutout, place);
        emitPreview(out, r.w, setAfterUrl, previewUrlRef, encodeSeqRef, previewCanvasRef);
      });
    }, 40);
    return () => {
      cancelled = true;
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [stage, cutoutTick, backdrop, ratio, shadow, shadowsOn, size, height, offsetX, design, placeFor]);

  // ---------------------------------------------------------------- actions

  const reset = () => {
    isDemoRef.current = false;
    cutoutRef.current = null;
    sourceRef.current = null;
    canvasRef.current = null;
    shadowCacheRef.current = null;
    baseCacheRef.current = null;
    previewCanvasRef.current = null;
    encodeSeqRef.current++;
    if (previewUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setStage("empty");
    setBeforeUrl(null);
    setAfterUrl(null);
    setFileName(null);
    setSamplePhoto(null);
    setEdgeWarning(false);
    setFitWarning(false);
    setTolerance(26);
    setUpscaleFactor(1);
    setShadow(DEFAULT_SHADOW);
    setSize(100);
    setHeight(72);
    setOffsetX(0);
    setDesign(null);
    setDesignSeed(null);
    setAnalysis(null);
    setRecommended([]);
    setConfidence(null);
    setDetection(null);
    setStyle("white-shadow");
    setShadowsOn(true);
    setBackdrop("studio");
    setView("compare");
  };

  /** Re-run the cutout at the current tolerance (custom engine only). */
  const retrySegmentation = () => {
    const src = sourceRef.current;
    if (!src) return;
    setStage("processing");
    setTimeout(
      () =>
        void runSegment(src.data.data, src.width, src.height, tolerance, undefined, true),
      30,
    );
  };

  const activePreset = SHADOW_PRESETS.find(
    (p) =>
      p.opts.direction === shadow.direction &&
      p.opts.length === shadow.length &&
      p.opts.softness === shadow.softness &&
      p.opts.opacity === shadow.opacity,
  );

  /** Render the current look at full export resolution onto a fresh canvas. */
  const renderFullQuality = (): HTMLCanvasElement | null => {
    const cutout = cutoutRef.current;
    if (!cutout) return null;
    const r = getRatio(ratio);
    const cv = document.createElement("canvas");
    cv.width = r.w;
    cv.height = r.h;
    const ctx = cv.getContext("2d")!;
    const place = placeFor(cutout, ratio);
    ctx.clearRect(0, 0, r.w, r.h);
    if (design) paintDesign(ctx, r.w, r.h, design);
    else drawBackdrop(ctx, r.w, r.h, backdrop);
    if (shadowsOn) {
      const intensity = renderShadowIntensity(cutout, place, r.w, r.h, shadow);
      paintShadow(ctx, toneMapShadow(intensity, r.w, r.h, shadow), r.w, r.h);
    }
    drawProduct(ctx, cutout, place);
    return cv;
  };

  /** Render one output style at full resolution and download it. */
  const exportStyle = (id: OutputStyleId) => {
    const cutout = cutoutRef.current;
    if (!cutout) return;
    const def = getStyle(id);
    const r = getRatio(ratio);
    const cv = document.createElement("canvas");
    cv.width = r.w;
    cv.height = r.h;
    const ctx = cv.getContext("2d")!;
    const place = placeFor(cutout, ratio);
    ctx.clearRect(0, 0, r.w, r.h);
    if (design && id === style) paintDesign(ctx, r.w, r.h, design);
    else drawBackdrop(ctx, r.w, r.h, def.backdrop);
    if (def.shadows) {
      const intensity = renderShadowIntensity(cutout, place, r.w, r.h, def.shadow);
      paintShadow(ctx, toneMapShadow(intensity, r.w, r.h, def.shadow), r.w, r.h);
    }
    drawProduct(ctx, cutout, place);
    exportBanner(cv, `relight-${id}`);
  };

  /** Batch export — every style, staggered so the browser doesn't drop them. */
  const exportAllStyles = async () => {
    if (exportingAll) return;
    setExportingAll(true);
    try {
      for (const s of OUTPUT_STYLES) {
        exportStyle(s.id);
        await new Promise((r) => setTimeout(r, 350));
      }
    } finally {
      setExportingAll(false);
    }
  };

  const exportCurrentLook = () => {
    const canvas = renderFullQuality();
    if (!canvas) return;
    exportBanner(canvas, `relight-current-${style}`);
  };

  const cycleRatio = () => {
    setRatio((r) => {
      const list = RATIOS.map((x) => x.id);
      return list[(list.indexOf(r) + 1) % list.length];
    });
  };

  // ---------------------------------------------------------------- render

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#studio-controls"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to controls
      </a>

      {/* Engine-status chips (fixed, low-key) */}
      {aiState === "loading" && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-border/60 bg-card/95 px-4 py-2 text-xs font-medium shadow-lg backdrop-blur">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex size-2 rounded-full bg-primary" />
          </span>
          Loading AI cutout engine{" "}
          {aiProgress !== null
            ? `— ${aiProgress}%${aiProgress >= 100 ? " (starting up…)" : ""}`
            : "— first run downloads ~60 MB, then cached"}
          <span className="text-muted-foreground">· app stays usable</span>
        </div>
      )}
      {detection && (
        <div className="fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-full border border-border/60 bg-card/95 px-4 py-2 text-xs font-medium shadow-lg backdrop-blur">
          <Sparkles className="size-3.5 text-primary" />
          Main object: {detection.label} · {Math.round(detection.confidence * 100)}%
        </div>
      )}
      {aiState === "failed" && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-4 py-2 text-xs font-medium text-brand-foreground shadow-lg">
          AI engine unavailable — using the on-device colour-model cutout
          <button
            onClick={() => {
              setAiProgress(null);
              preloadRef.current = false;
              ensureWarm();
            }}
            className="underline decoration-dotted underline-offset-2 hover:opacity-80"
          >
            retry
          </button>
        </div>
      )}

      {/* Screen-reader status */}
      <p aria-live="polite" className="sr-only">
        {stage === "processing" && "Processing photo: finding your product."}
        {stage === "ready" &&
          `Photo ready. ${candidateCount} object${candidateCount === 1 ? "" : "s"} detected. Cutout confidence ${Math.round((confidence ?? 0) * 100)} percent.`}
        {stage === "error" &&
          (fitWarning
            ? "Could not find a clear product. The whole photo was kept."
            : "Could not isolate a product in that photo.")}
      </p>

      {/* top bar */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <Logo size={28} />
          </Link>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="mr-1 hidden h-7 gap-1.5 rounded-full border-border/70 px-2.5 text-[11px] font-medium text-muted-foreground lg:inline-flex"
            >
              <Cpu className="size-3" />
              On-device · nothing uploaded
            </Badge>
            {fileName && (
              <span className="mr-1 hidden max-w-52 truncate text-sm text-muted-foreground sm:block">
                {fileName}
              </span>
            )}
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw className="size-4" />
              New photo
            </Button>
          </div>
        </div>
      </header>

      <main id="studio-controls" className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* -------------------------------------------------- controls */}
          <div className="flex flex-col gap-4">
            {/* 1 · photo */}
            <Card className="p-5">
              <StepHeading icon={ImageUp} title="1 · Photo" />
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                  e.target.value = "";
                }}
              />
              <div
                role="button"
                tabIndex={0}
                aria-label="Upload a photo: drop an image here, or press Enter to browse files"
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    inputRef.current?.click();
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void loadFile(f);
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-7 text-center transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  dragOver ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-muted/50",
                )}
              >
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                  <ImageUp className="size-5 text-primary" />
                </div>
                <p className="mt-3 text-sm font-medium">Drop, paste, or click to browse</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  JPG / PNG — product on any messy background
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => void loadSample()}
                disabled={stage === "processing"}
              >
                <Sparkles className="size-4 text-primary" />
                Try the sample photo
              </Button>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {samplePhoto ? (
                  <>
                    Sample photo by{" "}
                    <a
                      href={samplePhoto.source}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                    >
                      {samplePhoto.photographer}
                    </a>{" "}
                    (Pexels) — {samplePhoto.subject} on a real background.
                  </>
                ) : (
                  "Uses a real product photo; falls back to the built-in scene when offline."
                )}
              </p>

              <div className="mt-4">
                <Label className="text-xs text-muted-foreground">Detail boost (upscale)</Label>
                <div className="mt-1.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Upscale factor">
                  {([1, 2, 3] as const).map((f) => (
                    <button
                      key={f}
                      onClick={() => setUpscaleFactor(f)}
                      role="radio"
                      aria-checked={upscaleFactor === f}
                      aria-label={f === 1 ? "Native resolution" : `Upscale ${f} times`}
                      className={cn(
                        "min-h-10 rounded-lg border text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        upscaleFactor === f
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {f === 1 ? "Off" : `${f}×`}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Sharpens soft phone photos — 2× recommended for small crops.
                </p>
              </div>
            </Card>

            {/* 2 · output style */}
            <Card
              className={cn("p-5", stage !== "ready" && "pointer-events-none opacity-50")}
              aria-disabled={stage !== "ready"}
            >
              <StepHeading icon={Sparkles} title="2 · Output style" />
              <div className="grid gap-2" role="radiogroup" aria-label="Output style">
                {OUTPUT_STYLES.map((s) => {
                  const rank = recommended.indexOf(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => applyStyle(s.id)}
                      role="radio"
                      aria-checked={style === s.id}
                      aria-label={`${s.label} — ${s.blurb}`}
                      className={cn(
                        "group flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        style === s.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40 hover:bg-muted/50",
                      )}
                    >
                      <span
                        className="size-8 shrink-0 rounded-lg ring-1 ring-black/10"
                        style={{ background: STYLE_SWATCH[s.id] }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          {s.label}
                          {rank === 0 && stage === "ready" && (
                            <Badge variant="secondary" className="h-4 rounded-full px-1.5 text-[10px]">
                              Best match
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {s.blurb}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {!shadowsOn && stage === "ready" && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Shadows are off for this style — flip the switch in step 5 to add them.
                </p>
              )}
            </Card>

            {/* 3 · design */}
            <Card
              className={cn("p-5", stage !== "ready" && "pointer-events-none opacity-50")}
              aria-disabled={stage !== "ready"}
            >
              <div className="mb-3 flex items-center gap-2">
                <Wand2 className="size-4 text-primary" />
                <h2 className="font-display text-sm font-semibold tracking-wide uppercase">
                  3 · Design
                </h2>
                {design && (
                  <Badge variant="secondary" className="ml-auto h-4 rounded-full px-1.5 text-[10px]">
                    {design.family}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {design
                  ? `Generated scene #${design.seed % 100000} — matched to your product's palette and finish.`
                  : "Generate a unique studio scene tuned to your product, or keep a fixed backdrop below."}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant={design ? "outline" : "default"}
                  size="sm"
                  className="min-h-10"
                  disabled={stage !== "ready"}
                  onClick={() => {
                    const seed = randomSeed();
                    setDesignSeed(seed);
                    setDesign(generateDesign(analysis, seed));
                  }}
                >
                  <Sparkles className="size-4" />
                  {design ? "Surprise again" : "Surprise design"}
                </Button>
                {design && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    onClick={() => {
                      setDesign(null);
                      setDesignSeed(null);
                    }}
                  >
                    <RotateCcw className="size-4" />
                    Fixed backdrop
                  </Button>
                )}
              </div>
              {design && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full text-xs"
                  disabled={stage !== "ready" || designSeed === null}
                  onClick={() => {
                    if (designSeed !== null) setDesign(generateDesign(analysis, designSeed));
                  }}
                >
                  Replay this exact design (seed {designSeed! % 100000})
                </Button>
              )}
            </Card>

            {/* 4 · backdrop & size */}
            <Card
              className={cn("p-5", stage !== "ready" && "pointer-events-none opacity-50")}
              aria-disabled={stage !== "ready"}
            >
              <StepHeading icon={Wand2} title="4 · Backdrop & size" />
              <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label="Backdrop colour">
                {BACKDROPS.map((b) => (
                  <button
                    key={b.id}
                    title={b.label}
                    onClick={() => setBackdrop(b.id)}
                    role="radio"
                    aria-checked={backdrop === b.id}
                    className={cn(
                      "h-10 rounded-lg ring-1 ring-black/10 transition-transform outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring",
                      backdrop === b.id && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                    )}
                    style={{ background: b.swatch }}
                    aria-label={b.label}
                  />
                ))}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Output size">
                {RATIOS.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setRatio(r.id)}
                    role="radio"
                    aria-checked={ratio === r.id}
                    aria-label={`${r.label} — ${r.hint}`}
                    className={cn(
                      "min-h-10 rounded-lg border px-2 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      ratio === r.id
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{getRatio(ratio).hint}</p>

              <div className="mt-4 space-y-4">
                <SliderRow label="Product size" value={size} min={40} max={150} suffix="%" onChange={setSize} />
                <SliderRow
                  label="Baseline height"
                  value={height}
                  min={55}
                  max={88}
                  suffix="%"
                  onChange={setHeight}
                />
              </div>
            </Card>

            {/* 5 · shadow engine */}
            <Card
              className={cn("p-5", stage !== "ready" && "pointer-events-none opacity-50")}
              aria-disabled={stage !== "ready"}
            >
              <StepHeading icon={Layers} title="5 · Shadow engine" />
              <button
                onClick={() => setShadowsOn(!shadowsOn)}
                role="switch"
                aria-checked={shadowsOn}
                className="mb-4 flex min-h-11 w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="text-muted-foreground">Shadows</span>
                <span
                  className={cn(
                    "relative h-5 w-9 rounded-full transition-colors",
                    shadowsOn ? "bg-primary" : "bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
                      shadowsOn ? "left-[18px]" : "left-0.5",
                    )}
                  />
                </span>
              </button>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Shadow preset">
                {SHADOW_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setShadow({ ...shadow, ...p.opts })}
                    role="radio"
                    aria-checked={activePreset?.id === p.id}
                    className={cn(
                      "min-h-11 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      activePreset?.id === p.id
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-4 space-y-4">
                <SliderRow
                  label="Light angle"
                  value={shadow.direction}
                  min={0}
                  max={180}
                  suffix="°"
                  onChange={(v) => setShadow({ ...shadow, direction: v })}
                />
                <SliderRow
                  label="Cast length"
                  value={Math.round(shadow.length * 100)}
                  min={10}
                  max={140}
                  suffix="%"
                  onChange={(v) => setShadow({ ...shadow, length: v / 100 })}
                />
                <SliderRow
                  label="Softness"
                  value={Math.round(shadow.softness * 100)}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(v) => setShadow({ ...shadow, softness: v / 100 })}
                />
                <SliderRow
                  label="Strength"
                  value={Math.round(shadow.opacity * 100)}
                  min={10}
                  max={80}
                  suffix="%"
                  onChange={(v) => setShadow({ ...shadow, opacity: v / 100 })}
                />
                <button
                  onClick={() => setShadow({ ...shadow, contact: !shadow.contact })}
                  role="switch"
                  aria-checked={shadow.contact}
                  className="flex min-h-11 w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="text-muted-foreground">Contact shadow</span>
                  <span
                    className={cn(
                      "relative h-5 w-9 rounded-full transition-colors",
                      shadow.contact ? "bg-primary" : "bg-muted",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
                        shadow.contact ? "left-[18px]" : "left-0.5",
                      )}
                    />
                  </span>
                </button>
              </div>
            </Card>

            {/* 6 · cutout sensitivity */}
            <Card className={cn("p-5", !beforeUrl && "pointer-events-none opacity-50")}>
              <StepHeading icon={Wand2} title="6 · Cutout sensitivity" />
              <SliderRow
                label="Background tolerance"
                value={tolerance}
                min={8}
                max={60}
                onChange={setTolerance}
                onCommit={(v) => {
                  const src = sourceRef.current;
                  if (!src) return;
                  setStage("processing");
                  setTimeout(
                    () => void runSegment(src.data.data, src.width, src.height, v, undefined, true),
                    30,
                  );
                }}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Raise it if backdrop bits survive; lower it if the product gets eaten.
              </p>
            </Card>

            {/* 7 · export */}
            <Card className="p-5">
              <StepHeading icon={Download} title="7 · Export" />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="min-h-10"
                  size="sm"
                  onClick={exportCurrentLook}
                  disabled={stage !== "ready"}
                >
                  <Download className="size-4" />
                  Current look
                </Button>
                <Button
                  variant="outline"
                  className="min-h-10"
                  size="sm"
                  onClick={cycleRatio}
                  disabled={stage !== "ready"}
                >
                  <ImageUp className="size-4" />
                  Next ratio
                </Button>
              </div>
              <Button
                variant="outline"
                className="mt-2 min-h-10 w-full"
                size="sm"
                onClick={() => void exportAllStyles()}
                disabled={stage !== "ready" || exportingAll}
              >
                <Layers className="size-4" />
                {exportingAll ? "Exporting all 5…" : "Export all 5 styles"}
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Full-resolution PNGs at your chosen ratio — current look, or all five styles to pick later.
              </p>
            </Card>

            {/* style analysis */}
            {stage === "ready" && analysis && (
              <Card className="p-5">
                <StepHeading icon={Sparkles} title="What we read" />
                <div className="flex items-center gap-2">
                  {analysis.palette.map((hex, i) => (
                    <span
                      key={hex + i}
                      title={hex}
                      className="size-7 rounded-lg ring-1 ring-black/10"
                      style={{ background: hex }}
                    />
                  ))}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <Stat label="Category" value={analysis.category} />
                  <Stat label="Tone" value={String(Math.round(analysis.tone * 100))} />
                  <Stat label="Contrast" value={String(Math.round(analysis.contrast * 100))} />
                  <Stat label="Saturation" value={String(Math.round(analysis.saturation * 100))} />
                  <Stat
                    label="Finish"
                    value={
                      analysis.glossy > 0.3 ? "Glossy" : analysis.glossy > 0.12 ? "Semi-gloss" : "Matte"
                    }
                  />
                  <Stat label="Best style" value={getStyle(recommended[0] ?? style).label} />
                  <div className="col-span-2 mt-1 flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Objects detected</dt>
                    <dd className="font-medium">
                      {candidateCount}
                      {candidateCount > 1 && (
                        <span className="ml-1 text-xs text-muted-foreground">· centered one framed</span>
                      )}
                    </dd>
                  </div>
                  <div className="col-span-2 flex items-center justify-between gap-2">
                    <dt className="text-muted-foreground">Cutout confidence</dt>
                    <dd className="flex items-center gap-2 font-medium">
                      <span
                        className={cn(
                          "inline-block size-2 rounded-full",
                          confidence !== null && confidence >= 0.6
                            ? "bg-emerald-500"
                            : confidence !== null && confidence >= 0.35
                              ? "bg-amber-500"
                              : "bg-destructive",
                        )}
                      />
                      {confidence !== null ? `${Math.round(confidence * 100)}%` : "—"}
                    </dd>
                  </div>
                </dl>
              </Card>
            )}

            <button
              onClick={reset}
              className="text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              Start over
            </button>
          </div>

          {/* -------------------------------------------------- preview */}
          <div className="flex flex-col gap-4">
            {stage === "empty" && (
              <EmptyState onBrowse={() => inputRef.current?.click()} onSample={() => void loadSample()} />
            )}
            {stage === "processing" && <ProcessingState />}
            {stage === "error" && (
              <Card className="flex flex-col items-center justify-center gap-3 rounded-2xl border-dashed p-16 text-center">
                <AlertTriangle className="size-8 text-destructive/70" />
                {fitWarning ? (
                  <>
                    <p className="font-medium">We kept the whole photo — no clear product stood out</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Raise the “Background tolerance” slider and retry, or use a photo where the
                      product stands apart from the background.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">We couldn’t isolate a product in that photo</p>
                    <p className="max-w-sm text-sm text-muted-foreground">
                      Try the “Cutout sensitivity” slider, or a photo where the product stands apart
                      from the background.
                    </p>
                  </>
                )}
                <div className="mt-2 flex gap-2">
                  <Button variant="outline" size="sm" onClick={retrySegmentation}>
                    <RotateCcw className="size-4" />
                    Retry
                  </Button>
                  <Button size="sm" onClick={() => inputRef.current?.click()}>
                    <ImageUp className="size-4" />
                    Another photo
                  </Button>
                </div>
              </Card>
            )}

            {stage === "ready" && (
              <>
                {(edgeWarning || fitWarning) && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-brand/40 bg-brand/10 px-4 py-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-brand" />
                    <span className="text-brand-foreground">
                      {edgeWarning &&
                        "The product touches the edge of the photo — the cutout may clip. Photos with space around the product work best."}
                      {fitWarning &&
                        "We couldn’t find a clear product — the whole photo was kept. Raise the cutout sensitivity."}
                    </span>
                  </div>
                )}
                <Card className="p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div
                      className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-muted/50 p-1"
                      role="radiogroup"
                      aria-label="Preview mode"
                    >
                      {(
                        [
                          { id: "compare", label: "Compare", Icon: Columns2 },
                          { id: "after", label: "Banner", Icon: ImageIcon },
                          { id: "before", label: "Source", Icon: ImageUp },
                        ] as const
                      ).map((m) => (
                        <button
                          key={m.id}
                          role="radio"
                          aria-checked={view === m.id}
                          onClick={() => setView(m.id)}
                          className={cn(
                            "inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                            view === m.id
                              ? "bg-card text-foreground shadow-e1"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <m.Icon className="size-3.5" />
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      {offsetX !== 0 && (
                        <Button variant="outline" size="sm" onClick={() => setOffsetX(0)}>
                          <MoveHorizontal className="size-4" />
                          Recenter
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={exportingAll}
                        onClick={() => void exportAllStyles()}
                        title="Download one full-resolution PNG per output style"
                      >
                        <Layers className="size-4" />
                        {exportingAll ? "Exporting…" : "All styles"}
                      </Button>
                      <Button
                        size="sm"
                        onClick={exportCurrentLook}
                        title="Download the current banner as a full-resolution PNG"
                      >
                        <Download className="size-4" />
                        Download PNG
                      </Button>
                    </div>
                  </div>

                  <div
                    ref={previewBoxRef}
                    className="mx-auto max-w-[560px] cursor-grab touch-none select-none active:cursor-grabbing"
                    onPointerDown={(e) => {
                      // Drags that start on the compare handle belong to the
                      // BeforeAfterSlider, not to product placement.
                      const target = e.target as HTMLElement;
                      if (target.closest("[data-compare-handle]")) return;
                      if (e.button !== 0) return;
                      dragRef.current = { startX: e.clientX, startOffset: offsetX };
                      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      const d = dragRef.current;
                      const box = previewBoxRef.current;
                      if (!d || !box) return;
                      const rect = box.getBoundingClientRect();
                      const next = Math.max(
                        -1,
                        Math.min(1, d.startOffset + ((e.clientX - d.startX) / rect.width) * 2),
                      );
                      setOffsetX(Math.round(next * 100) / 100);
                    }}
                    onPointerUp={() => (dragRef.current = null)}
                    onPointerCancel={() => (dragRef.current = null)}
                    role="application"
                    aria-label="Product placement preview — drag horizontally or use arrow keys to reposition"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      const step = e.shiftKey ? 0.1 : 0.02;
                      if (e.key === "ArrowLeft") {
                        e.preventDefault();
                        setOffsetX((v) => Math.max(-1, Math.round((v - step) * 100) / 100));
                      } else if (e.key === "ArrowRight") {
                        e.preventDefault();
                        setOffsetX((v) => Math.min(1, Math.round((v + step) * 100) / 100));
                      }
                    }}
                    title="Drag horizontally (or arrow keys) to reposition the product"
                  >
                    {view === "compare" ? (
                      <BeforeAfterSlider before={beforeUrl} after={afterUrl} />
                    ) : (
                      (() => {
                        const src = view === "after" ? afterUrl : beforeUrl;
                        return src ? (
                          <div className="overflow-hidden rounded-xl border border-border/70 bg-muted/40">
                            <img
                              src={src}
                              alt={view === "after" ? "Finished banner" : "Original photo"}
                              className="block w-full"
                              draggable={false}
                            />
                          </div>
                        ) : (
                          <div
                            role="status"
                            aria-label="Preview rendering"
                            className="shimmer aspect-[4/5] w-full rounded-xl border border-border/70"
                          />
                        );
                      })()
                    )}
                  </div>
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    {view === "compare"
                      ? "Drag the handle to compare · drag the image sideways to reposition · shadows re-render live"
                      : view === "after"
                        ? "This is the banner you export — drag the image sideways to reposition the product."
                        : "The original photo. Switch to Compare to see what the engine changed."}
                  </p>
                </Card>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    { k: "Detected", v: `${candidateCount} ${candidateCount === 1 ? "object" : "objects"}` },
                    { k: "Shadow", v: "Coverage integral" },
                    { k: "Output", v: `${getRatio(ratio).w} × ${getRatio(ratio).h}` },
                    { k: "Privacy", v: "On-device" },
                  ].map((s) => (
                    <div
                      key={s.k}
                      className="edge-top rounded-xl border border-border/60 bg-card px-4 py-3 shadow-e1"
                    >
                      <div className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                        {s.k}
                      </div>
                      <div className="mt-0.5 text-sm font-medium">{s.v}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------- pieces

/** Numbered step heading shared by every control card. */
function StepHeading({
  icon: Icon,
  title,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="size-4 text-primary" />
      <h2 className="font-display text-sm font-semibold tracking-wide uppercase">{title}</h2>
    </div>
  );
}

/** Definition row used by the analysis panel. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

/**
 * Downscale the full-resolution banner into a preview image and hand it to
 * React.
 *
 * Prefers `OffscreenCanvas.convertToBlob()` so the JPEG encode runs off the
 * interaction path (dragging the size / shadow sliders stays at 60fps).
 * Falls back to a reused 2D canvas + `toDataURL`. A sequence number guards the
 * async path so a slow encode can never overwrite a newer preview.
 */
function emitPreview(
  source: HTMLCanvasElement,
  sw: number,
  setUrl: (url: string) => void,
  urlRef: { current: string | null },
  seqRef: { current: number },
  fallbackRef: { current: HTMLCanvasElement | null },
) {
  const pw = 648;
  const seq = ++seqRef.current;

  const commit = (url: string, isBlob: boolean) => {
    if (seq !== seqRef.current) {
      if (isBlob) URL.revokeObjectURL(url);
      return;
    }
    const prev = urlRef.current;
    urlRef.current = url;
    setUrl(url);
    if (prev && prev !== url && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  };

  if (typeof OffscreenCanvas !== "undefined") {
    try {
      const ph = Math.max(1, Math.round((source.height / sw) * pw));
      const oc = new OffscreenCanvas(pw, ph);
      const octx = oc.getContext("2d");
      if (octx) {
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = "high";
        octx.drawImage(source, 0, 0, pw, ph);
        void oc
          .convertToBlob({ type: "image/jpeg", quality: 0.88 })
          .then((blob) => commit(URL.createObjectURL(blob), true))
          .catch(() => commit(syncPreview(source, sw, pw, fallbackRef), false));
        return;
      }
    } catch {
      /* fall through to the synchronous path */
    }
  }
  commit(syncPreview(source, sw, pw, fallbackRef), false);
}

/** Synchronous preview encode fallback (reuses one canvas across ticks). */
function syncPreview(
  source: HTMLCanvasElement,
  sw: number,
  pw: number,
  fallbackRef: { current: HTMLCanvasElement | null },
): string {
  const pcv = fallbackRef.current ?? document.createElement("canvas");
  fallbackRef.current = pcv;
  pcv.width = pw;
  pcv.height = Math.max(1, Math.round((source.height / sw) * pw));
  const pctx = pcv.getContext("2d")!;
  pctx.imageSmoothingEnabled = true;
  pctx.imageSmoothingQuality = "high";
  pctx.drawImage(source, 0, 0, pcv.width, pcv.height);
  return pcv.toDataURL("image/jpeg", 0.88);
}

/**
 * Labeled slider with a live numeric readout.
 *
 * `onChange` fires on every drag tick (cheap); `onCommit`, when provided,
 * fires once on release (used for the expensive re-segmentation path).
 */
function SliderRow({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <span className="text-xs font-medium tabular-nums">
          {value}
          {suffix}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        aria-label={label}
        onValueChange={(vals) => onChange(vals[0])}
        onValueCommit={onCommit ? (vals) => onCommit(vals[0]) : undefined}
      />
    </div>
  );
}

/** Shown before any photo is loaded: drop zone + sample button. */
function EmptyState({ onBrowse, onSample }: { onBrowse: () => void; onSample: () => void }) {
  const points = [
    "BiRefNet AI matting + a custom edge-guided engine",
    "Coverage-integral shadow engine, painted in-browser",
    "Full-resolution PNGs for feeds, squares and banners",
  ];
  return (
    <Card className="flex flex-col items-center justify-center rounded-2xl border-dashed p-12 text-center sm:p-16">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
        <ImageUp className="size-7 text-primary" />
      </div>
      <h2 className="mt-5 font-display text-2xl font-semibold">Start with a messy photo</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        A laptop on a cluttered deck, a jacket on a bed — anything a human could point at.
        Everything runs on your device; nothing is uploaded.
      </p>
      <ul className="mt-6 grid gap-2 text-left text-sm text-muted-foreground">
        {points.map((p) => (
          <li key={p} className="flex items-center gap-2.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Check className="size-3 text-primary" strokeWidth={3} />
            </span>
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-7 flex flex-col gap-2 min-[380px]:flex-row">
        <Button onClick={onBrowse} className="min-h-11">
          <ImageUp className="size-4" />
          Choose a photo
        </Button>
        <Button variant="outline" onClick={onSample} className="min-h-11">
          <Sparkles className="size-4 text-primary" />
          Use sample
        </Button>
      </div>
    </Card>
  );
}

/** Full-bleed "finding your product" card shown while the pipeline runs. */
function ProcessingState() {
  return (
    <Card
      className="flex flex-col items-center justify-center rounded-2xl p-20 text-center"
      role="status"
      aria-label="Processing photo"
    >
      <div className="relative flex size-16 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
        <span className="absolute inset-2 rounded-full bg-primary/10" />
        <Wand2 className="size-6 text-primary" aria-hidden="true" />
      </div>
      <p className="mt-5 font-medium">Finding your product…</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Runs entirely on this device — usually takes a couple of seconds.
      </p>
      <div aria-hidden className="mt-7 w-full max-w-xs space-y-3">
        <div className="shimmer h-2.5 w-full rounded-full" />
        <div className="shimmer mx-auto h-2.5 w-3/4 rounded-full" />
        <div className="shimmer mx-auto h-2.5 w-1/2 rounded-full" />
      </div>
    </Card>
  );
}
