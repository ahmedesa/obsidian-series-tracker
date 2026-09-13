/**
 * Pure logic for the dashboard's "Next Up" spotlight and "Upcoming" list.
 * Consumes a flat list of unwatched episodes (already merged with OMDb
 * air-date data by the caller) and picks/groups them — no Obsidian or
 * network dependency, so it's fully unit-testable.
 */

import { parseLocalDate } from "./dateUtil";

export interface UpcomingEpisode {
  showTitle: string;
  showImage: string;
  filePath: string;
  season: number;
  episode: number;
  title: string;
  /** OMDb's `Released` field, `YYYY-MM-DD` (or "N/A"/empty if unknown). */
  released: string;
  lineIndex: number;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The oldest aired-but-unwatched episode across all shows, or null if none. */
export function findNextUp(candidates: UpcomingEpisode[], now: number = Date.now()): UpcomingEpisode | null {
  let best: UpcomingEpisode | null = null;
  let bestTime = Infinity;
  for (const c of candidates) {
    const t = parseLocalDate(c.released);
    if (t === null || t > now) continue;
    if (t < bestTime) {
      bestTime = t;
      best = c;
    }
  }
  return best;
}

/** All unwatched episodes with a future air date, soonest first. */
export function findUpcoming(candidates: UpcomingEpisode[], now: number = Date.now()): UpcomingEpisode[] {
  return candidates
    .filter((c) => {
      const t = parseLocalDate(c.released);
      return t !== null && t > now;
    })
    .sort((a, b) => parseLocalDate(a.released)! - parseLocalDate(b.released)!);
}

export interface UpcomingGroup {
  dateLabel: string;
  episodes: UpcomingEpisode[];
}

/** Groups an already-sorted (by date) episode list into date-labeled buckets. */
export function groupUpcomingByDate(episodes: UpcomingEpisode[]): UpcomingGroup[] {
  const groups: UpcomingGroup[] = [];
  let currentLabel: string | null = null;
  let currentGroup: UpcomingGroup | null = null;

  for (const ep of episodes) {
    const label = formatDateHeading(ep.released);
    if (label !== currentLabel || !currentGroup) {
      currentGroup = { dateLabel: label, episodes: [] };
      groups.push(currentGroup);
      currentLabel = label;
    }
    currentGroup.episodes.push(ep);
  }

  return groups;
}

/** e.g. "Wednesday September 16, 2026". Returns the raw string if unparsable. */
export function formatDateHeading(released: string): string {
  const t = parseLocalDate(released);
  if (t === null) return released;
  const d = new Date(t);
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
