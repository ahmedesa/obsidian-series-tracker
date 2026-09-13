/**
 * Pure logic for the dashboard's "Recently watched" feed. Consumes each
 * tracked show's parsed seasons (which already carry each episode's
 * `watchedDate`, if any) and returns the most recently watched episodes
 * across all shows — no Obsidian or network dependency, fully testable.
 */

import { Season } from "./SeriesParser";

export interface RecentlyWatchedShow {
  title: string;
  image: string;
  seasons: Season[];
}

export interface RecentlyWatchedEntry {
  showTitle: string;
  showImage: string;
  season: number;
  episode: number;
  title: string;
  /** `YYYY-MM-DD`, from the episode's `(watched: ...)` stamp. */
  watchedDate: string;
}

/**
 * Every watched episode across all shows, most recently watched first.
 * Ties (same watchedDate) keep the shows'/seasons'/episodes' original
 * relative order — there's no time-of-day granularity to break ties with.
 */
export function findRecentlyWatched(shows: RecentlyWatchedShow[], limit = 10): RecentlyWatchedEntry[] {
  const entries: RecentlyWatchedEntry[] = [];

  for (const show of shows) {
    for (const season of show.seasons) {
      for (const ep of season.episodes) {
        if (!ep.watchedDate) continue;
        entries.push({
          showTitle: show.title,
          showImage: show.image,
          season: season.number,
          episode: ep.number,
          title: ep.title,
          watchedDate: ep.watchedDate,
        });
      }
    }
  }

  entries.sort((a, b) => b.watchedDate.localeCompare(a.watchedDate));
  return entries.slice(0, limit);
}
