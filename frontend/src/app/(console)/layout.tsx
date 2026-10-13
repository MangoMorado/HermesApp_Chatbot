import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { Marquee } from "@/components/shell/marquee";

/** Consola operativa: cabecera, sesión del panel y caché de consultas. */
export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <Marquee />
      <main className="page">{children}</main>
    </Providers>
  );
}
