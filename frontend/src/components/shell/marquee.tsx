"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useIdentity, useToken } from "@/lib/use-session";
import { Clock } from "./clock";
import { PLATFORMS, SESSION_SHORTCUT } from "./platforms";
import { SessionDrawer } from "./session-drawer";

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
  );
}

/** Atajos 1–7 para cambiar de pantalla y 0 para abrir/cerrar la sesión. */
function useShortcuts(toggleSession: () => void) {
  const router = useRouter();
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) {
        return;
      }
      const platform = PLATFORMS.find((item) => item.key === event.key);
      if (platform) {
        router.push(platform.href);
      } else if (event.key === SESSION_SHORTCUT) {
        toggleSession();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggleSession]);
}

function SessionChip({
  open,
  onToggle,
}: {
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const token = useToken();
  const identity = useIdentity();
  let state = "off";
  let label = "Sin sesión";
  if (token && identity.isError) {
    state = "error";
    label = "Sesión rechazada";
  } else if (token && identity.data) {
    state = "on";
    const me = identity.data;
    label = me.kind === "tenant" ? `${me.role} · ${me.tenantId.slice(0, 8)}` : "platform";
  } else if (token) {
    label = "Verificando…";
  }
  return (
    <button
      type="button"
      className="session-chip"
      aria-expanded={open}
      aria-controls="session"
      aria-keyshortcuts={SESSION_SHORTCUT}
      onClick={onToggle}
    >
      <span className="session-dot" data-state={state} aria-hidden="true" />
      <span className="session-label">{label}</span>
      <span className="session-role">{identity.data?.role ?? ""}</span>
      <span className="visually-hidden">— abrir sesión</span>
      <kbd>{SESSION_SHORTCUT}</kbd>
    </button>
  );
}

export function Marquee() {
  const pathname = usePathname();
  const token = useToken();
  const [override, setOverride] = useState<boolean | null>(null);
  // Sin token la franja de sesión arranca abierta: es lo primero que hay que hacer.
  const open = override ?? !token;
  const toggle = useCallback(() => setOverride((current) => !(current ?? !token)), [token]);
  useShortcuts(toggle);

  return (
    <>
      <header className="marquee">
        <Link href="/" className="brand" aria-label="Ingenius360, inicio">
          <Image
            className="brand-full"
            src="/logotipo-claro.png"
            alt=""
            width={115}
            height={28}
            priority
          />
          <Image className="brand-mark" src="/isotipo.png" alt="" width={24} height={29} />
        </Link>
        <nav className="platforms" aria-label="Pantallas">
          {PLATFORMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="platform"
              aria-current={pathname === item.href ? "page" : undefined}
              aria-keyshortcuts={item.key}
            >
              {item.label}
              <kbd>{item.key}</kbd>
            </Link>
          ))}
        </nav>
        <div className="marquee-end">
          <Clock />
          <SessionChip open={open} onToggle={toggle} />
        </div>
      </header>
      {open ? <SessionDrawer /> : null}
    </>
  );
}
