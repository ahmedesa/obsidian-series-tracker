export interface GenreCount {
  genre: string;
  count: number;
}

/** Ranked count of tracked items per genre (series + movies combined), descending. */
export function countGenres(genreLists: string[][]): GenreCount[] {
  const counts = new Map<string, number>();
  for (const genres of genreLists) {
    for (const g of genres) {
      const key = g.trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre));
}

export interface TasteEntry {
  genres: string[];
  myRating: number | null;
  /** TMDb's public vote average (0-10 scale). */
  publicRating: number | null;
}

export interface GenreTaste {
  genre: string;
  /** Average of the user's own 0-5 ratings for this genre. */
  myAvg: number;
  /** Average of TMDb's public 0-10 rating, rescaled to 0-5 for a like-for-like comparison. */
  publicAvg: number;
  /** myAvg - publicAvg. Positive means the user rates this genre higher than the public does. */
  diff: number;
}

/**
 * Per-genre "taste index": the user's average rating for a genre vs TMDb's
 * public average, both on a 0-5 scale. Only items with both a personal
 * rating and a TMDb public rating contribute. Returns [] if nothing
 * qualifies.
 */
export function computeTasteIndex(entries: TasteEntry[]): GenreTaste[] {
  const mine = new Map<string, number[]>();
  const pub = new Map<string, number[]>();

  for (const { genres, myRating, publicRating } of entries) {
    if (myRating === null || publicRating === null) continue;
    for (const g of genres) {
      const key = g.trim();
      if (!key) continue;
      if (!mine.has(key)) mine.set(key, []);
      if (!pub.has(key)) pub.set(key, []);
      mine.get(key)!.push(myRating);
      pub.get(key)!.push(publicRating / 2);
    }
  }

  const result: GenreTaste[] = [];
  for (const [genre, myRatings] of mine.entries()) {
    const publicRatings = pub.get(genre) ?? [];
    const myAvg = average(myRatings);
    const publicAvg = average(publicRatings);
    result.push({ genre, myAvg, publicAvg, diff: myAvg - publicAvg });
  }
  return result.sort((a, b) => b.diff - a.diff || a.genre.localeCompare(b.genre));
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}
