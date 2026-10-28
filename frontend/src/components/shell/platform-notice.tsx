"use client";

import { usePathname } from "next/navigation";
import { useIdentity } from "@/lib/use-session";

/** Aviso en pantallas de clínica cuando la sesión es de plataforma (no opera dentro de un tenant). */
export function PlatformNotice() {
  const pathname = usePathname();
  const identity = useIdentity();
  const inTenantScreen = pathname.startsWith("/panel") || pathname.startsWith("/simulador");
  if (identity.data?.kind !== "platform" || !inTenantScreen) {
    return null;
  }
  return (
    <div className="notice" role="status">
      <span className="notice-code data">platform</span>
      <span>
        La sesión <code>platform</code> no opera dentro de una clínica: solo da de alta tenants
        (Simulador → Tenants).
      </span>
    </div>
  );
}
