import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { Marquee } from "@/components/shell/marquee";
import { PlatformNotice } from "@/components/shell/platform-notice";
import { oidcConfig } from "@/config/env";
import { AuthProvider } from "@/lib/auth/auth-provider";

// El proveedor de identidad se lee en cada petición, no en el build.
export const dynamic = "force-dynamic";

/** Consola operativa: cabecera, sesión OIDC del panel y caché de consultas. */
export default function ConsoleLayout({ children }: { readonly children: ReactNode }) {
  return (
    <AuthProvider config={oidcConfig()}>
      <Providers>
        <Marquee />
        <main className="page">
          <PlatformNotice />
          {children}
        </main>
      </Providers>
    </AuthProvider>
  );
}
