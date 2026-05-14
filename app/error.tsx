'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled runtime error:', error);
  }, [error]);

  return (
    <main className="min-h-screen tibo-page px-6 py-12">
      <div className="mx-auto max-w-[720px]">
        <h1 className="tibo-h1 mb-4 text-zinc-100">Hata oluştu.</h1>
        <p className="tibo-body mb-8 text-zinc-500">İşlem tamamlanamadı. Yeniden dene.</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="tibo-primary inline-flex h-14 items-center justify-center px-5 text-sm font-semibold transition-colors"
          >
            Tekrar Dene
          </button>
          <Link
            href="/"
            className="tibo-secondary inline-flex h-14 items-center justify-center px-5 text-sm transition-colors"
          >
            Anasayfaya Dön
          </Link>
        </div>
      </div>
    </main>
  );
}
