import Link from 'next/link';

export default function NotFoundPage() {
  return (
    <main className="min-h-screen tibo-page px-6 py-12">
      <div className="mx-auto max-w-[720px]">
        <h1 className="tibo-h1 mb-4 text-zinc-100">404</h1>
        <p className="tibo-body mb-8 text-zinc-500">Sayfa bulunamadı.</p>
        <Link
          href="/"
          className="inline-flex h-11 items-center justify-center bg-[var(--color-primary)] px-5 text-sm font-semibold text-[#020617] transition-colors hover:bg-[var(--color-primary-hover)]"
        >
          Anasayfaya Dön
        </Link>
      </div>
    </main>
  );
}
