'use client';

import Link from 'next/link';
import { tf, useLanguage } from './lib/i18n';

export default function NotFoundPage() {
  const { language } = useLanguage('en');
  const t = {
    subtitle: tf(language, 'Sayfa bulunamadı.', 'Page not found.'),
    home: tf(language, 'Anasayfaya Dön', 'Back Home'),
  };

  return (
    <main className="min-h-screen tibo-page px-6 py-12">
      <div className="mx-auto max-w-[720px]">
        <h1 className="tibo-h1 mb-4 text-zinc-100">404</h1>
        <p className="tibo-body mb-8 text-zinc-500">{t.subtitle}</p>
        <Link
          href="/"
          className="tibo-primary inline-flex h-14 items-center justify-center px-5 text-sm font-semibold transition-colors"
        >
          {t.home}
        </Link>
      </div>
    </main>
  );
}
