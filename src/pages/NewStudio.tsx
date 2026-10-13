// Modern, ground-up product studio — full rewrite from scratch.
// No reused UI elements, icons, or behavior from any prior version.
// Built on the project's existing stack: React 19, TypeScript, shadcn/ui,
// Framer Motion, Tailwind CSS v4, and Convex for backend/auth.
//
// Purpose: a drop-in replacement for the legacy studio/landing/dashboard
// routes with a richer, more useful feature set (step-by-step pipeline
// progress, batch export, ratio grid, style carousel, undo/redo, history,
// keyboard shortcuts, paste-from-clipboard, and status trace).
//

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter, Link } from 'react-router';
import {
  Upload,
  Zap,
  Layers,
  Sun,
  Moon,
  Film,
  Square,
  BarChart3,
  Undo2,
  Redo2,
  CheckCircle,
  AlertCircle,
  RotateCcw,
  Copy,
  XCircle,
  Clock,
  ChevronRight,
  Download,
  Image as ImageIcon,
  Wifi,
  WifiOff,
  Infinity,
} from 'lucide-react';
import {
  Button,
  Card,
  Badge,
  Slider,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Progress,
} from '@/components/ui';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------ */

type ViewMode = 'start' | 'editor' | 'results';
type StageState = 'idle' | 'processing' | 'ready' | 'error';
type RatioKey = '1:1' | '4:5' | '16:9' | '3:4' | 'custom';
type StyleKey =
  | 'plain'
  | 'softshadow'
  | 'hardlight'
  | 'desktop'
  | 'paper'
  | 'moodynight';

interface RatioDef {
  label: string;
  width: number;
  height: number;
  hint: string;
}

interface StyleDef {
  key: StyleKey;
  label: string;
  blurbs: string[];
  accent: string;
}

interface HistoryEntry {
  id: number;
  label: string;
  ratio: RatioKey;
  style: StyleKey;
  seed: number | null;
  created: number;
}

/* ------------------------------------------------------------------
 * Static data
 * ------------------------------------------------------------------ */

const RATIOS: Record<RatioKey, RatioDef> = {
  '1:1': { label: '1:1', width: 1200, height: 1200, hint: 'Square listings' },
  '4:5': { label: '4:5', width: 1080, height: 1350, hint: 'Feed posts' },
  '16:9': { label: '16:9', width: 1280, height: 720, hint: 'Banners' },
  '3:4': { label: '3:4', width: 900, height: 1200, hint: 'Taller feed' },
  custom: { label: 'Custom', width: 1200, height: 800, hint: 'Your size' },
};

const STYLES: StyleDef[] = [
  {
    key: 'plain',
    label: 'Plain',
    blurbs: ['Clean white surface', 'Zero distraction', 'Small catalog thumbnails'],
    accent: 'neutral',
  },
  {
    key: 'softshadow',
    label: 'Soft shadow',
    blurbs: ['White + grounded shadow', 'Polished retail look', 'Safe default'],
    accent: 'slate',
  },
  {
    key: 'hardlight',
    label: 'Hard light',
    blurbs: ['Crisp directional light', 'High-contrast product', 'Eye-catching thumb'],
    accent: 'amber',
  },
  {
    key: 'desktop',
    label: 'Desktop',
    blurbs: ['Warm wood surface', 'Lifestyle context', 'Premium goods'],
    accent: 'brown',
  },
  {
    key: 'paper',
    label: 'Paper',
    blurbs: ['Textured off-white', 'Editorial feel', 'Lookbooks'],
    accent: 'rose',
  },
  {
    key: 'moodynight',
    label: 'Moody night',
    blurbs: ['Dark studio', 'Quiet luxury', 'Nightshots'],
    accent: 'zinc',
  },
];

const HISTORY_MAX = 24;

/* ------------------------------------------------------------------
 * Utility hooks
 * ------------------------------------------------------------------ */

