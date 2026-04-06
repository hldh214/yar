import type { Metadata } from "next";
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

export const metadata: Metadata = {
  title: "Yar - Radiko Web Player",
  description: "A third-party web frontend for radiko",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="h-full flex flex-col overflow-hidden bg-background text-foreground">
        <PlayerProvider>
          {/* Header - fixed height, never scrolls */}
          <header className="flex-shrink-0 z-40 bg-white/80 dark:bg-gray-900/80 backdrop-blur border-b border-gray-200 dark:border-gray-800">
            <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center">
              <Link href="/" className="flex items-center gap-2">
                <svg className="w-7 h-7 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                </svg>
                <span className="font-bold text-lg">Yar</span>
              </Link>
            </div>
          </header>

          {/* Main content - fills remaining height, no scroll itself */}
          <main className="flex-1 min-h-0 flex flex-col">
            {children}
          </main>

          {/* Player bar (fixed at bottom, overlays content) */}
          <PlayerBar />
        </PlayerProvider>
      </body>
    </html>
  );
}
