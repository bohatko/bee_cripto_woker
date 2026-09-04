'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App-level error caught:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col items-center justify-center p-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mb-3">
        ⚠️
      </div>
      <h2 className="text-xl font-bold font-mono text-white mb-2">Something went wrong</h2>
      <p className="text-slate-400 text-xs mb-6 max-w-md">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <button
        onClick={() => reset()}
        className="px-4 py-2 bg-honey-500 hover:bg-honey-400 text-dark-950 font-bold rounded-lg text-xs transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
