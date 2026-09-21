/**
 * Pure logic for the dashboard's "Quick picks" strip: tracked shows that
 * still have unwatched episodes, ranked by fewest-unwatched-first — good
 * for "what can I knock out quickly." No Obsidian or network dependency,
 * fully testable.
 */

import { Season } from "./SeriesParser";

export interface QuickPickShow {
  title: string;
  image: string;
  filePath: string;
  seasons: Season[];
}

export interface QuickPickEntry {
  title: string;
  image: string;
  filePath: string;
  unwatchedCount: number;
}

/**
 * Shows with at least one unwatched episode, sorted by fewest unwatched
 * first. Shows with zero unwatched episodes (fully caught up/finished) are
 * excluded entirely. Ties break alphabetically by title for a deterministic
 * order.
 */
export function findQuickPicks(shows: QuickPickShow[]): QuickPickEntry[] {
  const entries: QuickPickEntry[] = shows
    .map((show) => {
      const unwatchedCount = show.seasons
        .flatMap((s) => s.episodes)
        .filter((e) => !e.watched).length;
      return { title: show.title, image: show.image, filePath: show.filePath, unwatchedCount };
    })
    .filter((entry) => entry.unwatchedCount > 0);

  entries.sort((a, b) => a.unwatchedCount - b.unwatchedCount || a.title.localeCompare(b.title));
  return entries;
}
