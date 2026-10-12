// ============================================================================
// Iterative Render Panel - UI for Mode 1 (find flaws) & Mode 2 (fix)
// ============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Cutout } from '@/lib/pipeline/segmentation';
import { iterativeRender, quickRender } from '@/lib/pipeline/iterativeRender';
import type { RenderedImage } from '@/lib/pipeline/renderTypes';

interface IterativeRenderPanelProps {
  cutout: Cutout | null;
  onRenderComplete?: (image: RenderedImage) => void;
  autoStart?: boolean;
}

type Mode = 1 | 2;
type Status = 'idle' | 'rendering' | 'complete' | 'error';

export function IterativeRenderPanel({
  cutout,
  onRenderComplete,
  autoStart = false,
}: IterativeRenderPanelProps) {
  const [mode, setMode] = useState<Mode>(1);
  const [status, setStatus] = useState<Status>('idle');
  const [currentImage, setCurrentImage] = useState<RenderedImage | null>(null);
  const [complexity, setComplexity] = useState(0);
  const [iteration, setIteration] = useState(0);
  const [flaws, setFlaws] = useState<Array<{
    type: string;
    severity: number;
    description: string;
  }>>([]);
  const [quality, setQuality] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  
  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-50), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // Render the current result to canvas
  useEffect(() => {
    if (!currentImage || !canvasRef.current) return;
    
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
    };
    img.src = currentImage.result.url;
  }, [currentImage]);

  const runRender = useCallback(async (mode: Mode, complexityLevel: number) => {
    if (!cutout) {
      setStatus('error');
      addLog('No cutout available');
      return;
    }
    
    abortRef.current = false;
    setStatus('rendering');
    setIteration(0);
    setFlaws([]);
    setQuality(0);
    addLog(`Starting ${mode === 1 ? 'Mode 1 (Find Flaws)' : 'Mode 2 (Fix)'} at complexity ${complexityLevel}`);
    
    try {
      // Convert cutout alpha to plain array for the render function
      const alphaData = new Uint8ClampedArray(cutout.alpha);
      const result = await iterativeRender(
        alphaData,
        cutout.width,
        cutout.height,
        mode,
        5, // max iterations
        complexityLevel
      );
      
      if (abortRef.current) {
        addLog('Render cancelled');
        return;
      }
      
      setCurrentImage(result);
      setFlaws(result.result.flaws);
      setQuality(result.result.qualityScore);
      setIteration(result.iteration);
      setComplexity(result.complexityLevel);
      
      addLog(`Completed: quality ${(result.result.qualityScore * 100).toFixed(0)}%, ${result.result.flaws.length} flaws`);
      
      if (onRenderComplete) {
        onRenderComplete(result);
      }
      
      setStatus('complete');
    } catch (err) {
      console.error('Render error:', err);
      addLog(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setStatus('error');
    }
  }, [cutout, onRenderComplete, addLog]);

  const handleStart = useCallback(() => {
    setLog([]);
    runRender(mode, complexity);
  }, [mode, complexity, runRender]);

  const handleModeChange = useCallback((newMode: Mode) => {
    setMode(newMode);
    setStatus('idle');
    setCurrentImage(null);
    setFlaws([]);
    setQuality(0);
    addLog(`Switched to Mode ${newMode}`);
  }, [addLog]);

  const handleComplexityChange = useCallback((delta: number) => {
    const newComplexity = Math.max(0, Math.min(10, complexity + delta));
    setComplexity(newComplexity);
    addLog(`Complexity: ${newComplexity}`);
  }, [complexity, addLog]);

  const handleCancel = useCallback(() => {
    abortRef.current = true;
    setStatus('idle');
    addLog('Cancelled');
  }, [addLog]);

  const handleRetry = useCallback(() => {
    if (currentImage && currentImage.mode === 1 && currentImage.result.flaws.length > 0) {
      // Switch to mode 2 to fix the flaws found in mode 1
      setMode(2);
      handleStart();
    } else {
      // Re-run with increased complexity if we want harder images
      setMode(1);
      handleComplexityChange(1);
      setTimeout(() => handleStart(), 100);
    }
  }, [currentImage, handleStart, handleComplexityChange]);

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && cutout && status === 'idle') {
      handleStart();
    }
  }, [autoStart, cutout, status, handleStart]);

  const totalSeverity = flaws.reduce((sum, f) => sum + f.severity, 0);
  const hasCriticalFlaws = flaws.some(f => f.severity > 0.7);

  return (
    <div className="iterative-render-panel">
      <div className="irp-header">
        <h3>Iterative Render Engine</h3>
        <div className="irp-status">
          <span className={`irp-status-badge status-${status}`}>
            {status === 'idle' && 'Ready'}
            {status === 'rendering' && 'Rendering...'}
            {status === 'complete' && 'Complete'}
            {status === 'error' && 'Error'}
          </span>
        </div>
      </div>

      <div className="irp-controls">
        <div className="irp-mode-selector">
          <button
            className={`irp-mode-btn ${mode === 1 ? 'active' : ''}`}
            onClick={() => handleModeChange(1)}
          >
            <span className="irp-mode-icon">🔍</span>
            <span className="irp-mode-title">Mode 1</span>
            <span className="irp-mode-desc">Find Flaws</span>
          </button>
          <button
            className={`irp-mode-btn ${mode === 2 ? 'active' : ''}`}
            onClick={() => handleModeChange(2)}
          >
            <span className="irp-mode-icon">🛠️</span>
            <span className="irp-mode-title">Mode 2</span>
            <span className="irp-mode-desc">Fix Issues</span>
          </button>
        </div>

        <div className="irp-complexity">
          <label className="irp-label">
            Complexity:
            <span className="irp-value">{complexity}/10</span>
          </label>
          <div className="irp-complexity-controls">
            <button
              className="irp-complexity-btn"
              onClick={() => handleComplexityChange(-1)}
              disabled={complexity <= 0 || status === 'rendering'}
            >
              ◀
            </button>
            <div className="irp-complexity-bar">
              <div
                className="irp-complexity-fill"
                style={{ width: `${(complexity / 10) * 100}%` }}
              />
            </div>
            <button
              className="irp-complexity-btn"
              onClick={() => handleComplexityChange(1)}
              disabled={complexity >= 10 || status === 'rendering'}
            >
              ▶
            </button>
          </div>
        </div>

        <div className="irp-actions">
          <button
            className="irp-primary-btn"
            onClick={handleStart}
            disabled={status === 'rendering' || !cutout}
          >
            {status === 'rendering' ? 'Rendering...' : mode === 1 ? 'Find Flaws' : 'Apply Fixes'}
          </button>
          {status === 'rendering' && (
            <button className="irp-secondary-btn" onClick={handleCancel}>
              Cancel
            </button>
          )}
          {status === 'complete' && (
            <>
              <button className="irp-secondary-btn" onClick={handleRetry}>
                {mode === 1 ? 'Switch to Fix Mode' : 'Re-render'}
              </button>
              <button className="irp-secondary-btn" onClick={() => {
                setComplexity(0);
                handleModeChange(1);
              }}>
                Reset
              </button>
            </>
          )}
        </div>
      </div>

      <div className="irp-content" ref={containerRef}>
        <div className="irp-visual">
          <canvas ref={canvasRef} className="irp-canvas" />
          {status === 'idle' && !currentImage && (
            <div className="irp-placeholder">
              {cutout ? 'Load an image to start' : 'No cutout available'}
            </div>
          )}
        </div>

        <div className="irp-analysis">
          <div className="irp-quality">
            <div className="irp-quality-label">Quality Score</div>
            <div className="irp-quality-value">
              {(quality * 100).toFixed(0)}%
            </div>
            <div className="irp-quality-bar">
              <div
                className="irp-quality-fill"
                style={{
                  width: `${quality * 100}%`,
                  backgroundColor: quality > 0.8 ? '#22c55e' : quality > 0.5 ? '#f59e0b' : '#ef4444'
                }}
              />
            </div>
          </div>

          <div className="irp-stats">
            <div className="irp-stat">
              <span className="irp-stat-label">Iteration</span>
              <span className="irp-stat-value">{iteration}</span>
            </div>
            <div className="irp-stat">
              <span className="irp-stat-label">Flaws Found</span>
              <span className="irp-stat-value">{flaws.length}</span>
            </div>
            <div className="irp-stat">
              <span className="irp-stat-label">Total Severity</span>
              <span className="irp-stat-value">{totalSeverity.toFixed(2)}</span>
            </div>
          </div>

          {flaws.length > 0 && (
            <div className="irp-flaws">
              <div className="irp-flaws-header">
                <span>Detected Issues</span>
                {hasCriticalFlaws && (
                  <span className="irp-critical-badge">Critical</span>
                )}
              </div>
              <ul className="irp-flaws-list">
                {flaws.map((flaw, i) => (
                  <li key={i} className={`irp-flaw ${flaw.severity > 0.7 ? 'critical' : ''}`}>
                    <span className="irp-flaw-type">
                      {flaw.type.replace(/_/g, ' ')}
                    </span>
                    <span className="irp-flaw-severity">
                      {(flaw.severity * 100).toFixed(0)}%
                    </span>
                    <span className="irp-flaw-desc">{flaw.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {flaws.length === 0 && status === 'complete' && (
            <div className="irp-no-flaws">
              <span className="irp-success-icon">✓</span>
              <span>No flaws detected - image is clean</span>
            </div>
          )}
        </div>
      </div>

      <div className="irp-log">
        <div className="irp-log-header">
          <span>Activity Log</span>
          <button className="irp-log-clear" onClick={() => setLog([])}>Clear</button>
        </div>
        <ul className="irp-log-list">
          {log.map((entry, i) => (
            <li key={i} className="irp-log-entry">{entry}</li>
          ))}
        </ul>
      </div>

      <style>{`
        .iterative-render-panel {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1rem;
          border: 1px solid var(--border);
          border-radius: 0.75rem;
          background: var(--background);
        }

        .irp-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .irp-status-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .status-idle { background: var(--muted); color: var(--muted-foreground); }
        .status-rendering { background: var(--primary); color: white; animation: pulse 1s infinite; }
        .status-complete { background: #22c55e; color: white; }
        .status-error { background: #ef4444; color: white; }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .irp-controls {
          display: flex;
          gap: 1rem;
          align-items: center;
          flex-wrap: wrap;
        }

        .irp-mode-selector {
          display: flex;
          gap: 0.5rem;
        }

        .irp-mode-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
          padding: 0.75rem 1rem;
          border: 1px solid var(--border);
          border-radius: 0.5rem;
          background: var(--card);
          color: var(--foreground);
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .irp-mode-btn:hover {
          border-color: var(--primary);
        }

        .irp-mode-btn.active {
          border-color: var(--primary);
          background: var(--primary)/10;
        }

        .irp-mode-icon { font-size: 1.25rem; }
        .irp-mode-title { font-weight: 600; font-size: 0.875rem; }
        .irp-mode-desc { font-size: 0.75rem; color: var(--muted-foreground); }

        .irp-complexity {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .irp-label {
          font-size: 0.875rem;
          color: var(--muted-foreground);
        }

        .irp-value {
          font-weight: 600;
          color: var(--foreground);
          margin-left: 0.5rem;
        }

        .irp-complexity-controls {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .irp-complexity-btn {
          width: 2rem;
          height: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border);
          border-radius: 0.375rem;
          background: var(--card);
          color: var(--foreground);
          cursor: pointer;
        }

        .irp-complexity-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .irp-complexity-bar {
          flex: 1;
          height: 0.5rem;
          background: var(--muted);
          border-radius: 9999px;
          overflow: hidden;
        }

        .irp-complexity-fill {
          height: 100%;
          background: var(--primary);
          transition: width 0.3s ease;
        }

        .irp-actions {
          display: flex;
          gap: 0.5rem;
          margin-left: auto;
        }

        .irp-primary-btn {
          padding: 0.5rem 1rem;
          background: var(--primary);
          color: white;
          border: none;
          border-radius: 0.375rem;
          font-weight: 500;
          cursor: pointer;
          transition: opacity 0.15s ease;
        }

        .irp-primary-btn:hover:not(:disabled) {
          opacity: 0.9;
        }

        .irp-primary-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .irp-secondary-btn {
          padding: 0.5rem 1rem;
          background: var(--card);
          color: var(--foreground);
          border: 1px solid var(--border);
          border-radius: 0.375rem;
          cursor: pointer;
        }

        .irp-content {
          display: grid;
          grid-template-columns: 1fr 300px;
          gap: 1rem;
        }

        @media (max-width: 768px) {
          .irp-content {
            grid-template-columns: 1fr;
          }
        }

        .irp-visual {
          position: relative;
          background: var(--muted);
          border-radius: 0.5rem;
          overflow: hidden;
          min-height: 300px;
        }

        .irp-canvas {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }

        .irp-placeholder {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--muted-foreground);
        }

        .irp-analysis {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .irp-quality {
          text-align: center;
        }

        .irp-quality-label {
          font-size: 0.75rem;
          color: var(--muted-foreground);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .irp-quality-value {
          font-size: 2rem;
          font-weight: 700;
          color: var(--foreground);
        }

        .irp-quality-bar {
          height: 0.5rem;
          background: var(--muted);
          border-radius: 9999px;
          overflow: hidden;
          margin-top: 0.5rem;
        }

        .irp-quality-fill {
          height: 100%;
          transition: width 0.3s ease, background-color 0.3s ease;
        }

        .irp-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.5rem;
          padding: 0.75rem;
          background: var(--card);
          border-radius: 0.5rem;
        }

        .irp-stat {
          text-align: center;
        }

        .irp-stat-label {
          display: block;
          font-size: 0.75rem;
          color: var(--muted-foreground);
        }

        .irp-stat-value {
          display: block;
          font-size: 1.25rem;
          font-weight: 600;
        }

        .irp-flaws {
          background: var(--card);
          border-radius: 0.5rem;
          overflow: hidden;
        }

        .irp-flaws-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem 0.75rem;
          background: var(--muted);
          font-weight: 500;
          font-size: 0.875rem;
        }

        .irp-critical-badge {
          padding: 0.125rem 0.5rem;
          background: #ef4444;
          color: white;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .irp-flaws-list {
          list-style: none;
          margin: 0;
          padding: 0.5rem;
          max-height: 200px;
          overflow-y: auto;
        }

        .irp-flaw {
          padding: 0.5rem;
          background: var(--background);
          border-radius: 0.375rem;
          margin-bottom: 0.5rem;
          font-size: 0.875rem;
        }

        .irp-flaw:last-child {
          margin-bottom: 0;
        }

        .irp-flaw.critical {
          border-left: 3px solid #ef4444;
        }

        .irp-flaw-type {
          font-weight: 600;
          color: var(--foreground);
          text-transform: capitalize;
        }

        .irp-flaw-severity {
          color: var(--muted-foreground);
          font-size: 0.75rem;
          margin-left: 0.5rem;
        }

        .irp-flaw-desc {
          display: block;
          color: var(--muted-foreground);
          font-size: 0.75rem;
          margin-top: 0.25rem;
        }

        .irp-no-flaws {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 1rem;
          background: #22c55e/10;
          border: 1px solid #22c55e;
          border-radius: 0.5rem;
          color: #22c55e;
          font-weight: 500;
        }

        .irp-success-icon {
          font-size: 1.25rem;
        }

        .irp-log {
          background: var(--card);
          border-radius: 0.5rem;
          overflow: hidden;
        }

        .irp-log-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem 0.75rem;
          background: var(--muted);
          font-weight: 500;
          font-size: 0.875rem;
        }

        .irp-log-clear {
          background: none;
          border: none;
          color: var(--muted-foreground);
          cursor: pointer;
          font-size: 0.75rem;
          padding: 0.25rem 0.5rem;
          border-radius: 0.25rem;
        }

        .irp-log-clear:hover {
          background: var(--background);
        }

        .irp-log-list {
          list-style: none;
          margin: 0;
          padding: 0.5rem;
          max-height: 100px;
          overflow-y: auto;
          font-family: monospace;
          font-size: 0.75rem;
        }

        .irp-log-entry {
          padding: 0.125rem 0;
          color: var(--muted-foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
    </div>
  );
}
