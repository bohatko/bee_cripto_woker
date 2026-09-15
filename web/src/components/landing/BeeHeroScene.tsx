'use client';

import { useEffect, useRef, useState } from 'react';

type BeeHeroSceneProps = {
  className?: string;
  onInteract?: () => void;
};

const FALLBACK_TICKERS = ['BTC', 'ETH', 'XRP', 'SOL', 'BNB', 'USDT'];

export function BeeHeroScene({ className = '', onInteract }: BeeHeroSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const interactRef = useRef<BeeHeroSceneProps['onInteract']>(onInteract);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    interactRef.current = onInteract;
  }, [onInteract]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let disposeScene: (() => void) | undefined;

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    void (async () => {
      try {
        const { createBeeScene } = await import('./bee-scene');
        if (disposed) return;
        disposeScene = createBeeScene(container, {
          reducedMotion,
          onInteract: () => interactRef.current?.(),
        });
      } catch {
        if (!disposed) {
          container.replaceChildren();
          setFallback(true);
        }
      }
    })();

    return () => {
      disposed = true;
      disposeScene?.();
    };
  }, []);

  return (
    <div className={`pointer-events-none ${className}`} aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_62%_48%,rgba(245,158,11,0.20),transparent_64%)] blur-3xl" />
      <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-honey-500/5 blur-[120px]" />
      <div ref={containerRef} className="absolute inset-0" />

      {fallback ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div className="flex h-56 w-56 items-center justify-center rounded-full border border-honey-500/30 bg-honey-500/10 text-7xl shadow-2xl shadow-honey-500/20 animate-pulse">
              🐝
            </div>
            {FALLBACK_TICKERS.map((ticker, index) => {
              const angle = (index / FALLBACK_TICKERS.length) * Math.PI * 2;
              const left = 50 + Math.cos(angle) * 46;
              const top = 50 + Math.sin(angle) * 46;
              return (
                <span
                  key={ticker}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-dark-700 bg-dark-900/90 px-2.5 py-1 font-mono text-[10px] font-semibold text-honey-400 animate-bounce"
                  style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${index * 120}ms` }}
                >
                  {ticker}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
