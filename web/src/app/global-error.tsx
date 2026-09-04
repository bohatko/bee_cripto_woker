'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-dark-950 text-slate-100 flex flex-col items-center justify-center min-h-screen p-4 text-center" suppressHydrationWarning>
        <h2 className="text-xl font-bold font-mono text-rose-400 mb-2">Application Error</h2>
        <p className="text-slate-400 text-xs mb-6 max-w-md">{error.message || 'Fatal error occurred.'}</p>
        <button
          onClick={() => reset()}
          className="px-4 py-2 bg-honey-500 hover:bg-honey-400 text-dark-950 font-bold rounded-lg text-xs transition-colors"
        >
          Try again
        </button>
      </body>
    </html>
  );
}
