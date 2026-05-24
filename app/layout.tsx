import type { Metadata } from "next";
import "./globals.css";
import { assertRuntimeEnv } from "./lib/env";

assertRuntimeEnv();

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://tibo.app";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "TiBo",
  description: "Not what you planned, what you did. A time-boxing system that measures estimation bias.",
  applicationName: "TiBo",
  keywords: ["time boxing", "focus", "deep work", "productivity", "TiBo"],
  openGraph: {
    title: "TiBo — Not what you planned, what you did.",
    description: "A time-boxing system that measures estimation bias. No account. No cloud. Open and work.",
    type: "website",
    siteName: "TiBo",
    locale: "en_US",
    url: appUrl,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'TiBo — Not what you planned, what you did.',
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TiBo — Not what you planned, what you did.",
    description: "A time-boxing system that measures estimation bias.",
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
    <html lang="en" data-scroll-behavior="smooth">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
