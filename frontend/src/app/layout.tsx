import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { TokenBar } from "@/components/token-bar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chatbot Ingenius 360",
  description: "Panel operativo y consola del chatbot",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Providers>
          <header className="site-header">
            <Link href="/">Chatbot Ingenius 360</Link>
            <nav>
              <Link href="/panel">Panel</Link>
              <Link href="/panel/ajustes">Ajustes</Link>
              <Link href="/simulador">Simulador</Link>
            </nav>
          </header>
          <TokenBar />
          <main className="site-main">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
