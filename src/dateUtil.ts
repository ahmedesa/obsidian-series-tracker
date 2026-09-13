/** Today's date as `YYYY-MM-DD`, in the local timezone. */
export function todayIso(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parses an TMDb `YYYY-MM-DD` date as local midnight rather than UTC
 * midnight — `new Date("2026-09-16")` parses as UTC, which shifts the
 * effective local date by one day in negative-UTC-offset timezones.
 * Returns null for missing/unparsable/`"N/A"` input.
 */
export function parseLocalDate(released: string | null | undefined): number | null {
  if (!released || released === "N/A") return null;
  const t = new Date(`${released}T00:00:00`).getTime();
  return isNaN(t) ? null : t;
}

/** True if `released` parses to a date at or before `now`. */
export function isAired(released: string | null | undefined, now: number = Date.now()): boolean {
  const t = parseLocalDate(released);
  return t !== null && t <= now;
}
