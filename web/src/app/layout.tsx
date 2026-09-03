import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bee Crypto Worker | Market-Neutral Alpha Trading Platform",
  description: "Automated multi-pair long-short algorithmic trading basket for Binance, OKX, and Bybit with zero market beta.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-dark-950 text-slate-100 antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
