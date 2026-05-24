'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { tf, useLanguage } from './lib/i18n';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { language } = useLanguage('en');
  useEffect(() => {
    console.error('Unhandled runtime error:', error);
  }, [error]);
  const t = {
    title: tf(language, 'Hata oluştu.', 'An error occurred.'),
    subtitle: tf(language, 'İşlem tamamlanamadı. Yeniden dene.', 'Action could not be completed. Try again.'),
    retry: tf(language, 'Tekrar Dene', 'Try Again'),
    home: tf(language, 'Anasayfaya Dön', 'Back Home'),
  };

  return (
    <main className="min-h-screen tibo-page px-6 py-12">
      <div className="mx-auto max-w-[720px]">
        <h1 className="tibo-h1 mb-4 text-zinc-100">{t.title}</h1>
        <p className="tibo-body mb-8 text-zinc-500">{t.subtitle}</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={reset}
            className="tibo-primary inline-flex h-14 items-center justify-center px-5 text-sm font-semibold transition-colors"
          >
            {t.retry}
          </button>
          <Link
            href="/"
            className="tibo-secondary inline-flex h-14 items-center justify-center px-5 text-sm transition-colors"
          >
            {t.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
