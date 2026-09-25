import type { Metadata, Viewport } from "next";
import { Figtree, Martian_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { Marquee } from "@/components/shell/marquee";
import "./globals.css";

const ui = Figtree({ subsets: ["latin"], variable: "--font-ui", display: "swap" });
const data = Martian_Mono({
  subsets: ["latin"],
  variable: "--font-data",
  display: "swap",
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: { default: "Ingenius360", template: "%s · Ingenius360" },
  description: "Panel operativo y consola del chatbot",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e1450",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${ui.variable} ${data.variable}`}>
      <body>
        <Providers>
          <Marquee />
          <main className="page">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
