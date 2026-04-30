"use client";

import { useEffect, useRef } from "react";

interface GeneratingCardProps {
  aspect: string;
  index: number;
  elapsed: number | null;
  dark: boolean;
}

export default function GeneratingCard({ aspect, index, elapsed, dark }: GeneratingCardProps) {
  return (
    <div
      className="generating-card"
      aria-label={`正在生成图片${elapsed !== null ? `，已等待 ${elapsed} 秒` : ""}`}
      style={{
        aspectRatio: aspect,
        "--preview-delay": `${index * 0.18}s`,
      } as React.CSSProperties}
    >
      <FlickeringGrid
        color={dark ? "255,255,255" : "58,52,44"}
        flickerChance={dark ? 0.08 : 0.06}
        gridGap={8}
        maxOpacity={dark ? 0.1 : 0.078}
        squareSize={5}
      />
      <div className="generating-card__label">
        正在创建图像......
      </div>
    </div>
  );
}

interface FlickeringGridProps {
  color: string;
  flickerChance: number;
  gridGap: number;
  maxOpacity: number;
  squareSize: number;
}

function FlickeringGrid({ color, flickerChance, gridGap, maxOpacity, squareSize }: FlickeringGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    let animationFrameId = 0;
    let width = 0;
    let height = 0;
    let columns = 0;
    let rows = 0;
    let opacities: number[] = [];
    const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = reduceMotionQuery.matches;

    const initializeGrid = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.floor(rect.width + 24));
      height = Math.max(1, Math.floor(rect.height + 24));
      columns = Math.ceil(width / (squareSize + gridGap));
      rows = Math.ceil(height / (squareSize + gridGap));
      opacities = Array.from({ length: columns * rows }, () => Math.random() * maxOpacity);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const drawGrid = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);

      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
          const idx = row * columns + col;
          if (!reduceMotion && Math.random() < flickerChance) {
            opacities[idx] = Math.random() * maxOpacity;
          }
          const x = col * (squareSize + gridGap) - 12;
          const y = row * (squareSize + gridGap) - 12;
          ctx.fillStyle = `rgba(${color}, ${opacities[idx]})`;
          ctx.fillRect(x, y, squareSize, squareSize);
        }
      }

      if (!reduceMotion) {
        animationFrameId = window.requestAnimationFrame(drawGrid);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      window.cancelAnimationFrame(animationFrameId);
      initializeGrid();
      drawGrid();
    });

    const handleReduceMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      window.cancelAnimationFrame(animationFrameId);
      drawGrid();
    };

    initializeGrid();
    drawGrid();
    resizeObserver.observe(parent);
    reduceMotionQuery.addEventListener("change", handleReduceMotionChange);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      reduceMotionQuery.removeEventListener("change", handleReduceMotionChange);
    };
  }, [color, flickerChance, gridGap, maxOpacity, squareSize]);

  return <canvas className="flickering-grid" ref={canvasRef} aria-hidden="true" />;
}
