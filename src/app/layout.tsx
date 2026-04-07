import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { PlayerProvider } from "@/lib/player-context";
import PlayerBar from "@/components/PlayerBar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111827" },
  ],
};

export const metadata: Metadata = {
  title: "Yar - Radiko Web Player",
  description: "A third-party web frontend for radiko",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Yar",
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} min-h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <PlayerProvider>
          {/* Header - sticky at top */}
          <header className="flex-shrink-0 z-40 pt-safe bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800 sticky top-0">
            <div className="max-w-screen-xl mx-auto px-4 pl-safe pr-safe h-14 flex items-center">
              <Link href="/" className="flex items-center gap-2">
                <svg className="w-7 h-7 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
                <span className="font-bold text-lg">Yar</span>
              </Link>
            </div>
          </header>

          {/* Main content */}
          <main className="flex-1 flex flex-col">
            {children}
          </main>

          {/* Footer */}
          <footer className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 text-center text-xs text-gray-400 dark:text-gray-500 py-4 px-4"
            style={{ paddingBottom: 'calc(var(--player-bar-h, 0px) + 1rem)' }}>
            <p>
              <a href="https://github.com/hldh214/yar" target="_blank" rel="noopener noreferrer"
                className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                Yar
              </a>
              {' '}&mdash; Open-source Radiko web player &middot; MIT License
            </p>
            <p className="mt-0.5 font-mono">
              {process.env.NEXT_PUBLIC_GIT_VERSION || 'dev'}
            </p>
          </footer>

          {/* Player bar (fixed at bottom, overlays content) */}
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}
