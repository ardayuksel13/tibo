import type { Metadata } from "next";
import "./globals.css";
import { assertRuntimeEnv } from "./lib/env";

assertRuntimeEnv();

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://tibo.app";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "TiBo",
  description: "Ne planladığın değil, ne yaptığın. Tahmin yanılgısını ölçen time boxing sistemi.",
  applicationName: "TiBo",
  keywords: ["time boxing", "focus", "deep work", "productivity", "TiBo"],
  openGraph: {
    title: "TiBo — Ne planladığın değil, ne yaptığın.",
    description: "Tahmin yanılgısını ölçen time boxing sistemi. Hesap yok, kayıt yok. Aç ve çalış.",
    type: "website",
    siteName: "TiBo",
    locale: "tr_TR",
    url: appUrl,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'TiBo — Ne planladığın değil, ne yaptığın.',
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TiBo — Ne planladığın değil, ne yaptığın.",
    description: "Tahmin yanılgısını ölçen time boxing sistemi.",
    images: ['/og-image.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-96x96.png', sizes: '96x96', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
