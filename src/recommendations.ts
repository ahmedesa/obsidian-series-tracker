import { MetadataSearchResult } from "./MetadataProvider";

export interface RatedEntry {
  genres: string[];
  rating: number | null;
}

/**
 * Top-rated genres across the user's tracked shows/movies: for each genre,
 * sums the rating of every rated item tagged with it, then returns the
 * `topN` genre names by that sum (ties broken alphabetically, for
 * deterministic output). Unrated items don't contribute. Returns `[]` if
 * nothing is rated yet — callers should treat that as "don't show
 * recommendations", not an error.
 */
export function topRatedGenres(entries: RatedEntry[], topN = 3): string[] {
  const weight = new Map<string, number>();
  for (const { genres, rating } of entries) {
    if (rating === null) continue;
    for (const g of genres) {
      const key = g.trim();
      if (!key) continue;
      weight.set(key, (weight.get(key) ?? 0) + rating);
    }
  }
  return Array.from(weight.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([genre]) => genre);
}

/**
 * Filters discover results down to titles not already tracked, matching by
 * normalized title (case/whitespace-insensitive) — discover results carry a
 * TMDb id, not an IMDb id, so an exact id match isn't cheaply available
 * here; title matching is good enough to avoid re-suggesting something the
 * user already has, without needing an extra resolve call per candidate.
 */
export function excludeTracked(
  candidates: MetadataSearchResult[],
  trackedTitles: Set<string>,
): MetadataSearchResult[] {
  return candidates.filter((c) => !trackedTitles.has(normalizeTitle(c.title)));
}

export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}
