"use client";

import { useEffect, useState } from "react";

const format = new Intl.DateTimeFormat("es-CO", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Reloj del tablero; se pinta solo en cliente para no desalinear la hidratación. */
export function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <time className="clock data" dateTime={now?.toISOString()} suppressHydrationWarning>
      {now ? format.format(now) : "--:--"}
    </time>
  );
}
