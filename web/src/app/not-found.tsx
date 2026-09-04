import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-dark-950 flex flex-col items-center justify-center p-4 text-center">
      <h1 className="text-4xl font-bold font-mono text-honey-400 mb-2">404</h1>
      <p className="text-slate-400 text-sm mb-6">Page not found</p>
      <Link
        href="/dashboard"
        className="px-4 py-2 bg-honey-500 hover:bg-honey-400 text-dark-950 font-semibold rounded-lg text-sm transition-colors"
      >
        Return to Dashboard
      </Link>
    </div>
  );
}
