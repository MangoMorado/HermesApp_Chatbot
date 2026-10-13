/** Mañana de lunes a viernes, en cupos de 30 minutos. El backend recibe la franja tal cual. */
export const WEEKDAY_MORNING = {
  duration_minutes: 30,
  windows: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    start_time: "08:00",
    end_time: "12:00",
  })),
};

export const SLOT_HORIZONS = [
  { days: 14, label: "2 semanas" },
  { days: 28, label: "4 semanas" },
  { days: 56, label: "8 semanas" },
] as const;

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Rango local. `to` es exclusivo, igual que el generador del simulador. */
export function upcomingRange(now: Date, days: number): { from: string; to: string } {
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  return { from: isoDate(now), to: isoDate(end) };
}
