import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pipette, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { VisualToolEditorProps } from './types';

interface ChromaRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const VIEWPORT_PADDING_PX = 20;
const VIEWPORT_MIN_WIDTH_PX = 220;
const VIEWPORT_MIN_HEIGHT_PX = 180;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;

type InteractionMode = 'select' | 'eyedropper' | 'magicWand';

export function ChromaKeyToolEditor({
  sourceImageUrl,
  options,
  onOptionsChange,
}: VisualToolEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const imageElementRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<InteractionMode>('select');
  const [regions, setRegions] = useState<ChromaRegion[]>(() => {
    try {
      return JSON.parse(String(options.regions ?? '[]'));
    } catch {
      return [];
    }
  });
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<ChromaRegion | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [magicWandPoints, setMagicWandPoints] = useState<Array<{ x: number; y: number }>>([]);
  const [fullImageMode, setFullImageMode] = useState(() => {
    try {
      const parsed = JSON.parse(String(options.regions ?? '[]'));
      return !Array.isArray(parsed) || parsed.length === 0;
    } catch {
      return true;
    }
  });

  const displaySourceImageUrl = useMemo(
    () => resolveImageDisplayUrl(sourceImageUrl),
    [sourceImageUrl]
  );

  const targetColor = String(options.targetColor ?? '#00b140');
  const tolerance = Number(options.tolerance ?? 0.3);
  const edgeSoftness = Number(options.edgeSoftness ?? 0.05);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const baseImageSize = useMemo(() => {
    if (naturalSize.width <= 0 || naturalSize.height <= 0) return null;

    const maxWidth = Math.max(VIEWPORT_MIN_WIDTH_PX, viewportSize.width - VIEWPORT_PADDING_PX * 2);
    const maxHeight = Math.max(VIEWPORT_MIN_HEIGHT_PX, viewportSize.height - VIEWPORT_PADDING_PX * 2);
    const ratio = Math.min(maxWidth / naturalSize.width, maxHeight / naturalSize.height, 1);

    return {
      width: Math.max(1, Math.round(naturalSize.width * ratio)),
      height: Math.max(1, Math.round(naturalSize.height * ratio)),
    };
  }, [naturalSize, viewportSize]);

  const renderedImageSize = useMemo(() => {
    if (!baseImageSize) return null;
    return {
      width: Math.round(baseImageSize.width * zoom),
      height: Math.round(baseImageSize.height * zoom),
    };
  }, [baseImageSize, zoom]);

  const scale = useMemo(() => {
    if (!renderedImageSize || naturalSize.width <= 0) return 1;
    return naturalSize.width / renderedImageSize.width;
  }, [renderedImageSize, naturalSize.width]);

  // Sync regions and magicWandPoints to options
  useEffect(() => {
    const updates: Record<string, unknown> = { ...options };
    if (fullImageMode) {
      updates.regions = '[]';
    } else {
      updates.regions = JSON.stringify(regions);
    }
    updates.magicWandPoints = JSON.stringify(magicWandPoints);
    onOptionsChange(updates as typeof options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, fullImageMode, magicWandPoints]);

  // Draw overlay
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageElementRef.current;
    if (!canvas || !renderedImageSize) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = renderedImageSize.width;
    canvas.height = renderedImageSize.height;

    // Draw image
    if (img) {
      ctx.drawImage(img, 0, 0, renderedImageSize.width, renderedImageSize.height);
    }

    if (!fullImageMode) {
      // Draw existing regions
      for (const region of regions) {
        const rx = region.x / scale;
        const ry = region.y / scale;
        const rw = region.width / scale;
        const rh = region.height / scale;

        ctx.fillStyle = 'rgba(0, 255, 100, 0.15)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = 'rgba(0, 255, 100, 0.8)';
        ctx.lineWidth = 2;
        ctx.strokeRect(rx, ry, rw, rh);
      }

      // Draw current drawing rect
      if (currentRect) {
        const rx = currentRect.x / scale;
        const ry = currentRect.y / scale;
        const rw = currentRect.width / scale;
        const rh = currentRect.height / scale;

        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);
      }
    }

    // Draw magic wand points
    for (const point of magicWandPoints) {
      const px = point.x / scale;
      const py = point.y / scale;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 200, 0, 0.8)';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }, [regions, currentRect, renderedImageSize, scale, fullImageMode, imageLoaded, magicWandPoints]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  const getCanvasPosition = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      const x = (event.clientX - rect.left) * scale;
      const y = (event.clientY - rect.top) * scale;
      return { x, y };
    },
    [scale]
  );

  // Eyedropper: pick color from the already-drawn canvas
  const pickColorAt = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const img = imageElementRef.current;
    if (!canvas || !img || !renderedImageSize) return;

    // Re-draw image onto canvas fresh to ensure we read image pixels (not overlay)
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // Save current canvas state, redraw just the image for pixel reading
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, renderedImageSize.width, renderedImageSize.height);

    const rect = canvas.getBoundingClientRect();
    const px = Math.max(0, Math.min(canvas.width - 1, Math.floor(event.clientX - rect.left)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.floor(event.clientY - rect.top)));

    const pixel = ctx.getImageData(px, py, 1, 1).data;
    ctx.restore();

    // Only update if we got a valid pixel (not transparent)
    if (pixel[3] > 0) {
      const hex = `#${pixel[0].toString(16).padStart(2, '0')}${pixel[1].toString(16).padStart(2, '0')}${pixel[2].toString(16).padStart(2, '0')}`;
      onOptionsChange({ ...options, targetColor: hex });
    }

    // Switch back to select mode after picking
    setMode('select');

    // Redraw overlay
    requestAnimationFrame(() => drawOverlay());
  }, [renderedImageSize, onOptionsChange, options, drawOverlay]);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode === 'eyedropper') {
        pickColorAt(event);
        return;
      }

      if (mode === 'magicWand') {
        // Record the click point in image coordinates
        const pos = getCanvasPosition(event);
        setMagicWandPoints((prev) => [...prev, { x: Math.round(pos.x), y: Math.round(pos.y) }]);
        return;
      }

      if (fullImageMode) return;

      const pos = getCanvasPosition(event);
      setIsDrawing(true);
      setDrawStart(pos);
      setCurrentRect(null);
    },
    [mode, fullImageMode, getCanvasPosition, pickColorAt]
  );

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (mode === 'eyedropper') return;
      if (!isDrawing || !drawStart) return;

      const pos = getCanvasPosition(event);
      const x = Math.min(drawStart.x, pos.x);
      const y = Math.min(drawStart.y, pos.y);
      const width = Math.abs(pos.x - drawStart.x);
      const height = Math.abs(pos.y - drawStart.y);

      setCurrentRect({ x, y, width, height });
    },
    [mode, isDrawing, drawStart, getCanvasPosition]
  );

  const handleMouseUp = useCallback(() => {
    if (mode === 'eyedropper') return;

    if (currentRect && currentRect.width > 5 && currentRect.height > 5) {
      setRegions((prev) => [...prev, currentRect]);
    }
    setIsDrawing(false);
    setDrawStart(null);
    setCurrentRect(null);
  }, [mode, currentRect]);

  const handleClearAll = useCallback(() => {
    setRegions([]);
  }, []);

  const handleUndoLast = useCallback(() => {
    setRegions((prev) => prev.slice(0, -1));
  }, []);

  const handleImageLoad = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    imageElementRef.current = img;
    setImageLoaded(true);
  }, []);

  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP)), []);
  const handleZoomReset = useCallback(() => setZoom(1), []);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      if (event.deltaY < 0) {
        setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP));
      } else {
        setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP));
      }
    }
  }, []);

  const cursorClass = mode === 'eyedropper' || mode === 'magicWand' ? 'cursor-crosshair' : fullImageMode ? 'cursor-default' : 'cursor-crosshair';

  return (
    <div className="space-y-3">
      {/* Row 1: Color & params */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">目标颜色</label>
          <input
            type="color"
            value={targetColor}
            onChange={(e) => onOptionsChange({ ...options, targetColor: e.target.value })}
            className="h-8 w-10 rounded border border-[rgba(255,255,255,0.12)] bg-bg-dark/90 p-0.5 cursor-pointer"
          />
          <span className="text-[11px] text-text-muted/70 font-mono">{targetColor}</span>
        </div>
        <button
          type="button"
          onClick={() => setMode(mode === 'eyedropper' ? 'select' : 'eyedropper')}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
            mode === 'eyedropper'
              ? 'border-accent/45 bg-accent/15 text-text-dark'
              : 'border-[rgba(255,255,255,0.15)] text-text-muted hover:bg-bg-dark'
          }`}
          title="吸管取色：点击图片上的颜色"
        >
          <Pipette className="h-3.5 w-3.5" />
          吸管
        </button>
        <button
          type="button"
          onClick={() => setMode(mode === 'magicWand' ? 'select' : 'magicWand')}
          className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
            mode === 'magicWand'
              ? 'border-yellow-400/45 bg-yellow-400/15 text-text-dark'
              : 'border-[rgba(255,255,255,0.15)] text-text-muted hover:bg-bg-dark'
          }`}
          title="智能选取：点击要去色的区域，自动识别连通区域"
        >
          ✨ 智能选取
        </button>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">容差</label>
          <input
            type="number"
            value={tolerance}
            min={0}
            max={1}
            step={0.01}
            onChange={(e) => onOptionsChange({ ...options, tolerance: Number(e.target.value) })}
            className="h-8 w-16 rounded-lg border border-[rgba(255,255,255,0.15)] bg-bg-dark/80 px-2 text-sm text-text-dark outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">羽化</label>
          <input
            type="number"
            value={edgeSoftness}
            min={0}
            max={0.5}
            step={0.01}
            onChange={(e) => onOptionsChange({ ...options, edgeSoftness: Number(e.target.value) })}
            className="h-8 w-16 rounded-lg border border-[rgba(255,255,255,0.15)] bg-bg-dark/80 px-2 text-sm text-text-dark outline-none"
          />
        </div>
      </div>

      {/* Row 2: Mode & region controls */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Full image toggle */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-text-muted">范围</label>
          <button
            type="button"
            onClick={() => setFullImageMode(true)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              fullImageMode
                ? 'border-accent/45 bg-accent/15 text-text-dark'
                : 'border-[rgba(255,255,255,0.15)] text-text-muted hover:bg-bg-dark'
            }`}
          >
            全图
          </button>
          <button
            type="button"
            onClick={() => setFullImageMode(false)}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
              !fullImageMode
                ? 'border-accent/45 bg-accent/15 text-text-dark'
                : 'border-[rgba(255,255,255,0.15)] text-text-muted hover:bg-bg-dark'
            }`}
          >
            框选区域
          </button>
        </div>

        {!fullImageMode && (
          <>
            <button
              type="button"
              onClick={handleUndoLast}
              disabled={regions.length === 0}
              className="rounded-lg border border-[rgba(255,255,255,0.15)] px-3 py-1.5 text-xs text-text-muted hover:bg-bg-dark disabled:opacity-40"
            >
              撤销
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={regions.length === 0}
              className="rounded-lg border border-[rgba(255,255,255,0.15)] px-3 py-1.5 text-xs text-text-muted hover:bg-bg-dark disabled:opacity-40"
            >
              清除全部
            </button>
            <span className="text-xs text-text-muted">
              已选 {regions.length} 个区域
            </span>
          </>
        )}

        {magicWandPoints.length > 0 && (
          <button
            type="button"
            onClick={() => setMagicWandPoints([])}
            className="rounded-lg border border-[rgba(255,255,255,0.15)] px-3 py-1.5 text-xs text-text-muted hover:bg-bg-dark"
          >
            清除选取点 ({magicWandPoints.length})
          </button>
        )}

        {/* Zoom controls */}
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={handleZoomOut} disabled={zoom <= ZOOM_MIN}
            className="rounded-lg border border-[rgba(255,255,255,0.15)] p-1.5 text-text-muted hover:bg-bg-dark disabled:opacity-40" title="缩小">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={handleZoomReset}
            className="rounded-lg border border-[rgba(255,255,255,0.15)] px-2 py-1 text-xs text-text-muted hover:bg-bg-dark min-w-[48px] text-center">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={handleZoomIn} disabled={zoom >= ZOOM_MAX}
            className="rounded-lg border border-[rgba(255,255,255,0.15)] p-1.5 text-text-muted hover:bg-bg-dark disabled:opacity-40" title="放大">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={handleZoomReset}
            className="rounded-lg border border-[rgba(255,255,255,0.15)] p-1.5 text-text-muted hover:bg-bg-dark" title="适应窗口">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="text-xs text-text-muted/70">
        {mode === 'eyedropper'
          ? '👆 点击图片上的颜色进行取色'
          : mode === 'magicWand'
            ? '✨ 点击要去色的区域，算法会自动识别连通的相似颜色区域（不会跨越到花卉等不同颜色的区域）'
            : fullImageMode
              ? '全图模式：将去除整张图片中匹配目标颜色的所有像素。用吸管点击灰色格子即可取色。'
              : '框选模式：拖拽框选要去色的区域。Ctrl+滚轮缩放图片。'}
      </p>

      <div
        ref={containerRef}
        className="relative h-[min(55vh,540px)] overflow-auto rounded-xl border border-[rgba(255,255,255,0.12)] bg-bg-dark/85"
        onWheel={handleWheel}
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-3"
          style={{
            minWidth: renderedImageSize ? `${renderedImageSize.width + VIEWPORT_PADDING_PX * 2}px` : undefined,
            minHeight: renderedImageSize ? `${renderedImageSize.height + VIEWPORT_PADDING_PX * 2}px` : undefined,
          }}
        >
          {renderedImageSize && (
            <div className="relative" style={{ width: renderedImageSize.width, height: renderedImageSize.height }}>
              <canvas
                ref={canvasRef}
                width={renderedImageSize.width}
                height={renderedImageSize.height}
                className={`block ${cursorClass}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              />
            </div>
          )}
          {/* Hidden image for loading */}
          <img
            ref={imageRef}
            src={displaySourceImageUrl}
            alt="Source"
            className="hidden"
            crossOrigin="anonymous"
            onLoad={handleImageLoad}
          />
        </div>
      </div>
    </div>
  );
}