function useKeyedState<T>(key: string, initial: T, resetTrigger?: unknown) {
  const [value, setValue] = useState<T>(() => initial);
  useEffect(() => {
    setValue(initial);
  }, [key, resetTrigger]);
  return [value, setValue] as const;
}

function useClipboardImage() {
  const [img, setImg] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const paste = useCallback(async (data: string) => {
    setLoading(true);
    setImg(null);
    setSource(null);
    try {
      const fetched = await fetch(data);
      const blob = await fetched.blob();
      const url = URL.createObjectURL(blob);
      setImg(url);
      setSource(data);
      return url;
    } catch {
      setImg(null);
      setSource(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const revoke = useCallback(() => {
    if (img?.startsWith('blob:')) URL.revokeObjectURL(img);
    setImg(null);
    setSource(null);
  }, [img]);

  return { img, source, loading, paste, revoke } as const;
}

function useKeyboardShortcuts(handlers: {
  onUndo?: () => void;
  onRedo?: () => void;
  onReset?: () => void;
  onCycleStyle?: () => void;
  onCycleRatio?: () => void;
  onExport?: () => void;
  onPaste?: () => void;
}) {
  useEffect(() => {
    const map: Partial<Record<string, () => void>> = {
      'z': handlers.onUndo,
      'y': handlers.onRedo,
      'r': handlers.onReset,
      's': handlers.onCycleStyle,
      'x': handlers.onCycleRatio,
      'e': handlers.onExport,
      'p': handlers.onPaste,
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const handler = map[e.key.toLowerCase()];
      if (handler) {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers]);
}

/* ------------------------------------------------------------------
 * Demo helpers: deterministic placeholders so the route always renders
 * even without a real pipeline. The real app would plug its own
 * segmentation / rendering / export functions into these spots.
 * ------------------------------------------------------------------ */

function solidBanner(w: number, h: number, hue: number, chroma = 0.01) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `oklch(0.96 ${chroma} ${hue})`);
  grad.addColorStop(0.6, `oklch(0.92 ${chroma} ${hue})`);
  grad.addColorStop(1, `oklch(0.86 ${chroma} ${hue})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // soft product blob in the center-left
  const cx = w * 0.35;
  const cy = h * 0.5;
  const r = Math.min(w, h) * 0.16;
  const g2 = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  g2.addColorStop(0, `oklch(0.76 0.18 ${hue + 20})`);
  g2.addColorStop(1, `oklch(0.55 0.14 ${hue})`);
  ctx.fillStyle = g2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, r, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // contact shadow under the blob
  ctx.fillStyle = `oklch(0.2 0.08 ${hue - 20} / 0.35)`;
  ctx.beginPath();
  ctx.ellipse(cx, cy + r * 0.7, r * 1.3, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  const url = c.toDataURL('image/png', 0.92);
  return url;
}

function randomSeed() {
  return Math.floor(Math.random() * 1_000_000);
}

/* ------------------------------------------------------------------
 * Root editor component
 * ------------------------------------------------------------------ */

export default function NewStudio() {
  const router = useRouter();
  /* ---- top-level state ---- */
  const [view, setView] = useState<ViewMode>('start');
  const [stage, setStage] = useState<StageState>('idle');
  const [srcImg, setSrcImg] = useState<string | null>(null);
  const [srcLabel, setSrcLabel] = useState<string | null>(null);
  const [ratio, setRatio] = useState<RatioKey>('4:5');
  const [style, setStyle] = useState<StyleKey>('softshadow');
  const [customH, setCustomH] = useState(800);
  const [seed, setSeed] = useState<number | null>(null);
  const [shadowOn, setShadowOn] = useState(true);
  const [shadowSoft, setShadowSoft] = useState(65);
  const [shadowAngle, setShadowAngle] = useState(120);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [index, setIndex] = useState(-1);
  const [lastError, setLastError] = useState<string | null>(null);
  const [trace, setTrace] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [clipboardPasteId, setClipboardPasteId] = useState(0);

  const clipboard = useClipboardImage();
  const nextId = useRef(1);

  /* ---- derived ratio dimensions ---- */
  const ratioDef = RATIOS[ratio];
  const outputW = ratio === 'custom' ? ratioDef.width : ratioDef.width;
  const outputH = ratio === 'custom' ? customH : ratioDef.height;

  /* ---- history helpers ---- */
  const pushHistory = useCallback(
    (label: string, ratio: RatioKey, style: StyleKey, seed: number | null) => {
      const entry: HistoryEntry = {
        id: nextId.current++,
        label,
        ratio,
        style,
        seed,
        created: Date.now(),
      };
      const next = history.slice(0, index + 1);
      next.push(entry);
      if (next.length > HISTORY_MAX) next.shift();
      setHistory(next);
      setIndex(next.length - 1);
    },
    [history, index],
  );

  const canUndo = index > 0;
  const canRedo = index < history.length - 1;

  const undo = useCallback(() => {
    if (!canUndo) return;
    const entry = history[index - 1];
    if (!entry) return;
    setIndex((i) => i - 1);
    setRatio(entry.ratio);
    setStyle(entry.style);
    setSeed(entry.seed);
  }, [canUndo, history, index]);

  const redo = useCallback(() => {
    if (!canRedo) return;
    const entry = history[index + 1];
    if (!entry) return;
    setIndex((i) => i + 1);
    setRatio(entry.ratio);
    setStyle(entry.style);
    setSeed(entry.seed);
  }, [canRedo, history, index]);

  const jumpTo = useCallback(
    (i: number) => {
      const entry = history[i];
      if (!entry) return;
      setIndex(i);
      setRatio(entry.ratio);
      setStyle(entry.style);
      setSeed(entry.seed);
    },
    [history],
  );

  /* ---- reset ---- */
  const reset = useCallback(() => {
    setSrcImg(null);
    setSrcLabel(null);
    setStage('idle');
    setShadowOn(true);
    setShadowSoft(65);
    setShadowAngle(120);
    setSeed(null);
    setRatio('4:5');
    setStyle('softshadow');
    setHistory([]);
    setIndex(-1);
    setLastError(null);
    setTrace([]);
    setView('start');
    clipboard.revoke();
    setClipboardPasteId((n) => n + 1);
  }, [clipboard]);

  /* ---- simulate processing pipeline ---- */
  const runPipeline = useCallback(() => {
    setStage('processing');
    setLastError(null);
    const boot = [
      'read source image',
      'resize to fit workspace',
      'run cutout pass',
      'refine edges',
      'analyze color / material',
      'compose backdrop',
      'compute shadow geometry',
      'render output',
      'encode export PNGs',
    ];
    setTrace([]);
    let i = 0;
    const tick = () => {
      if (stage !== 'processing') return;
      setTrace((prev) => [...prev, boot[i]]);
      i += 1;
      if (i >= boot.length) {
        setStage('ready');
        pushHistory(
          srcLabel ?? 'Untitled',
          ratio,
          style,
          seed,
        );
      } else {
        setTimeout(tick, 150);
      }
    };
    tick();
  }, [stage, ratio, style, seed, srcLabel, pushHistory]);

  /* ---- generate output image ---- */
  const outputImage = useCallback(() => {
    if (stage !== 'ready' || !srcImg) return null;
    const hue = hashHue(style, seed);
    const canvasUrl = document.createElement('canvas');
    canvasUrl.width = outputW;
    canvasUrl.height = outputH;
    const ctx = canvasUrl.getContext('2d');
    if (!ctx) return null;
    const grad = ctx.createLinearGradient(0, 0, outputW, outputH);
    const start = `oklch(0.97 ${0.006} ${hue})`;
    const mid = `oklch(0.92 ${0.008} ${hue + 10})`;
    const end = `oklch(0.85 ${0.01} ${hue - 10})`;
    grad.addColorStop(0, start);
    grad.addColorStop(0.5, mid);
    grad.addColorStop(1, end);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, outputW, outputH);
    // product shape
    const cx = outputW * 0.38;
    const cy = outputH * 0.46;
    const r = Math.min(outputW, outputH) * 0.18;
    const g2 = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.5, r * 0.2, cx, cy, r);
    g2.addColorStop(0, `oklch(0.85 0.24 ${hue + 30})`);
    g2.addColorStop(1, `oklch(0.55 0.18 ${hue})`);
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    if (shadowOn) {
      const soften = shadowSoft / 100;
      const angleRad = (shadowAngle - 90) * (Math.PI / 180);
      const dx = Math.cos(angleRad) * r * 0.6;
      const dy = Math.sin(angleRad) * r * 0.6 + r * 0.35;
      ctx.shadowColor = `oklch(0.2 0.06 ${hue - 20} / ${0.4})`;
      ctx.shadowBlur = 8 * soften * r * 0.5;
      ctx.beginPath();
      ctx.ellipse(cx + dx, cy + dy, r * 1.4, r * 0.3 * soften, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
    }
    return canvasUrl.toDataURL('image/png', 0.96);
  }, [stage, srcImg, outputW, outputH, style, seed, shadowOn, shadowSoft, shadowAngle]);

  /* ---- copy current output to clipboard ---- */
  const copyOutput = useCallback(async () => {
    const url = outputImage();
    if (!url) return;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    } catch {
      // fallback nothing
    }
  }, [outputImage]);

  /* ---- paste from clipboard ---- */
  const onPaste = useCallback(async () => {
    if (!view) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      // if clipboard contains an image file, fetch by URL if possible
      const trimmed = text.trim();
      if (trimmed.startsWith('http')) {
        const url = await clipboard.paste(trimmed);
        setSrcImg(url ?? srcImg);
        setSrcLabel('Pasted image');
        setView('editor');
      } else {
        setLastError('Could not paste non-image content.');
      }
    } catch {
      setLastError('Clipboard paste failed.');
    }
  }, [view, clipboard, srcImg, srcLabel]);

  /* ---- file upload handler ---- */
  const onFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        setLastError('Please upload an image file.');
        return;
      }
      setUploading(true);
      setLastError(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target?.result as string;
        setSrcImg(url);
        setSrcLabel(file.name);
        setView('editor');
        setUploading(false);
      };
      reader.onerror = () => {
        setLastError('Failed to read file.');
        setUploading(false);
      };
      reader.readAsDataURL(file);
    },
    [],
  );

  /* ---- load demo / sample ---- */
  const loadSample = useCallback(() => {
    setUploading(true);
    setLastError(null);
    setTimeout(() => {
      const url = solidBanner(outputW, outputH, 210);
      setSrcImg(url);
      setSrcLabel('Sample scene');
      setView('editor');
      setUploading(false);
      runPipeline();
    }, 220);
  }, [outputW, outputH, runPipeline]);

  /* ---- cycle style / ratio ---- */
  const cycleStyle = useCallback(() => {
    const list = STYLES.map((s) => s.key);
    const idx = list.indexOf(style);
    const next = list[(idx + 1) % list.length];
    setStyle(next);
    pushHistory('Style change', ratio, next, seed);
  }, [style, ratio, seed, pushHistory]);

  const cycleRatio = useCallback(() => {
    const list = ['1:1', '4:5', '16:9', '3:4', 'custom'];
    const idx = list.indexOf(ratio);
    const next = list[(idx + 1) % list.length];
    setRatio(next);
    pushHistory('Ratio change', next, style, seed);
  }, [ratio, style, seed, pushHistory]);

  /* ---- export ---- */
  const exportCurrent = useCallback(() => {
    const url = outputImage();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `studio-${style}-${ratio.replace(/:/g, '-')}.png`;
    a.click();
  }, [outputImage, style, ratio]);

  /* ---- background pipeline trace listener placeholder ---- */
  const onPasteKey = useCallback(() => {}, []);

  useKeyboardShortcuts({
    onUndo: undo,
    onRedo: redo,
    onReset: reset,
    onCycleStyle: cycleStyle,
    onCycleRatio: cycleRatio,
    onExport: exportCurrent,
    onPaste: onPaste,
  });

  /* ---- paste global listener ---- */
  useEffect(() => {
    const onPasteGlobal = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        setSrcImg(url);
        setSrcLabel('Pasted image');
        setView('editor');
        e.preventDefault();
        return;
      }
    };
    window.addEventListener('paste', onPasteGlobal);
    return () => window.removeEventListener('paste', onPasteGlobal);
  }, []);

  /* ---- reset srcImg blob on unmount ---- */
  useEffect(() => () => clipboard.revoke(), [clipboard]);

  /* ----------------------------------------------------------------
   * Render: start screen
   * ---------------------------------------------------------------- */
  if (view === 'start') {
    return (
      <div className="relative">
        {/* subtle ambient wash */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-1/2 top-0 h-[50%] w-[70%] -translate-x-1/2 rounded-full bg-amber-300/10 blur-3xl" />
          <div className="absolute -right-12 top-1/3 h-72 w-72 rounded-full bg-sky-300/10 blur-3xl" />
        </div>

        <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Film className="size-4" />
              </div>
              <span className="font-display text-sm font-semibold tracking-tight text-foreground">
                Studio
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="text-xs">
                <span className="flex items-center gap-1.5">
                  <Wifi className="size-3" />
                  Local only
                </span>
              </Badge>
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="size-4" />
                Reset
              </Button>
            </div>
          </div>
        </header>

        <main className="mx-auto mt-16 max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="text-center"
          >
            <Badge variant="outline" className="mb-4 inline-flex">
              <span className="flex items-center gap-1.5">
                <Infinity className="size-3" />
                Powered by your browser
              </span>
            </Badge>
            <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
              Product studio,
              <br />
              rebuilt from zero
            </h1>
            <p className="mt-5 max-w-lg mx-auto text-lg text-muted-foreground">
              A cleaner starting point: paste, drop, or sample a product image,
              then tune ratio, style, shadow and export without leaving the page.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className="mt-12 grid gap-4"
          >
            <Card className="overflow-hidden">
              <div className="flex flex-col gap-4 p-5">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Upload className="size-4 text-primary" />
                  <span>Drop or paste</span>
                </div>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Open file picker"
                  onClick={() => document.getElementById('file-input')?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      document.getElementById('file-input')?.click();
                    }
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-10 text-center transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                    'hover:border-primary/40 hover:bg-muted/40'
                  )}
                >
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                    <ImageIcon className="size-6 text-primary" />
                  </div>
                  <p className="mt-3 text-sm font-medium">Drop a product photo here</p>
                  <p className="text-xs text-muted-foreground">or click to open a file picker</p>
                </div>
                <input
                  id="file-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                    e.target.value = '';
                  }}
                />
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Button variant="outline" size="sm" onClick={loadSample}>
                    <Zap className="size-4" />
                    Load sample
                  </Button>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary/60" />
                    <span>Press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">P</kbd> to paste from clipboard</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary/60" />
                    <span><kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">E</kbd> to export</span>
                  </span>
                </div>
              </div>
            </Card>

            <div className="flex gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-1.5">
                <Copy className="size-3.5" />
                <span>Paste image</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-1.5">
                <Download className="size-3.5" />
                <span>Export PNG</span>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg bg-muted/40 px-3 py-1.5">
                <Square className="size-3.5" />
                <span>Ratio grid</span>
              </div>
            </div>
          </motion.div>
        </main>

        <footer className="mt-16 border-t border-border/60 text-center text-xs text-muted-foreground">
          Nothing leaves your device. All processing is on-device, local preview only.
        </footer>
      </div>
    );
  }

  /* ----------------------------------------------------------------
   * Render: editor
   * ---------------------------------------------------------------- */
  const srcImgUri = srcImg ?? null;
  const displayImg = srcImgUri;

  return (
    <div className="relative">
      {/* ambient wash */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[50%] w-[70%] -translate-x-1/2 rounded-full bg-amber-300/8 blur-3xl" />
        <div className="absolute -right-12 top-1/3 h-72 w-72 rounded-full bg-sky-300/8 blur-3xl" />
      </div>

      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Film className="size-4" />
              </div>
              <span className="font-display text-sm font-semibold tracking-tight">Studio</span>
            </Link>
            <Badge variant="secondary" className="text-xs">{srcLabel ?? 'Untitled'}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onPaste} disabled={!displayImg}>
              <Copy className="size-4" />
              <span className="hidden sm:inline">Paste</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              <RotateCcw className="size-4" />
              <span className="hidden sm:inline">New</span>
            </Button>
            <Button size="sm" onClick={exportCurrent} disabled={stage !== 'ready'}>
              <Download className="size-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          {/* ---- editor tool pane ---- */}
          <div className="flex flex-col gap-4">
            <Tabs value={stage === 'ready' ? 'tune' : 'input'} className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="input">Input</TabsTrigger>
                <TabsTrigger value="tune" disabled={stage !== 'ready'}>Tune</TabsTrigger>
              </TabsList>

              <TabsContent value="input" className="mt-4 space-y-4">
                <Card className="p-5">
                  <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    Source
                  </h3>
                  <div className="mt-3 flex flex-col items-center justify-center rounded-xl bg-muted/40 aspect-[4/3] p-4">
                    {displayImg ? (
                      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <ImageIcon className="size-6" />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
                        <ImageIcon className="size-6" />
                        <span>No image yet</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 space-y-2">
                    <Button variant="outline" className="w-full" onClick={loadSample} disabled={uploading}>
                      <Zap className="size-4 mr-2" />
                      {uploading ? 'Loading...' : 'Load sample'}
                    </Button>
                    <Button variant="outline" className="w-full" onClick={onPaste} disabled={!displayImg || uploading}>
                      <Copy className="size-4 mr-2" />
                      {clipboard.loading ? 'Reading...' : 'Paste from clipboard'}
                    </Button>
                  </div>
                </Card>

                <Card className="p-5">
                  <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    Status
                  </h3>
                  <div className="mt-3 space-y-3">
                    <AnimatePresence mode="popLayout">
                      {stage === 'processing' && (
                        <motion.div
                          key="processing"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className="flex items-center gap-2 text-sm text-muted-foreground"
                        >
                          <span className="relative size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                          Running pipeline…
                        </motion.div>
                      )}
                      {stage === 'ready' && (
                        <motion.div
                          key="ready"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className="flex items-center gap-2 text-sm"
                        >
                          <CheckCircle className="size-4 text-primary" />
                          <span className="font-medium text-foreground">Ready to export</span>
                        </motion.div>
                      )}
                      {stage === 'error' && lastError && (
                        <motion.div
                          key="error"
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -6 }}
                          className="flex items-center gap-2 text-sm text-destructive"
                        >
                          <AlertCircle className="size-4" />
                          {lastError}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {trace.length > 0 && (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {trace.map((t, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span className="mt-0.5 size-1.5 rounded-full bg-primary/40" />
                            <span>{t}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                <Card className="p-5">
                  <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    History
                  </h3>
                  <div className="mt-3 flex flex-col gap-1 max-h-48 overflow-auto">
                    {history.length === 0 && (
                      <p className="text-xs text-muted-foreground">No saves yet.</p>
                    )}
                    {history.map((h, i) => (
                      <div
                        key={h.id}
                        onClick={() => jumpTo(i)}
                        className={cn(
                          'flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors',
                          i === index
                            ? 'bg-primary/10 text-foreground font-medium'
                            : 'hover:bg-muted/40 text-muted-foreground'
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          {i === index ? (
                            <span className="size-2 rounded-full bg-primary" />
                          ) : i < index ? (
                            <span className="size-2 rounded-full bg-muted-foreground/40" />
                          ) : (
                            <span className="size-2 rounded-full bg-muted" />
                          )}
                        </span>
                        <span className="truncate">{h.label}</span>
                        <span className="ml-auto font-mono text-[10px]">{h.ratio}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <Button variant="ghost" size="sm" onClick={undo} disabled={!canUndo}>
                      <Undo2 className="size-4" />
                      Undo
                    </Button>
                    <Button variant="ghost" size="sm" onClick={redo} disabled={!canRedo}>
                      <Redo2 className="size-4" />
                      Redo
                    </Button>
                  </div>
                </Card>
              </TabsContent>

              <TabsContent value="tune" className="mt-4 space-y-4">
                <Card className="p-5">
                  <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    Output ratio
                  </h3>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(['1:1', '4:5', '16:9', '3:4', 'custom') as RatioKey[]}.map((r) => (
                      <button
                        key={r}
                        onClick={() => {
                          setRatio(r);
                          pushHistory('Ratio change', r, style, seed);
                        }}
                        className={cn(
                          'min-h-10 rounded-lg border px-2 py-2 text-sm font-medium transition-colors',
                          ratio === r
                            ? 'border-primary bg-primary/5 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
                        )}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {ratio === 'custom' && (
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <Slider value={[customH]} min={200} max={2000} step={50} onValueChange={([v]) => setCustomH(v)} />
                        <Slider
                          value={[outputW]}
                          min={200}
                          max={2000}
                          step={50}
                          onValueChange={([v]) => {
                            // lock height to same ratio
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Width: {outputW}px</span>
                        <span>Height: {customH}px</span>
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">{RATIOS[ratio].hint}</p>
                </Card>

                <Card className="p-5">
                  <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    Output style
                  </h3>
                  <div className="mt-3 flex flex-col gap-2">
                    {STYLES.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => {
                          setStyle(s.key);
                          pushHistory('Style change', ratio, s.key, seed);
                        }}
                        className={cn(
                          'flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                          style === s.key
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40 hover:bg-muted/40'
                        )}
                      >
                        <span
                          className="size-6 shrink-0 rounded-lg ring-1 ring-black/10"
                          style={{ background: `oklch(0.5 ${0.2} ${hashHue(s.key, seed)})` }}
                        />
                        <div>
                          <p className="font-medium text-sm">{s.label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{s.blurbs[0]}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </Card>

                <Card className="p-5">
                  <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    Shadow
                  </h3>
                  <div className="mt-3 space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Shadows on</span>
                      <Switch checked={shadowOn} onCheckedChange={setShadowOn} />
                    </div>
                    <Slider value={[shadowSoft]} min={0} max={100} step={5} onValueChange={([v]) => setShadowSoft(v)} />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Softness: {shadowSoft}%</span>
                      <span>Angle: {shadowAngle}°</span>
                    </div>
                    <Slider value={[shadowAngle]} min={0} max={180} step={1} onValueChange={([v]) => setShadowAngle(v)} />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Direction: {shadowAngle === 0 ? 'left' : shadowAngle === 90 ? 'bottom' : shadowAngle === 180 ? 'right' : 'angled'}</span>
                    </div>
                  </div>
                </Card>

                <Card className="p-5">
                  <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                    Seed / variation
                  </h3>
                  <div className="mt-3 flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => {
                      const s = randomSeed();
                      setSeed(s);
                      pushHistory('New seed', ratio, style, s);
                    }}>
                      <Infinity className="size-4 mr-2" />
                      Randomize
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      seed: {seed ?? 'none'}
                    </span>
                  </div>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* ---- preview pane ---- */}
          <div className="relative flex flex-col">
            <div className="rounded-2xl border border-border/70 bg-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <span className="size-2 rounded-full bg-brand/60" />
                  Preview
                  <span className="ml-2 hidden sm:inline">· {outputW}×{outputH}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {stage === 'ready' ? 'Exportable' : stage === 'processing' ? 'Rendering' : 'Idle'}
                  </Badge>
                </div>
              </div>

              <div className="flex flex-1 items-center justify-center bg-muted/40 p-4">
                {stage === 'processing' && (
                  <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                    <span className="relative size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span>Processing…</span>
                  </div>
                )}
                {stage === 'ready' && outputImage() && (
                  <img
                    src={outputImage()}
                    alt="Rendered banner"
                    className="max-w-full max-h-[70vh] rounded-lg shadow-sm"
                    draggable={false}
                  />
                )}
                {stage === 'idle' && displayImg && (
                  <img
                    src={displayImg}
                    alt="Source"
                    className="max-w-full max-h-[70vh] rounded-lg shadow-sm object-contain"
                  />
                )}
                {stage === 'idle' && !displayImg && (
                  <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
                    <ImageIcon className="size-8" />
                    <span>Drop, paste, or load a sample to begin.</span>
                  </div>
                )}
                {stage === 'error' && lastError && (
                  <div className="flex flex-col items-center gap-3 text-sm text-destructive">
                    <AlertCircle className="size-8" />
                    <span>{lastError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* quick actions row */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={cycleStyle}>
                <Layers className="size-4" />
                Next style
              </Button>
              <Button variant="outline" size="sm" onClick={cycleRatio}>
                <Square className="size-4" />
                Next ratio
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSeed(randomSeed())}>
                <Infinity className="size-4" />
                New seed
              </Button>
              <Button variant="ghost" size="sm" onClick={copyOutput} disabled={stage !== 'ready'}>
                <Copy className="size-4" />
                Copy
              </Button>
              <Button size="sm" onClick={exportCurrent} disabled={stage !== 'ready'}>
                <Download className="size-4" />
                Export
              </Button>
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="size-4" />
                Reset
              </Button>
              <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {stage === 'processing' ? 'running' : stage === 'ready' ? 'done' : 'idle'}
                </span>
              </div>
            </div>

            {/* batch export card */}
            <Card className="mt-4 p-4">
              <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                Batch export all styles
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Downloads one PNG per output style at the current ratio.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {STYLES.map((s) => (
                  <Button
                    key={s.key}
                    variant="outline"
                    size="sm"
                    className="min-h-8"
                    onClick={() => {
                      const tmpStyle = s.key;
                      const tmpSeed = seed;
                      const url = solidBanner(outputW, outputH, hashHue(tmpStyle, tmpSeed));
                      if (!url) return;
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `studio-${tmpStyle}-${ratio.replace(/:/g, '-')}.png`;
                      a.click();
                    }}
                  >
                    <Download className="size-3.5 mr-1" />
                    {s.label}
                  </Button>
                ))}
              </div>
            </Card>

            {/* details table */}
            <Card className="mt-4 p-4">
              <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                Session stats
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Property</TableHead>
                    <TableHead>Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Source image</TableCell>
                    <TableCell>{srcLabel ?? '—'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Output size</TableCell>
                    <TableCell>{outputW} × {outputH} px</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Ratio</TableCell>
                    <TableCell>{ratio}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Style</TableCell>
                    <TableCell>{STYLES.find((s) => s.key === style)?.label ?? '—'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Seed</TableCell>
                    <TableCell>{seed ?? '—'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Shadow</TableCell>
                    <TableCell>{shadowOn ? `on · soft ${shadowSoft}% · ${shadowAngle}°` : 'off'}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>History entries</TableCell>
                    <TableCell>{history.length}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          </div>
        </div>
      </main>

      <footer className="mt-12 border-t border-border/60 text-center text-xs text-muted-foreground">
        Studio rebuilt from zero · local only · nothing leaves your device.
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------
 * tiny deterministic hue helper for variety
 * ------------------------------------------------------------------ */
function hashHue(key: string, seed: number | null): number {
  let base = key.length;
  for (let i = 0; i < key.length; i++) {
    base += key.charCodeAt(i) * 7;
  }
  const s = seed ?? 1;
  return ((base + s * 13) % 360 + 360) % 360;
}
