import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Whale Tracker — Polymarket → Kalshi",
  description: "Spot large bets on Polymarket and copy-trade them on Kalshi.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
